import { Temporal } from "@js-temporal/polyfill";

/**
 * Civil values accepted by the billing domain.  Strings are deliberately
 * limited to the serialized forms used at boundaries; no JavaScript `Date`
 * is involved in any calculation in this module.
 */
export type BillingDateInput = string | Temporal.PlainDate;
export type BillingMonthInput = string | Temporal.PlainYearMonth;

export const BILLING_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
export const BILLING_MONTH_PATTERN = /^\d{4}-\d{2}$/u;

export const BILLING_ERROR_CODES = [
  "INVALID_DATE",
  "INVALID_BILLING_DAY",
  "INVALID_BILLING_RULE",
  "INVALID_BILLING_RULE_RANGE",
  "BILLING_RULE_NOT_FOUND",
  "BILLING_RULE_OVERLAP",
  "BILLING_RULE_NOT_APPLICABLE",
  "INVALID_BILLING_DUE_OVERRIDE",
  "BILLING_DUE_OVERRIDE_NOT_AFTER_CLOSING",
] as const;

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number];

/** Stable, database-independent errors exposed by the pure billing domain. */
export class BillingCycleError extends Error {
  readonly code: BillingErrorCode;
  readonly field?: string;

  constructor(code: BillingErrorCode, message: string, field?: string) {
    super(message);
    this.name = "BillingCycleError";
    this.code = code;
    this.field = field;
  }
}

export const CreditCardBillingError = BillingCycleError;
export const BillingDomainError = BillingCycleError;

/**
 * Versioned billing configuration.  `effectiveFrom`/`effectiveUntil` are
 * half-open: effectiveFrom <= occurredOn < effectiveUntil.  The range fields
 * are optional only to make a standalone rule convenient in pure callers;
 * omission means unbounded on that side.
 *
 * Snake-case aliases are accepted by the implementation for adapters that
 * read a database row, but the canonical domain names are camelCase.
 */
export interface BillingRule {
  id?: string | null;
  ruleId?: string | null;
  billingRuleId?: string | null;
  cardId?: string | null;
  closingDay?: number;
  dueDay?: number;
  effectiveFrom?: BillingDateInput | null;
  effectiveUntil?: BillingDateInput | null;
  closing_day?: number;
  due_day?: number;
  effective_from?: BillingDateInput | null;
  effective_until?: BillingDateInput | null;
  [key: string]: unknown;
}

export type BillingRuleInput = BillingRule;

/** Serializable snapshot persisted with each materialized installment. */
export interface BillingCycleSnapshot {
  billingRuleId: string | null;
  billingCycle: string;
  /** Alias for billingCycle used by statement/read-model callers. */
  cycle: string;
  competence: string;
  closingOn: string;
  dueOn: string;
  closingDay: number;
  dueDay: number;
  billingDueOnOverride: string | null;
  dueDateSource: "RULE" | "OVERRIDE";
}

/**
 * The result intentionally contains only serializable civil values.  The
 * implementation computes with Temporal.PlainDate/PlainYearMonth and emits
 * YYYY-MM-DD/YYYY-MM here so a caller cannot accidentally persist a timezone
 * bearing value or a mutable native date object.
 */
export type ResolvedBillingCycle = BillingCycleSnapshot;
export type BillingCycle = ResolvedBillingCycle;

export interface ResolveBillingCycleInput extends BillingRule {
  occurredOn?: BillingDateInput;
  purchaseDate?: BillingDateInput;
  date?: BillingDateInput;
  rule?: BillingRule;
  billingRule?: BillingRule;
  rules?: readonly BillingRule[];
  billingDueOnOverride?: BillingDateInput | null;
  billing_due_on_override?: BillingDateInput | null;
  override?: BillingDateInput | null;
}

export interface NormalizedBillingRule {
  id: string | null;
  cardId: string | null;
  closingDay: number;
  dueDay: number;
  effectiveFrom: Temporal.PlainDate;
  effectiveUntil: Temporal.PlainDate | null;
}

type ResolveArgs =
  | ResolveBillingCycleInput
  | BillingDateInput
  | { occurredOn: BillingDateInput; rule: BillingRule };

type ResolveRuleArgument = BillingRule | readonly BillingRule[];
type ResolveThirdArgument = number | BillingDateInput | null;

function fail(
  code: BillingErrorCode,
  message: string,
  field?: string,
): never {
  throw new BillingCycleError(code, message, field);
}

function isPlainDate(value: unknown): value is Temporal.PlainDate {
  return value instanceof Temporal.PlainDate;
}

function isPlainYearMonth(value: unknown): value is Temporal.PlainYearMonth {
  return value instanceof Temporal.PlainYearMonth;
}

/** Parse a strict YYYY-MM-DD without timezone or overflow. */
export function parseBillingDate(
  value: unknown,
  field = "date",
): Temporal.PlainDate {
  if (isPlainDate(value)) {
    return value;
  }

  if (typeof value !== "string" || !BILLING_DATE_PATTERN.test(value)) {
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

/** Parse a strict YYYY-MM without inventing a day or applying local time. */
export function parseBillingMonth(
  value: unknown,
  field = "billingCycle",
): Temporal.PlainYearMonth {
  if (isPlainYearMonth(value)) {
    return value;
  }

  if (typeof value !== "string" || !BILLING_MONTH_PATTERN.test(value)) {
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

export function serializeBillingDate(value: Temporal.PlainDate): string {
  if (!isPlainDate(value) || value.year < 0 || value.year > 9999) {
    return fail("INVALID_DATE", "Data civil inválida.", "date");
  }

  return [
    value.year.toString(10).padStart(4, "0"),
    value.month.toString(10).padStart(2, "0"),
    value.day.toString(10).padStart(2, "0"),
  ].join("-");
}

export function serializeBillingMonth(value: Temporal.PlainYearMonth): string {
  if (!isPlainYearMonth(value) || value.year < 0 || value.year > 9999) {
    return fail("INVALID_DATE", "Competência civil inválida.", "billingCycle");
  }

  return [
    value.year.toString(10).padStart(4, "0"),
    value.month.toString(10).padStart(2, "0"),
  ].join("-");
}

function compareDates(
  left: Temporal.PlainDate,
  right: Temporal.PlainDate,
): -1 | 0 | 1 {
  const result = Temporal.PlainDate.compare(left, right);
  return result < 0 ? -1 : result > 0 ? 1 : 0;
}

/**
 * Compares aliases by their civil value instead of object identity.  The
 * resolver accepts both strings and Temporal values, so two separately
 * constructed PlainDate instances for the same day must not be considered a
 * conflicting command payload.
 */
function sameCivilInput(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (
    (typeof left === "string" || isPlainDate(left)) &&
    (typeof right === "string" || isPlainDate(right))
  ) {
    try {
      return (
        serializeBillingDate(parseBillingDate(left)) ===
        serializeBillingDate(parseBillingDate(right))
      );
    } catch {
      return false;
    }
  }
  if (isPlainYearMonth(left) && isPlainYearMonth(right)) {
    return left.year === right.year && left.month === right.month;
  }
  return false;
}

function resolveCivilAlias<T>(
  values: readonly (T | undefined)[],
  field: string,
  code: BillingErrorCode = "INVALID_BILLING_RULE",
): T | undefined {
  const present = values.filter((value): value is T => value !== undefined);
  if (present.length > 1) {
    const first = present[0];
    if (present.some((value) => !sameCivilInput(first, value))) {
      return fail(
        code,
        "Aliases da entrada de billing divergentes.",
        field,
      );
    }
  }
  return present[0];
}

function readNumber(
  input: BillingRule,
  camelName: "closingDay" | "dueDay",
  snakeName: "closing_day" | "due_day",
): number {
  const value = input[camelName] ?? input[snakeName];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 31
  ) {
    return fail(
      "INVALID_BILLING_DAY",
      "O dia de fechamento e vencimento deve ser um inteiro entre 1 e 31.",
      camelName,
    );
  }
  return value;
}

function readDate(
  input: BillingRule,
  camelName: "effectiveFrom" | "effectiveUntil",
  snakeName: "effective_from" | "effective_until",
  fallback: BillingDateInput | null,
): Temporal.PlainDate | null {
  const value = input[camelName] ?? input[snakeName] ?? fallback;
  return value === null ? null : parseBillingDate(value, camelName);
}

function readIdentifier(input: BillingRule): string | null {
  const value = input.id ?? input.ruleId ?? input.billingRuleId;
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return fail(
      "INVALID_BILLING_RULE",
      "O identificador da regra de billing é inválido.",
      "billingRuleId",
    );
  }
  return value.trim();
}

function normalizeRule(input: BillingRule): NormalizedBillingRule {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fail("INVALID_BILLING_RULE", "Regra de billing inválida.", "rule");
  }

  const effectiveFrom = readDate(input, "effectiveFrom", "effective_from", "0000-01-01");
  const effectiveUntil = readDate(input, "effectiveUntil", "effective_until", null);
  if (!effectiveFrom) {
    return fail(
      "INVALID_BILLING_RULE_RANGE",
      "A regra precisa de uma data inicial de vigência.",
      "effectiveFrom",
    );
  }
  if (effectiveUntil && compareDates(effectiveUntil, effectiveFrom) <= 0) {
    return fail(
      "INVALID_BILLING_RULE_RANGE",
      "effectiveUntil deve ser posterior a effectiveFrom.",
      "effectiveUntil",
    );
  }

  const cardId = input.cardId;
  if (
    cardId !== undefined &&
    cardId !== null &&
    (typeof cardId !== "string" || cardId.trim().length === 0)
  ) {
    return fail("INVALID_BILLING_RULE", "Cartão da regra é inválido.", "cardId");
  }

  return {
    id: readIdentifier(input),
    cardId: cardId === undefined || cardId === null ? null : cardId.trim(),
    closingDay: readNumber(input, "closingDay", "closing_day"),
    dueDay: readNumber(input, "dueDay", "due_day"),
    effectiveFrom,
    effectiveUntil,
  };
}

/**
 * Normalizes a configured day into a concrete civil date in a month.
 * A day beyond the month's length is clamped to its last day (31 -> 28/29
 * in February, 31 -> 30 in a 30-day month); it never rolls into the next
 * month.
 */
export function normalizeBillingDay(
  month: BillingMonthInput,
  configuredDay: number,
): Temporal.PlainDate {
  const yearMonth =
    typeof month === "string" || isPlainYearMonth(month)
      ? parseBillingMonth(month)
      : fail("INVALID_DATE", "Competência civil inválida.", "billingCycle");

  if (
    !Number.isInteger(configuredDay) ||
    configuredDay < 1 ||
    configuredDay > 31
  ) {
    return fail(
      "INVALID_BILLING_DAY",
      "O dia de fechamento e vencimento deve ser um inteiro entre 1 e 31.",
      "billingDay",
    );
  }

  return yearMonth.toPlainDate({ day: Math.min(configuredDay, yearMonth.daysInMonth) });
}

export const normalizeDayOfMonth = normalizeBillingDay;
export const normalizeBillingDate = normalizeBillingDay;

function assertNonOverlapping(
  rules: readonly NormalizedBillingRule[],
): NormalizedBillingRule[] {
  const sorted = [...rules].sort((left, right) => {
    const byStart = compareDates(left.effectiveFrom, right.effectiveFrom);
    if (byStart !== 0) {
      return byStart;
    }
    return (left.id ?? "").localeCompare(right.id ?? "");
  });

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (
      previous.effectiveUntil === null ||
      compareDates(current.effectiveFrom, previous.effectiveUntil) < 0
    ) {
      return fail(
        "BILLING_RULE_OVERLAP",
        "As vigências das regras de billing não podem se sobrepor.",
        "effectiveFrom",
      );
    }
  }

  return sorted;
}

/** Validates and orders rules without mutating the caller's array. */
export function validateBillingRules(
  rules: readonly BillingRule[],
): readonly NormalizedBillingRule[] {
  if (!Array.isArray(rules) || rules.length === 0) {
    return fail(
      "BILLING_RULE_NOT_FOUND",
      "Nenhuma regra de billing foi configurada.",
      "rules",
    );
  }
  return assertNonOverlapping(rules.map(normalizeRule));
}

/** Selects the sole rule whose half-open effective range contains a date. */
export function resolveBillingRule(
  rules: readonly BillingRule[],
  occurredOn: BillingDateInput,
): BillingRule {
  const date = parseBillingDate(occurredOn, "occurredOn");
  const normalized = validateBillingRules(rules);
  const matching = normalized.filter(
    (rule) =>
      compareDates(date, rule.effectiveFrom) >= 0 &&
      (rule.effectiveUntil === null || compareDates(date, rule.effectiveUntil) < 0),
  );

  if (matching.length !== 1) {
    return fail(
      "BILLING_RULE_NOT_FOUND",
      "Nenhuma regra de billing vigente para a data informada.",
      "occurredOn",
    );
  }

  return matching[0] as unknown as BillingRule;
}

function asRuleInput(
  first: ResolveArgs,
  second?: ResolveRuleArgument | number,
  third?: ResolveThirdArgument,
): { occurredOn: BillingDateInput; rule: BillingRule; override: BillingDateInput | null } {
  if (typeof first === "string" || isPlainDate(first)) {
    const occurredOn = first;
    if (typeof second === "number") {
      if (typeof third !== "number") {
        return fail("INVALID_BILLING_RULE", "O dia de vencimento é obrigatório.", "dueDay");
      }
      return {
        occurredOn,
        rule: { closingDay: second, dueDay: third },
        override: null,
      };
    }
    if (Array.isArray(second)) {
      const rule = resolveBillingRule(second, occurredOn);
      if (third !== undefined && typeof third === "number") {
        return fail(
          "INVALID_BILLING_DUE_OVERRIDE",
          "O override de vencimento deve ser uma data civil.",
          "billingDueOnOverride",
        );
      }
      return {
        occurredOn,
        rule,
        override: third === undefined ? null : third,
      };
    }
    if (!second) {
      return fail("INVALID_BILLING_RULE", "Regra de billing obrigatória.", "rule");
    }
    if (third !== undefined && typeof third === "number") {
      return fail(
        "INVALID_BILLING_DUE_OVERRIDE",
        "O override de vencimento deve ser uma data civil.",
        "billingDueOnOverride",
      );
    }
    return {
      occurredOn,
      rule: second as BillingRule,
      override: third === undefined ? null : third,
    };
  }

  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return fail("INVALID_BILLING_RULE", "Entrada de billing inválida.", "rule");
  }

  const input = first as ResolveBillingCycleInput;
  const occurredOn = resolveCivilAlias(
    [input.occurredOn, input.purchaseDate, input.date],
    "occurredOn",
    "INVALID_DATE",
  );
  if (occurredOn === undefined) {
    return fail("INVALID_DATE", "A data da compra é obrigatória.", "occurredOn");
  }

  const explicitRule = input.rule ?? input.billingRule;
  let rule: BillingRule;
  if (explicitRule) {
    rule = explicitRule;
  } else if (input.rules) {
    rule = resolveBillingRule(input.rules, occurredOn);
  } else {
    rule = input;
  }

  const override =
    resolveCivilAlias(
      [
        input.billingDueOnOverride,
        input.billing_due_on_override,
        input.override,
      ],
      "billingDueOnOverride",
      "INVALID_BILLING_DUE_OVERRIDE",
    ) ?? null;
  return { occurredOn, rule, override };
}

/**
 * Resolve the billing cycle for a purchase date.
 *
 * The closing date is inclusive as a boundary: a purchase before the
 * normalized closing date belongs to that month's cycle; a purchase on the
 * closing date or after it belongs to the following cycle.  The due date is
 * the first normalized configured due day strictly after the closing date.
 */
export function resolveBillingCycle(
  input: ResolveBillingCycleInput,
): ResolvedBillingCycle;
export function resolveBillingCycle(
  occurredOn: BillingDateInput,
  rule: BillingRule | readonly BillingRule[],
): ResolvedBillingCycle;
export function resolveBillingCycle(
  occurredOn: BillingDateInput,
  rule: BillingRule | readonly BillingRule[],
  billingDueOnOverride: BillingDateInput | null,
): ResolvedBillingCycle;
export function resolveBillingCycle(
  occurredOn: BillingDateInput,
  closingDay: number,
  dueDay: number,
): ResolvedBillingCycle;
export function resolveBillingCycle(
  first: ResolveArgs,
  second?: ResolveRuleArgument | number,
  third?: ResolveThirdArgument,
): ResolvedBillingCycle {
  const args = asRuleInput(first, second, third);
  const occurredOn = parseBillingDate(args.occurredOn, "occurredOn");
  const normalizedRule = normalizeRule(args.rule);

  if (
    compareDates(occurredOn, normalizedRule.effectiveFrom) < 0 ||
    (normalizedRule.effectiveUntil !== null &&
      compareDates(occurredOn, normalizedRule.effectiveUntil) >= 0)
  ) {
    return fail(
      "BILLING_RULE_NOT_APPLICABLE",
      "A regra de billing não está vigente na data da compra.",
      "occurredOn",
    );
  }

  const purchaseMonth = occurredOn.toPlainYearMonth();
  const closingInPurchaseMonth = normalizeBillingDay(
    purchaseMonth,
    normalizedRule.closingDay,
  );
  const cycleMonth =
    compareDates(occurredOn, closingInPurchaseMonth) < 0
      ? purchaseMonth
      : purchaseMonth.add({ months: 1 });
  const closingOn = normalizeBillingDay(cycleMonth, normalizedRule.closingDay);

  let dueOn = normalizeBillingDay(cycleMonth, normalizedRule.dueDay);
  while (compareDates(dueOn, closingOn) <= 0) {
    dueOn = normalizeBillingDay(
      cycleMonth.add({ months: 1 }),
      normalizedRule.dueDay,
    );
  }

  let billingDueOnOverride: string | null = null;
  let dueDateSource: "RULE" | "OVERRIDE" = "RULE";
  if (args.override !== null && args.override !== undefined) {
    const overrideDate = parseBillingDate(
      args.override,
      "billingDueOnOverride",
    );
    if (compareDates(overrideDate, closingOn) <= 0) {
      return fail(
        "BILLING_DUE_OVERRIDE_NOT_AFTER_CLOSING",
        "O vencimento sobrescrito deve ser posterior ao fechamento resolvido.",
        "billingDueOnOverride",
      );
    }
    billingDueOnOverride = serializeBillingDate(overrideDate);
    dueOn = overrideDate;
    dueDateSource = "OVERRIDE";
  }

  const billingCycle = serializeBillingMonth(cycleMonth);
  const result: ResolvedBillingCycle = Object.freeze({
    billingRuleId: normalizedRule.id,
    billingCycle,
    cycle: billingCycle,
    competence: billingCycle,
    closingOn: serializeBillingDate(closingOn),
    dueOn: serializeBillingDate(dueOn),
    closingDay: normalizedRule.closingDay,
    dueDay: normalizedRule.dueDay,
    billingDueOnOverride,
    dueDateSource,
  });
  return result;
}

/** Convenience name used by adapters that persist the resolved snapshot. */
export const createBillingCycleSnapshot = resolveBillingCycle;
export const serializeResolvedBillingCycle = (
  value: ResolvedBillingCycle,
): BillingCycleSnapshot => Object.freeze({ ...value });
