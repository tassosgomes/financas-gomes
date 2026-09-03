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
import type { BudgetReadResult } from "@/modules/budgets/read-contracts";
import {
  S09_BUDGET_CONTRACT_VERSION,
  S09_BUDGET_EXPECTED_ERROR_CODES,
  S09_BUDGET_OPERATIONS,
  S09_BUDGET_RESERVE_RULE,
  S09_BUDGET_RULE_VERSION,
  classifyS09Error,
  createS09BudgetOperation,
  getS09QueryBudgetMs,
  getS09SlowQueryThresholdMs,
  instrumentS09BudgetReadAccess,
  instrumentS09BudgetReadBoundary,
  logS09BudgetOperation,
  measureS09Query,
  reportS09UnexpectedError,
  sanitizeS09BudgetCounts,
  sanitizeS09BudgetLog,
  toS09ErrorEnvelope,
  toS09ObservabilityContext,
  withS09BudgetObservability,
} from "./s09";

describe("S09 safe observability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(addBreadcrumbSafely).mockClear();
    vi.mocked(captureServerException).mockClear();
  });

  it("creates versioned operation metadata without financial input", () => {
    const operation = createS09BudgetOperation("budget.provider.read", {
      requestId: "request-opaque",
      result: "PROTECTED",
      providerStatus: "AVAILABLE",
      budgetCount: 4,
      componentCount: 2,
      amountCents: "999999",
      balanceCents: "999999",
      targetAmountCents: "999999",
      name: "Caixinha privada",
      description: "descrição privada",
      category: "categoria privada",
      referenceId: "movement-private",
      payload: { amountCents: "999999" },
      sql: "SELECT amount_cents FROM budgets",
      authorization: "Bearer private-token",
      cookie: "session=private",
    });

    expect(operation).toMatchObject({
      operation: "budget.provider.read",
      stage: "provider",
      contractVersion: S09_BUDGET_CONTRACT_VERSION,
      ruleVersion: S09_BUDGET_RULE_VERSION,
      rule: S09_BUDGET_RESERVE_RULE,
      requestId: "request-opaque",
      result: "PROTECTED",
      providerStatus: "AVAILABLE",
      budgetCount: 4,
      componentCount: 2,
    });

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
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(operation).not.toHaveProperty("amountCents");
    expect(operation).not.toHaveProperty("payload");
    expect(operation).not.toHaveProperty("sql");
  });

  it("rebuilds code-owned fields and rejects unknown or mismatched values", () => {
    const safe = sanitizeS09BudgetLog({
      operation: "budget.read",
      stage: "read",
      outcome: "success",
      requestId: "request-opaque",
      correlationId: "correlation-ignored",
      contractVersion: S09_BUDGET_CONTRACT_VERSION,
      ruleVersion: S09_BUDGET_RULE_VERSION,
      rule: S09_BUDGET_RESERVE_RULE,
      result: "NO_BOXES",
      providerStatus: "AVAILABLE",
      budgetCount: 2,
      movementCount: 3,
      durationMs: 18.6,
      statusCode: 200,
      event: "caller-event",
      useCase: "caller-use-case",
      operationName: "private operation",
      amountCents: "123456",
      balance: "123456",
      targetAmountCents: "123456",
      name: "private name",
      description: "private description",
      category: "private category",
      movementReferenceId: "private-reference",
      payload: { amountCents: "123456" },
      query: "SELECT * FROM budgets",
    });

    expect(safe).toEqual({
      event: "s09_budget_read_success",
      useCase: "budget.read",
      operation: "budget.read",
      stage: "read",
      contractVersion: S09_BUDGET_CONTRACT_VERSION,
      ruleVersion: S09_BUDGET_RULE_VERSION,
      rule: S09_BUDGET_RESERVE_RULE,
      outcome: "success",
      requestId: "request-opaque",
      result: "NO_BOXES",
      providerStatus: "AVAILABLE",
      budgetCount: 2,
      movementCount: 3,
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
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(
      sanitizeS09BudgetLog({
        operation: "budget.read",
        stage: "provider",
        outcome: "success",
      }),
    ).toBeUndefined();
    expect(
      sanitizeS09BudgetLog({
        operation: "budget.read",
        outcome: "success",
        contractVersion: "s09.v2",
      }),
    ).toBeUndefined();
    expect(
      sanitizeS09BudgetLog({
        operation: "budget.read",
        outcome: "success",
        result: "PRIVATE_RESULT",
      }),
    ).toBeUndefined();
  });

  it("keeps only bounded aggregate counts and never traverses rows", () => {
    expect(
      sanitizeS09BudgetCounts({
        budget_count: 3.4,
        activeBudgets: 2,
        movements: -1,
        components: Number.POSITIVE_INFINITY,
        serialized_fields: 4,
        rows: [{ amountCents: "999999", description: "private" }],
        payload: { movementCount: 999 },
      }),
    ).toEqual({
      budgetCount: 3,
      activeBudgetCount: 2,
      movementCount: 0,
      serializedFieldCount: 4,
    });
    expect(
      sanitizeS09BudgetCounts({ budgetCount: 9_999_999_999 }),
    ).toEqual({ budgetCount: 1_000_000_000 });
  });

  it("classifies context, closed and invalid-configuration failures as expected", () => {
    for (const code of S09_BUDGET_EXPECTED_ERROR_CODES) {
      expect(classifyS09Error({ code, message: "amount=999999 private" })).toEqual({
        outcome: "expected_error",
        errorCode: code,
      });
    }
    expect(
      classifyS09Error(new FinancialContextError("HOUSEHOLD_SELECTION_REQUIRED")),
    ).toEqual({
      outcome: "expected_error",
      errorCode: "HOUSEHOLD_SELECTION_REQUIRED",
    });
    expect(
      classifyS09Error({ code: "BUDGET_PROVIDER_FAILED", message: "saldo=999999" }),
    ).toEqual({
      outcome: "unexpected_error",
      errorCode: "BUDGET_PROVIDER_FAILED",
    });
    expect(classifyS09Error(new Error("SQL amount=999999 private"))).toEqual({
      outcome: "unexpected_error",
      errorCode: "UNEXPECTED_ERROR",
    });
  });

  it("returns only a stable error code envelope", () => {
    expect(
      toS09ErrorEnvelope({
        code: "BUDGET_CLOSED",
        message: "name=private amount=999999",
        field: "amountCents",
      }),
    ).toEqual({
      ok: false,
      error: { code: "BUDGET_CLOSED" },
    });
    expect(toS09ErrorEnvelope(new Error("database private"))).toEqual({
      ok: false,
      error: { code: "UNEXPECTED_ERROR" },
    });
  });

  it("reports expected failures without turning them into Sentry incidents", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = createS09BudgetOperation("write", {
      requestId: "request-opaque",
    });

    expect(
      reportS09UnexpectedError(
        { code: "INVALID_CONFIGURATION", message: "amount=999999" },
        operation,
        7,
      ),
    ).toEqual({
      outcome: "expected_error",
      errorCode: "INVALID_CONFIGURATION",
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
        code: "BUDGET_CLOSED",
        message: "name=private amount=999999",
        payload: { balanceCents: "999999" },
      },
    };
    const operation = createS09BudgetOperation("write", {
      requestId: "request-opaque",
    });

    await expect(
      withS09BudgetObservability(operation, () => result, {
        now: vi.fn<() => number>().mockReturnValueOnce(100).mockReturnValueOnce(112),
      }),
    ).resolves.toBe(result);

    expect(captureServerException).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    const serialized = String(info.mock.calls[0]?.[0]);
    expect(serialized).toContain('"outcome":"expected_error"');
    expect(serialized).toContain('"errorCode":"BUDGET_CLOSED"');
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("999999");
  });

  it("wraps the existing T05 Result read boundary without inspecting its payload", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const capture = vi.mocked(captureServerException);
    const safeResult: BudgetReadResult<{ readonly items: readonly [] }> = {
      ok: true,
      value: { items: [] },
    };
    const reader = instrumentS09BudgetReadBoundary(
      async (input: unknown): Promise<BudgetReadResult<{ readonly items: readonly [] }>> => {
        void input;
        return safeResult;
      },
      {
        correlationId: "t05-read-correlation",
        budgetCount: 2,
        amountCents: "999999",
        payload: { name: "private" },
        now: () => 10,
      },
    );

    const observed = await reader({
      name: "private input",
      categoryId: "private-category",
      amountCents: "999999",
    });

    expect(observed).toBe(safeResult);
    expect(capture).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    const serialized = String(info.mock.calls[0]?.[0]);
    expect(serialized).toContain('"operation":"budget.read"');
    expect(serialized).toContain('"stage":"read"');
    expect(serialized).toContain('"requestId":"t05-read-correlation"');
    expect(serialized).toContain('"budgetCount":2');
    expect(serialized).not.toMatch(/999999|private|private-category/u);
  });

  it("composes all four T05 access methods and preserves expected read failures", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const failure: BudgetReadResult<never> = {
      ok: false,
      error: {
        code: "INVALID_QUERY",
        message: "private filter amount=999999",
      },
    };
    const access = {
      list: async () => failure,
      detail: async (referenceId: unknown) => {
        void referenceId;
        return failure;
      },
      history: async (referenceId: unknown) => {
        void referenceId;
        return failure;
      },
      movements: async (referenceId: unknown) => {
        void referenceId;
        return failure;
      },
    };
    const observed = instrumentS09BudgetReadAccess(access, {
      requestId: "t05-access-correlation",
      now: () => 20,
    });

    await expect(observed.list()).resolves.toBe(failure);
    await expect(observed.detail("private-reference")).resolves.toBe(failure);
    await expect(observed.history("private-reference")).resolves.toBe(failure);
    await expect(observed.movements("private-reference")).resolves.toBe(failure);

    expect(captureServerException).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(4);
    for (const call of info.mock.calls) {
      const serialized = String(call[0]);
      expect(serialized).toContain('"stage":"read"');
      expect(serialized).toContain('"outcome":"expected_error"');
      expect(serialized).toContain('"errorCode":"INVALID_QUERY"');
      expect(serialized).not.toMatch(/999999|private/u);
    }
  });

  it("relays a technical T05 read failure with safe context and the same throw", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = {
      code: "QUERY_FAILED",
      message: "SQL balance_cents=999999 for private household",
    };
    const reader = instrumentS09BudgetReadBoundary(
      async (): Promise<BudgetReadResult<never>> => {
        throw error;
      },
      {
        correlationId: "t05-technical-correlation",
        now: () => 30,
      },
    );

    await expect(reader()).rejects.toBe(error);
    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        operation: "budget.read",
        stage: "read",
        requestId: "t05-technical-correlation",
        errorCode: "QUERY_FAILED",
      }),
    );
    expect(errorLog).toHaveBeenCalledOnce();
    expect(String(errorLog.mock.calls[0]?.[0])).not.toMatch(/balance_cents|999999|private/u);
  });

  it("captures technical exceptions, preserves the throw and creates correlation", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("SELECT amount_cents=999999 description=private");
    const operation = createS09BudgetOperation("provider", {
      result: "UNAVAILABLE",
      providerStatus: "UNAVAILABLE",
    });

    await expect(
      withS09BudgetObservability(
        operation,
        () => {
          throw error;
        },
        {
          technicalErrorCode: "BUDGET_PROVIDER_FAILED",
          now: vi.fn<() => number>().mockReturnValueOnce(200).mockReturnValueOnce(225),
        },
      ),
    ).rejects.toBe(error);

    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        operation: "budget.provider.read",
        stage: "provider",
        requestId: expect.any(String),
        errorCode: "BUDGET_PROVIDER_FAILED",
        durationMs: 25,
        s09ContractVersion: S09_BUDGET_CONTRACT_VERSION,
        s09ProviderStatus: "UNAVAILABLE",
      }),
    );
    expect(errorLog).toHaveBeenCalledOnce();
    const serialized = String(errorLog.mock.calls[0]?.[0]);
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("999999");
    expect(serialized).not.toContain("private");
  });

  it("uses the same safe operation metadata for breadcrumbs and context", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = createS09BudgetOperation("distribution", {
      requestId: "request-opaque",
      result: "NO_CONFIGURATION",
      budgetCount: 4,
      distributionCount: 0,
    });
    const record = logS09BudgetOperation(operation, "success", {
      durationMs: 12,
      balanceCents: "999999",
      name: "private name",
      payload: { amountCents: "999999" },
    } as never);

    expect(record).toMatchObject({
      event: "s09_budget_distribution_success",
      stage: "distribution",
      contractVersion: S09_BUDGET_CONTRACT_VERSION,
      result: "NO_CONFIGURATION",
      budgetCount: 4,
      distributionCount: 0,
    });
    expect(info).toHaveBeenCalledOnce();
    expect(addBreadcrumbSafely).toHaveBeenCalledOnce();
    const breadcrumb = vi.mocked(addBreadcrumbSafely).mock.calls[0]?.[0];
    expect(JSON.stringify(breadcrumb)).toContain("budget.distribution");
    expect(JSON.stringify(breadcrumb)).not.toContain("999999");
    expect(JSON.stringify(breadcrumb)).not.toContain("private");

    const context = toS09ObservabilityContext(operation, "success", {
      durationMs: 12,
      result: "NO_CONFIGURATION",
      distributionCount: 0,
    });
    expect(context).toMatchObject({
      entityType: "budget",
      s09Stage: "distribution",
      s09ContractVersion: S09_BUDGET_CONTRACT_VERSION,
      s09Rule: S09_BUDGET_RESERVE_RULE,
      s09Result: "NO_CONFIGURATION",
      distributionCount: 0,
    });
    expect(JSON.stringify(context)).not.toContain("999999");
    expect(JSON.stringify(context)).not.toContain("private");
  });

  it("emits aggregate-only slow metadata and distinguishes provider failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onSlowQuery = vi.fn();
    const operation = createS09BudgetOperation("provider", {
      requestId: "request-opaque",
      providerStatus: "UNAVAILABLE",
      result: "UNAVAILABLE",
      componentCount: 2,
    });

    await expect(
      measureS09Query(
        operation,
        () => {
          throw new Error("SELECT balance_cents=999999");
        },
        {
          thresholdMs: 250,
          queryBudgetMs: 2_000,
          technicalErrorCode: "BUDGET_PROVIDER_FAILED",
          onSlowQuery,
          now: vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValueOnce(2_100),
          sql: "SELECT balance_cents FROM budgets",
        } as never,
      ),
    ).rejects.toThrow("balance_cents=999999");

    expect(warn).toHaveBeenCalledOnce();
    expect(onSlowQuery).toHaveBeenCalledOnce();
    expect(onSlowQuery.mock.calls[0]?.[0]).toMatchObject({
      stage: "provider",
      outcome: "unexpected_error",
      errorCode: "BUDGET_PROVIDER_FAILED",
      slowQuery: true,
      budgetExceeded: true,
      providerStatus: "UNAVAILABLE",
    });
    const serialized = String(warn.mock.calls[0]?.[0]);
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("999999");
  });

  it("does not emit below threshold and bounds timing settings", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onSlowQuery = vi.fn();
    const operation = createS09BudgetOperation("read", { requestId: "request-opaque" });

    await expect(
      measureS09Query(operation, () => "fast", {
        thresholdMs: 250,
        queryBudgetMs: 2_000,
        onSlowQuery,
        now: vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValueOnce(249),
      }),
    ).resolves.toBe("fast");
    expect(warn).not.toHaveBeenCalled();
    expect(onSlowQuery).not.toHaveBeenCalled();
    expect(getS09SlowQueryThresholdMs("900")).toBe(900);
    expect(getS09SlowQueryThresholdMs("999999")).toBe(60_000);
    expect(getS09SlowQueryThresholdMs("not-a-number")).toBe(250);
    expect(getS09QueryBudgetMs("900")).toBe(900);
    expect(getS09QueryBudgetMs("999999")).toBe(60_000);
    expect(getS09QueryBudgetMs("not-a-number")).toBe(2_000);
  });

  it("publishes a closed operation vocabulary and safe provider diagnosis", () => {
    expect(S09_BUDGET_OPERATIONS).toEqual([
      "budget.read",
      "budget.write",
      "budget.distribution",
      "budget.derived.calculate",
      "budget.provider.read",
      "budget.serialize",
    ]);
    expect(
      sanitizeS09BudgetLog({
        operation: "budget.delete",
        outcome: "success",
      }),
    ).toBeUndefined();
    expect(
      sanitizeS09BudgetLog({
        operation: "budget.provider.read",
        outcome: "success",
        providerStatus: "UNAVAILABLE",
        result: "NO_BOXES",
      }),
    ).toMatchObject({
      providerStatus: "UNAVAILABLE",
      result: "NO_BOXES",
    });
    expect(
      sanitizeS09BudgetLog({
        operation: "budget.provider.read",
        outcome: "success",
        providerStatus: "UNAVAILABLE",
        result: "UNAVAILABLE",
      }),
    ).toMatchObject({ providerStatus: "UNAVAILABLE", result: "UNAVAILABLE" });
  });
});
