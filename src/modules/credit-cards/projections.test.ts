import { describe, expect, it } from "vitest";

import { allocateGlobalCardPayments } from "./projections";

describe("credit-card projection aggregators", () => {
  const buckets = [
    { period: "2026-08", minDueOn: "2026-08-20", totalAmountCents: BigInt(3334) },
    { period: "2026-09", minDueOn: "2026-09-20", totalAmountCents: BigInt(3333) },
    { period: "2026-10", minDueOn: "2026-10-20", totalAmountCents: BigInt(3333) },
  ] as const;

  it("allocates one global credit in due-date order without creating parcel payment state", () => {
    const allocation = allocateGlobalCardPayments(buckets, BigInt(4000));

    expect(allocation.get("2026-08")).toMatchObject({
      paidAmountCents: BigInt(3334),
      remainingAmountCents: BigInt(0),
      state: "PAID",
    });
    expect(allocation.get("2026-09")).toMatchObject({
      paidAmountCents: BigInt(666),
      remainingAmountCents: BigInt(2667),
      state: "PARTIALLY_PAID",
    });
    expect(allocation.get("2026-10")?.paidAmountCents).toBe(BigInt(0));
  });

  it("keeps overpayment as global credit after the full contractual schedule", () => {
    const allocation = allocateGlobalCardPayments(buckets, BigInt(12000));

    for (const period of ["2026-08", "2026-09", "2026-10"]) {
      expect(allocation.get(period)).toMatchObject({
        state: "CREDIT",
        creditAmountCents: BigInt(2000),
      });
    }
  });

  it("is deterministic even when input buckets are not ordered", () => {
    const reversed = [...buckets].reverse();
    const first = allocateGlobalCardPayments(buckets, BigInt(3334));
    const second = allocateGlobalCardPayments(reversed, BigInt(3334));
    expect([...second.entries()]).toEqual([...first.entries()]);
  });
});
