import { describe, expect, it } from "vitest";

import {
  encodeTransactionReviewQuery,
  parseTransactionReviewQuery,
  withTransactionReviewQuery,
} from "./transaction-review-query";

const ACCOUNT_ID = "00000000-0000-7000-8000-000000071101";
const CATEGORY_ID = "00000000-0000-7000-8000-000000071201";
const CURSOR = "cursor-page-2";

describe("transaction review query boundary", () => {
  it("parses URLSearchParams and deterministically re-emits every filter", () => {
    const params = new URLSearchParams({
      from: "2026-08-01",
      to: "2026-08-31",
      accountId: ` ${ACCOUNT_ID} `,
      categoryId: "__none",
      kind: "EXPENSE",
      status: "POSTED",
      origin: "IMPORT",
      review: "NEEDS_REVIEW",
      search: "  café  ",
      limit: "7",
      cursor: CURSOR,
      householdId: "must-not-cross-the-boundary",
    });

    const parsed = parseTransactionReviewQuery(params);

    expect(parsed).toEqual({
      hadInvalidFilters: true,
      query: {
        from: "2026-08-01",
        to: "2026-08-31",
        accountId: ACCOUNT_ID,
        categoryId: null,
        kind: "EXPENSE",
        status: "POSTED",
        origin: "IMPORT",
        review: "NEEDS_REVIEW",
        search: "café",
        limit: 7,
        cursor: CURSOR,
      },
    });

    expect(encodeTransactionReviewQuery(parsed.query)).toBe(
      `from=2026-08-01&to=2026-08-31&accountId=${ACCOUNT_ID}&categoryId=__none&kind=EXPENSE&status=POSTED&origin=IMPORT&review=NEEDS_REVIEW&search=caf%C3%A9&limit=7&cursor=${CURSOR}`,
    );
  });

  it("ignores arrays and invalid values while retaining valid filters", () => {
    const parsed = parseTransactionReviewQuery({
      from: "2026-08-01",
      accountId: ACCOUNT_ID,
      categoryId: [CATEGORY_ID],
      kind: "UNKNOWN",
      status: "INVALID",
      origin: "SYSTEM",
      review: "NOT_APPLICABLE",
      search: "\u0000",
      limit: "101",
      cursor: "",
      householdId: "ignored",
    });

    expect(parsed).toEqual({
      hadInvalidFilters: true,
      query: {
        from: "2026-08-01",
        accountId: ACCOUNT_ID,
      },
    });
    expect(encodeTransactionReviewQuery(parsed.query)).toBe(
      `from=2026-08-01&accountId=${ACCOUNT_ID}`,
    );
  });

  it("drops an inverted period and normalizes no-op filters", () => {
    const parsed = parseTransactionReviewQuery({
      from: "2026-08-31",
      to: "2026-08-01",
      categoryId: null,
      status: "ALL",
      origin: "ALL",
      review: "ALL",
      limit: "007",
    });

    expect(parsed).toEqual({
      hadInvalidFilters: true,
      query: {
        categoryId: null,
        limit: 7,
      },
    });
    expect(encodeTransactionReviewQuery(parsed.query)).toBe(
      "categoryId=__none&limit=7",
    );
  });

  it("replaces a link query, preserves the canonical order, and keeps its hash", () => {
    const query = {
      search: "Café do bairro",
      cursor: CURSOR,
      accountId: ACCOUNT_ID,
    };

    expect(withTransactionReviewQuery("/transactions/evt?householdId=bad#top", query)).toBe(
      `/transactions/evt?accountId=${ACCOUNT_ID}&search=Caf%C3%A9+do+bairro&cursor=${CURSOR}#top`,
    );
  });
});
