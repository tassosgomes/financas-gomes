import { listAccountsAction } from "@/app/actions/accounts";
import { listCategoriesAction } from "@/app/actions/categories";
import { updateReviewableTransactionAction } from "@/app/actions/transaction-review";
import {
  TransactionsListScreen,
  TransactionReviewReadError,
} from "@/components/transactions";
import {
  parseReviewQueryWithDiagnostics,
  type ReviewQueryInput,
} from "@/components/transactions/transaction-review-query";
import type { CategoryQuickEditAction } from "@/components/transactions/category-quick-edit";
import { withFinancialContext } from "@/modules/households/tenant-scoped";
import { transactionReviewReadUseCases } from "@/modules/transactions/review-reads";

export const dynamic = "force-dynamic";

type TransactionsSearchParams = ReviewQueryInput;

async function readSafely<T>(
  operation: () => Promise<
    | { ok: true; value: T }
    | { ok: false; error: { message: string } }
  >,
  fallbackMessage: string,
): Promise<{ value: T } | { error: string }> {
  try {
    const result = await operation();
    if (!result.ok) return { error: result.error.message };
    return { value: result.value };
  } catch {
    return { error: fallbackMessage };
  }
}

/**
 * The review page resolves list and summary in parallel with its reference
 * options. Financial context is still server-derived by the read boundary;
 * no household ID or origin is accepted from the browser.
 */
export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<TransactionsSearchParams>;
}) {
  const rawSearchParams = await searchParams;
  const parsed = parseReviewQueryWithDiagnostics(rawSearchParams);
  const [transactions, summary, accounts, categories] = await Promise.all([
    readSafely(
      () =>
        withFinancialContext((context) =>
          transactionReviewReadUseCases.list(context, parsed.query),
        ),
      "Não foi possível carregar os lançamentos. Tente novamente.",
    ),
    readSafely(
      () =>
        withFinancialContext((context) =>
          transactionReviewReadUseCases.summary(context, parsed.query),
        ),
      "Não foi possível carregar o resumo de revisão. Tente novamente.",
    ),
    readSafely(
      () => listAccountsAction({ status: "ALL" }),
      "Não foi possível carregar as contas. Tente novamente.",
    ),
    readSafely(
      () => listCategoriesAction({ status: "ALL" }),
      "Não foi possível carregar as categorias. Tente novamente.",
    ),
  ]);

  if ("error" in transactions) {
    return <TransactionReviewReadError message={transactions.error} />;
  }
  if ("error" in summary) {
    return <TransactionReviewReadError message={summary.error} />;
  }
  if ("error" in accounts) {
    return <TransactionReviewReadError message={accounts.error} />;
  }
  if ("error" in categories) {
    return <TransactionReviewReadError message={categories.error} />;
  }

  // The exported action is a Server Action and therefore can cross the
  // client boundary. The quick editor consumes only its serializable subset.
  const updateAction = updateReviewableTransactionAction as CategoryQuickEditAction;

  return (
    <TransactionsListScreen
      accounts={accounts.value.items}
      categories={categories.value.items}
      hadInvalidFilters={parsed.hadInvalidFilters}
      initialTransactions={transactions.value.items}
      pageInfo={transactions.value.pageInfo}
      query={parsed.query}
      reviewMode
      summary={summary.value}
      updateAction={updateAction}
    />
  );
}
