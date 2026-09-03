import { describe, expect, it } from "vitest";

import manifest from "../../../tests/fixtures/s09-caixinhas/manifest.json";
import {
  ALLOCATION_FIXTURE_BUDGETS,
  ALLOCATION_FIXTURE_CATEGORIES,
  ALLOCATION_FIXTURE_EXPECTED_DISTRIBUTION,
  ALLOCATION_FIXTURE_FINANCIAL_SOURCES,
  ALLOCATION_FIXTURE_INCOME,
  ALLOCATION_FIXTURE_RULES,
} from "./allocation-rules.fixtures";
import {
  distributeRealizedIncome,
  resolveBudgetFinancialEffects,
} from "./allocation-rules";
import {
  deriveBudgetBalance,
  deriveBudgetPeriodSummary,
  deriveBudgetProgress,
  deriveBudgetReserveComponent,
  serializeBudgetBalance,
  serializeBudgetPeriod,
  serializeBudgetProgress,
  serializeBudgetReserveComponent,
} from "./balance";
import {
  budgetDomainFixtures,
  BUDGET_DOMAIN_FIXTURE_IDS,
} from "./fixtures";
import {
  createBudget,
  parseBudgetAmount,
  parseBudgetDate,
} from "./domain";

function expectDomainError(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("T13 S09 domain and allocation matrix", () => {
  it("publishes a synthetic manifest while keeping downstream gates explicit", () => {
    expect(manifest.fixtureVersion).toBe("s09-caixinhas-t13-v1");
    expect(manifest.dateType).toBe("Temporal.PlainDate");
    expect(manifest.moneyType).toBe("bigint-cents");
    expect(manifest.syntheticData).toBe(true);
    expect(manifest.fixtures.map(({ id }) => id)).toEqual([
      "domain-matrix",
      "allocation-matrix",
      "movement-commands",
      "postgres-boundaries",
      "safe-observability",
    ]);
    expect(manifest.openGates).toEqual(["T14 E2E", "T15 release"]);
    expect(manifest.fixtures[0]?.cases).toEqual([...BUDGET_DOMAIN_FIXTURE_IDS]);
  });

  it("replays every T02 fixture deterministically and reconciles signed cents", () => {
    for (const fixtureId of BUDGET_DOMAIN_FIXTURE_IDS) {
      const fixture = budgetDomainFixtures[fixtureId];
      const expected = fixture.expected;
      const forward = deriveBudgetBalance(
        fixture.budget,
        fixture.movements,
        expected.asOf,
      );
      const reversed = deriveBudgetBalance(
        fixture.budget,
        [...fixture.movements].reverse(),
        expected.asOf,
      );

      expect(forward.balance.cents.toString()).toBe(expected.balanceCents);
      expect(forward.protectedAmount.cents.toString()).toBe(
        expected.protectedAmountCents,
      );
      expect([...forward.movementReferenceIds]).toEqual(
        expected.movementReferenceIds,
      );
      expect(reversed.balance.cents).toBe(forward.balance.cents);
      expect([...reversed.movementReferenceIds]).toEqual(
        [...forward.movementReferenceIds],
      );
    }
  });

  it("keeps rollover, closure and goal progress serializable without derived persistence", () => {
    const positive = budgetDomainFixtures["positive-rollover"];
    const period = deriveBudgetPeriodSummary(
      positive.budget,
      positive.movements,
      "2026-09-01",
      "2026-09-30",
    );
    expect(period.rollover.cents).toBe(BigInt("3000"));
    expect(period.closingBalance.cents).toBe(BigInt("13000"));
    expect(serializeBudgetPeriod(period)).toMatchObject({
      rolloverCents: "3000",
      closingBalanceCents: "13000",
    });

    const closed = budgetDomainFixtures["closed-on-boundary"];
    const component = deriveBudgetReserveComponent({
      budget: closed.budget,
      movements: closed.movements,
      asOf: "2026-09-10",
    });
    expect(component).toBeNull();

    const goalBudget = createBudget({
      referenceId: "t13-goal",
      name: "T13 goal",
      categoryId: "category-expense-fixture",
      activeFrom: "2026-08-01",
      goal: { targetAmountCents: "10000", targetDate: "2026-10-31" },
    });
    const progress = deriveBudgetProgress({
      budget: goalBudget,
      balanceCents: "3000",
      asOf: "2026-08-15",
    });
    expect(serializeBudgetProgress(progress)).toMatchObject({
      targetAmountCents: "10000",
      progressCents: "3000",
      remainingCents: "7000",
      progressBps: "3000",
      suggestedMonthlyCents: "2334",
    });

    const balance = deriveBudgetBalance(
      positive.budget,
      positive.movements,
      "2026-09-30",
    );
    const balanceBoundary = serializeBudgetBalance(balance);
    expect(balanceBoundary.balanceCents).toBe("13000");
    expect(JSON.stringify(balanceBoundary)).not.toContain("BigInt");
    expect(balanceBoundary).not.toHaveProperty("balance");
    expect(balanceBoundary).not.toHaveProperty("snapshot");

    const positiveComponent = deriveBudgetReserveComponent({
      budget: positive.budget,
      movements: positive.movements,
      asOf: "2026-09-30",
    });
    expect(positiveComponent).not.toBeNull();
    expect(
      serializeBudgetReserveComponent(positiveComponent!),
    ).toMatchObject({
      amountCents: "13000",
      appliedAmountCents: "-13000",
    });
  });

  it("rejects native numeric money and timezone-bearing dates at the pure boundary", () => {
    expectDomainError(() => parseBudgetAmount(1.25), "INVALID_AMOUNT");
    expectDomainError(() => parseBudgetAmount(100), "INVALID_AMOUNT");
    expectDomainError(
      () => parseBudgetDate("2026-09-01T00:00:00-03:00"),
      "INVALID_DATE",
    );
  });

  it("distributes realized income exactly and makes repeated materialization a no-op", () => {
    const distribution = distributeRealizedIncome({
      ...ALLOCATION_FIXTURE_INCOME,
      rules: ALLOCATION_FIXTURE_RULES,
    });
    const materializable = distribution.contributions.filter(
      ({ materializable }) => materializable,
    );
    expect(materializable.map(({ amountCents }) => amountCents)).toEqual(
      expect.arrayContaining([
        ...ALLOCATION_FIXTURE_EXPECTED_DISTRIBUTION.amounts,
      ]),
    );
    expect(distribution.distributedAmountCents).toBe(
      ALLOCATION_FIXTURE_EXPECTED_DISTRIBUTION.incomeCents,
    );
    expect(
      materializable.reduce(
        (total, contribution) => total + contribution.amountCents,
        BigInt(0),
      ),
    ).toBe(ALLOCATION_FIXTURE_EXPECTED_DISTRIBUTION.incomeCents);

    const replay = distributeRealizedIncome({
      ...ALLOCATION_FIXTURE_INCOME,
      rules: ALLOCATION_FIXTURE_RULES,
      alreadyReflectedReferenceIds: [ALLOCATION_FIXTURE_INCOME.referenceId],
    });
    expect(replay.status).toBe("ALREADY_RECONCILED");
    expect(replay.contributions).toEqual([]);
  });

  it("normalizes the economic purchase once and applies refund by effective date", () => {
    const effects = resolveBudgetFinancialEffects({
      sources: ALLOCATION_FIXTURE_FINANCIAL_SOURCES,
      budgets: ALLOCATION_FIXTURE_BUDGETS,
      categories: ALLOCATION_FIXTURE_CATEGORIES,
    });
    expect(effects.effects).toHaveLength(2);
    expect(effects.effects.map(({ sourceKind }) => sourceKind)).toEqual([
      "EXPENSE",
      "REFUND",
    ]);
    expect(effects.grossExpenseCents).toBe(BigInt("600000"));
    expect(effects.refundsCents).toBe(BigInt("100000"));
    expect(effects.netExpenseCents).toBe(BigInt("500000"));
    expect(effects.ignored).toHaveLength(3);
    expect(effects.ignored.every(({ reason }) => reason === "NON_CANONICAL_SOURCE")).toBe(
      true,
    );
  });
});
