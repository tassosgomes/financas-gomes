import { describe, expect, it } from "vitest";

import {
  DEFAULT_REVIEW_PAGE_LIMIT,
  REVIEWABLE_TRANSACTION_ORIGINS,
  TransactionReviewDomainError,
  createReviewCursor,
  decodeReviewCursor,
  encodeReviewCursor,
  hashReviewableTransactionFilters,
  isReviewableTransactionOrigin,
  parseListReviewableTransactionsQuery,
  parseTransactionReviewSummaryQuery,
  parseUpdateReviewableTransactionCommand,
  projectTransactionReview,
  transactionListItemReadModelSchema,
  transactionSourceSchema,
  type ReviewableTransactionOrigin,
} from "./review-contracts";

const ACCOUNT_ID = "00000000-0000-7000-8000-000000051101";
const CATEGORY_ID = "00000000-0000-7000-8000-000000051201";
const EVENT_ID = "00000000-0000-7000-8000-000000051301";
const IMPORT_ID = "00000000-0000-7000-8000-000000051401";
const HOUSEHOLD_ID = "00000000-0000-7000-8000-000000051501";

describe("review contract", () => {
  it("narrows the public origin to MANUAL and IMPORT", () => {
    const origin: ReviewableTransactionOrigin = "IMPORT";

    expect(REVIEWABLE_TRANSACTION_ORIGINS).toEqual(["MANUAL", "IMPORT"]);
    expect(origin).toBe("IMPORT");
    expect(isReviewableTransactionOrigin("SYSTEM")).toBe(false);
    expect(isReviewableTransactionOrigin("REVERSAL")).toBe(false);
  });

  it("projects the same review rule for posted, uncategorized and cancelled events", () => {
    expect(projectTransactionReview("POSTED", null)).toEqual({
      reviewState: "NEEDS_REVIEW",
      reviewReason: "UNCATEGORIZED",
      needsReview: true,
    });
    expect(projectTransactionReview("POSTED", CATEGORY_ID)).toEqual({
      reviewState: "ORGANIZED",
      reviewReason: null,
      needsReview: false,
    });
    expect(projectTransactionReview("CANCELLED", null)).toEqual({
      reviewState: "NOT_APPLICABLE",
      reviewReason: null,
      needsReview: false,
    });
  });

  it("accepts only safe manual/import source shapes", () => {
    expect(
      transactionSourceSchema.parse({ origin: "MANUAL", import: null }),
    ).toEqual({ origin: "MANUAL", import: null });
    expect(
      transactionSourceSchema.parse({
        origin: "IMPORT",
        import: { importId: IMPORT_ID, rowNumber: 2, externalId: null },
      }),
    ).toEqual({
      origin: "IMPORT",
      import: { importId: IMPORT_ID, rowNumber: 2, externalId: null },
    });

    expect(
      transactionSourceSchema.safeParse({
        origin: "IMPORT",
        import: {
          importId: IMPORT_ID,
          rowNumber: 2,
          externalId: null,
          token: "not-lineage",
        },
      }).success,
    ).toBe(false);
    expect(
      transactionSourceSchema.safeParse({ origin: "SYSTEM", import: null })
        .success,
    ).toBe(false);
  });

  it("canonicalizes URL-safe filters, null category and legacy date aliases", () => {
    const canonical = parseListReviewableTransactionsQuery({
      from: "2026-08-01",
      to: "2026-08-31",
      accountId: ` ${ACCOUNT_ID} `,
      categoryId: "__none",
      kind: "EXPENSE",
      status: "ALL",
      origin: "IMPORT",
      review: "NEEDS_REVIEW",
      search: "  café  ",
      limit: "7",
    });
    const aliases = parseListReviewableTransactionsQuery({
      dateFrom: "2026-08-01",
      periodEnd: "2026-08-31",
      accountId: ACCOUNT_ID,
      categoryId: null,
      kind: "EXPENSE",
      origin: "IMPORT",
      review: "NEEDS_REVIEW",
      search: "café",
      limit: 7,
    });

    expect(canonical).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
      accountId: ACCOUNT_ID,
      categoryId: null,
      kind: "EXPENSE",
      origin: "IMPORT",
      review: "NEEDS_REVIEW",
      search: "café",
      limit: 7,
    });
    expect(aliases).toEqual(canonical);
    expect(hashReviewableTransactionFilters(canonical)).toBe(
      hashReviewableTransactionFilters(aliases),
    );
  });

  it("uses the default limit and rejects unsafe/invalid query input", () => {
    expect(parseListReviewableTransactionsQuery({})).toEqual({
      limit: DEFAULT_REVIEW_PAGE_LIMIT,
    });

    expect(() =>
      parseListReviewableTransactionsQuery({ householdId: HOUSEHOLD_ID }),
    ).toThrowError(TransactionReviewDomainError);
    expect(() =>
      parseListReviewableTransactionsQuery({ limit: 0 }),
    ).toThrowError(TransactionReviewDomainError);
    expect(() =>
      parseListReviewableTransactionsQuery({ limit: 101 }),
    ).toThrowError(TransactionReviewDomainError);
    expect(() =>
      parseListReviewableTransactionsQuery({
        from: "2026-08-31",
        to: "2026-08-01",
      }),
    ).toThrowError(TransactionReviewDomainError);
    expect(() =>
      parseListReviewableTransactionsQuery({ categoryId: "null" }),
    ).toThrowError(TransactionReviewDomainError);
    expect(() =>
      parseListReviewableTransactionsQuery({ origin: "SYSTEM" }),
    ).toThrowError(TransactionReviewDomainError);
    expect(() =>
      parseListReviewableTransactionsQuery({ search: "\u0000" }),
    ).toThrowError(TransactionReviewDomainError);
  });

  it("keeps summary filters independent of review pagination", () => {
    expect(
      parseTransactionReviewSummaryQuery({
        categoryId: null,
        review: "NEEDS_REVIEW",
        limit: 1,
        cursor: "ignored-by-summary",
      }),
    ).toEqual({ categoryId: null });
  });

  it("accepts categoryId null but requires an editable command field", () => {
    expect(
      parseUpdateReviewableTransactionCommand({
        commandId: " review-command ",
        financialEventId: EVENT_ID,
        categoryId: null,
      }),
    ).toEqual({
      commandId: "review-command",
      financialEventId: EVENT_ID,
      categoryId: null,
    });
    expect(
      parseUpdateReviewableTransactionCommand({
        commandId: "review-command-2",
        financialEventId: EVENT_ID,
        description: "  Café   do   bairro ",
      }),
    ).toMatchObject({ description: "Café do bairro" });

    expect(() =>
      parseUpdateReviewableTransactionCommand({
        commandId: "review-command-3",
        financialEventId: EVENT_ID,
      }),
    ).toThrowError(TransactionReviewDomainError);
    try {
      parseUpdateReviewableTransactionCommand({
        commandId: "\u0000",
        financialEventId: EVENT_ID,
        categoryId: null,
      });
      throw new Error("expected command id rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_COMMAND_ID" });
    }
    expect(() =>
      parseUpdateReviewableTransactionCommand({
        commandId: "review-command-4",
        financialEventId: EVENT_ID,
        source: { origin: "MANUAL", import: null },
      }),
    ).toThrowError(TransactionReviewDomainError);
    try {
      parseUpdateReviewableTransactionCommand({
        commandId: "review-command-5",
        financialEventId: EVENT_ID,
        amountCents: "100",
        categoryId: null,
      });
      throw new Error("expected protected field rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "NON_EDITABLE_FIELD" });
    }
  });

  it("binds an opaque cursor to canonical filters and limit", () => {
    const query = parseListReviewableTransactionsQuery({
      from: "2026-08-01",
      limit: 2,
    });
    const cursor = createReviewCursor(
      { occurredOn: "2026-08-05", id: EVENT_ID },
      query,
    );

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(cursor).not.toContain("=");
    expect(decodeReviewCursor(cursor, {
      expectedFilterHash: hashReviewableTransactionFilters(query),
      expectedLimit: 2,
    })).toEqual({
      v: 1,
      occurredOn: "2026-08-05",
      id: EVENT_ID,
      filterHash: hashReviewableTransactionFilters(query),
      limit: 2,
    });
    expect(
      parseListReviewableTransactionsQuery({ ...query, cursor }),
    ).toMatchObject({ cursor });

    expect(() =>
      parseListReviewableTransactionsQuery({ ...query, limit: 3, cursor }),
    ).toThrowError(TransactionReviewDomainError);
    expect(() =>
      parseListReviewableTransactionsQuery({
        ...query,
        search: "different",
        cursor,
      }),
    ).toThrowError(TransactionReviewDomainError);
    expect(() => decodeReviewCursor("not-a-cursor")).toThrowError(
      TransactionReviewDomainError,
    );
    expect(() => {
      const invalidJson = "eyJ2IjoxLCI=";
      decodeReviewCursor(invalidJson);
    }).toThrowError(TransactionReviewDomainError);
    expect(() =>
      encodeReviewCursor({
        v: 1,
        occurredOn: "2026-08-05",
        id: EVENT_ID,
        filterHash: "0".repeat(64),
        limit: 0,
      }),
    ).toThrowError(TransactionReviewDomainError);
  });

  it("validates read-model review consistency and serializable fields", () => {
    const item = {
      id: EVENT_ID,
      householdId: HOUSEHOLD_ID,
      kind: "EXPENSE" as const,
      status: "POSTED" as const,
      origin: "MANUAL" as const,
      amountCents: "100",
      occurredOn: "2026-08-05",
      description: "Synthetic test event",
      accountId: ACCOUNT_ID,
      categoryId: null,
      account: {
        id: ACCOUNT_ID,
        householdId: HOUSEHOLD_ID,
        name: "Synthetic account",
        type: "CHECKING" as const,
        status: "ACTIVE" as const,
        spendability: "GENERAL" as const,
        liquidity: "IMMEDIATE" as const,
        includeInNetWorth: true,
        trackingStartedOn: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      category: null,
      entry: {
        id: "00000000-0000-7000-8000-000000051601",
        amountCents: "-100",
        status: "POSTED" as const,
        postedOn: "2026-08-05",
      },
      source: { origin: "MANUAL" as const, import: null },
      reviewState: "NEEDS_REVIEW" as const,
      reviewReason: "UNCATEGORIZED" as const,
      needsReview: true,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };

    expect(transactionListItemReadModelSchema.safeParse(item).success).toBe(
      true,
    );
    expect(
      transactionListItemReadModelSchema.safeParse({
        ...item,
        reviewState: "ORGANIZED",
        needsReview: false,
      }).success,
    ).toBe(false);
  });
});
