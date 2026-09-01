import { z } from "zod";

/**
 * Public, serializable vocabulary for the S07 forecast boundary.
 *
 * These types intentionally contain no household, session, authorization,
 * database object, Date or bigint.  A server reader owns the financial
 * context and sends only this read model to a route/component.
 */

export const FORECAST_CONTRACT_VERSION = "s07.v1" as const;

export const FORECAST_SCENARIOS = ["CONSERVATIVE", "EXPECTED"] as const;
export type ForecastScenario = (typeof FORECAST_SCENARIOS)[number];

export const FORECAST_CERTAINTIES = [
  "REALIZED",
  "COMMITTED",
  "EXPECTED",
] as const;
export type ForecastCertainty = (typeof FORECAST_CERTAINTIES)[number];

export const FORECAST_DIRECTIONS = ["INFLOW", "OUTFLOW"] as const;
export type ForecastDirection = (typeof FORECAST_DIRECTIONS)[number];

export const FORECAST_ITEM_STATUSES = [
  "PLANNED",
  "EXPECTED",
  "POSTED",
] as const;
export type ForecastItemStatus = (typeof FORECAST_ITEM_STATUSES)[number];

export const FORECAST_SOURCE_KINDS = [
  "RECURRING",
  "PLANNED_EVENT",
  "INSTALLMENT",
  "REALIZED_EVENT",
] as const;
export type ForecastSourceKind = (typeof FORECAST_SOURCE_KINDS)[number];

export interface ForecastSource {
  kind: ForecastSourceKind;
  /** Opaque, server-authorized reference used only for drill-down. */
  referenceId: string;
  /** Safe display label supplied by the server. */
  label: string;
  /** Only recurring sources expose these optional identifiers. */
  recurringRuleId?: string;
  occurrenceKey?: string;
  /** Only installment sources expose the materialized billing cycle. */
  billingCycle?: string;
  installmentSequence?: number;
}

export interface ForecastReconciliation {
  key: string;
  replacesReferenceId: string | null;
  plannedAmountCents: string | null;
  realizedAmountCents: string | null;
  remainingAmountCents: string | null;
  varianceAmountCents: string | null;
}

export interface ForecastItem {
  date: string;
  /** Always a positive decimal integer; direction carries the sign. */
  amountCents: string;
  direction: ForecastDirection;
  status: ForecastItemStatus;
  certainty: ForecastCertainty;
  source: ForecastSource;
  /** Equal to source.referenceId; duplication is intentional at the boundary. */
  referenceId: string;
  reconciliation: ForecastReconciliation | null;
}

export interface ForecastDay {
  date: string;
  items: readonly ForecastItem[];
  inflowCents: string;
  outflowCents: string;
  netCents: string;
  openingProjectedBalanceCents: string;
  closingProjectedBalanceCents: string;
}

export interface ForecastPeriodTotals {
  /** Civil month bucket in YYYY-MM form. */
  period: string;
  inflowCents: string;
  outflowCents: string;
  netCents: string;
  realizedInflowCents: string;
  realizedOutflowCents: string;
  projectedInflowCents: string;
  projectedOutflowCents: string;
}

export type ForecastTotals = Omit<ForecastPeriodTotals, "period">;

export interface ForecastTimeline {
  contractVersion: typeof FORECAST_CONTRACT_VERSION;
  scenario: ForecastScenario;
  from: string;
  to: string;
  openingBalanceCents: string;
  openingAdjustmentsCents: string;
  openingProjectedBalanceCents: string;
  closingProjectedBalanceCents: string;
  minimumProjectedBalanceCents: string;
  minimumProjectedOn: string | null;
  totals: ForecastTotals;
  periods: readonly ForecastPeriodTotals[];
  days: readonly ForecastDay[];
  minimumBalanceReferences: readonly string[];
}

/** The only query fields that a browser may submit to a forecast reader. */
export interface GetForecastQuery {
  from?: string;
  to?: string;
  scenario?: ForecastScenario;
}

export const FORECAST_ERROR_CODES = [
  "INVALID_DATE",
  "INVALID_DATE_RANGE",
  "INVALID_SCENARIO",
  "FORECAST_RANGE_TOO_LARGE",
  "FINANCIAL_CONTEXT_REQUIRED",
  "FORECAST_NOT_FOUND",
  "FORECAST_INCONSISTENT",
  "FORECAST_QUERY_FAILED",
] as const;
export type ForecastErrorCode = (typeof FORECAST_ERROR_CODES)[number];

export interface ForecastError {
  code: ForecastErrorCode;
  field: string | null;
}

export type ForecastResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ForecastError };

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const ISO_MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/u;
const DECIMAL_CENTS_PATTERN = /^\d+$/u;
const SIGNED_CENTS_PATTERN = /^-?\d+$/u;
const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];

  return Boolean(daysInMonth && day >= 1 && day <= daysInMonth);
}

function isValidSignedCents(value: string): boolean {
  if (!SIGNED_CENTS_PATTERN.test(value)) return false;
  try {
    BigInt(value);
    return true;
  } catch {
    return false;
  }
}

function isValidPositiveCents(value: string): boolean {
  if (!DECIMAL_CENTS_PATTERN.test(value)) return false;
  try {
    return BigInt(value) > BigInt(0);
  } catch {
    return false;
  }
}

export const isoDateSchema = z.string().refine(isValidIsoDate, {
  message: "data inválida",
});

export const isoMonthSchema = z.string().regex(ISO_MONTH_PATTERN, "mês inválido");

const nonEmptyOpaqueReferenceSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER.test(value), {
    message: "referência inválida",
  });

const safeLabelSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER.test(value), {
    message: "label inválida",
  });

const positiveCentsSchema = z
  .string()
  .refine(isValidPositiveCents, "centavos positivos inválidos");

const nullableSignedCentsSchema = z
  .string()
  .refine(isValidSignedCents, "centavos inválidos")
  .nullable();

const signedCentsSchema = z
  .string()
  .refine(isValidSignedCents, "centavos inválidos");

export const forecastSourceSchema = z
  .object({
    kind: z.enum(FORECAST_SOURCE_KINDS),
    referenceId: nonEmptyOpaqueReferenceSchema,
    label: safeLabelSchema,
    recurringRuleId: nonEmptyOpaqueReferenceSchema.optional(),
    occurrenceKey: safeLabelSchema.optional(),
    billingCycle: isoMonthSchema.optional(),
    installmentSequence: z.number().int().positive().optional(),
  })
  .strict();

export const forecastReconciliationSchema = z
  .object({
    key: nonEmptyOpaqueReferenceSchema,
    replacesReferenceId: nonEmptyOpaqueReferenceSchema.nullable(),
    plannedAmountCents: nullableSignedCentsSchema,
    realizedAmountCents: nullableSignedCentsSchema,
    remainingAmountCents: nullableSignedCentsSchema,
    varianceAmountCents: nullableSignedCentsSchema,
  })
  .strict();

export const forecastItemSchema = z
  .object({
    date: isoDateSchema,
    amountCents: positiveCentsSchema,
    direction: z.enum(FORECAST_DIRECTIONS),
    status: z.enum(FORECAST_ITEM_STATUSES),
    certainty: z.enum(FORECAST_CERTAINTIES),
    source: forecastSourceSchema,
    referenceId: nonEmptyOpaqueReferenceSchema,
    reconciliation: forecastReconciliationSchema.nullable(),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.referenceId !== item.source.referenceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referenceId"],
        message: "referenceId deve coincidir com a origem",
      });
    }
  });

export const forecastDaySchema = z
  .object({
    date: isoDateSchema,
    items: z.array(forecastItemSchema),
    inflowCents: signedCentsSchema,
    outflowCents: signedCentsSchema,
    netCents: signedCentsSchema,
    openingProjectedBalanceCents: signedCentsSchema,
    closingProjectedBalanceCents: signedCentsSchema,
  })
  .strict();

export const forecastPeriodTotalsSchema = z
  .object({
    period: isoMonthSchema,
    inflowCents: signedCentsSchema,
    outflowCents: signedCentsSchema,
    netCents: signedCentsSchema,
    realizedInflowCents: signedCentsSchema,
    realizedOutflowCents: signedCentsSchema,
    projectedInflowCents: signedCentsSchema,
    projectedOutflowCents: signedCentsSchema,
  })
  .strict();

const forecastTotalsSchema = forecastPeriodTotalsSchema.omit({ period: true });

export const forecastTimelineSchema = z
  .object({
    contractVersion: z.literal(FORECAST_CONTRACT_VERSION),
    scenario: z.enum(FORECAST_SCENARIOS),
    from: isoDateSchema,
    to: isoDateSchema,
    openingBalanceCents: signedCentsSchema,
    openingAdjustmentsCents: signedCentsSchema,
    openingProjectedBalanceCents: signedCentsSchema,
    closingProjectedBalanceCents: signedCentsSchema,
    minimumProjectedBalanceCents: signedCentsSchema,
    minimumProjectedOn: isoDateSchema.nullable(),
    totals: forecastTotalsSchema,
    periods: z.array(forecastPeriodTotalsSchema),
    days: z.array(forecastDaySchema),
    minimumBalanceReferences: z.array(nonEmptyOpaqueReferenceSchema),
  })
  .strict()
  .superRefine((timeline, context) => {
    if (timeline.from > timeline.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "intervalo de datas inválido",
      });
    }
  });

/** Runtime parser used at the server/UI boundary; it never creates domain objects. */
export function parseForecastItem(value: unknown): ForecastItem {
  return forecastItemSchema.parse(value) as ForecastItem;
}

export function parseForecastTimeline(value: unknown): ForecastTimeline {
  return forecastTimelineSchema.parse(value) as ForecastTimeline;
}

export const forecastScenarioSchema = z.enum(FORECAST_SCENARIOS);

/** Strict query boundary: household and authorization fields fail closed. */
export const getForecastQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    scenario: forecastScenarioSchema.optional(),
  })
  .strict();

export function parseGetForecastQuery(value: unknown): GetForecastQuery {
  return getForecastQuerySchema.parse(value) as GetForecastQuery;
}

export const forecastErrorSchema = z
  .object({
    code: z.enum(FORECAST_ERROR_CODES),
    field: z.string().nullable(),
  })
  .strict();

export function isForecastTimeline(value: unknown): value is ForecastTimeline {
  return forecastTimelineSchema.safeParse(value).success;
}

export function isForecastItem(value: unknown): value is ForecastItem {
  return forecastItemSchema.safeParse(value).success;
}
