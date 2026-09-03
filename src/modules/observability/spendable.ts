import { generateUuidV7 } from "@/lib/uuidv7";
import { FinancialContextError } from "@/modules/households/contracts";

import type { ObservabilityContext } from "./contracts";
import { addBreadcrumbSafely, captureServerException } from "./server";

/**
 * Version identifiers are code-owned values.  They are repeated in every
 * record so an incident can be correlated with the exact public contract and
 * formula without serializing the result or its inputs.
 */
export const SPENDABLE_CONTRACT_VERSION = "s08.v1" as const;
export const SPENDABLE_RULE_VERSION = "spendable.v1" as const;

export const SPENDABLE_STAGES = [
  "read",
  "forecast",
  "engine",
  "serialization",
] as const;

export type SpendableStage = (typeof SPENDABLE_STAGES)[number];

/** Closed operation names for all S08 server-side boundaries. */
export const SPENDABLE_OPERATIONS = [
  "spendable.read",
  "spendable.forecast.build",
  "spendable.engine.calculate",
  "spendable.serialize",
] as const;

export type SpendableOperation =
  (typeof SPENDABLE_OPERATIONS)[number];

/**
 * Adapters may use the older stage/query vocabulary; it is normalized to the
 * operation vocabulary above before it can reach logs, metrics or Sentry.
 */
export const SPENDABLE_OPERATION_ALIASES = [
  ...SPENDABLE_OPERATIONS,
  "spendable.query.read",
  "spendable.query.get",
  "spendable.read.query",
  "spendable.forecast",
  "spendable.forecast.calculate",
  "spendable.builder",
  "spendable.builder.build",
  "spendable.engine",
  "spendable.serialize.result",
  "spendable.serialization",
  "spendable.serialization.serialize",
  "read",
  "query",
  "forecast",
  "builder",
  "engine",
  "serialization",
  "serialize",
] as const;

export type SpendableOperationInput =
  | SpendableOperation
  | SpendableStage
  | (typeof SPENDABLE_OPERATION_ALIASES)[number];

/** Stable operation/query codes; these are not SQL identifiers. */
export const SPENDABLE_QUERY_CODES = {
  read: "spendable_read",
  forecast: "spendable_forecast",
  engine: "spendable_engine",
  serialization: "spendable_serialization",
} as const satisfies Record<SpendableStage, string>;

export type SpendableQueryCode =
  (typeof SPENDABLE_QUERY_CODES)[SpendableStage];

export const SPENDABLE_OUTCOMES = [
  "success",
  "expected_error",
  "unexpected_error",
] as const;

export type SpendableOutcome = (typeof SPENDABLE_OUTCOMES)[number];

/** Result states are categories only; no monetary result crosses this API. */
export const SPENDABLE_RESULTS = [
  "AVAILABLE",
  "ZERO",
  "DEFICIT",
  "UNAVAILABLE",
] as const;

export type SpendableResult = (typeof SPENDABLE_RESULTS)[number];

export const SPENDABLE_BUFFER_SOURCES = [
  "CONFIGURED",
  "ABSENT_DEFAULT_ZERO",
] as const;

export type SpendableBufferSource =
  (typeof SPENDABLE_BUFFER_SOURCES)[number];

export const SPENDABLE_SOURCE_KINDS = [
  "RECURRING",
  "PLANNED_EVENT",
  "INSTALLMENT",
  "REALIZED_EVENT",
  "RESERVE",
  "ALL",
] as const;

export type SpendableSourceKind =
  (typeof SPENDABLE_SOURCE_KINDS)[number];

/**
 * Only aggregate counters are represented here.  Deliberately absent are
 * cents, balances, dates, references, descriptions, rows and timelines.
 */
export interface SpendableAggregateCounts {
  sourceCount?: number;
  recurringCount?: number;
  plannedEventCount?: number;
  installmentCount?: number;
  realizedEventCount?: number;
  cancelledCount?: number;
  itemCount?: number;
  forecastItemCount?: number;
  projectedItemCount?: number;
  realizedItemCount?: number;
  dayCount?: number;
  periodCount?: number;
  pointCount?: number;
  causalPointCount?: number;
  generalAccountCount?: number;
  reserveComponentCount?: number;
  serializedFieldCount?: number;
}

export interface SpendableOperationOptions
  extends SpendableAggregateCounts {
  requestId?: string;
  /** Alias accepted from a transport boundary; emitted as requestId. */
  correlationId?: string;
  userId?: string;
  householdId?: string;
  scenario?: unknown;
  horizonDays?: unknown;
  /** The actual output category, never the amount returned by the engine. */
  result?: unknown;
  /** Compatibility alias for result. */
  resultState?: unknown;
  bufferSource?: unknown;
  sourceKind?: unknown;
  durationMs?: unknown;
  statusCode?: unknown;
  /** Untrusted adapter fields are dropped by the final allow-list. */
  [key: string]: unknown;
}

export interface SpendableOperationContext
  extends SpendableAggregateCounts {
  operation: SpendableOperation;
  stage: SpendableStage;
  queryCode: SpendableQueryCode;
  contractVersion: typeof SPENDABLE_CONTRACT_VERSION;
  ruleVersion: typeof SPENDABLE_RULE_VERSION;
  requestId?: string;
  userId?: string;
  householdId?: string;
  scenario?: "CONSERVATIVE" | "EXPECTED";
  horizonDays?: number;
  result?: SpendableResult;
  bufferSource?: SpendableBufferSource;
  sourceKind?: SpendableSourceKind;
  durationMs?: number;
  statusCode?: number;
}

export interface SpendableLog extends SpendableOperationContext {
  event: string;
  useCase: SpendableOperation;
  outcome: SpendableOutcome;
  errorCode?: SpendableErrorCode;
  slowQuery?: boolean;
  slowQueryThresholdMs?: number;
  queryBudgetMs?: number;
  budgetExceeded?: boolean;
}

/** Unknown fields are accepted solely to prove the sanitizer drops them. */
export type SpendableLogInput = Omit<
  Partial<SpendableLog>,
  | "event"
  | "useCase"
  | "operation"
  | "stage"
  | "queryCode"
  | "contractVersion"
  | "ruleVersion"
  | "errorCode"
  | "scenario"
  | "horizonDays"
  | "result"
  | "bufferSource"
  | "sourceKind"
> & {
  event?: unknown;
  useCase?: unknown;
  operation?: unknown;
  stage?: unknown;
  queryCode?: unknown;
  contractVersion?: unknown;
  ruleVersion?: unknown;
  errorCode?: unknown;
  scenario?: unknown;
  horizonDays?: unknown;
  result?: unknown;
  resultState?: unknown;
  bufferSource?: unknown;
  sourceKind?: unknown;
} & Record<string, unknown>;

export interface SpendableObservabilityHooks {
  /** Receives an already allow-listed record for logs/metrics. */
  onRecord?: (record: SpendableLog) => void;
  /** Alias for metric adapters that do not emit application logs. */
  onMetric?: (record: SpendableLog) => void;
  /** Receives only records that exceeded the configured threshold/budget. */
  onSlowQuery?: (record: SpendableLog) => void;
}

export interface SpendableCompletionOptions
  extends SpendableAggregateCounts,
    SpendableObservabilityHooks {
  durationMs?: number;
  errorCode?: string;
  technicalErrorCode?: string;
  scenario?: unknown;
  horizonDays?: unknown;
  result?: unknown;
  resultState?: unknown;
  bufferSource?: unknown;
  sourceKind?: unknown;
  queryBudgetMs?: number;
  slowQueryThresholdMs?: number;
  budgetExceeded?: boolean;
  /** Injectable monotonic clock for deterministic tests. */
  now?: () => number;
}

export interface SpendableQueryOptions
  extends SpendableAggregateCounts,
    SpendableObservabilityHooks {
  /** Per-call override, bounded by MAX_SPENDABLE_SLOW_QUERY_THRESHOLD_MS. */
  thresholdMs?: number;
  /** Per-call budget override, bounded by MAX_SPENDABLE_QUERY_BUDGET_MS. */
  queryBudgetMs?: number;
  technicalErrorCode?: string;
  now?: () => number;
  scenario?: unknown;
  horizonDays?: unknown;
  result?: unknown;
  resultState?: unknown;
  bufferSource?: unknown;
  sourceKind?: unknown;
}

export const SPENDABLE_EXPECTED_ERROR_CODES = [
  "INVALID_DATE",
  "INVALID_DATE_RANGE",
  "INVALID_AMOUNT",
  "INVALID_REFERENCE",
  "INVALID_ITEM",
  "INVALID_SCENARIO",
  "INVALID_HORIZON",
  "HORIZON_OUT_OF_RANGE",
  "INVALID_SPENDABLE_INPUT",
  "DUPLICATE_REFERENCE",
  "SPENDABLE_NOT_FOUND",
  "SPENDABLE_CONFIG_ABSENT",
  "SPENDABLE_BUFFER_ABSENT",
  "OPERATIONAL_BUFFER_ABSENT",
  "SPENDABLE_RESERVE_UNAVAILABLE",
  "FINANCIAL_CONTEXT_REQUIRED",
  "UNAUTHENTICATED",
  "HOUSEHOLD_MEMBERSHIP_REQUIRED",
  "HOUSEHOLD_SELECTION_REQUIRED",
  "INVALID_FINANCIAL_CONTEXT",
] as const;

export type SpendableExpectedErrorCode =
  (typeof SPENDABLE_EXPECTED_ERROR_CODES)[number];

/** Technical labels are closed so provider/database text never becomes code. */
export const SPENDABLE_TECHNICAL_ERROR_CODES = [
  "SPENDABLE_READ_FAILED",
  "SPENDABLE_QUERY_FAILED",
  "SPENDABLE_QUERY_TIMEOUT",
  "SPENDABLE_FORECAST_FAILED",
  "SPENDABLE_ENGINE_FAILED",
  "SPENDABLE_SERIALIZATION_FAILED",
  "SPENDABLE_INCONSISTENT",
  "INVALID_SPENDABLE_RESULT",
  "SPENDABLE_CONTRACT_VIOLATION",
  "UNEXPECTED_ERROR",
] as const;

export type SpendableTechnicalErrorCode =
  (typeof SPENDABLE_TECHNICAL_ERROR_CODES)[number];

export type SpendableErrorCode =
  | SpendableExpectedErrorCode
  | SpendableTechnicalErrorCode;

export interface SpendableErrorClassification {
  outcome: "expected_error" | "unexpected_error";
  errorCode: SpendableErrorCode;
}

export interface SpendableSafeErrorEnvelope {
  ok: false;
  error: {
    code: SpendableErrorCode;
    field: "asOf" | "horizon" | "scenario" | "buffer" | null;
  };
}

export const DEFAULT_SPENDABLE_SLOW_QUERY_THRESHOLD_MS = 250;
export const MAX_SPENDABLE_SLOW_QUERY_THRESHOLD_MS = 60_000;
export const DEFAULT_SPENDABLE_QUERY_BUDGET_MS = 2_000;
export const MAX_SPENDABLE_QUERY_BUDGET_MS = 60_000;
export const MAX_SPENDABLE_AGGREGATE_COUNT = 1_000_000_000;
export const MIN_SPENDABLE_HORIZON_DAYS = 1;
export const MAX_SPENDABLE_HORIZON_DAYS = 3_660;

const OPERATION_ALIASES: Readonly<Record<string, SpendableOperation>> = {
  "spendable.read": "spendable.read",
  "spendable.query.read": "spendable.read",
  "spendable.query.get": "spendable.read",
  "spendable.read.query": "spendable.read",
  read: "spendable.read",
  query: "spendable.read",
  "spendable.forecast.build": "spendable.forecast.build",
  "spendable.forecast": "spendable.forecast.build",
  "spendable.forecast.calculate": "spendable.forecast.build",
  "spendable.builder": "spendable.forecast.build",
  "spendable.builder.build": "spendable.forecast.build",
  forecast: "spendable.forecast.build",
  builder: "spendable.forecast.build",
  "spendable.engine.calculate": "spendable.engine.calculate",
  "spendable.engine": "spendable.engine.calculate",
  engine: "spendable.engine.calculate",
  "spendable.serialize": "spendable.serialize",
  "spendable.serialize.result": "spendable.serialize",
  "spendable.serialization": "spendable.serialize",
  "spendable.serialization.serialize": "spendable.serialize",
  serialization: "spendable.serialize",
  serialize: "spendable.serialize",
};

const OPERATION_SET = new Set<string>(SPENDABLE_OPERATIONS);
const STAGE_SET = new Set<string>(SPENDABLE_STAGES);
const RESULT_SET = new Set<string>(SPENDABLE_RESULTS);
const BUFFER_SOURCE_SET = new Set<string>(SPENDABLE_BUFFER_SOURCES);
const SOURCE_KIND_SET = new Set<string>(SPENDABLE_SOURCE_KINDS);
const EXPECTED_ERROR_SET = new Set<string>(
  SPENDABLE_EXPECTED_ERROR_CODES,
);
const TECHNICAL_ERROR_SET = new Set<string>(
  SPENDABLE_TECHNICAL_ERROR_CODES,
);
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const SAFE_SCENARIOS = ["CONSERVATIVE", "EXPECTED"] as const;
const SCENARIO_SET = new Set<string>(SAFE_SCENARIOS);
const SAFE_FIELD_SET = new Set(["asOf", "horizon", "horizonDays", "scenario", "buffer"]);

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
  maximum = MAX_SPENDABLE_AGGREGATE_COUNT,
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

function horizon(value: unknown): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_SPENDABLE_HORIZON_DAYS ||
    value > MAX_SPENDABLE_HORIZON_DAYS
  ) {
    return undefined;
  }

  return value;
}

function enumValue<T extends readonly string[]>(
  values: T,
  value: unknown,
): T[number] | undefined {
  return typeof value === "string" && values.includes(value)
    ? (value as T[number])
    : undefined;
}

function operationValue(value: unknown): SpendableOperation | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const operation = OPERATION_ALIASES[value];
  return operation && OPERATION_SET.has(operation) ? operation : undefined;
}

function stageValue(value: unknown): SpendableStage | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const aliases: Readonly<Record<string, SpendableStage>> = {
    read: "read",
    query: "read",
    forecast: "forecast",
    builder: "forecast",
    build: "forecast",
    engine: "engine",
    serialization: "serialization",
    serialize: "serialization",
  };
  const stage = aliases[value];
  return stage && STAGE_SET.has(stage) ? stage : undefined;
}

function outcomeValue(value: unknown): SpendableOutcome | undefined {
  return enumValue(SPENDABLE_OUTCOMES, value);
}

function scenarioValue(value: unknown): "CONSERVATIVE" | "EXPECTED" | undefined {
  return typeof value === "string" && SCENARIO_SET.has(value)
    ? (value as "CONSERVATIVE" | "EXPECTED")
    : undefined;
}

function resultValue(value: unknown): SpendableResult | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const aliases: Readonly<Record<string, SpendableResult>> = {
    AVAILABLE: "AVAILABLE",
    available: "AVAILABLE",
    POSITIVE: "AVAILABLE",
    positive: "AVAILABLE",
    ZERO: "ZERO",
    zero: "ZERO",
    DEFICIT: "DEFICIT",
    deficit: "DEFICIT",
    NEGATIVE: "DEFICIT",
    negative: "DEFICIT",
    UNAVAILABLE: "UNAVAILABLE",
    unavailable: "UNAVAILABLE",
  };
  const result = aliases[value];
  return result && RESULT_SET.has(result) ? result : undefined;
}

function bufferSourceValue(value: unknown): SpendableBufferSource | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const aliases: Readonly<Record<string, SpendableBufferSource>> = {
    CONFIGURED: "CONFIGURED",
    configured: "CONFIGURED",
    ABSENT_DEFAULT_ZERO: "ABSENT_DEFAULT_ZERO",
    absent_default_zero: "ABSENT_DEFAULT_ZERO",
    ABSENT: "ABSENT_DEFAULT_ZERO",
    absent: "ABSENT_DEFAULT_ZERO",
  };
  const source = aliases[value];
  return source && BUFFER_SOURCE_SET.has(source) ? source : undefined;
}

function sourceKindValue(value: unknown): SpendableSourceKind | undefined {
  return typeof value === "string" && SOURCE_KIND_SET.has(value)
    ? (value as SpendableSourceKind)
    : undefined;
}

function stageForOperation(operation: SpendableOperation): SpendableStage {
  if (operation === "spendable.read") {
    return "read";
  }
  if (operation === "spendable.forecast.build") {
    return "forecast";
  }
  if (operation === "spendable.engine.calculate") {
    return "engine";
  }
  return "serialization";
}

function operationForStage(stage: SpendableStage): SpendableOperation {
  return stage === "read"
    ? "spendable.read"
    : stage === "forecast"
      ? "spendable.forecast.build"
      : stage === "engine"
        ? "spendable.engine.calculate"
        : "spendable.serialize";
}

function queryCodeForStage(stage: SpendableStage): SpendableQueryCode {
  return SPENDABLE_QUERY_CODES[stage];
}

function eventName(
  operation: SpendableOperation,
  outcome: SpendableOutcome,
): string {
  return `spendable_${operation.replaceAll(".", "_")}_${outcome}`;
}

function safeErrorCode(value: unknown): SpendableErrorCode | undefined {
  if (
    typeof value !== "string" ||
    !ERROR_CODE_PATTERN.test(value) ||
    (!EXPECTED_ERROR_SET.has(value) && !TECHNICAL_ERROR_SET.has(value))
  ) {
    return undefined;
  }

  return value as SpendableErrorCode;
}

function safeTechnicalErrorCode(value: unknown): SpendableTechnicalErrorCode {
  return TECHNICAL_ERROR_SET.has(value as string)
    ? (value as SpendableTechnicalErrorCode)
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

/** Keeps bounded aggregate counters and never traverses rows or timelines. */
export function sanitizeSpendableCounts(
  value: unknown,
): SpendableAggregateCounts | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const source = isRecord(value.counts) ? value.counts : value;
  const aliases: Record<
    keyof SpendableAggregateCounts,
    readonly string[]
  > = {
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
    forecastItemCount: [
      "forecastItemCount",
      "forecast_item_count",
      "forecastItems",
      "forecast_items",
    ],
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
    dayCount: ["dayCount", "day_count", "days"],
    periodCount: ["periodCount", "period_count", "periods"],
    pointCount: ["pointCount", "point_count", "points"],
    causalPointCount: [
      "causalPointCount",
      "causal_point_count",
      "causalPoints",
      "causal_points",
    ],
    generalAccountCount: [
      "generalAccountCount",
      "general_account_count",
      "generalAccounts",
      "general_accounts",
    ],
    reserveComponentCount: [
      "reserveComponentCount",
      "reserve_component_count",
      "reserveComponents",
      "reserve_components",
    ],
    serializedFieldCount: [
      "serializedFieldCount",
      "serialized_field_count",
      "serializedFields",
      "serialized_fields",
    ],
  };

  const result: SpendableAggregateCounts = {};
  for (const key of Object.keys(aliases) as Array<
    keyof SpendableAggregateCounts
  >) {
    const count = countValue(source, aliases[key]);
    if (count !== undefined) {
      result[key] = count;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function aggregateInput(value: Record<string, unknown>): SpendableAggregateCounts {
  return sanitizeSpendableCounts(value) ?? {};
}

function addSafeId(
  target: SpendableOperationContext,
  key: "requestId" | "userId" | "householdId",
  value: unknown,
): void {
  const safe = opaqueId(value);
  if (safe) {
    target[key] = safe;
  }
}

/**
 * Creates technical operation metadata and a request correlation ID.  It
 * never copies a result, amount, balance, source reference or payload.
 */
export function createSpendableOperation(
  operationInput: SpendableOperationInput,
  options: SpendableOperationOptions = {},
): SpendableOperationContext {
  const suppliedOperation = operationValue(operationInput);
  const suppliedStage = stageValue(operationInput);
  const operation =
    suppliedOperation ??
    (suppliedStage ? operationForStage(suppliedStage) : "spendable.read");
  const stage = stageForOperation(operation);

  let requestId = opaqueId(options.requestId ?? options.correlationId);
  if (!requestId) {
    try {
      requestId = opaqueId(generateUuidV7());
    } catch {
      requestId = undefined;
    }
  }

  const result: SpendableOperationContext = {
    operation,
    stage,
    queryCode: queryCodeForStage(stage),
    contractVersion: SPENDABLE_CONTRACT_VERSION,
    ruleVersion: SPENDABLE_RULE_VERSION,
    ...aggregateInput(options),
    scenario: scenarioValue(options.scenario),
    horizonDays: horizon(options.horizonDays),
    result: resultValue(options.result ?? options.resultState),
    bufferSource: bufferSourceValue(options.bufferSource),
    sourceKind: sourceKindValue(options.sourceKind),
    durationMs: duration(options.durationMs),
    statusCode: statusCode(options.statusCode),
  };

  addSafeId(result, "requestId", requestId);
  addSafeId(result, "userId", options.userId);
  addSafeId(result, "householdId", options.householdId);
  return result;
}

/** Canonical operation/use-case identifier for service adapters. */
export function spendableUseCaseName(
  operation: SpendableOperationInput,
): SpendableOperation {
  return operationValue(operation)
    ?? operationForStage(stageValue(operation) ?? "read");
}

export function spendableEventName(
  operation: SpendableOperationInput,
  outcome: SpendableOutcome,
): string {
  return eventName(
    operationValue(operation) ??
      operationForStage(stageValue(operation) ?? "read"),
    outcome,
  );
}

function optionalLogFields(
  value: Record<string, unknown>,
  result: SpendableLog,
): boolean {
  const addId = (key: "requestId" | "userId" | "householdId") => {
    const id = opaqueId(value[key]);
    if (id) {
      result[key] = id;
    }
  };

  addId("requestId");
  addId("userId");
  addId("householdId");

  const suppliedContract = value.contractVersion;
  if (
    suppliedContract !== undefined &&
    suppliedContract !== SPENDABLE_CONTRACT_VERSION
  ) {
    return false;
  }
  const suppliedRule = value.ruleVersion;
  if (suppliedRule !== undefined && suppliedRule !== SPENDABLE_RULE_VERSION) {
    return false;
  }
  result.contractVersion = SPENDABLE_CONTRACT_VERSION;
  result.ruleVersion = SPENDABLE_RULE_VERSION;

  const scenario = scenarioValue(value.scenario);
  if (value.scenario !== undefined && !scenario) {
    return false;
  }
  if (scenario) {
    result.scenario = scenario;
  }

  const horizonDays = horizon(value.horizonDays);
  if (value.horizonDays !== undefined && horizonDays === undefined) {
    return false;
  }
  if (horizonDays !== undefined) {
    result.horizonDays = horizonDays;
  }

  const spendableResult = resultValue(value.result ?? value.resultState);
  if (
    (value.result !== undefined || value.resultState !== undefined) &&
    !spendableResult
  ) {
    return false;
  }
  if (spendableResult) {
    result.result = spendableResult;
  }

  const bufferSource = bufferSourceValue(value.bufferSource);
  if (value.bufferSource !== undefined && !bufferSource) {
    return false;
  }
  if (bufferSource) {
    result.bufferSource = bufferSource;
  }

  const sourceKind = sourceKindValue(value.sourceKind);
  if (value.sourceKind !== undefined && !sourceKind) {
    return false;
  }
  if (sourceKind) {
    result.sourceKind = sourceKind;
  }

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

  if (typeof value.slowQuery === "boolean") {
    result.slowQuery = value.slowQuery;
  }

  const threshold = finiteInteger(
    value.slowQueryThresholdMs,
    MAX_SPENDABLE_SLOW_QUERY_THRESHOLD_MS,
  );
  if (threshold !== undefined) {
    result.slowQueryThresholdMs = threshold;
  }

  const queryBudget = finiteInteger(
    value.queryBudgetMs,
    MAX_SPENDABLE_QUERY_BUDGET_MS,
  );
  if (queryBudget !== undefined) {
    result.queryBudgetMs = queryBudget;
  }

  if (typeof value.budgetExceeded === "boolean") {
    result.budgetExceeded = value.budgetExceeded;
  }

  return true;
}

/**
 * Final S08 allow-list.  Names and versions are rebuilt from code-owned
 * values; amounts, balances, dates, descriptions, IDs and payloads are not
 * read or traversed.
 */
export function sanitizeSpendableLog(
  value: SpendableLogInput,
): SpendableLog | undefined {
  try {
    const suppliedOperation =
      value.operation === undefined ? undefined : operationValue(value.operation);
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

    const safe: SpendableLog = {
      event: eventName(operation, outcome),
      useCase: operation,
      operation,
      stage,
      queryCode: queryCodeForStage(stage),
      contractVersion: SPENDABLE_CONTRACT_VERSION,
      ruleVersion: SPENDABLE_RULE_VERSION,
      outcome,
      ...aggregateInput(value),
    };

    return optionalLogFields(value, safe) ? safe : undefined;
  } catch {
    return undefined;
  }
}

function primaryContext(
  operation: SpendableOperationContext,
  outcome: SpendableOutcome,
  options: SpendableCompletionOptions = {},
): SpendableLog | undefined {
  return sanitizeSpendableLog({
    ...operation,
    ...options,
    operation: operation.operation,
    stage: operation.stage,
    outcome,
  });
}

/** Converts only S08 technical metadata to the shared Sentry context shape. */
export function toSpendableObservabilityContext(
  operation: SpendableOperationContext,
  outcome: SpendableOutcome = "unexpected_error",
  options: SpendableCompletionOptions = {},
): ObservabilityContext {
  const safe = primaryContext(operation, outcome, options);
  const fallbackOperation =
    operationValue(operation.operation) ?? "spendable.read";
  const fallbackStage = stageForOperation(fallbackOperation);

  return {
    event: safe?.event ?? eventName(fallbackOperation, outcome),
    useCase: safe?.useCase ?? fallbackOperation,
    operation: fallbackOperation,
    entityType: "spendable",
    requestId: safe?.requestId,
    userId: safe?.userId,
    householdId: safe?.householdId,
    durationMs: safe?.durationMs,
    statusCode: safe?.statusCode,
    stage: safe?.stage ?? fallbackStage,
    errorCode: safe?.errorCode,
    spendableStage: safe?.stage ?? fallbackStage,
    spendableQueryCode: safe?.queryCode ?? queryCodeForStage(fallbackStage),
    spendableContractVersion:
      safe?.contractVersion ?? SPENDABLE_CONTRACT_VERSION,
    spendableRuleVersion: safe?.ruleVersion ?? SPENDABLE_RULE_VERSION,
    spendableScenario: safe?.scenario,
    spendableHorizonDays: safe?.horizonDays,
    spendableResult: safe?.result,
    spendableBufferSource: safe?.bufferSource,
    spendableSourceKind: safe?.sourceKind,
    spendableSourceCount: safe?.sourceCount,
    spendableRecurringCount: safe?.recurringCount,
    spendablePlannedEventCount: safe?.plannedEventCount,
    spendableInstallmentCount: safe?.installmentCount,
    spendableRealizedEventCount: safe?.realizedEventCount,
    spendableCancelledCount: safe?.cancelledCount,
    spendableItemCount: safe?.itemCount,
    spendableForecastItemCount: safe?.forecastItemCount,
    spendableProjectedItemCount: safe?.projectedItemCount,
    spendableRealizedItemCount: safe?.realizedItemCount,
    spendableDayCount: safe?.dayCount,
    spendablePeriodCount: safe?.periodCount,
    spendablePointCount: safe?.pointCount,
    spendableCausalPointCount: safe?.causalPointCount,
    spendableGeneralAccountCount: safe?.generalAccountCount,
    spendableReserveComponentCount: safe?.reserveComponentCount,
    spendableSerializedFieldCount: safe?.serializedFieldCount,
    spendableQueryBudgetMs: safe?.queryBudgetMs,
    spendableSlowQuery: safe?.slowQuery,
    spendableBudgetExceeded: safe?.budgetExceeded,
  };
}

/** Adds a technical breadcrumb through the same allow-list as Sentry. */
export function addSpendableBreadcrumb(
  operation: SpendableOperationContext,
  outcome: SpendableOutcome,
  options: SpendableCompletionOptions = {},
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
      spendable_stage: safe.stage,
      spendable_query_code: safe.queryCode,
      spendable_contract_version: safe.contractVersion,
      spendable_rule_version: safe.ruleVersion,
      spendable_scenario: safe.scenario,
      spendable_horizon_days: safe.horizonDays,
      spendable_result: safe.result,
      spendable_buffer_source: safe.bufferSource,
      spendable_source_kind: safe.sourceKind,
      outcome: safe.outcome,
      request_id: safe.requestId,
      user_id: safe.userId,
      household_id: safe.householdId,
      duration_ms: safe.durationMs,
      status_code: safe.statusCode,
      error_code: safe.errorCode,
      spendable_source_count: safe.sourceCount,
      spendable_recurring_count: safe.recurringCount,
      spendable_planned_event_count: safe.plannedEventCount,
      spendable_installment_count: safe.installmentCount,
      spendable_realized_event_count: safe.realizedEventCount,
      spendable_cancelled_count: safe.cancelledCount,
      spendable_item_count: safe.itemCount,
      spendable_forecast_item_count: safe.forecastItemCount,
      spendable_projected_item_count: safe.projectedItemCount,
      spendable_realized_item_count: safe.realizedItemCount,
      spendable_day_count: safe.dayCount,
      spendable_period_count: safe.periodCount,
      spendable_point_count: safe.pointCount,
      spendable_causal_point_count: safe.causalPointCount,
      spendable_general_account_count: safe.generalAccountCount,
      spendable_reserve_component_count: safe.reserveComponentCount,
      spendable_serialized_field_count: safe.serializedFieldCount,
      spendable_query_budget_ms: safe.queryBudgetMs,
      spendable_slow_query: safe.slowQuery,
      spendable_budget_exceeded: safe.budgetExceeded,
    },
  });
}

function emitRecord(
  safe: SpendableLog,
  hooks: SpendableObservabilityHooks = {},
  level: "info" | "warn" | "error" =
    safe.outcome === "unexpected_error" ? "error" : "info",
): void {
  try {
    addSpendableBreadcrumb(safe, safe.outcome, safe);
  } catch {
    // Observability is best effort and never changes the spendable response.
  }

  try {
    hooks.onRecord?.(safe);
    hooks.onMetric?.(safe);
  } catch {
    // Metrics callbacks must never affect a read or calculation.
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

/** Emits a completed allow-listed S08 record. */
export function logSpendableOperation(
  operation: SpendableOperationContext,
  outcome: SpendableOutcome,
  options: SpendableCompletionOptions = {},
): SpendableLog | undefined {
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

  // Result errors expose only their stable code; message/stack/payload are
  // intentionally never inspected at this boundary.
  return isRecord(error.error) ? error.error.code : undefined;
}

/** Returns a known validation/auth/configuration code without reading text. */
export function expectedSpendableErrorCode(
  error: unknown,
): SpendableExpectedErrorCode | undefined {
  if (error instanceof FinancialContextError) {
    return EXPECTED_ERROR_SET.has(error.code)
      ? (error.code as SpendableExpectedErrorCode)
      : undefined;
  }

  const code = codeFromError(error);
  return typeof code === "string" && EXPECTED_ERROR_SET.has(code)
    ? (code as SpendableExpectedErrorCode)
    : undefined;
}

/** Classifies only the closed expected vocabulary; all other errors are technical. */
export function classifySpendableError(
  error: unknown,
): SpendableErrorClassification {
  const expectedCode = expectedSpendableErrorCode(error);
  if (expectedCode) {
    return { outcome: "expected_error", errorCode: expectedCode };
  }

  return {
    outcome: "unexpected_error",
    errorCode: safeTechnicalErrorCode(codeFromError(error)),
  };
}

export function isExpectedSpendableError(error: unknown): boolean {
  return expectedSpendableErrorCode(error) !== undefined;
}

function safeSpendableField(
  value: unknown,
): "asOf" | "horizon" | "scenario" | "buffer" | null {
  if (typeof value !== "string" || !SAFE_FIELD_SET.has(value)) {
    return null;
  }
  return value === "horizonDays"
    ? "horizon"
    : (value as "asOf" | "horizon" | "scenario" | "buffer");
}

function fieldFromError(
  error: unknown,
): "asOf" | "horizon" | "scenario" | "buffer" | null {
  if (!isRecord(error)) {
    return null;
  }

  const direct = safeSpendableField(error.field);
  if (direct) {
    return direct;
  }
  return isRecord(error.error) ? safeSpendableField(error.error.field) : null;
}

/** Converts an error to a public code/field-only envelope. */
export function toSpendableErrorEnvelope(
  error: unknown,
): SpendableSafeErrorEnvelope {
  const classification = classifySpendableError(error);
  const code =
    classification.errorCode === "UNAUTHENTICATED" ||
    classification.errorCode === "HOUSEHOLD_MEMBERSHIP_REQUIRED" ||
    classification.errorCode === "HOUSEHOLD_SELECTION_REQUIRED" ||
    classification.errorCode === "INVALID_FINANCIAL_CONTEXT"
      ? "FINANCIAL_CONTEXT_REQUIRED"
      : classification.errorCode;
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
  operation: SpendableOperationContext,
  outcome: SpendableOutcome,
  durationMs: number,
  options: SpendableCompletionOptions,
): SpendableLog | undefined {
  return logSpendableOperation(operation, outcome, {
    ...options,
    durationMs,
    errorCode: options.errorCode,
  });
}

/**
 * Wraps read, forecast, engine and serialization boundaries. Expected Result
 * errors remain ordinary outcomes; technical exceptions are captured with a
 * sanitized context and rethrown for the HTTP boundary.
 */
export async function withSpendableObservability<T>(
  operation: SpendableOperationContext,
  work: () => Promise<T> | T,
  options: SpendableCompletionOptions = {},
): Promise<T> {
  const now = options.now ?? monotonicNow;
  const startedAt = now();

  try {
    const value = await work();
    const failure = resultFailure(value);
    if (failure.failed) {
      const classification = classifySpendableError(failure.error);
      const durationMs = elapsedMs(startedAt, now);
      if (classification.outcome === "expected_error") {
        completionLog(operation, classification.outcome, durationMs, {
          ...options,
          errorCode: classification.errorCode,
        });
      } else {
        reportSpendableUnexpectedError(failure.error, operation, durationMs, options);
      }
      return value;
    }

    completionLog(operation, "success", elapsedMs(startedAt, now), options);
    return value;
  } catch (error) {
    const durationMs = elapsedMs(startedAt, now);
    const classification = classifySpendableError(error);
    if (classification.outcome === "expected_error") {
      completionLog(operation, classification.outcome, durationMs, {
        ...options,
        errorCode: classification.errorCode,
      });
      throw error;
    }

    reportSpendableUnexpectedError(error, operation, durationMs, options);
    throw error;
  }
}

function safeThreshold(value: unknown, maximum: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(maximum, Math.max(0, Math.round(value)));
  }
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    return safeThreshold(Number(value.trim()), maximum);
  }
  return undefined;
}

/** Reads the bounded S08 slow-operation threshold. */
export function getSpendableSlowQueryThresholdMs(value?: unknown): number {
  return (
    safeThreshold(value, MAX_SPENDABLE_SLOW_QUERY_THRESHOLD_MS) ??
    safeThreshold(
      typeof process !== "undefined"
        ? process.env.SPENDABLE_SLOW_QUERY_THRESHOLD_MS ??
          process.env.S08_SLOW_QUERY_THRESHOLD_MS ??
          process.env.S08_SPENDABLE_SLOW_QUERY_THRESHOLD_MS
        : undefined,
      MAX_SPENDABLE_SLOW_QUERY_THRESHOLD_MS,
    ) ?? DEFAULT_SPENDABLE_SLOW_QUERY_THRESHOLD_MS
  );
}

/** Reads the bounded S08 query budget. */
export function getSpendableQueryBudgetMs(value?: unknown): number {
  return (
    safeThreshold(value, MAX_SPENDABLE_QUERY_BUDGET_MS) ??
    safeThreshold(
      typeof process !== "undefined"
        ? process.env.SPENDABLE_QUERY_BUDGET_MS ??
          process.env.S08_QUERY_BUDGET_MS ??
          process.env.S08_SPENDABLE_QUERY_BUDGET_MS
        : undefined,
      MAX_SPENDABLE_QUERY_BUDGET_MS,
    ) ?? DEFAULT_SPENDABLE_QUERY_BUDGET_MS
  );
}

/** Reports expected failures and captures only unexpected technical failures. */
export function reportSpendableUnexpectedError(
  error: unknown,
  operation: SpendableOperationContext,
  durationOrOptions: number | SpendableCompletionOptions = 0,
  options: SpendableCompletionOptions = {},
): SpendableErrorClassification {
  const durationMs =
    typeof durationOrOptions === "number"
      ? durationOrOptions
      : durationOrOptions.durationMs ?? 0;
  const completionOptions =
    typeof durationOrOptions === "number" ? options : durationOrOptions;
  const classification = classifySpendableError(error);
  const code =
    classification.outcome === "expected_error"
      ? classification.errorCode
      : safeTechnicalErrorCode(
          completionOptions.technicalErrorCode ?? codeFromError(error),
        );
  const safeOptions: SpendableCompletionOptions = {
    ...completionOptions,
    durationMs,
    errorCode: code,
  };

  completionLog(operation, classification.outcome, durationMs, safeOptions);

  if (classification.outcome === "unexpected_error") {
    try {
      captureServerException(
        error,
        toSpendableObservabilityContext(operation, "unexpected_error", safeOptions),
      );
    } catch {
      // Sentry is best effort and never changes the response path.
    }
  }

  return { outcome: classification.outcome, errorCode: code };
}

/** Measures one S08 operation without accepting SQL or a result payload. */
export async function measureSpendableQuery<T>(
  operation: SpendableOperationContext,
  work: () => Promise<T> | T,
  options: SpendableQueryOptions = {},
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
    const thresholdMs = getSpendableSlowQueryThresholdMs(options.thresholdMs);
    const queryBudgetMs = getSpendableQueryBudgetMs(options.queryBudgetMs);
    const budgetExceeded = durationMs >= queryBudgetMs;
    const slowQuery = durationMs >= thresholdMs || budgetExceeded;

    if (slowQuery) {
      const returnedFailure = resultFailure(returnedValue);
      const classification = failed
        ? classifySpendableError(thrownError)
        : returnedFailure.failed
          ? classifySpendableError(returnedFailure.error)
          : undefined;
      const safe = sanitizeSpendableLog({
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
          addSpendableBreadcrumb(safe, safe.outcome, safe);
        } catch {
          // Best effort only.
        }

        try {
          options.onRecord?.(safe);
          options.onMetric?.(safe);
          options.onSlowQuery?.(safe);
        } catch {
          // Metrics callbacks are never part of the operation response path.
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

/** Naming aliases keep the adapter surface discoverable to T06/T07/T09. */
export const createSpendableContext = createSpendableOperation;
export const withSpendableOperation = withSpendableObservability;
export const observeSpendable = withSpendableObservability;
export const measureSpendableStage = measureSpendableQuery;
export const observeSpendableQuery = measureSpendableQuery;
export const measureSpendableOperation = measureSpendableQuery;
export const logSpendableResult = logSpendableOperation;
export const captureSpendableUnexpectedError = reportSpendableUnexpectedError;
export const toSpendableContext = toSpendableObservabilityContext;
export const getSpendableSlowOperationThresholdMs = getSpendableSlowQueryThresholdMs;
