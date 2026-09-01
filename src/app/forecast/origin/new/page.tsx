import Link from "next/link";

import { ForecastCreateCommitmentForm } from "@/components/forecast";
import { PageHeader } from "@/components/ui/page-header";
import { FORECAST_ORIGIN_ROUTE, FORECAST_ROUTE } from "@/modules/forecast/routes";

export const dynamic = "force-dynamic";

export default function NewForecastCommitmentPage() {
  return (
    <section className="space-y-6" data-testid="forecast-origin-new-route">
      <PageHeader
        action={
          <Link
            className="inline-flex min-h-10 items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={FORECAST_ROUTE}
          >
            Voltar à projeção
          </Link>
        }
        description="Adicione uma fonte explícita para que a projeção seja recalculada pelo servidor."
        eyebrow="Planejamento financeiro"
        title="Novo compromisso"
      />
      <ForecastCreateCommitmentForm />
      <p className="text-sm text-muted-foreground">
        Para uma parcela de cartão, consulte a compra em <Link className="underline" href={FORECAST_ORIGIN_ROUTE}>sua origem</Link>; pagamentos continuam sendo operações globais do cartão.
      </p>
    </section>
  );
}
