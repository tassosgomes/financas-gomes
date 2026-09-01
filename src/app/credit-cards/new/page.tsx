import { listAccountsAction } from "@/app/actions/accounts";
import { CreditCardCreateForm, type CreditCardAccountOption } from "@/components/credit-cards/card-management-screen";
import { ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { CREDIT_CARD_ROUTES, toCreditCardErrorViewModel } from "@/components/credit-cards/ui-contracts";

export const dynamic = "force-dynamic";

/** Loads payment-account options on the server; the form receives no tenant data. */
export default async function NewCreditCardPage() {
  try {
    const accountsResult = await listAccountsAction({ status: "ALL" });
    if (!accountsResult.ok) {
      return (
        <section className="space-y-6" data-testid="credit-card-create-route-error">
          <PageHeader
            description="Cadastre um cartão com limite contratual e regra inicial de cobrança."
            eyebrow="Cartões"
            title="Novo cartão"
          />
          <ErrorState
            message={toCreditCardErrorViewModel(accountsResult.error).message}
            retryHref={CREDIT_CARD_ROUTES.create}
            testId="credit-card-create-accounts-error"
          />
        </section>
      );
    }
    const accounts: CreditCardAccountOption[] = accountsResult.value.items.map((account) => ({
      id: account.id,
      name: account.name,
      status: account.status,
      type: account.type,
    }));
    return (
      <section className="space-y-6" data-testid="credit-card-create-route">
        <PageHeader
          description="Cadastre um cartão com limite contratual e regra inicial de cobrança."
          eyebrow="Cartões"
          title="Novo cartão"
        />
        <CreditCardCreateForm accounts={accounts} />
      </section>
    );
  } catch {
    return (
      <section className="space-y-6" data-testid="credit-card-create-route-error">
        <PageHeader
          description="Cadastre um cartão com limite contratual e regra inicial de cobrança."
          eyebrow="Cartões"
          title="Novo cartão"
        />
        <ErrorState
          message="Não foi possível carregar as contas de pagamento. Tente novamente."
          retryHref={CREDIT_CARD_ROUTES.create}
          testId="credit-card-create-accounts-error"
        />
      </section>
    );
  }
}
