import { describe, expect, it } from "vitest";

import {
  formatSignedCents,
  hasActiveTransactionFilters,
  parseTransactionsSearchParams,
  transactionDetailHref,
  transactionsHref,
} from "./transaction-listing-utils";

const ACCOUNT_ID = "00000000-0000-7000-8000-000000061101";
const CATEGORY_ID = "00000000-0000-7000-8000-000000061201";
const EVENT_ID = "00000000-0000-7000-8000-000000061301";

describe("transaction listing UI boundary", () => {
  it("normalizes URL filters and preserves them in list/detail links", () => {
    const parsed = parseTransactionsSearchParams({
      from: "2026-08-01",
      to: "2026-08-31",
      accountId: ` ${ACCOUNT_ID} `,
      categoryId: CATEGORY_ID,
      kind: "EXPENSE",
      status: "CANCELLED",
    });

    expect(parsed).toEqual({
      hadInvalidFilters: false,
      query: {
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_ID,
        from: "2026-08-01",
        kind: "EXPENSE",
        origin: "MANUAL",
        status: "CANCELLED",
        to: "2026-08-31",
      },
    });
    expect(transactionsHref(parsed.query)).toBe(
      `/transactions?from=2026-08-01&to=2026-08-31&accountId=${ACCOUNT_ID}&categoryId=${CATEGORY_ID}&kind=EXPENSE&status=CANCELLED`,
    );
    expect(transactionDetailHref(EVENT_ID, parsed.query)).toContain(
      `/transactions/${EVENT_ID}?from=2026-08-01&to=2026-08-31`,
    );
  });

  it("ignores malformed filters without turning them into tenant input", () => {
    const parsed = parseTransactionsSearchParams({
      accountId: "not-a-uuid",
      from: "not-a-date",
      status: "UNKNOWN",
      type: ["EXPENSE", "INCOME"],
    });

    expect(parsed).toEqual({
      hadInvalidFilters: true,
      query: { origin: "MANUAL" },
    });
  });

  it("drops an inverted period but keeps independently valid filters", () => {
    const parsed = parseTransactionsSearchParams({
      from: "2026-09-01",
      to: "2026-08-31",
      kind: "INCOME",
    });

    expect(parsed.hadInvalidFilters).toBe(true);
    expect(parsed.query).toEqual({ kind: "INCOME", origin: "MANUAL" });
  });

  it("supports deliberate uncategorized filtering and detects active filters", () => {
    const parsed = parseTransactionsSearchParams({
      categoryId: "__none",
      status: "ALL",
    });

    expect(parsed).toEqual({
      hadInvalidFilters: false,
      query: { categoryId: null, origin: "MANUAL" },
    });
    expect(hasActiveTransactionFilters(parsed.query)).toBe(true);
  });

  it("formats signed cents exactly in Brazilian currency notation", () => {
    expect(formatSignedCents("+3000")).toBe("+R$ 30,00");
    expect(formatSignedCents("-1250")).toBe("-R$ 12,50");
    expect(formatSignedCents("900719925474099301")).toBe(
      "+R$ 9.007.199.254.740.993,01",
    );
  });
});
