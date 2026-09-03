import { SpendableLoadingState } from "@/components/spendable";
import { OVERVIEW_TEST_IDS } from "@/modules/overview/ui-contracts";

function SectionCardSkeleton({ testId }: { testId: string }) {
  return (
    <section
      aria-busy="true"
      className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
      data-testid={testId}
    >
      <div className="space-y-2">
        <span className="block h-5 w-40 max-w-full animate-pulse rounded bg-secondary" />
        <span className="block h-4 w-56 max-w-full animate-pulse rounded bg-secondary" />
      </div>
      <div className="space-y-3">
        <span className="block h-12 w-full animate-pulse rounded-lg bg-secondary" />
        <span className="block h-12 w-full animate-pulse rounded-lg bg-secondary" />
      </div>
    </section>
  );
}

export default function AuthenticatedLoading() {
  return (
    <section
      aria-busy="true"
      className="min-w-0 space-y-6"
      data-testid={OVERVIEW_TEST_IDS.page}
    >
      <header className="min-w-0 space-y-2">
        <span className="block h-4 w-28 animate-pulse rounded bg-secondary" />
        <span className="block h-9 w-72 max-w-full animate-pulse rounded bg-secondary" />
        <span className="block h-4 w-full max-w-2xl animate-pulse rounded bg-secondary" />
      </header>

      <div data-testid={OVERVIEW_TEST_IDS.spendable}>
        <SpendableLoadingState testId="spendable-card-loading" />
      </div>

      <SectionCardSkeleton testId={`${OVERVIEW_TEST_IDS.periodSummary}-loading`} />
      <SectionCardSkeleton testId={`${OVERVIEW_TEST_IDS.categories}-loading`} />
      <SectionCardSkeleton testId={`${OVERVIEW_TEST_IDS.commitments}-loading`} />

      <span aria-live="polite" className="sr-only">
        Carregando visão geral…
      </span>
    </section>
  );
}
