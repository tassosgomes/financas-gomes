import {
  EmptyState,
  ErrorState,
  LoadingState,
  SuccessFeedback,
} from "@/components/ui/async-state";
import type { ForecastTimeline } from "@/modules/forecast/contracts";
import {
  toForecastErrorViewModel,
  toForecastSummaryViewModel,
  type ForecastReadModelState,
  type ForecastSummaryViewModel,
  type ForecastTimelineViewModel,
} from "@/modules/forecast/ui-contracts";

export interface ForecastSummaryProps {
  /** Timeline and all totals are projections produced by the server. */
  timeline?: ForecastTimeline | ForecastTimelineViewModel | null;
  state?: ForecastReadModelState;
  /** Only the stable forecast error code/field is used by the UI. */
  error?: unknown;
  retryHref?: string;
  successMessage?: string;
  testId?: string;
  className?: string;
}

function timelineFrom(
  value: ForecastTimeline | ForecastTimelineViewModel,
): ForecastTimeline {
  return "timeline" in value ? value.timeline : value;
}

function SummaryMetric({
  metric,
  testId,
}: {
  metric: ForecastSummaryViewModel["metrics"][number];
  testId: string;
}) {
  return (
    <div
      className="rounded-xl border bg-background px-4 py-3"
      data-testid={testId}
    >
      <dt className="text-sm font-medium text-muted-foreground">{metric.label}</dt>
      <dd
        aria-label={`${metric.label}: ${metric.amountLabel}`}
        className="mt-1 text-lg font-semibold tabular-nums"
      >
        {metric.amountLabel}
      </dd>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {metric.description}
      </p>
    </div>
  );
}

/**
 * Server-data-only summary for the future-flow view.  It renders totals and
 * balances verbatim from T06 and never adds, subtracts or filters amounts in
 * the browser.
 */
export function ForecastSummary({
  className,
  error,
  retryHref,
  state,
  successMessage,
  testId = "forecast-summary",
  timeline,
}: ForecastSummaryProps) {
  const resolvedState: ForecastReadModelState =
    state ?? (timeline ? "ready" : "empty");

  if (resolvedState === "loading") {
    return (
      <LoadingState
        label="Carregando fluxo futuro…"
        testId={`${testId}-loading`}
      />
    );
  }

  if (resolvedState === "error") {
    const safeError = toForecastErrorViewModel(error);
    return (
      <ErrorState
        message={safeError.message}
        retryHref={safeError.retryable ? retryHref : undefined}
        testId={`${testId}-error`}
      />
    );
  }

  if (resolvedState === "empty" || !timeline) {
    return (
      <EmptyState
        description="Quando houver compromissos conhecidos, o saldo e os totais aparecerão aqui."
        testId={`${testId}-empty`}
        title="Nenhuma projeção para exibir"
      />
    );
  }

  const timelineValue = timelineFrom(timeline);
  const model = toForecastSummaryViewModel(timelineValue);

  return (
    <section
      aria-describedby={`${testId}-description`}
      aria-labelledby={`${testId}-title`}
      className={`space-y-5 rounded-2xl border bg-card p-5 shadow-sm sm:p-6${className ? ` ${className}` : ""}`}
      data-testid={testId}
    >
      {resolvedState === "success" && successMessage ? (
        <SuccessFeedback message={successMessage} testId={`${testId}-success`} />
      ) : null}

      <header>
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Fluxo futuro · cenário {model.scenarioLabel}
        </p>
        <h2 className="mt-1 text-xl font-semibold" id={`${testId}-title`}>
          Resumo da projeção
        </h2>
        <p
          className="mt-1 text-sm leading-6 text-muted-foreground"
          id={`${testId}-description`}
        >
          {model.fromLabel} a {model.toLabel}. Valores realizados e previstos
          são apresentados separadamente; os cálculos vêm do servidor.
        </p>
      </header>

      <dl
        aria-label="Resumo financeiro do fluxo futuro"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {model.metrics.map((metric) => (
          <SummaryMetric
            key={metric.key}
            metric={metric}
            testId={`${testId}-metric-${metric.key}`}
          />
        ))}
      </dl>

      <p className="text-xs leading-5 text-muted-foreground">
        O menor saldo projetado considera somente compromissos conhecidos no
        cenário selecionado. Pagamentos de cartão são transferências e não
        aparecem como uma nova despesa nesta visão.
      </p>
    </section>
  );
}

export const ForecastProjectionSummary = ForecastSummary;
export const ForecastSummaryCards = ForecastSummary;

