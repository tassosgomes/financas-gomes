/**
 * Server-side preparation for the S08 reserve port.
 *
 * This module maps the tenant-safe T05/T06 persistence read to the
 * persistence-free `s09.v1` adapter. It carries only opaque movement/source
 * references across the handoff; expense, refund, installment, transfer and
 * correction semantics remain owned by T07/T04.
 */
import type { BudgetMovementRecord } from "@/db/budgets-schema";
import type { FinancialContext } from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";

import {
  createMovementReserveAdapter,
  RESERVE_RULE,
  type ReserveAdapterContext,
  type ReserveBoxInput,
  type ReserveMovementInput,
  type SpendableReserveAdapter,
} from "@/modules/spendable/reserve-adapter";
import {
  MAX_BUDGET_PAGE_LIMIT,
  normalizeBudgetReadDate,
  BudgetReadError,
} from "./read-contracts";
import {
  createBudgetReadQueries,
  type BudgetReadQueries,
  type BudgetReadExecutor,
  type BudgetQueryRow,
} from "./query";

/** The T05 queries needed by this preparation boundary, kept narrow for tests. */
export type BudgetReserveQueries = Pick<
  BudgetReadQueries,
  "list" | "allMovementsForBudgets"
>;

export interface BudgetReserveSourceOptions {
  /** An injected T05 query port; production resolves it lazily when absent. */
  readonly queries?: BudgetReserveQueries;
  /** Optional T05 database/transaction executor for server composition. */
  readonly database?: BudgetReadExecutor;
}

function queryFailure(): never {
  throw new BudgetReadError("QUERY_FAILED");
}

function reserveAsOf(context: ReserveAdapterContext): string {
  return normalizeBudgetReadDate(context.asOf, "asOf");
}

function movementInput(
  movement: BudgetMovementRecord,
  budget: BudgetQueryRow["budget"],
  context: FinancialContext,
  movementsById: ReadonlyMap<string, BudgetMovementRecord>,
): ReserveMovementInput {
  if (
    movement.householdId !== context.householdId ||
    movement.budgetId !== budget.id
  ) {
    return queryFailure();
  }

  const lineage = new Set<string>();
  const collectLineage = (
    candidate: BudgetMovementRecord,
    visited: ReadonlySet<string> = new Set(),
  ): void => {
    if (visited.has(candidate.id)) return;
    const nextVisited = new Set(visited);
    nextVisited.add(candidate.id);
    for (const reference of [
      candidate.sourceReferenceId,
      candidate.financialEventId,
      candidate.accountEntryId,
      candidate.transferReferenceId,
    ]) {
      if (reference !== null) lineage.add(reference);
    }
    if (candidate.correctsMovementId !== null) {
      const original = movementsById.get(candidate.correctsMovementId);
      if (original !== undefined) {
        lineage.add(original.referenceId);
        collectLineage(original, nextVisited);
      }
    }
  };
  collectLineage(movement);

  return {
    referenceId: movement.referenceId,
    boxReferenceId: budget.referenceId,
    kind: movement.kind,
    amountCents: movement.amountCents,
    effectiveOn: movement.effectiveOn,
    ...(lineage.size > 0
      ? { reconciliationReferenceIds: [...lineage].sort() }
      : {}),
  };
}

/**
 * Maps one tenant-safe T05 budget row and its complete movement read.
 * Metadata such as names, categories, and household IDs is deliberately not
 * part of the S08 provider boundary.
 */
export function mapBudgetRowToReserveBox(
  row: BudgetQueryRow,
  movements: readonly BudgetMovementRecord[],
  context: FinancialContext,
): ReserveBoxInput {
  assertFinancialContext(context);
  const budget = row.budget;
  if (budget.householdId !== context.householdId) return queryFailure();
  const movementsById = new Map(
    movements.map((candidate) => [candidate.id, candidate]),
  );

  return {
    rule: RESERVE_RULE,
    boxReferenceId: budget.referenceId,
    status: budget.status,
    activeFrom: budget.activeFrom,
    closedOn: budget.closedOn,
    movements: movements
      .map((movement) =>
        movementInput(
          movement,
          budget,
          context,
          movementsById,
        ),
      )
      .sort((left, right) => {
        const dateOrder = String(left.effectiveOn).localeCompare(
          String(right.effectiveOn),
        );
        if (dateOrder !== 0) return dateOrder;
        return left.referenceId.localeCompare(right.referenceId);
      }),
  };
}

function resolveQueries(options: BudgetReserveSourceOptions): BudgetReserveQueries {
  return options.queries ?? createBudgetReadQueries(options.database);
}

async function listAllBudgetRows(
  context: FinancialContext,
  asOf: string,
  queries: BudgetReserveQueries,
): Promise<readonly BudgetQueryRow[]> {
  const rows: BudgetQueryRow[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (;;) {
    const page = await queries.list(context, {
      status: "ALL",
      asOf,
      limit: MAX_BUDGET_PAGE_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    rows.push(...page.rows);
    if (!page.pageInfo.hasNextPage) return rows;

    const nextCursor = page.pageInfo.nextCursor;
    if (nextCursor === null || seenCursors.has(nextCursor)) return queryFailure();
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

/**
 * Reads only persisted T06/T07 movement rows available through T05.  The
 * returned inputs are still interpreted by `deriveReserveSnapshot`, so no
 * protected amount or balance is persisted or copied from a read DTO.
 */
export async function listBudgetReserveBoxesForContext(
  context: FinancialContext,
  reserveContext: ReserveAdapterContext,
  options: BudgetReserveSourceOptions = {},
): Promise<readonly ReserveBoxInput[]> {
  assertFinancialContext(context);
  const asOf = reserveAsOf(reserveContext);
  const queries = resolveQueries(options);
  const rows = await listAllBudgetRows(context, asOf, queries);
  if (rows.length === 0) return [];

  const budgetIds = rows.map(({ budget }) => {
    if (budget.householdId !== context.householdId) return queryFailure();
    return budget.id;
  });
  const knownBudgetIds = new Set(budgetIds);
  const movements = await queries.allMovementsForBudgets(
    context,
    budgetIds,
    asOf,
  );
  const byBudget = new Map<string, BudgetMovementRecord[]>();
  for (const movement of movements) {
    if (
      movement.householdId !== context.householdId ||
      !knownBudgetIds.has(movement.budgetId)
    ) {
      return queryFailure();
    }
    const bucket = byBudget.get(movement.budgetId) ?? [];
    bucket.push(movement);
    byBudget.set(movement.budgetId, bucket);
  }

  return rows
    .map((row) => mapBudgetRowToReserveBox(
      row,
      byBudget.get(row.budget.id) ?? [],
      context,
    ))
    .sort((left, right) => left.boxReferenceId.localeCompare(right.boxReferenceId));
}

/**
 * Captures the authenticated FinancialContext before entering the S08 port.
 * The adapter callback itself receives only `ReserveAdapterContext`, so a
 * browser cannot select a household through the versioned contract.
 */
export function createBudgetReserveAdapter(
  context: FinancialContext,
  options: BudgetReserveSourceOptions = {},
): SpendableReserveAdapter {
  assertFinancialContext(context);
  const queries = resolveQueries(options);
  return createMovementReserveAdapter((reserveContext) =>
    listBudgetReserveBoxesForContext(context, reserveContext, { queries }),
  );
}

export const createS09BudgetReserveAdapter = createBudgetReserveAdapter;
export const readBudgetReserveBoxes = listBudgetReserveBoxesForContext;
