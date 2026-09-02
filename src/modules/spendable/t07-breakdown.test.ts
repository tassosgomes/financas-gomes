import { describe, expect, it } from "vitest";

import type { ForecastItem } from "@/modules/forecast/contracts";

import { parseSpendableBreakdown } from "./contracts";
import { SpendableEngine } from "./engine";
import { installmentsOnceSpendableFixture } from "./fixtures";
import { normalizeSpendableTimeline } from "./timeline";

const ZERO_RESERVE = {
  contractVersion: "s09.v1" as const,
  status: "UNAVAILABLE" as const,
  protectedCents: "0",
  appliedOpeningAdjustmentCents: "0",
  components: [],
};

const BUFFER = {
  amountCents: "0",
  source: "CONFIGURED" as const,
  effectiveFrom: null,
  revision: null,
};

function item(referenceId: string, amountCents: string): ForecastItem {
  return {
    date: "2026-09-02",
    amountCents,
    direction: "OUTFLOW",
    status: "PLANNED",
    certainty: "COMMITTED",
    source: {
      kind: "PLANNED_EVENT",
      referenceId,
      label: `fixture-${referenceId}`,
    },
    referenceId,
    reconciliation: null,
  };
}

function timeline(items: readonly ForecastItem[]) {
  return normalizeSpendableTimeline(
    items,
    "1000",
    { from: "2026-09-02", to: "2026-09-02" },
    "CONSERVATIVE",
  );
}

describe("S08 T07 breakdown/origin invariants", () => {
  it("keeps all arithmetic while exposing a bounded causal page", () => {
    const normalized = timeline([
      item("cause-c", "10"),
      item("cause-a", "10"),
      item("cause-b", "10"),
    ]);
    const first = SpendableEngine({
      normalizedTimeline: normalized,
      operationalBuffer: BUFFER,
      reserve: ZERO_RESERVE,
      causalItems: { limit: 2 },
    });

    expect(first).toMatchObject({
      minimumProjectedBalanceCents: "970",
      rawSpendableCents: "970",
      displaySpendableCents: "970",
      deficitToPreserveReserveCents: "0",
      minimum: {
        causalItems: {
          totalCount: 3,
          returnedCount: 2,
          limit: 2,
          truncated: true,
        },
      },
    });
    expect(first.minimum.points[0]?.items.map(({ referenceId }) => referenceId)).toEqual([
      "cause-a",
      "cause-b",
    ]);
    expect(first.minimum.points[0]?.references).toEqual(["cause-a", "cause-b"]);

    const nextCursor = first.minimum.causalItems?.nextCursor;
    const second = SpendableEngine({
      normalizedTimeline: normalized,
      operationalBuffer: BUFFER,
      reserve: ZERO_RESERVE,
      causalItems: { limit: 2, cursor: nextCursor },
    });
    expect(second.minimum.points[0]?.items.map(({ referenceId }) => referenceId)).toEqual([
      "cause-c",
    ]);
    expect(second.minimum.causalItems).toMatchObject({
      totalCount: 3,
      returnedCount: 1,
      truncated: true,
      nextCursor: null,
    });
    expect(second.minimumProjectedBalanceCents).toBe(first.minimumProjectedBalanceCents);
    expect(parseSpendableBreakdown(second)).toEqual(second);
  });

  it("rejects a forged timeline whose daily sum or item collection diverges", () => {
    const normalized = timeline([item("cause-a", "10")]);
    const forged = {
      ...normalized,
      days: normalized.days.map((day) => ({
        ...day,
        netCents: BigInt(-99),
      })),
    };
    expect(() =>
      SpendableEngine({
        normalizedTimeline: forged,
        operationalBuffer: BUFFER,
        reserve: ZERO_RESERVE,
      }),
    ).toThrow();
  });

  it("keeps the minimum point free of cancelled or out-of-window sources", () => {
    const normalized = timeline([item("cause-a", "10")]);
    const cancelled = {
      ...normalized,
      items: normalized.items.map((value) => ({
        ...value,
        status: "CANCELLED",
      })),
    } as unknown as typeof normalized;
    expect(() =>
      SpendableEngine({
        normalizedTimeline: cancelled,
        operationalBuffer: BUFFER,
        reserve: ZERO_RESERVE,
      }),
    ).toThrow();
  });

  it("uses each S07 installment once and never treats purchase/payment as causal sources", () => {
    const normalized = normalizeSpendableTimeline(installmentsOnceSpendableFixture.timeline);
    const result = SpendableEngine({
      normalizedTimeline: normalized,
      operationalBuffer: BUFFER,
      reserve: ZERO_RESERVE,
    });
    const references = result.minimum.points.flatMap(({ items }) =>
      items.map(({ referenceId }) => referenceId),
    );
    expect(references).toEqual(["fx-installment-3"]);
    expect(references).not.toContain("fx-purchase-total");
    expect(references).not.toContain("fx-card-payment");
    expect(JSON.stringify(result)).not.toContain("householdId");
  });
});
