import {
  createBudget,
  createContributionMovement,
  createWithdrawalMovement,
} from "./domain";
import type {
  Budget,
  BudgetInput,
  BudgetMovement,
  BudgetPeriodSummary,
} from "./contracts";

export interface BudgetDomainFixtureExpectation {
  readonly asOf: string;
  readonly balanceCents: string;
  readonly protectedAmountCents: string;
  readonly movementReferenceIds: readonly string[];
  readonly rolloverCents?: string;
  readonly closingBalanceCents?: string;
}

export interface BudgetDomainFixture {
  readonly id: string;
  readonly budget: Budget;
  readonly movements: readonly BudgetMovement[];
  readonly expected: BudgetDomainFixtureExpectation;
  readonly period?: BudgetPeriodSummary;
}

const CATEGORY_ID = "category-expense-fixture";

function budget(referenceId: string, values: Partial<BudgetInput> = {}): Budget {
  return createBudget({
    referenceId,
    name: `Fixture ${referenceId}`,
    categoryId: CATEGORY_ID,
    activeFrom: "2026-08-01",
    ...values,
  });
}

function contribution(
  referenceId: string,
  boxReferenceId: string,
  amountCents: string,
  effectiveOn: string,
): BudgetMovement {
  return createContributionMovement({
    referenceId,
    boxReferenceId,
    amountCents,
    effectiveOn,
  });
}

function withdrawal(
  referenceId: string,
  boxReferenceId: string,
  amountCents: string,
  effectiveOn: string,
): BudgetMovement {
  return createWithdrawalMovement({
    referenceId,
    boxReferenceId,
    amountCents,
    effectiveOn,
  });
}

const multipleMovementsBudget = budget("box-multiple");
export const multipleMovementsFixture: BudgetDomainFixture = Object.freeze({
  id: "multiple-movements",
  budget: multipleMovementsBudget,
  movements: Object.freeze([
    contribution("movement-contribution-1", "box-multiple", "10000", "2026-08-02"),
    contribution("movement-contribution-2", "box-multiple", "2500", "2026-08-03"),
    withdrawal("movement-withdrawal-1", "box-multiple", "3000", "2026-08-04"),
  ]),
  expected: {
    asOf: "2026-08-31",
    balanceCents: "9500",
    protectedAmountCents: "9500",
    movementReferenceIds: [
      "movement-contribution-1",
      "movement-contribution-2",
      "movement-withdrawal-1",
    ],
  },
});

const positiveRolloverBudget = budget("box-rollover-positive");
export const positiveRolloverFixture: BudgetDomainFixture = Object.freeze({
  id: "positive-rollover",
  budget: positiveRolloverBudget,
  movements: Object.freeze([
    contribution("rollover-august-contribution", "box-rollover-positive", "10000", "2026-08-10"),
    withdrawal("rollover-august-spend", "box-rollover-positive", "7000", "2026-08-20"),
    contribution("rollover-september-contribution", "box-rollover-positive", "10000", "2026-09-10"),
  ]),
  expected: {
    asOf: "2026-09-30",
    balanceCents: "13000",
    protectedAmountCents: "13000",
    movementReferenceIds: [
      "rollover-august-contribution",
      "rollover-august-spend",
      "rollover-september-contribution",
    ],
    rolloverCents: "3000",
    closingBalanceCents: "13000",
  },
});

const negativeRolloverBudget = budget("box-rollover-negative");
export const negativeRolloverFixture: BudgetDomainFixture = Object.freeze({
  id: "negative-rollover",
  budget: negativeRolloverBudget,
  movements: Object.freeze([
    withdrawal("negative-august-spend", "box-rollover-negative", "2000", "2026-08-20"),
  ]),
  expected: {
    asOf: "2026-09-30",
    balanceCents: "-2000",
    protectedAmountCents: "0",
    movementReferenceIds: ["negative-august-spend"],
    rolloverCents: "-2000",
    closingBalanceCents: "-2000",
  },
});

const closedBudget = budget("box-closed", {
  status: "CLOSED",
  closedOn: "2026-09-10",
});
export const closedBudgetFixture: BudgetDomainFixture = Object.freeze({
  id: "closed-on-boundary",
  budget: closedBudget,
  movements: Object.freeze([
    contribution("closed-before", "box-closed", "5000", "2026-09-09"),
    contribution("closed-on-date", "box-closed", "1000", "2026-09-10"),
  ]),
  expected: {
    asOf: "2026-09-10",
    balanceCents: "6000",
    protectedAmountCents: "0",
    movementReferenceIds: ["closed-before", "closed-on-date"],
  },
});

const yearBoundaryBudget = budget("box-year-boundary", {
  activeFrom: "2025-12-01",
});
export const yearBoundaryFixture: BudgetDomainFixture = Object.freeze({
  id: "december-to-january",
  budget: yearBoundaryBudget,
  movements: Object.freeze([
    contribution("year-december", "box-year-boundary", "1200", "2025-12-31"),
    withdrawal("year-january", "box-year-boundary", "200", "2026-01-01"),
  ]),
  expected: {
    asOf: "2026-01-31",
    balanceCents: "1000",
    protectedAmountCents: "1000",
    movementReferenceIds: ["year-december", "year-january"],
    rolloverCents: "1200",
    closingBalanceCents: "1000",
  },
});

const sameDateBudget = budget("box-same-date");
export const sameDateMovementsFixture: BudgetDomainFixture = Object.freeze({
  id: "same-date-tie-break",
  budget: sameDateBudget,
  movements: Object.freeze([
    contribution("tie-z", "box-same-date", "100", "2026-08-15"),
    contribution("tie-a", "box-same-date", "200", "2026-08-15"),
    withdrawal("tie-m", "box-same-date", "50", "2026-08-15"),
  ]),
  expected: {
    asOf: "2026-08-15",
    balanceCents: "250",
    protectedAmountCents: "250",
    movementReferenceIds: ["tie-a", "tie-m", "tie-z"],
  },
});

export const BUDGET_DOMAIN_FIXTURE_IDS = [
  "multiple-movements",
  "positive-rollover",
  "negative-rollover",
  "closed-on-boundary",
  "december-to-january",
  "same-date-tie-break",
] as const;

export type BudgetDomainFixtureId = (typeof BUDGET_DOMAIN_FIXTURE_IDS)[number];

export const budgetDomainFixtures: Readonly<
  Record<BudgetDomainFixtureId, BudgetDomainFixture>
> = Object.freeze({
  "multiple-movements": multipleMovementsFixture,
  "positive-rollover": positiveRolloverFixture,
  "negative-rollover": negativeRolloverFixture,
  "closed-on-boundary": closedBudgetFixture,
  "december-to-january": yearBoundaryFixture,
  "same-date-tie-break": sameDateMovementsFixture,
});

export const budgetFixtures = budgetDomainFixtures;
export const S09_BUDGET_FIXTURES = budgetDomainFixtures;
