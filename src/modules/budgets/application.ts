/**
 * Application-layer entrypoint for S09 CRUD/lifecycle commands.
 *
 * The implementation lives in `use-cases.ts`; this stable alias lets callers
 * depend on the application boundary without importing persistence helpers.
 */
export {
  BUDGET_COMMAND_OPERATIONS,
  CLOSE_BUDGET_OPERATION,
  CREATE_BUDGET_OPERATION,
  UPDATE_BUDGET_OPERATION,
  budgetUseCases,
  budgetsUseCases,
  closeBudget,
  CloseBudget,
  CloseBox,
  createBudgetUseCases,
  createBudgetsUseCases,
  createBudgetUseCase,
  createBudgetsUseCase,
  createBudgetUseCasePort,
  createBudgetsUseCasePort,
  CreateBox,
  updateBudget,
  UpdateBudget,
  UpdateBox,
  parseCloseBudgetCommand,
  parseCreateBudgetCommand,
  parseUpdateBudgetCommand,
  isBudgetResultError,
} from "./use-cases";
export type {
  BudgetCommandOperation,
  BudgetTransaction,
  BudgetUseCaseOptions,
  BudgetUseCasePort,
} from "./use-cases";
