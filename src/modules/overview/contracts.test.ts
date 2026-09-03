import { describe, expect, it } from "vitest";

import {
  OVERVIEW_CONTRACT_VERSION,
  OVERVIEW_UNCATEGORIZED_KEY,
  OVERVIEW_UNCATEGORIZED_LABEL,
  isOverviewCategoryGroup,
  isOverviewPeriod,
  overviewCents,
  overviewDate,
  parseOverviewPeriod,
} from "./contracts";
import { civilMonthPeriod } from "./period";

describe("overview contracts", () => {
  it("exposes the s10.v1 contract version", () => {
    expect(OVERVIEW_CONTRACT_VERSION).toBe("s10.v1");
  });

  it("parses signed overview cents without Number", () => {
    expect(overviewCents("-1250")).toBe(BigInt(-1250));
    expect(overviewCents("9223372036854775807")).toBe(
      BigInt("9223372036854775807"),
    );
  });

  it("rejects invalid dates and amounts", () => {
    expect(() => overviewDate("2026-02-30")).toThrow();
    expect(() => overviewCents("12.5")).toThrow();
  });

  it("validates overview periods", () => {
    const period = civilMonthPeriod("2026-09-15");
    expect(isOverviewPeriod(period)).toBe(true);
    expect(parseOverviewPeriod(period)).toEqual(period);
  });

  it("validates category groups with signed cents", () => {
    const group = {
      key: OVERVIEW_UNCATEGORIZED_KEY,
      label: OVERVIEW_UNCATEGORIZED_LABEL,
      amountCents: "-100",
      percent: 0,
      expenseEventCount: 1,
      purchaseEventCount: 0,
    };
    expect(isOverviewCategoryGroup(group)).toBe(true);
    expect(isOverviewCategoryGroup({ ...group, amountCents: 100 })).toBe(false);
  });
});
