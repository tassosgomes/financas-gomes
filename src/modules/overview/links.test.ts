import { describe, expect, it } from "vitest";

import { parseTransactionsSearchParams } from "@/components/transactions/transaction-listing-utils";
import { parseCreditCardPeriodFilter } from "@/components/credit-cards/ui-contracts";
import { BUDGETS_ROUTE, SPENDABLE_BREAKDOWN_ROUTE } from "@/modules/budgets/routes";
import { FORECAST_ROUTE } from "@/modules/forecast/routes";
import { parseGetForecastQuery } from "@/modules/forecast/contracts";
import { TRANSACTIONS_ROUTE } from "@/modules/transactions/routes";

import {
  OVERVIEW_OTHER_KEY,
  OVERVIEW_UNCATEGORIZED_KEY,
  type OverviewAlert,
  type OverviewCaixinhaItem,
  type OverviewCardInvoiceItem,
  type OverviewCategoryGroup,
  type OverviewPeriod,
} from "./contracts";
import {
  buildOverviewLinks,
  disabledOverviewLink,
} from "./links";

const HOUSEHOLD_A_CATEGORY_ID = "00000000-0000-7000-8000-000000061201";
const HOUSEHOLD_B_CATEGORY_ID = "00000000-0000-7000-8000-000000061202";
const HOUSEHOLD_B_HOUSEHOLD_ID = "00000000-0000-7000-8000-000000101002";
const CAIXINHA_REFERENCE_ID = "00000000-0000-7000-8000-000000071301";
const CARD_ID = "00000000-0000-7000-8000-000000081401";

const PERIOD: OverviewPeriod = {
  key: "2026-09",
  from: "2026-09-01",
  to: "2026-09-30",
  asOf: "2026-09-15",
};

function parseTransactionsHref(href: string) {
  const url = new URL(href, "http://localhost");
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return parseTransactionsSearchParams(params).query;
}

function parseForecastHref(href: string) {
  const url = new URL(href, "http://localhost");
  return parseGetForecastQuery({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    scenario: url.searchParams.get("scenario") ?? undefined,
  });
}

function categoryGroup(
  overrides: Partial<OverviewCategoryGroup> & Pick<OverviewCategoryGroup, "key" | "label">,
): OverviewCategoryGroup {
  return {
    amountCents: "10000",
    percent: 50,
    expenseEventCount: 1,
    purchaseEventCount: 0,
    ...overrides,
  };
}

describe("buildOverviewLinks", () => {
  const links = buildOverviewLinks({
    period: PERIOD,
    scenario: "CONSERVATIVE",
    horizonDays: 90,
  });

  it("builds spendable, budgets and credit-card collection routes without query", () => {
    expect(links.spendableHref).toBe(SPENDABLE_BREAKDOWN_ROUTE);
    expect(links.budgetsHref).toBe(BUDGETS_ROUTE);
    expect(links.creditCardsHref).toBe("/credit-cards");
  });

  it("parses period income and expense transaction URLs", () => {
    expect(parseTransactionsHref(links.periodIncomeHref)).toEqual({
      from: PERIOD.from,
      to: PERIOD.to,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
    });
    expect(parseTransactionsHref(links.periodExpenseHref)).toEqual({
      from: PERIOD.from,
      to: PERIOD.to,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
    });
    expect(links.periodIncomeHref.startsWith(`${TRANSACTIONS_ROUTE}?`)).toBe(true);
    expect(links.periodExpenseHref.startsWith(`${TRANSACTIONS_ROUTE}?`)).toBe(true);
  });

  it("parses forecast URL from asOf+1 through asOf+horizonDays", () => {
    expect(parseForecastHref(links.forecastHref)).toEqual({
      from: "2026-09-16",
      to: "2026-12-14",
      scenario: "CONSERVATIVE",
    });
    expect(links.forecastHref.startsWith(`${FORECAST_ROUTE}?`)).toBe(true);
  });

  it("links real categories to EXPENSE filters with categoryId", () => {
    const group = categoryGroup({
      key: HOUSEHOLD_A_CATEGORY_ID,
      label: "Mercado",
      categoryId: HOUSEHOLD_A_CATEGORY_ID,
    });

    expect(parseTransactionsHref(links.categoryHref(group))).toEqual({
      from: PERIOD.from,
      to: PERIOD.to,
      kind: "EXPENSE",
      status: "POSTED",
      categoryId: HOUSEHOLD_A_CATEGORY_ID,
      origin: "MANUAL",
    });
  });

  it("uses __none for uncategorized drill-down", () => {
    const group = categoryGroup({
      key: OVERVIEW_UNCATEGORIZED_KEY,
      label: "Sem categoria",
    });

    expect(links.categoryHref(group)).toContain("categoryId=__none");
    expect(parseTransactionsHref(links.categoryHref(group))).toEqual({
      from: PERIOD.from,
      to: PERIOD.to,
      kind: "EXPENSE",
      status: "POSTED",
      categoryId: null,
      origin: "MANUAL",
    });
  });

  it("links the residual other bucket to period expenses without category filter", () => {
    const group = categoryGroup({
      key: OVERVIEW_OTHER_KEY,
      label: "Outros",
    });

    const href = links.categoryHref(group);
    expect(href).not.toContain("categoryId=");
    expect(parseTransactionsHref(href)).toEqual({
      from: PERIOD.from,
      to: PERIOD.to,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
    });
  });

  it("routes purchase subsets to credit-cards with the civil period filter", () => {
    const group = categoryGroup({
      key: HOUSEHOLD_A_CATEGORY_ID,
      label: "Mercado",
      categoryId: HOUSEHOLD_A_CATEGORY_ID,
      purchaseEventCount: 2,
    });

    const href = links.purchaseHref(group);
    expect(href.startsWith("/credit-cards?")).toBe(true);
    expect(href).not.toContain(TRANSACTIONS_ROUTE);

    const url = new URL(href, "http://localhost");
    expect(parseCreditCardPeriodFilter(url.searchParams)).toEqual({
      from: PERIOD.from,
      to: PERIOD.to,
    });
  });

  it("links caixinhas and cards to their detail routes", () => {
    const caixinha: OverviewCaixinhaItem = {
      referenceId: CAIXINHA_REFERENCE_ID,
      name: "Reserva",
      balanceCents: "50000",
      status: "ACTIVE",
    };
    const card: OverviewCardInvoiceItem = {
      cardId: CARD_ID,
      cardName: "Nubank",
      period: "2026-09",
      dueOn: "2026-10-10",
      amountCents: "120000",
      state: "PROJECTED",
    };

    expect(links.caixinhaHref(caixinha)).toBe(`/budgets/${CAIXINHA_REFERENCE_ID}`);
    expect(links.cardHref(card)).toBe(`/credit-cards/${CARD_ID}`);
  });

  it("marks caixinha drill-down unavailable when referenceId is empty", () => {
    const unavailable: OverviewCaixinhaItem = {
      referenceId: "",
      name: "Sem referência",
      balanceCents: "0",
      status: "ACTIVE",
    };

    expect(links.caixinhaHref(unavailable)).toBe("");
    expect(disabledOverviewLink("Caixinha indisponível")).toEqual({
      href: null,
      available: false,
      reason: "Caixinha indisponível",
    });
  });

  it("maps alert ruleIds to the documented destinations", () => {
    const alerts: OverviewAlert[] = [
      { ruleId: "SPENDABLE_NOT_POSITIVE", severity: "attention", message: "x" },
      { ruleId: "FORECAST_MONTH_NEGATIVE", severity: "critical", message: "x" },
      {
        ruleId: "COMMITMENT_SOON",
        severity: "attention",
        message: "x",
        date: "2026-09-20",
      },
      { ruleId: "EXPECTED_INCOME_UNREALIZED", severity: "attention", message: "x" },
      {
        ruleId: "BOX_INSUFFICIENT",
        severity: "attention",
        message: "x",
        referenceId: CAIXINHA_REFERENCE_ID,
      },
    ];

    expect(links.alertHref(alerts[0]!)).toBe(SPENDABLE_BREAKDOWN_ROUTE);
    expect(parseForecastHref(links.alertHref(alerts[1]!))).toEqual({
      from: "2026-09-16",
      to: "2026-12-14",
      scenario: "CONSERVATIVE",
    });
    expect(parseForecastHref(links.alertHref(alerts[2]!))).toEqual({
      from: "2026-09-20",
      to: "2026-12-14",
      scenario: "CONSERVATIVE",
    });
    expect(parseTransactionsHref(links.alertHref(alerts[3]!)).kind).toBe("INCOME");
    expect(links.alertHref(alerts[4]!)).toBe(`/budgets/${CAIXINHA_REFERENCE_ID}`);
    expect(
      links.alertHref({
        ruleId: "BOX_INSUFFICIENT",
        severity: "attention",
        message: "x",
      }),
    ).toBe("");
  });

  it("never exposes neighbor household identifiers in generated URLs", () => {
    const group = categoryGroup({
      key: HOUSEHOLD_A_CATEGORY_ID,
      label: "Mercado",
      categoryId: HOUSEHOLD_A_CATEGORY_ID,
    });

    const serialized = JSON.stringify({
      periodIncome: links.periodIncomeHref,
      periodExpense: links.periodExpenseHref,
      forecast: links.forecastHref,
      category: links.categoryHref(group),
      purchase: links.purchaseHref(group),
      caixinha: links.caixinhaHref({
        referenceId: CAIXINHA_REFERENCE_ID,
        name: "Reserva",
        balanceCents: "0",
        status: "ACTIVE",
      }),
      card: links.cardHref({
        cardId: CARD_ID,
        cardName: "Nubank",
        period: "2026-09",
        dueOn: "2026-10-10",
        amountCents: "0",
        state: "PROJECTED",
      }),
    });

    expect(serialized).not.toContain(HOUSEHOLD_B_HOUSEHOLD_ID);
    expect(serialized).not.toContain(HOUSEHOLD_B_CATEGORY_ID);
    expect(serialized).not.toContain("householdId");
  });
});
