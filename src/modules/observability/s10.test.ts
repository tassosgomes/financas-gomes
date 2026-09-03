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
  OVERVIEW_BLOCK_TIMEOUT_MS,
  OVERVIEW_SLOW_QUERY_THRESHOLD_MS,
  S10_CONTRACT_VERSION,
  S10_OVERVIEW_EXPECTED_ERROR_CODES,
  S10_OVERVIEW_OPERATIONS,
  classifyOverviewError,
  createOverviewOperation,
  getOverviewQueryBudgetMs,
  getOverviewSlowQueryThresholdMs,
  logOverviewOperation,
  measureOverviewQuery,
  reportOverviewUnexpectedError,
  sanitizeOverviewCounts,
  sanitizeOverviewLog,
  toOverviewErrorEnvelope,
  toOverviewObservabilityContext,
  withOverviewObservability,
} from "./s10";

describe("S10 overview observability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(addBreadcrumbSafely).mockClear();
    vi.mocked(captureServerException).mockClear();
  });

  it("creates versioned operation metadata without financial or tenancy input", () => {
    const operation = createOverviewOperation("overview.aggregate", {
      requestId: "request-opaque",
      correlationId: "correlation-ignored",
      userId: "user-private-id",
      householdId: "household-private-id",
      result: "PARTIAL",
      groupCount: 4,
      itemCount: 12,
      readyBlockCount: 3,
      errorBlockCount: 1,
      amountCents: "999999",
      balanceCents: "999999",
      name: "Caixinha privada",
      description: "descrição privada",
      category: "categoria privada",
      referenceId: "movement-private",
      asOf: "2026-09-01",
      payload: { amountCents: "999999" },
      sql: "SELECT amount_cents FROM overview",
      authorization: "Bearer private-token",
      cookie: "session=private",
    });

    expect(operation).toMatchObject({
      operation: "overview.aggregate",
      stage: "aggregate",
      contractVersion: S10_CONTRACT_VERSION,
      requestId: "request-opaque",
      result: "PARTIAL",
      groupCount: 4,
      itemCount: 12,
      readyBlockCount: 3,
      errorBlockCount: 1,
    });

    expect(operation).not.toHaveProperty("userId");
    expect(operation).not.toHaveProperty("householdId");

    const serialized = JSON.stringify(operation);
    for (const forbidden of [
      "999999",
      "Caixinha privada",
      "descrição privada",
      "categoria privada",
      "movement-private",
      "SELECT amount_cents",
      "private-token",
      "session=private",
      "user-private-id",
      "household-private-id",
      "correlation-ignored",
      "2026-09-01",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(operation).not.toHaveProperty("amountCents");
    expect(operation).not.toHaveProperty("payload");
    expect(operation).not.toHaveProperty("sql");
  });

  it("rebuilds code-owned fields and rejects unknown or mismatched values", () => {
    const safe = sanitizeOverviewLog({
      operation: "overview.read",
      stage: "read",
      outcome: "success",
      requestId: "request-opaque",
      correlationId: "correlation-ignored",
      userId: "user-private-id",
      householdId: "household-private-id",
      contractVersion: S10_CONTRACT_VERSION,
      result: "EMPTY",
      groupCount: 2,
      itemCount: 3,
      durationMs: 18.6,
      statusCode: 200,
      event: "caller-event",
      useCase: "caller-use-case",
      operationName: "private operation",
      amountCents: "123456",
      balance: "123456",
      name: "private name",
      description: "private description",
      category: "private category",
      payload: { amountCents: "123456" },
      query: "SELECT * FROM overview",
    });

    expect(safe).toEqual({
      event: "s10_overview_read_success",
      useCase: "overview.read",
      operation: "overview.read",
      stage: "read",
      contractVersion: S10_CONTRACT_VERSION,
      outcome: "success",
      requestId: "request-opaque",
      result: "EMPTY",
      groupCount: 2,
      itemCount: 3,
      durationMs: 19,
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
      "user-private-id",
      "household-private-id",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(
      sanitizeOverviewLog({
        operation: "overview.read",
        stage: "aggregate",
        outcome: "success",
      }),
    ).toBeUndefined();
    expect(
      sanitizeOverviewLog({
        operation: "overview.read",
        outcome: "success",
        contractVersion: "s10.v2",
      }),
    ).toBeUndefined();
    expect(
      sanitizeOverviewLog({
        operation: "overview.read",
        outcome: "success",
        result: "PRIVATE_RESULT",
      }),
    ).toBeUndefined();
  });

  it("keeps only bounded aggregate counts and never traverses rows", () => {
    expect(
      sanitizeOverviewCounts({
        group_count: 3.4,
        items: 5,
        boxes: -1,
        commitments: 7,
        readyBlocks: 2,
        rows: [{ amountCents: "999999", description: "private" }],
        payload: { itemCount: 999 },
      }),
    ).toEqual({
      groupCount: 3,
      itemCount: 5,
      boxCount: 0,
      commitmentCount: 7,
      readyBlockCount: 2,
    });
    expect(
      sanitizeOverviewCounts({ groupCount: 9_999_999_999 }),
    ).toEqual({ groupCount: 1_000_000_000 });
  });

  it("classifies context and validation failures as expected", () => {
    for (const code of S10_OVERVIEW_EXPECTED_ERROR_CODES) {
      expect(classifyOverviewError({ code, message: "amount=999999 private" })).toEqual({
        outcome: "expected_error",
        errorCode: code,
      });
    }
    expect(
      classifyOverviewError(new FinancialContextError("HOUSEHOLD_SELECTION_REQUIRED")),
    ).toEqual({
      outcome: "expected_error",
      errorCode: "HOUSEHOLD_SELECTION_REQUIRED",
    });
    expect(
      classifyOverviewError({ code: "OVERVIEW_QUERY_FAILED", message: "saldo=999999" }),
    ).toEqual({
      outcome: "unexpected_error",
      errorCode: "OVERVIEW_QUERY_FAILED",
    });
    expect(classifyOverviewError(new Error("SQL amount=999999 private"))).toEqual({
      outcome: "unexpected_error",
      errorCode: "UNEXPECTED_ERROR",
    });
  });

  it("returns only a stable error code envelope", () => {
    expect(
      toOverviewErrorEnvelope({
        code: "INVALID_DATE",
        message: "name=private amount=999999",
        field: "asOf",
      }),
    ).toEqual({
      ok: false,
      error: { code: "INVALID_DATE", field: "asOf" },
    });
    expect(toOverviewErrorEnvelope(new Error("database private"))).toEqual({
      ok: false,
      error: { code: "UNEXPECTED_ERROR", field: null },
    });
  });

  it("reports expected failures without turning them into Sentry incidents", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = createOverviewOperation("overview.compose", {
      requestId: "request-opaque",
    });

    expect(
      reportOverviewUnexpectedError(
        { code: "INVALID_SCENARIO", message: "amount=999999" },
        operation,
        7,
      ),
    ).toEqual({
      outcome: "expected_error",
      errorCode: "INVALID_SCENARIO",
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
        code: "INVALID_DATE",
        message: "name=private amount=999999",
        payload: { balanceCents: "999999" },
      },
    };
    const operation = createOverviewOperation("overview.read", {
      requestId: "request-opaque",
    });

    await expect(
      withOverviewObservability(operation, () => result, {
        now: vi.fn<() => number>().mockReturnValueOnce(100).mockReturnValueOnce(112),
      }),
    ).resolves.toBe(result);

    expect(captureServerException).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    const serialized = String(info.mock.calls[0]?.[0]);
    expect(serialized).toContain('"outcome":"expected_error"');
    expect(serialized).toContain('"errorCode":"INVALID_DATE"');
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("999999");
  });

  it("withOverviewObservability preserves returned value and order", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const values = ["first", "second", "third"];
    const operation = createOverviewOperation("overview.read", {
      requestId: "request-opaque",
    });

    const observed = await withOverviewObservability(
      operation,
      async () => values,
      { now: () => 0 },
    );

    expect(observed).toBe(values);
    expect(observed).toEqual(["first", "second", "third"]);
    expect(info).toHaveBeenCalledOnce();
    const serialized = String(info.mock.calls[0]?.[0]);
    expect(serialized).not.toContain("first");
    expect(serialized).not.toContain("second");
    expect(serialized).not.toContain("third");
  });

  it("captures aggregation exceptions with safe context and preserves the throw", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("SELECT amount_cents=999999 description=private");
    const operation = createOverviewOperation("aggregate", {
      result: "UNAVAILABLE",
      originCount: 3,
    });

    await expect(
      withOverviewObservability(
        operation,
        () => {
          throw error;
        },
        {
          technicalErrorCode: "OVERVIEW_AGGREGATION_FAILED",
          now: vi.fn<() => number>().mockReturnValueOnce(200).mockReturnValueOnce(225),
        },
      ),
    ).rejects.toBe(error);

    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        operation: "overview.aggregate",
        stage: "aggregate",
        requestId: expect.any(String),
        errorCode: "OVERVIEW_AGGREGATION_FAILED",
        durationMs: 25,
        s10ContractVersion: S10_CONTRACT_VERSION,
        s10Result: "UNAVAILABLE",
        originCount: 3,
      }),
    );
    expect(errorLog).toHaveBeenCalledOnce();
    const serialized = String(errorLog.mock.calls[0]?.[0]);
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("999999");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("householdId");
  });

  it("uses the same safe operation metadata for breadcrumbs and context", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = createOverviewOperation("overview.compose", {
      requestId: "request-opaque",
      result: "PARTIAL",
      readyBlockCount: 4,
      errorBlockCount: 1,
      userId: "user-private",
      householdId: "household-private",
    });
    const record = logOverviewOperation(operation, "success", {
      durationMs: 12,
      amountCents: "999999",
      name: "private name",
      payload: { amountCents: "999999" },
    } as never);

    expect(record).toMatchObject({
      event: "s10_overview_compose_success",
      stage: "compose",
      contractVersion: S10_CONTRACT_VERSION,
      result: "PARTIAL",
      readyBlockCount: 4,
      errorBlockCount: 1,
    });
    expect(info).toHaveBeenCalledOnce();
    expect(addBreadcrumbSafely).toHaveBeenCalledOnce();
    const breadcrumb = vi.mocked(addBreadcrumbSafely).mock.calls[0]?.[0];
    expect(JSON.stringify(breadcrumb)).toContain("overview.compose");
    expect(JSON.stringify(breadcrumb)).not.toContain("999999");
    expect(JSON.stringify(breadcrumb)).not.toContain("private");
    expect(JSON.stringify(breadcrumb)).not.toContain("user-private");
    expect(JSON.stringify(breadcrumb)).not.toContain("household-private");

    const context = toOverviewObservabilityContext(operation, "success", {
      durationMs: 12,
      result: "PARTIAL",
      readyBlockCount: 4,
      errorBlockCount: 1,
    });
    expect(context).toMatchObject({
      entityType: "overview",
      s10Stage: "compose",
      s10ContractVersion: S10_CONTRACT_VERSION,
      s10Result: "PARTIAL",
      readyBlockCount: 4,
      errorBlockCount: 1,
    });
    expect(JSON.stringify(context)).not.toContain("999999");
    expect(JSON.stringify(context)).not.toContain("private");
    expect(context).not.toHaveProperty("userId");
    expect(context).not.toHaveProperty("householdId");
  });

  it("emits aggregate-only slow metadata when duration exceeds 500ms", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onSlowQuery = vi.fn();
    const operation = createOverviewOperation("overview.aggregate", {
      requestId: "request-opaque",
      result: "PARTIAL",
      groupCount: 5,
      itemCount: 20,
      amountCents: "999999",
      description: "private description",
    });

    await expect(
      measureOverviewQuery(
        operation,
        () => "slow-result",
        {
          thresholdMs: OVERVIEW_SLOW_QUERY_THRESHOLD_MS,
          queryBudgetMs: OVERVIEW_BLOCK_TIMEOUT_MS,
          onSlowQuery,
          now: vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValueOnce(501),
          sql: "SELECT amount_cents FROM overview",
        } as never,
      ),
    ).resolves.toBe("slow-result");

    expect(warn).toHaveBeenCalledOnce();
    expect(onSlowQuery).toHaveBeenCalledOnce();
    expect(onSlowQuery.mock.calls[0]?.[0]).toMatchObject({
      stage: "aggregate",
      outcome: "success",
      slowQuery: true,
      slowQueryThresholdMs: 500,
      durationMs: 501,
      groupCount: 5,
      itemCount: 20,
    });
    const serialized = String(warn.mock.calls[0]?.[0]);
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("999999");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("slow-result");
  });

  it("does not emit below threshold and bounds timing settings", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onSlowQuery = vi.fn();
    const operation = createOverviewOperation("read", { requestId: "request-opaque" });

    await expect(
      measureOverviewQuery(operation, () => "fast", {
        thresholdMs: OVERVIEW_SLOW_QUERY_THRESHOLD_MS,
        queryBudgetMs: OVERVIEW_BLOCK_TIMEOUT_MS,
        onSlowQuery,
        now: vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValueOnce(499),
      }),
    ).resolves.toBe("fast");
    expect(warn).not.toHaveBeenCalled();
    expect(onSlowQuery).not.toHaveBeenCalled();
    expect(OVERVIEW_SLOW_QUERY_THRESHOLD_MS).toBe(500);
    expect(OVERVIEW_BLOCK_TIMEOUT_MS).toBe(2_500);
    expect(getOverviewSlowQueryThresholdMs("900")).toBe(900);
    expect(getOverviewSlowQueryThresholdMs("999999")).toBe(60_000);
    expect(getOverviewSlowQueryThresholdMs("not-a-number")).toBe(500);
    expect(getOverviewQueryBudgetMs("900")).toBe(900);
    expect(getOverviewQueryBudgetMs("999999")).toBe(60_000);
    expect(getOverviewQueryBudgetMs("not-a-number")).toBe(2_500);
  });

  it("publishes a closed operation vocabulary", () => {
    expect(S10_OVERVIEW_OPERATIONS).toEqual([
      "overview.read",
      "overview.aggregate",
      "overview.compose",
      "overview.render",
    ]);
    expect(
      sanitizeOverviewLog({
        operation: "overview.delete",
        outcome: "success",
      }),
    ).toBeUndefined();
    expect(
      sanitizeOverviewLog({
        operation: "overview.render",
        outcome: "success",
        result: "AVAILABLE",
      }),
    ).toMatchObject({
      result: "AVAILABLE",
    });
    expect(
      sanitizeOverviewLog({
        operation: "overview.compose",
        outcome: "success",
        result: "PARTIAL",
        readyBlockCount: 2,
        errorBlockCount: 1,
      }),
    ).toMatchObject({
      result: "PARTIAL",
      readyBlockCount: 2,
      errorBlockCount: 1,
    });
  });
});
