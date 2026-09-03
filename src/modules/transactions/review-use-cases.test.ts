import { describe, expect, it } from "vitest";

import {
  TransactionReviewDomainError,
  parseUpdateReviewableTransactionCommand,
  projectTransactionReview,
} from "./review-contracts";
import {
  assertReviewableUpdatePolicy,
  buildReviewUpdateSet,
  canonicalReviewUpdatePayload,
  hashReviewUpdateCommand,
  parseReviewUpdateCommand,
} from "./review-use-cases";

const eventId = "018f47b7-6c3a-7abc-8def-1234567890ad";
const categoryId = "018f47b7-6c3a-7abc-8def-1234567890ae";

describe("T05 review update use-case boundary", () => {
  it("normalizes editable fields and rejects protected fields", () => {
    expect(
      parseReviewUpdateCommand({
        commandId: " review-1 ",
        financialEventId: ` ${eventId} `,
        description: "  Café   do   bairro ",
        categoryId: ` ${categoryId} `,
      }),
    ).toEqual({
      commandId: "review-1",
      financialEventId: eventId,
      description: "Café do bairro",
      categoryId,
    });

    expect(() =>
      parseUpdateReviewableTransactionCommand({
        commandId: "review-2",
        financialEventId: eventId,
        amountCents: "100",
        categoryId: null,
      }),
    ).toThrowError(TransactionReviewDomainError);
    expect(() =>
      parseUpdateReviewableTransactionCommand({
        commandId: "review-3",
        financialEventId: eventId,
      }),
    ).toThrowError(TransactionReviewDomainError);
  });

  it("hashes only the effective normalized payload and excludes commandId", () => {
    const first = parseReviewUpdateCommand({
      commandId: "review-4",
      financialEventId: eventId,
      description: "Café",
      categoryId: null,
    });
    const retry = parseReviewUpdateCommand({
      categoryId: null,
      description: " Café ",
      financialEventId: eventId,
      commandId: "different-command",
    });

    expect(canonicalReviewUpdatePayload(first)).toEqual({
      financialEventId: eventId,
      description: "Café",
      categoryId: null,
    });
    expect(hashReviewUpdateCommand(first)).toBe(hashReviewUpdateCommand(retry));
  });

  it("builds a metadata-only update set and preserves category null", () => {
    const updatedAt = new Date("2026-08-30T12:00:00.000Z");
    const update = buildReviewUpdateSet(
      parseUpdateReviewableTransactionCommand({
        commandId: "review-5",
        financialEventId: eventId,
        description: "Descrição",
        categoryId: null,
      }),
      updatedAt,
    );

    expect(update).toEqual({
      description: "Descrição",
      categoryId: null,
      updatedAt,
    });
    expect(Object.keys(update).sort()).toEqual([
      "categoryId",
      "description",
      "updatedAt",
    ]);
    expect(update.updatedAt).not.toBe(updatedAt);
  });

  it("allows only posted expense/income manual/import events", () => {
    for (const origin of ["MANUAL", "IMPORT"] as const) {
      expect(() =>
        assertReviewableUpdatePolicy(
          { status: "POSTED", kind: "EXPENSE", origin },
          origin === "IMPORT" ? 1 : 0,
        ),
      ).not.toThrow();
    }

    for (const event of [
      { status: "CANCELLED", kind: "EXPENSE", origin: "MANUAL" },
      { status: "POSTED", kind: "REVERSAL", origin: "SYSTEM" },
      { status: "POSTED", kind: "EXPENSE", origin: "SYSTEM" },
    ]) {
      expect(() => assertReviewableUpdatePolicy(event, 0)).toThrowError(
        TransactionReviewDomainError,
      );
    }

    expect(() =>
      assertReviewableUpdatePolicy(
        { status: "POSTED", kind: "INCOME", origin: "IMPORT" },
        0,
      ),
    ).toThrowError(TransactionReviewDomainError);
    expect(() =>
      assertReviewableUpdatePolicy(
        { status: "POSTED", kind: "INCOME", origin: "IMPORT" },
        2,
      ),
    ).toThrowError(TransactionReviewDomainError);
  });

  it("projects category null as a pending review without changing money", () => {
    expect(projectTransactionReview("POSTED", null)).toEqual({
      reviewState: "NEEDS_REVIEW",
      reviewReason: "UNCATEGORIZED",
      needsReview: true,
    });
  });
});

