"use server";

import { revalidatePath } from "next/cache";

import {
  getBudgetActionHandlers,
  getBudgetMovementActionHandlers,
} from "@/modules/budgets/actions";
import {
  BUDGET_DETAIL_ROUTE_PATTERN,
  BUDGET_DASHBOARD_ROUTE,
  BUDGETS_ROUTE,
  budgetDetailRoute,
  SPENDABLE_BREAKDOWN_ROUTE,
  SPENDABLE_ROUTE,
} from "@/modules/budgets/routes";
import type {
  BudgetBoundary,
  BudgetCorrectionBoundary,
  BudgetDistributionBoundary,
  BudgetMovementBoundary,
  BudgetResult,
  BudgetTransferBoundary,
} from "@/modules/budgets/contracts";
import { budgetReadAccess } from "@/modules/budgets/service";
import type {
  BudgetDetailReadModel,
  BudgetHistoryReadModel,
  BudgetReadResult,
  ListBudgetMovementsQuery,
  ListBudgetsQuery,
  ListBudgetsReadModel,
} from "@/modules/budgets/read-contracts";
import { getTodayIsoDate } from "@/modules/transactions/form-contract";

function revalidateBudgetViews(value?: BudgetBoundary): void {
  revalidatePath(BUDGETS_ROUTE);
  revalidatePath(BUDGET_DETAIL_ROUTE_PATTERN, "page");
  revalidatePath(BUDGET_DASHBOARD_ROUTE);
  revalidatePath(SPENDABLE_ROUTE);
  revalidatePath(SPENDABLE_BREAKDOWN_ROUTE);

  if (value) {
    revalidatePath(budgetDetailRoute(value.referenceId));
  }
}

function productionHandlers() {
  return getBudgetActionHandlers(revalidateBudgetViews);
}

function productionMovementHandlers() {
  return getBudgetMovementActionHandlers(() => revalidateBudgetViews());
}

/**
 * Server-owned collection read. The browser may provide only the public read
 * filter; `budgetReadAccess` resolves FinancialContext from the session and
 * tenant-scopes the query before any row is returned.
 */
export async function listBudgetsAction(
  input?: ListBudgetsQuery,
): Promise<BudgetReadResult<ListBudgetsReadModel>> {
  return budgetReadAccess.list({
    ...(input ?? {}),
    asOf: input?.asOf ?? getTodayIsoDate(),
  });
}

/** Server-owned detail read; the reference is opaque and context is session-resolved. */
export async function getBudgetAction(
  budgetReferenceId: unknown,
  input?: ListBudgetMovementsQuery,
): Promise<BudgetReadResult<BudgetDetailReadModel>> {
  return budgetReadAccess.detail(budgetReferenceId, {
    ...(input ?? {}),
    asOf: input?.asOf ?? getTodayIsoDate(),
  });
}

export async function getBudgetHistoryAction(
  budgetReferenceId: unknown,
  input?: ListBudgetMovementsQuery,
): Promise<BudgetReadResult<BudgetHistoryReadModel>> {
  return budgetReadAccess.history(budgetReferenceId, {
    ...(input ?? {}),
    asOf: input?.asOf ?? getTodayIsoDate(),
  });
}

export async function createBudgetAction(
  input: unknown,
): Promise<BudgetResult<BudgetBoundary>> {
  return productionHandlers().createBudget(input);
}

export async function updateBudgetAction(
  input: unknown,
): Promise<BudgetResult<BudgetBoundary>> {
  return productionHandlers().updateBudget(input);
}

export async function closeBudgetAction(
  input: unknown,
): Promise<BudgetResult<BudgetBoundary>> {
  return productionHandlers().closeBudget(input);
}

export async function registerContributionAction(
  input: unknown,
): Promise<BudgetResult<BudgetMovementBoundary>> {
  return productionMovementHandlers().registerContribution(input);
}

export async function registerWithdrawalAction(
  input: unknown,
): Promise<BudgetResult<BudgetMovementBoundary>> {
  return productionMovementHandlers().registerWithdrawal(input);
}

export async function transferBetweenBudgetsAction(
  input: unknown,
): Promise<BudgetResult<BudgetTransferBoundary>> {
  return productionMovementHandlers().transferBetweenBudgets(input);
}

export async function correctBudgetMovementAction(
  input: unknown,
): Promise<BudgetResult<BudgetCorrectionBoundary>> {
  return productionMovementHandlers().correctMovement(input);
}

export async function distributeRealizedIncomeAction(
  input: unknown,
): Promise<BudgetResult<BudgetDistributionBoundary>> {
  return productionMovementHandlers().distributeRealizedIncome(input);
}

export async function createBudget(
  input: unknown,
): Promise<BudgetResult<BudgetBoundary>> {
  return createBudgetAction(input);
}

export async function listBudgets(
  input?: ListBudgetsQuery,
): Promise<BudgetReadResult<ListBudgetsReadModel>> {
  return listBudgetsAction(input);
}

export async function getBudget(
  budgetReferenceId: unknown,
  input?: ListBudgetMovementsQuery,
): Promise<BudgetReadResult<BudgetDetailReadModel>> {
  return getBudgetAction(budgetReferenceId, input);
}

export async function getBudgetHistory(
  budgetReferenceId: unknown,
  input?: ListBudgetMovementsQuery,
): Promise<BudgetReadResult<BudgetHistoryReadModel>> {
  return getBudgetHistoryAction(budgetReferenceId, input);
}

export async function updateBudget(
  input: unknown,
): Promise<BudgetResult<BudgetBoundary>> {
  return updateBudgetAction(input);
}

export async function closeBudget(
  input: unknown,
): Promise<BudgetResult<BudgetBoundary>> {
  return closeBudgetAction(input);
}

export async function registerContribution(
  input: unknown,
): Promise<BudgetResult<BudgetMovementBoundary>> {
  return registerContributionAction(input);
}

export async function registerWithdrawal(
  input: unknown,
): Promise<BudgetResult<BudgetMovementBoundary>> {
  return registerWithdrawalAction(input);
}

export async function transferBetweenBudgets(
  input: unknown,
): Promise<BudgetResult<BudgetTransferBoundary>> {
  return transferBetweenBudgetsAction(input);
}

export async function correctBudgetMovement(
  input: unknown,
): Promise<BudgetResult<BudgetCorrectionBoundary>> {
  return correctBudgetMovementAction(input);
}

export async function distributeRealizedIncome(
  input: unknown,
): Promise<BudgetResult<BudgetDistributionBoundary>> {
  return distributeRealizedIncomeAction(input);
}

export async function createBoxAction(
  input: unknown,
): Promise<BudgetResult<BudgetBoundary>> {
  return createBudgetAction(input);
}

export async function updateBoxAction(
  input: unknown,
): Promise<BudgetResult<BudgetBoundary>> {
  return updateBudgetAction(input);
}

export async function closeBoxAction(
  input: unknown,
): Promise<BudgetResult<BudgetBoundary>> {
  return closeBudgetAction(input);
}

export async function contributeToBudgetAction(
  input: unknown,
): Promise<BudgetResult<BudgetMovementBoundary>> {
  return registerContributionAction(input);
}

export async function withdrawFromBudgetAction(
  input: unknown,
): Promise<BudgetResult<BudgetMovementBoundary>> {
  return registerWithdrawalAction(input);
}

export async function transferBudgetAction(
  input: unknown,
): Promise<BudgetResult<BudgetTransferBoundary>> {
  return transferBetweenBudgetsAction(input);
}

export async function createBox(
  input: unknown,
): Promise<BudgetResult<BudgetBoundary>> {
  return createBoxAction(input);
}

export async function updateBox(
  input: unknown,
): Promise<BudgetResult<BudgetBoundary>> {
  return updateBoxAction(input);
}

export async function closeBox(
  input: unknown,
): Promise<BudgetResult<BudgetBoundary>> {
  return closeBoxAction(input);
}
