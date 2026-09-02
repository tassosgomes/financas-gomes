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
  S08_SPENDABLE_EXPECTED_ERROR_CODES,
  S08_SPENDABLE_OPERATIONS,
  classifyS08Error,
  createS08SpendableOperation,
  getS08QueryBudgetMs,
  getS08SlowQueryThresholdMs,
  logS08SpendableOperation,
  measureS08Query,
  reportS08UnexpectedError,
  sanitizeS08SpendableCounts,
  sanitizeS08SpendableLog,
  toS08ErrorEnvelope,
  toS08ObservabilityContext,
  withS08SpendableObservability,
} from "./s08";
import {
  sanitizeSentryBreadcrumb,
  toSafeObservabilityContext,
} from "./sanitize";

describe("S08 spendable observability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(addBreadcrumbSafely).mockClear();
    vi.mocked(captureServerException).mockClear();
  });

  it("creates versioned stage metadata and drops financial payload fields", () => {
    const operation = createS08SpendableOperation("engine", {
      requestId: "request-opaque",
      householdId: "household-opaque",
      scenario: "EXPECTED",
      horizonDays: 90,
      result: "DEFICIT",
      bufferSource: "CONFIGURED",
      sourceCount: 12,
      forecastItemCount: 8,
      pointCount: 2,
      amountCents: "999999" as never,
      openingBalanceCents: "999999" as never,
      rawSpendableCents: "999999" as never,
      description: "private spendable description",
      referenceId: "private-reference" as never,
      asOf: "2026-09-01" as never,
      payload: { amountCents: "999999" } as never,
    });

    expect(operation).toMatchObject({
      operation: "spendable.engine.calculate",
      stage: "engine",
      queryCode: "spendable_engine",
      contractVersion: "s08.v1",
      ruleVersion: "spendable.v1",
      requestId: "request-opaque",
      householdId: "household-opaque",
      scenario: "EXPECTED",
      horizonDays: 90,
      result: "DEFICIT",
      bufferSource: "CONFIGURED",
      sourceCount: 12,
      forecastItemCount: 8,
      pointCount: 2,
    });

    const serialized = JSON.stringify(operation);
    for (const forbidden of [
      "999999",
      "private spendable description",
      "private-reference",
      "2026-09-01",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(operation).not.toHaveProperty("amountCents");
    expect(operation).not.toHaveProperty("openingBalanceCents");
    expect(operation).not.toHaveProperty("rawSpendableCents");
    expect(operation).not.toHaveProperty("payload");
  });

  it("rebuilds code-owned fields and retains only bounded aggregates", () => {
    const safe = sanitizeS08SpendableLog({
      operation: "spendable.read",
      stage: "read",
      outcome: "success",
      requestId: "request-opaque",
      householdId: "household-opaque",
      scenario: "CONSERVATIVE",
      horizonDays: 90,
      result: "AVAILABLE",
      bufferSource: "ABSENT_DEFAULT_ZERO",
      sourceCount: 20,
      installmentCount: 8,
      forecastItemCount: 19,
      projectedItemCount: 12,
      realizedItemCount: 7,
      dayCount: 15,
      pointCount: 2,
      causalPointCount: 3,
      generalAccountCount: 1,
      reserveComponentCount: 0,
      serializedFieldCount: 18,
      durationMs: 42.4,
      statusCode: 200,
      event: "caller-event",
      useCase: "caller-use-case",
      queryCode: "SELECT amount_cents FROM private_spendable" as never,
      contractVersion: "s08.v1",
      ruleVersion: "spendable.v1",
      amountCents: "123456" as never,
      balanceCents: "123456" as never,
      description: "private description",
      asOf: "2026-09-01" as never,
      referenceId: "private-reference" as never,
      payload: { description: "private" } as never,
    });

    expect(safe).toEqual({
      event: "s08_spendable_read_success",
      useCase: "spendable.read",
      operation: "spendable.read",
      stage: "read",
      queryCode: "spendable_read",
      contractVersion: "s08.v1",
      ruleVersion: "spendable.v1",
      outcome: "success",
      requestId: "request-opaque",
      householdId: "household-opaque",
      scenario: "CONSERVATIVE",
      horizonDays: 90,
      result: "AVAILABLE",
      bufferSource: "ABSENT_DEFAULT_ZERO",
      sourceCount: 20,
      installmentCount: 8,
      forecastItemCount: 19,
      projectedItemCount: 12,
      realizedItemCount: 7,
      dayCount: 15,
      pointCount: 2,
      causalPointCount: 3,
      generalAccountCount: 1,
      reserveComponentCount: 0,
      serializedFieldCount: 18,
      durationMs: 42,
      statusCode: 200,
    });

    const serialized = JSON.stringify(safe);
    for (const forbidden of [
      "caller-event",
      "caller-use-case",
      "SELECT",
      "123456",
      "private",
      "2026-09-01",
      "private-reference",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(
      sanitizeS08SpendableLog({
        operation: "spendable.read",
        outcome: "success",
        contractVersion: "s08.v2",
      }),
    ).toBeUndefined();
  });

  it("bounds aggregate counters and rejects non-scalar rows", () => {
    expect(
      sanitizeS08SpendableCounts({
        source_count: 3.4,
        forecast_items: 2,
        dayCount: -1,
        pointCount: Number.POSITIVE_INFINITY,
        rows: [{ amountCents: "999999" }],
        serialized_field_count: 2,
      }),
    ).toEqual({
      sourceCount: 3,
      forecastItemCount: 2,
      dayCount: 0,
      serializedFieldCount: 2,
    });
    expect(
      sanitizeS08SpendableCounts({ sourceCount: 9_999_999_999 }),
    ).toEqual({ sourceCount: 1_000_000_000 });
  });

  it("classifies validation, context and configuration absence as expected", () => {
    for (const code of S08_SPENDABLE_EXPECTED_ERROR_CODES) {
      expect(classifyS08Error({ code, message: "amount=999999 private" })).toEqual({
        outcome: "expected_error",
        errorCode: code,
      });
    }
    expect(classifyS08Error(new FinancialContextError("UNAUTHENTICATED"))).toEqual({
      outcome: "expected_error",
      errorCode: "UNAUTHENTICATED",
    });
    expect(classifyS08Error({ code: "SPENDABLE_INCONSISTENT", message: "private" })).toEqual({
      outcome: "unexpected_error",
      errorCode: "SPENDABLE_INCONSISTENT",
    });
    expect(classifyS08Error(new Error("database amount=999999"))).toEqual({
      outcome: "unexpected_error",
      errorCode: "UNEXPECTED_ERROR",
    });
  });

  it("returns a public code/field-only error envelope", () => {
    expect(
      toS08ErrorEnvelope({
        code: "INVALID_HORIZON",
        field: "horizonDays",
        message: "private date/value",
      }),
    ).toEqual({
      ok: false,
      error: { code: "INVALID_HORIZON", field: "horizon" },
    });
    expect(toS08ErrorEnvelope(new Error("private technical message"))).toEqual({
      ok: false,
      error: { code: "UNEXPECTED_ERROR", field: null },
    });
    expect(toS08ErrorEnvelope(new FinancialContextError("UNAUTHENTICATED"))).toEqual({
      ok: false,
      error: { code: "FINANCIAL_CONTEXT_REQUIRED", field: null },
    });
  });

  it("captures unexpected technical failures with safe versioned context", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("query failed amount=999999 description=private");
    const operation = createS08SpendableOperation("engine", {
      requestId: "request-opaque",
      householdId: "household-opaque",
      scenario: "CONSERVATIVE",
      horizonDays: 90,
      result: "DEFICIT",
      pointCount: 3,
    });

    const classification = reportS08UnexpectedError(error, operation, 27, {
      technicalErrorCode: "SPENDABLE_ENGINE_FAILED",
    });

    expect(classification).toEqual({
      outcome: "unexpected_error",
      errorCode: "SPENDABLE_ENGINE_FAILED",
    });
    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        event: "s08_spendable_engine_calculate_unexpected_error",
        useCase: "spendable.engine.calculate",
        operation: "spendable.engine.calculate",
        entityType: "spendable",
        stage: "engine",
        spendableStage: "engine",
        spendableQueryCode: "spendable_engine",
        spendableContractVersion: "s08.v1",
        spendableRuleVersion: "spendable.v1",
        spendableScenario: "CONSERVATIVE",
        spendableHorizonDays: 90,
        spendableResult: "DEFICIT",
        errorCode: "SPENDABLE_ENGINE_FAILED",
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
      error: { code: "SPENDABLE_CONFIG_ABSENT", message: "private" },
    };
    const operation = createS08SpendableOperation("read", {
      requestId: "request-opaque",
      scenario: "CONSERVATIVE",
      horizonDays: 90,
    });

    await expect(
      withS08SpendableObservability(operation, () => result, {
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

  it("captures thrown technical failures, preserves the throw and generates correlation", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("serialize amount=999999 description=private");
    const operation = createS08SpendableOperation("serialization", {
      householdId: "household-opaque",
    });

    await expect(
      withS08SpendableObservability(
        operation,
        () => {
          throw error;
        },
        {
          technicalErrorCode: "SPENDABLE_SERIALIZATION_FAILED",
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
        operation: "spendable.serialize",
        stage: "serialization",
        errorCode: "SPENDABLE_SERIALIZATION_FAILED",
        requestId: expect.any(String),
      }),
    );
    expect(errorLog).toHaveBeenCalledOnce();
    expect(String(errorLog.mock.calls[0]?.[0])).not.toContain("999999");
    expect(String(errorLog.mock.calls[0]?.[0])).not.toContain("private");
  });

  it("measures all stages and emits only aggregate slow-operation metadata", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onSlowQuery = vi.fn();

    for (const stage of ["read", "forecast", "engine", "serialization"] as const) {
      const operation = createS08SpendableOperation(stage, {
        requestId: `request-${stage}`,
        scenario: "EXPECTED",
        horizonDays: 90,
      });
      const now = vi
        .fn<() => number>()
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(2_100);

      await expect(
        measureS08Query(
          operation,
          () => ({ amountCents: "999999", rawSpendableCents: "999999" }),
          {
            thresholdMs: 250,
            queryBudgetMs: 2_000,
            onSlowQuery,
            now,
            sql: "SELECT amount_cents FROM private_spendable",
          } as never,
        ),
      ).resolves.toEqual({
        amountCents: "999999",
        rawSpendableCents: "999999",
      });
    }

    expect(warn).toHaveBeenCalledTimes(4);
    expect(onSlowQuery).toHaveBeenCalledTimes(4);
    expect(onSlowQuery.mock.calls.map(([value]) => value.stage)).toEqual([
      "read",
      "forecast",
      "engine",
      "serialization",
    ]);
    const serialized = warn.mock.calls.map(([value]) => String(value)).join("\n");
    expect(serialized).toContain('"budgetExceeded":true');
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("999999");
  });

  it("does not emit below threshold and bounds settings", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onSlowQuery = vi.fn();
    const operation = createS08SpendableOperation("read", {
      requestId: "request-opaque",
    });

    await expect(
      measureS08Query(operation, () => "fast-result", {
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
    expect(getS08SlowQueryThresholdMs("900")).toBe(900);
    expect(getS08SlowQueryThresholdMs(-10)).toBe(0);
    expect(getS08SlowQueryThresholdMs("999999")).toBe(60_000);
    expect(getS08SlowQueryThresholdMs("not-a-number")).toBe(250);
    expect(getS08QueryBudgetMs("900")).toBe(900);
    expect(getS08QueryBudgetMs("999999")).toBe(60_000);
    expect(getS08QueryBudgetMs("not-a-number")).toBe(2_000);
  });

  it("uses the same allow-list for breadcrumbs, Sentry context and tags", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = createS08SpendableOperation("read", {
      requestId: "request-opaque",
      householdId: "household-opaque",
      scenario: "EXPECTED",
      horizonDays: 365,
      result: "ZERO",
      bufferSource: "CONFIGURED",
      sourceKind: "PLANNED_EVENT",
      sourceCount: 10,
    });
    const record = logS08SpendableOperation(operation, "success", {
      durationMs: 12,
      description: "private description",
      amountCents: "999999",
    } as never);

    expect(record).toMatchObject({
      event: "s08_spendable_read_success",
      stage: "read",
      queryCode: "spendable_read",
      contractVersion: "s08.v1",
      ruleVersion: "spendable.v1",
      scenario: "EXPECTED",
      horizonDays: 365,
      result: "ZERO",
      bufferSource: "CONFIGURED",
      sourceKind: "PLANNED_EVENT",
      sourceCount: 10,
    });
    expect(info).toHaveBeenCalledOnce();
    expect(addBreadcrumbSafely).toHaveBeenCalledOnce();
    const breadcrumb = vi.mocked(addBreadcrumbSafely).mock.calls[0]?.[0];
    expect(JSON.stringify(breadcrumb)).toContain("spendable_read");
    expect(JSON.stringify(breadcrumb)).not.toContain("private");
    expect(JSON.stringify(breadcrumb)).not.toContain("999999");

    const context = toS08ObservabilityContext(operation, "success", {
      durationMs: 12,
      queryBudgetMs: 2_000,
      budgetExceeded: false,
    });
    expect(context).toMatchObject({
      entityType: "spendable",
      spendableStage: "read",
      spendableQueryCode: "spendable_read",
      spendableContractVersion: "s08.v1",
      spendableRuleVersion: "spendable.v1",
      spendableScenario: "EXPECTED",
      spendableHorizonDays: 365,
      spendableResult: "ZERO",
      spendableBufferSource: "CONFIGURED",
      spendableSourceKind: "PLANNED_EVENT",
      spendableSourceCount: 10,
      spendableQueryBudgetMs: 2_000,
      spendableBudgetExceeded: false,
    });
    expect(JSON.stringify(context)).not.toContain("description");
    expect(JSON.stringify(context)).not.toContain("999999");

    const sentry = toSafeObservabilityContext(context);
    expect(sentry.tags).toMatchObject({
      spendable_stage: "read",
      spendable_query_code: "spendable_read",
      spendable_contract_version: "s08.v1",
      spendable_rule_version: "spendable.v1",
      spendable_scenario: "EXPECTED",
      spendable_horizon_days: 365,
      spendable_result: "ZERO",
      spendable_buffer_source: "CONFIGURED",
      spendable_source_kind: "PLANNED_EVENT",
      spendable_source_count: 10,
      spendable_query_budget_ms: 2_000,
      spendable_budget_exceeded: false,
    });
    expect(JSON.stringify(sentry)).not.toContain("description");
    expect(JSON.stringify(sentry)).not.toContain("999999");

    const sanitizedBreadcrumb = sanitizeSentryBreadcrumb({
      type: "info",
      category: "spendable.read",
      data: {
        spendable_stage: "read",
        spendable_query_code: "spendable_read",
        spendable_contract_version: "s08.v1",
        spendable_rule_version: "spendable.v1",
        spendable_horizon_days: 365,
        spendable_result: "ZERO",
        spendable_source_count: 10,
        amountCents: "999999",
        description: "private description",
        timeline: [{ amountCents: "999999" }],
      },
    });
    expect(sanitizedBreadcrumb).toMatchObject({
      data: {
        spendable_stage: "read",
        spendable_query_code: "spendable_read",
        spendable_contract_version: "s08.v1",
        spendable_rule_version: "spendable.v1",
        spendable_horizon_days: 365,
        spendable_result: "ZERO",
        spendable_source_count: 10,
      },
    });
    expect(JSON.stringify(sanitizedBreadcrumb)).not.toContain("999999");
    expect(JSON.stringify(sanitizedBreadcrumb)).not.toContain("private");
  });

  it("publishes the four closed operations", () => {
    expect(S08_SPENDABLE_OPERATIONS).toEqual([
      "spendable.read",
      "spendable.forecast.build",
      "spendable.engine.calculate",
      "spendable.serialize",
    ]);
  });
});

