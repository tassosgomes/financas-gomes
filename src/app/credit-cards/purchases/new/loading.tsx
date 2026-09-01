import { LoadingState } from "@/components/ui/async-state";

export default function NewCreditCardPurchaseLoading() {
  return (
    <section className="space-y-6" data-testid="credit-card-purchase-loading">
      <LoadingState label="Carregando cartões e categorias…" testId="credit-card-purchase-loading-state" />
    </section>
  );
}
