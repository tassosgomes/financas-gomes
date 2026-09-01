import type {
  ForecastDay,
  ForecastItem,
  ForecastTimeline as ForecastTimelineValue,
} from "@/modules/forecast/contracts";
import {
  formatForecastDate,
  formatForecastImpact,
  formatForecastMoney,
  formatForecastPeriod,
  toForecastErrorViewModel,
  type ForecastReadModelState,
  type ForecastTimelineViewModel,
} from "@/modules/forecast/ui-contracts";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/async-state";

import {
  ForecastCertaintyBadge,
  ForecastDirectionBadge,
  ForecastOriginLink,
  ForecastSourceBadge,
  ForecastStatusBadge,
} from "./forecast-badges";

export interface ForecastTimelineProps {
  /** Timeline and day totals are calculated by the server/ForecastEngine. */
  timeline?: ForecastTimelineValue | ForecastTimelineViewModel | null;
  state?: ForecastReadModelState;
  error?: unknown;
  retryHref?: string;
  /** Server-authorized route resolver for an origin; no ID is composed here. */
  getSourceHref?: (item: ForecastItem) => string | null | undefined;
  /** Alternative to a callback for serializable server component props. */
  sourceHrefs?: Readonly<Record<string, string>>;
  returnHref?: string;
  testId?: string;
  className?: string;
}

function unwrapTimeline(
  value: ForecastTimelineValue | ForecastTimelineViewModel,
): ForecastTimelineValue {
  return "timeline" in value ? value.timeline : value;
}

function DayTotals({ day, testId }: { day: ForecastDay; testId: string }) {
  return (
    <dl
      aria-label={`Totais do dia ${formatForecastDate(day.date)}`}
      className="grid gap-2 text-sm sm:grid-cols-3"
      data-testid={testId}
    >
      <div>
        <dt className="text-muted-foreground">Entradas</dt>
        <dd className="font-medium tabular-nums">
          {formatForecastMoney(day.inflowCents)}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Saídas</dt>
        <dd className="font-medium tabular-nums">
          {formatForecastMoney(day.outflowCents)}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Variação líquida</dt>
        <dd className="font-medium tabular-nums">
          {formatForecastMoney(day.netCents)}
        </dd>
      </div>
    </dl>
  );
}

function ForecastTimelineItem({
  getSourceHref,
  item,
  returnHref,
  sourceHrefs,
  testId,
}: {
  item: ForecastItem;
  getSourceHref?: (item: ForecastItem) => string | null | undefined;
  sourceHrefs?: Readonly<Record<string, string>>;
  returnHref?: string;
  testId: string;
}) {
  const sourceHref = getSourceHref?.(item) ?? sourceHrefs?.[item.referenceId];

  return (
    <li
      className="rounded-xl border bg-background p-4"
      data-testid={testId}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ForecastSourceBadge source={item.source} />
            <ForecastCertaintyBadge certainty={item.certainty} />
            <ForecastStatusBadge status={item.status} />
            <ForecastDirectionBadge direction={item.direction} />
          </div>
          <p className="font-medium leading-6">{item.source.label}</p>
          <p className="text-sm text-muted-foreground">
            {formatForecastDate(item.date)} · referência de origem preservada
            para consulta segura
          </p>
          {item.reconciliation ? (
            <p className="text-sm text-muted-foreground">
              Compromisso reconciliado com realização explícita.
              {item.reconciliation.varianceAmountCents !== null
                ? ` Variação: ${formatForecastMoney(item.reconciliation.varianceAmountCents)}.`
                : null}
            </p>
          ) : null}
          {sourceHref ? (
            <ForecastOriginLink
              href={sourceHref}
              returnHref={returnHref}
              testId={`${testId}-origin`}
            />
          ) : null}
        </div>
        <strong
          aria-label={`${item.direction === "INFLOW" ? "Entrada" : "Saída"}: ${formatForecastImpact(item.amountCents, item.direction)}`}
          className="whitespace-nowrap text-lg font-semibold tabular-nums"
        >
          {formatForecastImpact(item.amountCents, item.direction)}
        </strong>
      </div>
    </li>
  );
}

function ForecastTimelineDay({
  day,
  getSourceHref,
  index,
  returnHref,
  sourceHrefs,
  testId,
}: {
  day: ForecastDay;
  getSourceHref?: (item: ForecastItem) => string | null | undefined;
  index: number;
  sourceHrefs?: Readonly<Record<string, string>>;
  returnHref?: string;
  testId: string;
}) {
  const dayId = `${testId}-day-${index}`;
  return (
    <li className="space-y-3" data-testid={dayId}>
      <article
        aria-labelledby={`${dayId}-title`}
        className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
      >
        <header className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Dia projetado
            </p>
            <h3 className="mt-1 text-lg font-semibold" id={`${dayId}-title`}>
              {formatForecastDate(day.date)}
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Saldo final do dia: {formatForecastMoney(day.closingProjectedBalanceCents)}
          </p>
        </header>
        <div className="space-y-4 pt-4">
          <DayTotals day={day} testId={`${dayId}-totals`} />
          <ul aria-label={`Compromissos de ${formatForecastDate(day.date)}`} className="space-y-2">
            {day.items.map((item, itemIndex) => (
              <ForecastTimelineItem
                getSourceHref={getSourceHref}
                item={item}
                key={`${item.referenceId}-${itemIndex}`}
                returnHref={returnHref}
                sourceHrefs={sourceHrefs}
                testId={`${dayId}-item-${itemIndex}`}
              />
            ))}
          </ul>
        </div>
      </article>
    </li>
  );
}

/**
 * Responsive, text-first timeline.  The component only groups the days/items
 * already grouped by the server; it does not sort, filter, sum or forecast.
 */
export function ForecastTimelineView({
  className,
  error,
  getSourceHref,
  retryHref,
  returnHref,
  sourceHrefs,
  state,
  testId = "forecast-timeline",
  timeline,
}: ForecastTimelineProps) {
  const resolvedState: ForecastReadModelState =
    state ?? (timeline ? "ready" : "empty");

  if (resolvedState === "loading") {
    return (
      <LoadingState
        label="Carregando compromissos…"
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
        description="Não há compromissos conhecidos para os dias consultados."
        testId={`${testId}-empty`}
        title="Nenhum compromisso no período"
      />
    );
  }

  const timelineValue = unwrapTimeline(timeline);
  if (timelineValue.days.length === 0) {
    return (
      <section
        aria-labelledby={`${testId}-title`}
        className={`space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6${className ? ` ${className}` : ""}`}
        data-testid={testId}
      >
        <header>
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Linha do tempo · {formatForecastPeriod(timelineValue.from.slice(0, 7))}
          </p>
          <h2 className="mt-1 text-xl font-semibold" id={`${testId}-title`}>
            Nenhum compromisso no período
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Os totais e saldos permanecem disponíveis no resumo acima.
          </p>
        </header>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={`${testId}-title`}
      className={`space-y-5${className ? ` ${className}` : ""}`}
      data-testid={testId}
    >
      <header>
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Linha do tempo · {formatForecastPeriod(timelineValue.from.slice(0, 7))}
        </p>
        <h2 className="mt-1 text-xl font-semibold" id={`${testId}-title`}>
          Compromissos por dia
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Cada linha mostra se o valor é realizado, comprometido ou esperado
          e identifica a origem quando o servidor autorizou um detalhe.
        </p>
      </header>
      <ol className="space-y-4" data-testid={`${testId}-days`}>
        {timelineValue.days.map((day, index) => (
          <ForecastTimelineDay
            day={day}
            getSourceHref={getSourceHref}
            index={index}
            key={`${day.date}-${index}`}
            returnHref={returnHref}
            sourceHrefs={sourceHrefs}
            testId={testId}
          />
        ))}
      </ol>
    </section>
  );
}

export const ForecastTimeline = ForecastTimelineView;
export const ForecastDailyTimeline = ForecastTimelineView;
