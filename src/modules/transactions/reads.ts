import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  accountEntries,
  financialEvents,
  type FinancialEventRecord,
} from "@/db/financial-events-schema";
import {
  accounts,
  categories,
  type AccountRecord,
  type CategoryRecord,
} from "@/db/accounts-categories-schema";
import { isUuidV7 } from "@/lib/uuidv7";
import {
  assertFinancialContext,
  withFinancialContext,
} from "@/modules/households/tenant-scoped";
import type {
  FinancialContext,
  RequireFinancialContextOptions,
} from "@/modules/households/contracts";
import type {
  AccountReadModel,
  CategoryReadModel,
} from "@/modules/accounts-categories/contracts";

import {
  ACCOUNT_ENTRY_STATUSES,
  FINANCIAL_EVENT_KINDS,
  MANUAL_TRANSACTION_KINDS,
  TransactionDomainError,
  failure,
  ok,
  type AccountBalanceReadModel,
  type AccountMovementReadModel,
  type FinancialEventKind,
  type FinancialEventStatus,
  type ListAccountMovementsQuery,
  type ListAccountMovementsReadModel,
  type ListManualTransactionsQuery,
  type ListManualTransactionsReadModel,
  type ManualTransactionDetailReadModel,
  type ManualTransactionEntryReadModel,
  type ManualTransactionListItemReadModel,
  type ManualTransactionReadModel,
  type ManualTransactionKind,
  type TransactionResult,
} from "./contracts";
import {
  compareFinancialDates,
  currentFinancialDate,
  formatFinancialDate,
  parseFinancialDate,
  type FinancialDate,
} from "./dates";
import type { TransactionReferenceExecutor } from "./references";

/**
 * Read queries use the same executor union as T04. This makes the functions
 * safe to call inside a T05/T07 transaction while the normal public factory
 * remains database-backed and does not open a nested transaction.
 */
export type TransactionReadExecutor = TransactionReferenceExecutor;

type ManualTransactionJoinRow = {
  event: FinancialEventRecord;
  entry: typeof accountEntries.$inferSelect;
  account: AccountRecord;
  category: CategoryRecord | null;
};

/**
 * S03 read models intentionally expose only realized/cancelled events. S06
 * extends the persistence enum with future/payment kinds, so keep the old
 * public boundary explicit instead of allowing those values to leak through
 * a broad Drizzle row type.
 */
const MANUAL_TRANSACTION_READ_STATUSES = ["POSTED", "CANCELLED"] as const;
type ManualTransactionReadStatus =
  (typeof MANUAL_TRANSACTION_READ_STATUSES)[number];

interface NormalizedDateRange {
  from?: string;
  to?: string;
}

interface NormalizedManualTransactionQuery extends NormalizedDateRange {
  accountId?: string;
  categoryId?: string;
  categoryIsNull: boolean;
  kind?: (typeof MANUAL_TRANSACTION_KINDS)[number];
  status?: ManualTransactionReadStatus;
}

interface NormalizedMovementQuery extends NormalizedDateRange {
  categoryId?: string;
  categoryIsNull: boolean;
  kind?: FinancialEventKind;
  status?: ManualTransactionReadStatus;
}

function resolveDatabase(database?: Database): Database {
  return database ?? getDb();
}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toCents(value: bigint | number | string): string {
  return typeof value === "bigint" ? value.toString(10) : String(value);
}

function requirePostedOn(value: string | null): string {
  if (typeof value !== "string" || value.length === 0) {
    // This indicates a corrupted row or a migration drift, not a user input
    // error. Keeping it unexpected prevents a fabricated balance/read model.
    throw new Error("Um entry POSTED não possui posted_on.");
  }
  return value;
}

function requireExpectedOnNull(value: string | null): null {
  if (value !== null) {
    throw new Error("Um entry realizado não pode possuir expected_on.");
  }
  return null;
}

function toAccountReadModel(record: AccountRecord): AccountReadModel {
  return {
    id: record.id,
    householdId: record.householdId,
    name: record.name,
    type: record.type,
    status: record.status,
    spendability: record.spendability,
    liquidity: record.liquidity,
    includeInNetWorth: record.includeInNetWorth,
    trackingStartedOn: record.trackingStartedOn,
    createdAt: toIsoTimestamp(record.createdAt),
    updatedAt: toIsoTimestamp(record.updatedAt),
  };
}

function toCategoryReadModel(record: CategoryRecord): CategoryReadModel {
  return {
    id: record.id,
    householdId: record.householdId,
    name: record.name,
    parentId: record.parentId,
    kind: record.kind,
    status: record.status,
    createdAt: toIsoTimestamp(record.createdAt),
    updatedAt: toIsoTimestamp(record.updatedAt),
  };
}

function toManualEntryReadModel(
  entry: typeof accountEntries.$inferSelect,
): ManualTransactionEntryReadModel {
  if (entry.status !== "POSTED") {
    throw new Error("O read model manual recebeu um entry não POSTED.");
  }

  return {
    id: entry.id,
    amountCents: toCents(entry.amountCents),
    status: "POSTED",
    postedOn: requirePostedOn(entry.postedOn),
  };
}

function assertManualEvent(
  event: FinancialEventRecord,
): asserts event is FinancialEventRecord & {
  kind: ManualTransactionKind;
  origin: "MANUAL";
  status: ManualTransactionReadStatus;
} {
  if (
    (event.kind !== "EXPENSE" && event.kind !== "INCOME") ||
    event.origin !== "MANUAL" ||
    (event.status !== "POSTED" && event.status !== "CANCELLED")
  ) {
    throw new Error("O read model manual recebeu um evento não manual.");
  }
}

function toManualTransactionReadModel(
  row: ManualTransactionJoinRow,
  reversal: FinancialEventRecord | null,
): ManualTransactionListItemReadModel {
  assertManualEvent(row.event);

  const event = row.event;
  const category = row.category ? toCategoryReadModel(row.category) : null;
  const value: ManualTransactionReadModel = {
    id: event.id,
    householdId: event.householdId,
    kind: event.kind,
    status: event.status,
    origin: "MANUAL",
    amountCents: toCents(event.amountCents),
    occurredOn: event.occurredOn,
    description: event.description,
    accountId: row.account.id,
    categoryId: event.categoryId,
    entry: toManualEntryReadModel(row.entry),
    reversal: reversal
      ? {
          id: reversal.id,
          amountCents: toCents(reversal.amountCents),
          origin: "SYSTEM",
          status: "POSTED",
          occurredOn: reversal.occurredOn,
        }
      : null,
    createdAt: toIsoTimestamp(event.createdAt),
    updatedAt: toIsoTimestamp(event.updatedAt),
  };

  return {
    ...value,
    account: toAccountReadModel(row.account),
    category,
  };
}

type StatementEventRecord = FinancialEventRecord & {
  kind: FinancialEventKind;
  status: FinancialEventStatus;
};

function assertStatementEvent(
  event: FinancialEventRecord,
): asserts event is StatementEventRecord {
  if (
    (event.kind !== "EXPENSE" &&
      event.kind !== "INCOME" &&
      event.kind !== "REVERSAL") ||
    (event.status !== "POSTED" && event.status !== "CANCELLED")
  ) {
    throw new Error("O extrato recebeu um evento fora do contrato de transações.");
  }
}

function toEventMovementSummary(event: StatementEventRecord) {
  return {
    id: event.id,
    kind: event.kind,
    status: event.status,
    origin: event.origin,
    amountCents: toCents(event.amountCents),
    occurredOn: event.occurredOn,
    description: event.description,
    categoryId: event.categoryId,
    reversalOfEventId: event.reversalOfEventId,
    createdAt: toIsoTimestamp(event.createdAt),
    updatedAt: toIsoTimestamp(event.updatedAt),
  };
}

function toAccountMovementReadModel(
  event: FinancialEventRecord,
  entry: typeof accountEntries.$inferSelect,
  account: AccountRecord,
  category: CategoryRecord | null,
): AccountMovementReadModel {
  assertStatementEvent(event);

  if (entry.status !== "POSTED") {
    throw new Error("O extrato recebeu um entry não POSTED.");
  }

  return {
    id: entry.id,
    financialEventId: event.id,
    accountId: account.id,
    householdId: event.householdId,
    amountCents: toCents(entry.amountCents),
    status: "POSTED",
    expectedOn: requireExpectedOnNull(entry.expectedOn),
    postedOn: requirePostedOn(entry.postedOn),
    occurredOn: event.occurredOn,
    kind: event.kind,
    origin: event.origin,
    description: event.description,
    categoryId: event.categoryId,
    account: toAccountReadModel(account),
    category: category ? toCategoryReadModel(category) : null,
    event: toEventMovementSummary(event),
  };
}

function scalarQueryValue(
  query: Record<string, unknown>,
  key: string,
): unknown {
  const value = query[key];
  if (Array.isArray(value)) {
    throw new TransactionDomainError("INVALID_COMMAND");
  }
  return value;
}

function firstDefinedQueryValue(
  query: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  const values = keys
    .map((key) => scalarQueryValue(query, key))
    .filter((value): value is string => value !== undefined);

  if (values.length > 1 && values.some((value) => value !== values[0])) {
    throw new TransactionDomainError("INVALID_COMMAND");
  }
  return values[0];
}

function normalizeDateFilter(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TransactionDomainError("INVALID_DATE", "occurredOn");
  }
  return formatFinancialDate(parseFinancialDate(value));
}

function normalizeDateRange(query: Record<string, unknown>): NormalizedDateRange {
  const rawPeriod = scalarQueryValue(query, "period");
  let periodFrom: unknown;
  let periodTo: unknown;
  if (rawPeriod !== undefined) {
    if (
      typeof rawPeriod !== "object" ||
      rawPeriod === null ||
      Array.isArray(rawPeriod)
    ) {
      throw new TransactionDomainError("INVALID_COMMAND");
    }
    const period = rawPeriod as Record<string, unknown>;
    periodFrom = period.from;
    periodTo = period.to;
    if (Object.keys(period).some((key) => key !== "from" && key !== "to")) {
      throw new TransactionDomainError("INVALID_COMMAND");
    }
  }
  const queryWithPeriodAliases: Record<string, unknown> = {
    ...query,
    ...(periodFrom === undefined ? {} : { __periodFrom: periodFrom }),
    ...(periodTo === undefined ? {} : { __periodTo: periodTo }),
  };
  const from = normalizeDateFilter(
    firstDefinedQueryValue(queryWithPeriodAliases, [
      "from",
      "occurredOnFrom",
      "dateFrom",
      "startDate",
      "effectiveDateFrom",
      "periodStart",
      "__periodFrom",
    ]),
  );
  const to = normalizeDateFilter(
    firstDefinedQueryValue(queryWithPeriodAliases, [
      "to",
      "occurredOnTo",
      "dateTo",
      "endDate",
      "effectiveDateTo",
      "periodEnd",
      "__periodTo",
    ]),
  );

  if (
    from !== undefined &&
    to !== undefined &&
    compareFinancialDates(parseFinancialDate(from), parseFinancialDate(to)) > 0
  ) {
    throw new TransactionDomainError("INVALID_COMMAND");
  }

  return { from, to };
}

function normalizeResourceFilter(
  value: unknown,
  field: "accountId" | "categoryId",
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TransactionDomainError("INVALID_COMMAND", field);
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  if (!isUuidV7(normalized)) {
    throw new TransactionDomainError("INVALID_COMMAND", field);
  }
  return normalized;
}

function normalizeStatus(value: unknown): ManualTransactionReadStatus | undefined {
  if (value === undefined || value === "ALL") {
    return undefined;
  }
  if (value !== "POSTED" && value !== "CANCELLED") {
    throw new TransactionDomainError("INVALID_COMMAND");
  }
  return value;
}

function normalizeManualKind(value: unknown): (typeof MANUAL_TRANSACTION_KINDS)[number] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    !MANUAL_TRANSACTION_KINDS.includes(
      value as (typeof MANUAL_TRANSACTION_KINDS)[number],
    )
  ) {
    throw new TransactionDomainError("INVALID_COMMAND");
  }
  return value as (typeof MANUAL_TRANSACTION_KINDS)[number];
}

function normalizeMovementKind(value: unknown): FinancialEventKind | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    !FINANCIAL_EVENT_KINDS.includes(value as FinancialEventKind)
  ) {
    throw new TransactionDomainError("INVALID_COMMAND");
  }
  return value as FinancialEventKind;
}

function normalizeCategoryFilter(
  query: Record<string, unknown>,
): { categoryId?: string; categoryIsNull: boolean } {
  const raw = scalarQueryValue(query, "categoryId");
  if (raw === null) {
    return { categoryIsNull: true };
  }
  return {
    categoryId: normalizeResourceFilter(raw, "categoryId"),
    categoryIsNull: false,
  };
}

function normalizeListManualTransactionsQuery(
  input: ListManualTransactionsQuery | undefined,
): NormalizedManualTransactionQuery {
  const query = (input ?? {}) as unknown;
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    throw new TransactionDomainError("INVALID_COMMAND");
  }

  const values = query as Record<string, unknown>;
  const dateRange = normalizeDateRange(values);
  const category = normalizeCategoryFilter(values);
  const kind = normalizeManualKind(
    firstDefinedQueryValue(values, ["kind", "type"]),
  );
  const origin = scalarQueryValue(values, "origin");
  if (origin !== undefined && origin !== "MANUAL") {
    throw new TransactionDomainError("INVALID_COMMAND");
  }

  return {
    ...dateRange,
    accountId: normalizeResourceFilter(
      scalarQueryValue(values, "accountId"),
      "accountId",
    ),
    ...category,
    kind,
    status: normalizeStatus(scalarQueryValue(values, "status")),
  };
}

function normalizeListAccountMovementsQuery(
  input: ListAccountMovementsQuery | undefined,
): NormalizedMovementQuery {
  const query = (input ?? {}) as unknown;
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    throw new TransactionDomainError("INVALID_COMMAND");
  }

  const values = query as Record<string, unknown>;
  const dateRange = normalizeDateRange(values);
  const category = normalizeCategoryFilter(values);
  const kind = normalizeMovementKind(
    firstDefinedQueryValue(values, ["kind", "type"]),
  );

  return {
    ...dateRange,
    ...category,
    kind,
    status: normalizeStatus(scalarQueryValue(values, "status")),
  };
}

function normalizeReadDate(value: string | FinancialDate | undefined): string {
  if (value === undefined) {
    return formatFinancialDate(currentFinancialDate());
  }
  return typeof value === "string"
    ? formatFinancialDate(parseFinancialDate(value))
    : formatFinancialDate(value);
}

function normalizeEventId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return isUuidV7(normalized) ? normalized : undefined;
}

function buildManualTransactionPredicates(
  context: FinancialContext,
  query: NormalizedManualTransactionQuery,
): SQL<unknown>[] {
  const predicates: SQL<unknown>[] = [
    eq(financialEvents.householdId, context.householdId),
    eq(financialEvents.origin, "MANUAL"),
    inArray(financialEvents.kind, MANUAL_TRANSACTION_KINDS),
    inArray(financialEvents.status, MANUAL_TRANSACTION_READ_STATUSES),
  ];

  if (query.from !== undefined) {
    predicates.push(gte(financialEvents.occurredOn, query.from));
  }
  if (query.to !== undefined) {
    predicates.push(lte(financialEvents.occurredOn, query.to));
  }
  if (query.accountId !== undefined) {
    predicates.push(eq(accountEntries.accountId, query.accountId));
  }
  if (query.categoryIsNull) {
    predicates.push(isNull(financialEvents.categoryId));
  } else if (query.categoryId !== undefined) {
    predicates.push(eq(financialEvents.categoryId, query.categoryId));
  }
  if (query.kind !== undefined) {
    predicates.push(eq(financialEvents.kind, query.kind));
  }
  if (query.status !== undefined) {
    predicates.push(eq(financialEvents.status, query.status));
  }

  return predicates;
}

async function selectManualTransactionRows(
  executor: TransactionReadExecutor,
  predicates: readonly SQL<unknown>[],
): Promise<ManualTransactionJoinRow[]> {
  return executor
    .select({
      event: financialEvents,
      entry: accountEntries,
      account: accounts,
      category: categories,
    })
    .from(financialEvents)
    .innerJoin(
      accountEntries,
      and(
        eq(accountEntries.financialEventId, financialEvents.id),
        eq(accountEntries.householdId, financialEvents.householdId),
      ),
    )
    .innerJoin(
      accounts,
      and(
        eq(accountEntries.accountId, accounts.id),
        eq(accountEntries.householdId, accounts.householdId),
      ),
    )
    .leftJoin(
      categories,
      and(
        eq(financialEvents.categoryId, categories.id),
        eq(financialEvents.householdId, categories.householdId),
      ),
    )
    .where(and(...predicates))
    .orderBy(desc(financialEvents.occurredOn), desc(financialEvents.id));
}

async function findReversalForEvent(
  executor: TransactionReadExecutor,
  context: FinancialContext,
  eventId: string,
): Promise<FinancialEventRecord | null> {
  const rows = await executor
    .select()
    .from(financialEvents)
    .where(
      and(
        eq(financialEvents.householdId, context.householdId),
        eq(financialEvents.reversalOfEventId, eventId),
        eq(financialEvents.kind, "REVERSAL"),
        eq(financialEvents.origin, "SYSTEM"),
        eq(financialEvents.status, "POSTED"),
      ),
    )
    .orderBy(desc(financialEvents.id))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Lists only manual economic events and joins their posted entry, account and
 * optional category. The household predicate is present on the event and on
 * every relationship join, so a known ID or a forged filter cannot cross a
 * tenant boundary.
 */
export async function listManualTransactionsForContext(
  executor: TransactionReadExecutor,
  context: FinancialContext,
  query: ListManualTransactionsQuery = {},
): Promise<ListManualTransactionsReadModel> {
  assertFinancialContext(context);
  const normalized = normalizeListManualTransactionsQuery(query);
  const rows = await selectManualTransactionRows(
    executor,
    buildManualTransactionPredicates(context, normalized),
  );

  return {
    items: rows.map((row) => toManualTransactionReadModel(row, null)),
  };
}

/** Returns one manual transaction, or `undefined` for missing/cross-tenant IDs. */
export async function findManualTransactionForContext(
  executor: TransactionReadExecutor,
  context: FinancialContext,
  financialEventId: unknown,
): Promise<ManualTransactionDetailReadModel | undefined> {
  assertFinancialContext(context);
  const normalizedId = normalizeEventId(financialEventId);
  if (!normalizedId) {
    return undefined;
  }

  const rows = await selectManualTransactionRows(executor, [
    eq(financialEvents.id, normalizedId),
    eq(financialEvents.householdId, context.householdId),
    eq(financialEvents.origin, "MANUAL"),
    inArray(financialEvents.kind, MANUAL_TRANSACTION_KINDS),
    inArray(financialEvents.status, MANUAL_TRANSACTION_READ_STATUSES),
  ]);
  const row = rows[0];
  if (!row) {
    return undefined;
  }

  const reversal = await findReversalForEvent(
    executor,
    context,
    row.event.id,
  );
  return toManualTransactionReadModel(row, reversal);
}

/**
 * Detail reads deliberately map every missing, malformed or cross-tenant ID
 * to EVENT_NOT_FOUND, keeping the existence of another household's event
 * opaque to the caller.
 */
export async function getManualTransactionForContext(
  executor: TransactionReadExecutor,
  context: FinancialContext,
  financialEventId: unknown,
): Promise<ManualTransactionDetailReadModel> {
  const value = await findManualTransactionForContext(
    executor,
    context,
    financialEventId,
  );
  if (!value) {
    throw new TransactionDomainError("EVENT_NOT_FOUND", "financialEventId");
  }
  return value;
}

/** Computes a balance from POSTED entries up to and including the requested date. */
export async function getAccountBalanceForContext(
  executor: TransactionReadExecutor,
  context: FinancialContext,
  accountId: unknown,
  asOf?: string | FinancialDate,
): Promise<AccountBalanceReadModel> {
  assertFinancialContext(context);
  const accountIdValue = normalizeEventId(accountId);
  if (!accountIdValue) {
    throw new TransactionDomainError("ACCOUNT_NOT_FOUND", "accountId");
  }

  const accountRows = await executor
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountIdValue),
        eq(accounts.householdId, context.householdId),
      ),
    )
    .limit(1);
  if (!accountRows[0]) {
    throw new TransactionDomainError("ACCOUNT_NOT_FOUND", "accountId");
  }

  const date = normalizeReadDate(asOf);
  const rows = await executor
    .select({
      // PostgreSQL returns SUM(bigint) as numeric text. Explicitly cast the
      // coalesced value to text so no JavaScript number/float is introduced.
      balanceCents: sql<string>`coalesce(sum(${accountEntries.amountCents}), 0)::text`,
    })
    .from(accountEntries)
    .where(
      and(
        eq(accountEntries.householdId, context.householdId),
        eq(accountEntries.accountId, accountIdValue),
        eq(accountEntries.status, ACCOUNT_ENTRY_STATUSES[0]),
        lte(accountEntries.postedOn, date),
      ),
    );

  return {
    accountId: accountIdValue,
    householdId: context.householdId,
    asOf: date,
    balanceCents: toCents(rows[0]?.balanceCents ?? "0"),
  };
}

/** Lists all posted effects of an account, including SYSTEM reversals. */
export async function listAccountMovementsForContext(
  executor: TransactionReadExecutor,
  context: FinancialContext,
  accountId: unknown,
  query: ListAccountMovementsQuery = {},
): Promise<ListAccountMovementsReadModel> {
  assertFinancialContext(context);
  const accountIdValue = normalizeEventId(accountId);
  if (!accountIdValue) {
    throw new TransactionDomainError("ACCOUNT_NOT_FOUND", "accountId");
  }

  const accountRows = await executor
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountIdValue),
        eq(accounts.householdId, context.householdId),
      ),
    )
    .limit(1);
  const account = accountRows[0];
  if (!account) {
    throw new TransactionDomainError("ACCOUNT_NOT_FOUND", "accountId");
  }

  const normalized = normalizeListAccountMovementsQuery(query);
  const predicates: SQL<unknown>[] = [
    eq(accountEntries.householdId, context.householdId),
    eq(accountEntries.accountId, accountIdValue),
    eq(accountEntries.status, ACCOUNT_ENTRY_STATUSES[0]),
    inArray(financialEvents.kind, FINANCIAL_EVENT_KINDS),
    inArray(financialEvents.status, MANUAL_TRANSACTION_READ_STATUSES),
  ];
  if (normalized.from !== undefined) {
    predicates.push(gte(accountEntries.postedOn, normalized.from));
  }
  if (normalized.to !== undefined) {
    predicates.push(lte(accountEntries.postedOn, normalized.to));
  }
  if (normalized.categoryIsNull) {
    predicates.push(isNull(financialEvents.categoryId));
  } else if (normalized.categoryId !== undefined) {
    predicates.push(eq(financialEvents.categoryId, normalized.categoryId));
  }
  if (normalized.kind !== undefined) {
    predicates.push(eq(financialEvents.kind, normalized.kind));
  }
  if (normalized.status !== undefined) {
    predicates.push(eq(financialEvents.status, normalized.status));
  }

  const rows = await executor
    .select({
      event: financialEvents,
      entry: accountEntries,
      category: categories,
    })
    .from(accountEntries)
    .innerJoin(
      financialEvents,
      and(
        eq(accountEntries.financialEventId, financialEvents.id),
        eq(accountEntries.householdId, financialEvents.householdId),
      ),
    )
    .leftJoin(
      categories,
      and(
        eq(financialEvents.categoryId, categories.id),
        eq(financialEvents.householdId, categories.householdId),
      ),
    )
    .where(and(...predicates))
    .orderBy(desc(accountEntries.postedOn), desc(accountEntries.id));

  const to = normalized.to;
  const balance = await getAccountBalanceForContext(
    executor,
    context,
    accountIdValue,
    to,
  );

  return {
    account: toAccountReadModel(account),
    balance,
    items: rows.map((row) =>
      toAccountMovementReadModel(row.event, row.entry, account, row.category),
    ),
  };
}

export interface TransactionReadQueries {
  list(
    context: FinancialContext,
    query?: ListManualTransactionsQuery,
  ): Promise<ListManualTransactionsReadModel>;
  find(
    context: FinancialContext,
    financialEventId: unknown,
  ): Promise<ManualTransactionDetailReadModel | undefined>;
  get(
    context: FinancialContext,
    financialEventId: unknown,
  ): Promise<ManualTransactionDetailReadModel>;
  balance(
    context: FinancialContext,
    accountId: unknown,
    asOf?: string | FinancialDate,
  ): Promise<AccountBalanceReadModel>;
  movements(
    context: FinancialContext,
    accountId: unknown,
    query?: ListAccountMovementsQuery,
  ): Promise<ListAccountMovementsReadModel>;
}

/** Builds direct, context-explicit read queries with an injectable database. */
export function createTransactionReadQueries(
  database?: Database,
): TransactionReadQueries {
  return {
    list: (context, query = {}) =>
      listManualTransactionsForContext(resolveDatabase(database), context, query),
    find: (context, financialEventId) =>
      findManualTransactionForContext(
        resolveDatabase(database),
        context,
        financialEventId,
      ),
    get: (context, financialEventId) =>
      getManualTransactionForContext(
        resolveDatabase(database),
        context,
        financialEventId,
      ),
    balance: (context, accountId, asOf) =>
      getAccountBalanceForContext(
        resolveDatabase(database),
        context,
        accountId,
        asOf,
      ),
    movements: (context, accountId, query = {}) =>
      listAccountMovementsForContext(
        resolveDatabase(database),
        context,
        accountId,
        query,
      ),
  };
}

export const createTransactionReads = createTransactionReadQueries;
export const createTransactionReadModels = createTransactionReadQueries;

/** Convenience functions follow the S02 context-first use-case convention. */
export async function listManualTransactions(
  context: FinancialContext,
  query: ListManualTransactionsQuery = {},
  database?: Database,
): Promise<ListManualTransactionsReadModel> {
  return listManualTransactionsForContext(resolveDatabase(database), context, query);
}

export async function findManualTransaction(
  context: FinancialContext,
  financialEventId: unknown,
  database?: Database,
): Promise<ManualTransactionDetailReadModel | undefined> {
  return findManualTransactionForContext(
    resolveDatabase(database),
    context,
    financialEventId,
  );
}

export async function getManualTransaction(
  context: FinancialContext,
  financialEventId: unknown,
  database?: Database,
): Promise<ManualTransactionDetailReadModel> {
  return getManualTransactionForContext(
    resolveDatabase(database),
    context,
    financialEventId,
  );
}

export async function getAccountBalance(
  context: FinancialContext,
  accountId: unknown,
  asOf?: string | FinancialDate,
  database?: Database,
): Promise<AccountBalanceReadModel> {
  return getAccountBalanceForContext(
    resolveDatabase(database),
    context,
    accountId,
    asOf,
  );
}

export async function listAccountMovements(
  context: FinancialContext,
  accountId: unknown,
  query: ListAccountMovementsQuery = {},
  database?: Database,
): Promise<ListAccountMovementsReadModel> {
  return listAccountMovementsForContext(
    resolveDatabase(database),
    context,
    accountId,
    query,
  );
}

/** Common aliases used by route/read-model consumers. */
export const listTransactions = listManualTransactions;
export const findTransaction = findManualTransaction;
export const getTransaction = getManualTransaction;
export const readAccountBalance = getAccountBalance;
export const getBalance = getAccountBalance;
export const listAccountEntries = listAccountMovements;

/** Context-first aliases make the query names discoverable to route modules. */
export const listTransactionsForContext = listManualTransactionsForContext;
export const findTransactionForContext = findManualTransactionForContext;
export const getTransactionForContext = getManualTransactionForContext;
export const getBalanceForAccountForContext = getAccountBalanceForContext;
export const listMovementsForAccountForContext =
  listAccountMovementsForContext;

export async function getAccountBalanceCents(
  context: FinancialContext,
  accountId: unknown,
  asOf?: string | FinancialDate,
  database?: Database,
): Promise<string> {
  const balance = await getAccountBalance(context, accountId, asOf, database);
  return balance.balanceCents;
}

function asReadResult<T>(operation: () => Promise<T>): Promise<TransactionResult<T>> {
  return operation()
    .then((value) => ok(value))
    .catch((error: unknown) => {
      if (error instanceof TransactionDomainError) {
        return failure<T>(error.code, error.field);
      }
      throw error;
  });
}

export function listManualTransactionsResultForContext(
  executor: TransactionReadExecutor,
  context: FinancialContext,
  query: ListManualTransactionsQuery = {},
): Promise<TransactionResult<ListManualTransactionsReadModel>> {
  return asReadResult(() =>
    listManualTransactionsForContext(executor, context, query),
  );
}

export function getManualTransactionResultForContext(
  executor: TransactionReadExecutor,
  context: FinancialContext,
  financialEventId: unknown,
): Promise<TransactionResult<ManualTransactionDetailReadModel>> {
  return asReadResult(() =>
    getManualTransactionForContext(executor, context, financialEventId),
  );
}

export function getAccountBalanceResultForContext(
  executor: TransactionReadExecutor,
  context: FinancialContext,
  accountId: unknown,
  asOf?: string | FinancialDate,
): Promise<TransactionResult<AccountBalanceReadModel>> {
  return asReadResult(() =>
    getAccountBalanceForContext(executor, context, accountId, asOf),
  );
}

/** Result-returning port for Server Actions and route adapters. */
export interface TransactionReadUseCasePort {
  list(
    context: FinancialContext,
    query?: ListManualTransactionsQuery,
  ): Promise<TransactionResult<ListManualTransactionsReadModel>>;
  detail(
    context: FinancialContext,
    financialEventId: unknown,
  ): Promise<TransactionResult<ManualTransactionDetailReadModel>>;
  balance(
    context: FinancialContext,
    accountId: unknown,
    asOf?: string | FinancialDate,
  ): Promise<TransactionResult<AccountBalanceReadModel>>;
  movements(
    context: FinancialContext,
    accountId: unknown,
    query?: ListAccountMovementsQuery,
  ): Promise<TransactionResult<ListAccountMovementsReadModel>>;
}

export function createTransactionReadUseCases(
  database?: Database,
): TransactionReadUseCasePort {
  const queries = createTransactionReadQueries(database);
  return {
    list: (context, query = {}) =>
      asReadResult(() => queries.list(context, query)),
    detail: (context, financialEventId) =>
      asReadResult(() => queries.get(context, financialEventId)),
    balance: (context, accountId, asOf) =>
      asReadResult(() => queries.balance(context, accountId, asOf)),
    movements: (context, accountId, query = {}) =>
      asReadResult(() => queries.movements(context, accountId, query)),
  };
}

export const transactionReadUseCases = createTransactionReadUseCases();
export const transactionReadUseCase = transactionReadUseCases;
export const createTransactionsReadQueries = createTransactionReadQueries;
export const createTransactionsReadUseCases = createTransactionReadUseCases;
export const transactionsReadUseCases = transactionReadUseCases;

/**
 * Optional auth-resolving facade. It keeps browser-facing callers from ever
 * passing a household ID while preserving the context-explicit port for
 * integration tests and composition inside other server use cases.
 */
export interface TransactionReadAccess {
  list(
    query?: ListManualTransactionsQuery,
    options?: RequireFinancialContextOptions,
  ): Promise<TransactionResult<ListManualTransactionsReadModel>>;
  detail(
    financialEventId: unknown,
    options?: RequireFinancialContextOptions,
  ): Promise<TransactionResult<ManualTransactionDetailReadModel>>;
  balance(
    accountId: unknown,
    asOf?: string | FinancialDate,
    options?: RequireFinancialContextOptions,
  ): Promise<TransactionResult<AccountBalanceReadModel>>;
  movements(
    accountId: unknown,
    query?: ListAccountMovementsQuery,
    options?: RequireFinancialContextOptions,
  ): Promise<TransactionResult<ListAccountMovementsReadModel>>;
}

export function createTransactionReadAccess(
  database?: Database,
): TransactionReadAccess {
  const useCases = createTransactionReadUseCases(database);
  return {
    async list(query = {}, options = {}) {
      return withFinancialContext(
        (context) => useCases.list(context, query),
        options,
      );
    },
    async detail(financialEventId, options = {}) {
      return withFinancialContext(
        (context) => useCases.detail(context, financialEventId),
        options,
      );
    },
    async balance(accountId, asOf, options = {}) {
      return withFinancialContext(
        (context) => useCases.balance(context, accountId, asOf),
        options,
      );
    },
    async movements(accountId, query = {}, options = {}) {
      return withFinancialContext(
        (context) => useCases.movements(context, accountId, query),
        options,
      );
    },
  };
}

export const transactionReadAccess = createTransactionReadAccess();

/** Public parser export for Server Components that normalize searchParams. */
export function parseListManualTransactionsQuery(
  input: ListManualTransactionsQuery | undefined,
): ListManualTransactionsQuery {
  const normalized = normalizeListManualTransactionsQuery(input);
  return {
    ...(normalized.from ? { from: normalized.from } : {}),
    ...(normalized.to ? { to: normalized.to } : {}),
    ...(normalized.accountId ? { accountId: normalized.accountId } : {}),
    ...(normalized.categoryIsNull
      ? { categoryId: null }
      : normalized.categoryId
        ? { categoryId: normalized.categoryId }
        : {}),
    ...(normalized.kind ? { kind: normalized.kind } : {}),
    ...(normalized.status ? { status: normalized.status } : {}),
    origin: "MANUAL",
  };
}

export function parseListAccountMovementsQuery(
  input: ListAccountMovementsQuery | undefined,
): ListAccountMovementsQuery {
  const normalized = normalizeListAccountMovementsQuery(input);
  return {
    ...(normalized.from ? { from: normalized.from } : {}),
    ...(normalized.to ? { to: normalized.to } : {}),
    ...(normalized.categoryIsNull
      ? { categoryId: null }
      : normalized.categoryId
        ? { categoryId: normalized.categoryId }
        : {}),
    ...(normalized.kind ? { kind: normalized.kind } : {}),
    ...(normalized.status ? { status: normalized.status } : {}),
  };
}
