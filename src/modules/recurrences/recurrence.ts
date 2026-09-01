import { Temporal } from "@js-temporal/polyfill";

import {
  RECURRENCE_DATE_PATTERN,
  RECURRENCE_MONTH_PATTERN,
  RECURRENCE_YEAR_PATTERN,
  RecurrenceDomainError,
  assertBelongsToHousehold,
  assertCalendarBelongsToHousehold,
  compareRecurrenceDates,
  createBusinessCalendar,
  formatRecurrenceDate,
  parseRecurrenceDate,
  parseRecurrenceMonth,
  BusinessCalendar,
} from "./calendar";
import type {
  BusinessCalendarInput,
  CalendarHoliday,
  HolidayInput,
  NormalizedRecurringRule,
  RecurrenceDateInput,
  RecurrenceDirection,
  RecurrenceFrequency,
  RecurrenceMonthInput,
  RecurringOccurrence,
  RecurringOccurrenceItem,
  RecurringOccurrenceOverride,
  RecurringOccurrenceStatus,
  RecurringRealization,
  RecurringRuleInput,
  RecurringRuleVersionChange,
  ReconciledRecurringOccurrence,
  RecurrenceReconciliation,
} from "./contracts";

export {
  RECURRENCE_ERROR_CODES,
  CalendarError,
  RecurrenceDomainError,
  RecurrenceError,
  RecurringDomainError,
} from "./calendar";
export type { RecurrenceErrorCode } from "./calendar";

const MAX_INT64_CENTS = BigInt("9223372036854775807");
const INTEGER_PATTERN = /^\d+$/u;
const IDENTIFIER_MAX_LENGTH = 200;

export interface RecurrenceCalendarOptions {
  calendar?: BusinessCalendar;
  holidays?: readonly HolidayInput[];
  householdId?: string | null;
  household_id?: string | null;
}

export interface GenerateRecurringOccurrencesOptions
  extends RecurrenceCalendarOptions {
  /** Defaults to PLANNED because a configured recurring rule is a commitment. */
  occurrenceStatus?: "PLANNED" | "EXPECTED";
  status?: "PLANNED" | "EXPECTED";
}

export type RecurrencePeriodInput =
  | RecurrenceDateInput
  | RecurrenceMonthInput
  | string
  | number
  | { year: number; month?: number };

export interface GenerateRecurringOccurrencesInput
  extends GenerateRecurringOccurrencesOptions {
  rule: RecurringRuleInput | NormalizedRecurringRule;
  from: RecurrenceDateInput;
  to: RecurrenceDateInput;
}

function fail(
  code: ConstructorParameters<typeof RecurrenceDomainError>[0],
  message: string,
  field?: string,
): never {
  throw new RecurrenceDomainError(code, message, field);
}

function isNormalizedRule(
  input: RecurringRuleInput | NormalizedRecurringRule,
): input is NormalizedRecurringRule {
  return (
    typeof input === "object" &&
    input !== null &&
    input.startOn instanceof Temporal.PlainDate &&
    typeof input.amountCents === "string" &&
    typeof input.frequency === "string" &&
    typeof input.dayRule === "string"
  );
}

function readPrimitiveAlias<T>(
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

function normalizeIdentifier(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > IDENTIFIER_MAX_LENGTH
  ) {
    return fail("INVALID_RULE", "Identificador inválido.", field);
  }
  return value.trim();
}

function readIdentifier(input: RecurringRuleInput): string | null {
  return normalizeIdentifier(
    readPrimitiveAlias(
      [input.id, input.ruleId, input.recurringRuleId],
      "recurringRuleId",
    ),
    "recurringRuleId",
  );
}

function readHouseholdId(input: {
  householdId?: string | null;
  household_id?: string | null;
}): string | null {
  const value = readPrimitiveAlias(
    [input.householdId, input.household_id],
    "householdId",
  );
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return fail("TENANT_MISMATCH", "Household inválido.", "householdId");
  }
  return value.trim();
}

function sameDate(left: unknown, right: unknown): boolean {
  try {
    return (
      formatRecurrenceDate(parseRecurrenceDate(left)) ===
      formatRecurrenceDate(parseRecurrenceDate(right))
    );
  } catch {
    return false;
  }
}

function readDateAlias(
  values: readonly (RecurrenceDateInput | null | undefined)[],
  field: string,
): RecurrenceDateInput | null | undefined {
  const present = values.filter(
    (value): value is RecurrenceDateInput | null => value !== undefined,
  );
  if (present.length > 1) {
    const first = present[0];
    if (first === null || present.some((value) => !sameDate(first, value))) {
      return fail("INVALID_RULE", "Aliases de data são divergentes.", field);
    }
  }
  return present[0];
}

function readPositiveCents(value: unknown, field: string): string {
  if (typeof value === "bigint") {
    if (value <= BigInt(0) || value > MAX_INT64_CENTS) {
      return fail("INVALID_AMOUNT", "O valor em centavos deve ser positivo.", field);
    }
    return value.toString(10);
  }
  if (typeof value !== "string" || !INTEGER_PATTERN.test(value)) {
    return fail("INVALID_AMOUNT", "O valor em centavos é inválido.", field);
  }
  try {
    const cents = BigInt(value);
    if (cents <= BigInt(0) || cents > MAX_INT64_CENTS) {
      return fail("INVALID_AMOUNT", "O valor em centavos deve ser positivo.", field);
    }
    return cents.toString(10);
  } catch {
    return fail("INVALID_AMOUNT", "O valor em centavos é inválido.", field);
  }
}

function readNumberAlias(
  values: readonly (number | null | undefined)[],
  field: string,
): number | null | undefined {
  const present = values.filter(
    (value): value is number | null => value !== undefined,
  );
  if (present.length > 1) {
    const first = present[0];
    if (present.some((value) => value !== first)) {
      return fail("INVALID_RULE", "Aliases numéricos são divergentes.", field);
    }
  }
  return present[0];
}

function validateDay(value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 1 || value > 31) {
    return fail(
      "INVALID_DAY_OF_MONTH",
      "O dia da recorrência deve ser um inteiro entre 1 e 31.",
      "dayOfMonth",
    );
  }
  return value;
}

function validateMonth(value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 1 || value > 12) {
    return fail(
      "INVALID_MONTH_OF_YEAR",
      "O mês anual deve ser um inteiro entre 1 e 12.",
      "monthOfYear",
    );
  }
  return value;
}

function normalizeDirection(input: RecurringRuleInput): RecurrenceDirection {
  const explicit = readPrimitiveAlias(
    [input.direction, input.flowDirection, input.flow_direction],
    "direction",
  );
  const fromKind =
    input.kind === "INCOME"
      ? "INFLOW"
      : input.kind === "EXPENSE"
        ? "OUTFLOW"
        : input.kind;
  if (explicit !== undefined && fromKind !== undefined && explicit !== fromKind) {
    return fail("INVALID_DIRECTION", "Direção da recorrência divergente.", "direction");
  }
  const direction = explicit ?? fromKind;
  if (direction !== "INFLOW" && direction !== "OUTFLOW") {
    return fail("INVALID_DIRECTION", "Direção da recorrência inválida.", "direction");
  }
  return direction;
}

function normalizeLabel(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length === 0) {
    return null;
  }
  return normalized;
}

/** Normalizes and validates a recurring rule without touching persistence. */
export function normalizeRecurringRule(
  input: RecurringRuleInput | NormalizedRecurringRule,
): NormalizedRecurringRule {
  if (isNormalizedRule(input)) {
    return { ...input };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fail("INVALID_RULE", "Regra de recorrência inválida.", "rule");
  }

  const frequency = input.frequency;
  if (frequency !== "MONTHLY" && frequency !== "YEARLY") {
    return fail("INVALID_FREQUENCY", "Frequência de recorrência inválida.", "frequency");
  }

  const dayRule = readPrimitiveAlias(
    [input.dayRule, input.day_rule],
    "dayRule",
  );
  if (
    dayRule !== "FIXED_DAY" &&
    dayRule !== "FIRST_BUSINESS_DAY" &&
    dayRule !== "LAST_BUSINESS_DAY"
  ) {
    return fail("INVALID_DAY_RULE", "Regra de dia inválida.", "dayRule");
  }

  const dayOfMonth = validateDay(
    readNumberAlias(
      [input.dayOfMonth, input.day_of_month, input.day],
      "dayOfMonth",
    ),
  );
  let monthOfYear = validateMonth(
    readNumberAlias(
      [input.monthOfYear, input.month_of_year, input.month],
      "monthOfYear",
    ),
  );

  if (dayRule === "FIXED_DAY" && dayOfMonth === null) {
    return fail(
      "INVALID_DAY_OF_MONTH",
      "FIXED_DAY exige um dia configurado.",
      "dayOfMonth",
    );
  }
  if (frequency === "MONTHLY" && monthOfYear !== null) {
    return fail(
      "INVALID_MONTH_OF_YEAR",
      "Recorrência mensal não pode configurar mês anual.",
      "monthOfYear",
    );
  }

  const amountValue = readPrimitiveAlias(
    [input.amountCents, input.amount_cents],
    "amountCents",
  );
  if (amountValue === undefined) {
    return fail("INVALID_AMOUNT", "Valor da recorrência obrigatório.", "amountCents");
  }
  const amountCents = readPositiveCents(amountValue, "amountCents");
  const startValue = readDateAlias([input.startOn, input.start_on], "startOn");
  if (startValue === undefined || startValue === null) {
    return fail("INVALID_RULE", "A recorrência exige startOn.", "startOn");
  }
  const startOn = parseRecurrenceDate(startValue, "startOn");
  // T02 persists the month of a YEARLY rule in start_on (there is no extra
  // month column).  An explicit month remains useful to pure callers, but
  // the persisted-row shape naturally derives it from the start date.
  if (frequency === "YEARLY" && monthOfYear === null) {
    monthOfYear = startOn.month;
  }
  const endValue = readDateAlias([input.endOn, input.end_on], "endOn");
  const endOn = endValue === undefined || endValue === null
    ? null
    : parseRecurrenceDate(endValue, "endOn");
  if (endOn && compareRecurrenceDates(endOn, startOn) < 0) {
    return fail(
      "INVALID_RULE_RANGE",
      "endOn deve ser igual ou posterior a startOn.",
      "endOn",
    );
  }

  const status = input.status ?? "ACTIVE";
  if (status !== "ACTIVE" && status !== "CANCELLED") {
    return fail("INVALID_RULE", "Status da regra inválido.", "status");
  }

  return {
    id: readIdentifier(input),
    householdId: readHouseholdId(input),
    frequency,
    dayRule,
    dayOfMonth,
    monthOfYear,
    amountCents,
    direction: normalizeDirection(input),
    startOn,
    endOn,
    includeInConservativeForecast:
      input.includeInConservativeForecast ??
      input.include_in_conservative_forecast ??
      true,
    status,
    label: normalizeLabel(input.label),
  };
}

export const normalizeRecurring = normalizeRecurringRule;
export const validateRecurringRule = normalizeRecurringRule;

function yearString(year: number, field = "year"): string {
  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    return fail("INVALID_DATE", "Ano civil inválido.", field);
  }
  return year.toString(10).padStart(4, "0");
}

function monthString(year: number, month: number): string {
  return `${yearString(year)}-${month.toString(10).padStart(2, "0")}`;
}

function parseYear(value: unknown, field = "year"): number {
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 0 && value <= 9999) {
      return value;
    }
    return fail("INVALID_DATE", "Ano civil inválido.", field);
  }
  if (typeof value !== "string" || !RECURRENCE_YEAR_PATTERN.test(value)) {
    return fail("INVALID_DATE", "Ano deve usar o formato YYYY.", field);
  }
  return Number(value);
}

function periodParts(
  value: RecurrencePeriodInput,
  frequency: RecurrenceFrequency,
  explicitMonth?: number,
): { year: number; month: number | null } {
  if (frequency === "MONTHLY") {
    if (typeof value === "number") {
      if (explicitMonth === undefined) {
        return fail("INVALID_DATE", "Competência mensal inválida.", "period");
      }
      const year = parseYear(value);
      if (!Number.isInteger(explicitMonth) || explicitMonth < 1 || explicitMonth > 12) {
        return fail("INVALID_DATE", "Mês civil inválido.", "period");
      }
      return { year, month: explicitMonth };
    }
    if (value instanceof Temporal.PlainDate) {
      return { year: value.year, month: value.month };
    }
    if (value instanceof Temporal.PlainYearMonth) {
      return { year: value.year, month: value.month };
    }
    if (typeof value === "object" && value !== null) {
      const year = parseYear(value.year);
      if (
        !Number.isInteger(value.month) ||
        (value.month as number) < 1 ||
        (value.month as number) > 12
      ) {
        return fail("INVALID_DATE", "Mês civil inválido.", "period");
      }
      return { year, month: value.month as number };
    }
    if (typeof value === "string") {
      if (RECURRENCE_MONTH_PATTERN.test(value)) {
        const month = parseRecurrenceMonth(value, "period");
        return { year: month.year, month: month.month };
      }
      if (RECURRENCE_DATE_PATTERN.test(value)) {
        const date = parseRecurrenceDate(value, "period");
        return { year: date.year, month: date.month };
      }
    }
    return fail("INVALID_DATE", "Competência mensal inválida.", "period");
  }

  if (value instanceof Temporal.PlainDate || value instanceof Temporal.PlainYearMonth) {
    return { year: value.year, month: null };
  }
  if (typeof value === "object" && value !== null) {
    return { year: parseYear(value.year), month: null };
  }
  if (typeof value === "number" || typeof value === "string") {
    return { year: parseYear(value), month: null };
  }
  return fail("INVALID_DATE", "Ano de recorrência inválido.", "period");
}

function calendarFor(
  rule: NormalizedRecurringRule,
  options?: RecurrenceCalendarOptions | BusinessCalendar | readonly HolidayInput[],
): BusinessCalendar {
  if (options instanceof BusinessCalendar) {
    if (rule.householdId !== null) {
      assertCalendarBelongsToHousehold(options, rule.householdId);
    }
    return options;
  }

  const arrayOptions: RecurrenceCalendarOptions | undefined =
    options !== undefined && !Array.isArray(options)
      ? (options as RecurrenceCalendarOptions)
      : undefined;
  const explicitHouseholdId = arrayOptions
    ? readPrimitiveAlias(
        [arrayOptions.householdId, arrayOptions.household_id],
        "householdId",
      )
    : undefined;
  if (
    explicitHouseholdId !== undefined &&
    explicitHouseholdId !== null &&
    typeof explicitHouseholdId !== "string"
  ) {
    return fail("TENANT_MISMATCH", "Household inválido.", "householdId");
  }
  const householdId = explicitHouseholdId ?? rule.householdId;
  if (
    rule.householdId !== null &&
    householdId !== null &&
    householdId !== undefined &&
    rule.householdId !== householdId
  ) {
    return fail(
      "TENANT_RESOURCE_NOT_FOUND",
      "Recurso não encontrado.",
      "householdId",
    );
  }
  const holidays = Array.isArray(options)
    ? options
    : arrayOptions?.holidays;
  return createBusinessCalendar({
    householdId: householdId ?? null,
    holidays,
  });
}

function normalizeCalendarOption(
  options: RecurrenceCalendarOptions | BusinessCalendar | readonly HolidayInput[] | undefined,
): RecurrenceCalendarOptions | BusinessCalendar | readonly HolidayInput[] | undefined {
  return options;
}

/** Resolves one occurrence date for a civil period. */
export function resolveOccurrenceDate(
  ruleInput: RecurringRuleInput | NormalizedRecurringRule,
  period: RecurrencePeriodInput,
  options?: RecurrenceCalendarOptions | BusinessCalendar | readonly HolidayInput[],
): Temporal.PlainDate {
  const rule = normalizeRecurringRule(ruleInput);
  const parts = periodParts(period, rule.frequency);
  const month =
    rule.frequency === "MONTHLY"
      ? (parts.month as number)
      : (rule.monthOfYear as number);
  const yearMonth = parseRecurrenceMonth(monthString(parts.year, month), "period");
  const calendar = calendarFor(rule, normalizeCalendarOption(options));

  if (rule.dayRule === "FIRST_BUSINESS_DAY") {
    return calendar.firstBusinessDayOfMonth(yearMonth);
  }
  if (rule.dayRule === "LAST_BUSINESS_DAY") {
    return calendar.lastBusinessDayOfMonth(yearMonth);
  }
  const configuredDay = rule.dayOfMonth as number;
  return yearMonth.toPlainDate({
    day: Math.min(configuredDay, yearMonth.daysInMonth),
  });
}

/** Alias used by callers that name the date resolver after the aggregate. */
export const resolveRecurringDate = resolveOccurrenceDate;
export const resolveRecurringOccurrenceDate = resolveOccurrenceDate;
export const resolveDateForPeriod = resolveOccurrenceDate;

function occurrenceKeyForParts(
  frequency: RecurrenceFrequency,
  year: number,
  month: number | null,
): string {
  const yearPart = yearString(year);
  if (frequency === "YEARLY") {
    return yearPart;
  }
  if (month === null || month < 1 || month > 12) {
    return fail("INVALID_DATE", "Competência mensal inválida.", "period");
  }
  return `${yearPart}-${month.toString(10).padStart(2, "0")}`;
}

/** Creates the stable YYYY-MM/ YYYY key defined by ADR-008. */
export function occurrenceKey(
  frequencyOrRule: RecurrenceFrequency | RecurringRuleInput | NormalizedRecurringRule,
  period: RecurrencePeriodInput,
): string {
  const frequency =
    typeof frequencyOrRule === "string"
      ? frequencyOrRule
      : normalizeRecurringRule(frequencyOrRule).frequency;
  if (frequency !== "MONTHLY" && frequency !== "YEARLY") {
    return fail("INVALID_FREQUENCY", "Frequência de recorrência inválida.", "frequency");
  }
  const parts = periodParts(period, frequency);
  return occurrenceKeyForParts(frequency, parts.year, parts.month);
}

export const recurringOccurrenceKey = occurrenceKey;
export const buildOccurrenceKey = occurrenceKey;

function reconciliationKey(ruleId: string | null, key: string): string {
  // A missing id is useful in pure previews, but never causes two different
  // rules to collide: callers with persistence always provide the UUIDv7.
  return `${ruleId ?? "unidentified-rule"}:${key}`;
}

function occurrenceForPeriod(
  rule: NormalizedRecurringRule,
  period: RecurrencePeriodInput,
  calendar: BusinessCalendar,
  status: "PLANNED" | "EXPECTED",
): RecurringOccurrence {
  const date = resolveOccurrenceDate(rule, period, calendar);
  const key = occurrenceKey(rule, period);
  return {
    ruleId: rule.id,
    householdId: rule.householdId,
    occurrenceKey: key,
    key,
    date: formatRecurrenceDate(date),
    amountCents: rule.amountCents,
    direction: rule.direction,
    status,
    includeInConservativeForecast: rule.includeInConservativeForecast,
    label: rule.label,
    reconciliationKey: reconciliationKey(rule.id, key),
  };
}

function rangeParts(
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
  frequency: RecurrenceFrequency,
): { startYear: number; endYear: number; startMonth: number; endMonth: number } {
  if (frequency === "YEARLY") {
    return {
      startYear: from.year,
      endYear: to.year,
      startMonth: 1,
      endMonth: 12,
    };
  }
  return {
    startYear: from.year,
    endYear: to.year,
    startMonth: from.month,
    endMonth: to.month,
  };
}

function inInclusiveRange(
  value: Temporal.PlainDate,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
): boolean {
  return (
    compareRecurrenceDates(value, from) >= 0 &&
    compareRecurrenceDates(value, to) <= 0
  );
}

function generateFromInput(input: GenerateRecurringOccurrencesInput): readonly RecurringOccurrence[] {
  const rule = normalizeRecurringRule(input.rule);
  const from = parseRecurrenceDate(input.from, "from");
  const to = parseRecurrenceDate(input.to, "to");
  if (compareRecurrenceDates(from, to) > 0) {
    return fail(
      "INVALID_DATE_RANGE",
      "from deve ser igual ou anterior a to.",
      "from",
    );
  }
  if (input.householdId !== undefined && input.household_id !== undefined) {
    readPrimitiveAlias([input.householdId, input.household_id], "householdId");
  }
  if (
    input.householdId !== undefined &&
    input.householdId !== null &&
    rule.householdId !== null &&
    input.householdId !== rule.householdId
  ) {
    return fail("TENANT_RESOURCE_NOT_FOUND", "Recurso não encontrado.", "householdId");
  }
  if (rule.status === "CANCELLED") {
    return [];
  }

  const calendar = calendarFor(rule, input);
  const status = input.occurrenceStatus ?? input.status ?? "PLANNED";
  if (status !== "PLANNED" && status !== "EXPECTED") {
    return fail(
      "INVALID_OCCURRENCE",
      "O status de uma ocorrência virtual deve ser PLANNED ou EXPECTED.",
      "status",
    );
  }
  const result: RecurringOccurrence[] = [];
  const parts = rangeParts(from, to, rule.frequency);

  if (rule.frequency === "MONTHLY") {
    let current = parseRecurrenceMonth(
      monthString(parts.startYear, parts.startMonth),
      "from",
    );
    const last = parseRecurrenceMonth(
      monthString(parts.endYear, parts.endMonth),
      "to",
    );
    while (current.year < last.year || (current.year === last.year && current.month <= last.month)) {
      const occurrence = occurrenceForPeriod(
        rule,
        current,
        calendar,
        status,
      );
      const date = parseRecurrenceDate(occurrence.date);
      if (
        inInclusiveRange(date, from, to) &&
        compareRecurrenceDates(date, rule.startOn) >= 0 &&
        (rule.endOn === null || compareRecurrenceDates(date, rule.endOn) <= 0)
      ) {
        result.push(occurrence);
      }
      current = current.add({ months: 1 });
    }
  } else {
    for (let year = parts.startYear; year <= parts.endYear; year += 1) {
      const occurrence = occurrenceForPeriod(rule, year, calendar, status);
      const date = parseRecurrenceDate(occurrence.date);
      if (
        inInclusiveRange(date, from, to) &&
        compareRecurrenceDates(date, rule.startOn) >= 0 &&
        (rule.endOn === null || compareRecurrenceDates(date, rule.endOn) <= 0)
      ) {
        result.push(occurrence);
      }
    }
  }
  return result;
}

/** Generates virtual occurrences for the inclusive range, with no SQL. */
export function generateRecurringOccurrences(
  input: GenerateRecurringOccurrencesInput,
): readonly RecurringOccurrence[];
export function generateRecurringOccurrences(
  rule: RecurringRuleInput | NormalizedRecurringRule,
  from: RecurrenceDateInput,
  to: RecurrenceDateInput,
  options?: GenerateRecurringOccurrencesOptions,
): readonly RecurringOccurrence[];
export function generateRecurringOccurrences(
  first: GenerateRecurringOccurrencesInput | RecurringRuleInput | NormalizedRecurringRule,
  second?: RecurrenceDateInput,
  third?: RecurrenceDateInput,
  fourth?: GenerateRecurringOccurrencesOptions,
): readonly RecurringOccurrence[] {
  if (
    second === undefined &&
    third === undefined &&
    typeof first === "object" &&
    first !== null &&
    "rule" in first
  ) {
    return generateFromInput(first as GenerateRecurringOccurrencesInput);
  }
  if (second === undefined || third === undefined) {
    return fail("INVALID_DATE_RANGE", "Intervalo de recorrência obrigatório.", "from");
  }
  return generateFromInput({
    ...(fourth ?? {}),
    rule: first as RecurringRuleInput | NormalizedRecurringRule,
    from: second,
    to: third,
  });
}

export const generateOccurrences = generateRecurringOccurrences;
export const generateVirtualOccurrences = generateRecurringOccurrences;
export const buildRecurringOccurrences = generateRecurringOccurrences;

/** Validates inclusive, non-overlapping versions of one recurring timeline. */
export function validateRecurringRuleVersions(
  rules: readonly (RecurringRuleInput | NormalizedRecurringRule)[],
): readonly NormalizedRecurringRule[] {
  if (!Array.isArray(rules) || rules.length === 0) {
    return fail("RULE_NOT_FOUND", "Nenhuma regra de recorrência foi configurada.", "rules");
  }
  const normalized = rules.map(normalizeRecurringRule);
  const householdIds = new Set(
    normalized.map((rule) => rule.householdId).filter((id): id is string => id !== null),
  );
  if (householdIds.size > 1) {
    return fail("TENANT_MISMATCH", "Regras de households diferentes não podem ser misturadas.", "householdId");
  }
  const sorted = [...normalized].sort((left, right) => {
    const byStart = compareRecurrenceDates(left.startOn, right.startOn);
    if (byStart !== 0) return byStart;
    return (left.id ?? "").localeCompare(right.id ?? "");
  });
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (
      previous.endOn === null ||
      compareRecurrenceDates(current.startOn, previous.endOn) <= 0
    ) {
      return fail(
        "RULE_OVERLAP",
        "As vigências das regras de recorrência não podem se sobrepor.",
        "startOn",
      );
    }
  }
  return sorted;
}

export const validateRecurringRules = validateRecurringRuleVersions;

export function resolveRecurringRule(
  rules: readonly (RecurringRuleInput | NormalizedRecurringRule)[],
  dateInput: RecurrenceDateInput,
): NormalizedRecurringRule {
  const date = parseRecurrenceDate(dateInput, "date");
  const normalized = validateRecurringRuleVersions(rules);
  const matching = normalized.filter(
    (rule) =>
      rule.status === "ACTIVE" &&
      compareRecurrenceDates(date, rule.startOn) >= 0 &&
      (rule.endOn === null || compareRecurrenceDates(date, rule.endOn) <= 0),
  );
  if (matching.length !== 1) {
    return fail("RULE_NOT_FOUND", "Nenhuma regra vigente para a data informada.", "date");
  }
  return matching[0] as NormalizedRecurringRule;
}

export const resolveRuleForDate = resolveRecurringRule;

/**
 * Splits a rule at an effective date.  The old version ends the day before
 * the new one starts; no occurrence or override is rewritten.
 */
export function createProspectiveRuleVersion(
  currentInput: RecurringRuleInput | NormalizedRecurringRule,
  nextInput: RecurringRuleInput | NormalizedRecurringRule,
  effectiveFromInput: RecurrenceDateInput,
): RecurringRuleVersionChange {
  const current = normalizeRecurringRule(currentInput);
  const next = normalizeRecurringRule(nextInput);
  const effectiveFrom = parseRecurrenceDate(effectiveFromInput, "effectiveFrom");
  if (compareRecurrenceDates(effectiveFrom, current.startOn) <= 0) {
    return fail(
      "INVALID_RULE_RANGE",
      "A alteração prospectiva deve começar após o início atual.",
      "effectiveFrom",
    );
  }
  if (current.endOn && compareRecurrenceDates(effectiveFrom, current.endOn) > 0) {
    return fail(
      "INVALID_RULE_RANGE",
      "A alteração deve ocorrer durante a vigência atual.",
      "effectiveFrom",
    );
  }
  if (current.householdId !== null && next.householdId !== null && current.householdId !== next.householdId) {
    return fail("TENANT_MISMATCH", "A nova regra pertence a outro household.", "householdId");
  }
  const previousEnd = effectiveFrom.subtract({ days: 1 });
  const previous: NormalizedRecurringRule = {
    ...current,
    endOn: previousEnd,
  };
  const nextVersion: NormalizedRecurringRule = {
    ...next,
    householdId: next.householdId ?? current.householdId,
    startOn: effectiveFrom,
  };
  return { previous, next: nextVersion };
}

export const splitRecurringRule = createProspectiveRuleVersion;
export const updateRecurringRuleFuture = createProspectiveRuleVersion;

function occurrenceRuleId(input: RecurringOccurrenceOverride): string | null {
  return normalizeIdentifier(
    readPrimitiveAlias(
      [input.ruleId, input.recurringRuleId, input.recurring_rule_id],
      "recurringRuleId",
    ),
    "recurringRuleId",
  );
}

function normalizeRealization(
  input: RecurringRealization,
): RecurringRealization & { amountCents: string; realizedOn: string | null } {
  if (!input || typeof input !== "object") {
    return fail("REALIZATION_INVALID", "Realização inválida.", "realization");
  }
  if (
    typeof input.financialEventId !== "string" ||
    input.financialEventId.trim().length === 0
  ) {
    return fail("REALIZATION_INVALID", "Realização exige evento POSTED relacionado.", "financialEventId");
  }
  if (input.status !== undefined && input.status !== "POSTED") {
    return fail("REALIZATION_NOT_POSTED", "Somente realização POSTED é aceita.", "status");
  }
  const amountCents = readPositiveCents(input.amountCents, "realization.amountCents");
  const realizedDate = readDateAlias(
    [input.realizedOn, input.postedOn],
    "realization.realizedOn",
  );
  const realizedOn =
    realizedDate === undefined || realizedDate === null
      ? null
      : formatRecurrenceDate(parseRecurrenceDate(realizedDate, "realization.realizedOn"));
  return {
    ...input,
    financialEventId: input.financialEventId.trim(),
    amountCents,
    realizedOn,
    postedOn: realizedOn,
    status: "POSTED",
    partial: input.partial ?? false,
  };
}

interface NormalizedOccurrenceOverride {
  householdId: string | null;
  ruleId: string | null;
  occurrenceKey: string;
  overrideDate: string | null;
  overrideAmountCents: string | null;
  status: RecurringOccurrenceStatus | null;
  realization: (RecurringRealization & { amountCents: string; realizedOn: string | null }) | null;
}

function normalizeOccurrenceOverride(
  input: RecurringOccurrenceOverride,
): NormalizedOccurrenceOverride {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fail("INVALID_OCCURRENCE", "Override de ocorrência inválido.", "override");
  }
  const occurrenceKey = readPrimitiveAlias(
    [input.occurrenceKey, input.occurrence_key],
    "occurrenceKey",
  );
  if (typeof occurrenceKey !== "string" || occurrenceKey.length === 0) {
    return fail("INVALID_OCCURRENCE", "Override exige occurrenceKey.", "occurrenceKey");
  }
  const householdValue = readPrimitiveAlias(
    [input.householdId, input.household_id],
    "householdId",
  );
  const householdId =
    householdValue === undefined || householdValue === null
      ? null
      : normalizeIdentifier(householdValue, "householdId");
  const overrideDateValue = readDateAlias(
    [input.overrideDate, input.override_date],
    "overrideDate",
  );
  const overrideDate =
    overrideDateValue === undefined || overrideDateValue === null
      ? null
      : formatRecurrenceDate(parseRecurrenceDate(overrideDateValue, "overrideDate"));
  const amountValue = readPrimitiveAlias(
    [input.overrideAmountCents, input.override_amount_cents],
    "overrideAmountCents",
  );
  const overrideAmountCents =
    amountValue === undefined || amountValue === null
      ? null
      : readPositiveCents(amountValue, "overrideAmountCents");
  const realizationValue = input.realization ?? input.realized ?? null;
  const realization = realizationValue === null ? null : normalizeRealization(realizationValue);
  const cancellation = Boolean(input.skip || input.skipped || input.cancelled);
  let status = input.status;
  if (status !== undefined && !["PLANNED", "EXPECTED", "POSTED", "CANCELLED"].includes(status)) {
    return fail("INVALID_OCCURRENCE", "Status da ocorrência inválido.", "status");
  }
  if (cancellation && status !== undefined && status !== "CANCELLED") {
    return fail("INVALID_OCCURRENCE_STATE", "Skip/cancelamento conflita com status ativo.", "status");
  }
  if (cancellation) status = "CANCELLED";
  if (realization !== null) {
    if (status !== undefined && status !== "POSTED") {
      return fail("INVALID_OCCURRENCE_STATE", "Realização exige status POSTED.", "status");
    }
    status = "POSTED";
  }
  if (status === "POSTED" && realization === null) {
    return fail("REALIZATION_INVALID", "Status POSTED exige realização relacionada.", "realization");
  }
  if (status === "CANCELLED" && realization !== null) {
    return fail("INVALID_OCCURRENCE_STATE", "Ocorrência cancelada não pode ter realização.", "realization");
  }
  return {
    householdId,
    ruleId: occurrenceRuleId(input),
    occurrenceKey,
    overrideDate,
    overrideAmountCents,
    status: status ?? null,
    realization,
  };
}

function makeReconciliation(
  occurrence: RecurringOccurrence,
  key: string,
  plannedAmountCents: string,
  realizedAmountCents: string | null,
  remainingAmountCents: string | null,
  varianceAmountCents: string | null,
  replacesReferenceId: string | null,
): RecurrenceReconciliation {
  return {
    key,
    replacesReferenceId,
    plannedAmountCents,
    realizedAmountCents,
    remainingAmountCents,
    varianceAmountCents,
  };
}

function makeItem(
  occurrence: RecurringOccurrence,
  role: RecurringOccurrenceItem["role"],
  date: string,
  amountCents: string,
  status: "PLANNED" | "EXPECTED" | "POSTED",
  realizationId: string | null,
): RecurringOccurrenceItem {
  return {
    role,
    ruleId: occurrence.ruleId,
    householdId: occurrence.householdId,
    occurrenceKey: occurrence.occurrenceKey,
    reconciliationKey: occurrence.reconciliationKey,
    date,
    amountCents,
    direction: occurrence.direction,
    status,
    includeInConservativeForecast: occurrence.includeInConservativeForecast,
    label: occurrence.label,
    realizationId,
  };
}

/** Applies one explicit exception and/or POSTED realization to an occurrence. */
export function reconcileRecurringOccurrence(
  occurrence: RecurringOccurrence,
  overrideInput?: RecurringOccurrenceOverride | null,
): ReconciledRecurringOccurrence {
  if (!occurrence || typeof occurrence !== "object") {
    return fail("INVALID_OCCURRENCE", "Ocorrência inválida.", "occurrence");
  }
  const occurrenceKey = occurrence.occurrenceKey ?? occurrence.key;
  if (typeof occurrenceKey !== "string" || occurrenceKey.length === 0) {
    return fail("INVALID_OCCURRENCE", "Ocorrência exige occurrenceKey.", "occurrenceKey");
  }
  const plannedDate = formatRecurrenceDate(parseRecurrenceDate(occurrence.date, "occurrence.date"));
  const baseAmountCents = readPositiveCents(occurrence.amountCents, "occurrence.amountCents");
  const baseReconciliationKey = occurrence.reconciliationKey || reconciliationKey(occurrence.ruleId, occurrenceKey);
  const noOverride: NormalizedOccurrenceOverride = {
    householdId: null,
    ruleId: null,
    occurrenceKey,
    overrideDate: null,
    overrideAmountCents: null,
    status: occurrence.status,
    realization: null,
  };
  const override = overrideInput === undefined || overrideInput === null
    ? noOverride
    : normalizeOccurrenceOverride(overrideInput);
  if (override.occurrenceKey !== occurrenceKey) {
    return fail("OCCURRENCE_KEY_MISMATCH", "Override não pertence à ocorrência.", "occurrenceKey");
  }
  if (
    override.ruleId !== null &&
    override.ruleId !== occurrence.ruleId
  ) {
    return fail("TENANT_RESOURCE_NOT_FOUND", "Recurso não encontrado.", "recurringRuleId");
  }
  if (
    override.householdId !== null &&
    override.householdId !== occurrence.householdId
  ) {
    return fail("TENANT_RESOURCE_NOT_FOUND", "Recurso não encontrado.", "householdId");
  }

  const plannedAmountCents = override.overrideAmountCents ?? baseAmountCents;
  const effectiveDate = override.overrideDate ?? plannedDate;
  const effectiveStatus = override.status ?? occurrence.status;
  if (override.status === "CANCELLED") {
    const reconciliation = makeReconciliation(
      occurrence,
      baseReconciliationKey,
      plannedAmountCents,
      null,
      null,
      null,
      null,
    );
    return {
      ruleId: occurrence.ruleId,
      householdId: occurrence.householdId,
      occurrenceKey,
      reconciliationKey: baseReconciliationKey,
      active: false,
      status: "CANCELLED",
      plannedDate,
      effectiveDate: null,
      plannedAmountCents,
      realizedAmountCents: null,
      remainingAmountCents: null,
      varianceAmountCents: null,
      items: [],
      activeItems: [],
      reconciliation,
    };
  }

  const activeStatus =
    effectiveStatus === "CANCELLED"
      ? fail("INVALID_OCCURRENCE_STATE", "Ocorrência cancelada inválida.", "status")
      : effectiveStatus;
  const plannedStatus =
    activeStatus === "POSTED" ? "PLANNED" : activeStatus;

  if (override.realization === null) {
    const item = makeItem(
      occurrence,
      "PROJECTED",
      effectiveDate,
      plannedAmountCents,
      activeStatus === "POSTED" ? "POSTED" : activeStatus,
      null,
    );
    const hasException =
      override.overrideDate !== null ||
      override.overrideAmountCents !== null ||
      override.status !== null && override.status !== occurrence.status;
    return {
      ruleId: occurrence.ruleId,
      householdId: occurrence.householdId,
      occurrenceKey,
      reconciliationKey: baseReconciliationKey,
      active: true,
      status: item.status,
      plannedDate,
      effectiveDate,
      plannedAmountCents,
      realizedAmountCents: null,
      remainingAmountCents: null,
      varianceAmountCents: null,
      items: [item],
      activeItems: [item],
      reconciliation: hasException
        ? makeReconciliation(
            occurrence,
            baseReconciliationKey,
            plannedAmountCents,
            null,
            null,
            null,
            null,
          )
        : null,
    };
  }

  const realization = override.realization;
  const realizedAmountCents = realization.amountCents;
  const realizedOn = realization.realizedOn ?? effectiveDate;
  const planned = BigInt(plannedAmountCents);
  const realized = BigInt(realizedAmountCents);
  const residual = realization.partial
    ? planned > realized
      ? planned - realized
      : BigInt(0)
    : null;
  const variance = realized - planned;
  const realizedItem = makeItem(
    occurrence,
    "REALIZED",
    realizedOn,
    realizedAmountCents,
    "POSTED",
    realization.financialEventId,
  );
  const items: RecurringOccurrenceItem[] = [realizedItem];
  if (residual !== null && residual > BigInt(0)) {
    items.push(
      makeItem(
        occurrence,
        "REMAINING",
        effectiveDate,
        residual.toString(10),
        plannedStatus,
        null,
      ),
    );
  }
  const residualString = residual === null ? null : residual.toString(10);
  const varianceString = variance.toString(10);
  const reconciliation = makeReconciliation(
    occurrence,
    baseReconciliationKey,
    plannedAmountCents,
    realizedAmountCents,
    residualString,
    varianceString,
    realization.financialEventId,
  );
  return {
    ruleId: occurrence.ruleId,
    householdId: occurrence.householdId,
    occurrenceKey,
    reconciliationKey: baseReconciliationKey,
    active: true,
    status: "POSTED",
    plannedDate,
    effectiveDate: realizedOn,
    plannedAmountCents,
    realizedAmountCents,
    remainingAmountCents: residualString,
    varianceAmountCents: varianceString,
    items,
    activeItems: items,
    reconciliation,
  };
}

export const reconcileOccurrence = reconcileRecurringOccurrence;
export const applyOccurrenceOverride = reconcileRecurringOccurrence;
export const applyOccurrenceException = reconcileRecurringOccurrence;

/** Applies exceptions by stable rule/key identity and rejects duplicate sources. */
export function reconcileRecurringOccurrences(
  occurrences: readonly RecurringOccurrence[],
  overrides: readonly RecurringOccurrenceOverride[] = [],
): readonly ReconciledRecurringOccurrence[] {
  const occurrenceMap = new Map<string, RecurringOccurrence>();
  for (const occurrence of occurrences) {
    const key = occurrence.reconciliationKey || reconciliationKey(occurrence.ruleId, occurrence.occurrenceKey);
    if (occurrenceMap.has(key)) {
      return fail("FORECAST_INCONSISTENT", "Duas ocorrências ativas compartilham a mesma chave.", "occurrenceKey");
    }
    occurrenceMap.set(key, occurrence);
  }
  const overrideMap = new Map<string, RecurringOccurrenceOverride>();
  for (const override of overrides) {
    const normalized = normalizeOccurrenceOverride(override);
    const key = reconciliationKey(normalized.ruleId, normalized.occurrenceKey);
    if (overrideMap.has(key)) {
      return fail("FORECAST_INCONSISTENT", "Duas exceções compartilham a mesma chave.", "occurrenceKey");
    }
    overrideMap.set(key, override);
  }
  const result: ReconciledRecurringOccurrence[] = [];
  for (const [key, occurrence] of occurrenceMap) {
    const direct = overrideMap.get(key) ??
      overrideMap.get(reconciliationKey(null, occurrence.occurrenceKey));
    result.push(reconcileRecurringOccurrence(occurrence, direct));
  }
  for (const [key] of overrideMap) {
    if (!occurrenceMap.has(key) && ![...occurrenceMap.values()].some((occurrence) => occurrence.occurrenceKey === key.split(":").slice(1).join(":"))) {
      return fail("FORECAST_INCONSISTENT", "Exceção sem ocorrência correspondente.", "occurrenceKey");
    }
  }
  return result;
}

export const applyOccurrenceOverrides = reconcileRecurringOccurrences;
export const reconcileOccurrences = reconcileRecurringOccurrences;

export function assertRecurringRuleBelongsToHousehold(
  rule: RecurringRuleInput | NormalizedRecurringRule | null | undefined,
  householdId: string,
): NormalizedRecurringRule {
  const normalized = rule ? normalizeRecurringRule(rule) : null;
  assertBelongsToHousehold(normalized, householdId);
  return normalized as NormalizedRecurringRule;
}

export function assertRecurringOccurrenceBelongsToHousehold(
  occurrence: RecurringOccurrence | null | undefined,
  householdId: string,
): RecurringOccurrence {
  assertBelongsToHousehold(occurrence, householdId);
  return occurrence as RecurringOccurrence;
}

export function assertOccurrenceOverrideBelongsToHousehold(
  override: RecurringOccurrenceOverride | null | undefined,
  householdId: string,
): RecurringOccurrenceOverride {
  assertBelongsToHousehold(override, householdId);
  return override as RecurringOccurrenceOverride;
}

/** Returns a rule only when its server-loaded tenant identity matches. */
export function getTenantScopedRecurringRule(
  rules: readonly (RecurringRuleInput | NormalizedRecurringRule)[],
  ruleId: string,
  householdId: string,
): NormalizedRecurringRule {
  const found = rules.find((rule) => {
    const normalized = normalizeRecurringRule(rule);
    return normalized.id === ruleId;
  });
  return assertRecurringRuleBelongsToHousehold(found, householdId);
}

export function validateOccurrenceKey(
  ruleOrFrequency: RecurringFrequencyLike,
  key: string,
): string {
  const frequency =
    typeof ruleOrFrequency === "string"
      ? ruleOrFrequency
      : normalizeRecurringRule(ruleOrFrequency).frequency;
  if (frequency === "MONTHLY") {
    if (!RECURRENCE_MONTH_PATTERN.test(key)) {
      return fail("INVALID_OCCURRENCE", "Occurrence key mensal inválida.", "occurrenceKey");
    }
    parseRecurrenceMonth(key, "occurrenceKey");
    return key;
  }
  if (frequency === "YEARLY") {
    parseYear(key, "occurrenceKey");
    return key;
  }
  return fail("INVALID_FREQUENCY", "Frequência inválida.", "frequency");
}

type RecurringFrequencyLike =
  | RecurrenceFrequency
  | RecurringRuleInput
  | NormalizedRecurringRule;

export const assertOccurrenceKey = validateOccurrenceKey;

// Keep these aliases discoverable for the persistence adapters without making
// the pure domain depend on the T02 schema.
export type { CalendarHoliday, BusinessCalendarInput, BusinessCalendar, HolidayInput };
