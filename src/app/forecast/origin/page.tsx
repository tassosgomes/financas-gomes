import Link from "next/link";

import { getForecastOriginAction } from "@/app/actions/forecast-origin";
import { ForecastOriginDetailView } from "@/components/forecast";
import { ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { FORECAST_ORIGIN_ROUTE, FORECAST_ROUTE } from "@/modules/forecast/routes";
import { forecastHref } from "@/modules/forecast/ui-contracts";
import { getForecastQuerySchema } from "@/modules/forecast/contracts";

export const dynamic = "force-dynamic";

type OriginSearchParams = Record<string, string | string[] | undefined>;

function scalar(
  params: OriginSearchParams,
  key: keyof OriginSearchParams,
): string | undefined {
  return typeof params[key] === "string" ? params[key] : undefined;
}

function safeBackHref(value: string | undefined): string {
  if (!value || value.length > 512 || /[\p{Cc}\p{Cf}]/u.test(value)) {
    return FORECAST_ROUTE;
  }
  try {
    const parsed = new URL(value, "https://forecast.local");
    if (parsed.origin !== "https://forecast.local" || parsed.pathname !== FORECAST_ROUTE) {
      return FORECAST_ROUTE;
    }
    const query = Object.fromEntries(parsed.searchParams.entries());
    const valid = getForecastQuerySchema.safeParse(query);
    return valid.success ? forecastHref(valid.data, FORECAST_ROUTE) : FORECAST_ROUTE;
  } catch {
    return FORECAST_ROUTE;
  }
}

function routeError(backHref: string) {
  return (
    <section className="space-y-6" data-testid="forecast-origin-route-error">
      <PageHeader
        action={
          <Link
            className="inline-flex min-h-10 items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={backHref}
          >
            Voltar à projeção
          </Link>
        }
        description="Consulte a fonte autorizada de um compromisso sem expor dados de outro espaço financeiro."
        eyebrow="Planejamento financeiro"
        title="Origem do compromisso"
      />
      <ErrorState
        message="Essa origem não foi encontrada no seu espaço financeiro."
        retryHref={backHref}
        testId="forecast-origin-not-found"
        title="Origem não encontrada"
      />
    </section>
  );
}

/**
 * Origin drill-down. The URL contains only an opaque source reference and
 * optional recurring hints; the action resolves household ownership server-side.
 */
export default async function ForecastOriginPage({
  searchParams,
}: {
  searchParams?: Promise<OriginSearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const backHref = safeBackHref(scalar(params, "returnTo"));
  const input = {
    kind: scalar(params, "kind"),
    referenceId: scalar(params, "referenceId"),
    ...(scalar(params, "recurringRuleId")
      ? { recurringRuleId: scalar(params, "recurringRuleId") }
      : {}),
    ...(scalar(params, "occurrenceKey")
      ? { occurrenceKey: scalar(params, "occurrenceKey") }
      : {}),
  };

  let result: Awaited<ReturnType<typeof getForecastOriginAction>>;
  try {
    result = await getForecastOriginAction(input);
  } catch {
    return routeError(backHref);
  }

  if (!result.ok) return routeError(backHref);

  return (
    <section className="space-y-6" data-testid="forecast-origin-route">
      <PageHeader
        action={
          <Link
            className="inline-flex min-h-10 items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={`${FORECAST_ORIGIN_ROUTE}/new`}
          >
            Novo compromisso
          </Link>
        }
        description="Confira a regra que gerou o valor e faça somente a manutenção permitida pela sua fonte."
        eyebrow="Planejamento financeiro"
        title="Origem do compromisso"
      />
      <ForecastOriginDetailView backHref={backHref} detail={result.value} />
    </section>
  );
}
