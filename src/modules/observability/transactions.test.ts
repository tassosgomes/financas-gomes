import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/observability/server", () => ({
  addBreadcrumbSafely: vi.fn(),
  captureServerException: vi.fn(),
}));

import { FinancialContextError } from "@/modules/households/contracts";
import {
  addBreadcrumbSafely,
  captureServerException,
} from "@/modules/observability/server";
import {
  TRANSACTION_ERROR_CODES,
  TRANSACTION_ERROR_MESSAGES,
  createTransactionObservabilityOperation,
  isExpectedTransactionError,
  logTransactionObservabilityOperation,
  reportTransactionUnexpectedError,
  transactionObservabilityEventName,
  transactionObservabilityUseCaseName,
  toTransactionError,
} from "./transactions";

const context = {
  userId: "user-opaque",
  householdId: "household-opaque",
};

const eventId = "018f4f26-7c1b-7abc-8a7f-56d2b1a89f0e";

describe("transaction observability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(captureServerException).mockClear();
  });

  it("uses the ADR operation names and keeps only technical metadata", () => {
    expect(transactionObservabilityUseCaseName("create", "EXPENSE")).toBe(
      "transactions.create.expense",
    );
    expect(transactionObservabilityUseCaseName("create", "INCOME")).toBe(
      "transactions.create.income",
    );
    expect(transactionObservabilityUseCaseName("update", "MANUAL")).toBe(
      "transactions.update.manual",
    );
    expect(transactionObservabilityUseCaseName("cancel", "MANUAL")).toBe(
      "transactions.cancel.manual",
    );
    expect(transactionObservabilityEventName("cancel", "MANUAL", "success")).toBe(
      "transaction_cancel_manual_success",
    );

    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = createTransactionObservabilityOperation("create", "EXPENSE", {
      requestId: "request-opaque",
      eventId,
      amount: 123456,
      description: "salary private note",
      accountName: "Main account",
      categoryName: "Private category",
      payload: { amountCents: "123456" },
    } as never);

    expect(operation).not.toHaveProperty("amount");
    expect(operation).not.toHaveProperty("description");
    expect(operation).not.toHaveProperty("payload");

    logTransactionObservabilityOperation(operation, "success", 42.4, context);

    expect(info).toHaveBeenCalledOnce();
    const serialized = String(info.mock.calls[0]?.[0]);
    expect(serialized).toContain('"event":"transaction_create_expense_success"');
    expect(serialized).toContain('"useCase":"transactions.create.expense"');
    expect(serialized).toContain('"transactionKind":"EXPENSE"');
    expect(serialized).toContain(`"eventId":"${eventId}"`);
    expect(serialized).toContain('"durationMs":42');
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("salary");
    expect(serialized).not.toContain("Main account");
    expect(serialized).not.toContain("Private category");
    expect(serialized).not.toContain("payload");
    expect(addBreadcrumbSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "transactions.create.expense",
        data: expect.objectContaining({
          operation: "create",
          transaction_kind: "EXPENSE",
          event_id: eventId,
          outcome: "success",
          duration_ms: 42,
        }),
      }),
    );
  });

  it("reports persistence failures with operation, event ID and duration only", () => {
    const error = new Error(
      "insert failed: amount=123456 description=private account=checking",
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const operation = createTransactionObservabilityOperation("update", "MANUAL", {
      eventId,
      requestId: "request-opaque",
    });

    reportTransactionUnexpectedError(error, operation, 17.8, context);

    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        event: "transaction_update_manual_unexpected_error",
        useCase: "transactions.update.manual",
        operation: "update",
        entityType: "transaction",
        eventId,
        durationMs: 18,
        environment: "test",
        userId: context.userId,
        householdId: context.householdId,
      }),
    );
    const sentryContext = vi.mocked(captureServerException).mock.calls[0]?.[1];
    expect(JSON.stringify(sentryContext)).not.toContain("123456");
    expect(JSON.stringify(sentryContext)).not.toContain("private");
    expect(JSON.stringify(sentryContext)).not.toContain("checking");

    expect(errorLog).toHaveBeenCalledOnce();
    const serialized = String(errorLog.mock.calls[0]?.[0]);
    expect(serialized).toContain('"outcome":"unexpected_error"');
    expect(serialized).not.toContain("amount");
    expect(serialized).not.toContain("description");
    expect(addBreadcrumbSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          operation: "update",
          transaction_kind: "MANUAL",
          event_id: eventId,
          outcome: "unexpected_error",
          duration_ms: 18,
        }),
      }),
    );
  });

  it("maps every ADR error code to stable UI copy", () => {
    for (const code of TRANSACTION_ERROR_CODES) {
      const result = toTransactionError({
        code,
        message: "SQLSTATE 23505 stack=private payload",
        field: "description",
      });

      expect(result.code).toBe(code);
      expect(result.message).toBe(TRANSACTION_ERROR_MESSAGES[code]);
      expect(result.message).not.toMatch(/SQLSTATE|stack|payload|23505/iu);
      expect(result.field).toBe("description");
    }
  });

  it("recognizes context/domain failures as expected and leaves technical errors unexpected", () => {
    expect(isExpectedTransactionError(new FinancialContextError("UNAUTHENTICATED"))).toBe(
      true,
    );
    expect(isExpectedTransactionError({ code: "COMMAND_ID_REUSED" })).toBe(true);
    expect(isExpectedTransactionError(new Error("database unavailable"))).toBe(false);

    expect(toTransactionError(new FinancialContextError("UNAUTHENTICATED"))).toEqual({
      code: "UNAUTHENTICATED",
      message: TRANSACTION_ERROR_MESSAGES.UNAUTHENTICATED,
    });
  });
});
