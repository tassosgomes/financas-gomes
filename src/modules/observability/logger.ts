import type { ObservabilityContext } from "./contracts";
import { getServerSentryConfig } from "./server-config";

/** The CRUD verbs intentionally form a small, stable aggregation vocabulary. */
export const OBSERVABILITY_OPERATIONS = [
  "create",
  "list",
  "update",
  "archive",
  "cancel",
] as const;

export type ObservabilityOperation =
  (typeof OBSERVABILITY_OPERATIONS)[number];

export const OBSERVABILITY_ENTITY_TYPES = [
  "account",
  "category",
  "transaction",
] as const;

export type ObservabilityEntityType =
  (typeof OBSERVABILITY_ENTITY_TYPES)[number];

export const OBSERVABILITY_OUTCOMES = [
  "success",
  "expected_error",
  "unexpected_error",
] as const;

export type ObservabilityOutcome = (typeof OBSERVABILITY_OUTCOMES)[number];

export interface CrudObservabilityContext {
  operation: ObservabilityOperation;
  entityType: ObservabilityEntityType;
  /** An opaque UUID for update/archive; omitted for create/list. */
  entityId?: string;
  /** An opaque FinancialEvent identifier; omitted before create succeeds. */
  eventId?: string;
  /** Stable FinancialEvent kind; never a display label. */
  transactionKind?: "EXPENSE" | "INCOME" | "MANUAL";
  requestId?: string;
  userId?: string;
  householdId?: string;
  durationMs?: number;
  statusCode?: number;
  environment?: string;
  release?: string;
}

export interface CrudObservabilityLog extends CrudObservabilityContext {
  event: string;
  useCase: string;
  outcome: ObservabilityOutcome;
  /** Stable allow-listed domain code; never a raw Error message. */
  errorCode?: string;
}

const MAX_LOG_STRING_LENGTH = 160;

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, MAX_LOG_STRING_LENGTH) : undefined;
}

function normalizeOpaqueId(value: unknown): string | undefined {
  const normalized = normalizeString(value);
  // IDs/releases are technical values. Reject spaces and punctuation that can
  // turn a display name or free-form form value into a log field.
  return normalized && /^[A-Za-z0-9._:/-]+$/u.test(normalized)
    ? normalized
    : undefined;
}

function normalizeOperationalName(value: unknown): string | undefined {
  const normalized = normalizeString(value);
  // Event/use-case names are code-owned identifiers, never display text.
  return normalized && /^[a-z][a-z0-9_.-]{0,159}$/u.test(normalized)
    ? normalized
    : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.round(value));
}

function enumValue<T extends readonly string[]>(
  values: T,
  value: unknown,
): T[number] | undefined {
  return typeof value === "string" && values.some((item) => item === value)
    ? value
    : undefined;
}

function safeErrorCode(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/u.test(value)) {
    return undefined;
  }

  return value;
}

/**
 * Final application-log boundary. This is allow-listed instead of recursively
 * redacting an arbitrary object: input payloads, Error objects and unknown SDK
 * fields never get a chance to enter the process log.
 */
export function sanitizeCrudObservabilityLog(
  value: Partial<CrudObservabilityLog> & Record<string, unknown>,
): CrudObservabilityLog | undefined {
  const operation = enumValue(OBSERVABILITY_OPERATIONS, value.operation);
  const entityType = enumValue(OBSERVABILITY_ENTITY_TYPES, value.entityType);
  const outcome = enumValue(OBSERVABILITY_OUTCOMES, value.outcome);
  const event = normalizeOperationalName(value.event);
  const useCase = normalizeOperationalName(value.useCase);

  if (!operation || !entityType || !outcome || !event || !useCase) {
    return undefined;
  }

  const result: CrudObservabilityLog = {
    event,
    useCase,
    operation,
    entityType,
    outcome,
  };

  const transactionKind = enumValue(
    ["EXPENSE", "INCOME", "MANUAL"] as const,
    value.transactionKind,
  );
  if (transactionKind) {
    result.transactionKind = transactionKind;
  }

  const errorCode = safeErrorCode(value.errorCode);
  if (errorCode) {
    result.errorCode = errorCode;
  }

  const addString = (
    key:
      | "entityId"
      | "eventId"
      | "requestId"
      | "userId"
      | "householdId"
      | "environment"
      | "release",
  ) => {
    const normalized = normalizeOpaqueId(value[key]);
    if (normalized) {
      result[key] = normalized;
    }
  };

  addString("entityId");
  addString("eventId");
  addString("requestId");
  addString("userId");
  addString("householdId");
  addString("environment");
  addString("release");

  const durationMs = optionalFiniteNumber(value.durationMs);
  if (durationMs !== undefined) {
    result.durationMs = durationMs;
  }

  const statusCode = optionalFiniteNumber(value.statusCode);
  if (statusCode !== undefined) {
    result.statusCode = statusCode;
  }

  return result;
}

export type ObservabilityLogLevel = "info" | "warn" | "error";

/**
 * Emits one JSON object containing technical metadata only. Logging is best
 * effort: a console/runtime failure must never alter the CRUD response.
 */
export function logObservability(
  level: ObservabilityLogLevel,
  value: Partial<CrudObservabilityLog> & Record<string, unknown>,
): void {
  try {
    const safe = sanitizeCrudObservabilityLog(value);
    if (!safe) {
      return;
    }

    const serialized = JSON.stringify(safe);
    if (level === "error") {
      console.error(serialized);
    } else if (level === "warn") {
      console.warn(serialized);
    } else {
      console.info(serialized);
    }
  } catch {
    // Observability is deliberately non-blocking.
  }
}

/**
 * Builds the shared operation context. Sentry environment/release are read
 * without including the private DSN in either logs or event context.
 */
export function buildCrudObservabilityContext(
  operation: ObservabilityOperation,
  entityType: ObservabilityEntityType,
  context: Omit<CrudObservabilityContext, "operation" | "entityType" | "environment" | "release"> = {},
): CrudObservabilityContext {
  let environment: string | undefined;
  let release: string | undefined;

  try {
    const config = getServerSentryConfig();
    environment = config.environment;
    release = config.release;
  } catch {
    // Configuration is optional and must not break a server action.
  }

  return {
    ...context,
    operation,
    entityType,
    environment,
    release,
  };
}

export function crudUseCaseName(
  entityType: ObservabilityEntityType,
  operation: ObservabilityOperation,
): string {
  const resource =
    entityType === "account"
      ? "accounts"
      : entityType === "category"
        ? "categories"
        : "transactions";
  return `${resource}.${operation}`;
}

export function crudEventName(
  entityType: ObservabilityEntityType,
  operation: ObservabilityOperation,
  outcome: ObservabilityOutcome,
): string {
  const prefix = entityType === "transaction" ? "s03" : "s02";
  return `${prefix}_${entityType}_${operation}_${outcome}`;
}

/** Converts CRUD metadata to the shared Sentry context shape. */
export function toCrudObservabilityContext(
  value: CrudObservabilityContext,
): ObservabilityContext {
  return {
    event: crudEventName(value.entityType, value.operation, "unexpected_error"),
    useCase: crudUseCaseName(value.entityType, value.operation),
    operation: value.operation,
    entityType: value.entityType,
    entityId: value.entityId,
    eventId: value.eventId,
    transactionKind: value.transactionKind,
    requestId: value.requestId,
    userId: value.userId,
    householdId: value.householdId,
    durationMs: value.durationMs,
    statusCode: value.statusCode,
    environment: value.environment,
    release: value.release,
  };
}
