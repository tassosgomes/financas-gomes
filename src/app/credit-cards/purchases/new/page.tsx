import { listCategoriesAction } from "@/app/actions/categories";
import { listCreditCardsAction } from "@/app/actions/credit-cards";
import {
  CreditCardPurchaseScreen,
  type CreditCardPurchaseCardOption,
  type CreditCardPurchaseCategoryOption,
} from "@/components/credit-cards/purchase-screen";
import { ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { toCreditCardErrorViewModel } from "@/components/credit-cards/ui-contracts";
import type { CreditCardReadModel } from "@/modules/credit-cards/contracts";
import type { CategoryReadModel } from "@/modules/accounts-categories/contracts";

export const dynamic = "force-dynamic";

function errorPage(message: string) {
  return (
    <section className="space-y-6" data-testid="credit-card-purchase-route-error">
      <PageHeader
        description="Registre uma compra e visualize o schedule calculado pelo servidor."
        eyebrow="Cartões"
        title="Nova compra"
      />
      <ErrorState
        message={message}
        retryHref="/credit-cards/purchases/new"
        testId="credit-card-purchase-route-error-state"
      />
    </section>
  );
}

function cardOptions(items: readonly CreditCardReadModel[]): CreditCardPurchaseCardOption[] {
  return items.map((card) => ({
    id: card.id,
    name: card.name,
    status: card.status,
  }));
}

function categoryOptions(items: readonly CategoryReadModel[]): CreditCardPurchaseCategoryOption[] {
  return items.map((category) => ({
    id: category.id,
    name: category.name,
    status: category.status,
    kind: category.kind,
  }));
}

/** Server-first purchase entry point; no browser fetch or tenant payload. */
export default async function NewCreditCardPurchasePage() {
  try {
    const [cardsResult, categoriesResult] = await Promise.all([
      listCreditCardsAction({ status: "ACTIVE" }),
      listCategoriesAction({ status: "ACTIVE" }),
    ]);
    if (!cardsResult.ok) return errorPage(toCreditCardErrorViewModel(cardsResult.error).message);
    if (!categoriesResult.ok) return errorPage(toCreditCardErrorViewModel(categoriesResult.error).message);

    return (
      <section className="space-y-6" data-testid="credit-card-purchase-route">
        <PageHeader
          description="Informe o total da compra; valores e competências das parcelas serão calculados pelo servidor."
          eyebrow="Cartões"
          title="Nova compra"
        />
        <CreditCardPurchaseScreen
          cards={cardOptions(cardsResult.value.items)}
          categories={categoryOptions(categoriesResult.value.items)}
        />
      </section>
    );
  } catch {
    return errorPage("Não foi possível carregar os cartões. Tente novamente.");
  }
}
