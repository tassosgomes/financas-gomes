import { describe, expect, it } from "vitest";

import {
  isSpendableBreakdown,
  parseSpendableBreakdown,
  spendableDate,
  spendableMoney,
} from "./contracts";

function breakdown(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "s08.v1",
    ruleVersion: "spendable.v1",
    period: {
      asOf: "2026-09-01",
      from: "2026-09-02",
      to: "2026-12-01",
      horizonDays: 90,
      scenario: "CONSERVATIVE",
      forecastContractVersion: "s07.v1",
    },
    openingBalanceCents: "800000",
    openingAdjustmentsCents: "0",
    openingProjectedBalanceCents: "800000",
    closingProjectedBalanceCents: "800000",
    minimumProjectedBalanceCents: "800000",
    minimum: {
      projectedBalanceCents: "800000",
      points: [
        {
          kind: "OPENING",
          date: "2026-09-01",
          projectedBalanceCents: "800000",
          references: [],
          items: [],
        },
      ],
    },
    operationalBuffer: {
      amountCents: "100000",
      source: "CONFIGURED",
      effectiveFrom: "2026-08-01",
      revision: "fx-buffer-revision",
    },
    reserve: {
      contractVersion: "s09.v1",
      status: "UNAVAILABLE",
      protectedCents: "0",
      appliedOpeningAdjustmentCents: "0",
      components: [],
    },
    rawSpendableCents: "700000",
    displaySpendableCents: "700000",
    deficitToPreserveReserveCents: "0",
    ...overrides,
  };
}

describe("S08 T02 serializable contracts", () => {
  it("validates the ADR-011 DTO and its cent invariants", () => {
    const value = breakdown();
    expect(parseSpendableBreakdown(value)).toEqual(value);
    expect(isSpendableBreakdown(value)).toBe(true);
    expect(isSpendableBreakdown({ ...value, rawSpendableCents: "1" })).toBe(false);
  });

  it("rejects financial numbers, malformed dates and unknown DTO fields", () => {
    const value = breakdown();
    expect(isSpendableBreakdown({ ...value, openingBalanceCents: 800000 })).toBe(false);
    expect(isSpendableBreakdown({ ...value, unknown: "not-in-contract" })).toBe(false);
    expect(() => spendableDate("2026-02-30")).toThrow();
    expect(() => spendableDate(new Date("2026-09-01"))).toThrow();
    expect(spendableMoney("9223372036854775807").toCentsString()).toBe(
      "9223372036854775807",
    );
  });
});
