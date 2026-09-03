import { describe, expect, it } from "vitest";

import {
  forecastErrorSchema,
  forecastItemSchema,
  forecastTimelineSchema,
  getForecastQuerySchema,
  isForecastItem,
  isForecastTimeline,
  parseForecastItem,
  parseForecastTimeline,
  parseGetForecastQuery,
  type ForecastItem,
  type ForecastTimeline,
} from "./contracts";

function item(overrides: Record<string, unknown> = {}): ForecastItem {
  return {
    date: "2026-09-01",
    amountCents: "100",
    direction: "OUTFLOW",
    status: "PLANNED",
    certainty: "COMMITTED",
    source: {
      kind: "INSTALLMENT",
      referenceId: "installment-1",
      label: "Parcela de cartão",
      billingCycle: "2026-09",
      installmentSequence: 1,
    },
    referenceId: "installment-1",
    reconciliation: null,
    ...overrides,
  } as ForecastItem;
}

function timeline(overrides: Record<string, unknown> = {}): ForecastTimeline {
  return {
    contractVersion: "s07.v1",
    scenario: "EXPECTED",
    from: "2026-09-01",
    to: "2026-09-30",
    openingBalanceCents: "1000",
    openingAdjustmentsCents: "0",
    openingProjectedBalanceCents: "1000",
    closingProjectedBalanceCents: "1000",
    minimumProjectedBalanceCents: "1000",
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
        period: "2026-09",
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
    ...overrides,
  } as ForecastTimeline;
}

describe("T11 serializable forecast boundary", () => {
  it("accepts only the public query fields and rejects tenant/query authority", () => {
    const query = {
      from: "2026-09-01",
      to: "2026-09-30",
      scenario: "EXPECTED" as const,
    };

    expect(parseGetForecastQuery(query)).toEqual(query);
    expect(getForecastQuerySchema.safeParse(query).success).toBe(true);

    for (const forbidden of [
      "householdId",
      "userId",
      "authorization",
      "referenceId",
      "status",
      "accountId",
      "table",
    ]) {
      expect(
        getForecastQuerySchema.safeParse({ ...query, [forbidden]: "forged" })
          .success,
      ).toBe(false);
    }
  });

  it("rejects invalid civil dates, ranges and scenarios before a read can widen", () => {
    expect(
      getForecastQuerySchema.safeParse({ from: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      getForecastQuerySchema.safeParse({ to: "2026-13-01" }).success,
    ).toBe(false);
    expect(
      getForecastQuerySchema.safeParse({ scenario: "OTHER" }).success,
    ).toBe(false);

    // The query schema validates each date; the service/builder owns the
    // cross-field from <= to check. The public timeline contract closes that
    // second half at its own boundary (covered below).
    expect(() => parseGetForecastQuery({ from: "2026-02-30" })).toThrow();
  });

  it("enforces opaque, navigable item references and integer money", () => {
    const valid = item();
    expect(parseForecastItem(valid)).toEqual(valid);
    expect(isForecastItem(valid)).toBe(true);

    for (const amountCents of ["0", "-1", "1.5", "1e2", BigInt(100)]) {
      expect(forecastItemSchema.safeParse({ ...valid, amountCents }).success).toBe(
        false,
      );
    }

    expect(
      forecastItemSchema.safeParse({
        ...valid,
        referenceId: "different-reference",
      }).success,
    ).toBe(false);
    expect(
      forecastItemSchema.safeParse({ ...valid, status: "CANCELLED" }).success,
    ).toBe(false);
    expect(
      forecastItemSchema.safeParse({ ...valid, date: new Date("2026-09-01") })
        .success,
    ).toBe(false);
    expect(
      forecastItemSchema.safeParse({ ...valid, householdId: "forged" }).success,
    ).toBe(false);
    expect(
      forecastItemSchema.safeParse({ ...valid, source: { ...valid.source, raw: "secret" } })
        .success,
    ).toBe(false);
  });

  it("round-trips a JSON timeline and fails closed on range, version and raw-money violations", () => {
    const valid = timeline();
    const serialized = JSON.parse(JSON.stringify(valid)) as unknown;
    expect(parseForecastTimeline(serialized)).toEqual(valid);
    expect(isForecastTimeline(serialized)).toBe(true);

    expect(
      forecastTimelineSchema.safeParse({
        ...valid,
        from: "2026-10-01",
        to: "2026-09-30",
      }).success,
    ).toBe(false);
    expect(
      forecastTimelineSchema.safeParse({ ...valid, contractVersion: "s07.v2" })
        .success,
    ).toBe(false);
    expect(
      forecastTimelineSchema.safeParse({ ...valid, openingBalanceCents: BigInt(1000) })
        .success,
    ).toBe(false);
    expect(
      forecastTimelineSchema.safeParse({ ...valid, householdId: "forged" }).success,
    ).toBe(false);
  });

  it("keeps error envelopes opaquely code/field-only", () => {
    const error = { code: "FORECAST_NOT_FOUND" as const, field: null };
    expect(forecastErrorSchema.parse(error)).toEqual(error);
    expect(
      forecastErrorSchema.safeParse({
        ...error,
        message: "household details",
        referenceId: "secret",
      }).success,
    ).toBe(false);
  });
});
