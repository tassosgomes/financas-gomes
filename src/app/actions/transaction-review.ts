"use server";

import { revalidatePath } from "next/cache";

import {
  getTransactionReviewActionHandlers,
} from "@/modules/transactions/review-adapters";
import {
  TRANSACTION_DETAIL_ROUTE,
  TRANSACTIONS_ROUTE,
} from "@/modules/transactions/routes";
import type {
  S05Result,
  TransactionDetailReadModel,
  TransactionListReadModel,
  TransactionReviewSummaryReadModel,
} from "@/modules/transactions/review-contracts";
import type { ReviewableTransactionUpdateReadModel } from "@/modules/transactions/review-use-cases";

function productionHandlers() {
  return getTransactionReviewActionHandlers({
    // The list page contains both the queue and its summary. Revalidating the
    // collection after commit refreshes both projections; the detail path is
    // invalidated separately so a caller can use the returned read model.
    revalidateReview: (value) => {
      revalidatePath(TRANSACTIONS_ROUTE);
      revalidatePath(TRANSACTION_DETAIL_ROUTE(value.id));
    },
  });
}

/** Lists the authenticated household's reviewable transactions. */
export async function listReviewableTransactionsAction(
  input?: unknown,
): Promise<S05Result<TransactionListReadModel>> {
  return productionHandlers().list(input);
}

/** Reads one reviewable transaction by an untrusted financial-event ID. */
export async function getReviewableTransactionDetailAction(
  financialEventId: unknown,
): Promise<S05Result<TransactionDetailReadModel>> {
  return productionHandlers().detail(financialEventId);
}

/** Counts pending review items using the server-side summary query. */
export async function getTransactionReviewSummaryAction(
  input?: unknown,
): Promise<S05Result<TransactionReviewSummaryReadModel>> {
  return productionHandlers().summary(input);
}

/** Updates only description/category through the T05 review port. */
export async function updateReviewableTransactionAction(
  input: unknown,
): Promise<S05Result<ReviewableTransactionUpdateReadModel>> {
  return productionHandlers().update(input);
}

/** Naming aliases retained for T08/T09 composition and existing callers. */
export const listTransactionReviewAction = listReviewableTransactionsAction;
export const listTransactionReviewsAction = listReviewableTransactionsAction;
export const getTransactionReviewDetailAction =
  getReviewableTransactionDetailAction;
export const getTransactionDetailReviewAction =
  getReviewableTransactionDetailAction;
export const getReviewSummaryAction = getTransactionReviewSummaryAction;
export const updateTransactionReviewAction = updateReviewableTransactionAction;
export const updateTransactionReview = updateReviewableTransactionAction;
export const updateReviewableTransaction = updateReviewableTransactionAction;

