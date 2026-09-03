import { Temporal } from "@js-temporal/polyfill";

import {
  Money,
  type Money as MoneyValue,
} from "@/modules/transactions/money";

import {
  BUDGET_ERROR_CODES,
  BUDGET_MOVEMENT_KINDS,
  BUDGET_STATUSES,
  MAX_PERSISTABLE_CENTS,
  MIN_PERSISTABLE_CENTS,
  BudgetDomainError,
  type Budget,
  type BudgetCorrection,
  type BudgetCorrectionInput,
  type BudgetDateInput,
  type BudgetErrorField,
  type BudgetGoal,
  type BudgetGoalInput,
  type BudgetInput,
  type BudgetMovement,
  type BudgetMovementInput,
  type BudgetMovementKind,
  type BudgetMovementValidationOptions,
  type BudgetStatus,
  type BudgetTransfer,
  type BudgetTransferInput,
} from "./contracts";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DECIMAL_CENTS_PATTERN = /^\d+$/u;
const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const ZERO = BigInt(0);

function fail(
  code: (typeof BUDGET_ERROR_CODES)[number],
  field?: BudgetErrorField,
): never {
  throw new BudgetDomainError(code, field);
}

function isPlainDate(value: unknown): value is Temporal.PlainDate {
  return (
    value instanceof Temporal.PlainDate && value.calendarId === "iso8601"
  );
}

/** Parses only the serialized civil-date contract; timezone-bearing values are not accepted. */
export function parseBudgetDate(
  value: unknown,
  field: BudgetErrorField = "effectiveOn",
): Temporal.PlainDate {
  if (isPlainDate(value)) return value;

  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return fail("INVALID_DATE", field);
  }

  try {
    return Temporal.PlainDate.from(value, { overflow: "reject" });
  } catch {
    return fail("INVALID_DATE", field);
  }
}

export const parseFinancialBudgetDate = parseBudgetDate;
export const parseBoxDate = parseBudgetDate;

export function isValidBudgetDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  try {
    parseBudgetDate(value);
    return true;
  } catch {
    return false;
  }
}

export const isValidBoxDate = isValidBudgetDate;

export function serializeBudgetDate(value: Temporal.PlainDate): string {
  const date = parseBudgetDate(value, "effectiveOn");
  if (date.year < 0 || date.year > 9999) {
    return fail("INVALID_DATE", "effectiveOn");
  }

  return [
    date.year.toString(10).padStart(4, "0"),
    date.month.toString(10).padStart(2, "0"),
    date.day.toString(10).padStart(2, "0"),
  ].join("-");
}

export const formatBudgetDate = serializeBudgetDate;
export const serializeFinancialBudgetDate = serializeBudgetDate;

export function compareBudgetDates(
  left: Temporal.PlainDate,
  right: Temporal.PlainDate,
): -1 | 0 | 1 {
  const result = Temporal.PlainDate.compare(
    parseBudgetDate(left, "effectiveOn"),
    parseBudgetDate(right, "effectiveOn"),
  );
  return result < 0 ? -1 : result > 0 ? 1 : 0;
}

export const compareBoxDates = compareBudgetDates;

/** NFKC + edge trim + internal whitespace collapse, without silently removing controls. */
export function normalizeBudgetName(value: unknown): string {
  if (typeof value !== "string") return fail("INVALID_NAME", "name");
  const normalized = value.normalize("NFKC");
  if (CONTROL_OR_FORMAT_CHARACTER.test(normalized)) {
    return fail("INVALID_NAME", "name");
  }

  const collapsed = normalized.trim().replace(/\s+/gu, " ");
  const codePointLength = Array.from(collapsed).length;
  if (codePointLength < 1 || codePointLength > 120) {
    return fail("INVALID_NAME", "name");
  }
  return collapsed;
}

export const normalizeBoxName = normalizeBudgetName;
export const normalizeName = normalizeBudgetName;

export function normalizeBudgetCommandId(value: unknown): string {
  if (typeof value !== "string") return fail("INVALID_COMMAND_ID", "commandId");
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 128 ||
    CONTROL_OR_FORMAT_CHARACTER.test(normalized)
  ) {
    return fail("INVALID_COMMAND_ID", "commandId");
  }
  return normalized;
}

export const normalizeCommandId = normalizeBudgetCommandId;

/** Opaque references are validated, never normalized: their exact identity is significant. */
export function assertOpaqueReference(
  value: unknown,
  field: BudgetErrorField = "referenceId",
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    CONTROL_OR_FORMAT_CHARACTER.test(value)
  ) {
    return fail("INVALID_REFERENCE", field);
  }
  return value;
}

export const validateOpaqueReference = assertOpaqueReference;
export const budgetReference = assertOpaqueReference;

function amountCandidate(value: unknown, field: BudgetErrorField): bigint {
  if (value instanceof Money) return value.cents;
  if (typeof value === "bigint") return value;
  if (typeof value === "string") {
    if (!DECIMAL_CENTS_PATTERN.test(value)) return fail("INVALID_AMOUNT", field);
    try {
      return BigInt(value);
    } catch {
      return fail("INVALID_AMOUNT", field);
    }
  }
  if (value !== null && typeof value === "object") {
    const cents = (value as { readonly cents?: unknown }).cents;
    if (typeof cents === "bigint") return cents;

    const serializer = (value as { readonly toCentsString?: unknown }).toCentsString;
    if (typeof serializer === "function") {
      try {
        const serialized = serializer.call(value);
        if (typeof serialized === "string" && DECIMAL_CENTS_PATTERN.test(serialized)) {
          return BigInt(serialized);
        }
      } catch {
        // Map all malformed amount implementations to the stable domain error.
      }
    }
  }
  return fail("INVALID_AMOUNT", field);
}

function assertPersistableSigned(cents: bigint): bigint {
  if (cents < MIN_PERSISTABLE_CENTS || cents > MAX_PERSISTABLE_CENTS) {
    return fail("AMOUNT_OUT_OF_RANGE", "amountCents");
  }
  return cents;
}

/** Converts a positive domain amount without accepting native numeric input. */
export function parseBudgetAmount(
  value: unknown,
  field: BudgetErrorField = "amountCents",
): MoneyValue {
  const cents = amountCandidate(value, field);
  if (cents <= ZERO) return fail("INVALID_AMOUNT", field);
  if (cents > MAX_PERSISTABLE_CENTS) return fail("AMOUNT_OUT_OF_RANGE", field);
  return new Money(cents);
}

export const parsePositiveBudgetAmount = parseBudgetAmount;
export const parseBudgetMoney = parseBudgetAmount;

export function parseBudgetCents(
  value: unknown,
  field: BudgetErrorField = "amountCents",
): bigint {
  return parseBudgetAmount(value, field).cents;
}

export const parsePositiveBudgetCents = parseBudgetCents;
export const parsePositiveCents = parseBudgetCents;

function resolveReferenceAliases(
  values: readonly (unknown | undefined)[],
  field: BudgetErrorField,
  required = true,
): string | undefined {
  const supplied = values.filter((value): value is unknown => value !== undefined && value !== null);
  if (supplied.length === 0) {
    if (required) return fail("INVALID_REFERENCE", field);
    return undefined;
  }
  const normalized = supplied.map((value) => assertOpaqueReference(value, field));
  const first = normalized[0];
  if (normalized.some((value) => value !== first)) {
    return fail("INVALID_REFERENCE", field);
  }
  return first;
}

function resolveDateAliases(
  values: readonly (unknown | undefined)[],
  field: BudgetErrorField,
): Temporal.PlainDate {
  const supplied = values.filter((value): value is unknown => value !== undefined && value !== null);
  if (supplied.length === 0) return fail("INVALID_DATE", field);
  const normalized = supplied.map((value) => parseBudgetDate(value, field));
  const first = normalized[0];
  if (normalized.some((value) => compareBudgetDates(value, first) !== 0)) {
    return fail("INVALID_DATE", field);
  }
  return first;
}

function resolveAmountAliases(
  values: readonly (unknown | undefined)[],
  field: BudgetErrorField,
): MoneyValue {
  const supplied = values.filter((value): value is unknown => value !== undefined && value !== null);
  if (supplied.length === 0) return fail("INVALID_AMOUNT", field);
  const normalized = supplied.map((value) => parseBudgetAmount(value, field));
  const first = normalized[0];
  if (normalized.some((value) => !value.equals(first))) {
    return fail("INVALID_AMOUNT", field);
  }
  return first;
}

function resolveNullableReference(
  value: unknown,
  field: BudgetErrorField,
): string | null {
  if (value === undefined || value === null) return null;
  return assertOpaqueReference(value, field) as string;
}

function resolveBudgetReference(input: BudgetInput | Budget): string {
  const candidate = input as BudgetInput;
  return resolveReferenceAliases(
    [candidate.referenceId, candidate.budgetReferenceId, candidate.boxReferenceId, candidate.id],
    "referenceId",
  ) as string;
}

function goalInputForBudget(input: BudgetInput | Budget): BudgetGoalInput | BudgetGoal | null | undefined {
  const candidate = input.goal;
  const aliases = input as BudgetInput;
  const topAmount = aliases.targetAmountCents;
  const topDate = aliases.targetDate;

  if (candidate === null) {
    if (topAmount !== undefined && topAmount !== null) return fail("INVALID_GOAL", "targetAmountCents");
    if (topDate !== undefined && topDate !== null) return fail("INVALID_GOAL", "targetDate");
    return null;
  }

  if (candidate !== undefined) {
    if (topAmount !== undefined && topAmount !== null) {
      return fail("INVALID_GOAL", "targetAmountCents");
    }
    if (topDate !== undefined && topDate !== null) {
      return fail("INVALID_GOAL", "targetDate");
    }
    return candidate as BudgetGoalInput | BudgetGoal;
  }

  if (topAmount === undefined && topDate === undefined) return undefined;
  if (topAmount === null && topDate === null) return null;
  return {
    targetAmountCents: topAmount ?? undefined,
    targetDate: topDate as BudgetDateInput | undefined,
  };
}

function normalizeGoal(
  input: BudgetInput | Budget,
  activeFrom: Temporal.PlainDate,
): BudgetGoal | null {
  const candidate = goalInputForBudget(input);
  if (candidate === undefined || candidate === null) return null;

  const goal = candidate as BudgetGoalInput | BudgetGoal;
  const amount = resolveAmountAliases(
    [
      "targetAmount" in goal ? goal.targetAmount : undefined,
      "targetAmountCents" in goal ? goal.targetAmountCents : undefined,
    ],
    "targetAmountCents",
  );
  const targetDateValue = "targetDate" in goal ? goal.targetDate : undefined;
  const targetDate = parseBudgetDate(targetDateValue, "targetDate");
  if (compareBudgetDates(targetDate, activeFrom) < 0) {
    return fail("INVALID_TARGET_DATE", "targetDate");
  }

  return Object.freeze({ targetAmount: amount, targetDate });
}

function asBudgetInput(input: BudgetInput | Budget): BudgetInput | Budget {
  if (input === null || typeof input !== "object") {
    return fail("INVALID_COMMAND", "referenceId");
  }
  return input;
}

/** Normalizes a serializable aggregate input into an immutable domain Budget. */
export function normalizeBudget(input: BudgetInput | Budget): Budget {
  const source = asBudgetInput(input);
  const referenceId = resolveBudgetReference(source);
  const name = normalizeBudgetName(source.name);
  const categoryId = resolveReferenceAliases([source.categoryId], "categoryId") as string;
  const activeFrom = parseBudgetDate(source.activeFrom, "activeFrom");
  const closedOn =
    source.closedOn === undefined || source.closedOn === null
      ? null
      : parseBudgetDate(source.closedOn, "closedOn");

  if (closedOn !== null && compareBudgetDates(closedOn, activeFrom) < 0) {
    return fail("INVALID_DATE_RANGE", "closedOn");
  }

  let status: BudgetStatus;
  if (source.status === undefined) {
    status = closedOn === null ? "ACTIVE" : "CLOSED";
  } else if (!(BUDGET_STATUSES as readonly string[]).includes(source.status)) {
    return fail("INVALID_STATUS");
  } else {
    status = source.status;
  }

  if (status === "ACTIVE" && closedOn !== null) {
    return fail("INVALID_DATE_RANGE", "closedOn");
  }
  if (status === "CLOSED" && closedOn === null) {
    return fail("INVALID_DATE_RANGE", "closedOn");
  }

  const householdId =
    source.householdId === undefined || source.householdId === null
      ? source.householdId ?? undefined
      : assertOpaqueReference(source.householdId, "referenceId");

  return Object.freeze({
    referenceId,
    name,
    categoryId,
    status,
    activeFrom,
    closedOn,
    goal: normalizeGoal(source, activeFrom),
    ...(householdId !== undefined ? { householdId } : {}),
  });
}

export const createBudget = normalizeBudget;
export const validateBudget = normalizeBudget;
export const assertBudget = normalizeBudget;
export const createBox = normalizeBudget;

export function serializeBudget(input: BudgetInput | Budget) {
  const budget = normalizeBudget(input);
  return {
    referenceId: budget.referenceId,
    name: budget.name,
    categoryId: budget.categoryId,
    status: budget.status,
    activeFrom: serializeBudgetDate(budget.activeFrom),
    closedOn: budget.closedOn === null ? null : serializeBudgetDate(budget.closedOn),
    goal:
      budget.goal === null
        ? null
        : {
            targetAmountCents: budget.goal.targetAmount.toCentsString(),
            targetDate: serializeBudgetDate(budget.goal.targetDate),
          },
  };
}

export const toBudgetBoundary = serializeBudget;
export const serializeBox = serializeBudget;

export function isBudgetActiveAt(
  input: BudgetInput | Budget,
  asOf: BudgetDateInput,
): boolean {
  const budget = normalizeBudget(input);
  const date = parseBudgetDate(asOf, "asOf");
  return (
    compareBudgetDates(date, budget.activeFrom) >= 0 &&
    (budget.closedOn === null || compareBudgetDates(date, budget.closedOn) < 0)
  );
}

export const activeAt = isBudgetActiveAt;
export const isBoxActiveAt = isBudgetActiveAt;

/** A movement may be part of historical replay through the closing date, inclusive. */
export function assertMovementDateWithinBudget(
  budgetInput: BudgetInput | Budget,
  effectiveOn: BudgetDateInput,
): Temporal.PlainDate {
  const budget = normalizeBudget(budgetInput);
  const date = parseBudgetDate(effectiveOn, "effectiveOn");
  if (compareBudgetDates(date, budget.activeFrom) < 0) {
    return fail("BUDGET_NOT_ACTIVE_AT_DATE", "effectiveOn");
  }
  if (budget.closedOn !== null && compareBudgetDates(date, budget.closedOn) > 0) {
    return fail("BUDGET_CLOSED", "effectiveOn");
  }
  return date;
}

export const assertMovementWithinBudget = assertMovementDateWithinBudget;

/** Interactive writes require an actually active aggregate; historical corrections use the date-only rule above. */
export function assertBudgetCanReceiveMovement(
  budgetInput: BudgetInput | Budget,
  effectiveOn: BudgetDateInput,
): Budget {
  const budget = normalizeBudget(budgetInput);
  const date = parseBudgetDate(effectiveOn, "effectiveOn");
  if (budget.status !== "ACTIVE") return fail("BUDGET_CLOSED", "budgetReferenceId");
  if (compareBudgetDates(date, budget.activeFrom) < 0) {
    return fail("BUDGET_NOT_ACTIVE_AT_DATE", "effectiveOn");
  }
  if (budget.closedOn !== null && compareBudgetDates(date, budget.closedOn) >= 0) {
    return fail("BUDGET_CLOSED", "effectiveOn");
  }
  return budget;
}

function resolveMovementReference(input: BudgetMovementInput | BudgetMovement): string {
  const candidate = input as BudgetMovementInput;
  return resolveReferenceAliases(
    [candidate.referenceId, candidate.movementReferenceId, candidate.id],
    "referenceId",
  ) as string;
}

function resolveMovementBoxReference(
  input: BudgetMovementInput | BudgetMovement,
  budget?: Budget,
): string {
  const candidateInput = input as BudgetMovementInput;
  const explicit = resolveReferenceAliases(
    [candidateInput.boxReferenceId, candidateInput.budgetReferenceId],
    "boxReferenceId",
    false,
  );
  if (explicit !== undefined) return explicit;
  if (budget !== undefined) return budget.referenceId;
  return fail("INVALID_REFERENCE", "boxReferenceId");
}

function resolveMovementKind(value: unknown): BudgetMovementKind {
  if (
    typeof value !== "string" ||
    !(BUDGET_MOVEMENT_KINDS as readonly string[]).includes(value)
  ) {
    return fail("INVALID_MOVEMENT_KIND", "kind");
  }
  return value as BudgetMovementKind;
}

/** Normalizes one immutable movement and validates its relationship with the aggregate when supplied. */
export function normalizeBudgetMovement(
  input: BudgetMovementInput | BudgetMovement,
  budgetInput?: BudgetInput | Budget,
  options: BudgetMovementValidationOptions = {},
): BudgetMovement {
  if (input === null || typeof input !== "object") {
    return fail("INVALID_COMMAND", "referenceId");
  }
  const budget = budgetInput === undefined ? undefined : normalizeBudget(budgetInput);
  const candidateInput = input as BudgetMovementInput;
  const referenceId = resolveMovementReference(input);
  const boxReferenceId = resolveMovementBoxReference(input, budget);
  if (budget !== undefined && boxReferenceId !== budget.referenceId) {
    return fail("MOVEMENT_BUDGET_MISMATCH", "boxReferenceId");
  }

  const kind = resolveMovementKind(candidateInput.kind);
  const amount = resolveAmountAliases(
    [candidateInput.amount, candidateInput.amountCents],
    "amountCents",
  );
  const effectiveOn = resolveDateAliases(
    [candidateInput.effectiveOn, candidateInput.date],
    "effectiveOn",
  );

  if (budget !== undefined) {
    if (options.interactive === true) {
      assertBudgetCanReceiveMovement(budget, effectiveOn);
    } else {
      assertMovementDateWithinBudget(budget, effectiveOn);
    }
  }

  const correctsReferenceId = resolveNullableReference(
    candidateInput.correctsReferenceId,
    "correctsReferenceId",
  );
  const transferReferenceId = resolveNullableReference(
    candidateInput.transferReferenceId,
    "referenceId",
  );
  const sourceReferenceId = resolveNullableReference(
    candidateInput.sourceReferenceId,
    "referenceId",
  );
  if (correctsReferenceId === referenceId) {
    return fail("INVALID_REFERENCE", "correctsReferenceId");
  }

  return Object.freeze({
    referenceId,
    boxReferenceId,
    kind,
    amount,
    effectiveOn,
    correctsReferenceId,
    transferReferenceId,
    sourceReferenceId,
  });
}

export const createBudgetMovement = normalizeBudgetMovement;
export const validateBudgetMovement = normalizeBudgetMovement;
export const createBoxMovement = normalizeBudgetMovement;

export function serializeBudgetMovement(
  input: BudgetMovementInput | BudgetMovement,
) {
  const movement = normalizeBudgetMovement(input);
  return {
    referenceId: movement.referenceId,
    boxReferenceId: movement.boxReferenceId,
    kind: movement.kind,
    amountCents: movement.amount.toCentsString(),
    effectiveOn: serializeBudgetDate(movement.effectiveOn),
    ...(movement.correctsReferenceId !== null
      ? { correctsReferenceId: movement.correctsReferenceId }
      : {}),
    ...(movement.transferReferenceId !== null
      ? { transferReferenceId: movement.transferReferenceId }
      : {}),
    ...(movement.sourceReferenceId !== null
      ? { sourceReferenceId: movement.sourceReferenceId }
      : {}),
  };
}

export const toBudgetMovementBoundary = serializeBudgetMovement;
export const serializeBoxMovement = serializeBudgetMovement;

export function createContributionMovement(
  input: Omit<BudgetMovementInput, "kind">,
  budgetInput?: BudgetInput | Budget,
  options?: BudgetMovementValidationOptions,
): BudgetMovement {
  return normalizeBudgetMovement(
    { ...input, kind: "CONTRIBUTION" },
    budgetInput,
    options,
  );
}

export const createContribution = createContributionMovement;
export const createBudgetContribution = createContributionMovement;

export function createWithdrawalMovement(
  input: Omit<BudgetMovementInput, "kind">,
  budgetInput?: BudgetInput | Budget,
  options?: BudgetMovementValidationOptions,
): BudgetMovement {
  return normalizeBudgetMovement(
    { ...input, kind: "WITHDRAWAL" },
    budgetInput,
    options,
  );
}

export const createWithdrawal = createWithdrawalMovement;
export const createBudgetWithdrawal = createWithdrawalMovement;

/** Checks identity uniqueness and returns the canonical date/reference ordering used by S09. */
export function sortBudgetMovements(
  inputs: readonly (BudgetMovementInput | BudgetMovement)[],
  budgetInput?: BudgetInput | Budget,
  options?: BudgetMovementValidationOptions,
): readonly BudgetMovement[] {
  const budget = budgetInput === undefined ? undefined : normalizeBudget(budgetInput);
  const movements = inputs.map((input) => normalizeBudgetMovement(input, budget, options));
  const references = new Set<string>();
  for (const movement of movements) {
    if (references.has(movement.referenceId)) {
      return fail("DUPLICATE_REFERENCE", "referenceId");
    }
    references.add(movement.referenceId);
  }

  return Object.freeze(
    [...movements].sort((left, right) => {
      const dateComparison = compareBudgetDates(left.effectiveOn, right.effectiveOn);
      if (dateComparison !== 0) return dateComparison;
      if (left.referenceId < right.referenceId) return -1;
      if (left.referenceId > right.referenceId) return 1;
      if (left.kind < right.kind) return -1;
      if (left.kind > right.kind) return 1;
      return left.amount.compare(right.amount);
    }),
  );
}

export const canonicalizeBudgetMovements = sortBudgetMovements;
export const sortBoxMovements = sortBudgetMovements;

export function assertUniqueMovementReferences(
  inputs: readonly (BudgetMovementInput | BudgetMovement)[],
): readonly BudgetMovement[] {
  return sortBudgetMovements(inputs);
}

export const validateMovementReferences = assertUniqueMovementReferences;

function oppositeMovementKind(kind: BudgetMovementKind): BudgetMovementKind {
  return kind === "CONTRIBUTION" ? "WITHDRAWAL" : "CONTRIBUTION";
}

function resolveBudgetPair(
  input: BudgetTransferInput,
): { source: Budget; destination: Budget } {
  const sourceInput = input.sourceBudget ?? input.fromBudget;
  const destinationInput = input.destinationBudget ?? input.toBudget;
  if (!sourceInput || !destinationInput) return fail("BUDGET_NOT_FOUND");
  const source = normalizeBudget(sourceInput);
  const destination = normalizeBudget(destinationInput);
  if (source.referenceId === destination.referenceId) {
    return fail("TRANSFER_SAME_BUDGET", "destinationBudgetReferenceId");
  }

  if (
    input.sourceBudgetReferenceId !== undefined &&
    input.sourceBudgetReferenceId !== source.referenceId
  ) {
    return fail("BUDGET_NOT_FOUND", "sourceBudgetReferenceId");
  }
  if (
    input.destinationBudgetReferenceId !== undefined &&
    input.destinationBudgetReferenceId !== destination.referenceId
  ) {
    return fail("BUDGET_NOT_FOUND", "destinationBudgetReferenceId");
  }
  if (
    source.householdId !== undefined &&
    destination.householdId !== undefined &&
    source.householdId !== destination.householdId
  ) {
    return fail("BUDGET_NOT_FOUND", "destinationBudgetReferenceId");
  }
  return { source, destination };
}

/** Creates both sides of a transfer before either can be persisted. */
export function createBudgetTransfer(input: BudgetTransferInput): BudgetTransfer {
  const { source, destination } = resolveBudgetPair(input);
  const amount = resolveAmountAliases([input.amount, input.amountCents], "amountCents");
  const effectiveOn = parseBudgetDate(input.effectiveOn, "effectiveOn");
  assertBudgetCanReceiveMovement(source, effectiveOn);
  assertBudgetCanReceiveMovement(destination, effectiveOn);

  const withdrawalReferenceId = resolveReferenceAliases(
    [input.withdrawalReferenceId, input.sourceReferenceId],
    "withdrawalReferenceId",
  ) as string;
  const contributionReferenceId = resolveReferenceAliases(
    [input.contributionReferenceId, input.destinationReferenceId],
    "contributionReferenceId",
  ) as string;
  if (withdrawalReferenceId === contributionReferenceId) {
    return fail("DUPLICATE_REFERENCE", "contributionReferenceId");
  }
  const transferReferenceId =
    input.transferReferenceId === undefined || input.transferReferenceId === null
      ? null
      : assertOpaqueReference(input.transferReferenceId, "referenceId");

  const sourceMovement = createWithdrawalMovement(
    {
      referenceId: withdrawalReferenceId,
      boxReferenceId: source.referenceId,
      amount,
      effectiveOn,
      transferReferenceId,
    },
    source,
    { interactive: true },
  );
  const destinationMovement = createContributionMovement(
    {
      referenceId: contributionReferenceId,
      boxReferenceId: destination.referenceId,
      amount,
      effectiveOn,
      transferReferenceId,
    },
    destination,
    { interactive: true },
  );

  return Object.freeze({
    transferReferenceId,
    source: sourceMovement,
    destination: destinationMovement,
    movements: Object.freeze([sourceMovement, destinationMovement]) as readonly [
      BudgetMovement,
      BudgetMovement,
    ],
  });
}

export const transferBetweenBudgets = createBudgetTransfer;
export const createTransferBetweenBudgets = createBudgetTransfer;
export const createBudgetTransferPair = createBudgetTransfer;

function resolveOriginalMovement(
  input: BudgetCorrectionInput,
  budget?: Budget,
): BudgetMovement {
  const explicit = input.originalMovement ?? input.movement ?? input.original;
  if (explicit) return normalizeBudgetMovement(explicit, budget);

  const reference = input.movementReferenceId ?? input.correctsReferenceId;
  if (reference === undefined) return fail("MOVEMENT_NOT_FOUND", "correctsReferenceId");
  const existing = input.existingMovements ?? [];
  for (const candidate of existing) {
    const movement = normalizeBudgetMovement(candidate, budget);
    if (movement.referenceId === reference) return movement;
  }
  return fail("MOVEMENT_NOT_FOUND", "correctsReferenceId");
}

/** Appends a compensation (and optionally a replacement) while retaining original identity and lineage. */
export function correctBudgetMovement(input: BudgetCorrectionInput): BudgetCorrection {
  const budget = input.budget === undefined ? undefined : normalizeBudget(input.budget);
  const original = resolveOriginalMovement(input, budget);

  if (budget !== undefined && original.boxReferenceId !== budget.referenceId) {
    return fail("MOVEMENT_BUDGET_MISMATCH", "boxReferenceId");
  }
  const allExisting = (input.existingMovements ?? []).map((movement) =>
    normalizeBudgetMovement(movement, budget),
  );
  if (
    allExisting.length > 0 &&
    !allExisting.some((movement) => movement.referenceId === original.referenceId)
  ) {
    return fail("MOVEMENT_NOT_FOUND", "correctsReferenceId");
  }
  if (
    input.correctsReferenceId !== undefined &&
    input.correctsReferenceId !== original.referenceId
  ) {
    return fail("MOVEMENT_NOT_FOUND", "correctsReferenceId");
  }
  if (
    allExisting.some(
      (movement) =>
        movement.correctsReferenceId === original.referenceId,
    )
  ) {
    return fail("MOVEMENT_ALREADY_CORRECTED", "correctsReferenceId");
  }

  const correctionReferenceId = resolveReferenceAliases(
    [input.correctionReferenceId, input.compensationReferenceId],
    "correctionReferenceId",
  ) as string;
  if (correctionReferenceId === original.referenceId) {
    return fail("DUPLICATE_REFERENCE", "correctionReferenceId");
  }
  const effectiveOn =
    input.effectiveOn === undefined
      ? original.effectiveOn
      : parseBudgetDate(input.effectiveOn, "effectiveOn");
  if (budget !== undefined) assertMovementDateWithinBudget(budget, effectiveOn);

  const compensation = normalizeBudgetMovement(
    {
      referenceId: correctionReferenceId,
      boxReferenceId: original.boxReferenceId,
      kind: oppositeMovementKind(original.kind),
      amount: original.amount,
      effectiveOn,
      correctsReferenceId: original.referenceId,
      sourceReferenceId: original.sourceReferenceId,
    },
    budget,
  );

  const replacement =
    input.replacement === undefined || input.replacement === null
      ? null
      : normalizeBudgetMovement(input.replacement, budget);
  if (replacement !== null && replacement.referenceId === original.referenceId) {
    return fail("DUPLICATE_REFERENCE", "referenceId");
  }

  const appended = [
    ...allExisting,
    compensation,
    ...(replacement === null ? [] : [replacement]),
  ];
  const canonicalAppended = sortBudgetMovements(appended, budget);
  return Object.freeze({
    original,
    compensation,
    replacement,
    movements: canonicalAppended,
  });
}

export const correctMovement = correctBudgetMovement;
export const createMovementCorrection = correctBudgetMovement;
export const createCompensatingMovement = correctBudgetMovement;

export function signedMovementAmount(movementInput: BudgetMovementInput | BudgetMovement): MoneyValue {
  const movement = normalizeBudgetMovement(movementInput);
  return movement.kind === "CONTRIBUTION"
    ? movement.amount
    : movement.amount.negate();
}

export const movementSignedAmount = signedMovementAmount;

export function assertBalanceRange(cents: bigint): bigint {
  return assertPersistableSigned(cents);
}

export function addPersistableCents(left: bigint, right: bigint): bigint {
  return assertPersistableSigned(left + right);
}

export function subtractPersistableCents(left: bigint, right: bigint): bigint {
  return assertPersistableSigned(left - right);
}

/** A deterministic civil-month parser used by the monthly period helper. */
export function parseBudgetMonth(value: unknown, field: BudgetErrorField = "effectiveOn"): Temporal.PlainYearMonth {
  if (value instanceof Temporal.PlainYearMonth && value.calendarId === "iso8601") {
    return value;
  }
  if (typeof value !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value)) {
    return fail("INVALID_DATE", field);
  }
  try {
    return Temporal.PlainYearMonth.from(value, { overflow: "reject" });
  } catch {
    return fail("INVALID_DATE", field);
  }
}

export const parseFinancialBudgetMonth = parseBudgetMonth;

export function monthRange(value: string | Temporal.PlainYearMonth): {
  readonly from: Temporal.PlainDate;
  readonly to: Temporal.PlainDate;
} {
  const month = parseBudgetMonth(value, "from");
  const from = month.toPlainDate({ day: 1 });
  const to = month.add({ months: 1 }).toPlainDate({ day: 1 }).subtract({ days: 1 });
  return { from, to };
}

export const budgetMonthRange = monthRange;

export function serializeMoney(value: MoneyValue): string {
  if (!(value instanceof Money)) return fail("INVALID_AMOUNT", "amountCents");
  return value.toCentsString();
}

export const serializeBudgetMoney = serializeMoney;
