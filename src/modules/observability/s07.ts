import { generateUuidV7 } from "@/lib/uuidv7";
import { FinancialContextError } from "@/modules/households/contracts";
import {
  FORECAST_ERROR_CODES,
  FORECAST_SCENARIOS,
  FORECAST_SOURCE_KINDS,
  type ForecastScenario,
} from "@/modules/forecast/contracts";

import type { ObservabilityContext } from "./contracts";
import { addBreadcrumbSafely, captureServerException } from "./server";

/**
 * Observable stages of the S07 pipeline.  A stage is deliberately broader
 * than a source/reference identifier so it remains useful for aggregation.
 */
export const S07_FORECAST_STAGES = [
  "source",
  "builder",
  "engine",
  "query",
] as const;

export type S07ForecastStage = (typeof S07_FORECAST_STAGES)[number];

/**
 * Code-owned operation names.  They are the only names that can reach an
 * event/use-case field; callers cannot turn a query or label into a name.
 */
export const S07_FORECAST_OPERATIONS = [
  "forecast.source.load",
  "forecast.timeline.build",
  "forecast.engine.calculate",
  "forecast.query.get",
] as const;

export type S07ForecastOperation = (typeof S07_FORECAST_OPERATIONS)[number];

/** Compatibility input names for adapters that call the stage a builder. */
export const S07_FORECAST_OPERATION_ALIASES = [
  ...S07_FORECAST_OPERATIONS,
  "forecast.builder.build",
  "forecast.source",
  "forecast.builder",
  "forecast.engine",
  "forecast.query",
  "forecast.query.execute",
  "forecast.query.read",
] as const;

export type S07ForecastOperationInput =
  | S07ForecastOperation
  | S07ForecastStage
  | (typeof S07_FORECAST_OPERATION_ALIASES)[number];

/** Stable query/stage codes used in metrics and slow-query investigation. */
export const S07_FORECAST_QUERY_CODES = {
  source: "forecast_source",
  builder: "forecast_builder",
  engine: "forecast_engine",
  query: "forecast_query",
} as const satisfies Record<S07ForecastStage, string>;

export type S07ForecastQueryCode =
  (typeof S07_FORECAST_QUERY_CODES)[S07ForecastStage];

export const S07_FORECAST_OUTCOMES = [
  "success",
  "expected_error",
  "unexpected_error",
] as const;

export type S07ForecastOutcome = (typeof S07_FORECAST_OUTCOMES)[number];

/** Source kind can be aggregated as ALL without exposing a source ID. */
export const S07_FORECAST_SOURCE_KINDS = [
  ...FORECAST_SOURCE_KINDS,
  "ALL",
] as const;

export type S07ForecastSourceKind =
  (typeof S07_FORECAST_SOURCE_KINDS)[number];

/** A categorical range bucket; exact from/to dates never enter telemetry. */
export const S07_FORECAST_PERIOD_BUCKETS = [
  "SINGLE_PERIOD",
  "SHORT",
  "MEDIUM",
  "LONG",
] as const;

export type S07ForecastPeriodBucket =
  (typeof S07_FORECAST_PERIOD_BUCKETS)[number];

/**
 * Counters are intentionally aggregate-only.  In particular, this type has
 * no amount, balance, date, description, item, source-reference or payload.
 */
export interface S07ForecastAggregateCounts {
  sourceCount?: number;
  recurringCount?: number;
  plannedEventCount?: number;
  installmentCount?: number;
  realizedEventCount?: number;
  cancelledCount?: number;
  itemCount?: number;
  projectedItemCount?: number;
  realizedItemCount?: number;
  periodCount?: number;
  dayCount?: number;
}

export interface S07ForecastOperationOptions
  extends S07ForecastAggregateCounts {
  requestId?: string;
  /** Alias accepted from a transport boundary; emitted as requestId. */
  correlationId?: string;
  userId?: string;
  householdId?: string;
  scenario?: ForecastScenario;
  sourceKind?: S07ForecastSourceKind;
  /** Exact period dates are never accepted; only this categorical bucket is. */
  periodBucket?: S07ForecastPeriodBucket;
  /** Compatibility aliases normalized to periodBucket. */
  periodRangeBucket?: S07ForecastPeriodBucket;
  periodRange?: S07ForecastPeriodBucket;
  durationMs?: number;
  statusCode?: number;
  /** Untrusted adapter objects are allow-listed by the final sanitizer. */
  [key: string]: unknown;
}

export interface S07ForecastOperationContext
  extends S07ForecastAggregateCounts {
  operation: S07ForecastOperation;
  stage: S07ForecastStage;
  queryCode: S07ForecastQueryCode;
  requestId?: string;
  userId?: string;
  householdId?: string;
  scenario?: ForecastScenario;
  sourceKind?: S07ForecastSourceKind;
  periodBucket?: S07ForecastPeriodBucket;
  durationMs?: number;
  statusCode?: number;
}

export interface S07ForecastLog extends S07ForecastOperationContext {
  event: string;
  useCase: string;
  outcome: S07ForecastOutcome;
  errorCode?: S07ForecastErrorCode;
  slowQuery?: boolean;
  slowQueryThresholdMs?: number;
  queryBudgetMs?: number;
  budgetExceeded?: boolean;
}

/** Unknown adapter fields are accepted here only to prove they are dropped. */
export type S07ForecastLogInput = Omit<
  Partial<S07ForecastLog>,
  "errorCode"
> & {
  errorCode?: unknown;
} & Record<string, unknown>;

export interface S07ForecastObservabilityHooks {
  /** Receives an already allow-listed record for logs/metrics. */
  onRecord?: (record: S07ForecastLog) => void;
  /** Alias for metric adapters that do not emit application logs. */
  onMetric?: (record: S07ForecastLog) => void;
  /** Receives only records that exceeded the slow/budget threshold. */
  onSlowQuery?: (record: S07ForecastLog) => void;
}

export interface S07ForecastCompletionOptions
  extends S07ForecastAggregateCounts,
    S07ForecastObservabilityHooks {
  durationMs?: number;
  errorCode?: string;
  technicalErrorCode?: string;
  queryBudgetMs?: number;
  slowQueryThresholdMs?: number;
  budgetExceeded?: boolean;
  /** Injectable monotonic clock for deterministic wrapper tests. */
  now?: () => number;
}

export interface S07ForecastQueryOptions
  extends S07ForecastAggregateCounts,
    S07ForecastObservabilityHooks {
  /** Per-call override; bounded by MAX_S07_SLOW_QUERY_THRESHOLD_MS. */
  thresholdMs?: number;
  /** Per-call query budget override; bounded by MAX_S07_QUERY_BUDGET_MS. */
  queryBudgetMs?: number;
  technicalErrorCode?: string;
  /** Injectable monotonic clock for deterministic measurement tests. */
  now?: () => number;
}

export const S07_FORECAST_EXPECTED_ERROR_CODES = [
  "INVALID_DATE",
  "INVALID_DATE_RANGE",
  "INVALID_SCENARIO",
  "FORECAST_RANGE_TOO_LARGE",
  "FINANCIAL_CONTEXT_REQUIRED",
  "FORECAST_NOT_FOUND",
  "UNAUTHENTICATED",
  "HOUSEHOLD_MEMBERSHIP_REQUIRED",
  "HOUSEHOLD_SELECTION_REQUIRED",
  "INVALID_FINANCIAL_CONTEXT",
] as const satisfies readonly string[];

export type S07ForecastExpectedErrorCode =
  (typeof S07_FORECAST_EXPECTED_ERROR_CODES)[number];

/** Technical labels are closed so provider/database text never becomes code. */
export const S07_FORECAST_TECHNICAL_ERROR_CODES = [
  "FORECAST_INCONSISTENT",
  "FORECAST_QUERY_FAILED",
  "FORECAST_SOURCE_QUERY_FAILED",
  "FORECAST_BUILDER_FAILED",
  "FORECAST_ENGINE_FAILED",
  "FORECAST_QUERY_TIMEOUT",
  "INVALID_FORECAST_RESULT",
  "UNEXPECTED_ERROR",
] as const;

export type S07ForecastTechnicalErrorCode =
  (typeof S07_FORECAST_TECHNICAL_ERROR_CODES)[number];

export type S07ForecastErrorCode =
  | S07ForecastExpectedErrorCode
  | S07ForecastTechnicalErrorCode;

export interface S07ForecastErrorClassification {
  outcome: "expected_error" | "unexpected_error";
  errorCode: S07ForecastErrorCode;
}

export interface S07ForecastSafeErrorEnvelope {
  ok: false;
  error: {
    code: (typeof FORECAST_ERROR_CODES)[number];
    field: "from" | "to" | "scenario" | null;
  };
}

export const DEFAULT_S07_SLOW_QUERY_THRESHOLD_MS = 250;
export const MAX_S07_SLOW_QUERY_THRESHOLD_MS = 60_000;
export const DEFAULT_S07_QUERY_BUDGET_MS = 2_000;
export const MAX_S07_QUERY_BUDGET_MS = 60_000;
export const MAX_S07_AGGREGATE_COUNT = 1_000_000_000;

const OPERATION_ALIASES: Readonly<Record<string, S07ForecastOperation>> = {
  "forecast.source.load": "forecast.source.load",
  "forecast.source": "forecast.source.load",
  source: "forecast.source.load",
  "source.load": "forecast.source.load",
  "forecast.timeline.build": "forecast.timeline.build",
  "forecast.builder.build": "forecast.timeline.build",
  "forecast.builder": "forecast.timeline.build",
  builder: "forecast.timeline.build",
  timeline: "forecast.timeline.build",
  "forecast.engine.calculate": "forecast.engine.calculate",
  "forecast.engine": "forecast.engine.calculate",
  engine: "forecast.engine.calculate",
  "forecast.query.get": "forecast.query.get",
  "forecast.query": "forecast.query.get",
  "forecast.query.execute": "forecast.query.get",
  "forecast.query.read": "forecast.query.get",
  query: "forecast.query.get",
};

const OPERATION_SET = new Set<string>(S07_FORECAST_OPERATIONS);
const PERIOD_BUCKET_SET = new Set<string>(S07_FORECAST_PERIOD_BUCKETS);
const EXPECTED_ERROR_SET = new Set<string>(
  S07_FORECAST_EXPECTED_ERROR_CODES,
);
const TECHNICAL_ERROR_SET = new Set<string>(
  S07_FORECAST_TECHNICAL_ERROR_CODES,
);
const FORECAST_ERROR_SET = new Set<string>(FORECAST_ERROR_CODES);
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/u;
const FORECAST_FIELD_SET = new Set(["from", "to", "scenario"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function opaqueId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized && OPAQUE_ID_PATTERN.test(normalized)
    ? normalized
    : undefined;
}

function finiteInteger(
  value: unknown,
  maximum = MAX_S07_AGGREGATE_COUNT,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(maximum, Math.max(0, Math.round(value)));
}

function duration(value: unknown): number | undefined {
  return finiteInteger(value, 86_400_000);
}

function statusCode(value: unknown): number | undefined {
  return finiteInteger(value, 999);
}

function enumValue<T extends readonly string[]>(
  values: T,
  value: unknown,
): T[number] | undefined {
  return typeof value === "string" && values.includes(value)
    ? (value as T[number])
    : undefined;
}

function operationValue(value: unknown): S07ForecastOperation | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const operation = OPERATION_ALIASES[value];
  return operation && OPERATION_SET.has(operation) ? operation : undefined;
}

function stageValue(value: unknown): S07ForecastStage | undefined {
  return enumValue(S07_FORECAST_STAGES, value);
}

function outcomeValue(value: unknown): S07ForecastOutcome | undefined {
  return enumValue(S07_FORECAST_OUTCOMES, value);
}

function scenarioValue(value: unknown): ForecastScenario | undefined {
  return enumValue(FORECAST_SCENARIOS, value);
}

function sourceKindValue(value: unknown): S07ForecastSourceKind | undefined {
  return enumValue(S07_FORECAST_SOURCE_KINDS, value);
}

function periodBucketValue(value: unknown): S07ForecastPeriodBucket | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const aliases: Record<string, S07ForecastPeriodBucket> = {
    SINGLE: "SINGLE_PERIOD",
    SINGLE_PERIOD: "SINGLE_PERIOD",
    ONE_PERIOD: "SINGLE_PERIOD",
    SHORT: "SHORT",
    MEDIUM: "MEDIUM",
    LONG: "LONG",
  };
  const normalized = value.trim().toUpperCase();
  const bucket = aliases[normalized];
  return bucket && PERIOD_BUCKET_SET.has(bucket) ? bucket : undefined;
}

function stageForOperation(operation: S07ForecastOperation): S07ForecastStage {
  if (operation === "forecast.source.load") {
    return "source";
  }
  if (operation === "forecast.timeline.build") {
    return "builder";
  }
  if (operation === "forecast.engine.calculate") {
    return "engine";
  }
  return "query";
}

function operationForStage(stage: S07ForecastStage): S07ForecastOperation {
  return stage === "source"
    ? "forecast.source.load"
    : stage === "builder"
      ? "forecast.timeline.build"
      : stage === "engine"
        ? "forecast.engine.calculate"
        : "forecast.query.get";
}

function queryCodeForStage(stage: S07ForecastStage): S07ForecastQueryCode {
  return S07_FORECAST_QUERY_CODES[stage];
}

function eventName(
  operation: S07ForecastOperation,
  outcome: S07ForecastOutcome,
): string {
  return `s07_${operation.replaceAll(".", "_")}_${outcome}`;
}

function safeErrorCode(value: unknown): S07ForecastErrorCode | undefined {
  if (
    typeof value !== "string" ||
    !ERROR_CODE_PATTERN.test(value) ||
    (!EXPECTED_ERROR_SET.has(value) && !TECHNICAL_ERROR_SET.has(value))
  ) {
    return undefined;
  }

  return value as S07ForecastErrorCode;
}

function safeTechnicalErrorCode(value: unknown): S07ForecastTechnicalErrorCode {
  return TECHNICAL_ERROR_SET.has(value as string)
    ? (value as S07ForecastTechnicalErrorCode)
    : "UNEXPECTED_ERROR";
}

function countValue(
  value: Record<string, unknown>,
  aliases: readonly string[],
): number | undefined {
  for (const alias of aliases) {
    const count = finiteInteger(value[alias]);
    if (count !== undefined) {
      return count;
    }
  }
  return undefined;
}

/** Keeps bounded aggregate counts and drops rows/items and all payloads. */
export function sanitizeS07ForecastCounts(
  value: unknown,
): S07ForecastAggregateCounts | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const source = isRecord(value.counts) ? value.counts : value;
  const aliases: Record<keyof S07ForecastAggregateCounts, readonly string[]> = {
    sourceCount: ["sourceCount", "source_count", "sources"],
    recurringCount: ["recurringCount", "recurring_count", "recurring"],
    plannedEventCount: [
      "plannedEventCount",
      "planned_event_count",
      "plannedEvents",
      "planned_events",
    ],
    installmentCount: [
      "installmentCount",
      "installment_count",
      "installments",
    ],
    realizedEventCount: [
      "realizedEventCount",
      "realized_event_count",
      "realizedEvents",
      "realized_events",
    ],
    cancelledCount: [
      "cancelledCount",
      "cancelled_count",
      "canceledCount",
      "canceled_count",
      "cancelledSources",
    ],
    itemCount: ["itemCount", "item_count", "items"],
    projectedItemCount: [
      "projectedItemCount",
      "projected_item_count",
      "projectedItems",
    ],
    realizedItemCount: [
      "realizedItemCount",
      "realized_item_count",
      "realizedItems",
    ],
    periodCount: ["periodCount", "period_count", "periods"],
    dayCount: ["dayCount", "day_count", "days"],
  };

  const result: S07ForecastAggregateCounts = {};
  for (const key of Object.keys(aliases) as Array<keyof S07ForecastAggregateCounts>) {
    const count = countValue(source, aliases[key]);
    if (count !== undefined) {
      result[key] = count;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function aggregateInput(value: Record<string, unknown>): S07ForecastAggregateCounts {
  return sanitizeS07ForecastCounts(value) ?? {};
}

function addSafeId(
  target: S07ForecastOperationContext,
  key: "requestId" | "userId" | "householdId",
  value: unknown,
): void {
  const safe = opaqueId(value);
  if (safe) {
    target[key] = safe;
  }
}

/**
 * Creates operation metadata and generates a fresh opaque request ID when a
 * boundary has not supplied one.  No query, command, source ID or result is
 * copied into the context.
 */
export function createS07ForecastOperation(
  operationInput: S07ForecastOperationInput,
  options: S07ForecastOperationOptions = {},
): S07ForecastOperationContext {
  const suppliedOperation = operationValue(operationInput);
  const suppliedStage = stageValue(operationInput);
  const operation =
    suppliedOperation ??
    (suppliedStage ? operationForStage(suppliedStage) : "forecast.query.get");
  const stage = stageForOperation(operation);
  let requestId = opaqueId(options.requestId ?? options.correlationId);
  if (!requestId) {
    try {
      requestId = opaqueId(generateUuidV7());
    } catch {
      requestId = undefined;
    }
  }

  const result: S07ForecastOperationContext = {
    operation,
    stage,
    queryCode: queryCodeForStage(stage),
    ...aggregateInput(options),
    scenario: scenarioValue(options.scenario),
    sourceKind: sourceKindValue(options.sourceKind),
    periodBucket: periodBucketValue(
      options.periodBucket ?? options.periodRangeBucket ?? options.periodRange,
    ),
    durationMs: duration(options.durationMs),
    statusCode: statusCode(options.statusCode),
  };

  addSafeId(result, "requestId", requestId);
  addSafeId(result, "userId", options.userId);
  addSafeId(result, "householdId", options.householdId);
  return result;
}

/** Canonical operation/use-case identifier for adapters and metrics. */
export function s07ForecastUseCaseName(
  operation: S07ForecastOperationInput,
): string {
  return operationValue(operation)
    ? operationValue(operation)!
    : operationForStage(stageValue(operation) ?? "query");
}

export function s07ForecastEventName(
  operation: S07ForecastOperationInput,
  outcome: S07ForecastOutcome,
): string {
  return eventName(
    operationValue(operation) ??
      operationForStage(stageValue(operation) ?? "query"),
    outcome,
  );
}

function optionalLogFields(
  value: Record<string, unknown>,
  result: S07ForecastLog,
): void {
  const addId = (key: "requestId" | "userId" | "householdId") => {
    const id = opaqueId(value[key]);
    if (id) {
      result[key] = id;
    }
  };

  addId("requestId");
  addId("userId");
  addId("householdId");

  const durationMs = duration(value.durationMs);
  if (durationMs !== undefined) {
    result.durationMs = durationMs;
  }

  const status = statusCode(value.statusCode);
  if (status !== undefined) {
    result.statusCode = status;
  }

  const errorCode = safeErrorCode(value.errorCode);
  if (errorCode) {
    result.errorCode = errorCode;
  }

  const scenario = scenarioValue(value.scenario);
  if (scenario) {
    result.scenario = scenario;
  }

  const sourceKind = sourceKindValue(value.sourceKind);
  if (sourceKind) {
    result.sourceKind = sourceKind;
  }

  const periodBucket = periodBucketValue(
    value.periodBucket ?? value.periodRangeBucket ?? value.periodRange,
  );
  if (periodBucket) {
    result.periodBucket = periodBucket;
  }

  if (typeof value.slowQuery === "boolean") {
    result.slowQuery = value.slowQuery;
  }

  const threshold = finiteInteger(
    value.slowQueryThresholdMs,
    MAX_S07_SLOW_QUERY_THRESHOLD_MS,
  );
  if (threshold !== undefined) {
    result.slowQueryThresholdMs = threshold;
  }

  const queryBudget = finiteInteger(
    value.queryBudgetMs,
    MAX_S07_QUERY_BUDGET_MS,
  );
  if (queryBudget !== undefined) {
    result.queryBudgetMs = queryBudget;
  }

  if (typeof value.budgetExceeded === "boolean") {
    result.budgetExceeded = value.budgetExceeded;
  }
}

/**
 * Final S07 allow-list.  Operation/stage/query identifiers are rebuilt from
 * a closed vocabulary, and dates, values, balances, labels and payloads are
 * never traversed.
 */
export function sanitizeS07ForecastLog(
  value: S07ForecastLogInput,
): S07ForecastLog | undefined {
  try {
    const suppliedOperation =
      value.operation === undefined
        ? undefined
        : operationValue(value.operation);
    const suppliedStage =
      value.stage === undefined ? undefined : stageValue(value.stage);
    const outcome = outcomeValue(value.outcome);

    if (
      (value.operation !== undefined && !suppliedOperation) ||
      (value.stage !== undefined && !suppliedStage) ||
      !outcome
    ) {
      return undefined;
    }

    const operation =
      suppliedOperation ??
      (suppliedStage ? operationForStage(suppliedStage) : undefined);
    if (!operation) {
      return undefined;
    }

    const stage = stageForOperation(operation);
    if (suppliedStage && suppliedStage !== stage) {
      return undefined;
    }

    const safe: S07ForecastLog = {
      event: eventName(operation, outcome),
      useCase: operation,
      operation,
      stage,
      queryCode: queryCodeForStage(stage),
      outcome,
      ...aggregateInput(value),
    };

    optionalLogFields(value, safe);
    return safe;
  } catch {
    return undefined;
  }
}

function primaryContext(
  operation: S07ForecastOperationContext,
  outcome: S07ForecastOutcome,
  options: S07ForecastCompletionOptions = {},
): S07ForecastLog | undefined {
  return sanitizeS07ForecastLog({
    ...operation,
    ...options,
    operation: operation.operation,
    stage: operation.stage,
    outcome,
  });
}

/** Converts only S07 technical metadata to the shared Sentry context shape. */
export function toS07ObservabilityContext(
  operation: S07ForecastOperationContext,
  outcome: S07ForecastOutcome = "unexpected_error",
  options: S07ForecastCompletionOptions = {},
): ObservabilityContext {
  const safe = primaryContext(operation, outcome, options);
  const fallbackOperation = operationValue(operation.operation) ?? "forecast.query.get";
  const fallbackStage = stageForOperation(fallbackOperation);

  return {
    event: safe?.event ?? eventName(fallbackOperation, outcome),
    useCase: safe?.useCase ?? fallbackOperation,
    operation: fallbackOperation,
    entityType: "forecast",
    requestId: safe?.requestId,
    userId: safe?.userId,
    householdId: safe?.householdId,
    durationMs: safe?.durationMs,
    statusCode: safe?.statusCode,
    stage: safe?.stage ?? fallbackStage,
    errorCode: safe?.errorCode,
    forecastStage: safe?.stage ?? fallbackStage,
    forecastScenario: safe?.scenario,
    forecastSourceKind: safe?.sourceKind,
    forecastPeriodBucket: safe?.periodBucket,
    forecastQueryCode: safe?.queryCode ?? queryCodeForStage(fallbackStage),
    forecastSourceCount: safe?.sourceCount,
    forecastRecurringCount: safe?.recurringCount,
    forecastPlannedEventCount: safe?.plannedEventCount,
    forecastInstallmentCount: safe?.installmentCount,
    forecastRealizedEventCount: safe?.realizedEventCount,
    forecastCancelledCount: safe?.cancelledCount,
    forecastItemCount: safe?.itemCount,
    forecastProjectedItemCount: safe?.projectedItemCount,
    forecastRealizedItemCount: safe?.realizedItemCount,
    forecastPeriodCount: safe?.periodCount,
    forecastDayCount: safe?.dayCount,
    forecastQueryBudgetMs: safe?.queryBudgetMs,
    forecastSlowQuery: safe?.slowQuery,
    forecastBudgetExceeded: safe?.budgetExceeded,
  };
}

/** Adds one technical breadcrumb; no source/result/payload is attached. */
export function addS07ForecastBreadcrumb(
  operation: S07ForecastOperationContext,
  outcome: S07ForecastOutcome,
  options: S07ForecastCompletionOptions = {},
): void {
  const safe = primaryContext(operation, outcome, options);
  if (!safe) {
    return;
  }

  addBreadcrumbSafely({
    type: "info",
    category: safe.useCase,
    data: {
      operation: safe.operation,
      stage: safe.stage,
      forecast_stage: safe.stage,
      forecast_query_code: safe.queryCode,
      forecast_scenario: safe.scenario,
      forecast_source_kind: safe.sourceKind,
      forecast_period_bucket: safe.periodBucket,
      outcome: safe.outcome,
      request_id: safe.requestId,
      user_id: safe.userId,
      household_id: safe.householdId,
      duration_ms: safe.durationMs,
      status_code: safe.statusCode,
      error_code: safe.errorCode,
      forecast_source_count: safe.sourceCount,
      forecast_recurring_count: safe.recurringCount,
      forecast_planned_event_count: safe.plannedEventCount,
      forecast_installment_count: safe.installmentCount,
      forecast_realized_event_count: safe.realizedEventCount,
      forecast_cancelled_count: safe.cancelledCount,
      forecast_item_count: safe.itemCount,
      forecast_projected_item_count: safe.projectedItemCount,
      forecast_realized_item_count: safe.realizedItemCount,
      forecast_period_count: safe.periodCount,
      forecast_day_count: safe.dayCount,
      forecast_query_budget_ms: safe.queryBudgetMs,
      forecast_slow_query: safe.slowQuery,
      forecast_budget_exceeded: safe.budgetExceeded,
    },
  });
}

function emitRecord(
  safe: S07ForecastLog,
  hooks: S07ForecastObservabilityHooks = {},
  level: "info" | "warn" | "error" =
    safe.outcome === "unexpected_error" ? "error" : "info",
): void {
  try {
    addS07ForecastBreadcrumb(safe, safe.outcome, safe);
  } catch {
    // Observability is best effort and never changes the forecast response.
  }

  try {
    hooks.onRecord?.(safe);
    hooks.onMetric?.(safe);
  } catch {
    // Metrics providers must not affect a query or calculation.
  }

  try {
    const serialized = JSON.stringify(safe);
    if (level === "error") {
      console.error(serialized);
    } else if (level === "warn") {
      console.warn(serialized);
    } else {
      console.info(serialized);
    }
  } catch {
    // Structured logging is deliberately non-blocking.
  }
}

/** Emits a completed S07 record without serializing its input/result. */
export function logS07ForecastOperation(
  operation: S07ForecastOperationContext,
  outcome: S07ForecastOutcome,
  options: S07ForecastCompletionOptions = {},
): S07ForecastLog | undefined {
  const safe = primaryContext(operation, outcome, options);
  if (!safe) {
    return undefined;
  }

  emitRecord(safe, options);
  return safe;
}

function codeFromError(error: unknown): unknown {
  if (!isRecord(error)) {
    return undefined;
  }

  if (typeof error.code === "string") {
    return error.code;
  }

  // Result<T, E> errors expose only this stable code property.  Message,
  // stack and nested financial objects are intentionally never inspected.
  return isRecord(error.error) ? error.error.code : undefined;
}

/** Returns a known validation/auth/absence code without reading a message. */
export function expectedS07ErrorCode(
  error: unknown,
): S07ForecastExpectedErrorCode | undefined {
  if (error instanceof FinancialContextError) {
    return EXPECTED_ERROR_SET.has(error.code)
      ? (error.code as S07ForecastExpectedErrorCode)
      : undefined;
  }

  const code = codeFromError(error);
  return typeof code === "string" && EXPECTED_ERROR_SET.has(code)
    ? (code as S07ForecastExpectedErrorCode)
    : undefined;
}

/** Classifies only the closed expected vocabulary; all other codes are technical. */
export function classifyS07Error(error: unknown): S07ForecastErrorClassification {
  const expectedCode = expectedS07ErrorCode(error);
  if (expectedCode) {
    return { outcome: "expected_error", errorCode: expectedCode };
  }

  const code = codeFromError(error);
  return {
    outcome: "unexpected_error",
    errorCode: safeTechnicalErrorCode(code),
  };
}

export function isExpectedS07Error(error: unknown): boolean {
  return expectedS07ErrorCode(error) !== undefined;
}

function safeForecastField(value: unknown): "from" | "to" | "scenario" | null {
  return typeof value === "string" && FORECAST_FIELD_SET.has(value)
    ? (value as "from" | "to" | "scenario")
    : null;
}

function fieldFromError(error: unknown): "from" | "to" | "scenario" | null {
  if (!isRecord(error)) {
    return null;
  }

  const direct = safeForecastField(error.field);
  if (direct) {
    return direct;
  }
  return isRecord(error.error) ? safeForecastField(error.error.field) : null;
}

/** Converts an error to the public code/field-only forecast envelope. */
export function toS07ErrorEnvelope(
  error: unknown,
): S07ForecastSafeErrorEnvelope {
  const classification = classifyS07Error(error);
  const code =
    classification.errorCode === "UNAUTHENTICATED" ||
    classification.errorCode === "HOUSEHOLD_MEMBERSHIP_REQUIRED" ||
    classification.errorCode === "HOUSEHOLD_SELECTION_REQUIRED" ||
    classification.errorCode === "INVALID_FINANCIAL_CONTEXT"
      ? "FINANCIAL_CONTEXT_REQUIRED"
      : FORECAST_ERROR_SET.has(classification.errorCode)
        ? (classification.errorCode as (typeof FORECAST_ERROR_CODES)[number])
        : "FORECAST_QUERY_FAILED";
  return {
    ok: false,
    error: { code, field: fieldFromError(error) },
  };
}

function monotonicNow(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt: number, now: () => number): number {
  const current = now();
  return Number.isFinite(current)
    ? Math.max(0, Math.round(current - startedAt))
    : 0;
}

function resultFailure(value: unknown): { failed: boolean; error?: unknown } {
  if (!isRecord(value) || value.ok !== false) {
    return { failed: false };
  }
  return { failed: true, error: value.error };
}

function completionLog(
  operation: S07ForecastOperationContext,
  outcome: S07ForecastOutcome,
  durationMs: number,
  options: S07ForecastCompletionOptions,
): S07ForecastLog | undefined {
  return logS07ForecastOperation(operation, outcome, {
    ...options,
    durationMs,
    errorCode: options.errorCode,
  });
}

/**
 * Wraps source loading, builder, engine and query boundaries. Expected Result
 * errors remain ordinary outcomes; unexpected exceptions are captured and
 * rethrown after safe logging.
 */
export async function withS07ForecastObservability<T>(
  operation: S07ForecastOperationContext,
  work: () => Promise<T> | T,
  options: S07ForecastCompletionOptions = {},
): Promise<T> {
  const now = options.now ?? monotonicNow;
  const startedAt = now();

  try {
    const value = await work();
    const failure = resultFailure(value);
    if (failure.failed) {
      const classification = classifyS07Error(failure.error);
      const durationMs = elapsedMs(startedAt, now);
      if (classification.outcome === "expected_error") {
        completionLog(operation, classification.outcome, durationMs, {
          ...options,
          errorCode: classification.errorCode,
        });
      } else {
        reportS07UnexpectedError(failure.error, operation, durationMs, options);
      }
      return value;
    }

    completionLog(operation, "success", elapsedMs(startedAt, now), options);
    return value;
  } catch (error) {
    const durationMs = elapsedMs(startedAt, now);
    const classification = classifyS07Error(error);
    if (classification.outcome === "expected_error") {
      completionLog(operation, classification.outcome, durationMs, {
        ...options,
        errorCode: classification.errorCode,
      });
      throw error;
    }

    reportS07UnexpectedError(error, operation, durationMs, options);
    throw error;
  }
}

function safeThreshold(
  value: unknown,
  maximum: number,
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(maximum, Math.max(0, Math.round(value)));
  }
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    return safeThreshold(Number(value.trim()), maximum);
  }
  return undefined;
}

/** Reads the bounded slow-query threshold for S07. */
export function getS07SlowQueryThresholdMs(value?: unknown): number {
  return (
    safeThreshold(
      value ?? process.env.S07_SLOW_QUERY_THRESHOLD_MS,
      MAX_S07_SLOW_QUERY_THRESHOLD_MS,
    ) ?? DEFAULT_S07_SLOW_QUERY_THRESHOLD_MS
  );
}

/** Reads the bounded query budget for S07. */
export function getS07QueryBudgetMs(value?: unknown): number {
  return (
    safeThreshold(value ?? process.env.S07_QUERY_BUDGET_MS, MAX_S07_QUERY_BUDGET_MS) ??
    DEFAULT_S07_QUERY_BUDGET_MS
  );
}

/** Reports expected failures and captures only unexpected technical failures. */
export function reportS07UnexpectedError(
  error: unknown,
  operation: S07ForecastOperationContext,
  durationMs: number,
  options: S07ForecastCompletionOptions = {},
): S07ForecastErrorClassification {
  const classification = classifyS07Error(error);
  const code =
    classification.outcome === "expected_error"
      ? classification.errorCode
      : safeTechnicalErrorCode(options.technicalErrorCode ?? codeFromError(error));
  const safeOptions: S07ForecastCompletionOptions = {
    ...options,
    durationMs,
    errorCode: code,
  };

  completionLog(operation, classification.outcome, durationMs, safeOptions);

  if (classification.outcome === "unexpected_error") {
    try {
      captureServerException(
        error,
        toS07ObservabilityContext(operation, "unexpected_error", safeOptions),
      );
    } catch {
      // Sentry is best effort and never changes the forecast response.
    }
  }

  return { outcome: classification.outcome, errorCode: code };
}

/** Measures one source/builder/engine/query call without accepting SQL. */
export async function measureS07Query<T>(
  operation: S07ForecastOperationContext,
  work: () => Promise<T> | T,
  options: S07ForecastQueryOptions = {},
): Promise<T> {
  const now = options.now ?? monotonicNow;
  const startedAt = now();
  let thrownError: unknown;
  let returnedValue: unknown;
  let failed = false;

  try {
    returnedValue = await work();
    return returnedValue as T;
  } catch (error) {
    failed = true;
    thrownError = error;
    throw error;
  } finally {
    const durationMs = elapsedMs(startedAt, now);
    const thresholdMs = getS07SlowQueryThresholdMs(options.thresholdMs);
    const queryBudgetMs = getS07QueryBudgetMs(options.queryBudgetMs);
    const budgetExceeded = durationMs >= queryBudgetMs;
    const slowQuery = durationMs >= thresholdMs || budgetExceeded;
    if (slowQuery) {
      const returnedFailure = resultFailure(returnedValue);
      const classification = failed
        ? classifyS07Error(thrownError)
        : returnedFailure.failed
          ? classifyS07Error(returnedFailure.error)
          : undefined;
      const safe = sanitizeS07ForecastLog({
        ...operation,
        ...options,
        operation: operation.operation,
        stage: operation.stage,
        outcome: classification?.outcome ?? "success",
        errorCode:
          classification?.outcome === "expected_error"
            ? classification.errorCode
            : classification?.outcome === "unexpected_error"
              ? safeTechnicalErrorCode(options.technicalErrorCode)
              : undefined,
        durationMs,
        slowQuery: true,
        slowQueryThresholdMs: thresholdMs,
        queryBudgetMs,
        budgetExceeded,
      });

      if (safe) {
        try {
          addS07ForecastBreadcrumb(safe, safe.outcome, safe);
        } catch {
          // Best effort only.
        }

        try {
          options.onRecord?.(safe);
          options.onMetric?.(safe);
          options.onSlowQuery?.(safe);
        } catch {
          // Metrics callbacks are never part of the query response path.
        }

        try {
          console.warn(JSON.stringify(safe));
        } catch {
          // Structured logging is best effort.
        }
      }
    }
  }
}

/** Naming aliases keep the small adapter surface discoverable to T04–T06. */
export const createS07ForecastContext = createS07ForecastOperation;
export const withS07ForecastOperation = withS07ForecastObservability;
export const observeS07Forecast = withS07ForecastObservability;
export const measureS07ForecastStage = measureS07Query;
export const observeS07Query = measureS07Query;
export const logS07ForecastResult = logS07ForecastOperation;
export const captureS07UnexpectedError = reportS07UnexpectedError;
