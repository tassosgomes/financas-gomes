export interface ObservabilityContext {
  environment?: string;
  release?: string;
  /** A stable, non-sensitive name for the operation that failed. */
  event?: string;
  /** The application use case being executed, never its input payload. */
  useCase?: string;
  /** CRUD verb, kept separate so log consumers can aggregate operations. */
  operation?: string;
  /** Stable entity kind, never an entity display name. */
  entityType?: string;
  /** Opaque resource identifier, when the operation already has one. */
  entityId?: string;
  /** Opaque S06 card identifier, when the operation already has one. */
  cardId?: string;
  /** Opaque S06 purchase identifier, when the operation already has one. */
  purchaseId?: string;
  /** Opaque S06 installment-plan identifier, when one exists. */
  installmentPlanId?: string;
  /** Opaque S06 installment identifier, when one exists. */
  installmentId?: string;
  /** Opaque S06 billing-rule identifier, when one exists. */
  billingRuleId?: string;
  /** Opaque S06 payment identifier, when one exists. */
  paymentId?: string;
  /** Opaque FinancialEvent identifier, when the operation already has one. */
  eventId?: string;
  /** Financial event kind; only the stable technical enum is accepted. */
  transactionKind?: "EXPENSE" | "INCOME" | "MANUAL";
  /** Duration of the operation in milliseconds. */
  durationMs?: number;
  /** Opaque correlation identifier, when one exists. */
  requestId?: string;
  /** Opaque local-user identifier, when one exists. */
  userId?: string;
  /** Opaque household identifier, when one exists. */
  householdId?: string;
  /** A route template, never a URL with query parameters. */
  route?: string;
  /** HTTP status, when one exists. */
  statusCode?: number;
  /** Closed S04/S07/S08 pipeline stage, never an input value. */
  stage?: string;
  /** Opaque server-side preview identifier; never the bearer token. */
  previewId?: string;
  /** Opaque confirmed import identifier. */
  importId?: string;
  /** Opaque account identifier used only for technical correlation. */
  accountId?: string;
  /** Stable allow-listed domain/technical code, never an Error message. */
  errorCode?: string;
  /** Aggregate row counts; individual rows and payloads are never accepted. */
  processedRows?: number;
  validRows?: number;
  invalidRows?: number;
  ignoredDuplicateRows?: number;
  importedRows?: number;
  /** S07 forecast stage; only the closed source/builder/engine/query values. */
  forecastStage?: "source" | "builder" | "engine" | "query";
  /** S07 scenario; amounts and timeline values are never part of context. */
  forecastScenario?: "CONSERVATIVE" | "EXPECTED";
  /** S07 source kind; this is a category, not a source/reference identifier. */
  forecastSourceKind?:
    | "RECURRING"
    | "PLANNED_EVENT"
    | "INSTALLMENT"
    | "REALIZED_EVENT"
    | "ALL";
  /** S07 range bucket; exact from/to dates are deliberately omitted. */
  forecastPeriodBucket?:
    | "SINGLE_PERIOD"
    | "SHORT"
    | "MEDIUM"
    | "LONG";
  /** S07 code-owned query identifier, never SQL or bind values. */
  forecastQueryCode?: string;
  /** Bounded S07 aggregate counters; individual forecast items are omitted. */
  forecastSourceCount?: number;
  forecastRecurringCount?: number;
  forecastPlannedEventCount?: number;
  forecastInstallmentCount?: number;
  forecastRealizedEventCount?: number;
  forecastCancelledCount?: number;
  forecastItemCount?: number;
  forecastProjectedItemCount?: number;
  forecastRealizedItemCount?: number;
  forecastPeriodCount?: number;
  forecastDayCount?: number;
  /** S07 query budget telemetry; no SQL or financial payload is accepted. */
  forecastQueryBudgetMs?: number;
  forecastSlowQuery?: boolean;
  forecastBudgetExceeded?: boolean;
  /** S08 spendable stage; values are closed in observability/s08.ts. */
  spendableStage?: "read" | "forecast" | "engine" | "serialization";
  /** S08 code-owned operation identifier, never SQL or bind values. */
  spendableQueryCode?: string;
  /** Versioned serializable contract used by the spendable response. */
  spendableContractVersion?: string;
  /** Versioned formula/rule used by the spendable engine. */
  spendableRuleVersion?: string;
  /** S08 scenario; amounts and timeline values are never part of context. */
  spendableScenario?: "CONSERVATIVE" | "EXPECTED";
  /** Exact horizon length is technical metadata, not a financial value. */
  spendableHorizonDays?: number;
  /** Result category only; no raw or displayed cents are accepted. */
  spendableResult?: "AVAILABLE" | "ZERO" | "DEFICIT" | "UNAVAILABLE";
  /** Effective buffer source category; buffer cents are intentionally absent. */
  spendableBufferSource?: "CONFIGURED" | "ABSENT_DEFAULT_ZERO";
  /** Source category only; source/reference IDs are intentionally absent. */
  spendableSourceKind?:
    | "RECURRING"
    | "PLANNED_EVENT"
    | "INSTALLMENT"
    | "REALIZED_EVENT"
    | "RESERVE"
    | "ALL";
  /** Bounded S08 aggregate counters; individual items are omitted. */
  spendableSourceCount?: number;
  spendableRecurringCount?: number;
  spendablePlannedEventCount?: number;
  spendableInstallmentCount?: number;
  spendableRealizedEventCount?: number;
  spendableCancelledCount?: number;
  spendableItemCount?: number;
  spendableForecastItemCount?: number;
  spendableProjectedItemCount?: number;
  spendableRealizedItemCount?: number;
  spendableDayCount?: number;
  spendablePeriodCount?: number;
  spendablePointCount?: number;
  spendableCausalPointCount?: number;
  spendableGeneralAccountCount?: number;
  spendableReserveComponentCount?: number;
  spendableSerializedFieldCount?: number;
  spendableQueryBudgetMs?: number;
  spendableSlowQuery?: boolean;
  spendableBudgetExceeded?: boolean;
}

export type SentryRuntime = "server" | "edge" | "client";

export interface SentryRuntimeConfig {
  dsn?: string;
  environment: string;
  release?: string;
}

/** Field names that must never be attached to an error or structured event. */
export const SENSITIVE_OBSERVABILITY_FIELDS = [
  "password",
  "token",
  "tokenHash",
  "accessToken",
  "refreshToken",
  "cookie",
  "cookies",
  "set-cookie",
  "authorization",
  "payload",
  "data",
  "amount",
  "value",
  "description",
  "accountName",
  "account_name",
  "notes",
  "note",
  "currency",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
] as const;
