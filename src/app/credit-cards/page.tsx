import { listCreditCardsAction } from "@/app/actions/credit-cards";
import { CreditCardCollectionScreen } from "@/components/credit-cards/card-management-screen";
import { ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { toCreditCardErrorViewModel, CREDIT_CARD_ROUTES } from "@/components/credit-cards/ui-contracts";

export const dynamic = "force-dynamic";

/** Initial collection read stays on the authenticated/server action boundary. */
export default async function CreditCardsPage() {
  try {
    const result = await listCreditCardsAction({ status: "ACTIVE" });
    if (!result.ok) {
      return (
        <section className="space-y-6" data-testid="credit-card-route-error">
          <PageHeader
            description="Consulte a configuração contratual dos cartões do espaço financeiro."
            eyebrow="Cartões"
            title="Cartões de crédito"
          />
          <ErrorState
            message={toCreditCardErrorViewModel(result.error).message}
            retryHref={CREDIT_CARD_ROUTES.collection}
            testId="credit-card-route-error-state"
          />
        </section>
      );
    }
    return <CreditCardCollectionScreen initialCards={result.value.items} />;
  } catch {
    return (
      <section className="space-y-6" data-testid="credit-card-route-error">
        <PageHeader
          description="Consulte a configuração contratual dos cartões do espaço financeiro."
          eyebrow="Cartões"
          title="Cartões de crédito"
        />
        <ErrorState
          message="Não foi possível carregar os cartões. Tente novamente."
          retryHref={CREDIT_CARD_ROUTES.collection}
          testId="credit-card-route-error-state"
        />
      </section>
    );
  }
}
