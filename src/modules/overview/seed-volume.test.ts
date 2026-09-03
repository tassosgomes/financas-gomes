import { describe, expect, it } from "vitest";

import {
  expectedS10SeptemberCardGroupCents,
  S10_VOLUME_EXPECTED_INDEXES,
} from "../../../tests/fixtures/s10-visao-consolidada/seed";

describe("S10 volume seed expectations", () => {
  it("sums September aCard as two recurring expenses plus the purchase", () => {
    expect(expectedS10SeptemberCardGroupCents()).toBe("368900");
  });

  it("lists tenant-aware household indexes including covering S05 variants", () => {
    expect(S10_VOLUME_EXPECTED_INDEXES).toContain(
      "financial_events_household_occurred_on_idx",
    );
    expect(S10_VOLUME_EXPECTED_INDEXES).toContain(
      "financial_events_household_category_occurred_on_id_idx",
    );
  });
});
