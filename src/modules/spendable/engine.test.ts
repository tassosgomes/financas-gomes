import { describe, expect, it } from "vitest";

import {
  isSpendableBreakdown,
  parseSpendableBreakdown,
  type OperationalBufferSnapshot,
  type SpendableReserveSnapshot,
} from "./contracts";
import type { ForecastTimeline } from "@/modules/forecast/contracts";
import {
  negativeSpendableFixture,
  noEventsSpendableFixture,
  positiveSpendableFixture,
  reliableIncomeScenarioFixture,
  sameDaySpendableFixture,
  yearBoundarySpendableFixture,
  zeroSpendableFixture,
} from "./fixtures";
import {
  SpendableEngine,
  calculateSpendable,
  type SpendableBufferInput,
} from "./engine";
import { normalizeSpendableTimeline, serializeSpendableTimeline } from "./timeline";

const ZERO_RESERVE: SpendableReserveSnapshot = {
  contractVersion: "s09.v1",
  status: "UNAVAILABLE",
  protectedCents: "0",
  appliedOpeningAdjustmentCents: "0",
  components: [],
};

function buffer(
  amountCents: string,
  source: OperationalBufferSnapshot["source"] = "CONFIGURED",
): SpendableBufferInput {
  return {
    amountCents,
    source,
    effectiveFrom: source === "CONFIGURED" ? null : null,
    revision: source === "CONFIGURED" ? "fixture-buffer" : null,
  };
}

function calculateFixture(fixture: {
  readonly timeline: ForecastTimeline;
  readonly operationalBufferCents: string;
  readonly operationalBufferSource: OperationalBufferSnapshot["source"];
}) {
  return SpendableEngine({
    timeline: normalizeSpendableTimeline(fixture.timeline),
    operationalBuffer: buffer(
      fixture.operationalBufferCents,
      fixture.operationalBufferSource,
    ),
    reserve: ZERO_RESERVE,
  });
}

describe("S08 SpendableEngine (T03)", () => {
  it("reconciles positive, zero and negative raw spendable values", () => {
    const positive = calculateFixture(positiveSpendableFixture);
    expect(positive).toMatchObject({
      minimumProjectedBalanceCents: "734500",
      rawSpendableCents: "234500",
      displaySpendableCents: "234500",
      deficitToPreserveReserveCents: "0",
    });

    const zero = calculateFixture(zeroSpendableFixture);
    expect(zero).toMatchObject({
      minimumProjectedBalanceCents: "500000",
      rawSpendableCents: "0",
      displaySpendableCents: "0",
      deficitToPreserveReserveCents: "0",
    });

    const negative = calculateFixture(negativeSpendableFixture);
    expect(negative).toMatchObject({
      minimumProjectedBalanceCents: "300000",
      rawSpendableCents: "-200000",
      displaySpendableCents: "0",
      deficitToPreserveReserveCents: "200000",
    });
  });

  it("uses the grouped daily net and does not create an intraday minimum", () => {
    const result = calculateFixture(sameDaySpendableFixture);

    expect(result.closingProjectedBalanceCents).toBe("200000");
    expect(result.minimumProjectedBalanceCents).toBe("100000");
    expect(result.minimum.points).toEqual([
      {
        kind: "OPENING",
        date: "2026-09-01",
        projectedBalanceCents: "100000",
        references: [],
        items: [],
      },
    ]);
  });

  it("keeps an event-free horizon valid and includes the opening candidate", () => {
    const result = calculateFixture(noEventsSpendableFixture);

    expect(result.period).toMatchObject({
      asOf: "2026-09-01",
      from: "2026-09-02",
      to: "2026-11-30",
      horizonDays: 90,
    });
    expect(result.minimum.points).toHaveLength(1);
    expect(result.minimum.points[0]?.kind).toBe("OPENING");
    expect(result.closingProjectedBalanceCents).toBe(
      result.openingProjectedBalanceCents,
    );
  });

  it("preserves every tied minimum point in deterministic civil/reference order", () => {
    const timeline = normalizeSpendableTimeline(
      [
        {
          date: "2026-09-04",
          amountCents: "500",
          direction: "OUTFLOW",
          status: "PLANNED",
          certainty: "COMMITTED",
          source: {
            kind: "PLANNED_EVENT",
            referenceId: "tie-late",
            label: "not used",
          },
          referenceId: "tie-late",
          reconciliation: null,
        },
        {
          date: "2026-09-03",
          amountCents: "500",
          direction: "INFLOW",
          status: "PLANNED",
          certainty: "COMMITTED",
          source: {
            kind: "PLANNED_EVENT",
            referenceId: "tie-reset",
            label: "not used",
          },
          referenceId: "tie-reset",
          reconciliation: null,
        },
        {
          date: "2026-09-02",
          amountCents: "500",
          direction: "OUTFLOW",
          status: "PLANNED",
          certainty: "COMMITTED",
          source: {
            kind: "PLANNED_EVENT",
            referenceId: "tie-early",
            label: "not used",
          },
          referenceId: "tie-early",
          reconciliation: null,
        },
      ],
      "1000",
      { from: "2026-09-02", to: "2026-09-04" },
      "CONSERVATIVE",
    );
    const result = SpendableEngine({
      timeline,
      operationalBuffer: buffer("0"),
      reserve: ZERO_RESERVE,
    });

    expect(result.minimumProjectedBalanceCents).toBe("500");
    expect(result.minimum.points.map(({ date, references }) => [date, references])).toEqual([
      ["2026-09-02", ["tie-early"]],
      ["2026-09-04", ["tie-late"]],
    ]);
  });

  it("retains an opening/day-close tie and causal references", () => {
    const timeline = normalizeSpendableTimeline(
      [
        {
          date: "2026-09-02",
          amountCents: "25",
          direction: "INFLOW",
          status: "PLANNED",
          certainty: "COMMITTED",
          source: {
            kind: "PLANNED_EVENT",
            referenceId: "tie-inflow",
            label: "not used",
          },
          referenceId: "tie-inflow",
          reconciliation: null,
        },
        {
          date: "2026-09-02",
          amountCents: "25",
          direction: "OUTFLOW",
          status: "PLANNED",
          certainty: "COMMITTED",
          source: {
            kind: "PLANNED_EVENT",
            referenceId: "tie-outflow",
            label: "not used",
          },
          referenceId: "tie-outflow",
          reconciliation: null,
        },
      ],
      "1000",
      { from: "2026-09-02", to: "2026-09-02" },
      "CONSERVATIVE",
    );
    const result = calculateSpendable({
      timeline,
      operationalBuffer: buffer("0"),
      reserve: ZERO_RESERVE,
    });

    expect(result.minimum.points.map(({ kind, date }) => [kind, date])).toEqual([
      ["OPENING", "2026-09-01"],
      ["DAY_CLOSE", "2026-09-02"],
    ]);
    expect(result.minimum.points[1]?.references).toEqual([
      "tie-inflow",
      "tie-outflow",
    ]);
    expect(result.minimum.points[1]?.items.map(({ referenceId }) => referenceId)).toEqual([
      "tie-inflow",
      "tie-outflow",
    ]);
  });

  it("keeps uncertain inflows governed by the S07 timeline scenario", () => {
    const conservative = calculateFixture(reliableIncomeScenarioFixture.variants.CONSERVATIVE);
    const expected = calculateFixture(reliableIncomeScenarioFixture.variants.EXPECTED);

    expect(conservative.period.scenario).toBe("CONSERVATIVE");
    expect(expected.period.scenario).toBe("EXPECTED");
    expect(expected.closingProjectedBalanceCents).toBe("400000");
    expect(conservative.closingProjectedBalanceCents).toBe("100000");
  });

  it("uses bigint precision, does not mutate the timeline and emits a valid DTO", () => {
    const timeline = normalizeSpendableTimeline(
      sameDaySpendableFixture.timeline,
    );
    const before = serializeSpendableTimeline(timeline);
    const result = SpendableEngine({
      timeline,
      operationalBuffer: buffer("1"),
      reserve: ZERO_RESERVE,
    });

    expect(result.openingBalanceCents).toBe("100000");
    expect(result.rawSpendableCents).toBe("99999");
    expect(serializeSpendableTimeline(timeline)).toEqual(before);
    expect(isSpendableBreakdown(result)).toBe(true);
    expect(parseSpendableBreakdown(result)).toEqual(result);

    const largeTimeline = normalizeSpendableTimeline(
      [],
      "922337203685477580700",
      { from: "2026-09-02", to: "2026-09-02" },
      "CONSERVATIVE",
    );
    const large = SpendableEngine({
      timeline: largeTimeline,
      operationalBuffer: buffer("1"),
      reserve: ZERO_RESERVE,
    });
    expect(large.rawSpendableCents).toBe("922337203685477580699");
  });

  it("keeps PlainDate ordering through a civil year boundary", () => {
    const result = calculateFixture(yearBoundarySpendableFixture);

    expect(result.period).toMatchObject({
      asOf: "2026-12-30",
      from: "2026-12-31",
      to: "2027-01-02",
    });
    expect(result.minimumProjectedBalanceCents).toBe("400000");
    expect(result.minimum.points[0]?.date).toBe("2026-12-31");
  });

  it("supports the explicit items/range overload without introducing defaults", () => {
    const fixture = positiveSpendableFixture;
    const result = SpendableEngine(
      fixture.timeline.days.flatMap(({ items }) => items),
      fixture.openingBalanceCents,
      { from: fixture.from, to: fixture.to },
      fixture.scenario,
      buffer(fixture.operationalBufferCents),
      ZERO_RESERVE,
    );

    expect(result.rawSpendableCents).toBe(fixture.expected.rawSpendableCents);
    expect(result.period.horizonDays).toBe(fixture.horizonDays);
  });

  it("applies an explicit reserve opening adjustment exactly once", () => {
    const timeline = normalizeSpendableTimeline(noEventsSpendableFixture.timeline);
    const result = SpendableEngine({
      timeline,
      operationalBuffer: buffer("0"),
      reserve: {
        contractVersion: "s09.v1",
        status: "AVAILABLE",
        protectedCents: "100000",
        appliedOpeningAdjustmentCents: "-100000",
        components: [
          {
            referenceId: "reserve-box",
            amountCents: "100000",
            effectiveOn: "2026-09-01",
          },
        ],
      },
    });

    expect(result.openingAdjustmentsCents).toBe("-100000");
    expect(result.openingProjectedBalanceCents).toBe("700000");
    expect(result.minimumProjectedBalanceCents).toBe("700000");
    expect(result.minimum.points[0]?.items).toContainEqual({
      referenceId: "reserve-box",
      sourceKind: "RESERVE",
      date: "2026-09-01",
      amountCents: "100000",
      direction: "OUTFLOW",
      status: null,
      certainty: null,
    });
  });

  it("rejects hidden defaults, invalid horizon boundaries and inconsistent asOf", () => {
    const timeline = normalizeSpendableTimeline(noEventsSpendableFixture.timeline);

    expect(() => SpendableEngine({ timeline })).toThrow();
    expect(() => SpendableEngine({
      timeline,
      operationalBuffer: buffer("0"),
      reserve: ZERO_RESERVE,
      horizon: { days: 0 },
    })).toThrow();
    expect(() => SpendableEngine({
      timeline,
      operationalBuffer: buffer("0"),
      reserve: ZERO_RESERVE,
      horizon: { days: 3661 },
    })).toThrow();
    expect(() => SpendableEngine({
      timeline,
      operationalBuffer: buffer("0"),
      reserve: ZERO_RESERVE,
      asOf: "2026-09-02",
    })).toThrow();
  });

  it("rejects negative buffers and a non-zero unavailable reserve", () => {
    const timeline = normalizeSpendableTimeline(noEventsSpendableFixture.timeline);

    expect(() => SpendableEngine({
      timeline,
      operationalBuffer: buffer("-1"),
      reserve: ZERO_RESERVE,
    })).toThrow();
    expect(() => SpendableEngine({
      timeline,
      operationalBuffer: buffer("0"),
      reserve: {
        ...ZERO_RESERVE,
        protectedCents: "1",
      },
    })).toThrow();
  });
});
