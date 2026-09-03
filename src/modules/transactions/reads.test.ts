import { describe, expect, it } from "vitest";

import { TransactionDomainError } from "./contracts";
import {
  parseListAccountMovementsQuery,
  parseListManualTransactionsQuery,
} from "./reads";

const ACCOUNT_ID = "00000000-0000-7000-8000-000000061101";
const CATEGORY_ID = "00000000-0000-7000-8000-000000061201";

describe("transaction read query contracts", () => {
  it("normalizes serializable URL aliases into the canonical manual filter", () => {
    expect(
      parseListManualTransactionsQuery({
        dateFrom: "2026-08-01",
        periodEnd: "2026-08-31",
        accountId: ` ${ACCOUNT_ID} `,
        categoryId: CATEGORY_ID,
        type: "EXPENSE",
        status: "CANCELLED",
      }),
    ).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
      kind: "EXPENSE",
      status: "CANCELLED",
      origin: "MANUAL",
    });
  });

  it("supports an explicit uncategorized filter and all statuses", () => {
    expect(
      parseListManualTransactionsQuery({
        categoryId: null,
        status: "ALL",
      }),
    ).toEqual({ categoryId: null, origin: "MANUAL" });
  });

  it("accepts reversal movements in account statements", () => {
    expect(
      parseListAccountMovementsQuery({
        from: "2026-08-01",
        to: "2026-08-31",
        kind: "REVERSAL",
      }),
    ).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
      kind: "REVERSAL",
    });
  });

  it("rejects an inverted period and invalid resource filters", () => {
    expect(() =>
      parseListManualTransactionsQuery({
        from: "2026-09-01",
        to: "2026-08-31",
      }),
    ).toThrowError(TransactionDomainError);

    expect(() =>
      parseListManualTransactionsQuery({ accountId: "not-a-uuid" }),
    ).toThrowError(TransactionDomainError);
  });
});

