import { describe, expect, it } from "vitest";

import type { SpendableCausalItem, SpendableCausalPoint } from "./contracts";
import {
  decodeSpendableCausalCursor,
  encodeSpendableCausalCursor,
  paginateSpendableCausalItems,
  paginateSpendableCausalPoints,
} from "./causality";

function item(referenceId: string): SpendableCausalItem {
  return {
    referenceId,
    sourceKind: "PLANNED_EVENT",
    date: "2026-09-02",
    amountCents: "100",
    direction: "OUTFLOW",
    status: "PLANNED",
    certainty: "COMMITTED",
  };
}

function point(referenceId: string, items: readonly SpendableCausalItem[]): SpendableCausalPoint {
  return {
    kind: "DAY_CLOSE",
    date: "2026-09-02",
    projectedBalanceCents: "900",
    references: [referenceId],
    items,
  };
}

describe("T07 causal page", () => {
  it("uses an opaque, versioned cursor without copying a financial reference", () => {
    const cursor = encodeSpendableCausalCursor({ offset: 2, limit: 1 });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(cursor).not.toContain("private-reference");
    expect(decodeSpendableCausalCursor(cursor)).toEqual({
      v: 1,
      offset: 2,
      limit: 1,
    });
  });

  it("reports the aggregate count and deterministic continuation when truncating", () => {
    const values = [item("cause-a"), item("cause-b"), item("cause-c")];
    const first = paginateSpendableCausalItems(values, { limit: 2 });
    expect(first.items.map(({ referenceId }) => referenceId)).toEqual([
      "cause-a",
      "cause-b",
    ]);
    expect(first.pageInfo).toMatchObject({
      totalCount: 3,
      returnedCount: 2,
      limit: 2,
      truncated: true,
    });
    expect(first.pageInfo.nextCursor).toBeTypeOf("string");

    const second = paginateSpendableCausalItems(values, {
      limit: 2,
      cursor: first.pageInfo.nextCursor,
    });
    expect(second.items.map(({ referenceId }) => referenceId)).toEqual(["cause-c"]);
    expect(second.pageInfo).toMatchObject({
      totalCount: 3,
      returnedCount: 1,
      truncated: true,
      nextCursor: null,
    });
  });

  it("pages across tied points while retaining each minimum point", () => {
    const firstPoint = point("cause-a", [item("cause-a"), item("cause-b")]);
    const secondPoint = point("cause-c", [item("cause-c")]);
    const first = paginateSpendableCausalPoints([firstPoint, secondPoint], { limit: 1 });
    expect(first.points.map(({ references }) => references)).toEqual([["cause-a"], []]);
    expect(first.points.map(({ items }) => items.map(({ referenceId }) => referenceId))).toEqual([
      ["cause-a"],
      [],
    ]);

    const second = paginateSpendableCausalPoints(
      [firstPoint, secondPoint],
      { limit: 1, cursor: first.pageInfo.nextCursor },
    );
    expect(second.points.map(({ references }) => references)).toEqual([["cause-b"], []]);
    expect(second.points[0]?.items[0]?.referenceId).toBe("cause-b");
    expect(second.pageInfo.nextCursor).toBeTypeOf("string");

    const third = paginateSpendableCausalPoints(
      [firstPoint, secondPoint],
      { limit: 1, cursor: second.pageInfo.nextCursor },
    );
    expect(third.points.map(({ references }) => references)).toEqual([[], ["cause-c"]]);
    expect(third.pageInfo.nextCursor).toBeNull();
  });

  it("rejects malformed cursors and unsafe limits", () => {
    expect(() => decodeSpendableCausalCursor("not-a-valid-cursor")).toThrow();
    expect(() => paginateSpendableCausalItems([item("cause-a")], { limit: 0 })).toThrow();
    expect(() => paginateSpendableCausalItems([item("cause-a")], { limit: 1, cursor: "bad" })).toThrow();
  });
});

