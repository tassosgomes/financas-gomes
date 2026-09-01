import { LoadingState } from "@/components/ui/async-state";

export default function CardPurchaseLoading() {
  return (
    <section className="space-y-6" data-testid="credit-card-card-purchase-loading">
      <LoadingState label="Carregando compra…" testId="credit-card-card-purchase-loading-state" />
    </section>
  );
}
