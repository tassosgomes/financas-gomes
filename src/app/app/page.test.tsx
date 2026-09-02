import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SpendableBreakdown } from "@/modules/spendable/contracts";

const mocks = vi.hoisted(() => ({
  getSpendableAction: vi.fn(),
}));

vi.mock("@/app/actions/spendable", () => ({
  getSpendableAction: mocks.getSpendableAction,
}));

import AuthenticatedLoading from "./loading";
import AuthenticatedHomePage from "./page";

function breakdown(
  overrides: Partial<SpendableBreakdown> = {},
): SpendableBreakdown {
  const base: SpendableBreakdown = {
    contractVersion: "s08.v1",
    ruleVersion: "spendable.v1",
    period: {
      asOf: "2026-09-01",
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

describe("T09 authenticated home spendable card", () => {
  beforeEach(() => {
    mocks.getSpendableAction.mockReset();
  });

  it("reads the server adapter and presents the conservative 90-day model", async () => {
    mocks.getSpendableAction.mockResolvedValue({
      ok: true,
      value: breakdown(),
    });

    const html = renderToStaticMarkup(await AuthenticatedHomePage());

    expect(mocks.getSpendableAction).toHaveBeenCalledWith();
    expect(html).toContain('data-testid="home-spendable"');
    expect(html).toContain('data-state="positive"');
    expect(html).toContain("Pode gastar: R$ 2.345,00");
    expect(html).toContain("Cenário Conservador");
    expect(html).toContain("referência em 01/09/2026");
    expect(html).toContain("horizonte de 90 dias");
    expect(html).toContain('/spendable/breakdown');
    expect(html).toContain("Ver composição do disponível para gastar");
    expect(html).not.toContain("Editar cálculo");
  });

  it("keeps a deficit safe and explains the amount to preserve", async () => {
    mocks.getSpendableAction.mockResolvedValue({
      ok: true,
      value: breakdown({
        closingProjectedBalanceCents: "300000",
        minimumProjectedBalanceCents: "300000",
        minimum: { projectedBalanceCents: "300000", points: [] },
        rawSpendableCents: "-200000",
        displaySpendableCents: "0",
        deficitToPreserveReserveCents: "200000",
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
    mocks.getSpendableAction.mockResolvedValue({
      ok: false,
      error: { code: "SPENDABLE_NOT_FOUND", field: null },
    });

    const emptyHtml = renderToStaticMarkup(await AuthenticatedHomePage());
    expect(emptyHtml).toContain('data-testid="spendable-card-empty"');
    expect(emptyHtml).toContain("Nenhuma disponibilidade para exibir");
    expect(emptyHtml).not.toContain("Pode gastar: R$ 0,00");

    mocks.getSpendableAction.mockResolvedValue({
      ok: false,
      error: { code: "SPENDABLE_QUERY_FAILED", field: null },
    });
    const errorHtml = renderToStaticMarkup(await AuthenticatedHomePage());
    expect(errorHtml).toContain('data-testid="spendable-card-error"');
    expect(errorHtml).toContain("Não foi possível carregar a disponibilidade");
    expect(errorHtml).not.toContain("R$ 0,00");
  });

  it("exposes the shared loading state while the server read is pending", () => {
    const html = renderToStaticMarkup(<AuthenticatedLoading />);

    expect(html).toContain('data-testid="spendable-card-loading"');
    expect(html).toContain("Carregando disponibilidade para gastar");
  });
});

export {};
