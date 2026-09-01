import { LoadingState } from "@/components/ui/async-state";

export default function CreditCardDetailLoading() {
  return (
    <section className="space-y-6" data-testid="credit-card-detail-loading">
      <LoadingState label="Carregando cartão…" testId="credit-card-detail-loading-state" />
    </section>
  );
}
