import { FinancialContextError } from "@/modules/households/contracts";
import type { FinancialContext } from "@/modules/households/contracts";
import {
  S03_ERROR_CODES,
  S03_ERROR_MESSAGES,
  type S03Error,
  type S03ErrorCode,
  type S03ErrorField,
} from "@/modules/transactions/contracts";

export {
  S03_ERROR_CODES,
  S03_ERROR_MESSAGES,
} from "@/modules/transactions/contracts";
export type {
  S03Error,
  S03ErrorCode,
  S03ErrorField,
  S03Result,
} from "@/modules/transactions/contracts";

import { addBreadcrumbSafely, captureServerException } from "./server";
import {
  buildCrudObservabilityContext,
  logObservability,
  toCrudObservabilityContext,
  type CrudObservabilityContext,
  type ObservabilityOutcome,
} from "./logger";

/**
 * Stable operation vocabulary for the manual transaction slice. The kind is
 * kept separately so logs can aggregate create/update/cancel without ever
 * receiving a command or a financial value.
 */
export const S03_TRANSACTION_OPERATIONS = [
  "create",
  "update",
  "cancel",
] as const;

export type S03TransactionOperation =
  (typeof S03_TRANSACTION_OPERATIONS)[number];

export const S03_TRANSACTION_KINDS = ["EXPENSE", "INCOME", "MANUAL"] as const;

export type S03TransactionKind = (typeof S03_TRANSACTION_KINDS)[number];

export interface S03TransactionObservabilityContext
  extends CrudObservabilityContext {
  operation: S03TransactionOperation;
  entityType: "transaction";
  transactionKind: S03TransactionKind;
  /** The FinancialEvent ID, never a description or a command payload. */
  eventId?: string;
}

export type S03TransactionObservabilityOptions = Omit<
  Partial<S03TransactionObservabilityContext>,
  "operation" | "entityType" | "transactionKind"
>;

function opaqueTechnicalId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized && /^[A-Za-z0-9._:/-]+$/u.test(normalized)
    ? normalized.slice(0, 160)
    : undefined;
}

/**
 * Creates the server-side operation metadata consumed by logs and Sentry.
 * `eventId` is optional because a create operation only obtains it after the
 * database write succeeds. `entityId` is accepted as a compatibility alias,
 * but both values are still treated as opaque technical identifiers.
 */
export function createS03TransactionOperation(
  operation: S03TransactionOperation,
  transactionKind: S03TransactionKind,
  options: S03TransactionObservabilityOptions = {},
): S03TransactionObservabilityContext {
  const eventId = opaqueTechnicalId(options.eventId ?? options.entityId);
  const context = buildCrudObservabilityContext(operation, "transaction", {
    entityId: eventId,
    eventId,
    transactionKind,
    requestId: opaqueTechnicalId(options.requestId),
    userId: opaqueTechnicalId(options.userId),
    householdId: opaqueTechnicalId(options.householdId),
    durationMs:
      typeof options.durationMs === "number" && Number.isFinite(options.durationMs)
        ? Math.max(0, Math.round(options.durationMs))
        : undefined,
    statusCode:
      typeof options.statusCode === "number" && Number.isFinite(options.statusCode)
        ? Math.round(options.statusCode)
        : undefined,
  });

  return {
    ...context,
    entityType: "transaction",
    operation,
    transactionKind,
  };
}

function kindSegment(kind: S03TransactionKind): string {
  return kind.toLowerCase();
}

/** Names match the application command operations fixed by ADR-004. */
export function s03TransactionUseCaseName(
  operation: S03TransactionOperation,
  transactionKind: S03TransactionKind,
): string {
  return operation === "create"
    ? `transactions.create.${kindSegment(transactionKind)}`
    : `transactions.${operation}.manual`;
}

export function s03TransactionEventName(
  operation: S03TransactionOperation,
  transactionKind: S03TransactionKind,
  outcome: ObservabilityOutcome,
): string {
  return `s03_transaction_${operation}_${kindSegment(transactionKind)}_${outcome}`;
}

/**
 * Adds a flow breadcrumb containing only the same technical allow-list used
 * by the Sentry event boundary. It is safe to call even when Sentry is off.
 */
export function addS03TransactionBreadcrumb(
  operation: S03TransactionObservabilityContext,
  outcome: ObservabilityOutcome,
  durationMs?: number,
  errorCode?: string,
): void {
  addBreadcrumbSafely({
    type: "info",
    category: s03TransactionUseCaseName(
      operation.operation,
      operation.transactionKind,
    ),
    data: {
      operation: operation.operation,
      transaction_kind: operation.transactionKind,
      event_id: operation.eventId ?? operation.entityId,
      outcome,
      duration_ms:
        typeof durationMs === "number" && Number.isFinite(durationMs)
          ? Math.max(0, Math.round(durationMs))
          : undefined,
      error_code: errorCode,
    },
  });
}

function contextForOperation(
  operation: S03TransactionObservabilityContext,
  durationMs: number,
  financialContext?: FinancialContext,
): S03TransactionObservabilityContext {
  const safeDurationMs =
    typeof durationMs === "number" && Number.isFinite(durationMs)
      ? Math.max(0, Math.round(durationMs))
      : 0;

  return createS03TransactionOperation(
    operation.operation,
    operation.transactionKind,
    {
      ...operation,
      entityId: operation.entityId ?? operation.eventId,
      eventId: operation.eventId,
      userId: financialContext?.userId ?? operation.userId,
      householdId: financialContext?.householdId ?? operation.householdId,
      durationMs: safeDurationMs,
    },
  );
}

/**
 * Emits technical metadata for a completed operation. The result and input
 * are intentionally absent; expected errors are represented by their stable
 * code only.
 */
export function logS03TransactionOperation(
  operation: S03TransactionObservabilityContext,
  outcome: ObservabilityOutcome,
  durationMs: number,
  financialContext?: FinancialContext,
  errorCode?: string,
): void {
  const context = contextForOperation(operation, durationMs, financialContext);
  try {
    addS03TransactionBreadcrumb(context, outcome, durationMs, errorCode);
  } catch {
    // A breadcrumb implementation/configuration failure is non-blocking.
  }
  logObservability(outcome === "unexpected_error" ? "error" : "info", {
    ...context,
    event: s03TransactionEventName(
      operation.operation,
      operation.transactionKind,
      outcome,
    ),
    useCase: s03TransactionUseCaseName(
      operation.operation,
      operation.transactionKind,
    ),
    outcome,
    errorCode,
  });
}

/**
 * Reports an unexpected persistence/infrastructure failure. The exception is
 * passed to the Sentry boundary for technical stack diagnostics; its
 * sanitizer removes message, request and payload data before transport.
 */
export function reportS03UnexpectedError(
  error: unknown,
  operation: S03TransactionObservabilityContext,
  durationMs: number,
  financialContext?: FinancialContext,
): void {
  const context = contextForOperation(operation, durationMs, financialContext);
  const sentryContext = {
    ...toCrudObservabilityContext(context),
    event: s03TransactionEventName(
      operation.operation,
      operation.transactionKind,
      "unexpected_error",
    ),
    useCase: s03TransactionUseCaseName(
      operation.operation,
      operation.transactionKind,
    ),
  };

  logS03TransactionOperation(
    operation,
    "unexpected_error",
    durationMs,
    financialContext,
  );

  try {
    captureServerException(error, sentryContext);
  } catch {
    // Sentry is best effort and must never change the use-case response path.
  }
}

const S03_ERROR_FIELDS = new Set<S03ErrorField>([
  "commandId",
  "amountCents",
  "occurredOn",
  "description",
  "accountId",
  "categoryId",
  "financialEventId",
]);

/** Returns a status suitable for an HTTP adapter without exposing details. */
export function statusForS03Error(code: S03ErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "ACCOUNT_NOT_FOUND":
    case "CATEGORY_NOT_FOUND":
    case "EVENT_NOT_FOUND":
      return 404;
    case "RESOURCE_ARCHIVED":
    case "TRACKING_START_DATE_VIOLATION":
    case "CATEGORY_KIND_MISMATCH":
    case "EVENT_NOT_MANUAL":
    case "EVENT_NOT_POSTED":
    case "EVENT_ALREADY_CANCELLED":
    case "REVERSAL_ALREADY_EXISTS":
    case "NON_EDITABLE_FIELD":
    case "COMMAND_ID_REUSED":
      return 409;
    default:
      return 400;
  }
}

function codeFromError(error: unknown): string | undefined {
  if (
    !error ||
    typeof error !== "object" ||
    !("code" in error) ||
    typeof (error as { code?: unknown }).code !== "string"
  ) {
    return undefined;
  }

  return (error as { code: string }).code;
}

/** Only these codes may be treated as an expected business failure. */
export function isExpectedS03Error(error: unknown): boolean {
  if (error instanceof FinancialContextError) {
    return true;
  }

  const code = codeFromError(error);
  return typeof code === "string" && S03_ERROR_CODES.includes(code as S03ErrorCode);
}

/**
 * Converts an expected exception/result error into the public stable shape.
 * Callers should use {@link isExpectedS03Error} before invoking this helper;
 * unknown technical exceptions intentionally fall back to a generic message.
 */
export function toS03Error(error: unknown): S03Error {
  if (error instanceof FinancialContextError) {
    return {
      code: "UNAUTHENTICATED",
      message: S03_ERROR_MESSAGES.UNAUTHENTICATED,
    };
  }

  const code = codeFromError(error);
  const safeCode = S03_ERROR_CODES.includes(code as S03ErrorCode)
    ? (code as S03ErrorCode)
    : "INVALID_COMMAND";
  const candidateField =
    error && typeof error === "object" && "field" in error
      ? (error as { field?: unknown }).field
      : undefined;
  const field =
    typeof candidateField === "string" && S03_ERROR_FIELDS.has(candidateField as S03ErrorField)
      ? (candidateField as S03ErrorField)
      : undefined;

  return {
    code: safeCode,
    message: S03_ERROR_MESSAGES[safeCode],
    ...(field ? { field } : {}),
  };
}

/** Names the adapter-facing alias explicitly for use in Server Actions. */
export const toS03ActionError = toS03Error;
