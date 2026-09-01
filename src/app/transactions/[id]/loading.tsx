import { LoadingState } from "@/components/ui/async-state";

/** Keeps navigation to a detail route legible while its tenant-scoped reads run. */
export default function TransactionDetailLoading() {
  return (
    <section className="space-y-6" data-testid="transaction-detail-loading">
      <LoadingState label="Carregando lançamento…" testId="transaction-detail-loading-state" />
    </section>
  );
}

