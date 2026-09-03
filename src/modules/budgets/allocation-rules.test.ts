import { describe, expect, it } from "vitest";

import {
  ALLOCATION_FIXTURE_BUDGETS,
  ALLOCATION_FIXTURE_CATEGORIES,
  ALLOCATION_FIXTURE_FINANCIAL_SOURCES,
  ALLOCATION_FIXTURE_RULES,
  ALLOCATION_FIXTURE_INCOME,
  ALLOCATION_FIXTURE_GOAL,
} from "./allocation-rules.fixtures";
import {
  canonicalizeAllocationRules,
  deriveBudgetGoalSuggestion,
  deriveBudgetRollover,
  distributeRealizedIncome,
  normalizeAllocationBudget,
  resolveBudgetForExpense,
  resolveBudgetFinancialEffects,
  resolveBudgetTemporalState,
  resolveEffectiveAllocationRule,
  resolveEffectiveAllocationRules,
  type AllocationRuleInput,
} from "./allocation-rules";

const FOUR_WEIGHT_RULES: readonly AllocationRuleInput[] = Object.freeze([
  {
    ruleReferenceId: "rule-a",
    boxReferenceId: "box-a",
    amountCents: "50",
    effectiveFrom: "2026-01-01",
  },
  {
    ruleReferenceId: "rule-b",
    boxReferenceId: "box-b",
    amountCents: "20",
    effectiveFrom: "2026-01-01",
  },
  {
    ruleReferenceId: "rule-c",
    boxReferenceId: "box-c",
    amountCents: "20",
    effectiveFrom: "2026-01-01",
  },
  {
    ruleReferenceId: "rule-d",
    boxReferenceId: "box-d",
    amountCents: "10",
    effectiveFrom: "2026-01-01",
  },
]);

function expectBudgetError(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("T04 allocation and temporal policy", () => {
  it("resolves the rule version at the economic date and keeps adjacent history", () => {
    const old = resolveEffectiveAllocationRule(
      ALLOCATION_FIXTURE_RULES,
      "box-general",
      "2026-06-30",
    );
    const current = resolveEffectiveAllocationRule(
      ALLOCATION_FIXTURE_RULES,
      "box-general",
      "2026-07-01",
    );

    expect(old?.referenceId).toBe("rule-general-old");
    expect(current?.referenceId).toBe("rule-general-current");
    expect(
      resolveEffectiveAllocationRule(
        ALLOCATION_FIXTURE_RULES,
        "box-general",
        "2025-12-31",
      ),
    ).toBeNull();
    expect(
      resolveEffectiveAllocationRules(ALLOCATION_FIXTURE_RULES, "2026-08-31").map(
        (rule) => rule.boxReferenceId,
      ),
    ).toEqual(["box-food", "box-general", "box-zero"]);

    const yearTurnRules: readonly AllocationRuleInput[] = [
      {
        referenceId: "year-old",
        boxReferenceId: "box-year",
        amountCents: "10",
        effectiveFrom: "2026-12-01",
        effectiveUntil: "2027-01-01",
      },
      {
        referenceId: "year-new",
        boxReferenceId: "box-year",
        amountCents: "20",
        effectiveFrom: "2027-01-01",
      },
    ];
    expect(resolveEffectiveAllocationRule(yearTurnRules, "box-year", "2026-12-31")?.referenceId).toBe(
      "year-old",
    );
    expect(resolveEffectiveAllocationRule(yearTurnRules, "box-year", "2027-01-01")?.referenceId).toBe(
      "year-new",
    );
  });

  it("rejects overlapping or reused rule identities", () => {
    expectBudgetError(
      () =>
        canonicalizeAllocationRules([
          {
            referenceId: "rule-1",
            boxReferenceId: "box-a",
            amountCents: "1",
            effectiveFrom: "2026-01-01",
          },
          {
            referenceId: "rule-2",
            boxReferenceId: "box-a",
            amountCents: "2",
            effectiveFrom: "2026-02-01",
          },
        ]),
      "ALLOCATION_OVERLAP",
    );
    expectBudgetError(
      () =>
        canonicalizeAllocationRules([
          {
            referenceId: "same-rule",
            boxReferenceId: "box-a",
            amountCents: "1",
            effectiveFrom: "2026-01-01",
          },
          {
            referenceId: "same-rule",
            boxReferenceId: "box-b",
            amountCents: "1",
            effectiveFrom: "2026-01-01",
          },
        ]),
      "DUPLICATE_REFERENCE",
    );
  });

  it("distributes a realized income exactly with canonical remainder order", () => {
    const first = distributeRealizedIncome({
      ...ALLOCATION_FIXTURE_INCOME,
      rules: FOUR_WEIGHT_RULES,
    });
    const reversed = distributeRealizedIncome({
      ...ALLOCATION_FIXTURE_INCOME,
      rules: [...FOUR_WEIGHT_RULES].reverse(),
    });

    expect(first.status).toBe("DISTRIBUTED");
    expect(first.contributions.map((row) => row.boxReferenceId)).toEqual([
      "box-a",
      "box-b",
      "box-c",
      "box-d",
    ]);
    expect(first.contributions.map((row) => row.amountCents)).toEqual([
      BigInt("575000"),
      BigInt("230000"),
      BigInt("230000"),
      BigInt("115000"),
    ]);
    expect(first.distributedAmountCents).toBe(BigInt("1150000"));
    expect(
      first.contributions.reduce(
        (total, contribution) => total + contribution.amountCents,
        BigInt(0),
      ),
    ).toBe(BigInt("1150000"));
    expect(reversed.contributions.map((row) => row.referenceId)).toEqual(
      first.contributions.map((row) => row.referenceId),
    );
    expect(reversed.contributions.map((row) => row.amountCents)).toEqual(
      first.contributions.map((row) => row.amountCents),
    );
    expect(first.contributions.every((row) => row.sourceReferenceId === ALLOCATION_FIXTURE_INCOME.referenceId)).toBe(
      true,
    );
  });

  it("assigns remainders even when a positive weight has a zero base", () => {
    const result = distributeRealizedIncome({
      referenceId: "income-small",
      amountCents: "2",
      occurredOn: "2026-01-01",
      status: "POSTED",
      kind: "INCOME",
      rules: [
        { referenceId: "rule-a", boxReferenceId: "box-a", amountCents: "1", effectiveFrom: "2026-01-01" },
        { referenceId: "rule-b", boxReferenceId: "box-b", amountCents: "1", effectiveFrom: "2026-01-01" },
        { referenceId: "rule-c", boxReferenceId: "box-c", amountCents: "1", effectiveFrom: "2026-01-01" },
      ],
    });

    expect(result.contributions.map((row) => row.amountCents)).toEqual([
      BigInt(1),
      BigInt(1),
      BigInt(0),
    ]);
    expect(result.distributedAmountCents).toBe(BigInt(2));
  });

  it("does not materialize planned income and exposes absent/zero configuration", () => {
    const planned = distributeRealizedIncome({
      ...ALLOCATION_FIXTURE_INCOME,
      status: "EXPECTED",
      rules: FOUR_WEIGHT_RULES,
    });
    const absent = distributeRealizedIncome({
      ...ALLOCATION_FIXTURE_INCOME,
      rules: [],
    });
    const zero = distributeRealizedIncome({
      ...ALLOCATION_FIXTURE_INCOME,
      rules: [
        {
          referenceId: "zero-rule",
          boxReferenceId: "box-zero-only",
          amountCents: "0",
          effectiveFrom: "2026-01-01",
        },
      ],
    });

    expect(planned).toMatchObject({ status: "NOT_REALIZED", contributions: [] });
    expect(absent).toMatchObject({ status: "NO_CONFIGURATION", contributions: [] });
    expect(zero).toMatchObject({ status: "NO_CONFIGURATION", contributions: [] });
    expect(planned.createsMovement).toBe(false);
    expect(planned.entersForecast).toBe(false);
  });

  it("returns an idempotent no-op when the income or every contribution is reflected", () => {
    const first = distributeRealizedIncome({
      ...ALLOCATION_FIXTURE_INCOME,
      rules: FOUR_WEIGHT_RULES,
    });
    const byIncome = distributeRealizedIncome({
      ...ALLOCATION_FIXTURE_INCOME,
      rules: FOUR_WEIGHT_RULES,
      alreadyReflectedReferenceIds: [ALLOCATION_FIXTURE_INCOME.referenceId],
    });
    const byRows = distributeRealizedIncome({
      ...ALLOCATION_FIXTURE_INCOME,
      rules: FOUR_WEIGHT_RULES,
      existingContributions: first.contributions.map((row) => ({
        referenceId: row.referenceId,
        amountCents: row.amountCents,
      })),
    });

    expect(byIncome.status).toBe("ALREADY_RECONCILED");
    expect(byIncome.contributions).toEqual([]);
    expect(byRows.status).toBe("ALREADY_RECONCILED");
    expect(byRows.contributions).toEqual([]);
  });

  it("selects the most specific category association by occurredOn", () => {
    const child = resolveBudgetForExpense({
      categoryId: "category-food",
      occurredOn: "2026-08-29",
      budgets: ALLOCATION_FIXTURE_BUDGETS,
      categories: ALLOCATION_FIXTURE_CATEGORIES,
    });
    const afterChildClosure = resolveBudgetForExpense({
      categoryId: "category-food",
      occurredOn: "2026-09-10",
      budgets: ALLOCATION_FIXTURE_BUDGETS,
      categories: ALLOCATION_FIXTURE_CATEGORIES,
    });
    const beforeChild = resolveBudgetForExpense({
      categoryId: "category-food",
      occurredOn: "2026-07-31",
      budgets: ALLOCATION_FIXTURE_BUDGETS,
      categories: ALLOCATION_FIXTURE_CATEGORIES,
    });
    const beforeCreation = resolveBudgetForExpense({
      categoryId: "category-food",
      occurredOn: "2025-12-31",
      budgets: ALLOCATION_FIXTURE_BUDGETS,
      categories: ALLOCATION_FIXTURE_CATEGORIES,
    });

    expect(child).toMatchObject({
      boxReferenceId: "box-food",
      matchedCategoryId: "category-food",
      specificity: 0,
    });
    expect(afterChildClosure).toMatchObject({
      boxReferenceId: "box-general",
      matchedCategoryId: "category-expenses",
      specificity: 1,
    });
    expect(beforeChild?.boxReferenceId).toBe("box-general");
    expect(beforeCreation).toBeNull();
  });

  it("preserves historical archived-category attribution but rejects post-archive attribution", () => {
    const historical = resolveBudgetForExpense({
      categoryId: "category-archived",
      occurredOn: "2026-08-31",
      budgets: ALLOCATION_FIXTURE_BUDGETS,
      categories: ALLOCATION_FIXTURE_CATEGORIES,
    });
    const newExpense = resolveBudgetForExpense({
      categoryId: "category-archived",
      occurredOn: "2026-09-01",
      budgets: ALLOCATION_FIXTURE_BUDGETS,
      categories: ALLOCATION_FIXTURE_CATEGORIES,
    });

    expect(historical?.boxReferenceId).toBe("box-archived-category");
    expect(newExpense).toBeNull();
  });

  it("normalizes one economic purchase, ignores installments/payments, and applies refund on its effective date", () => {
    const result = resolveBudgetFinancialEffects({
      sources: ALLOCATION_FIXTURE_FINANCIAL_SOURCES,
      budgets: ALLOCATION_FIXTURE_BUDGETS,
      categories: ALLOCATION_FIXTURE_CATEGORIES,
    });

    expect(result.effects.map((effect) => effect.sourceKind)).toEqual([
      "EXPENSE",
      "REFUND",
    ]);
    expect(result.effects.map((effect) => effect.amountCents)).toEqual([
      BigInt("600000"),
      BigInt("100000"),
    ]);
    expect(result.effects[0]?.kind).toBe("WITHDRAWAL");
    expect(result.effects[1]).toMatchObject({
      kind: "CONTRIBUTION",
      originalReferenceId: "purchase-600000",
      balanceEligible: true,
    });
    expect(result.grossExpenseCents).toBe(BigInt("600000"));
    expect(result.refundsCents).toBe(BigInt("100000"));
    expect(result.netExpenseCents).toBe(BigInt("500000"));
    expect(result.ignored.map((row) => row.reason)).toEqual([
      "NON_CANONICAL_SOURCE",
      "NON_CANONICAL_SOURCE",
      "NON_CANONICAL_SOURCE",
    ]);
  });

  it("deduplicates an event/purchase pair and rejects refunds above the original", () => {
    const result = resolveBudgetFinancialEffects({
      sources: [
        {
          kind: "EXPENSE",
          referenceId: "event-purchase",
          economicReferenceId: "purchase-economic",
          categoryId: "category-expenses",
          amountCents: "600000",
          occurredOn: "2026-08-29",
        },
        {
          kind: "PURCHASE",
          referenceId: "purchase-economic",
          purchaseId: "purchase-economic",
          categoryId: "category-expenses",
          amountCents: "600000",
          occurredOn: "2026-08-29",
        },
      ],
      budgets: ALLOCATION_FIXTURE_BUDGETS,
      categories: ALLOCATION_FIXTURE_CATEGORIES,
    });
    expect(result.effects.filter((effect) => effect.sourceKind === "EXPENSE")).toHaveLength(1);
    expect(result.effects[0]?.referenceId).toBe("purchase-economic");

    const refundByLegacyReference = resolveBudgetFinancialEffects({
      sources: [
        {
          kind: "EXPENSE",
          referenceId: "event-purchase",
          economicReferenceId: "purchase-economic",
          categoryId: "category-expenses",
          amountCents: "600000",
          occurredOn: "2026-08-29",
        },
        {
          kind: "PURCHASE",
          referenceId: "purchase-economic",
          purchaseId: "purchase-economic",
          categoryId: "category-expenses",
          amountCents: "600000",
          occurredOn: "2026-08-29",
        },
        {
          kind: "REFUND",
          referenceId: "refund-by-event",
          originalReferenceId: "event-purchase",
          amountCents: "100000",
          effectiveOn: "2026-09-05",
        },
      ],
      budgets: ALLOCATION_FIXTURE_BUDGETS,
      categories: ALLOCATION_FIXTURE_CATEGORIES,
    });
    expect(refundByLegacyReference.effects).toHaveLength(2);
    expect(refundByLegacyReference.effects[1]).toMatchObject({
      referenceId: "refund-by-event",
      originalReferenceId: "event-purchase",
      economicReferenceId: "purchase-economic",
      balanceEligible: true,
    });

    expectBudgetError(
      () =>
        resolveBudgetFinancialEffects({
          sources: [
            {
              kind: "EXPENSE",
              referenceId: "event-purchase",
              economicReferenceId: "purchase-economic",
              categoryId: "category-expenses",
              amountCents: "100",
              occurredOn: "2026-08-29",
            },
            {
              kind: "PURCHASE",
              referenceId: "purchase-economic",
              purchaseId: "purchase-economic",
              categoryId: "category-expenses",
              amountCents: "100",
              occurredOn: "2026-08-29",
            },
            {
              kind: "REFUND",
              referenceId: "refund-event-part",
              originalReferenceId: "event-purchase",
              amountCents: "60",
              effectiveOn: "2026-09-05",
            },
            {
              kind: "REFUND",
              referenceId: "refund-purchase-part",
              originalReferenceId: "purchase-economic",
              amountCents: "41",
              effectiveOn: "2026-09-06",
            },
          ],
          budgets: ALLOCATION_FIXTURE_BUDGETS,
          categories: ALLOCATION_FIXTURE_CATEGORIES,
        }),
      "REFUND_EXCEEDS_ORIGINAL",
    );

    expectBudgetError(
      () =>
        resolveBudgetFinancialEffects({
          sources: [
            {
              kind: "EXPENSE",
              referenceId: "expense-1",
              categoryId: "category-expenses",
              amountCents: "100",
              occurredOn: "2026-08-01",
            },
            {
              kind: "REFUND",
              referenceId: "refund-too-large",
              originalReferenceId: "expense-1",
              amountCents: "101",
              originalAmountCents: "100",
              effectiveOn: "2026-08-02",
            },
          ],
          budgets: ALLOCATION_FIXTURE_BUDGETS,
          categories: ALLOCATION_FIXTURE_CATEGORIES,
        }),
      "REFUND_EXCEEDS_ORIGINAL",
    );
  });

  it("keeps a post-closure refund explainable without reopening protection", () => {
    const result = resolveBudgetFinancialEffects({
      sources: [
        {
          kind: "EXPENSE",
          referenceId: "closed-expense",
          categoryId: "category-food",
          amountCents: "600000",
          occurredOn: "2026-08-29",
        },
        {
          kind: "REFUND",
          referenceId: "late-refund",
          originalReferenceId: "closed-expense",
          amountCents: "100000",
          effectiveOn: "2026-09-11",
        },
      ],
      budgets: ALLOCATION_FIXTURE_BUDGETS,
      categories: ALLOCATION_FIXTURE_CATEGORIES,
    });
    const refund = result.effects.find((effect) => effect.referenceId === "late-refund");

    expect(refund).toMatchObject({ balanceEligible: false, originalReferenceId: "closed-expense" });
    expect(result.grossExpenseCents).toBe(BigInt("600000"));
    expect(result.refundsCents).toBe(BigInt(0));
    expect(result.netExpenseCents).toBe(BigInt("600000"));
  });

  it("resolves lifecycle boundaries, signed rollover and explanatory goal suggestion", () => {
    const budget = normalizeAllocationBudget({
      boxReferenceId: "box-goal",
      categoryId: "category-expenses",
      activeFrom: "2026-08-01",
      closedOn: "2026-09-10",
      status: "CLOSED",
    });
    const active = resolveBudgetTemporalState(
      {
        referenceId: "box-goal",
        name: "Meta",
        categoryId: "category-expenses",
        activeFrom: "2026-08-01",
        status: "CLOSED",
        closedOn: "2026-09-10",
        goal: { targetAmountCents: "10000", targetDate: "2026-12-31" },
      },
      "2026-09-09",
    );
    const closed = resolveBudgetTemporalState(
      {
        referenceId: "box-goal",
        name: "Meta",
        categoryId: "category-expenses",
        activeFrom: "2026-08-01",
        status: "CLOSED",
        closedOn: "2026-09-10",
      },
      "2026-09-10",
    );
    const rollover = deriveBudgetRollover(
      {
        referenceId: "box-rollover",
        name: "Rollover",
        categoryId: "category-expenses",
        activeFrom: "2026-08-01",
      },
      [
        { referenceId: "aug-income", boxReferenceId: "box-rollover", kind: "CONTRIBUTION", amountCents: "10000", effectiveOn: "2026-08-05" },
        { referenceId: "aug-expense", boxReferenceId: "box-rollover", kind: "WITHDRAWAL", amountCents: "7000", effectiveOn: "2026-08-20" },
        { referenceId: "sep-income", boxReferenceId: "box-rollover", kind: "CONTRIBUTION", amountCents: "10000", effectiveOn: "2026-09-05" },
      ],
      "2026-09-01",
    );
    const suggestion = deriveBudgetGoalSuggestion({
      budget: {
        referenceId: "box-suggestion",
        name: "Meta",
        categoryId: "category-expenses",
        activeFrom: "2026-08-01",
        goal: ALLOCATION_FIXTURE_GOAL,
      },
      balanceCents: "3000",
      asOf: "2026-08-15",
    });

    expect(budget.closedOn?.toString()).toBe("2026-09-10");
    expect(active).toMatchObject({
      activeAtCutoff: true,
      protectsSpendable: true,
      canReceiveInteractiveMovement: false,
    });
    expect(closed).toMatchObject({
      activeAtCutoff: false,
      protectsSpendable: false,
      canReceiveHistoricalEffect: true,
      canReceiveInteractiveMovement: false,
    });
    expect(rollover.cents).toBe(BigInt("3000"));
    expect(suggestion).toMatchObject({
      balanceCents: BigInt("3000"),
      remainingCents: BigInt("7000"),
      remainingMonths: 3,
      suggestedMonthlyCents: BigInt("2334"),
      createsMovement: false,
      entersForecast: false,
      isCommitment: false,
    });
  });
});
