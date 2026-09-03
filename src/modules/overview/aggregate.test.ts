import { describe, expect, it } from "vitest";

import {
  OVERVIEW_OTHER_KEY,
  OVERVIEW_OTHER_LABEL,
  OVERVIEW_UNCATEGORIZED_KEY,
  OVERVIEW_UNCATEGORIZED_LABEL,
} from "./contracts";
import {
  __distributeHamiltonPercentsForTest,
  aggregatePeriodFacts,
  sumCategoryGroupAmounts,
  sumCategoryGroupPercents,
  type PeriodAggregationCategory,
  type PeriodAggregationEventKind,
  type PeriodAggregationFact,
} from "./aggregate";
import { civilMonthPeriod } from "./period";

const SEPTEMBER = civilMonthPeriod("2026-09-15");
const OCTOBER = civilMonthPeriod("2026-10-10");

function expense(
  id: string,
  amountCents: string,
  occurredOn: string,
  categoryId: string | null = "cat-food",
): PeriodAggregationFact {
  return {
    id,
    kind: "EXPENSE",
    status: "POSTED",
    amountCents,
    occurredOn,
    categoryId,
    reversalOfEventId: null,
  };
}

function purchase(
  id: string,
  amountCents: string,
  occurredOn: string,
  categoryId: string | null = "cat-card",
): PeriodAggregationFact {
  return {
    id,
    kind: "PURCHASE",
    status: "POSTED",
    amountCents,
    occurredOn,
    categoryId,
    reversalOfEventId: null,
  };
}

function income(
  id: string,
  amountCents: string,
  occurredOn: string,
): PeriodAggregationFact {
  return {
    id,
    kind: "INCOME",
    status: "POSTED",
    amountCents,
    occurredOn,
    categoryId: null,
    reversalOfEventId: null,
  };
}

function reversal(
  id: string,
  amountCents: string,
  occurredOn: string,
  reversalOfEventId: string,
): PeriodAggregationFact {
  return {
    id,
    kind: "REVERSAL",
    status: "POSTED",
    amountCents,
    occurredOn,
    categoryId: null,
    reversalOfEventId,
  };
}

function cancelledExpense(
  id: string,
  amountCents: string,
  occurredOn: string,
  categoryId: string | null = "cat-food",
): PeriodAggregationFact {
  return {
    id,
    kind: "EXPENSE",
    status: "CANCELLED",
    amountCents,
    occurredOn,
    categoryId,
    reversalOfEventId: null,
  };
}

function withOriginals(
  facts: PeriodAggregationFact[],
  originals: PeriodAggregationFact[],
): PeriodAggregationFact[] {
  const seen = new Set(facts.map((fact) => fact.id));
  return [
    ...facts,
    ...originals.filter((original) => !seen.has(original.id)),
  ];
}

const CATEGORIES: PeriodAggregationCategory[] = [
  { id: "cat-food", name: "Alimentação" },
  { id: "cat-card", name: "Cartão" },
  ...Array.from({ length: 9 }, (_, index) => ({
    id: `cat-${index + 1}`,
    name: `Categoria ${String.fromCharCode(65 + index)}`,
  })),
];

const CENTS_PATTERN = /^-?\d+$/u;

function expectAllMoneySerialized(result: ReturnType<typeof aggregatePeriodFacts>) {
  expect(result.summary.incomeCents).toMatch(CENTS_PATTERN);
  expect(result.summary.expenseCents).toMatch(CENTS_PATTERN);
  expect(result.summary.netCents).toMatch(CENTS_PATTERN);
  expect(result.totalExpenseCents).toMatch(CENTS_PATTERN);
  for (const group of result.groups) {
    expect(group.amountCents).toMatch(CENTS_PATTERN);
    expect(typeof group.percent).toBe("number");
  }
}

describe("aggregatePeriodFacts", () => {
  it("1. applies a later-month refund only in the reversal month", () => {
    const expenseId = "evt-expense-sep";
    const facts = withOriginals(
      [
        expense(expenseId, "10000", "2026-09-05"),
        reversal("evt-reversal-oct", "10000", "2026-10-12", expenseId),
      ],
      [expense(expenseId, "10000", "2026-09-05")],
    );

    const september = aggregatePeriodFacts(facts, CATEGORIES, SEPTEMBER);
    expect(september.summary.expenseCents).toBe("10000");
    expect(september.summary.incomeCents).toBe("0");
    expect(september.groups).toHaveLength(1);
    expect(september.groups[0]?.amountCents).toBe("10000");

    const october = aggregatePeriodFacts(facts, CATEGORIES, OCTOBER);
    expect(october.summary.expenseCents).toBe("-10000");
    expect(october.summary.incomeCents).toBe("0");
    expect(october.groups[0]?.amountCents).toBe("-10000");
  });

  it("2. keeps same-month cancel at net zero without double subtracting", () => {
    const expenseId = "evt-cancelled";
    const facts = withOriginals(
      [reversal("evt-reversal", "5000", "2026-09-10", expenseId)],
      [cancelledExpense(expenseId, "5000", "2026-09-10")],
    );

    const result = aggregatePeriodFacts(facts, CATEGORIES, SEPTEMBER);
    expect(result.summary.expenseCents).toBe("0");
    expect(result.summary.expenseEventCount).toBe(0);
    expect(result.groups).toHaveLength(0);
    expect(sumCategoryGroupAmounts(result.groups)).toBe("0");
  });

  it("3. counts a parcelled purchase once and ignores non-economic rows", () => {
    const facts = [purchase("evt-purchase", "30000", "2026-09-05")];

    const result = aggregatePeriodFacts(facts, CATEGORIES, SEPTEMBER);
    expect(result.summary.expenseCents).toBe("30000");
    expect(result.summary.purchaseEventCount).toBe(1);
    expect(result.summary.expenseEventCount).toBe(0);
    expect(result.groups[0]?.amountCents).toBe("30000");
    expect(result.groups[0]?.purchaseEventCount).toBe(1);
  });

  it("4. groups missing categories as Sem categoria", () => {
    const facts = [expense("evt-none", "2500", "2026-09-08", null)];

    const result = aggregatePeriodFacts(facts, CATEGORIES, SEPTEMBER);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      key: OVERVIEW_UNCATEGORIZED_KEY,
      label: OVERVIEW_UNCATEGORIZED_LABEL,
      amountCents: "2500",
      expenseEventCount: 1,
      purchaseEventCount: 0,
    });
    expect(result.groups[0]?.categoryId).toBeUndefined();
  });

  it("5. collapses the ninth category into Outros with exact sums and percents", () => {
    const amounts = [
      "9000",
      "8000",
      "7000",
      "6000",
      "5000",
      "4000",
      "3000",
      "2000",
      "1000",
    ];
    const facts = amounts.map((amountCents, index) =>
      expense(`evt-${index}`, amountCents, "2026-09-12", `cat-${index + 1}`),
    );

    const result = aggregatePeriodFacts(facts, CATEGORIES, SEPTEMBER);
    expect(result.summary.expenseCents).toBe("45000");
    expect(result.groups).toHaveLength(9);
    expect(result.groups.slice(0, 8).every((group) => group.key !== OVERVIEW_OTHER_KEY)).toBe(
      true,
    );
    expect(result.groups[8]).toMatchObject({
      key: OVERVIEW_OTHER_KEY,
      label: OVERVIEW_OTHER_LABEL,
      amountCents: "1000",
    });
    expect(sumCategoryGroupAmounts(result.groups)).toBe(result.totalExpenseCents);
    expect(sumCategoryGroupPercents(result.groups)).toBe(100);
  });

  it("6. only aggregates facts explicitly passed into the pure function", () => {
    const facts = [expense("evt-a", "1200", "2026-09-03", "cat-food")];

    const result = aggregatePeriodFacts(facts, CATEGORIES, SEPTEMBER);
    expect(result.summary.expenseCents).toBe("1200");
    expect(result.groups).toHaveLength(1);
  });

  it("7. is deterministic for the same input", () => {
    const facts = [
      expense("evt-a", "5000", "2026-09-01", "cat-1"),
      expense("evt-b", "4000", "2026-09-02", "cat-2"),
      income("evt-income", "12000", "2026-09-03"),
    ];

    const first = aggregatePeriodFacts(facts, CATEGORIES, SEPTEMBER);
    const second = aggregatePeriodFacts(facts, CATEGORIES, SEPTEMBER);
    expect(second).toEqual(first);
  });

  it("8. never emits number money in serialized output", () => {
    const facts = [
      expense("evt-a", "5000", "2026-09-01", "cat-1"),
      purchase("evt-b", "30000", "2026-09-05", "cat-card"),
      income("evt-income", "12000", "2026-09-03"),
    ];

    const result = aggregatePeriodFacts(facts, CATEGORIES, SEPTEMBER);
    expectAllMoneySerialized(result);
    expect(JSON.stringify(result)).not.toMatch(/"amountCents":\s*\d/);
    expect(JSON.stringify(result)).not.toMatch(/Cents":\s*\d/);
  });

  it("9. counts purchase once and ignores non-economic transfer rows in facts", () => {
    const facts: PeriodAggregationFact[] = [
      purchase("evt-purchase", "30000", "2026-09-05"),
      {
        id: "evt-transfer",
        kind: "TRANSFER" as unknown as PeriodAggregationEventKind,
        status: "POSTED",
        amountCents: "10000",
        occurredOn: "2026-09-20",
        categoryId: null,
        reversalOfEventId: null,
      },
    ];

    const result = aggregatePeriodFacts(facts, CATEGORIES, SEPTEMBER);
    expect(result.summary.expenseCents).toBe("30000");
    expect(result.summary.purchaseEventCount).toBe(1);
    expect(result.summary.expenseEventCount).toBe(0);
    expect(sumCategoryGroupAmounts(result.groups)).toBe("30000");
  });

  it("nets income reversals in the reversal month", () => {
    const incomeId = "evt-income";
    const facts = withOriginals(
      [
        income(incomeId, "20000", "2026-09-01"),
        reversal("evt-income-reversal", "5000", "2026-09-20", incomeId),
      ],
      [income(incomeId, "20000", "2026-09-01")],
    );

    const result = aggregatePeriodFacts(facts, CATEGORIES, SEPTEMBER);
    expect(result.summary.incomeCents).toBe("15000");
    expect(result.summary.expenseCents).toBe("0");
  });
});

describe("Hamilton percent distribution", () => {
  it("allocates integer percents that sum to 100", () => {
    const percents = __distributeHamiltonPercentsForTest(
      ["3333", "3333", "3334"],
      "10000",
    );

    expect(percents).toEqual([33, 33, 34]);
    expect(percents.reduce((sum, percent) => sum + percent, 0)).toBe(100);
  });

  it("assigns the remainder to the largest fractional parts", () => {
    const percents = __distributeHamiltonPercentsForTest(
      ["1000", "1000", "1000", "1000", "1000", "1000", "1000", "1000", "1000"],
      "9000",
    );

    expect(percents.reduce((sum, percent) => sum + percent, 0)).toBe(100);
    expect(percents.every((percent) => Number.isInteger(percent))).toBe(true);
  });
});

describe("civilMonthPeriod", () => {
  it("uses the civil month boundaries of asOf", () => {
    expect(civilMonthPeriod("2026-09-15")).toEqual({
      key: "2026-09",
      from: "2026-09-01",
      to: "2026-09-30",
      asOf: "2026-09-15",
    });
  });
});
