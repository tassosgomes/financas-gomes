import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ForecastTimeline } from "@/modules/forecast/contracts";
import {
  formatForecastImpact,
  formatForecastMoney,
  formatForecastPeriod,
  parseForecastTimeline,
  serializeForecastQuery,
  toForecastErrorViewModel,
} from "@/modules/forecast";

import {
  ForecastReadModel,
  ForecastSummary,
  ForecastTimelineView,
} from "./index";

const sourceId = "018f47b7-6c3a-7abc-8def-1234567890ab";

const timeline: ForecastTimeline = {
  contractVersion: "s07.v1",
  scenario: "CONSERVATIVE",
  from: "2026-09-01",
  to: "2026-09-30",
  openingBalanceCents: "100000",
  openingAdjustmentsCents: "-10000",
  openingProjectedBalanceCents: "90000",
  closingProjectedBalanceCents: "110000",
  minimumProjectedBalanceCents: "75000",
  minimumProjectedOn: "2026-09-10",
  totals: {
    inflowCents: "50000",
    outflowCents: "30000",
    netCents: "20000",
    realizedInflowCents: "20000",
    realizedOutflowCents: "10000",
    projectedInflowCents: "30000",
    projectedOutflowCents: "20000",
  },
  periods: [
    {
      period: "2026-09",
      inflowCents: "50000",
      outflowCents: "30000",
      netCents: "20000",
      realizedInflowCents: "20000",
      realizedOutflowCents: "10000",
      projectedInflowCents: "30000",
      projectedOutflowCents: "20000",
    },
  ],
  days: [
    {
      date: "2026-09-10",
      inflowCents: "20000",
      outflowCents: "5000",
      netCents: "15000",
      openingProjectedBalanceCents: "75000",
      closingProjectedBalanceCents: "90000",
      items: [
        {
          date: "2026-09-10",
          amountCents: "20000",
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
    },
  ],
  minimumBalanceReferences: [sourceId],
};

describe("T08 contracts and shared components", () => {
  it("keeps read model serializable and formats cents/date only at the UI edge", () => {
    expect(parseForecastTimeline(JSON.parse(JSON.stringify(timeline)))).toEqual(
      timeline,
    );
    expect(formatForecastMoney("1234567")).toBe("R$ 12.345,67");
    expect(formatForecastImpact("1234", "OUTFLOW")).toBe("-R$ 12,34");
    expect(formatForecastPeriod("2026-09")).toBe("setembro de 2026");
    expect(JSON.stringify(timeline)).not.toContain("householdId");
    expect(JSON.stringify(timeline)).not.toContain("bigint");
  });

  it("serializes only the public forecast query fields", () => {
    expect(
      serializeForecastQuery({
        from: "2026-09-01",
        to: "2026-09-30",
        scenario: "EXPECTED",
      }),
    ).toBe("from=2026-09-01&to=2026-09-30&scenario=EXPECTED");
    expect(
      serializeForecastQuery({
        from: "2026-09-01",
        householdId: "secret",
      } as never),
    ).toBe("");
  });

  it("distinguishes realized, projected, direction and source in text", () => {
    const html = renderToStaticMarkup(
      <ForecastReadModel
        getSourceHref={() => "/transactions/source-detail"}
        returnHref="/forecast?from=2026-09-01"
        showPeriodSelector
        periodSelector={{
          query: {
            from: "2026-09-01",
            to: "2026-09-30",
            scenario: "CONSERVATIVE",
          },
          previousHref: "/forecast?from=2026-08-01&to=2026-08-31",
          nextHref: "/forecast?from=2026-10-01&to=2026-10-31",
        }}
        timeline={timeline}
      />,
    );

    expect(html).toContain("Saldo inicial realizado");
    expect(html).toContain("Entradas realizadas");
    expect(html).toContain("Entradas previstas");
    expect(html).toContain("Certeza: Realizado");
    expect(html).toContain("Origem: Lançamento realizado");
    expect(html).toContain("Tipo: Entrada");
    expect(html).toContain("Ver origem do compromisso");
    expect(html).toContain("Aplicar período");
    expect(html).toContain('name="scenario"');
    expect(html).not.toContain("householdId");
  });

  it("exposes accessible loading, empty and allow-listed error states", () => {
    const loading = renderToStaticMarkup(
      <ForecastSummary state="loading" />,
    );
    const empty = renderToStaticMarkup(
      <ForecastTimelineView state="empty" />,
    );
    const error = renderToStaticMarkup(
      <ForecastTimelineView
        error={{ code: "FORECAST_QUERY_FAILED", field: null, message: "SELECT * FROM secret; stack" }}
        retryHref="/forecast"
        state="error"
      />,
    );

    expect(loading).toContain('role="status"');
    expect(empty).toContain("Nenhum compromisso no período");
    expect(error).toContain('role="alert"');
    expect(error).toContain("Tente novamente");
    expect(error).not.toContain("SELECT * FROM secret");
    expect(error).not.toContain("stack");
    expect(toForecastErrorViewModel({ code: "FORECAST_INCONSISTENT", field: null })).toMatchObject({
      message: expect.stringContaining("consistente"),
      retryable: false,
    });
  });
});

export {};
