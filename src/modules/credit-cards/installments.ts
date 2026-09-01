import { Money } from "@/modules/transactions/money";

import {
  normalizeBillingDay,
  parseBillingDate,
  parseBillingMonth,
  resolveBillingRule,
  resolveBillingCycle,
  serializeBillingDate,
  serializeBillingMonth,
  type BillingCycleSnapshot,
  type BillingDateInput,
  type BillingRule,
} from "./billing-cycle";

/**
 * The operational limit is deliberately shared with the S06 boundary and
 * schema.  It prevents an accidental unbounded allocation from creating an
 * unusable schedule while keeping the domain independent of persistence.
 */
export const MIN_INSTALLMENT_COUNT = 1 as const;
export const MAX_INSTALLMENT_COUNT = 120 as const;
export const MAX_INSTALLMENTS = MAX_INSTALLMENT_COUNT;
export const MAX_INSTALLMENT_COUNT_OPERATIONAL = MAX_INSTALLMENT_COUNT;

/** PostgreSQL BIGINT's positive upper bound, kept as bigint end-to-end. */
export const MAX_INSTALLMENT_AMOUNT_CENTS = BigInt("9223372036854775807");
export const MAX_CREDIT_CARD_AMOUNT_CENTS = MAX_INSTALLMENT_AMOUNT_CENTS;

export const INSTALLMENT_STATUSES = [
  "PLANNED",
  "POSTED",
  "CANCELLED",
] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export const INSTALLMENT_PLAN_STATUSES = ["ACTIVE", "CANCELLED"] as const;
export type InstallmentPlanStatus =
  (typeof INSTALLMENT_PLAN_STATUSES)[number];

export const INSTALLMENT_ERROR_CODES = [
  "INVALID_AMOUNT",
  "AMOUNT_OUT_OF_RANGE",
  "INVALID_INSTALLMENT_COUNT",
  "INSTALLMENT_COUNT_OUT_OF_RANGE",
  "INVALID_INSTALLMENT_PLAN",
  "INVALID_INSTALLMENT",
  "INVALID_STATE",
  "INSTALLMENT_MUTATION_FORBIDDEN",
  "PAYMENT_INSTALLMENT_FORBIDDEN",
  "PLAN_ALREADY_CANCELLED",
  "SCHEDULE_INVARIANT_VIOLATION",
  "INVALID_DATE",
] as const;
export type InstallmentErrorCode = (typeof INSTALLMENT_ERROR_CODES)[number];

/** Stable errors for pure aggregate validation and state transitions. */
export class InstallmentDomainError extends Error {
  readonly code: InstallmentErrorCode;
  readonly field?: string;

  constructor(code: InstallmentErrorCode, message: string, field?: string) {
    super(message);
    this.name = "InstallmentDomainError";
    this.code = code;
    this.field = field;
  }
}

export const CreditCardInstallmentError = InstallmentDomainError;
export const InstallmentError = InstallmentDomainError;

type InstallmentAmount = bigint | string | Money;

/** The frozen, serializable rule metadata needed to explain a schedule. */
export interface BillingRuleSnapshot {
  readonly id: string | null;
  readonly closingDay: number;
  readonly dueDay: number;
  readonly effectiveFrom: string | null;
  readonly effectiveUntil: string | null;
}

/**
 * A materialized schedule row.  `amountCents` remains bigint in the domain;
 * `serializeInstallment` is the explicit boundary conversion for commands or
 * read models.  The resolved billing fields are duplicated intentionally as a
 * row snapshot so changing a card rule cannot reinterpret history.
 */
export interface Installment {
  readonly planId: string;
  /** Alias consumed by adapters that use the aggregate's longer name. */
  readonly installmentPlanId: string;
  readonly purchaseId: string;
  readonly sequence: number;
  readonly amountCents: bigint;
  readonly status: InstallmentStatus;
  readonly billingRuleId: string | null;
  readonly billingCycle: string;
  readonly cycle: string;
  readonly competence: string;
  readonly billingClosingDay: number;
  readonly billingDueDay: number;
  readonly billingClosingOn: string;
  readonly billingDueOn: string;
  readonly billingDueOnOverride: string | null;
  readonly billingSnapshot: BillingCycleSnapshot;
}

/** Aggregate boundary used by T06/T07/T09. */
export interface InstallmentPlan {
  readonly id: string;
  readonly planId: string;
  readonly purchaseId: string;
  readonly totalAmountCents: bigint;
  readonly installmentCount: number;
  readonly status: InstallmentPlanStatus;
  readonly billingRuleSnapshot: BillingRuleSnapshot;
  readonly installments: readonly Installment[];
}

export type InstallmentSchedule = InstallmentPlan;
export type InstallmentPlanAggregate = InstallmentPlan;

/** Inputs accepted by the pure schedule builder. */
export interface GenerateInstallmentScheduleInput {
  readonly planId?: string;
  readonly installmentPlanId?: string;
  readonly installment_plan_id?: string;
  readonly purchaseId?: string;
  readonly purchase_id?: string;
  readonly amountCents?: InstallmentAmount;
  readonly totalAmountCents?: InstallmentAmount;
  readonly purchaseAmountCents?: InstallmentAmount;
  readonly installmentCount?: number;
  readonly count?: number;
  readonly numberOfInstallments?: number;
  readonly occurredOn?: BillingDateInput;
  readonly purchaseDate?: BillingDateInput;
  readonly date?: BillingDateInput;
  readonly rule?: BillingRule;
  readonly billingRule?: BillingRule;
  /** Optional versioned set; T03 selects the sole rule valid on occurredOn. */
  readonly rules?: readonly BillingRule[];
  readonly closingDay?: number;
  readonly dueDay?: number;
  readonly closing_day?: number;
  readonly due_day?: number;
  readonly billingRuleId?: string | null;
  readonly effectiveFrom?: BillingDateInput | null;
  readonly effectiveUntil?: BillingDateInput | null;
  readonly effective_from?: BillingDateInput | null;
  readonly effective_until?: BillingDateInput | null;
  readonly billingDueOnOverride?: BillingDateInput | null;
  readonly billing_due_on_override?: BillingDateInput | null;
  readonly override?: BillingDateInput | null;
}

export interface InstallmentLike {
  readonly amountCents: InstallmentAmount;
  readonly status?: InstallmentStatus | string;
  readonly planId?: string;
  readonly installmentPlanId?: string;
  readonly purchaseId?: string;
  readonly sequence?: number;
  readonly billingRuleId?: string | null;
  readonly billingCycle?: string;
  readonly cycle?: string;
  readonly competence?: string;
  readonly billingClosingDay?: number;
  readonly billingDueDay?: number;
  readonly billingClosingOn?: string;
  readonly billingDueOn?: string;
  readonly billingDueOnOverride?: string | null;
  readonly billingSnapshot?: BillingCycleSnapshot;
}

function fail(
  code: InstallmentErrorCode,
  message: string,
  field?: string,
): never {
  throw new InstallmentDomainError(code, message, field);
}

function isInstallmentStatus(value: unknown): value is InstallmentStatus {
  return (
    typeof value === "string" &&
    (INSTALLMENT_STATUSES as readonly string[]).includes(value)
  );
}

function assertIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fail("INVALID_INSTALLMENT_PLAN", "Identificador do agregado inválido.", field);
  }
  return value.trim();
}

function sameInstallmentAliasValue(
  left: unknown,
  right: unknown,
  field: string,
): boolean {
  if (left === right) {
    return true;
  }
  if (left instanceof Money && right instanceof Money) {
    return left.cents === right.cents;
  }
  if (field === "amountCents") {
    try {
      return readAmount(left) === readAmount(right);
    } catch {
      return false;
    }
  }
  if (field === "occurredOn" || field === "billingDueOnOverride") {
    try {
      return (
        serializeBillingDate(parseBillingDate(left as BillingDateInput)) ===
        serializeBillingDate(parseBillingDate(right as BillingDateInput))
      );
    } catch {
      return false;
    }
  }
  return false;
}

function resolveAlias<T>(
  values: readonly (T | undefined)[],
  field: string,
): T | undefined {
  const present = values.filter((value): value is T => value !== undefined);
  if (present.length > 1) {
    const first = present[0];
    if (present.some((value) => !sameInstallmentAliasValue(first, value, field))) {
      return fail("INVALID_INSTALLMENT_PLAN", "Aliases do agregado divergentes.", field);
    }
  }
  return present[0];
}

/**
 * Reads a positive monetary value without accepting a JavaScript number.  The
 * existing S03 Money value object remains the parser for all input forms.
 */
function readAmount(value: unknown, field = "amountCents"): bigint {
  if (
    typeof value !== "bigint" &&
    typeof value !== "string" &&
    !(value instanceof Money)
  ) {
    return fail("INVALID_AMOUNT", "O valor deve ser inteiro positivo em centavos.", field);
  }

  let cents: bigint;
  try {
    cents = (value instanceof Money ? value : Money.fromCents(value)).cents;
  } catch {
    return fail("INVALID_AMOUNT", "O valor deve ser inteiro positivo em centavos.", field);
  }

  if (cents <= BigInt(0)) {
    return fail("INVALID_AMOUNT", "O valor deve ser inteiro positivo em centavos.", field);
  }
  if (cents > MAX_INSTALLMENT_AMOUNT_CENTS) {
    return fail("AMOUNT_OUT_OF_RANGE", "O valor excede o limite de BIGINT.", field);
  }
  return cents;
}

function readInstallmentCount(value: unknown, field = "installmentCount"): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Number.isFinite(value) ||
    value < MIN_INSTALLMENT_COUNT
  ) {
    return fail(
      "INVALID_INSTALLMENT_COUNT",
      "A quantidade de parcelas deve ser um inteiro positivo.",
      field,
    );
  }
  if (value > MAX_INSTALLMENT_COUNT) {
    return fail(
      "INSTALLMENT_COUNT_OUT_OF_RANGE",
      `A quantidade de parcelas não pode exceder ${MAX_INSTALLMENT_COUNT}.`,
      field,
    );
  }
  return value;
}

/**
 * Divides an exact positive amount and gives one remainder cent to each of
 * the first rows.  No floating-point or Number conversion touches money.
 */
export function allocateInstallments(
  amountCents: InstallmentAmount,
  installmentCount: number,
): readonly bigint[] {
  const amount = readAmount(amountCents);
  const count = readInstallmentCount(installmentCount);
  const divisor = BigInt(count);
  const base = amount / divisor;
  const remainder = amount % divisor;
  const amounts = Array.from({ length: count }, (_, index) =>
    base + (BigInt(index) < remainder ? BigInt(1) : BigInt(0)),
  );

  // Positive total and count guarantee every row is positive; retain a
  // defensive assertion because this function is the aggregate's money gate.
  if (amounts.some((value) => value <= BigInt(0))) {
    return fail("SCHEDULE_INVARIANT_VIOLATION", "A alocação gerou parcela não positiva.");
  }
  if (amounts.reduce((sum, value) => sum + value, BigInt(0)) !== amount) {
    return fail("SCHEDULE_INVARIANT_VIOLATION", "A soma das parcelas diverge da compra.");
  }

  return Object.freeze(amounts);
}

export const allocateInstallmentAmounts = allocateInstallments;
export const divideInstallments = allocateInstallments;
export const splitInstallments = allocateInstallments;

/** Money-object variant for callers that want value-object arithmetic. */
export function allocateInstallmentMoney(
  amountCents: InstallmentAmount,
  installmentCount: number,
): readonly Money[] {
  return Object.freeze(
    allocateInstallments(amountCents, installmentCount).map(
      (value) => new Money(value),
    ),
  );
}

function readDateBoundary(value: BillingDateInput | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return serializeBillingDate(parseBillingDate(value));
}

function readRule(input: GenerateInstallmentScheduleInput): BillingRule {
  if (input.billingRule) {
    return input.billingRule;
  }
  if (input.rule) {
    return input.rule;
  }
  if (input.rules) {
    return resolveBillingRule(input.rules, readOccurredOn(input));
  }

  // Supporting the direct shape keeps the pure helper convenient in tests and
  // adapters while still sending all date semantics through T03.
  return {
    id: input.billingRuleId,
    closingDay: input.closingDay,
    dueDay: input.dueDay,
    closing_day: input.closing_day,
    due_day: input.due_day,
    effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil,
    effective_from: input.effective_from,
    effective_until: input.effective_until,
  };
}

function readOccurredOn(input: GenerateInstallmentScheduleInput): BillingDateInput {
  const occurredOn = resolveAlias(
    [input.occurredOn, input.purchaseDate, input.date],
    "occurredOn",
  );
  if (occurredOn === undefined) {
    return fail("INVALID_DATE", "A data da compra é obrigatória.", "occurredOn");
  }
  return occurredOn;
}

function readOverride(
  input: GenerateInstallmentScheduleInput,
): BillingDateInput | null | undefined {
  return resolveAlias(
    [
      input.billingDueOnOverride,
      input.billing_due_on_override,
      input.override,
    ],
    "billingDueOnOverride",
  );
}

function compareIsoDates(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invariantFailure(message: string, field?: string): never {
  return fail("SCHEDULE_INVARIANT_VIOLATION", message, field);
}

function parseSnapshotDate(value: unknown, field: string): string {
  try {
    return serializeBillingDate(parseBillingDate(value as BillingDateInput));
  } catch {
    return invariantFailure("Data civil inválida no snapshot de billing.", field);
  }
}

function parseSnapshotMonth(value: unknown, field: string): string {
  try {
    return serializeBillingMonth(parseBillingMonth(value as string));
  } catch {
    return invariantFailure("Competência inválida no snapshot de billing.", field);
  }
}

function assertConfiguredBillingDay(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 31
  ) {
    return invariantFailure("Dia configurado inválido no snapshot de billing.", field);
  }
  return value;
}

function cycleDates(
  billingCycle: string,
  closingDay: number,
  dueDay: number,
): { closingOn: string; dueOn: string } {
  const month = parseBillingMonth(billingCycle);
  const closingOn = serializeBillingDate(normalizeBillingDay(month, closingDay));
  let dueMonth = month;
  let dueOn = serializeBillingDate(normalizeBillingDay(dueMonth, dueDay));

  while (compareIsoDates(dueOn, closingOn) <= 0) {
    dueMonth = dueMonth.add({ months: 1 });
    dueOn = serializeBillingDate(normalizeBillingDay(dueMonth, dueDay));
  }

  return { closingOn, dueOn };
}

/**
 * Advances a resolved T03 cycle by one calendar month without consulting the
 * currently active rule.  This is important: a materialized schedule keeps
 * its original billing snapshot even when a future rule is added.
 */
function advanceBillingCycle(
  initial: BillingCycleSnapshot,
  monthOffset: number,
): BillingCycleSnapshot {
  const month = parseBillingMonth(initial.billingCycle).add({
    months: monthOffset,
  });
  const billingCycle = serializeBillingMonth(month);
  const { closingOn, dueOn } = cycleDates(
    billingCycle,
    initial.closingDay,
    initial.dueDay,
  );

  return Object.freeze({
    billingRuleId: initial.billingRuleId,
    billingCycle,
    cycle: billingCycle,
    competence: billingCycle,
    closingOn,
    dueOn,
    closingDay: initial.closingDay,
    dueDay: initial.dueDay,
    billingDueOnOverride: null,
    dueDateSource: "RULE",
  });
}

function createRuleSnapshot(
  rule: BillingRule,
  initial: BillingCycleSnapshot,
): BillingRuleSnapshot {
  const effectiveFrom =
    rule.effectiveFrom ?? rule.effective_from ?? null;
  const effectiveUntil =
    rule.effectiveUntil ?? rule.effective_until ?? null;
  return Object.freeze({
    id: initial.billingRuleId,
    closingDay: initial.closingDay,
    dueDay: initial.dueDay,
    effectiveFrom: readDateBoundary(effectiveFrom),
    effectiveUntil: readDateBoundary(effectiveUntil),
  });
}

function materializeInstallment(
  planId: string,
  purchaseId: string,
  sequence: number,
  amountCents: bigint,
  billingSnapshot: BillingCycleSnapshot,
): Installment {
  const snapshot = Object.freeze({ ...billingSnapshot });
  return Object.freeze({
    planId,
    installmentPlanId: planId,
    purchaseId,
    sequence,
    amountCents,
    status: "PLANNED" as const,
    billingRuleId: snapshot.billingRuleId,
    billingCycle: snapshot.billingCycle,
    cycle: snapshot.cycle,
    competence: snapshot.competence,
    billingClosingDay: snapshot.closingDay,
    billingDueDay: snapshot.dueDay,
    billingClosingOn: snapshot.closingOn,
    billingDueOn: snapshot.dueOn,
    billingDueOnOverride: snapshot.billingDueOnOverride,
    billingSnapshot: snapshot,
  });
}

/**
 * Builds one immutable aggregate for both 1x and N>1 purchases.  A supplied
 * due-date override applies only to the first authorized installment; all
 * subsequent rows retain the frozen rule-derived due date.
 */
export function generateInstallmentSchedule(
  input: GenerateInstallmentScheduleInput,
): InstallmentSchedule {
  const planId = assertIdentifier(
    resolveAlias(
      [input.planId, input.installmentPlanId, input.installment_plan_id],
      "planId",
    ),
    "planId",
  );
  const purchaseId = assertIdentifier(
    resolveAlias([input.purchaseId, input.purchase_id], "purchaseId"),
    "purchaseId",
  );
  const amountCents = readAmount(
    resolveAlias(
      [input.amountCents, input.totalAmountCents, input.purchaseAmountCents],
      "amountCents",
    ),
  );
  const installmentCount = readInstallmentCount(
    resolveAlias(
      [input.installmentCount, input.count, input.numberOfInstallments],
      "installmentCount",
    ),
  );
  const occurredOn = readOccurredOn(input);
  const billingRule = readRule(input);
  const billingDueOnOverride = readOverride(input);

  // Initial resolution is delegated to T03.  It validates the civil date,
  // effective rule interval, closing boundary and authorized override.
  const initialCycle = resolveBillingCycle({
    occurredOn,
    rule: billingRule,
    billingDueOnOverride,
  });
  const amounts = allocateInstallments(amountCents, installmentCount);
  const installments = amounts.map((rowAmount, index) => {
    const sequence = index + 1;
    const cycle =
      sequence === 1
        ? initialCycle
        : advanceBillingCycle(initialCycle, index);
    return materializeInstallment(
      planId,
      purchaseId,
      sequence,
      rowAmount,
      cycle,
    );
  });

  const plan: InstallmentPlan = Object.freeze({
    id: planId,
    planId,
    purchaseId,
    totalAmountCents: amountCents,
    installmentCount,
    status: "ACTIVE",
    billingRuleSnapshot: createRuleSnapshot(billingRule, initialCycle),
    installments: Object.freeze(installments),
  });
  assertInstallmentAggregateInvariants(plan);
  return plan;
}

export const createInstallmentSchedule = generateInstallmentSchedule;
export const createInstallmentPlan = generateInstallmentSchedule;
export const buildInstallmentPlan = generateInstallmentSchedule;
export const generateInstallments = generateInstallmentSchedule;

function planItems(
  planOrItems: InstallmentPlan | readonly InstallmentLike[],
): readonly InstallmentLike[] {
  if (Array.isArray(planOrItems)) {
    return planOrItems;
  }
  const plan = planOrItems as InstallmentPlan;
  if (
    plan &&
    typeof plan === "object" &&
    Array.isArray(plan.installments)
  ) {
    return plan.installments;
  }
  return fail("INVALID_INSTALLMENT_PLAN", "Agregado de parcelas inválido.");
}

/** Exact sum helper; cancelled rows remain part of historical schedule sum. */
export function sumInstallmentAmounts(
  planOrItems: InstallmentPlan | readonly InstallmentLike[],
): bigint {
  return planItems(planOrItems).reduce(
    (sum, installment) => sum + readAmount(installment.amountCents),
    BigInt(0),
  );
}

export const sumInstallments = (
  planOrItems: InstallmentPlan | readonly InstallmentLike[],
): bigint => sumInstallmentAmounts(planOrItems);

export const sumSchedule = sumInstallments;
export const totalInstallmentAmount = sumInstallments;

/** Active rows include posted and planned obligations, excluding cancellation. */
export function activeInstallments(
  planOrItems: InstallmentPlan | readonly InstallmentLike[],
): readonly InstallmentLike[] {
  const rows = planItems(planOrItems).filter(
    (installment) => installment.status !== "CANCELLED",
  );
  return Object.freeze(rows);
}

export const getActiveInstallments = activeInstallments;

/** Future/remaining rows are planned only; posted rows are no longer future. */
export function remainingInstallments(
  planOrItems: InstallmentPlan | readonly InstallmentLike[],
): readonly InstallmentLike[] {
  const rows = planItems(planOrItems).filter(
    (installment) => installment.status === "PLANNED",
  );
  return Object.freeze(rows);
}

export const remainingFutureInstallments = remainingInstallments;
export const getRemainingInstallments = remainingInstallments;
export const getFutureInstallments = remainingInstallments;

export function activeInstallmentBalance(
  planOrItems: InstallmentPlan | readonly InstallmentLike[],
): bigint {
  return sumInstallmentAmounts(activeInstallments(planOrItems));
}

export function remainingInstallmentBalance(
  planOrItems: InstallmentPlan | readonly InstallmentLike[],
): bigint {
  return sumInstallmentAmounts(remainingInstallments(planOrItems));
}

export const futureInstallmentBalance = remainingInstallmentBalance;
export const getFutureInstallmentBalance = remainingInstallmentBalance;
export const getRemainingInstallmentBalance = remainingInstallmentBalance;

function assertSnapshotInvariants(installment: InstallmentLike): void {
  if (!isInstallmentStatus(installment.status ?? "PLANNED")) {
    return fail("INVALID_STATE", "Estado de parcela inválido.", "status");
  }
  if (installment.sequence !== undefined &&
      (!Number.isInteger(installment.sequence) || installment.sequence < 1)) {
    return fail("SCHEDULE_INVARIANT_VIOLATION", "Sequência de parcela inválida.", "sequence");
  }
  const amount = readAmount(installment.amountCents);
  if (amount <= BigInt(0)) {
    return fail("SCHEDULE_INVARIANT_VIOLATION", "Parcela não positiva.", "amountCents");
  }
  if (installment.billingSnapshot) {
    const snapshot = installment.billingSnapshot;
    const billingCycle = parseSnapshotMonth(
      snapshot.billingCycle,
      "billingCycle",
    );
    if (
      snapshot.cycle !== billingCycle ||
      snapshot.competence !== billingCycle
    ) {
      return invariantFailure(
        "Aliases de competência divergentes no snapshot.",
        "billingCycle",
      );
    }
    const closingDay = assertConfiguredBillingDay(
      snapshot.closingDay,
      "closingDay",
    );
    const dueDay = assertConfiguredBillingDay(snapshot.dueDay, "dueDay");
    const closingOn = parseSnapshotDate(snapshot.closingOn, "closingOn");
    const dueOn = parseSnapshotDate(snapshot.dueOn, "dueOn");
    const expectedDates = cycleDates(billingCycle, closingDay, dueDay);
    if (closingOn !== expectedDates.closingOn) {
      return invariantFailure(
        "Fechamento não corresponde à competência ou ao dia configurado.",
        "closingOn",
      );
    }
    if (snapshot.dueDateSource !== "RULE" && snapshot.dueDateSource !== "OVERRIDE") {
      return invariantFailure(
        "Origem do vencimento inválida no snapshot.",
        "dueDateSource",
      );
    }
    const override = snapshot.billingDueOnOverride;
    if (override !== null) {
      const overrideDate = parseSnapshotDate(override, "billingDueOnOverride");
      if (
        compareIsoDates(overrideDate, closingOn) <= 0 ||
        overrideDate !== dueOn ||
        snapshot.dueDateSource !== "OVERRIDE"
      ) {
        return invariantFailure(
          "Override de vencimento divergente ou anterior ao fechamento.",
          "billingDueOnOverride",
        );
      }
    } else if (
      snapshot.dueDateSource !== "RULE" ||
      dueOn !== expectedDates.dueOn
    ) {
      return invariantFailure(
        "Vencimento não corresponde à regra congelada.",
        "dueOn",
      );
    }
    if (compareIsoDates(dueOn, closingOn) <= 0) {
      return invariantFailure(
        "Vencimento deve ser posterior ao fechamento.",
        "billingDueOn",
      );
    }
    if (
      (snapshot.billingRuleId !== null &&
        typeof snapshot.billingRuleId !== "string") ||
      (installment.billingRuleId !== null &&
        typeof installment.billingRuleId !== "string")
    ) {
      return invariantFailure(
        "Identificador da regra inválido no snapshot.",
        "billingRuleId",
      );
    }
    if (
      snapshot.billingCycle !== installment.billingCycle ||
      snapshot.cycle !== installment.cycle ||
      snapshot.competence !== installment.competence ||
      snapshot.billingRuleId !== installment.billingRuleId ||
      snapshot.closingDay !== installment.billingClosingDay ||
      snapshot.dueDay !== installment.billingDueDay ||
      snapshot.closingOn !== installment.billingClosingOn ||
      snapshot.dueOn !== installment.billingDueOn ||
      snapshot.billingDueOnOverride !== installment.billingDueOnOverride
    ) {
      return fail(
        "SCHEDULE_INVARIANT_VIOLATION",
        "Snapshot de billing divergente da parcela.",
        "billingSnapshot",
      );
    }
  }
}

/**
 * Checks cardinality, contiguous sequence, links, statuses and exact total.
 * It throws a stable domain error instead of silently accepting a malformed
 * aggregate from an adapter or test fixture.
 */
export function assertInstallmentAggregateInvariants(
  plan: InstallmentPlan,
): true {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.installments)) {
    return fail("INVALID_INSTALLMENT_PLAN", "Agregado de parcelas inválido.");
  }
  const count = readInstallmentCount(plan.installmentCount);
  if (plan.installments.length !== count) {
    return fail(
      "SCHEDULE_INVARIANT_VIOLATION",
      "A cardinalidade do schedule diverge da quantidade declarada.",
      "installments",
    );
  }
  if (
    !isInstallmentPlanStatus(plan.status) ||
    typeof plan.id !== "string" ||
    plan.id.trim().length === 0 ||
    typeof plan.planId !== "string" ||
    plan.planId.trim().length === 0 ||
    plan.id !== plan.planId ||
    typeof plan.purchaseId !== "string" ||
    plan.purchaseId.trim().length === 0 ||
    typeof plan.totalAmountCents !== "bigint" ||
    plan.totalAmountCents <= BigInt(0) ||
    plan.totalAmountCents > MAX_INSTALLMENT_AMOUNT_CENTS ||
    !plan.billingRuleSnapshot ||
    typeof plan.billingRuleSnapshot !== "object"
  ) {
    return fail("INVALID_INSTALLMENT_PLAN", "Metadados do agregado inválidos.");
  }
  const ruleSnapshot = plan.billingRuleSnapshot;
  if (
    (ruleSnapshot.id !== null &&
      (typeof ruleSnapshot.id !== "string" || ruleSnapshot.id.trim().length === 0)) ||
    !Number.isInteger(ruleSnapshot.closingDay) ||
    ruleSnapshot.closingDay < 1 ||
    ruleSnapshot.closingDay > 31 ||
    !Number.isInteger(ruleSnapshot.dueDay) ||
    ruleSnapshot.dueDay < 1 ||
    ruleSnapshot.dueDay > 31 ||
    (ruleSnapshot.effectiveFrom !== null &&
      typeof ruleSnapshot.effectiveFrom !== "string") ||
    (ruleSnapshot.effectiveUntil !== null &&
      typeof ruleSnapshot.effectiveUntil !== "string")
  ) {
    return invariantFailure("Snapshot da regra de billing inválido.", "billingRuleSnapshot");
  }
  const effectiveFrom =
    ruleSnapshot.effectiveFrom === null
      ? null
      : parseSnapshotDate(ruleSnapshot.effectiveFrom, "effectiveFrom");
  const effectiveUntil =
    ruleSnapshot.effectiveUntil === null
      ? null
      : parseSnapshotDate(ruleSnapshot.effectiveUntil, "effectiveUntil");
  if (
    effectiveFrom !== null &&
    effectiveUntil !== null &&
    compareIsoDates(effectiveUntil, effectiveFrom) <= 0
  ) {
    return invariantFailure(
      "Intervalo de vigência inválido no snapshot da regra.",
      "billingRuleSnapshot",
    );
  }
  const seen = new Set<number>();
  for (const installment of plan.installments) {
    if (!installment.billingSnapshot) {
      return fail(
        "SCHEDULE_INVARIANT_VIOLATION",
        "Cada parcela deve preservar o snapshot de billing.",
        "billingSnapshot",
      );
    }
    assertSnapshotInvariants(installment);
    if (
      installment.planId !== plan.planId ||
      installment.installmentPlanId !== plan.planId ||
      installment.purchaseId !== plan.purchaseId ||
      installment.billingRuleId !== ruleSnapshot.id ||
      installment.billingClosingDay !== ruleSnapshot.closingDay ||
      installment.billingDueDay !== ruleSnapshot.dueDay ||
      installment.sequence === undefined ||
      installment.sequence > count ||
      seen.has(installment.sequence)
    ) {
      return fail(
        "SCHEDULE_INVARIANT_VIOLATION",
        "Parcela sem vínculo/ordem válida no agregado.",
        "installments",
      );
    }
    seen.add(installment.sequence);
  }
  for (let sequence = 1; sequence <= count; sequence += 1) {
    if (!seen.has(sequence)) {
      return fail(
        "SCHEDULE_INVARIANT_VIOLATION",
        "A sequência do schedule possui lacuna.",
        "sequence",
      );
    }
  }
  if (sumInstallmentAmounts(plan.installments) !== plan.totalAmountCents) {
    return fail(
      "SCHEDULE_INVARIANT_VIOLATION",
      "A soma do schedule diverge do valor econômico da compra.",
      "totalAmountCents",
    );
  }
  const cancelledRows = plan.installments.every(
    (installment) => installment.status === "CANCELLED",
  );
  if (
    (plan.status === "ACTIVE" &&
      plan.installments.some((installment) => installment.status === "CANCELLED")) ||
    (plan.status === "CANCELLED" && !cancelledRows)
  ) {
    return invariantFailure(
      "Estado do agregado não corresponde ao estado de suas parcelas.",
      "status",
    );
  }
  return true;
}

export const assertInstallmentPlanInvariants =
  assertInstallmentAggregateInvariants;

export function isInstallmentPlanValid(plan: InstallmentPlan): boolean {
  try {
    assertInstallmentAggregateInvariants(plan);
    return true;
  } catch {
    return false;
  }
}

function isInstallmentPlanStatus(value: unknown): value is InstallmentPlanStatus {
  return (
    typeof value === "string" &&
    (INSTALLMENT_PLAN_STATUSES as readonly string[]).includes(value)
  );
}

/** State transition allowed for publication; cancellation belongs to plan API. */
export function transitionInstallmentStatus(
  installment: Installment,
  nextStatus: InstallmentStatus | string,
): Installment {
  assertSnapshotInvariants(installment);
  if (!isInstallmentStatus(nextStatus)) {
    return fail("INVALID_STATE", "Estado de parcela inválido.", "status");
  }
  if (nextStatus === "CANCELLED") {
    return fail(
      "INSTALLMENT_MUTATION_FORBIDDEN",
      "O cancelamento deve ocorrer no agregado da compra.",
      "status",
    );
  }
  if (nextStatus === "PLANNED") {
    if (installment.status === "PLANNED") {
      return installment;
    }
    return fail("INVALID_STATE", "Uma parcela publicada não retorna a PLANNED.", "status");
  }
  if (installment.status === "CANCELLED") {
    return fail("INVALID_STATE", "Uma parcela cancelada não pode ser publicada.", "status");
  }
  if (installment.status === "POSTED") {
    return installment;
  }
  return Object.freeze({ ...installment, status: "POSTED" as const });
}

export const transitionInstallment = transitionInstallmentStatus;
export const postInstallmentStatus = transitionInstallmentStatus;

/** Publishes one row only through the aggregate, never as a payment command. */
export function postInstallment(
  plan: InstallmentPlan,
  target: number | string,
): InstallmentPlan {
  assertInstallmentAggregateInvariants(plan);
  const index = plan.installments.findIndex(
    (installment) =>
      (typeof target === "number" && installment.sequence === target) ||
      (typeof target === "string" &&
        (installment.planId === target || installment.purchaseId === target)),
  );
  if (index < 0) {
    return fail("INVALID_INSTALLMENT", "Parcela não encontrada no agregado.");
  }
  const current = plan.installments[index] as Installment;
  const posted = transitionInstallmentStatus(current, "POSTED");
  if (posted === current) {
    return plan;
  }
  const installments = [...plan.installments];
  installments[index] = posted;
  const next = Object.freeze({
    ...plan,
    installments: Object.freeze(installments),
  });
  assertInstallmentAggregateInvariants(next);
  return next;
}

/** Cancels all future rows while preserving posted historical rows. */
export function cancelInstallmentPlan(plan: InstallmentPlan): InstallmentPlan {
  assertInstallmentAggregateInvariants(plan);
  if (plan.status === "CANCELLED") {
    return plan;
  }
  const installments = plan.installments.map((installment) =>
    installment.status !== "CANCELLED"
      ? Object.freeze({ ...installment, status: "CANCELLED" as const })
      : installment,
  );
  const next = Object.freeze({
    ...plan,
    status: "CANCELLED" as const,
    installments: Object.freeze(installments),
  });
  assertInstallmentAggregateInvariants(next);
  return next;
}

export const cancelInstallmentAggregate = cancelInstallmentPlan;
export const cancelPurchaseInstallmentPlan = cancelInstallmentPlan;

/** Explicit guards prevent callers from inventing individual payment/edit APIs. */
export function payInstallment(installment: Installment): never {
  void installment;
  return fail(
    "PAYMENT_INSTALLMENT_FORBIDDEN",
    "Pagamento ocorre no nível global do cartão, não da parcela.",
    "installmentId",
  );
}

export const markInstallmentPaid = payInstallment;
export const settleInstallment = payInstallment;

export function editInstallment(
  installment: Installment,
  changes?: unknown,
): never {
  void installment;
  void changes;
  return fail(
    "INSTALLMENT_MUTATION_FORBIDDEN",
    "Parcela não pode ser editada isoladamente; altere a compra agregada.",
    "installmentId",
  );
}

export const updateInstallment = editInstallment;

export function cancelInstallment(installment: Installment): never {
  void installment;
  return fail(
    "INSTALLMENT_MUTATION_FORBIDDEN",
    "Parcela não pode ser cancelada isoladamente; cancele a compra agregada.",
    "installmentId",
  );
}

export function serializeInstallment(installment: Installment): Record<string, unknown> {
  assertSnapshotInvariants(installment);
  return Object.freeze({
    planId: installment.planId,
    installmentPlanId: installment.installmentPlanId,
    purchaseId: installment.purchaseId,
    sequence: installment.sequence,
    amountCents: installment.amountCents.toString(10),
    status: installment.status,
    billingRuleId: installment.billingRuleId,
    billingCycle: installment.billingCycle,
    cycle: installment.cycle,
    competence: installment.competence,
    billingClosingDay: installment.billingClosingDay,
    billingDueDay: installment.billingDueDay,
    billingClosingOn: installment.billingClosingOn,
    billingDueOn: installment.billingDueOn,
    billingDueOnOverride: installment.billingDueOnOverride,
    billingSnapshot: Object.freeze({ ...installment.billingSnapshot }),
  });
}

export function serializeInstallmentPlan(
  plan: InstallmentPlan,
): Record<string, unknown> {
  assertInstallmentAggregateInvariants(plan);
  return Object.freeze({
    id: plan.id,
    planId: plan.planId,
    purchaseId: plan.purchaseId,
    totalAmountCents: plan.totalAmountCents.toString(10),
    installmentCount: plan.installmentCount,
    status: plan.status,
    billingRuleSnapshot: Object.freeze({ ...plan.billingRuleSnapshot }),
    installments: Object.freeze(plan.installments.map(serializeInstallment)),
  });
}

export const toSerializableInstallment = serializeInstallment;
export const toSerializableInstallmentPlan = serializeInstallmentPlan;
export const serializeInstallmentSchedule = serializeInstallmentPlan;
export const toSerializableSchedule = serializeInstallmentPlan;
