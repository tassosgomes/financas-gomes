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
  /** S04 import pipeline stage, never an input value. */
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
