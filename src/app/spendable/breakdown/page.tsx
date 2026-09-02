import Link from "next/link";

import { getSpendableAction } from "@/app/actions/spendable";
import {
  SpendableBreakdownView,
  SpendableCard,
} from "@/components/spendable";
import { PageHeader } from "@/components/ui/page-header";
import { AUTHENTICATED_ROUTE } from "@/modules/auth/routes";
import { spendableCausalOriginHref } from "@/modules/spendable/origins";
import type {
  GetSpendableInput,
  SpendableBreakdown,
} from "@/modules/spendable/contracts";
import type { SpendableResult } from "@/modules/spendable/service";

export const dynamic = "force-dynamic";

const SPENDABLE_BREAKDOWN_ROUTE = "/spendable/breakdown" as const;

type SpendableSearchParams = Record<string, string | string[] | undefined>;
type SpendablePageResult = SpendableResult<SpendableBreakdown>;

function scalar(
  params: SpendableSearchParams,
  key: keyof SpendableSearchParams,
): string | undefined {
  return typeof params[key] === "string" ? params[key] : undefined;
}

function safeHorizon(value: string): number {
  if (!/^\d+$/u.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

/**
 * Maps only the public S08 selectors from the URL. Household/session fields,
 * return paths and causal references are deliberately ignored here; context
 * authority remains inside the server action/service.
 */
function queryInput(params: SpendableSearchParams): GetSpendableInput | undefined {
  const asOf = scalar(params, "asOf");
  const scenario = scalar(params, "scenario");
  const horizon = scalar(params, "horizon");
  const input: {
    asOf?: string;
    scenario?: GetSpendableInput["scenario"];
    horizon?: { days: number };
  } = {};

  if (asOf !== undefined) input.asOf = asOf;
  if (scenario !== undefined) {
    // Keep invalid values visible to the strict service parser instead of
    // silently changing a requested scenario to the conservative default.
    input.scenario = scenario as GetSpendableInput["scenario"];
  }
  if (horizon !== undefined) input.horizon = { days: safeHorizon(horizon) };

  return Object.keys(input).length > 0 ? input : undefined;
}

function queryHref(input: GetSpendableInput | undefined): string {
  if (!input) return SPENDABLE_BREAKDOWN_ROUTE;

  const params = new URLSearchParams();
  if (input.asOf !== undefined) params.set("asOf", input.asOf);
  if (input.scenario !== undefined) params.set("scenario", input.scenario);
  if (input.horizon !== undefined) {
    params.set("horizon", String(input.horizon.days));
  }
  const encoded = params.toString();
  return encoded ? `${SPENDABLE_BREAKDOWN_ROUTE}?${encoded}` : SPENDABLE_BREAKDOWN_ROUTE;
}

function routeAction(href: string) {
  return (
    <Link
      className="inline-flex min-h-10 items-center justify-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      href={href}
    >
      Voltar à visão geral
    </Link>
  );
}

function pageState(result: SpendablePageResult): "empty" | "error" | "ready" {
  if (result.ok) return "ready";
  return result.error.code === "SPENDABLE_NOT_FOUND" ? "empty" : "error";
}

/**
 * Authenticated, server-first composition page. The browser may select only
 * the public period/scenario fields; all monetary data and origin hrefs come
 * from the authenticated server boundary.
 */
export default async function SpendableBreakdownPage({
  searchParams,
}: {
  searchParams?: Promise<SpendableSearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const input = queryInput(params);
  const href = queryHref(input);
  let result: SpendablePageResult;

  try {
    result = input === undefined
      ? await getSpendableAction()
      : await getSpendableAction(input);
  } catch {
    result = {
      ok: false,
      error: { code: "SPENDABLE_QUERY_FAILED", field: null },
    };
  }

  const state = pageState(result);
  const action = routeAction(AUTHENTICATED_ROUTE);

  return (
    <section className="space-y-6" data-testid="spendable-breakdown-route">
      <PageHeader
        action={action}
        description="Confira cada componente do cálculo, o ponto de menor saldo e as origens autorizadas que explicam o resultado."
        eyebrow="Disponibilidade para gastar"
        title="Composição do disponível"
      />

      {result.ok ? (
        <div className="space-y-6">
          <SpendableCard
            breakdown={result.value}
            detailsLabel="Composição aberta"
            state="ready"
            testId="spendable-breakdown-card"
          />
          <SpendableBreakdownView
            breakdown={result.value}
            getOriginHref={spendableCausalOriginHref}
            returnHref={href}
            state="ready"
            testId="spendable-breakdown"
          />
        </div>
      ) : (
        <SpendableBreakdownView
          error={result.error}
          retryHref={href}
          state={state}
          testId="spendable-breakdown"
        />
      )}
    </section>
  );
}
