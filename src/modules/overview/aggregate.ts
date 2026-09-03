import { Money } from "@/modules/transactions/money";

import {
  OVERVIEW_OTHER_KEY,
  OVERVIEW_OTHER_LABEL,
  OVERVIEW_MAX_NAMED_CATEGORY_GROUPS,
  OVERVIEW_UNCATEGORIZED_KEY,
  OVERVIEW_UNCATEGORIZED_LABEL,
  overviewCents,
  overviewMoney,
  type OverviewCategoryGroup,
  type OverviewPeriod,
  type OverviewPeriodSummary,
} from "./contracts";
import { isDateWithinOverviewPeriod } from "./period";

export const PERIOD_AGGREGATION_EVENT_KINDS = [
  "EXPENSE",
  "INCOME",
  "PURCHASE",
  "REVERSAL",
] as const;

export type PeriodAggregationEventKind =
  (typeof PERIOD_AGGREGATION_EVENT_KINDS)[number];

export type PeriodAggregationEconomicKind = "EXPENSE" | "INCOME" | "PURCHASE";

export interface PeriodAggregationFact {
  readonly id: string;
  readonly kind: PeriodAggregationEventKind;
  readonly status: "POSTED" | "CANCELLED";
  readonly amountCents: string | bigint;
  readonly occurredOn: string;
  readonly categoryId: string | null;
  readonly reversalOfEventId: string | null;
}

export interface PeriodAggregationCategory {
  readonly id: string;
  readonly name: string;
}

export interface PeriodAggregationResult {
  readonly summary: OverviewPeriodSummary;
  readonly groups: readonly OverviewCategoryGroup[];
  readonly totalExpenseCents: string;
}

interface PeriodAggregationOriginal {
  readonly id: string;
  readonly kind: PeriodAggregationEconomicKind;
  readonly status: "POSTED" | "CANCELLED";
  readonly occurredOn: string;
  readonly categoryId: string | null;
}

interface MutableCategoryAccumulator {
  readonly key: string;
  readonly label: string;
  readonly categoryId?: string;
  amount: Money;
  expenseEventCount: number;
  purchaseEventCount: number;
}

function compareBigIntDesc(left: bigint, right: bigint): number {
  if (left > right) return -1;
  if (left < right) return 1;
  return 0;
}

function compareStringsAsc(left: string, right: string): number {
  return left.localeCompare(right, "pt-BR", { sensitivity: "base" });
}

function resolveCategoryLabel(
  categoryId: string | null,
  categories: ReadonlyMap<string, PeriodAggregationCategory>,
): { key: string; label: string; categoryId?: string } {
  if (categoryId === null) {
    return {
      key: OVERVIEW_UNCATEGORIZED_KEY,
      label: OVERVIEW_UNCATEGORIZED_LABEL,
    };
  }

  const category = categories.get(categoryId);
  return {
    key: categoryId,
    label: category?.name ?? categoryId,
    categoryId,
  };
}

function buildReconciliation(period: OverviewPeriod): OverviewPeriodSummary["reconciliation"] {
  const params = new URLSearchParams({
    from: period.from,
    to: period.to,
    status: "POSTED",
  });

  const expenseFilter = `/transactions?${new URLSearchParams({
    ...Object.fromEntries(params),
    kind: "EXPENSE",
  }).toString()}`;
  const incomeFilter = `/transactions?${new URLSearchParams({
    ...Object.fromEntries(params),
    kind: "INCOME",
  }).toString()}`;

  return {
    from: period.from,
    to: period.to,
    expenseFilter,
    incomeFilter,
  };
}

function shouldIgnoreReversal(
  original: PeriodAggregationOriginal,
  period: OverviewPeriod,
): boolean {
  return (
    original.status === "CANCELLED" &&
    isDateWithinOverviewPeriod(original.occurredOn, period)
  );
}

function applyExpenseEffect(
  groups: Map<string, MutableCategoryAccumulator>,
  categories: ReadonlyMap<string, PeriodAggregationCategory>,
  categoryId: string | null,
  amount: Money,
  counters: { expenseEventCount: number; purchaseEventCount: number },
): void {
  const resolved = resolveCategoryLabel(categoryId, categories);
  const existing = groups.get(resolved.key);
  if (existing) {
    existing.amount = existing.amount.add(amount);
    existing.expenseEventCount += counters.expenseEventCount;
    existing.purchaseEventCount += counters.purchaseEventCount;
    return;
  }

  groups.set(resolved.key, {
    key: resolved.key,
    label: resolved.label,
    categoryId: resolved.categoryId,
    amount,
    expenseEventCount: counters.expenseEventCount,
    purchaseEventCount: counters.purchaseEventCount,
  });
}

function distributeHamiltonPercents(
  groups: readonly MutableCategoryAccumulator[],
  totalCents: bigint,
): number[] {
  if (totalCents <= BigInt(0) || groups.length === 0) {
    return groups.map(() => 0);
  }

  const total = new Money(totalCents);
  const allocations = groups.map((group) => {
    const exact = (group.amount.cents * BigInt(100)) / total.cents;
    const remainder = (group.amount.cents * BigInt(100)) % total.cents;
    return {
      floor: Number(exact),
      remainder,
      amountCents: group.amount.cents,
      label: group.label,
      key: group.key,
    };
  });

  const assigned = allocations.reduce((sum, item) => sum + item.floor, 0);
  let remaining = 100 - assigned;

  const order = [...allocations.keys()].sort((leftIndex, rightIndex) => {
    const left = allocations[leftIndex]!;
    const right = allocations[rightIndex]!;

    const remainderCompare = compareBigIntDesc(left.remainder, right.remainder);
    if (remainderCompare !== 0) return remainderCompare;

    const amountCompare = compareBigIntDesc(left.amountCents, right.amountCents);
    if (amountCompare !== 0) return amountCompare;

    const labelCompare = compareStringsAsc(left.label, right.label);
    if (labelCompare !== 0) return labelCompare;

    return compareStringsAsc(left.key, right.key);
  });

  const percents = allocations.map((item) => item.floor);
  for (const index of order) {
    if (remaining <= 0) break;
    percents[index]! += 1;
    remaining -= 1;
  }

  return percents;
}

function collapseCategoryGroups(
  groups: Map<string, MutableCategoryAccumulator>,
): readonly OverviewCategoryGroup[] {
  const sorted = [...groups.values()].sort((left, right) => {
    const amountCompare = compareBigIntDesc(
      left.amount.cents,
      right.amount.cents,
    );
    if (amountCompare !== 0) return amountCompare;

    const labelCompare = compareStringsAsc(left.label, right.label);
    if (labelCompare !== 0) return labelCompare;

    return compareStringsAsc(left.key, right.key);
  });

  const totalExpenseCents = sorted.reduce(
    (sum, group) => sum.add(group.amount),
    Money.zero(),
  );

  const named = sorted.slice(0, OVERVIEW_MAX_NAMED_CATEGORY_GROUPS);
  const remainder = sorted.slice(OVERVIEW_MAX_NAMED_CATEGORY_GROUPS);

  const collapsed: MutableCategoryAccumulator[] = [...named];
  if (remainder.length > 0) {
    const otherAmount = remainder.reduce(
      (sum, group) => sum.add(group.amount),
      Money.zero(),
    );
    const otherExpenseCount = remainder.reduce(
      (sum, group) => sum + group.expenseEventCount,
      0,
    );
    const otherPurchaseCount = remainder.reduce(
      (sum, group) => sum + group.purchaseEventCount,
      0,
    );

    collapsed.push({
      key: OVERVIEW_OTHER_KEY,
      label: OVERVIEW_OTHER_LABEL,
      amount: otherAmount,
      expenseEventCount: otherExpenseCount,
      purchaseEventCount: otherPurchaseCount,
    });
  }

  const percents = distributeHamiltonPercents(collapsed, totalExpenseCents.cents);

  return collapsed.map((group, index) => ({
    key: group.key,
    label: group.label,
    ...(group.categoryId ? { categoryId: group.categoryId } : {}),
    amountCents: group.amount.toCentsString(),
    percent: percents[index] ?? 0,
    expenseEventCount: group.expenseEventCount,
    purchaseEventCount: group.purchaseEventCount,
  }));
}

function toOriginalLookup(
  fact: PeriodAggregationFact,
): PeriodAggregationOriginal | null {
  if (
    fact.kind !== "EXPENSE" &&
    fact.kind !== "INCOME" &&
    fact.kind !== "PURCHASE"
  ) {
    return null;
  }

  return {
    id: fact.id,
    kind: fact.kind,
    status: fact.status,
    occurredOn: fact.occurredOn,
    categoryId: fact.categoryId,
  };
}

/**
 * Pure derivation of period totals and expense groups from canonical facts.
 * `facts` may include originals referenced by reversals even when cancelled or
 * outside the period; only POSTED events inside the window are counted.
 */
export function aggregatePeriodFacts(
  facts: readonly PeriodAggregationFact[],
  categories: readonly PeriodAggregationCategory[],
  period: OverviewPeriod,
): PeriodAggregationResult {
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const originalMap = new Map<string, PeriodAggregationOriginal>();
  for (const fact of facts) {
    const original = toOriginalLookup(fact);
    if (original) {
      originalMap.set(original.id, original);
    }
  }
  const groups = new Map<string, MutableCategoryAccumulator>();

  let incomeCents = Money.zero();
  let expenseCents = Money.zero();
  let expenseEventCount = 0;
  let purchaseEventCount = 0;

  for (const fact of facts) {
    if (fact.status !== "POSTED") {
      continue;
    }

    if (!isDateWithinOverviewPeriod(fact.occurredOn, period)) {
      continue;
    }

    const amount = overviewMoney(fact.amountCents, "amountCents");

    switch (fact.kind) {
      case "EXPENSE": {
        expenseCents = expenseCents.add(amount);
        expenseEventCount += 1;
        applyExpenseEffect(
          groups,
          categoryMap,
          fact.categoryId,
          amount,
          { expenseEventCount: 1, purchaseEventCount: 0 },
        );
        break;
      }
      case "PURCHASE": {
        expenseCents = expenseCents.add(amount);
        purchaseEventCount += 1;
        applyExpenseEffect(
          groups,
          categoryMap,
          fact.categoryId,
          amount,
          { expenseEventCount: 0, purchaseEventCount: 1 },
        );
        break;
      }
      case "INCOME": {
        incomeCents = incomeCents.add(amount);
        break;
      }
      case "REVERSAL": {
        if (!fact.reversalOfEventId) {
          break;
        }

        const original = originalMap.get(fact.reversalOfEventId);
        if (!original || shouldIgnoreReversal(original, period)) {
          break;
        }

        const reversalAmount = amount.negate();

        if (original.kind === "EXPENSE" || original.kind === "PURCHASE") {
          expenseCents = expenseCents.add(reversalAmount);
          applyExpenseEffect(
            groups,
            categoryMap,
            original.categoryId,
            reversalAmount,
            { expenseEventCount: 0, purchaseEventCount: 0 },
          );
        } else if (original.kind === "INCOME") {
          incomeCents = incomeCents.add(reversalAmount);
        }
        break;
      }
      default:
        break;
    }
  }

  const netCents = incomeCents.subtract(expenseCents);
  const collapsedGroups = collapseCategoryGroups(groups);

  return {
    summary: {
      incomeCents: incomeCents.toCentsString(),
      expenseCents: expenseCents.toCentsString(),
      netCents: netCents.toCentsString(),
      expenseEventCount,
      purchaseEventCount,
      reconciliation: buildReconciliation(period),
    },
    groups: collapsedGroups,
    totalExpenseCents: expenseCents.toCentsString(),
  };
}

export function sumCategoryGroupAmounts(
  groups: readonly OverviewCategoryGroup[],
): string {
  const total = groups.reduce(
    (sum, group) => sum.add(overviewMoney(group.amountCents)),
    Money.zero(),
  );
  return total.toCentsString();
}

export function sumCategoryGroupPercents(
  groups: readonly OverviewCategoryGroup[],
): number {
  return groups.reduce((sum, group) => sum + group.percent, 0);
}

/** @internal exported for tests */
export function __distributeHamiltonPercentsForTest(
  amounts: readonly string[],
  totalCents: string,
): number[] {
  const groups = amounts.map((amountCents, index) => ({
    key: `group-${index}`,
    label: `Group ${index}`,
    amount: overviewMoney(amountCents),
    expenseEventCount: 0,
    purchaseEventCount: 0,
  }));
  return distributeHamiltonPercents(groups, overviewCents(totalCents));
}
