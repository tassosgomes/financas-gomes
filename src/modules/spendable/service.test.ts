import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FinancialContextError } from "@/modules/households/contracts";

import {
  getSpendable,
  normalizeGetSpendableInput,
  type SpendableServiceDependencies,
} from "./service";
import {
  negativeSpendableFixture,
  noEventsSpendableFixture,
  positiveSpendableFixture,
  yearBoundarySpendableFixture,
} from "./fixtures";

const contextA = {
  userId: "user-a",
  householdId: "household-a",
} as const;

function dependencies(
  fixture = positiveSpendableFixture,
  overrides: Partial<SpendableServiceDependencies> = {},
): SpendableServiceDependencies & {
  openingReader: ReturnType<typeof vi.fn>;
  bufferReader: ReturnType<typeof vi.fn>;
  forecastReader: ReturnType<typeof vi.fn>;
} {
  const openingReader = vi.fn().mockResolvedValue({
    householdId: contextA.householdId,
    asOf: fixture.asOf,
    openingBalanceCents: fixture.openingBalanceCents,
    generalAccountCount: 1,
  });
  const bufferReader = vi.fn().mockResolvedValue({
    householdId: contextA.householdId,
    amountCents: fixture.operationalBufferCents,
    source: fixture.operationalBufferSource,
    effectiveFrom: fixture.effectiveBufferFrom ?? "2026-08-01",
    revision: fixture.operationalBufferSource === "CONFIGURED" ? "buffer-revision" : null,
  });
  const forecastReader = vi.fn().mockResolvedValue({ ok: true, value: fixture.timeline });
  return {
    resolveContext: vi.fn().mockResolvedValue(contextA),
    readOpeningBalance: openingReader,
    readBuffer: bufferReader,
    readForecast: forecastReader,
    today: fixture.asOf,
    ...overrides,
    openingReader,
    bufferReader,
    forecastReader,
  };
}

describe("T06 availability service", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("resolves defaults on the server and consumes S07 once with the explicit window", async () => {
    const deps = dependencies(noEventsSpendableFixture);
    const result = await getSpendable(undefined, deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        contractVersion: "s08.v1",
        ruleVersion: "spendable.v1",
        period: {
          asOf: "2026-09-01",
          from: "2026-09-02",
          to: "2026-11-30",
          horizonDays: 90,
          scenario: "CONSERVATIVE",
          forecastContractVersion: "s07.v1",
        },
        openingBalanceCents: "800000",
        minimumProjectedBalanceCents: "800000",
        rawSpendableCents: "700000",
        displaySpendableCents: "700000",
      },
    });
    expect(deps.forecastReader).toHaveBeenCalledOnce();
    expect(deps.forecastReader).toHaveBeenCalledWith(
      { from: "2026-09-02", to: "2026-11-30", scenario: "CONSERVATIVE" },
      expect.objectContaining({ resolveContext: expect.any(Function) }),
    );
    const query = deps.forecastReader.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(query).not.toHaveProperty("householdId");
  });

  it("uses only the GENERAL opening supplied by the tenant-safe reader", async () => {
    const deps = dependencies(positiveSpendableFixture, {
      readOpeningBalance: vi.fn().mockResolvedValue({
        householdId: contextA.householdId,
        asOf: "2026-09-01",
        // A restricted/excluded balance is intentionally not present here.
        openingBalanceCents: "1200000",
        generalAccountCount: 2,
      }),
    });
    const result = await getSpendable(
      { asOf: "2026-09-01", scenario: "CONSERVATIVE", horizon: { days: 14 } },
      deps,
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        openingBalanceCents: "1200000",
        period: { scenario: "CONSERVATIVE", horizonDays: 14 },
      },
    });
  });

  it("selects an effective buffer and keeps the zero reserve handoff explicit", async () => {
    const deps = dependencies(yearBoundarySpendableFixture, {
      readBuffer: vi.fn().mockResolvedValue({
        householdId: contextA.householdId,
        amountCents: "50000",
        source: "CONFIGURED",
        effectiveFrom: "2026-12-30",
        revision: "buffer-v2",
      }),
    });
    const reserveAdapter = {
      contractVersion: "s09.v1" as const,
      getReserve: vi.fn().mockReturnValue({
        contractVersion: "s09.v1",
        status: "UNAVAILABLE",
        protectedAmount: { cents: BigInt(0) },
        appliedOpeningAdjustment: { cents: BigInt(0) },
        components: [],
        boxes: [],
      }),
    };
    const result = await getSpendable(
      { asOf: "2026-12-30", scenario: "CONSERVATIVE", horizon: { days: 3 } },
      { ...deps, reserveAdapter },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        operationalBuffer: {
          amountCents: "50000",
          source: "CONFIGURED",
          effectiveFrom: "2026-12-30",
          revision: "buffer-v2",
        },
        reserve: {
          contractVersion: "s09.v1",
          status: "UNAVAILABLE",
          protectedCents: "0",
          appliedOpeningAdjustmentCents: "0",
          components: [],
        },
      },
    });
    expect(reserveAdapter.getReserve).toHaveBeenCalledWith(
      expect.objectContaining({
        asOf: "2026-12-30",
        scenario: "CONSERVATIVE",
        horizon: { days: 3 },
      }),
    );
    expect(reserveAdapter.getReserve.mock.calls[0]?.[0]).not.toHaveProperty("householdId");
  });

  it("preserves a negative raw result while displaying zero and its deficit", async () => {
    const result = await getSpendable(
      { asOf: negativeSpendableFixture.asOf, horizon: { days: 1 } },
      dependencies(negativeSpendableFixture),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        rawSpendableCents: "-200000",
        displaySpendableCents: "0",
        deficitToPreserveReserveCents: "200000",
      },
    });
  });

  it("treats a foreign opening response as absent without disclosing its value", async () => {
    const deps = dependencies(positiveSpendableFixture, {
      readOpeningBalance: vi.fn().mockResolvedValue({
        householdId: "household-b",
        asOf: "2026-09-01",
        openingBalanceCents: "999999",
        generalAccountCount: 1,
      }),
    });
    const result = await getSpendable({ asOf: "2026-09-01" }, deps);

    expect(result).toEqual({
      ok: false,
      error: { code: "SPENDABLE_NOT_FOUND", field: null },
    });
    expect(JSON.stringify(result)).not.toContain("999999");
    expect(deps.forecastReader).not.toHaveBeenCalled();
  });

  it("does not allow the request to select a household or invalid horizon", async () => {
    const deps = dependencies();
    expect(() =>
      normalizeGetSpendableInput({ householdId: "household-b" }, deps),
    ).toThrow();
    const forged = await getSpendable({ householdId: "household-b" }, deps);
    const invalidHorizon = await getSpendable({ horizon: { days: 0 } }, deps);

    expect(forged).toEqual({
      ok: false,
      error: { code: "INVALID_SPENDABLE_INPUT", field: null },
    });
    expect(invalidHorizon).toEqual({
      ok: false,
      error: { code: "INVALID_HORIZON", field: "horizon" },
    });
    expect(deps.resolveContext).not.toHaveBeenCalled();
  });

  it("maps missing financial context to an opaque error", async () => {
    const deps = dependencies(positiveSpendableFixture, {
      resolveContext: vi.fn().mockRejectedValue(
        new FinancialContextError("HOUSEHOLD_MEMBERSHIP_REQUIRED"),
      ),
    });
    const result = await getSpendable({ asOf: "2026-09-01" }, deps);

    expect(result).toEqual({
      ok: false,
      error: { code: "FINANCIAL_CONTEXT_REQUIRED", field: null },
    });
    expect(JSON.stringify(result)).not.toContain("HOUSEHOLD_MEMBERSHIP_REQUIRED");
  });
});
