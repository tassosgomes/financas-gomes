import { listAccountsAction } from "@/app/actions/accounts";
import { listCategoriesAction } from "@/app/actions/categories";
import { TransactionCreateEntryPoints } from "@/components/transactions/transaction-create-entry-points";
import { TransactionCreateScreen } from "@/components/transactions/transaction-create-screen";
import { ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import type { ManualTransactionKind } from "@/modules/transactions/contracts";
import { TRANSACTION_NEW_ROUTE } from "@/modules/transactions/routes";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

interface NewTransactionPageProps {
  searchParams?: Promise<SearchParams>;
}

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveKind(value: string | undefined): ManualTransactionKind {
  return value === "INCOME" ? "INCOME" : "EXPENSE";
}

/** Reads tenant-scoped options on the server before rendering the small form island. */
export default async function NewTransactionPage({
  searchParams,
}: NewTransactionPageProps) {
  const params = (await searchParams) ?? {};
  const initialKind = resolveKind(firstSearchParam(params.kind));
  const [accountsResult, categoriesResult] = await Promise.all([
    listAccountsAction({ status: "ACTIVE" }),
    listCategoriesAction({ status: "ACTIVE" }),
  ]);

  if (!accountsResult.ok) {
    return (
      <section className="space-y-6" data-testid="transaction-create-route-error">
        <PageHeader
          description="Registre uma receita ou despesa vinculada a uma conta ativa."
          eyebrow="Movimentações"
          title="Novo lançamento"
        />
        <ErrorState
          message={accountsResult.error.message}
          retryHref={TRANSACTION_NEW_ROUTE}
          testId="transaction-accounts-load-error"
        />
      </section>
    );
  }

  if (!categoriesResult.ok) {
    return (
      <section className="space-y-6" data-testid="transaction-create-route-error">
        <PageHeader
          description="Registre uma receita ou despesa vinculada a uma conta ativa."
          eyebrow="Movimentações"
          title="Novo lançamento"
        />
        <ErrorState
          message={categoriesResult.error.message}
          retryHref={TRANSACTION_NEW_ROUTE}
          testId="transaction-categories-load-error"
        />
      </section>
    );
  }

  const accounts = accountsResult.value.items.map((account) => ({
    id: account.id,
    name: account.name,
    status: account.status,
    trackingStartedOn: account.trackingStartedOn,
  }));
  const categories = categoriesResult.value.items.map((category) => ({
    id: category.id,
    name: category.name,
    kind: category.kind,
    status: category.status,
  }));

  return (
    <section className="space-y-6" data-testid="transaction-create-route">
      <PageHeader
        action={<TransactionCreateEntryPoints activeKind={initialKind} />}
        description="Registre uma receita ou despesa realizada, com valor preciso e conta ativa."
        eyebrow="Movimentações"
        title="Novo lançamento"
      />
      <TransactionCreateScreen
        accounts={accounts}
        categories={categories}
        initialKind={initialKind}
      />
    </section>
  );
}
