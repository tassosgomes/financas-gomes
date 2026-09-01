import { LoadingState } from "@/components/ui/async-state";

export default function CreditCardsLoading() {
  return (
    <section className="space-y-6" data-testid="credit-card-route-loading">
      <LoadingState label="Carregando cartões…" testId="credit-card-route-loading-state" />
    </section>
  );
}
