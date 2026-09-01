import { notFound } from "next/navigation";

import { listCategoriesAction } from "@/app/actions/categories";
import { listCreditCardsAction } from "@/app/actions/credit-cards";
import {
  CreditCardPurchaseScreen,
  type CreditCardPurchaseCardOption,
  type CreditCardPurchaseCategoryOption,
} from "@/components/credit-cards/purchase-screen";
import { ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { isUuidV7 } from "@/lib/uuidv7";
import { toCreditCardErrorViewModel } from "@/components/credit-cards/ui-contracts";

export const dynamic = "force-dynamic";

interface CardPurchasePageProps {
  params: Promise<{ id: string }>;
}

function errorPage(message: string) {
  return (
    <section className="space-y-6" data-testid="credit-card-card-purchase-route-error">
      <PageHeader
        description="Registre uma compra associada a um cartão ativo."
        eyebrow="Cartões"
        title="Nova compra"
      />
      <ErrorState
        message={message}
        retryHref="/credit-cards/purchases/new"
        testId="credit-card-card-purchase-route-error-state"
      />
    </section>
  );
}

/** Card-scoped entry point keeps the opaque card ID in the URL only. */
export default async function CardPurchasePage({ params }: CardPurchasePageProps) {
  const { id } = await params;
  if (!isUuidV7(id)) notFound();

  try {
    const [cardsResult, categoriesResult] = await Promise.all([
      listCreditCardsAction({ status: "ACTIVE" }),
      listCategoriesAction({ status: "ACTIVE" }),
    ]);
    if (!cardsResult.ok) return errorPage(toCreditCardErrorViewModel(cardsResult.error).message);
    if (!cardsResult.value.items.some((card) => card.id === id)) notFound();
    if (!categoriesResult.ok) return errorPage(toCreditCardErrorViewModel(categoriesResult.error).message);

    const cards: CreditCardPurchaseCardOption[] = cardsResult.value.items.map((card) => ({
      id: card.id,
      name: card.name,
      status: card.status,
    }));
    const categories: CreditCardPurchaseCategoryOption[] = categoriesResult.value.items.map((category) => ({
      id: category.id,
      name: category.name,
      status: category.status,
      kind: category.kind,
    }));

    return (
      <section className="space-y-6" data-testid="credit-card-card-purchase-route">
        <PageHeader
          description="Informe o total da compra; valores e competências das parcelas serão calculados pelo servidor."
          eyebrow="Cartões"
          title="Nova compra"
        />
        <CreditCardPurchaseScreen
          cards={cards}
          categories={categories}
          initialCardId={id}
        />
      </section>
    );
  } catch {
    return errorPage("Não foi possível carregar os dados da compra. Tente novamente.");
  }
}
