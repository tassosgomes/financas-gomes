import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SpendableBreakdown,
  SpendableResult,
} from "@/modules/spendable";

const mocks = vi.hoisted(() => ({
  getSpendableAction: vi.fn(),
}));

vi.mock("@/app/actions/spendable", () => ({
  getSpendableAction: mocks.getSpendableAction,
}));

import SpendableBreakdownPage from "./page";

const sourceId = "018f47b7-6c3a-7abc-8def-1234567890ab";

function breakdown(
  overrides: Partial<SpendableBreakdown> = {},
): SpendableBreakdown {
  const value: SpendableBreakdown = {
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
    openingBalanceCents: "600000",
    openingAdjustmentsCents: "0",
    openingProjectedBalanceCents: "600000",
    closingProjectedBalanceCents: "300000",
    minimumProjectedBalanceCents: "300000",
    minimum: {
      projectedBalanceCents: "300000",
      points: [
        {
          kind: "DAY_CLOSE",
          date: "2026-09-15",
          projectedBalanceCents: "300000",
          references: [sourceId],
          items: [
            {
              referenceId: sourceId,
              sourceKind: "PLANNED_EVENT",
              date: "2026-09-15",
              amountCents: "300000",
              direction: "OUTFLOW",
              status: "PLANNED",
              certainty: "COMMITTED",
            },
          ],
        },
      ],
      causalItems: {
        totalCount: 1,
        returnedCount: 1,
        limit: 100,
        truncated: false,
        nextCursor: null,
      },
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
    rawSpendableCents: "-200000",
    displaySpendableCents: "0",
    deficitToPreserveReserveCents: "200000",
  };

  return { ...value, ...overrides };
}

function success(value: SpendableBreakdown): SpendableResult<SpendableBreakdown> {
  return { ok: true, value };
}

describe("T10 spendable breakdown route", () => {
  beforeEach(() => {
    mocks.getSpendableAction.mockReset();
  });

  it("reads the authenticated action and renders the card relation plus authorized origin", async () => {
    mocks.getSpendableAction.mockResolvedValue(success(breakdown()));

    const html = renderToStaticMarkup(
      await SpendableBreakdownPage({ searchParams: Promise.resolve({}) }),
    );

    expect(mocks.getSpendableAction).toHaveBeenCalledWith();
    expect(html).toContain('data-testid="spendable-breakdown-route"');
    expect(html).toContain("Saldo de referência");
    expect(html).toContain("Menor saldo projetado");
    expect(html).toContain("Buffer operacional");
    expect(html).toContain("Disponível bruto");
    expect(html).toContain("Disponível exibido");
    expect(html).toContain("Déficit para preservar a reserva: R$ 2.000,00");
    expect(html).toContain("Reconciliação com o card");
    expect(html).toContain("returnTo=%2Fspendable%2Fbreakdown");
    expect(html).toContain("/forecast/origin");
    expect(html).not.toContain("householdId");
  });

  it("maps only public selectors and ignores a household selector", async () => {
    mocks.getSpendableAction.mockResolvedValue(success(breakdown()));

    await SpendableBreakdownPage({
      searchParams: Promise.resolve({
        asOf: "2026-09-10",
        scenario: "EXPECTED",
        horizon: "30",
        householdId: "foreign-household",
        returnTo: "/foreign-path",
      }),
    });

    expect(mocks.getSpendableAction).toHaveBeenCalledWith({
      asOf: "2026-09-10",
      scenario: "EXPECTED",
      horizon: { days: 30 },
    });
  });

  it("accepts only a same-origin budget detail as the return target", async () => {
    mocks.getSpendableAction.mockResolvedValue(success(breakdown()));

    const budgetHtml = renderToStaticMarkup(
      await SpendableBreakdownPage({
        searchParams: Promise.resolve({ returnTo: "/budgets/budget-reference" }),
      }),
    );
    expect(budgetHtml).toContain('href="/budgets/budget-reference"');
    expect(budgetHtml).toContain("Voltar à Caixinha");

    const foreignHtml = renderToStaticMarkup(
      await SpendableBreakdownPage({
        searchParams: Promise.resolve({ returnTo: "https://evil.example/steal" }),
      }),
    );
    expect(foreignHtml).toContain('href="/app"');
    expect(foreignHtml).not.toContain("evil.example");
  });

  it("keeps unavailable resources explicit without leaking server errors", async () => {
    mocks.getSpendableAction.mockResolvedValue({
      ok: false,
      error: { code: "SPENDABLE_NOT_FOUND", field: null },
    });

    const emptyHtml = renderToStaticMarkup(
      await SpendableBreakdownPage({ searchParams: Promise.resolve({}) }),
    );
    expect(emptyHtml).toContain("Nenhuma composição para exibir");

    mocks.getSpendableAction.mockResolvedValue({
      ok: false,
      error: {
        code: "SPENDABLE_QUERY_FAILED",
        message: "SELECT secret; stack trace",
      },
    });
    const errorHtml = renderToStaticMarkup(
      await SpendableBreakdownPage({ searchParams: Promise.resolve({}) }),
    );
    expect(errorHtml).toContain("Tente novamente");
    expect(errorHtml).not.toContain("SELECT secret");
    expect(errorHtml).not.toContain("stack trace");
  });

  it("announces a truncated causal list and keeps a removed origin readable", async () => {
    const base = breakdown();
    const removedReference = "removed-origin-reference";
    const value: SpendableBreakdown = {
      ...base,
      minimum: {
        ...base.minimum,
        points: [
          {
            ...base.minimum.points[0]!,
            references: [removedReference],
            items: [
              {
                ...base.minimum.points[0]!.items[0]!,
                referenceId: removedReference,
              },
            ],
          },
        ],
        causalItems: {
          totalCount: 4,
          returnedCount: 1,
          limit: 1,
          truncated: true,
          nextCursor: "eyJ2IjoxLCJvZmZzZXQiOjF9",
        },
      },
    };
    mocks.getSpendableAction.mockResolvedValue(success(value));

    const html = renderToStaticMarkup(
      await SpendableBreakdownPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("Exibindo 1 de 4 itens causais");
    expect(html).toContain("A lista está truncada por segurança");
    expect(html).toContain("Há mais itens causais disponíveis");
    expect(html).toContain("Origem removida, cancelada ou indisponível");
    expect(html).not.toContain('href="/forecast/origin');
  });
});

export {};
