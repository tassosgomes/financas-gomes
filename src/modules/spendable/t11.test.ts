import { describe, expect, it } from "vitest";

import {
  buildForecastItems,
  buildForecastTimelineFromSources,
  type ForecastBuilderInput,
} from "@/modules/forecast/builder";

import {
  cardPaymentNotSourceSpendableFixture,
  installmentsOnceSpendableFixture,
  negativeSpendableFixture,
  noEventsSpendableFixture,
  positiveSpendableFixture,
  reliableIncomeScenarioFixture,
  sameDaySpendableFixture,
  SPENDABLE_FIXTURES,
  yearBoundarySpendableFixture,
  zeroSpendableFixture,
} from "./fixtures";
import {
  SpendableEngine,
  type SpendableBufferInput,
} from "./engine";
import {
  normalizeSpendableTimeline,
  serializeSpendableTimeline,
} from "./timeline";
import type { SpendableBreakdown, SpendableReserveSnapshot } from "./contracts";

const ZERO_RESERVE: SpendableReserveSnapshot = {
  contractVersion: "s09.v1",
  status: "UNAVAILABLE",
  protectedCents: "0",
  appliedOpeningAdjustmentCents: "0",
  components: [],
};

const MONEY_FIELDS = [
  "openingBalanceCents",
  "openingAdjustmentsCents",
  "openingProjectedBalanceCents",
  "closingProjectedBalanceCents",
  "minimumProjectedBalanceCents",
  "rawSpendableCents",
  "displaySpendableCents",
  "deficitToPreserveReserveCents",
] as const satisfies readonly (keyof SpendableBreakdown)[];

function calculate(
  fixture: (typeof SPENDABLE_FIXTURES)[number],
  timeline = normalizeSpendableTimeline(fixture.timeline),
): SpendableBreakdown {
  const buffer: SpendableBufferInput = {
    amountCents: fixture.operationalBufferCents,
    source: fixture.operationalBufferSource,
    effectiveFrom: fixture.effectiveBufferFrom ?? null,
    revision: fixture.operationalBufferSource === "CONFIGURED" ? "t11-buffer" : null,
  };
  return SpendableEngine({
    timeline,
    operationalBuffer: buffer,
    reserve: ZERO_RESERVE,
  });
}

function expectCents(value: unknown): asserts value is string {
  expect(typeof value).toBe("string");
  expect(value).toMatch(/^-?\d+$/u);
}

describe("T11 S08 unit acceptance matrix", () => {
  it("reconciles every fixture with integer cent arithmetic and no float money", () => {
    for (const fixture of SPENDABLE_FIXTURES) {
      const result = calculate(fixture);
      for (const field of MONEY_FIELDS) expectCents(result[field]);

      const minimum = BigInt(result.minimumProjectedBalanceCents);
      const buffer = BigInt(fixture.operationalBufferCents);
      const raw = BigInt(result.rawSpendableCents);
      expect(minimum - buffer).toBe(raw);
      expect(BigInt(result.displaySpendableCents)).toBe(
        raw < BigInt(0) ? BigInt(0) : raw,
      );
      expect(BigInt(result.deficitToPreserveReserveCents)).toBe(
        raw < BigInt(0) ? -raw : BigInt(0),
      );
    }
  });

  it("covers positive, zero, deficit, cents, same-day and year-boundary behavior", () => {
    expect(calculate(positiveSpendableFixture).rawSpendableCents).toBe("234500");
    expect(calculate(zeroSpendableFixture).rawSpendableCents).toBe("0");

    const negative = calculate(negativeSpendableFixture);
    expect(negative.rawSpendableCents).toBe("-200000");
    expect(negative.displaySpendableCents).toBe("0");
    expect(negative.deficitToPreserveReserveCents).toBe("200000");

    const sameDay = calculate(sameDaySpendableFixture);
    expect(sameDay.minimumProjectedBalanceCents).toBe("100000");
    expect(sameDay.closingProjectedBalanceCents).toBe("200000");
    expect(sameDay.minimum.points.map(({ kind }) => kind)).toEqual(["OPENING"]);

    const yearBoundary = calculate(yearBoundarySpendableFixture);
    expect(yearBoundary.period).toMatchObject({
      asOf: "2026-12-30",
      from: "2026-12-31",
      to: "2027-01-02",
    });
    expect(yearBoundary.minimum.points[0]?.date).toBe("2026-12-31");
  });

  it("keeps tied minimum points and result serialization deterministic", () => {
    const sourceItems = sameDaySpendableFixture.timeline.days.flatMap(
      ({ items }) => items,
    );
    const serializations = [
      sourceItems,
      [...sourceItems].reverse(),
      [sourceItems[1]!, sourceItems[2]!, sourceItems[0]!],
    ].map((items) => {
      const timeline = normalizeSpendableTimeline({
        forecast: sameDaySpendableFixture.timeline,
        items,
      });
      return JSON.stringify(calculate(sameDaySpendableFixture, timeline));
    });

    expect(new Set(serializations).size).toBe(1);

    const tieTimeline = normalizeSpendableTimeline(
      [
        {
          date: "2026-09-02",
          amountCents: "500",
          direction: "OUTFLOW",
          status: "PLANNED",
          certainty: "COMMITTED",
          source: {
            kind: "PLANNED_EVENT",
            referenceId: "t11-tie-early",
            label: "ignored",
          },
          referenceId: "t11-tie-early",
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
            referenceId: "t11-tie-reset",
            label: "ignored",
          },
          referenceId: "t11-tie-reset",
          reconciliation: null,
        },
        {
          date: "2026-09-04",
          amountCents: "500",
          direction: "OUTFLOW",
          status: "PLANNED",
          certainty: "COMMITTED",
          source: {
            kind: "PLANNED_EVENT",
            referenceId: "t11-tie-late",
            label: "ignored",
          },
          referenceId: "t11-tie-late",
          reconciliation: null,
        },
      ],
      "1000",
      { from: "2026-09-02", to: "2026-09-04" },
      "CONSERVATIVE",
    );
    const result = SpendableEngine({
      timeline: tieTimeline,
      operationalBuffer: { amountCents: "0", source: "CONFIGURED", effectiveFrom: null, revision: "t11" },
      reserve: ZERO_RESERVE,
    });
    expect(result.minimum.points.map(({ date, references }) => [date, references])).toEqual([
      ["2026-09-02", ["t11-tie-early"]],
      ["2026-09-04", ["t11-tie-late"]],
    ]);
    expect(serializeSpendableTimeline(tieTimeline)).toEqual(
      serializeSpendableTimeline(
        normalizeSpendableTimeline(
          [
            {
              date: "2026-09-04",
              amountCents: "500",
              direction: "OUTFLOW",
              status: "PLANNED",
              certainty: "COMMITTED",
              source: {
                kind: "PLANNED_EVENT",
                referenceId: "t11-tie-late",
                label: "ignored",
              },
              referenceId: "t11-tie-late",
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
                referenceId: "t11-tie-reset",
                label: "ignored",
              },
              referenceId: "t11-tie-reset",
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
                referenceId: "t11-tie-early",
                label: "ignored",
              },
              referenceId: "t11-tie-early",
              reconciliation: null,
            },
          ],
          "1000",
          { from: "2026-09-02", to: "2026-09-04" },
          "CONSERVATIVE",
        ),
      ),
    );
  });

  it("proves conservative/expected certainty and S07 source reconciliation fixtures", () => {
    const conservative = calculate(reliableIncomeScenarioFixture.variants.CONSERVATIVE);
    const expected = calculate(reliableIncomeScenarioFixture.variants.EXPECTED);
    expect(conservative.period.scenario).toBe("CONSERVATIVE");
    expect(expected.period.scenario).toBe("EXPECTED");
    expect(conservative.closingProjectedBalanceCents).toBe("100000");
    expect(expected.closingProjectedBalanceCents).toBe("400000");

    const noEvents = calculate(noEventsSpendableFixture);
    expect(noEvents.minimum.points.map(({ kind }) => kind)).toEqual(["OPENING"]);

    const installmentRefs = normalizeSpendableTimeline(
      installmentsOnceSpendableFixture.timeline,
    ).items.map(({ referenceId }) => referenceId);
    expect(installmentRefs).toEqual([
      "fx-installment-1",
      "fx-installment-2",
      "fx-installment-3",
    ]);
    expect(installmentsOnceSpendableFixture.excludedReferenceIds).toEqual([
      "fx-purchase-total",
      "fx-card-payment",
    ]);

    const cardFixture = normalizeSpendableTimeline(
      cardPaymentNotSourceSpendableFixture.timeline,
    );
    expect(cardFixture.items).toHaveLength(3);
    expect(cardPaymentNotSourceSpendableFixture.excludedReferenceIds).toEqual([
      "fx-purchase-total",
      "fx-card-payment",
      "fx-invoice-total",
    ]);
  });

  it("integrates the S07 builder contract for future inputs and cancellation", () => {
    const input: ForecastBuilderInput = {
      from: "2026-09-01",
      to: "2026-09-30",
      openingBalanceCents: "1000000",
      scenario: "EXPECTED",
      plannedEvents: [
        {
          id: "t11-known-expense",
          householdId: "t11-household",
          kind: "EXPENSE",
          status: "PLANNED",
          amountCents: "200",
          expectedOn: "2026-09-10",
          description: "known future commitment",
        },
        {
          id: "t11-cancelled-expense",
          householdId: "t11-household",
          kind: "EXPENSE",
          status: "CANCELLED",
          amountCents: "900000",
          expectedOn: "2026-09-11",
          description: "cancelled commitment",
        },
      ],
      installments: [
        {
          id: "t11-future-installment",
          householdId: "t11-household",
          amountCents: "300",
          status: "PLANNED",
          billingCycle: "2026-09-01",
          billingDueOn: "2026-09-20",
          sequence: 1,
          event: {
            id: "t11-purchase-total",
            householdId: "t11-household",
            kind: "PURCHASE",
            status: "POSTED",
            amountCents: "300",
            occurredOn: "2026-09-01",
            description: "purchase total is not a second source",
          },
          entries: [
            {
              id: "t11-future-installment-entry",
              householdId: "t11-household",
              financialEventId: "t11-purchase-total",
              installmentId: "t11-future-installment",
              amountCents: "-300",
              status: "EXPECTED",
              expectedOn: "2026-09-20",
              postedOn: null,
            },
          ],
        },
      ],
    };
    const items = buildForecastItems(input);
    expect(items.map(({ referenceId }) => referenceId)).toEqual([
      "t11-known-expense",
      "t11-future-installment",
    ]);
    expect(items.map(({ amountCents }) => amountCents)).toEqual(["200", "300"]);
    expect(items.some(({ referenceId }) => referenceId === "t11-cancelled-expense")).toBe(false);
    expect(items.some(({ referenceId }) => referenceId === "t11-purchase-total")).toBe(false);

    const timeline = buildForecastTimelineFromSources(input);
    expect(timeline.totals.outflowCents).toBe("500");
    expect(timeline.days.flatMap(({ items: dayItems }) => dayItems)).toHaveLength(2);
  });

  it.todo(
    "T11/S09: habilitar valores de caixinha quando a persistência de S09 estiver disponível",
  );
});
