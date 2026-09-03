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
  S11_CONTRACT_VERSION,
  S11_EXPECTED_ERROR_CODES,
  S11_OPERATIONS,
  classifyS11Error,
  createS11Operation,
  getS11DatasetSlowThresholdMs,
  getS11ExportSlowThresholdMs,
  instrumentS11ExportBoundary,
  logS11JobFinish,
  logS11JobStart,
  logS11Operation,
  measureS11DatasetRead,
  reportS11UnexpectedError,
  sanitizeS11AggregateFields,
  sanitizeS11Log,
  toS11ErrorEnvelope,
  toS11ObservabilityContext,
  withJobAttempt,
  withS11Observability,
  wrapDatasetRead,
} from "./s11";

describe("S11 safe observability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(addBreadcrumbSafely).mockClear();
    vi.mocked(captureServerException).mockClear();
  });

  it("creates versioned operation metadata without financial input", () => {
    const operation = createS11Operation("export.dataset", {
      requestId: "request-opaque",
      datasetId: "accounts",
      rowCount: 120,
      byteCount: 4096,
      amountCents: "999999",
      balanceCents: "999999",
      name: "Conta privada",
      description: "descrição privada",
      category: "categoria privada",
      householdId: "household-private",
      userId: "user-private",
      email: "user@example.com",
      fileName: "conta-corrente-privada.csv",
      payload: { amountCents: "999999" },
      sql: "SELECT amount_cents FROM accounts",
      authorization: "Bearer private-token",
      cookie: "session=private",
    });

    expect(operation).toMatchObject({
      operation: "export.dataset",
      stage: "dataset",
      contractVersion: S11_CONTRACT_VERSION,
      requestId: "request-opaque",
      datasetId: "accounts",
      rowCount: 120,
      byteCount: 4096,
    });

    const serialized = JSON.stringify(operation);
    for (const forbidden of [
      "999999",
      "Conta privada",
      "descrição privada",
      "categoria privada",
      "household-private",
      "user-private",
      "user@example.com",
      "conta-corrente-privada",
      "SELECT amount_cents",
      "private-token",
      "session=private",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(operation).not.toHaveProperty("amountCents");
    expect(operation).not.toHaveProperty("payload");
    expect(operation).not.toHaveProperty("sql");
  });

  it("rebuilds code-owned fields and rejects unknown or mismatched values", () => {
    const safe = sanitizeS11Log({
      operation: "export.request",
      stage: "request",
      outcome: "success",
      requestId: "request-opaque",
      correlationId: "correlation-ignored",
      contractVersion: S11_CONTRACT_VERSION,
      result: "SUCCESS",
      datasetCount: 17,
      rowCount: 10_000,
      byteCount: 1_048_576,
      durationMs: 5_001.4,
      statusCode: 200,
      event: "caller-event",
      useCase: "caller-use-case",
      amountCents: "123456",
      balance: "123456",
      name: "private name",
      description: "private description",
      category: "private category",
      payload: { amountCents: "123456" },
      query: "SELECT * FROM financial_events",
    });

    expect(safe).toEqual({
      event: "s11_export_request_success",
      useCase: "export.request",
      operation: "export.request",
      stage: "request",
      contractVersion: S11_CONTRACT_VERSION,
      outcome: "success",
      requestId: "request-opaque",
      result: "SUCCESS",
      datasetCount: 17,
      rowCount: 10000,
      byteCount: 1048576,
      durationMs: 5001,
      statusCode: 200,
    });

    const serialized = JSON.stringify(safe);
    for (const forbidden of [
      "caller-event",
      "caller-use-case",
      "123456",
      "private",
      "SELECT",
      "correlation-ignored",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(
      sanitizeS11Log({
        operation: "export.request",
        stage: "dataset",
        outcome: "success",
      }),
    ).toBeUndefined();
    expect(
      sanitizeS11Log({
        operation: "export.request",
        outcome: "success",
        contractVersion: "s11.v2",
      }),
    ).toBeUndefined();
    expect(
      sanitizeS11Log({
        operation: "export.request",
        outcome: "success",
        result: "PRIVATE_RESULT",
      }),
    ).toBeUndefined();
  });

  it("keeps only bounded aggregate fields and never traverses rows", () => {
    expect(
      sanitizeS11AggregateFields({
        row_count: 3.4,
        byteCount: 2048,
        datasets: 17,
        rows: [{ amountCents: "999999", description: "private" }],
        payload: { rowCount: 999 },
      }),
    ).toEqual({
      rowCount: 3,
      byteCount: 2048,
      datasetCount: 17,
    });
    expect(sanitizeS11AggregateFields({ rowCount: 9_999_999_999 })).toEqual({
      rowCount: 1_000_000_000,
    });
  });

  it("classifies export and context failures as expected", () => {
    for (const code of S11_EXPECTED_ERROR_CODES) {
      expect(classifyS11Error({ code, message: "amount=999999 private" })).toEqual({
        outcome: "expected_error",
        errorCode: code,
      });
    }
    expect(
      classifyS11Error(new FinancialContextError("HOUSEHOLD_SELECTION_REQUIRED")),
    ).toEqual({
      outcome: "expected_error",
      errorCode: "HOUSEHOLD_SELECTION_REQUIRED",
    });
    expect(
      classifyS11Error({ code: "EXPORT_DATASET_FAILED", message: "saldo=999999" }),
    ).toEqual({
      outcome: "unexpected_error",
      errorCode: "EXPORT_DATASET_FAILED",
    });
    expect(classifyS11Error(new Error("SQL amount=999999 private"))).toEqual({
      outcome: "unexpected_error",
      errorCode: "UNEXPECTED_ERROR",
    });
  });

  it("returns only a stable error code envelope", () => {
    expect(
      toS11ErrorEnvelope({
        code: "EXPORT_RATE_LIMITED",
        message: "name=private amount=999999",
        field: "amountCents",
      }),
    ).toEqual({
      ok: false,
      error: { code: "EXPORT_RATE_LIMITED" },
    });
    expect(toS11ErrorEnvelope(new Error("database private"))).toEqual({
      ok: false,
      error: { code: "UNEXPECTED_ERROR" },
    });
  });

  it("reports expected failures without turning them into Sentry incidents", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = createS11Operation("export.request", {
      requestId: "request-opaque",
    });

    expect(
      reportS11UnexpectedError(
        { code: "EXPORT_IN_PROGRESS", message: "amount=999999" },
        operation,
        7,
      ),
    ).toEqual({
      outcome: "expected_error",
      errorCode: "EXPORT_IN_PROGRESS",
    });
    expect(captureServerException).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    expect(String(info.mock.calls[0]?.[0])).not.toContain("999999");
  });

  it("keeps expected Result errors out of Sentry and preserves the exact result", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = {
      ok: false as const,
      error: {
        code: "EXPORT_RATE_LIMITED",
        message: "name=private amount=999999",
        payload: { balanceCents: "999999" },
      },
    };
    const operation = createS11Operation("export.request", {
      requestId: "request-opaque",
    });

    await expect(
      withS11Observability(operation, () => result, {
        now: vi.fn<() => number>().mockReturnValueOnce(100).mockReturnValueOnce(112),
      }),
    ).resolves.toBe(result);

    expect(captureServerException).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    const serialized = String(info.mock.calls[0]?.[0]);
    expect(serialized).toContain('"outcome":"expected_error"');
    expect(serialized).toContain('"errorCode":"EXPORT_RATE_LIMITED"');
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("999999");
  });

  it("wraps dataset reads without inspecting the returned payload", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const rows = [{ name: "private", amountCents: "999999" }];

    const observed = await wrapDatasetRead(
      "financial_events",
      async () => rows,
      {
        correlationId: "t06-read-correlation",
        rowCount: 10_000,
        amountCents: "999999",
        payload: { name: "private" },
        now: () => 10,
      },
    );

    expect(observed).toBe(rows);
    expect(captureServerException).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    const serialized = String(info.mock.calls[0]?.[0]);
    expect(serialized).toContain('"operation":"export.dataset"');
    expect(serialized).toContain('"stage":"dataset"');
    expect(serialized).toContain('"requestId":"t06-read-correlation"');
    expect(serialized).toContain('"datasetId":"financial_events"');
    expect(serialized).toContain('"rowCount":10000');
    expect(serialized).not.toMatch(/999999|private/u);
  });

  it("rejects invalid dataset identifiers at the adapter boundary", async () => {
    await expect(
      wrapDatasetRead("conta-corrente-privada.csv", async () => "ok"),
    ).rejects.toThrow("INVALID_DATASET_ID");
  });

  it("correlates job attempts by executionId and attempt", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(
      withJobAttempt(async () => "heartbeat-ok", {
        jobName: "s11.job.heartbeat",
        attempt: 2,
        executionId: "exec-opaque-001",
        correlationId: "job-correlation",
        now: () => 50,
      }),
    ).resolves.toBe("heartbeat-ok");

    expect(info).toHaveBeenCalledOnce();
    const serialized = String(info.mock.calls[0]?.[0]);
    expect(serialized).toContain('"operation":"job.attempt"');
    expect(serialized).toContain('"jobName":"s11.job.heartbeat"');
    expect(serialized).toContain('"attempt":2');
    expect(serialized).toContain('"executionId":"exec-opaque-001"');
  });

  it("relays a technical export failure with safe context and the same throw", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = {
      code: "EXPORT_SERIALIZATION_FAILED",
      message: "SQL balance_cents=999999 for private household",
    };
    const boundary = instrumentS11ExportBoundary(
      "export.serialize",
      async () => {
        throw error;
      },
      {
        correlationId: "t07-technical-correlation",
        now: () => 30,
      },
    );

    await expect(boundary()).rejects.toBe(error);
    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        operation: "export.serialize",
        stage: "serialize",
        requestId: "t07-technical-correlation",
        errorCode: "EXPORT_SERIALIZATION_FAILED",
      }),
    );
    expect(errorLog).toHaveBeenCalledOnce();
    expect(String(errorLog.mock.calls[0]?.[0])).not.toMatch(/balance_cents|999999|private/u);
  });

  it("marks export.request slow above 5s and dataset slow above 2s", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onSlow = vi.fn();

    const exportOperation = createS11Operation("export.request", {
      requestId: "slow-export",
      datasetCount: 17,
    });
    await withS11Observability(exportOperation, async () => "zip", {
      now: vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValueOnce(5_001),
      onSlow,
    });
    expect(info).toHaveBeenCalledOnce();
    expect(String(info.mock.calls[0]?.[0])).toContain('"slow":true');
    expect(String(info.mock.calls[0]?.[0])).toContain('"result":"SLOW"');

    const datasetOperation = createS11Operation("export.dataset", {
      requestId: "slow-dataset",
      datasetId: "accounts",
    });
    await measureS11DatasetRead(datasetOperation, async () => "rows", {
      onSlow,
      now: vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValueOnce(2_100),
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(onSlow).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain('"slow":true');
    expect(String(warn.mock.calls[0]?.[0])).toContain('"datasetId":"accounts"');
  });

  it("uses the same safe operation metadata for breadcrumbs and context", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = createS11Operation("export.deliver", {
      requestId: "request-opaque",
      result: "SUCCESS",
      byteCount: 1_048_576,
    });
    const record = logS11Operation(operation, "success", {
      durationMs: 12,
      amountCents: "999999",
      name: "private name",
      payload: { amountCents: "999999" },
    } as never);

    expect(record).toMatchObject({
      event: "s11_export_deliver_success",
      stage: "deliver",
      contractVersion: S11_CONTRACT_VERSION,
      result: "SUCCESS",
      byteCount: 1_048_576,
    });
    expect(info).toHaveBeenCalledOnce();
    expect(addBreadcrumbSafely).toHaveBeenCalledOnce();
    const breadcrumb = vi.mocked(addBreadcrumbSafely).mock.calls[0]?.[0];
    expect(JSON.stringify(breadcrumb)).toContain("export.deliver");
    expect(JSON.stringify(breadcrumb)).not.toContain("999999");
    expect(JSON.stringify(breadcrumb)).not.toContain("private");

    const context = toS11ObservabilityContext(operation, "success", {
      durationMs: 12,
      result: "SUCCESS",
      byteCount: 1_048_576,
    });
    expect(context).toMatchObject({
      entityType: "export",
      s11Stage: "deliver",
      s11ContractVersion: S11_CONTRACT_VERSION,
      s11Result: "SUCCESS",
      byteCount: 1_048_576,
    });
    expect(JSON.stringify(context)).not.toContain("999999");
    expect(JSON.stringify(context)).not.toContain("private");
  });

  it("emits job lifecycle helpers with closed job names", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    expect(
      logS11JobStart({
        jobName: "s11.job.heartbeat",
        executionId: "exec-001",
        correlationId: "job-correlation",
      }),
    ).toMatchObject({
      operation: "job.start",
      jobName: "s11.job.heartbeat",
      executionId: "exec-001",
    });
    expect(
      logS11JobFinish("success", {
        jobName: "s11.backup.logical",
        executionId: "exec-001",
        result: "SUCCESS",
      }),
    ).toMatchObject({
      operation: "job.finish",
      jobName: "s11.backup.logical",
      result: "SUCCESS",
    });
    expect(info).toHaveBeenCalledTimes(2);
    expect(
      logS11JobStart({ jobName: "private.job", executionId: "exec-001" }),
    ).toBeUndefined();
  });

  it("does not emit dataset slow metadata below threshold and bounds timing settings", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onSlow = vi.fn();
    const operation = createS11Operation("export.dataset", {
      requestId: "request-opaque",
      datasetId: "accounts",
    });

    await expect(
      measureS11DatasetRead(operation, () => "fast", {
        onSlow,
        now: vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValueOnce(1_999),
      }),
    ).resolves.toBe("fast");
    expect(warn).not.toHaveBeenCalled();
    expect(onSlow).not.toHaveBeenCalled();
    expect(getS11DatasetSlowThresholdMs("900")).toBe(900);
    expect(getS11DatasetSlowThresholdMs("999999")).toBe(60_000);
    expect(getS11DatasetSlowThresholdMs("not-a-number")).toBe(2_000);
    expect(getS11ExportSlowThresholdMs("900")).toBe(900);
    expect(getS11ExportSlowThresholdMs("999999")).toBe(60_000);
    expect(getS11ExportSlowThresholdMs("not-a-number")).toBe(5_000);
  });

  it("publishes a closed operation vocabulary", () => {
    expect(S11_OPERATIONS).toEqual([
      "export.request",
      "export.dataset",
      "export.serialize",
      "export.deliver",
      "job.start",
      "job.attempt",
      "job.finish",
    ]);
    expect(
      sanitizeS11Log({
        operation: "export.delete",
        outcome: "success",
      }),
    ).toBeUndefined();
    expect(
      sanitizeS11Log({
        operation: "export.dataset",
        outcome: "success",
        datasetId: "accounts",
        result: "EMPTY",
      }),
    ).toMatchObject({
      datasetId: "accounts",
      result: "EMPTY",
    });
  });
});
