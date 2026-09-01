import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/observability/server", () => ({
  addBreadcrumbSafely: vi.fn(),
  captureServerException: vi.fn(),
}));

import { captureServerException } from "@/modules/observability/server";
import {
  createTransactionMaintenanceActionHandlers,
  type TransactionMaintenanceActionDependencies,
} from "./adapters";
import type {
  ManualTransactionReadModel,
  S03Result,
} from "./contracts";

const context = {
  userId: "user-1",
  householdId: "household-1",
};

const eventId = "018f47b7-6c3a-7abc-8def-1234567890ad";

const value: ManualTransactionReadModel = {
  id: eventId,
  householdId: context.householdId,
  kind: "EXPENSE",
  status: "POSTED",
  origin: "MANUAL",
  amountCents: "123456",
  occurredOn: "2020-01-02",
  description: "Café da manhã",
  accountId: "018f47b7-6c3a-7abc-8def-1234567890ac",
  categoryId: null,
  entry: {
    id: "018f47b7-6c3a-7abc-8def-1234567890ae",
    amountCents: "-123456",
    status: "POSTED",
    postedOn: "2020-01-02",
  },
  reversal: null,
  createdAt: "2020-01-02T00:00:00.000Z",
  updatedAt: "2020-01-02T00:00:00.000Z",
};

function dependencies(
  result: S03Result<ManualTransactionReadModel> = { ok: true, value },
): TransactionMaintenanceActionDependencies & {
  resolveContext: ReturnType<typeof vi.fn>;
  revalidateTransactions: ReturnType<typeof vi.fn>;
  port: TransactionMaintenanceActionDependencies["port"] & {
    updateManualTransaction: ReturnType<typeof vi.fn>;
    cancelManualTransaction: ReturnType<typeof vi.fn>;
  };
} {
  const updateManualTransaction = vi.fn().mockResolvedValue(result);
  const cancelManualTransaction = vi.fn().mockResolvedValue(result);

  return {
    resolveContext: vi.fn().mockResolvedValue(context),
    revalidateTransactions: vi.fn(),
    port: {
      updateManualTransaction,
      cancelManualTransaction,
      update: updateManualTransaction,
      cancel: cancelManualTransaction,
    },
  };
}

describe("transaction maintenance Server Action adapter", () => {
  it("rejects non-editable payload fields before resolving context", async () => {
    const deps = dependencies();
    const handlers = createTransactionMaintenanceActionHandlers(deps);

    const result = await handlers.updateManualTransaction({
      commandId: "update-1",
      financialEventId: eventId,
      amountCents: "123456",
      description: "private",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "NON_EDITABLE_FIELD" },
    });
    expect(deps.resolveContext).not.toHaveBeenCalled();
    expect(deps.port.updateManualTransaction).not.toHaveBeenCalled();
  });

  it("logs expected update conflicts with stable copy and no revalidation", async () => {
    const deps = dependencies({
      ok: false,
      error: {
        code: "COMMAND_ID_REUSED",
        message: "raw database detail with amount=123456",
      },
    });
    const handlers = createTransactionMaintenanceActionHandlers(deps);

    const result = await handlers.updateManualTransaction({
      commandId: "update-1",
      financialEventId: eventId,
      description: "Café atualizado",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "COMMAND_ID_REUSED",
        message: "O identificador da operação já foi utilizado.",
      },
    });
    expect(deps.revalidateTransactions).not.toHaveBeenCalled();
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("calls cancel, revalidates only after success and correlates by event ID", async () => {
    const deps = dependencies();
    const handlers = createTransactionMaintenanceActionHandlers(deps);

    const result = await handlers.cancelManualTransaction({
      commandId: "cancel-1",
      financialEventId: eventId,
    });

    expect(result).toEqual({ ok: true, value });
    expect(deps.port.cancelManualTransaction).toHaveBeenCalledWith(context, {
      commandId: "cancel-1",
      financialEventId: eventId,
    });
    expect(deps.port.updateManualTransaction).not.toHaveBeenCalled();
    expect(deps.revalidateTransactions).toHaveBeenCalledOnce();
  });

  it("sends unexpected update persistence failures to Sentry without the command", async () => {
    const deps = dependencies();
    const error = new Error(
      "database failure amount=999999 description=private account=checking",
    );
    deps.port.updateManualTransaction.mockRejectedValue(error);
    const handlers = createTransactionMaintenanceActionHandlers(deps);

    await expect(
      handlers.updateManualTransaction({
        commandId: "update-technical-1",
        financialEventId: eventId,
        description: "private description",
      }),
    ).rejects.toBe(error);

    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        event: "s03_transaction_update_manual_unexpected_error",
        useCase: "transactions.update.manual",
        operation: "update",
        entityType: "transaction",
        eventId,
      }),
    );
    const sentryContext = vi.mocked(captureServerException).mock.calls[0]?.[1];
    expect(JSON.stringify(sentryContext)).not.toContain("999999");
    expect(JSON.stringify(sentryContext)).not.toContain("private");
    expect(JSON.stringify(sentryContext)).not.toContain("checking");
    expect(JSON.stringify(sentryContext)).not.toContain("update-technical-1");
    expect(deps.revalidateTransactions).not.toHaveBeenCalled();
  });
});
