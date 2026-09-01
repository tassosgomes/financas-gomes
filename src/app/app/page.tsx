import { Inbox } from "lucide-react";

import { InviteShareCard } from "@/components/households/invite-share-card";
import { TransactionCreateEntryPoints } from "@/components/transactions/transaction-create-entry-points";

/** No financial entities are created here yet; sharing is the S01 action. */
export default function AuthenticatedHomePage() {
  return (
    <section aria-labelledby="empty-home-title" className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Visão geral
        </p>
        <h1 className="text-3xl font-semibold tracking-tight" id="empty-home-title">
          Seu espaço financeiro
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Esta é a base compartilhada da sua organização financeira. Os dados
          aparecerão aqui conforme as próximas etapas forem construídas.
        </p>
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
          Ainda não há informações financeiras para mostrar. Esta tela fica
          vazia de propósito enquanto o produto prepara os próximos recursos.
        </p>
      </div>

      <InviteShareCard />
    </section>
  );
}
