import { describe, expect, it } from "vitest";

import { spendableCausalOriginHref, spendableOriginHref } from "./origins";

const SOURCE_ID = "00000000-0000-7000-8000-000000000001";
const RULE_ID = "00000000-0000-7000-8000-000000000002";

describe("T07 origin mapping", () => {
  it("delegates source references to the canonical server-authorized S07 route", () => {
    const href = spendableOriginHref({
      referenceId: SOURCE_ID,
      source: {
        kind: "RECURRING",
        referenceId: SOURCE_ID,
        label: "não vai para a URL",
        recurringRuleId: RULE_ID,
        occurrenceKey: "2026-09",
      },
    });

    expect(href).toBe(
      `/forecast/origin?kind=RECURRING&referenceId=${SOURCE_ID}&recurringRuleId=${RULE_ID}&occurrenceKey=2026-09`,
    );
    expect(href).not.toContain("household");
    expect(href).not.toContain("não vai");
  });

  it("preserves recurring hints in the causal DTO and leaves reserve origins unavailable", () => {
    const href = spendableCausalOriginHref({
      referenceId: SOURCE_ID,
      sourceKind: "RECURRING",
      date: "2026-09-02",
      amountCents: "100",
      direction: "OUTFLOW",
      status: "PLANNED",
      certainty: "COMMITTED",
      recurringRuleId: RULE_ID,
      occurrenceKey: "2026-09",
    });
    expect(href).toContain(`kind=RECURRING&referenceId=${SOURCE_ID}`);
    expect(href).toContain(`recurringRuleId=${RULE_ID}`);
    expect(href).toContain("occurrenceKey=2026-09");

    expect(
      spendableCausalOriginHref({
        referenceId: "reserve-private-reference",
        sourceKind: "RESERVE",
        date: "2026-09-01",
        amountCents: "100",
        direction: "OUTFLOW",
        status: null,
        certainty: null,
      }),
    ).toBeNull();
  });
});

