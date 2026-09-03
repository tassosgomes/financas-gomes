import { generateUuidV7 } from "@/lib/uuidv7";
import { FinancialContextError } from "@/modules/households/contracts";

import type { ObservabilityContext } from "./contracts";
import { addBreadcrumbSafely, captureServerException } from "./server";

/** Versioned, code-owned identifiers for the S10 observability contract. */
export const S10_OVERVIEW_CONTRACT_VERSION = "s10.v1" as const;

/** Compatibility aliases for callers using the shorter contract vocabulary. */
export const S10_CONTRACT_VERSION = S10_OVERVIEW_CONTRACT_VERSION;

/** The only operation names that may reach an S10 event or use-case field. */
export const S10_OVERVIEW_OPERATIONS = [
  "overview.read",
  "overview.aggregate",
  "overview.compose",
  "overview.render",
] as const;

export type S10OverviewOperation = (typeof S10_OVERVIEW_OPERATIONS)[number];

/** Stages are derived from operations and never accepted as free text. */
export const S10_OVERVIEW_STAGES = [
  "read",
  "aggregate",
  "compose",
  "render",
] as const;

export type S10OverviewStage = (typeof S10_OVERVIEW_STAGES)[number];

/** Result categories distinguish absence, partial degradation and failure. */
export const S10_OVERVIEW_RESULTS = [
  "AVAILABLE",
  "EMPTY",
  "PARTIAL",
  "UNAVAILABLE",
] as const;

export type S10OverviewResult = (typeof S10_OVERVIEW_RESULTS)[number];

export const S10_OVERVIEW_OUTCOMES = [
  "success",
  "expected_error",
  "unexpected_error",
] as const;

export type S10OverviewOutcome = (typeof S10_OVERVIEW_OUTCOMES)[number];

/** Aggregate counters only; rows, references, values and payloads are absent. */
export interface S10OverviewAggregateCounts {
  groupCount?: number;
  itemCount?: number;
  boxCount?: number;
  commitmentCount?: number;
  alertCount?: number;
  originCount?: number;
  readyBlockCount?: number;
  errorBlockCount?: number;
  emptyBlockCount?: number;
}

export interface S10OverviewOperationOptions extends S10OverviewAggregateCounts {
  requestId?: unknown;
  /** Alias accepted by transport boundaries and emitted as requestId. */
  correlationId?: unknown;
  userId?: unknown;
  householdId?: unknown;
  result?: unknown;
  contractVersion?: unknown;
  durationMs?: unknown;
  statusCode?: unknown;
  [key: string]: unknown;
}

export interface S10OverviewOperationContext extends S10OverviewAggregateCounts {
  operation: S10OverviewOperation;
  stage: S10OverviewStage;
  contractVersion: typeof S10_OVERVIEW_CONTRACT_VERSION;
  requestId?: string;
  result?: S10OverviewResult;
  durationMs?: number;
  statusCode?: number;
}

export interface S10OverviewLog extends S10OverviewOperationContext {
  event: string;
  useCase: S10OverviewOperation;
  outcome: S10OverviewOutcome;
  errorCode?: S10OverviewErrorCode;
  slowQuery?: boolean;
  slowQueryThresholdMs?: number;
  queryBudgetMs?: number;
  budgetExceeded?: boolean;
}

export type S10OverviewLogInput = Omit<
  Partial<S10OverviewLog>,
  | "event"
  | "useCase"
  | "operation"
  | "stage"
  | "contractVersion"
  | "result"
  | "errorCode"
> &
  S10OverviewOperationOptions & {
    event?: unknown;
    useCase?: unknown;
    operation?: unknown;
    stage?: unknown;
    contractVersion?: unknown;
    result?: unknown;
    errorCode?: unknown;
  };

export interface S10OverviewObservabilityHooks {
  onRecord?: (record: S10OverviewLog) => void;
  onMetric?: (record: S10OverviewLog) => void;
  onSlowQuery?: (record: S10OverviewLog) => void;
}

/**
 * Safe categories/counters that a boundary may derive from its own result.
 * The callback is deliberately separate from the event allow-list: its output
 * is sanitized again before it reaches a log, breadcrumb, metric or Sentry.
 */
export interface S10OverviewResultSummary extends S10OverviewAggregateCounts {
  result?: unknown;
}

export type S10OverviewResultSummarizer =
  (value: unknown) => S10OverviewResultSummary;

export interface S10OverviewCompletionOptions
  extends S10OverviewAggregateCounts,
    S10OverviewObservabilityHooks {
  durationMs?: number;
  errorCode?: string;
  technicalErrorCode?: string;
  result?: unknown;
  queryBudgetMs?: number;
  slowQueryThresholdMs?: number;
  budgetExceeded?: boolean;
  now?: () => number;
  /** Derives categories/counts without exposing the boundary result. */
  summarizeResult?: S10OverviewResultSummarizer;
}

export interface S10OverviewQueryOptions
  extends S10OverviewAggregateCounts,
    S10OverviewObservabilityHooks {
  thresholdMs?: number;
  queryBudgetMs?: number;
  technicalErrorCode?: string;
  now?: () => number;
  /** Derives categories/counts without exposing the boundary result. */
  summarizeResult?: S10OverviewResultSummarizer;
}

export type S10OverviewBoundaryOptions =
  S10OverviewCompletionOptions & S10OverviewQueryOptions & Record<string, unknown>;

export const S10_OVERVIEW_EXPECTED_ERROR_CODES = [
  "UNAUTHENTICATED",
  "HOUSEHOLD_MEMBERSHIP_REQUIRED",
  "HOUSEHOLD_SELECTION_REQUIRED",
  "INVALID_FINANCIAL_CONTEXT",
  "FINANCIAL_CONTEXT_REQUIRED",
  "INVALID_DATE",
  "INVALID_DATE_RANGE",
  "INVALID_SCENARIO",
  "INVALID_HORIZON",
  "HORIZON_OUT_OF_RANGE",
  "INVALID_QUERY",
  "INVALID_CURSOR",
  "CONFLICT",
] as const;

export type S10OverviewExpectedErrorCode =
  (typeof S10_OVERVIEW_EXPECTED_ERROR_CODES)[number];

export const S10_OVERVIEW_TECHNICAL_ERROR_CODES = [
  "OVERVIEW_QUERY_FAILED",
  "OVERVIEW_PARTIAL_FAILURE",
  "OVERVIEW_AGGREGATION_FAILED",
  "OVERVIEW_COMPOSE_FAILED",
  "OVERVIEW_RENDER_FAILED",
  "OVERVIEW_QUERY_TIMEOUT",
  "QUERY_FAILED",
  "UNEXPECTED_ERROR",
] as const;

export type S10OverviewTechnicalErrorCode =
  (typeof S10_OVERVIEW_TECHNICAL_ERROR_CODES)[number];

export type S10OverviewErrorCode =
  | S10OverviewExpectedErrorCode
  | S10OverviewTechnicalErrorCode;

export interface S10OverviewErrorClassification {
  outcome: "expected_error" | "unexpected_error";
  errorCode: S10OverviewErrorCode;
}

export interface S10OverviewSafeErrorEnvelope {
  ok: false;
  error: { code: S10OverviewErrorCode; field?: string | null };
}

/** ADR-013 slow-query threshold for overview blocks (T04). */
export const OVERVIEW_SLOW_QUERY_THRESHOLD_MS = 500;
/** ADR-013 per-block timeout exported for T03/T06 composition. */
export const OVERVIEW_BLOCK_TIMEOUT_MS = 2_500;

export const DEFAULT_OVERVIEW_SLOW_QUERY_THRESHOLD_MS = OVERVIEW_SLOW_QUERY_THRESHOLD_MS;
export const MAX_OVERVIEW_SLOW_QUERY_THRESHOLD_MS = 60_000;
export const DEFAULT_OVERVIEW_QUERY_BUDGET_MS = OVERVIEW_BLOCK_TIMEOUT_MS;
export const MAX_OVERVIEW_QUERY_BUDGET_MS = 60_000;
export const MAX_OVERVIEW_AGGREGATE_COUNT = 1_000_000_000;

const OPERATION_ALIASES: Readonly<Record<string, S10OverviewOperation>> = {
  "overview.read": "overview.read",
  "overview.get": "overview.read",
  "overview.query": "overview.read",
  read: "overview.read",
  query: "overview.read",
  "overview.aggregate": "overview.aggregate",
  "overview.aggregation": "overview.aggregate",
  aggregate: "overview.aggregate",
  aggregation: "overview.aggregate",
  "overview.compose": "overview.compose",
  "overview.composition": "overview.compose",
  compose: "overview.compose",
  composition: "overview.compose",
  "overview.render": "overview.render",
  "overview.serialization": "overview.render",
  render: "overview.render",
  serialization: "overview.render",
  serialize: "overview.render",
};

const OPERATION_SET = new Set<string>(S10_OVERVIEW_OPERATIONS);
const STAGE_SET = new Set<string>(S10_OVERVIEW_STAGES);
const OUTCOME_SET = new Set<string>(S10_OVERVIEW_OUTCOMES);
const RESULT_ALIASES: Readonly<Record<string, S10OverviewResult>> = {
  AVAILABLE: "AVAILABLE",
  available: "AVAILABLE",
  READY: "AVAILABLE",
  ready: "AVAILABLE",
  EMPTY: "EMPTY",
  empty: "EMPTY",
  NO_DATA: "EMPTY",
  no_data: "EMPTY",
  PARTIAL: "PARTIAL",
  partial: "PARTIAL",
  DEGRADED: "PARTIAL",
  degraded: "PARTIAL",
  UNAVAILABLE: "UNAVAILABLE",
  unavailable: "UNAVAILABLE",
  ERROR: "UNAVAILABLE",
  error: "UNAVAILABLE",
};
const RESULT_SET = new Set<string>(S10_OVERVIEW_RESULTS);
const EXPECTED_ERROR_SET = new Set<string>(S10_OVERVIEW_EXPECTED_ERROR_CODES);
const TECHNICAL_ERROR_SET = new Set<string>(S10_OVERVIEW_TECHNICAL_ERROR_CODES);
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const MAX_DURATION_MS = 86_400_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function opaqueId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized && OPAQUE_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function boundedInteger(value: unknown, maximum = MAX_OVERVIEW_AGGREGATE_COUNT): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(maximum, Math.max(0, Math.round(value)));
}

function duration(value: unknown): number | undefined {
  return boundedInteger(value, MAX_DURATION_MS);
}

function statusCode(value: unknown): number | undefined {
  return boundedInteger(value, 999);
}

function operationValue(value: unknown): S10OverviewOperation | undefined {
  if (typeof value !== "string") return undefined;
  const operation = OPERATION_ALIASES[value];
  return operation && OPERATION_SET.has(operation) ? operation : undefined;
}

function stageForOperation(operation: S10OverviewOperation): S10OverviewStage {
  if (operation === "overview.read") return "read";
  if (operation === "overview.aggregate") return "aggregate";
  if (operation === "overview.compose") return "compose";
  return "render";
}

function operationForStage(stage: S10OverviewStage): S10OverviewOperation {
  if (stage === "read") return "overview.read";
  if (stage === "aggregate") return "overview.aggregate";
  if (stage === "compose") return "overview.compose";
  return "overview.render";
}

function stageValue(value: unknown): S10OverviewStage | undefined {
  if (typeof value !== "string" || !STAGE_SET.has(value)) return undefined;
  return value as S10OverviewStage;
}

function outcomeValue(value: unknown): S10OverviewOutcome | undefined {
  if (typeof value !== "string" || !OUTCOME_SET.has(value)) return undefined;
  return value as S10OverviewOutcome;
}

function resultValue(value: unknown): S10OverviewResult | undefined {
  if (typeof value !== "string") return undefined;
  const result = RESULT_ALIASES[value];
  return result && RESULT_SET.has(result) ? result : undefined;
}

function errorCodeValue(value: unknown): S10OverviewErrorCode | undefined {
  if (
    typeof value !== "string" ||
    !ERROR_CODE_PATTERN.test(value) ||
    (!EXPECTED_ERROR_SET.has(value) && !TECHNICAL_ERROR_SET.has(value))
  ) {
    return undefined;
  }
  return value as S10OverviewErrorCode;
}

function technicalErrorCode(value: unknown): S10OverviewTechnicalErrorCode {
  return typeof value === "string" && TECHNICAL_ERROR_SET.has(value)
    ? (value as S10OverviewTechnicalErrorCode)
    : "UNEXPECTED_ERROR";
}

const COUNT_ALIASES: Readonly<Record<keyof S10OverviewAggregateCounts, readonly string[]>> = {
  groupCount: ["groupCount", "group_count", "groups"],
  itemCount: ["itemCount", "item_count", "items"],
  boxCount: ["boxCount", "box_count", "boxes", "caixinhaCount", "caixinha_count"],
  commitmentCount: ["commitmentCount", "commitment_count", "commitments"],
  alertCount: ["alertCount", "alert_count", "alerts"],
  originCount: ["originCount", "origin_count", "origins"],
  readyBlockCount: ["readyBlockCount", "ready_block_count", "readyBlocks"],
  errorBlockCount: ["errorBlockCount", "error_block_count", "errorBlocks"],
  emptyBlockCount: ["emptyBlockCount", "empty_block_count", "emptyBlocks"],
};

function countFrom(source: Record<string, unknown>, aliases: readonly string[]): number | undefined {
  for (const alias of aliases) {
    const value = boundedInteger(source[alias]);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Keeps only bounded scalar aggregate counters; it never traverses rows. */
export function sanitizeOverviewCounts(value: unknown): S10OverviewAggregateCounts | undefined {
  if (!isRecord(value)) return undefined;
  const source = isRecord(value.counts) ? value.counts : value;
  const result: S10OverviewAggregateCounts = {};
  for (const key of Object.keys(COUNT_ALIASES) as Array<keyof S10OverviewAggregateCounts>) {
    const count = countFrom(source, COUNT_ALIASES[key]);
    if (count !== undefined) result[key] = count;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function aggregateInput(value: Record<string, unknown>): S10OverviewAggregateCounts {
  return sanitizeOverviewCounts(value) ?? {};
}

function eventName(operation: S10OverviewOperation, outcome: S10OverviewOutcome): string {
  return `s10_${operation.replaceAll(".", "_")}_${outcome}`;
}

function addRequestId(target: { requestId?: string }, value: unknown): void {
  const safe = opaqueId(value);
  if (safe) target.requestId = safe;
}

/** Creates operation metadata and generates request correlation when absent. */
export function createOverviewOperation(
  operationInput: S10OverviewOperation | S10OverviewStage | string,
  options: S10OverviewOperationOptions = {},
): S10OverviewOperationContext {
  const operation = operationValue(operationInput) ?? "overview.read";
  let requestId = opaqueId(options.requestId ?? options.correlationId);
  if (!requestId) {
    try {
      requestId = opaqueId(generateUuidV7());
    } catch {
      requestId = undefined;
    }
  }

  const result: S10OverviewOperationContext = {
    operation,
    stage: stageForOperation(operation),
    contractVersion: S10_OVERVIEW_CONTRACT_VERSION,
    ...aggregateInput(options),
  };
  addRequestId(result, requestId);

  const resultState = resultValue(options.result);
  if (resultState) result.result = resultState;
  const durationMs = duration(options.durationMs);
  if (durationMs !== undefined) result.durationMs = durationMs;
  const status = statusCode(options.statusCode);
  if (status !== undefined) result.statusCode = status;
  return result;
}

export const createS10Operation = createOverviewOperation;
export const createS10OverviewContext = createOverviewOperation;

/** Final S10 allow-list: caller event names and unknown fields are rebuilt/dropped. */
export function sanitizeOverviewLog(value: S10OverviewLogInput): S10OverviewLog | undefined {
  try {
    const suppliedOperation = value.operation === undefined
      ? undefined
      : operationValue(value.operation);
    const suppliedStage = value.stage === undefined ? undefined : stageValue(value.stage);
    const outcome = outcomeValue(value.outcome);
    if ((value.operation !== undefined && !suppliedOperation) ||
        (value.stage !== undefined && !suppliedStage) || !outcome) {
      return undefined;
    }
    const operation = suppliedOperation ?? (suppliedStage ? operationForStage(suppliedStage) : undefined);
    if (!operation) return undefined;
    const stage = stageForOperation(operation);
    if (suppliedStage && suppliedStage !== stage) return undefined;
    if (value.contractVersion !== undefined && value.contractVersion !== S10_OVERVIEW_CONTRACT_VERSION) return undefined;

    const safe: S10OverviewLog = {
      event: eventName(operation, outcome),
      useCase: operation,
      operation,
      stage,
      contractVersion: S10_OVERVIEW_CONTRACT_VERSION,
      outcome,
      ...aggregateInput(value),
    };
    addRequestId(safe, value.requestId ?? value.correlationId);

    const result = resultValue(value.result);
    if (value.result !== undefined && !result) return undefined;
    if (result) safe.result = result;
    const durationMs = duration(value.durationMs);
    if (durationMs !== undefined) safe.durationMs = durationMs;
    const status = statusCode(value.statusCode);
    if (status !== undefined) safe.statusCode = status;
    const errorCode = errorCodeValue(value.errorCode);
    if (value.errorCode !== undefined && !errorCode) return undefined;
    if (errorCode) safe.errorCode = errorCode;
    if (typeof value.slowQuery === "boolean") safe.slowQuery = value.slowQuery;
    const threshold = duration(value.slowQueryThresholdMs);
    if (threshold !== undefined) safe.slowQueryThresholdMs = threshold;
    const budget = duration(value.queryBudgetMs);
    if (budget !== undefined) safe.queryBudgetMs = budget;
    if (typeof value.budgetExceeded === "boolean") safe.budgetExceeded = value.budgetExceeded;
    return safe;
  } catch {
    return undefined;
  }
}

export const sanitizeS10Log = sanitizeOverviewLog;

function primaryContext(
  operation: S10OverviewOperationContext,
  outcome: S10OverviewOutcome,
  options: S10OverviewCompletionOptions = {},
): S10OverviewLog | undefined {
  return sanitizeOverviewLog({
    ...operation,
    ...options,
    operation: operation.operation,
    stage: operation.stage,
    outcome,
  });
}

/** Converts S10 metadata to the shared context shape without raw fields. */
export function toOverviewObservabilityContext(
  operation: S10OverviewOperationContext,
  outcome: S10OverviewOutcome = "unexpected_error",
  options: S10OverviewCompletionOptions = {},
): ObservabilityContext & Record<string, unknown> {
  const safe = primaryContext(operation, outcome, options);
  return {
    event: safe?.event ?? eventName(operation.operation, outcome),
    useCase: safe?.useCase ?? operation.operation,
    operation: safe?.operation ?? operation.operation,
    entityType: "overview",
    requestId: safe?.requestId,
    durationMs: safe?.durationMs,
    statusCode: safe?.statusCode,
    stage: safe?.stage ?? operation.stage,
    errorCode: safe?.errorCode,
    s10Operation: safe?.operation,
    s10Stage: safe?.stage,
    s10ContractVersion: safe?.contractVersion ?? S10_OVERVIEW_CONTRACT_VERSION,
    s10Outcome: safe?.outcome,
    s10Result: safe?.result,
    ...Object.fromEntries(
      Object.entries(safe ?? {}).filter(([key]) =>
        key.endsWith("Count") ||
        key === "slowQuery" ||
        key === "slowQueryThresholdMs" ||
        key === "queryBudgetMs" ||
        key === "budgetExceeded",
      ),
    ),
  };
}

function breadcrumbData(safe: S10OverviewLog): Record<string, unknown> {
  return {
    operation: safe.operation,
    stage: safe.stage,
    s10_operation: safe.operation,
    s10_stage: safe.stage,
    s10_contract_version: safe.contractVersion,
    outcome: safe.outcome,
    request_id: safe.requestId,
    error_code: safe.errorCode,
    result: safe.result,
    duration_ms: safe.durationMs,
    status_code: safe.statusCode,
    slow_query: safe.slowQuery,
    slow_query_threshold_ms: safe.slowQueryThresholdMs,
    query_budget_ms: safe.queryBudgetMs,
    budget_exceeded: safe.budgetExceeded,
    ...Object.fromEntries(
      Object.entries(safe).filter(([key]) => key.endsWith("Count")),
    ),
  };
}

export function addOverviewBreadcrumb(
  operation: S10OverviewOperationContext,
  outcome: S10OverviewOutcome,
  options: S10OverviewCompletionOptions = {},
): void {
  const safe = primaryContext(operation, outcome, options);
  if (!safe) return;
  addBreadcrumbSafely({
    type: "info",
    category: safe.useCase,
    data: breadcrumbData(safe),
  });
}

function emitRecord(safe: S10OverviewLog, hooks: S10OverviewObservabilityHooks = {}): void {
  try { addOverviewBreadcrumb(safe, safe.outcome, safe); } catch { /* best effort */ }
  try { hooks.onRecord?.(safe); hooks.onMetric?.(safe); } catch { /* non-blocking */ }
  try {
    const serialized = JSON.stringify(safe);
    if (safe.outcome === "unexpected_error") console.error(serialized);
    else console.info(serialized);
  } catch { /* non-blocking */ }
}

export function logOverviewOperation(
  operation: S10OverviewOperationContext,
  outcome: S10OverviewOutcome,
  options: S10OverviewCompletionOptions = {},
): S10OverviewLog | undefined {
  const safe = primaryContext(operation, outcome, options);
  if (!safe) return undefined;
  emitRecord(safe, options);
  return safe;
}

export const logS10Operation = logOverviewOperation;

function codeFromError(error: unknown): unknown {
  if (!isRecord(error)) return undefined;
  if (typeof error.code === "string") return error.code;
  return isRecord(error.error) ? error.error.code : undefined;
}

export function expectedOverviewErrorCode(error: unknown): S10OverviewExpectedErrorCode | undefined {
  if (error instanceof FinancialContextError && EXPECTED_ERROR_SET.has(error.code)) {
    return error.code as S10OverviewExpectedErrorCode;
  }
  const code = codeFromError(error);
  return typeof code === "string" && EXPECTED_ERROR_SET.has(code)
    ? (code as S10OverviewExpectedErrorCode)
    : undefined;
}

export function classifyOverviewError(error: unknown): S10OverviewErrorClassification {
  const expected = expectedOverviewErrorCode(error);
  if (expected) return { outcome: "expected_error", errorCode: expected };
  return { outcome: "unexpected_error", errorCode: technicalErrorCode(codeFromError(error)) };
}

export const classifyS10Error = classifyOverviewError;
export function isExpectedOverviewError(error: unknown): boolean {
  return expectedOverviewErrorCode(error) !== undefined;
}

function safeOverviewField(
  value: unknown,
): "asOf" | "horizon" | "scenario" | null {
  if (typeof value !== "string") return null;
  if (value === "asOf" || value === "horizon" || value === "horizonDays" || value === "scenario") {
    return value === "horizonDays" ? "horizon" : (value as "asOf" | "horizon" | "scenario");
  }
  return null;
}

function fieldFromError(error: unknown): "asOf" | "horizon" | "scenario" | null {
  if (!isRecord(error)) return null;
  const direct = safeOverviewField(error.field);
  if (direct) return direct;
  return isRecord(error.error) ? safeOverviewField(error.error.field) : null;
}

export function toOverviewErrorEnvelope(error: unknown): S10OverviewSafeErrorEnvelope {
  const classification = classifyOverviewError(error);
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

export function reportOverviewUnexpectedError(
  error: unknown,
  operation: S10OverviewOperationContext,
  durationOrOptions: number | S10OverviewCompletionOptions = 0,
  options: S10OverviewCompletionOptions = {},
): S10OverviewErrorClassification {
  const durationMs = typeof durationOrOptions === "number"
    ? durationOrOptions
    : durationOrOptions.durationMs ?? 0;
  const completionOptions = typeof durationOrOptions === "number" ? options : durationOrOptions;
  const classification = classifyOverviewError(error);
  const code = classification.outcome === "expected_error"
    ? classification.errorCode
    : technicalErrorCode(completionOptions.technicalErrorCode ?? codeFromError(error));
  const safeOptions = {
    ...completionOptions,
    durationMs,
    errorCode: code,
  };
  logOverviewOperation(operation, classification.outcome, safeOptions);
  if (classification.outcome === "unexpected_error") {
    try {
      captureServerException(
        error,
        toOverviewObservabilityContext(operation, "unexpected_error", safeOptions),
      );
    } catch { /* best effort */ }
  }
  return { outcome: classification.outcome, errorCode: code };
}

function monotonicNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt: number, now: () => number): number {
  const current = now();
  return Number.isFinite(current) ? Math.max(0, Math.round(current - startedAt)) : 0;
}

function resultFailure(value: unknown): { failed: boolean; error?: unknown } {
  return isRecord(value) && value.ok === false ? { failed: true, error: value.error } : { failed: false };
}

function summarizeResult(
  options: { summarizeResult?: S10OverviewResultSummarizer },
  value: unknown,
): S10OverviewResultSummary {
  if (typeof options.summarizeResult !== "function") return {};
  try {
    const summary = options.summarizeResult(value);
    return isRecord(summary) ? summary as S10OverviewResultSummary : {};
  } catch {
    return {};
  }
}

export async function withOverviewObservability<T>(
  operation: S10OverviewOperationContext,
  work: () => Promise<T> | T,
  options: S10OverviewCompletionOptions = {},
): Promise<T> {
  const now = options.now ?? monotonicNow;
  const startedAt = now();
  try {
    const value = await work();
    const failure = resultFailure(value);
    const durationMs = elapsedMs(startedAt, now);
    if (failure.failed) {
      reportOverviewUnexpectedError(failure.error, operation, durationMs, options);
      return value;
    }
    logOverviewOperation(operation, "success", {
      ...options,
      ...summarizeResult(options, value),
      durationMs,
    });
    return value;
  } catch (error) {
    const durationMs = elapsedMs(startedAt, now);
    const classification = classifyOverviewError(error);
    if (classification.outcome === "expected_error") {
      logOverviewOperation(operation, "expected_error", {
        ...options,
        durationMs,
        errorCode: classification.errorCode,
      });
    } else {
      reportOverviewUnexpectedError(error, operation, durationMs, options);
    }
    throw error;
  }
}

export const withS10Observability = withOverviewObservability;
export const observeS10Operation = withOverviewObservability;

function safeThreshold(value: unknown, maximum: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.min(maximum, Math.max(0, Math.round(value)));
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) return safeThreshold(Number(value.trim()), maximum);
  return undefined;
}

export function getOverviewSlowQueryThresholdMs(value?: unknown): number {
  return safeThreshold(
    value ??
      (typeof process !== "undefined"
        ? process.env.S10_SLOW_QUERY_THRESHOLD_MS ??
          process.env.OVERVIEW_SLOW_QUERY_THRESHOLD_MS
        : undefined),
    MAX_OVERVIEW_SLOW_QUERY_THRESHOLD_MS,
  ) ?? DEFAULT_OVERVIEW_SLOW_QUERY_THRESHOLD_MS;
}

export function getOverviewQueryBudgetMs(value?: unknown): number {
  return safeThreshold(
    value ??
      (typeof process !== "undefined"
        ? process.env.S10_QUERY_BUDGET_MS ??
          process.env.OVERVIEW_BLOCK_TIMEOUT_MS ??
          process.env.OVERVIEW_QUERY_BUDGET_MS
        : undefined),
    MAX_OVERVIEW_QUERY_BUDGET_MS,
  ) ?? DEFAULT_OVERVIEW_QUERY_BUDGET_MS;
}

/** Measures slow reads without accepting SQL or returned payloads. */
export async function measureOverviewQuery<T>(
  operation: S10OverviewOperationContext,
  work: () => Promise<T> | T,
  options: S10OverviewQueryOptions = {},
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
    const thresholdMs = getOverviewSlowQueryThresholdMs(options.thresholdMs);
    const queryBudgetMs = getOverviewQueryBudgetMs(options.queryBudgetMs);
    const budgetExceeded = durationMs >= queryBudgetMs;
    if (durationMs >= thresholdMs || budgetExceeded) {
      const returnedFailure = resultFailure(returnedValue);
      const classification = failed
        ? classifyOverviewError(thrownError)
        : returnedFailure.failed ? classifyOverviewError(returnedFailure.error) : undefined;
      const safe = sanitizeOverviewLog({
        ...operation,
        ...options,
        ...(!failed && !returnedFailure.failed
          ? summarizeResult(options, returnedValue)
          : {}),
        operation: operation.operation,
        stage: operation.stage,
        outcome: classification?.outcome ?? "success",
        errorCode: classification?.outcome === "expected_error"
          ? classification.errorCode
          : classification?.outcome === "unexpected_error"
            ? technicalErrorCode(options.technicalErrorCode)
            : undefined,
        durationMs,
        slowQuery: true,
        slowQueryThresholdMs: thresholdMs,
        queryBudgetMs,
        budgetExceeded,
      });
      if (safe) {
        try { addOverviewBreadcrumb(safe, safe.outcome, safe); } catch { /* best effort */ }
        try { options.onRecord?.(safe); options.onMetric?.(safe); options.onSlowQuery?.(safe); } catch { /* non-blocking */ }
        try { console.warn(JSON.stringify(safe)); } catch { /* non-blocking */ }
      }
    }
  }
}

export const observeOverviewQuery = measureOverviewQuery;
export const measureS10Query = measureOverviewQuery;
export const measureOverviewOperation = measureOverviewQuery;
export const getS10SlowOperationThresholdMs = getOverviewSlowQueryThresholdMs;
export const getS10SlowQueryThresholdMs = getOverviewSlowQueryThresholdMs;
export const getS10QueryBudgetMs = getOverviewQueryBudgetMs;
