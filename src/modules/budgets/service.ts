import type { FinancialContext } from "@/modules/households/contracts";
import { requireFinancialContext } from "@/modules/households/context";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import {
  instrumentS09BudgetReadAccess,
  type S09BudgetReadBoundaryOptions,
} from "@/modules/observability/s09";
import type { BudgetMovementRecord } from "@/db/budgets-schema";

import {
  resolveBudgetFinancialEffects,
  resolveEffectiveAllocationRules,
  resolveBudgetTemporalState,
  serializeAllocationRule,
  type AllocationBudgetReferenceInput,
  type AllocationCategoryInput,
  type BudgetFinancialSourceInput,
} from "./allocation-rules";
import {
  deriveBoxBalance,
  deriveBudgetPeriodSummary,
  deriveBudgetProgress,
  serializeBudgetBalance,
  serializeBudgetPeriod,
  serializeBudgetProgress,
} from "./balance";
import {
  normalizeBudget,
  normalizeBudgetMovement,
  parseBudgetDate,
  serializeBudget,
  serializeBudgetDate,
  serializeBudgetMovement,
  sortBudgetMovements,
} from "./domain";
import type {
  Budget,
  BudgetInput,
  BudgetMovement,
  BudgetMovementInput,
} from "./contracts";
import {
  BudgetReadError,
  budgetReadFailure,
  budgetReadOk,
  createBudgetMovementCursor,
  decodeBudgetMovementCursor,
  normalizeListBudgetMovementsQuery,
  normalizeListBudgetsQuery,
  toBudgetReadError,
  type BudgetDetailReadModel,
  type BudgetCategoryReadModel,
  type BudgetHistoryReadModel,
  type BudgetListItemReadModel,
  type BudgetMovementPageReadModel,
  type BudgetReadResult,
  type BudgetReadClock,
  type ListBudgetMovementsQuery,
  type ListBudgetsQuery,
  type ListBudgetsReadModel,
  type NormalizedListBudgetMovementsQuery,
  type NormalizedListBudgetsQuery,
} from "./read-contracts";
import {
  createBudgetReadQueries,
  type BudgetFinancialSourceRow,
  type BudgetQueryRow,
  type BudgetReadExecutor,
  type BudgetReadQueries,
} from "./query";

export interface BudgetReadServiceDependencies extends BudgetReadClock {
  readonly database?: BudgetReadExecutor;
  /** Injectable composition seam used by unit tests and transaction callers. */
  readonly queries?: BudgetReadQueries;
  /** Safe S09 metadata/hooks; read payloads are never inspected by the adapter. */
  readonly observability?: S09BudgetReadBoundaryOptions;
  /** Server-owned resolver; browser inputs never become tenant authority. */
  readonly resolveContext?: (
    requestHeaders?: HeadersInit,
  ) => Promise<FinancialContext> | FinancialContext;
  readonly requestHeaders?: HeadersInit;
}

interface CanonicalMovement {
  readonly movement: BudgetMovement;
  readonly id: string;
}

interface DerivedBudgetSnapshot {
  readonly budget: Budget;
  readonly category: BudgetListItemReadModel["category"];
  readonly balance: ReturnType<typeof serializeBudgetBalance>;
  readonly progress: ReturnType<typeof serializeBudgetProgress>;
  readonly period: ReturnType<typeof serializeBudgetPeriod> | null;
  readonly movements: readonly CanonicalMovement[];
  readonly virtualMovementCount: number;
}

function resolveQueries(
  dependencies: BudgetReadServiceDependencies,
): BudgetReadQueries {
  return dependencies.queries ?? createBudgetReadQueries(dependencies.database);
}

function normalizeClock(
  dependencies: BudgetReadServiceDependencies,
): BudgetReadClock {
  return {
    today: dependencies.clock?.() ?? dependencies.today,
  };
}

function normalizeListQuery(
  input: unknown,
  dependencies: BudgetReadServiceDependencies,
): NormalizedListBudgetsQuery {
  return normalizeListBudgetsQuery(input, normalizeClock(dependencies));
}

function normalizeMovementQuery(
  input: unknown,
  dependencies: BudgetReadServiceDependencies,
): NormalizedListBudgetMovementsQuery {
  return normalizeListBudgetMovementsQuery(
    input,
    normalizeClock(dependencies),
  );
}

function mapCategory(
  row: BudgetQueryRow,
  context: FinancialContext,
): BudgetListItemReadModel["category"] {
  const category = row.category;
  if (category === null) return null;
  if (
    category.householdId !== context.householdId ||
    category.id !== row.budget.categoryId ||
    (category.kind !== "EXPENSE" && category.kind !== "INCOME") ||
    (category.status !== "ACTIVE" && category.status !== "ARCHIVED")
  ) {
    throw new BudgetReadError("CATEGORY_NOT_FOUND", "categoryId");
  }
  return {
    referenceId: category.id,
    name: category.name,
    parentReferenceId: category.parentId,
    kind: category.kind,
    status: category.status,
  };
}

function budgetInputFromRow(row: BudgetQueryRow): BudgetInput {
  const record = row.budget;
  return {
    referenceId: record.referenceId,
    name: record.name,
    categoryId: record.categoryId,
    status: record.status,
    activeFrom: record.activeFrom,
    closedOn: record.closedOn,
    targetAmountCents: record.targetAmountCents,
    targetDate: record.targetDate,
    householdId: record.householdId,
  };
}

function normalizeBudgetForRow(
  row: BudgetQueryRow,
  context: FinancialContext,
): Budget {
  if (row.budget.householdId !== context.householdId) {
    throw new BudgetReadError("BUDGET_NOT_FOUND", "budgetReferenceId");
  }
  return normalizeBudget(budgetInputFromRow(row));
}

function allocationBudgetFromRow(
  budget: Budget,
  category: BudgetListItemReadModel["category"],
): AllocationBudgetReferenceInput {
  return {
    referenceId: budget.referenceId,
    categoryId: budget.categoryId,
    activeFrom: budget.activeFrom,
    closedOn: budget.closedOn,
    status: budget.status,
    categoryStatus: category?.status,
    categoryArchivedOn: null,
    category: category
      ? {
          id: category.referenceId,
          parentId: category.parentReferenceId,
          kind: category.kind,
          status: category.status,
        }
      : null,
  };
}

function categoriesForAllocation(
  rows: readonly (BudgetCategoryReadModel | null)[],
  allRows: readonly (BudgetCategoryReadModel | null)[],
): readonly AllocationCategoryInput[] {
  const source = allRows.length > 0 ? allRows : rows;
  return source.flatMap((category) =>
    category === null
      ? []
      : [
          {
            id: category.referenceId,
            parentId: category.parentReferenceId,
            kind: category.kind,
            status: category.status,
          },
        ],
  );
}

function mapSourceRow(
  row: BudgetFinancialSourceRow,
  context: FinancialContext,
): BudgetFinancialSourceInput {
  const event = row.event;
  if (
    event.householdId !== context.householdId ||
    row.category.householdId !== context.householdId ||
    row.category.id !== event.categoryId ||
    event.categoryId === null ||
    (event.kind !== "EXPENSE" && event.kind !== "PURCHASE")
  ) {
    throw new BudgetReadError("QUERY_FAILED");
  }
  return {
    kind: event.kind,
    sourceKind: event.kind,
    referenceId: event.id,
    sourceReferenceId: event.id,
    financialEventId: event.id,
    categoryId: event.categoryId,
    amountCents: event.amountCents,
    occurredOn: event.occurredOn,
    effectiveOn: event.occurredOn,
    status: event.status,
    origin: event.origin,
  };
}

function mapCategoryRowsForContext(
  rows: readonly import("@/db/accounts-categories-schema").CategoryRecord[],
  context: FinancialContext,
): readonly BudgetCategoryReadModel[] {
  return rows.map((category) => {
    if (
      category.householdId !== context.householdId ||
      (category.kind !== "EXPENSE" && category.kind !== "INCOME") ||
      (category.status !== "ACTIVE" && category.status !== "ARCHIVED")
    ) {
      throw new BudgetReadError("CATEGORY_NOT_FOUND", "categoryId");
    }
    return {
      referenceId: category.id,
      name: category.name,
      parentReferenceId: category.parentId,
      kind: category.kind,
      status: category.status,
    };
  });
}

function persistedMovementInput(
  record: BudgetMovementRecord,
  budget: Budget,
  budgetId: string,
  context: FinancialContext,
  referenceById?: ReadonlyMap<string, string>,
): BudgetMovementInput {
  if (
    record.householdId !== context.householdId ||
    record.budgetId !== budgetId
  ) {
    // The budget id relation is checked by the query and again by the caller;
    // this branch only prevents malformed test adapters from leaking rows.
    throw new BudgetReadError("QUERY_FAILED");
  }
  return {
    referenceId: record.referenceId,
    boxReferenceId: budget.referenceId,
    kind: record.kind,
    amountCents: record.amountCents,
    effectiveOn: record.effectiveOn,
    correctsReferenceId:
      record.correctsMovementId === null
        ? null
        : referenceById?.get(record.correctsMovementId) ?? record.correctsMovementId,
    transferReferenceId: record.transferReferenceId,
    sourceReferenceId: record.sourceReferenceId,
  };
}

function serializePersistedMovement(
  record: BudgetMovementRecord,
  budget: Budget,
  budgetId: string,
  context: FinancialContext,
  referenceById?: ReadonlyMap<string, string>,
): BudgetMovement {
  return normalizeBudgetMovement(
    persistedMovementInput(record, budget, budgetId, context, referenceById),
  );
}

function mergeCanonicalMovements(
  budget: Budget,
  budgetId: string,
  persistedRows: readonly BudgetMovementRecord[],
  effects: ReturnType<typeof resolveBudgetFinancialEffects>["effects"],
  context: FinancialContext,
): { readonly movements: readonly CanonicalMovement[]; readonly virtualCount: number } {
  const seen = new Set<string>();
  const canonical: CanonicalMovement[] = [];
  const referenceById = new Map(
    persistedRows.map((record) => [record.id, record.referenceId]),
  );
  for (const row of persistedRows) {
    const movement = serializePersistedMovement(
      row,
      budget,
      budgetId,
      context,
      referenceById,
    );
    if (seen.has(movement.referenceId)) {
      throw new BudgetReadError("QUERY_FAILED");
    }
    seen.add(movement.referenceId);
    if (movement.sourceReferenceId !== null) seen.add(movement.sourceReferenceId);
    canonical.push({ movement, id: row.id });
  }

  let virtualCount = 0;
  for (const effect of effects) {
    if (effect.boxReferenceId !== budget.referenceId || !effect.balanceEligible) {
      continue;
    }
    if (seen.has(effect.referenceId) || seen.has(effect.sourceReferenceId)) {
      continue;
    }
    const movement = normalizeBudgetMovement({
      referenceId: effect.referenceId,
      boxReferenceId: budget.referenceId,
      kind: effect.kind,
      amountCents: effect.amountCents,
      effectiveOn: effect.effectiveOn,
      sourceReferenceId: effect.sourceReferenceId,
    });
    seen.add(movement.referenceId);
    seen.add(effect.sourceReferenceId);
    canonical.push({ movement, id: effect.referenceId });
    virtualCount += 1;
  }

  const ordered = sortBudgetMovements(
    canonical.map((entry) => entry.movement),
    budget,
  );
  const byReference = new Map(canonical.map((entry) => [entry.movement.referenceId, entry]));
  return {
    movements: Object.freeze(
      ordered.map((movement) => byReference.get(movement.referenceId) as CanonicalMovement),
    ),
    virtualCount,
  };
}

function deriveSnapshot(
  row: BudgetQueryRow,
  persistedRows: readonly BudgetMovementRecord[],
  sourceRows: readonly BudgetFinancialSourceRow[],
  categoryRows: readonly BudgetListItemReadModel["category"][],
  asOf: string,
  period: { readonly from: string; readonly to: string } | null,
  context: FinancialContext,
): DerivedBudgetSnapshot {
  const budget = normalizeBudgetForRow(row, context);
  const category = mapCategory(row, context);
  const allocationBudget = allocationBudgetFromRow(budget, category);
  const categories = categoriesForAllocation(
    [category],
    categoryRows,
  );
  const sources = sourceRows.map((source) => mapSourceRow(source, context));
  let effects: ReturnType<typeof resolveBudgetFinancialEffects>["effects"] = [];
  if (sources.length > 0) {
    effects = resolveBudgetFinancialEffects({
      sources,
      budgets: [allocationBudget],
      categories,
    }).effects;
  }
  const merged = mergeCanonicalMovements(
    budget,
    row.budget.id,
    persistedRows,
    effects,
    context,
  );
  const domainMovements = merged.movements.map((entry) => entry.movement);
  const balance = deriveBoxBalance(budget, domainMovements, asOf);
  const progress = deriveBudgetProgress(budget, balance.balance, asOf);
  const derivedPeriod = period
    ? deriveBudgetPeriodSummary(
        budget,
        domainMovements,
        period.from,
        period.to,
      )
    : null;
  // This resolver is intentionally called at the same cutoff used by reads;
  // T04 remains the owner of effective-dated lifecycle semantics.
  resolveBudgetTemporalState(budget, asOf);
  return {
    budget,
    category,
    balance: serializeBudgetBalance(balance),
    progress: serializeBudgetProgress(progress),
    period: derivedPeriod === null ? null : serializeBudgetPeriod(derivedPeriod),
    movements: merged.movements,
    virtualMovementCount: merged.virtualCount,
  };
}

function toListItem(snapshot: DerivedBudgetSnapshot): BudgetListItemReadModel {
  return {
    ...serializeBudget(snapshot.budget),
    category: snapshot.category,
    balance: snapshot.balance,
    progress: snapshot.progress,
    period: snapshot.period,
  };
}

/** The collection read exposes the current period without client arithmetic. */
function currentBudgetPeriod(asOf: string): { from: string; to: string } {
  const date = parseBudgetDate(asOf, "asOf");
  return {
    from: serializeBudgetDate(date.with({ day: 1 })),
    to: serializeBudgetDate(date),
  };
}

function pageCanonicalMovements(
  movements: readonly CanonicalMovement[],
  query: NormalizedListBudgetMovementsQuery,
): BudgetMovementPageReadModel {
  const filtered = movements
    .filter((entry) => {
      const date = entry.movement.effectiveOn.toString();
      return (
        date <= query.asOf &&
        (query.from === undefined || date >= query.from) &&
        (query.to === undefined || date <= query.to)
      );
    })
    .sort((left, right) => {
      const leftDate = left.movement.effectiveOn.toString();
      const rightDate = right.movement.effectiveOn.toString();
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
      return right.id.localeCompare(left.id);
    });

  let afterCursor = filtered;
  if (query.cursor !== undefined) {
    // Query-level pagination validates the cursor against the same filters;
    // this call also prevents a forged cursor from changing the page window.
    const cursor = decodeBudgetMovementCursor(query.cursor, query);
    afterCursor = filtered.filter((entry) => {
      const date = entry.movement.effectiveOn.toString();
      return (
        date < cursor.effectiveOn ||
        (date === cursor.effectiveOn && entry.id < cursor.id)
      );
    });
  }
  const hasNextPage = afterCursor.length > query.limit;
  const items = afterCursor.slice(0, query.limit).map((entry) => serializeBudgetMovement(entry.movement));
  const last = afterCursor[query.limit - 1];
  return {
    items,
    pageInfo: {
        hasNextPage,
        nextCursor:
          hasNextPage && last !== undefined
          ? createBudgetMovementCursor(
              {
                effectiveOn: last.movement.effectiveOn.toString(),
                id: last.id,
              },
              query,
            )
          : null,
    },
  };
}

function mapAllocationRules(
  rows: readonly import("@/db/budgets-schema").BudgetAllocationRuleRecord[],
  budget: Budget,
  category: BudgetListItemReadModel["category"],
  asOf: string,
) {
  const inputs = rows.map((rule) => ({
    id: rule.id,
    referenceId: rule.id,
    budgetReferenceId: budget.referenceId,
    boxReferenceId: budget.referenceId,
    amountCents: rule.amountCents,
    effectiveFrom: rule.effectiveFrom,
    effectiveUntil: rule.effectiveUntil,
  }));
  const effective = resolveEffectiveAllocationRules({
    rules: inputs,
    asOf,
    budgets: [allocationBudgetFromRow(budget, category)],
  });
  return effective.map(serializeAllocationRule);
}

async function listBudgetsInContext(
  context: FinancialContext,
  input: ListBudgetsQuery,
  dependencies: BudgetReadServiceDependencies,
): Promise<ListBudgetsReadModel> {
  assertFinancialContext(context);
  const query = normalizeListQuery(input, dependencies);
  const queries = resolveQueries(dependencies);
  const page = await queries.list(context, query);
  if (page.rows.length === 0) {
    return { items: [], pageInfo: page.pageInfo };
  }
  const categories = await queries.categories(context);
  const sources = await queries.financialSources(context, query.asOf);
  const movements = await queries.allMovementsForBudgets(
    context,
    page.rows.map((row) => row.budget.id),
    query.asOf,
  );
  const byBudget = new Map<string, typeof movements[number][]>();
  for (const movement of movements) {
    const bucket = byBudget.get(movement.budgetId) ?? [];
    bucket.push(movement);
    byBudget.set(movement.budgetId, bucket);
  }
  const categoryValues = mapCategoryRowsForContext(categories, context);
  const period = currentBudgetPeriod(query.asOf);
  return {
    items: page.rows.map((row) =>
      toListItem(
        deriveSnapshot(
          row,
          byBudget.get(row.budget.id) ?? [],
          sources,
          categoryValues,
          query.asOf,
          period,
          context,
        ),
      ),
    ),
    pageInfo: page.pageInfo,
  };
}

async function getBudgetInContext(
  context: FinancialContext,
  budgetReferenceId: unknown,
  input: ListBudgetMovementsQuery,
  dependencies: BudgetReadServiceDependencies,
): Promise<BudgetDetailReadModel> {
  assertFinancialContext(context);
  const query = normalizeMovementQuery(input, dependencies);
  const queries = resolveQueries(dependencies);
  const page = await queries.movements(context, budgetReferenceId, query);
  const row = page.budget;
  const categories = await queries.categories(context);
  const categoryValues = mapCategoryRowsForContext(categories, context);
  const [allMovements, sourceRows, ruleRows] = await Promise.all([
    queries.allMovements(context, row.budget.id, query.asOf),
    queries.financialSources(context, query.asOf),
    queries.allocationRules(context, row.budget.id, query.asOf),
  ]);
  const period =
    query.from !== undefined && query.to !== undefined
      ? { from: query.from, to: query.to }
      : null;
  const snapshot = deriveSnapshot(
    row,
    allMovements,
    sourceRows,
    categoryValues,
    query.asOf,
    period,
    context,
  );
  const persistedPageOnly =
    snapshot.virtualMovementCount === 0
      ? {
          items: page.rows.map((movement) =>
            serializeBudgetMovement(
              serializePersistedMovement(
                movement,
                snapshot.budget,
                row.budget.id,
                context,
                new Map(
                  allMovements.map((record) => [record.id, record.referenceId]),
                ),
              ),
            ),
          ),
          pageInfo: page.pageInfo,
        }
      : pageCanonicalMovements(snapshot.movements, query);
  return {
    ...toListItem(snapshot),
    period: snapshot.period,
    movements: persistedPageOnly.items,
    movementPageInfo: persistedPageOnly.pageInfo,
    allocationRules: mapAllocationRules(
      ruleRows,
      snapshot.budget,
      snapshot.category,
      query.asOf,
    ),
  };
}

export async function listBudgetsForContext(
  context: FinancialContext,
  input: ListBudgetsQuery = {},
  dependencies: BudgetReadServiceDependencies = {},
): Promise<ListBudgetsReadModel> {
  try {
    return await listBudgetsInContext(context, input, dependencies);
  } catch (error) {
    throw toBudgetReadError(error);
  }
}

export async function getBudgetForContext(
  context: FinancialContext,
  budgetReferenceId: unknown,
  input: ListBudgetMovementsQuery = {},
  dependencies: BudgetReadServiceDependencies = {},
): Promise<BudgetDetailReadModel> {
  try {
    return await getBudgetInContext(
      context,
      budgetReferenceId,
      input,
      dependencies,
    );
  } catch (error) {
    throw toBudgetReadError(error);
  }
}

export async function getBudgetHistoryForContext(
  context: FinancialContext,
  budgetReferenceId: unknown,
  input: ListBudgetMovementsQuery = {},
  dependencies: BudgetReadServiceDependencies = {},
): Promise<BudgetHistoryReadModel> {
  const detail = await getBudgetForContext(
    context,
    budgetReferenceId,
    input,
    dependencies,
  );
  return {
    boxReferenceId: detail.referenceId,
    asOf: detail.balance.asOf,
    balance: detail.balance,
    period: detail.period,
    movements: {
      items: detail.movements,
      pageInfo: detail.movementPageInfo,
    },
  };
}

export async function listBudgetMovementsForContext(
  context: FinancialContext,
  budgetReferenceId: unknown,
  input: ListBudgetMovementsQuery = {},
  dependencies: BudgetReadServiceDependencies = {},
): Promise<BudgetMovementPageReadModel> {
  const detail = await getBudgetForContext(
    context,
    budgetReferenceId,
    input,
    dependencies,
  );
  return {
    items: detail.movements,
    pageInfo: detail.movementPageInfo,
  };
}

async function resolveContext(
  dependencies: BudgetReadServiceDependencies,
): Promise<FinancialContext> {
  if (dependencies.resolveContext !== undefined) {
    const context = await dependencies.resolveContext(dependencies.requestHeaders);
    assertFinancialContext(context);
    return context;
  }
  return requireFinancialContext(
    dependencies.requestHeaders === undefined
      ? {}
      : { requestHeaders: dependencies.requestHeaders },
  );
}

async function asReadResult<T>(work: () => Promise<T>): Promise<BudgetReadResult<T>> {
  try {
    return budgetReadOk(await work());
  } catch (error) {
    const mapped = toBudgetReadError(error);
    return budgetReadFailure(mapped.code, mapped.field);
  }
}

export interface BudgetReadUseCasePort {
  list(
    context: FinancialContext,
    input?: ListBudgetsQuery,
  ): Promise<BudgetReadResult<ListBudgetsReadModel>>;
  detail(
    context: FinancialContext,
    budgetReferenceId: unknown,
    input?: ListBudgetMovementsQuery,
  ): Promise<BudgetReadResult<BudgetDetailReadModel>>;
  history(
    context: FinancialContext,
    budgetReferenceId: unknown,
    input?: ListBudgetMovementsQuery,
  ): Promise<BudgetReadResult<BudgetHistoryReadModel>>;
  movements(
    context: FinancialContext,
    budgetReferenceId: unknown,
    input?: ListBudgetMovementsQuery,
  ): Promise<BudgetReadResult<BudgetMovementPageReadModel>>;
}

export function createBudgetReadUseCases(
  dependencies: BudgetReadServiceDependencies = {},
): BudgetReadUseCasePort {
  const access: BudgetReadUseCasePort = {
    list: (context, input = {}) =>
      asReadResult(() => listBudgetsInContext(context, input, dependencies)),
    detail: (context, budgetReferenceId, input = {}) =>
      asReadResult(() =>
        getBudgetInContext(context, budgetReferenceId, input, dependencies),
      ),
    history: (context, budgetReferenceId, input = {}) =>
      asReadResult(() =>
        getBudgetHistoryForContext(
          context,
          budgetReferenceId,
          input,
          dependencies,
        ),
      ),
    movements: (context, budgetReferenceId, input = {}) =>
      asReadResult(() =>
        listBudgetMovementsForContext(
          context,
          budgetReferenceId,
          input,
          dependencies,
        ),
      ),
  };
  return instrumentS09BudgetReadAccess(access, dependencies.observability);
}

export interface BudgetReadAccess {
  list(input?: ListBudgetsQuery): Promise<BudgetReadResult<ListBudgetsReadModel>>;
  detail(
    budgetReferenceId: unknown,
    input?: ListBudgetMovementsQuery,
  ): Promise<BudgetReadResult<BudgetDetailReadModel>>;
  history(
    budgetReferenceId: unknown,
    input?: ListBudgetMovementsQuery,
  ): Promise<BudgetReadResult<BudgetHistoryReadModel>>;
  movements(
    budgetReferenceId: unknown,
    input?: ListBudgetMovementsQuery,
  ): Promise<BudgetReadResult<BudgetMovementPageReadModel>>;
}

export function createBudgetReadAccess(
  dependencies: BudgetReadServiceDependencies = {},
): BudgetReadAccess {
  const access: BudgetReadAccess = {
    list: async (input = {}) => {
      return asReadResult(async () =>
        listBudgetsInContext(await resolveContext(dependencies), input, dependencies),
      );
    },
    detail: async (budgetReferenceId, input = {}) => {
      return asReadResult(async () =>
        getBudgetInContext(
          await resolveContext(dependencies),
          budgetReferenceId,
          input,
          dependencies,
        ),
      );
    },
    history: async (budgetReferenceId, input = {}) => {
      return asReadResult(async () =>
        getBudgetHistoryForContext(
          await resolveContext(dependencies),
          budgetReferenceId,
          input,
          dependencies,
        ),
      );
    },
    movements: async (budgetReferenceId, input = {}) => {
      return asReadResult(async () =>
        listBudgetMovementsForContext(
          await resolveContext(dependencies),
          budgetReferenceId,
          input,
          dependencies,
        ),
      );
    },
  };
  return instrumentS09BudgetReadAccess(access, dependencies.observability);
}

export const budgetReadUseCases = createBudgetReadUseCases();
export const budgetReadAccess = createBudgetReadAccess();
export const budgetService = budgetReadAccess;

/** Result-returning public aliases used by server actions/routes. */
export const listBudgets = (
  input: ListBudgetsQuery = {},
  dependencies: BudgetReadServiceDependencies = {},
) => createBudgetReadAccess(dependencies).list(input);

export const getBudget = (
  budgetReferenceId: unknown,
  input: ListBudgetMovementsQuery = {},
  dependencies: BudgetReadServiceDependencies = {},
) => createBudgetReadAccess(dependencies).detail(budgetReferenceId, input);

export const getBudgetHistory = (
  budgetReferenceId: unknown,
  input: ListBudgetMovementsQuery = {},
  dependencies: BudgetReadServiceDependencies = {},
) => createBudgetReadAccess(dependencies).history(budgetReferenceId, input);

export const getBudgetMovements = (
  budgetReferenceId: unknown,
  input: ListBudgetMovementsQuery = {},
  dependencies: BudgetReadServiceDependencies = {},
) => createBudgetReadAccess(dependencies).movements(budgetReferenceId, input);

export type { BudgetReadExecutor } from "./query";
