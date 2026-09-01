/**
 * Tenant-safe read boundaries for the S07 forecast.
 *
 * The functions in this file are deliberately boring adapters: they only
 * load source rows and never decide whether a row is a forecast item.  That
 * decision belongs to `builder.ts`, which is persistence independent.  The
 * household predicate is repeated on every table and relationship, including
 * joins reached through an opaque resource id.
 */
import { Temporal } from "@js-temporal/polyfill";
import {
  and,
  asc,
  eq,
  gte,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { getDb } from "@/db";
import {
  accountEntries,
  financialEvents,
  type AccountEntryRecord,
  type FinancialEventRecord,
} from "@/db/financial-events-schema";
import {
  creditCardPurchases,
  installmentPlans,
  installments,
  type CreditCardPurchaseRecord,
  type InstallmentPlanRecord,
  type InstallmentRecord,
} from "@/db/credit-cards-schema";
import {
  holidays,
  plannedEvents,
  recurringOccurrences,
  recurringRules,
  type HolidayRecord,
  type PlannedEventRecord,
  type RecurringOccurrenceRecord,
  type RecurringRuleRecord,
} from "@/db/recurring-schema";
import type { FinancialContext } from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import type { TransactionReferenceExecutor } from "@/modules/transactions/references";
import {
  createS07ForecastOperation,
  measureS07Query,
  type S07ForecastOperationOptions,
} from "@/modules/observability/s07";

/** A database or an already-open Drizzle transaction. */
export type ForecastReadExecutor = TransactionReferenceExecutor;

export interface ForecastSourceDateRange {
  /** Inclusive civil dates. Both are required for the aggregate read. */
  from: string;
  to: string;
}

export interface ForecastSourceReadOptions extends Partial<ForecastSourceDateRange> {
  database?: ForecastReadExecutor;
  /** Technical-only hooks; no source row or query payload is accepted. */
  observability?: Omit<
    S07ForecastOperationOptions,
    "householdId" | "sourceKind" | "periodBucket"
  >;
}

export interface ForecastOpeningBalanceReadModel {
  householdId: string;
  /** The last ledger day included in the opening balance. */
  asOf: string;
  openingBalanceCents: string;
}

export interface ForecastRealizedEventReadModel {
  event: FinancialEventRecord;
  entries: readonly AccountEntryRecord[];
}

export interface ForecastRecurringSourceReadModel {
  rule: RecurringRuleRecord;
  occurrence: RecurringOccurrenceRecord;
  event: FinancialEventRecord | null;
  entries: readonly AccountEntryRecord[];
}

export interface ForecastPlannedEventReadModel {
  plannedEvent: PlannedEventRecord;
  event: FinancialEventRecord | null;
  entries: readonly AccountEntryRecord[];
}

export interface ForecastInstallmentReadModel {
  installment: InstallmentRecord;
  purchase: CreditCardPurchaseRecord;
  plan: InstallmentPlanRecord;
  event: FinancialEventRecord;
  entries: readonly AccountEntryRecord[];
}

/**
 * Internal server-side bundle consumed by the pure timeline builder.  These
 * are persistence records on purpose; this type must not cross a route/UI
 * boundary. `openingBalanceCents` is derived from POSTED ledger entries.
 */
export interface ForecastSourceBundle {
  householdId: string;
  range: ForecastSourceDateRange;
  openingBalance: ForecastOpeningBalanceReadModel;
  realizedEvents: readonly ForecastRealizedEventReadModel[];
  recurringRules: readonly RecurringRuleRecord[];
  recurringOccurrences: readonly ForecastRecurringSourceReadModel[];
  holidays: readonly HolidayRecord[];
  plannedEvents: readonly ForecastPlannedEventReadModel[];
  installments: readonly ForecastInstallmentReadModel[];
}

/** Compatibility names used by adapters while the S07 boundary settles. */
export type ForecastSourcesReadModel = ForecastSourceBundle;
export type ForecastSourceReadModel = ForecastSourceBundle;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

function isContext(value: unknown): value is FinancialContext {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as Partial<FinancialContext>).userId === "string" &&
      typeof (value as Partial<FinancialContext>).householdId === "string",
  );
}

function parseDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new ForecastSourceError("INVALID_DATE", field);
  }
  try {
    return Temporal.PlainDate.from(value, { overflow: "reject" }).toString();
  } catch {
    throw new ForecastSourceError("INVALID_DATE", field);
  }
}

function normalizeRange(
  range: Partial<ForecastSourceDateRange> | undefined,
): ForecastSourceDateRange {
  const from = parseDate(range?.from, "from");
  const to = parseDate(range?.to, "to");
  if (from > to) {
    throw new ForecastSourceError("INVALID_DATE_RANGE", "from");
  }
  return { from, to };
}

function previousDate(value: string): string {
  return Temporal.PlainDate.from(value).subtract({ days: 1 }).toString();
}

function resolveExecutor(value?: ForecastReadExecutor): ForecastReadExecutor {
  return value ?? getDb();
}

function optionsFor(
  options: ForecastSourceReadOptions,
  context: FinancialContext,
  sourceKind:
    | "RECURRING"
    | "PLANNED_EVENT"
    | "INSTALLMENT"
    | "REALIZED_EVENT"
    | "ALL",
  range: ForecastSourceDateRange,
) {
  const operation = createS07ForecastOperation("source", {
    ...options.observability,
    householdId: context.householdId,
    sourceKind,
    periodBucket: periodBucket(range),
  });
  return {
    operation,
    queryOptions: {
      ...options.observability,
      technicalErrorCode: "FORECAST_SOURCE_QUERY_FAILED",
    } as Parameters<typeof measureS07Query>[2],
  };
}

function periodBucket(range: ForecastSourceDateRange): "SINGLE_PERIOD" | "SHORT" | "MEDIUM" | "LONG" {
  const from = Temporal.PlainDate.from(range.from);
  const to = Temporal.PlainDate.from(range.to);
  const months = (to.year - from.year) * 12 + to.month - from.month + 1;
  if (months <= 1) return "SINGLE_PERIOD";
  if (months <= 3) return "SHORT";
  if (months <= 12) return "MEDIUM";
  return "LONG";
}

async function measured<T>(
  executor: ForecastReadExecutor,
  operation: ReturnType<typeof createS07ForecastOperation>,
  work: () => Promise<T>,
  options: ForecastSourceReadOptions,
): Promise<T> {
  // Keeping the executor argument here documents that this is a query
  // boundary; it is intentionally not passed to observability.
  void executor;
  const queryOptions = {
    ...options.observability,
    technicalErrorCode: "FORECAST_SOURCE_QUERY_FAILED",
  } as Parameters<typeof measureS07Query>[2];
  return measureS07Query(operation, work, queryOptions);
}

function groupedRows<K, T extends { entry: AccountEntryRecord | null }>(
  rows: readonly T[],
  keyFor: (row: T) => K,
): Map<K, { row: T; entries: AccountEntryRecord[] }> {
  const grouped = new Map<K, { row: T; entries: AccountEntryRecord[] }>();
  for (const row of rows) {
    const key = keyFor(row);
    const existing = grouped.get(key);
    if (existing) {
      if (row.entry) existing.entries.push(row.entry);
    } else {
      grouped.set(key, {
        row,
        entries: row.entry ? [row.entry] : [],
      });
    }
  }
  return grouped;
}

export class ForecastSourceError extends Error {
  readonly code: "INVALID_DATE" | "INVALID_DATE_RANGE" | "FORECAST_SOURCE_QUERY_FAILED";
  readonly field: string | null;

  constructor(
    code: "INVALID_DATE" | "INVALID_DATE_RANGE" | "FORECAST_SOURCE_QUERY_FAILED",
    field?: string,
  ) {
    super(code);
    this.name = "ForecastSourceError";
    this.code = code;
    this.field = field ?? null;
  }
}

function rangeRulePredicate(
  context: FinancialContext,
  range: ForecastSourceDateRange,
): SQL<unknown> {
  return and(
    eq(recurringRules.householdId, context.householdId),
    lte(recurringRules.startOn, range.to),
    or(
      sql`${recurringRules.endOn} is null`,
      gte(recurringRules.endOn, range.from),
    ),
  )!;
}

/** Reads POSTED ledger position before `from`, across all household accounts. */
export async function readForecastOpeningBalanceForContext(
  context: FinancialContext,
  from: string,
  options?: ForecastSourceReadOptions,
): Promise<ForecastOpeningBalanceReadModel>;
export async function readForecastOpeningBalanceForContext(
  executor: ForecastReadExecutor,
  context: FinancialContext,
  from: string,
  options?: ForecastSourceReadOptions,
): Promise<ForecastOpeningBalanceReadModel>;
export async function readForecastOpeningBalanceForContext(
  first: FinancialContext | ForecastReadExecutor,
  second: string | FinancialContext,
  third?: string | ForecastSourceReadOptions,
  fourth: ForecastSourceReadOptions = {},
): Promise<ForecastOpeningBalanceReadModel> {
  const context = isContext(first) ? first : (second as FinancialContext);
  const from = isContext(first) ? (second as string) : (third as string);
  const options = (isContext(first) ? third : fourth) as ForecastSourceReadOptions | undefined ?? {};
  assertFinancialContext(context);
  const normalizedFrom = parseDate(from, "from");
  const asOf = previousDate(normalizedFrom);
  const executor = resolveExecutor(options.database);
  const { operation } = optionsFor(options, context, "ALL", {
    from: normalizedFrom,
    to: normalizedFrom,
  });
  const rows = await measured(
    executor,
    operation,
    () =>
      executor
        .select({
          balanceCents: sql<string>`coalesce(sum(${accountEntries.amountCents}), 0)::text`,
        })
        .from(accountEntries)
        .where(
          and(
            eq(accountEntries.householdId, context.householdId),
            eq(accountEntries.status, "POSTED"),
            lte(accountEntries.postedOn, asOf),
          ),
        ),
    options,
  );
  return {
    householdId: context.householdId,
    asOf,
    openingBalanceCents: String(rows[0]?.balanceCents ?? "0"),
  };
}

/** Lists independent POSTED effects in the requested interval. */
export async function readForecastRealizedEventsForContext(
  context: FinancialContext,
  range: ForecastSourceDateRange,
  options?: ForecastSourceReadOptions,
): Promise<ForecastRealizedEventReadModel[]>;
export async function readForecastRealizedEventsForContext(
  executor: ForecastReadExecutor,
  context: FinancialContext,
  range: ForecastSourceDateRange,
  options?: ForecastSourceReadOptions,
): Promise<ForecastRealizedEventReadModel[]>;
export async function readForecastRealizedEventsForContext(
  first: FinancialContext | ForecastReadExecutor,
  second: ForecastSourceDateRange | FinancialContext,
  third?: ForecastSourceDateRange | ForecastSourceReadOptions,
  fourth: ForecastSourceReadOptions = {},
): Promise<ForecastRealizedEventReadModel[]> {
  const context = isContext(first) ? first : (second as FinancialContext);
  const range = normalizeRange(
    isContext(first)
      ? (second as ForecastSourceDateRange)
      : (third as ForecastSourceDateRange),
  );
  const options = (isContext(first) ? third : fourth) as ForecastSourceReadOptions | undefined ?? {};
  assertFinancialContext(context);
  const executor = resolveExecutor(options.database ?? (!isContext(first) ? first : undefined));
  const { operation } = optionsFor(options, context, "REALIZED_EVENT", range);
  const rows = await measured(
    executor,
    operation,
    () =>
      executor
        .select({ event: financialEvents, entry: accountEntries })
        .from(accountEntries)
        .innerJoin(
          financialEvents,
          and(
            eq(accountEntries.financialEventId, financialEvents.id),
            eq(accountEntries.householdId, financialEvents.householdId),
          ),
        )
        .where(
          and(
            eq(accountEntries.householdId, context.householdId),
            eq(accountEntries.status, "POSTED"),
            gte(accountEntries.postedOn, range.from),
            lte(accountEntries.postedOn, range.to),
            eq(financialEvents.householdId, context.householdId),
            eq(financialEvents.status, "POSTED"),
          ),
        )
        .orderBy(
          asc(accountEntries.postedOn),
          asc(financialEvents.id),
          asc(accountEntries.id),
        ),
    options,
  );
  const byEvent = new Map<string, ForecastRealizedEventReadModel>();
  for (const row of rows) {
    const existing = byEvent.get(row.event.id);
    if (existing) {
      existing.entries = [...existing.entries, row.entry];
    } else {
      byEvent.set(row.event.id, { event: row.event, entries: [row.entry] });
    }
  }
  return [...byEvent.values()].sort((left, right) => left.event.id.localeCompare(right.event.id));
}

/** Reads recurring rules and durable occurrence exceptions in one boundary. */
export async function readForecastRecurringSourcesForContext(
  context: FinancialContext,
  range: ForecastSourceDateRange,
  options?: ForecastSourceReadOptions,
): Promise<{
  rules: readonly RecurringRuleRecord[];
  occurrences: readonly ForecastRecurringSourceReadModel[];
  holidays: readonly HolidayRecord[];
}>;
export async function readForecastRecurringSourcesForContext(
  executor: ForecastReadExecutor,
  context: FinancialContext,
  range: ForecastSourceDateRange,
  options?: ForecastSourceReadOptions,
): Promise<{
  rules: readonly RecurringRuleRecord[];
  occurrences: readonly ForecastRecurringSourceReadModel[];
  holidays: readonly HolidayRecord[];
}>;
export async function readForecastRecurringSourcesForContext(
  first: FinancialContext | ForecastReadExecutor,
  second: ForecastSourceDateRange | FinancialContext,
  third?: ForecastSourceDateRange | ForecastSourceReadOptions,
  fourth: ForecastSourceReadOptions = {},
): Promise<{
  rules: readonly RecurringRuleRecord[];
  occurrences: readonly ForecastRecurringSourceReadModel[];
  holidays: readonly HolidayRecord[];
}> {
  const context = isContext(first) ? first : (second as FinancialContext);
  const range = normalizeRange(
    isContext(first)
      ? (second as ForecastSourceDateRange)
      : (third as ForecastSourceDateRange),
  );
  const options = (isContext(first) ? third : fourth) as ForecastSourceReadOptions | undefined ?? {};
  assertFinancialContext(context);
  const executor = resolveExecutor(options.database ?? (!isContext(first) ? first : undefined));
  const { operation } = optionsFor(options, context, "RECURRING", range);

  const rows = await measured(
    executor,
    operation,
    () =>
      executor
        .select({
          rule: recurringRules,
          occurrence: recurringOccurrences,
          event: financialEvents,
          entry: accountEntries,
        })
        .from(recurringOccurrences)
        .innerJoin(
          recurringRules,
          and(
            eq(recurringRules.id, recurringOccurrences.recurringRuleId),
            eq(recurringRules.householdId, recurringOccurrences.householdId),
            rangeRulePredicate(context, range),
          ),
        )
        .leftJoin(
          financialEvents,
          and(
            eq(financialEvents.id, recurringOccurrences.financialEventId),
            eq(financialEvents.householdId, recurringOccurrences.householdId),
          ),
        )
        .leftJoin(
          accountEntries,
          and(
            eq(accountEntries.financialEventId, recurringOccurrences.financialEventId),
            eq(accountEntries.householdId, recurringOccurrences.householdId),
          ),
        )
        .where(
          and(
            eq(recurringOccurrences.householdId, context.householdId),
            eq(recurringRules.householdId, context.householdId),
          ),
        )
        .orderBy(
          asc(recurringOccurrences.occurrenceKey),
          asc(recurringOccurrences.id),
          asc(accountEntries.id),
        ),
    options,
  );

  type Joined = (typeof rows)[number];
  const grouped = groupedRows(rows as readonly Joined[], (row) => row.occurrence.id);
  const occurrences = [...grouped.values()]
    .map(({ row, entries }) => ({
      rule: row.rule,
      occurrence: row.occurrence,
      event: row.event,
      entries,
    }))
    .sort(
      (left, right) =>
        left.occurrence.occurrenceKey.localeCompare(right.occurrence.occurrenceKey) ||
        left.occurrence.id.localeCompare(right.occurrence.id),
    );

  const calendarHolidays = await measured(
    executor,
    operation,
    () =>
      executor
        .select()
        .from(holidays)
        .where(
          and(
            eq(holidays.householdId, context.householdId),
            lte(holidays.date, range.to),
          ),
        )
        .orderBy(asc(holidays.date), asc(holidays.id)),
    options,
  );

  const rules = await measured(
    executor,
    operation,
    () =>
      executor
        .select()
        .from(recurringRules)
        .where(rangeRulePredicate(context, range))
        .orderBy(asc(recurringRules.startOn), asc(recurringRules.id)),
    options,
  );

  return { rules, occurrences, holidays: calendarHolidays };
}

/** Reads one-off planned events, including overdue active rows. */
export async function readForecastPlannedEventsForContext(
  context: FinancialContext,
  range: ForecastSourceDateRange,
  options?: ForecastSourceReadOptions,
): Promise<readonly ForecastPlannedEventReadModel[]>;
export async function readForecastPlannedEventsForContext(
  executor: ForecastReadExecutor,
  context: FinancialContext,
  range: ForecastSourceDateRange,
  options?: ForecastSourceReadOptions,
): Promise<readonly ForecastPlannedEventReadModel[]>;
export async function readForecastPlannedEventsForContext(
  first: FinancialContext | ForecastReadExecutor,
  second: ForecastSourceDateRange | FinancialContext,
  third?: ForecastSourceDateRange | ForecastSourceReadOptions,
  fourth: ForecastSourceReadOptions = {},
): Promise<readonly ForecastPlannedEventReadModel[]> {
  const context = isContext(first) ? first : (second as FinancialContext);
  const range = normalizeRange(
    isContext(first)
      ? (second as ForecastSourceDateRange)
      : (third as ForecastSourceDateRange),
  );
  const options = (isContext(first) ? third : fourth) as ForecastSourceReadOptions | undefined ?? {};
  assertFinancialContext(context);
  const executor = resolveExecutor(options.database ?? (!isContext(first) ? first : undefined));
  const { operation } = optionsFor(options, context, "PLANNED_EVENT", range);
  const rows = await measured(
    executor,
    operation,
    () =>
      executor
        .select({
          plannedEvent: plannedEvents,
          event: financialEvents,
          entry: accountEntries,
        })
        .from(plannedEvents)
        .leftJoin(
          financialEvents,
          and(
            eq(financialEvents.id, plannedEvents.financialEventId),
            eq(financialEvents.householdId, plannedEvents.householdId),
          ),
        )
        .leftJoin(
          accountEntries,
          and(
            eq(accountEntries.financialEventId, plannedEvents.financialEventId),
            eq(accountEntries.householdId, plannedEvents.householdId),
          ),
        )
        .where(
          and(
            eq(plannedEvents.householdId, context.householdId),
            or(
              // Active commitments are retained when overdue so the engine
              // can account for them in openingAdjustments.
              lte(plannedEvents.expectedOn, range.to),
              // A posted fact may have an expected date after the requested
              // window; the ledger effect still belongs in the window.
              and(
                eq(financialEvents.householdId, context.householdId),
                eq(financialEvents.status, "POSTED"),
                eq(accountEntries.status, "POSTED"),
                gte(accountEntries.postedOn, range.from),
                lte(accountEntries.postedOn, range.to),
              ),
            ),
          ),
        )
        .orderBy(
          asc(plannedEvents.expectedOn),
          asc(plannedEvents.id),
          asc(accountEntries.id),
        ),
    options,
  );
  type Joined = (typeof rows)[number];
  const grouped = groupedRows(rows as readonly Joined[], (row) => row.plannedEvent.id);
  return [...grouped.values()]
    .map(({ row, entries }) => ({
      plannedEvent: row.plannedEvent,
      event: row.event,
      entries,
    }))
    .sort(
      (left, right) =>
        left.plannedEvent.expectedOn.localeCompare(right.plannedEvent.expectedOn) ||
        left.plannedEvent.id.localeCompare(right.plannedEvent.id),
    );
}

/** Reads materialized S06 installments once per installment, never the purchase total. */
export async function readForecastInstallmentsForContext(
  context: FinancialContext,
  range: ForecastSourceDateRange,
  options?: ForecastSourceReadOptions,
): Promise<readonly ForecastInstallmentReadModel[]>;
export async function readForecastInstallmentsForContext(
  executor: ForecastReadExecutor,
  context: FinancialContext,
  range: ForecastSourceDateRange,
  options?: ForecastSourceReadOptions,
): Promise<readonly ForecastInstallmentReadModel[]>;
export async function readForecastInstallmentsForContext(
  first: FinancialContext | ForecastReadExecutor,
  second: ForecastSourceDateRange | FinancialContext,
  third?: ForecastSourceDateRange | ForecastSourceReadOptions,
  fourth: ForecastSourceReadOptions = {},
): Promise<readonly ForecastInstallmentReadModel[]> {
  const context = isContext(first) ? first : (second as FinancialContext);
  const range = normalizeRange(
    isContext(first)
      ? (second as ForecastSourceDateRange)
      : (third as ForecastSourceDateRange),
  );
  const options = (isContext(first) ? third : fourth) as ForecastSourceReadOptions | undefined ?? {};
  assertFinancialContext(context);
  const executor = resolveExecutor(options.database ?? (!isContext(first) ? first : undefined));
  const { operation } = optionsFor(options, context, "INSTALLMENT", range);
  const rows = await measured(
    executor,
    operation,
    () =>
      executor
        .select({
          installment: installments,
          purchase: creditCardPurchases,
          plan: installmentPlans,
          event: financialEvents,
          entry: accountEntries,
        })
        .from(installments)
        .innerJoin(
          creditCardPurchases,
          and(
            eq(creditCardPurchases.id, installments.purchaseId),
            eq(creditCardPurchases.householdId, context.householdId),
          ),
        )
        .innerJoin(
          installmentPlans,
          and(
            eq(installmentPlans.id, installments.planId),
            eq(installmentPlans.purchaseId, installments.purchaseId),
            eq(installmentPlans.householdId, context.householdId),
          ),
        )
        .innerJoin(
          financialEvents,
          and(
            eq(financialEvents.id, creditCardPurchases.financialEventId),
            eq(financialEvents.householdId, context.householdId),
          ),
        )
        .leftJoin(
          accountEntries,
          and(
            eq(accountEntries.installmentId, installments.id),
            eq(accountEntries.financialEventId, financialEvents.id),
            eq(accountEntries.householdId, context.householdId),
          ),
        )
        .where(
          and(
            eq(installments.householdId, context.householdId),
            lte(installments.billingCycle, `${range.to.slice(0, 7)}-01`),
            or(
              lte(installments.billingDueOn, range.to),
              lte(installments.billingDueOnOverride, range.to),
              and(
                eq(accountEntries.status, "POSTED"),
                lte(accountEntries.postedOn, range.to),
              ),
            ),
          ),
        )
        .orderBy(
          asc(installments.billingCycle),
          asc(installments.billingDueOn),
          asc(installments.sequence),
          asc(installments.id),
          asc(accountEntries.id),
        ),
    options,
  );
  type Joined = (typeof rows)[number];
  const grouped = groupedRows(rows as readonly Joined[], (row) => row.installment.id);
  return [...grouped.values()]
    .map(({ row, entries }) => ({
      installment: row.installment,
      purchase: row.purchase,
      plan: row.plan,
      event: row.event,
      entries,
    }))
    .sort(
      (left, right) =>
        left.installment.billingCycle.localeCompare(right.installment.billingCycle) ||
        left.installment.billingDueOn.localeCompare(right.installment.billingDueOn) ||
        left.installment.sequence - right.installment.sequence ||
        left.installment.id.localeCompare(right.installment.id),
    );
}

/** Loads the four V1 boundaries plus independent realized effects. */
export async function readForecastSourcesForContext(
  context: FinancialContext,
  range: ForecastSourceDateRange,
  options?: ForecastSourceReadOptions,
): Promise<ForecastSourceBundle>;
export async function readForecastSourcesForContext(
  executor: ForecastReadExecutor,
  context: FinancialContext,
  range: ForecastSourceDateRange,
  options?: ForecastSourceReadOptions,
): Promise<ForecastSourceBundle>;
export async function readForecastSourcesForContext(
  first: FinancialContext | ForecastReadExecutor,
  second: ForecastSourceDateRange | FinancialContext,
  third?: ForecastSourceDateRange | ForecastSourceReadOptions,
  fourth: ForecastSourceReadOptions = {},
): Promise<ForecastSourceBundle> {
  const context = isContext(first) ? first : (second as FinancialContext);
  const range = normalizeRange(
    isContext(first)
      ? (second as ForecastSourceDateRange)
      : (third as ForecastSourceDateRange),
  );
  const options = (isContext(first) ? third : fourth) as ForecastSourceReadOptions | undefined ?? {};
  assertFinancialContext(context);
  const executor = resolveExecutor(options.database ?? (!isContext(first) ? first : undefined));
  const [openingBalance, realizedEvents, recurring, planned, installmentRows] = await Promise.all([
    readForecastOpeningBalanceForContext(executor, context, range.from, options),
    readForecastRealizedEventsForContext(executor, context, range, options),
    readForecastRecurringSourcesForContext(executor, context, range, options),
    readForecastPlannedEventsForContext(executor, context, range, options),
    readForecastInstallmentsForContext(executor, context, range, options),
  ]);
  return {
    householdId: context.householdId,
    range,
    openingBalance,
    realizedEvents,
    recurringRules: recurring.rules,
    recurringOccurrences: recurring.occurrences,
    holidays: recurring.holidays,
    plannedEvents: planned,
    installments: installmentRows,
  };
}

/** Context-first aliases matching the existing S03/T02 read vocabulary. */
export const readForecastOpeningBalance = readForecastOpeningBalanceForContext;
export const getForecastOpeningBalanceForContext = readForecastOpeningBalanceForContext;
export const readForecastRealizedEvents = readForecastRealizedEventsForContext;
export const listForecastRealizedEventsForContext = readForecastRealizedEventsForContext;
export const readForecastRecurringSources = readForecastRecurringSourcesForContext;
export const listForecastRecurringSourcesForContext = readForecastRecurringSourcesForContext;
export const readForecastPlannedEvents = readForecastPlannedEventsForContext;
export const listForecastPlannedEventsForContext = readForecastPlannedEventsForContext;
export const readForecastInstallments = readForecastInstallmentsForContext;
export const listForecastInstallmentsForContext = readForecastInstallmentsForContext;
export const readForecastSourceBundleForContext = readForecastSourcesForContext;
export const readForecastSources = readForecastSourcesForContext;
export const listForecastSourcesForContext = readForecastSourcesForContext;
