import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  lt,
  or,
  type SQL,
} from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  categories,
  type CategoryRecord,
} from "@/db/accounts-categories-schema";
import {
  financialEvents,
  type FinancialEventRecord,
} from "@/db/financial-events-schema";
import {
  budgetAllocationRules,
  budgetMovements,
  budgets,
  type BudgetAllocationRuleRecord,
  type BudgetMovementRecord,
  type BudgetRecord,
} from "@/db/budgets-schema";
import type { FinancialContext } from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import type { TransactionReferenceExecutor } from "@/modules/transactions/references";

import {
  createBudgetListCursor,
  createBudgetMovementCursor,
  decodeBudgetListCursor,
  decodeBudgetMovementCursor,
  normalizeListBudgetMovementsQuery,
  normalizeListBudgetsQuery,
  BudgetReadError,
  type ListBudgetMovementsQuery,
  type ListBudgetsQuery,
  type NormalizedListBudgetMovementsQuery,
  type NormalizedListBudgetsQuery,
} from "./read-contracts";

/** A database or an already-open transaction, matching the S03 read pattern. */
export type BudgetReadExecutor = TransactionReferenceExecutor;

export interface BudgetReadQueryOptions {
  readonly database?: BudgetReadExecutor;
}

export interface BudgetQueryRow {
  readonly budget: BudgetRecord;
  readonly category: CategoryRecord | null;
}

export interface BudgetQueryPage {
  readonly rows: readonly BudgetQueryRow[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly nextCursor: string | null;
  };
}

export interface BudgetMovementQueryPage {
  readonly budget: BudgetQueryRow;
  readonly rows: readonly BudgetMovementRecord[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly nextCursor: string | null;
  };
}

export interface BudgetFinancialSourceRow {
  readonly event: FinancialEventRecord;
  readonly category: CategoryRecord;
}

function resolveExecutor(database?: BudgetReadExecutor): BudgetReadExecutor {
  return database ?? getDb();
}

function queryFailed(error: unknown): never {
  if (error instanceof BudgetReadError) throw error;
  throw new BudgetReadError("QUERY_FAILED");
}

async function safeQuery<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    return queryFailed(error);
  }
}

function normalizedListQuery(
  query: ListBudgetsQuery,
): NormalizedListBudgetsQuery {
  return normalizeListBudgetsQuery(query, {
    today: "9999-12-31",
  });
}

function normalizedMovementQuery(
  query: ListBudgetMovementsQuery,
): NormalizedListBudgetMovementsQuery {
  return normalizeListBudgetMovementsQuery(query, {
    today: "9999-12-31",
  });
}

function referenceValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 256
    ? normalized
    : undefined;
}

function budgetListPredicates(
  context: FinancialContext,
  query: NormalizedListBudgetsQuery,
): SQL<unknown>[] {
  const predicates: SQL<unknown>[] = [
    eq(budgets.householdId, context.householdId),
  ];
  if (query.status !== "ALL") {
    predicates.push(eq(budgets.status, query.status));
  }
  if (query.cursor !== undefined) {
    const cursor = decodeBudgetListCursor(query.cursor, query);
    predicates.push(
      or(
        lt(budgets.activeFrom, cursor.activeFrom),
        and(
          eq(budgets.activeFrom, cursor.activeFrom),
          lt(budgets.id, cursor.id),
        ),
      )!,
    );
  }
  return predicates;
}

function movementPredicates(
  context: FinancialContext,
  budgetId: string,
  query: NormalizedListBudgetMovementsQuery,
): SQL<unknown>[] {
  const predicates: SQL<unknown>[] = [
    eq(budgetMovements.householdId, context.householdId),
    eq(budgetMovements.budgetId, budgetId),
    lte(budgetMovements.effectiveOn, query.asOf),
  ];
  if (query.from !== undefined) {
    predicates.push(gte(budgetMovements.effectiveOn, query.from));
  }
  if (query.to !== undefined) {
    predicates.push(lte(budgetMovements.effectiveOn, query.to));
  }
  if (query.cursor !== undefined) {
    const cursor = decodeBudgetMovementCursor(query.cursor, query);
    predicates.push(
      or(
        lt(budgetMovements.effectiveOn, cursor.effectiveOn),
        and(
          eq(budgetMovements.effectiveOn, cursor.effectiveOn),
          lt(budgetMovements.id, cursor.id),
        ),
      )!,
    );
  }
  return predicates;
}

function budgetCategoryJoin(context: FinancialContext): SQL<unknown> {
  return and(
    eq(categories.id, budgets.categoryId),
    eq(categories.householdId, budgets.householdId),
    eq(categories.householdId, context.householdId),
  )!;
}

function movementBudgetJoin(context: FinancialContext): SQL<unknown> {
  return and(
    eq(budgetMovements.budgetId, budgets.id),
    eq(budgetMovements.householdId, budgets.householdId),
    eq(budgetMovements.householdId, context.householdId),
    eq(budgets.householdId, context.householdId),
  )!;
}

function allocationBudgetJoin(context: FinancialContext): SQL<unknown> {
  return and(
    eq(budgetAllocationRules.budgetId, budgets.id),
    eq(budgetAllocationRules.householdId, budgets.householdId),
    eq(budgetAllocationRules.householdId, context.householdId),
    eq(budgets.householdId, context.householdId),
  )!;
}

function financialCategoryJoin(context: FinancialContext): SQL<unknown> {
  return and(
    eq(financialEvents.categoryId, categories.id),
    eq(financialEvents.householdId, categories.householdId),
    eq(financialEvents.householdId, context.householdId),
    eq(categories.householdId, context.householdId),
  )!;
}

/** Lists only budget rows belonging to the resolved household. */
export async function listBudgetRowsForContext(
  executor: BudgetReadExecutor,
  context: FinancialContext,
  query: ListBudgetsQuery,
): Promise<BudgetQueryPage> {
  assertFinancialContext(context);
  const normalized = normalizedListQuery(query);
  return safeQuery(async () => {
    const rows = await executor
      .select({ budget: budgets, category: categories })
      .from(budgets)
      .leftJoin(categories, budgetCategoryJoin(context))
      .where(and(...budgetListPredicates(context, normalized)))
      .orderBy(desc(budgets.activeFrom), desc(budgets.id))
      .limit(normalized.limit + 1);

    const hasNextPage = rows.length > normalized.limit;
    const pageRows = rows.slice(0, normalized.limit) as BudgetQueryRow[];
    const last = pageRows[pageRows.length - 1];
    return {
      rows: pageRows,
      pageInfo: {
        hasNextPage,
        nextCursor:
          hasNextPage && last !== undefined
            ? createBudgetListCursor(
                {
                  activeFrom: last.budget.activeFrom,
                  id: last.budget.id,
                },
                normalized,
              )
            : null,
      },
    };
  });
}

/** Finds by opaque reference and deliberately treats a foreign reference as absent. */
export async function findBudgetRowForContext(
  executor: BudgetReadExecutor,
  context: FinancialContext,
  budgetReferenceId: unknown,
): Promise<BudgetQueryRow | undefined> {
  assertFinancialContext(context);
  const reference = referenceValue(budgetReferenceId);
  if (reference === undefined) return undefined;
  return safeQuery(async () => {
    const rows = await executor
      .select({ budget: budgets, category: categories })
      .from(budgets)
      .leftJoin(categories, budgetCategoryJoin(context))
      .where(
        and(
          eq(budgets.householdId, context.householdId),
          eq(budgets.referenceId, reference),
        ),
      )
      .limit(1);
    return (rows[0] as BudgetQueryRow | undefined) ?? undefined;
  });
}

export async function getBudgetRowForContext(
  executor: BudgetReadExecutor,
  context: FinancialContext,
  budgetReferenceId: unknown,
): Promise<BudgetQueryRow> {
  const row = await findBudgetRowForContext(
    executor,
    context,
    budgetReferenceId,
  );
  if (row === undefined) throw new BudgetReadError("BUDGET_NOT_FOUND", "budgetReferenceId");
  return row;
}

/**
 * Loads all persisted movements needed for derivation. The history page has a
 * bounded query below, but totals are intentionally never computed from only
 * the visible page.
 */
export async function listAllBudgetMovementRowsForContext(
  executor: BudgetReadExecutor,
  context: FinancialContext,
  budgetId: string,
  asOf: string,
): Promise<readonly BudgetMovementRecord[]> {
  assertFinancialContext(context);
  return safeQuery(async () => {
    const rows = await executor
      .select({ movement: budgetMovements })
      .from(budgetMovements)
      .innerJoin(budgets, movementBudgetJoin(context))
      .where(
        and(
          eq(budgetMovements.householdId, context.householdId),
          eq(budgetMovements.budgetId, budgetId),
          eq(budgets.householdId, context.householdId),
          lte(budgetMovements.effectiveOn, asOf),
        ),
      )
      .orderBy(asc(budgetMovements.effectiveOn), asc(budgetMovements.id));
    return rows.map((row) => row.movement) as BudgetMovementRecord[];
  });
}

/** Batch form used by the list reader to avoid one movement query per box. */
export async function listAllBudgetMovementRowsForBudgetsForContext(
  executor: BudgetReadExecutor,
  context: FinancialContext,
  budgetIds: readonly string[],
  asOf: string,
): Promise<readonly BudgetMovementRecord[]> {
  assertFinancialContext(context);
  if (budgetIds.length === 0) return [];
  return safeQuery(async () => {
    const rows = await executor
      .select({ movement: budgetMovements })
      .from(budgetMovements)
      .innerJoin(budgets, movementBudgetJoin(context))
      .where(
        and(
          eq(budgetMovements.householdId, context.householdId),
          inArray(budgetMovements.budgetId, [...budgetIds]),
          eq(budgets.householdId, context.householdId),
          lte(budgetMovements.effectiveOn, asOf),
        ),
      )
      .orderBy(
        asc(budgetMovements.budgetId),
        asc(budgetMovements.effectiveOn),
        asc(budgetMovements.id),
      );
    return rows.map((row) => row.movement) as BudgetMovementRecord[];
  });
}

/** Returns a bounded, keyset-paginated persisted history page. */
export async function listBudgetMovementRowsForContext(
  executor: BudgetReadExecutor,
  context: FinancialContext,
  budgetReferenceId: unknown,
  query: ListBudgetMovementsQuery,
): Promise<BudgetMovementQueryPage> {
  assertFinancialContext(context);
  const budget = await getBudgetRowForContext(
    executor,
    context,
    budgetReferenceId,
  );
  const normalized = normalizedMovementQuery(query);
  return safeQuery(async () => {
    const rows = await executor
      .select({ movement: budgetMovements })
      .from(budgetMovements)
      .innerJoin(budgets, movementBudgetJoin(context))
      .where(and(...movementPredicates(context, budget.budget.id, normalized)))
      .orderBy(desc(budgetMovements.effectiveOn), desc(budgetMovements.id))
      .limit(normalized.limit + 1);

    const pageRows = rows
      .slice(0, normalized.limit)
      .map((row) => row.movement) as BudgetMovementRecord[];
    const hasNextPage = rows.length > normalized.limit;
    const last = pageRows[pageRows.length - 1];
    return {
      budget,
      rows: pageRows,
      pageInfo: {
        hasNextPage,
        nextCursor:
          hasNextPage && last !== undefined
            ? createBudgetMovementCursor(
                {
                  effectiveOn: last.effectiveOn,
                  id: last.id,
                },
                normalized,
              )
            : null,
      },
    };
  });
}

/** Reads only rules before the cutoff, preserving every prior effective version. */
export async function listBudgetAllocationRuleRowsForContext(
  executor: BudgetReadExecutor,
  context: FinancialContext,
  budgetId: string,
  asOf: string,
): Promise<readonly BudgetAllocationRuleRecord[]> {
  assertFinancialContext(context);
  return safeQuery(async () => {
    const rows = await executor
      .select({ rule: budgetAllocationRules })
      .from(budgetAllocationRules)
      .innerJoin(budgets, allocationBudgetJoin(context))
      .where(
        and(
          eq(budgetAllocationRules.householdId, context.householdId),
          eq(budgetAllocationRules.budgetId, budgetId),
          eq(budgets.householdId, context.householdId),
          lte(budgetAllocationRules.effectiveFrom, asOf),
        ),
      )
      .orderBy(
        asc(budgetAllocationRules.effectiveFrom),
        asc(budgetAllocationRules.id),
      );
    return rows.map((row) => row.rule) as BudgetAllocationRuleRecord[];
  });
}

/** Loads the complete category tree for T04's date-aware resolver. */
export async function listCategoryRowsForContext(
  executor: BudgetReadExecutor,
  context: FinancialContext,
): Promise<readonly CategoryRecord[]> {
  assertFinancialContext(context);
  return safeQuery(async () => {
    const rows = await executor
      .select()
      .from(categories)
      .where(eq(categories.householdId, context.householdId))
      .orderBy(asc(categories.id));
    return rows as CategoryRecord[];
  });
}

/**
 * Reads canonical realized economic sources. Installments, payments and
 * forecast rows are intentionally not queried here: S06/S07 remain their
 * sources and T04 receives only the one economic PURCHASE/EXPENSE fact.
 */
export async function listBudgetFinancialSourceRowsForContext(
  executor: BudgetReadExecutor,
  context: FinancialContext,
  asOf: string,
): Promise<readonly BudgetFinancialSourceRow[]> {
  assertFinancialContext(context);
  return safeQuery(async () => {
    const rows = await executor
      .select({ event: financialEvents, category: categories })
      .from(financialEvents)
      .innerJoin(categories, financialCategoryJoin(context))
      .where(
        and(
          eq(financialEvents.householdId, context.householdId),
          eq(categories.householdId, context.householdId),
          inArray(financialEvents.kind, ["EXPENSE", "PURCHASE"]),
          eq(financialEvents.status, "POSTED"),
          isNotNull(financialEvents.categoryId),
          lte(financialEvents.occurredOn, asOf),
        ),
      )
      .orderBy(asc(financialEvents.occurredOn), asc(financialEvents.id));
    return rows as BudgetFinancialSourceRow[];
  });
}

export interface BudgetReadQueries {
  list(
    context: FinancialContext,
    query: NormalizedListBudgetsQuery,
  ): Promise<BudgetQueryPage>;
  find(
    context: FinancialContext,
    budgetReferenceId: unknown,
  ): Promise<BudgetQueryRow | undefined>;
  get(
    context: FinancialContext,
    budgetReferenceId: unknown,
  ): Promise<BudgetQueryRow>;
  movements(
    context: FinancialContext,
    budgetReferenceId: unknown,
    query: NormalizedListBudgetMovementsQuery,
  ): Promise<BudgetMovementQueryPage>;
  allMovements(
    context: FinancialContext,
    budgetId: string,
    asOf: string,
  ): Promise<readonly BudgetMovementRecord[]>;
  allMovementsForBudgets(
    context: FinancialContext,
    budgetIds: readonly string[],
    asOf: string,
  ): Promise<readonly BudgetMovementRecord[]>;
  allocationRules(
    context: FinancialContext,
    budgetId: string,
    asOf: string,
  ): Promise<readonly BudgetAllocationRuleRecord[]>;
  categories(context: FinancialContext): Promise<readonly CategoryRecord[]>;
  financialSources(
    context: FinancialContext,
    asOf: string,
  ): Promise<readonly BudgetFinancialSourceRow[]>;
}

export function createBudgetReadQueries(
  database?: BudgetReadExecutor,
): BudgetReadQueries {
  const executor = () => resolveExecutor(database);
  return {
    list: (context, query) =>
      listBudgetRowsForContext(executor(), context, query),
    find: (context, budgetReferenceId) =>
      findBudgetRowForContext(executor(), context, budgetReferenceId),
    get: (context, budgetReferenceId) =>
      getBudgetRowForContext(executor(), context, budgetReferenceId),
    movements: (context, budgetReferenceId, query) =>
      listBudgetMovementRowsForContext(
        executor(),
        context,
        budgetReferenceId,
        query,
      ),
    allMovements: (context, budgetId, asOf) =>
      listAllBudgetMovementRowsForContext(executor(), context, budgetId, asOf),
    allMovementsForBudgets: (context, budgetIds, asOf) =>
      listAllBudgetMovementRowsForBudgetsForContext(
        executor(),
        context,
        budgetIds,
        asOf,
      ),
    allocationRules: (context, budgetId, asOf) =>
      listBudgetAllocationRuleRowsForContext(
        executor(),
        context,
        budgetId,
        asOf,
      ),
    categories: (context) => listCategoryRowsForContext(executor(), context),
    financialSources: (context, asOf) =>
      listBudgetFinancialSourceRowsForContext(executor(), context, asOf),
  };
}

export const createBudgetQueries = createBudgetReadQueries;
export const budgetReadQueries = createBudgetReadQueries();

/** Resolves a database only at call time, which keeps imports safe during builds. */
export function resolveBudgetReadExecutor(
  database?: Database | BudgetReadExecutor,
): BudgetReadExecutor {
  return database ?? getDb();
}

export const listBudgetsQuery = listBudgetRowsForContext;
export const findBudgetQuery = findBudgetRowForContext;
export const getBudgetQuery = getBudgetRowForContext;
export const listBudgetMovementsQuery = listBudgetMovementRowsForContext;
