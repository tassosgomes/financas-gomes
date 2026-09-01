import { notFound } from "next/navigation";

import { listCategoriesAction } from "@/app/actions/categories";
import { getCreditCardAction } from "@/app/actions/credit-cards";
import { getCreditCardPurchaseAction } from "@/app/actions/credit-card-purchases";
import {
  CreditCardPurchaseDetailScreen,
  type CreditCardPurchaseCategoryOption,
} from "@/components/credit-cards";
import type { CreditCardReadModelState } from "@/components/credit-cards/read-models";
import { ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { isUuidV7 } from "@/lib/uuidv7";
import { purchaseScheduleViewModel } from "@/components/credit-cards/purchase-schedule-view-model";
import type { CreditCardPurchaseReadModel } from "@/modules/credit-cards/contracts";
import {
  creditCardHref,
  parseCreditCardPurchaseDetail,
  toCreditCardErrorViewModel,
} from "@/components/credit-cards/ui-contracts";

export const dynamic = "force-dynamic";

interface CreditCardPurchaseDetailPageProps {
  params: Promise<{ id: string; purchaseId: string }>;
}

function routeError(message: string) {
  return (
    <section
      className="space-y-6"
      data-testid="credit-card-purchase-detail-route-error"
    >
      <PageHeader
        description="Consulte a compra, seu schedule e as ações permitidas pelo cartão."
        eyebrow="Cartões"
        title="Detalhe da compra"
      />
      <ErrorState
        message={message}
        retryHref="/credit-cards"
        testId="credit-card-purchase-detail-route-error-state"
      />
    </section>
  );
}

function toPurchaseDetailViewModel(
  value: CreditCardPurchaseReadModel,
) {
  const schedule = purchaseScheduleViewModel(value);
  return parseCreditCardPurchaseDetail({
    id: value.id,
    cardId: value.cardId,
    amountCents: value.amountCents,
    occurredOn: value.occurredOn,
    description: value.description,
    categoryId: value.categoryId,
    installmentCount: value.installmentCount,
    status: value.status ?? value.schedule.status,
    schedule,
  });
}

/**
 * Card-scoped purchase detail. Both IDs are validated before actions run;
 * the purchase reader applies the authenticated household predicate and the
 * card match below prevents a valid purchase from another card being shown.
 */
export default async function CreditCardPurchaseDetailPage({
  params,
}: CreditCardPurchaseDetailPageProps) {
  const { id, purchaseId } = await params;
  if (!isUuidV7(id) || !isUuidV7(purchaseId)) notFound();

  let cardResult: Awaited<ReturnType<typeof getCreditCardAction>>;
  let purchaseResult: Awaited<ReturnType<typeof getCreditCardPurchaseAction>>;
  try {
    [cardResult, purchaseResult] = await Promise.all([
      getCreditCardAction({ cardId: id }),
      getCreditCardPurchaseAction({ purchaseId }),
    ]);
  } catch {
    return routeError("Não foi possível carregar a compra. Tente novamente.");
  }

  if (!cardResult.ok) {
    if (
      cardResult.error.code === "CARD_NOT_FOUND" ||
      cardResult.error.code === "CREDIT_CARD_NOT_FOUND"
    ) {
      notFound();
    }
    return routeError(toCreditCardErrorViewModel(cardResult.error).message);
  }

  if (!purchaseResult.ok) {
    if (
      purchaseResult.error.code === "PURCHASE_NOT_FOUND" ||
      purchaseResult.error.code === "INVALID_PURCHASE_ID"
    ) {
      notFound();
    }
    return routeError(toCreditCardErrorViewModel(purchaseResult.error).message);
  }

  if (purchaseResult.value.cardId !== id) {
    notFound();
  }

  let categoriesResult: Awaited<ReturnType<typeof listCategoriesAction>> | null =
    null;
  let categoriesError: unknown = null;
  try {
    categoriesResult = await listCategoriesAction({ status: "ALL" });
  } catch {
    categoriesError = { code: "RETRYABLE_ERROR" };
  }
  if (categoriesResult && !categoriesResult.ok) {
    categoriesError = categoriesResult.error;
  }

  const categories: CreditCardPurchaseCategoryOption[] =
    categoriesResult?.ok
      ? categoriesResult.value.items.map((category) => ({
          id: category.id,
          name: category.name,
          status: category.status,
          kind: category.kind,
        }))
      : [];
  const categoriesState: CreditCardReadModelState = categoriesResult?.ok
    ? categories.length > 0
      ? "ready"
      : "empty"
    : "error";
  const purchase = toPurchaseDetailViewModel(purchaseResult.value);

  return (
    <section
      className="space-y-6"
      data-testid="credit-card-purchase-detail-route"
    >
      <PageHeader
        description="Valor, data e schedule são projeções imutáveis; somente metadata permitida pode ser editada."
        eyebrow="Cartões"
        title="Detalhe da compra"
      />
      <CreditCardPurchaseDetailScreen
        backHref={creditCardHref(id)}
        cardName={cardResult.value.name}
        categories={categories}
        categoriesError={categoriesError}
        categoriesState={categoriesState}
        purchase={purchase}
        retryHref={creditCardHref(id)}
      />
    </section>
  );
}
