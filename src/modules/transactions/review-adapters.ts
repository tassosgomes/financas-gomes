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
  createS05TransactionReviewOperation,
  isExpectedS05Error,
  withS05TransactionReviewObservability,
} from "./observability-s05";
import {
  S05_ERROR_CODES,
  S05_ERROR_MESSAGES,
  failure,
  ok,
  parseListReviewableTransactionsQuery,
  parseTransactionReviewSummaryQuery,
  parseUpdateReviewableTransactionCommand,
  toS05Error,
  type NormalizedListReviewableTransactionsQuery,
  type NormalizedTransactionReviewSummaryQuery,
  type S05Error,
  type S05Result,
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
export type ReviewReadPortValue<T> = T | S05Result<T>;

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
  ): Promise<S05Result<TransactionListReadModel>>;
  listReviewableTransactions(
    input?: unknown,
  ): Promise<S05Result<TransactionListReadModel>>;
  detail(
    input: unknown,
  ): Promise<S05Result<TransactionDetailReadModel>>;
  getDetail(
    input: unknown,
  ): Promise<S05Result<TransactionDetailReadModel>>;
  getTransactionDetail(
    input: unknown,
  ): Promise<S05Result<TransactionDetailReadModel>>;
  summary(
    input?: unknown,
  ): Promise<S05Result<TransactionReviewSummaryReadModel>>;
  getSummary(
    input?: unknown,
  ): Promise<S05Result<TransactionReviewSummaryReadModel>>;
  getTransactionReviewSummary(
    input?: unknown,
  ): Promise<S05Result<TransactionReviewSummaryReadModel>>;
}

export interface TransactionReviewUpdateActionHandlers {
  update(
    input: unknown,
  ): Promise<S05Result<ReviewableTransactionUpdateReadModel>>;
  updateReviewableTransaction(
    input: unknown,
  ): Promise<S05Result<ReviewableTransactionUpdateReadModel>>;
  updateTransactionReview(
    input: unknown,
  ): Promise<S05Result<ReviewableTransactionUpdateReadModel>>;
}

export interface TransactionReviewActionHandlers
  extends TransactionReviewReadActionHandlers,
    TransactionReviewUpdateActionHandlers {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isS05ErrorCode(value: unknown): value is (typeof S05_ERROR_CODES)[number] {
  return (
    typeof value === "string" &&
    S05_ERROR_CODES.includes(value as (typeof S05_ERROR_CODES)[number])
  );
}

function isS05Result<T>(value: unknown): value is S05Result<T> {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return false;
  }

  if (value.ok) {
    return Object.prototype.hasOwnProperty.call(value, "value");
  }

  return (
    isRecord(value.error) &&
    isS05ErrorCode(value.error.code)
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

function normalizePortValue<T>(value: unknown): S05Result<T> {
  if (isS05Result<T>(value)) {
    if (!value.ok) {
      return {
        ok: false,
        error: toS05Error(value.error),
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

function publicContextError(error: unknown): S05Error | undefined {
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
      message: S05_ERROR_MESSAGES[mapped],
    };
  }

  return undefined;
}

function contextFailure<T>(error: unknown): S05Result<T> | undefined {
  const safe = publicContextError(error);
  return safe ? { ok: false, error: safe } : undefined;
}

function parseListInput(
  input: unknown,
): S05Result<NormalizedListReviewableTransactionsQuery> {
  try {
    return ok(parseListReviewableTransactionsQuery(input ?? {}));
  } catch (error) {
    return { ok: false, error: toS05Error(error, "INVALID_QUERY") };
  }
}

function parseSummaryInput(
  input: unknown,
): S05Result<NormalizedTransactionReviewSummaryQuery> {
  try {
    return ok(parseTransactionReviewSummaryQuery(input ?? {}));
  } catch (error) {
    return { ok: false, error: toS05Error(error, "INVALID_QUERY") };
  }
}

function parseDetailId(input: unknown): S05Result<string> {
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
): S05Result<ReturnType<typeof parseUpdateReviewableTransactionCommand>> {
  try {
    return ok(parseUpdateReviewableTransactionCommand(input));
  } catch (error) {
    return { ok: false, error: toS05Error(error, "INVALID_COMMAND") };
  }
}

async function resolveActionContext(
  resolveContext: () => Promise<FinancialContext>,
): Promise<S05Result<FinancialContext>> {
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

  return createS05TransactionReviewOperation(operation, {
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
  parse: (input: unknown) => S05Result<TInput>,
  invoke: (
    context: FinancialContext,
    input: TInput,
  ) => MaybePromise<ReviewReadPortValue<TResult>>,
): Promise<S05Result<TResult>> {
  const initialOperation = operationFor(operation, input);

  return withS05TransactionReviewObservability(
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
        if (isExpectedS05ErrorLike(error)) {
          return { ok: false, error: toS05Error(error) };
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
): Promise<S05Result<ReviewableTransactionUpdateReadModel>> {
  const operation = operationFor("update", input);

  return withS05TransactionReviewObservability(operation, async () => {
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
      if (isExpectedS05ErrorLike(error)) {
        return { ok: false, error: toS05Error(error) };
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

function isExpectedS05ErrorLike(error: unknown): boolean {
  if (isExpectedS05Error(error)) {
    return true;
  }
  return isRecord(error) && isS05ErrorCode(error.code);
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
  const detail = (input: unknown): Promise<S05Result<TransactionDetailReadModel>> =>
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
          return result as S05Result<TransactionDetailReadModel>;
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
