import { describe, expect, it, vi } from "vitest";

import type { ListBudgetsReadModel } from "@/modules/budgets/read-contracts";
import type { ForecastItem, ForecastTimeline } from "@/modules/forecast/contracts";
import type { FinancialContext } from "@/modules/households/contracts";
import type { SpendableBreakdown } from "@/modules/spendable/contracts";

import type { PeriodAggregationResult } from "./aggregate";
import { getOverviewForContext } from "./service";
import type { OriginResult, OverviewOriginPorts } from "./ports";
import { OverviewQueryError } from "./query";
import type { OverviewBlockEnvelope, OverviewReadModel } from "./contracts";

const AS_OF = "2026-09-15";
const CONTEXT_A: FinancialContext = {
  userId: "00000000-0000-7000-8000-000000101901",
  householdId: "00000000-0000-7000-8000-000000101001",
};
const CONTEXT_B: FinancialContext = {
  userId: "00000000-0000-7000-8000-000000101902",
  householdId: "00000000-0000-7000-8000-000000101002",
};

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

const zeroSpendableBreakdown = {
  ...fakeSpendableBreakdown,
  rawSpendableCents: "0",
  displaySpendableCents: "0",
} as SpendableBreakdown;

function forecastItem(
  overrides: Partial<ForecastItem> & Pick<ForecastItem, "referenceId" | "date" | "direction">,
): ForecastItem {
  const source = overrides.source ?? {
    kind: "PLANNED_EVENT",
    referenceId: overrides.referenceId,
    label: "Compromisso",
  };

  return {
    amountCents: "10000",
    status: "PLANNED",
    certainty: "COMMITTED",
    reconciliation: null,
    ...overrides,
    source,
  };
}

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
  periods: [
    {
      period: "2026-09",
      inflowCents: "200000",
      outflowCents: "150000",
      netCents: "50000",
      realizedInflowCents: "100000",
      realizedOutflowCents: "80000",
      projectedInflowCents: "100000",
      projectedOutflowCents: "70000",
    },
  ],
  days: [
    {
      date: "2026-09-10",
      items: [
        forecastItem({
          referenceId: "past-outflow",
          date: "2026-09-10",
          direction: "OUTFLOW",
        }),
      ],
      inflowCents: "0",
      outflowCents: "10000",
      netCents: "-10000",
      openingProjectedBalanceCents: "500000",
      closingProjectedBalanceCents: "490000",
    },
    {
      date: "2026-09-20",
      items: [
        forecastItem({
          referenceId: "b-commitment",
          date: "2026-09-20",
          direction: "OUTFLOW",
          source: {
            kind: "INSTALLMENT",
            referenceId: "b-commitment",
            label: "Parcela B",
          },
        }),
        forecastItem({
          referenceId: "a-income",
          date: "2026-09-20",
          direction: "INFLOW",
          source: {
            kind: "RECURRING",
            referenceId: "a-income",
            label: "Salário",
          },
        }),
      ],
      inflowCents: "50000",
      outflowCents: "10000",
      netCents: "40000",
      openingProjectedBalanceCents: "490000",
      closingProjectedBalanceCents: "530000",
    },
  ],
  minimumBalanceReferences: [],
} as ForecastTimeline;

const emptyBudgets: ListBudgetsReadModel = {
  items: [],
  pageInfo: {
    hasNextPage: false,
    nextCursor: null,
  },
};

const emptyAggregation: PeriodAggregationResult = {
  summary: {
    incomeCents: "0",
    expenseCents: "0",
    netCents: "0",
    expenseEventCount: 0,
    purchaseEventCount: 0,
    reconciliation: {
      from: "2026-09-01",
      to: "2026-09-30",
      expenseFilter: "/transactions?from=2026-09-01&to=2026-09-30&status=POSTED&kind=EXPENSE",
      incomeFilter: "/transactions?from=2026-09-01&to=2026-09-30&status=POSTED&kind=INCOME",
    },
  },
  groups: [],
  totalExpenseCents: "0",
};

const populatedAggregation: PeriodAggregationResult = {
  summary: {
    incomeCents: "300000",
    expenseCents: "120000",
    netCents: "180000",
    expenseEventCount: 2,
    purchaseEventCount: 1,
    reconciliation: {
      from: "2026-09-01",
      to: "2026-09-30",
      expenseFilter: "/transactions?from=2026-09-01&to=2026-09-30&status=POSTED&kind=EXPENSE",
      incomeFilter: "/transactions?from=2026-09-01&to=2026-09-30&status=POSTED&kind=INCOME",
    },
  },
  groups: [
    {
      key: "food",
      label: "Alimentação",
      categoryId: "food",
      amountCents: "120000",
      percent: 100,
      expenseEventCount: 2,
      purchaseEventCount: 1,
    },
  ],
  totalExpenseCents: "120000",
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

function createAggregationReader(
  result: PeriodAggregationResult,
  householdId: string,
) {
  return vi.fn(async (_context: FinancialContext) => {
    expect(_context.householdId).toBe(householdId);
    return result;
  });
}

function monetaryFieldsFromBlock(block: OverviewBlockEnvelope<unknown>): string[] {
  if (block.state !== "ready" || block.data === undefined) {
    return [];
  }

  const serialized = JSON.stringify(block.data);
  const matches = serialized.match(/"[^"]*Cents":\s*"-?\d+"/gu) ?? [];
  return matches;
}

function assertErrorBlocksNeverExposeMonetaryZero(model: OverviewReadModel): void {
  const blocks: Array<[string, OverviewBlockEnvelope<unknown>]> = [
    ["spendable", model.spendable],
    ["periodSummary", model.periodSummary],
    ["expensesByCategory", model.expensesByCategory],
    ["upcomingCommitments", model.upcomingCommitments],
    ["upcomingIncome", model.upcomingIncome],
    ["caixinhasSummary", model.caixinhasSummary],
    ["cardInvoices", model.cardInvoices],
  ];

  for (const [name, block] of blocks) {
    if (block.state === "error") {
      expect(block.data, `${name} error block must not carry monetary data`).toBeUndefined();
      expect(monetaryFieldsFromBlock(block), `${name} error block leaked cents`).toEqual([]);
    }
  }
}

describe("getOverviewForContext", () => {
  it("returns empty blocks for an empty household without invented critical numbers", async () => {
    const ports = createFakePorts({
      readSpendable: vi.fn(async () => ({
        ok: false,
        error: { code: "SPENDABLE_NOT_FOUND", field: null },
      })) as OverviewOriginPorts["readSpendable"],
    });
    const readAggregation = vi.fn(async () => emptyAggregation);

    const result = await getOverviewForContext(
      CONTEXT_A,
      { asOf: AS_OF },
      {
        ports,
        readAggregation,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.spendable.state).toBe("empty");
    expect(result.value.periodSummary.state).toBe("empty");
    expect(result.value.expensesByCategory.state).toBe("empty");
    expect(result.value.upcomingCommitments.state).toBe("ready");
    expect(result.value.spendable.data).toBeUndefined();
    expect(result.value.periodSummary.data).toBeUndefined();
  });

  it("keeps spendable and categories ready when forecast fails", async () => {
    const ports = createFakePorts({
      readForecast: vi.fn(async () => ({
        ok: false,
        error: { code: "FORECAST_QUERY_FAILED", field: null },
      })) as OverviewOriginPorts["readForecast"],
    });
    const readAggregation = vi.fn(async () => populatedAggregation);

    const result = await getOverviewForContext(
      CONTEXT_A,
      { asOf: AS_OF },
      { ports, readAggregation },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.spendable.state).toBe("ready");
    expect(result.value.expensesByCategory.state).toBe("ready");
    expect(result.value.upcomingCommitments.state).toBe("error");
    expect(result.value.upcomingIncome.state).toBe("error");
    expect(result.value.upcomingCommitments.error?.code).toBe("FORECAST_QUERY_FAILED");
    expect(result.value.upcomingCommitments.data).toBeUndefined();
    expect(result.value.periodSummary.state).toBe("ready");
    expect(result.value.periodSummary.data?.planned).toBeUndefined();
    expect(result.value.periodSummary.data?.referenceBalanceCents).toBe("500000");
  });

  it("returns spendable breakdown byte-for-byte from the origin", async () => {
    const readSpendable = vi.fn(
      async (): Promise<OriginResult<SpendableBreakdown>> => ({
        ok: true,
        value: fakeSpendableBreakdown,
      }),
    );
    const ports = createFakePorts({ readSpendable });
    const readAggregation = vi.fn(async () => emptyAggregation);

    const result = await getOverviewForContext(
      CONTEXT_A,
      { asOf: AS_OF },
      { ports, readAggregation },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.spendable.state).toBe("ready");
    if (result.value.spendable.state === "ready") {
      expect(result.value.spendable.data?.breakdown).toBe(fakeSpendableBreakdown);
    }
  });

  it("treats legitimate zero spendable as ready", async () => {
    const ports = createFakePorts({
      readSpendable: vi.fn(async () => ({
        ok: true,
        value: zeroSpendableBreakdown,
      })) as OverviewOriginPorts["readSpendable"],
      readForecast: vi.fn(async () => ({
        ok: true,
        value: { ...fakeForecastTimeline, days: [] },
      })) as OverviewOriginPorts["readForecast"],
    });

    const result = await getOverviewForContext(
      CONTEXT_A,
      { asOf: AS_OF },
      {
        ports,
        readAggregation: vi.fn(async () => emptyAggregation),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.spendable.state).toBe("ready");
    expect(result.value.spendable.data?.breakdown.displaySpendableCents).toBe("0");
  });

  it("reconciles category groups with the expense total", async () => {
    const readAggregation = vi.fn(async () => populatedAggregation);
    const result = await getOverviewForContext(
      CONTEXT_A,
      { asOf: AS_OF },
      {
        ports: createFakePorts({
          readForecast: vi.fn(async () => ({
            ok: true,
            value: { ...fakeForecastTimeline, days: [] },
          })) as OverviewOriginPorts["readForecast"],
        }),
        readAggregation,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.expensesByCategory.state).toBe("ready");
    const data = result.value.expensesByCategory.data;
    expect(data?.totalExpenseCents).toBe("120000");
    const groupSum = (data?.groups ?? []).reduce(
      (sum, group) => sum + BigInt(group.amountCents),
      BigInt(0),
    );
    expect(groupSum.toString()).toBe(data?.totalExpenseCents);
  });

  it("never maps origin failures to monetary zero in ready blocks", async () => {
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
    const readAggregation = vi.fn(async () => {
      throw new OverviewQueryError();
    });

    const result = await getOverviewForContext(
      CONTEXT_A,
      { asOf: AS_OF },
      { ports, readAggregation },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.spendable.state).toBe("error");
    expect(result.value.periodSummary.state).toBe("error");
    expect(result.value.expensesByCategory.state).toBe("error");
    expect(result.value.upcomingCommitments.state).toBe("error");
    expect(result.value.upcomingIncome.state).toBe("error");
    expect(result.value.caixinhasSummary.state).toBe("error");
    expect(result.value.cardInvoices.state).toBe("error");
    assertErrorBlocksNeverExposeMonetaryZero(result.value);
  });

  it("does not leak neighbor household data through fakes", async () => {
    const readSpendable = vi.fn(async () => ({
      ok: true,
      value: fakeSpendableBreakdown,
    })) as OverviewOriginPorts["readSpendable"];
    const readForecast = vi.fn(async () => ({
      ok: true,
      value: fakeForecastTimeline,
    })) as OverviewOriginPorts["readForecast"];
    const ports = createFakePorts({ readSpendable, readForecast });
    const readAggregationB = createAggregationReader(emptyAggregation, CONTEXT_B.householdId);

    const result = await getOverviewForContext(
      CONTEXT_B,
      { asOf: AS_OF },
      { ports, readAggregation: readAggregationB },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain(CONTEXT_A.householdId);
    expect(result.value.upcomingCommitments.state).toBe("ready");
    if (result.value.upcomingCommitments.state === "ready") {
      expect(
        result.value.upcomingCommitments.data?.items.some(
          (item) => item.referenceId === "b-commitment",
        ),
      ).toBe(true);
      expect(
        result.value.upcomingCommitments.data?.items.some(
          (item) => item.referenceId === "past-outflow",
        ),
      ).toBe(false);
    }
  });

  it("calls each origin port and aggregation exactly once", async () => {
    const ports = createFakePorts();
    const readAggregation = vi.fn(async () => emptyAggregation);

    await getOverviewForContext(
      CONTEXT_A,
      { asOf: AS_OF },
      { ports, readAggregation },
    );

    expect(ports.readSpendable).toHaveBeenCalledTimes(1);
    expect(ports.readForecast).toHaveBeenCalledTimes(1);
    expect(ports.readBudgets).toHaveBeenCalledTimes(1);
    expect(ports.readCardInvoices).toHaveBeenCalledTimes(1);
    expect(readAggregation).toHaveBeenCalledTimes(1);
  });

  it("attaches planned totals from forecast and reconciliation filters on period summary", async () => {
    const result = await getOverviewForContext(
      CONTEXT_A,
      { asOf: AS_OF },
      {
        ports: createFakePorts({
          readForecast: vi.fn(async () => ({
            ok: true,
            value: fakeForecastTimeline,
          })) as OverviewOriginPorts["readForecast"],
        }),
        readAggregation: vi.fn(async () => populatedAggregation),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = result.value.periodSummary.data;
    expect(summary?.planned?.inflowCents).toBe("200000");
    expect(summary?.reconciliation.expenseFilter).toContain("kind=EXPENSE");
    expect(summary?.reconciliation.incomeFilter).toContain("kind=INCOME");
    expect(summary?.reconciliation.from).toBe("2026-09-01");
    expect(summary?.reconciliation.to).toBe("2026-09-30");
  });

  it("limits upcoming commitments to five items sorted by date then referenceId", async () => {
    const manyItems = Array.from({ length: 7 }, (_, index) =>
      forecastItem({
        referenceId: `ref-${index}`,
        date: `2026-09-${String(17 + index).padStart(2, "0")}`,
        direction: "OUTFLOW",
      }),
    );
    const timeline = {
      ...fakeForecastTimeline,
      days: [
        {
          date: "2026-09-17",
          items: manyItems,
          inflowCents: "0",
          outflowCents: "70000",
          netCents: "-70000",
          openingProjectedBalanceCents: "500000",
          closingProjectedBalanceCents: "430000",
        },
      ],
    } as ForecastTimeline;

    const result = await getOverviewForContext(
      CONTEXT_A,
      { asOf: AS_OF },
      {
        ports: createFakePorts({
          readForecast: vi.fn(async () => ({
            ok: true,
            value: timeline,
          })) as OverviewOriginPorts["readForecast"],
        }),
        readAggregation: vi.fn(async () => emptyAggregation),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const block = result.value.upcomingCommitments;
    expect(block.state).toBe("ready");
    expect(block.data?.items).toHaveLength(5);
    expect(block.data?.totalMatching).toBe(7);
    expect(block.data?.viewAllHref).toContain("/forecast?");
    expect(block.data?.viewAllHref).toContain("scenario=CONSERVATIVE");
  });
});
