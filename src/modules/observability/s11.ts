import { generateUuidV7 } from "@/lib/uuidv7";
import { FinancialContextError } from "@/modules/households/contracts";

import type { ObservabilityContext } from "./contracts";
import { addBreadcrumbSafely, captureServerException } from "./server";

/** Versioned, code-owned identifiers for the S11 observability contract. */
export const S11_CONTRACT_VERSION = "s11.v1" as const;

/** The only operation names that may reach an S11 event or use-case field. */
export const S11_OPERATIONS = [
  "export.request",
  "export.dataset",
  "export.serialize",
  "export.deliver",
  "job.start",
  "job.attempt",
  "job.finish",
] as const;

export type S11Operation = (typeof S11_OPERATIONS)[number];

/** Stages are derived from operations and never accepted as free text. */
export const S11_STAGES = [
  "request",
  "dataset",
  "serialize",
  "deliver",
  "job",
] as const;

export type S11Stage = (typeof S11_STAGES)[number];

/** Result categories distinguish absence, gates, limits and retry state. */
export const S11_RESULTS = [
  "SUCCESS",
  "EMPTY",
  "UNAVAILABLE_EXTERNAL_GATE",
  "TIMEOUT",
  "TOO_LARGE",
  "RATE_LIMITED",
  "IN_PROGRESS",
  "FAILED",
  "SKIPPED_IDEMPOTENT",
  "SLOW",
  "RETRYING",
] as const;

export type S11Result = (typeof S11_RESULTS)[number];

export const S11_OUTCOMES = [
  "success",
  "expected_error",
  "unexpected_error",
] as const;

export type S11Outcome = (typeof S11_OUTCOMES)[number];

/** Closed dataset identifiers from ADR-014; never user filenames. */
export const S11_DATASET_IDS = [
  "accounts",
  "categories",
  "financial_events",
  "account_entries",
  "credit_cards",
  "credit_card_billing_rules",
  "credit_card_purchases",
  "installment_plans",
  "installments",
  "recurring_rules",
  "recurring_occurrences",
  "planned_events",
  "holidays",
  "spendable_settings",
  "budgets",
  "budget_movements",
  "budget_allocation_rules",
] as const;

export type S11DatasetId = (typeof S11_DATASET_IDS)[number];

/** Closed job names for the S11 runtime. */
export const S11_JOB_NAMES = [
  "s11.job.heartbeat",
  "s11.backup.logical",
] as const;

export type S11JobName = (typeof S11_JOB_NAMES)[number];

/** Aggregate counters only; rows, references, values and payloads are absent. */
export interface S11AggregateFields {
  datasetId?: S11DatasetId;
  rowCount?: number;
  byteCount?: number;
  durationMs?: number;
  datasetCount?: number;
  attempt?: number;
  jobName?: S11JobName;
  slow?: boolean;
}

export interface S11OperationOptions extends S11AggregateFields {
  requestId?: unknown;
  /** Alias accepted by transport boundaries and emitted as requestId. */
  correlationId?: unknown;
  executionId?: unknown;
  userId?: unknown;
  householdId?: unknown;
  result?: unknown;
  contractVersion?: unknown;
  statusCode?: unknown;
  errorCode?: unknown;
  [key: string]: unknown;
}

export interface S11OperationContext extends S11AggregateFields {
  operation: S11Operation;
  stage: S11Stage;
  contractVersion: typeof S11_CONTRACT_VERSION;
  requestId?: string;
  executionId?: string;
  result?: S11Result;
  statusCode?: number;
}

export interface S11Log extends S11OperationContext {
  event: string;
  useCase: S11Operation;
  outcome: S11Outcome;
  errorCode?: S11ErrorCode;
  slowThresholdMs?: number;
}

export type S11LogInput = Omit<
  Partial<S11Log>,
  | "event"
  | "useCase"
  | "operation"
  | "stage"
  | "contractVersion"
  | "result"
  | "errorCode"
> &
  S11OperationOptions & {
    event?: unknown;
    useCase?: unknown;
    operation?: unknown;
    stage?: unknown;
    contractVersion?: unknown;
    result?: unknown;
    errorCode?: unknown;
  };

export interface S11ObservabilityHooks {
  onRecord?: (record: S11Log) => void;
  onMetric?: (record: S11Log) => void;
  onSlow?: (record: S11Log) => void;
}

/**
 * Safe categories/counters that a boundary may derive from its own result.
 * The callback is deliberately separate from the event allow-list: its output
 * is sanitized again before it reaches a log, breadcrumb, metric or Sentry.
 */
export interface S11ResultSummary extends S11AggregateFields {
  result?: unknown;
}

export type S11ResultSummarizer = (value: unknown) => S11ResultSummary;

export interface S11CompletionOptions
  extends S11AggregateFields,
    S11ObservabilityHooks {
  durationMs?: number;
  errorCode?: string;
  technicalErrorCode?: string;
  result?: unknown;
  thresholdMs?: number;
  slowThresholdMs?: number;
  now?: () => number;
  summarizeResult?: S11ResultSummarizer;
}

export interface S11DatasetReadOptions
  extends S11AggregateFields,
    S11ObservabilityHooks {
  requestId?: unknown;
  correlationId?: unknown;
  executionId?: unknown;
  result?: unknown;
  durationMs?: number;
  errorCode?: string;
  technicalErrorCode?: string;
  thresholdMs?: number;
  now?: () => number;
  summarizeResult?: S11ResultSummarizer;
  [key: string]: unknown;
}

export interface S11JobAttemptOptions extends S11ObservabilityHooks {
  requestId?: unknown;
  correlationId?: unknown;
  executionId?: unknown;
  jobName?: unknown;
  attempt?: unknown;
  result?: unknown;
  durationMs?: number;
  errorCode?: string;
  technicalErrorCode?: string;
  rowCount?: number;
  byteCount?: number;
  datasetCount?: number;
  slow?: boolean;
  now?: () => number;
  summarizeResult?: S11ResultSummarizer;
  [key: string]: unknown;
}

export type S11BoundaryOptions = S11CompletionOptions & Record<string, unknown>;

export const S11_EXPECTED_ERROR_CODES = [
  "UNAUTHENTICATED",
  "EXPORT_IN_PROGRESS",
  "EXPORT_RATE_LIMITED",
  "EXPORT_TIMEOUT",
  "EXPORT_TOO_LARGE",
  "EXPORT_UNAVAILABLE",
  "EXPORT_FAILED",
  "HOUSEHOLD_MEMBERSHIP_REQUIRED",
  "HOUSEHOLD_SELECTION_REQUIRED",
  "INVALID_FINANCIAL_CONTEXT",
  "FINANCIAL_CONTEXT_REQUIRED",
  "HOUSEHOLD_NOT_FOUND",
] as const;

export type S11ExpectedErrorCode = (typeof S11_EXPECTED_ERROR_CODES)[number];

export const S11_TECHNICAL_ERROR_CODES = [
  "EXPORT_DATASET_FAILED",
  "EXPORT_SERIALIZATION_FAILED",
  "EXPORT_DELIVERY_FAILED",
  "JOB_FAILED",
  "JOB_HEARTBEAT_FAILED",
  "JOB_BACKUP_FAILED",
  "CONTRACT_VERSION_MISMATCH",
  "QUERY_FAILED",
  "PERSISTENCE_FAILED",
  "UNEXPECTED_ERROR",
] as const;

export type S11TechnicalErrorCode = (typeof S11_TECHNICAL_ERROR_CODES)[number];

export type S11ErrorCode = S11ExpectedErrorCode | S11TechnicalErrorCode;

export interface S11ErrorClassification {
  outcome: "expected_error" | "unexpected_error";
  errorCode: S11ErrorCode;
}

export interface S11SafeErrorEnvelope {
  ok: false;
  error: { code: S11ErrorCode };
}

export const DEFAULT_S11_DATASET_SLOW_THRESHOLD_MS = 2_000;
export const DEFAULT_S11_EXPORT_SLOW_THRESHOLD_MS = 5_000;
export const MAX_S11_SLOW_THRESHOLD_MS = 60_000;
export const MAX_S11_AGGREGATE_COUNT = 1_000_000_000;
export const MAX_S11_ATTEMPT = 99;
export const MAX_DURATION_MS = 86_400_000;

const OPERATION_ALIASES: Readonly<Record<string, S11Operation>> = {
  "export.request": "export.request",
  request: "export.request",
  export: "export.request",
  "export.dataset": "export.dataset",
  dataset: "export.dataset",
  "export.serialize": "export.serialize",
  serialize: "export.serialize",
  serialization: "export.serialize",
  "export.deliver": "export.deliver",
  deliver: "export.deliver",
  delivery: "export.deliver",
  "job.start": "job.start",
  start: "job.start",
  "job.attempt": "job.attempt",
  attempt: "job.attempt",
  "job.finish": "job.finish",
  finish: "job.finish",
};

const OPERATION_SET = new Set<string>(S11_OPERATIONS);
const STAGE_SET = new Set<string>(S11_STAGES);
const OUTCOME_SET = new Set<string>(S11_OUTCOMES);
const RESULT_ALIASES: Readonly<Record<string, S11Result>> = {
  SUCCESS: "SUCCESS",
  success: "SUCCESS",
  EMPTY: "EMPTY",
  empty: "EMPTY",
  UNAVAILABLE_EXTERNAL_GATE: "UNAVAILABLE_EXTERNAL_GATE",
  unavailable_external_gate: "UNAVAILABLE_EXTERNAL_GATE",
  UNAVAILABLE: "UNAVAILABLE_EXTERNAL_GATE",
  unavailable: "UNAVAILABLE_EXTERNAL_GATE",
  TIMEOUT: "TIMEOUT",
  timeout: "TIMEOUT",
  TOO_LARGE: "TOO_LARGE",
  too_large: "TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
  rate_limited: "RATE_LIMITED",
  IN_PROGRESS: "IN_PROGRESS",
  in_progress: "IN_PROGRESS",
  FAILED: "FAILED",
  failed: "FAILED",
  SKIPPED_IDEMPOTENT: "SKIPPED_IDEMPOTENT",
  skipped_idempotent: "SKIPPED_IDEMPOTENT",
  SLOW: "SLOW",
  slow: "SLOW",
  RETRYING: "RETRYING",
  retrying: "RETRYING",
};
const RESULT_SET = new Set<string>(S11_RESULTS);
const DATASET_ID_SET = new Set<string>(S11_DATASET_IDS);
const JOB_NAME_SET = new Set<string>(S11_JOB_NAMES);
const EXPECTED_ERROR_SET = new Set<string>(S11_EXPECTED_ERROR_CODES);
const TECHNICAL_ERROR_SET = new Set<string>(S11_TECHNICAL_ERROR_CODES);
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function opaqueId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized && OPAQUE_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function boundedInteger(value: unknown, maximum = MAX_S11_AGGREGATE_COUNT): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(maximum, Math.max(0, Math.round(value)));
}

function duration(value: unknown): number | undefined {
  return boundedInteger(value, MAX_DURATION_MS);
}

function statusCode(value: unknown): number | undefined {
  return boundedInteger(value, 999);
}

function attemptValue(value: unknown): number | undefined {
  return boundedInteger(value, MAX_S11_ATTEMPT);
}

function operationValue(value: unknown): S11Operation | undefined {
  if (typeof value !== "string") return undefined;
  const operation = OPERATION_ALIASES[value];
  return operation && OPERATION_SET.has(operation) ? operation : undefined;
}

function stageForOperation(operation: S11Operation): S11Stage {
  if (operation === "export.request") return "request";
  if (operation === "export.dataset") return "dataset";
  if (operation === "export.serialize") return "serialize";
  if (operation === "export.deliver") return "deliver";
  return "job";
}

function operationForStage(stage: S11Stage): S11Operation {
  if (stage === "request") return "export.request";
  if (stage === "dataset") return "export.dataset";
  if (stage === "serialize") return "export.serialize";
  if (stage === "deliver") return "export.deliver";
  return "job.start";
}

function stageValue(value: unknown): S11Stage | undefined {
  if (typeof value !== "string" || !STAGE_SET.has(value)) return undefined;
  return value as S11Stage;
}

function outcomeValue(value: unknown): S11Outcome | undefined {
  if (typeof value !== "string" || !OUTCOME_SET.has(value)) return undefined;
  return value as S11Outcome;
}

function resultValue(value: unknown): S11Result | undefined {
  if (typeof value !== "string") return undefined;
  const result = RESULT_ALIASES[value];
  return result && RESULT_SET.has(result) ? result : undefined;
}

function datasetIdValue(value: unknown): S11DatasetId | undefined {
  return typeof value === "string" && DATASET_ID_SET.has(value)
    ? (value as S11DatasetId)
    : undefined;
}

function jobNameValue(value: unknown): S11JobName | undefined {
  return typeof value === "string" && JOB_NAME_SET.has(value)
    ? (value as S11JobName)
    : undefined;
}

function errorCodeValue(value: unknown): S11ErrorCode | undefined {
  if (
    typeof value !== "string" ||
    !ERROR_CODE_PATTERN.test(value) ||
    (!EXPECTED_ERROR_SET.has(value) && !TECHNICAL_ERROR_SET.has(value))
  ) {
    return undefined;
  }
  return value as S11ErrorCode;
}

function technicalErrorCode(value: unknown): S11TechnicalErrorCode {
  return typeof value === "string" && TECHNICAL_ERROR_SET.has(value)
    ? (value as S11TechnicalErrorCode)
    : "UNEXPECTED_ERROR";
}

function slowFlag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

const AGGREGATE_ALIASES: Readonly<
  Record<keyof S11AggregateFields, readonly string[]>
> = {
  datasetId: ["datasetId", "dataset_id", "dataset"],
  rowCount: ["rowCount", "row_count", "rows"],
  byteCount: ["byteCount", "byte_count", "bytes"],
  durationMs: ["durationMs", "duration_ms", "duration"],
  datasetCount: ["datasetCount", "dataset_count", "datasets"],
  attempt: ["attempt", "retryAttempt", "retry_attempt"],
  jobName: ["jobName", "job_name", "job"],
  slow: ["slow", "isSlow", "is_slow"],
};

function aggregateFrom(source: Record<string, unknown>): S11AggregateFields {
  const result: S11AggregateFields = {};
  for (const key of Object.keys(AGGREGATE_ALIASES) as Array<keyof S11AggregateFields>) {
    for (const alias of AGGREGATE_ALIASES[key]) {
      const raw = source[alias];
      if (key === "datasetId") {
        const datasetId = datasetIdValue(raw);
        if (datasetId) {
          result.datasetId = datasetId;
          break;
        }
        continue;
      }
      if (key === "jobName") {
        const jobName = jobNameValue(raw);
        if (jobName) {
          result.jobName = jobName;
          break;
        }
        continue;
      }
      if (key === "slow") {
        const slow = slowFlag(raw);
        if (slow !== undefined) {
          result.slow = slow;
          break;
        }
        continue;
      }
      if (key === "attempt") {
        const attempt = attemptValue(raw);
        if (attempt !== undefined) {
          result.attempt = attempt;
          break;
        }
        continue;
      }
      const count = boundedInteger(raw);
      if (count !== undefined) {
        result[key] = count;
        break;
      }
    }
  }
  return result;
}

/** Keeps only bounded scalar aggregate fields; it never traverses rows. */
export function sanitizeS11AggregateFields(value: unknown): S11AggregateFields | undefined {
  if (!isRecord(value)) return undefined;
  const source = isRecord(value.counts) ? value.counts : value;
  const result = aggregateFrom(source);
  return Object.keys(result).length > 0 ? result : undefined;
}

function eventName(operation: S11Operation, outcome: S11Outcome): string {
  return `s11_${operation.replaceAll(".", "_")}_${outcome}`;
}

function addOpaqueId(
  target: { requestId?: string; executionId?: string },
  field: "requestId" | "executionId",
  value: unknown,
): void {
  const safe = opaqueId(value);
  if (safe) target[field] = safe;
}

/** Creates operation metadata and generates request correlation when absent. */
export function createS11Operation(
  operationInput: S11Operation | S11Stage | string,
  options: S11OperationOptions = {},
): S11OperationContext {
  const operation = operationValue(operationInput) ?? "export.request";
  let requestId = opaqueId(options.requestId ?? options.correlationId);
  if (!requestId) {
    try {
      requestId = opaqueId(generateUuidV7());
    } catch {
      requestId = undefined;
    }
  }

  const result: S11OperationContext = {
    operation,
    stage: stageForOperation(operation),
    contractVersion: S11_CONTRACT_VERSION,
    ...aggregateFrom(options),
  };
  addOpaqueId(result, "requestId", requestId);
  addOpaqueId(result, "executionId", options.executionId);

  const resultState = resultValue(options.result);
  if (resultState) result.result = resultState;
  const durationMs = duration(options.durationMs);
  if (durationMs !== undefined) result.durationMs = durationMs;
  const status = statusCode(options.statusCode);
  if (status !== undefined) result.statusCode = status;
  return result;
}

/** Final S11 allow-list: caller event names and unknown fields are rebuilt/dropped. */
export function sanitizeS11Log(value: S11LogInput): S11Log | undefined {
  try {
    const suppliedOperation = value.operation === undefined
      ? undefined
      : operationValue(value.operation);
    const suppliedStage = value.stage === undefined ? undefined : stageValue(value.stage);
    const outcome = outcomeValue(value.outcome);
    if (
      (value.operation !== undefined && !suppliedOperation) ||
      (value.stage !== undefined && !suppliedStage) ||
      !outcome
    ) {
      return undefined;
    }
    const operation =
      suppliedOperation ?? (suppliedStage ? operationForStage(suppliedStage) : undefined);
    if (!operation) return undefined;
    const stage = stageForOperation(operation);
    if (suppliedStage && suppliedStage !== stage) return undefined;
    if (value.contractVersion !== undefined && value.contractVersion !== S11_CONTRACT_VERSION) {
      return undefined;
    }

    const aggregates = aggregateFrom(value);
    if (value.datasetId !== undefined && aggregates.datasetId === undefined) return undefined;
    if (value.jobName !== undefined && aggregates.jobName === undefined) return undefined;

    const safe: S11Log = {
      event: eventName(operation, outcome),
      useCase: operation,
      operation,
      stage,
      contractVersion: S11_CONTRACT_VERSION,
      outcome,
      ...aggregates,
    };
    addOpaqueId(safe, "requestId", value.requestId ?? value.correlationId);
    addOpaqueId(safe, "executionId", value.executionId);

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
    const threshold = duration(value.slowThresholdMs);
    if (threshold !== undefined) safe.slowThresholdMs = threshold;
    if (typeof value.slow === "boolean") safe.slow = value.slow;
    return safe;
  } catch {
    return undefined;
  }
}

function primaryContext(
  operation: S11OperationContext,
  outcome: S11Outcome,
  options: S11CompletionOptions = {},
): S11Log | undefined {
  return sanitizeS11Log({
    ...operation,
    ...options,
    operation: operation.operation,
    stage: operation.stage,
    outcome,
  });
}

/** Converts S11 metadata to the shared context shape without raw fields. */
export function toS11ObservabilityContext(
  operation: S11OperationContext,
  outcome: S11Outcome = "unexpected_error",
  options: S11CompletionOptions = {},
): ObservabilityContext & Record<string, unknown> {
  const safe = primaryContext(operation, outcome, options);
  return {
    event: safe?.event ?? eventName(operation.operation, outcome),
    useCase: safe?.useCase ?? operation.operation,
    operation: safe?.operation ?? operation.operation,
    entityType: "export",
    requestId: safe?.requestId,
    durationMs: safe?.durationMs,
    statusCode: safe?.statusCode,
    stage: safe?.stage ?? operation.stage,
    errorCode: safe?.errorCode,
    s11Operation: safe?.operation,
    s11Stage: safe?.stage,
    s11ContractVersion: safe?.contractVersion ?? S11_CONTRACT_VERSION,
    s11Outcome: safe?.outcome,
    s11Result: safe?.result,
    s11ExecutionId: safe?.executionId,
    s11DatasetId: safe?.datasetId,
    s11JobName: safe?.jobName,
    s11Attempt: safe?.attempt,
    s11Slow: safe?.slow,
    rowCount: safe?.rowCount,
    byteCount: safe?.byteCount,
    datasetCount: safe?.datasetCount,
  };
}

function breadcrumbData(safe: S11Log): Record<string, unknown> {
  return {
    operation: safe.operation,
    stage: safe.stage,
    s11_operation: safe.operation,
    s11_stage: safe.stage,
    s11_contract_version: safe.contractVersion,
    outcome: safe.outcome,
    request_id: safe.requestId,
    execution_id: safe.executionId,
    error_code: safe.errorCode,
    result: safe.result,
    dataset_id: safe.datasetId,
    job_name: safe.jobName,
    attempt: safe.attempt,
    duration_ms: safe.durationMs,
    status_code: safe.statusCode,
    row_count: safe.rowCount,
    byte_count: safe.byteCount,
    dataset_count: safe.datasetCount,
    slow: safe.slow,
    slow_threshold_ms: safe.slowThresholdMs,
  };
}

export function addS11Breadcrumb(
  operation: S11OperationContext,
  outcome: S11Outcome,
  options: S11CompletionOptions = {},
): void {
  const safe = primaryContext(operation, outcome, options);
  if (!safe) return;
  addBreadcrumbSafely({
    type: "info",
    category: safe.useCase,
    data: breadcrumbData(safe),
  });
}

function emitRecord(safe: S11Log, hooks: S11ObservabilityHooks = {}): void {
  try {
    addS11Breadcrumb(safe, safe.outcome, safe);
  } catch {
    /* best effort */
  }
  try {
    hooks.onRecord?.(safe);
    hooks.onMetric?.(safe);
  } catch {
    /* non-blocking */
  }
  try {
    const serialized = JSON.stringify(safe);
    if (safe.outcome === "unexpected_error") console.error(serialized);
    else console.info(serialized);
  } catch {
    /* non-blocking */
  }
}

export function logS11Operation(
  operation: S11OperationContext,
  outcome: S11Outcome,
  options: S11CompletionOptions = {},
): S11Log | undefined {
  const safe = primaryContext(operation, outcome, options);
  if (!safe) return undefined;
  emitRecord(safe, options);
  return safe;
}

function codeFromError(error: unknown): unknown {
  if (!isRecord(error)) return undefined;
  if (typeof error.code === "string") return error.code;
  return isRecord(error.error) ? error.error.code : undefined;
}

export function expectedS11ErrorCode(error: unknown): S11ExpectedErrorCode | undefined {
  if (error instanceof FinancialContextError && EXPECTED_ERROR_SET.has(error.code)) {
    return error.code as S11ExpectedErrorCode;
  }
  const code = codeFromError(error);
  return typeof code === "string" && EXPECTED_ERROR_SET.has(code)
    ? (code as S11ExpectedErrorCode)
    : undefined;
}

export function classifyS11Error(error: unknown): S11ErrorClassification {
  const expected = expectedS11ErrorCode(error);
  if (expected) return { outcome: "expected_error", errorCode: expected };
  return { outcome: "unexpected_error", errorCode: technicalErrorCode(codeFromError(error)) };
}

export function isExpectedS11Error(error: unknown): boolean {
  return expectedS11ErrorCode(error) !== undefined;
}

export function toS11ErrorEnvelope(error: unknown): S11SafeErrorEnvelope {
  const classification = classifyS11Error(error);
  return { ok: false, error: { code: classification.errorCode } };
}

export function reportS11UnexpectedError(
  error: unknown,
  operation: S11OperationContext,
  durationOrOptions: number | S11CompletionOptions = 0,
  options: S11CompletionOptions = {},
): S11ErrorClassification {
  const durationMs =
    typeof durationOrOptions === "number"
      ? durationOrOptions
      : (durationOrOptions.durationMs ?? 0);
  const completionOptions =
    typeof durationOrOptions === "number" ? options : durationOrOptions;
  const classification = classifyS11Error(error);
  const code =
    classification.outcome === "expected_error"
      ? classification.errorCode
      : technicalErrorCode(completionOptions.technicalErrorCode ?? codeFromError(error));
  const safeOptions = {
    ...completionOptions,
    durationMs,
    errorCode: code,
  };
  logS11Operation(operation, classification.outcome, safeOptions);
  if (classification.outcome === "unexpected_error") {
    try {
      captureServerException(
        error,
        toS11ObservabilityContext(operation, "unexpected_error", safeOptions),
      );
    } catch {
      /* best effort */
    }
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
  return isRecord(value) && value.ok === false
    ? { failed: true, error: value.error }
    : { failed: false };
}

function summarizeResult(
  options: { summarizeResult?: S11ResultSummarizer },
  value: unknown,
): S11ResultSummary {
  if (typeof options.summarizeResult !== "function") return {};
  try {
    const summary = options.summarizeResult(value);
    return isRecord(summary) ? (summary as S11ResultSummary) : {};
  } catch {
    return {};
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

export function getS11DatasetSlowThresholdMs(value?: unknown): number {
  return (
    safeThreshold(
      value ?? process.env.S11_DATASET_SLOW_THRESHOLD_MS,
      MAX_S11_SLOW_THRESHOLD_MS,
    ) ?? DEFAULT_S11_DATASET_SLOW_THRESHOLD_MS
  );
}

export function getS11ExportSlowThresholdMs(value?: unknown): number {
  return (
    safeThreshold(
      value ?? process.env.S11_EXPORT_SLOW_THRESHOLD_MS,
      MAX_S11_SLOW_THRESHOLD_MS,
    ) ?? DEFAULT_S11_EXPORT_SLOW_THRESHOLD_MS
  );
}

function slowThresholdForOperation(
  operation: S11Operation,
  thresholdMs?: unknown,
): number {
  if (operation === "export.dataset") {
    return getS11DatasetSlowThresholdMs(thresholdMs);
  }
  if (operation === "export.request") {
    return getS11ExportSlowThresholdMs(thresholdMs);
  }
  return safeThreshold(thresholdMs, MAX_S11_SLOW_THRESHOLD_MS) ?? 0;
}

function applySlowMetadata(
  operation: S11Operation,
  durationMs: number,
  options: S11CompletionOptions,
): S11CompletionOptions {
  const thresholdMs = slowThresholdForOperation(operation, options.thresholdMs);
  if (thresholdMs <= 0 || durationMs < thresholdMs) return options;
  return {
    ...options,
    durationMs,
    slow: true,
    slowThresholdMs: thresholdMs,
    result: options.result ?? "SLOW",
  };
}

export async function withS11Observability<T>(
  operation: S11OperationContext,
  work: () => Promise<T> | T,
  options: S11CompletionOptions = {},
): Promise<T> {
  const now = options.now ?? monotonicNow;
  const startedAt = now();
  try {
    const value = await work();
    const failure = resultFailure(value);
    const durationMs = elapsedMs(startedAt, now);
    if (failure.failed) {
      reportS11UnexpectedError(failure.error, operation, durationMs, options);
      return value;
    }
    const completion = applySlowMetadata(operation.operation, durationMs, {
      ...options,
      ...summarizeResult(options, value),
      durationMs,
    });
    logS11Operation(operation, "success", completion);
    if (completion.slow) {
      try {
        options.onSlow?.(
          primaryContext(operation, "success", completion) as S11Log,
        );
      } catch {
        /* non-blocking */
      }
    }
    return value;
  } catch (error) {
    const durationMs = elapsedMs(startedAt, now);
    const classification = classifyS11Error(error);
    if (classification.outcome === "expected_error") {
      logS11Operation(operation, "expected_error", {
        ...options,
        durationMs,
        errorCode: classification.errorCode,
      });
    } else {
      reportS11UnexpectedError(error, operation, durationMs, options);
    }
    throw error;
  }
}

/**
 * Wraps a dataset read boundary (T06) with timing, slow detection and safe
 * aggregate emission. The returned value and thrown error are never inspected.
 */
export function wrapDatasetRead<T>(
  datasetId: S11DatasetId | string,
  work: () => Promise<T> | T,
  options: S11DatasetReadOptions = {},
): Promise<T> {
  const safeDatasetId = datasetIdValue(datasetId);
  if (!safeDatasetId) {
    return Promise.reject(new Error("INVALID_DATASET_ID"));
  }
  const operation = createS11Operation("export.dataset", {
    ...options,
    datasetId: safeDatasetId,
  });
  return withS11Observability(
    operation,
    () => measureS11DatasetRead(operation, work, options),
    {
      ...options,
      datasetId: safeDatasetId,
      technicalErrorCode: options.technicalErrorCode ?? "EXPORT_DATASET_FAILED",
    },
  );
}

/**
 * Wraps one job attempt (T08) with correlation by executionId and attempt.
 */
export function withJobAttempt<T>(
  work: () => Promise<T> | T,
  options: S11JobAttemptOptions = {},
): Promise<T> {
  const jobName = jobNameValue(options.jobName);
  if (!jobName) {
    return Promise.reject(new Error("INVALID_JOB_NAME"));
  }
  const attempt = attemptValue(options.attempt);
  if (attempt === undefined) {
    return Promise.reject(new Error("INVALID_JOB_ATTEMPT"));
  }
  const operation = createS11Operation("job.attempt", {
    ...options,
    jobName,
    attempt,
  });
  return withS11Observability(operation, work, {
    ...options,
    jobName,
    attempt,
    technicalErrorCode: options.technicalErrorCode ?? "JOB_FAILED",
  });
}

/** Measures dataset reads without accepting SQL or returned payloads. */
export async function measureS11DatasetRead<T>(
  operation: S11OperationContext,
  work: () => Promise<T> | T,
  options: S11DatasetReadOptions = {},
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
    const thresholdMs = getS11DatasetSlowThresholdMs(options.thresholdMs);
    if (durationMs >= thresholdMs) {
      const returnedFailure = resultFailure(returnedValue);
      const classification = failed
        ? classifyS11Error(thrownError)
        : returnedFailure.failed
          ? classifyS11Error(returnedFailure.error)
          : undefined;
      const safe = sanitizeS11Log({
        ...operation,
        ...options,
        ...(!failed && !returnedFailure.failed
          ? summarizeResult(options, returnedValue)
          : {}),
        operation: operation.operation,
        stage: operation.stage,
        outcome: classification?.outcome ?? "success",
        errorCode:
          classification?.outcome === "expected_error"
            ? classification.errorCode
            : classification?.outcome === "unexpected_error"
              ? technicalErrorCode(options.technicalErrorCode)
              : undefined,
        durationMs,
        slow: true,
        slowThresholdMs: thresholdMs,
        result: "SLOW",
      } as S11LogInput);
      if (safe) {
        try {
          addS11Breadcrumb(safe, safe.outcome, safe);
        } catch {
          /* best effort */
        }
        try {
          options.onRecord?.(safe);
          options.onMetric?.(safe);
          options.onSlow?.(safe);
        } catch {
          /* non-blocking */
        }
        try {
          console.warn(JSON.stringify(safe));
        } catch {
          /* non-blocking */
        }
      }
    }
  }
}

/** Wraps an export pipeline stage without inspecting its returned payload. */
export function instrumentS11ExportBoundary<
  TArguments extends readonly unknown[],
  TResult,
>(
  operationName: S11Operation | S11Stage | string,
  boundary: (...args: TArguments) => Promise<TResult> | TResult,
  options: S11BoundaryOptions = {},
): (...args: TArguments) => Promise<TResult> {
  return async (...args: TArguments): Promise<TResult> => {
    const operation = createS11Operation(operationName, options);
    const technicalByOperation: Partial<Record<S11Operation, S11TechnicalErrorCode>> = {
      "export.request": "EXPORT_DATASET_FAILED",
      "export.dataset": "EXPORT_DATASET_FAILED",
      "export.serialize": "EXPORT_SERIALIZATION_FAILED",
      "export.deliver": "EXPORT_DELIVERY_FAILED",
      "job.start": "JOB_FAILED",
      "job.attempt": "JOB_FAILED",
      "job.finish": "JOB_FAILED",
    };
    return withS11Observability(
      operation,
      () => boundary(...args),
      {
        ...options,
        technicalErrorCode:
          options.technicalErrorCode ?? technicalByOperation[operation.operation] ?? "UNEXPECTED_ERROR",
      },
    );
  };
}

/** Emits job.start for a new logical execution. */
export function logS11JobStart(
  options: S11JobAttemptOptions = {},
): S11Log | undefined {
  const jobName = jobNameValue(options.jobName);
  if (!jobName) return undefined;
  const operation = createS11Operation("job.start", {
    ...options,
    jobName,
  } as S11OperationOptions);
  return logS11Operation(operation, "success", options as S11CompletionOptions);
}

/** Emits job.finish for the terminal state of a logical execution. */
export function logS11JobFinish(
  outcome: S11Outcome,
  options: S11JobAttemptOptions = {},
): S11Log | undefined {
  const jobName = jobNameValue(options.jobName);
  if (!jobName) return undefined;
  const operation = createS11Operation("job.finish", {
    ...options,
    jobName,
  } as S11OperationOptions);
  return logS11Operation(operation, outcome, options as S11CompletionOptions);
}

export function isOpaqueUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
