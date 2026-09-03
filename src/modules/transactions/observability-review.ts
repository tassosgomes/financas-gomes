import type { ObservabilityContext } from "@/modules/observability/contracts";
import {
  addBreadcrumbSafely,
  captureServerException,
} from "@/modules/observability/server";
import { FinancialContextError } from "@/modules/households/contracts";
import { generateUuidV7 } from "@/lib/uuidv7";

import { TRANSACTION_ERROR_CODES } from "./contracts";

/** The four observable S05 read/write boundaries. */
export const TRANSACTION_REVIEW_OPERATIONS = [
  "list",
  "summary",
  "detail",
  "update",
] as const;

export type TransactionReviewOperation =
  (typeof TRANSACTION_REVIEW_OPERATIONS)[number];

/**
 * Query identifiers are code-owned values. They are derived from the
 * operation and are never accepted from a request, query string or SQL.
 */
export const TRANSACTION_REVIEW_QUERY_CODES = {
  list: "review_list",
  summary: "review_summary",
  detail: "review_detail",
  update: "review_update",
} as const satisfies Record<TransactionReviewOperation, string>;

export type TransactionReviewQueryCode =
  (typeof TRANSACTION_REVIEW_QUERY_CODES)[TransactionReviewOperation];

export const TRANSACTION_REVIEW_OUTCOMES = [
  "success",
  "expected_error",
  "unexpected_error",
] as const;

export type TransactionReviewOutcome =
  (typeof TRANSACTION_REVIEW_OUTCOMES)[number];

/** Aggregated values only; `ALL` represents a mixed/unfiltered operation. */
export const TRANSACTION_REVIEW_ORIGINS = [
  "MANUAL",
  "IMPORT",
  "ALL",
] as const;

export type TransactionReviewOrigin =
  (typeof TRANSACTION_REVIEW_ORIGINS)[number];

export const TRANSACTION_REVIEW_KINDS = [
  "EXPENSE",
  "INCOME",
  "ALL",
] as const;

export type TransactionReviewKind =
  (typeof TRANSACTION_REVIEW_KINDS)[number];

/**
 * The ADR-006 expected-error vocabulary plus the S03 compatibility codes.
 * Only a code from this closed set can be classified as an expected failure.
 */
export const TRANSACTION_REVIEW_EXPECTED_ERROR_CODES = [
  ...TRANSACTION_ERROR_CODES,
  "HOUSEHOLD_MEMBERSHIP_REQUIRED",
  "HOUSEHOLD_SELECTION_REQUIRED",
  "INVALID_FINANCIAL_CONTEXT",
  "INVALID_QUERY",
  "INVALID_CURSOR",
  "EVENT_NOT_REVIEWABLE",
  "IMPORT_LINEAGE_INVALID",
] as const;

export type TransactionReviewExpectedErrorCode =
  (typeof TRANSACTION_REVIEW_EXPECTED_ERROR_CODES)[number];

/** Technical labels are also closed so a provider/SQL message cannot become a log field. */
export const TRANSACTION_REVIEW_TECHNICAL_ERROR_CODES = [
  "QUERY_FAILED",
  "UPDATE_FAILED",
  "INVALID_READ_RESULT",
  "UNEXPECTED_ERROR",
] as const;

export type TransactionReviewTechnicalErrorCode =
  (typeof TRANSACTION_REVIEW_TECHNICAL_ERROR_CODES)[number];

export type TransactionReviewErrorCode =
  | TransactionReviewExpectedErrorCode
  | TransactionReviewTechnicalErrorCode;

/**
 * Operation metadata accepted by the S05 boundary. There is deliberately no
 * query, cursor, command, source, lineage, or financial-value field here.
 */
export interface TransactionReviewOperationOptions {
  requestId?: string;
  eventId?: string;
  userId?: string;
  householdId?: string;
  origin?: TransactionReviewOrigin;
  transactionKind?: TransactionReviewKind;
  statusCode?: number;
}

export interface TransactionReviewOperationContext
  extends TransactionReviewOperationOptions {
  operation: TransactionReviewOperation;
  queryCode: TransactionReviewQueryCode;
}

/** Aggregate result metadata safe to send to logs, metrics and breadcrumbs. */
export interface TransactionReviewResultMetadata {
  pageSize?: number;
  resultCount?: number;
  needsReviewCount?: number;
  hasNextPage?: boolean;
  origin?: TransactionReviewOrigin;
  transactionKind?: TransactionReviewKind;
}

export interface TransactionReviewLog
  extends TransactionReviewResultMetadata {
  event: string;
  useCase: string;
  operation: TransactionReviewOperation;
  queryCode: TransactionReviewQueryCode;
  outcome: TransactionReviewOutcome;
  requestId?: string;
  eventId?: string;
  userId?: string;
  householdId?: string;
  durationMs?: number;
  statusCode?: number;
  errorCode?: TransactionReviewErrorCode;
  slowQuery?: boolean;
  slowQueryThresholdMs?: number;
}

export type TransactionReviewLogInput =
  Partial<TransactionReviewLog> & Record<string, unknown>;

export interface TransactionReviewObservabilityHooks {
  /** Receives an already allow-listed record; suitable for metrics adapters. */
  onRecord?: (record: TransactionReviewLog) => void;
  /** Receives an already allow-listed slow-query record. */
  onSlowQuery?: (record: TransactionReviewLog) => void;
}

export interface TransactionReviewCompletionOptions
  extends TransactionReviewResultMetadata,
    TransactionReviewObservabilityHooks {
  durationMs?: number;
  errorCode?: string;
  technicalErrorCode?: TransactionReviewTechnicalErrorCode;
  /** Injectable monotonic clock for deterministic wrapper tests. */
  now?: () => number;
}

export interface TransactionReviewQueryOptions
  extends TransactionReviewResultMetadata,
    TransactionReviewObservabilityHooks {
  /** Overrides the environment threshold for this measurement only. */
  thresholdMs?: number;
  /** Injectable monotonic clock for deterministic tests. */
  now?: () => number;
  technicalErrorCode?: TransactionReviewTechnicalErrorCode;
}

export interface TransactionReviewErrorClassification {
  outcome: "expected_error" | "unexpected_error";
  errorCode: TransactionReviewErrorCode;
}

export interface TransactionReviewSafeErrorEnvelope {
  ok: false;
  error: {
    code: TransactionReviewErrorCode;
  };
}

export const DEFAULT_TRANSACTION_REVIEW_SLOW_QUERY_THRESHOLD_MS = 250;
export const MAX_TRANSACTION_REVIEW_SLOW_QUERY_THRESHOLD_MS = 60_000;
export const MAX_TRANSACTION_REVIEW_AGGREGATE_COUNT = 1_000_000_000;

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/u;
const EXPECTED_ERROR_CODE_SET = new Set<string>(
  TRANSACTION_REVIEW_EXPECTED_ERROR_CODES,
);
const TECHNICAL_ERROR_CODE_SET = new Set<string>(
  TRANSACTION_REVIEW_TECHNICAL_ERROR_CODES,
);

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
  maximum = MAX_TRANSACTION_REVIEW_AGGREGATE_COUNT,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(maximum, Math.max(0, Math.round(value)));
}

function statusCode(value: unknown): number | undefined {
  return finiteInteger(value, 999);
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function enumValue<T extends readonly string[]>(
  values: T,
  value: unknown,
): T[number] | undefined {
  return typeof value === "string" && values.includes(value)
    ? (value as T[number])
    : undefined;
}

function safeErrorCode(value: unknown): TransactionReviewErrorCode | undefined {
  if (
    typeof value !== "string" ||
    !SAFE_ERROR_CODE_PATTERN.test(value) ||
    (!EXPECTED_ERROR_CODE_SET.has(value) && !TECHNICAL_ERROR_CODE_SET.has(value))
  ) {
    return undefined;
  }

  return value as TransactionReviewErrorCode;
}

function safeTechnicalErrorCode(
  value: unknown,
): TransactionReviewTechnicalErrorCode {
  return TECHNICAL_ERROR_CODE_SET.has(value as string)
    ? (value as TransactionReviewTechnicalErrorCode)
    : "UNEXPECTED_ERROR";
}

function operationValue(value: unknown): TransactionReviewOperation | undefined {
  return enumValue(TRANSACTION_REVIEW_OPERATIONS, value);
}

function outcomeValue(value: unknown): TransactionReviewOutcome | undefined {
  return enumValue(TRANSACTION_REVIEW_OUTCOMES, value);
}

function originValue(value: unknown): TransactionReviewOrigin | undefined {
  return enumValue(TRANSACTION_REVIEW_ORIGINS, value);
}

function kindValue(value: unknown): TransactionReviewKind | undefined {
  return enumValue(TRANSACTION_REVIEW_KINDS, value);
}

function queryCodeFor(
  operation: TransactionReviewOperation,
): TransactionReviewQueryCode {
  return TRANSACTION_REVIEW_QUERY_CODES[operation];
}

function eventName(
  operation: TransactionReviewOperation,
  outcome: TransactionReviewOutcome,
): string {
  return `transaction_review_${operation}_${outcome}`;
}

function reviewUseCaseName(operation: TransactionReviewOperation): string {
  return `transactions.review.${operation}`;
}

/** Canonical names exposed for metrics/query adapters. */
export const transactionReviewEventName = eventName;
export const transactionReviewUseCaseName = reviewUseCaseName;

function safeAggregateMetadata(
  value: Record<string, unknown>,
): TransactionReviewResultMetadata {
  const result: TransactionReviewResultMetadata = {};
  const pageSize = finiteInteger(value.pageSize, 100);
  const resultCount = finiteInteger(value.resultCount);
  const needsReviewCount = finiteInteger(value.needsReviewCount);
  const hasNextPage = booleanValue(value.hasNextPage);
  const origin = originValue(value.origin);
  const transactionKind = kindValue(value.transactionKind);

  if (pageSize !== undefined) {
    result.pageSize = pageSize;
  }
  if (resultCount !== undefined) {
    result.resultCount = resultCount;
  }
  if (needsReviewCount !== undefined) {
    result.needsReviewCount = needsReviewCount;
  }
  if (hasNextPage !== undefined) {
    result.hasNextPage = hasNextPage;
  }
  if (origin) {
    result.origin = origin;
  }
  if (transactionKind) {
    result.transactionKind = transactionKind;
  }

  return result;
}

function safeOptionalFields(
  value: Record<string, unknown>,
  result: TransactionReviewLog,
): void {
  const addId = (
    key: "requestId" | "eventId" | "userId" | "householdId",
  ) => {
    const id = opaqueId(value[key]);
    if (id) {
      result[key] = id;
    }
  };

  addId("requestId");
  addId("eventId");
  addId("userId");
  addId("householdId");

  const durationMs = finiteInteger(value.durationMs);
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

  const slowQuery = booleanValue(value.slowQuery);
  if (slowQuery !== undefined) {
    result.slowQuery = slowQuery;
  }

  const slowQueryThresholdMs = finiteInteger(
    value.slowQueryThresholdMs,
    MAX_TRANSACTION_REVIEW_SLOW_QUERY_THRESHOLD_MS,
  );
  if (slowQueryThresholdMs !== undefined) {
    result.slowQueryThresholdMs = slowQueryThresholdMs;
  }
}

/**
 * Final S05 allow-list. Event/use-case/query identifiers are derived from the
 * operation, so caller input such as `search`, `description`, `cursor`,
 * `externalId`, token or payload can never be serialized by this function.
 */
export function sanitizeTransactionReviewLog(
  value: TransactionReviewLogInput,
): TransactionReviewLog | undefined {
  try {
    const operation = operationValue(value.operation);
    const outcome = outcomeValue(value.outcome);
    if (!operation || !outcome) {
      return undefined;
    }

    const safe: TransactionReviewLog = {
      event: eventName(operation, outcome),
      useCase: reviewUseCaseName(operation),
      operation,
      queryCode: queryCodeFor(operation),
      outcome,
      ...safeAggregateMetadata(value),
    };

    safeOptionalFields(value, safe);
    return safe;
  } catch {
    return undefined;
  }
}

function toLogInput(
  operation: TransactionReviewOperationContext,
  outcome: TransactionReviewOutcome,
  options: TransactionReviewCompletionOptions = {},
): TransactionReviewLogInput {
  return {
    ...operation,
    ...options,
    operation: operation.operation,
    outcome,
    durationMs: options.durationMs,
    // The sanitizer is the type/runtime allow-list for adapter-supplied codes.
    errorCode: options.errorCode as TransactionReviewErrorCode | undefined,
  };
}

function addTransactionReviewBreadcrumb(
  safe: TransactionReviewLog,
): void {
  addBreadcrumbSafely({
    type: "info",
    category: safe.useCase,
    data: {
      // The shared Sentry sanitizer accepts only technical breadcrumb fields.
      stage: safe.queryCode,
      operation: safe.operation,
      transaction_kind:
        safe.transactionKind === "ALL" ? undefined : safe.transactionKind,
      event_id: safe.eventId,
      outcome: safe.outcome,
      request_id: safe.requestId,
      duration_ms: safe.durationMs,
      error_code: safe.errorCode,
    },
  });
}

function emitRecord(
  safe: TransactionReviewLog,
  hooks: TransactionReviewObservabilityHooks = {},
  level: "info" | "error" | "warn" =
    safe.outcome === "unexpected_error" ? "error" : "info",
): void {
  try {
    addTransactionReviewBreadcrumb(safe);
  } catch {
    // Breadcrumbs are best effort and cannot affect the read/write response.
  }

  try {
    hooks.onRecord?.(safe);
  } catch {
    // A metrics/log adapter is best effort as well.
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
    // Structured logging must never change the application result.
  }
}

/** Creates an S05 operation and generates a fresh opaque request ID by default. */
export function createTransactionReviewOperation(
  operation: TransactionReviewOperation,
  options: TransactionReviewOperationOptions = {},
): TransactionReviewOperationContext {
  let requestId = opaqueId(options.requestId);
  if (!requestId) {
    try {
      requestId = opaqueId(generateUuidV7());
    } catch {
      requestId = undefined;
    }
  }

  return {
    operation,
    queryCode: queryCodeFor(operation),
    requestId,
    eventId: opaqueId(options.eventId),
    userId: opaqueId(options.userId),
    householdId: opaqueId(options.householdId),
    origin: originValue(options.origin),
    transactionKind: kindValue(options.transactionKind),
    statusCode: statusCode(options.statusCode),
  };
}

/** Emits one completed S05 record without serializing its result or input. */
export function logTransactionReviewOperation(
  operation: TransactionReviewOperationContext,
  outcome: TransactionReviewOutcome,
  options: TransactionReviewCompletionOptions = {},
): TransactionReviewLog | undefined {
  const safe = sanitizeTransactionReviewLog(
    toLogInput(operation, outcome, options),
  );
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

  const directCode = error.code;
  if (typeof directCode === "string") {
    return directCode;
  }

  // Result<T, E> errors are read through this single stable property only;
  // no message, stack, payload or nested financial object is inspected.
  return isRecord(error.error) ? error.error.code : undefined;
}

/** Returns the expected code only when the code belongs to the ADR allow-list. */
export function expectedTransactionReviewErrorCode(
  error: unknown,
): TransactionReviewExpectedErrorCode | undefined {
  if (error instanceof FinancialContextError) {
    return EXPECTED_ERROR_CODE_SET.has(error.code)
      ? (error.code as TransactionReviewExpectedErrorCode)
      : undefined;
  }

  const code = codeFromError(error);
  return typeof code === "string" && EXPECTED_ERROR_CODE_SET.has(code)
    ? (code as TransactionReviewExpectedErrorCode)
    : undefined;
}

/** Classifies domain/context failures without inspecting an exception message. */
export function classifyTransactionReviewError(
  error: unknown,
): TransactionReviewErrorClassification {
  const expectedCode = expectedTransactionReviewErrorCode(error);
  return expectedCode
    ? { outcome: "expected_error", errorCode: expectedCode }
    : { outcome: "unexpected_error", errorCode: "UNEXPECTED_ERROR" };
}

export function isExpectedTransactionReviewError(error: unknown): boolean {
  return expectedTransactionReviewErrorCode(error) !== undefined;
}

/** Safe shape for adapters that need to turn an error into a Result envelope. */
export function toTransactionReviewErrorEnvelope(
  error: unknown,
): TransactionReviewSafeErrorEnvelope {
  const classification = classifyTransactionReviewError(error);
  return {
    ok: false,
    error: { code: classification.errorCode },
  };
}

function completionLog(
  operation: TransactionReviewOperationContext,
  outcome: TransactionReviewOutcome,
  durationMs: number,
  options: TransactionReviewCompletionOptions,
): TransactionReviewLog | undefined {
  return logTransactionReviewOperation(operation, outcome, {
    ...options,
    durationMs,
    errorCode: options.errorCode,
  });
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

/**
 * Wraps a T04/T05/T06 operation. Expected Result errors are logged as an
 * outcome and returned unchanged; thrown technical exceptions are logged,
 * captured through the existing sanitized Sentry boundary and rethrown.
 */
export async function withTransactionReviewObservability<T>(
  operation: TransactionReviewOperationContext,
  work: () => Promise<T> | T,
  options: TransactionReviewCompletionOptions = {},
): Promise<T> {
  const now = options.now ?? monotonicNow;
  const startedAt = now();

  try {
    const value = await work();
    const failure = resultFailure(value);
    if (failure.failed) {
      const classification = classifyTransactionReviewError(failure.error);
      if (classification.outcome === "expected_error") {
        completionLog(operation, classification.outcome, elapsedMs(startedAt, now), {
          ...options,
          errorCode: classification.errorCode,
        });
        return value;
      }

      reportTransactionReviewUnexpectedError(
        failure.error,
        operation,
        elapsedMs(startedAt, now),
        options,
      );
      return value;
    }

    completionLog(operation, "success", elapsedMs(startedAt, now), options);
    return value;
  } catch (error) {
    const classification = classifyTransactionReviewError(error);
    const durationMs = elapsedMs(startedAt, now);
    if (classification.outcome === "expected_error") {
      completionLog(operation, classification.outcome, durationMs, {
        ...options,
        errorCode: classification.errorCode,
      });
      throw error;
    }

    reportTransactionReviewUnexpectedError(error, operation, durationMs, options);
    throw error;
  }
}

function safeThreshold(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(
      MAX_TRANSACTION_REVIEW_SLOW_QUERY_THRESHOLD_MS,
      Math.max(0, Math.round(value)),
    );
  }

  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    return safeThreshold(Number(value.trim()));
  }

  return undefined;
}

/** Reads `TRANSACTION_REVIEW_SLOW_QUERY_THRESHOLD_MS`, with a bounded safe default. */
export function getTransactionReviewSlowQueryThresholdMs(value?: unknown): number {
  const configuredValue =
    value ??
    process.env.TRANSACTION_REVIEW_SLOW_QUERY_THRESHOLD_MS ??
    process.env.S05_SLOW_QUERY_THRESHOLD_MS;
  return (
    safeThreshold(configuredValue) ??
    Math.min(
      MAX_TRANSACTION_REVIEW_SLOW_QUERY_THRESHOLD_MS,
      DEFAULT_TRANSACTION_REVIEW_SLOW_QUERY_THRESHOLD_MS,
    )
  );
}

function sentryContextFor(
  operation: TransactionReviewOperationContext,
  outcome: TransactionReviewOutcome,
  options: TransactionReviewCompletionOptions,
): ObservabilityContext {
  const safeOperation = operationValue(operation.operation) ?? "list";
  const safe = sanitizeTransactionReviewLog(
    toLogInput(operation, outcome, options),
  );

  return {
    event: safe?.event ?? eventName(safeOperation, outcome),
    useCase: safe?.useCase ?? reviewUseCaseName(safeOperation),
    operation: safeOperation,
    entityType: "transaction",
    entityId: safe?.eventId,
    eventId: safe?.eventId,
    transactionKind:
      safe?.transactionKind === "EXPENSE" || safe?.transactionKind === "INCOME"
        ? safe.transactionKind
        : undefined,
    requestId: safe?.requestId,
    userId: safe?.userId,
    householdId: safe?.householdId,
    durationMs: safe?.durationMs,
    statusCode: safe?.statusCode,
    // `stage` is the code-owned query stage; it never carries a cursor.
    stage: safe?.queryCode,
    errorCode: safe?.errorCode,
  };
}

/** Converts only the S05 allow-listed metadata to the shared Sentry shape. */
export function toTransactionReviewObservabilityContext(
  operation: TransactionReviewOperationContext,
  outcome: TransactionReviewOutcome = "unexpected_error",
  options: TransactionReviewCompletionOptions = {},
): ObservabilityContext {
  return sentryContextFor(operation, outcome, options);
}

/** Logs expected failures and captures only unexpected technical exceptions. */
export function reportTransactionReviewUnexpectedError(
  error: unknown,
  operation: TransactionReviewOperationContext,
  durationMs: number,
  options: TransactionReviewCompletionOptions = {},
): TransactionReviewErrorClassification {
  const classification = classifyTransactionReviewError(error);
  const safeOptions: TransactionReviewCompletionOptions = {
    ...options,
    durationMs,
    errorCode:
      classification.outcome === "expected_error"
        ? classification.errorCode
        : safeTechnicalErrorCode(options.technicalErrorCode),
  };

  completionLog(
    operation,
    classification.outcome,
    durationMs,
    safeOptions,
  );

  if (classification.outcome === "unexpected_error") {
    try {
      captureServerException(
        error,
        sentryContextFor(operation, classification.outcome, safeOptions),
      );
    } catch {
      // Sentry is best effort and must never change the response path.
    }
  }

  return classification;
}

/**
 * Measures one SQL/read-model call. Only calls above the bounded threshold
 * emit a warning/metric record; SQL text and bind values are never accepted.
 */
export async function measureTransactionReviewQuery<T>(
  operation: TransactionReviewOperationContext,
  work: () => Promise<T> | T,
  options: TransactionReviewQueryOptions = {},
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
    const thresholdMs = getTransactionReviewSlowQueryThresholdMs(options.thresholdMs);
    if (durationMs >= thresholdMs) {
      const returnedFailure = resultFailure(returnedValue);
      const classification = failed
        ? classifyTransactionReviewError(thrownError)
        : returnedFailure.failed
          ? classifyTransactionReviewError(returnedFailure.error)
          : { outcome: "success" as const, errorCode: undefined };
      const safe = sanitizeTransactionReviewLog({
        ...operation,
        ...options,
        operation: operation.operation,
        outcome: classification.outcome,
        durationMs,
        errorCode:
          classification.outcome === "expected_error"
            ? classification.errorCode
            : classification.outcome === "unexpected_error" &&
                (failed || returnedFailure.failed)
              ? safeTechnicalErrorCode(options.technicalErrorCode)
              : undefined,
        slowQuery: true,
        slowQueryThresholdMs: thresholdMs,
      });

      if (safe) {
        try {
          addTransactionReviewBreadcrumb(safe);
        } catch {
          // Best effort only.
        }

        try {
          options.onRecord?.(safe);
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

/** Naming aliases keep the small adapter surface discoverable. */
export const createTransactionReviewReviewOperation = createTransactionReviewOperation;
export const withTransactionReviewReviewObservability =
  withTransactionReviewObservability;
export const observeTransactionReviewQuery = measureTransactionReviewQuery;
export const classifyTransactionReviewTransactionError = classifyTransactionReviewError;
