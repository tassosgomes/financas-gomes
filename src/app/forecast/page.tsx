import { Temporal } from "@js-temporal/polyfill";
import Link from "next/link";

import { getForecastAction } from "@/app/actions/forecast";
import {
  ForecastPeriodBreakdown,
  ForecastReadModel,
} from "@/components/forecast";
import { PageHeader } from "@/components/ui/page-header";
import { FORECAST_ROUTE } from "@/modules/forecast/routes";
import { forecastOriginHref } from "@/modules/forecast/origins";
import {
  forecastHref,
  type ForecastQueryViewModel,
} from "@/modules/forecast/ui-contracts";
import type {
  ForecastResult,
  ForecastTimeline,
  GetForecastQuery,
} from "@/modules/forecast/contracts";

export const dynamic = "force-dynamic";

type ForecastSearchParams = Record<string, string | string[] | undefined>;

interface PeriodNavigation {
  previousHref: string;
  nextHref: string;
}

function safeString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function queryForSelector(
  searchParams: ForecastSearchParams,
): GetForecastQuery | ForecastQueryViewModel {
  const scenario = safeString(searchParams.scenario);
  return {
    from: safeString(searchParams.from) ?? null,
    to: safeString(searchParams.to) ?? null,
    scenario:
      scenario === "EXPECTED" || scenario === "CONSERVATIVE"
        ? scenario
        : "CONSERVATIVE",
  };
}

function monthRange(date: Temporal.PlainDate): { from: string; to: string } {
  const first = date.with({ day: 1 });
  return {
    from: first.toString(),
    to: first.with({ day: first.daysInMonth }).toString(),
  };
}

function shiftDate(date: Temporal.PlainDate, months: number): Temporal.PlainDate {
  return date.add({ months }, { overflow: "constrain" });
}

function navigationFor(
  timeline: ForecastTimeline,
): PeriodNavigation | undefined {
  try {
    const from = Temporal.PlainDate.from(timeline.from);
    const to = Temporal.PlainDate.from(timeline.to);
    const isWholeMonth =
      from.day === 1 && to.day === to.daysInMonth && from.year === to.year && from.month === to.month;

    const periodFor = (months: number): GetForecastQuery => {
      if (isWholeMonth) {
        const target = shiftDate(from.with({ day: 1 }), months);
        return { ...monthRange(target), scenario: timeline.scenario };
      }

      return {
        from: shiftDate(from, months).toString(),
        to: shiftDate(to, months).toString(),
        scenario: timeline.scenario,
      };
    };

    return {
      previousHref: forecastHref(periodFor(-1), FORECAST_ROUTE),
      nextHref: forecastHref(periodFor(1), FORECAST_ROUTE),
    };
  } catch {
    // T06 has already validated the read model. Keep navigation fail-closed
    // if an adapter ever supplies an invalid timeline to this route.
    return undefined;
  }
}

function currentPeriodQuery(timeline: ForecastTimeline): GetForecastQuery {
  return {
    from: timeline.from,
    to: timeline.to,
    scenario: timeline.scenario,
  };
}

function periodSelectorProps(
  timeline: ForecastTimeline,
): {
  query: GetForecastQuery;
  previousHref?: string;
  nextHref?: string;
} {
  const navigation = navigationFor(timeline);
  return {
    query: currentPeriodQuery(timeline),
    ...(navigation?.previousHref
      ? { previousHref: navigation.previousHref }
      : {}),
    ...(navigation?.nextHref ? { nextHref: navigation.nextHref } : {}),
  };
}

function routeActionLink() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Link
        className="inline-flex min-h-10 items-center justify-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={FORECAST_ROUTE}
      >
        Período atual
      </Link>
      <Link
        className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href="/forecast/origin/new"
      >
        Novo compromisso
      </Link>
    </div>
  );
}

function routeErrorQuery(
  searchParams: ForecastSearchParams,
): GetForecastQuery | ForecastQueryViewModel {
  return queryForSelector(searchParams);
}

/**
 * Server-first S07 view. The browser submits only the public query accepted by
 * T06; period defaults, navigation and all financial values stay server-side.
 */
export default async function ForecastPage({
  searchParams,
}: {
  searchParams?: Promise<ForecastSearchParams>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  let result: ForecastResult<ForecastTimeline>;

  try {
    // Keep the URL shape at the T06 boundary. Its strict schema rejects
    // unknown fields/array values with an opaque, recoverable error.
    result = await getForecastAction(resolvedSearchParams);
  } catch {
    result = {
      ok: false,
      error: { code: "FORECAST_QUERY_FAILED", field: null },
    };
  }

  if (!result.ok) {
    return (
      <section className="space-y-6" data-testid="forecast-route-error">
        <PageHeader
          action={routeActionLink()}
          description="Veja o saldo e os compromissos conhecidos do fluxo futuro."
          eyebrow="Planejamento financeiro"
          title="Fluxo futuro"
        />
        <ForecastReadModel
          error={result.error}
          periodSelector={{
            action: FORECAST_ROUTE,
            query: routeErrorQuery(resolvedSearchParams),
          }}
          retryHref={FORECAST_ROUTE}
          showPeriodSelector
          state="error"
          testId="forecast-view"
        />
      </section>
    );
  }

  const timeline = result.value;
  const query = currentPeriodQuery(timeline);

  return (
    <section className="space-y-6" data-testid="forecast-route">
      <PageHeader
        action={routeActionLink()}
        description="Consulte o saldo projetado e os compromissos conhecidos, distinguindo o que já foi realizado do que ainda está previsto."
        eyebrow="Planejamento financeiro"
        title="Fluxo futuro"
      />
      <ForecastReadModel
        getSourceHref={forecastOriginHref}
        periodSelector={{
          action: FORECAST_ROUTE,
          ...periodSelectorProps(timeline),
        }}
        returnHref={forecastHref(query, FORECAST_ROUTE)}
        showPeriodSelector
        state="ready"
        testId="forecast-view"
        timeline={timeline}
      />
      <ForecastPeriodBreakdown timeline={timeline} />
    </section>
  );
}
