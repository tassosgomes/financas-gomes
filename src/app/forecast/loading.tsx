import { ForecastLoadingState } from "@/components/forecast";
import { PageHeader } from "@/components/ui/page-header";

export default function ForecastLoading() {
  return (
    <section className="space-y-6" data-testid="forecast-route-loading">
      <PageHeader
        description="Veja o saldo e os compromissos conhecidos do fluxo futuro."
        eyebrow="Planejamento financeiro"
        title="Fluxo futuro"
      />
      <ForecastLoadingState testId="forecast-load-state" />
    </section>
  );
}

