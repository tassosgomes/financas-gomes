import { LoadingState } from "@/components/ui/async-state";

export default function CreditCardPurchaseDetailLoading() {
  return (
    <section
      className="space-y-6"
      data-testid="credit-card-purchase-detail-loading"
    >
      <LoadingState
        label="Carregando detalhe da compra…"
        testId="credit-card-purchase-detail-loading-state"
      />
    </section>
  );
}
