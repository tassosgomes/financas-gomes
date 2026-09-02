import { Inbox } from "lucide-react";

import { getSpendableAction } from "@/app/actions/spendable";
import { InviteShareCard } from "@/components/households/invite-share-card";
import { SpendableCard } from "@/components/spendable";
import { TransactionCreateEntryPoints } from "@/components/transactions/transaction-create-entry-points";
import { AUTHENTICATED_ROUTE } from "@/modules/auth/routes";
import type { SpendableBreakdown } from "@/modules/spendable/contracts";
import type { SpendableResult } from "@/modules/spendable/service";

const SPENDABLE_BREAKDOWN_ROUTE = "/spendable/breakdown" as const;

type HomeSpendableResult = SpendableResult<SpendableBreakdown>;

async function readHomeSpendable(): Promise<HomeSpendableResult> {
  try {
    return await getSpendableAction();
  } catch {
    // The action already returns an opaque envelope. Keep the route fail-safe
    // if a transport/runtime failure occurs before that boundary is reached.
    return {
      ok: false,
      error: { code: "SPENDABLE_QUERY_FAILED", field: null },
    };
  }
}

function homeSpendableState(
  result: HomeSpendableResult,
): "empty" | "error" | "ready" {
  if (result.ok) return "ready";
  // A missing scoped resource is presented as an explicit empty state. It
  // must not be turned into a monetary zero, which could hide an error.
  return result.error.code === "SPENDABLE_NOT_FOUND" ? "empty" : "error";
}

/** The authenticated overview reads derived spendable data server-side. */
export default async function AuthenticatedHomePage() {
  const spendable = await readHomeSpendable();
  const spendableState = homeSpendableState(spendable);

  return (
    <section aria-labelledby="home-title" className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Visão geral
        </p>
        <h1 className="text-3xl font-semibold tracking-tight" id="home-title">
          Seu espaço financeiro
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Acompanhe quanto pode gastar com segurança e registre as
          movimentações do seu espaço financeiro.
        </p>
      </div>

      <div data-testid="home-spendable">
        <SpendableCard
          breakdown={spendable.ok ? spendable.value : undefined}
          detailsHref={SPENDABLE_BREAKDOWN_ROUTE}
          error={spendable.ok ? undefined : spendable.error}
          retryHref={AUTHENTICATED_ROUTE}
          state={spendableState}
        />
      </div>

      <section
        aria-labelledby="quick-transaction-actions-title"
        className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
        data-testid="quick-transaction-actions"
      >
        <div className="space-y-1">
          <h2 className="text-lg font-semibold" id="quick-transaction-actions-title">
            Registrar movimentação
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Adicione uma receita ou despesa realizada para acompanhar seu espaço financeiro.
          </p>
        </div>
        <TransactionCreateEntryPoints />
      </section>

      <div
        aria-label="Estado vazio"
        className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed bg-card px-6 py-12 text-center shadow-sm"
      >
        <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
          <Inbox aria-hidden="true" className="size-7" />
        </span>
        <h2 className="mt-5 text-lg font-semibold">Tudo pronto para começar</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Outros recursos financeiros aparecerão aqui conforme as próximas
          etapas forem construídas.
        </p>
      </div>

      <InviteShareCard />
    </section>
  );
}
