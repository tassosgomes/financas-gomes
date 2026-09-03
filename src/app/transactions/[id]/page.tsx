import { listAccountsAction } from "@/app/actions/accounts";
import { listCategoriesAction } from "@/app/actions/categories";
import {
  cancelManualTransactionAction,
  updateReviewableTransactionAction,
} from "@/app/actions/transactions";
import { ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { TransactionDetailScreen } from "@/components/transactions/transaction-detail-screen";
import {
  parseReviewQueryWithDiagnostics,
  reviewQueryHref,
  type ReviewQueryInput,
} from "@/components/transactions/transaction-review-query";
import type {
  AccountReadModel,
  CategoryReadModel,
} from "@/modules/accounts-categories/contracts";
import { FinancialContextError } from "@/modules/households/contracts";
import { transactionReadAccess } from "@/modules/transactions/reads";
import { withFinancialContext } from "@/modules/households/tenant-scoped";
import { transactionReviewReadUseCases } from "@/modules/transactions/review-reads";
import type { TransactionReviewResult, TransactionDetailReadModel } from "@/modules/transactions/review-contracts";

export const dynamic = "force-dynamic";

interface TransactionDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<ReviewQueryInput>;
}

const DEFAULT_READ_ERROR =
  "Não foi possível carregar o lançamento. Tente novamente.";

function routeError(
  message: string,
  retryHref: string,
  testId: string,
  title = "Não foi possível carregar o lançamento",
) {
  return (
    <section className="space-y-6" data-testid={testId}>
      <PageHeader
        description="Consulte os dados do lançamento e seu efeito na conta."
        eyebrow="Movimentações"
        title="Detalhe do lançamento"
      />
      <ErrorState
        message={message}
        retryHref={retryHref}
        testId={`${testId}-state`}
        title={title}
      />
    </section>
  );
}

function isNotFound(result: TransactionReviewResult<unknown>): boolean {
  return !result.ok && result.error.code === "EVENT_NOT_FOUND";
}

function optionAccounts(accounts: AccountReadModel[]) {
  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    status: account.status,
    trackingStartedOn: account.trackingStartedOn,
  }));
}

function optionCategories(categories: CategoryReadModel[]) {
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    kind: category.kind,
    status: category.status,
  }));
}

/**
 * Generic review detail route for both manual and imported events. The event
 * and its source are read through the S05 tenant-scoped boundary; the URL only
 * carries canonical list filters used by the back link.
 */
export default async function TransactionDetailPage({
  params,
  searchParams,
}: TransactionDetailPageProps) {
  const { id } = await params;
  const parsed = parseReviewQueryWithDiagnostics((await searchParams) ?? {});
  const backHref = reviewQueryHref("/transactions", parsed.query);

  let detailResult: TransactionReviewResult<TransactionDetailReadModel>;
  try {
    detailResult = await withFinancialContext((context) =>
      transactionReviewReadUseCases.detail(context, id),
    );
  } catch (error) {
    return routeError(
      error instanceof FinancialContextError
        ? error.message
        : DEFAULT_READ_ERROR,
      backHref,
      "transaction-detail-route-error",
    );
  }

  if (!detailResult.ok) {
    if (isNotFound(detailResult)) {
      return routeError(
        "Esse lançamento não foi encontrado no seu espaço financeiro.",
        backHref,
        "transaction-detail-not-found",
        "Lançamento não encontrado",
      );
    }
    return routeError(
      detailResult.error.message,
      backHref,
      "transaction-detail-route-error",
    );
  }

  const transaction = detailResult.value;
  let accountsResult: Awaited<ReturnType<typeof listAccountsAction>>;
  let categoriesResult: Awaited<ReturnType<typeof listCategoriesAction>>;
  let balanceResult: Awaited<ReturnType<typeof transactionReadAccess.balance>>;

  try {
    [accountsResult, categoriesResult, balanceResult] = await Promise.all([
      listAccountsAction({ status: "ALL" }),
      listCategoriesAction({ status: "ALL" }),
      transactionReadAccess.balance(transaction.accountId, transaction.occurredOn),
    ]);
  } catch (error) {
    return routeError(
      error instanceof FinancialContextError
        ? error.message
        : DEFAULT_READ_ERROR,
      backHref,
      "transaction-detail-route-error",
    );
  }

  if (!accountsResult.ok) {
    return routeError(
      accountsResult.error.message,
      backHref,
      "transaction-detail-route-error",
    );
  }
  if (!categoriesResult.ok) {
    return routeError(
      categoriesResult.error.message,
      backHref,
      "transaction-detail-route-error",
    );
  }
  if (!balanceResult.ok) {
    return routeError(
      balanceResult.error.message,
      backHref,
      "transaction-detail-route-error",
    );
  }

  return (
    <TransactionDetailScreen
      accounts={optionAccounts(accountsResult.value.items)}
      backHref={backHref}
      categories={optionCategories(categoriesResult.value.items)}
      initialBalance={balanceResult.value}
      initialTransaction={transaction}
      updateAction={updateReviewableTransactionAction}
      cancelAction={cancelManualTransactionAction}
    />
  );
}
