import { requireFinancialContext } from "@/modules/households/context";
import { FinancialContextError, type FinancialContext } from "@/modules/households/contracts";
import {
  createS09BudgetOperation,
  withS09BudgetObservability,
  type S09BudgetCompletionOptions,
  type S09BudgetOperationOptions,
} from "@/modules/observability/s09";

import {
  BUDGET_ERROR_CODES,
  budgetBoundarySchema,
  budgetFailure,
  BudgetDomainError,
  type BudgetCorrectionBoundary,
  type BudgetDistributionBoundary,
  type BudgetBoundary,
  type BudgetMovementBoundary,
  type BudgetResult,
  type BudgetTransferBoundary,
} from "./contracts";
import {
  budgetUseCases,
  parseCloseBudgetCommand,
  parseCreateBudgetCommand,
  parseUpdateBudgetCommand,
  type BudgetUseCasePort,
} from "./use-cases";
import {
  budgetMovementUseCases,
  BUDGET_MOVEMENT_COMMAND_OPERATIONS,
  parseCorrectMovementCommand,
  parseDistributeRealizedIncomeCommand,
  parseRegisterContributionCommand,
  parseRegisterWithdrawalCommand,
  parseTransferBetweenBudgetsCommand,
  type BudgetMovementCommandOperation,
  type BudgetMovementUseCasePort,
} from "./movements";

/** Dependencies keep the action boundary unit-testable without Next.js. */
export interface BudgetActionDependencies {
  readonly resolveContext: () => Promise<FinancialContext>;
  readonly port: BudgetUseCasePort;
  readonly revalidateBudgetViews?: (value?: BudgetBoundary) => void | Promise<void>;
  /** Safe aggregate-only hooks for this Server Action boundary. */
  readonly observability?: S09BudgetCompletionOptions & S09BudgetOperationOptions;
}

export interface BudgetActionHandlers {
  createBudget(input: unknown): Promise<BudgetResult<BudgetBoundary>>;
  updateBudget(input: unknown): Promise<BudgetResult<BudgetBoundary>>;
  closeBudget(input: unknown): Promise<BudgetResult<BudgetBoundary>>;
  /** Box aliases are compatibility names only; they share the same port. */
  createBox(input: unknown): Promise<BudgetResult<BudgetBoundary>>;
  updateBox(input: unknown): Promise<BudgetResult<BudgetBoundary>>;
  closeBox(input: unknown): Promise<BudgetResult<BudgetBoundary>>;
}

function isResult<T>(value: unknown): value is BudgetResult<T> {
  if (
    !value ||
    typeof value !== "object" ||
    !("ok" in value) ||
    typeof (value as { ok?: unknown }).ok !== "boolean"
  ) {
    return false;
  }

  if ((value as { ok: boolean }).ok) {
    return budgetBoundarySchema.safeParse(
      (value as { value?: unknown }).value,
    ).success;
  }

  const error = (value as { error?: unknown }).error;
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return (
    typeof code === "string" &&
    BUDGET_ERROR_CODES.includes(code as (typeof BUDGET_ERROR_CODES)[number])
  );
}

function unauthenticated<T>(): BudgetResult<T> {
  return budgetFailure("UNAUTHENTICATED");
}

async function runAction(
  input: unknown,
  dependencies: BudgetActionDependencies,
  operation: "create" | "update" | "close",
): Promise<BudgetResult<BudgetBoundary>> {
  const telemetry = createS09BudgetOperation(
    "budget.write",
    dependencies.observability as S09BudgetOperationOptions | undefined,
  );

  return withS09BudgetObservability(
    telemetry,
    async () => {
      try {
        // Parse before resolving the session so malformed browser input cannot
        // trigger authentication or persistence work. The use case repeats this
        // check for direct non-HTTP callers.
        try {
          if (operation === "create") parseCreateBudgetCommand(input);
          if (operation === "update") parseUpdateBudgetCommand(input);
          if (operation === "close") parseCloseBudgetCommand(input);
        } catch (error) {
          if (error instanceof BudgetDomainError) {
            return budgetFailure(error.code, error.field);
          }
          throw error;
        }

        const context = await dependencies.resolveContext();
        const result = await dependencies.port[operation](context, input);

        if (!isResult<BudgetBoundary>(result)) {
          throw new Error("invalid budget action result");
        }
        if (!result.ok) return result;

        await dependencies.revalidateBudgetViews?.(result.value);
        return result;
      } catch (error) {
        if (error instanceof FinancialContextError) return unauthenticated();
        throw error;
      }
    },
    dependencies.observability,
  );
}

export function createBudgetActionHandlers(
  dependencies: BudgetActionDependencies,
): BudgetActionHandlers {
  const create = (input: unknown) => runAction(input, dependencies, "create");
  const update = (input: unknown) => runAction(input, dependencies, "update");
  const close = (input: unknown) => runAction(input, dependencies, "close");

  return {
    createBudget: create,
    updateBudget: update,
    closeBudget: close,
    createBox: create,
    updateBox: update,
    closeBox: close,
  };
}

/** Production composition resolves FinancialContext only from the session. */
export function getBudgetActionHandlers(
  revalidateBudgetViews?: (value?: BudgetBoundary) => void | Promise<void>,
): BudgetActionHandlers {
  return createBudgetActionHandlers({
    resolveContext: () => requireFinancialContext(),
    port: budgetUseCases,
    revalidateBudgetViews,
  });
}

export const getBudgetsActionHandlers = getBudgetActionHandlers;
export const createBudgetsActionHandlers = createBudgetActionHandlers;

/** Dependencies for movement actions are kept separate from CRUD so existing
 * CRUD consumers can continue to inject the smaller T06 port. */
export interface BudgetMovementActionDependencies {
  readonly resolveContext: () => Promise<FinancialContext>;
  readonly port: BudgetMovementUseCasePort;
  readonly revalidateBudgetViews?: () => void | Promise<void>;
  /** Safe aggregate-only hooks for each movement Server Action boundary. */
  readonly observability?: S09BudgetCompletionOptions & S09BudgetOperationOptions;
}

export interface BudgetMovementActionHandlers {
  registerContribution(
    input: unknown,
  ): Promise<BudgetResult<BudgetMovementBoundary>>;
  registerWithdrawal(input: unknown): Promise<BudgetResult<BudgetMovementBoundary>>;
  transferBetweenBudgets(
    input: unknown,
  ): Promise<BudgetResult<BudgetTransferBoundary>>;
  correctMovement(input: unknown): Promise<BudgetResult<BudgetCorrectionBoundary>>;
  distributeRealizedIncome(
    input: unknown,
  ): Promise<BudgetResult<BudgetDistributionBoundary>>;
  contribution: BudgetMovementActionHandlers["registerContribution"];
  withdrawal: BudgetMovementActionHandlers["registerWithdrawal"];
  transfer: BudgetMovementActionHandlers["transferBetweenBudgets"];
  correct: BudgetMovementActionHandlers["correctMovement"];
  distribute: BudgetMovementActionHandlers["distributeRealizedIncome"];
}

function isMovementResult<T>(value: unknown): value is BudgetResult<T> {
  if (
    !value ||
    typeof value !== "object" ||
    !("ok" in value) ||
    typeof (value as { ok?: unknown }).ok !== "boolean"
  ) {
    return false;
  }
  if ((value as { ok: boolean }).ok) {
    return Boolean("value" in value);
  }
  const error = (value as { error?: unknown }).error;
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return (
    typeof code === "string" &&
    BUDGET_ERROR_CODES.includes(code as (typeof BUDGET_ERROR_CODES)[number])
  );
}

function movementActionCounts(
  operation: BudgetMovementCommandOperation,
): S09BudgetOperationOptions {
  return operation === BUDGET_MOVEMENT_COMMAND_OPERATIONS.transfer
    ? { movementCount: 2 }
    : operation === BUDGET_MOVEMENT_COMMAND_OPERATIONS.distribution
      ? { distributionCount: 1 }
      : { movementCount: 1 };
}

async function runMovementAction<T>(
  input: unknown,
  dependencies: BudgetMovementActionDependencies,
  parse: (input: unknown) => unknown,
  operation: (
    context: FinancialContext,
    input: unknown,
  ) => Promise<BudgetResult<T>>,
  telemetryOperation: BudgetMovementCommandOperation,
): Promise<BudgetResult<T>> {
  const telemetry = createS09BudgetOperation(telemetryOperation, {
    ...(dependencies.observability as S09BudgetOperationOptions | undefined),
    ...movementActionCounts(telemetryOperation),
  });
  return withS09BudgetObservability(
    telemetry,
    async () => {
      try {
        try {
          parse(input);
        } catch (error) {
          if (error instanceof BudgetDomainError) {
            return budgetFailure(error.code, error.field);
          }
          throw error;
        }
        const context = await dependencies.resolveContext();
        const result = await operation(context, input);
        if (!isMovementResult<T>(result)) {
          throw new Error("invalid budget movement action result");
        }
        if (!result.ok) return result;
        await dependencies.revalidateBudgetViews?.();
        return result;
      } catch (error) {
        if (error instanceof FinancialContextError) return unauthenticated();
        throw error;
      }
    },
    dependencies.observability,
  );
}

export function createBudgetMovementActionHandlers(
  dependencies: BudgetMovementActionDependencies,
): BudgetMovementActionHandlers {
  const registerContribution = (input: unknown) =>
    runMovementAction(
      input,
      dependencies,
      parseRegisterContributionCommand,
      dependencies.port.registerContribution,
      BUDGET_MOVEMENT_COMMAND_OPERATIONS.contribution,
    );
  const registerWithdrawal = (input: unknown) =>
    runMovementAction(
      input,
      dependencies,
      parseRegisterWithdrawalCommand,
      dependencies.port.registerWithdrawal,
      BUDGET_MOVEMENT_COMMAND_OPERATIONS.withdrawal,
    );
  const transferBetweenBudgets = (input: unknown) =>
    runMovementAction(
      input,
      dependencies,
      parseTransferBetweenBudgetsCommand,
      dependencies.port.transferBetweenBudgets,
      BUDGET_MOVEMENT_COMMAND_OPERATIONS.transfer,
    );
  const correctMovement = (input: unknown) =>
    runMovementAction(
      input,
      dependencies,
      parseCorrectMovementCommand,
      dependencies.port.correctMovement,
      BUDGET_MOVEMENT_COMMAND_OPERATIONS.correct,
    );
  const distributeRealizedIncome = (input: unknown) =>
    runMovementAction(
      input,
      dependencies,
      parseDistributeRealizedIncomeCommand,
      dependencies.port.distributeRealizedIncome,
      BUDGET_MOVEMENT_COMMAND_OPERATIONS.distribution,
    );
  return {
    registerContribution,
    registerWithdrawal,
    transferBetweenBudgets,
    correctMovement,
    distributeRealizedIncome,
    contribution: registerContribution,
    withdrawal: registerWithdrawal,
    transfer: transferBetweenBudgets,
    correct: correctMovement,
    distribute: distributeRealizedIncome,
  };
}

export function getBudgetMovementActionHandlers(
  revalidateBudgetViews?: () => void | Promise<void>,
): BudgetMovementActionHandlers {
  return createBudgetMovementActionHandlers({
    resolveContext: () => requireFinancialContext(),
    port: budgetMovementUseCases,
    revalidateBudgetViews,
  });
}

export const getBudgetsMovementActionHandlers = getBudgetMovementActionHandlers;
