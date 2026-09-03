"use server";

import { revalidatePath } from "next/cache";

import {
  getTransactionActionHandlers,
  getTransactionMaintenanceActionHandlers,
} from "@/modules/transactions/adapters";
import {
  TRANSACTION_DETAIL_ROUTE,
  TRANSACTIONS_ROUTE,
} from "@/modules/transactions/routes";
import type {
  ManualTransactionReadModel,
  TransactionResult,
} from "@/modules/transactions/contracts";
import {
  getReviewableTransactionDetailAction as getReviewableTransactionDetail,
  getTransactionReviewDetailAction as getTransactionReviewDetail,
  getTransactionReviewSummaryAction as getTransactionReviewSummary,
  listReviewableTransactionsAction as listReviewableTransactions,
  listTransactionReviewAction as listTransactionReview,
  listTransactionReviewsAction as listTransactionReviews,
  updateReviewableTransaction as updateReviewable,
  updateReviewableTransactionAction as updateReviewableAction,
  updateTransactionReview as updateReview,
  updateTransactionReviewAction as updateReviewAction,
} from "./transaction-review";

function productionHandlers() {
  return getTransactionActionHandlers(() => {
    // T11 owns the collection page; invalidate it after the T05 commit.
    revalidatePath(TRANSACTIONS_ROUTE);
  });
}

function productionMaintenanceHandlers() {
  return getTransactionMaintenanceActionHandlers((transaction) => {
    // T11 owns the collection page; invalidate all T12 read projections after
    // the T07 commit. The detail includes the account balance projection.
    revalidatePath(TRANSACTIONS_ROUTE);
    if (transaction) {
      revalidatePath(TRANSACTION_DETAIL_ROUTE(transaction.id));
    }
  });
}

/** Receives only the serializable CreateExpense command. */
export async function createExpenseAction(
  input: unknown,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return productionHandlers().createExpense(input);
}

/** Receives only the serializable CreateIncome command. */
export async function createIncomeAction(
  input: unknown,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return productionHandlers().createIncome(input);
}

/** Short aliases preserve the naming used by the use-case port. */
export async function createExpense(
  input: unknown,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return createExpenseAction(input);
}

export async function createIncome(
  input: unknown,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return createIncomeAction(input);
}

export async function createExpenseServerAction(
  input: unknown,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return createExpenseAction(input);
}

export async function createIncomeServerAction(
  input: unknown,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return createIncomeAction(input);
}

/** Receives only the serializable T07 metadata-update command. */
export async function updateManualTransactionAction(
  input: unknown,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return productionMaintenanceHandlers().updateManualTransaction(input);
}

/** Receives only the serializable T07 cancellation command. */
export async function cancelManualTransactionAction(
  input: unknown,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return productionMaintenanceHandlers().cancelManualTransaction(input);
}

export async function updateManualTransaction(
  input: unknown,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return updateManualTransactionAction(input);
}

export async function cancelManualTransaction(
  input: unknown,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return cancelManualTransactionAction(input);
}

export async function updateManualTransactionServerAction(
  input: unknown,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return updateManualTransactionAction(input);
}

export async function cancelManualTransactionServerAction(
  input: unknown,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return cancelManualTransactionAction(input);
}

/**
 * S05 review actions share this server-only transaction boundary.
 *
 * Next requires every export in a `use server` module to be an async
 * function. Keep the compatibility aliases as explicit wrappers instead of
 * re-exporting the bindings from `transaction-review`; this preserves the
 * T06 action contract while making the boundary valid for the production
 * compiler.
 */
export async function getReviewableTransactionDetailAction(input: unknown) {
  return getReviewableTransactionDetail(input);
}

export async function getTransactionReviewDetailAction(input: unknown) {
  return getTransactionReviewDetail(input);
}

export async function getTransactionReviewSummaryAction(input?: unknown) {
  return getTransactionReviewSummary(input);
}

export async function listReviewableTransactionsAction(input?: unknown) {
  return listReviewableTransactions(input);
}

export async function listTransactionReviewAction(input?: unknown) {
  return listTransactionReview(input);
}

export async function listTransactionReviewsAction(input?: unknown) {
  return listTransactionReviews(input);
}

export async function updateReviewableTransaction(input: unknown) {
  return updateReviewable(input);
}

export async function updateReviewableTransactionAction(input: unknown) {
  return updateReviewableAction(input);
}

export async function updateTransactionReview(input: unknown) {
  return updateReview(input);
}

export async function updateTransactionReviewAction(input: unknown) {
  return updateReviewAction(input);
}
