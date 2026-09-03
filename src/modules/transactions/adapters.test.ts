import { describe, expect, it, vi } from "vitest";

import { FinancialContextError } from "@/modules/households/contracts";

import {
  createTransactionActionHandlers,
  type TransactionCreateActionDependencies,
} from "./adapters";
import type {
  ManualTransactionReadModel,
  TransactionResult,
} from "./contracts";

const context = {
  userId: "user-1",
  householdId: "household-1",
};

const command = {
  commandId: "attempt-1",
  amountCents: "123456",
  occurredOn: "2020-01-02",
  description: "Café da manhã",
  accountId: "018f47b7-6c3a-7abc-8def-1234567890ac",
  categoryId: null,
};

const value: ManualTransactionReadModel = {
  id: "018f47b7-6c3a-7abc-8def-1234567890ad",
  householdId: context.householdId,
  kind: "EXPENSE",
  status: "POSTED",
  origin: "MANUAL",
  amountCents: command.amountCents,
  occurredOn: command.occurredOn,
  description: command.description,
  accountId: command.accountId,
  categoryId: null,
  entry: {
    id: "018f47b7-6c3a-7abc-8def-1234567890ae",
    amountCents: "-123456",
    status: "POSTED",
    postedOn: command.occurredOn,
  },
  reversal: null,
  createdAt: "2020-01-02T00:00:00.000Z",
  updatedAt: "2020-01-02T00:00:00.000Z",
};

function dependencies(
  result: TransactionResult<ManualTransactionReadModel> = { ok: true, value },
): TransactionCreateActionDependencies & {
  resolveContext: ReturnType<typeof vi.fn>;
  revalidateTransactions: ReturnType<typeof vi.fn>;
  port: TransactionCreateActionDependencies["port"] & {
    createExpense: ReturnType<typeof vi.fn>;
    createIncome: ReturnType<typeof vi.fn>;
  };
} {
  return {
    resolveContext: vi.fn().mockResolvedValue(context),
    revalidateTransactions: vi.fn(),
    port: {
      createExpense: vi.fn().mockResolvedValue(result),
      createIncome: vi.fn().mockResolvedValue(result),
    },
  };
}

describe("transaction create Server Action adapter", () => {
  it("validates before resolving context and rejects tenant authority", async () => {
    const deps = dependencies();
    const handlers = createTransactionActionHandlers(deps);

    const result = await handlers.createExpense({
      ...command,
      householdId: "forged-household",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "NON_EDITABLE_FIELD" },
    });
    expect(deps.resolveContext).not.toHaveBeenCalled();
    expect(deps.port.createExpense).not.toHaveBeenCalled();
  });

  it("calls the operation-specific T05 port and revalidates only after success", async () => {
    const deps = dependencies();
    const handlers = createTransactionActionHandlers(deps);

    const result = await handlers.createExpense(command);

    expect(result).toEqual({ ok: true, value });
    expect(deps.resolveContext).toHaveBeenCalledOnce();
    expect(deps.port.createExpense).toHaveBeenCalledWith(context, command);
    expect(deps.port.createIncome).not.toHaveBeenCalled();
    expect(deps.revalidateTransactions).toHaveBeenCalledOnce();
  });

  it("selects income without adding a client-controlled kind to the command", async () => {
    const income = { ...value, kind: "INCOME" as const };
    const deps = dependencies({ ok: true, value: income });
    const handlers = createTransactionActionHandlers(deps);

    const result = await handlers.createIncome(command);

    expect(result).toEqual({ ok: true, value: income });
    expect(deps.port.createIncome).toHaveBeenCalledWith(context, command);
    expect(deps.port.createExpense).not.toHaveBeenCalled();
  });

  it("translates expected backend errors to stable UI copy", async () => {
    const deps = dependencies({
      ok: false,
      error: { code: "CATEGORY_KIND_MISMATCH", message: "raw backend detail" },
    });
    const handlers = createTransactionActionHandlers(deps);

    const result = await handlers.createExpense(command);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "CATEGORY_KIND_MISMATCH",
        message: "A categoria precisa ter o mesmo tipo do lançamento.",
      },
    });
    expect(deps.revalidateTransactions).not.toHaveBeenCalled();
  });

  it("returns authentication failures without exposing context internals", async () => {
    const deps = dependencies();
    deps.resolveContext.mockRejectedValue(
      new FinancialContextError("UNAUTHENTICATED"),
    );
    const handlers = createTransactionActionHandlers(deps);

    const result = await handlers.createExpense(command);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "É necessário entrar para acessar este recurso.",
      },
    });
    expect(deps.port.createExpense).not.toHaveBeenCalled();
  });

  it("keeps technical failures outside Result for observability", async () => {
    const deps = dependencies();
    const failure = new Error("database unavailable");
    deps.port.createExpense.mockRejectedValue(failure);
    const handlers = createTransactionActionHandlers(deps);

    await expect(handlers.createExpense(command)).rejects.toBe(failure);
    expect(deps.revalidateTransactions).not.toHaveBeenCalled();
  });
});
