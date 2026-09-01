import type { Temporal } from "@js-temporal/polyfill";

/**
 * Public vocabulary for the S07 recurrence domain.  These types intentionally
 * do not mention Drizzle, SQL, a request/session, or a JavaScript Date.
 */
export const RECURRENCE_FREQUENCIES = ["MONTHLY", "YEARLY"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];
export type RecurringFrequency = RecurrenceFrequency;

export const RECURRENCE_DAY_RULES = [
  "FIXED_DAY",
  "FIRST_BUSINESS_DAY",
  "LAST_BUSINESS_DAY",
] as const;
export type RecurrenceDayRule = (typeof RECURRENCE_DAY_RULES)[number];
export type RecurringDayRule = RecurrenceDayRule;

export const RECURRENCE_DIRECTIONS = ["INFLOW", "OUTFLOW"] as const;
export type RecurrenceDirection = (typeof RECURRENCE_DIRECTIONS)[number];
export type RecurringDirection = RecurrenceDirection;

export const RECURRING_RULE_STATUSES = ["ACTIVE", "CANCELLED"] as const;
export type RecurringRuleStatus = (typeof RECURRING_RULE_STATUSES)[number];

export const RECURRING_OCCURRENCE_STATUSES = [
  "PLANNED",
  "EXPECTED",
  "POSTED",
  "CANCELLED",
] as const;
export type RecurringOccurrenceStatus =
  (typeof RECURRING_OCCURRENCE_STATUSES)[number];

export type RecurrenceDateInput = string | Temporal.PlainDate;
export type RecurrenceMonthInput = string | Temporal.PlainYearMonth;

export interface CalendarHoliday {
  id?: string | null;
  householdId?: string | null;
  household_id?: string | null;
  date: RecurrenceDateInput;
  name?: string | null;
}

export type HolidayInput = RecurrenceDateInput | CalendarHoliday;

export interface BusinessCalendarInput {
  householdId?: string | null;
  household_id?: string | null;
  holidays?: readonly HolidayInput[];
}

/**
 * Boundary shape accepted by the pure rule normalizer.  Snake-case aliases
 * are included because T02 adapters will read database rows, while callers
 * creating a rule normally use the camelCase names.
 */
export interface RecurringRuleInput {
  id?: string | null;
  ruleId?: string | null;
  recurringRuleId?: string | null;
  householdId?: string | null;
  household_id?: string | null;
  frequency?: RecurrenceFrequency;
  dayRule?: RecurrenceDayRule;
  day_rule?: RecurrenceDayRule;
  dayOfMonth?: number | null;
  day_of_month?: number | null;
  monthOfYear?: number | null;
  month_of_year?: number | null;
  /** `month`/`day` are accepted as compact adapter aliases. */
  month?: number | null;
  day?: number | null;
  amountCents?: string | bigint;
  amount_cents?: string | bigint;
  direction?: RecurrenceDirection;
  flowDirection?: RecurrenceDirection;
  flow_direction?: RecurrenceDirection;
  /** Optional legacy-friendly aliases, normalized to INFLOW/OUTFLOW. */
  kind?: "INFLOW" | "OUTFLOW" | "INCOME" | "EXPENSE";
  startOn?: RecurrenceDateInput;
  start_on?: RecurrenceDateInput;
  endOn?: RecurrenceDateInput | null;
  end_on?: RecurrenceDateInput | null;
  includeInConservativeForecast?: boolean;
  include_in_conservative_forecast?: boolean;
  status?: RecurringRuleStatus;
  label?: string | null;
}

export interface NormalizedRecurringRule {
  id: string | null;
  householdId: string | null;
  frequency: RecurrenceFrequency;
  dayRule: RecurrenceDayRule;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  amountCents: string;
  direction: RecurrenceDirection;
  startOn: Temporal.PlainDate;
  endOn: Temporal.PlainDate | null;
  includeInConservativeForecast: boolean;
  status: RecurringRuleStatus;
  label: string | null;
}

/** An occurrence generated without querying or writing persistence. */
export interface RecurringOccurrence {
  ruleId: string | null;
  householdId: string | null;
  occurrenceKey: string;
  /** Alias used by adapters that call the key simply `key`. */
  key: string;
  date: string;
  amountCents: string;
  direction: RecurrenceDirection;
  status: Exclude<RecurringOccurrenceStatus, "CANCELLED">;
  includeInConservativeForecast: boolean;
  label: string | null;
  /** Stable server-side reconciliation key; never derived from a date. */
  reconciliationKey: string;
}

export interface RecurringRealization {
  /** The explicit POSTED FinancialEvent/entry relationship. */
  financialEventId: string;
  amountCents: string | bigint;
  /** The effect date supplied by the source; no date-based inference occurs. */
  realizedOn?: RecurrenceDateInput | null;
  postedOn?: RecurrenceDateInput | null;
  status?: "POSTED";
  /** Residual creation is allowed only when this is explicitly true. */
  partial?: boolean;
}

export interface RecurringOccurrenceOverride {
  id?: string | null;
  householdId?: string | null;
  household_id?: string | null;
  recurringRuleId?: string | null;
  recurring_rule_id?: string | null;
  ruleId?: string | null;
  occurrenceKey?: string;
  occurrence_key?: string;
  overrideDate?: RecurrenceDateInput | null;
  override_date?: RecurrenceDateInput | null;
  overrideAmountCents?: string | bigint | null;
  override_amount_cents?: string | bigint | null;
  status?: RecurringOccurrenceStatus;
  skip?: boolean;
  skipped?: boolean;
  cancelled?: boolean;
  realization?: RecurringRealization | null;
  realized?: RecurringRealization | null;
}

export interface RecurringOccurrenceItem {
  role: "PROJECTED" | "REALIZED" | "REMAINING";
  ruleId: string | null;
  householdId: string | null;
  occurrenceKey: string;
  reconciliationKey: string;
  date: string;
  amountCents: string;
  direction: RecurrenceDirection;
  status: Exclude<RecurringOccurrenceStatus, "CANCELLED">;
  includeInConservativeForecast: boolean;
  label: string | null;
  realizationId: string | null;
}

export interface RecurrenceReconciliation {
  key: string;
  replacesReferenceId: string | null;
  plannedAmountCents: string | null;
  realizedAmountCents: string | null;
  remainingAmountCents: string | null;
  varianceAmountCents: string | null;
}

export interface ReconciledRecurringOccurrence {
  ruleId: string | null;
  householdId: string | null;
  occurrenceKey: string;
  reconciliationKey: string;
  /** False for an explicitly skipped/cancelled occurrence. */
  active: boolean;
  status: RecurringOccurrenceStatus;
  plannedDate: string;
  effectiveDate: string | null;
  plannedAmountCents: string;
  realizedAmountCents: string | null;
  remainingAmountCents: string | null;
  varianceAmountCents: string | null;
  items: readonly RecurringOccurrenceItem[];
  /** Alias useful to source builders. */
  activeItems: readonly RecurringOccurrenceItem[];
  reconciliation: RecurrenceReconciliation | null;
}

export interface RecurringRuleVersionChange {
  previous: NormalizedRecurringRule;
  next: NormalizedRecurringRule;
}

