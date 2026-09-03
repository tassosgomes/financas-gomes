import { describe, expect, it } from "vitest";

import {
  readForecastInstallmentsForContext,
  readForecastOpeningBalanceForContext,
  readForecastSourcesForContext,
  ForecastSourceError,
  type ForecastReadExecutor,
} from "./sources";

const context = { userId: "user-a", householdId: "household-a" } as const;
const noDatabase = {} as ForecastReadExecutor;

describe("T04 source read boundaries", () => {
  it("rejects malformed opening dates before touching the executor", async () => {
    await expect(
      readForecastOpeningBalanceForContext(context, "2026-02-30", {
        database: noDatabase,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_DATE",
      field: "from",
    } satisfies Partial<ForecastSourceError>);
  });

  it("rejects inverted ranges for every source boundary", async () => {
    const range = { from: "2026-10-01", to: "2026-09-01" } as const;
    await expect(
      readForecastInstallmentsForContext(context, range, { database: noDatabase }),
    ).rejects.toMatchObject({ code: "INVALID_DATE_RANGE", field: "from" });
    await expect(
      readForecastSourcesForContext(context, range, { database: noDatabase }),
    ).rejects.toMatchObject({ code: "INVALID_DATE_RANGE", field: "from" });
  });

  it("enforces the authenticated context before constructing any query", async () => {
    const invalidContext = { userId: "", householdId: "household-a" };
    await expect(
      readForecastSourcesForContext(invalidContext, {
        from: "2026-09-01",
        to: "2026-09-30",
      }, { database: noDatabase }),
    ).rejects.toMatchObject({ code: "INVALID_FINANCIAL_CONTEXT" });
  });
});
