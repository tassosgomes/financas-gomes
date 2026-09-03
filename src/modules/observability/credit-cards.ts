import { generateUuidV7 } from "@/lib/uuidv7";
import { FinancialContextError } from "@/modules/households/contracts";

import type { ObservabilityContext } from "./contracts";
import { addBreadcrumbSafely, captureServerException } from "./server";

/**
 * Code-owned names for every server boundary in the credit-card slice.
 *
 * The operation itself is the only source for event/use-case/stage names.
 * Callers can therefore pass an adapter result to this module without being
 * able to turn a card label, a query or a request value into telemetry.
 */
export const CREDIT_CARD_OPERATIONS = [
  "credit_card.create",
  "credit_card.update",
  "credit_card.archive",
  "credit_card.billing_rule.create",
  "credit_card.billing_rule.update",
  "credit_card.purchase.create",
  "credit_card.purchase.read",
  "credit_card.purchase.update_metadata",
  /** @deprecated retained for adapters published before ADR-007. */
  "credit_card.purchase.update",
  "credit_card.purchase.cancel",
  "credit_card.installment.generate",
  "credit_card.statement.read",
  "credit_card.obligation.read",
  "credit_card.limit.read",
  "credit_card.payment.create",
  "credit_card.payment.read",
] as const;

export type CreditCardOperation =
  (typeof CREDIT_CARD_OPERATIONS)[number];

/** Stable result values used by logs, metrics, breadcrumbs and Sentry. */
export const CREDIT_CARD_OUTCOMES = [
  "success",
  "expected_error",
  "unexpected_error",
] as const;

export type CreditCardOutcome =
  (typeof CREDIT_CARD_OUTCOMES)[number];

/** Stages are derived from the operation and never accepted as free text. */
export const CREDIT_CARD_STAGES = [
  "card",
  "billing_rule",
  "purchase",
  "installment",
  "statement",
  "projection",
  "payment",
] as const;

export type CreditCardStage = (typeof CREDIT_CARD_STAGES)[number];

/**
 * Domain/context failures are outcomes, not incidents. This is intentionally
 * closed: a provider or database message can never become an error code.
 */
export const CREDIT_CARD_EXPECTED_ERROR_CODES = [
  "UNAUTHENTICATED",
  "HOUSEHOLD_MEMBERSHIP_REQUIRED",
  "HOUSEHOLD_SELECTION_REQUIRED",
  "INVALID_FINANCIAL_CONTEXT",
  "INVALID_COMMAND",
  "INVALID_COMMAND_ID",
  "INVALID_NAME",
  "INVALID_AMOUNT",
  "INVALID_DATE",
  "DATE_IN_FUTURE",
  "INVALID_DESCRIPTION",
  "INVALID_ACCOUNT_ID",
  "INVALID_CARD_ID",
  "INVALID_CREDIT_CARD_ID",
  "INVALID_PURCHASE_ID",
  "INVALID_PAYMENT_ID",
  "INVALID_BILLING_RULE_ID",
  "INVALID_BILLING_RULE",
  "INVALID_BILLING_RULE_RANGE",
  "INVALID_BILLING_DUE_OVERRIDE",
  "BILLING_DUE_OVERRIDE_NOT_AFTER_CLOSING",
  "INVALID_CLOSING_DAY",
  "INVALID_DUE_DAY",
  "INVALID_INSTALLMENT_COUNT",
  "INSTALLMENT_COUNT_OUT_OF_RANGE",
  "AMOUNT_OUT_OF_RANGE",
  "INVALID_STATEMENT_PERIOD",
  "INVALID_STATE",
  "ACCOUNT_NOT_FOUND",
  "ACCOUNT_ARCHIVED",
  "ACCOUNT_NOT_CREDIT_CARD",
  "PAYMENT_ACCOUNT_NOT_FOUND",
  "PAYMENT_ACCOUNT_ARCHIVED",
  "PAYMENT_ACCOUNT_INVALID",
  "CATEGORY_NOT_FOUND",
  "CATEGORY_ARCHIVED",
  "CATEGORY_KIND_MISMATCH",
  "RESOURCE_ARCHIVED",
  "CREDIT_CARD_NOT_FOUND",
  "CREDIT_CARD_ARCHIVED",
  "CREDIT_CARD_INVALID",
  "CARD_NOT_FOUND",
  "CARD_ARCHIVED",
  "CARD_NOT_ACTIVE",
  "PURCHASE_NOT_FOUND",
  "PURCHASE_ALREADY_CANCELLED",
  "PURCHASE_NOT_EDITABLE",
  "INSTALLMENT_PLAN_NOT_FOUND",
  "INSTALLMENT_NOT_FOUND",
  "INVALID_INSTALLMENT",
  "INVALID_INSTALLMENT_PLAN",
  "SCHEDULE_INVARIANT_VIOLATION",
  "PLAN_ALREADY_CANCELLED",
  "BILLING_RULE_NOT_FOUND",
  "BILLING_RULE_NOT_APPLICABLE",
  "EVENT_NOT_FOUND",
  "EVENT_ALREADY_CANCELLED",
  "COMMAND_ID_REUSED",
  "DUPLICATE_CREDIT_CARD",
  "DUPLICATE_PURCHASE",
  "DUPLICATE_PAYMENT",
  "CREDIT_CARD_NAME_CONFLICT",
  "CARD_NAME_CONFLICT",
  "BILLING_RULE_OVERLAP",
  "BILLING_RULE_CONFLICT",
  "RESOURCE_CONFLICT",
  "CONFLICT",
  "NON_EDITABLE_FIELD",
  "INSTALLMENT_MUTATION_FORBIDDEN",
  "PAYMENT_INSTALLMENT_FORBIDDEN",
] as const;

export type CreditCardExpectedErrorCode =
  (typeof CREDIT_CARD_EXPECTED_ERROR_CODES)[number];

/** Technical labels are closed so SQL/provider text cannot enter telemetry. */
export const CREDIT_CARD_TECHNICAL_ERROR_CODES = [
  "CARD_PERSISTENCE_FAILED",
  "CREDIT_CARD_PERSISTENCE_FAILED",
  "BILLING_RULE_PERSISTENCE_FAILED",
  "PURCHASE_PERSISTENCE_FAILED",
  "INSTALLMENT_PERSISTENCE_FAILED",
  "STATEMENT_QUERY_FAILED",
  "PROJECTION_QUERY_FAILED",
  "PAYMENT_PERSISTENCE_FAILED",
  "PAYMENT_QUERY_FAILED",
  "CANCEL_PERSISTENCE_FAILED",
  "QUERY_FAILED",
  "PERSISTENCE_FAILED",
  "DATABASE_ERROR",
  "UNEXPECTED_PERSISTENCE_FAILURE",
  "UNEXPECTED_ERROR",
] as const;

export type CreditCardTechnicalErrorCode =
  (typeof CREDIT_CARD_TECHNICAL_ERROR_CODES)[number];

export type CreditCardErrorCode =
  | CreditCardExpectedErrorCode
  | CreditCardTechnicalErrorCode;

export interface CreditCardAggregateCounts {
  /** Number of installments in the aggregate, never their values. */
  installmentCount?: number;
  /** Number of rows/items in a statement or projection. */
  statementItemCount?: number;
  projectedItemCount?: number;
  postedItemCount?: number;
  cancelledItemCount?: number;
}

export interface CreditCardOperationOptions
  extends CreditCardAggregateCounts {
  requestId?: string;
  /** Alias accepted from HTTP boundaries; emitted as one request ID. */
  correlationId?: string;
  userId?: string;
  householdId?: string;
  cardId?: string;
  purchaseId?: string;
  eventId?: string;
  installmentPlanId?: string;
  installmentId?: string;
  billingRuleId?: string;
  paymentId?: string;
  durationMs?: number;
  statusCode?: number;
}

export interface CreditCardOperationContext
  extends CreditCardAggregateCounts {
  operation: CreditCardOperation;
  stage: CreditCardStage;
  requestId?: string;
  userId?: string;
  householdId?: string;
  cardId?: string;
  purchaseId?: string;
  eventId?: string;
  installmentPlanId?: string;
  installmentId?: string;
  billingRuleId?: string;
  paymentId?: string;
  durationMs?: number;
  statusCode?: number;
}

export interface CreditCardLog extends CreditCardOperationContext {
  event: string;
  useCase: CreditCardOperation;
  outcome: CreditCardOutcome;
  errorCode?: CreditCardErrorCode;
  slowQuery?: boolean;
  slowQueryThresholdMs?: number;
}

/**
 * Untrusted input accepted by the final allow-list.  Code-owned fields are
 * intentionally `unknown` here so a caller cannot smuggle a display label
 * into the type boundary; `sanitizeCreditCardLog` validates them again.
 */
export type CreditCardLogInput =
  Omit<Partial<CreditCardLog>, "event" | "useCase" | "stage" | "errorCode"> &
  {
    event?: unknown;
    useCase?: unknown;
    stage?: unknown;
    errorCode?: unknown;
  } &
  Record<string, unknown>;

export interface CreditCardObservabilityHooks {
  /** Receives an already allow-listed aggregate record. */
  onRecord?: (record: CreditCardLog) => void;
  /** Alias for metric adapters that do not emit application logs. */
  onMetric?: (record: CreditCardLog) => void;
}

export interface CreditCardCompletionOptions
  extends CreditCardAggregateCounts,
    CreditCardObservabilityHooks {
  durationMs?: number;
  errorCode?: string;
  technicalErrorCode?: string;
  now?: () => number;
}

export interface CreditCardQueryOptions
  extends CreditCardAggregateCounts,
    CreditCardObservabilityHooks {
  thresholdMs?: number;
  now?: () => number;
  technicalErrorCode?: string;
}

export interface CreditCardErrorClassification {
  outcome: "expected_error" | "unexpected_error";
  errorCode: CreditCardErrorCode;
}

export interface CreditCardSafeErrorEnvelope {
  ok: false;
  error: { code: CreditCardErrorCode };
}

export const DEFAULT_CREDIT_CARD_SLOW_QUERY_THRESHOLD_MS = 250;
export const MAX_CREDIT_CARD_SLOW_QUERY_THRESHOLD_MS = 60_000;
export const MAX_CREDIT_CARD_AGGREGATE_COUNT = 10_000;

const OPERATION_SET = new Set<string>(CREDIT_CARD_OPERATIONS);
const OUTCOME_SET = new Set<string>(CREDIT_CARD_OUTCOMES);
const EXPECTED_ERROR_SET = new Set<string>(
  CREDIT_CARD_EXPECTED_ERROR_CODES,
);
const TECHNICAL_ERROR_SET = new Set<string>(
  CREDIT_CARD_TECHNICAL_ERROR_CODES,
);
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/u;

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
  maximum = MAX_CREDIT_CARD_AGGREGATE_COUNT,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(maximum, Math.max(0, Math.round(value)));
}

function statusCode(value: unknown): number | undefined {
  return finiteInteger(value, 999);
}

function operationValue(value: unknown): CreditCardOperation | undefined {
  return typeof value === "string" && OPERATION_SET.has(value)
    ? (value as CreditCardOperation)
    : undefined;
}

function outcomeValue(value: unknown): CreditCardOutcome | undefined {
  return typeof value === "string" && OUTCOME_SET.has(value)
    ? (value as CreditCardOutcome)
    : undefined;
}

function stageForOperation(
  operation: CreditCardOperation,
): CreditCardStage {
  if (operation.startsWith("credit_card.billing_rule.")) {
    return "billing_rule";
  }
  if (operation.startsWith("credit_card.purchase.")) {
    return "purchase";
  }
  if (operation === "credit_card.installment.generate") {
    return "installment";
  }
  if (operation === "credit_card.statement.read") {
    return "statement";
  }
  if (
    operation === "credit_card.obligation.read" ||
    operation === "credit_card.limit.read"
  ) {
    return "projection";
  }
  if (operation.startsWith("credit_card.payment.")) {
    return "payment";
  }
  return "card";
}

function operationSlug(operation: CreditCardOperation): string {
  return operation.replaceAll(".", "_");
}

function eventName(
  operation: CreditCardOperation,
  outcome: CreditCardOutcome,
): string {
  return `credit_card_${operationSlug(operation)}_${outcome}`;
}

function normalizedErrorCode(value: unknown): CreditCardErrorCode | undefined {
  if (
    typeof value !== "string" ||
    !ERROR_CODE_PATTERN.test(value) ||
    (!EXPECTED_ERROR_SET.has(value) && !TECHNICAL_ERROR_SET.has(value))
  ) {
    return undefined;
  }

  return value as CreditCardErrorCode;
}

function technicalErrorCode(value: unknown): CreditCardTechnicalErrorCode {
  return TECHNICAL_ERROR_SET.has(value as string)
    ? (value as CreditCardTechnicalErrorCode)
    : "UNEXPECTED_ERROR";
}

function aggregateValue(
  value: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const result = finiteInteger(value[key]);
    if (result !== undefined) {
      return result;
    }
  }
  return undefined;
}

/** Keep only bounded aggregate counts; rows, values and payloads are dropped. */
export function sanitizeCreditCardCounts(
  value: unknown,
): CreditCardAggregateCounts | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const source = isRecord(value.counts) ? value.counts : value;
  const result: CreditCardAggregateCounts = {};
  const installmentCount = aggregateValue(source, [
    "installmentCount",
    "installment_count",
    "installments",
    "parcelCount",
    "parcel_count",
  ]);
  const statementItemCount = aggregateValue(source, [
    "statementItemCount",
    "statement_item_count",
    "itemCount",
    "item_count",
    "items",
  ]);
  const projectedItemCount = aggregateValue(source, [
    "projectedItemCount",
    "projected_item_count",
  ]);
  const postedItemCount = aggregateValue(source, [
    "postedItemCount",
    "posted_item_count",
  ]);
  const cancelledItemCount = aggregateValue(source, [
    "cancelledItemCount",
    "cancelled_item_count",
  ]);

  if (installmentCount !== undefined) {
    result.installmentCount = installmentCount;
  }
  if (statementItemCount !== undefined) {
    result.statementItemCount = statementItemCount;
  }
  if (projectedItemCount !== undefined) {
    result.projectedItemCount = projectedItemCount;
  }
  if (postedItemCount !== undefined) {
    result.postedItemCount = postedItemCount;
  }
  if (cancelledItemCount !== undefined) {
    result.cancelledItemCount = cancelledItemCount;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function aggregateInput(value: Record<string, unknown>): CreditCardAggregateCounts {
  return sanitizeCreditCardCounts(value) ?? {};
}

function addSafeId(
  target: CreditCardOperationContext,
  key:
    | "requestId"
    | "userId"
    | "householdId"
    | "cardId"
    | "purchaseId"
    | "eventId"
    | "installmentPlanId"
    | "installmentId"
    | "billingRuleId"
    | "paymentId",
  value: unknown,
): void {
  const safe = opaqueId(value);
  if (safe) {
    target[key] = safe;
  }
}

/**
 * Builds operation metadata and generates a correlation ID when a boundary
 * does not already have one. No command or financial field is copied.
 */
export function createCreditCardOperation(
  operation: CreditCardOperation,
  options: CreditCardOperationOptions = {},
): CreditCardOperationContext {
  let requestId = opaqueId(options.requestId ?? options.correlationId);
  if (!requestId) {
    try {
      requestId = opaqueId(generateUuidV7());
    } catch {
      requestId = undefined;
    }
  }

  const result: CreditCardOperationContext = {
    operation,
    stage: stageForOperation(operation),
    installmentCount: finiteInteger(options.installmentCount),
    statementItemCount: finiteInteger(options.statementItemCount),
    projectedItemCount: finiteInteger(options.projectedItemCount),
    postedItemCount: finiteInteger(options.postedItemCount),
    cancelledItemCount: finiteInteger(options.cancelledItemCount),
  };

  addSafeId(result, "requestId", requestId);
  addSafeId(result, "userId", options.userId);
  addSafeId(result, "householdId", options.householdId);
  addSafeId(result, "cardId", options.cardId);
  addSafeId(result, "purchaseId", options.purchaseId);
  addSafeId(result, "eventId", options.eventId);
  addSafeId(result, "installmentPlanId", options.installmentPlanId);
  addSafeId(result, "installmentId", options.installmentId);
  addSafeId(result, "billingRuleId", options.billingRuleId);
  addSafeId(result, "paymentId", options.paymentId);

  const durationMs = finiteInteger(options.durationMs, 86_400_000);
  if (durationMs !== undefined) {
    result.durationMs = durationMs;
  }
  const status = statusCode(options.statusCode);
  if (status !== undefined) {
    result.statusCode = status;
  }

  return result;
}

/** Canonical operation/use-case identifier for adapters and metrics. */
export function creditCardUseCaseName(
  operation: CreditCardOperation,
): CreditCardOperation {
  return operation;
}

export function creditCardEventName(
  operation: CreditCardOperation,
  outcome: CreditCardOutcome,
): string {
  return eventName(operation, outcome);
}

/**
 * Final allow-list for application logs and metric callbacks. Caller-supplied
 * event/use-case/stage and unknown fields are ignored and rebuilt from the
 * closed operation vocabulary.
 */
export function sanitizeCreditCardLog(
  value: CreditCardLogInput,
): CreditCardLog | undefined {
  try {
    const operation = operationValue(value.operation);
    const outcome = outcomeValue(value.outcome);
    if (!operation || !outcome) {
      return undefined;
    }

    const expectedStage = stageForOperation(operation);
    if (value.stage !== undefined && value.stage !== expectedStage) {
      return undefined;
    }

    const counts = aggregateInput(value);
    const safe: CreditCardLog = {
      event: eventName(operation, outcome),
      useCase: operation,
      operation,
      stage: expectedStage,
      outcome,
      ...counts,
    };

    const addId = (
      key:
        | "requestId"
        | "userId"
        | "householdId"
        | "cardId"
        | "purchaseId"
        | "eventId"
        | "installmentPlanId"
        | "installmentId"
        | "billingRuleId"
        | "paymentId",
    ) => addSafeId(safe, key, value[key]);

    addId("requestId");
    addId("userId");
    addId("householdId");
    addId("cardId");
    addId("purchaseId");
    addId("eventId");
    addId("installmentPlanId");
    addId("installmentId");
    addId("billingRuleId");
    addId("paymentId");

    const durationMs = finiteInteger(value.durationMs, 86_400_000);
    if (durationMs !== undefined) {
      safe.durationMs = durationMs;
    }
    const status = statusCode(value.statusCode);
    if (status !== undefined) {
      safe.statusCode = status;
    }

    const errorCode = normalizedErrorCode(value.errorCode);
    if (errorCode) {
      safe.errorCode = errorCode;
    }

    if (typeof value.slowQuery === "boolean") {
      safe.slowQuery = value.slowQuery;
    }
    const threshold = finiteInteger(
      value.slowQueryThresholdMs,
      MAX_CREDIT_CARD_SLOW_QUERY_THRESHOLD_MS,
    );
    if (threshold !== undefined) {
      safe.slowQueryThresholdMs = threshold;
    }

    return safe;
  } catch {
    return undefined;
  }
}

function primaryEntityId(value: CreditCardLog): string | undefined {
  return (
    value.purchaseId ??
    value.paymentId ??
    value.cardId ??
    value.billingRuleId ??
    value.installmentPlanId ??
    value.installmentId
  );
}

/** Converts only S06 technical metadata to the shared Sentry context shape. */
export function toCreditCardObservabilityContext(
  operation: CreditCardOperationContext,
  outcome: CreditCardOutcome = "unexpected_error",
  options: CreditCardCompletionOptions = {},
): ObservabilityContext {
  const safe = sanitizeCreditCardLog({
    ...operation,
    ...options,
    operation: operation.operation,
    stage: operation.stage,
    outcome,
  });

  const fallbackOperation = operationValue(operation.operation) ??
    "credit_card.create";
  return {
    event: safe?.event ?? eventName(fallbackOperation, outcome),
    useCase: safe?.useCase ?? fallbackOperation,
    operation: fallbackOperation,
    entityType: "credit_card",
    entityId: safe ? primaryEntityId(safe) : undefined,
    cardId: safe?.cardId,
    purchaseId: safe?.purchaseId,
    installmentPlanId: safe?.installmentPlanId,
    installmentId: safe?.installmentId,
    billingRuleId: safe?.billingRuleId,
    paymentId: safe?.paymentId,
    eventId: safe?.eventId,
    requestId: safe?.requestId,
    userId: safe?.userId,
    householdId: safe?.householdId,
    durationMs: safe?.durationMs,
    statusCode: safe?.statusCode,
    stage: safe?.stage,
    errorCode: safe?.errorCode,
  };
}

/** Adds one technical breadcrumb; no raw message, payload or query is used. */
export function addCreditCardBreadcrumb(
  operation: CreditCardOperationContext,
  outcome: CreditCardOutcome,
  options: CreditCardCompletionOptions = {},
): void {
  const safe = sanitizeCreditCardLog({
    ...operation,
    ...options,
    operation: operation.operation,
    stage: operation.stage,
    outcome,
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
      event_id: safe.eventId ?? primaryEntityId(safe),
      card_id: safe.cardId,
      purchase_id: safe.purchaseId,
      installment_plan_id: safe.installmentPlanId,
      installment_id: safe.installmentId,
      billing_rule_id: safe.billingRuleId,
      payment_id: safe.paymentId,
      account_id: safe.cardId,
      duration_ms: safe.durationMs,
      status_code: safe.statusCode,
      error_code: safe.errorCode,
      installment_count: safe.installmentCount,
      statement_item_count: safe.statementItemCount,
    },
  });
}

function emitRecord(
  safe: CreditCardLog,
  hooks: CreditCardObservabilityHooks = {},
  level: "info" | "warn" | "error" =
    safe.outcome === "unexpected_error" ? "error" : "info",
): void {
  try {
    addCreditCardBreadcrumb(
      safe,
      safe.outcome,
      safe,
    );
  } catch {
    // Observability is best effort and never changes the operation result.
  }

  try {
    hooks.onRecord?.(safe);
    hooks.onMetric?.(safe);
  } catch {
    // Metrics providers must not affect a card command or read.
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

export function logCreditCardOperation(
  operation: CreditCardOperationContext,
  outcome: CreditCardOutcome,
  options: CreditCardCompletionOptions = {},
): CreditCardLog | undefined {
  const safe = sanitizeCreditCardLog({
    ...operation,
    ...options,
    operation: operation.operation,
    stage: operation.stage,
    outcome,
  });
  if (!safe) {
    return undefined;
  }

  emitRecord(safe, options);
  return safe;
}

function errorCodeFrom(error: unknown): unknown {
  if (!isRecord(error)) {
    return undefined;
  }
  if (typeof error.code === "string") {
    return error.code;
  }
  return isRecord(error.error) ? error.error.code : undefined;
}

export function expectedCreditCardErrorCode(
  error: unknown,
): CreditCardExpectedErrorCode | undefined {
  if (error instanceof FinancialContextError) {
    return EXPECTED_ERROR_SET.has(error.code)
      ? (error.code as CreditCardExpectedErrorCode)
      : undefined;
  }

  const code = errorCodeFrom(error);
  return typeof code === "string" && EXPECTED_ERROR_SET.has(code)
    ? (code as CreditCardExpectedErrorCode)
    : undefined;
}

/** Classifies only known domain codes; error messages are never inspected. */
export function classifyCreditCardError(
  error: unknown,
): CreditCardErrorClassification {
  const expectedCode = expectedCreditCardErrorCode(error);
  return expectedCode
    ? { outcome: "expected_error", errorCode: expectedCode }
    : { outcome: "unexpected_error", errorCode: "UNEXPECTED_ERROR" };
}

export function isExpectedCreditCardError(error: unknown): boolean {
  return expectedCreditCardErrorCode(error) !== undefined;
}

export function toCreditCardErrorEnvelope(
  error: unknown,
): CreditCardSafeErrorEnvelope {
  const classification = classifyCreditCardError(error);
  return { ok: false, error: { code: classification.errorCode } };
}

/** Reports one unexpected technical failure without changing caller control flow. */
export function reportCreditCardUnexpectedError(
  error: unknown,
  operation: CreditCardOperationContext,
  options: CreditCardCompletionOptions = {},
): CreditCardErrorClassification {
  const classification = classifyCreditCardError(error);
  const code =
    classification.outcome === "expected_error"
      ? classification.errorCode
      : technicalErrorCode(
          options.technicalErrorCode ?? errorCodeFrom(error),
        );
  const safeOptions = { ...options, errorCode: code };

  logCreditCardOperation(
    operation,
    classification.outcome,
    safeOptions,
  );

  if (classification.outcome === "unexpected_error") {
    try {
      captureServerException(
        error,
        toCreditCardObservabilityContext(operation, "unexpected_error", {
          ...options,
          errorCode: code,
        }),
      );
    } catch {
      // Sentry is best effort and cannot change the response path.
    }
  }

  return {
    outcome: classification.outcome,
    errorCode: code,
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

/**
 * Wraps card commands and reads. Expected Result errors remain ordinary
 * outcomes; technical exceptions are captured and rethrown.
 */
export async function withCreditCardObservability<T>(
  operation: CreditCardOperationContext,
  work: () => Promise<T> | T,
  options: CreditCardCompletionOptions = {},
): Promise<T> {
  const now = options.now ?? monotonicNow;
  const startedAt = now();

  try {
    const value = await work();
    const failure = resultFailure(value);
    const durationMs = elapsedMs(startedAt, now);
    if (failure.failed) {
      const classification = classifyCreditCardError(failure.error);
      if (classification.outcome === "expected_error") {
        logCreditCardOperation(operation, "expected_error", {
          ...options,
          durationMs,
          errorCode: classification.errorCode,
        });
      } else {
        reportCreditCardUnexpectedError(failure.error, operation, {
          ...options,
          durationMs,
        });
      }
      return value;
    }

    logCreditCardOperation(operation, "success", {
      ...options,
      durationMs,
    });
    return value;
  } catch (error) {
    const durationMs = elapsedMs(startedAt, now);
    const classification = classifyCreditCardError(error);
    if (classification.outcome === "expected_error") {
      logCreditCardOperation(operation, "expected_error", {
        ...options,
        durationMs,
        errorCode: classification.errorCode,
      });
      throw error;
    }

    reportCreditCardUnexpectedError(error, operation, {
      ...options,
      durationMs,
    });
    throw error;
  }
}

function safeThreshold(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(
      MAX_CREDIT_CARD_SLOW_QUERY_THRESHOLD_MS,
      Math.max(0, Math.round(value)),
    );
  }
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    return safeThreshold(Number(value.trim()));
  }
  return undefined;
}

export function getCreditCardSlowQueryThresholdMs(value?: unknown): number {
  return (
    safeThreshold(
      value ??
        process.env.CREDIT_CARD_SLOW_QUERY_THRESHOLD_MS ??
        process.env.S06_SLOW_QUERY_THRESHOLD_MS,
    ) ??
    DEFAULT_CREDIT_CARD_SLOW_QUERY_THRESHOLD_MS
  );
}

/** Measures only duration and aggregate technical state; SQL is not accepted. */
export async function measureCreditCardQuery<T>(
  operation: CreditCardOperationContext,
  work: () => Promise<T> | T,
  options: CreditCardQueryOptions = {},
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
    const thresholdMs = getCreditCardSlowQueryThresholdMs(options.thresholdMs);
    if (durationMs >= thresholdMs) {
      const returnedFailure = resultFailure(returnedValue);
      const classification = failed
        ? classifyCreditCardError(thrownError)
        : returnedFailure.failed
          ? classifyCreditCardError(returnedFailure.error)
          : undefined;
      const safe = sanitizeCreditCardLog({
        ...operation,
        ...options,
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
        slowQuery: true,
        slowQueryThresholdMs: thresholdMs,
      });
      if (safe) {
        try {
          addCreditCardBreadcrumb(safe, safe.outcome, safe);
          options.onRecord?.(safe);
          options.onMetric?.(safe);
          console.warn(JSON.stringify(safe));
        } catch {
          // Slow-query telemetry remains best effort.
        }
      }
    }
  }
}

/** Naming aliases keep the adapter discoverable by each S06 backend task. */
export const createCreditCardContext = createCreditCardOperation;
export const sanitizeCreditCardObservabilityLog = sanitizeCreditCardLog;
export const observeCreditCardOperation = withCreditCardObservability;
export const observeCreditCardQuery = measureCreditCardQuery;
export const captureCreditCardUnexpectedError = reportCreditCardUnexpectedError;
