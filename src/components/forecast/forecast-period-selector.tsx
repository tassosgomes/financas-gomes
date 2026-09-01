import Link from "next/link";

import type {
  ForecastScenario,
  GetForecastQuery,
} from "@/modules/forecast/contracts";
import {
  FORECAST_SCENARIO_LABELS,
  type ForecastQueryViewModel,
} from "@/modules/forecast/ui-contracts";

export interface ForecastPeriodSelectorProps {
  /** Current query, supplied by the server route. */
  query?: GetForecastQuery | ForecastQueryViewModel;
  from?: string | null;
  to?: string | null;
  scenario?: ForecastScenario;
  action?: string;
  previousHref?: string;
  nextHref?: string;
  previousLabel?: string;
  nextLabel?: string;
  testId?: string;
  className?: string;
}

function queryValue(
  query: GetForecastQuery | ForecastQueryViewModel | undefined,
  key: "from" | "to",
): string {
  const value = query?.[key];
  return typeof value === "string" ? value : "";
}

/**
 * GET-only period/scenario selector.  It emits exactly the public T06 query
 * fields and leaves default-period resolution to the server.
 */
export function ForecastPeriodSelector({
  action = "/forecast",
  className,
  from,
  nextHref,
  nextLabel = "Próximo período",
  previousHref,
  previousLabel = "Período anterior",
  query,
  scenario = "CONSERVATIVE",
  testId = "forecast-period-selector",
  to,
}: ForecastPeriodSelectorProps) {
  const resolvedFrom = queryValue(query, "from") || from || "";
  const resolvedTo = queryValue(query, "to") || to || "";
  const resolvedScenario = query?.scenario ?? scenario;

  return (
    <section
      aria-labelledby={`${testId}-title`}
      className={`rounded-2xl border bg-card p-4 shadow-sm sm:p-5${className ? ` ${className}` : ""}`}
      data-testid={testId}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold" id={`${testId}-title`}>
            Consultar período
          </h2>
          <p className="mt-1 text-sm text-muted-foreground" id={`${testId}-description`}>
            Escolha datas civis e um cenário; a projeção é calculada no servidor.
          </p>
        </div>
        <nav aria-label="Navegação de períodos" className="flex flex-wrap gap-2">
          {previousHref ? (
            <Link
              className="inline-flex min-h-10 items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`${testId}-previous`}
              href={previousHref}
            >
              {previousLabel}
            </Link>
          ) : null}
          {nextHref ? (
            <Link
              className="inline-flex min-h-10 items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`${testId}-next`}
              href={nextHref}
            >
              {nextLabel}
            </Link>
          ) : null}
        </nav>
      </div>

      <form
        action={action}
        className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
        data-testid={`${testId}-form`}
        method="get"
      >
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor={`${testId}-from`}>
            Data inicial
          </label>
          <input
            aria-describedby={`${testId}-description`}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            id={`${testId}-from`}
            name="from"
            type="date"
            defaultValue={resolvedFrom}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor={`${testId}-to`}>
            Data final
          </label>
          <input
            aria-describedby={`${testId}-description`}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            id={`${testId}-to`}
            name="to"
            type="date"
            defaultValue={resolvedTo}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor={`${testId}-scenario`}>
            Cenário
          </label>
          <select
            aria-describedby={`${testId}-description`}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            id={`${testId}-scenario`}
            name="scenario"
            defaultValue={resolvedScenario}
          >
            {(Object.keys(FORECAST_SCENARIO_LABELS) as ForecastScenario[]).map(
              (value) => (
                <option key={value} value={value}>
                  {FORECAST_SCENARIO_LABELS[value]}
                </option>
              ),
            )}
          </select>
        </div>
        <button
          className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={`${testId}-submit`}
          type="submit"
        >
          Aplicar período
        </button>
      </form>
    </section>
  );
}

export const ForecastScenarioSelector = ForecastPeriodSelector;
export const PeriodSelector = ForecastPeriodSelector;
export const ForecastPeriodPicker = ForecastPeriodSelector;
