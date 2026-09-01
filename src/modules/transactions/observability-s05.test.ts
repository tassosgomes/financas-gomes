import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/observability/server", () => ({
  addBreadcrumbSafely: vi.fn(),
  captureServerException: vi.fn(),
}));

import {
  addBreadcrumbSafely,
  captureServerException,
} from "@/modules/observability/server";
import { FinancialContextError } from "@/modules/households/contracts";

import {
  classifyS05Error,
  createS05TransactionReviewOperation,
  getS05SlowQueryThresholdMs,
  isExpectedS05Error,
  logS05TransactionReviewOperation,
  measureS05Query,
  sanitizeS05TransactionReviewLog,
  toS05ErrorEnvelope,
  withS05TransactionReviewObservability,
} from "./observability-s05";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("S05 transaction review observability", () => {
  it("creates the four code-owned operation/query identifiers and an opaque request id", () => {
    const operation = createS05TransactionReviewOperation("list", {
      requestId: "request-opaque",
      eventId: "event-opaque",
      householdId: "household-opaque",
      origin: "ALL",
      transactionKind: "ALL",
    });

    expect(operation).toEqual({
      operation: "list",
      queryCode: "review_list",
      requestId: "request-opaque",
      eventId: "event-opaque",
      userId: undefined,
      householdId: "household-opaque",
      origin: "ALL",
      transactionKind: "ALL",
      statusCode: undefined,
    });
  });

  it("allow-lists aggregate metadata and drops every prohibited S05 field", () => {
    const safe = sanitizeS05TransactionReviewLog({
      operation: "detail",
      outcome: "success",
      requestId: "request-opaque",
      eventId: "event-opaque",
      householdId: "household-opaque",
      origin: "IMPORT",
      transactionKind: "EXPENSE",
      durationMs: 42.4,
      statusCode: 200,
      pageSize: 1,
      resultCount: 1,
      needsReviewCount: 7,
      hasNextPage: false,
      // These fields intentionally arrive as an untyped adapter object. They
      // must remain absent from the final record rather than be redacted in
      // place and accidentally forwarded later.
      search: "private search phrase",
      description: "private description",
      amount: "999999",
      accountName: "Conta privada",
      categoryName: "Categoria privada",
      externalId: "bank-external-private",
      cursor: "decoded-cursor-private",
      token: "bearer-private-token",
      CSV: "raw,csv,private",
      cookie: "session=private",
      Authorization: "Bearer private",
      payload: { description: "private", amount: "999999" },
      event: "caller-injected-event",
      useCase: "caller-injected-use-case",
      queryCode: "caller-injected-query-code" as never,
    });

    expect(safe).toEqual({
      event: "s05_transaction_review_detail_success",
      useCase: "transactions.review.detail",
      operation: "detail",
      queryCode: "review_detail",
      outcome: "success",
      requestId: "request-opaque",
      eventId: "event-opaque",
      householdId: "household-opaque",
      origin: "IMPORT",
      transactionKind: "EXPENSE",
      durationMs: 42,
      statusCode: 200,
      pageSize: 1,
      resultCount: 1,
      needsReviewCount: 7,
      hasNextPage: false,
    });

    const serialized = JSON.stringify(safe);
    for (const forbidden of [
      "private search phrase",
      "private description",
      "999999",
      "Conta privada",
      "Categoria privada",
      "bank-external-private",
      "decoded-cursor-private",
      "bearer-private-token",
      "raw,csv,private",
      "session=private",
      "Bearer private",
      "caller-injected-event",
      "caller-injected-use-case",
      "caller-injected-query-code",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    expect(safe).not.toHaveProperty("search");
    expect(safe).not.toHaveProperty("description");
    expect(safe).not.toHaveProperty("amount");
    expect(safe).not.toHaveProperty("externalId");
    expect(safe).not.toHaveProperty("cursor");
    expect(safe).not.toHaveProperty("payload");
  });

  it("rejects an unknown operation/outcome instead of serializing caller text", () => {
    expect(
      sanitizeS05TransactionReviewLog({
        operation: "search" as never,
        outcome: "success",
        description: "private description",
      }),
    ).toBeUndefined();

    expect(
      sanitizeS05TransactionReviewLog({
        operation: "list",
        outcome: "failed" as never,
        error: "private error",
      }),
    ).toBeUndefined();
  });

  it("classifies only ADR/S03 expected codes and never uses an exception message", () => {
    for (const error of [
      { code: "INVALID_QUERY", message: "search=private" },
      { code: "INVALID_CURSOR", message: "decoded cursor=private" },
      { code: "CATEGORY_NOT_FOUND", message: "category=private" },
      { code: "EVENT_NOT_REVIEWABLE", message: "amount=999999" },
      { code: "COMMAND_ID_REUSED", message: "payload=private" },
      new FinancialContextError("HOUSEHOLD_MEMBERSHIP_REQUIRED"),
    ]) {
      expect(classifyS05Error(error)).toMatchObject({
        outcome: "expected_error",
      });
      expect(isExpectedS05Error(error)).toBe(true);
    }

    const technical = new Error(
      "database failure search=private description=private amount=999999",
    );
    expect(classifyS05Error(technical)).toEqual({
      outcome: "unexpected_error",
      errorCode: "UNEXPECTED_ERROR",
    });
    expect(isExpectedS05Error(technical)).toBe(false);
    expect(classifyS05Error({ code: "NOT_AN_EXPECTED_CODE" })).toEqual({
      outcome: "unexpected_error",
      errorCode: "UNEXPECTED_ERROR",
    });
  });

  it("returns a code-only safe error envelope", () => {
    expect(toS05ErrorEnvelope({ code: "INVALID_QUERY", message: "search=private" })).toEqual({
      ok: false,
      error: { code: "INVALID_QUERY" },
    });
    expect(toS05ErrorEnvelope(new Error("private technical message"))).toEqual({
      ok: false,
      error: { code: "UNEXPECTED_ERROR" },
    });
  });

  it("logs expected Result failures without capturing them in Sentry", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(142);
    const operation = createS05TransactionReviewOperation("summary", {
      requestId: "request-opaque",
    });
    const result = {
      ok: false as const,
      error: {
        code: "INVALID_QUERY",
        message: "search=private must not be logged",
      },
    };

    await expect(
      withS05TransactionReviewObservability(operation, () => result, {
        now,
        needsReviewCount: 0,
      }),
    ).resolves.toBe(result);

    expect(captureServerException).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    const serialized = String(info.mock.calls[0]?.[0]);
    expect(serialized).toContain('"operation":"summary"');
    expect(serialized).toContain('"outcome":"expected_error"');
    expect(serialized).toContain('"errorCode":"INVALID_QUERY"');
    expect(serialized).not.toContain("search=private");
    expect(serialized).not.toContain("must not be logged");
  });

  it("captures only unexpected technical failures with sanitized context", async () => {
    const error = new Error(
      "database failure description=private amount=999999 externalId=private",
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(200)
      .mockReturnValueOnce(275);
    const operation = createS05TransactionReviewOperation("update", {
      requestId: "request-opaque",
      eventId: "event-opaque",
      householdId: "household-opaque",
      origin: "IMPORT",
      transactionKind: "INCOME",
    });

    await expect(
      withS05TransactionReviewObservability(
        operation,
        () => {
          throw error;
        },
        { now, technicalErrorCode: "UPDATE_FAILED" },
      ),
    ).rejects.toBe(error);

    expect(captureServerException).toHaveBeenCalledOnce();
    const sentryContext = vi.mocked(captureServerException).mock.calls[0]?.[1];
    expect(sentryContext).toMatchObject({
      event: "s05_transaction_review_update_unexpected_error",
      useCase: "transactions.review.update",
      operation: "update",
      entityType: "transaction",
      stage: "review_update",
      requestId: "request-opaque",
      eventId: "event-opaque",
      transactionKind: "INCOME",
      errorCode: "UPDATE_FAILED",
    });
    const serializedContext = JSON.stringify(sentryContext);
    expect(serializedContext).not.toContain("private");
    expect(serializedContext).not.toContain("999999");

    expect(errorLog).toHaveBeenCalledOnce();
    const serializedLog = String(errorLog.mock.calls[0]?.[0]);
    expect(serializedLog).toContain('"outcome":"unexpected_error"');
    expect(serializedLog).not.toContain("description=private");
    expect(serializedLog).not.toContain("999999");
    expect(serializedLog).not.toContain("externalId");
  });

  it("measures slow queries above the configured threshold and preserves results", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onSlowQuery = vi.fn();
    const onRecord = vi.fn();
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(350);
    const operation = createS05TransactionReviewOperation("list", {
      requestId: "request-opaque",
      origin: "ALL",
      transactionKind: "ALL",
    });

    await expect(
      measureS05Query(operation, () => "read-result", {
        thresholdMs: 250,
        now,
        pageSize: 50,
        resultCount: 50,
        hasNextPage: true,
        onRecord,
        onSlowQuery,
      }),
    ).resolves.toBe("read-result");

    expect(warn).toHaveBeenCalledOnce();
    expect(onRecord).toHaveBeenCalledOnce();
    expect(onSlowQuery).toHaveBeenCalledOnce();
    expect(onSlowQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryCode: "review_list",
        operation: "list",
        outcome: "success",
        durationMs: 350,
        slowQuery: true,
        slowQueryThresholdMs: 250,
        pageSize: 50,
        resultCount: 50,
        hasNextPage: true,
      }),
    );
    const serialized = String(warn.mock.calls[0]?.[0]);
    expect(serialized).not.toContain("search");
    expect(serialized).not.toContain("description");
    expect(serialized).not.toContain("cursor");
  });

  it("does not emit a slow-query record below threshold and keeps expected errors non-Sentry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onSlowQuery = vi.fn();
    const fastNow = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(249);
    const operation = createS05TransactionReviewOperation("detail", {
      requestId: "request-opaque",
    });

    await expect(
      measureS05Query(operation, () => "fast-result", {
        thresholdMs: 250,
        now: fastNow,
        onSlowQuery,
      }),
    ).resolves.toBe("fast-result");
    expect(warn).not.toHaveBeenCalled();
    expect(onSlowQuery).not.toHaveBeenCalled();

    const slowExpectedNow = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(300);
    const expected = { code: "INVALID_CURSOR", message: "cursor private" };
    await expect(
      measureS05Query(
        operation,
        () => {
          throw expected;
        },
        { thresholdMs: 250, now: slowExpectedNow, onSlowQuery },
      ),
    ).rejects.toBe(expected);

    expect(onSlowQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "expected_error",
        errorCode: "INVALID_CURSOR",
        slowQuery: true,
      }),
    );
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("bounds and reads the configurable threshold", () => {
    expect(getS05SlowQueryThresholdMs("900")).toBe(900);
    expect(getS05SlowQueryThresholdMs(0)).toBe(0);
    expect(getS05SlowQueryThresholdMs("999999")).toBe(60_000);
    expect(getS05SlowQueryThresholdMs("not-a-number")).toBe(250);
    expect(getS05SlowQueryThresholdMs(-10)).toBe(0);
  });

  it("emits a safe allow-listed record and breadcrumb for direct integrations", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = createS05TransactionReviewOperation("list", {
      requestId: "request-opaque",
      transactionKind: "EXPENSE",
    });

    const record = logS05TransactionReviewOperation(operation, "success", {
      durationMs: 12,
      pageSize: 2,
      resultCount: 2,
      search: "private search",
    } as never);

    expect(record).toMatchObject({
      event: "s05_transaction_review_list_success",
      useCase: "transactions.review.list",
      queryCode: "review_list",
      requestId: "request-opaque",
      transactionKind: "EXPENSE",
      durationMs: 12,
      pageSize: 2,
      resultCount: 2,
    });
    expect(info).toHaveBeenCalledOnce();
    expect(addBreadcrumbSafely).toHaveBeenCalledOnce();
    expect(JSON.stringify(record)).not.toContain("private search");
    expect(JSON.stringify(vi.mocked(addBreadcrumbSafely).mock.calls[0]?.[0])).not.toContain(
      "private search",
    );
  });
});
