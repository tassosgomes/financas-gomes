/**
 * Server-side, tenant-scoped reads for the S07 persistence boundary.
 *
 * This module intentionally does not generate occurrences, reconcile facts or
 * expose commands; those behaviours belong to T03/T04.  It only provides
 * reusable reads for a caller that already has the authenticated financial
 * context.  Every query repeats the household predicate, including lookups
 * by an opaque resource id, so a cross-tenant id is indistinguishable from an
 * absent resource.
 */
import {
  and,
  asc,
  eq,
  gte,
  isNull,
  lte,
  or,
} from "drizzle-orm";

import { getDb, type Database } from "@/db";
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
import { isUuidV7 } from "@/lib/uuidv7";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import type { FinancialContext } from "@/modules/households/contracts";

export interface RecurringSourceDateRange {
  /** Inclusive ISO `YYYY-MM-DD` bounds, validated by the owning boundary. */
  from?: string;
  to?: string;
}

export interface RecurringSourceReadOptions extends RecurringSourceDateRange {
  database?: Database;
}

export interface RecurringSourceReadModel {
  recurringRules: readonly RecurringRuleRecord[];
  recurringOccurrences: readonly RecurringOccurrenceRecord[];
  holidays: readonly HolidayRecord[];
  plannedEvents: readonly PlannedEventRecord[];
}

function resolveDatabase(database?: Database): Database {
  return database ?? getDb();
}

function normalizedResourceId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return isUuidV7(normalized) ? normalized : undefined;
}

function rangeForRules(
  context: FinancialContext,
  range: RecurringSourceDateRange,
) {
  const predicates = [eq(recurringRules.householdId, context.householdId)];
  if (range.to !== undefined) {
    predicates.push(lte(recurringRules.startOn, range.to));
  }
  if (range.from !== undefined) {
    predicates.push(
      or(
        isNull(recurringRules.endOn),
        gte(recurringRules.endOn, range.from),
      )!,
    );
  }
  return and(...predicates);
}

function rangeForDate(
  column: typeof recurringOccurrences.expectedOn,
  context: FinancialContext,
  range: RecurringSourceDateRange,
) {
  const predicates = [eq(recurringOccurrences.householdId, context.householdId)];
  if (range.from !== undefined) {
    predicates.push(gte(column, range.from));
  }
  if (range.to !== undefined) {
    predicates.push(lte(column, range.to));
  }
  return and(...predicates);
}

/** Lists all rule rows visible to the supplied server context. */
export async function listRecurringRulesForContext(
  context: FinancialContext,
  options: RecurringSourceReadOptions = {},
): Promise<RecurringRuleRecord[]> {
  assertFinancialContext(context);
  return resolveDatabase(options.database)
    .select()
    .from(recurringRules)
    .where(rangeForRules(context, options))
    .orderBy(asc(recurringRules.startOn), asc(recurringRules.id));
}

/** Finds one rule, returning undefined for invalid or cross-tenant IDs. */
export async function getRecurringRuleForContext(
  context: FinancialContext,
  ruleId: unknown,
  options: Pick<RecurringSourceReadOptions, "database"> = {},
): Promise<RecurringRuleRecord | undefined> {
  assertFinancialContext(context);
  const normalizedId = normalizedResourceId(ruleId);
  if (!normalizedId) {
    return undefined;
  }
  const rows = await resolveDatabase(options.database)
    .select()
    .from(recurringRules)
    .where(
      and(
        eq(recurringRules.id, normalizedId),
        eq(recurringRules.householdId, context.householdId),
      ),
    )
    .limit(1);
  return rows[0];
}

/** Lists durable occurrence exceptions for the authenticated household. */
export async function listRecurringOccurrencesForContext(
  context: FinancialContext,
  options: RecurringSourceReadOptions = {},
): Promise<RecurringOccurrenceRecord[]> {
  assertFinancialContext(context);
  return resolveDatabase(options.database)
    .select()
    .from(recurringOccurrences)
    .where(rangeForDate(recurringOccurrences.expectedOn, context, options))
    .orderBy(asc(recurringOccurrences.expectedOn), asc(recurringOccurrences.id));
}

/** Finds one exception, returning undefined for invalid or cross-tenant IDs. */
export async function getRecurringOccurrenceForContext(
  context: FinancialContext,
  occurrenceId: unknown,
  options: Pick<RecurringSourceReadOptions, "database"> = {},
): Promise<RecurringOccurrenceRecord | undefined> {
  assertFinancialContext(context);
  const normalizedId = normalizedResourceId(occurrenceId);
  if (!normalizedId) {
    return undefined;
  }
  const rows = await resolveDatabase(options.database)
    .select()
    .from(recurringOccurrences)
    .where(
      and(
        eq(recurringOccurrences.id, normalizedId),
        eq(recurringOccurrences.householdId, context.householdId),
      ),
    )
    .limit(1);
  return rows[0];
}

/** Lists manually managed holidays in the authenticated household. */
export async function listHolidaysForContext(
  context: FinancialContext,
  options: RecurringSourceReadOptions = {},
): Promise<HolidayRecord[]> {
  assertFinancialContext(context);
  const predicates = [eq(holidays.householdId, context.householdId)];
  if (options.from !== undefined) {
    predicates.push(gte(holidays.date, options.from));
  }
  if (options.to !== undefined) {
    predicates.push(lte(holidays.date, options.to));
  }
  return resolveDatabase(options.database)
    .select()
    .from(holidays)
    .where(and(...predicates))
    .orderBy(asc(holidays.date), asc(holidays.id));
}

/** Finds one holiday, returning undefined for invalid or cross-tenant IDs. */
export async function getHolidayForContext(
  context: FinancialContext,
  holidayId: unknown,
  options: Pick<RecurringSourceReadOptions, "database"> = {},
): Promise<HolidayRecord | undefined> {
  assertFinancialContext(context);
  const normalizedId = normalizedResourceId(holidayId);
  if (!normalizedId) {
    return undefined;
  }
  const rows = await resolveDatabase(options.database)
    .select()
    .from(holidays)
    .where(
      and(
        eq(holidays.id, normalizedId),
        eq(holidays.householdId, context.householdId),
      ),
    )
    .limit(1);
  return rows[0];
}

/** Lists one-off commitments, including overdue active rows for opening adjustments. */
export async function listPlannedEventsForContext(
  context: FinancialContext,
  options: RecurringSourceReadOptions = {},
): Promise<PlannedEventRecord[]> {
  assertFinancialContext(context);
  const predicates = [eq(plannedEvents.householdId, context.householdId)];
  if (options.from !== undefined) {
    predicates.push(gte(plannedEvents.expectedOn, options.from));
  }
  if (options.to !== undefined) {
    predicates.push(lte(plannedEvents.expectedOn, options.to));
  }
  return resolveDatabase(options.database)
    .select()
    .from(plannedEvents)
    .where(and(...predicates))
    .orderBy(asc(plannedEvents.expectedOn), asc(plannedEvents.id));
}

/** Finds one planned event, returning undefined for invalid/cross-tenant IDs. */
export async function getPlannedEventForContext(
  context: FinancialContext,
  eventId: unknown,
  options: Pick<RecurringSourceReadOptions, "database"> = {},
): Promise<PlannedEventRecord | undefined> {
  assertFinancialContext(context);
  const normalizedId = normalizedResourceId(eventId);
  if (!normalizedId) {
    return undefined;
  }
  const rows = await resolveDatabase(options.database)
    .select()
    .from(plannedEvents)
    .where(
      and(
        eq(plannedEvents.id, normalizedId),
        eq(plannedEvents.householdId, context.householdId),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Performs the four source reads with one tenant predicate per query.  This
 * is the handoff boundary for a future timeline builder; it intentionally
 * returns persistence records only on the server.
 */
export async function readRecurringSourcesForContext(
  context: FinancialContext,
  options: RecurringSourceReadOptions = {},
): Promise<RecurringSourceReadModel> {
  assertFinancialContext(context);
  const database = resolveDatabase(options.database);
  const [rules, occurrences, calendarHolidays, oneOffEvents] = await Promise.all([
    listRecurringRulesForContext(context, { ...options, database }),
    listRecurringOccurrencesForContext(context, { ...options, database }),
    listHolidaysForContext(context, { ...options, database }),
    listPlannedEventsForContext(context, { ...options, database }),
  ]);
  return {
    recurringRules: rules,
    recurringOccurrences: occurrences,
    holidays: calendarHolidays,
    plannedEvents: oneOffEvents,
  };
}

/** Explicit aliases used by future readers without changing the boundary. */
export const listRecurringRules = listRecurringRulesForContext;
export const listRecurringOccurrences = listRecurringOccurrencesForContext;
export const listPlannedEvents = listPlannedEventsForContext;
export const listHouseholdHolidays = listHolidaysForContext;
export const readRecurringSources = readRecurringSourcesForContext;
export const listRecurringSourcesForContext = readRecurringSourcesForContext;
