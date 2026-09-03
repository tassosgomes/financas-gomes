import { describe, expect, it } from "vitest";

import {
  ALLOCATION_FIXTURE_EXPECTED_DISTRIBUTION,
  ALLOCATION_FIXTURE_INCOME,
  ALLOCATION_FIXTURE_RULES,
} from "./allocation-rules.fixtures";
import {
  distributeRealizedIncome,
} from "./allocation-rules";
import {
  createBudget,
  createBudgetTransfer,
  createContributionMovement,
  createWithdrawalMovement,
  correctBudgetMovement,
} from "./domain";
import {
  BUDGET_MOVEMENT_FIXTURE,
  BUDGET_MOVEMENT_FIXTURE_IDS,
  budgetMovementFixtures,
} from "./movement-fixtures";
import {
  parseCorrectMovementCommand,
  parseDistributeRealizedIncomeCommand,
  parseRegisterContributionCommand,
  parseRegisterWithdrawalCommand,
  parseTransferBetweenBudgetsCommand,
} from "./movements";

function expectDomainError(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

const sourceBudget = createBudget({
  referenceId: "box-movement-a",
  name: "Movimentos A",
  categoryId: "category-movement-a",
  activeFrom: "2026-08-01",
});
const destinationBudget = createBudget({
  referenceId: "box-movement-b",
  name: "Movimentos B",
  categoryId: "category-movement-b",
  activeFrom: "2026-08-01",
});

describe("T07 movement command boundary", () => {
  it("publishes serializable fixture commands without tenant authority", () => {
    expect(BUDGET_MOVEMENT_FIXTURE_IDS).toEqual(["basic-lifecycle"]);
    expect(budgetMovementFixtures["basic-lifecycle"]).toBe(BUDGET_MOVEMENT_FIXTURE);
    expect(parseRegisterContributionCommand(BUDGET_MOVEMENT_FIXTURE.contribution)).toEqual(
      BUDGET_MOVEMENT_FIXTURE.contribution,
    );
    expect(BUDGET_MOVEMENT_FIXTURE.contribution).not.toHaveProperty("householdId");
    expect(BUDGET_MOVEMENT_FIXTURE.contribution).not.toHaveProperty("balanceCents");
  });

  it("rejects non-positive/overflow money, timezone dates and extra browser fields", () => {
    expectDomainError(
      () => parseRegisterContributionCommand({
        ...BUDGET_MOVEMENT_FIXTURE.contribution,
        amountCents: "0",
      }),
      "INVALID_AMOUNT",
    );
    expectDomainError(
      () => parseRegisterWithdrawalCommand({
        ...BUDGET_MOVEMENT_FIXTURE.withdrawal,
        amountCents: "-1",
      }),
      "INVALID_AMOUNT",
    );
    expectDomainError(
      () => parseRegisterContributionCommand({
        ...BUDGET_MOVEMENT_FIXTURE.contribution,
        amountCents: "9223372036854775808",
      }),
      "INVALID_AMOUNT",
    );
    expectDomainError(
      () => parseRegisterContributionCommand({
        ...BUDGET_MOVEMENT_FIXTURE.contribution,
        effectiveOn: "2026-09-01T00:00:00-03:00",
      }),
      "INVALID_DATE",
    );
    expectDomainError(
      () => parseRegisterContributionCommand({
        ...BUDGET_MOVEMENT_FIXTURE.contribution,
        householdId: "forged-household",
      }),
      "INVALID_COMMAND",
    );
  });

  it("maps transfer/correction semantic collisions to stable public errors", () => {
    expectDomainError(
      () => parseTransferBetweenBudgetsCommand({
        ...BUDGET_MOVEMENT_FIXTURE.transfer,
        destinationBudgetReferenceId: BUDGET_MOVEMENT_FIXTURE.transfer.sourceBudgetReferenceId,
      }),
      "TRANSFER_SAME_BUDGET",
    );
    expectDomainError(
      () => parseTransferBetweenBudgetsCommand({
        ...BUDGET_MOVEMENT_FIXTURE.transfer,
        contributionReferenceId: BUDGET_MOVEMENT_FIXTURE.transfer.withdrawalReferenceId,
      }),
      "DUPLICATE_REFERENCE",
    );
    expectDomainError(
      () => parseCorrectMovementCommand({
        ...BUDGET_MOVEMENT_FIXTURE.correction,
        correctionReferenceId: BUDGET_MOVEMENT_FIXTURE.correction.correctsReferenceId,
      }),
      "DUPLICATE_REFERENCE",
    );
  });

  it("accepts the minimal transfer/correction commands and lets the server derive refs", () => {
    const transfer = parseTransferBetweenBudgetsCommand({
      commandId: "t07-derived-transfer",
      sourceBudgetReferenceId: "box-movement-a",
      destinationBudgetReferenceId: "box-movement-b",
      amountCents: "1",
      effectiveOn: "2026-09-01",
    });
    expect(transfer.withdrawalReferenceId).toBeUndefined();
    expect(transfer.contributionReferenceId).toBeUndefined();
    const correction = parseCorrectMovementCommand({
      commandId: "t07-derived-correction",
      budgetReferenceId: "box-movement-a",
      correctsReferenceId: "t07-original",
    });
    expect(correction.correctionReferenceId).toBeUndefined();
  });

  it("parses correction and distribution commands using only opaque references", () => {
    expect(parseCorrectMovementCommand(BUDGET_MOVEMENT_FIXTURE.correction)).toEqual(
      BUDGET_MOVEMENT_FIXTURE.correction,
    );
    expect(
      parseDistributeRealizedIncomeCommand(BUDGET_MOVEMENT_FIXTURE.distribution),
    ).toEqual({
      commandId: BUDGET_MOVEMENT_FIXTURE.distribution.commandId,
      financialEventId: BUDGET_MOVEMENT_FIXTURE.distribution.financialEventId,
      incomeReferenceId: BUDGET_MOVEMENT_FIXTURE.distribution.financialEventId,
    });
  });
});

describe("T07 append-only movement rules", () => {
  it("derives multiple signed movements and permits a negative balance", () => {
    const movements = [
      createContributionMovement({
        referenceId: "t07-contribution-reference",
        boxReferenceId: sourceBudget.referenceId,
        amountCents: "10000",
        effectiveOn: "2026-09-01",
      }),
      createWithdrawalMovement({
        referenceId: "t07-withdrawal-reference",
        boxReferenceId: sourceBudget.referenceId,
        amountCents: "3000",
        effectiveOn: "2026-09-02",
      }),
      createWithdrawalMovement({
        referenceId: "t07-negative-withdrawal",
        boxReferenceId: sourceBudget.referenceId,
        amountCents: "10000",
        effectiveOn: "2026-09-03",
      }),
    ];
    const balance = movements.reduce(
      (total, movement) =>
        total +
        (movement.kind === "CONTRIBUTION"
          ? movement.amount.cents
          : -movement.amount.cents),
      BigInt(0),
    );
    expect(balance).toBe(BigInt("-3000"));
    expect(movements.every(({ amount }) => amount.cents > BigInt(0))).toBe(true);
  });

  it("creates one transfer pair with no bank/expense effect", () => {
    const transfer = createBudgetTransfer({
      sourceBudget,
      destinationBudget,
      ...BUDGET_MOVEMENT_FIXTURE.transfer,
    });
    expect(transfer.movements).toHaveLength(2);
    expect(transfer.source).toMatchObject({
      kind: "WITHDRAWAL",
      amount: { cents: BigInt("2500") },
      transferReferenceId: "t07-transfer-reference",
    });
    expect(transfer.destination).toMatchObject({
      kind: "CONTRIBUTION",
      amount: { cents: BigInt("2500") },
      transferReferenceId: "t07-transfer-reference",
    });
    expect(transfer.source.referenceId).not.toBe(transfer.destination.referenceId);
    expect(transfer.source.referenceId).toBe("t07-transfer-withdrawal");
    expect(transfer.destination.referenceId).toBe("t07-transfer-contribution");
  });

  it("compensates a published movement without editing its identity", () => {
    const original = createContributionMovement({
      referenceId: "t07-original",
      boxReferenceId: sourceBudget.referenceId,
      amountCents: "1000",
      effectiveOn: "2026-09-01",
    });
    const correction = correctBudgetMovement({
      budget: sourceBudget,
      originalMovement: original,
      correctionReferenceId: "t07-compensation",
      effectiveOn: "2026-09-04",
      existingMovements: [original],
    });
    expect(original.amount.cents).toBe(BigInt("1000"));
    expect(correction.compensation).toMatchObject({
      referenceId: "t07-compensation",
      kind: "WITHDRAWAL",
      correctsReferenceId: "t07-original",
      amount: { cents: BigInt("1000") },
    });
    expect(correction.movements.map(({ referenceId }) => referenceId)).toEqual([
      "t07-original",
      "t07-compensation",
    ]);
    expectDomainError(
      () =>
        correctBudgetMovement({
          budget: sourceBudget,
          originalMovement: original,
          correctionReferenceId: "t07-second-correction",
          existingMovements: [original, correction.compensation],
        }),
      "MOVEMENT_ALREADY_CORRECTED",
    );
  });

  it("materializes only POSTED income with deterministic remainder and replay refs", () => {
    const first = distributeRealizedIncome({
      ...ALLOCATION_FIXTURE_INCOME,
      rules: ALLOCATION_FIXTURE_RULES,
    });
    expect(first.status).toBe("DISTRIBUTED");
    expect(first.distributedAmountCents).toBe(
      ALLOCATION_FIXTURE_EXPECTED_DISTRIBUTION.incomeCents,
    );
    expect(
      first.contributions.reduce(
        (total, contribution) => total + contribution.amountCents,
        BigInt(0),
      ),
    ).toBe(ALLOCATION_FIXTURE_EXPECTED_DISTRIBUTION.incomeCents);
    expect(first.contributions.map(({ amountCents }) => amountCents)).toEqual(
      expect.arrayContaining([...ALLOCATION_FIXTURE_EXPECTED_DISTRIBUTION.amounts]),
    );
    expect(first.contributions.every(({ sourceReferenceId, incomeReferenceId }) =>
      sourceReferenceId === ALLOCATION_FIXTURE_INCOME.referenceId &&
      incomeReferenceId === ALLOCATION_FIXTURE_INCOME.referenceId,
    )).toBe(true);

    const replay = distributeRealizedIncome({
      ...ALLOCATION_FIXTURE_INCOME,
      rules: ALLOCATION_FIXTURE_RULES,
      existingContributions: first.contributions.map(({ referenceId, amountCents }) => ({
        referenceId,
        amountCents,
      })),
    });
    expect(replay.status).toBe("ALREADY_RECONCILED");
    expect(replay.contributions).toEqual([]);

    const planned = distributeRealizedIncome({
      ...ALLOCATION_FIXTURE_INCOME,
      status: "EXPECTED",
      rules: ALLOCATION_FIXTURE_RULES,
    });
    expect(planned.status).toBe("NOT_REALIZED");
    expect(planned.contributions).toEqual([]);
  });
});
