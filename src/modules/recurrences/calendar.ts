import { Temporal } from "@js-temporal/polyfill";

import type {
  BusinessCalendarInput,
  CalendarHoliday,
  HolidayInput,
  RecurrenceDateInput,
  RecurrenceMonthInput,
} from "./contracts";

export const RECURRENCE_ERROR_CODES = [
  "INVALID_DATE",
  "INVALID_DATE_RANGE",
  "INVALID_FREQUENCY",
  "INVALID_DAY_RULE",
  "INVALID_DAY_OF_MONTH",
  "INVALID_MONTH_OF_YEAR",
  "INVALID_AMOUNT",
  "INVALID_DIRECTION",
  "INVALID_RULE",
  "INVALID_RULE_RANGE",
  "RULE_NOT_FOUND",
  "RULE_OVERLAP",
  "INVALID_OCCURRENCE",
  "OCCURRENCE_KEY_MISMATCH",
  "INVALID_OCCURRENCE_STATE",
  "REALIZATION_INVALID",
  "REALIZATION_NOT_POSTED",
  "TENANT_MISMATCH",
  "TENANT_RESOURCE_NOT_FOUND",
  "HOLIDAY_NOT_FOUND",
  "NO_BUSINESS_DAY",
  "FORECAST_INCONSISTENT",
] as const;

export type RecurrenceErrorCode = (typeof RECURRENCE_ERROR_CODES)[number];

/** Stable errors for recurrence/calendar boundaries; no persistence required. */
export class RecurrenceDomainError extends Error {
  readonly code: RecurrenceErrorCode;
  readonly field?: string;

  constructor(code: RecurrenceErrorCode, message: string, field?: string) {
    super(message);
    this.name = "RecurrenceDomainError";
    this.code = code;
    this.field = field;
  }
}

export const RecurringDomainError = RecurrenceDomainError;
export const RecurrenceError = RecurrenceDomainError;
export const CalendarError = RecurrenceDomainError;

export const RECURRENCE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
export const RECURRENCE_MONTH_PATTERN = /^\d{4}-\d{2}$/u;
export const RECURRENCE_YEAR_PATTERN = /^\d{4}$/u;

function fail(
  code: RecurrenceErrorCode,
  message: string,
  field?: string,
): never {
  throw new RecurrenceDomainError(code, message, field);
}

function isPlainDate(value: unknown): value is Temporal.PlainDate {
  return value instanceof Temporal.PlainDate;
}

function isPlainYearMonth(value: unknown): value is Temporal.PlainYearMonth {
  return value instanceof Temporal.PlainYearMonth;
}

/**
 * Parses the exact serializable date accepted by the S07 boundary.  Temporal
 * rejects impossible ISO dates (including 30 February); no timezone or
 * native Date participates in the calculation.
 */
export function parseRecurrenceDate(
  value: unknown,
  field = "date",
): Temporal.PlainDate {
  if (isPlainDate(value)) {
    return value;
  }

  if (typeof value !== "string" || !RECURRENCE_DATE_PATTERN.test(value)) {
    return fail(
      "INVALID_DATE",
      "A data deve usar o formato YYYY-MM-DD e ser válida no calendário ISO.",
      field,
    );
  }

  try {
    return Temporal.PlainDate.from(value, { overflow: "reject" });
  } catch {
    return fail(
      "INVALID_DATE",
      "A data deve usar o formato YYYY-MM-DD e ser válida no calendário ISO.",
      field,
    );
  }
}

export function parseRecurrenceMonth(
  value: unknown,
  field = "month",
): Temporal.PlainYearMonth {
  if (isPlainYearMonth(value)) {
    return value;
  }

  if (typeof value !== "string" || !RECURRENCE_MONTH_PATTERN.test(value)) {
    return fail(
      "INVALID_DATE",
      "A competência deve usar o formato YYYY-MM e ser válida no calendário ISO.",
      field,
    );
  }

  try {
    return Temporal.PlainYearMonth.from(value, { overflow: "reject" });
  } catch {
    return fail(
      "INVALID_DATE",
      "A competência deve usar o formato YYYY-MM e ser válida no calendário ISO.",
      field,
    );
  }
}

export function formatRecurrenceDate(value: Temporal.PlainDate): string {
  if (!isPlainDate(value) || value.year < 0 || value.year > 9999) {
    return fail("INVALID_DATE", "Data civil inválida.", "date");
  }

  return [
    value.year.toString(10).padStart(4, "0"),
    value.month.toString(10).padStart(2, "0"),
    value.day.toString(10).padStart(2, "0"),
  ].join("-");
}

export const serializeRecurrenceDate = formatRecurrenceDate;
export const formatFinancialDate = formatRecurrenceDate;
export const serializeFinancialDate = formatRecurrenceDate;
export const parseFinancialDate = parseRecurrenceDate;

export function formatRecurrenceMonth(value: Temporal.PlainYearMonth): string {
  if (!isPlainYearMonth(value) || value.year < 0 || value.year > 9999) {
    return fail("INVALID_DATE", "Competência civil inválida.", "month");
  }

  return [
    value.year.toString(10).padStart(4, "0"),
    value.month.toString(10).padStart(2, "0"),
  ].join("-");
}

export const serializeRecurrenceMonth = formatRecurrenceMonth;

export function compareRecurrenceDates(
  left: Temporal.PlainDate,
  right: Temporal.PlainDate,
): -1 | 0 | 1 {
  const result = Temporal.PlainDate.compare(left, right);
  return result < 0 ? -1 : result > 0 ? 1 : 0;
}

function readAlias<T>(
  values: readonly (T | undefined)[],
  field: string,
): T | undefined {
  const present = values.filter((value): value is T => value !== undefined);
  if (present.length > 1) {
    const first = present[0];
    if (present.some((value) => value !== first)) {
      return fail("INVALID_RULE", "Aliases da entrada são divergentes.", field);
    }
  }
  return present[0];
}

function readHouseholdId(input: {
  householdId?: string | null;
  household_id?: string | null;
}): string | null {
  const value = readAlias([input.householdId, input.household_id], "householdId");
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return fail("TENANT_MISMATCH", "Household inválido.", "householdId");
  }
  return value.trim();
}

function holidayDate(input: HolidayInput): Temporal.PlainDate {
  if (typeof input === "string" || isPlainDate(input)) {
    return parseRecurrenceDate(input, "holiday.date");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fail("INVALID_DATE", "Feriado inválido.", "holiday");
  }
  return parseRecurrenceDate(input.date, "holiday.date");
}

function holidayHouseholdId(input: HolidayInput): string | null {
  if (typeof input === "string" || isPlainDate(input)) {
    return null;
  }
  return readHouseholdId(input);
}

function assertHouseholdIdMatches(
  expectedHouseholdId: string | null | undefined,
  actualHouseholdId: string | null,
  field = "householdId",
): void {
  if (
    expectedHouseholdId !== undefined &&
    expectedHouseholdId !== null &&
    actualHouseholdId !== null &&
    expectedHouseholdId !== actualHouseholdId
  ) {
    return fail(
      "TENANT_MISMATCH",
      "O recurso não pertence ao contexto financeiro atual.",
      field,
    );
  }
}

function normalizeHolidayInputs(
  holidays: readonly HolidayInput[] | undefined,
  householdId: string | null,
): { dates: readonly string[]; values: readonly CalendarHoliday[] } {
  const byDate = new Map<string, CalendarHoliday>();
  for (const input of holidays ?? []) {
    const date = holidayDate(input);
    const dateString = formatRecurrenceDate(date);
    const inputHouseholdId = holidayHouseholdId(input);
    assertHouseholdIdMatches(householdId, inputHouseholdId);

    const value: CalendarHoliday =
      typeof input === "string" || isPlainDate(input)
        ? { date: dateString, householdId }
        : {
            ...input,
            date: dateString,
            householdId: inputHouseholdId ?? householdId,
          };
    const previous = byDate.get(dateString);
    if (previous && previous.householdId !== value.householdId) {
      return fail(
        "TENANT_MISMATCH",
        "Feriados de households diferentes não podem compartilhar calendário.",
        "holiday.householdId",
      );
    }
    byDate.set(dateString, value);
  }

  return {
    dates: [...byDate.keys()].sort(),
    values: [...byDate.values()],
  };
}

/**
 * A small immutable calendar value object.  The household is metadata used to
 * enforce tenant boundaries; it is never consulted to change date math.
 */
export class BusinessCalendar {
  readonly householdId: string | null;
  readonly holidays: readonly CalendarHoliday[];
  private readonly holidayDates: ReadonlySet<string>;

  constructor(input: BusinessCalendarInput | readonly HolidayInput[] = {}) {
    const normalizedInput: BusinessCalendarInput = Array.isArray(input)
      ? { holidays: input as readonly HolidayInput[] }
      : (input as BusinessCalendarInput);
    const householdId = readHouseholdId(normalizedInput);
    const normalized = normalizeHolidayInputs(
      normalizedInput.holidays,
      householdId,
    );
    this.householdId = householdId;
    this.holidays = normalized.values;
    this.holidayDates = new Set(normalized.dates);
    Object.freeze(this.holidays);
    Object.freeze(this);
  }

  isHoliday(value: RecurrenceDateInput): boolean {
    return this.holidayDates.has(formatRecurrenceDate(parseRecurrenceDate(value)));
  }

  isBusinessDay(value: RecurrenceDateInput): boolean {
    const date = parseRecurrenceDate(value);
    return date.dayOfWeek <= 5 && !this.isHoliday(date);
  }

  firstBusinessDayOfMonth(value: RecurrenceMonthInput): Temporal.PlainDate {
    const month = parseRecurrenceMonth(value);
    let date = month.toPlainDate({ day: 1 });
    while (date.month === month.month) {
      if (this.isBusinessDay(date)) {
        return date;
      }
      date = date.add({ days: 1 });
    }
    return fail(
      "NO_BUSINESS_DAY",
      "O mês não possui dia útil disponível.",
      "month",
    );
  }

  lastBusinessDayOfMonth(value: RecurrenceMonthInput): Temporal.PlainDate {
    const month = parseRecurrenceMonth(value);
    let date = month.toPlainDate({ day: month.daysInMonth });
    while (date.month === month.month) {
      if (this.isBusinessDay(date)) {
        return date;
      }
      date = date.subtract({ days: 1 });
    }
    return fail(
      "NO_BUSINESS_DAY",
      "O mês não possui dia útil disponível.",
      "month",
    );
  }
}

export function createBusinessCalendar(
  input: BusinessCalendarInput | readonly HolidayInput[] = {},
): BusinessCalendar {
  return new BusinessCalendar(input);
}

export const buildBusinessCalendar = createBusinessCalendar;
export const HolidayCalendar = BusinessCalendar;

function asCalendar(
  value: BusinessCalendar | BusinessCalendarInput | readonly HolidayInput[] | undefined,
): BusinessCalendar {
  if (value instanceof BusinessCalendar) {
    return value;
  }
  return createBusinessCalendar(value ?? {});
}

export function isHoliday(
  value: RecurrenceDateInput,
  calendar?: BusinessCalendar | BusinessCalendarInput | readonly HolidayInput[],
): boolean {
  return asCalendar(calendar).isHoliday(value);
}

export function isBusinessDay(
  value: RecurrenceDateInput,
  calendar?: BusinessCalendar | BusinessCalendarInput | readonly HolidayInput[],
): boolean {
  return asCalendar(calendar).isBusinessDay(value);
}

export function firstBusinessDayOfMonth(
  value: RecurrenceMonthInput,
  calendar?: BusinessCalendar | BusinessCalendarInput | readonly HolidayInput[],
): Temporal.PlainDate {
  return asCalendar(calendar).firstBusinessDayOfMonth(value);
}

export const resolveFirstBusinessDay = firstBusinessDayOfMonth;

export function lastBusinessDayOfMonth(
  value: RecurrenceMonthInput,
  calendar?: BusinessCalendar | BusinessCalendarInput | readonly HolidayInput[],
): Temporal.PlainDate {
  return asCalendar(calendar).lastBusinessDayOfMonth(value);
}

export const resolveLastBusinessDay = lastBusinessDayOfMonth;

/** Tenant-safe assertion shared by rule, occurrence and holiday adapters. */
export function assertBelongsToHousehold(
  resource: { householdId?: string | null; household_id?: string | null } | null | undefined,
  householdId: string,
  field = "householdId",
): void {
  if (!resource) {
    return fail(
      "TENANT_RESOURCE_NOT_FOUND",
      "Recurso não encontrado.",
      field,
    );
  }
  const resourceHouseholdId = readHouseholdId(resource);
  if (resourceHouseholdId !== householdId) {
    return fail(
      "TENANT_RESOURCE_NOT_FOUND",
      "Recurso não encontrado.",
      field,
    );
  }
}

export const assertTenantOwnership = assertBelongsToHousehold;
export const assertHouseholdOwnership = assertBelongsToHousehold;

export function assertHolidayBelongsToHousehold(
  holiday: CalendarHoliday | null | undefined,
  householdId: string,
): CalendarHoliday {
  assertBelongsToHousehold(holiday, householdId, "holiday.householdId");
  return holiday as CalendarHoliday;
}

export function assertCalendarBelongsToHousehold(
  calendar: BusinessCalendar,
  householdId: string,
): BusinessCalendar {
  if (calendar.householdId !== householdId) {
    return fail(
      "TENANT_RESOURCE_NOT_FOUND",
      "Calendário não encontrado.",
      "householdId",
    );
  }
  return calendar;
}
