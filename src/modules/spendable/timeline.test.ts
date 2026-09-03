import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";

import type { ForecastItem } from "@/modules/forecast/contracts";

import {
  SPENDABLE_FIXTURES,
  cardPaymentNotSourceSpendableFixture,
  installmentsOnceSpendableFixture,
  noEventsSpendableFixture,
  sameDaySpendableFixture,
  yearBoundarySpendableFixture,
} from "./fixtures";
import {
  SpendableContractError,
  type NormalizedSpendableTimeline,
} from "./contracts";
import {
  normalizeSpendableForecastItem,
  normalizeSpendableTimeline,
  serializeSpendableTimeline,
} from "./timeline";

function expectError(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(SpendableContractError);
    expect(error).toMatchObject({ code });
  }
}

function itemsOf(timeline: NormalizedSpendableTimeline): ForecastItem[] {
  return timeline.days.flatMap(({ items }) =>
    items.map((item) => ({
      date: item.date.toString(),
      amountCents: item.amountCents.toString(10),
      direction: item.direction,
      status: item.status,
      certainty: item.certainty,
      source: { ...item.source },
      referenceId: item.referenceId,
      reconciliation: item.reconciliation ? { ...item.reconciliation } : null,
    })),
  );
}

describe("T02 normalized spendable timeline", () => {
  it("recomputes an intraday aggregate before changing the balance", () => {
    const normalized = normalizeSpendableTimeline(sameDaySpendableFixture.timeline);
    const day = normalized.days[0];

    expect(day).toMatchObject({
      date: Temporal.PlainDate.from("2026-09-02"),
      inflowCents: BigInt(150000),
      outflowCents: BigInt(50000),
      netCents: BigInt(100000),
      openingProjectedBalanceCents: BigInt(100000),
      closingProjectedBalanceCents: BigInt(200000),
    });
    expect(normalized.minimumProjectedBalanceCents).toBe(BigInt(100000));
    expect(normalized.minimumProjectedOn).toBeNull();
    expect(normalized.openingPoint.date.toString()).toBe("2026-09-01");
  });

  it("produces the same daily timeline for any input row order", () => {
    const original = sameDaySpendableFixture.timeline.days.flatMap(({ items }) => items);
    const first = normalizeSpendableTimeline({
      forecast: sameDaySpendableFixture.timeline,
      items: original,
    });
    const second = normalizeSpendableTimeline({
      forecast: sameDaySpendableFixture.timeline,
      items: [...original].reverse(),
    });

    expect(serializeSpendableTimeline(second)).toEqual(serializeSpendableTimeline(first));
    expect(first.days[0]?.items.map(({ referenceId }) => referenceId)).toEqual([
      "fx-same-day-inflow",
      "fx-same-day-outflow-a",
      "fx-same-day-outflow-b",
    ]);
  });

  it("accepts a pure S07 item collection without persistence adapters", () => {
    const items = sameDaySpendableFixture.timeline.days.flatMap(({ items }) => items);
    const normalized = normalizeSpendableTimeline(
      [...items].reverse(),
      "100000",
      { from: "2026-09-02", to: "2026-09-02" },
      "EXPECTED",
    );
    expect(normalized.days[0]?.closingProjectedBalanceCents).toBe(BigInt(200000));
    expect(normalized.scenario).toBe("EXPECTED");
  });

  it("keeps an empty horizon explicit and includes opening in the minimum", () => {
    const normalized = normalizeSpendableTimeline(noEventsSpendableFixture.timeline);

    expect(normalized.days).toEqual([]);
    expect(normalized.openingBalanceCents).toBe(BigInt(800000));
    expect(normalized.closingProjectedBalanceCents).toBe(BigInt(800000));
    expect(normalized.minimumProjectedBalanceCents).toBe(BigInt(800000));
    expect(normalized.points.map(({ kind }) => kind)).toEqual(["OPENING"]);
    expect(normalized.minimumBalanceReferences).toEqual([]);
  });

  it("orders dates across the year boundary using PlainDate", () => {
    const normalized = normalizeSpendableTimeline(yearBoundarySpendableFixture.timeline);
    expect(normalized.days.map(({ date }) => date.toString())).toEqual([
      "2026-12-31",
      "2027-01-01",
    ]);
    expect(normalized.days.map(({ closingProjectedBalanceCents }) => closingProjectedBalanceCents)).toEqual([
      BigInt(400000),
      BigInt(650000),
    ]);
  });

  it("deduplicates an identical opaque reference but rejects conflicting values", () => {
    const items = sameDaySpendableFixture.timeline.days.flatMap(({ items }) => items);
    const withExactDuplicate = normalizeSpendableTimeline({
      forecast: sameDaySpendableFixture.timeline,
      items: [...items, items[0]!],
    });
    expect(withExactDuplicate.days[0]?.items).toHaveLength(3);

    const conflicting = {
      ...items[0]!,
      amountCents: "999999",
    } as ForecastItem;
    expectError(
      () => normalizeSpendableTimeline({
        forecast: sameDaySpendableFixture.timeline,
        items: [...items, conflicting],
      }),
      "DUPLICATE_REFERENCE",
    );
  });

  it("rejects number money and JavaScript Date at the domain boundary", () => {
    const item = sameDaySpendableFixture.timeline.days[0]!.items[0]!;
    expectError(
      () => normalizeSpendableForecastItem({ ...item, amountCents: 42 } as unknown as ForecastItem),
      "INVALID_ITEM",
    );
    expectError(
      () => normalizeSpendableTimeline({
        forecast: sameDaySpendableFixture.timeline,
        from: new Date("2026-09-02") as unknown as string,
      }),
      "INVALID_DATE",
    );
  });

  it("keeps installment rows exactly once and excludes purchase/payment references", () => {
    const normalized = normalizeSpendableTimeline(installmentsOnceSpendableFixture.timeline);
    const references = normalized.items.map(({ referenceId }) => referenceId);
    expect(references).toEqual([
      "fx-installment-1",
      "fx-installment-2",
      "fx-installment-3",
    ]);
    expect(references).not.toContain("fx-purchase-total");
    expect(references).not.toContain("fx-card-payment");
    expect(normalized.items).toHaveLength(3);

    const serialized = serializeSpendableTimeline(normalized);
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });

  it("keeps labels out of canonical ordering and preserves opaque references", () => {
    const normalized = normalizeSpendableTimeline(sameDaySpendableFixture.timeline);
    const serialized = serializeSpendableTimeline(normalized);
    const item = serialized.items[0];
    expect(item?.referenceId).toMatch(/^fx-/u);
    expect(item?.source.label).toMatch(/^fixture-/u);
    expect(itemsOf(normalized).map(({ referenceId }) => referenceId)).toEqual([
      "fx-same-day-inflow",
      "fx-same-day-outflow-a",
      "fx-same-day-outflow-b",
    ]);
  });

  it("exposes immutable Money/bigint balance components", () => {
    const normalized = normalizeSpendableTimeline(cardPaymentNotSourceSpendableFixture.timeline);
    const opening = normalized.openingPoint.components[0];
    const dayNet = normalized.days[0]?.components.at(-1);
    expect(opening?.amount.cents).toBe(opening?.amountCents);
    expect(dayNet?.amount.cents).toBe(dayNet?.amountCents);
    expect(typeof normalized.openingBalanceCents).toBe("bigint");
  });

  it("reconciles every exported matrix fixture with its expected cent values", () => {
    for (const fixture of SPENDABLE_FIXTURES) {
      const normalized = normalizeSpendableTimeline(fixture.timeline);
      expect(normalized.openingProjectedBalanceCents.toString(10)).toBe(
        fixture.expected.openingProjectedBalanceCents,
      );
      expect(normalized.closingProjectedBalanceCents.toString(10)).toBe(
        fixture.expected.closingProjectedBalanceCents,
      );
      expect(normalized.minimumProjectedBalanceCents.toString(10)).toBe(
        fixture.expected.minimumProjectedBalanceCents,
      );
      expect(normalized.minimumProjectedOn?.toString() ?? null).toBe(
        fixture.expected.minimumProjectedOn,
      );
    }
  });
});
