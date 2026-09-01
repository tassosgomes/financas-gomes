import { CSV_IMPORT_ERROR_CODES } from "@/modules/transaction-imports/contracts";
import type { ObservabilityContext } from "./contracts";
import { addBreadcrumbSafely, captureServerException } from "./server";
import { getServerSentryConfig } from "./server-config";

/**
 * The S04 pipeline has four observable boundaries.  `confirmation` is the
 * public stage name while its command/use-case name is `confirm`.
 */
export const S04_IMPORT_STAGES = [
  "upload",
  "parse",
  "preview",
  "confirmation",
] as const;

export type S04ImportStage = (typeof S04_IMPORT_STAGES)[number];

export const S04_IMPORT_OPERATIONS = [
  "upload",
  "parse",
  "preview",
  "confirm",
] as const;

export type S04ImportOperation = (typeof S04_IMPORT_OPERATIONS)[number];

export const S04_IMPORT_OUTCOMES = [
  "success",
  "expected_error",
  "unexpected_error",
] as const;

export type S04ImportOutcome = (typeof S04_IMPORT_OUTCOMES)[number];

/**
 * These are the domain errors from ADR-005 plus the expected financial
 * context errors.  They are outcomes of the import flow, not Sentry events.
 */
export const S04_IMPORT_EXPECTED_ERROR_CODES = [
  ...CSV_IMPORT_ERROR_CODES,
  "HOUSEHOLD_MEMBERSHIP_REQUIRED",
  "HOUSEHOLD_SELECTION_REQUIRED",
  "INVALID_FINANCIAL_CONTEXT",
] as const;

export type S04ImportExpectedErrorCode =
  (typeof S04_IMPORT_EXPECTED_ERROR_CODES)[number];

/** Alias used by adapters that call these simply the S04 error codes. */
export const S04_ERROR_CODES = S04_IMPORT_EXPECTED_ERROR_CODES;

export interface S04ImportCounts {
  processed: number;
  valid: number;
  invalid: number;
  ignoredDuplicate: number;
  imported: number;
}

/** Accepts ADR names and the persistence column aliases. */
export interface S04ImportCountsLike
  extends Partial<S04ImportCounts> {
  processedRows?: number;
  validRows?: number;
  invalidRows?: number;
  ignoredDuplicateRows?: number;
  importedRows?: number;
  processed_rows?: number;
  valid_rows?: number;
  invalid_rows?: number;
  ignored_duplicate_rows?: number;
  imported_rows?: number;
}

export interface S04ImportObservabilityContext {
  stage: S04ImportStage;
  operation: S04ImportOperation;
  requestId?: string;
  /** This is a staging row ID, never the bearer preview token. */
  previewId?: string;
  /** This is a confirmed import row ID. */
  importId?: string;
  /** Technical UUID only; account display names are never accepted. */
  accountId?: string;
  userId?: string;
  householdId?: string;
  durationMs?: number;
  statusCode?: number;
  environment?: string;
  release?: string;
  errorCode?: string;
  counts?: S04ImportCounts;
}

/** Input options intentionally have no CSV, filename, token or payload field. */
export interface S04ImportObservabilityOptions
  extends Partial<
    Omit<S04ImportObservabilityContext, "stage" | "operation" | "counts">
  > {
  counts?: S04ImportCountsLike;
  /** Unknown keys are accepted at this boundary only to prove they are dropped. */
  [key: string]: unknown;
}

export interface S04ImportLog extends Omit<
  S04ImportObservabilityContext,
  "counts"
> {
  event: string;
  useCase: string;
  outcome: S04ImportOutcome;
  processedRows?: number;
  validRows?: number;
  invalidRows?: number;
  ignoredDuplicateRows?: number;
  importedRows?: number;
}

export type S04ImportLogInput = Partial<S04ImportLog> & Record<string, unknown> & {
  stage?: string;
  operation?: string;
  outcome?: string;
  counts?: S04ImportCountsLike;
};

const COUNT_KEYS = [
  "processed",
  "valid",
  "invalid",
  "ignoredDuplicate",
  "imported",
] as const;

type CountKey = (typeof COUNT_KEYS)[number];

const COUNT_ALIASES: Record<CountKey, readonly string[]> = {
  processed: ["processed", "processedRows", "processed_rows"],
  valid: ["valid", "validRows", "valid_rows"],
  invalid: ["invalid", "invalidRows", "invalid_rows"],
  ignoredDuplicate: [
    "ignoredDuplicate",
    "ignoredDuplicateRows",
    "ignored_duplicate_rows",
  ],
  imported: ["imported", "importedRows", "imported_rows"],
};

const MAX_IMPORT_ROWS = 10_000;
const MAX_STRING_LENGTH = 160;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const ERROR_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizedText(value: unknown, maxLength = MAX_STRING_LENGTH): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function opaqueId(value: unknown): string | undefined {
  const normalized = normalizedText(value);
  return normalized && OPAQUE_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function errorCode(value: unknown): string | undefined {
  const normalized = normalizedText(value, 64);
  return normalized && ERROR_CODE_PATTERN.test(normalized) ? normalized : undefined;
}

function finiteInteger(value: unknown, maximum = MAX_IMPORT_ROWS): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(maximum, Math.max(0, Math.round(value)));
}

function statusCode(value: unknown): number | undefined {
  return finiteInteger(value, 999);
}

function canonicalStage(value: unknown): S04ImportStage | undefined {
  switch (value) {
    case "upload":
      return "upload";
    case "parse":
      return "parse";
    case "preview":
      return "preview";
    case "confirm":
    case "confirmation":
    case "confirmacao":
      return "confirmation";
    default:
      return undefined;
  }
}

function canonicalOperation(value: unknown): S04ImportOperation | undefined {
  switch (value) {
    case "upload":
      return "upload";
    case "parse":
      return "parse";
    case "preview":
      return "preview";
    case "confirm":
    case "confirmation":
    case "confirmacao":
      return "confirm";
    default:
      return undefined;
  }
}

function operationForStage(stage: S04ImportStage): S04ImportOperation {
  return stage === "confirmation" ? "confirm" : stage;
}

function stageForOperation(operation: S04ImportOperation): S04ImportStage {
  return operation === "confirm" ? "confirmation" : operation;
}

function outcome(value: unknown): S04ImportOutcome | undefined {
  return S04_IMPORT_OUTCOMES.includes(value as S04ImportOutcome)
    ? (value as S04ImportOutcome)
    : undefined;
}

function getCount(value: Record<string, unknown>, key: CountKey): number | undefined {
  for (const alias of COUNT_ALIASES[key]) {
    const count = finiteInteger(value[alias]);
    if (count !== undefined) {
      return count;
    }
  }
  return undefined;
}

/**
 * Converts parser/result counts to a complete, finite aggregate.  Missing
 * counters are zero; arbitrary nested objects and row data are ignored.
 */
export function sanitizeS04ImportCounts(
  value: unknown,
): S04ImportCounts | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const source = isRecord(value.counts) ? value.counts : value;
  const values = COUNT_KEYS.map((key) => getCount(source, key));
  if (values.every((item) => item === undefined)) {
    return undefined;
  }

  return {
    processed: values[0] ?? 0,
    valid: values[1] ?? 0,
    invalid: values[2] ?? 0,
    ignoredDuplicate: values[3] ?? 0,
    imported: values[4] ?? 0,
  };
}

function configValue(
  value: unknown,
  fallback: string | undefined,
): string | undefined {
  return opaqueId(value) ?? opaqueId(fallback);
}

/** Reads only Sentry environment/release; the DSN is never copied. */
function configuredEnvironment(): Pick<
  S04ImportObservabilityContext,
  "environment" | "release"
> {
  try {
    const config = getServerSentryConfig();
    return {
      environment: opaqueId(config.environment),
      release: opaqueId(config.release),
    };
  } catch {
    return {};
  }
}

/**
 * Creates server-side metadata for one import boundary.  The preview bearer
 * token is deliberately not part of this type or this function's allow-list.
 */
export function createS04ImportOperation(
  stage: S04ImportStage | S04ImportOperation,
  options: S04ImportObservabilityOptions = {},
): S04ImportObservabilityContext {
  const normalizedStage =
    canonicalStage(stage) ?? stageForOperation(canonicalOperation(stage) ?? "upload");
  const configured = configuredEnvironment();
  const counts = sanitizeS04ImportCounts(options.counts);

  return {
    stage: normalizedStage,
    operation: operationForStage(normalizedStage),
    requestId: opaqueId(options.requestId),
    previewId: opaqueId(options.previewId),
    importId: opaqueId(options.importId),
    accountId: opaqueId(options.accountId),
    userId: opaqueId(options.userId),
    householdId: opaqueId(options.householdId),
    durationMs: finiteInteger(options.durationMs),
    statusCode: statusCode(options.statusCode),
    environment: configValue(options.environment, configured.environment),
    release: configValue(options.release, configured.release),
    errorCode: errorCode(options.errorCode),
    counts,
  };
}

/** Canonical operation/use-case name consumed by Sentry and log queries. */
export function s04ImportUseCaseName(
  stageOrOperation: S04ImportStage | S04ImportOperation,
): string {
  const operation =
    canonicalOperation(stageOrOperation) ??
    operationForStage(canonicalStage(stageOrOperation) ?? "upload");
  return `transactions.import.${operation}`;
}

export function s04ImportEventName(
  stageOrOperation: S04ImportStage | S04ImportOperation,
  result: S04ImportOutcome,
): string {
  const operation =
    canonicalOperation(stageOrOperation) ??
    operationForStage(canonicalStage(stageOrOperation) ?? "upload");
  return `s04_import_${operation}_${result}`;
}

function normalizedOperationContext(
  value: S04ImportObservabilityContext,
  durationMs?: number,
  counts?: S04ImportCountsLike,
  error?: string,
): S04ImportObservabilityContext {
  const safeCounts = sanitizeS04ImportCounts(counts) ?? value.counts;
  return {
    ...value,
    durationMs:
      finiteInteger(durationMs) ?? finiteInteger(value.durationMs) ?? 0,
    errorCode: errorCode(error) ?? errorCode(value.errorCode),
    counts: safeCounts,
  };
}

function flattenedCounts(value: unknown): Partial<S04ImportLog> {
  const counts = sanitizeS04ImportCounts(value);
  if (!counts) {
    return {};
  }

  return {
    processedRows: counts.processed,
    validRows: counts.valid,
    invalidRows: counts.invalid,
    ignoredDuplicateRows: counts.ignoredDuplicate,
    importedRows: counts.imported,
  };
}

/**
 * Final structured-log boundary.  It builds the event/use-case names from
 * the stage and operation instead of trusting caller-provided display text.
 */
export function sanitizeS04ImportLog(
  value: S04ImportLogInput,
): S04ImportLog | undefined {
  const suppliedStage =
    value.stage === undefined ? undefined : canonicalStage(value.stage);
  const suppliedOperation =
    value.operation === undefined
      ? undefined
      : canonicalOperation(value.operation);

  // An explicit but unknown/conflicting stage or operation is rejected.  A
  // caller cannot smuggle a display value into the event name by pairing a
  // valid stage with an unrelated operation.
  if (
    (value.stage !== undefined && !suppliedStage) ||
    (value.operation !== undefined && !suppliedOperation)
  ) {
    return undefined;
  }

  const stage =
    suppliedStage ??
    (suppliedOperation ? stageForOperation(suppliedOperation) : undefined);
  const operation =
    suppliedOperation ??
    (stage ? operationForStage(stage) : undefined);
  const result = outcome(value.outcome);

  if (!stage || !operation || !result || stageForOperation(operation) !== stage) {
    return undefined;
  }

  const counts = flattenedCounts(value.counts ?? value);
  const safe: S04ImportLog = {
    event: s04ImportEventName(operation, result),
    useCase: s04ImportUseCaseName(operation),
    stage,
    operation,
    outcome: result,
    ...counts,
  };

  const addId = (
    key: "requestId" | "previewId" | "importId" | "accountId" | "userId" | "householdId",
  ) => {
    const valueForKey = opaqueId(value[key]);
    if (valueForKey) {
      safe[key] = valueForKey;
    }
  };

  addId("requestId");
  addId("previewId");
  addId("importId");
  addId("accountId");
  addId("userId");
  addId("householdId");

  const durationMs = finiteInteger(value.durationMs);
  if (durationMs !== undefined) {
    safe.durationMs = durationMs;
  }

  const status = statusCode(value.statusCode);
  if (status !== undefined) {
    safe.statusCode = status;
  }

  const environment = opaqueId(value.environment);
  if (environment) {
    safe.environment = environment;
  }

  const release = opaqueId(value.release);
  if (release) {
    safe.release = release;
  }

  const safeErrorCode = errorCode(value.errorCode);
  if (safeErrorCode) {
    safe.errorCode = safeErrorCode;
  }

  return safe;
}

/** Converts S04 metadata to the shared Sentry context allow-list. */
export function toS04ObservabilityContext(
  operation: S04ImportObservabilityContext,
  result: S04ImportOutcome = "unexpected_error",
  counts?: S04ImportCountsLike,
  error?: string,
): ObservabilityContext {
  const context = normalizedOperationContext(operation, operation.durationMs, counts, error);
  const safe = sanitizeS04ImportLog({
    ...context,
    stage: context.stage,
    operation: context.operation,
    outcome: result,
    counts: context.counts,
  });

  return {
    event: s04ImportEventName(context.operation, result),
    useCase: s04ImportUseCaseName(context.operation),
    operation: context.operation,
    entityType: "transaction_import",
    stage: context.stage,
    requestId: context.requestId,
    previewId: context.previewId,
    importId: context.importId,
    accountId: context.accountId,
    userId: context.userId,
    householdId: context.householdId,
    durationMs: context.durationMs,
    statusCode: context.statusCode,
    environment: context.environment,
    release: context.release,
    errorCode: safe?.errorCode,
    processedRows: safe?.processedRows,
    validRows: safe?.validRows,
    invalidRows: safe?.invalidRows,
    ignoredDuplicateRows: safe?.ignoredDuplicateRows,
    importedRows: safe?.importedRows,
  };
}

/** Adds one technical breadcrumb for a stage; raw messages/data are omitted. */
export function addS04ImportBreadcrumb(
  operation: S04ImportObservabilityContext,
  result: S04ImportOutcome,
  durationMs?: number,
  error?: string,
  counts?: S04ImportCountsLike,
): void {
  const context = normalizedOperationContext(operation, durationMs, counts, error);
  const safe = sanitizeS04ImportLog({
    ...context,
    stage: context.stage,
    operation: context.operation,
    outcome: result,
    counts: context.counts,
  });
  if (!safe) {
    return;
  }

  addBreadcrumbSafely({
    type: "info",
    category: safe.useCase,
    data: {
      stage: safe.stage,
      operation: safe.operation,
      outcome: safe.outcome,
      request_id: safe.requestId,
      preview_id: safe.previewId,
      import_id: safe.importId,
      account_id: safe.accountId,
      user_id: safe.userId,
      household_id: safe.householdId,
      duration_ms: safe.durationMs,
      status_code: safe.statusCode,
      error_code: safe.errorCode,
      processed_rows: safe.processedRows,
      valid_rows: safe.validRows,
      invalid_rows: safe.invalidRows,
      ignored_duplicate_rows: safe.ignoredDuplicateRows,
      imported_rows: safe.importedRows,
    },
  });
}

/** Emits one aggregate JSON line; no result, row, request or error object is serialized. */
export function logS04ImportOperation(
  operation: S04ImportObservabilityContext,
  result: S04ImportOutcome,
  durationMs?: number,
  counts?: S04ImportCountsLike,
  error?: string,
): void {
  const context = normalizedOperationContext(operation, durationMs, counts, error);
  const safe = sanitizeS04ImportLog({
    ...context,
    stage: context.stage,
    operation: context.operation,
    outcome: result,
    counts: context.counts,
  });
  if (!safe) {
    return;
  }

  try {
    addS04ImportBreadcrumb(operation, result, durationMs, error, counts);
  } catch {
    // A breadcrumb failure must not change an import response.
  }

  try {
    const serialized = JSON.stringify(safe);
    if (result === "unexpected_error") {
      console.error(serialized);
    } else {
      console.info(serialized);
    }
  } catch {
    // Structured logging is best effort and intentionally non-blocking.
  }
}

/**
 * Reports an unexpected technical failure.  Expected parser/domain errors
 * are downgraded to an aggregate `expected_error` log and never captured.
 */
export function reportS04UnexpectedError(
  error: unknown,
  operation: S04ImportObservabilityContext,
  durationMs?: number,
  counts?: S04ImportCountsLike,
  technicalErrorCode?: string,
): void {
  if (isExpectedS04Error(error)) {
    logS04ImportOperation(
      operation,
      "expected_error",
      durationMs,
      counts,
      expectedS04ErrorCode(error),
    );
    return;
  }

  const safeTechnicalCode =
    errorCode(technicalErrorCode) ?? errorCode(readErrorCode(error)) ?? "UNEXPECTED_ERROR";
  const context = normalizedOperationContext(
    operation,
    durationMs,
    counts,
    safeTechnicalCode,
  );

  logS04ImportOperation(
    context,
    "unexpected_error",
    context.durationMs,
    context.counts,
    safeTechnicalCode,
  );

  try {
    captureServerException(
      error,
      toS04ObservabilityContext(
        context,
        "unexpected_error",
        context.counts,
        safeTechnicalCode,
      ),
    );
  } catch {
    // Sentry is best effort and must never change the import response.
  }
}

function readErrorCode(error: unknown): unknown {
  if (!isRecord(error)) {
    return undefined;
  }
  return error.code;
}

function isExpectedS04Code(code: string): boolean {
  return S04_IMPORT_EXPECTED_ERROR_CODES.includes(
    code as S04ImportExpectedErrorCode,
  );
}

/** Extracts only a stable code; messages/stacks are never inspected. */
export function expectedS04ErrorCode(error: unknown): string | undefined {
  const code = expectedS04ErrorCodeInternal(error);
  return code;
}

function expectedS04ErrorCodeInternal(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const direct = errorCode(error.code);
  if (direct && isExpectedS04Code(direct)) {
    return direct;
  }

  if (isRecord(error.error)) {
    const nested = errorCode(error.error.code);
    if (nested && isExpectedS04Code(nested)) {
      return nested;
    }
  }

  return undefined;
}

/** Validation/domain results are expected and must not create Sentry noise. */
export function isExpectedS04Error(error: unknown): boolean {
  return expectedS04ErrorCodeInternal(error) !== undefined;
}

/** A generic alias useful to adapters that only need a stable outcome. */
export function s04OutcomeForError(error: unknown): S04ImportOutcome {
  return isExpectedS04Error(error) ? "expected_error" : "unexpected_error";
}

/**
 * Small adapter helper for T06–T08.  It centralizes duration, expected-error
 * classification and best-effort Sentry capture while preserving the caller's
 * original return/throw behavior.
 */
export async function withS04ImportObservability<T>(
  operation: S04ImportObservabilityContext,
  work: () => Promise<T> | T,
  options: {
    counts?: S04ImportCountsLike;
    errorCode?: string;
  } = {},
): Promise<T> {
  const startedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const elapsed = () => {
    const now =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    return Math.max(0, Math.round(now - startedAt));
  };

  try {
    const value = await work();
    logS04ImportOperation(
      operation,
      "success",
      elapsed(),
      options.counts,
    );
    return value;
  } catch (error) {
    if (isExpectedS04Error(error)) {
      logS04ImportOperation(
        operation,
        "expected_error",
        elapsed(),
        options.counts,
        expectedS04ErrorCode(error),
      );
      throw error;
    }

    reportS04UnexpectedError(
      error,
      operation,
      elapsed(),
      options.counts,
      options.errorCode,
    );
    throw error;
  }
}

/** Naming aliases keep the helper discoverable in stage adapters. */
export const observeS04ImportStage = withS04ImportObservability;
export const captureS04UnexpectedError = reportS04UnexpectedError;
export const logS04ImportResult = logS04ImportOperation;
export const createS04ImportContext = createS04ImportOperation;
