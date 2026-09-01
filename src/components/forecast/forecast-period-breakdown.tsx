import type { ForecastTimeline } from "@/modules/forecast/contracts";
import {
  formatForecastMoney,
  formatForecastPeriod,
  type ForecastTimelineViewModel,
} from "@/modules/forecast/ui-contracts";

export interface ForecastPeriodBreakdownProps {
  /** Period buckets are calculated by T06 and are only formatted here. */
  timeline: ForecastTimeline | ForecastTimelineViewModel;
  testId?: string;
  className?: string;
}

function unwrapTimeline(
  value: ForecastTimeline | ForecastTimelineViewModel,
): ForecastTimeline {
  return "timeline" in value ? value.timeline : value;
}

/**
 * Presents the server-provided civil-month buckets without regrouping or
 * recalculating their totals in the browser.
 */
export function ForecastPeriodBreakdown({
  className,
  testId = "forecast-period-breakdown",
  timeline,
}: ForecastPeriodBreakdownProps) {
  const value = unwrapTimeline(timeline);

  return (
    <section
      aria-labelledby={`${testId}-title`}
      className={`space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6${className ? ` ${className}` : ""}`}
      data-testid={testId}
    >
      <header>
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Totais por período
        </p>
        <h2 className="mt-1 text-xl font-semibold" id={`${testId}-title`}>
          Entradas e saídas por mês
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Os buckets seguem o calendário civil. Realizado tem efeito publicado;
          previsto ainda não foi publicado.
        </p>
      </header>

      {value.periods.length > 0 ? (
        <ol
          aria-label="Totais mensais do fluxo futuro"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {value.periods.map((period) => (
            <li
              className="rounded-xl border bg-background p-4"
              data-testid={`${testId}-${period.period}`}
              key={period.period}
            >
              <h3 className="font-semibold">{formatForecastPeriod(period.period)}</h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Entradas</dt>
                  <dd className="font-medium tabular-nums">
                    {formatForecastMoney(period.inflowCents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Saídas</dt>
                  <dd className="font-medium tabular-nums">
                    {formatForecastMoney(period.outflowCents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Entradas realizadas</dt>
                  <dd className="font-medium tabular-nums">
                    {formatForecastMoney(period.realizedInflowCents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Saídas realizadas</dt>
                  <dd className="font-medium tabular-nums">
                    {formatForecastMoney(period.realizedOutflowCents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Entradas previstas</dt>
                  <dd className="font-medium tabular-nums">
                    {formatForecastMoney(period.projectedInflowCents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Saídas previstas</dt>
                  <dd className="font-medium tabular-nums">
                    {formatForecastMoney(period.projectedOutflowCents)}
                  </dd>
                </div>
                <div className="col-span-2 border-t pt-3">
                  <dt className="text-muted-foreground">Variação líquida</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatForecastMoney(period.netCents)}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
          Não há buckets de período para exibir.
        </p>
      )}
    </section>
  );
}

export const ForecastMonthlyBreakdown = ForecastPeriodBreakdown;
