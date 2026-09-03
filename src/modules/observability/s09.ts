import { generateUuidV7 } from "@/lib/uuidv7";
import { FinancialContextError } from "@/modules/households/contracts";

import type { ObservabilityContext } from "./contracts";
import { addBreadcrumbSafely, captureServerException } from "./server";

/** Versioned, code-owned identifiers for the S09 observability contract. */
export const S09_BUDGET_CONTRACT_VERSION = "s09.v1" as const;
/** S09 v1 publishes one protected-box rule and no separate rule version. */
export const S09_BUDGET_RULE_VERSION = S09_BUDGET_CONTRACT_VERSION;
export const S09_BUDGET_RESERVE_RULE = "BOX_BALANCE_PROTECTED" as const;

/** Compatibility aliases for callers using the shorter contract vocabulary. */
export const S09_CONTRACT_VERSION = S09_BUDGET_CONTRACT_VERSION;
export const S09_RULE_VERSION = S09_BUDGET_RULE_VERSION;
export const S09_RESERVE_RULE = S09_BUDGET_RESERVE_RULE;

/** The only operation names that may reach an S09 event or use-case field. */
export const S09_BUDGET_OPERATIONS = [
  "budget.read",
  "budget.write",
  "budget.distribution",
  "budget.derived.calculate",
  "budget.provider.read",
  "budget.serialize",
] as const;

export type S09BudgetOperation = (typeof S09_BUDGET_OPERATIONS)[number];

/** Stages are derived from operations and never accepted as free text. */
export const S09_BUDGET_STAGES = [
  "read",
  "write",
  "distribution",
  "derived",
  "provider",
  "serialization",
] as const;

export type S09BudgetStage = (typeof S09_BUDGET_STAGES)[number];

/** Result categories distinguish absence/zero protection from provider failure. */
export const S09_BUDGET_RESULTS = [
  "SUCCESS",
  "AVAILABLE",
  "NO_BOXES",
  "ZERO_PROTECTION",
  "PROTECTED",
  "DEFICIT",
  "CLOSED",
  "NO_CONFIGURATION",
  "UNAVAILABLE",
] as const;

export type S09BudgetResult = (typeof S09_BUDGET_RESULTS)[number];

export const S09_BUDGET_OUTCOMES = [
  "success",
  "expected_error",
  "unexpected_error",
] as const;

export type S09BudgetOutcome = (typeof S09_BUDGET_OUTCOMES)[number];

export const S09_BUDGET_PROVIDER_STATUSES = ["AVAILABLE", "UNAVAILABLE"] as const;
export type S09BudgetProviderStatus = (typeof S09_BUDGET_PROVIDER_STATUSES)[number];

/** Aggregate counters only; rows, references, values and payloads are absent. */
export interface S09BudgetAggregateCounts {
  budgetCount?: number;
  activeBudgetCount?: number;
  closedBudgetCount?: number;
  movementCount?: number;
  contributionCount?: number;
  withdrawalCount?: number;
  effectCount?: number;
  expenseEffectCount?: number;
  refundEffectCount?: number;
  allocationRuleCount?: number;
  positiveAllocationRuleCount?: number;
  distributionCount?: number;
  componentCount?: number;
  protectedComponentCount?: number;
  appliedMovementCount?: number;
  reflectedReferenceCount?: number;
  serializedFieldCount?: number;
}

export interface S09BudgetOperationOptions extends S09BudgetAggregateCounts {
  requestId?: unknown;
  /** Alias accepted by transport boundaries and emitted as requestId. */
  correlationId?: unknown;
  userId?: unknown;
  householdId?: unknown;
  result?: unknown;
  providerStatus?: unknown;
  rule?: unknown;
  contractVersion?: unknown;
  ruleVersion?: unknown;
  durationMs?: unknown;
  statusCode?: unknown;
  transactionFailed?: unknown;
  [key: string]: unknown;
}

export interface S09BudgetOperationContext extends S09BudgetAggregateCounts {
  operation: S09BudgetOperation;
  stage: S09BudgetStage;
  contractVersion: typeof S09_BUDGET_CONTRACT_VERSION;
  ruleVersion: typeof S09_BUDGET_RULE_VERSION;
  rule: typeof S09_BUDGET_RESERVE_RULE;
  requestId?: string;
  result?: S09BudgetResult;
  providerStatus?: S09BudgetProviderStatus;
  durationMs?: number;
  statusCode?: number;
  transactionFailed?: boolean;
}

export interface S09BudgetLog extends S09BudgetOperationContext {
  event: string;
  useCase: S09BudgetOperation;
  outcome: S09BudgetOutcome;
  errorCode?: S09BudgetErrorCode;
  slowQuery?: boolean;
  slowQueryThresholdMs?: number;
  queryBudgetMs?: number;
  budgetExceeded?: boolean;
}

export type S09BudgetLogInput = Omit<
  Partial<S09BudgetLog>,
  | "event"
  | "useCase"
  | "operation"
  | "stage"
  | "contractVersion"
  | "ruleVersion"
  | "rule"
  | "result"
  | "providerStatus"
  | "errorCode"
> &
  S09BudgetOperationOptions & {
    event?: unknown;
    useCase?: unknown;
    operation?: unknown;
    stage?: unknown;
    contractVersion?: unknown;
    ruleVersion?: unknown;
    rule?: unknown;
    result?: unknown;
    providerStatus?: unknown;
    errorCode?: unknown;
  };

export interface S09BudgetObservabilityHooks {
  onRecord?: (record: S09BudgetLog) => void;
  onMetric?: (record: S09BudgetLog) => void;
  onSlowQuery?: (record: S09BudgetLog) => void;
}

/**
 * Safe categories/counters that a boundary may derive from its own result.
 * The callback is deliberately separate from the event allow-list: its output
 * is sanitized again before it reaches a log, breadcrumb, metric or Sentry.
 */
export interface S09BudgetResultSummary extends S09BudgetAggregateCounts {
  result?: unknown;
  providerStatus?: unknown;
}

export type S09BudgetResultSummarizer =
  (value: unknown) => S09BudgetResultSummary;

export interface S09BudgetCompletionOptions
  extends S09BudgetAggregateCounts,
    S09BudgetObservabilityHooks {
  durationMs?: number;
  errorCode?: string;
  technicalErrorCode?: string;
  result?: unknown;
  providerStatus?: unknown;
  rule?: unknown;
  queryBudgetMs?: number;
  slowQueryThresholdMs?: number;
  budgetExceeded?: boolean;
  transactionFailed?: boolean;
  now?: () => number;
  /** Derives categories/counts without exposing the boundary result. */
  summarizeResult?: S09BudgetResultSummarizer;
}

export interface S09BudgetQueryOptions
  extends S09BudgetAggregateCounts,
    S09BudgetObservabilityHooks {
  thresholdMs?: number;
  queryBudgetMs?: number;
  technicalErrorCode?: string;
  transactionFailed?: boolean;
  now?: () => number;
  /** Derives categories/counts without exposing the boundary result. */
  summarizeResult?: S09BudgetResultSummarizer;
}

export type S09BudgetBoundaryOptions =
  S09BudgetCompletionOptions & S09BudgetQueryOptions & Record<string, unknown>;

/**
 * Options accepted by the T05 reader adapter. Unknown caller fields are
 * intentionally tolerated at this seam and are removed by the S09 allow-list
 * before any record, breadcrumb or exception context is emitted.
 */
export interface S09BudgetReadBoundaryOptions
  extends S09BudgetAggregateCounts,
    S09BudgetObservabilityHooks {
  requestId?: unknown;
  correlationId?: unknown;
  result?: unknown;
  providerStatus?: unknown;
  rule?: unknown;
  contractVersion?: unknown;
  ruleVersion?: unknown;
  durationMs?: number;
  statusCode?: number;
  errorCode?: string;
  technicalErrorCode?: string;
  transactionFailed?: boolean;
  thresholdMs?: number;
  queryBudgetMs?: number;
  slowQuery?: boolean;
  slowQueryThresholdMs?: number;
  budgetExceeded?: boolean;
  now?: () => number;
  [key: string]: unknown;
}

export type S09BudgetReadBoundary<
  TArguments extends readonly unknown[] = readonly unknown[],
  TResult = unknown,
> = (...args: TArguments) => Promise<TResult> | TResult;

export const S09_BUDGET_EXPECTED_ERROR_CODES = [
  "UNAUTHENTICATED",
  "HOUSEHOLD_MEMBERSHIP_REQUIRED",
  "HOUSEHOLD_SELECTION_REQUIRED",
  "INVALID_FINANCIAL_CONTEXT",
  "FINANCIAL_CONTEXT_REQUIRED",
  "HOUSEHOLD_NOT_FOUND",
  "INVALID_COMMAND",
  "INVALID_COMMAND_ID",
  "INVALID_NAME",
  "INVALID_AMOUNT",
  "AMOUNT_OUT_OF_RANGE",
  "INVALID_DATE",
  "INVALID_DATE_RANGE",
  "INVALID_QUERY",
  "INVALID_CURSOR",
  "INVALID_REFERENCE",
  "INVALID_CATEGORY_ID",
  "INVALID_STATUS",
  "INVALID_RULE",
  "INVALID_CONFIGURATION",
  "INVALID_ALLOCATION",
  "INVALID_GOAL",
  "INVALID_TARGET_AMOUNT",
  "INVALID_TARGET_DATE",
  "TARGET_DATE_BEFORE_ACTIVE_FROM",
  "BUDGET_NOT_FOUND",
  "CATEGORY_NOT_FOUND",
  "MOVEMENT_NOT_FOUND",
  "CATEGORY_ARCHIVED",
  "CATEGORY_KIND_MISMATCH",
  "BUDGET_CLOSED",
  "BUDGET_NOT_ACTIVE_AT_DATE",
  "CATEGORY_ACTIVE_BUDGET_CONFLICT",
  "ALLOCATION_OVERLAP",
  "ALLOCATION_NO_POSITIVE_WEIGHT",
  "DUPLICATE_REFERENCE",
  "COMMAND_ID_REUSED",
  "MOVEMENT_ALREADY_CORRECTED",
  "TRANSFER_SAME_BUDGET",
  "REFUND_EXCEEDS_ORIGINAL",
  "CONFLICT",
  "NON_EDITABLE_FIELD",
] as const;

export type S09BudgetExpectedErrorCode =
  (typeof S09_BUDGET_EXPECTED_ERROR_CODES)[number];

export const S09_BUDGET_TECHNICAL_ERROR_CODES = [
  "BUDGET_QUERY_FAILED",
  "BUDGET_QUERY_TIMEOUT",
  "BUDGET_PERSISTENCE_FAILED",
  "BUDGET_TRANSACTION_FAILED",
  "BUDGET_DISTRIBUTION_FAILED",
  "BUDGET_DERIVATION_FAILED",
  "BUDGET_PROVIDER_FAILED",
  "BUDGET_PROVIDER_UNAVAILABLE",
  "BUDGET_SERIALIZATION_FAILED",
  "BUDGET_CONTRACT_VIOLATION",
  "BUDGET_INVARIANT_VIOLATION",
  "PROVIDER_UNAVAILABLE",
  "CONTRACT_VERSION_MISMATCH",
  "QUERY_FAILED",
  "PERSISTENCE_FAILED",
  "TRANSACTION_FAILED",
  "UNEXPECTED_ERROR",
] as const;

export type S09BudgetTechnicalErrorCode =
  (typeof S09_BUDGET_TECHNICAL_ERROR_CODES)[number];

export type S09BudgetErrorCode =
  | S09BudgetExpectedErrorCode
  | S09BudgetTechnicalErrorCode;

export interface S09BudgetErrorClassification {
  outcome: "expected_error" | "unexpected_error";
  errorCode: S09BudgetErrorCode;
}

export interface S09BudgetSafeErrorEnvelope {
  ok: false;
  error: { code: S09BudgetErrorCode };
}

export const DEFAULT_S09_SLOW_QUERY_THRESHOLD_MS = 250;
export const MAX_S09_SLOW_QUERY_THRESHOLD_MS = 60_000;
export const DEFAULT_S09_QUERY_BUDGET_MS = 2_000;
export const MAX_S09_QUERY_BUDGET_MS = 60_000;
export const MAX_S09_AGGREGATE_COUNT = 1_000_000_000;

const OPERATION_ALIASES: Readonly<Record<string, S09BudgetOperation>> = {
  "budget.read": "budget.read",
  "budget.list": "budget.read",
  "budget.get": "budget.read",
  "budget.query": "budget.read",
  read: "budget.read",
  query: "budget.read",
  "budget.write": "budget.write",
  "budget.create": "budget.write",
  "budget.update": "budget.write",
  "budget.close": "budget.write",
  "budget.movement.contribution": "budget.write",
  "budget.movement.withdrawal": "budget.write",
  "budget.movement.transfer": "budget.write",
  "budget.movement.correct": "budget.write",
  "budget.allocation.replace": "budget.write",
  write: "budget.write",
  "budget.distribution": "budget.distribution",
  "budget.distribute": "budget.distribution",
  "budget.distribution.realize": "budget.distribution",
  distribution: "budget.distribution",
  "budget.derived.calculate": "budget.derived.calculate",
  "budget.calculate": "budget.derived.calculate",
  "budget.balance.calculate": "budget.derived.calculate",
  "budget.progress.calculate": "budget.derived.calculate",
  "budget.rollover.calculate": "budget.derived.calculate",
  derived: "budget.derived.calculate",
  calculate: "budget.derived.calculate",
  "budget.provider.read": "budget.provider.read",
  "budget.provider": "budget.provider.read",
  "budget.reserve.read": "budget.provider.read",
  provider: "budget.provider.read",
  "budget.serialize": "budget.serialize",
  "budget.serialization": "budget.serialize",
  serialization: "budget.serialize",
  serialize: "budget.serialize",
};

const OPERATION_SET = new Set<string>(S09_BUDGET_OPERATIONS);
const STAGE_SET = new Set<string>(S09_BUDGET_STAGES);
const OUTCOME_SET = new Set<string>(S09_BUDGET_OUTCOMES);
const RESULT_ALIASES: Readonly<Record<string, S09BudgetResult>> = {
  SUCCESS: "SUCCESS",
  success: "SUCCESS",
  AVAILABLE: "AVAILABLE",
  available: "AVAILABLE",
  NO_BOXES: "NO_BOXES",
  no_boxes: "NO_BOXES",
  ABSENT: "NO_BOXES",
  absent: "NO_BOXES",
  ZERO_PROTECTION: "ZERO_PROTECTION",
  zero_protection: "ZERO_PROTECTION",
  ZERO: "ZERO_PROTECTION",
  zero: "ZERO_PROTECTION",
  PROTECTED: "PROTECTED",
  protected: "PROTECTED",
  DEFICIT: "DEFICIT",
  deficit: "DEFICIT",
  NEGATIVE: "DEFICIT",
  negative: "DEFICIT",
  CLOSED: "CLOSED",
  closed: "CLOSED",
  NO_CONFIGURATION: "NO_CONFIGURATION",
  no_configuration: "NO_CONFIGURATION",
  UNAVAILABLE: "UNAVAILABLE",
  unavailable: "UNAVAILABLE",
};
const RESULT_SET = new Set<string>(S09_BUDGET_RESULTS);
const PROVIDER_STATUS_SET = new Set<string>(S09_BUDGET_PROVIDER_STATUSES);
const EXPECTED_ERROR_SET = new Set<string>(S09_BUDGET_EXPECTED_ERROR_CODES);
const TECHNICAL_ERROR_SET = new Set<string>(S09_BUDGET_TECHNICAL_ERROR_CODES);
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

function boundedInteger(value: unknown, maximum = MAX_S09_AGGREGATE_COUNT): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(maximum, Math.max(0, Math.round(value)));
}

function duration(value: unknown): number | undefined {
  return boundedInteger(value, MAX_DURATION_MS);
}

function statusCode(value: unknown): number | undefined {
  return boundedInteger(value, 999);
}

function operationValue(value: unknown): S09BudgetOperation | undefined {
  if (typeof value !== "string") return undefined;
  const operation = OPERATION_ALIASES[value];
  return operation && OPERATION_SET.has(operation) ? operation : undefined;
}

function stageForOperation(operation: S09BudgetOperation): S09BudgetStage {
  if (operation === "budget.read") return "read";
  if (operation === "budget.write") return "write";
  if (operation === "budget.distribution") return "distribution";
  if (operation === "budget.derived.calculate") return "derived";
  if (operation === "budget.provider.read") return "provider";
  return "serialization";
}

function operationForStage(stage: S09BudgetStage): S09BudgetOperation {
  if (stage === "read") return "budget.read";
  if (stage === "write") return "budget.write";
  if (stage === "distribution") return "budget.distribution";
  if (stage === "derived") return "budget.derived.calculate";
  if (stage === "provider") return "budget.provider.read";
  return "budget.serialize";
}

function stageValue(value: unknown): S09BudgetStage | undefined {
  if (typeof value !== "string" || !STAGE_SET.has(value)) return undefined;
  return value as S09BudgetStage;
}

function outcomeValue(value: unknown): S09BudgetOutcome | undefined {
  if (typeof value !== "string" || !OUTCOME_SET.has(value)) return undefined;
  return value as S09BudgetOutcome;
}

function resultValue(value: unknown): S09BudgetResult | undefined {
  if (typeof value !== "string") return undefined;
  const result = RESULT_ALIASES[value];
  return result && RESULT_SET.has(result) ? result : undefined;
}

function providerStatusValue(value: unknown): S09BudgetProviderStatus | undefined {
  return typeof value === "string" && PROVIDER_STATUS_SET.has(value)
    ? (value as S09BudgetProviderStatus)
    : undefined;
}

function errorCodeValue(value: unknown): S09BudgetErrorCode | undefined {
  if (
    typeof value !== "string" ||
    !ERROR_CODE_PATTERN.test(value) ||
    (!EXPECTED_ERROR_SET.has(value) && !TECHNICAL_ERROR_SET.has(value))
  ) {
    return undefined;
  }
  return value as S09BudgetErrorCode;
}

function technicalErrorCode(value: unknown): S09BudgetTechnicalErrorCode {
  return typeof value === "string" && TECHNICAL_ERROR_SET.has(value)
    ? (value as S09BudgetTechnicalErrorCode)
    : "UNEXPECTED_ERROR";
}

function transactionFailureFlag(value: unknown): boolean | undefined {
  return value === "BUDGET_TRANSACTION_FAILED" || value === "TRANSACTION_FAILED"
    ? true
    : undefined;
}

const COUNT_ALIASES: Readonly<Record<keyof S09BudgetAggregateCounts, readonly string[]>> = {
  budgetCount: ["budgetCount", "budget_count", "budgets"],
  activeBudgetCount: ["activeBudgetCount", "active_budget_count", "activeBudgets"],
  closedBudgetCount: ["closedBudgetCount", "closed_budget_count", "closedBudgets"],
  movementCount: ["movementCount", "movement_count", "movements"],
  contributionCount: ["contributionCount", "contribution_count", "contributions"],
  withdrawalCount: ["withdrawalCount", "withdrawal_count", "withdrawals"],
  effectCount: ["effectCount", "effect_count", "effects"],
  expenseEffectCount: ["expenseEffectCount", "expense_effect_count", "expenseEffects"],
  refundEffectCount: ["refundEffectCount", "refund_effect_count", "refundEffects"],
  allocationRuleCount: ["allocationRuleCount", "allocation_rule_count", "allocationRules"],
  positiveAllocationRuleCount: [
    "positiveAllocationRuleCount",
    "positive_allocation_rule_count",
    "positiveAllocationRules",
  ],
  distributionCount: ["distributionCount", "distribution_count", "distributions"],
  componentCount: ["componentCount", "component_count", "components"],
  protectedComponentCount: [
    "protectedComponentCount",
    "protected_component_count",
    "protectedComponents",
  ],
  appliedMovementCount: ["appliedMovementCount", "applied_movement_count", "appliedMovements"],
  reflectedReferenceCount: [
    "reflectedReferenceCount",
    "reflected_reference_count",
    "reflectedReferences",
  ],
  serializedFieldCount: [
    "serializedFieldCount",
    "serialized_field_count",
    "serializedFields",
    "serialized_fields",
  ],
};

function countFrom(source: Record<string, unknown>, aliases: readonly string[]): number | undefined {
  for (const alias of aliases) {
    const value = boundedInteger(source[alias]);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Keeps only bounded scalar aggregate counters; it never traverses rows. */
export function sanitizeS09BudgetCounts(value: unknown): S09BudgetAggregateCounts | undefined {
  if (!isRecord(value)) return undefined;
  const source = isRecord(value.counts) ? value.counts : value;
  const result: S09BudgetAggregateCounts = {};
  for (const key of Object.keys(COUNT_ALIASES) as Array<keyof S09BudgetAggregateCounts>) {
    const count = countFrom(source, COUNT_ALIASES[key]);
    if (count !== undefined) result[key] = count;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function aggregateInput(value: Record<string, unknown>): S09BudgetAggregateCounts {
  return sanitizeS09BudgetCounts(value) ?? {};
}

function eventName(operation: S09BudgetOperation, outcome: S09BudgetOutcome): string {
  return `s09_${operation.replaceAll(".", "_")}_${outcome}`;
}

function addRequestId(target: { requestId?: string }, value: unknown): void {
  const safe = opaqueId(value);
  if (safe) target.requestId = safe;
}

/** Creates operation metadata and generates request correlation when absent. */
export function createS09BudgetOperation(
  operationInput: S09BudgetOperation | S09BudgetStage | string,
  options: S09BudgetOperationOptions = {},
): S09BudgetOperationContext {
  const operation = operationValue(operationInput) ?? "budget.read";
  let requestId = opaqueId(options.requestId ?? options.correlationId);
  if (!requestId) {
    try {
      requestId = opaqueId(generateUuidV7());
    } catch {
      requestId = undefined;
    }
  }

  const result: S09BudgetOperationContext = {
    operation,
    stage: stageForOperation(operation),
    contractVersion: S09_BUDGET_CONTRACT_VERSION,
    ruleVersion: S09_BUDGET_RULE_VERSION,
    rule: S09_BUDGET_RESERVE_RULE,
    ...aggregateInput(options),
  };
  addRequestId(result, requestId);

  const resultState = resultValue(options.result);
  if (resultState) result.result = resultState;
  const providerStatus = providerStatusValue(options.providerStatus);
  if (providerStatus) result.providerStatus = providerStatus;
  const durationMs = duration(options.durationMs);
  if (durationMs !== undefined) result.durationMs = durationMs;
  const status = statusCode(options.statusCode);
  if (status !== undefined) result.statusCode = status;
  if (typeof options.transactionFailed === "boolean") {
    result.transactionFailed = options.transactionFailed;
  }
  return result;
}

export const createS09Operation = createS09BudgetOperation;
export const createS09BudgetContext = createS09BudgetOperation;

/** Final S09 allow-list: caller event names and unknown fields are rebuilt/dropped. */
export function sanitizeS09BudgetLog(value: S09BudgetLogInput): S09BudgetLog | undefined {
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
    if (value.contractVersion !== undefined && value.contractVersion !== S09_BUDGET_CONTRACT_VERSION) return undefined;
    if (value.ruleVersion !== undefined && value.ruleVersion !== S09_BUDGET_RULE_VERSION) return undefined;
    if (value.rule !== undefined && value.rule !== S09_BUDGET_RESERVE_RULE) return undefined;

    const safe: S09BudgetLog = {
      event: eventName(operation, outcome),
      useCase: operation,
      operation,
      stage,
      contractVersion: S09_BUDGET_CONTRACT_VERSION,
      ruleVersion: S09_BUDGET_RULE_VERSION,
      rule: S09_BUDGET_RESERVE_RULE,
      outcome,
      ...aggregateInput(value),
    };
    addRequestId(safe, value.requestId ?? value.correlationId);

    const result = resultValue(value.result);
    if (value.result !== undefined && !result) return undefined;
    if (result) safe.result = result;
    const providerStatus = providerStatusValue(value.providerStatus);
    if (value.providerStatus !== undefined && !providerStatus) return undefined;
    if (providerStatus) safe.providerStatus = providerStatus;
    const durationMs = duration(value.durationMs);
    if (durationMs !== undefined) safe.durationMs = durationMs;
    const status = statusCode(value.statusCode);
    if (status !== undefined) safe.statusCode = status;
    const errorCode = errorCodeValue(value.errorCode);
    if (value.errorCode !== undefined && !errorCode) return undefined;
    if (errorCode) safe.errorCode = errorCode;
    if (typeof value.transactionFailed === "boolean") safe.transactionFailed = value.transactionFailed;
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

export const sanitizeS09Log = sanitizeS09BudgetLog;

function primaryContext(
  operation: S09BudgetOperationContext,
  outcome: S09BudgetOutcome,
  options: S09BudgetCompletionOptions = {},
): S09BudgetLog | undefined {
  return sanitizeS09BudgetLog({
    ...operation,
    ...options,
    operation: operation.operation,
    stage: operation.stage,
    outcome,
  });
}

/** Converts S09 metadata to the shared context shape without raw fields. */
export function toS09ObservabilityContext(
  operation: S09BudgetOperationContext,
  outcome: S09BudgetOutcome = "unexpected_error",
  options: S09BudgetCompletionOptions = {},
): ObservabilityContext & Record<string, unknown> {
  const safe = primaryContext(operation, outcome, options);
  return {
    event: safe?.event ?? eventName(operation.operation, outcome),
    useCase: safe?.useCase ?? operation.operation,
    operation: safe?.operation ?? operation.operation,
    entityType: "budget",
    requestId: safe?.requestId,
    durationMs: safe?.durationMs,
    statusCode: safe?.statusCode,
    stage: safe?.stage ?? operation.stage,
    errorCode: safe?.errorCode,
    s09Operation: safe?.operation,
    s09Stage: safe?.stage,
    s09ContractVersion: safe?.contractVersion ?? S09_BUDGET_CONTRACT_VERSION,
    s09RuleVersion: safe?.ruleVersion ?? S09_BUDGET_RULE_VERSION,
    s09Rule: safe?.rule ?? S09_BUDGET_RESERVE_RULE,
    s09Outcome: safe?.outcome,
    s09Result: safe?.result,
    s09ProviderStatus: safe?.providerStatus,
    ...Object.fromEntries(
      Object.entries(safe ?? {}).filter(([key]) => key.endsWith("Count") || key === "transactionFailed" || key === "slowQuery" || key === "slowQueryThresholdMs" || key === "queryBudgetMs" || key === "budgetExceeded"),
    ),
  };
}

function breadcrumbData(safe: S09BudgetLog): Record<string, unknown> {
  return {
    operation: safe.operation,
    stage: safe.stage,
    s09_operation: safe.operation,
    s09_stage: safe.stage,
    s09_contract_version: safe.contractVersion,
    s09_rule_version: safe.ruleVersion,
    s09_rule: safe.rule,
    outcome: safe.outcome,
    request_id: safe.requestId,
    error_code: safe.errorCode,
    result: safe.result,
    provider_status: safe.providerStatus,
    duration_ms: safe.durationMs,
    status_code: safe.statusCode,
    transaction_failed: safe.transactionFailed,
    slow_query: safe.slowQuery,
    slow_query_threshold_ms: safe.slowQueryThresholdMs,
    query_budget_ms: safe.queryBudgetMs,
    budget_exceeded: safe.budgetExceeded,
    ...Object.fromEntries(
      Object.entries(safe).filter(([key]) => key.endsWith("Count")),
    ),
  };
}

export function addS09BudgetBreadcrumb(
  operation: S09BudgetOperationContext,
  outcome: S09BudgetOutcome,
  options: S09BudgetCompletionOptions = {},
): void {
  const safe = primaryContext(operation, outcome, options);
  if (!safe) return;
  addBreadcrumbSafely({
    type: "info",
    category: safe.useCase,
    data: breadcrumbData(safe),
  });
}

function emitRecord(safe: S09BudgetLog, hooks: S09BudgetObservabilityHooks = {}): void {
  try { addS09BudgetBreadcrumb(safe, safe.outcome, safe); } catch { /* best effort */ }
  try { hooks.onRecord?.(safe); hooks.onMetric?.(safe); } catch { /* non-blocking */ }
  try {
    const serialized = JSON.stringify(safe);
    if (safe.outcome === "unexpected_error") console.error(serialized);
    else console.info(serialized);
  } catch { /* non-blocking */ }
}

export function logS09BudgetOperation(
  operation: S09BudgetOperationContext,
  outcome: S09BudgetOutcome,
  options: S09BudgetCompletionOptions = {},
): S09BudgetLog | undefined {
  const safe = primaryContext(operation, outcome, options);
  if (!safe) return undefined;
  emitRecord(safe, options);
  return safe;
}

export const logS09Operation = logS09BudgetOperation;

function codeFromError(error: unknown): unknown {
  if (!isRecord(error)) return undefined;
  if (typeof error.code === "string") return error.code;
  return isRecord(error.error) ? error.error.code : undefined;
}

export function expectedS09ErrorCode(error: unknown): S09BudgetExpectedErrorCode | undefined {
  if (error instanceof FinancialContextError && EXPECTED_ERROR_SET.has(error.code)) {
    return error.code as S09BudgetExpectedErrorCode;
  }
  const code = codeFromError(error);
  return typeof code === "string" && EXPECTED_ERROR_SET.has(code)
    ? (code as S09BudgetExpectedErrorCode)
    : undefined;
}

export function classifyS09Error(error: unknown): S09BudgetErrorClassification {
  const expected = expectedS09ErrorCode(error);
  if (expected) return { outcome: "expected_error", errorCode: expected };
  return { outcome: "unexpected_error", errorCode: technicalErrorCode(codeFromError(error)) };
}

export const classifyS09BudgetError = classifyS09Error;
export function isExpectedS09Error(error: unknown): boolean {
  return expectedS09ErrorCode(error) !== undefined;
}

export function toS09ErrorEnvelope(error: unknown): S09BudgetSafeErrorEnvelope {
  const classification = classifyS09Error(error);
  return { ok: false, error: { code: classification.errorCode } };
}

export function reportS09UnexpectedError(
  error: unknown,
  operation: S09BudgetOperationContext,
  durationOrOptions: number | S09BudgetCompletionOptions = 0,
  options: S09BudgetCompletionOptions = {},
): S09BudgetErrorClassification {
  const durationMs = typeof durationOrOptions === "number"
    ? durationOrOptions
    : durationOrOptions.durationMs ?? 0;
  const completionOptions = typeof durationOrOptions === "number" ? options : durationOrOptions;
  const classification = classifyS09Error(error);
  const code = classification.outcome === "expected_error"
    ? classification.errorCode
    : technicalErrorCode(completionOptions.technicalErrorCode ?? codeFromError(error));
  const safeOptions = {
    ...completionOptions,
    durationMs,
    errorCode: code,
    transactionFailed:
      completionOptions.transactionFailed ?? transactionFailureFlag(code),
  };
  logS09BudgetOperation(operation, classification.outcome, safeOptions);
  if (classification.outcome === "unexpected_error") {
    try { captureServerException(error, toS09ObservabilityContext(operation, "unexpected_error", safeOptions)); } catch { /* best effort */ }
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
  options: { summarizeResult?: S09BudgetResultSummarizer },
  value: unknown,
): S09BudgetResultSummary {
  if (typeof options.summarizeResult !== "function") return {};
  try {
    const summary = options.summarizeResult(value);
    return isRecord(summary) ? summary as S09BudgetResultSummary : {};
  } catch {
    // A diagnostic summarizer is never allowed to affect the response path.
    return {};
  }
}

export async function withS09BudgetObservability<T>(
  operation: S09BudgetOperationContext,
  work: () => Promise<T> | T,
  options: S09BudgetCompletionOptions = {},
): Promise<T> {
  const now = options.now ?? monotonicNow;
  const startedAt = now();
  try {
    const value = await work();
    const failure = resultFailure(value);
    const durationMs = elapsedMs(startedAt, now);
    if (failure.failed) {
      const classification = classifyS09Error(failure.error);
      reportS09UnexpectedError(failure.error, operation, durationMs, options);
      if (classification.outcome === "expected_error") {
        // reportS09UnexpectedError already emitted the expected result and did not capture it.
      }
      return value;
    }
    logS09BudgetOperation(operation, "success", {
      ...options,
      ...summarizeResult(options, value),
      durationMs,
    });
    return value;
  } catch (error) {
    const durationMs = elapsedMs(startedAt, now);
    const classification = classifyS09Error(error);
    if (classification.outcome === "expected_error") {
      logS09BudgetOperation(operation, "expected_error", { ...options, durationMs, errorCode: classification.errorCode });
    } else {
      reportS09UnexpectedError(error, operation, durationMs, options);
    }
    throw error;
  }
}

/**
 * Synchronous counterpart for serialization boundaries that must preserve a
 * synchronous public API. It follows the async wrapper's error semantics and
 * applies the same final allow-list before emitting any diagnostic.
 */
export function withS09BudgetObservabilitySync<T>(
  operation: S09BudgetOperationContext,
  work: () => T,
  options: S09BudgetCompletionOptions = {},
): T {
  const now = options.now ?? monotonicNow;
  const startedAt = now();
  try {
    const value = work();
    const failure = resultFailure(value);
    const durationMs = elapsedMs(startedAt, now);
    if (failure.failed) {
      reportS09UnexpectedError(failure.error, operation, durationMs, options);
      return value;
    }
    logS09BudgetOperation(operation, "success", {
      ...options,
      ...summarizeResult(options, value),
      durationMs,
    });
    return value;
  } catch (error) {
    const durationMs = elapsedMs(startedAt, now);
    const classification = classifyS09Error(error);
    if (classification.outcome === "expected_error") {
      logS09BudgetOperation(operation, "expected_error", {
        ...options,
        durationMs,
        errorCode: classification.errorCode,
      });
    } else {
      reportS09UnexpectedError(error, operation, durationMs, options);
    }
    throw error;
  }
}

export const withS09Observability = withS09BudgetObservability;
export const observeS09Operation = withS09BudgetObservability;

/**
 * Wraps the S09 provider boundary with a closed operation and conservative
 * unavailable defaults. A caller may supply a result summarizer, but only its
 * allow-listed categories/counters can be emitted.
 */
export function instrumentS09BudgetProviderBoundary<
  TArguments extends readonly unknown[],
  TResult,
>(
  boundary: S09BudgetReadBoundary<TArguments, TResult>,
  options: S09BudgetBoundaryOptions = {},
): (...args: TArguments) => Promise<TResult> {
  return async (...args: TArguments): Promise<TResult> => {
    const safeOptions: S09BudgetBoundaryOptions = {
      ...options,
      result: options.result ?? "UNAVAILABLE",
      providerStatus: options.providerStatus ?? "UNAVAILABLE",
      technicalErrorCode: options.technicalErrorCode ?? "BUDGET_PROVIDER_FAILED",
    };
    const operation = createS09BudgetOperation("budget.provider.read", safeOptions);
    return withS09BudgetObservability(
      operation,
      () => measureS09Query(operation, () => boundary(...args), safeOptions),
      safeOptions,
    );
  };
}

/** Wraps an async serialization boundary with the versioned S09 operation. */
export function instrumentS09BudgetSerializationBoundary<
  TArguments extends readonly unknown[],
  TResult,
>(
  boundary: S09BudgetReadBoundary<TArguments, TResult>,
  options: S09BudgetBoundaryOptions = {},
): (...args: TArguments) => Promise<TResult> {
  return async (...args: TArguments): Promise<TResult> => {
    const safeOptions: S09BudgetBoundaryOptions = {
      ...options,
      result: options.result ?? "SUCCESS",
      technicalErrorCode:
        options.technicalErrorCode ?? "BUDGET_SERIALIZATION_FAILED",
    };
    const operation = createS09BudgetOperation("budget.serialize", safeOptions);
    return withS09BudgetObservability(
      operation,
      () => measureS09Query(operation, () => boundary(...args), safeOptions),
      safeOptions,
    );
  };
}

/** Synchronous variant used by the reserve snapshot serializer. */
export function instrumentS09BudgetSerializationBoundarySync<
  TInput,
  TResult,
>(
  boundary: (input: TInput) => TResult,
  options: S09BudgetBoundaryOptions = {},
): (input: TInput) => TResult {
  return (input: TInput): TResult => {
    const safeOptions: S09BudgetBoundaryOptions = {
      ...options,
      result: options.result ?? "SUCCESS",
      technicalErrorCode:
        options.technicalErrorCode ?? "BUDGET_SERIALIZATION_FAILED",
    };
    const operation = createS09BudgetOperation("budget.serialize", safeOptions);
    return withS09BudgetObservabilitySync(
      operation,
      () => boundary(input),
      safeOptions,
    );
  };
}

/** Creates a fresh canonical read operation for each T05 boundary call. */
export function createS09BudgetReadOperation(
  options: S09BudgetReadBoundaryOptions = {},
): S09BudgetOperationContext {
  return createS09BudgetOperation("budget.read", options);
}

/**
 * Wraps one T05 reader while preserving its returned value and thrown error.
 * The reader arguments and returned payload are never inspected or emitted;
 * callers provide only safe aggregate counts through the options seam.
 */
export function instrumentS09BudgetReadBoundary<
  TArguments extends readonly unknown[],
  TResult,
>(
  boundary: S09BudgetReadBoundary<TArguments, TResult>,
  options: S09BudgetReadBoundaryOptions = {},
): (...args: TArguments) => Promise<TResult> {
  return async (...args: TArguments): Promise<TResult> => {
    const operation = createS09BudgetReadOperation(options);
    return withS09BudgetObservability(
      operation,
      () => measureS09Query(operation, () => boundary(...args), options),
      options,
    );
  };
}

/**
 * Composes the four-method T05 read access (`list`, `detail`, `history`, and
 * `movements`) without importing or mutating the budgets module. This keeps
 * ownership in observability while giving the T05 owner a single composition
 * point for the existing public boundary.
 */
export function instrumentS09BudgetReadAccess<T extends object>(
  access: T,
  options: S09BudgetReadBoundaryOptions = {},
): T {
  const instrumented = { ...access } as Record<string, unknown>;
  for (const [name, candidate] of Object.entries(access)) {
    if (typeof candidate !== "function") continue;
    const method = candidate as (...args: readonly unknown[]) => unknown;
    instrumented[name] = instrumentS09BudgetReadBoundary(
      (...args: readonly unknown[]) => Reflect.apply(method, access, args),
      options,
    );
  }
  return instrumented as T;
}

export const withS09BudgetReadObservability = instrumentS09BudgetReadBoundary;
export const observeS09BudgetRead = instrumentS09BudgetReadBoundary;
export const instrumentS09BudgetReaders = instrumentS09BudgetReadAccess;

function safeThreshold(value: unknown, maximum: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.min(maximum, Math.max(0, Math.round(value)));
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) return safeThreshold(Number(value.trim()), maximum);
  return undefined;
}

export function getS09SlowQueryThresholdMs(value?: unknown): number {
  return safeThreshold(value ?? process.env.S09_SLOW_QUERY_THRESHOLD_MS, MAX_S09_SLOW_QUERY_THRESHOLD_MS) ?? DEFAULT_S09_SLOW_QUERY_THRESHOLD_MS;
}

export function getS09QueryBudgetMs(value?: unknown): number {
  return safeThreshold(value ?? process.env.S09_QUERY_BUDGET_MS, MAX_S09_QUERY_BUDGET_MS) ?? DEFAULT_S09_QUERY_BUDGET_MS;
}

/** Measures slow reads/transactions without accepting SQL or returned payloads. */
export async function measureS09Query<T>(
  operation: S09BudgetOperationContext,
  work: () => Promise<T> | T,
  options: S09BudgetQueryOptions = {},
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
    const thresholdMs = getS09SlowQueryThresholdMs(options.thresholdMs);
    const queryBudgetMs = getS09QueryBudgetMs(options.queryBudgetMs);
    const budgetExceeded = durationMs >= queryBudgetMs;
    if (durationMs >= thresholdMs || budgetExceeded) {
      const returnedFailure = resultFailure(returnedValue);
      const classification = failed
        ? classifyS09Error(thrownError)
        : returnedFailure.failed ? classifyS09Error(returnedFailure.error) : undefined;
      const safe = sanitizeS09BudgetLog({
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
        transactionFailed:
          options.transactionFailed ??
          (classification?.outcome === "unexpected_error"
            ? transactionFailureFlag(technicalErrorCode(options.technicalErrorCode))
            : undefined),
        durationMs,
        slowQuery: true,
        slowQueryThresholdMs: thresholdMs,
        queryBudgetMs,
        budgetExceeded,
      });
      if (safe) {
        try { addS09BudgetBreadcrumb(safe, safe.outcome, safe); } catch { /* best effort */ }
        try { options.onRecord?.(safe); options.onMetric?.(safe); options.onSlowQuery?.(safe); } catch { /* non-blocking */ }
        try { console.warn(JSON.stringify(safe)); } catch { /* non-blocking */ }
      }
    }
  }
}

export const observeS09Query = measureS09Query;
export const measureS09Transaction = measureS09Query;
export const measureS09Operation = measureS09Query;
export const getS09SlowOperationThresholdMs = getS09SlowQueryThresholdMs;
