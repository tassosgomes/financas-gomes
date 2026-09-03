import { describe, expect, it } from "vitest";

import {
  budgetMovementSchema,
  createBudgetCommandSchema,
  parseBudgetBoundary,
  parseBudgetMovementBoundary,
  type BudgetInput,
} from "./contracts";
import {
  assertBudgetCanReceiveMovement,
  assertOpaqueReference,
  correctBudgetMovement,
  createBudget,
  createBudgetMovement,
  createBudgetTransfer,
  createContributionMovement,
  normalizeBudgetName,
  normalizeBudgetMovement,
  parseBudgetAmount,
  parseBudgetDate,
  serializeBudget,
  serializeBudgetMovement,
  sortBudgetMovements,
} from "./domain";
import {
  deriveBudgetBalance,
  deriveBudgetProgress,
  deriveBudgetReserveComponent,
  deriveBudgetPeriodSummary,
  deriveMonthlyBudgetSummary,
  deriveRollover,
  serializeBudgetBalance,
  serializeBudgetProgress,
} from "./balance";
import {
  BUDGET_DOMAIN_FIXTURE_IDS,
  budgetDomainFixtures,
  closedBudgetFixture,
  multipleMovementsFixture,
  negativeRolloverFixture,
  positiveRolloverFixture,
  sameDateMovementsFixture,
  yearBoundaryFixture,
} from "./fixtures";
import { BudgetDomainError } from "./contracts";

function expectCode(run: () => unknown, code: string): void {
  expect(run).toThrowError(BudgetDomainError);
  try {
    run();
  } catch (error) {
    expect((error as BudgetDomainError).code).toBe(code);
  }
}

function inputBudget(overrides: Partial<BudgetInput> = {}): BudgetInput {
  return {
    referenceId: "box-test",
    name: "Reserva de emergência",
    categoryId: "category-test",
    activeFrom: "2026-08-01",
    ...overrides,
  };
}

function movement(
  referenceId: string,
  kind: "CONTRIBUTION" | "WITHDRAWAL",
  amountCents: string,
  effectiveOn = "2026-08-02",
  boxReferenceId = "box-test",
) {
  return createBudgetMovement({
    referenceId,
    boxReferenceId,
    kind,
    amountCents,
    effectiveOn,
  });
}

describe("T02 serializable contracts", () => {
  it("accepts the ADR movement boundary and rejects tenant authority/raw domain values", () => {
    const serialized = {
      referenceId: "movement-1",
      boxReferenceId: "box-test",
      kind: "CONTRIBUTION" as const,
      amountCents: "10000",
      effectiveOn: "2026-08-02",
    };

    expect(budgetMovementSchema.safeParse(serialized).success).toBe(true);
    expect(parseBudgetMovementBoundary(serialized)).toEqual(serialized);
    expect(
      budgetMovementSchema.safeParse({ ...serialized, householdId: "forged" })
        .success,
    ).toBe(false);
    expect(
      budgetMovementSchema.safeParse({ ...serialized, amountCents: BigInt(100) })
        .success,
    ).toBe(false);
  });

  it("normalizes names/command IDs at the boundary and validates civil dates", () => {
    expect(normalizeBudgetName("  Reserva\u00a0de\u2003viagem  ")).toBe(
      "Reserva de viagem",
    );
    expect(createBudgetCommandSchema.parse({
      commandId: " command-1 ",
      name: "  Viagem  ",
      categoryId: "category-test",
      activeFrom: "2026-08-01",
    })).toEqual({
      commandId: "command-1",
      name: "Viagem",
      categoryId: "category-test",
      activeFrom: "2026-08-01",
    });
    expectCode(() => normalizeBudgetName("ok\nno"), "INVALID_NAME");
    expectCode(() => parseBudgetDate("2026-02-30"), "INVALID_DATE");
    expectCode(() => parseBudgetAmount("0"), "INVALID_AMOUNT");
    expectCode(() => parseBudgetAmount("-1"), "INVALID_AMOUNT");
    expectCode(() => parseBudgetAmount(1), "INVALID_AMOUNT");
    expectCode(() => assertOpaqueReference(""), "INVALID_REFERENCE");
  });

  it("serializes domain values without Money, bigint or Temporal", () => {
    const budget = createBudget(inputBudget({
      goal: { targetAmountCents: "10000", targetDate: "2026-12-31" },
    }));
    const contribution = movement("movement-1", "CONTRIBUTION", "10000");
    const balance = deriveBudgetBalance(budget, [contribution], "2026-08-02");

    expect(parseBudgetBoundary(serializeBudget(budget))).toEqual(serializeBudget(budget));
    expect(parseBudgetMovementBoundary(serializeBudgetMovement(contribution))).toEqual(
      serializeBudgetMovement(contribution),
    );
    expect(typeof balance.balance.cents).toBe("bigint");
    expect(typeof JSON.parse(JSON.stringify(serializeBudgetBalance(balance))).balanceCents).toBe(
      "string",
    );
  });
});

describe("T02 lifecycle, movement validation and deterministic identity", () => {
  it("enforces lifecycle boundaries and the movement-to-budget relationship", () => {
    const budget = createBudget(inputBudget({
      status: "CLOSED",
      closedOn: "2026-08-10",
    }));
    expectCode(
      () => normalizeBudgetMovement(movement("before", "CONTRIBUTION", "1", "2026-07-31"), budget),
      "BUDGET_NOT_ACTIVE_AT_DATE",
    );
    expectCode(
      () => normalizeBudgetMovement(movement("after", "CONTRIBUTION", "1", "2026-08-11"), budget),
      "BUDGET_CLOSED",
    );
    expect(
      normalizeBudgetMovement(
        movement("on-close", "CONTRIBUTION", "1", "2026-08-10"),
        budget,
      ).effectiveOn.toString(),
    ).toBe("2026-08-10");
    expectCode(
      () => normalizeBudgetMovement(movement("foreign", "CONTRIBUTION", "1", "2026-08-02", "other-box"), budget),
      "MOVEMENT_BUDGET_MISMATCH",
    );
    expectCode(
      () => normalizeBudgetMovement({
        referenceId: "missing-box",
        kind: "CONTRIBUTION",
        amountCents: "1",
        effectiveOn: "2026-08-02",
      }),
      "INVALID_REFERENCE",
    );
    expectCode(
      () => normalizeBudgetMovement({
        referenceId: "bad-kind",
        boxReferenceId: "box-test",
        kind: "OTHER" as never,
        amountCents: "1",
        effectiveOn: "2026-08-02",
      }),
      "INVALID_MOVEMENT_KIND",
    );
    expectCode(
      () => createBudget(inputBudget({ status: "ACTIVE", closedOn: "2026-08-10" })),
      "INVALID_DATE_RANGE",
    );
    expectCode(
      () => assertBudgetCanReceiveMovement(budget, "2026-08-02"),
      "BUDGET_CLOSED",
    );
  });

  it("rejects duplicate movement references and gives one canonical order", () => {
    const first = movement("z", "CONTRIBUTION", "100", "2026-08-15");
    const second = movement("a", "WITHDRAWAL", "50", "2026-08-15");
    expect(sortBudgetMovements([first, second]).map(({ referenceId }) => referenceId)).toEqual([
      "a",
      "z",
    ]);
    expectCode(() => sortBudgetMovements([first, first]), "DUPLICATE_REFERENCE");
  });
});

describe("T02 derived balance, cutoff, rollover and protection", () => {
  it("replays the same collection in any order with stable balance and references", () => {
    const { budget, movements, expected } = multipleMovementsFixture;
    const forward = deriveBudgetBalance(budget, movements, expected.asOf);
    const reverse = deriveBudgetBalance(budget, [...movements].reverse(), expected.asOf);

    expect(forward.balance.toCentsString()).toBe(expected.balanceCents);
    expect(forward.protectedAmount.toCentsString()).toBe(expected.protectedAmountCents);
    expect(forward.movementReferenceIds).toEqual(expected.movementReferenceIds);
    expect(serializeBudgetBalance(forward)).toEqual(serializeBudgetBalance(reverse));
  });

  it("includes the cutoff date, returns zero before activation and stops protection at closing", () => {
    const beforeClose = deriveBudgetBalance(
      closedBudgetFixture.budget,
      closedBudgetFixture.movements,
      "2026-09-09",
    );
    const atClose = deriveBudgetBalance(
      closedBudgetFixture.budget,
      closedBudgetFixture.movements,
      "2026-09-10",
    );
    const afterClose = deriveBudgetBalance(
      closedBudgetFixture.budget,
      closedBudgetFixture.movements,
      "2026-09-11",
    );
    const beforeActivation = deriveBudgetBalance(
      closedBudgetFixture.budget,
      closedBudgetFixture.movements,
      "2026-07-31",
    );

    expect(beforeClose.balance.toCentsString()).toBe("5000");
    expect(beforeClose.protectedAmount.toCentsString()).toBe("5000");
    expect(atClose.balance.toCentsString()).toBe("6000");
    expect(atClose.protectedAmount.toCentsString()).toBe("0");
    expect(afterClose.balance.toCentsString()).toBe("6000");
    expect(afterClose.protectedAmount.toCentsString()).toBe("0");
    expect(atClose.movementReferenceIds).toEqual(["closed-before", "closed-on-date"]);
    expect(beforeActivation.balance.toCentsString()).toBe("0");
    expect(beforeActivation.movementReferenceIds).toEqual([]);
  });

  it("preserves negative balances while protection is exactly zero", () => {
    const result = deriveBudgetBalance(
      negativeRolloverFixture.budget,
      negativeRolloverFixture.movements,
      negativeRolloverFixture.expected.asOf,
    );
    expect(result.balance.toCentsString()).toBe("-2000");
    expect(result.protectedAmount.toCentsString()).toBe("0");
    expect(deriveBudgetReserveComponent({
      budget: negativeRolloverFixture.budget,
      movements: negativeRolloverFixture.movements,
      asOf: negativeRolloverFixture.expected.asOf,
    })).toBeNull();
  });

  it("exposes one positive protection component and a signed reflected adjustment", () => {
    const { budget, movements } = multipleMovementsFixture;
    const component = deriveBudgetReserveComponent({
      budget,
      movements,
      asOf: "2026-08-31",
    });
    const reflectedContribution = deriveBudgetReserveComponent({
      budget,
      movements,
      asOf: "2026-08-31",
      reflectedReferenceIds: ["movement-contribution-1"],
    });

    expect(component?.kind).toBe("BOX_BALANCE");
    expect(component?.rule).toBe("BOX_BALANCE_PROTECTED");
    expect(component?.amount.toCentsString()).toBe("9500");
    expect(component?.appliedAmount.toCentsString()).toBe("-9500");
    expect(component?.movementReferenceIds).toEqual([
      "movement-contribution-1",
      "movement-contribution-2",
      "movement-withdrawal-1",
    ]);
    expect(reflectedContribution?.appliedAmount.toCentsString()).toBe("500");
    expect(reflectedContribution?.appliedMovementReferenceIds).toEqual([
      "movement-contribution-2",
      "movement-withdrawal-1",
    ]);
  });

  it("carries positive and negative rollover through month and year boundaries", () => {
    const positive = deriveBudgetPeriodSummary(
      positiveRolloverFixture.budget,
      positiveRolloverFixture.movements,
      "2026-09-01",
      "2026-09-30",
    );
    const negative = deriveBudgetPeriodSummary(
      negativeRolloverFixture.budget,
      negativeRolloverFixture.movements,
      "2026-09-01",
      "2026-09-30",
    );
    const year = deriveMonthlyBudgetSummary(
      yearBoundaryFixture.budget,
      yearBoundaryFixture.movements,
      "2026-01",
    );

    expect(positive.rollover.toCentsString()).toBe("3000");
    expect(positive.closingBalance.toCentsString()).toBe("13000");
    expect(negative.rollover.toCentsString()).toBe("-2000");
    expect(negative.closingBalance.toCentsString()).toBe("-2000");
    expect(year.month).toBe("2026-01");
    expect(year.rollover.toCentsString()).toBe("1200");
    expect(year.closingBalance.toCentsString()).toBe("1000");
    expect(deriveRollover(
      positiveRolloverFixture.budget,
      positiveRolloverFixture.movements,
      "2026-09-01",
    ).toCentsString()).toBe("3000");
  });

  it("derives contribution/spending totals and preserves same-day tie order", () => {
    const summary = deriveBudgetPeriodSummary(
      multipleMovementsFixture.budget,
      multipleMovementsFixture.movements,
      "2026-08-01",
      "2026-08-31",
    );
    const ties = deriveBudgetBalance(
      sameDateMovementsFixture.budget,
      [...sameDateMovementsFixture.movements].reverse(),
      "2026-08-15",
    );

    expect(summary.contributions.toCentsString()).toBe("12500");
    expect(summary.withdrawals.toCentsString()).toBe("3000");
    expect(summary.netChange.toCentsString()).toBe("9500");
    expect(ties.movementReferenceIds).toEqual(["tie-a", "tie-m", "tie-z"]);
    expect(ties.balance.toCentsString()).toBe("250");
  });
});

describe("T02 goals, transfer and append-only correction", () => {
  it("derives progress, deficit and ceil monthly suggestion entirely with bigint", () => {
    const budget = createBudget(inputBudget({
      goal: { targetAmountCents: "10000", targetDate: "2026-12-15" },
    }));
    const inProgress = deriveBudgetProgress(budget, "2500", "2026-09-02");
    const negative = deriveBudgetProgress(budget, "-2000", "2026-09-02");
    const achieved = deriveBudgetProgress(budget, "12000", "2026-09-02");

    expect(inProgress.progress.toCentsString()).toBe("2500");
    expect(inProgress.remaining.toCentsString()).toBe("7500");
    expect(inProgress.progressBps).toBe(BigInt(2500));
    expect(inProgress.remainingMonths).toBe(4);
    expect(inProgress.suggestedMonthlyAmount?.toCentsString()).toBe("1875");
    expect(negative.progress.toCentsString()).toBe("0");
    expect(negative.remaining.toCentsString()).toBe("12000");
    expect(negative.suggestedMonthlyAmount?.toCentsString()).toBe("3000");
    expect(achieved.status).toBe("ACHIEVED");
    expect(achieved.remaining.toCentsString()).toBe("0");
    expect(serializeBudgetProgress(inProgress).progressBps).toBe("2500");
  });

  it("returns an atomic transfer pair with opposite movement signs", () => {
    const source = createBudget(inputBudget({ referenceId: "source" }));
    const destination = createBudget(inputBudget({ referenceId: "destination" }));
    const transfer = createBudgetTransfer({
      sourceBudget: source,
      destinationBudget: destination,
      amountCents: "30000",
      effectiveOn: "2026-08-05",
      withdrawalReferenceId: "transfer-withdrawal",
      contributionReferenceId: "transfer-contribution",
      transferReferenceId: "transfer-1",
    });

    expect(transfer.movements).toHaveLength(2);
    expect(transfer.source.kind).toBe("WITHDRAWAL");
    expect(transfer.destination.kind).toBe("CONTRIBUTION");
    expect(transfer.source.transferReferenceId).toBe("transfer-1");
    expect(transfer.destination.transferReferenceId).toBe("transfer-1");
    expect(deriveBudgetBalance(source, [transfer.source], "2026-08-05").balance.toCentsString()).toBe(
      "-30000",
    );
    expect(deriveBudgetBalance(destination, [transfer.destination], "2026-08-05").balance.toCentsString()).toBe(
      "30000",
    );
    expectCode(
      () => createBudgetTransfer({
        sourceBudget: source,
        destinationBudget: source,
        amountCents: "1",
        effectiveOn: "2026-08-05",
        withdrawalReferenceId: "w",
        contributionReferenceId: "c",
        transferReferenceId: "t",
      }),
      "TRANSFER_SAME_BUDGET",
    );
  });

  it("corrects by compensation, optionally appending a replacement, without editing the original", () => {
    const budget = createBudget(inputBudget());
    const original = createContributionMovement({
      referenceId: "original-contribution",
      boxReferenceId: "box-test",
      amountCents: "1000",
      effectiveOn: "2026-08-02",
    });
    const correction = correctBudgetMovement({
      budget,
      originalMovement: original,
      correctionReferenceId: "compensation-withdrawal",
      replacement: {
        referenceId: "replacement-contribution",
        boxReferenceId: "box-test",
        kind: "CONTRIBUTION",
        amountCents: "1500",
        effectiveOn: "2026-08-03",
      },
      existingMovements: [original],
    });

    expect(original.amount.toCentsString()).toBe("1000");
    expect(correction.compensation.kind).toBe("WITHDRAWAL");
    expect(correction.compensation.correctsReferenceId).toBe("original-contribution");
    expect(correction.replacement?.amount.toCentsString()).toBe("1500");
    expect(correction.movements.map(({ referenceId }) => referenceId)).toEqual([
      "compensation-withdrawal",
      "original-contribution",
      "replacement-contribution",
    ]);
    expectCode(
      () => correctBudgetMovement({
        budget,
        originalMovement: original,
        correctionReferenceId: "another-correction",
        existingMovements: [original, correction.compensation],
      }),
      "MOVEMENT_ALREADY_CORRECTED",
    );
  });
});

describe("T02 reusable fixtures", () => {
  it("publishes the complete fixture matrix for downstream T05/T07/T08/T13", () => {
    expect(BUDGET_DOMAIN_FIXTURE_IDS).toHaveLength(6);
    expect(Object.keys(budgetDomainFixtures)).toEqual(
      expect.arrayContaining([...BUDGET_DOMAIN_FIXTURE_IDS]),
    );
    expect(multipleMovementsFixture.movements).toHaveLength(3);
    expect(closedBudgetFixture.budget.status).toBe("CLOSED");
    expect(negativeRolloverFixture.expected.protectedAmountCents).toBe("0");
    expect(positiveRolloverFixture.expected.rolloverCents).toBe("3000");
    expect(yearBoundaryFixture.expected.rolloverCents).toBe("1200");
  });
});
