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
  sanitizeSentryBreadcrumb,
  toSafeObservabilityContext,
} from "./sanitize";

import {
  FORECAST_EXPECTED_ERROR_CODES,
  classifyForecastError,
  createForecastOperation,
  getForecastQueryBudgetMs,
  getForecastSlowQueryThresholdMs,
  logForecastOperation,
  measureForecastQuery,
  reportForecastUnexpectedError,
  sanitizeForecastCounts,
  sanitizeForecastLog,
  toForecastErrorEnvelope,
  toForecastObservabilityContext,
  withForecastObservability,
} from "./forecast";

describe("forecast observability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(addBreadcrumbSafely).mockClear();
    vi.mocked(captureServerException).mockClear();
  });

  it("creates stage/query metadata and drops forecast payload fields", () => {
    const operation = createForecastOperation("builder", {
      requestId: "request-opaque",
      householdId: "household-opaque",
      scenario: "EXPECTED",
      sourceKind: "INSTALLMENT",
      periodBucket: "MEDIUM",
      sourceCount: 12,
      installmentCount: 4,
      itemCount: 8,
      from: "2026-09-01",
      to: "2026-12-31",
      amountCents: "999999",
      openingBalanceCents: "999999",
      description: "private forecast description",
      referenceId: "source-private",
      payload: { amountCents: "999999" },
    });

    expect(operation).toMatchObject({
      operation: "forecast.timeline.build",
      stage: "builder",
      queryCode: "forecast_builder",
      requestId: "request-opaque",
      householdId: "household-opaque",
      scenario: "EXPECTED",
      sourceKind: "INSTALLMENT",
      periodBucket: "MEDIUM",
      sourceCount: 12,
      installmentCount: 4,
      itemCount: 8,
    });

    const serialized = JSON.stringify(operation);
    for (const forbidden of [
      "2026-09-01",
      "2026-12-31",
      "999999",
      "private forecast description",
      "source-private",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(operation).not.toHaveProperty("amountCents");
    expect(operation).not.toHaveProperty("openingBalanceCents");
    expect(operation).not.toHaveProperty("payload");
  });

  it("derives code-owned names and retains only aggregate safe metadata", () => {
    const safe = sanitizeForecastLog({
      operation: "forecast.query.get",
      outcome: "success",
      requestId: "request-opaque",
      householdId: "household-opaque",
      scenario: "CONSERVATIVE",
      sourceKind: "ALL",
      periodRangeBucket: "SHORT",
      sourceCount: 20,
      recurringCount: 4,
      plannedEventCount: 5,
      installmentCount: 8,
      realizedEventCount: 3,
      cancelledCount: 1,
      itemCount: 19,
      projectedItemCount: 12,
      realizedItemCount: 7,
      periodCount: 2,
      dayCount: 15,
      durationMs: 42.4,
      statusCode: 200,
      event: "caller-event",
      useCase: "caller-use-case",
      queryCode: "SELECT amount_cents FROM private_forecast" as never,
      from: "2026-09-01",
      to: "2026-10-31",
      amountCents: "123456",
      balanceCents: "123456",
      description: "private description",
      label: "private label",
      referenceId: "private-reference",
      cursor: "private-cursor",
      payload: { description: "private" },
    });

    expect(safe).toEqual({
      event: "forecast_query_get_success",
      useCase: "forecast.query.get",
      operation: "forecast.query.get",
      stage: "query",
      queryCode: "forecast_query",
      outcome: "success",
      requestId: "request-opaque",
      householdId: "household-opaque",
      scenario: "CONSERVATIVE",
      sourceKind: "ALL",
      periodBucket: "SHORT",
      sourceCount: 20,
      recurringCount: 4,
      plannedEventCount: 5,
      installmentCount: 8,
      realizedEventCount: 3,
      cancelledCount: 1,
      itemCount: 19,
      projectedItemCount: 12,
      realizedItemCount: 7,
      periodCount: 2,
      dayCount: 15,
      durationMs: 42,
      statusCode: 200,
    });

    const serialized = JSON.stringify(safe);
    for (const forbidden of [
      "caller-event",
      "caller-use-case",
      "SELECT",
      "2026-09-01",
      "123456",
      "private",
      "private-reference",
      "private-cursor",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("normalizes bounded counters and ignores arrays/amount-like values", () => {
    expect(
      sanitizeForecastCounts({
        source_count: 3.4,
        recurring: 2,
        planned_events: -1,
        installment_count: Number.POSITIVE_INFINITY,
        items: [{ amountCents: "999999" }],
        periodCount: 2,
        rows: [{ description: "private" }],
      }),
    ).toEqual({
      sourceCount: 3,
      recurringCount: 2,
      plannedEventCount: 0,
      periodCount: 2,
    });
  });

  it("classifies validation, authorization and absence as expected", () => {
    for (const code of FORECAST_EXPECTED_ERROR_CODES) {
      expect(classifyForecastError({ code, message: "amount=999999 private" })).toEqual({
        outcome: "expected_error",
        errorCode: code,
      });
    }
    expect(classifyForecastError(new FinancialContextError("UNAUTHENTICATED"))).toEqual({
      outcome: "expected_error",
      errorCode: "UNAUTHENTICATED",
    });
    expect(classifyForecastError({ code: "FORECAST_INCONSISTENT", message: "private" })).toEqual({
      outcome: "unexpected_error",
      errorCode: "FORECAST_INCONSISTENT",
    });
    expect(classifyForecastError(new Error("database amount=999999"))).toEqual({
      outcome: "unexpected_error",
      errorCode: "UNEXPECTED_ERROR",
    });
  });

  it("returns a public code/field-only error envelope", () => {
    expect(
      toForecastErrorEnvelope({
        code: "INVALID_DATE",
        field: "from",
        message: "private date/value",
      }),
    ).toEqual({
      ok: false,
      error: { code: "INVALID_DATE", field: "from" },
    });
    expect(toForecastErrorEnvelope(new Error("private technical message"))).toEqual({
      ok: false,
      error: { code: "FORECAST_QUERY_FAILED", field: null },
    });
    expect(toForecastErrorEnvelope(new FinancialContextError("UNAUTHENTICATED"))).toEqual({
      ok: false,
      error: { code: "FINANCIAL_CONTEXT_REQUIRED", field: null },
    });
    expect(
      toForecastErrorEnvelope({ code: "INVALID_DATE", field: "amountCents" }),
    ).toEqual({
      ok: false,
      error: { code: "INVALID_DATE", field: null },
    });
  });

  it("captures unexpected technical errors with safe Sentry context", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("query failed amount=999999 description=private");
    const operation = createForecastOperation("engine", {
      requestId: "request-opaque",
      householdId: "household-opaque",
      scenario: "CONSERVATIVE",
      periodBucket: "SINGLE_PERIOD",
      itemCount: 3,
    });

    const classification = reportForecastUnexpectedError(error, operation, 27, {
      technicalErrorCode: "FORECAST_ENGINE_FAILED",
    });

    expect(classification).toEqual({
      outcome: "unexpected_error",
      errorCode: "FORECAST_ENGINE_FAILED",
    });
    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        event: "forecast_engine_calculate_unexpected_error",
        useCase: "forecast.engine.calculate",
        operation: "forecast.engine.calculate",
        entityType: "forecast",
        stage: "engine",
        forecastStage: "engine",
        forecastScenario: "CONSERVATIVE",
        forecastPeriodBucket: "SINGLE_PERIOD",
        errorCode: "FORECAST_ENGINE_FAILED",
        durationMs: 27,
      }),
    );
    expect(errorLog).toHaveBeenCalledOnce();
    const serialized = String(errorLog.mock.calls[0]?.[0]);
    expect(serialized).not.toContain("999999");
    expect(serialized).not.toContain("private");
  });

  it("keeps expected Result errors out of Sentry and preserves the result", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = {
      ok: false as const,
      error: { code: "FORECAST_NOT_FOUND", field: null, message: "private" },
    };
    const operation = createForecastOperation("query", {
      requestId: "request-opaque",
    });

    await expect(
      withForecastObservability(operation, () => result, {
        now: vi
          .fn<() => number>()
          .mockReturnValueOnce(100)
          .mockReturnValueOnce(112),
      }),
    ).resolves.toBe(result);

    expect(captureServerException).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    expect(String(info.mock.calls[0]?.[0])).toContain(
      '"outcome":"expected_error"',
    );
    expect(String(info.mock.calls[0]?.[0])).not.toContain("private");
  });

  it("captures thrown failures, preserves the throw and generates correlation", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("source amount=999999 description=private");
    const operation = createForecastOperation("source", {
      householdId: "household-opaque",
      sourceKind: "RECURRING",
    });

    await expect(
      withForecastObservability(
        operation,
        () => {
          throw error;
        },
        {
          technicalErrorCode: "FORECAST_SOURCE_QUERY_FAILED",
          now: vi
            .fn<() => number>()
            .mockReturnValueOnce(200)
            .mockReturnValueOnce(225),
        },
      ),
    ).rejects.toBe(error);

    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        operation: "forecast.source.load",
        stage: "source",
        errorCode: "FORECAST_SOURCE_QUERY_FAILED",
        requestId: expect.any(String),
      }),
    );
    expect(errorLog).toHaveBeenCalledOnce();
    expect(String(errorLog.mock.calls[0]?.[0])).not.toContain("999999");
    expect(String(errorLog.mock.calls[0]?.[0])).not.toContain("private");
  });

  it("emits slow records that distinguish source, builder, engine and query", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onSlowQuery = vi.fn();
    const stages = ["source", "builder", "engine", "query"] as const;

    for (const stage of stages) {
      const operation = createForecastOperation(stage, {
        requestId: `request-${stage}`,
        scenario: "EXPECTED",
        sourceKind: "ALL",
      });
      const now = vi
        .fn<() => number>()
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(2_100);

      await expect(
        measureForecastQuery(operation, () => ({ amountCents: "999999" }), {
          thresholdMs: 250,
          queryBudgetMs: 2_000,
          onSlowQuery,
          now,
          sql: "SELECT amount_cents FROM private_forecast",
        } as never),
      ).resolves.toEqual({ amountCents: "999999" });
    }

    expect(warn).toHaveBeenCalledTimes(stages.length);
    expect(onSlowQuery).toHaveBeenCalledTimes(stages.length);
    expect(onSlowQuery.mock.calls.map(([value]) => value.stage)).toEqual(stages);
    const serialized = warn.mock.calls.map(([value]) => String(value)).join("\n");
    expect(serialized).toContain('"budgetExceeded":true');
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("999999");
  });

  it("does not emit below threshold and bounds threshold/budget settings", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onSlowQuery = vi.fn();
    const operation = createForecastOperation("query", {
      requestId: "request-opaque",
    });

    await expect(
      measureForecastQuery(operation, () => "fast-result", {
        thresholdMs: 250,
        queryBudgetMs: 2_000,
        onSlowQuery,
        now: vi
          .fn<() => number>()
          .mockReturnValueOnce(0)
          .mockReturnValueOnce(249),
      }),
    ).resolves.toBe("fast-result");
    expect(warn).not.toHaveBeenCalled();
    expect(onSlowQuery).not.toHaveBeenCalled();
    expect(getForecastSlowQueryThresholdMs("900")).toBe(900);
    expect(getForecastSlowQueryThresholdMs(-10)).toBe(0);
    expect(getForecastSlowQueryThresholdMs("999999")).toBe(60_000);
    expect(getForecastSlowQueryThresholdMs("not-a-number")).toBe(250);
    expect(getForecastQueryBudgetMs("900")).toBe(900);
    expect(getForecastQueryBudgetMs("999999")).toBe(60_000);
    expect(getForecastQueryBudgetMs("not-a-number")).toBe(2_000);
  });

  it("uses the same allow-list for breadcrumbs and Sentry context", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = createForecastOperation("query", {
      requestId: "request-opaque",
      householdId: "household-opaque",
      scenario: "EXPECTED",
      sourceKind: "PLANNED_EVENT",
      periodBucket: "LONG",
      sourceCount: 10,
    });
    const record = logForecastOperation(operation, "success", {
      durationMs: 12,
      description: "private description",
      amountCents: "999999",
    } as never);

    expect(record).toMatchObject({
      event: "forecast_query_get_success",
      stage: "query",
      queryCode: "forecast_query",
      scenario: "EXPECTED",
      sourceKind: "PLANNED_EVENT",
      periodBucket: "LONG",
      sourceCount: 10,
    });
    expect(info).toHaveBeenCalledOnce();
    expect(addBreadcrumbSafely).toHaveBeenCalledOnce();
    const breadcrumb = vi.mocked(addBreadcrumbSafely).mock.calls[0]?.[0];
    expect(JSON.stringify(breadcrumb)).toContain("forecast_query");
    expect(JSON.stringify(breadcrumb)).not.toContain("private");
    expect(JSON.stringify(breadcrumb)).not.toContain("999999");

    const context = toForecastObservabilityContext(operation, "success", {
      durationMs: 12,
      queryBudgetMs: 2_000,
      budgetExceeded: false,
    });
    expect(context).toMatchObject({
      entityType: "forecast",
      forecastStage: "query",
      forecastScenario: "EXPECTED",
      forecastSourceKind: "PLANNED_EVENT",
      forecastPeriodBucket: "LONG",
      forecastQueryCode: "forecast_query",
      forecastSourceCount: 10,
      forecastQueryBudgetMs: 2_000,
      forecastBudgetExceeded: false,
    });
    expect(JSON.stringify(context)).not.toContain("description");
    expect(JSON.stringify(context)).not.toContain("999999");

    const sentry = toSafeObservabilityContext(context);
    expect(sentry.tags).toMatchObject({
      forecast_stage: "query",
      forecast_query_code: "forecast_query",
      forecast_scenario: "EXPECTED",
      forecast_source_kind: "PLANNED_EVENT",
      forecast_source_count: 10,
      forecast_query_budget_ms: 2_000,
      forecast_budget_exceeded: false,
    });
    expect(JSON.stringify(sentry)).not.toContain("description");
    expect(JSON.stringify(sentry)).not.toContain("999999");

    const sanitizedBreadcrumb = sanitizeSentryBreadcrumb({
      type: "info",
      category: "forecast.query.get",
      data: {
        forecast_stage: "query",
        forecast_query_code: "forecast_query",
        forecast_scenario: "EXPECTED",
        forecast_source_count: 10,
        amountCents: "999999",
        description: "private description",
      },
    });
    expect(sanitizedBreadcrumb).toMatchObject({
      data: {
        forecast_stage: "query",
        forecast_query_code: "forecast_query",
        forecast_source_count: 10,
      },
    });
    expect(JSON.stringify(sanitizedBreadcrumb)).not.toContain("999999");
    expect(JSON.stringify(sanitizedBreadcrumb)).not.toContain("private");
  });
});
