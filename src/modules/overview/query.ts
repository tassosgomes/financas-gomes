import { and, between, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  categories,
  financialEvents,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import type { TransactionReferenceExecutor } from "@/modules/transactions/references";
import { overviewCents, type OverviewPeriod } from "./contracts";
import {
  aggregatePeriodFacts,
  type PeriodAggregationCategory,
  type PeriodAggregationFact,
  type PeriodAggregationResult,
} from "./aggregate";

export type OverviewReadExecutor = TransactionReferenceExecutor;

export interface OverviewQueryOptions {
  readonly database?: OverviewReadExecutor;
  /** When true, runs `EXPLAIN (ANALYZE, FORMAT TEXT)` instead of `EXPLAIN` only. */
  readonly analyze?: boolean;
}

export class OverviewQueryError extends Error {
  readonly code = "OVERVIEW_QUERY_FAILED" as const;
  readonly field: string | null;

  constructor(field: string | null = null) {
    super("OVERVIEW_QUERY_FAILED");
    this.name = "OverviewQueryError";
    this.field = field;
  }
}

function resolveExecutor(database?: OverviewReadExecutor): OverviewReadExecutor {
  return database ?? getDb();
}

function centsString(value: unknown, field: string): string {
  if (typeof value === "bigint") {
    return value.toString(10);
  }
  if (typeof value !== "string" || !/^-?\d+$/u.test(value)) {
    throw new OverviewQueryError(field);
  }
  try {
    return BigInt(value).toString(10);
  } catch {
    throw new OverviewQueryError(field);
  }
}

function assertReturnedHousehold(
  value: unknown,
  context: FinancialContext,
): void {
  if (value !== undefined && value !== null && value !== context.householdId) {
    throw new OverviewQueryError("householdId");
  }
}

type PeriodEventRow = {
  id: string;
  householdId: string;
  kind: "EXPENSE" | "INCOME" | "PURCHASE" | "REVERSAL";
  status: "POSTED" | "CANCELLED";
  amountCents: bigint;
  occurredOn: string;
  categoryId: string | null;
  reversalOfEventId: string | null;
  categoryName: string | null;
  originalId: string | null;
  originalKind: "EXPENSE" | "INCOME" | "PURCHASE" | null;
  originalStatus: "POSTED" | "CANCELLED" | null;
  originalOccurredOn: string | null;
  originalCategoryId: string | null;
  originalCategoryName: string | null;
};

/**
 * Tenant-scoped read of POSTED economic events for the civil period.
 * Every predicate and join repeats `household_id`.
 */
export async function readPeriodAggregationForContext(
  context: FinancialContext,
  period: OverviewPeriod,
  options: OverviewQueryOptions = {},
): Promise<PeriodAggregationResult> {
  assertFinancialContext(context);
  const executor = resolveExecutor(options.database);

  try {
    const rows = (await executor
      .select({
        id: financialEvents.id,
        householdId: financialEvents.householdId,
        kind: financialEvents.kind,
        status: financialEvents.status,
        amountCents: financialEvents.amountCents,
        occurredOn: financialEvents.occurredOn,
        categoryId: financialEvents.categoryId,
        reversalOfEventId: financialEvents.reversalOfEventId,
        categoryName: categories.name,
        originalId: sql<string | null>`original_event.id`,
        originalKind: sql<"EXPENSE" | "INCOME" | "PURCHASE" | null>`original_event.kind`,
        originalStatus: sql<"POSTED" | "CANCELLED" | null>`original_event.status`,
        originalOccurredOn: sql<string | null>`original_event.occurred_on`,
        originalCategoryId: sql<string | null>`original_event.category_id`,
        originalCategoryName: sql<string | null>`original_category.name`,
      })
      .from(financialEvents)
      .leftJoin(
        categories,
        and(
          eq(financialEvents.categoryId, categories.id),
          eq(financialEvents.householdId, categories.householdId),
          eq(categories.householdId, context.householdId),
        ),
      )
      .leftJoin(
        sql`financial_events AS original_event`,
        and(
          eq(financialEvents.reversalOfEventId, sql`original_event.id`),
          eq(financialEvents.householdId, sql`original_event.household_id`),
          eq(sql`original_event.household_id`, context.householdId),
        ),
      )
      .leftJoin(
        sql`categories AS original_category`,
        and(
          eq(sql`original_event.category_id`, sql`original_category.id`),
          eq(sql`original_event.household_id`, sql`original_category.household_id`),
          eq(sql`original_category.household_id`, context.householdId),
        ),
      )
      .where(
        and(
          eq(financialEvents.householdId, context.householdId),
          eq(financialEvents.status, "POSTED"),
          inArray(financialEvents.kind, [
            "EXPENSE",
            "INCOME",
            "PURCHASE",
            "REVERSAL",
          ]),
          between(financialEvents.occurredOn, period.from, period.to),
        ),
      )) as PeriodEventRow[];

    const facts: PeriodAggregationFact[] = [];
    const categoryAccumulator = new Map<string, PeriodAggregationCategory>();

    for (const row of rows) {
      assertReturnedHousehold(row.householdId, context);

      facts.push({
        id: row.id,
        kind: row.kind,
        status: row.status,
        amountCents: centsString(row.amountCents, "amountCents"),
        occurredOn: row.occurredOn,
        categoryId: row.categoryId,
        reversalOfEventId: row.reversalOfEventId,
      });

      if (row.categoryId && row.categoryName) {
        categoryAccumulator.set(row.categoryId, {
          id: row.categoryId,
          name: row.categoryName,
        });
      }

      if (
        row.originalId &&
        row.originalKind &&
        row.originalStatus &&
        row.originalOccurredOn &&
        !facts.some((fact) => fact.id === row.originalId)
      ) {
        facts.push({
          id: row.originalId,
          kind: row.originalKind,
          status: row.originalStatus,
          amountCents: "0",
          occurredOn: row.originalOccurredOn,
          categoryId: row.originalCategoryId,
          reversalOfEventId: null,
        });

        if (row.originalCategoryId && row.originalCategoryName) {
          categoryAccumulator.set(row.originalCategoryId, {
            id: row.originalCategoryId,
            name: row.originalCategoryName,
          });
        }
      }
    }

    return aggregatePeriodFacts(
      facts,
      [...categoryAccumulator.values()],
      period,
    );
  } catch (error) {
    if (error instanceof OverviewQueryError) {
      throw error;
    }
    throw new OverviewQueryError();
  }
}

/** @internal helper for integration diagnostics */
export async function explainPeriodAggregationQuery(
  context: FinancialContext,
  period: OverviewPeriod,
  options: OverviewQueryOptions = {},
): Promise<string> {
  assertFinancialContext(context);
  const executor = resolveExecutor(options.database);

  const explainClause = options.analyze
    ? sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)`
    : sql`EXPLAIN (FORMAT TEXT)`;

  const result = await executor.execute(sql`
    ${explainClause}
    SELECT fe.id
    FROM financial_events fe
    LEFT JOIN categories c
      ON fe.category_id = c.id
     AND fe.household_id = c.household_id
     AND c.household_id = ${context.householdId}
    LEFT JOIN financial_events original_event
      ON fe.reversal_of_event_id = original_event.id
     AND fe.household_id = original_event.household_id
     AND original_event.household_id = ${context.householdId}
    LEFT JOIN categories original_category
      ON original_event.category_id = original_category.id
     AND original_event.household_id = original_category.household_id
     AND original_category.household_id = ${context.householdId}
    WHERE fe.household_id = ${context.householdId}
      AND fe.status = 'POSTED'
      AND fe.kind IN ('EXPENSE', 'INCOME', 'PURCHASE', 'REVERSAL')
      AND fe.occurred_on BETWEEN ${period.from} AND ${period.to}
  `);

  return result.rows
    .map((row: Record<string, unknown>) => Object.values(row).join(" "))
    .join("\n");
}

export function assertGroupsReconcileWithTotal(
  result: PeriodAggregationResult,
): void {
  const groupSum = result.groups.reduce(
    (sum, group) => sum + overviewCents(group.amountCents),
    BigInt(0),
  );
  const total = overviewCents(result.totalExpenseCents);
  if (groupSum !== total) {
    throw new OverviewQueryError("groups");
  }
}
