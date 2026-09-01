import { describe, expect, it } from "vitest";

import {
  decodeReviewPageCursor,
  encodeReviewPageCursor,
  isReviewableEventShape,
  normalizeReviewReadQuery,
  projectReviewRow,
  reviewQueryFilterHash,
} from "./review-reads";

const ACCOUNT_ID = "00000000-0000-7000-8000-000000049101";
const EVENT_ID = "00000000-0000-7000-8000-000000049103";
const IMPORT_ID = "00000000-0000-7000-8000-000000049104";
const HOUSEHOLD_ID = "00000000-0000-7000-8000-000000049105";

const account = {
  id: ACCOUNT_ID,
  householdId: HOUSEHOLD_ID,
  name: "Conta sintética",
  type: "CHECKING" as const,
  status: "ACTIVE" as const,
  spendability: "GENERAL" as const,
  liquidity: "IMMEDIATE" as const,
  includeInNetWorth: true,
  trackingStartedOn: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function expectS05Error(action: () => unknown, code: string): void {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject({ code });
}

function row(
  origin: "MANUAL" | "IMPORT",
  lineage: {
    importId: string;
    rowNumber: number;
    externalId: string | null;
  } | null,
) {
  return {
    id: EVENT_ID,
    householdId: HOUSEHOLD_ID,
    kind: "EXPENSE" as const,
    status: "POSTED" as const,
    origin,
    amountCents: "100",
    occurredOn: "2026-08-05",
    description: "Despesa sintética",
    accountId: ACCOUNT_ID,
    categoryId: null,
    account,
    category: null,
    entry: {
      id: "00000000-0000-7000-8000-000000049106",
      amountCents: "-100",
      status: "POSTED" as const,
      postedOn: "2026-08-05",
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    lineage,
  };
}

describe("S05 review read helpers", () => {
  it("normalizes aliases and null category while rejecting household authority", () => {
    expect(
      normalizeReviewReadQuery({
        dateFrom: "2026-08-01",
        periodEnd: "2026-08-31",
        categoryId: "__none",
        limit: "3",
      }),
    ).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
      categoryId: null,
      limit: 3,
    });
    expectS05Error(
      () => normalizeReviewReadQuery({ householdId: HOUSEHOLD_ID }),
      "INVALID_QUERY",
    );
  });

  it("projects manual and imported rows without fabricating or dropping lineage", () => {
    const manual = projectReviewRow(row("MANUAL", null));
    expect(manual.source).toEqual({ origin: "MANUAL", import: null });
    expect(manual.reviewState).toBe("NEEDS_REVIEW");
    expect(manual.needsReview).toBe(true);

    const imported = projectReviewRow(
      row("IMPORT", {
        importId: IMPORT_ID,
        rowNumber: 2,
        externalId: "external-2",
      }),
    );
    expect(imported.source).toEqual({
      origin: "IMPORT",
      import: {
        importId: IMPORT_ID,
        rowNumber: 2,
        externalId: "external-2",
      },
    });
    expect(isReviewableEventShape(row("IMPORT", null))).toBe(false);
    expectS05Error(
      () =>
        projectReviewRow(
          row("MANUAL", {
            importId: IMPORT_ID,
            rowNumber: 2,
            externalId: null,
          }),
        ),
      "IMPORT_LINEAGE_INVALID",
    );
  });

  it("binds the cursor to the canonical query and stable date/id position", () => {
    const query = normalizeReviewReadQuery({ limit: 2, search: "café" });
    const cursor = encodeReviewPageCursor({
      occurredOn: "2026-08-05",
      id: EVENT_ID,
      filterHash: reviewQueryFilterHash(query),
      limit: 2,
    });
    expect(
      decodeReviewPageCursor(cursor, {
        expectedFilterHash: reviewQueryFilterHash(query),
        expectedLimit: 2,
      }),
    ).toMatchObject({ occurredOn: "2026-08-05", id: EVENT_ID, limit: 2 });
    expectS05Error(
      () => decodeReviewPageCursor(cursor, { ...query, search: "outro" }),
      "INVALID_CURSOR",
    );
  });
});
