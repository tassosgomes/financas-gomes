/**
 * Pure temporal and allocation policy for S09.
 *
 * This module is deliberately persistence-independent.  Allocation rules and
 * financial sources are normalized here so T05/T07 can consume one policy
 * without creating a second ledger, forecast or balance implementation.
 *
 * `AllocationRule.amount`/`amountCents` are nominal weights, not balances.
 * `BudgetFinancialEffect` and `AllocationContribution` are virtual effects;
 * a use case may materialize a positive contribution/withdrawal later, but
 * this file never writes one.
 */
import { Temporal } from "@js-temporal/polyfill";

import {
  MAX_PERSISTABLE_CENTS,
  MIN_PERSISTABLE_CENTS,
  BudgetDomainError,
  type Budget,
  type BudgetAmountInput,
  type BudgetDateInput,
  type BudgetGoal,
  type BudgetInput,
  type BudgetMovement,
  type BudgetMovementInput,
  type BudgetPeriodSummary,
  type BudgetProgress,
} from "./contracts";
import {
  deriveBudgetBalance,
  deriveBudgetPeriodSummary,
  deriveBudgetProgress,
  deriveRollover,
} from "./balance";
import {
  assertBudgetCanReceiveMovement,
  assertMovementDateWithinBudget,
  assertOpaqueReference,
  compareBudgetDates,
  isBudgetActiveAt,
  normalizeBudget,
  parseBudgetDate,
  serializeBudgetDate,
} from "./domain";
import { Money, type Money as MoneyValue } from "@/modules/transactions/money";

const ZERO = BigInt(0);
const ONE = BigInt(1);
const ALLOCATION_REFERENCE_MAX_LENGTH = 256;

function fail(
  code:
    | "INVALID_COMMAND"
    | "INVALID_AMOUNT"
    | "AMOUNT_OUT_OF_RANGE"
    | "INVALID_DATE"
    | "INVALID_DATE_RANGE"
    | "INVALID_REFERENCE"
    | "CATEGORY_KIND_MISMATCH"
    | "CATEGORY_ACTIVE_BUDGET_CONFLICT"
    | "ALLOCATION_OVERLAP"
    | "ALLOCATION_NO_POSITIVE_WEIGHT"
    | "DUPLICATE_REFERENCE"
    | "REFUND_EXCEEDS_ORIGINAL",
  field?:
    | "referenceId"
    | "boxReferenceId"
    | "categoryId"
    | "amountCents"
    | "balanceCents"
    | "effectiveOn"
    | "from"
    | "to",
): never {
  throw new BudgetDomainError(code, field);
}

function asNonNegativeCents(
  value: unknown,
  field: "amountCents" = "amountCents",
): bigint {
  let cents: bigint | undefined;

  if (value instanceof Money) {
    cents = value.cents;
  } else if (typeof value === "bigint") {
    cents = value;
  } else if (typeof value === "string" && /^\d+$/u.test(value)) {
    try {
      cents = BigInt(value);
    } catch {
      return fail("INVALID_AMOUNT", field);
    }
  } else if (value !== null && typeof value === "object") {
    const candidate = value as {
      readonly cents?: unknown;
      readonly toCentsString?: unknown;
    };
    if (typeof candidate.cents === "bigint") {
      cents = candidate.cents;
    } else if (typeof candidate.toCentsString === "function") {
      try {
        const serialized = candidate.toCentsString();
        if (typeof serialized === "string" && /^\d+$/u.test(serialized)) {
          cents = BigInt(serialized);
        }
      } catch {
        cents = undefined;
      }
    }
  }

  if (cents === undefined || cents < ZERO) return fail("INVALID_AMOUNT", field);
  if (cents > MAX_PERSISTABLE_CENTS) {
    return fail("AMOUNT_OUT_OF_RANGE", field);
  }
  return cents;
}

function asPositiveCents(value: unknown): bigint {
  const cents = asNonNegativeCents(value);
  if (cents <= ZERO) return fail("INVALID_AMOUNT", "amountCents");
  return cents;
}

function moneyFromCents(
  cents: bigint,
  field: "amountCents" | "balanceCents" = "amountCents",
): MoneyValue {
  if (cents < MIN_PERSISTABLE_CENTS || cents > MAX_PERSISTABLE_CENTS) {
    return fail("AMOUNT_OUT_OF_RANGE", field);
  }
  return new Money(cents);
}

function positiveMoney(value: unknown): MoneyValue {
  return moneyFromCents(asPositiveCents(value));
}

function referenceAlias(
  values: readonly (unknown | undefined | null)[],
  field: "referenceId" | "boxReferenceId" | "categoryId" = "referenceId",
  required = true,
): string | undefined {
  const supplied = values.filter(
    (value): value is unknown => value !== undefined && value !== null,
  );
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

function firstReference(
  values: readonly (unknown | undefined | null)[],
  field: "referenceId" | "boxReferenceId" | "categoryId" = "referenceId",
): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return assertOpaqueReference(value, field);
    }
  }
  return undefined;
}

function sumCents(values: readonly bigint[]): bigint {
  let total = ZERO;
  for (const value of values) {
    total += value;
    if (total > MAX_PERSISTABLE_CENTS || total < MIN_PERSISTABLE_CENTS) {
      return fail("AMOUNT_OUT_OF_RANGE", "amountCents");
    }
  }
  return total;
}

function compareReferences(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareAllocationRules(left: AllocationRule, right: AllocationRule): number {
  const box = compareReferences(left.boxReferenceId, right.boxReferenceId);
  if (box !== 0) return box;
  const from = compareBudgetDates(left.effectiveFrom, right.effectiveFrom);
  if (from !== 0) return from;
  return compareReferences(left.referenceId, right.referenceId);
}

/** Input accepted from a DB reader or from a serializable T07 command. */
export interface AllocationRuleInput {
  readonly id?: string;
  readonly referenceId?: string;
  readonly ruleReferenceId?: string;
  readonly budgetReferenceId?: string;
  readonly boxReferenceId?: string;
  readonly amount?: BudgetAmountInput;
  readonly amountCents?: BudgetAmountInput;
  readonly effectiveFrom: BudgetDateInput;
  readonly effectiveUntil?: BudgetDateInput | null;
}

/** Immutable domain representation of one effective-dated nominal weight. */
export interface AllocationRule {
  readonly id: string;
  readonly referenceId: string;
  readonly ruleReferenceId: string;
  readonly budgetReferenceId: string;
  readonly boxReferenceId: string;
  readonly amount: MoneyValue;
  readonly amountCents: bigint;
  readonly effectiveFrom: Temporal.PlainDate;
  readonly effectiveUntil: Temporal.PlainDate | null;
}

function defaultRuleReference(boxReferenceId: string, effectiveFrom: Temporal.PlainDate): string {
  return `allocation-rule:${boxReferenceId}:${serializeBudgetDate(effectiveFrom)}`;
}

/** Normalizes one rule without changing its historical interval. */
export function normalizeAllocationRule(input: AllocationRuleInput | AllocationRule): AllocationRule {
  if (input === null || typeof input !== "object") {
    return fail("INVALID_COMMAND", "referenceId");
  }

  const source = input as AllocationRuleInput | AllocationRule;
  const boxReferenceId = referenceAlias(
    [source.boxReferenceId, source.budgetReferenceId],
    "boxReferenceId",
  ) as string;
  const effectiveFrom = parseBudgetDate(source.effectiveFrom, "effectiveOn");
  const effectiveUntil =
    source.effectiveUntil === undefined || source.effectiveUntil === null
      ? null
      : parseBudgetDate(source.effectiveUntil, "effectiveOn");
  if (
    effectiveUntil !== null &&
    compareBudgetDates(effectiveUntil, effectiveFrom) <= 0
  ) {
    return fail("INVALID_DATE_RANGE", "effectiveOn");
  }

  const amountCents = asNonNegativeCents(
    source.amount ?? source.amountCents,
  );
  const suppliedReference = referenceAlias(
    [source.ruleReferenceId, source.referenceId, source.id],
    "referenceId",
    false,
  );
  const referenceId =
    suppliedReference ?? defaultRuleReference(boxReferenceId, effectiveFrom);
  assertOpaqueReference(referenceId, "referenceId");

  return Object.freeze({
    id: referenceId,
    referenceId,
    ruleReferenceId: referenceId,
    budgetReferenceId: boxReferenceId,
    boxReferenceId,
    amount: moneyFromCents(amountCents),
    amountCents,
    effectiveFrom,
    effectiveUntil,
  });
}

export const createAllocationRule = normalizeAllocationRule;
export const validateAllocationRule = normalizeAllocationRule;
export const normalizeBudgetAllocationRule = normalizeAllocationRule;

/**
 * Canonicalizes rules and rejects overlapping versions for one Caixinha.
 * Adjacent intervals are valid: `[2026-01-01, 2026-07-01)` followed by
 * `[2026-07-01, null)`.
 */
export function canonicalizeAllocationRules(
  inputs: readonly (AllocationRuleInput | AllocationRule)[],
): readonly AllocationRule[] {
  const rules = inputs.map(normalizeAllocationRule).sort(compareAllocationRules);
  const references = new Set<string>();
  const previousByBox = new Map<string, AllocationRule>();

  for (const rule of rules) {
    if (references.has(rule.referenceId)) {
      return fail("DUPLICATE_REFERENCE", "referenceId");
    }
    references.add(rule.referenceId);

    const previous = previousByBox.get(rule.boxReferenceId);
    if (
      previous !== undefined &&
      (previous.effectiveUntil === null ||
        compareBudgetDates(rule.effectiveFrom, previous.effectiveUntil) < 0)
    ) {
      return fail("ALLOCATION_OVERLAP", "effectiveOn");
    }
    previousByBox.set(rule.boxReferenceId, rule);
  }

  return Object.freeze(rules);
}

export const validateAllocationRules = canonicalizeAllocationRules;
export const sortAllocationRules = canonicalizeAllocationRules;
export const canonicalizeBudgetAllocationRules = canonicalizeAllocationRules;

function ruleAppliesAt(rule: AllocationRule, date: Temporal.PlainDate): boolean {
  return (
    compareBudgetDates(rule.effectiveFrom, date) <= 0 &&
    (rule.effectiveUntil === null ||
      compareBudgetDates(date, rule.effectiveUntil) < 0)
  );
}

export interface AllocationCategoryInput {
  readonly id: string;
  readonly parentId?: string | null;
  readonly parentCategoryId?: string | null;
  readonly kind?: "EXPENSE" | "INCOME" | string;
  readonly status?: "ACTIVE" | "ARCHIVED" | string;
  /** Effective archive date lets historical events remain explainable. */
  readonly archivedOn?: BudgetDateInput | null;
}

export interface AllocationBudgetReferenceInput {
  readonly id?: string;
  readonly referenceId?: string;
  readonly budgetReferenceId?: string;
  readonly boxReferenceId?: string;
  readonly categoryId: string;
  readonly activeFrom: BudgetDateInput;
  readonly closedOn?: BudgetDateInput | null;
  readonly status?: "ACTIVE" | "CLOSED";
  readonly categoryStatus?: "ACTIVE" | "ARCHIVED" | string;
  readonly categoryArchivedOn?: BudgetDateInput | null;
  readonly category?: AllocationCategoryInput | null;
}

export type AllocationBudgetInput =
  | Budget
  | BudgetInput
  | AllocationBudgetReferenceInput
  | AllocationBudgetReference;

/** Minimal normalized association used by both allocation and expense rules. */
export interface AllocationBudgetReference {
  readonly referenceId: string;
  readonly budgetReferenceId: string;
  readonly boxReferenceId: string;
  readonly categoryId: string;
  readonly activeFrom: Temporal.PlainDate;
  readonly closedOn: Temporal.PlainDate | null;
  readonly status: "ACTIVE" | "CLOSED";
  readonly categoryStatus: "ACTIVE" | "ARCHIVED" | null;
  readonly categoryArchivedOn: Temporal.PlainDate | null;
}

function isBudgetAggregate(input: AllocationBudgetInput): input is Budget | BudgetInput {
  return (
    input !== null &&
    typeof input === "object" &&
    "name" in input &&
    typeof input.name === "string" &&
    "categoryId" in input
  );
}

function isNormalizedAllocationBudget(
  input: AllocationBudgetInput,
): input is AllocationBudgetReference {
  return (
    input !== null &&
    typeof input === "object" &&
    "referenceId" in input &&
    "boxReferenceId" in input &&
    "categoryStatus" in input &&
    input.activeFrom instanceof Temporal.PlainDate
  );
}

/** Normalizes a budget/category association without requiring persistence. */
export function normalizeAllocationBudget(
  input: AllocationBudgetInput,
): AllocationBudgetReference {
  if (isNormalizedAllocationBudget(input)) return input;
  if (isBudgetAggregate(input)) {
    const budget = normalizeBudget(input);
    return Object.freeze({
      referenceId: budget.referenceId,
      budgetReferenceId: budget.referenceId,
      boxReferenceId: budget.referenceId,
      categoryId: budget.categoryId,
      activeFrom: budget.activeFrom,
      closedOn: budget.closedOn,
      status: budget.status,
      categoryStatus: null,
      categoryArchivedOn: null,
    });
  }

  if (input === null || typeof input !== "object") {
    return fail("INVALID_COMMAND", "boxReferenceId");
  }
  const source = input as AllocationBudgetReferenceInput;
  const referenceId = referenceAlias(
    [source.boxReferenceId, source.budgetReferenceId, source.referenceId, source.id],
    "boxReferenceId",
  ) as string;
  const categoryId = referenceAlias([source.categoryId], "categoryId") as string;
  const activeFrom = parseBudgetDate(source.activeFrom, "from");
  const closedOn =
    source.closedOn === undefined || source.closedOn === null
      ? null
      : parseBudgetDate(source.closedOn, "to");
  if (closedOn !== null && compareBudgetDates(closedOn, activeFrom) < 0) {
    return fail("INVALID_DATE_RANGE", "from");
  }
  const categoryStatus =
    source.categoryStatus ?? source.category?.status ?? null;
  if (
    categoryStatus !== null &&
    categoryStatus !== "ACTIVE" &&
    categoryStatus !== "ARCHIVED"
  ) {
    return fail("INVALID_COMMAND", "categoryId");
  }
  const categoryArchivedOnValue =
    source.categoryArchivedOn ?? source.category?.archivedOn;
  const categoryArchivedOn =
    categoryArchivedOnValue === undefined || categoryArchivedOnValue === null
      ? null
      : parseBudgetDate(categoryArchivedOnValue, "effectiveOn");
  const status = source.status ?? (closedOn === null ? "ACTIVE" : "CLOSED");
  if (status === "ACTIVE" && closedOn !== null) {
    return fail("INVALID_DATE_RANGE", "to");
  }
  if (status === "CLOSED" && closedOn === null) {
    return fail("INVALID_DATE_RANGE", "to");
  }

  return Object.freeze({
    referenceId,
    budgetReferenceId: referenceId,
    boxReferenceId: referenceId,
    categoryId,
    activeFrom,
    closedOn,
    status,
    categoryStatus: categoryStatus as "ACTIVE" | "ARCHIVED" | null,
    categoryArchivedOn,
  });
}

export const normalizeBudgetCategoryAssociation = normalizeAllocationBudget;

function budgetActiveAt(
  budget: AllocationBudgetReference,
  date: Temporal.PlainDate,
): boolean {
  return (
    compareBudgetDates(date, budget.activeFrom) >= 0 &&
    (budget.closedOn === null || compareBudgetDates(date, budget.closedOn) < 0)
  );
}

function budgetCanReceiveHistoricalEffectAt(
  budget: AllocationBudgetReference,
  date: Temporal.PlainDate,
): boolean {
  return (
    compareBudgetDates(date, budget.activeFrom) >= 0 &&
    (budget.closedOn === null || compareBudgetDates(date, budget.closedOn) <= 0)
  );
}

function budgetAutomaticallyEligible(
  budget: AllocationBudgetReference,
  date: Temporal.PlainDate,
  includeArchived = false,
): boolean {
  if (!budgetActiveAt(budget, date)) return false;
  if (includeArchived || budget.categoryStatus !== "ARCHIVED") return true;
  if (budget.categoryArchivedOn !== null) {
    return compareBudgetDates(date, budget.categoryArchivedOn) < 0;
  }
  return false;
}

export interface ResolveEffectiveAllocationRulesInput {
  readonly rules: readonly (AllocationRuleInput | AllocationRule)[];
  readonly asOf: BudgetDateInput;
  readonly budgets?: readonly AllocationBudgetInput[];
  readonly includeArchivedCategories?: boolean;
}

function normalizeBudgetMap(
  inputs: readonly AllocationBudgetInput[] | undefined,
): Map<string, AllocationBudgetReference> {
  const result = new Map<string, AllocationBudgetReference>();
  for (const input of inputs ?? []) {
    const budget = normalizeAllocationBudget(input);
    if (result.has(budget.boxReferenceId)) {
      return fail("DUPLICATE_REFERENCE", "boxReferenceId");
    }
    result.set(budget.boxReferenceId, budget);
  }
  return result;
}

/** Resolves one Caixinha's rule at the economic date, never at query time. */
export function resolveEffectiveAllocationRule(
  rules: readonly (AllocationRuleInput | AllocationRule)[],
  boxReferenceId: string,
  asOf: BudgetDateInput,
  options: Omit<ResolveEffectiveAllocationRulesInput, "rules" | "asOf"> = {},
): AllocationRule | null {
  const box = assertOpaqueReference(boxReferenceId, "boxReferenceId");
  const date = parseBudgetDate(asOf, "effectiveOn");
  const resolved = resolveEffectiveAllocationRules({
    rules,
    asOf: date,
    ...options,
  }).filter((rule) => rule.boxReferenceId === box);
  return resolved[0] ?? null;
}

/** Resolves at most one rule per Caixinha and returns canonical box order. */
export function resolveEffectiveAllocationRules(
  input: ResolveEffectiveAllocationRulesInput,
): readonly AllocationRule[];
export function resolveEffectiveAllocationRules(
  rules: readonly (AllocationRuleInput | AllocationRule)[],
  asOf: BudgetDateInput,
  options?: Omit<ResolveEffectiveAllocationRulesInput, "rules" | "asOf">,
): readonly AllocationRule[];
export function resolveEffectiveAllocationRules(
  first:
    | ResolveEffectiveAllocationRulesInput
    | readonly (AllocationRuleInput | AllocationRule)[],
  second?: BudgetDateInput,
  third: Omit<ResolveEffectiveAllocationRulesInput, "rules" | "asOf"> = {},
): readonly AllocationRule[] {
  const input: ResolveEffectiveAllocationRulesInput = Array.isArray(first)
    ? { rules: first, asOf: second as BudgetDateInput, ...third }
    : (first as ResolveEffectiveAllocationRulesInput);
  const date = parseBudgetDate(input.asOf, "effectiveOn");
  const rules = canonicalizeAllocationRules(input.rules);
  const budgets = normalizeBudgetMap(input.budgets);
  const selected = new Map<string, AllocationRule>();

  for (const rule of rules) {
    if (!ruleAppliesAt(rule, date)) continue;
    const budget = budgets.get(rule.boxReferenceId);
    if (
      budget !== undefined &&
      !budgetAutomaticallyEligible(
        budget,
        date,
        input.includeArchivedCategories === true,
      )
    ) {
      continue;
    }
    if (selected.has(rule.boxReferenceId)) {
      return fail("ALLOCATION_OVERLAP", "effectiveOn");
    }
    selected.set(rule.boxReferenceId, rule);
  }

  return Object.freeze(
    [...selected.values()].sort((left, right) =>
      compareReferences(left.boxReferenceId, right.boxReferenceId),
    ),
  );
}

export const resolveAllocationRuleAt = resolveEffectiveAllocationRule;
export const resolveAllocationRulesAt = resolveEffectiveAllocationRules;
export const resolveBudgetAllocationRule = resolveEffectiveAllocationRule;
export const resolveBudgetAllocationRules = resolveEffectiveAllocationRules;

/** Explicit validation hook for ReplaceAllocationRules commands. */
export function assertAllocationRulesHavePositiveWeight(
  rules: readonly (AllocationRuleInput | AllocationRule)[],
  asOf?: BudgetDateInput,
): true {
  const canonical = canonicalizeAllocationRules(rules);
  const effective =
    asOf === undefined
      ? canonical
      : resolveEffectiveAllocationRules(canonical, asOf);
  if (!effective.some((rule) => rule.amountCents > ZERO)) {
    return fail("ALLOCATION_NO_POSITIVE_WEIGHT", "amountCents");
  }
  return true;
}

export interface RealizedIncomeInput {
  readonly id?: string;
  readonly referenceId?: string;
  readonly incomeReferenceId?: string;
  readonly sourceReferenceId?: string;
  readonly financialEventId?: string;
  readonly kind?: "INCOME" | string;
  readonly status?: "POSTED" | "PLANNED" | "EXPECTED" | "CANCELLED" | "REALIZED" | string;
  readonly origin?: string;
  readonly amount?: BudgetAmountInput;
  readonly amountCents?: BudgetAmountInput;
  readonly occurredOn?: BudgetDateInput;
  readonly effectiveOn?: BudgetDateInput;
  readonly reconciliationKey?: string | null;
  readonly plannedReferenceId?: string | null;
}

export interface NormalizedIncomeEvent {
  readonly referenceId: string;
  readonly incomeReferenceId: string;
  readonly amount: MoneyValue;
  readonly amountCents: bigint;
  readonly occurredOn: Temporal.PlainDate;
  readonly effectiveOn: Temporal.PlainDate;
  readonly kind: "INCOME";
  readonly status: string;
  readonly reconciliationKey: string | null;
}

function normalizeIncome(input: RealizedIncomeInput): NormalizedIncomeEvent {
  if (input === null || typeof input !== "object") {
    return fail("INVALID_COMMAND", "referenceId");
  }
  const referenceId = referenceAlias(
    [input.incomeReferenceId, input.sourceReferenceId, input.referenceId, input.financialEventId, input.id],
    "referenceId",
  ) as string;
  if (input.kind !== undefined && input.kind !== "INCOME") {
    return fail("INVALID_COMMAND", "referenceId");
  }
  const amount = positiveMoney(input.amount ?? input.amountCents);
  const dateValue = input.occurredOn ?? input.effectiveOn;
  if (dateValue === undefined) return fail("INVALID_DATE", "effectiveOn");
  const occurredOn = parseBudgetDate(dateValue, "effectiveOn");
  const effectiveOn =
    input.effectiveOn === undefined
      ? occurredOn
      : parseBudgetDate(input.effectiveOn, "effectiveOn");
  const status = input.status ?? "POSTED";
  const reconciliationKey =
    input.reconciliationKey === undefined || input.reconciliationKey === null
      ? null
      : assertOpaqueReference(input.reconciliationKey, "referenceId");
  return Object.freeze({
    referenceId,
    incomeReferenceId: referenceId,
    amount,
    amountCents: amount.cents,
    occurredOn,
    effectiveOn,
    kind: "INCOME",
    status,
    reconciliationKey,
  });
}

export type AllocationDistributionStatus =
  | "DISTRIBUTED"
  | "NO_CONFIGURATION"
  | "NOT_REALIZED"
  | "ALREADY_RECONCILED";

export interface AllocationContribution {
  readonly referenceId: string;
  readonly boxReferenceId: string;
  readonly budgetReferenceId: string;
  readonly ruleReferenceId: string;
  readonly kind: "CONTRIBUTION";
  readonly amount: MoneyValue;
  readonly amountCents: bigint;
  readonly effectiveOn: Temporal.PlainDate;
  readonly sourceReferenceId: string;
  readonly incomeReferenceId: string;
  readonly reconciliationKey: string | null;
  /** Zero-weight rows explain the complete distribution but are not movements. */
  readonly materializable: boolean;
}

export interface ExistingAllocationContributionInput {
  readonly referenceId: string;
  readonly amount?: BudgetAmountInput;
  readonly amountCents?: BudgetAmountInput;
}

export interface DistributeRealizedIncomeInput extends RealizedIncomeInput {
  readonly income?: RealizedIncomeInput;
  readonly event?: RealizedIncomeInput;
  readonly rules: readonly (AllocationRuleInput | AllocationRule)[];
  readonly budgets?: readonly AllocationBudgetInput[];
  readonly includeArchivedCategories?: boolean;
  readonly alreadyReflectedReferenceIds?: readonly string[];
  readonly alreadyDistributedReferenceIds?: readonly string[];
  readonly existingContributionReferences?: readonly string[];
  readonly existingContributions?: readonly ExistingAllocationContributionInput[];
}

export interface AllocationDistribution {
  readonly status: AllocationDistributionStatus;
  readonly incomeReferenceId: string;
  readonly effectiveOn: Temporal.PlainDate;
  readonly originAmount: MoneyValue;
  readonly originAmountCents: bigint;
  readonly distributedAmount: MoneyValue;
  readonly distributedAmountCents: bigint;
  readonly remainingAmount: MoneyValue;
  readonly remainingAmountCents: bigint;
  readonly contributions: readonly AllocationContribution[];
  readonly ruleReferenceIds: readonly string[];
  readonly reconciliationKey: string | null;
  /** Informational only: no command/forecast item is created by this result. */
  readonly createsMovement: false;
  readonly entersForecast: false;
}

function fnv64(value: string): string {
  let hash = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  const mask = BigInt("0xffffffffffffffff");
  for (const character of value) {
    hash ^= BigInt(character.charCodeAt(0));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Stable opaque reference for a contribution, independent of persistence IDs. */
export function allocationContributionReferenceId(
  incomeReferenceId: string,
  ruleReferenceId: string,
  suffix?: string,
): string {
  const income = assertOpaqueReference(incomeReferenceId, "referenceId");
  const rule = assertOpaqueReference(ruleReferenceId, "referenceId");
  const normalizedSuffix =
    suffix === undefined ? "" : `:${assertOpaqueReference(suffix, "referenceId")}`;
  const candidate = `allocation:${income}:${rule}${normalizedSuffix}`;
  if (candidate.length <= ALLOCATION_REFERENCE_MAX_LENGTH) return candidate;
  return `allocation:${fnv64(candidate)}`;
}

export const buildAllocationContributionReference = allocationContributionReferenceId;
export const deriveAllocationReference = allocationContributionReferenceId;

function distributionInput(
  first: DistributeRealizedIncomeInput | RealizedIncomeInput,
  rules?: readonly (AllocationRuleInput | AllocationRule)[],
  options: Omit<DistributeRealizedIncomeInput, keyof RealizedIncomeInput | "rules" | "income" | "event"> = {},
): DistributeRealizedIncomeInput {
  if (
    first !== null &&
    typeof first === "object" &&
    "rules" in first
  ) {
    return first as DistributeRealizedIncomeInput;
  }
  if (rules === undefined) return fail("INVALID_COMMAND", "referenceId");
  return {
    ...(first as RealizedIncomeInput),
    ...options,
    rules,
  };
}

function contributionFrom(
  income: NormalizedIncomeEvent,
  rule: AllocationRule,
  amountCents: bigint,
): AllocationContribution {
  return Object.freeze({
    referenceId: allocationContributionReferenceId(
      income.incomeReferenceId,
      rule.referenceId,
    ),
    boxReferenceId: rule.boxReferenceId,
    budgetReferenceId: rule.boxReferenceId,
    ruleReferenceId: rule.referenceId,
    kind: "CONTRIBUTION",
    amount: moneyFromCents(amountCents),
    amountCents,
    effectiveOn: income.effectiveOn,
    sourceReferenceId: income.incomeReferenceId,
    incomeReferenceId: income.incomeReferenceId,
    reconciliationKey: income.reconciliationKey,
    materializable: amountCents > ZERO,
  });
}

function emptyDistribution(
  income: NormalizedIncomeEvent,
  status: AllocationDistributionStatus,
  rules: readonly AllocationRule[] = [],
): AllocationDistribution {
  return Object.freeze({
    status,
    incomeReferenceId: income.incomeReferenceId,
    effectiveOn: income.effectiveOn,
    originAmount: income.amount,
    originAmountCents: income.amountCents,
    distributedAmount: Money.zero(),
    distributedAmountCents: ZERO,
    remainingAmount: income.amount,
    remainingAmountCents: income.amountCents,
    contributions: Object.freeze([]),
    ruleReferenceIds: Object.freeze(rules.map((rule) => rule.referenceId)),
    reconciliationKey: income.reconciliationKey,
    createsMovement: false,
    entersForecast: false,
  });
}

function existingReferenceSet(input: DistributeRealizedIncomeInput): Set<string> {
  const values = [
    ...(input.alreadyReflectedReferenceIds ?? []),
    ...(input.alreadyDistributedReferenceIds ?? []),
    ...(input.existingContributionReferences ?? []),
  ];
  const result = new Set<string>();
  for (const value of values) {
    result.add(assertOpaqueReference(value, "referenceId"));
  }
  return result;
}

function existingContributions(
  input: DistributeRealizedIncomeInput,
): Map<string, bigint> {
  const result = new Map<string, bigint>();
  for (const item of input.existingContributions ?? []) {
    const referenceId = assertOpaqueReference(item.referenceId, "referenceId");
    const amount = asNonNegativeCents(item.amount ?? item.amountCents);
    if (result.has(referenceId)) return fail("DUPLICATE_REFERENCE", "referenceId");
    result.set(referenceId, amount);
  }
  return result;
}

/**
 * Distributes only a realized INCOME/POSTED event.  The returned rows are
 * virtual and deterministic; a planned/expected income returns no rows.
 */
export function distributeRealizedIncome(
  input: DistributeRealizedIncomeInput,
): AllocationDistribution;
export function distributeRealizedIncome(
  income: RealizedIncomeInput,
  rules: readonly (AllocationRuleInput | AllocationRule)[],
  options?: Omit<DistributeRealizedIncomeInput, keyof RealizedIncomeInput | "rules" | "income" | "event">,
): AllocationDistribution;
export function distributeRealizedIncome(
  first: DistributeRealizedIncomeInput | RealizedIncomeInput,
  second?: readonly (AllocationRuleInput | AllocationRule)[],
  third: Omit<DistributeRealizedIncomeInput, keyof RealizedIncomeInput | "rules" | "income" | "event"> = {},
): AllocationDistribution {
  const input = distributionInput(first, second, third);
  const income = normalizeIncome(input.income ?? input.event ?? input);
  const status = income.status;
  if (status !== "POSTED" && status !== "REALIZED") {
    return emptyDistribution(income, "NOT_REALIZED");
  }

  const references = existingReferenceSet(input);
  if (
    references.has(income.incomeReferenceId) ||
    (income.reconciliationKey !== null && references.has(income.reconciliationKey))
  ) {
    const effective = resolveEffectiveAllocationRules({
      rules: input.rules,
      asOf: income.effectiveOn,
      budgets: input.budgets,
      includeArchivedCategories: input.includeArchivedCategories,
    });
    return emptyDistribution(income, "ALREADY_RECONCILED", effective);
  }

  const effectiveRules = resolveEffectiveAllocationRules({
    rules: input.rules,
    asOf: income.effectiveOn,
    budgets: input.budgets,
    includeArchivedCategories: input.includeArchivedCategories,
  });
  const positiveRules = effectiveRules.filter((rule) => rule.amountCents > ZERO);
  if (positiveRules.length === 0) {
    return emptyDistribution(income, "NO_CONFIGURATION", effectiveRules);
  }

  const totalWeight = sumCents(positiveRules.map((rule) => rule.amountCents));
  if (totalWeight <= ZERO) {
    return emptyDistribution(income, "NO_CONFIGURATION", effectiveRules);
  }

  const existing = existingContributions(input);
  const expected = effectiveRules.map((rule) => {
    const base = (income.amountCents * rule.amountCents) / totalWeight;
    return contributionFrom(income, rule, base);
  });
  const baseTotal = sumCents(expected.map((contribution) => contribution.amountCents));
  const remainder = income.amountCents - baseTotal;
  let positiveIndex = ZERO;
  const rounded = expected.map((contribution, index) => {
    const rule = effectiveRules[index];
    if (rule === undefined) return contribution;
    const receivesRemainder =
      rule.amountCents > ZERO && positiveIndex < remainder;
    if (rule.amountCents > ZERO) positiveIndex += ONE;
    if (!receivesRemainder) return contribution;
    return contributionFrom(
      income,
      rule,
      contribution.amountCents + ONE,
    );
  });

  const contributions: AllocationContribution[] = [];
  for (const contribution of rounded) {
    const previousAmount = existing.get(contribution.referenceId);
    if (previousAmount !== undefined) {
      if (previousAmount !== contribution.amountCents) {
        return fail("DUPLICATE_REFERENCE", "referenceId");
      }
      continue;
    }
    if (references.has(contribution.referenceId)) continue;
    contributions.push(contribution);
  }

  const createdAmountCents = sumCents(
    contributions.map((contribution) => contribution.amountCents),
  );
  const statusResult: AllocationDistributionStatus =
    contributions.length === 0 ? "ALREADY_RECONCILED" : "DISTRIBUTED";
  return Object.freeze({
    status: statusResult,
    incomeReferenceId: income.incomeReferenceId,
    effectiveOn: income.effectiveOn,
    originAmount: income.amount,
    originAmountCents: income.amountCents,
    distributedAmount: moneyFromCents(createdAmountCents),
    distributedAmountCents: createdAmountCents,
    remainingAmount: moneyFromCents(income.amountCents - createdAmountCents),
    remainingAmountCents: income.amountCents - createdAmountCents,
    contributions: Object.freeze(contributions),
    ruleReferenceIds: Object.freeze(effectiveRules.map((rule) => rule.referenceId)),
    reconciliationKey: income.reconciliationKey,
    createsMovement: false,
    entersForecast: false,
  });
}

export const allocateRealizedIncome = distributeRealizedIncome;
export const distributeIncome = distributeRealizedIncome;
export const allocateIncome = distributeRealizedIncome;
export const distributePostedIncome = distributeRealizedIncome;

export interface BudgetExpenseSourceInput {
  readonly kind?: "EXPENSE" | "PURCHASE" | string;
  readonly sourceKind?: "EXPENSE" | "PURCHASE" | string;
  readonly id?: string;
  readonly referenceId?: string;
  readonly sourceReferenceId?: string;
  readonly financialEventId?: string;
  readonly purchaseId?: string | null;
  readonly purchaseReferenceId?: string | null;
  readonly economicReferenceId?: string | null;
  readonly categoryId?: string | null;
  readonly amount?: BudgetAmountInput;
  readonly amountCents?: BudgetAmountInput;
  readonly occurredOn?: BudgetDateInput;
  readonly effectiveOn?: BudgetDateInput;
  readonly status?: string;
  readonly origin?: string;
  readonly installmentId?: string | null;
  readonly installmentReferenceId?: string | null;
  readonly installmentIds?: readonly string[];
  readonly installmentCount?: number;
}

export interface BudgetRefundSourceInput {
  readonly kind?: "REFUND" | string;
  readonly sourceKind?: "REFUND" | string;
  readonly id?: string;
  readonly referenceId?: string;
  readonly sourceReferenceId?: string;
  readonly refundReferenceId?: string;
  readonly originalReferenceId?: string;
  readonly originalExpenseReferenceId?: string;
  readonly financialEventId?: string;
  readonly categoryId?: string | null;
  readonly amount?: BudgetAmountInput;
  readonly amountCents?: BudgetAmountInput;
  readonly originalAmount?: BudgetAmountInput;
  readonly originalAmountCents?: BudgetAmountInput;
  readonly originalOccurredOn?: BudgetDateInput | null;
  readonly occurredOn?: BudgetDateInput;
  readonly effectiveOn?: BudgetDateInput;
  readonly status?: string;
  readonly origin?: string;
}

export interface BudgetNonExpenseSourceInput {
  readonly kind?: string;
  readonly sourceKind?: string;
  readonly id?: string;
  readonly referenceId?: string;
  readonly sourceReferenceId?: string;
  readonly status?: string;
  readonly amount?: BudgetAmountInput;
  readonly amountCents?: BudgetAmountInput;
  readonly occurredOn?: BudgetDateInput;
  readonly effectiveOn?: BudgetDateInput;
}

export type BudgetFinancialSourceInput =
  | BudgetExpenseSourceInput
  | BudgetRefundSourceInput
  | BudgetNonExpenseSourceInput;

export type BudgetEffectSourceKind = "EXPENSE" | "REFUND";

export interface BudgetFinancialEffect {
  readonly referenceId: string;
  readonly sourceReferenceId: string;
  readonly sourceKind: BudgetEffectSourceKind;
  readonly kind: "WITHDRAWAL" | "CONTRIBUTION";
  readonly boxReferenceId: string;
  readonly budgetReferenceId: string;
  readonly categoryId: string;
  readonly amount: MoneyValue;
  readonly amountCents: bigint;
  readonly effectiveOn: Temporal.PlainDate;
  readonly economicReferenceId: string;
  readonly originalReferenceId: string | null;
  /** The source is virtual; T07 decides if/when it becomes a persisted row. */
  readonly virtual: true;
  /** False for a refund after closure: explainable, but not a new protection. */
  readonly balanceEligible: boolean;
}

export type BudgetEffectKind = BudgetFinancialEffect["kind"];

export type BudgetIgnoredSourceReason =
  | "NOT_REALIZED"
  | "NON_CANONICAL_SOURCE"
  | "DUPLICATE_SOURCE"
  | "NO_ACTIVE_BUDGET"
  | "CATEGORY_ARCHIVED"
  | "CANCELLED";

export interface BudgetIgnoredSource {
  readonly referenceId: string | null;
  readonly sourceKind: string;
  readonly reason: BudgetIgnoredSourceReason;
}

export interface BudgetFinancialEffects {
  readonly effects: readonly BudgetFinancialEffect[];
  readonly ignored: readonly BudgetIgnoredSource[];
  readonly grossExpense: MoneyValue;
  readonly grossExpenseCents: bigint;
  readonly refunds: MoneyValue;
  readonly refundsCents: bigint;
  readonly netExpense: MoneyValue;
  readonly netExpenseCents: bigint;
  readonly expenseReferenceIds: readonly string[];
  readonly refundReferenceIds: readonly string[];
  readonly allSourceReferenceIds: readonly string[];
}

export interface ResolveBudgetForExpenseInput {
  readonly categoryId: string;
  readonly occurredOn: BudgetDateInput;
  readonly budgets: readonly AllocationBudgetInput[];
  readonly categories?: readonly AllocationCategoryInput[];
  readonly allowArchivedCategoryHistory?: boolean;
}

export interface BudgetCategoryResolution {
  readonly budget: AllocationBudgetReference;
  readonly boxReferenceId: string;
  readonly budgetReferenceId: string;
  readonly matchedCategoryId: string;
  readonly expenseCategoryId: string;
  readonly specificity: number;
  readonly occurredOn: Temporal.PlainDate;
}

function normalizeCategory(input: AllocationCategoryInput): AllocationCategoryInput {
  const id = referenceAlias([input.id], "categoryId") as string;
  const parentId = referenceAlias(
    [input.parentId, input.parentCategoryId],
    "categoryId",
    false,
  );
  const archivedOn =
    input.archivedOn === undefined || input.archivedOn === null
      ? null
      : parseBudgetDate(input.archivedOn, "effectiveOn");
  return Object.freeze({
    ...input,
    id,
    parentId: parentId ?? null,
    parentCategoryId: parentId ?? null,
    archivedOn,
  });
}

function categoryIsExpenseAt(
  category: AllocationCategoryInput | undefined,
  date: Temporal.PlainDate,
  allowArchivedCategoryHistory: boolean,
): boolean {
  if (category?.kind !== undefined && category.kind !== "EXPENSE") {
    return fail("CATEGORY_KIND_MISMATCH", "categoryId");
  }
  if (category?.status !== "ARCHIVED") return true;
  if (
    allowArchivedCategoryHistory &&
    category.archivedOn !== undefined &&
    category.archivedOn !== null &&
    compareBudgetDates(
      date,
      parseBudgetDate(category.archivedOn, "effectiveOn"),
    ) < 0
  ) {
    return true;
  }
  return false;
}

/**
 * Chooses the most specific active Caixinha at the expense's economic date.
 * It never uses the query date and never splits one expense between boxes.
 */
export function resolveBudgetForExpense(
  input: ResolveBudgetForExpenseInput,
): BudgetCategoryResolution | null {
  const expenseCategoryId = referenceAlias([input.categoryId], "categoryId") as string;
  const occurredOn = parseBudgetDate(input.occurredOn, "effectiveOn");
  const budgets = input.budgets.map(normalizeAllocationBudget);
  const categories = new Map<string, AllocationCategoryInput>();
  for (const rawCategory of input.categories ?? []) {
    const category = normalizeCategory(rawCategory);
    if (categories.has(category.id)) return fail("DUPLICATE_REFERENCE", "categoryId");
    categories.set(category.id, category);
  }

  const allowArchivedHistory = input.allowArchivedCategoryHistory !== false;
  const visited = new Set<string>();
  let currentCategoryId: string | null = expenseCategoryId;
  let specificity = 0;
  while (currentCategoryId !== null) {
    if (visited.has(currentCategoryId)) return fail("INVALID_COMMAND", "categoryId");
    visited.add(currentCategoryId);
    const category = categories.get(currentCategoryId);
    if (!categoryIsExpenseAt(category, occurredOn, allowArchivedHistory)) {
      return null;
    }

    const matches = budgets.filter(
      (budget) =>
        budget.categoryId === currentCategoryId &&
        budgetAutomaticallyEligible(budget, occurredOn, false),
    );
    if (matches.length > 1) {
      return fail("CATEGORY_ACTIVE_BUDGET_CONFLICT", "categoryId");
    }
    const match = matches[0];
    if (match !== undefined) {
      return Object.freeze({
        budget: match,
        boxReferenceId: match.boxReferenceId,
        budgetReferenceId: match.budgetReferenceId,
        matchedCategoryId: currentCategoryId,
        expenseCategoryId,
        specificity,
        occurredOn,
      });
    }

    const parent = category?.parentId ?? category?.parentCategoryId ?? null;
    currentCategoryId = parent;
    specificity += 1;
  }
  return null;
}

export const resolveExpenseBudget = resolveBudgetForExpense;
export const resolveCategoryBudget = resolveBudgetForExpense;
export const resolveSpecificBudgetForExpense = resolveBudgetForExpense;

interface NormalizedExpenseSource {
  readonly referenceId: string;
  readonly economicReferenceId: string;
  readonly categoryId: string;
  readonly amount: MoneyValue;
  readonly occurredOn: Temporal.PlainDate;
  readonly kind: "EXPENSE" | "PURCHASE";
  readonly status: string;
}

interface NormalizedRefundSource {
  readonly referenceId: string;
  readonly originalReferenceId: string;
  readonly categoryId: string | null;
  readonly amount: MoneyValue;
  readonly originalAmount: MoneyValue | null;
  readonly originalOccurredOn: Temporal.PlainDate | null;
  readonly effectiveOn: Temporal.PlainDate;
  readonly status: string;
}

function sourceKind(input: BudgetFinancialSourceInput): string {
  const value = input.sourceKind ?? input.kind;
  return typeof value === "string" && value.length > 0 ? value : "UNKNOWN";
}

function sourceReference(input: BudgetFinancialSourceInput): string | null {
  return referenceAlias(
    [
      input.sourceReferenceId,
      input.referenceId,
      "financialEventId" in input ? input.financialEventId : undefined,
      "refundReferenceId" in input ? input.refundReferenceId : undefined,
      input.id,
    ],
    "referenceId",
    false,
  ) ?? null;
}

function realizedStatus(status: string | undefined): boolean {
  return status === undefined || status === "POSTED" || status === "REALIZED";
}

function normalizeExpenseSource(
  input: BudgetExpenseSourceInput,
): NormalizedExpenseSource {
  const referenceId = sourceReference(input);
  if (referenceId === null) return fail("INVALID_REFERENCE", "referenceId");
  const categoryId = referenceAlias([input.categoryId], "categoryId") as string;
  const dateValue = input.occurredOn ?? input.effectiveOn;
  if (dateValue === undefined) return fail("INVALID_DATE", "effectiveOn");
  const occurredOn = parseBudgetDate(dateValue, "effectiveOn");
  const kindValue = input.sourceKind ?? input.kind ?? "EXPENSE";
  const kind = kindValue === "PURCHASE" ? "PURCHASE" : "EXPENSE";
  const identity = referenceAlias(
    [input.economicReferenceId],
    "referenceId",
    false,
  ) ??
    firstReference(
      [input.purchaseReferenceId, input.purchaseId, input.financialEventId, referenceId],
      "referenceId",
    );
  if (identity === undefined) return fail("INVALID_REFERENCE", "referenceId");
  return Object.freeze({
    referenceId,
    economicReferenceId: identity,
    categoryId,
    amount: positiveMoney(input.amount ?? input.amountCents),
    occurredOn,
    kind,
    status: input.status ?? "POSTED",
  });
}

function normalizeRefundSource(input: BudgetRefundSourceInput): NormalizedRefundSource {
  const referenceId = sourceReference(input);
  if (referenceId === null) return fail("INVALID_REFERENCE", "referenceId");
  const originalReferenceId = referenceAlias(
    [input.originalReferenceId, input.originalExpenseReferenceId],
    "referenceId",
  ) as string;
  const effectiveValue = input.effectiveOn ?? input.occurredOn;
  if (effectiveValue === undefined) return fail("INVALID_DATE", "effectiveOn");
  const originalOccurredOn =
    input.originalOccurredOn === undefined || input.originalOccurredOn === null
      ? null
      : parseBudgetDate(input.originalOccurredOn, "effectiveOn");
  return Object.freeze({
    referenceId,
    originalReferenceId,
    categoryId: referenceAlias([input.categoryId], "categoryId", false) ?? null,
    amount: positiveMoney(input.amount ?? input.amountCents),
    originalAmount:
      input.originalAmount === undefined && input.originalAmountCents === undefined
        ? null
        : positiveMoney(input.originalAmount ?? input.originalAmountCents),
    originalOccurredOn,
    effectiveOn: parseBudgetDate(effectiveValue, "effectiveOn"),
    status: input.status ?? "POSTED",
  });
}

function expenseIdentity(input: NormalizedExpenseSource): string {
  return input.economicReferenceId;
}

function effectFromExpense(
  source: NormalizedExpenseSource,
  resolution: BudgetCategoryResolution,
): BudgetFinancialEffect {
  return Object.freeze({
    referenceId: source.referenceId,
    sourceReferenceId: source.referenceId,
    sourceKind: "EXPENSE",
    kind: "WITHDRAWAL",
    boxReferenceId: resolution.boxReferenceId,
    budgetReferenceId: resolution.budgetReferenceId,
    categoryId: source.categoryId,
    amount: source.amount,
    amountCents: source.amount.cents,
    effectiveOn: source.occurredOn,
    economicReferenceId: source.economicReferenceId,
    originalReferenceId: null,
    virtual: true,
    balanceEligible: true,
  });
}

function effectFromRefund(
  source: NormalizedRefundSource,
  resolution: BudgetCategoryResolution,
  categoryId: string,
  economicReferenceId: string,
): BudgetFinancialEffect {
  return Object.freeze({
    referenceId: source.referenceId,
    sourceReferenceId: source.referenceId,
    sourceKind: "REFUND",
    kind: "CONTRIBUTION",
    boxReferenceId: resolution.boxReferenceId,
    budgetReferenceId: resolution.budgetReferenceId,
    categoryId,
    amount: source.amount,
    amountCents: source.amount.cents,
    effectiveOn: source.effectiveOn,
    economicReferenceId,
    originalReferenceId: source.originalReferenceId,
    virtual: true,
    balanceEligible: budgetCanReceiveHistoricalEffectAt(
      resolution.budget,
      source.effectiveOn,
    ),
  });
}

export interface ResolveBudgetFinancialEffectsInput {
  readonly sources: readonly BudgetFinancialSourceInput[];
  readonly budgets: readonly AllocationBudgetInput[];
  readonly categories?: readonly AllocationCategoryInput[];
}

function ignored(
  input: BudgetFinancialSourceInput,
  reason: BudgetIgnoredSourceReason,
): BudgetIgnoredSource {
  return Object.freeze({
    referenceId: sourceReference(input),
    sourceKind: sourceKind(input),
    reason,
  });
}

function sourcePayloadSignature(input: BudgetFinancialSourceInput): string {
  const reference = sourceReference(input) ?? "";
  const kind = sourceKind(input);
  const amount =
    "amountCents" in input && input.amountCents !== undefined
      ? String(input.amountCents)
      : "amount" in input && input.amount !== undefined
        ? String(input.amount)
        : "";
  const date = String(input.effectiveOn ?? input.occurredOn ?? "");
  return `${kind}|${reference}|${amount}|${date}`;
}

/**
 * Normalizes the canonical expense/refund stream.
 *
 * `PURCHASE` is the one economic expense for a card purchase. `INSTALLMENT`,
 * `FORECAST`, `PAYMENT` and `TRANSFER` inputs are deliberately reported as
 * ignored, so callers cannot accidentally add them as competing withdrawals.
 */
export function resolveBudgetFinancialEffects(
  input: ResolveBudgetFinancialEffectsInput,
): BudgetFinancialEffects {
  const budgets = input.budgets.map(normalizeAllocationBudget);
  const categories = input.categories ?? [];
  const effects: BudgetFinancialEffect[] = [];
  const ignoredSources: BudgetIgnoredSource[] = [];
  const seenReferences = new Map<string, string>();
  const expenses = new Map<string, NormalizedExpenseSource>();
  /**
   * A legacy/event row and its economic PURCHASE row may have distinct
   * references while sharing one identity. Keep both aliases so a refund can
   * point at whichever original reference the upstream source published.
   */
  const expenseAliases = new Map<string, Set<string>>();
  const refunds: NormalizedRefundSource[] = [];
  const sourceReferences: string[] = [];

  for (const raw of input.sources) {
    const kind = sourceKind(raw);
    const referenceId = sourceReference(raw);
    if (referenceId !== null) sourceReferences.push(referenceId);
    const signature = sourcePayloadSignature(raw);
    if (referenceId !== null) {
      const previous = seenReferences.get(referenceId);
      if (previous !== undefined) {
        if (previous !== signature) return fail("DUPLICATE_REFERENCE", "referenceId");
        ignoredSources.push(ignored(raw, "DUPLICATE_SOURCE"));
        continue;
      }
      seenReferences.set(referenceId, signature);
    }

    if (kind === "EXPENSE" || kind === "PURCHASE") {
      const expense = normalizeExpenseSource(raw as BudgetExpenseSourceInput);
      if (!realizedStatus(expense.status)) {
        ignoredSources.push(ignored(raw, expense.status === "CANCELLED" ? "CANCELLED" : "NOT_REALIZED"));
        continue;
      }
      const identity = expenseIdentity(expense);
      const aliases = expenseAliases.get(identity) ?? new Set<string>();
      aliases.add(expense.referenceId);
      aliases.add(expense.economicReferenceId);
      expenseAliases.set(identity, aliases);
      const previous = expenses.get(identity);
      if (previous !== undefined) {
        // Prefer the economic PURCHASE row if a legacy reader also supplies a
        // generic event row. Never add both rows.
        if (expense.kind === "PURCHASE" && previous.kind !== "PURCHASE") {
          expenses.set(identity, expense);
        } else {
          ignoredSources.push(ignored(raw, "DUPLICATE_SOURCE"));
        }
      } else {
        expenses.set(identity, expense);
      }
      continue;
    }

    if (kind === "REFUND") {
      const refund = normalizeRefundSource(raw as BudgetRefundSourceInput);
      if (!realizedStatus(refund.status)) {
        ignoredSources.push(ignored(raw, refund.status === "CANCELLED" ? "CANCELLED" : "NOT_REALIZED"));
        continue;
      }
      refunds.push(refund);
      continue;
    }

    if (
      kind === "INSTALLMENT" ||
      kind === "PAYMENT" ||
      kind === "CARD_PAYMENT" ||
      kind === "TRANSFER" ||
      kind === "FORECAST"
    ) {
      ignoredSources.push(
        ignored(raw, kind === "FORECAST" && raw.status !== "POSTED" ? "NOT_REALIZED" : "NON_CANONICAL_SOURCE"),
      );
      continue;
    }
    ignoredSources.push(ignored(raw, "NON_CANONICAL_SOURCE"));
  }

  const expenseByReference = new Map<string, NormalizedExpenseSource>();
  for (const expense of expenses.values()) {
    const aliases = expenseAliases.get(expense.economicReferenceId) ?? new Set([
      expense.referenceId,
      expense.economicReferenceId,
    ]);
    for (const alias of aliases) {
      const previous = expenseByReference.get(alias);
      if (
        previous !== undefined &&
        previous.economicReferenceId !== expense.economicReferenceId
      ) {
        return fail("DUPLICATE_REFERENCE", "referenceId");
      }
      expenseByReference.set(alias, expense);
    }
    const resolution = resolveBudgetForExpense({
      categoryId: expense.categoryId,
      occurredOn: expense.occurredOn,
      budgets,
      categories,
      allowArchivedCategoryHistory: true,
    });
    if (resolution === null) {
      ignoredSources.push({
        referenceId: expense.referenceId,
        sourceKind: expense.kind,
        reason: "NO_ACTIVE_BUDGET",
      });
      continue;
    }
    effects.push(effectFromExpense(expense, resolution));
  }

  const refundTotals = new Map<string, bigint>();
  for (const refund of refunds) {
    const original = expenseByReference.get(refund.originalReferenceId);
    const originalAmount = refund.originalAmount ?? original?.amount ?? null;
    if (originalAmount === null) return fail("REFUND_EXCEEDS_ORIGINAL", "amountCents");
    const refundIdentity = original?.economicReferenceId ?? refund.originalReferenceId;
    const accumulated = (refundTotals.get(refundIdentity) ?? ZERO) + refund.amount.cents;
    if (accumulated > originalAmount.cents) {
      return fail("REFUND_EXCEEDS_ORIGINAL", "amountCents");
    }
    refundTotals.set(refundIdentity, accumulated);

    const categoryId = refund.categoryId ?? original?.categoryId ?? null;
    const originalOccurredOn = refund.originalOccurredOn ?? original?.occurredOn ?? null;
    if (categoryId === null || originalOccurredOn === null) {
      ignoredSources.push(ignored(refund as unknown as BudgetRefundSourceInput, "NO_ACTIVE_BUDGET"));
      continue;
    }
    const resolution = resolveBudgetForExpense({
      categoryId,
      occurredOn: originalOccurredOn,
      budgets,
      categories,
      allowArchivedCategoryHistory: true,
    });
    if (resolution === null) {
      ignoredSources.push(ignored(refund as unknown as BudgetRefundSourceInput, "NO_ACTIVE_BUDGET"));
      continue;
    }
    effects.push(
      effectFromRefund(
        refund,
        resolution,
        categoryId,
        original?.economicReferenceId ?? refund.originalReferenceId,
      ),
    );
  }

  const grossExpenseCents = sumCents(
    effects
      .filter((effect) => effect.sourceKind === "EXPENSE" && effect.balanceEligible)
      .map((effect) => effect.amountCents),
  );
  const refundsCents = sumCents(
    effects
      .filter((effect) => effect.sourceKind === "REFUND" && effect.balanceEligible)
      .map((effect) => effect.amountCents),
  );
  const netExpenseCents = grossExpenseCents - refundsCents;
  if (netExpenseCents < MIN_PERSISTABLE_CENTS || netExpenseCents > MAX_PERSISTABLE_CENTS) {
    return fail("AMOUNT_OUT_OF_RANGE", "amountCents");
  }
  const orderedEffects = [...effects].sort((left, right) => {
    const date = compareBudgetDates(left.effectiveOn, right.effectiveOn);
    if (date !== 0) return date;
    return compareReferences(left.referenceId, right.referenceId);
  });
  return Object.freeze({
    effects: Object.freeze(orderedEffects),
    ignored: Object.freeze(ignoredSources),
    grossExpense: moneyFromCents(grossExpenseCents),
    grossExpenseCents,
    refunds: moneyFromCents(refundsCents),
    refundsCents,
    netExpense: moneyFromCents(netExpenseCents),
    netExpenseCents,
    expenseReferenceIds: Object.freeze(
      orderedEffects
        .filter((effect) => effect.sourceKind === "EXPENSE")
        .map((effect) => effect.referenceId),
    ),
    refundReferenceIds: Object.freeze(
      orderedEffects
        .filter((effect) => effect.sourceKind === "REFUND")
        .map((effect) => effect.referenceId),
    ),
    allSourceReferenceIds: Object.freeze([...new Set(sourceReferences)]),
  });
}

export const normalizeBudgetFinancialEffects = resolveBudgetFinancialEffects;
export const resolveBudgetExpenseEffects = resolveBudgetFinancialEffects;
export const normalizeBudgetExpenseSources = resolveBudgetFinancialEffects;
export const deriveBudgetFinancialEffects = resolveBudgetFinancialEffects;

export interface BudgetTemporalState {
  readonly asOf: Temporal.PlainDate;
  readonly activeAtCutoff: boolean;
  readonly historicalAtCutoff: boolean;
  readonly protectsSpendable: boolean;
  readonly canReceiveHistoricalEffect: boolean;
  readonly canReceiveInteractiveMovement: boolean;
  readonly closedOn: Temporal.PlainDate | null;
}

/** Resolves the lifecycle boundary once so readers do not reimplement it. */
export function resolveBudgetTemporalState(
  budgetInput: Budget | BudgetInput,
  asOfInput: BudgetDateInput,
): BudgetTemporalState {
  const budget = normalizeBudget(budgetInput);
  const asOf = parseBudgetDate(asOfInput, "asOf");
  const activeAtCutoff = isBudgetActiveAt(budget, asOf);
  const historicalAtCutoff = compareBudgetDates(asOf, budget.activeFrom) >= 0;
  const canReceiveHistoricalEffect =
    historicalAtCutoff &&
    (budget.closedOn === null || compareBudgetDates(asOf, budget.closedOn) <= 0);
  const canReceiveInteractiveMovement =
    budget.status === "ACTIVE" && activeAtCutoff;
  return Object.freeze({
    asOf,
    activeAtCutoff,
    historicalAtCutoff,
    protectsSpendable: activeAtCutoff,
    canReceiveHistoricalEffect,
    canReceiveInteractiveMovement,
    closedOn: budget.closedOn,
  });
}

export const resolveBudgetLifecycle = resolveBudgetTemporalState;
export const resolveBudgetTransition = resolveBudgetTemporalState;
export const temporalStateAt = resolveBudgetTemporalState;

/** T02 remains the sole implementation of the signed rollover calculation. */
export function deriveBudgetRollover(
  budget: Budget | BudgetInput,
  movements: readonly (BudgetMovementInput | BudgetMovement)[],
  periodStart: BudgetDateInput,
): MoneyValue {
  return deriveRollover(budget, movements, periodStart);
}

export const resolveRollover = deriveBudgetRollover;
export const rollover = deriveBudgetRollover;

export interface BudgetGoalSuggestion {
  readonly targetAmount: MoneyValue | null;
  readonly targetAmountCents: bigint | null;
  readonly targetDate: Temporal.PlainDate | null;
  readonly balance: MoneyValue;
  readonly balanceCents: bigint;
  readonly remaining: MoneyValue;
  readonly remainingCents: bigint;
  readonly remainingMonths: number | null;
  readonly suggestedMonthlyAmount: MoneyValue | null;
  readonly suggestedMonthlyCents: bigint | null;
  readonly status: BudgetProgress["status"];
  readonly paceStatus: BudgetProgress["paceStatus"];
  readonly createsMovement: false;
  readonly entersForecast: false;
  readonly isCommitment: false;
}

export interface DeriveBudgetGoalSuggestionInput {
  readonly budget: Budget | BudgetInput;
  readonly asOf: BudgetDateInput;
  readonly balance?: MoneyValue | bigint | string;
  readonly balanceCents?: MoneyValue | bigint | string;
  readonly movements?: readonly (BudgetMovementInput | BudgetMovement)[];
}

/**
 * Derives the explanatory target suggestion from T02's single progress
 * calculation. It intentionally carries proof flags showing that no movement
 * or forecast commitment was created.
 */
export function deriveBudgetGoalSuggestion(
  input: DeriveBudgetGoalSuggestionInput,
): BudgetGoalSuggestion {
  const budget = normalizeBudget(input.budget);
  const asOf = parseBudgetDate(input.asOf, "asOf");
  const suppliedBalance = input.balance ?? input.balanceCents;
  const progress = deriveBudgetProgress({
    budget,
    asOf,
    movements: input.movements,
    ...(suppliedBalance !== undefined ? { balance: suppliedBalance } : {}),
  });
  const balance =
    suppliedBalance === undefined
      ? deriveBudgetBalance(budget, input.movements ?? [], asOf).balance
      : typeof suppliedBalance === "bigint"
        ? moneyFromCents(suppliedBalance, "balanceCents")
        : suppliedBalance instanceof Money
          ? moneyFromCents(suppliedBalance.cents, "balanceCents")
          : moneyFromCents(BigInt(suppliedBalance), "balanceCents");
  return Object.freeze({
    targetAmount: progress.targetAmount,
    targetAmountCents: progress.targetAmount?.cents ?? null,
    targetDate: progress.targetDate,
    balance,
    balanceCents: balance.cents,
    remaining: progress.remaining,
    remainingCents: progress.remaining.cents,
    remainingMonths: progress.remainingMonths,
    suggestedMonthlyAmount: progress.suggestedMonthlyAmount,
    suggestedMonthlyCents: progress.suggestedMonthlyAmount?.cents ?? null,
    status: progress.status,
    paceStatus: progress.paceStatus,
    createsMovement: false,
    entersForecast: false,
    isCommitment: false,
  });
}

export const deriveSuggestedGoalContribution = deriveBudgetGoalSuggestion;
export const deriveGoalSuggestion = deriveBudgetGoalSuggestion;
export const suggestedGoalContribution = deriveBudgetGoalSuggestion;

/** Boundary helper for T05/T07; it does not persist or alter the domain. */
export function serializeAllocationRule(
  input: AllocationRuleInput | AllocationRule,
): {
  readonly referenceId: string;
  readonly budgetReferenceId: string;
  readonly boxReferenceId: string;
  readonly amountCents: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
} {
  const rule = normalizeAllocationRule(input);
  return {
    referenceId: rule.referenceId,
    budgetReferenceId: rule.budgetReferenceId,
    boxReferenceId: rule.boxReferenceId,
    amountCents: rule.amountCents.toString(10),
    effectiveFrom: serializeBudgetDate(rule.effectiveFrom),
    effectiveUntil:
      rule.effectiveUntil === null ? null : serializeBudgetDate(rule.effectiveUntil),
  };
}

export const toAllocationRuleBoundary = serializeAllocationRule;

// Re-export the already-tested T02 temporal primitives so downstream readers
// can import one policy seam without copying lifecycle/rollover/progress math.
export {
  assertBudgetCanReceiveMovement,
  assertMovementDateWithinBudget,
  deriveBudgetBalance,
  deriveBudgetPeriodSummary,
  deriveBudgetProgress,
  isBudgetActiveAt,
};

export type { BudgetGoal };
export type { BudgetPeriodSummary };
