import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OverviewReadModel } from "@/modules/overview/contracts";
import { OVERVIEW_CONTRACT_VERSION } from "@/modules/overview/contracts";
import type { SpendableBreakdown } from "@/modules/spendable/contracts";

const mocks = vi.hoisted(() => ({
  getOverviewAction: vi.fn(),
}));

vi.mock("@/app/actions/overview", () => ({
  getOverviewAction: mocks.getOverviewAction,
}));

import AuthenticatedLoading from "./loading";
import AuthenticatedHomePage from "./page";

const AS_OF = "2026-09-01";
const PERIOD_KEY = "2026-09";

function breakdown(
  overrides: Partial<SpendableBreakdown> = {},
): SpendableBreakdown {
  const base: SpendableBreakdown = {
    contractVersion: "s08.v1",
    ruleVersion: "spendable.v1",
    period: {
      asOf: AS_OF,
      from: "2026-09-02",
      to: "2026-12-01",
      horizonDays: 90,
      scenario: "CONSERVATIVE",
      forecastContractVersion: "s07.v1",
    },
    openingBalanceCents: "1200000",
    openingAdjustmentsCents: "0",
    openingProjectedBalanceCents: "1200000",
    closingProjectedBalanceCents: "734500",
    minimumProjectedBalanceCents: "734500",
    minimum: {
      projectedBalanceCents: "734500",
      points: [],
    },
    operationalBuffer: {
      amountCents: "500000",
      source: "CONFIGURED",
      effectiveFrom: "2026-08-01",
      revision: "buffer-revision",
    },
    reserve: {
      contractVersion: "s09.v1",
      status: "UNAVAILABLE",
      protectedCents: "0",
      appliedOpeningAdjustmentCents: "0",
      components: [],
    },
    rawSpendableCents: "234500",
    displaySpendableCents: "234500",
    deficitToPreserveReserveCents: "0",
  };

  return { ...base, ...overrides };
}

function readySpendable(
  value: SpendableBreakdown = breakdown(),
): OverviewReadModel["spendable"] {
  return { state: "ready", data: { breakdown: value } };
}

function emptyOverviewModel(
  overrides: Partial<OverviewReadModel> = {},
): OverviewReadModel {
  return {
    contractVersion: OVERVIEW_CONTRACT_VERSION,
    period: {
      key: PERIOD_KEY,
      from: "2026-09-01",
      to: "2026-09-30",
      asOf: AS_OF,
    },
    scenario: "CONSERVATIVE",
    horizonDays: 90,
    spendable: { state: "empty" },
    periodSummary: { state: "empty" },
    expensesByCategory: { state: "empty" },
    upcomingCommitments: { state: "empty" },
    upcomingIncome: { state: "empty" },
    caixinhasSummary: { state: "empty" },
    cardInvoices: { state: "empty" },
    alerts: { state: "ready", data: { items: [] } },
    ...overrides,
  };
}

function readyOverviewModel(
  overrides: Partial<OverviewReadModel> = {},
): OverviewReadModel {
  return emptyOverviewModel({
    spendable: readySpendable(),
    periodSummary: {
      state: "ready",
      data: {
        incomeCents: "150000",
        expenseCents: "50000",
        netCents: "100000",
        expenseEventCount: 2,
        purchaseEventCount: 0,
        referenceBalanceCents: "1200000",
        reconciliation: {
          from: "2026-09-01",
          to: "2026-09-30",
          expenseFilter: "/transactions",
          incomeFilter: "/transactions",
        },
      },
    },
    expensesByCategory: {
      state: "ready",
      data: {
        totalExpenseCents: "50000",
        groups: [
          {
            key: "food",
            label: "Alimentação",
            categoryId: "cat-food",
            amountCents: "30000",
            percent: 60,
            expenseEventCount: 1,
            purchaseEventCount: 0,
          },
          {
            key: "transport",
            label: "Transporte",
            categoryId: "cat-transport",
            amountCents: "20000",
            percent: 40,
            expenseEventCount: 1,
            purchaseEventCount: 1,
          },
        ],
      },
    },
    upcomingCommitments: {
      state: "ready",
      data: {
        items: [
          {
            referenceId: "commitment-1",
            date: "2026-09-10",
            amountCents: "25000",
            direction: "OUTFLOW",
            label: "Aluguel",
            originKind: "PLANNED_EVENT",
          },
        ],
        totalMatching: 1,
        viewAllHref: "/forecast?from=2026-09-02&to=2026-11-30&scenario=CONSERVATIVE",
      },
    },
    upcomingIncome: { state: "empty" },
    caixinhasSummary: { state: "empty" },
    cardInvoices: { state: "empty" },
    alerts: {
      state: "ready",
      data: {
        items: [
          {
            ruleId: "SPENDABLE_NOT_POSITIVE",
            severity: "attention",
            message: "A disponibilidade para gastar está zerada.",
          },
        ],
      },
    },
    ...overrides,
  });
}

describe("S10 authenticated overview page", () => {
  beforeEach(() => {
    mocks.getOverviewAction.mockReset();
  });

  it("reads the consolidated action and presents the conservative 90-day spendable model", async () => {
    mocks.getOverviewAction.mockResolvedValue({
      ok: true,
      value: readyOverviewModel(),
    });

    const html = renderToStaticMarkup(await AuthenticatedHomePage());

    expect(mocks.getOverviewAction).toHaveBeenCalledWith();
    expect(html).toContain('data-testid="overview-page"');
    expect(html).toContain('data-testid="overview-spendable"');
    expect(html).toContain('data-testid="home-spendable"');
    expect(html).toContain('data-state="positive"');
    expect(html).toContain("Pode gastar: R$ 2.345,00");
    expect(html).toContain("Cenário Conservador");
    expect(html).toContain("referência em 01/09/2026");
    expect(html).toContain("horizonte de 90 dias");
    expect(html).toContain("/spendable/breakdown");
    expect(html).toContain("Ver composição do disponível para gastar");
    expect(html).not.toContain("Editar cálculo");
  });

  it("keeps a deficit safe and explains the amount to preserve", async () => {
    mocks.getOverviewAction.mockResolvedValue({
      ok: true,
      value: readyOverviewModel({
        spendable: readySpendable(
          breakdown({
            closingProjectedBalanceCents: "300000",
            minimumProjectedBalanceCents: "300000",
            minimum: { projectedBalanceCents: "300000", points: [] },
            rawSpendableCents: "-200000",
            displaySpendableCents: "0",
            deficitToPreserveReserveCents: "200000",
          }),
        ),
      }),
    });

    const html = renderToStaticMarkup(await AuthenticatedHomePage());

    expect(html).toContain('data-state="deficit"');
    expect(html).toContain("Pode gastar: R$ 0,00");
    expect(html).toContain("Déficit para preservar a reserva: R$ 2.000,00");
    expect(html).toContain("Resultado bruto");
    expect(html).toContain("-R$ 2.000,00");
    expect(html).not.toContain("Pode gastar: -R$");
  });

  it("keeps missing data distinct from a monetary zero and sanitizes failures", async () => {
    mocks.getOverviewAction.mockResolvedValue({
      ok: true,
      value: emptyOverviewModel({
        spendable: { state: "empty" },
      }),
    });

    const emptyHtml = renderToStaticMarkup(await AuthenticatedHomePage());
    expect(emptyHtml).toContain('data-testid="spendable-card-empty"');
    expect(emptyHtml).toContain("Nenhuma disponibilidade para exibir");
    expect(emptyHtml).toContain("Registre uma receita ou despesa para ver o resumo do mês.");
    expect(emptyHtml).not.toContain("Pode gastar: R$ 0,00");

    mocks.getOverviewAction.mockResolvedValue({
      ok: false,
      error: { code: "OVERVIEW_QUERY_FAILED", field: null },
    });
    const errorHtml = renderToStaticMarkup(await AuthenticatedHomePage());
    expect(errorHtml).toContain('data-testid="overview-page-error"');
    expect(errorHtml).toContain("Não foi possível carregar a visão geral");
    expect(errorHtml).not.toContain("R$ 0,00");
  });

  it("renders categories and alerts when present", async () => {
    mocks.getOverviewAction.mockResolvedValue({
      ok: true,
      value: readyOverviewModel(),
    });

    const rendered = renderToStaticMarkup(await AuthenticatedHomePage());

    expect(rendered).toContain('data-testid="overview-categories"');
    expect(rendered).toContain('data-testid="overview-category-food"');
    expect(rendered).toContain("Alimentação");
    expect(rendered).toContain('data-testid="overview-category-transport-purchase-drilldown"');
    expect(rendered).toContain('data-testid="overview-alert-SPENDABLE_NOT_POSITIVE"');
    expect(rendered).toContain("A disponibilidade para gastar está zerada.");
  });

  it("keeps spendable when forecast blocks fail partially", async () => {
    mocks.getOverviewAction.mockResolvedValue({
      ok: true,
      value: readyOverviewModel({
        upcomingCommitments: {
          state: "error",
          error: { code: "FORECAST_QUERY_FAILED", field: null },
        },
        upcomingIncome: {
          state: "error",
          error: { code: "FORECAST_QUERY_FAILED", field: null },
        },
        alerts: { state: "ready", data: { items: [] } },
      }),
    });

    const html = renderToStaticMarkup(await AuthenticatedHomePage());

    expect(html).toContain('data-testid="home-spendable"');
    expect(html).toContain("Pode gastar: R$ 2.345,00");
    expect(html).toContain('data-testid="overview-commitments-error"');
    expect(html).not.toContain('data-testid="overview-alerts"');
  });

  it("exposes the shared loading state while the server read is pending", () => {
    const html = renderToStaticMarkup(<AuthenticatedLoading />);

    expect(html).toContain('data-testid="overview-page"');
    expect(html).toContain('data-testid="spendable-card-loading"');
    expect(html).toContain("Carregando disponibilidade para gastar");
  });
});

export {};
