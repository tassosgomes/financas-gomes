import { describe, expect, it, vi } from "vitest";

import { FinancialContextError } from "@/modules/households/contracts";

import { buildForecastTimelineFromSources } from "./builder";
import {
  DEFAULT_FORECAST_MAX_RANGE_MONTHS,
  getForecast,
  getForecastLimits,
} from "./service";
import type { ForecastSourceBundle } from "./sources";

const context = {
  userId: "user-a",
  householdId: "household-a",
} as const;

function bundle(
  overrides: Partial<ForecastSourceBundle> = {},
): ForecastSourceBundle {
  return {
    householdId: context.householdId,
    range: { from: "2026-09-01", to: "2026-09-30" },
    openingBalance: {
      householdId: context.householdId,
      asOf: "2026-08-31",
      openingBalanceCents: "1000",
    },
    realizedEvents: [],
    recurringRules: [],
    recurringOccurrences: [],
    holidays: [],
    plannedEvents: [
      {
        id: "planned-rent",
        householdId: context.householdId,
        kind: "EXPENSE",
        status: "PLANNED",
        amountCents: BigInt(300),
        expectedOn: "2026-09-10",
        description: "synthetic rent",
        financialEventId: null,
      },
    ],
    installments: [],
    ...overrides,
  } as ForecastSourceBundle;
}

function dependencies(
  sourceBundle: ForecastSourceBundle = bundle(),
) {
  const reader = vi.fn().mockResolvedValue(sourceBundle);
  return {
    resolveContext: vi.fn().mockResolvedValue(context),
    readSources: reader,
    buildTimeline: buildForecastTimelineFromSources,
    today: "2026-09-15",
    reader,
  };
}

describe("T06 forecast service boundary", () => {
  it("returns a serializable timeline and keeps household data internal", async () => {
    const deps = dependencies();
    const result = await getForecast(
      { from: "2026-09-01", to: "2026-09-30", scenario: "EXPECTED" },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      contractVersion: "s07.v1",
      scenario: "EXPECTED",
      from: "2026-09-01",
      to: "2026-09-30",
      totals: { outflowCents: "300" },
    });
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(result.value);
    expect("householdId" in result.value).toBe(false);
    expect(deps.reader).toHaveBeenCalledWith(
      context,
      { from: "2026-09-01", to: "2026-09-30" },
      expect.objectContaining({ observability: expect.any(Object) }),
    );
  });

  it("uses the server clock for the default civil month, including a year boundary", async () => {
    const deps = dependencies(
      bundle({
        range: { from: "2027-01-01", to: "2027-01-31" },
        plannedEvents: [],
      }),
    );
    const result = await getForecast({}, { ...deps, today: "2026-12-20" });

    expect(result).toMatchObject({
      ok: true,
      value: {
        from: "2026-12-01",
        to: "2026-12-31",
      },
    });
    expect(deps.reader).toHaveBeenCalledWith(
      context,
      { from: "2026-12-01", to: "2026-12-31" },
      expect.any(Object),
    );
  });

  it("rejects invalid/forged query fields before resolving context or reading", async () => {
    const deps = dependencies();
    const invalid = await getForecast(
      {
        from: "2026-09-01",
        to: "2026-09-30",
        householdId: context.householdId,
      },
      deps,
    );
    const malformed = await getForecast(
      { from: "2026-02-30" },
      deps,
    );

    expect(invalid).toEqual({
      ok: false,
      error: { code: "FORECAST_QUERY_FAILED", field: null },
    });
    expect(malformed).toEqual({
      ok: false,
      error: { code: "INVALID_DATE", field: "from" },
    });
    expect(deps.resolveContext).not.toHaveBeenCalled();
    expect(deps.reader).not.toHaveBeenCalled();
  });

  it("rejects inverted and over-large ranges without truncating or reading", async () => {
    const deps = dependencies();
    const inverted = await getForecast(
      { from: "2026-10-01", to: "2026-09-01" },
      deps,
    );
    const limited = await getForecast(
      { from: "2026-01-01", to: "2026-03-31" },
      { ...deps, maxRangeMonths: 2 },
    );

    expect(inverted).toEqual({
      ok: false,
      error: { code: "INVALID_DATE_RANGE", field: "from" },
    });
    expect(limited).toEqual({
      ok: false,
      error: { code: "FORECAST_RANGE_TOO_LARGE", field: null },
    });
    expect(deps.resolveContext).not.toHaveBeenCalled();
    expect(deps.reader).not.toHaveBeenCalled();
  });

  it("maps authentication failures to the opaque financial-context error", async () => {
    const deps = dependencies();
    deps.resolveContext.mockRejectedValue(
      new FinancialContextError("HOUSEHOLD_MEMBERSHIP_REQUIRED"),
    );
    const result = await getForecast(
      { from: "2026-09-01", to: "2026-09-30" },
      deps,
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "FINANCIAL_CONTEXT_REQUIRED", field: null },
    });
    expect(JSON.stringify(result)).not.toContain("HOUSEHOLD");
  });

  it("treats a foreign reader bundle as absent and never serializes its balance", async () => {
    const deps = dependencies(
      bundle({
        householdId: "household-b",
        openingBalance: {
          householdId: "household-b",
          asOf: "2026-08-31",
          openingBalanceCents: "999999",
        },
      }),
    );
    const result = await getForecast(
      { from: "2026-09-01", to: "2026-09-30" },
      deps,
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "FORECAST_NOT_FOUND", field: null },
    });
    expect(JSON.stringify(result)).not.toContain("999999");
  });

  it("keeps the operational limits bounded and supports a horizon beyond one year", () => {
    const limits = getForecastLimits({
      maxRangeMonths: Number.MAX_SAFE_INTEGER,
      maxRangeDays: Number.MAX_SAFE_INTEGER,
    });
    expect(limits.maxRangeMonths).toBeLessThanOrEqual(1_200);
    expect(limits.maxRangeDays).toBeLessThanOrEqual(36_600);
    expect(DEFAULT_FORECAST_MAX_RANGE_MONTHS).toBeGreaterThan(12);
  });
});
