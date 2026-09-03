import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

import {
  Money,
  type Money as MoneyValue,
} from "@/modules/transactions/money";
import type {
  ForecastCertainty,
  ForecastDirection,
  ForecastItem,
  ForecastItemStatus,
  ForecastReconciliation,
  ForecastScenario,
  ForecastSource,
  ForecastSourceKind,
  ForecastTimeline,
} from "@/modules/forecast/contracts";

/** The public, serializable version of the S08 read model. */
export const SPENDABLE_CONTRACT_VERSION = "s08.v1" as const;
export const SPENDABLE_RULE_VERSION = "spendable.v1" as const;
export const FORECAST_CONTRACT_VERSION = "s07.v1" as const;

export const SPENDABLE_SCENARIOS = ["CONSERVATIVE", "EXPECTED"] as const;
export type SpendableScenario = (typeof SPENDABLE_SCENARIOS)[number];

export const SPENDABLE_CERTAINTIES = [
  "REALIZED",
  "COMMITTED",
  "EXPECTED",
] as const;
export type SpendableCertainty = (typeof SPENDABLE_CERTAINTIES)[number];

export const SPENDABLE_DIRECTIONS = ["INFLOW", "OUTFLOW"] as const;
export type SpendableDirection = (typeof SPENDABLE_DIRECTIONS)[number];

export const SPENDABLE_ITEM_STATUSES = ["PLANNED", "EXPECTED", "POSTED"] as const;
export type SpendableItemStatus = (typeof SPENDABLE_ITEM_STATUSES)[number];

export const SPENDABLE_SOURCE_KINDS = [
  "RECURRING",
  "PLANNED_EVENT",
  "INSTALLMENT",
  "REALIZED_EVENT",
  "RESERVE",
] as const;
export type SpendableSourceKind = (typeof SPENDABLE_SOURCE_KINDS)[number];

/**
 * Causal items are intentionally bounded at the read boundary.  The full
 * timeline is still replayed to calculate the minimum; these values only
 * protect the amount of explanation returned to a consumer.
 */
export const DEFAULT_SPENDABLE_CAUSAL_ITEM_LIMIT = 100;
export const MAX_SPENDABLE_CAUSAL_ITEM_LIMIT = 500;
export const MAX_SPENDABLE_CAUSAL_CURSOR_LENGTH = 512;

export type OpaqueReference = string;
export type SpendableDate = Temporal.PlainDate;
export type SpendableCents = bigint;
export type SpendableMoney = MoneyValue;

/** Accepted domain inputs; JavaScript numbers are deliberately not included. */
export type SpendableCentsInput =
  | string
  | bigint
  | MoneyValue
  | { readonly cents: bigint }
  | { readonly toCentsString: () => string };

export interface GetSpendableInput {
  readonly asOf?: string;
  readonly scenario?: SpendableScenario;
  readonly horizon?: { readonly days: number };
}

export interface NormalizedGetSpendableInput {
  readonly asOf: string;
  readonly scenario: SpendableScenario;
  readonly horizon: { readonly days: number };
  readonly forecastFrom: string;
  readonly forecastTo: string;
}

export type SpendableSource = Omit<ForecastSource, "kind"> & {
  readonly kind: Exclude<SpendableSourceKind, "RESERVE">;
};

/** Domain item after the S07 serializable boundary has been normalized. */
export interface NormalizedSpendableForecastItem {
  readonly date: SpendableDate;
  readonly amountCents: SpendableCents;
  readonly direction: SpendableDirection;
  readonly status: SpendableItemStatus;
  readonly certainty: SpendableCertainty;
  readonly source: SpendableSource;
  readonly referenceId: OpaqueReference;
  readonly reconciliation: ForecastReconciliation | null;
}

export type SpendableForecastItem = NormalizedSpendableForecastItem;
export type DomainForecastItem = NormalizedSpendableForecastItem;
export type NormalizedForecastItem = NormalizedSpendableForecastItem;
export type InternalForecastItem = NormalizedSpendableForecastItem;

export type SpendableBalanceComponentKind =
  | "OPENING"
  | "OPENING_ADJUSTMENT"
  | "DAY_ITEM"
  | "DAY_NET";

/** A signed balance effect; amount is immutable and always represented in cents. */
export interface SpendableBalanceComponent {
  readonly kind: SpendableBalanceComponentKind;
  readonly date: SpendableDate;
  readonly amount: MoneyValue;
  readonly amountCents: SpendableCents;
  readonly referenceId: OpaqueReference | null;
  readonly direction: SpendableDirection | null;
  readonly sourceKind: SpendableSourceKind | null;
}

export interface SpendableBalancePoint {
  readonly kind: "OPENING" | "DAY_CLOSE";
  readonly date: SpendableDate;
  readonly projectedBalanceCents: SpendableCents;
  readonly references: readonly OpaqueReference[];
  readonly items: readonly NormalizedSpendableForecastItem[];
  readonly components: readonly SpendableBalanceComponent[];
}

/** Internal timeline consumed by the pure S08 engine. */
export interface NormalizedSpendableDailyPoint {
  readonly date: SpendableDate;
  readonly items: readonly NormalizedSpendableForecastItem[];
  readonly inflowCents: SpendableCents;
  readonly outflowCents: SpendableCents;
  readonly netCents: SpendableCents;
  readonly openingProjectedBalanceCents: SpendableCents;
  readonly closingProjectedBalanceCents: SpendableCents;
  readonly components: readonly SpendableBalanceComponent[];
}

export type SpendableDailyPoint = NormalizedSpendableDailyPoint;
export type DailySpendablePoint = NormalizedSpendableDailyPoint;

export interface NormalizedSpendableTimeline {
  readonly contractVersion: typeof SPENDABLE_CONTRACT_VERSION;
  readonly scenario: SpendableScenario;
  readonly from: SpendableDate;
  readonly to: SpendableDate;
  readonly openingBalanceCents: SpendableCents;
  readonly openingBalance: MoneyValue;
  readonly openingAdjustmentsCents: SpendableCents;
  readonly openingAdjustments: MoneyValue;
  readonly openingProjectedBalanceCents: SpendableCents;
  readonly closingProjectedBalanceCents: SpendableCents;
  readonly minimumProjectedBalanceCents: SpendableCents;
  readonly minimumProjectedOn: SpendableDate | null;
  readonly openingPoint: SpendableBalancePoint;
  readonly points: readonly SpendableBalancePoint[];
  readonly days: readonly NormalizedSpendableDailyPoint[];
  readonly items: readonly NormalizedSpendableForecastItem[];
  readonly minimumBalanceReferences: readonly OpaqueReference[];
}

export type SpendableTimeline = NormalizedSpendableTimeline;
export type SpendableForecastTimeline = NormalizedSpendableTimeline;

export type SpendableBufferSource = "CONFIGURED" | "ABSENT_DEFAULT_ZERO";

export interface SpendablePeriod {
  readonly asOf: string;
  readonly from: string;
  readonly to: string;
  readonly horizonDays: number;
  readonly scenario: SpendableScenario;
  readonly forecastContractVersion: typeof FORECAST_CONTRACT_VERSION;
}

export interface OperationalBufferSnapshot {
  readonly amountCents: string;
  readonly source: SpendableBufferSource;
  readonly effectiveFrom: string | null;
  readonly revision: OpaqueReference | null;
}

export interface SpendableCausalItem {
  readonly referenceId: OpaqueReference;
  readonly sourceKind: SpendableSourceKind;
  readonly date: string;
  readonly amountCents: string;
  readonly direction: SpendableDirection;
  readonly status: SpendableItemStatus | null;
  readonly certainty: SpendableCertainty | null;
  /** Optional S07 hints needed to resolve a virtual recurring origin. */
  readonly recurringRuleId?: OpaqueReference;
  readonly occurrenceKey?: string;
  readonly billingCycle?: string;
  readonly installmentSequence?: number;
}

export interface SpendableCausalPoint {
  readonly kind: "OPENING" | "DAY_CLOSE";
  readonly date: string;
  readonly projectedBalanceCents: string;
  readonly references: readonly OpaqueReference[];
  readonly items: readonly SpendableCausalItem[];
}

/** Metadata for the bounded causal page attached to `minimum`. */
export interface SpendableCausalPageInfo {
  /** Number of causal items across all tied minimum points. */
  readonly totalCount: number;
  /** Number of causal items present in this response. */
  readonly returnedCount: number;
  /** Maximum number of causal items requested for this response. */
  readonly limit: number;
  /** True whenever this response omits at least one causal item. */
  readonly truncated: boolean;
  /** Opaque continuation token, or null when there is no next page. */
  readonly nextCursor: string | null;
}

/** Pure-engine input for causal pagination; it is not a browser request. */
export interface SpendableCausalPageInput {
  readonly limit?: number;
  readonly cursor?: string | null;
}

export interface SpendableReserveComponent {
  readonly referenceId: OpaqueReference;
  readonly amountCents: string;
  readonly effectiveOn: string;
}

export interface SpendableReserveSnapshot {
  readonly contractVersion: "s09.v1";
  readonly status: "UNAVAILABLE" | "AVAILABLE";
  readonly protectedCents: string;
  readonly appliedOpeningAdjustmentCents: string;
  readonly components: readonly SpendableReserveComponent[];
}

export interface SpendableBreakdown {
  readonly contractVersion: typeof SPENDABLE_CONTRACT_VERSION;
  readonly ruleVersion: typeof SPENDABLE_RULE_VERSION;
  readonly period: SpendablePeriod;
  readonly openingBalanceCents: string;
  readonly openingAdjustmentsCents: string;
  readonly openingProjectedBalanceCents: string;
  readonly closingProjectedBalanceCents: string;
  readonly minimumProjectedBalanceCents: string;
  readonly minimum: {
    readonly projectedBalanceCents: string;
    readonly points: readonly SpendableCausalPoint[];
    /**
     * Present on results produced by the engine. Optional at the parser edge
     * so older persisted/test fixtures remain readable during the handoff.
     */
    readonly causalItems?: SpendableCausalPageInfo;
  };
  readonly operationalBuffer: OperationalBufferSnapshot;
  readonly reserve: SpendableReserveSnapshot;
  readonly rawSpendableCents: string;
  readonly displaySpendableCents: string;
  readonly deficitToPreserveReserveCents: string;
}

export interface SpendableTimelineInput {
  readonly forecast?: ForecastTimeline;
  readonly timeline?: ForecastTimeline;
  readonly items?: readonly ForecastItem[];
  readonly openingBalanceCents?: SpendableCentsInput;
  readonly openingAdjustmentsCents?: SpendableCentsInput;
  readonly scenario?: SpendableScenario;
  readonly from?: SpendableDate | string;
  readonly to?: SpendableDate | string;
}

export type NormalizeSpendableTimelineInput = SpendableTimelineInput;

export const SPENDABLE_ERROR_CODES = [
  "INVALID_DATE",
  "INVALID_DATE_RANGE",
  "INVALID_AMOUNT",
  "INVALID_REFERENCE",
  "INVALID_ITEM",
  "INVALID_SCENARIO",
  "DUPLICATE_REFERENCE",
  "SPENDABLE_INCONSISTENT",
] as const;
export type SpendableErrorCode = (typeof SPENDABLE_ERROR_CODES)[number];

export class SpendableContractError extends Error {
  readonly code: SpendableErrorCode;
  readonly field: string | null;

  constructor(code: SpendableErrorCode, message: string, field?: string) {
    super(message);
    this.name = "SpendableContractError";
    this.code = code;
    this.field = field ?? null;
  }
}

const SIGNED_CENTS_PATTERN = /^-?\d+$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;

function fail(
  code: SpendableErrorCode,
  message: string,
  field?: string,
): never {
  throw new SpendableContractError(code, message, field);
}

/** Converts a domain amount without ever accepting a JavaScript number. */
export function spendableCents(value: unknown, field = "amountCents"): bigint {
  let candidate: string | bigint | undefined;

  if (typeof value === "bigint") {
    candidate = value;
  } else if (typeof value === "string") {
    candidate = value;
  } else if (value instanceof Money) {
    candidate = value.cents;
  } else if (value !== null && typeof value === "object") {
    const cents = (value as { readonly cents?: unknown }).cents;
    if (typeof cents === "bigint") {
      candidate = cents;
    } else {
      const serializer = (value as { readonly toCentsString?: unknown }).toCentsString;
      if (typeof serializer === "function") {
        const serialized = serializer.call(value);
        if (typeof serialized === "string") candidate = serialized;
      }
    }
  }

  if (typeof candidate === "bigint") return candidate;
  if (typeof candidate !== "string" || !SIGNED_CENTS_PATTERN.test(candidate)) {
    return fail("INVALID_AMOUNT", "Centavos devem ser um inteiro decimal.", field);
  }

  try {
    return BigInt(candidate);
  } catch {
    return fail("INVALID_AMOUNT", "Centavos devem ser um inteiro decimal.", field);
  }
}

export function spendablePositiveCents(value: unknown, field = "amountCents"): bigint {
  const cents = spendableCents(value, field);
  if (cents <= BigInt(0)) {
    return fail("INVALID_AMOUNT", "Centavos devem ser positivos.", field);
  }
  return cents;
}

export function spendableNonNegativeCents(value: unknown, field = "amountCents"): bigint {
  const cents = spendableCents(value, field);
  if (cents < BigInt(0)) {
    return fail("INVALID_AMOUNT", "Centavos não podem ser negativos.", field);
  }
  return cents;
}

export function spendableMoney(value: unknown, field = "amountCents"): MoneyValue {
  return new Money(spendableCents(value, field));
}

/** Strict civil date parser for the domain boundary; JavaScript Date is rejected. */
export function spendableDate(value: unknown, field = "date"): Temporal.PlainDate {
  if (value instanceof Temporal.PlainDate) return value;
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return fail("INVALID_DATE", "A data deve usar YYYY-MM-DD.", field);
  }

  try {
    return Temporal.PlainDate.from(value, { overflow: "reject" });
  } catch {
    return fail("INVALID_DATE", "A data deve ser válida no calendário ISO.", field);
  }
}

export const parseSpendableDate = spendableDate;
export const parseSpendableCents = spendableCents;
export const parseSpendableMoney = spendableMoney;

export function spendableReference(value: unknown, field = "referenceId"): OpaqueReference {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    CONTROL_OR_FORMAT_CHARACTER.test(value)
  ) {
    CONTROL_OR_FORMAT_CHARACTER.lastIndex = 0;
    return fail("INVALID_REFERENCE", "A referência opaca é inválida.", field);
  }
  CONTROL_OR_FORMAT_CHARACTER.lastIndex = 0;
  return value;
}

export function compareSpendableDates(
  left: Temporal.PlainDate,
  right: Temporal.PlainDate,
): -1 | 0 | 1 {
  const result = Temporal.PlainDate.compare(left, right);
  return result < 0 ? -1 : result > 0 ? 1 : 0;
}

/** Converts a domain timeline to the public DTO shape without exposing bigint/Temporal. */
export function serializeSpendableCents(value: bigint): string {
  return value.toString(10);
}

export function serializeSpendableDate(value: Temporal.PlainDate): string {
  return value.toString();
}

const spendableIsoDateSchema = z.string().refine(
  (value) => {
    try {
      spendableDate(value);
      return true;
    } catch {
      return false;
    }
  },
  "data inválida",
);
const spendableSignedCentsSchema = z.string().refine(
  (value) => {
    if (!SIGNED_CENTS_PATTERN.test(value)) return false;
    try {
      BigInt(value);
      return true;
    } catch {
      return false;
    }
  },
  "centavos inválidos",
);
const spendablePositiveCentsSchema = spendableSignedCentsSchema.refine(
  (value) => BigInt(value) > BigInt(0),
  "centavos positivos inválidos",
);
const spendableNonNegativeCentsSchema = spendableSignedCentsSchema.refine(
  (value) => BigInt(value) >= BigInt(0),
  "centavos não negativos inválidos",
);
const spendableOpaqueReferenceSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER.test(value), "referência inválida");
const spendableOccurrenceKeySchema = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (value) => !CONTROL_OR_FORMAT_CHARACTER.test(value),
    "ocorrência inválida",
  );

export const spendableScenarioSchema = z.enum(SPENDABLE_SCENARIOS);
export const spendableBufferSourceSchema = z.enum([
  "CONFIGURED",
  "ABSENT_DEFAULT_ZERO",
] as const);
export const spendableCausalItemSchema = z
  .object({
    referenceId: spendableOpaqueReferenceSchema,
    sourceKind: z.enum(SPENDABLE_SOURCE_KINDS),
    date: spendableIsoDateSchema,
    amountCents: spendablePositiveCentsSchema,
    direction: z.enum(SPENDABLE_DIRECTIONS),
    status: z.enum(SPENDABLE_ITEM_STATUSES).nullable(),
    certainty: z.enum(SPENDABLE_CERTAINTIES).nullable(),
    recurringRuleId: spendableOpaqueReferenceSchema.optional(),
    occurrenceKey: spendableOccurrenceKeySchema.optional(),
    billingCycle: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u).optional(),
    installmentSequence: z.number().int().positive().optional(),
  })
  .strict();
export const spendableCausalPointSchema = z
  .object({
    kind: z.enum(["OPENING", "DAY_CLOSE"] as const),
    date: spendableIsoDateSchema,
    projectedBalanceCents: spendableSignedCentsSchema,
    references: z.array(spendableOpaqueReferenceSchema),
    items: z.array(spendableCausalItemSchema),
  })
  .strict()
  .superRefine((point, context) => {
    const itemReferences = point.items.map(({ referenceId }) => referenceId);
    const uniqueItemReferences = [...new Set(itemReferences)].sort();
    const references = [...point.references].sort();
    if (
      references.length !== new Set(references).size ||
      references.length !== uniqueItemReferences.length ||
      references.some((reference, index) => reference !== uniqueItemReferences[index])
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["references"],
        message: "referências devem corresponder aos itens causais sem duplicidade",
      });
    }

    for (const [index, item] of point.items.entries()) {
      if (point.kind === "DAY_CLOSE" && item.date !== point.date) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "date"],
          message: "item diário deve usar a data do fechamento",
        });
      }
      if (point.kind === "OPENING" && item.date > point.date) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "date"],
          message: "item de abertura não pode estar no futuro",
        });
      }
    }
  });
const spendableCausalCursorSchema = z
  .string()
  .min(1)
  .max(MAX_SPENDABLE_CAUSAL_CURSOR_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/u, "cursor causal inválido");
export const spendableCausalPageInfoSchema = z
  .object({
    totalCount: z.number().int().nonnegative(),
    returnedCount: z.number().int().nonnegative(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_SPENDABLE_CAUSAL_ITEM_LIMIT),
    truncated: z.boolean(),
    nextCursor: spendableCausalCursorSchema.nullable(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.returnedCount > page.totalCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["returnedCount"],
        message: "itens retornados não podem exceder o total",
      });
    }
    const truncated = page.returnedCount < page.totalCount;
    if (page.truncated !== truncated) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["truncated"],
        message: "truncamento inconsistente",
      });
    }
    if (!truncated && page.nextCursor !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nextCursor"],
        message: "página final não pode ter cursor",
      });
    }
    // A final page may still be truncated when it follows an earlier page;
    // `nextCursor` only describes whether another page follows this one.
  });
export const spendablePeriodSchema = z
  .object({
    asOf: spendableIsoDateSchema,
    from: spendableIsoDateSchema,
    to: spendableIsoDateSchema,
    horizonDays: z.number().int().min(1).max(3660),
    scenario: spendableScenarioSchema,
    forecastContractVersion: z.literal(FORECAST_CONTRACT_VERSION),
  })
  .strict()
  .superRefine((period, context) => {
    if (period.from > period.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "intervalo de datas inválido",
      });
    }
  });
export const operationalBufferSnapshotSchema = z
  .object({
    amountCents: spendableNonNegativeCentsSchema,
    source: spendableBufferSourceSchema,
    effectiveFrom: spendableIsoDateSchema.nullable(),
    revision: spendableOpaqueReferenceSchema.nullable(),
  })
  .strict();
export const spendableReserveComponentSchema = z
  .object({
    referenceId: spendableOpaqueReferenceSchema,
    amountCents: spendableNonNegativeCentsSchema,
    effectiveOn: spendableIsoDateSchema,
  })
  .strict();
export const spendableReserveSnapshotSchema = z
  .object({
    contractVersion: z.literal("s09.v1"),
    status: z.enum(["UNAVAILABLE", "AVAILABLE"] as const),
    protectedCents: spendableNonNegativeCentsSchema,
    appliedOpeningAdjustmentCents: spendableSignedCentsSchema,
    components: z.array(spendableReserveComponentSchema),
  })
  .strict();

export const spendableBreakdownSchema = z
  .object({
    contractVersion: z.literal(SPENDABLE_CONTRACT_VERSION),
    ruleVersion: z.literal(SPENDABLE_RULE_VERSION),
    period: spendablePeriodSchema,
    openingBalanceCents: spendableSignedCentsSchema,
    openingAdjustmentsCents: spendableSignedCentsSchema,
    openingProjectedBalanceCents: spendableSignedCentsSchema,
    closingProjectedBalanceCents: spendableSignedCentsSchema,
    minimumProjectedBalanceCents: spendableSignedCentsSchema,
    minimum: z
      .object({
        projectedBalanceCents: spendableSignedCentsSchema,
        points: z.array(spendableCausalPointSchema),
        causalItems: spendableCausalPageInfoSchema.optional(),
      })
      .strict(),
    operationalBuffer: operationalBufferSnapshotSchema,
    reserve: spendableReserveSnapshotSchema,
    rawSpendableCents: spendableSignedCentsSchema,
    displaySpendableCents: spendableNonNegativeCentsSchema,
    deficitToPreserveReserveCents: spendableNonNegativeCentsSchema,
  })
  .strict()
  .superRefine((breakdown, context) => {
    if (
      breakdown.minimumProjectedBalanceCents !==
      breakdown.minimum.projectedBalanceCents
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimum", "projectedBalanceCents"],
        message: "mínimo inconsistente",
      });
    }

    try {
      const asOf = spendableDate(breakdown.period.asOf);
      const expectedFrom = asOf.add({ days: 1 }).toString();
      if (breakdown.period.from !== expectedFrom) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["period", "from"],
          message: "a janela deve começar no dia seguinte a asOf",
        });
      }
    } catch {
      // The field schemas already report malformed dates. Keep this
      // refinement defensive so it never turns malformed input into a throw.
    }

    const opening = BigInt(breakdown.openingBalanceCents);
    const openingAdjustments = BigInt(breakdown.openingAdjustmentsCents);
    if (
      BigInt(breakdown.openingProjectedBalanceCents) !==
      opening + openingAdjustments
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["openingProjectedBalanceCents"],
        message: "abertura projetada inconsistente",
      });
    }

    const causalReferences = new Set<string>();
    for (const [index, point] of breakdown.minimum.points.entries()) {
      if (point.kind === "OPENING" && point.date !== breakdown.period.asOf) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["minimum", "points", index, "date"],
          message: "o ponto de abertura deve usar asOf",
        });
      }
      if (
        point.kind === "DAY_CLOSE" &&
        (point.date < breakdown.period.from || point.date > breakdown.period.to)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["minimum", "points", index, "date"],
          message: "ponto causal fora da janela",
        });
      }
      for (const item of point.items) {
        if (causalReferences.has(item.referenceId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["minimum", "points", index, "items"],
            message: "uma referência causal não pode aparecer duas vezes",
          });
        }
        causalReferences.add(item.referenceId);
        if (
          item.date < breakdown.period.from &&
          point.kind !== "OPENING"
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["minimum", "points", index, "items"],
            message: "item causal fora da janela",
          });
        }
        if (item.date > breakdown.period.to) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["minimum", "points", index, "items"],
            message: "item causal fora da janela",
          });
        }
      }
    }

    const page = breakdown.minimum.causalItems;
    if (page) {
      const returnedCount = breakdown.minimum.points.reduce(
        (total, point) => total + point.items.length,
        0,
      );
      if (returnedCount !== page.returnedCount) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["minimum", "causalItems", "returnedCount"],
          message: "contagem retornada não reconcilia os itens",
        });
      }
      if (page.returnedCount > page.limit) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["minimum", "causalItems", "returnedCount"],
          message: "itens retornados excedem o limite",
        });
      }
    }

    const minimum = BigInt(breakdown.minimumProjectedBalanceCents);
    const buffer = BigInt(breakdown.operationalBuffer.amountCents);
    const raw = BigInt(breakdown.rawSpendableCents);
    const display = BigInt(breakdown.displaySpendableCents);
    const deficit = BigInt(breakdown.deficitToPreserveReserveCents);
    if (raw !== minimum - buffer) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rawSpendableCents"],
        message: "bruto inconsistente",
      });
    }
    if (display !== (raw > BigInt(0) ? raw : BigInt(0))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["displaySpendableCents"],
        message: "valor exibido inconsistente",
      });
    }
    if (deficit !== (raw < BigInt(0) ? -raw : BigInt(0))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deficitToPreserveReserveCents"],
        message: "déficit inconsistente",
      });
    }
  });

export function parseSpendableBreakdown(value: unknown): SpendableBreakdown {
  return spendableBreakdownSchema.parse(value) as SpendableBreakdown;
}

export function isSpendableBreakdown(value: unknown): value is SpendableBreakdown {
  return spendableBreakdownSchema.safeParse(value).success;
}

// Keep these imports as type-only aliases available to downstream S08 tasks.
export type {
  ForecastCertainty,
  ForecastDirection,
  ForecastItem,
  ForecastItemStatus,
  ForecastReconciliation,
  ForecastScenario,
  ForecastSource,
  ForecastSourceKind,
  ForecastTimeline,
};
