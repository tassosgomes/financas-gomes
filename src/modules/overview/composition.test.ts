import { describe, expect, it, vi } from "vitest";

import type { ListBudgetsReadModel } from "@/modules/budgets/read-contracts";
import type { ForecastTimeline } from "@/modules/forecast/contracts";
import type { SpendableBreakdown } from "@/modules/spendable/contracts";

import { composeOverviewOrigins } from "./composition";
import type { OriginResult, OverviewOriginPorts } from "./ports";

const AS_OF = "2026-09-15";

const fakeSpendableBreakdown = {
  contractVersion: "s08.v1",
  ruleVersion: "spendable.v1",
  period: {
    asOf: AS_OF,
    from: "2026-09-16",
    to: "2026-12-14",
    horizonDays: 90,
    scenario: "CONSERVATIVE",
    forecastContractVersion: "s07.v1",
  },
  openingBalanceCents: "500000",
  openingAdjustmentsCents: "0",
  openingProjectedBalanceCents: "500000",
  closingProjectedBalanceCents: "450000",
  minimumProjectedBalanceCents: "420000",
  minimum: {
    projectedBalanceCents: "420000",
    points: [],
  },
  operationalBuffer: {
    amountCents: "0",
    source: "ABSENT_DEFAULT_ZERO",
    effectiveFrom: null,
    revision: null,
  },
  reserve: {
    contractVersion: "s09.v1",
    status: "UNAVAILABLE",
    protectedCents: "0",
    appliedOpeningAdjustmentCents: "0",
    components: [],
  },
  rawSpendableCents: "420000",
  displaySpendableCents: "420000",
  deficitToPreserveReserveCents: "0",
} as SpendableBreakdown;

const fakeForecastTimeline = {
  contractVersion: "s07.v1",
  scenario: "CONSERVATIVE",
  from: "2026-09-16",
  to: "2026-12-14",
  openingBalanceCents: "500000",
  openingAdjustmentsCents: "0",
  openingProjectedBalanceCents: "500000",
  closingProjectedBalanceCents: "450000",
  minimumProjectedBalanceCents: "420000",
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
  periods: [],
  days: [],
  minimumBalanceReferences: [],
} as ForecastTimeline;

const emptyBudgets: ListBudgetsReadModel = {
  items: [],
  pageInfo: {
    hasNextPage: false,
    nextCursor: null,
  },
};

function createFakePorts(
  overrides: Partial<OverviewOriginPorts> = {},
): OverviewOriginPorts {
  return {
    readSpendable:
      overrides.readSpendable ??
      (vi.fn(async () => ({ ok: true, value: fakeSpendableBreakdown })) as OverviewOriginPorts["readSpendable"]),
    readForecast:
      overrides.readForecast ??
      (vi.fn(async () => ({ ok: true, value: fakeForecastTimeline })) as OverviewOriginPorts["readForecast"]),
    readBudgets:
      overrides.readBudgets ??
      (vi.fn(async () => ({ ok: true, value: emptyBudgets })) as OverviewOriginPorts["readBudgets"]),
    readCardInvoices:
      overrides.readCardInvoices ??
      (vi.fn(async () => ({ ok: true, value: [] })) as OverviewOriginPorts["readCardInvoices"]),
  };
}

describe("composeOverviewOrigins", () => {
  it("returns spendable byte-for-byte from the origin without reformulation", async () => {
    const readSpendable = vi.fn(
      async (): Promise<OriginResult<SpendableBreakdown>> => ({
        ok: true,
        value: fakeSpendableBreakdown,
      }),
    );
    const ports = createFakePorts({ readSpendable });

    const result = await composeOverviewOrigins({ asOf: AS_OF }, ports);

    expect(result.spendable.ok).toBe(true);
    if (result.spendable.ok) {
      expect(result.spendable.value).toBe(fakeSpendableBreakdown);
      expect(result.spendable.value.displaySpendableCents).toBe("420000");
      expect(result.spendable.value.rawSpendableCents).toBe("420000");
    }
    expect(result.period).toEqual({
      key: "2026-09",
      from: "2026-09-01",
      to: "2026-09-30",
      asOf: AS_OF,
    });
    expect(result.scenario).toBe("CONSERVATIVE");
    expect(result.horizonDays).toBe(90);
  });

  it("keeps spendable ready when forecast fails without inventing zero cents", async () => {
    const ports = createFakePorts({
      readForecast: vi.fn(async () => ({
        ok: false,
        error: { code: "FORECAST_QUERY_FAILED", field: null },
      })) as OverviewOriginPorts["readForecast"],
    });

    const result = await composeOverviewOrigins({ asOf: AS_OF }, ports);

    expect(result.forecast).toEqual({
      ok: false,
      error: { code: "FORECAST_QUERY_FAILED", field: null },
    });
    expect(result.spendable.ok).toBe(true);
    if (result.spendable.ok) {
      expect(result.spendable.value.rawSpendableCents).toBe("420000");
      expect(result.spendable.value.displaySpendableCents).toBe("420000");
    }
  });

  it("returns errors for every origin when all reads fail", async () => {
    const ports = createFakePorts({
      readSpendable: vi.fn(async () => ({
        ok: false,
        error: { code: "SPENDABLE_QUERY_FAILED", field: null },
      })) as OverviewOriginPorts["readSpendable"],
      readForecast: vi.fn(async () => ({
        ok: false,
        error: { code: "FORECAST_QUERY_FAILED", field: null },
      })) as OverviewOriginPorts["readForecast"],
      readBudgets: vi.fn(async () => ({
        ok: false,
        error: { code: "QUERY_FAILED", field: null },
      })) as OverviewOriginPorts["readBudgets"],
      readCardInvoices: vi.fn(async () => ({
        ok: false,
        error: { code: "OVERVIEW_ORIGIN_UNAVAILABLE", field: null },
      })) as OverviewOriginPorts["readCardInvoices"],
    });

    const result = await composeOverviewOrigins({ asOf: AS_OF }, ports);

    expect(result.spendable.ok).toBe(false);
    expect(result.forecast.ok).toBe(false);
    expect(result.budgets.ok).toBe(false);
    expect(result.cardInvoices.ok).toBe(false);
    if (!result.spendable.ok) {
      expect(result.spendable.error.code).toBe("SPENDABLE_QUERY_FAILED");
    }
  });

  it("marks a hanging origin as unavailable while other origins succeed", async () => {
    const ports = createFakePorts({
      readForecast: vi.fn(
        () =>
          new Promise<OriginResult<ForecastTimeline>>(() => {
            // Intentionally never resolves.
          }),
      ) as OverviewOriginPorts["readForecast"],
    });

    const result = await composeOverviewOrigins(
      { asOf: AS_OF },
      ports,
      { timeoutMs: 25 },
    );

    expect(result.forecast).toEqual({
      ok: false,
      error: { code: "OVERVIEW_ORIGIN_UNAVAILABLE", field: null },
    });
    expect(result.spendable.ok).toBe(true);
    expect(result.budgets.ok).toBe(true);
    expect(result.cardInvoices.ok).toBe(true);
  });

  it("calls each origin port exactly once", async () => {
    const ports = createFakePorts();

    await composeOverviewOrigins({ asOf: AS_OF }, ports);

    expect(ports.readSpendable).toHaveBeenCalledTimes(1);
    expect(ports.readForecast).toHaveBeenCalledTimes(1);
    expect(ports.readBudgets).toHaveBeenCalledTimes(1);
    expect(ports.readCardInvoices).toHaveBeenCalledTimes(1);
  });

  it("treats an empty budgets list as success", async () => {
    const ports = createFakePorts({
      readBudgets: vi.fn(async () => ({ ok: true, value: emptyBudgets })) as OverviewOriginPorts["readBudgets"],
    });

    const result = await composeOverviewOrigins({ asOf: AS_OF }, ports);

    expect(result.budgets).toEqual({ ok: true, value: emptyBudgets });
  });

  it("never forwards householdId from browser input into origin reads", async () => {
    const readSpendable = vi.fn<OverviewOriginPorts["readSpendable"]>(async () => ({
      ok: true,
      value: fakeSpendableBreakdown,
    }));
    const readForecast = vi.fn<OverviewOriginPorts["readForecast"]>(async () => ({
      ok: true,
      value: fakeForecastTimeline,
    }));
    const readBudgets = vi.fn<OverviewOriginPorts["readBudgets"]>(async () => ({
      ok: true,
      value: emptyBudgets,
    }));
    const readCardInvoices = vi.fn<OverviewOriginPorts["readCardInvoices"]>(async () => ({
      ok: true,
      value: [],
    }));
    const ports = createFakePorts({
      readSpendable,
      readForecast,
      readBudgets,
      readCardInvoices,
    });

    await composeOverviewOrigins(
      {
        asOf: AS_OF,
        scenario: "EXPECTED",
        horizon: { days: 30 },
        // Simulated hostile browser payload — must not reach ports.
        householdId: "browser-household",
      } as ComposeOverviewInputWithHousehold,
      ports,
    );

    for (const call of [
      readSpendable.mock.calls[0]![0],
      readForecast.mock.calls[0]![0],
      readBudgets.mock.calls[0]![0],
      readCardInvoices.mock.calls[0]![0],
    ]) {
      expect(call).toBeDefined();
      expect(call).not.toHaveProperty("householdId");
      expect(call).not.toHaveProperty("userId");
    }

    expect(readSpendable).toHaveBeenCalledWith({
      asOf: AS_OF,
      scenario: "EXPECTED",
      horizonDays: 30,
    });
    expect(readForecast).toHaveBeenCalledWith({
      from: "2026-09-16",
      to: "2026-10-15",
      scenario: "EXPECTED",
    });
    expect(readBudgets).toHaveBeenCalledWith({ asOf: AS_OF });
    expect(readCardInvoices).toHaveBeenCalledWith({ asOf: AS_OF });
  });
});

interface ComposeOverviewInputWithHousehold {
  readonly asOf?: string;
  readonly scenario?: "CONSERVATIVE" | "EXPECTED";
  readonly horizon?: { readonly days: number };
  readonly householdId?: string;
}
