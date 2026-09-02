import { SpendableLoadingState } from "@/components/spendable";

export default function AuthenticatedLoading() {
  return (
    <main
      aria-busy="true"
      className="flex min-h-screen items-center justify-center bg-secondary/40 p-6"
    >
      <div className="w-full max-w-3xl space-y-6 rounded-2xl border bg-card p-8 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="size-11 animate-pulse rounded-xl bg-secondary" />
          <span className="h-4 w-40 animate-pulse rounded bg-secondary" />
        </div>
        <div className="space-y-3">
          <span className="block h-8 w-2/3 animate-pulse rounded bg-secondary" />
          <span className="block h-4 w-full animate-pulse rounded bg-secondary" />
          <span className="block h-4 w-5/6 animate-pulse rounded bg-secondary" />
        </div>
        <SpendableLoadingState testId="spendable-card-loading" />
        <span aria-live="polite" className="sr-only">
          Carregando seu espaço financeiro…
        </span>
      </div>
    </main>
  );
}
