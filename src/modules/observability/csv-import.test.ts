import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/observability/server", () => ({
  addBreadcrumbSafely: vi.fn(),
  captureServerException: vi.fn(),
}));

import {
  addBreadcrumbSafely,
  captureServerException,
} from "@/modules/observability/server";
import {
  CSV_IMPORT_EXPECTED_ERROR_CODES,
  createCsvImportOperation,
  expectedCsvImportErrorCode,
  isExpectedCsvImportError,
  logCsvImportOperation,
  reportCsvImportUnexpectedError,
  sanitizeCsvImportObservabilityCounts,
  sanitizeCsvImportImportLog,
  toCsvImportObservabilityContext,
  withCsvImportObservability,
} from "./csv-import";

const previewId = "018f4f26-7c1b-7abc-8a7f-56d2b1a89f0e";
const importId = "018f4f26-7c1b-7abc-8a7f-56d2b1a89f0f";
const counts = {
  processed: 3,
  valid: 2,
  invalid: 1,
  ignoredDuplicate: 0,
  imported: 2,
};

describe("import observability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(addBreadcrumbSafely).mockClear();
    vi.mocked(captureServerException).mockClear();
  });

  it("normalizes stages and keeps only technical context", () => {
    const operation = createCsvImportOperation("confirmation", {
      requestId: "request-opaque",
      previewId,
      importId,
      accountId: "account-opaque",
      userId: "user-opaque",
      householdId: "household-opaque",
      counts,
      amount: "123456",
      description: "private salary",
      filename: "extrato-real.csv",
      previewToken: "raw-bearer-token",
      payload: { amountCents: "123456" },
    });

    expect(operation).toMatchObject({
      stage: "confirmation",
      operation: "confirm",
      requestId: "request-opaque",
      previewId,
      importId,
      counts,
    });
    expect(operation).not.toHaveProperty("amount");
    expect(operation).not.toHaveProperty("description");
    expect(operation).not.toHaveProperty("filename");
    expect(operation).not.toHaveProperty("previewToken");
    expect(operation).not.toHaveProperty("payload");
  });

  it("emits aggregate logs and breadcrumbs without financial payload", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = createCsvImportOperation("preview", {
      requestId: "request-opaque",
      previewId,
    });

    logCsvImportOperation(operation, "success", 42.4, counts);

    expect(info).toHaveBeenCalledOnce();
    const serialized = String(info.mock.calls[0]?.[0]);
    expect(serialized).toContain('"stage":"preview"');
    expect(serialized).toContain('"operation":"preview"');
    expect(serialized).toContain('"outcome":"success"');
    expect(serialized).toContain('"processedRows":3');
    expect(serialized).toContain('"validRows":2');
    expect(serialized).toContain('"invalidRows":1');
    expect(serialized).toContain('"importedRows":2');
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("extrato");
    expect(serialized).not.toContain("token");

    expect(addBreadcrumbSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "transactions.import.preview",
        data: expect.objectContaining({
          stage: "preview",
          outcome: "success",
          processed_rows: 3,
          valid_rows: 2,
          invalid_rows: 1,
          imported_rows: 2,
        }),
      }),
    );
  });

  it("captures unexpected failures with stage, code, IDs, duration and counts", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(
      new Error("insert failed amount=123456 description=private"),
      { code: "IMPORT_PERSISTENCE_FAILED" },
    );
    const operation = createCsvImportOperation("confirmation", {
      requestId: "request-opaque",
      previewId,
      importId,
    });

    reportCsvImportUnexpectedError(error, operation, 17.8, counts);

    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        stage: "confirmation",
        operation: "confirm",
        errorCode: "IMPORT_PERSISTENCE_FAILED",
        previewId,
        importId,
        durationMs: 18,
        processedRows: 3,
        validRows: 2,
      }),
    );
    expect(errorLog).toHaveBeenCalledOnce();
    const serialized = String(errorLog.mock.calls[0]?.[0]);
    expect(serialized).toContain('"outcome":"unexpected_error"');
    expect(serialized).toContain('"errorCode":"IMPORT_PERSISTENCE_FAILED"');
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("private");
  });

  it("classifies all ADR validation errors as expected and never captures them", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = createCsvImportOperation("parse");

    for (const code of CSV_IMPORT_EXPECTED_ERROR_CODES) {
      expect(isExpectedCsvImportError({ code })).toBe(true);
      expect(expectedCsvImportErrorCode({ code })).toBe(code);
      reportCsvImportUnexpectedError(
        { code, message: "raw amount=123456 description=private" },
        operation,
        5,
        counts,
      );
    }

    expect(captureServerException).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(CSV_IMPORT_EXPECTED_ERROR_CODES.length);
    const serialized = info.mock.calls.map(([value]) => String(value)).join("\n");
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("private");
  });

  it("does not forward request/body-like keys into Sentry context", () => {
    const operation = createCsvImportOperation("upload", {
      requestId: "request-opaque",
      accountId: "account-opaque",
      previewToken: "raw-token",
      filename: "real-file.csv",
      csv: "occurred_on,description,amount_cents",
      body: { description: "private", amount: 1234 },
    });
    const context = toCsvImportObservabilityContext(operation, "unexpected_error", {
      ...counts,
      payload: { description: "private", amount: "1234" },
    } as never);
    const serialized = JSON.stringify(context);

    expect(serialized).toContain("request-opaque");
    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain("real-file.csv");
    expect(serialized).not.toContain("occurred_on");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("1234");
    expect(context.processedRows).toBe(3);
  });

  it("normalizes counters and logs expected errors through the wrapper", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect(
      sanitizeCsvImportObservabilityCounts({
        processedRows: 3.4,
        valid_rows: 2,
        invalid: -1,
        ignoredDuplicate: Number.POSITIVE_INFINITY,
        imported: 2,
        rows: [{ description: "private" }],
      }),
    ).toEqual({
      processed: 3,
      valid: 2,
      invalid: 0,
      ignoredDuplicate: 0,
      imported: 2,
    });

    const operation = createCsvImportOperation("parse");
    const expectedError = { code: "CSV_INVALID_UTF8" };
    await expect(
      withCsvImportObservability(operation, () => {
        throw expectedError;
      }, { counts }),
    ).rejects.toBe(expectedError);

    expect(captureServerException).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    expect(String(info.mock.calls[0]?.[0])).toContain('"outcome":"expected_error"');
  });

  it("rejects an unrecognized stage/operation rather than logging arbitrary input", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const safe = sanitizeCsvImportImportLog({
      stage: "preview",
      operation: "delete" as never,
      outcome: "success",
      description: "private",
    });

    expect(safe).toBeUndefined();
    expect(info).not.toHaveBeenCalled();
  });
});
