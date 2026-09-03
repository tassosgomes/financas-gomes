import type {
  BudgetCorrectionBoundary,
  BudgetDistributionBoundary,
  BudgetMovementBoundary,
  BudgetResult,
  BudgetTransferBoundary,
  CorrectMovementCommand,
  RegisterContributionCommand,
  RegisterWithdrawalCommand,
  TransferBetweenBudgetsCommand,
} from "./contracts";

/**
 * Serializable command matrix shared by T07 and downstream test/provider
 * slices.  It intentionally contains no household/user authority and keeps
 * all monetary values as decimal cent strings.
 */
export interface BudgetMovementFixtureSet {
  readonly contribution: RegisterContributionCommand;
  readonly withdrawal: RegisterWithdrawalCommand;
  readonly transfer: TransferBetweenBudgetsCommand;
  readonly correction: CorrectMovementCommand;
  readonly distribution: {
    readonly commandId: string;
    readonly financialEventId: string;
  };
  readonly expected: {
    readonly balanceAfterContributionAndWithdrawalCents: string;
    readonly transferAmountCents: string;
    readonly contributionReferenceId: string;
    readonly withdrawalReferenceId: string;
    readonly transferReferenceId: string;
  };
}

export const BUDGET_MOVEMENT_FIXTURE: BudgetMovementFixtureSet = Object.freeze({
  contribution: Object.freeze({
    commandId: "t07-contribution-1",
    budgetReferenceId: "box-movement-a",
    amountCents: "10000",
    effectiveOn: "2026-09-01",
    referenceId: "t07-contribution-reference",
  }),
  withdrawal: Object.freeze({
    commandId: "t07-withdrawal-1",
    budgetReferenceId: "box-movement-a",
    amountCents: "3000",
    effectiveOn: "2026-09-02",
    referenceId: "t07-withdrawal-reference",
  }),
  transfer: Object.freeze({
    commandId: "t07-transfer-1",
    sourceBudgetReferenceId: "box-movement-a",
    destinationBudgetReferenceId: "box-movement-b",
    amountCents: "2500",
    effectiveOn: "2026-09-03",
    withdrawalReferenceId: "t07-transfer-withdrawal",
    contributionReferenceId: "t07-transfer-contribution",
    transferReferenceId: "t07-transfer-reference",
  }),
  correction: Object.freeze({
    commandId: "t07-correction-1",
    budgetReferenceId: "box-movement-a",
    correctsReferenceId: "t07-contribution-reference",
    correctionReferenceId: "t07-correction-reference",
    effectiveOn: "2026-09-04",
  }),
  distribution: Object.freeze({
    commandId: "t07-distribution-1",
    financialEventId: "00000000-0000-7000-8000-000000070401",
  }),
  expected: Object.freeze({
    balanceAfterContributionAndWithdrawalCents: "7000",
    transferAmountCents: "2500",
    contributionReferenceId: "t07-contribution-reference",
    withdrawalReferenceId: "t07-withdrawal-reference",
    transferReferenceId: "t07-transfer-reference",
  }),
});

export const BUDGET_MOVEMENT_FIXTURE_IDS = ["basic-lifecycle"] as const;
export type BudgetMovementFixtureId = (typeof BUDGET_MOVEMENT_FIXTURE_IDS)[number];

export const budgetMovementFixtures: Readonly<
  Record<BudgetMovementFixtureId, BudgetMovementFixtureSet>
> = Object.freeze({
  "basic-lifecycle": BUDGET_MOVEMENT_FIXTURE,
});

/** Compatibility aliases for T08/T13/T14 fixture discovery. */
export const MOVEMENT_FIXTURES = budgetMovementFixtures;
export const S09_MOVEMENT_FIXTURES = budgetMovementFixtures;

export type BudgetMovementFixtureResult =
  | BudgetResult<BudgetMovementBoundary>
  | BudgetResult<BudgetTransferBoundary>
  | BudgetResult<BudgetCorrectionBoundary>
  | BudgetResult<BudgetDistributionBoundary>;
