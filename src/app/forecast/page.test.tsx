import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ForecastResult,
  ForecastTimeline,
} from "@/modules/forecast/contracts";

const mocks = vi.hoisted(() => ({
  getForecastAction: vi.fn(),
}));

vi.mock("@/app/actions/forecast", () => ({
  getForecastAction: mocks.getForecastAction,
}));

import ForecastPage from "./page";

const sourceId = "018f47b7-6c3a-7abc-8def-1234567890ab";

function timeline(
  overrides: Partial<ForecastTimeline> = {},
): ForecastTimeline {
  return {
    contractVersion: "s07.v1",
    scenario: "CONSERVATIVE",
    from: "2026-09-01",
    to: "2026-09-30",
    openingBalanceCents: "100000",
    openingAdjustmentsCents: "0",
    openingProjectedBalanceCents: "100000",
    closingProjectedBalanceCents: "115000",
    minimumProjectedBalanceCents: "100000",
    minimumProjectedOn: "2026-09-01",
    totals: {
      inflowCents: "20000",
      outflowCents: "5000",
      netCents: "15000",
      realizedInflowCents: "10000",
      realizedOutflowCents: "0",
      projectedInflowCents: "10000",
      projectedOutflowCents: "5000",
    },
    periods: [
      {
        period: "2026-09",
        inflowCents: "20000",
        outflowCents: "5000",
        netCents: "15000",
        realizedInflowCents: "10000",
        realizedOutflowCents: "0",
        projectedInflowCents: "10000",
        projectedOutflowCents: "5000",
      },
    ],
    days: [
      {
        date: "2026-09-01",
        items: [
          {
            date: "2026-09-01",
            amountCents: "10000",
            direction: "INFLOW",
            status: "POSTED",
            certainty: "REALIZED",
            source: {
              kind: "REALIZED_EVENT",
              referenceId: sourceId,
              label: "Salário",
            },
            referenceId: sourceId,
            reconciliation: null,
          },
        ],
        inflowCents: "10000",
        outflowCents: "0",
        netCents: "10000",
        openingProjectedBalanceCents: "100000",
        closingProjectedBalanceCents: "110000",
      },
    ],
    minimumBalanceReferences: [sourceId],
    ...overrides,
  };
}

function success(value: ForecastTimeline): ForecastResult<ForecastTimeline> {
  return { ok: true, value };
}

describe("T09 future-flow route", () => {
  beforeEach(() => {
    mocks.getForecastAction.mockReset();
  });

  it("uses T06 output and preserves monthly navigation through a year turn", async () => {
    const value = timeline({
      scenario: "EXPECTED",
      from: "2026-12-01",
      to: "2026-12-31",
      periods: [
        {
          period: "2026-12",
          inflowCents: "20000",
          outflowCents: "5000",
          netCents: "15000",
          realizedInflowCents: "10000",
          realizedOutflowCents: "0",
          projectedInflowCents: "10000",
          projectedOutflowCents: "5000",
        },
      ],
    });
    mocks.getForecastAction.mockResolvedValue(success(value));

    const html = renderToStaticMarkup(
      await ForecastPage({
        searchParams: Promise.resolve({
          from: "2026-12-01",
          to: "2026-12-31",
          scenario: "EXPECTED",
        }),
      }),
    );

    expect(mocks.getForecastAction).toHaveBeenCalledWith({
      from: "2026-12-01",
      to: "2026-12-31",
      scenario: "EXPECTED",
    });
    expect(html).toContain(
      '/forecast?from=2027-01-01&amp;to=2027-01-31&amp;scenario=EXPECTED',
    );
    expect(html).toContain(
      '/forecast?from=2026-11-01&amp;to=2026-11-30&amp;scenario=EXPECTED',
    );
    expect(html).toContain("Entradas realizadas");
    expect(html).toContain("Entradas previstas");
    expect(html).toContain("dezembro de 2026");
  });

  it("keeps a month with no items explicit while retaining server balances", async () => {
    const value = timeline({
      from: "2027-02-01",
      to: "2027-02-28",
      openingBalanceCents: "12345",
      openingProjectedBalanceCents: "12345",
      closingProjectedBalanceCents: "12345",
      minimumProjectedBalanceCents: "12345",
      minimumProjectedOn: null,
      totals: {
        inflowCents: "0",
        outflowCents: "0",
        netCents: "0",
        realizedInflowCents: "0",
        realizedOutflowCents: "0",
        projectedInflowCents: "0",
        projectedOutflowCents: "0",
      },
      periods: [
        {
          period: "2027-02",
          inflowCents: "0",
          outflowCents: "0",
          netCents: "0",
          realizedInflowCents: "0",
          realizedOutflowCents: "0",
          projectedInflowCents: "0",
          projectedOutflowCents: "0",
        },
      ],
      days: [],
      minimumBalanceReferences: [],
    });
    mocks.getForecastAction.mockResolvedValue(success(value));

    const html = renderToStaticMarkup(
      await ForecastPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("Nenhum compromisso no período");
    expect(html).toContain("Saldo final projetado");
    expect(html).toContain("R$ 123,45");
    expect(html).toContain("fevereiro de 2027");
  });

  it("shows an allow-listed recovery state for an invalid URL", async () => {
    mocks.getForecastAction.mockResolvedValue({
      ok: false,
      error: { code: "INVALID_DATE", field: "from" },
    });

    const html = renderToStaticMarkup(
      await ForecastPage({
        searchParams: Promise.resolve({ from: "not-a-date" }),
      }),
    );

    expect(html).toContain("Informe datas válidas");
    expect(html).toContain("Período atual");
    expect(html).not.toContain("stack");
  });
});

export {};
