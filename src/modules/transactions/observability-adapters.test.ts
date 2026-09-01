import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/observability/server", () => ({
  addBreadcrumbSafely: vi.fn(),
  captureServerException: vi.fn(),
}));

import { captureServerException } from "@/modules/observability/server";
import {
  createTransactionActionHandlers,
  type TransactionCreateActionDependencies,
} from "./adapters";

const context = {
  userId: "user-1",
  householdId: "household-1",
};

const eventId = "018f47b7-6c3a-7abc-8def-1234567890ad";

const command = {
  commandId: "create-technical-1",
  amountCents: "999999",
  occurredOn: "2020-01-02",
  description: "private description",
  accountId: "018f47b7-6c3a-7abc-8def-1234567890ac",
  categoryId: null,
};

describe("T08 create adapter instrumentation", () => {
  it("captures an unexpected create persistence failure with no command payload", async () => {
    const error = new Error(
      "database failure amount=999999 description=private account=checking",
    );
    const dependencies: TransactionCreateActionDependencies = {
      resolveContext: vi.fn().mockResolvedValue(context),
      port: {
        createExpense: vi.fn().mockRejectedValue(error),
        createIncome: vi.fn(),
      },
    };

    const handlers = createTransactionActionHandlers(dependencies);
    await expect(handlers.createExpense(command)).rejects.toBe(error);

    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        event: "s03_transaction_create_expense_unexpected_error",
        useCase: "transactions.create.expense",
        operation: "create",
        entityType: "transaction",
      }),
    );

    const sentryContext = vi.mocked(captureServerException).mock.calls[0]?.[1];
    const serialized = JSON.stringify(sentryContext);
    expect(serialized).not.toContain("999999");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("checking");
    expect(serialized).not.toContain("create-technical-1");
    expect(serialized).not.toContain(eventId);
  });
});

