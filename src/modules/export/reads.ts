import {
  and,
  asc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  accounts,
  categories,
} from "@/db/accounts-categories-schema";
import {
  budgetAllocationRules,
  budgetMovements,
  budgets,
} from "@/db/budgets-schema";
import {
  creditCardBillingRules,
  creditCardPurchases,
  creditCards,
  installmentPlans,
  installments,
} from "@/db/credit-cards-schema";
import {
  accountEntries,
  financialEvents,
} from "@/db/financial-events-schema";
import {
  holidays,
  plannedEvents,
  recurringOccurrences,
  recurringRules,
} from "@/db/recurring-schema";
import { spendableSettings } from "@/db/spendable-schema";
import type { FinancialContext } from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import { isUuidV7 } from "@/lib/uuidv7";
import {
  compareFinancialDates,
  formatFinancialDate,
  parseFinancialDate,
} from "@/modules/transactions/dates";

/** Page size fixed by ADR-014 for streaming export reads. */
export const S11_EXPORT_PAGE_SIZE = 500;

/** Dataset ids and column lists duplicated from ADR-014 while T01 contract.ts is absent. */
export const S11_DATASET_IDS = [
  "accounts",
  "categories",
  "financial_events",
  "account_entries",
  "credit_cards",
  "credit_card_billing_rules",
  "credit_card_purchases",
  "installment_plans",
  "installments",
  "recurring_rules",
  "recurring_occurrences",
  "planned_events",
  "holidays",
  "spendable_settings",
  "budgets",
  "budget_movements",
  "budget_allocation_rules",
] as const;

export type S11DatasetId = (typeof S11_DATASET_IDS)[number];

export type S11DatasetAvailability = "AVAILABLE" | "UNAVAILABLE_EXTERNAL_GATE";

export type S11TransactionFilterKind =
  | "EXPENSE"
  | "INCOME"
  | "REVERSAL"
  | "PURCHASE"
  | "TRANSFER";

export type S11TransactionFilterStatus =
  | "PLANNED"
  | "EXPECTED"
  | "PENDING"
  | "POSTED"
  | "CANCELLED"
  | "ALL";

export interface S11TransactionFilters {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string | null;
  kind?: S11TransactionFilterKind;
  status?: S11TransactionFilterStatus;
}

/** Serializable export row before CSV encoding (T03). */
export type ExportDatasetRow = Record<string, string | boolean>;

export interface S11DatasetObservabilityMeta {
  id: S11DatasetId;
  availability: S11DatasetAvailability;
  sort: string;
  rowCount: number;
  durationMs: number;
}

export interface ExportReadsOptions {
  filters?: S11TransactionFilters;
  database?: Database;
  onDataset?: (meta: S11DatasetObservabilityMeta) => void;
}

export interface ExportDatasetReadResult {
  availability: S11DatasetAvailability;
  sort: string;
  rows: AsyncGenerator<ExportDatasetRow>;
}

export class ExportReadError extends Error {
  readonly code: "INVALID_FILTER";

  readonly field?: string;

  constructor(code: "INVALID_FILTER", field?: string) {
    super(code);
    this.name = "ExportReadError";
    this.code = code;
    this.field = field;
  }
}

const S11_TRANSACTION_FILTER_KINDS: readonly S11TransactionFilterKind[] = [
  "EXPENSE",
  "INCOME",
  "REVERSAL",
  "PURCHASE",
  "TRANSFER",
];

const S11_TRANSACTION_FILTER_STATUSES: readonly S11TransactionFilterStatus[] = [
  "PLANNED",
  "EXPECTED",
  "PENDING",
  "POSTED",
  "CANCELLED",
  "ALL",
];

const NULL_DATE_SENTINEL = "9999-12-31";

const DATASET_SORT_KEYS: Record<S11DatasetId, string> = {
  accounts: "name ASC, id ASC",
  categories: "kind ASC, name ASC, id ASC",
  financial_events: "occurredOn ASC, id ASC",
  account_entries:
    "postedOn NULLS LAST, expectedOn NULLS LAST, id ASC",
  credit_cards: "id ASC",
  credit_card_billing_rules: "cardId ASC, effectiveFrom ASC, id ASC",
  credit_card_purchases: "id ASC",
  installment_plans: "id ASC",
  installments: "planId ASC, sequence ASC, id ASC",
  recurring_rules: "startOn ASC, id ASC",
  recurring_occurrences:
    "recurringRuleId ASC, occurrenceKey ASC, id ASC",
  planned_events: "expectedOn ASC, id ASC",
  holidays: "date ASC, id ASC",
  spendable_settings: "effectiveFrom ASC, id ASC",
  budgets: "name ASC, id ASC",
  budget_movements: "effectiveOn ASC, id ASC",
  budget_allocation_rules: "budgetId ASC, effectiveFrom ASC, id ASC",
};

type ExportReadExecutor = Database;

interface NormalizedS11TransactionFilters {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  categoryIsNull: boolean;
  kind?: S11TransactionFilterKind;
  status?: Exclude<S11TransactionFilterStatus, "ALL">;
}

interface DatasetModuleGate {
  availability: S11DatasetAvailability;
}

function resolveExecutor(database?: Database): ExportReadExecutor {
  return database ?? getDb();
}

function impossiblePredicate(): SQL {
  return sql`false`;
}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toMoneyString(value: bigint | number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "bigint" ? value.toString(10) : String(value);
}

function toOptionalUuid(value: string | null | undefined): string {
  return value ?? "";
}

function toOptionalDate(value: string | null | undefined): string {
  return value ?? "";
}

function normalizeDateFilter(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ExportReadError("INVALID_FILTER", field);
  }
  return formatFinancialDate(parseFinancialDate(value));
}

function normalizeResourceFilter(
  value: unknown,
  field: "accountId" | "categoryId",
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ExportReadError("INVALID_FILTER", field);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  if (!isUuidV7(normalized)) {
    throw new ExportReadError("INVALID_FILTER", field);
  }
  return normalized;
}

function normalizeStatusFilter(
  value: unknown,
): Exclude<S11TransactionFilterStatus, "ALL"> | undefined {
  if (value === undefined || value === "ALL") {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    !S11_TRANSACTION_FILTER_STATUSES.includes(value as S11TransactionFilterStatus) ||
    value === "ALL"
  ) {
    throw new ExportReadError("INVALID_FILTER", "status");
  }
  return value as Exclude<S11TransactionFilterStatus, "ALL">;
}

function normalizeKindFilter(value: unknown): S11TransactionFilterKind | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    !S11_TRANSACTION_FILTER_KINDS.includes(value as S11TransactionFilterKind)
  ) {
    throw new ExportReadError("INVALID_FILTER", "kind");
  }
  return value as S11TransactionFilterKind;
}

/** Normalizes optional transaction filters for export reads. */
export function normalizeS11TransactionFilters(
  input: S11TransactionFilters | undefined,
): NormalizedS11TransactionFilters {
  if (input === undefined) {
    return { categoryIsNull: false };
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ExportReadError("INVALID_FILTER");
  }

  const from = normalizeDateFilter(input.from, "from");
  const to = normalizeDateFilter(input.to, "to");
  if (
    from !== undefined &&
    to !== undefined &&
    compareFinancialDates(parseFinancialDate(from), parseFinancialDate(to)) > 0
  ) {
    throw new ExportReadError("INVALID_FILTER", "to");
  }

  const rawCategory = input.categoryId;
  if (rawCategory === null) {
    return {
      from,
      to,
      accountId: normalizeResourceFilter(input.accountId, "accountId"),
      categoryIsNull: true,
      kind: normalizeKindFilter(input.kind),
      status: normalizeStatusFilter(input.status),
    };
  }

  return {
    from,
    to,
    accountId: normalizeResourceFilter(input.accountId, "accountId"),
    categoryId: normalizeResourceFilter(rawCategory, "categoryId"),
    categoryIsNull: false,
    kind: normalizeKindFilter(input.kind),
    status: normalizeStatusFilter(input.status),
  };
}

/** True when any transaction filter dimension is active. */
export function hasActiveTransactionFilters(
  filters: NormalizedS11TransactionFilters,
): boolean {
  return (
    filters.from !== undefined ||
    filters.to !== undefined ||
    filters.accountId !== undefined ||
    filters.categoryIsNull ||
    filters.categoryId !== undefined ||
    filters.kind !== undefined ||
    filters.status !== undefined
  );
}

function buildFinancialEventFilterPredicates(
  executor: ExportReadExecutor,
  context: FinancialContext,
  filters: NormalizedS11TransactionFilters,
): SQL<unknown>[] {
  const predicates: SQL<unknown>[] = [
    eq(financialEvents.householdId, context.householdId),
  ];

  if (filters.from !== undefined) {
    predicates.push(gte(financialEvents.occurredOn, filters.from));
  }
  if (filters.to !== undefined) {
    predicates.push(lte(financialEvents.occurredOn, filters.to));
  }
  if (filters.categoryIsNull) {
    predicates.push(isNull(financialEvents.categoryId));
  } else if (filters.categoryId !== undefined) {
    predicates.push(eq(financialEvents.categoryId, filters.categoryId));
  }
  if (filters.kind !== undefined) {
    predicates.push(eq(financialEvents.kind, filters.kind));
  }
  if (filters.status !== undefined) {
    predicates.push(eq(financialEvents.status, filters.status));
  }
  if (filters.accountId !== undefined) {
    predicates.push(
      exists(
        executor
          .select({ one: sql`1` })
          .from(accountEntries)
          .where(
            and(
              eq(accountEntries.financialEventId, financialEvents.id),
              eq(accountEntries.householdId, financialEvents.householdId),
              eq(accountEntries.accountId, filters.accountId),
            ),
          ),
      ),
    );
  }

  return predicates;
}

function financialEventFilterWhere(
  executor: ExportReadExecutor,
  context: FinancialContext,
  filters: NormalizedS11TransactionFilters | undefined,
): SQL<unknown> | undefined {
  if (filters === undefined || !hasActiveTransactionFilters(filters)) {
    return undefined;
  }
  return and(
    ...buildFinancialEventFilterPredicates(executor, context, filters),
  );
}

function entryPostedSortKey(column: typeof accountEntries.postedOn): SQL {
  return sql`coalesce(${column}, ${NULL_DATE_SENTINEL})`;
}

function entryExpectedSortKey(column: typeof accountEntries.expectedOn): SQL {
  return sql`coalesce(${column}, ${NULL_DATE_SENTINEL})`;
}

function keysetAfterOne(
  column: AnyColumn | SQL,
  value: string,
  idColumn: AnyColumn,
  id: string,
): SQL {
  return sql`(${column}, ${idColumn}) > (${value}, ${id})`;
}

function keysetAfterTwo(
  first: AnyColumn | SQL,
  firstValue: string,
  second: AnyColumn | SQL,
  secondValue: string | number,
  idColumn: AnyColumn,
  id: string,
): SQL {
  return sql`(${first}, ${second}, ${idColumn}) > (${firstValue}, ${secondValue}, ${id})`;
}

function keysetAfterId(idColumn: AnyColumn, id: string): SQL {
  return gt(idColumn, id);
}

interface PageCursor {
  values: string[];
  id: string;
}

function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(encoded: string): PageCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as PageCursor;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.values) ||
      typeof parsed.id !== "string"
    ) {
      throw new Error("invalid");
    }
    return parsed;
  } catch {
    throw new ExportReadError("INVALID_FILTER", "cursor");
  }
}

async function* streamPages(
  fetchPage: (
    cursor: string | null,
  ) => Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }>,
): AsyncGenerator<ExportDatasetRow> {
  let cursor: string | null = null;
  for (;;) {
    const page = await fetchPage(cursor);
    for (const row of page.rows) {
      yield row;
    }
    if (page.nextCursor === null) {
      return;
    }
    cursor = page.nextCursor;
  }
}

function detectDatasetAvailability(): Record<S11DatasetId, DatasetModuleGate> {
  const available: DatasetModuleGate = { availability: "AVAILABLE" };
  try {
    void accounts;
    void categories;
    void financialEvents;
    void accountEntries;
    void creditCards;
    void creditCardBillingRules;
    void creditCardPurchases;
    void installmentPlans;
    void installments;
    void recurringRules;
    void recurringOccurrences;
    void plannedEvents;
    void holidays;
    void spendableSettings;
    void budgets;
    void budgetMovements;
    void budgetAllocationRules;
    return Object.fromEntries(
      S11_DATASET_IDS.map((id) => [id, available]),
    ) as Record<S11DatasetId, DatasetModuleGate>;
  } catch {
    return Object.fromEntries(
      S11_DATASET_IDS.map((id) => [
        id,
        { availability: "UNAVAILABLE_EXTERNAL_GATE" as const },
      ]),
    ) as Record<S11DatasetId, DatasetModuleGate>;
  }
}

const datasetAvailability = detectDatasetAvailability();

async function readAccountsPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(accounts.householdId, context.householdId),
  ];
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(
      keysetAfterOne(
        accounts.name,
        decoded.values[0]!,
        accounts.id,
        decoded.id,
      ),
    );
  }

  const rows = await executor
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      status: accounts.status,
      spendability: accounts.spendability,
      liquidity: accounts.liquidity,
      includeInNetWorth: accounts.includeInNetWorth,
      trackingStartedOn: accounts.trackingStartedOn,
      createdAt: accounts.createdAt,
      updatedAt: accounts.updatedAt,
    })
    .from(accounts)
    .where(and(...predicates))
    .orderBy(asc(accounts.name), asc(accounts.id))
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      status: row.status,
      spendability: row.spendability,
      liquidity: row.liquidity,
      includeInNetWorth: row.includeInNetWorth,
      trackingStartedOn: toOptionalDate(row.trackingStartedOn),
      createdAt: toIsoTimestamp(row.createdAt),
      updatedAt: toIsoTimestamp(row.updatedAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({ values: [last.name], id: last.id })
        : null,
  };
}

async function readCategoriesPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(categories.householdId, context.householdId),
  ];
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(
      keysetAfterTwo(
        categories.kind,
        decoded.values[0]!,
        categories.name,
        decoded.values[1]!,
        categories.id,
        decoded.id,
      ),
    );
  }

  const rows = await executor
    .select({
      id: categories.id,
      name: categories.name,
      parentId: categories.parentId,
      kind: categories.kind,
      status: categories.status,
      createdAt: categories.createdAt,
      updatedAt: categories.updatedAt,
    })
    .from(categories)
    .where(and(...predicates))
    .orderBy(asc(categories.kind), asc(categories.name), asc(categories.id))
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: toOptionalUuid(row.parentId),
      kind: row.kind,
      status: row.status,
      createdAt: toIsoTimestamp(row.createdAt),
      updatedAt: toIsoTimestamp(row.updatedAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({
            values: [last.kind, last.name],
            id: last.id,
          })
        : null,
  };
}

async function readFinancialEventsPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  filters: NormalizedS11TransactionFilters | undefined,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(financialEvents.householdId, context.householdId),
  ];
  const filterWhere = financialEventFilterWhere(executor, context, filters);
  if (filterWhere !== undefined) {
    predicates.push(filterWhere);
  }
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(
      keysetAfterOne(
        financialEvents.occurredOn,
        decoded.values[0]!,
        financialEvents.id,
        decoded.id,
      ),
    );
  }

  const rows = await executor
    .select({
      id: financialEvents.id,
      kind: financialEvents.kind,
      status: financialEvents.status,
      origin: financialEvents.origin,
      amountCents: financialEvents.amountCents,
      occurredOn: financialEvents.occurredOn,
      description: financialEvents.description,
      categoryId: financialEvents.categoryId,
      reversalOfEventId: financialEvents.reversalOfEventId,
      createdAt: financialEvents.createdAt,
      updatedAt: financialEvents.updatedAt,
    })
    .from(financialEvents)
    .where(and(...predicates))
    .orderBy(asc(financialEvents.occurredOn), asc(financialEvents.id))
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      origin: row.origin,
      amountCents: toMoneyString(row.amountCents),
      occurredOn: row.occurredOn,
      description: row.description,
      categoryId: toOptionalUuid(row.categoryId),
      reversalOfEventId: toOptionalUuid(row.reversalOfEventId),
      createdAt: toIsoTimestamp(row.createdAt),
      updatedAt: toIsoTimestamp(row.updatedAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({ values: [last.occurredOn], id: last.id })
        : null,
  };
}

async function readAccountEntriesPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  filters: NormalizedS11TransactionFilters | undefined,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const postedKey = entryPostedSortKey(accountEntries.postedOn);
  const expectedKey = entryExpectedSortKey(accountEntries.expectedOn);
  const predicates: SQL<unknown>[] = [
    eq(accountEntries.householdId, context.householdId),
  ];

  const filterWhere = financialEventFilterWhere(executor, context, filters);
  if (filterWhere !== undefined) {
    const matchingEvents = executor
      .select({ id: financialEvents.id })
      .from(financialEvents)
      .where(filterWhere);
    predicates.push(inArray(accountEntries.financialEventId, matchingEvents));
  }

  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(
      keysetAfterTwo(
        postedKey,
        decoded.values[0]!,
        expectedKey,
        decoded.values[1]!,
        accountEntries.id,
        decoded.id,
      ),
    );
  }

  const rows = await executor
    .select({
      id: accountEntries.id,
      financialEventId: accountEntries.financialEventId,
      installmentId: accountEntries.installmentId,
      accountId: accountEntries.accountId,
      amountCents: accountEntries.amountCents,
      status: accountEntries.status,
      expectedOn: accountEntries.expectedOn,
      postedOn: accountEntries.postedOn,
      createdAt: accountEntries.createdAt,
    })
    .from(accountEntries)
    .where(and(...predicates))
    .orderBy(asc(postedKey), asc(expectedKey), asc(accountEntries.id))
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      financialEventId: row.financialEventId,
      installmentId: toOptionalUuid(row.installmentId),
      accountId: row.accountId,
      amountCents: toMoneyString(row.amountCents),
      status: row.status,
      expectedOn: toOptionalDate(row.expectedOn),
      postedOn: toOptionalDate(row.postedOn),
      createdAt: toIsoTimestamp(row.createdAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({
            values: [
              last.postedOn ?? NULL_DATE_SENTINEL,
              last.expectedOn ?? NULL_DATE_SENTINEL,
            ],
            id: last.id,
          })
        : null,
  };
}

async function readCreditCardsPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(creditCards.householdId, context.householdId),
  ];
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(keysetAfterId(creditCards.id, decoded.id));
  }

  const rows = await executor
    .select({
      id: creditCards.id,
      accountId: creditCards.accountId,
      creditLimitCents: creditCards.creditLimitCents,
      defaultPaymentAccountId: creditCards.defaultPaymentAccountId,
      createdAt: creditCards.createdAt,
      updatedAt: creditCards.updatedAt,
    })
    .from(creditCards)
    .where(and(...predicates))
    .orderBy(asc(creditCards.id))
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      creditLimitCents: toMoneyString(row.creditLimitCents),
      defaultPaymentAccountId: toOptionalUuid(row.defaultPaymentAccountId),
      createdAt: toIsoTimestamp(row.createdAt),
      updatedAt: toIsoTimestamp(row.updatedAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({ values: [], id: last.id })
        : null,
  };
}

async function readCreditCardBillingRulesPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(creditCardBillingRules.householdId, context.householdId),
  ];
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(
      keysetAfterTwo(
        creditCardBillingRules.cardId,
        decoded.values[0]!,
        creditCardBillingRules.effectiveFrom,
        decoded.values[1]!,
        creditCardBillingRules.id,
        decoded.id,
      ),
    );
  }

  const rows = await executor
    .select({
      id: creditCardBillingRules.id,
      cardId: creditCardBillingRules.cardId,
      closingDay: creditCardBillingRules.closingDay,
      dueDay: creditCardBillingRules.dueDay,
      effectiveFrom: creditCardBillingRules.effectiveFrom,
      effectiveUntil: creditCardBillingRules.effectiveUntil,
      createdAt: creditCardBillingRules.createdAt,
    })
    .from(creditCardBillingRules)
    .where(and(...predicates))
    .orderBy(
      asc(creditCardBillingRules.cardId),
      asc(creditCardBillingRules.effectiveFrom),
      asc(creditCardBillingRules.id),
    )
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      cardId: row.cardId,
      closingDay: String(row.closingDay),
      dueDay: String(row.dueDay),
      effectiveFrom: row.effectiveFrom,
      effectiveUntil: toOptionalDate(row.effectiveUntil),
      createdAt: toIsoTimestamp(row.createdAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({
            values: [last.cardId, last.effectiveFrom],
            id: last.id,
          })
        : null,
  };
}

async function readCreditCardPurchasesPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(creditCardPurchases.householdId, context.householdId),
  ];
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(keysetAfterId(creditCardPurchases.id, decoded.id));
  }

  const rows = await executor
    .select({
      id: creditCardPurchases.id,
      cardId: creditCardPurchases.cardId,
      financialEventId: creditCardPurchases.financialEventId,
      installmentPlanId: creditCardPurchases.installmentPlanId,
      createdAt: creditCardPurchases.createdAt,
      updatedAt: creditCardPurchases.updatedAt,
    })
    .from(creditCardPurchases)
    .where(and(...predicates))
    .orderBy(asc(creditCardPurchases.id))
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      cardId: row.cardId,
      financialEventId: row.financialEventId,
      installmentPlanId: row.installmentPlanId,
      createdAt: toIsoTimestamp(row.createdAt),
      updatedAt: toIsoTimestamp(row.updatedAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({ values: [], id: last.id })
        : null,
  };
}

async function readInstallmentPlansPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(installmentPlans.householdId, context.householdId),
  ];
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(keysetAfterId(installmentPlans.id, decoded.id));
  }

  const rows = await executor
    .select({
      id: installmentPlans.id,
      purchaseId: installmentPlans.purchaseId,
      totalAmountCents: installmentPlans.totalAmountCents,
      installmentCount: installmentPlans.installmentCount,
      createdAt: installmentPlans.createdAt,
    })
    .from(installmentPlans)
    .where(and(...predicates))
    .orderBy(asc(installmentPlans.id))
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      purchaseId: row.purchaseId,
      totalAmountCents: toMoneyString(row.totalAmountCents),
      installmentCount: String(row.installmentCount),
      createdAt: toIsoTimestamp(row.createdAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({ values: [], id: last.id })
        : null,
  };
}

async function readInstallmentsPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(installments.householdId, context.householdId),
  ];
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(
      keysetAfterTwo(
        installments.planId,
        decoded.values[0]!,
        installments.sequence,
        Number(decoded.values[1]!),
        installments.id,
        decoded.id,
      ),
    );
  }

  const rows = await executor
    .select({
      id: installments.id,
      planId: installments.planId,
      purchaseId: installments.purchaseId,
      sequence: installments.sequence,
      amountCents: installments.amountCents,
      status: installments.status,
      billingRuleId: installments.billingRuleId,
      billingCycle: installments.billingCycle,
      billingClosingDay: installments.billingClosingDay,
      billingDueDay: installments.billingDueDay,
      billingClosingOn: installments.billingClosingOn,
      billingDueOn: installments.billingDueOn,
      billingDueOnOverride: installments.billingDueOnOverride,
      createdAt: installments.createdAt,
    })
    .from(installments)
    .where(and(...predicates))
    .orderBy(
      asc(installments.planId),
      asc(installments.sequence),
      asc(installments.id),
    )
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      planId: row.planId,
      purchaseId: row.purchaseId,
      sequence: String(row.sequence),
      amountCents: toMoneyString(row.amountCents),
      status: row.status,
      billingRuleId: row.billingRuleId,
      billingCycle: row.billingCycle,
      billingClosingDay: String(row.billingClosingDay),
      billingDueDay: String(row.billingDueDay),
      billingClosingOn: row.billingClosingOn,
      billingDueOn: row.billingDueOn,
      billingDueOnOverride: toOptionalDate(row.billingDueOnOverride),
      createdAt: toIsoTimestamp(row.createdAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({
            values: [last.planId, String(last.sequence)],
            id: last.id,
          })
        : null,
  };
}

async function readRecurringRulesPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(recurringRules.householdId, context.householdId),
  ];
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(
      keysetAfterOne(
        recurringRules.startOn,
        decoded.values[0]!,
        recurringRules.id,
        decoded.id,
      ),
    );
  }

  const rows = await executor
    .select({
      id: recurringRules.id,
      accountId: recurringRules.accountId,
      categoryId: recurringRules.categoryId,
      kind: recurringRules.kind,
      amountCents: recurringRules.amountCents,
      description: recurringRules.description,
      frequency: recurringRules.frequency,
      dayRule: recurringRules.dayRule,
      dayOfMonth: recurringRules.dayOfMonth,
      startOn: recurringRules.startOn,
      endOn: recurringRules.endOn,
      includeInConservativeForecast: recurringRules.includeInConservativeForecast,
      createdAt: recurringRules.createdAt,
      updatedAt: recurringRules.updatedAt,
    })
    .from(recurringRules)
    .where(and(...predicates))
    .orderBy(asc(recurringRules.startOn), asc(recurringRules.id))
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      accountId: toOptionalUuid(row.accountId),
      categoryId: toOptionalUuid(row.categoryId),
      kind: row.kind,
      amountCents: toMoneyString(row.amountCents),
      description: row.description,
      frequency: row.frequency,
      dayRule: row.dayRule,
      dayOfMonth: row.dayOfMonth === null ? "" : String(row.dayOfMonth),
      startOn: row.startOn,
      endOn: toOptionalDate(row.endOn),
      includeInConservativeForecast: row.includeInConservativeForecast,
      createdAt: toIsoTimestamp(row.createdAt),
      updatedAt: toIsoTimestamp(row.updatedAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({ values: [last.startOn], id: last.id })
        : null,
  };
}

async function readRecurringOccurrencesPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(recurringOccurrences.householdId, context.householdId),
  ];
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(
      keysetAfterTwo(
        recurringOccurrences.recurringRuleId,
        decoded.values[0]!,
        recurringOccurrences.occurrenceKey,
        decoded.values[1]!,
        recurringOccurrences.id,
        decoded.id,
      ),
    );
  }

  const rows = await executor
    .select({
      id: recurringOccurrences.id,
      recurringRuleId: recurringOccurrences.recurringRuleId,
      occurrenceKey: recurringOccurrences.occurrenceKey,
      status: recurringOccurrences.status,
      amountCents: recurringOccurrences.amountCents,
      expectedOn: recurringOccurrences.expectedOn,
      financialEventId: recurringOccurrences.financialEventId,
      isPartial: recurringOccurrences.isPartial,
      createdAt: recurringOccurrences.createdAt,
      updatedAt: recurringOccurrences.updatedAt,
    })
    .from(recurringOccurrences)
    .where(and(...predicates))
    .orderBy(
      asc(recurringOccurrences.recurringRuleId),
      asc(recurringOccurrences.occurrenceKey),
      asc(recurringOccurrences.id),
    )
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      recurringRuleId: row.recurringRuleId,
      occurrenceKey: row.occurrenceKey,
      status: row.status,
      amountCents: toMoneyString(row.amountCents),
      expectedOn: toOptionalDate(row.expectedOn),
      financialEventId: toOptionalUuid(row.financialEventId),
      isPartial: row.isPartial,
      createdAt: toIsoTimestamp(row.createdAt),
      updatedAt: toIsoTimestamp(row.updatedAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({
            values: [last.recurringRuleId, last.occurrenceKey],
            id: last.id,
          })
        : null,
  };
}

async function readPlannedEventsPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(plannedEvents.householdId, context.householdId),
  ];
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(
      keysetAfterOne(
        plannedEvents.expectedOn,
        decoded.values[0]!,
        plannedEvents.id,
        decoded.id,
      ),
    );
  }

  const rows = await executor
    .select({
      id: plannedEvents.id,
      accountId: plannedEvents.accountId,
      categoryId: plannedEvents.categoryId,
      kind: plannedEvents.kind,
      status: plannedEvents.status,
      amountCents: plannedEvents.amountCents,
      expectedOn: plannedEvents.expectedOn,
      description: plannedEvents.description,
      includeInConservativeForecast: plannedEvents.includeInConservativeForecast,
      financialEventId: plannedEvents.financialEventId,
      isPartial: plannedEvents.isPartial,
      createdAt: plannedEvents.createdAt,
      updatedAt: plannedEvents.updatedAt,
    })
    .from(plannedEvents)
    .where(and(...predicates))
    .orderBy(asc(plannedEvents.expectedOn), asc(plannedEvents.id))
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      accountId: toOptionalUuid(row.accountId),
      categoryId: toOptionalUuid(row.categoryId),
      kind: row.kind,
      status: row.status,
      amountCents: toMoneyString(row.amountCents),
      expectedOn: row.expectedOn,
      description: row.description,
      includeInConservativeForecast: row.includeInConservativeForecast,
      financialEventId: toOptionalUuid(row.financialEventId),
      isPartial: row.isPartial,
      createdAt: toIsoTimestamp(row.createdAt),
      updatedAt: toIsoTimestamp(row.updatedAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({ values: [last.expectedOn], id: last.id })
        : null,
  };
}

async function readHolidaysPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(holidays.householdId, context.householdId),
  ];
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(
      keysetAfterOne(
        holidays.date,
        decoded.values[0]!,
        holidays.id,
        decoded.id,
      ),
    );
  }

  const rows = await executor
    .select({
      id: holidays.id,
      date: holidays.date,
      name: holidays.name,
      createdAt: holidays.createdAt,
      updatedAt: holidays.updatedAt,
    })
    .from(holidays)
    .where(and(...predicates))
    .orderBy(asc(holidays.date), asc(holidays.id))
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      date: row.date,
      name: row.name,
      createdAt: toIsoTimestamp(row.createdAt),
      updatedAt: toIsoTimestamp(row.updatedAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({ values: [last.date], id: last.id })
        : null,
  };
}

async function readSpendableSettingsPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(spendableSettings.householdId, context.householdId),
  ];
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(
      keysetAfterOne(
        spendableSettings.effectiveFrom,
        decoded.values[0]!,
        spendableSettings.id,
        decoded.id,
      ),
    );
  }

  const rows = await executor
    .select({
      id: spendableSettings.id,
      effectiveFrom: spendableSettings.effectiveFrom,
      operationalBufferCents: spendableSettings.operationalBufferCents,
      createdAt: spendableSettings.createdAt,
    })
    .from(spendableSettings)
    .where(and(...predicates))
    .orderBy(asc(spendableSettings.effectiveFrom), asc(spendableSettings.id))
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      effectiveFrom: row.effectiveFrom,
      operationalBufferCents: toMoneyString(row.operationalBufferCents),
      createdAt: toIsoTimestamp(row.createdAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({ values: [last.effectiveFrom], id: last.id })
        : null,
  };
}

async function readBudgetsPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(budgets.householdId, context.householdId),
  ];
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(
      keysetAfterOne(
        budgets.name,
        decoded.values[0]!,
        budgets.id,
        decoded.id,
      ),
    );
  }

  const rows = await executor
    .select({
      id: budgets.id,
      referenceId: budgets.referenceId,
      categoryId: budgets.categoryId,
      name: budgets.name,
      status: budgets.status,
      activeFrom: budgets.activeFrom,
      closedOn: budgets.closedOn,
      targetAmountCents: budgets.targetAmountCents,
      targetDate: budgets.targetDate,
      createdAt: budgets.createdAt,
      updatedAt: budgets.updatedAt,
    })
    .from(budgets)
    .where(and(...predicates))
    .orderBy(asc(budgets.name), asc(budgets.id))
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      referenceId: row.referenceId,
      categoryId: row.categoryId,
      name: row.name,
      status: row.status,
      activeFrom: row.activeFrom,
      closedOn: toOptionalDate(row.closedOn),
      targetAmountCents: toMoneyString(row.targetAmountCents),
      targetDate: toOptionalDate(row.targetDate),
      createdAt: toIsoTimestamp(row.createdAt),
      updatedAt: toIsoTimestamp(row.updatedAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({ values: [last.name], id: last.id })
        : null,
  };
}

async function readBudgetMovementsPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(budgetMovements.householdId, context.householdId),
  ];
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(
      keysetAfterOne(
        budgetMovements.effectiveOn,
        decoded.values[0]!,
        budgetMovements.id,
        decoded.id,
      ),
    );
  }

  const rows = await executor
    .select({
      id: budgetMovements.id,
      budgetId: budgetMovements.budgetId,
      referenceId: budgetMovements.referenceId,
      kind: budgetMovements.kind,
      amountCents: budgetMovements.amountCents,
      effectiveOn: budgetMovements.effectiveOn,
      sourceKind: budgetMovements.sourceKind,
      sourceReferenceId: budgetMovements.sourceReferenceId,
      financialEventId: budgetMovements.financialEventId,
      accountEntryId: budgetMovements.accountEntryId,
      correctsMovementId: budgetMovements.correctsMovementId,
      transferReferenceId: budgetMovements.transferReferenceId,
      createdAt: budgetMovements.createdAt,
    })
    .from(budgetMovements)
    .where(and(...predicates))
    .orderBy(asc(budgetMovements.effectiveOn), asc(budgetMovements.id))
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      budgetId: row.budgetId,
      referenceId: row.referenceId,
      kind: row.kind,
      amountCents: toMoneyString(row.amountCents),
      effectiveOn: row.effectiveOn,
      sourceKind: row.sourceKind,
      sourceReferenceId: row.sourceReferenceId ?? "",
      financialEventId: toOptionalUuid(row.financialEventId),
      accountEntryId: toOptionalUuid(row.accountEntryId),
      correctsMovementId: toOptionalUuid(row.correctsMovementId),
      transferReferenceId: row.transferReferenceId ?? "",
      createdAt: toIsoTimestamp(row.createdAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({ values: [last.effectiveOn], id: last.id })
        : null,
  };
}

async function readBudgetAllocationRulesPage(
  executor: ExportReadExecutor,
  context: FinancialContext,
  cursor: string | null,
): Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }> {
  const predicates: SQL<unknown>[] = [
    eq(budgetAllocationRules.householdId, context.householdId),
  ];
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    predicates.push(
      keysetAfterTwo(
        budgetAllocationRules.budgetId,
        decoded.values[0]!,
        budgetAllocationRules.effectiveFrom,
        decoded.values[1]!,
        budgetAllocationRules.id,
        decoded.id,
      ),
    );
  }

  const rows = await executor
    .select({
      id: budgetAllocationRules.id,
      budgetId: budgetAllocationRules.budgetId,
      amountCents: budgetAllocationRules.amountCents,
      effectiveFrom: budgetAllocationRules.effectiveFrom,
      effectiveUntil: budgetAllocationRules.effectiveUntil,
      createdAt: budgetAllocationRules.createdAt,
    })
    .from(budgetAllocationRules)
    .where(and(...predicates))
    .orderBy(
      asc(budgetAllocationRules.budgetId),
      asc(budgetAllocationRules.effectiveFrom),
      asc(budgetAllocationRules.id),
    )
    .limit(S11_EXPORT_PAGE_SIZE + 1);

  const page = rows.slice(0, S11_EXPORT_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      budgetId: row.budgetId,
      amountCents: toMoneyString(row.amountCents),
      effectiveFrom: row.effectiveFrom,
      effectiveUntil: toOptionalDate(row.effectiveUntil),
      createdAt: toIsoTimestamp(row.createdAt),
    })),
    nextCursor:
      rows.length > S11_EXPORT_PAGE_SIZE && last !== undefined
        ? encodeCursor({
            values: [last.budgetId, last.effectiveFrom],
            id: last.id,
          })
        : null,
  };
}

type DatasetPageReader = (
  executor: ExportReadExecutor,
  context: FinancialContext,
  filters: NormalizedS11TransactionFilters | undefined,
  cursor: string | null,
) => Promise<{ rows: ExportDatasetRow[]; nextCursor: string | null }>;

const DATASET_READERS: Record<S11DatasetId, DatasetPageReader> = {
  accounts: (executor, context, _filters, cursor) =>
    readAccountsPage(executor, context, cursor),
  categories: (executor, context, _filters, cursor) =>
    readCategoriesPage(executor, context, cursor),
  financial_events: (executor, context, filters, cursor) =>
    readFinancialEventsPage(executor, context, filters, cursor),
  account_entries: (executor, context, filters, cursor) =>
    readAccountEntriesPage(executor, context, filters, cursor),
  credit_cards: (executor, context, _filters, cursor) =>
    readCreditCardsPage(executor, context, cursor),
  credit_card_billing_rules: (executor, context, _filters, cursor) =>
    readCreditCardBillingRulesPage(executor, context, cursor),
  credit_card_purchases: (executor, context, _filters, cursor) =>
    readCreditCardPurchasesPage(executor, context, cursor),
  installment_plans: (executor, context, _filters, cursor) =>
    readInstallmentPlansPage(executor, context, cursor),
  installments: (executor, context, _filters, cursor) =>
    readInstallmentsPage(executor, context, cursor),
  recurring_rules: (executor, context, _filters, cursor) =>
    readRecurringRulesPage(executor, context, cursor),
  recurring_occurrences: (executor, context, _filters, cursor) =>
    readRecurringOccurrencesPage(executor, context, cursor),
  planned_events: (executor, context, _filters, cursor) =>
    readPlannedEventsPage(executor, context, cursor),
  holidays: (executor, context, _filters, cursor) =>
    readHolidaysPage(executor, context, cursor),
  spendable_settings: (executor, context, _filters, cursor) =>
    readSpendableSettingsPage(executor, context, cursor),
  budgets: (executor, context, _filters, cursor) =>
    readBudgetsPage(executor, context, cursor),
  budget_movements: (executor, context, _filters, cursor) =>
    readBudgetMovementsPage(executor, context, cursor),
  budget_allocation_rules: (executor, context, _filters, cursor) =>
    readBudgetAllocationRulesPage(executor, context, cursor),
};

/** Reads one export dataset as a tenant-scoped async generator. */
export async function readExportDataset(
  context: FinancialContext,
  datasetId: S11DatasetId,
  options: ExportReadsOptions = {},
): Promise<ExportDatasetReadResult> {
  assertFinancialContext(context);
  const gate = datasetAvailability[datasetId];
  const sort = DATASET_SORT_KEYS[datasetId];
  if (gate.availability !== "AVAILABLE") {
    return {
      availability: gate.availability,
      sort,
      rows: (async function* unavailable() {})(),
    };
  }

  const executor = resolveExecutor(options.database);
  const normalizedFilters =
    datasetId === "financial_events" || datasetId === "account_entries"
      ? normalizeS11TransactionFilters(options.filters)
      : undefined;

  const generator = streamPages((cursor) =>
    DATASET_READERS[datasetId](
      executor,
      context,
      normalizedFilters,
      cursor,
    ),
  );

  if (options.onDataset === undefined) {
    return {
      availability: "AVAILABLE",
      sort,
      rows: generator,
    };
  }

  const startedAt = performance.now();
  const wrapped = (async function* () {
    let rowCount = 0;
    for await (const row of generator) {
      rowCount += 1;
      yield row;
    }
    options.onDataset?.({
      id: datasetId,
      availability: "AVAILABLE",
      sort,
      rowCount,
      durationMs: Math.round(performance.now() - startedAt),
    });
  })();

  return {
    availability: "AVAILABLE",
    sort,
    rows: wrapped,
  };
}

/** Reads every contracted dataset for the resolved financial context. */
export async function readAllExportDatasets(
  context: FinancialContext,
  options: ExportReadsOptions = {},
): Promise<Record<S11DatasetId, ExportDatasetReadResult>> {
  const results = {} as Record<S11DatasetId, ExportDatasetReadResult>;
  for (const datasetId of S11_DATASET_IDS) {
    results[datasetId] = await readExportDataset(context, datasetId, options);
  }
  return results;
}

/** Exported for tests: encodes a keyset cursor from business sort values. */
export function encodeExportCursor(values: string[], id: string): string {
  return encodeCursor({ values, id });
}

/** Exported for tests: decodes a keyset cursor. */
export function decodeExportCursor(encoded: string): PageCursor {
  return decodeCursor(encoded);
}

/** Exported for tests: builds financial-event filter predicates. */
export function buildExportFinancialEventPredicates(
  executor: ExportReadExecutor,
  context: FinancialContext,
  filters: S11TransactionFilters,
): SQL<unknown>[] {
  return buildFinancialEventFilterPredicates(
    executor,
    context,
    normalizeS11TransactionFilters(filters),
  );
}

/** Exported for tests: impossible SQL predicate used for empty filter sets. */
export function exportImpossiblePredicate(): SQL {
  return impossiblePredicate();
}
