/**
 * Server-only adapters for the S05 review flow.
 *
 * The adapter is intentionally boring: parse an untrusted serializable value,
 * resolve the authenticated financial context, invoke a port and return a
 * serializable Result.  It never accepts household/origin/lineage authority
 * from the browser and it never reaches Drizzle directly.
 */

import { AuthGuardError } from "@/modules/auth/server";
import {
  FinancialContextError,
  type FinancialContext,
} from "@/modules/households/contracts";
import { requireFinancialContext } from "@/modules/households/context";
import { isFinancialContext } from "@/modules/households/tenant-scoped";

import {
  createTransactionReviewOperation,
  isExpectedTransactionReviewError,
  withTransactionReviewObservability,
} from "./observability-review";
import {
  TRANSACTION_REVIEW_ERROR_CODES,
  TRANSACTION_REVIEW_ERROR_MESSAGES,
  failure,
  ok,
  parseListReviewableTransactionsQuery,
  parseTransactionReviewSummaryQuery,
  parseUpdateReviewableTransactionCommand,
  toTransactionReviewError,
  type NormalizedListReviewableTransactionsQuery,
  type NormalizedTransactionReviewSummaryQuery,
  type TransactionReviewError,
  type TransactionReviewResult,
  type TransactionDetailReadModel,
  type TransactionListReadModel,
  type TransactionReviewSummaryReadModel,
} from "./review-contracts";
import {
  reviewableTransactionUseCases,
  type ReviewableTransactionUpdateReadModel,
  type ReviewableTransactionUseCasePort,
} from "./review-use-cases";
import { transactionReviewReadUseCases } from "./review-reads";

type MaybePromise<T> = T | Promise<T>;

/**
 * T04 may return a plain read model while it is composed, or a Result once it
 * is behind its own domain boundary. Supporting both keeps this adapter thin
 * and avoids duplicating read-side error translation.
 */
export type ReviewReadPortValue<T> = T | TransactionReviewResult<T>;

export interface TransactionReviewReadUseCasePort {
  list(
    context: FinancialContext,
    query: NormalizedListReviewableTransactionsQuery,
  ): MaybePromise<ReviewReadPortValue<TransactionListReadModel>>;
  detail(
    context: FinancialContext,
    financialEventId: string,
  ): MaybePromise<
    ReviewReadPortValue<TransactionDetailReadModel | undefined>
  >;
  summary(
    context: FinancialContext,
    query: NormalizedTransactionReviewSummaryQuery,
  ): MaybePromise<ReviewReadPortValue<TransactionReviewSummaryReadModel>>;
}

export type ReviewableTransactionReadUseCasePort =
  TransactionReviewReadUseCasePort;

export interface TransactionReviewActionPort
  extends TransactionReviewReadUseCasePort,
    ReviewableTransactionUseCasePort {}

export type ReviewActionPort = TransactionReviewActionPort;

export interface TransactionReviewCacheDependencies {
  /** Called only after a successful update has committed. */
  revalidateReview?: (
    value: ReviewableTransactionUpdateReadModel,
  ) => void | Promise<void>;
  /** Naming alias used by list/detail integrations. */
  revalidateTransactions?: (
    value: ReviewableTransactionUpdateReadModel,
  ) => void | Promise<void>;
}

export interface TransactionReviewActionDependencies
  extends TransactionReviewCacheDependencies {
  /** Resolves the session-derived household. */
  resolveContext: () => Promise<FinancialContext>;
  /** Combined port used by the convenience factory. */
  port?: TransactionReviewActionPort;
  /** Read and write ports can be supplied independently during T04/T05 handoff. */
  readPort?: TransactionReviewReadUseCasePort;
  updatePort?: ReviewableTransactionUseCasePort;
}

export interface TransactionReviewReadActionHandlers {
  list(
    input?: unknown,
  ): Promise<TransactionReviewResult<TransactionListReadModel>>;
  listReviewableTransactions(
    input?: unknown,
  ): Promise<TransactionReviewResult<TransactionListReadModel>>;
  detail(
    input: unknown,
  ): Promise<TransactionReviewResult<TransactionDetailReadModel>>;
  getDetail(
    input: unknown,
  ): Promise<TransactionReviewResult<TransactionDetailReadModel>>;
  getTransactionDetail(
    input: unknown,
  ): Promise<TransactionReviewResult<TransactionDetailReadModel>>;
  summary(
    input?: unknown,
  ): Promise<TransactionReviewResult<TransactionReviewSummaryReadModel>>;
  getSummary(
    input?: unknown,
  ): Promise<TransactionReviewResult<TransactionReviewSummaryReadModel>>;
  getTransactionReviewSummary(
    input?: unknown,
  ): Promise<TransactionReviewResult<TransactionReviewSummaryReadModel>>;
}

export interface TransactionReviewUpdateActionHandlers {
  update(
    input: unknown,
  ): Promise<TransactionReviewResult<ReviewableTransactionUpdateReadModel>>;
  updateReviewableTransaction(
    input: unknown,
  ): Promise<TransactionReviewResult<ReviewableTransactionUpdateReadModel>>;
  updateTransactionReview(
    input: unknown,
  ): Promise<TransactionReviewResult<ReviewableTransactionUpdateReadModel>>;
}

export interface TransactionReviewActionHandlers
  extends TransactionReviewReadActionHandlers,
    TransactionReviewUpdateActionHandlers {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTransactionReviewErrorCode(value: unknown): value is (typeof TRANSACTION_REVIEW_ERROR_CODES)[number] {
  return (
    typeof value === "string" &&
    TRANSACTION_REVIEW_ERROR_CODES.includes(value as (typeof TRANSACTION_REVIEW_ERROR_CODES)[number])
  );
}

function isTransactionReviewResult<T>(value: unknown): value is TransactionReviewResult<T> {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return false;
  }

  if (value.ok) {
    return Object.prototype.hasOwnProperty.call(value, "value");
  }

  return (
    isRecord(value.error) &&
    isTransactionReviewErrorCode(value.error.code)
  );
}

/** Reject ORM records and other non-serializable values at the action edge. */
function isSerializable(value: unknown, seen = new Set<unknown>()): boolean {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (
    typeof value === "bigint" ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    value instanceof Date
  ) {
    return false;
  }

  if (typeof value !== "object") {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.every((item) => isSerializable(item, seen));
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  return Object.values(value).every((item) => isSerializable(item, seen));
}

function normalizePortValue<T>(value: unknown): TransactionReviewResult<T> {
  if (isTransactionReviewResult<T>(value)) {
    if (!value.ok) {
      return {
        ok: false,
        error: toTransactionReviewError(value.error),
      };
    }
    if (!isSerializable(value.value)) {
      throw new Error("O use case de revisão retornou dados não serializáveis.");
    }
    return value;
  }

  if (!isSerializable(value)) {
    throw new Error("O use case de revisão retornou dados não serializáveis.");
  }

  if (isRecord(value) && "ok" in value && typeof value.ok === "boolean") {
    throw new Error("O use case de revisão retornou um Result inválido.");
  }

  return ok(value as T);
}

function publicContextError(error: unknown): TransactionReviewError | undefined {
  const code =
    isRecord(error) && typeof error.code === "string" ? error.code : undefined;

  if (
    error instanceof FinancialContextError ||
    error instanceof AuthGuardError ||
    code === "UNAUTHENTICATED" ||
    code === "INVALID_SESSION" ||
    code === "HOUSEHOLD_MEMBERSHIP_REQUIRED" ||
    code === "HOUSEHOLD_SELECTION_REQUIRED" ||
    code === "INVALID_FINANCIAL_CONTEXT"
  ) {
    const mapped =
      code === "HOUSEHOLD_MEMBERSHIP_REQUIRED" ||
      code === "HOUSEHOLD_SELECTION_REQUIRED" ||
      code === "INVALID_FINANCIAL_CONTEXT"
        ? code
        : "UNAUTHENTICATED";
    return {
      code: mapped,
      message: TRANSACTION_REVIEW_ERROR_MESSAGES[mapped],
    };
  }

  return undefined;
}

function contextFailure<T>(error: unknown): TransactionReviewResult<T> | undefined {
  const safe = publicContextError(error);
  return safe ? { ok: false, error: safe } : undefined;
}

function parseListInput(
  input: unknown,
): TransactionReviewResult<NormalizedListReviewableTransactionsQuery> {
  try {
    return ok(parseListReviewableTransactionsQuery(input ?? {}));
  } catch (error) {
    return { ok: false, error: toTransactionReviewError(error, "INVALID_QUERY") };
  }
}

function parseSummaryInput(
  input: unknown,
): TransactionReviewResult<NormalizedTransactionReviewSummaryQuery> {
  try {
    return ok(parseTransactionReviewSummaryQuery(input ?? {}));
  } catch (error) {
    return { ok: false, error: toTransactionReviewError(error, "INVALID_QUERY") };
  }
}

function parseDetailId(input: unknown): TransactionReviewResult<string> {
  const value =
    typeof input === "string"
      ? input
      : isRecord(input) && Object.keys(input).length === 1
        ? input.financialEventId
        : undefined;

  if (typeof value !== "string") {
    return failure("EVENT_NOT_FOUND", "financialEventId");
  }

  const normalized = value.trim();
  // Importing the UUID predicate here would make the adapter depend on a
  // persistence shape. The T04 port still revalidates the ID in its context;
  // this check only avoids sending arbitrary strings to a database adapter.
  if (
    normalized.length === 0 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      normalized,
    )
  ) {
    return failure("EVENT_NOT_FOUND", "financialEventId");
  }

  return ok(normalized);
}

function parseUpdateInput(
  input: unknown,
): TransactionReviewResult<ReturnType<typeof parseUpdateReviewableTransactionCommand>> {
  try {
    return ok(parseUpdateReviewableTransactionCommand(input));
  } catch (error) {
    return { ok: false, error: toTransactionReviewError(error, "INVALID_COMMAND") };
  }
}

async function resolveActionContext(
  resolveContext: () => Promise<FinancialContext>,
): Promise<TransactionReviewResult<FinancialContext>> {
  try {
    const context = await resolveContext();
    return isFinancialContext(context)
      ? ok(context)
      : failure("INVALID_FINANCIAL_CONTEXT");
  } catch (error) {
    return contextFailure<FinancialContext>(error) ?? (() => {
      throw error;
    })();
  }
}

function operationFor(
  operation: "list" | "summary" | "detail" | "update",
  input: unknown,
  context?: FinancialContext,
) {
  const eventId =
    operation === "detail" || operation === "update"
      ? typeof input === "string"
        ? input
        : isRecord(input) && typeof input.financialEventId === "string"
          ? input.financialEventId
          : undefined
      : undefined;

  return createTransactionReviewOperation(operation, {
    requestId: undefined,
    eventId,
    userId: context?.userId,
    householdId: context?.householdId,
  });
}

async function runRead<TInput, TResult>(
  operation: "list" | "summary" | "detail",
  input: unknown,
  dependencies: Pick<TransactionReviewActionDependencies, "resolveContext">,
  parse: (input: unknown) => TransactionReviewResult<TInput>,
  invoke: (
    context: FinancialContext,
    input: TInput,
  ) => MaybePromise<ReviewReadPortValue<TResult>>,
): Promise<TransactionReviewResult<TResult>> {
  const initialOperation = operationFor(operation, input);

  return withTransactionReviewObservability(
    initialOperation,
    async () => {
      const parsed = parse(input);
      if (!parsed.ok) {
        return parsed;
      }

      const contextResult = await resolveActionContext(dependencies.resolveContext);
      if (!contextResult.ok) {
        return contextResult;
      }

      Object.assign(
        initialOperation,
        operationFor(operation, input, contextResult.value),
      );

      let result: ReviewReadPortValue<TResult>;
      try {
        result = await invoke(contextResult.value, parsed.value);
      } catch (error) {
        if (isExpectedTransactionReviewErrorLike(error)) {
          return { ok: false, error: toTransactionReviewError(error) };
        }
        throw error;
      }
      const normalized = normalizePortValue<TResult>(result);
      if (!normalized.ok) {
        return normalized;
      }
      return normalized;
    },
  );
}

async function runUpdate(
  input: unknown,
  dependencies: TransactionReviewActionDependencies,
  port: ReviewableTransactionUseCasePort,
): Promise<TransactionReviewResult<ReviewableTransactionUpdateReadModel>> {
  const operation = operationFor("update", input);

  return withTransactionReviewObservability(operation, async () => {
    const parsed = parseUpdateInput(input);
    if (!parsed.ok) {
      return parsed;
    }

    const contextResult = await resolveActionContext(dependencies.resolveContext);
    if (!contextResult.ok) {
      return contextResult;
    }

    let result: ReviewReadPortValue<ReviewableTransactionUpdateReadModel>;
    try {
      result = await port.updateReviewableTransaction(
        contextResult.value,
        parsed.value,
      );
    } catch (error) {
      if (isExpectedTransactionReviewErrorLike(error)) {
        return { ok: false, error: toTransactionReviewError(error) };
      }
      throw error;
    }
    const normalized = normalizePortValue<ReviewableTransactionUpdateReadModel>(
      result,
    );
    if (!normalized.ok) {
      return normalized;
    }

    // Cache invalidation is intentionally after the successful port result.
    // A domain failure never causes a success-looking refresh.
    const revalidate =
      dependencies.revalidateReview ?? dependencies.revalidateTransactions;
    await revalidate?.(normalized.value);
    return normalized;
  }, {
    technicalErrorCode: "UPDATE_FAILED",
  });
}

function isExpectedTransactionReviewErrorLike(error: unknown): boolean {
  if (isExpectedTransactionReviewError(error)) {
    return true;
  }
  return isRecord(error) && isTransactionReviewErrorCode(error.code);
}

function requireReadPort(
  dependencies: TransactionReviewActionDependencies,
): TransactionReviewReadUseCasePort {
  return dependencies.readPort ?? dependencies.port ?? transactionReviewReadUseCases;
}

function requireUpdatePort(
  dependencies: TransactionReviewActionDependencies,
): ReviewableTransactionUseCasePort {
  const port = dependencies.updatePort ?? dependencies.port;
  if (!port) {
    return reviewableTransactionUseCases;
  }
  return port;
}

export function createTransactionReviewReadActionHandlers(
  dependencies: Pick<TransactionReviewActionDependencies, "resolveContext" | "port" | "readPort">,
): TransactionReviewReadActionHandlers {
  const port = requireReadPort(dependencies);

  const list = (input?: unknown) =>
    runRead(
      "list",
      input,
      dependencies,
      parseListInput,
      (context, query) => port.list(context, query),
    );
  const detail = (input: unknown): Promise<TransactionReviewResult<TransactionDetailReadModel>> =>
    runRead<string, TransactionDetailReadModel>(
      "detail",
      input,
      dependencies,
      parseDetailId,
      async (context, eventId) => {
        const result = normalizePortValue<TransactionDetailReadModel | undefined>(
          await port.detail(context, eventId),
        );
        if (!result.ok) {
          return result as TransactionReviewResult<TransactionDetailReadModel>;
        }
        return result.value === undefined
          ? failure("EVENT_NOT_FOUND", "financialEventId")
          : ok(result.value);
      },
    );
  const summary = (input?: unknown) =>
    runRead(
      "summary",
      input,
      dependencies,
      parseSummaryInput,
      (context, query) => port.summary(context, query),
    );

  return {
    list,
    listReviewableTransactions: list,
    detail,
    getDetail: detail,
    getTransactionDetail: detail,
    summary,
    getSummary: summary,
    getTransactionReviewSummary: summary,
  };
}

export function createTransactionReviewUpdateActionHandlers(
  dependencies: TransactionReviewActionDependencies,
): TransactionReviewUpdateActionHandlers {
  const port = requireUpdatePort(dependencies);
  const update = (input: unknown) => runUpdate(input, dependencies, port);
  return {
    update,
    updateReviewableTransaction: update,
    updateTransactionReview: update,
  };
}

export function createTransactionReviewActionHandlers(
  dependencies: TransactionReviewActionDependencies,
): TransactionReviewActionHandlers {
  return {
    ...createTransactionReviewReadActionHandlers(dependencies),
    ...createTransactionReviewUpdateActionHandlers(dependencies),
  };
}

export const createReviewActionHandlers =
  createTransactionReviewActionHandlers;
export const createReviewableTransactionActionHandlers =
  createTransactionReviewActionHandlers;
export const createReviewReadActionHandlers =
  createTransactionReviewReadActionHandlers;
export const createReviewUpdateActionHandlers =
  createTransactionReviewUpdateActionHandlers;

/**
 * Production update composition. The read port is supplied by T04 at the
 * application composition boundary; update itself is available immediately
 * from T05's concrete port.
 */
export function getTransactionReviewActionHandlers(
  dependencies: Omit<
    TransactionReviewActionDependencies,
    "resolveContext" | "updatePort"
  > & {
    resolveContext?: () => Promise<FinancialContext>;
    updatePort?: ReviewableTransactionUseCasePort;
  } = {},
): TransactionReviewActionHandlers {
  return createTransactionReviewActionHandlers({
    ...dependencies,
    resolveContext: dependencies.resolveContext ?? (() => requireFinancialContext()),
    updatePort: dependencies.updatePort ?? reviewableTransactionUseCases,
  });
}

export function getTransactionReviewUpdateActionHandlers(
  dependencies: Omit<
    TransactionReviewActionDependencies,
    "resolveContext" | "updatePort"
  > & {
    resolveContext?: () => Promise<FinancialContext>;
    updatePort?: ReviewableTransactionUseCasePort;
  } = {},
): TransactionReviewUpdateActionHandlers {
  return createTransactionReviewUpdateActionHandlers({
    ...dependencies,
    resolveContext: dependencies.resolveContext ?? (() => requireFinancialContext()),
    updatePort: dependencies.updatePort ?? reviewableTransactionUseCases,
  });
}

export const getReviewActionHandlers = getTransactionReviewActionHandlers;
export const getReviewableTransactionActionHandlers =
  getTransactionReviewActionHandlers;
export const getReviewUpdateActionHandlers =
  getTransactionReviewUpdateActionHandlers;

/** Compatibility aliases for callers that name the mutation explicitly. */
export const createUpdateReviewableTransactionActionHandlers =
  createTransactionReviewUpdateActionHandlers;
export const getUpdateReviewableTransactionActionHandlers =
  getTransactionReviewUpdateActionHandlers;
