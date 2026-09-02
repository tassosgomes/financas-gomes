import { describe, expect, it } from "vitest";

import {
  SPENDABLE_FIXTURE_IDS,
  SPENDABLE_FIXTURES,
  cardPaymentNotSourceSpendableFixture,
  getSpendableFixture,
  installmentsOnceSpendableFixture,
  realizedOnceSpendableFixture,
  reliableIncomeScenarioFixture,
  yearBoundarySpendableFixture,
} from "./fixtures";
import { normalizeSpendableTimeline } from "./timeline";

describe("S08 T02 reusable fixture matrix", () => {
  it("publishes unique IDs for every acceptance scenario", () => {
    expect(SPENDABLE_FIXTURES).toHaveLength(SPENDABLE_FIXTURE_IDS.length);
    expect(new Set(SPENDABLE_FIXTURES.map(({ id }) => id)).size).toBe(
      SPENDABLE_FIXTURES.length,
    );
    expect(SPENDABLE_FIXTURES.map(({ id }) => id)).toEqual([...SPENDABLE_FIXTURE_IDS]);
  });

  it("distinguishes reliable income in conservative from uncertain income in expected", () => {
    const conservative = reliableIncomeScenarioFixture.variants.CONSERVATIVE;
    const expected = reliableIncomeScenarioFixture.variants.EXPECTED;
    const conservativeRefs = normalizeSpendableTimeline(conservative.timeline).items.map(
      ({ referenceId }) => referenceId,
    );
    const expectedRefs = normalizeSpendableTimeline(expected.timeline).items.map(
      ({ referenceId }) => referenceId,
    );

    expect(conservativeRefs).toContain("fx-income-reliable");
    expect(conservativeRefs).not.toContain("fx-income-uncertain");
    expect(expectedRefs).toContain("fx-income-reliable");
    expect(expectedRefs).toContain("fx-income-uncertain");
  });

  it("keeps a realized obligation and each installment as one normalized item", () => {
    const realized = normalizeSpendableTimeline(realizedOnceSpendableFixture.timeline);
    expect(realized.items.map(({ referenceId }) => referenceId)).toEqual([
      "fx-realized-expense",
    ]);
    expect(realizedOnceSpendableFixture.excludedReferenceIds).toEqual([
      "fx-planned-expense",
    ]);

    const installments = normalizeSpendableTimeline(installmentsOnceSpendableFixture.timeline);
    expect(installments.items.map(({ referenceId }) => referenceId)).toEqual([
      "fx-installment-1",
      "fx-installment-2",
      "fx-installment-3",
    ]);
    expect(installmentsOnceSpendableFixture.excludedReferenceIds).toEqual([
      "fx-purchase-total",
      "fx-card-payment",
    ]);
  });

  it("covers card payment exclusion and the year transition with serializable fixture data", () => {
    expect(cardPaymentNotSourceSpendableFixture.excludedReferenceIds).toEqual([
      "fx-purchase-total",
      "fx-card-payment",
      "fx-invoice-total",
    ]);
    const year = normalizeSpendableTimeline(yearBoundarySpendableFixture.timeline);
    expect(year.days.map(({ date }) => date.toString())).toEqual([
      "2026-12-31",
      "2027-01-01",
    ]);
    expect(() => JSON.stringify(yearBoundarySpendableFixture.timeline)).not.toThrow();
  });

  it("resolves fixtures by opaque ID and keeps fixture values in cents strings", () => {
    const fixture = getSpendableFixture("positive");
    expect(fixture.openingBalanceCents).toMatch(/^\d+$/u);
    expect(fixture.expected.rawSpendableCents).toMatch(/^-?\d+$/u);
    expect(() => getSpendableFixture("missing-fixture")).toThrow();
  });
});
