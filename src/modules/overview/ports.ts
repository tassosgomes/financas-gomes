import type { ListBudgetsReadModel } from "@/modules/budgets/read-contracts";
import type { ForecastTimeline } from "@/modules/forecast/contracts";
import type { FinancialContext } from "@/modules/households/contracts";
import type { SpendableBreakdown } from "@/modules/spendable/contracts";

export type OriginResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly field: string | null } };

export interface OverviewCardInvoiceDraft {
  readonly cardId: string;
  readonly cardName: string;
  readonly period: string;
  readonly dueOn: string;
  readonly amountCents: string;
  readonly state: string;
}

export interface OverviewOriginPorts {
  readSpendable(input: {
    readonly asOf: string;
    readonly scenario: "CONSERVATIVE" | "EXPECTED";
    readonly horizonDays: number;
  }): Promise<OriginResult<SpendableBreakdown>>;
  readForecast(input: {
    readonly from: string;
    readonly to: string;
    readonly scenario: "CONSERVATIVE" | "EXPECTED";
  }): Promise<OriginResult<ForecastTimeline>>;
  readBudgets(input: { readonly asOf: string }): Promise<OriginResult<ListBudgetsReadModel>>;
  readCardInvoices(input: {
    readonly asOf: string;
  }): Promise<OriginResult<readonly OverviewCardInvoiceDraft[]>>;
}

export interface DefaultOverviewPortsDependencies {
  readonly getSpendable?: (
    input?: unknown,
    dependencies?: Record<string, unknown>,
  ) => Promise<OriginResult<SpendableBreakdown>>;
  readonly getForecast?: (
    input?: unknown,
    dependencies?: Record<string, unknown>,
  ) => Promise<OriginResult<ForecastTimeline>>;
  readonly budgetReadAccess?: {
    readonly list: (
      input?: { readonly asOf?: string },
    ) => Promise<OriginResult<ListBudgetsReadModel>>;
  };
  readonly listCreditCards?: (
    context: FinancialContext,
    query?: unknown,
  ) => Promise<OriginResult<{ readonly items: readonly { readonly id: string; readonly name: string }[] }>>;
  readonly getCreditCardProjection?: (
    context: FinancialContext,
    query: { readonly cardId: string; readonly asOf: string },
  ) => Promise<{
    readonly current: {
      readonly period: string;
      readonly dueOn: string | null;
      readonly totalAmountCents: string;
      readonly payment: { readonly state: string };
    };
  }>;
  readonly requireContext?: () => Promise<FinancialContext>;
}

const PUBLIC_ORIGIN_ERROR_CODES = new Set([
  "FINANCIAL_CONTEXT_REQUIRED",
  "SPENDABLE_NOT_FOUND",
  "SPENDABLE_QUERY_FAILED",
  "FORECAST_QUERY_FAILED",
  "QUERY_FAILED",
]);

export function mapOriginErrorCode(code: string): string {
  if (PUBLIC_ORIGIN_ERROR_CODES.has(code)) {
    return code;
  }
  return "OVERVIEW_ORIGIN_UNAVAILABLE";
}

export function toOriginResult<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string; readonly field?: string | null } },
): OriginResult<T> {
  if (result.ok) {
    return { ok: true, value: result.value };
  }
  return {
    ok: false,
    error: {
      code: mapOriginErrorCode(result.error.code),
      field: result.error.field ?? null,
    },
  };
}

export function createDefaultOverviewPorts(
  deps: DefaultOverviewPortsDependencies = {},
): OverviewOriginPorts {
  return {
    readSpendable: async ({ asOf, scenario, horizonDays }) => {
      const { getSpendable } = await import("@/modules/spendable/service");
      const getSpendableFn = deps.getSpendable ?? getSpendable;
      try {
        return toOriginResult(
          await getSpendableFn({
            asOf,
            scenario,
            horizon: { days: horizonDays },
          }),
        );
      } catch {
        return {
          ok: false,
          error: { code: "OVERVIEW_ORIGIN_UNAVAILABLE", field: null },
        };
      }
    },
    readForecast: async ({ from, to, scenario }) => {
      const { getForecast } = await import("@/modules/forecast/service");
      const getForecastFn = deps.getForecast ?? getForecast;
      try {
        return toOriginResult(await getForecastFn({ from, to, scenario }));
      } catch {
        return {
          ok: false,
          error: { code: "OVERVIEW_ORIGIN_UNAVAILABLE", field: null },
        };
      }
    },
    readBudgets: async ({ asOf }) => {
      const { budgetReadAccess } = await import("@/modules/budgets/service");
      const listBudgets = deps.budgetReadAccess?.list ?? budgetReadAccess.list;
      try {
        return toOriginResult(await listBudgets({ asOf }));
      } catch {
        return {
          ok: false,
          error: { code: "OVERVIEW_ORIGIN_UNAVAILABLE", field: null },
        };
      }
    },
    readCardInvoices: async ({ asOf }) => {
      const { requireFinancialContext } = await import("@/modules/households/context");
      const { listCreditCards } = await import("@/modules/credit-cards/use-cases");
      const { getCreditCardProjection } = await import("@/modules/credit-cards/projections");

      const resolveContext = deps.requireContext ?? requireFinancialContext;
      const listCards = deps.listCreditCards ?? listCreditCards;
      const readProjection = deps.getCreditCardProjection ?? getCreditCardProjection;

      try {
        const context = await resolveContext();
        const cardsResult = await listCards(context, { status: "ACTIVE" });
        if (!cardsResult.ok) {
          return toOriginResult(cardsResult);
        }

        const drafts: OverviewCardInvoiceDraft[] = [];
        for (const card of cardsResult.value.items) {
          const projection = await readProjection(context, { cardId: card.id, asOf });
          drafts.push({
            cardId: card.id,
            cardName: card.name,
            period: projection.current.period,
            dueOn: projection.current.dueOn ?? "",
            amountCents: projection.current.totalAmountCents,
            state: projection.current.payment.state,
          });
        }

        return { ok: true, value: drafts };
      } catch {
        return {
          ok: false,
          error: { code: "OVERVIEW_ORIGIN_UNAVAILABLE", field: null },
        };
      }
    },
  };
}
