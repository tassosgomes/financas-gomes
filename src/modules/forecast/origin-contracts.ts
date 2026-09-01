import { z } from "zod";

import {
  FORECAST_SOURCE_KINDS,
  type ForecastSourceKind,
} from "./contracts";

/** Versioned, serializable contract for a single S07 origin detail. */
export const FORECAST_ORIGIN_CONTRACT_VERSION = "s07.origin.v1" as const;

export const FORECAST_ORIGIN_ACTIONS = [
  "recurring_rule.update_future",
  "recurring_rule.end",
  "recurring_occurrence.override",
  "recurring_occurrence.cancel",
  "recurring_occurrence.realize",
  "planned_event.update",
  "planned_event.cancel",
] as const;
export type ForecastOriginAction = (typeof FORECAST_ORIGIN_ACTIONS)[number];

export interface ForecastOriginQuery {
  kind: ForecastSourceKind;
  /** Opaque UUIDv7 emitted by the forecast read model. */
  referenceId: string;
  /** Metadata is only a lookup hint; the resolver verifies it server-side. */
  recurringRuleId?: string;
  occurrenceKey?: string;
}

export interface ForecastOriginActionDescriptor {
  operation: ForecastOriginAction;
  label: string;
  enabled: boolean;
  reason: string | null;
}

export interface ForecastRecurringOriginDetail {
  ruleId: string;
  occurrenceId: string | null;
  occurrenceKey: string | null;
  frequency: "MONTHLY" | "YEARLY";
  kind: "EXPENSE" | "INCOME";
  amountCents: string;
  description: string;
  startOn: string;
  endOn: string | null;
  expectedOn: string | null;
  status: "PLANNED" | "EXPECTED" | "POSTED" | "CANCELLED";
  isVirtual: boolean;
  financialEventId: string | null;
}

export interface ForecastPlannedEventOriginDetail {
  plannedEventId: string;
  kind: "EXPENSE" | "INCOME";
  amountCents: string;
  description: string;
  expectedOn: string;
  status: "PLANNED" | "EXPECTED" | "POSTED" | "CANCELLED";
  financialEventId: string | null;
}

export interface ForecastInstallmentOriginDetail {
  installmentId: string;
  purchaseId: string;
  cardId: string;
  sequence: number;
  installmentCount: number;
  amountCents: string;
  status: "PLANNED" | "POSTED" | "CANCELLED";
  billingCycle: string;
  dueOn: string;
  purchaseHref: string;
  /** Explicitly documents that no installment-scoped action exists. */
  aggregateOnly: true;
}

export interface ForecastRealizedEventOriginDetail {
  financialEventId: string;
  kind: "EXPENSE" | "INCOME";
  amountCents: string;
  occurredOn: string;
  description: string;
  status: "POSTED" | "CANCELLED";
  transactionHref: string;
}

export interface ForecastOriginDetail {
  contractVersion: typeof FORECAST_ORIGIN_CONTRACT_VERSION;
  kind: ForecastSourceKind;
  referenceId: string;
  label: string;
  status: "PLANNED" | "EXPECTED" | "POSTED" | "CANCELLED";
  sourceUnavailable: false;
  actions: readonly ForecastOriginActionDescriptor[];
  recurring: ForecastRecurringOriginDetail | null;
  plannedEvent: ForecastPlannedEventOriginDetail | null;
  installment: ForecastInstallmentOriginDetail | null;
  realizedEvent: ForecastRealizedEventOriginDetail | null;
}

export const FORECAST_ORIGIN_ERROR_CODES = [
  "FORECAST_NOT_FOUND",
  "FORECAST_QUERY_FAILED",
  "FINANCIAL_CONTEXT_REQUIRED",
] as const;
export type ForecastOriginErrorCode = (typeof FORECAST_ORIGIN_ERROR_CODES)[number];

export interface ForecastOriginError {
  code: ForecastOriginErrorCode;
  field: string | null;
}

export type ForecastOriginResult =
  | { ok: true; value: ForecastOriginDetail }
  | { ok: false; error: ForecastOriginError };

const safeReference = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    "referência inválida",
  );
const safeOccurrenceKey = z
  .string()
  .regex(/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/u, "ocorrência inválida");

/** Strict query parser: no household, table, status or action is accepted. */
export const forecastOriginQuerySchema = z
  .object({
    kind: z.enum(FORECAST_SOURCE_KINDS),
    referenceId: safeReference,
    recurringRuleId: safeReference.optional(),
    occurrenceKey: safeOccurrenceKey.optional(),
  })
  .strict();

export function parseForecastOriginQuery(value: unknown): ForecastOriginQuery {
  return forecastOriginQuerySchema.parse(value) as ForecastOriginQuery;
}

export const forecastOriginErrorSchema = z
  .object({
    code: z.enum(FORECAST_ORIGIN_ERROR_CODES),
    field: z.string().nullable(),
  })
  .strict();
