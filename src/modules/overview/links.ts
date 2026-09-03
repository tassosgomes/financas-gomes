import { Temporal } from "@js-temporal/polyfill";

import {
  CREDIT_CARD_ROUTES,
  creditCardHref,
  encodeCreditCardPeriodFilter,
} from "@/components/credit-cards/ui-contracts";
import {
  transactionsHref,
} from "@/components/transactions/transaction-listing-utils";
import {
  BUDGETS_ROUTE,
  budgetDetailRoute,
  SPENDABLE_BREAKDOWN_ROUTE,
} from "@/modules/budgets/routes";
import { FORECAST_ORIGIN_ROUTE } from "@/modules/forecast/routes";
import { forecastHref } from "@/modules/forecast/ui-contracts";

import {
  OVERVIEW_OTHER_KEY,
  OVERVIEW_UNCATEGORIZED_KEY,
  type OverviewAlert,
  type OverviewCaixinhaItem,
  type OverviewCardInvoiceItem,
  type OverviewCategoryGroup,
  type OverviewCommitmentItem,
  type OverviewPeriod,
  type OverviewReadModel,
  type OverviewScenario,
} from "./contracts";

export interface DisabledOverviewLink {
  readonly href: null;
  readonly available: false;
  readonly reason: string;
}

export function disabledOverviewLink(reason: string): DisabledOverviewLink {
  return { href: null, available: false, reason };
}

export interface OverviewLinks {
  readonly spendableHref: string;
  readonly periodIncomeHref: string;
  readonly periodExpenseHref: string;
  readonly forecastHref: string;
  readonly budgetsHref: string;
  readonly creditCardsHref: string;
  readonly categoryHref: (group: OverviewCategoryGroup) => string;
  readonly purchaseHref: (group: OverviewCategoryGroup) => string;
  readonly caixinhaHref: (item: OverviewCaixinhaItem) => string;
  readonly cardHref: (item: OverviewCardInvoiceItem) => string;
  readonly alertHref: (alert: OverviewAlert) => string;
  readonly commitmentItemHref: (item: OverviewCommitmentItem) => string;
}

interface OverviewLinkContext {
  readonly period: OverviewPeriod;
  readonly scenario: OverviewScenario;
  readonly forecastFrom: string;
  readonly forecastTo: string;
}

function computeForecastRange(
  period: OverviewPeriod,
  horizonDays: number,
): { readonly from: string; readonly to: string } {
  const asOf = Temporal.PlainDate.from(period.asOf);
  return {
    from: asOf.add({ days: 1 }).toString(),
    to: asOf.add({ days: horizonDays }).toString(),
  };
}

function periodTransactionsHref(
  context: OverviewLinkContext,
  kind: "INCOME" | "EXPENSE",
  categoryId?: string | null,
): string {
  return transactionsHref({
    from: context.period.from,
    to: context.period.to,
    kind,
    status: "POSTED",
    ...(categoryId !== undefined ? { categoryId } : {}),
  });
}

function creditCardsPeriodHref(context: OverviewLinkContext): string {
  const query = encodeCreditCardPeriodFilter({
    from: context.period.from,
    to: context.period.to,
  });
  return query
    ? `${CREDIT_CARD_ROUTES.collection}?${query}`
    : CREDIT_CARD_ROUTES.collection;
}

function resolveCategoryTransactionsHref(
  context: OverviewLinkContext,
  group: OverviewCategoryGroup,
): string {
  if (group.key === OVERVIEW_OTHER_KEY) {
    return periodTransactionsHref(context, "EXPENSE");
  }

  if (group.key === OVERVIEW_UNCATEGORIZED_KEY) {
    return periodTransactionsHref(context, "EXPENSE", null);
  }

  const categoryId = group.categoryId ?? group.key;
  return periodTransactionsHref(context, "EXPENSE", categoryId);
}

function resolveCommitmentItemHref(item: OverviewCommitmentItem): string {
  const referenceId = item.referenceId.trim();
  if (!referenceId) {
    return "";
  }

  const params = new URLSearchParams({
    kind: item.originKind,
    referenceId,
  });
  return `${FORECAST_ORIGIN_ROUTE}?${params.toString()}`;
}

function resolveAlertHref(
  context: OverviewLinkContext,
  alert: OverviewAlert,
): string {
  switch (alert.ruleId) {
    case "SPENDABLE_NOT_POSITIVE":
      return SPENDABLE_BREAKDOWN_ROUTE;
    case "FORECAST_MONTH_NEGATIVE":
      return forecastHref({
        from: context.forecastFrom,
        to: context.forecastTo,
        scenario: context.scenario,
      });
    case "COMMITMENT_SOON":
      return forecastHref({
        from: alert.date ?? context.forecastFrom,
        to: context.forecastTo,
        scenario: context.scenario,
      });
    case "EXPECTED_INCOME_UNREALIZED":
      return periodTransactionsHref(context, "INCOME");
    case "BOX_INSUFFICIENT":
      return alert.referenceId
        ? budgetDetailRoute(alert.referenceId)
        : "";
    default: {
      const exhaustive: never = alert.ruleId;
      return exhaustive;
    }
  }
}

/** Deterministic drill-down URLs for the S10 read model (T07). */
export function buildOverviewLinks(
  model: Pick<OverviewReadModel, "period" | "scenario" | "horizonDays">,
): OverviewLinks {
  const forecastRange = computeForecastRange(model.period, model.horizonDays);
  const context: OverviewLinkContext = {
    period: model.period,
    scenario: model.scenario,
    forecastFrom: forecastRange.from,
    forecastTo: forecastRange.to,
  };

  return {
    spendableHref: SPENDABLE_BREAKDOWN_ROUTE,
    periodIncomeHref: periodTransactionsHref(context, "INCOME"),
    periodExpenseHref: periodTransactionsHref(context, "EXPENSE"),
    forecastHref: forecastHref({
      from: context.forecastFrom,
      to: context.forecastTo,
      scenario: context.scenario,
    }),
    budgetsHref: BUDGETS_ROUTE,
    creditCardsHref: CREDIT_CARD_ROUTES.collection,
    categoryHref: (group) => resolveCategoryTransactionsHref(context, group),
    purchaseHref: () => creditCardsPeriodHref(context),
    caixinhaHref: (item) =>
      item.referenceId.trim().length > 0
        ? budgetDetailRoute(item.referenceId)
        : "",
    cardHref: (item) => creditCardHref(item.cardId),
    alertHref: (alert) => resolveAlertHref(context, alert),
    commitmentItemHref: (item) => resolveCommitmentItemHref(item),
  };
}
