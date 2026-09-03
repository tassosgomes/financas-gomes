import { requireFinancialContext } from "@/modules/households/context";
import type { FinancialContext } from "@/modules/households/contracts";
import {
  createObservabilityRequestId,
  createTransactionObservabilityOperation,
  isExpectedTransactionError,
  logTransactionObservabilityOperation,
  reportTransactionUnexpectedError,
  toTransactionActionError,
} from "@/modules/observability";

import {
  TRANSACTION_ERROR_CODES,
  type CreateExpenseCommand,
  type CreateIncomeCommand,
  type CancelManualTransactionCommand,
  type ManualTransactionKind,
  type ManualTransactionReadModel,
  type TransactionResult,
  type UpdateManualTransactionCommand,
} from "./contracts";
import {
  safeParseCancelManualTransactionCommand,
  safeParseCreateExpenseCommand,
  safeParseCreateIncomeCommand,
  safeParseUpdateManualTransactionCommand,
} from "./validation";
import {
  transactionsUseCases,
  type TransactionsMaintenanceUseCasePort,
  type TransactionsUseCasePort,
} from "./use-cases";

/** Invalid result protection keeps malformed adapter ports out of the UI. */
function isTransactionResult<T>(value: unknown): value is TransactionResult<T> {
  if (
    typeof value !== "object" ||
    value === null ||
    !("ok" in value) ||
    typeof (value as { ok?: unknown }).ok !== "boolean"
  ) {
    return false;
  }

  if ((value as { ok: boolean }).ok) {
    return "value" in value;
  }

  const error = (value as { error?: unknown }).error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;

  return (
    typeof code === "string" &&
    TRANSACTION_ERROR_CODES.includes(code as (typeof TRANSACTION_ERROR_CODES)[number])
  );
}

function monotonicNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(monotonicNow() - startedAt));
}

export interface TransactionCreateActionDependencies {
  /** Resolves tenant context from the authenticated server session. */
  resolveContext: () => Promise<FinancialContext>;
  /** T05 port; the adapter never reaches persistence directly. */
  port: TransactionsUseCasePort;
  /** Invalidates the collection after a committed write. */
  revalidateTransactions?: () => void | Promise<void>;
}

export interface TransactionCreateActionHandlers {
  createExpense(input: unknown): Promise<TransactionResult<ManualTransactionReadModel>>;
  createIncome(input: unknown): Promise<TransactionResult<ManualTransactionReadModel>>;
}

function parseCommand(
  kind: ManualTransactionKind,
  input: unknown,
): TransactionResult<CreateExpenseCommand | CreateIncomeCommand> {
  return kind === "EXPENSE"
    ? safeParseCreateExpenseCommand(input)
    : safeParseCreateIncomeCommand(input);
}

/**
 * Runs one create action. The parser is deliberately before context resolution
 * so malformed payloads cannot trigger authentication/database work.
 */
async function runCreate(
  kind: ManualTransactionKind,
  input: unknown,
  dependencies: TransactionCreateActionDependencies,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  const startedAt = monotonicNow();
  const operation = createTransactionObservabilityOperation("create", kind, {
    requestId: createObservabilityRequestId(),
  });

  const parsed = parseCommand(kind, input);
  if (!parsed.ok) {
    logTransactionObservabilityOperation(
      operation,
      "expected_error",
      elapsedMs(startedAt),
      undefined,
      parsed.error.code,
    );
    return parsed;
  }

  let context: FinancialContext;
  try {
    context = await dependencies.resolveContext();
  } catch (error) {
    if (isExpectedTransactionError(error)) {
      const safeError = toTransactionActionError(error);
      logTransactionObservabilityOperation(
        operation,
        "expected_error",
        elapsedMs(startedAt),
        undefined,
        safeError.code,
      );
      return { ok: false, error: safeError };
    }

    reportTransactionUnexpectedError(error, operation, elapsedMs(startedAt));
    throw error;
  }

  let operationForError = operation;
  try {
    const result =
      kind === "EXPENSE"
        ? await dependencies.port.createExpense(
            context,
            parsed.value as CreateExpenseCommand,
          )
        : await dependencies.port.createIncome(
            context,
            parsed.value as CreateIncomeCommand,
          );

    if (!isTransactionResult<ManualTransactionReadModel>(result)) {
      const invalidResultError = new Error("invalid transaction create result");
      throw invalidResultError;
    }

    if (!result.ok) {
      const safeError = toTransactionActionError(result.error);
      logTransactionObservabilityOperation(
        operation,
        "expected_error",
        elapsedMs(startedAt),
        context,
        safeError.code,
      );
      return { ok: false, error: safeError };
    }

    const completedOperation = createTransactionObservabilityOperation("create", kind, {
      requestId: operation.requestId,
      eventId: result.value.id,
    });
    operationForError = completedOperation;

    await dependencies.revalidateTransactions?.();

    logTransactionObservabilityOperation(
      completedOperation,
      "success",
      elapsedMs(startedAt),
      context,
    );
    return { ok: true, value: result.value };
  } catch (error) {
    if (isExpectedTransactionError(error)) {
      const safeError = toTransactionActionError(error);
      logTransactionObservabilityOperation(
        operation,
        "expected_error",
        elapsedMs(startedAt),
        context,
        safeError.code,
      );
      return { ok: false, error: safeError };
    }

    // The port keeps technical failures outside Result so T08 can retain the
    // stack while this boundary exposes only a generic client failure.
    reportTransactionUnexpectedError(
      error,
      operationForError,
      elapsedMs(startedAt),
      context,
    );
    throw error;
  }
}

/** Builds action handlers around explicit context, port and cache dependencies. */
export function createTransactionActionHandlers(
  dependencies: TransactionCreateActionDependencies,
): TransactionCreateActionHandlers {
  return {
    createExpense: (input) => runCreate("EXPENSE", input, dependencies),
    createIncome: (input) => runCreate("INCOME", input, dependencies),
  };
}

/** Production composition used by the Next Server Action boundary. */
export function getTransactionActionHandlers(
  revalidateTransactions?: () => void | Promise<void>,
): TransactionCreateActionHandlers {
  return createTransactionActionHandlers({
    resolveContext: () => requireFinancialContext(),
    port: transactionsUseCases,
    revalidateTransactions,
  });
}

export interface TransactionMaintenanceActionDependencies {
  /** Resolves tenant context from the authenticated server session. */
  resolveContext: () => Promise<FinancialContext>;
  /** T07 maintenance port; the adapter never reaches persistence directly. */
  port: TransactionsMaintenanceUseCasePort;
  /** Invalidates collection/detail/balance views after a committed write. */
  revalidateTransactions?: (
    transaction?: ManualTransactionReadModel,
  ) => void | Promise<void>;
}

export interface TransactionMaintenanceActionHandlers {
  updateManualTransaction(
    input: unknown,
  ): Promise<TransactionResult<ManualTransactionReadModel>>;
  cancelManualTransaction(
    input: unknown,
  ): Promise<TransactionResult<ManualTransactionReadModel>>;
  /** Short aliases preserve the generic maintenance port vocabulary. */
  update(input: unknown): Promise<TransactionResult<ManualTransactionReadModel>>;
  cancel(input: unknown): Promise<TransactionResult<ManualTransactionReadModel>>;
}

type MaintenanceOperation = "update" | "cancel";
type MaintenanceCommand =
  | UpdateManualTransactionCommand
  | CancelManualTransactionCommand;

function parseMaintenanceCommand(
  operation: MaintenanceOperation,
  input: unknown,
): TransactionResult<MaintenanceCommand> {
  return operation === "update"
    ? safeParseUpdateManualTransactionCommand(input)
    : safeParseCancelManualTransactionCommand(input);
}

/**
 * Runs T07 maintenance actions through the same safe boundary as T10 create.
 * The event ID is added only after strict parsing and never the full command.
 */
async function runMaintenance(
  operation: MaintenanceOperation,
  input: unknown,
  dependencies: TransactionMaintenanceActionDependencies,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  const startedAt = monotonicNow();
  const requestId = createObservabilityRequestId();
  let operationContext = createTransactionObservabilityOperation(operation, "MANUAL", {
    requestId,
  });

  const parsed = parseMaintenanceCommand(operation, input);
  if (!parsed.ok) {
    operationContext = createTransactionObservabilityOperation(operation, "MANUAL", {
      requestId,
    });
    logTransactionObservabilityOperation(
      operationContext,
      "expected_error",
      elapsedMs(startedAt),
      undefined,
      parsed.error.code,
    );
    return parsed;
  }

  operationContext = createTransactionObservabilityOperation(operation, "MANUAL", {
    requestId,
    eventId: parsed.value.financialEventId,
  });

  let context: FinancialContext;
  try {
    context = await dependencies.resolveContext();
  } catch (error) {
    if (isExpectedTransactionError(error)) {
      const safeError = toTransactionActionError(error);
      logTransactionObservabilityOperation(
        operationContext,
        "expected_error",
        elapsedMs(startedAt),
        undefined,
        safeError.code,
      );
      return { ok: false, error: safeError };
    }

    reportTransactionUnexpectedError(error, operationContext, elapsedMs(startedAt));
    throw error;
  }

  try {
    const result =
      operation === "update"
        ? await dependencies.port.updateManualTransaction(
            context,
            parsed.value as UpdateManualTransactionCommand,
          )
        : await dependencies.port.cancelManualTransaction(
            context,
            parsed.value as CancelManualTransactionCommand,
          );

    if (!isTransactionResult<ManualTransactionReadModel>(result)) {
      throw new Error("invalid transaction maintenance result");
    }

    if (!result.ok) {
      const safeError = toTransactionActionError(result.error);
      logTransactionObservabilityOperation(
        operationContext,
        "expected_error",
        elapsedMs(startedAt),
        context,
        safeError.code,
      );
      return { ok: false, error: safeError };
    }

    await dependencies.revalidateTransactions?.(result.value);
    logTransactionObservabilityOperation(
      operationContext,
      "success",
      elapsedMs(startedAt),
      context,
    );
    return { ok: true, value: result.value };
  } catch (error) {
    if (isExpectedTransactionError(error)) {
      const safeError = toTransactionActionError(error);
      logTransactionObservabilityOperation(
        operationContext,
        "expected_error",
        elapsedMs(startedAt),
        context,
        safeError.code,
      );
      return { ok: false, error: safeError };
    }

    reportTransactionUnexpectedError(
      error,
      operationContext,
      elapsedMs(startedAt),
      context,
    );
    throw error;
  }
}

/** Builds update/cancel handlers around explicit context and T07 ports. */
export function createTransactionMaintenanceActionHandlers(
  dependencies: TransactionMaintenanceActionDependencies,
): TransactionMaintenanceActionHandlers {
  return {
    updateManualTransaction: (input) =>
      runMaintenance("update", input, dependencies),
    cancelManualTransaction: (input) =>
      runMaintenance("cancel", input, dependencies),
    update: (input) => runMaintenance("update", input, dependencies),
    cancel: (input) => runMaintenance("cancel", input, dependencies),
  };
}

/** Production composition used by the future maintenance Server Actions. */
export function getTransactionMaintenanceActionHandlers(
  revalidateTransactions?: TransactionMaintenanceActionDependencies["revalidateTransactions"],
): TransactionMaintenanceActionHandlers {
  return createTransactionMaintenanceActionHandlers({
    resolveContext: () => requireFinancialContext(),
    port: transactionsUseCases,
    revalidateTransactions,
  });
}

/** S05 review list/detail/summary/update action adapters. */
export * from "./review-adapters";
