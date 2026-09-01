import { AccountsScreen } from "@/components/accounts/accounts-screen";
import { ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { listAccountsAction } from "@/app/actions/accounts";
import { ACCOUNTS_ROUTE } from "@/modules/accounts-categories/routes";

export const dynamic = "force-dynamic";

/** Server-render the initial active collection; mutations stay in the client screen. */
export default async function AccountsPage() {
  const result = await listAccountsAction({ status: "ACTIVE" });

  if (!result.ok) {
    return (
      <section className="space-y-6" data-testid="accounts-route-error">
        <PageHeader
          description="Cadastre as contas que serão usadas nos próximos fluxos financeiros."
          eyebrow="Estrutura financeira"
          title="Contas"
        />
        <ErrorState
          message={result.error.message}
          retryHref={ACCOUNTS_ROUTE}
          testId="accounts-load-error"
        />
      </section>
    );
  }

  return <AccountsScreen initialAccounts={result.value.items} />;
}
