import { Temporal } from "@js-temporal/polyfill";

import {
  Money,
  type Money as MoneyValue,
} from "@/modules/transactions/money";

import {
  MAX_PERSISTABLE_CENTS,
  MIN_PERSISTABLE_CENTS,
  BudgetDomainError,
  type Budget,
  type BudgetBalance,
  type BudgetBalanceBoundary,
  type BudgetDateInput,
  type BudgetInput,
  type BudgetMovement,
  type BudgetMovementInput,
  type BudgetPeriodBoundary,
  type BudgetPeriodSummary,
  type BudgetPaceStatus,
  type BudgetProgress,
  type BudgetProgressBoundary,
  type BudgetReserveComponent,
  type BudgetReserveComponentBoundary,
} from "./contracts";
import {
  addPersistableCents,
  assertOpaqueReference,
  compareBudgetDates,
  monthRange,
  normalizeBudget,
  parseBudgetDate,
  sortBudgetMovements,
  serializeBudgetDate,
} from "./domain";

const ZERO = BigInt(0);
const BASIS_POINTS = BigInt(10_000);

export interface DeriveBudgetBalanceInput {
  readonly budget: BudgetInput | Budget;
  readonly movements: readonly (BudgetMovementInput | BudgetMovement)[];
  readonly asOf: BudgetDateInput;
}

export interface BudgetPeriodInput {
  readonly budget: BudgetInput | Budget;
  readonly movements: readonly (BudgetMovementInput | BudgetMovement)[];
  readonly from: BudgetDateInput;
  readonly to: BudgetDateInput;
}

export interface BudgetMonthInput {
  readonly budget: BudgetInput | Budget;
  readonly movements: readonly (BudgetMovementInput | BudgetMovement)[];
  readonly month: string | Temporal.PlainYearMonth;
}

export interface BudgetProgressInput {
  readonly budget: BudgetInput | Budget;
  readonly movements?: readonly (BudgetMovementInput | BudgetMovement)[];
  readonly balance?: MoneyValue | bigint | string;
  readonly balanceCents?: MoneyValue | bigint | string;
  readonly asOf: BudgetDateInput;
}

function signedMoney(cents: bigint): MoneyValue {
  if (cents < MIN_PERSISTABLE_CENTS || cents > MAX_PERSISTABLE_CENTS) {
    throw new BudgetDomainError("AMOUNT_OUT_OF_RANGE", "amountCents");
  }
  return cents === ZERO ? Money.zero() : new Money(cents);
}

function resolveBalanceArguments(
  first: DeriveBudgetBalanceInput | BudgetInput | Budget,
  second?: readonly (BudgetMovementInput | BudgetMovement)[],
  third?: BudgetDateInput,
): DeriveBudgetBalanceInput {
  if (
    second === undefined &&
    third === undefined &&
    first !== null &&
    typeof first === "object" &&
    "budget" in first &&
    "movements" in first &&
    "asOf" in first
  ) {
    return first as DeriveBudgetBalanceInput;
  }
  if (second === undefined || third === undefined) {
    throw new BudgetDomainError("INVALID_COMMAND", "asOf");
  }
  return {
    budget: first as BudgetInput | Budget,
    movements: second,
    asOf: third,
  };
}

/** Derives a signed balance using the inclusive cutoff and effective lifecycle window. */
export function deriveBudgetBalance(input: DeriveBudgetBalanceInput): BudgetBalance;
export function deriveBudgetBalance(
  budget: BudgetInput | Budget,
  movements: readonly (BudgetMovementInput | BudgetMovement)[],
  asOf: BudgetDateInput,
): BudgetBalance;
export function deriveBudgetBalance(
  first: DeriveBudgetBalanceInput | BudgetInput | Budget,
  second?: readonly (BudgetMovementInput | BudgetMovement)[],
  third?: BudgetDateInput,
): BudgetBalance {
  const input = resolveBalanceArguments(first, second, third);
  const budget = normalizeBudget(input.budget);
  const asOf = parseBudgetDate(input.asOf, "asOf");
  const movements = sortBudgetMovements(input.movements, budget);

  let contributionCents = ZERO;
  let withdrawalCents = ZERO;
  const movementReferenceIds: string[] = [];
  const contributionReferenceIds: string[] = [];
  const withdrawalReferenceIds: string[] = [];

  for (const movement of movements) {
    if (compareBudgetDates(movement.effectiveOn, asOf) > 0) continue;
    movementReferenceIds.push(movement.referenceId);
    if (movement.kind === "CONTRIBUTION") {
      contributionCents = addPersistableCents(
        contributionCents,
        movement.amount.cents,
      );
      contributionReferenceIds.push(movement.referenceId);
    } else {
      withdrawalCents = addPersistableCents(
        withdrawalCents,
        movement.amount.cents,
      );
      withdrawalReferenceIds.push(movement.referenceId);
    }
  }

  const balanceCents = addPersistableCents(
    contributionCents,
    -withdrawalCents,
  );
  const activeAtCutoff =
    compareBudgetDates(asOf, budget.activeFrom) >= 0 &&
    (budget.closedOn === null || compareBudgetDates(asOf, budget.closedOn) < 0);
  const protectedCents =
    activeAtCutoff && balanceCents > ZERO ? balanceCents : ZERO;

  return Object.freeze({
    rule: "BOX_BALANCE_PROTECTED",
    boxReferenceId: budget.referenceId,
    asOf,
    balance: signedMoney(balanceCents),
    protectedAmount: signedMoney(protectedCents),
    contributions: signedMoney(contributionCents),
    withdrawals: signedMoney(withdrawalCents),
    activeAtCutoff,
    movementReferenceIds: Object.freeze(movementReferenceIds),
    contributionReferenceIds: Object.freeze(contributionReferenceIds),
    withdrawalReferenceIds: Object.freeze(withdrawalReferenceIds),
  });
}

export const deriveBoxBalance = deriveBudgetBalance;
export const deriveBalance = deriveBudgetBalance;
export const calculateBudgetBalance = deriveBudgetBalance;

export function deriveBudgetBalanceCents(
  budget: BudgetInput | Budget,
  movements: readonly (BudgetMovementInput | BudgetMovement)[],
  asOf: BudgetDateInput,
): bigint {
  return deriveBudgetBalance(budget, movements, asOf).balance.cents;
}

export const balanceCents = deriveBudgetBalanceCents;
export const deriveBoxBalanceCents = deriveBudgetBalanceCents;

export function deriveProtectedAmount(
  budget: BudgetInput | Budget,
  movements: readonly (BudgetMovementInput | BudgetMovement)[],
  asOf: BudgetDateInput,
): MoneyValue {
  return deriveBudgetBalance(budget, movements, asOf).protectedAmount;
}

export const protectedAmount = deriveProtectedAmount;

export function protectedAmountCents(
  budget: BudgetInput | Budget,
  movements: readonly (BudgetMovementInput | BudgetMovement)[],
  asOf: BudgetDateInput,
): bigint {
  return deriveProtectedAmount(budget, movements, asOf).cents;
}

export const deriveProtectedAmountCents = protectedAmountCents;

function reflectedReferences(values: readonly string[] | undefined): ReadonlySet<string> {
  const result = new Set<string>();
  for (const [index, value] of (values ?? []).entries()) {
    result.add(assertOpaqueReference(value, index === 0 ? "referenceId" : "referenceId"));
  }
  return result;
}

export interface BudgetReserveComponentInput extends DeriveBudgetBalanceInput {
  readonly reflectedReferenceIds?: readonly string[];
  readonly alreadyReflectedReferenceIds?: readonly string[];
}

/** Derives the positive protected component and the one-time signed opening adjustment. */
export function deriveBudgetReserveComponent(
  input: BudgetReserveComponentInput,
): BudgetReserveComponent | null {
  const budget = normalizeBudget(input.budget);
  const balance = deriveBudgetBalance(input);
  if (!balance.activeAtCutoff || !balance.protectedAmount.isPositive()) return null;

  const reflected = reflectedReferences([
    ...(input.reflectedReferenceIds ?? []),
    ...(input.alreadyReflectedReferenceIds ?? []),
  ]);
  const canonicalMovements = sortBudgetMovements(input.movements, budget).filter(
    (movement) => compareBudgetDates(movement.effectiveOn, balance.asOf) <= 0,
  );
  let unreflectedSignedCents = ZERO;
  const appliedMovementReferenceIds: string[] = [];
  for (const movement of canonicalMovements) {
    if (reflected.has(movement.referenceId)) continue;
    const signed =
      movement.kind === "CONTRIBUTION"
        ? movement.amount.cents
        : -movement.amount.cents;
    unreflectedSignedCents = addPersistableCents(unreflectedSignedCents, signed);
    appliedMovementReferenceIds.push(movement.referenceId);
  }

  return Object.freeze({
    kind: "BOX_BALANCE",
    rule: "BOX_BALANCE_PROTECTED",
    referenceId: budget.referenceId,
    boxReferenceId: budget.referenceId,
    amount: balance.protectedAmount,
    appliedAmount: signedMoney(-unreflectedSignedCents),
    effectiveOn: balance.asOf,
    movementReferenceIds: balance.movementReferenceIds,
    appliedMovementReferenceIds: Object.freeze(appliedMovementReferenceIds),
  });
}

export const deriveReserveComponent = deriveBudgetReserveComponent;
export const deriveBoxReserveComponent = deriveBudgetReserveComponent;

function resolvePeriodArguments(
  first: BudgetPeriodInput | BudgetInput | Budget,
  second?: readonly (BudgetMovementInput | BudgetMovement)[],
  third?: BudgetDateInput,
  fourth?: BudgetDateInput,
): BudgetPeriodInput {
  if (
    second === undefined &&
    third === undefined &&
    fourth === undefined &&
    first !== null &&
    typeof first === "object" &&
    "budget" in first &&
    "movements" in first &&
    "from" in first &&
    "to" in first
  ) {
    return first as BudgetPeriodInput;
  }
  if (second === undefined || third === undefined || fourth === undefined) {
    throw new BudgetDomainError("INVALID_COMMAND", "from");
  }
  return {
    budget: first as BudgetInput | Budget,
    movements: second,
    from: third,
    to: fourth,
  };
}

/** Derives rollover, period movement totals and closing position for an inclusive civil interval. */
export function deriveBudgetPeriodSummary(input: BudgetPeriodInput): BudgetPeriodSummary;
export function deriveBudgetPeriodSummary(
  budget: BudgetInput | Budget,
  movements: readonly (BudgetMovementInput | BudgetMovement)[],
  from: BudgetDateInput,
  to: BudgetDateInput,
): BudgetPeriodSummary;
export function deriveBudgetPeriodSummary(
  first: BudgetPeriodInput | BudgetInput | Budget,
  second?: readonly (BudgetMovementInput | BudgetMovement)[],
  third?: BudgetDateInput,
  fourth?: BudgetDateInput,
): BudgetPeriodSummary {
  const input = resolvePeriodArguments(first, second, third, fourth);
  const budget = normalizeBudget(input.budget);
  const from = parseBudgetDate(input.from, "from");
  const to = parseBudgetDate(input.to, "to");
  if (compareBudgetDates(from, to) > 0) {
    throw new BudgetDomainError("INVALID_DATE_RANGE", "from");
  }

  let previousDay: Temporal.PlainDate;
  try {
    previousDay = from.subtract({ days: 1 });
  } catch {
    throw new BudgetDomainError("INVALID_DATE_RANGE", "from");
  }
  const openingBalance = deriveBudgetBalance(budget, input.movements, previousDay);
  const closingBalance = deriveBudgetBalance(budget, input.movements, to);
  const movements = sortBudgetMovements(input.movements, budget);
  let contributions = ZERO;
  let withdrawals = ZERO;
  const contributionReferenceIds: string[] = [];
  const withdrawalReferenceIds: string[] = [];

  for (const movement of movements) {
    if (
      compareBudgetDates(movement.effectiveOn, from) < 0 ||
      compareBudgetDates(movement.effectiveOn, to) > 0
    ) {
      continue;
    }
    if (movement.kind === "CONTRIBUTION") {
      contributions = addPersistableCents(contributions, movement.amount.cents);
      contributionReferenceIds.push(movement.referenceId);
    } else {
      withdrawals = addPersistableCents(withdrawals, movement.amount.cents);
      withdrawalReferenceIds.push(movement.referenceId);
    }
  }

  const netChange = addPersistableCents(contributions, -withdrawals);
  return Object.freeze({
    from,
    to,
    rollover: openingBalance.balance,
    openingBalance: openingBalance.balance,
    closingBalance: closingBalance.balance,
    contributions: signedMoney(contributions),
    withdrawals: signedMoney(withdrawals),
    netChange: signedMoney(netChange),
    contributionReferenceIds: Object.freeze(contributionReferenceIds),
    withdrawalReferenceIds: Object.freeze(withdrawalReferenceIds),
  });
}

export const derivePeriodBalance = deriveBudgetPeriodSummary;
export const deriveBudgetPeriod = deriveBudgetPeriodSummary;
export const deriveAccumulatedBalance = deriveBudgetPeriodSummary;

export function deriveRollover(
  budget: BudgetInput | Budget,
  movements: readonly (BudgetMovementInput | BudgetMovement)[],
  periodStart: BudgetDateInput,
): MoneyValue {
  const start = parseBudgetDate(periodStart, "from");
  let previousDay: Temporal.PlainDate;
  try {
    previousDay = start.subtract({ days: 1 });
  } catch {
    throw new BudgetDomainError("INVALID_DATE_RANGE", "from");
  }
  return deriveBudgetBalance(budget, movements, previousDay).balance;
}

export const rollover = deriveRollover;

export function rolloverCents(
  budget: BudgetInput | Budget,
  movements: readonly (BudgetMovementInput | BudgetMovement)[],
  periodStart: BudgetDateInput,
): bigint {
  return deriveRollover(budget, movements, periodStart).cents;
}

export const deriveRolloverCents = rolloverCents;

export function deriveMonthlyBudgetSummary(
  input: BudgetMonthInput,
): BudgetPeriodSummary & { readonly month: string };
export function deriveMonthlyBudgetSummary(
  budget: BudgetInput | Budget,
  movements: readonly (BudgetMovementInput | BudgetMovement)[],
  month: string | Temporal.PlainYearMonth,
): BudgetPeriodSummary & { readonly month: string };
export function deriveMonthlyBudgetSummary(
  first: BudgetMonthInput | BudgetInput | Budget,
  second?: readonly (BudgetMovementInput | BudgetMovement)[],
  third?: string | Temporal.PlainYearMonth,
): BudgetPeriodSummary & { readonly month: string } {
  const input: BudgetMonthInput =
    second === undefined && third === undefined && first !== null && typeof first === "object" && "budget" in first
      ? (first as BudgetMonthInput)
      : {
          budget: first as BudgetInput | Budget,
          movements: second ?? [],
          month: third as string | Temporal.PlainYearMonth,
        };
  const range = monthRange(input.month);
  const summary = deriveBudgetPeriodSummary(
    input.budget,
    input.movements,
    range.from,
    range.to,
  );
  return Object.freeze({ ...summary, month: `${range.from.year.toString(10).padStart(4, "0")}-${range.from.month.toString(10).padStart(2, "0")}` });
}

export const deriveBudgetMonth = deriveMonthlyBudgetSummary;
export const deriveMonthlyBalance = deriveMonthlyBudgetSummary;

function signedBalance(value: MoneyValue | bigint | string): MoneyValue {
  let cents: bigint;
  if (value instanceof Money) {
    cents = value.cents;
  } else if (typeof value === "bigint") {
    cents = value;
  } else if (typeof value === "string" && /^-?\d+$/u.test(value)) {
    try {
      cents = BigInt(value);
    } catch {
      throw new BudgetDomainError("INVALID_AMOUNT", "balanceCents");
    }
  } else {
    throw new BudgetDomainError("INVALID_AMOUNT", "balanceCents");
  }
  if (cents < MIN_PERSISTABLE_CENTS || cents > MAX_PERSISTABLE_CENTS) {
    throw new BudgetDomainError("AMOUNT_OUT_OF_RANGE", "balanceCents");
  }
  return signedMoney(cents);
}

function monthDistance(
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
): number {
  return (
    (to.year - from.year) * 12 +
    (to.month - from.month)
  );
}

function elapsedDays(from: Temporal.PlainDate, to: Temporal.PlainDate): bigint {
  const duration = from.until(to, { largestUnit: "days" });
  return BigInt(duration.days);
}

function derivePaceStatus(
  budget: Budget,
  balance: MoneyValue,
  targetDate: Temporal.PlainDate,
  targetAmount: MoneyValue,
  asOf: Temporal.PlainDate,
): BudgetPaceStatus {
  if (balance.cents >= targetAmount.cents) return "ON_TRACK";
  if (compareBudgetDates(asOf, budget.activeFrom) <= 0) {
    return balance.cents >= ZERO ? "ON_TRACK" : "BEHIND";
  }
  if (compareBudgetDates(asOf, targetDate) >= 0) return "BEHIND";

  const totalDays = elapsedDays(budget.activeFrom, targetDate);
  const elapsed = elapsedDays(budget.activeFrom, asOf);
  if (totalDays <= ZERO) return "BEHIND";
  const expected = (targetAmount.cents * elapsed) / totalDays;
  return balance.cents >= expected ? "ON_TRACK" : "BEHIND";
}

function resolveProgressArguments(
  first: BudgetProgressInput | BudgetInput | Budget,
  second?: MoneyValue | bigint | string,
  third?: BudgetDateInput,
): BudgetProgressInput {
  if (
    second === undefined &&
    third === undefined &&
    first !== null &&
    typeof first === "object" &&
    "budget" in first &&
    "asOf" in first
  ) {
    return first as BudgetProgressInput;
  }
  if (second === undefined || third === undefined) {
    throw new BudgetDomainError("INVALID_COMMAND", "asOf");
  }
  return {
    budget: first as BudgetInput | Budget,
    balance: second,
    asOf: third,
  };
}

/** Derives goal progress exclusively from the signed balance; no contribution state is stored. */
export function deriveBudgetProgress(input: BudgetProgressInput): BudgetProgress;
export function deriveBudgetProgress(
  budget: BudgetInput | Budget,
  balance: MoneyValue | bigint | string,
  asOf: BudgetDateInput,
): BudgetProgress;
export function deriveBudgetProgress(
  first: BudgetProgressInput | BudgetInput | Budget,
  second?: MoneyValue | bigint | string,
  third?: BudgetDateInput,
): BudgetProgress {
  const input = resolveProgressArguments(first, second, third);
  const budget = normalizeBudget(input.budget);
  const asOf = parseBudgetDate(input.asOf, "asOf");
  const suppliedBalance = input.balance ?? input.balanceCents;
  const balance =
    suppliedBalance === undefined
      ? deriveBudgetBalance(budget, input.movements ?? [], asOf).balance
      : signedBalance(suppliedBalance);
  const goal = budget.goal;
  if (goal === null) {
    return Object.freeze({
      targetAmount: null,
      targetDate: null,
      progress: Money.zero(),
      remaining: Money.zero(),
      progressBps: ZERO,
      remainingMonths: null,
      suggestedMonthlyAmount: null,
      status: "NOT_APPLICABLE",
      paceStatus: "NOT_APPLICABLE",
    });
  }

  const target = goal.targetAmount.cents;
  const progressCents =
    balance.cents <= ZERO ? ZERO : balance.cents >= target ? target : balance.cents;
  const remainingCents = balance.cents >= target ? ZERO : target - balance.cents;
  const progressBps = (progressCents * BASIS_POINTS) / target;
  const targetIsFuture = compareBudgetDates(goal.targetDate, asOf) > 0;
  const remainingMonths = targetIsFuture
    ? Math.max(1, monthDistance(asOf, goal.targetDate) + 1)
    : 0;
  const suggestedCents =
    remainingMonths === 0
      ? remainingCents
      : (remainingCents + BigInt(remainingMonths) - BigInt(1)) /
        BigInt(remainingMonths);
  const status = balance.cents >= target ? "ACHIEVED" : "IN_PROGRESS";
  const paceStatus = derivePaceStatus(
    budget,
    balance,
    goal.targetDate,
    goal.targetAmount,
    asOf,
  );

  return Object.freeze({
    targetAmount: goal.targetAmount,
    targetDate: goal.targetDate,
    progress: signedMoney(progressCents),
    remaining: signedMoney(remainingCents),
    progressBps,
    remainingMonths,
    suggestedMonthlyAmount: signedMoney(suggestedCents),
    status,
    paceStatus,
  });
}

export const deriveProgress = deriveBudgetProgress;
export const deriveGoalProgress = deriveBudgetProgress;
export const calculateBudgetProgress = deriveBudgetProgress;

export function serializeBudgetBalance(
  input: BudgetBalance,
): BudgetBalanceBoundary {
  return {
    boxReferenceId: input.boxReferenceId,
    asOf: serializeBudgetDate(input.asOf),
    balanceCents: input.balance.toCentsString(),
    protectedAmountCents: input.protectedAmount.toCentsString(),
    contributionCents: input.contributions.toCentsString(),
    withdrawalCents: input.withdrawals.toCentsString(),
    activeAtCutoff: input.activeAtCutoff,
    movementReferenceIds: input.movementReferenceIds,
    contributionReferenceIds: input.contributionReferenceIds,
    withdrawalReferenceIds: input.withdrawalReferenceIds,
  };
}

export const toBudgetBalanceBoundary = serializeBudgetBalance;
export const serializeBoxBalance = serializeBudgetBalance;

export function serializeBudgetPeriod(
  input: BudgetPeriodSummary,
): BudgetPeriodBoundary {
  return {
    from: serializeBudgetDate(input.from),
    to: serializeBudgetDate(input.to),
    rolloverCents: input.rollover.toCentsString(),
    openingBalanceCents: input.openingBalance.toCentsString(),
    closingBalanceCents: input.closingBalance.toCentsString(),
    contributionCents: input.contributions.toCentsString(),
    withdrawalCents: input.withdrawals.toCentsString(),
    netChangeCents: input.netChange.toCentsString(),
    contributionReferenceIds: input.contributionReferenceIds,
    withdrawalReferenceIds: input.withdrawalReferenceIds,
  };
}

export const serializeBudgetPeriodSummary = serializeBudgetPeriod;

export function serializeBudgetProgress(
  input: BudgetProgress,
): BudgetProgressBoundary {
  return {
    targetAmountCents:
      input.targetAmount === null ? null : input.targetAmount.toCentsString(),
    targetDate:
      input.targetDate === null ? null : serializeBudgetDate(input.targetDate),
    progressCents: input.progress.toCentsString(),
    remainingCents: input.remaining.toCentsString(),
    progressBps: input.progressBps.toString(10),
    remainingMonths: input.remainingMonths,
    suggestedMonthlyCents:
      input.suggestedMonthlyAmount === null
        ? null
        : input.suggestedMonthlyAmount.toCentsString(),
    status: input.status,
    paceStatus: input.paceStatus,
  };
}

export const toBudgetProgressBoundary = serializeBudgetProgress;

export function serializeBudgetReserveComponent(
  input: BudgetReserveComponent,
): BudgetReserveComponentBoundary {
  return {
    kind: input.kind,
    rule: input.rule,
    referenceId: input.referenceId,
    boxReferenceId: input.boxReferenceId,
    amountCents: input.amount.toCentsString(),
    appliedAmountCents: input.appliedAmount.toCentsString(),
    effectiveOn: serializeBudgetDate(input.effectiveOn),
    movementReferenceIds: input.movementReferenceIds,
    appliedMovementReferenceIds: input.appliedMovementReferenceIds,
  };
}

export const toBudgetReserveComponentBoundary = serializeBudgetReserveComponent;
