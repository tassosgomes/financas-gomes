/**
 * Pure read-side helpers for S05 transaction review.
 *
 * Database adapters provide a tenant-scoped row to this module. This file
 * does not resolve tenancy, execute queries or manufacture import lineage.
 */
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  isNotNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  accounts,
  categories,
  type AccountRecord,
  type CategoryRecord,
} from "@/db/accounts-categories-schema";
import {
  accountEntries,
  financialEvents,
  type FinancialEventRecord,
} from "@/db/financial-events-schema";
import {
  transactionImportItems,
  transactionImports,
} from "@/db/transaction-imports-schema";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import type { FinancialContext } from "@/modules/households/contracts";
import { isUuidV7 } from "@/lib/uuidv7";
import type { TransactionReferenceExecutor } from "./references";
import type {
  AccountReadModel,
  CategoryReadModel,
} from "@/modules/accounts-categories/contracts";

import {
  REVIEWABLE_TRANSACTION_KINDS,
  REVIEWABLE_TRANSACTION_STATUSES,
  decodeReviewCursor,
  encodeReviewCursor,
  createReviewCursor,
  hashReviewableTransactionFilters,
  parseListReviewableTransactionsQuery,
  parseTransactionReviewSummaryQuery,
  parseReviewableTransactionSource,
  projectTransactionReview,
  type ListReviewableTransactionsQuery,
  type NormalizedListReviewableTransactionsQuery,
  type NormalizedTransactionReviewSummaryQuery,
  type ReviewCursorExpectedQuery,
  type ReviewCursorV1,
  type ReviewableTransactionKind,
  type ReviewableTransactionOrigin,
  type ReviewableTransactionStatus,
  type TransactionReviewResult,
  type TransactionDetailReadModel,
  type TransactionListItemReadModel,
  type TransactionListReadModel,
  type TransactionReviewSummaryReadModel,
  type TransactionSource,
} from "./review-contracts";
import { TransactionReviewDomainError } from "./review-contracts";

export type ReviewReadQuery =
  | ListReviewableTransactionsQuery
  | NormalizedListReviewableTransactionsQuery;

/** Delegates query canonicalization, including rejection of householdId. */
export function normalizeReviewReadQuery(
  input: unknown = {},
): NormalizedListReviewableTransactionsQuery {
  return parseListReviewableTransactionsQuery(input);
}

/** Hashes the canonical filters used by a review page cursor. */
export function reviewQueryFilterHash(query: ReviewReadQuery): string {
  return hashReviewableTransactionFilters(query);
}

export type ReviewPageCursor = Pick<
  ReviewCursorV1,
  "occurredOn" | "id" | "filterHash" | "limit"
>;
export type ReviewPageCursorInput = ReviewPageCursor;
export type ReviewPageCursorExpectation = ReviewCursorExpectedQuery;

/** Encodes the stable date/id position together with filters and page size. */
export function encodeReviewPageCursor(input: ReviewPageCursorInput): string {
  return encodeReviewCursor({
    v: 1,
    occurredOn: input.occurredOn,
    id: input.id,
    filterHash: input.filterHash,
    limit: input.limit,
  });
}

/** Decodes and validates a cursor, optionally against its canonical query. */
export function decodeReviewPageCursor(
  value: unknown,
  expectation?: ReviewPageCursorExpectation,
): ReviewCursorV1 {
  return decodeReviewCursor(value, expectation);
}

export type ReviewEventOrigin = ReviewableTransactionOrigin | "SYSTEM";
export type ReviewEventKind = ReviewableTransactionKind | "REVERSAL";

/** The only lineage fields that can become the public import source. */
export interface ReviewImportLineageRow {
  importId: string;
  rowNumber: number;
  externalId: string | null;
}

/**
 * Query projection supplied by T04-B. Values already use read-model formats;
 * only source and review projection are derived here.
 */
export type ReviewReadRow = Omit<
  TransactionListItemReadModel,
  "kind" | "origin" | "source" | "reviewState" | "reviewReason" | "needsReview"
> & {
  kind: ReviewEventKind;
  status: ReviewableTransactionStatus;
  origin: ReviewEventOrigin;
  lineage: ReviewImportLineageRow | null;
};

/** The discriminator and lineage portion checked by isReviewableEventShape. */
export type ReviewEventShape = Pick<
  ReviewReadRow,
  "kind" | "status" | "origin" | "lineage"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasReviewableEventDiscriminator(
  value: Record<string, unknown>,
): value is Record<string, unknown> & {
  kind: ReviewableTransactionKind;
  status: ReviewableTransactionStatus;
  origin: ReviewableTransactionOrigin;
} {
  return (
    REVIEWABLE_TRANSACTION_KINDS.includes(
      value.kind as ReviewableTransactionKind,
    ) &&
    REVIEWABLE_TRANSACTION_STATUSES.includes(
      value.status as ReviewableTransactionStatus,
    ) &&
    (value.origin === "MANUAL" || value.origin === "IMPORT")
  );
}

function buildReviewSource(
  origin: unknown,
  lineage: unknown,
): TransactionSource {
  if (origin === "MANUAL") {
    if (lineage !== null) {
      throw new TransactionReviewDomainError("IMPORT_LINEAGE_INVALID");
    }
    return parseReviewableTransactionSource({
      origin: "MANUAL",
      import: null,
    });
  }

  if (origin === "IMPORT") {
    if (lineage === null) {
      throw new TransactionReviewDomainError("IMPORT_LINEAGE_INVALID");
    }
    return parseReviewableTransactionSource({
      origin: "IMPORT",
      import: lineage,
    });
  }

  throw new TransactionReviewDomainError("EVENT_NOT_REVIEWABLE");
}

/**
 * Returns true only for posted/cancelled expense or income events with a
 * source shape the S05 contract accepts. SYSTEM and REVERSAL stay excluded.
 */
export function isReviewableEventShape(
  value: unknown,
): value is ReviewEventShape {
  if (!isRecord(value) || !hasReviewableEventDiscriminator(value)) {
    return false;
  }

  try {
    buildReviewSource(value.origin, value.lineage);
    return true;
  } catch {
    return false;
  }
}

/**
 * Projects a supplied row without adding database fields or import lineage.
 * Invalid import lineage is an error; it is never downgraded to MANUAL.
 */
export function projectReviewRow(row: ReviewReadRow): TransactionListItemReadModel {
  if (!isRecord(row) || !hasReviewableEventDiscriminator(row)) {
    throw new TransactionReviewDomainError("EVENT_NOT_REVIEWABLE");
  }

  // `ReviewReadRow` is intentionally broad enough for the discriminator
  // validator to reject a REVERSAL/SYSTEM row at runtime. Narrow the kind
  // after that validation before returning the reviewable read model.
  const kind = row.kind;
  if (kind !== "EXPENSE" && kind !== "INCOME") {
    throw new TransactionReviewDomainError("EVENT_NOT_REVIEWABLE");
  }
  const origin = row.origin;
  if (origin !== "MANUAL" && origin !== "IMPORT") {
    throw new TransactionReviewDomainError("EVENT_NOT_REVIEWABLE");
  }

  const source = buildReviewSource(row.origin, row.lineage);
  if (!isReviewableEventShape(row)) {
    throw new TransactionReviewDomainError("EVENT_NOT_REVIEWABLE");
  }

  const base = Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== "lineage"),
  ) as Omit<ReviewReadRow, "lineage">;
  return {
    ...base,
    kind,
    origin,
    source,
    ...projectTransactionReview(row.status, row.categoryId),
  };
}

/**
 * Tenant-scoped SQL reads for the S05 review queue.
 *
 * The pure helpers above remain useful to adapters and tests, while this
 * section is the concrete T04-B persistence boundary. Every relationship is
 * joined with the event household, and import lineage is projected only when
 * both the item and its confirmed batch are present. A malformed import row
 * therefore fails closed instead of being presented as a manual transaction.
 */

type ReviewReadExecutor = TransactionReferenceExecutor;

type ReviewSqlRow = {
  event: FinancialEventRecord;
  entry: typeof accountEntries.$inferSelect;
  account: AccountRecord;
  category: CategoryRecord | null;
  lineageItemId: string | null;
  lineageImportId: string | null;
  lineageRowNumber: number | null;
  lineageExternalId: string | null;
  lineageBatchId: string | null;
  lineageBatchAccountId: string | null;
};

type ReviewFilterQuery =
  | NormalizedListReviewableTransactionsQuery
  | NormalizedTransactionReviewSummaryQuery;

function assertReviewableSqlEvent(
  event: FinancialEventRecord,
): asserts event is FinancialEventRecord & {
  kind: ReviewableTransactionKind;
  status: ReviewableTransactionStatus;
  origin: ReviewableTransactionOrigin;
} {
  if (
    (event.kind !== "EXPENSE" && event.kind !== "INCOME") ||
    (event.status !== "POSTED" && event.status !== "CANCELLED") ||
    (event.origin !== "MANUAL" && event.origin !== "IMPORT")
  ) {
    throw new TransactionReviewDomainError("EVENT_NOT_REVIEWABLE");
  }
}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toCents(value: bigint | number | string): string {
  return typeof value === "bigint" ? value.toString(10) : String(value);
}

function requireReviewDate(value: string | null): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Um entry de revisão não possui posted_on.");
  }
  return value;
}

function toReviewAccountReadModel(record: AccountRecord): AccountReadModel {
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

function toReviewCategoryReadModel(record: CategoryRecord): CategoryReadModel {
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

function escapeReviewSearch(value: string): string {
  // `ILIKE` treats backslash as the pattern escape character in PostgreSQL.
  // Escaping it first keeps `%`, `_` and user-provided backslashes literal.
  return value.replace(/\\/gu, "\\\\").replace(/%/gu, "\\%").replace(/_/gu, "\\_");
}

function lineageFromReviewSqlRow(row: ReviewSqlRow): ReviewImportLineageRow | null {
  const fields = [
    row.lineageItemId,
    row.lineageImportId,
    row.lineageRowNumber,
    row.lineageBatchId,
    row.lineageBatchAccountId,
  ];
  const noItem = fields.every((value) => value === null);

  if (noItem) {
    return null;
  }

  if (
    row.lineageItemId === null ||
    row.lineageImportId === null ||
    row.lineageRowNumber === null ||
    row.lineageBatchId === null ||
    row.lineageBatchAccountId === null ||
    row.lineageBatchAccountId !== row.account.id
  ) {
    throw new TransactionReviewDomainError("IMPORT_LINEAGE_INVALID");
  }

  return {
    importId: row.lineageImportId,
    rowNumber: row.lineageRowNumber,
    externalId: row.lineageExternalId,
  };
}

function reviewEntryFromSqlRow(row: ReviewSqlRow): TransactionListItemReadModel["entry"] {
  if (row.entry.status !== "POSTED" || row.entry.expectedOn !== null) {
    throw new Error("O read model de revisão recebeu um entry não realizado.");
  }

  const signedAmount = BigInt(row.entry.amountCents);
  if (
    signedAmount === BigInt(0) ||
    (row.event.kind === "EXPENSE" && signedAmount >= BigInt(0)) ||
    (row.event.kind === "INCOME" && signedAmount <= BigInt(0))
  ) {
    throw new Error("O sinal do entry não corresponde ao evento de revisão.");
  }

  return {
    id: row.entry.id,
    amountCents: toCents(row.entry.amountCents),
    status: "POSTED",
    postedOn: requireReviewDate(row.entry.postedOn),
  };
}

function reviewRowFromSqlRow(row: ReviewSqlRow): TransactionListItemReadModel {
  const event = row.event;
  assertReviewableSqlEvent(event);
  const lineage = lineageFromReviewSqlRow(row);
  const reviewRow: ReviewReadRow = {
    id: event.id,
    householdId: event.householdId,
    kind: event.kind,
    status: event.status,
    origin: event.origin,
    amountCents: toCents(event.amountCents),
    occurredOn: event.occurredOn,
    description: event.description,
    accountId: row.account.id,
    categoryId: event.categoryId,
    account: toReviewAccountReadModel(row.account),
    category: row.category ? toReviewCategoryReadModel(row.category) : null,
    entry: reviewEntryFromSqlRow(row),
    lineage,
    createdAt: toIsoTimestamp(event.createdAt),
    updatedAt: toIsoTimestamp(event.updatedAt),
  };

  return projectReviewRow(reviewRow);
}

function assertUniqueReviewEvents(rows: readonly ReviewSqlRow[]): void {
  const eventIds = new Set<string>();
  for (const row of rows) {
    if (eventIds.has(row.event.id)) {
      // This is a database integrity failure (normally prevented by the S03
      // one-entry invariant), not a second public transaction item.
      throw new Error("Um evento de revisão possui mais de um account_entry.");
    }
    eventIds.add(row.event.id);
  }
}

function reviewablePredicates(
  context: FinancialContext,
  query: ReviewFilterQuery,
): SQL<unknown>[] {
  const predicates: SQL<unknown>[] = [
    eq(financialEvents.householdId, context.householdId),
    inArray(financialEvents.kind, ["EXPENSE", "INCOME"]),
    inArray(financialEvents.origin, ["MANUAL", "IMPORT"]),
    inArray(financialEvents.status, REVIEWABLE_TRANSACTION_STATUSES),
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
  if (query.categoryId === null) {
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
  if (query.origin !== undefined) {
    predicates.push(eq(financialEvents.origin, query.origin));
  }
  if ("review" in query && query.review === "NEEDS_REVIEW") {
    const pendingPredicate = and(
      eq(financialEvents.status, "POSTED"),
      isNull(financialEvents.categoryId),
    );
    if (pendingPredicate) {
      predicates.push(pendingPredicate);
    }
  } else if ("review" in query && query.review === "ORGANIZED") {
    const organizedPredicate = and(
      eq(financialEvents.status, "POSTED"),
      isNotNull(financialEvents.categoryId),
    );
    if (organizedPredicate) {
      predicates.push(organizedPredicate);
    }
  }
  if (query.search !== undefined) {
    predicates.push(
      ilike(
        financialEvents.description,
        `%${escapeReviewSearch(query.search)}%`,
      ),
    );
  }

  return predicates;
}

function reviewKeysetPredicate(
  cursor: ReviewCursorV1 | undefined,
): SQL<unknown> | undefined {
  if (!cursor) {
    return undefined;
  }

  return or(
    lt(financialEvents.occurredOn, cursor.occurredOn),
    and(
      eq(financialEvents.occurredOn, cursor.occurredOn),
      lt(financialEvents.id, cursor.id),
    ),
  ) ?? sql`true`;
}

function reviewLineageJoin(): SQL<unknown> {
  return and(
    eq(transactionImportItems.financialEventId, financialEvents.id),
    eq(transactionImportItems.householdId, financialEvents.householdId),
  ) ?? sql`false`;
}

function reviewImportJoin(): SQL<unknown> {
  return and(
    eq(transactionImports.id, transactionImportItems.importId),
    eq(transactionImports.householdId, transactionImportItems.householdId),
  ) ?? sql`false`;
}

function reviewCategoryJoin(): SQL<unknown> {
  return and(
    eq(categories.id, financialEvents.categoryId),
    eq(categories.householdId, financialEvents.householdId),
  ) ?? sql`false`;
}

async function selectReviewSqlRows(
  executor: ReviewReadExecutor,
  predicates: readonly SQL<unknown>[],
  limit: number,
): Promise<ReviewSqlRow[]> {
  return executor
    .select({
      event: financialEvents,
      entry: accountEntries,
      account: accounts,
      category: categories,
      lineageItemId: transactionImportItems.id,
      lineageImportId: transactionImportItems.importId,
      lineageRowNumber: transactionImportItems.rowNumber,
      lineageExternalId: transactionImportItems.externalId,
      lineageBatchId: transactionImports.id,
      lineageBatchAccountId: transactionImports.accountId,
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
        eq(accounts.id, accountEntries.accountId),
        eq(accounts.householdId, accountEntries.householdId),
      ),
    )
    .leftJoin(
      categories,
      reviewCategoryJoin(),
    )
    .leftJoin(transactionImportItems, reviewLineageJoin())
    .leftJoin(transactionImports, reviewImportJoin())
    .where(and(...predicates))
    .orderBy(desc(financialEvents.occurredOn), desc(financialEvents.id))
    .limit(limit) as Promise<ReviewSqlRow[]>;
}

async function validateReviewFilterResources(
  executor: ReviewReadExecutor,
  context: FinancialContext,
  query: ReviewFilterQuery,
): Promise<void> {
  if (query.accountId !== undefined) {
    const account = await executor
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, query.accountId),
          eq(accounts.householdId, context.householdId),
        ),
      )
      .limit(1);
    if (!account[0]) {
      throw new TransactionReviewDomainError("ACCOUNT_NOT_FOUND", "accountId");
    }
  }

  if (query.categoryId !== undefined && query.categoryId !== null) {
    const category = await executor
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.id, query.categoryId),
          eq(categories.householdId, context.householdId),
        ),
      )
      .limit(1);
    if (!category[0]) {
      throw new TransactionReviewDomainError("CATEGORY_NOT_FOUND", "categoryId");
    }
  }
}

function reviewCursorForQuery(
  query: NormalizedListReviewableTransactionsQuery,
): ReviewCursorV1 | undefined {
  if (query.cursor === undefined) {
    return undefined;
  }

  return decodeReviewCursor(query.cursor, {
    expectedFilterHash: hashReviewableTransactionFilters(query),
    expectedLimit: query.limit,
  });
}

/** Lists manual and imported reviewable events with keyset pagination. */
export async function listReviewableTransactionsForContext(
  executor: ReviewReadExecutor,
  context: FinancialContext,
  input: ListReviewableTransactionsQuery = {},
): Promise<TransactionListReadModel> {
  assertFinancialContext(context);
  const query = parseListReviewableTransactionsQuery(input);
  await validateReviewFilterResources(executor, context, query);
  const cursor = reviewCursorForQuery(query);
  const predicates = reviewablePredicates(context, query);
  const position = reviewKeysetPredicate(cursor);
  if (position) {
    predicates.push(position);
  }

  const rows = await selectReviewSqlRows(executor, predicates, query.limit + 1);
  assertUniqueReviewEvents(rows);

  const projectedRows = rows.map(reviewRowFromSqlRow);
  const hasNextPage = projectedRows.length > query.limit;
  const items = projectedRows.slice(0, query.limit);
  const last = items[items.length - 1];

  return {
    items,
    pageInfo: {
      hasNextPage,
      nextCursor:
        hasNextPage && last
          ? createReviewCursor(
              { occurredOn: last.occurredOn, id: last.id },
              query,
            )
          : null,
    },
  };
}

async function selectReviewDetailRow(
  executor: ReviewReadExecutor,
  context: FinancialContext,
  financialEventId: string,
): Promise<ReviewSqlRow | undefined> {
  const rows = await selectReviewSqlRows(
    executor,
    [
      eq(financialEvents.id, financialEventId),
      eq(financialEvents.householdId, context.householdId),
      inArray(financialEvents.kind, ["EXPENSE", "INCOME"]),
      inArray(financialEvents.origin, ["MANUAL", "IMPORT"]),
      inArray(financialEvents.status, REVIEWABLE_TRANSACTION_STATUSES),
    ],
    2,
  );
  assertUniqueReviewEvents(rows);
  return rows[0];
}

async function findReviewReversal(
  executor: ReviewReadExecutor,
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

/** Returns a detail row or `undefined` for malformed/missing/cross-tenant IDs. */
export async function findReviewableTransactionForContext(
  executor: ReviewReadExecutor,
  context: FinancialContext,
  financialEventId: unknown,
): Promise<TransactionDetailReadModel | undefined> {
  assertFinancialContext(context);
  if (typeof financialEventId !== "string") {
    return undefined;
  }
  const normalizedId = financialEventId.trim();
  if (!isUuidV7(normalizedId)) {
    return undefined;
  }

  const row = await selectReviewDetailRow(executor, context, normalizedId);
  if (!row) {
    return undefined;
  }

  const item = reviewRowFromSqlRow(row);
  const reversal = await findReviewReversal(executor, context, row.event.id);
  return {
    ...item,
    reversal: reversal
      ? {
          id: reversal.id,
          amountCents: toCents(reversal.amountCents),
          origin: "SYSTEM",
          status: "POSTED",
          occurredOn: reversal.occurredOn,
        }
      : null,
  };
}

/** Detail reads keep another household's event indistinguishable from absent. */
export async function getReviewableTransactionForContext(
  executor: ReviewReadExecutor,
  context: FinancialContext,
  financialEventId: unknown,
): Promise<TransactionDetailReadModel> {
  const value = await findReviewableTransactionForContext(
    executor,
    context,
    financialEventId,
  );
  if (!value) {
    throw new TransactionReviewDomainError("EVENT_NOT_FOUND", "financialEventId");
  }
  return value;
}

/**
 * Counts the exact pending projection in SQL. Invalid lineage is detected in
 * the same aggregate query, so summary never loads the whole queue merely to
 * validate source metadata.
 */
export async function getTransactionReviewSummaryForContext(
  executor: ReviewReadExecutor,
  context: FinancialContext,
  input: ListReviewableTransactionsQuery = {},
): Promise<TransactionReviewSummaryReadModel> {
  assertFinancialContext(context);
  const query = parseTransactionReviewSummaryQuery(input);
  await validateReviewFilterResources(executor, context, query);

  const pendingQuery = queryWithPendingReview(query);
  const predicates = reviewablePredicates(context, pendingQuery);
  const rows = await executor
    .select({
      needsReviewCount: sql<number>`count(distinct ${financialEvents.id})::integer`,
      invalidImportLineageCount: sql<number>`count(*) filter (
        where ${financialEvents.origin} = 'IMPORT'
          and (${transactionImportItems.id} is null or ${transactionImports.id} is null)
      )::integer`,
      invalidManualLineageCount: sql<number>`count(*) filter (
        where ${financialEvents.origin} = 'MANUAL'
          and ${transactionImportItems.id} is not null
      )::integer`,
      invalidBatchAccountCount: sql<number>`count(*) filter (
        where ${transactionImportItems.id} is not null
          and (${transactionImports.id} is null
            or ${transactionImports.accountId} <> ${accountEntries.accountId})
      )::integer`,
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
        eq(accounts.id, accountEntries.accountId),
        eq(accounts.householdId, accountEntries.householdId),
      ),
    )
    .leftJoin(categories, reviewCategoryJoin())
    .leftJoin(transactionImportItems, reviewLineageJoin())
    .leftJoin(transactionImports, reviewImportJoin())
    .where(and(...predicates));

  const aggregate = rows[0];
  if (!aggregate) {
    return { needsReviewCount: 0 };
  }

  const invalidImportLineageCount = Number(aggregate.invalidImportLineageCount ?? 0);
  const invalidManualLineageCount = Number(aggregate.invalidManualLineageCount ?? 0);
  const invalidBatchAccountCount = Number(aggregate.invalidBatchAccountCount ?? 0);
  if (invalidImportLineageCount > 0 || invalidManualLineageCount > 0 || invalidBatchAccountCount > 0) {
    throw new TransactionReviewDomainError("IMPORT_LINEAGE_INVALID");
  }

  return {
    needsReviewCount: Number(aggregate.needsReviewCount ?? 0),
  };
}

type PendingReviewQuery = NormalizedTransactionReviewSummaryQuery & {
  review: "NEEDS_REVIEW";
  limit: number;
};

function queryWithPendingReview(
  query: NormalizedTransactionReviewSummaryQuery,
): PendingReviewQuery {
  return {
    ...query,
    review: "NEEDS_REVIEW",
    limit: 1,
  };
}

export interface TransactionReviewReadQueries {
  list(
    context: FinancialContext,
    query?: ListReviewableTransactionsQuery,
  ): Promise<TransactionListReadModel>;
  find(
    context: FinancialContext,
    financialEventId: unknown,
  ): Promise<TransactionDetailReadModel | undefined>;
  get(
    context: FinancialContext,
    financialEventId: unknown,
  ): Promise<TransactionDetailReadModel>;
  summary(
    context: FinancialContext,
    query?: ListReviewableTransactionsQuery,
  ): Promise<TransactionReviewSummaryReadModel>;
}

export function createTransactionReviewReadQueries(
  database?: Database,
): TransactionReviewReadQueries {
  const resolveExecutor = (): ReviewReadExecutor => database ?? getDb();
  return {
    list: (context, query = {}) =>
      listReviewableTransactionsForContext(resolveExecutor(), context, query),
    find: (context, financialEventId) =>
      findReviewableTransactionForContext(
        resolveExecutor(),
        context,
        financialEventId,
      ),
    get: (context, financialEventId) =>
      getReviewableTransactionForContext(
        resolveExecutor(),
        context,
        financialEventId,
      ),
    summary: (context, query = {}) =>
      getTransactionReviewSummaryForContext(resolveExecutor(), context, query),
  };
}

export const createReviewableTransactionReadQueries =
  createTransactionReviewReadQueries;
export const createReviewReads = createTransactionReviewReadQueries;
export const transactionReviewReadQueries = createTransactionReviewReadQueries();

function reviewReadResult<T>(operation: () => Promise<T>): Promise<TransactionReviewResult<T>> {
  return operation()
    .then((value) => ({ ok: true as const, value }))
    .catch((error: unknown) => {
      if (error instanceof TransactionReviewDomainError) {
        return {
          ok: false as const,
          error: error.toError(),
        };
      }
      throw error;
    });
}

export interface TransactionReviewReadUseCasePort {
  list(
    context: FinancialContext,
    query?: ListReviewableTransactionsQuery,
  ): Promise<TransactionReviewResult<TransactionListReadModel>>;
  detail(
    context: FinancialContext,
    financialEventId: unknown,
  ): Promise<TransactionReviewResult<TransactionDetailReadModel>>;
  summary(
    context: FinancialContext,
    query?: ListReviewableTransactionsQuery,
  ): Promise<TransactionReviewResult<TransactionReviewSummaryReadModel>>;
}

export function createTransactionReviewReadUseCases(
  database?: Database,
): TransactionReviewReadUseCasePort {
  const queries = createTransactionReviewReadQueries(database);
  return {
    list: (context, query = {}) => reviewReadResult(() => queries.list(context, query)),
    detail: (context, financialEventId) =>
      reviewReadResult(() => queries.get(context, financialEventId)),
    summary: (context, query = {}) =>
      reviewReadResult(() => queries.summary(context, query)),
  };
}

export const createReviewableTransactionReadUseCases =
  createTransactionReviewReadUseCases;
export const transactionReviewReadUseCases = createTransactionReviewReadUseCases();

export async function listReviewableTransactions(
  context: FinancialContext,
  query: ListReviewableTransactionsQuery = {},
  database?: Database,
): Promise<TransactionListReadModel> {
  return listReviewableTransactionsForContext(database ?? getDb(), context, query);
}

export async function findReviewableTransaction(
  context: FinancialContext,
  financialEventId: unknown,
  database?: Database,
): Promise<TransactionDetailReadModel | undefined> {
  return findReviewableTransactionForContext(
    database ?? getDb(),
    context,
    financialEventId,
  );
}

export async function getReviewableTransaction(
  context: FinancialContext,
  financialEventId: unknown,
  database?: Database,
): Promise<TransactionDetailReadModel> {
  return getReviewableTransactionForContext(
    database ?? getDb(),
    context,
    financialEventId,
  );
}

export async function getTransactionReviewSummary(
  context: FinancialContext,
  query: ListReviewableTransactionsQuery = {},
  database?: Database,
): Promise<TransactionReviewSummaryReadModel> {
  return getTransactionReviewSummaryForContext(
    database ?? getDb(),
    context,
    query,
  );
}

export const listReviewTransactions = listReviewableTransactions;
export const getReviewTransaction = getReviewableTransaction;
export const reviewTransactionReads = transactionReviewReadQueries;
