import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";

import { parseForecastTimeline, type ForecastScenario } from "./contracts";
import {
  ForecastEngine,
  calculateForecast,
  forecastEngine,
  isForecastItemIncluded,
  type ForecastEngineItem,
} from "./engine";

function source(
  referenceId: string,
  kind: ForecastEngineItem["source"]["kind"] = "PLANNED_EVENT",
  extra: Record<string, unknown> = {},
): ForecastEngineItem["source"] {
  return {
    kind,
    referenceId,
    label: `Origem ${referenceId}`,
    ...extra,
  };
}

function item(
  referenceId: string,
  values: Partial<ForecastEngineItem> = {},
): ForecastEngineItem {
  return {
    date: "2026-09-01",
    amountCents: "100",
    direction: "OUTFLOW",
    status: "PLANNED",
    certainty: "COMMITTED",
    source: source(referenceId),
    referenceId,
    reconciliation: null,
    ...values,
  };
}

function expectEngineCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("S07 ForecastEngine", () => {
  it("aggregates all events of a day before changing the projected balance", () => {
    const result = ForecastEngine(
      [
        item("out-2", { amountCents: "200" }),
        item("in-1", {
          amountCents: "1500",
          direction: "INFLOW",
          source: source("in-1"),
        }),
        item("out-1", { amountCents: "300" }),
      ],
      "1000",
      { from: "2026-09-01", to: "2026-09-01" },
      "EXPECTED",
    );

    expect(result.days).toHaveLength(1);
    expect(result.days[0]).toMatchObject({
      date: "2026-09-01",
      inflowCents: "1500",
      outflowCents: "500",
      netCents: "1000",
      openingProjectedBalanceCents: "1000",
      closingProjectedBalanceCents: "2000",
    });
    expect(result.minimumProjectedBalanceCents).toBe("1000");
    expect(result.minimumProjectedOn).toBeNull();
    expect(result.minimumBalanceReferences).toEqual([]);
  });

  it("is independent of input row order and uses a canonical item order", () => {
    const rows = [
      item("z-out", {
        amountCents: "20",
        status: "EXPECTED",
        certainty: "EXPECTED",
        source: source("z-out", "RECURRING", {
          recurringRuleId: "rule-z",
          occurrenceKey: "2026-09",
        }),
      }),
      item("posted", {
        amountCents: "30",
        direction: "INFLOW",
        status: "POSTED",
        certainty: "REALIZED",
        source: source("posted", "REALIZED_EVENT"),
      }),
      item("a-out", {
        amountCents: "10",
        status: "PLANNED",
        certainty: "COMMITTED",
        source: source("a-out", "INSTALLMENT", {
          billingCycle: "2026-09",
          installmentSequence: 2,
        }),
      }),
      item("a-out-first", {
        amountCents: "11",
        status: "PLANNED",
        certainty: "COMMITTED",
        source: source("a-out-first", "INSTALLMENT", {
          billingCycle: "2026-09",
          installmentSequence: 1,
        }),
      }),
    ];
    const first = ForecastEngine(rows, "1000", {
      from: "2026-09-01",
      to: "2026-09-01",
    }, "EXPECTED");
    const second = ForecastEngine([...rows].reverse(), "1000", {
      from: "2026-09-01",
      to: "2026-09-01",
    }, "EXPECTED");

    expect(second).toEqual(first);
    expect(first.days[0]?.items.map(({ referenceId }) => referenceId)).toEqual([
      "posted",
      "a-out",
      "a-out-first",
      "z-out",
    ]);
  });

  it("keeps the inclusive civil date range and excludes items after it", () => {
    const result = ForecastEngine(
      [
        item("at-from", { date: "2026-09-01", amountCents: "10" }),
        item("at-to", { date: "2026-09-30", amountCents: "20" }),
        item("outside", { date: "2026-10-01", amountCents: "999" }),
      ],
      "1000",
      { from: Temporal.PlainDate.from("2026-09-01"), to: "2026-09-30" },
      "EXPECTED",
    );

    expect(result.from).toBe("2026-09-01");
    expect(result.to).toBe("2026-09-30");
    expect(result.totals.outflowCents).toBe("30");
    expect(result.days.map(({ date }) => date)).toEqual(["2026-09-01", "2026-09-30"]);
  });

  it("places active planned items before the range in opening adjustments", () => {
    const result = ForecastEngine(
      [
        item("late-out", { date: "2026-08-10", amountCents: "200" }),
        item("late-in", {
          date: "2026-08-20",
          amountCents: "50",
          direction: "INFLOW",
          certainty: "EXPECTED",
          source: source("late-in"),
        }),
        item("posted-history", {
          date: "2026-08-01",
          amountCents: "999",
          status: "POSTED",
          certainty: "REALIZED",
          source: source("posted-history", "REALIZED_EVENT"),
        }),
        item("in-range", { date: "2026-09-05", amountCents: "100" }),
      ],
      "1000",
      { from: "2026-09-01", to: "2026-09-30" },
      "EXPECTED",
    );

    expect(result.openingBalanceCents).toBe("1000");
    expect(result.openingAdjustmentsCents).toBe("-150");
    expect(result.openingProjectedBalanceCents).toBe("850");
    expect(result.days.map(({ date }) => date)).toEqual(["2026-09-05"]);
    expect(result.days[0]?.openingProjectedBalanceCents).toBe("850");
    expect(result.closingProjectedBalanceCents).toBe("750");
    expect(result.minimumProjectedBalanceCents).toBe("750");
    expect(result.minimumProjectedOn).toBe("2026-09-05");
    expect(result.minimumBalanceReferences).toEqual(["in-range"]);
  });

  it("includes all civil months crossed by the range, including empty buckets and year rollover", () => {
    const result = ForecastEngine(
      [
        item("dec-out", { date: "2026-12-31", amountCents: "100" }),
        item("jan-in", {
          date: "2027-01-01",
          amountCents: "250",
          direction: "INFLOW",
          source: source("jan-in"),
        }),
      ],
      "1000",
      { from: "2026-11-15", to: "2027-02-02" },
      "EXPECTED",
    );

    expect(result.periods).toEqual([
      {
        period: "2026-11",
        inflowCents: "0",
        outflowCents: "0",
        netCents: "0",
        realizedInflowCents: "0",
        realizedOutflowCents: "0",
        projectedInflowCents: "0",
        projectedOutflowCents: "0",
      },
      {
        period: "2026-12",
        inflowCents: "0",
        outflowCents: "100",
        netCents: "-100",
        realizedInflowCents: "0",
        realizedOutflowCents: "0",
        projectedInflowCents: "0",
        projectedOutflowCents: "100",
      },
      {
        period: "2027-01",
        inflowCents: "250",
        outflowCents: "0",
        netCents: "250",
        realizedInflowCents: "0",
        realizedOutflowCents: "0",
        projectedInflowCents: "250",
        projectedOutflowCents: "0",
      },
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
    ]);
    expect(result.totals).toMatchObject({
      inflowCents: "250",
      outflowCents: "100",
      netCents: "150",
    });
  });

  it("returns a valid empty-month timeline without manufacturing daily rows", () => {
    const result = ForecastEngine(
      [],
      "-123456789012345678901",
      { from: "2027-02-01", to: "2027-02-28" },
      "CONSERVATIVE",
    );

    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]?.period).toBe("2027-02");
    expect(result.days).toEqual([]);
    expect(result.openingProjectedBalanceCents).toBe("-123456789012345678901");
    expect(result.closingProjectedBalanceCents).toBe(result.openingProjectedBalanceCents);
    expect(result.minimumProjectedBalanceCents).toBe(result.openingProjectedBalanceCents);
    expect(result.minimumProjectedOn).toBeNull();
  });

  it("separates realized and projected period totals by POSTED status", () => {
    const result = ForecastEngine(
      [
        item("realized-in", {
          amountCents: "1000",
          direction: "INFLOW",
          status: "POSTED",
          certainty: "REALIZED",
          source: source("realized-in", "REALIZED_EVENT"),
        }),
        item("realized-out", {
          amountCents: "200",
          status: "POSTED",
          certainty: "REALIZED",
          source: source("realized-out", "REALIZED_EVENT"),
        }),
        item("projected-in", {
          amountCents: "3000",
          direction: "INFLOW",
          status: "EXPECTED",
          certainty: "EXPECTED",
          source: source("projected-in", "RECURRING"),
        }),
        item("projected-out", { amountCents: "400" }),
      ],
      "0",
      { from: "2026-09-01", to: "2026-09-01" },
      "EXPECTED",
    );

    expect(result.totals).toEqual({
      inflowCents: "4000",
      outflowCents: "600",
      netCents: "3400",
      realizedInflowCents: "1000",
      realizedOutflowCents: "200",
      projectedInflowCents: "3000",
      projectedOutflowCents: "400",
    });
  });

  it("applies conservative certainty and source inclusion without excluding obligations", () => {
    const uncertainIncome = item("uncertain-income", {
      amountCents: "2000",
      direction: "INFLOW",
      status: "EXPECTED",
      certainty: "EXPECTED",
      source: source("uncertain-income", "RECURRING"),
    });
    const reliableIncome = item("reliable-income", {
      amountCents: "3000",
      direction: "INFLOW",
      status: "EXPECTED",
      certainty: "EXPECTED",
      includeInConservativeForecast: true,
      source: source("reliable-income", "RECURRING"),
    });
    const committedIncome = item("committed-income", {
      amountCents: "4000",
      direction: "INFLOW",
      status: "PLANNED",
      certainty: "COMMITTED",
      source: source("committed-income", "RECURRING"),
    });
    const knownOutflow = item("known-outflow", { amountCents: "500" });
    const realizedIncome = item("realized-income", {
      amountCents: "600",
      direction: "INFLOW",
      status: "POSTED",
      certainty: "REALIZED",
      source: source("realized-income", "REALIZED_EVENT"),
    });

    const conservative = ForecastEngine(
      [uncertainIncome, reliableIncome, committedIncome, knownOutflow, realizedIncome],
      "0",
      { from: "2026-09-01", to: "2026-09-01" },
      "CONSERVATIVE",
    );
    const expected = ForecastEngine(
      [uncertainIncome, reliableIncome, committedIncome, knownOutflow, realizedIncome],
      "0",
      { from: "2026-09-01", to: "2026-09-01" },
      "EXPECTED",
    );

    expect(conservative.totals.inflowCents).toBe("7600");
    expect(conservative.totals.outflowCents).toBe("500");
    expect(conservative.days[0]?.items.map(({ referenceId }) => referenceId)).toEqual([
      "realized-income",
      "known-outflow",
      "committed-income",
      "reliable-income",
    ]);
    expect(expected.totals.inflowCents).toBe("9600");
    expect(expected.days[0]?.items).toHaveLength(5);
    expect(isForecastItemIncluded(uncertainIncome, "CONSERVATIVE")).toBe(false);
    expect(isForecastItemIncluded(uncertainIncome, "EXPECTED")).toBe(true);
  });

  it("accepts bigint/value-object cents and emits only canonical strings", () => {
    const result = ForecastEngine(
      [
        item("big-int", {
          amountCents: BigInt("900719925474099312345678"),
        }),
        item("value-object", {
          amountCents: { cents: BigInt("2") },
          date: "2026-09-02",
        }),
      ],
      { cents: BigInt("1000000000000000000000000") },
      ["2026-09-01", "2026-09-02"],
      "EXPECTED",
    );

    expect(result.days[0]?.outflowCents).toBe("900719925474099312345678");
    expect(result.days[1]?.outflowCents).toBe("2");
    expect(result.openingBalanceCents).toBe("1000000000000000000000000");
    expect(result.closingProjectedBalanceCents).toBe("99280074525900687654320");
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(typeof result.days[0]?.items[0]?.amountCents).toBe("string");
  });

  it("selects the lowest closing balance and all same-day references explaining it", () => {
    const result = ForecastEngine(
      [
        item("minimum-in", {
          amountCents: "100",
          direction: "INFLOW",
          source: source("minimum-in"),
        }),
        item("minimum-out-a", { amountCents: "900" }),
        item("minimum-out-b", { amountCents: "400" }),
      ],
      "1000",
      { from: "2026-09-01", to: "2026-09-02" },
      "EXPECTED",
    );

    expect(result.days[0]?.closingProjectedBalanceCents).toBe("-200");
    expect(result.minimumProjectedBalanceCents).toBe("-200");
    expect(result.minimumProjectedOn).toBe("2026-09-01");
    expect(result.minimumBalanceReferences).toEqual([
      "minimum-in",
      "minimum-out-a",
      "minimum-out-b",
    ]);
  });

  it("does not mutate the source item array or item objects", () => {
    const original = [item("immutable", { amountCents: "00100" })];
    const snapshot = JSON.stringify(original);
    const result = ForecastEngine(
      original,
      "0",
      { from: "2026-09-01", to: "2026-09-01" },
      "EXPECTED",
    );

    expect(JSON.stringify(original)).toBe(snapshot);
    expect(result.days[0]?.items[0]?.amountCents).toBe("100");
    expect(original[0]?.amountCents).toBe("00100");
  });

  it("supports the object form and aliases while preserving the same shape", () => {
    const input = {
      items: [item("configured", { amountCents: "10" })],
      openingBalance: "100",
      from: "2026-09-01",
      to: "2026-09-01",
      scenario: "EXPECTED" as ForecastScenario,
    };
    const expected = ForecastEngine(input);
    expect(calculateForecast(input)).toEqual(expected);
    expect(forecastEngine(input)).toEqual(expected);
    expect(ForecastEngine({
      forecastItems: input.items,
      openingBalanceCents: input.openingBalance,
      range: { from: input.from, to: input.to },
      scenario: input.scenario,
    })).toEqual(expected);
  });

  it("rejects invalid dates, ranges, scenarios, amounts and conflicting aliases", () => {
    expectEngineCode(
      () => ForecastEngine([], "0", { from: "2026-02-30", to: "2026-03-01" }),
      "INVALID_DATE",
    );
    expectEngineCode(
      () => ForecastEngine([], "0", { from: "2026-03-02", to: "2026-03-01" }),
      "INVALID_DATE_RANGE",
    );
    expectEngineCode(
      () => ForecastEngine([], "0", { from: "2026-03-01", to: "2026-03-01" }, "OTHER" as ForecastScenario),
      "INVALID_SCENARIO",
    );
    expectEngineCode(
      () => ForecastEngine([item("zero", { amountCents: "0" })], "0", {
        from: "2026-03-01",
        to: "2026-03-01",
      }),
      "INVALID_AMOUNT",
    );
    expectEngineCode(
      () => ForecastEngine({
        items: [],
        openingBalance: "1",
        openingBalanceCents: "2",
        range: { from: "2026-03-01", to: "2026-03-01" },
      }),
      "FORECAST_INCONSISTENT",
    );
  });

  it("returns a timeline accepted by the strict public serializable contract", () => {
    const result = ForecastEngine(
      [
        item("strict", {
          amountCents: "00042",
          source: source("strict", "RECURRING", {
            recurringRuleId: "rule-1",
            occurrenceKey: "2026-09",
          }),
          reconciliation: {
            key: "rule-1:2026-09",
            replacesReferenceId: "planned-1",
            plannedAmountCents: "100",
            realizedAmountCents: "142",
            remainingAmountCents: "0",
            varianceAmountCents: "42",
          },
        }),
      ],
      "100",
      { from: "2026-09-01", to: "2026-09-30" },
      "EXPECTED",
    );

    expect(parseForecastTimeline(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });
});
