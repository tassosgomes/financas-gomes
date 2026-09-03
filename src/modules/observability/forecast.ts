import { generateUuidV7 } from "@/lib/uuidv7";
import { FinancialContextError } from "@/modules/households/contracts";
import {
  FORECAST_ERROR_CODES,
  FORECAST_SCENARIOS,
  FORECAST_SOURCE_KINDS as DOMAIN_FORECAST_SOURCE_KINDS,
  type ForecastScenario,
} from "@/modules/forecast/contracts";

import type { ObservabilityContext } from "./contracts";
import { addBreadcrumbSafely, captureServerException } from "./server";

/**
 * Observable stages of the S07 pipeline.  A stage is deliberately broader
 * than a source/reference identifier so it remains useful for aggregation.
 */
export const FORECAST_STAGES = [
  "source",
  "builder",
  "engine",
  "query",
] as const;

export type ForecastStage = (typeof FORECAST_STAGES)[number];

/**
 * Code-owned operation names.  They are the only names that can reach an
 * event/use-case field; callers cannot turn a query or label into a name.
 */
export const FORECAST_OPERATIONS = [
  "forecast.source.load",
  "forecast.timeline.build",
  "forecast.engine.calculate",
  "forecast.query.get",
] as const;

export type ForecastOperation = (typeof FORECAST_OPERATIONS)[number];

/** Compatibility input names for adapters that call the stage a builder. */
export const FORECAST_OPERATION_ALIASES = [
  ...FORECAST_OPERATIONS,
  "forecast.builder.build",
  "forecast.source",
  "forecast.builder",
  "forecast.engine",
  "forecast.query",
  "forecast.query.execute",
  "forecast.query.read",
] as const;

export type ForecastOperationInput =
  | ForecastOperation
  | ForecastStage
  | (typeof FORECAST_OPERATION_ALIASES)[number];

/** Stable query/stage codes used in metrics and slow-query investigation. */
export const FORECAST_QUERY_CODES = {
  source: "forecast_source",
  builder: "forecast_builder",
  engine: "forecast_engine",
  query: "forecast_query",
} as const satisfies Record<ForecastStage, string>;

export type ForecastQueryCode =
  (typeof FORECAST_QUERY_CODES)[ForecastStage];

export const FORECAST_OUTCOMES = [
  "success",
  "expected_error",
  "unexpected_error",
] as const;

export type ForecastOutcome = (typeof FORECAST_OUTCOMES)[number];

/** Source kind can be aggregated as ALL without exposing a source ID. */
export const FORECAST_OBSERVABILITY_SOURCE_KINDS = [
  ...DOMAIN_FORECAST_SOURCE_KINDS,
  "ALL",
] as const;

export type ForecastObservabilitySourceKind =
  (typeof FORECAST_OBSERVABILITY_SOURCE_KINDS)[number];

/** A categorical range bucket; exact from/to dates never enter telemetry. */
export const FORECAST_PERIOD_BUCKETS = [
  "SINGLE_PERIOD",
  "SHORT",
  "MEDIUM",
  "LONG",
] as const;

export type ForecastPeriodBucket =
  (typeof FORECAST_PERIOD_BUCKETS)[number];

/**
 * Counters are intentionally aggregate-only.  In particular, this type has
 * no amount, balance, date, description, item, source-reference or payload.
 */
export interface ForecastAggregateCounts {
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

export interface ForecastOperationOptions
  extends ForecastAggregateCounts {
  requestId?: string;
  /** Alias accepted from a transport boundary; emitted as requestId. */
  correlationId?: string;
  userId?: string;
  householdId?: string;
  scenario?: ForecastScenario;
  sourceKind?: ForecastObservabilitySourceKind;
  /** Exact period dates are never accepted; only this categorical bucket is. */
  periodBucket?: ForecastPeriodBucket;
  /** Compatibility aliases normalized to periodBucket. */
  periodRangeBucket?: ForecastPeriodBucket;
  periodRange?: ForecastPeriodBucket;
  durationMs?: number;
  statusCode?: number;
  /** Untrusted adapter objects are allow-listed by the final sanitizer. */
  [key: string]: unknown;
}

export interface ForecastOperationContext
  extends ForecastAggregateCounts {
  operation: ForecastOperation;
  stage: ForecastStage;
  queryCode: ForecastQueryCode;
  requestId?: string;
  userId?: string;
  householdId?: string;
  scenario?: ForecastScenario;
  sourceKind?: ForecastObservabilitySourceKind;
  periodBucket?: ForecastPeriodBucket;
  durationMs?: number;
  statusCode?: number;
}

export interface ForecastLog extends ForecastOperationContext {
  event: string;
  useCase: string;
  outcome: ForecastOutcome;
  errorCode?: ForecastErrorCode;
  slowQuery?: boolean;
  slowQueryThresholdMs?: number;
  queryBudgetMs?: number;
  budgetExceeded?: boolean;
}

/** Unknown adapter fields are accepted here only to prove they are dropped. */
export type ForecastLogInput = Omit<
  Partial<ForecastLog>,
  "errorCode"
> & {
  errorCode?: unknown;
} & Record<string, unknown>;

export interface ForecastObservabilityHooks {
  /** Receives an already allow-listed record for logs/metrics. */
  onRecord?: (record: ForecastLog) => void;
  /** Alias for metric adapters that do not emit application logs. */
  onMetric?: (record: ForecastLog) => void;
  /** Receives only records that exceeded the slow/budget threshold. */
  onSlowQuery?: (record: ForecastLog) => void;
}

export interface ForecastCompletionOptions
  extends ForecastAggregateCounts,
    ForecastObservabilityHooks {
  durationMs?: number;
  errorCode?: string;
  technicalErrorCode?: string;
  queryBudgetMs?: number;
  slowQueryThresholdMs?: number;
  budgetExceeded?: boolean;
  /** Injectable monotonic clock for deterministic wrapper tests. */
  now?: () => number;
}

export interface ForecastQueryOptions
  extends ForecastAggregateCounts,
    ForecastObservabilityHooks {
  /** Per-call override; bounded by MAX_FORECAST_SLOW_QUERY_THRESHOLD_MS. */
  thresholdMs?: number;
  /** Per-call query budget override; bounded by MAX_FORECAST_QUERY_BUDGET_MS. */
  queryBudgetMs?: number;
  technicalErrorCode?: string;
  /** Injectable monotonic clock for deterministic measurement tests. */
  now?: () => number;
}

export const FORECAST_EXPECTED_ERROR_CODES = [
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

export type ForecastExpectedErrorCode =
  (typeof FORECAST_EXPECTED_ERROR_CODES)[number];

/** Technical labels are closed so provider/database text never becomes code. */
export const FORECAST_TECHNICAL_ERROR_CODES = [
  "FORECAST_INCONSISTENT",
  "FORECAST_QUERY_FAILED",
  "FORECAST_SOURCE_QUERY_FAILED",
  "FORECAST_BUILDER_FAILED",
  "FORECAST_ENGINE_FAILED",
  "FORECAST_QUERY_TIMEOUT",
  "INVALID_FORECAST_RESULT",
  "UNEXPECTED_ERROR",
] as const;

export type ForecastTechnicalErrorCode =
  (typeof FORECAST_TECHNICAL_ERROR_CODES)[number];

export type ForecastErrorCode =
  | ForecastExpectedErrorCode
  | ForecastTechnicalErrorCode;

export interface ForecastErrorClassification {
  outcome: "expected_error" | "unexpected_error";
  errorCode: ForecastErrorCode;
}

export interface ForecastSafeErrorEnvelope {
  ok: false;
  error: {
    code: (typeof FORECAST_ERROR_CODES)[number];
    field: "from" | "to" | "scenario" | null;
  };
}

export const DEFAULT_FORECAST_SLOW_QUERY_THRESHOLD_MS = 250;
export const MAX_FORECAST_SLOW_QUERY_THRESHOLD_MS = 60_000;
export const DEFAULT_FORECAST_QUERY_BUDGET_MS = 2_000;
export const MAX_FORECAST_QUERY_BUDGET_MS = 60_000;
export const MAX_FORECAST_AGGREGATE_COUNT = 1_000_000_000;

const OPERATION_ALIASES: Readonly<Record<string, ForecastOperation>> = {
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

const OPERATION_SET = new Set<string>(FORECAST_OPERATIONS);
const PERIOD_BUCKET_SET = new Set<string>(FORECAST_PERIOD_BUCKETS);
const EXPECTED_ERROR_SET = new Set<string>(
  FORECAST_EXPECTED_ERROR_CODES,
);
const TECHNICAL_ERROR_SET = new Set<string>(
  FORECAST_TECHNICAL_ERROR_CODES,
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
  maximum = MAX_FORECAST_AGGREGATE_COUNT,
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

function operationValue(value: unknown): ForecastOperation | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const operation = OPERATION_ALIASES[value];
  return operation && OPERATION_SET.has(operation) ? operation : undefined;
}

function stageValue(value: unknown): ForecastStage | undefined {
  return enumValue(FORECAST_STAGES, value);
}

function outcomeValue(value: unknown): ForecastOutcome | undefined {
  return enumValue(FORECAST_OUTCOMES, value);
}

function scenarioValue(value: unknown): ForecastScenario | undefined {
  return enumValue(FORECAST_SCENARIOS, value);
}

function sourceKindValue(value: unknown): ForecastObservabilitySourceKind | undefined {
  return enumValue(FORECAST_OBSERVABILITY_SOURCE_KINDS, value);
}

function periodBucketValue(value: unknown): ForecastPeriodBucket | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const aliases: Record<string, ForecastPeriodBucket> = {
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

function stageForOperation(operation: ForecastOperation): ForecastStage {
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

function operationForStage(stage: ForecastStage): ForecastOperation {
  return stage === "source"
    ? "forecast.source.load"
    : stage === "builder"
      ? "forecast.timeline.build"
      : stage === "engine"
        ? "forecast.engine.calculate"
        : "forecast.query.get";
}

function queryCodeForStage(stage: ForecastStage): ForecastQueryCode {
  return FORECAST_QUERY_CODES[stage];
}

function eventName(
  operation: ForecastOperation,
  outcome: ForecastOutcome,
): string {
  return `${operation.replaceAll(".", "_")}_${outcome}`;
}

function safeErrorCode(value: unknown): ForecastErrorCode | undefined {
  if (
    typeof value !== "string" ||
    !ERROR_CODE_PATTERN.test(value) ||
    (!EXPECTED_ERROR_SET.has(value) && !TECHNICAL_ERROR_SET.has(value))
  ) {
    return undefined;
  }

  return value as ForecastErrorCode;
}

function safeTechnicalErrorCode(value: unknown): ForecastTechnicalErrorCode {
  return TECHNICAL_ERROR_SET.has(value as string)
    ? (value as ForecastTechnicalErrorCode)
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
export function sanitizeForecastCounts(
  value: unknown,
): ForecastAggregateCounts | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const source = isRecord(value.counts) ? value.counts : value;
  const aliases: Record<keyof ForecastAggregateCounts, readonly string[]> = {
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

  const result: ForecastAggregateCounts = {};
  for (const key of Object.keys(aliases) as Array<keyof ForecastAggregateCounts>) {
    const count = countValue(source, aliases[key]);
    if (count !== undefined) {
      result[key] = count;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function aggregateInput(value: Record<string, unknown>): ForecastAggregateCounts {
  return sanitizeForecastCounts(value) ?? {};
}

function addSafeId(
  target: ForecastOperationContext,
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
export function createForecastOperation(
  operationInput: ForecastOperationInput,
  options: ForecastOperationOptions = {},
): ForecastOperationContext {
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

  const result: ForecastOperationContext = {
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
export function forecastUseCaseName(
  operation: ForecastOperationInput,
): string {
  return operationValue(operation)
    ? operationValue(operation)!
    : operationForStage(stageValue(operation) ?? "query");
}

export function forecastEventName(
  operation: ForecastOperationInput,
  outcome: ForecastOutcome,
): string {
  return eventName(
    operationValue(operation) ??
      operationForStage(stageValue(operation) ?? "query"),
    outcome,
  );
}

function optionalLogFields(
  value: Record<string, unknown>,
  result: ForecastLog,
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
    MAX_FORECAST_SLOW_QUERY_THRESHOLD_MS,
  );
  if (threshold !== undefined) {
    result.slowQueryThresholdMs = threshold;
  }

  const queryBudget = finiteInteger(
    value.queryBudgetMs,
    MAX_FORECAST_QUERY_BUDGET_MS,
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
export function sanitizeForecastLog(
  value: ForecastLogInput,
): ForecastLog | undefined {
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

    const safe: ForecastLog = {
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
  operation: ForecastOperationContext,
  outcome: ForecastOutcome,
  options: ForecastCompletionOptions = {},
): ForecastLog | undefined {
  return sanitizeForecastLog({
    ...operation,
    ...options,
    operation: operation.operation,
    stage: operation.stage,
    outcome,
  });
}

/** Converts only S07 technical metadata to the shared Sentry context shape. */
export function toForecastObservabilityContext(
  operation: ForecastOperationContext,
  outcome: ForecastOutcome = "unexpected_error",
  options: ForecastCompletionOptions = {},
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
export function addForecastBreadcrumb(
  operation: ForecastOperationContext,
  outcome: ForecastOutcome,
  options: ForecastCompletionOptions = {},
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
  safe: ForecastLog,
  hooks: ForecastObservabilityHooks = {},
  level: "info" | "warn" | "error" =
    safe.outcome === "unexpected_error" ? "error" : "info",
): void {
  try {
    addForecastBreadcrumb(safe, safe.outcome, safe);
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
export function logForecastOperation(
  operation: ForecastOperationContext,
  outcome: ForecastOutcome,
  options: ForecastCompletionOptions = {},
): ForecastLog | undefined {
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
export function expectedForecastErrorCode(
  error: unknown,
): ForecastExpectedErrorCode | undefined {
  if (error instanceof FinancialContextError) {
    return EXPECTED_ERROR_SET.has(error.code)
      ? (error.code as ForecastExpectedErrorCode)
      : undefined;
  }

  const code = codeFromError(error);
  return typeof code === "string" && EXPECTED_ERROR_SET.has(code)
    ? (code as ForecastExpectedErrorCode)
    : undefined;
}

/** Classifies only the closed expected vocabulary; all other codes are technical. */
export function classifyForecastError(error: unknown): ForecastErrorClassification {
  const expectedCode = expectedForecastErrorCode(error);
  if (expectedCode) {
    return { outcome: "expected_error", errorCode: expectedCode };
  }

  const code = codeFromError(error);
  return {
    outcome: "unexpected_error",
    errorCode: safeTechnicalErrorCode(code),
  };
}

export function isExpectedForecastError(error: unknown): boolean {
  return expectedForecastErrorCode(error) !== undefined;
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
export function toForecastErrorEnvelope(
  error: unknown,
): ForecastSafeErrorEnvelope {
  const classification = classifyForecastError(error);
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
  operation: ForecastOperationContext,
  outcome: ForecastOutcome,
  durationMs: number,
  options: ForecastCompletionOptions,
): ForecastLog | undefined {
  return logForecastOperation(operation, outcome, {
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
export async function withForecastObservability<T>(
  operation: ForecastOperationContext,
  work: () => Promise<T> | T,
  options: ForecastCompletionOptions = {},
): Promise<T> {
  const now = options.now ?? monotonicNow;
  const startedAt = now();

  try {
    const value = await work();
    const failure = resultFailure(value);
    if (failure.failed) {
      const classification = classifyForecastError(failure.error);
      const durationMs = elapsedMs(startedAt, now);
      if (classification.outcome === "expected_error") {
        completionLog(operation, classification.outcome, durationMs, {
          ...options,
          errorCode: classification.errorCode,
        });
      } else {
        reportForecastUnexpectedError(failure.error, operation, durationMs, options);
      }
      return value;
    }

    completionLog(operation, "success", elapsedMs(startedAt, now), options);
    return value;
  } catch (error) {
    const durationMs = elapsedMs(startedAt, now);
    const classification = classifyForecastError(error);
    if (classification.outcome === "expected_error") {
      completionLog(operation, classification.outcome, durationMs, {
        ...options,
        errorCode: classification.errorCode,
      });
      throw error;
    }

    reportForecastUnexpectedError(error, operation, durationMs, options);
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
export function getForecastSlowQueryThresholdMs(value?: unknown): number {
  return (
    safeThreshold(
      value ??
        process.env.FORECAST_SLOW_QUERY_THRESHOLD_MS ??
        process.env.S07_SLOW_QUERY_THRESHOLD_MS,
      MAX_FORECAST_SLOW_QUERY_THRESHOLD_MS,
    ) ?? DEFAULT_FORECAST_SLOW_QUERY_THRESHOLD_MS
  );
}

/** Reads the bounded query budget for S07. */
export function getForecastQueryBudgetMs(value?: unknown): number {
  return (
    safeThreshold(
      value ??
        process.env.FORECAST_QUERY_BUDGET_MS ??
        process.env.S07_QUERY_BUDGET_MS,
      MAX_FORECAST_QUERY_BUDGET_MS,
    ) ??
    DEFAULT_FORECAST_QUERY_BUDGET_MS
  );
}

/** Reports expected failures and captures only unexpected technical failures. */
export function reportForecastUnexpectedError(
  error: unknown,
  operation: ForecastOperationContext,
  durationMs: number,
  options: ForecastCompletionOptions = {},
): ForecastErrorClassification {
  const classification = classifyForecastError(error);
  const code =
    classification.outcome === "expected_error"
      ? classification.errorCode
      : safeTechnicalErrorCode(options.technicalErrorCode ?? codeFromError(error));
  const safeOptions: ForecastCompletionOptions = {
    ...options,
    durationMs,
    errorCode: code,
  };

  completionLog(operation, classification.outcome, durationMs, safeOptions);

  if (classification.outcome === "unexpected_error") {
    try {
      captureServerException(
        error,
        toForecastObservabilityContext(operation, "unexpected_error", safeOptions),
      );
    } catch {
      // Sentry is best effort and never changes the forecast response.
    }
  }

  return { outcome: classification.outcome, errorCode: code };
}

/** Measures one source/builder/engine/query call without accepting SQL. */
export async function measureForecastQuery<T>(
  operation: ForecastOperationContext,
  work: () => Promise<T> | T,
  options: ForecastQueryOptions = {},
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
    const thresholdMs = getForecastSlowQueryThresholdMs(options.thresholdMs);
    const queryBudgetMs = getForecastQueryBudgetMs(options.queryBudgetMs);
    const budgetExceeded = durationMs >= queryBudgetMs;
    const slowQuery = durationMs >= thresholdMs || budgetExceeded;
    if (slowQuery) {
      const returnedFailure = resultFailure(returnedValue);
      const classification = failed
        ? classifyForecastError(thrownError)
        : returnedFailure.failed
          ? classifyForecastError(returnedFailure.error)
          : undefined;
      const safe = sanitizeForecastLog({
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
          addForecastBreadcrumb(safe, safe.outcome, safe);
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
export const createForecastContext = createForecastOperation;
export const withForecastOperation = withForecastObservability;
export const observeForecast = withForecastObservability;
export const measureForecastStage = measureForecastQuery;
export const observeForecastQuery = measureForecastQuery;
export const logForecastResult = logForecastOperation;
export const captureForecastUnexpectedError = reportForecastUnexpectedError;
