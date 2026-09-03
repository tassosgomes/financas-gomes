import { captureServerException } from "./server";
import {
  buildCrudObservabilityContext,
  crudEventName,
  crudUseCaseName,
  logObservability,
  toCrudObservabilityContext,
  type CrudObservabilityContext,
  type ObservabilityEntityType,
  type ObservabilityOperation,
  type ObservabilityOutcome,
} from "./logger";
import { generateUuidV7 } from "@/lib/uuidv7";
import type { FinancialContext } from "@/modules/households/contracts";

/** Generates an opaque per-action correlation ID without trusting client input. */
export function createObservabilityRequestId(): string | undefined {
  try {
    return generateUuidV7();
  } catch {
    return undefined;
  }
}

export interface CrudOperation extends CrudObservabilityContext {
  operation: ObservabilityOperation;
  entityType: ObservabilityEntityType;
}

function contextFor(
  operation: CrudOperation,
  durationMs: number,
  financialContext?: FinancialContext,
): CrudObservabilityContext {
  return buildCrudObservabilityContext(operation.operation, operation.entityType, {
    entityId: operation.entityId,
    requestId: operation.requestId,
    userId: financialContext?.userId ?? operation.userId,
    householdId: financialContext?.householdId ?? operation.householdId,
    durationMs,
    statusCode: operation.statusCode,
  });
}

/** Logs a completed CRUD operation without logging its result or input. */
export function logCrudOperation(
  operation: CrudOperation,
  outcome: ObservabilityOutcome,
  durationMs: number,
  financialContext?: FinancialContext,
  errorCode?: string,
): void {
  const context = contextFor(operation, durationMs, financialContext);
  logObservability(outcome === "unexpected_error" ? "error" : "info", {
    ...context,
    event: crudEventName(operation.entityType, operation.operation, outcome),
    useCase: crudUseCaseName(operation.entityType, operation.operation),
    outcome,
    errorCode,
  });
}

/**
 * Sends unexpected failures to the Sentry boundary and emits a matching safe
 * log line. The original exception is retained for its technical stack; the
 * Sentry beforeSend allow-list removes its message, request and payload data.
 */
export function reportCrudUnexpectedError(
  error: unknown,
  operation: CrudOperation,
  durationMs: number,
  financialContext?: FinancialContext,
): void {
  const context = contextFor(operation, durationMs, financialContext);
  const sentryContext = toCrudObservabilityContext(context);

  logObservability("error", {
    ...context,
    event: crudEventName(operation.entityType, operation.operation, "unexpected_error"),
    useCase: crudUseCaseName(operation.entityType, operation.operation),
    outcome: "unexpected_error",
  });

  try {
    captureServerException(error, sentryContext);
  } catch {
    // Sentry is explicitly best effort and must not alter the response path.
  }
}
