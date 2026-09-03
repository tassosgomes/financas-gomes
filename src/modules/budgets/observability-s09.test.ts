import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/observability/server", () => ({
  addBreadcrumbSafely: vi.fn(),
  captureServerException: vi.fn(),
}));

import { captureServerException } from "@/modules/observability/server";
import type { Database } from "@/db";
import { createBudgetActionHandlers } from "./actions";
import { budgetOk } from "./contracts";
import { createBudgetUseCases } from "./use-cases";

const context = {
  userId: "00000000-0000-7000-8000-000000069101",
  householdId: "00000000-0000-7000-8000-000000069102",
} as const;

const categoryId = "00000000-0000-7000-8000-000000069103";
const budget = {
  referenceId: "budget-observability",
  name: "Reserva privada",
  categoryId,
  status: "ACTIVE" as const,
  activeFrom: "2026-09-01",
  closedOn: null,
  goal: {
    targetAmountCents: "999999",
    targetDate: "2026-12-01",
  },
};

const createCommand = {
  commandId: "create-observability",
  name: "Reserva privada",
  categoryId,
  activeFrom: "2026-09-01",
  goal: {
    targetAmountCents: "999999",
    targetDate: "2026-12-01",
  },
};

describe("T06 S09 write and Server Action integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(captureServerException).mockClear();
  });

  it("observes an action result with server correlation and no command payload", async () => {
    const records: unknown[] = [];
    const create = vi.fn(async () => budgetOk(budget));
    const handlers = createBudgetActionHandlers({
      resolveContext: vi.fn(async () => context),
      port: {
        create,
        update: vi.fn(async () => budgetOk(budget)),
        close: vi.fn(async () => budgetOk(budget)),
      },
      observability: {
        onRecord: (record) => records.push(record),
      },
    });

    const result = await handlers.createBudget(createCommand);

    expect(result).toEqual({ ok: true, value: budget });
    expect(create).toHaveBeenCalledWith(context, createCommand);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      operation: "budget.write",
      stage: "write",
      outcome: "success",
      requestId: expect.any(String),
    });
    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toMatch(/999999|Reserva privada|create-observability/u);
    expect(serialized).not.toMatch(/payload|commandId|categoryId/iu);
  });

  it("keeps malformed action input as an expected, non-Sentry write outcome", async () => {
    const records: unknown[] = [];
    const resolveContext = vi.fn(async () => context);
    const handlers = createBudgetActionHandlers({
      resolveContext,
      port: {
        create: vi.fn(async () => budgetOk(budget)),
        update: vi.fn(async () => budgetOk(budget)),
        close: vi.fn(async () => budgetOk(budget)),
      },
      observability: {
        onRecord: (record) => records.push(record),
      },
    });

    const result = await handlers.createBudget({
      ...createCommand,
      payload: { amountCents: "999999" },
      description: "descrição privada",
    });

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(resolveContext).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      operation: "budget.write",
      stage: "write",
      outcome: "expected_error",
      errorCode: "INVALID_COMMAND",
    });
    expect(JSON.stringify(records[0])).not.toMatch(/999999|descrição privada|payload/iu);
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("measures a T06 transaction and captures only a safe technical code", async () => {
    const records: unknown[] = [];
    const error = new Error("SQL amount_cents=999999 nome=privado");
    const database = {
      transaction: vi.fn(async () => {
        throw error;
      }),
    } as unknown as Database;
    const port = createBudgetUseCases({
      database,
      observability: {
        onRecord: (record) => records.push(record),
        now: vi
          .fn<() => number>()
          .mockReturnValueOnce(100)
          .mockReturnValueOnce(100)
          .mockReturnValueOnce(116)
          .mockReturnValueOnce(116),
      },
    });

    await expect(port.create(context, createCommand)).rejects.toBe(error);

    expect(database.transaction).toHaveBeenCalledOnce();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      operation: "budget.write",
      stage: "write",
      outcome: "unexpected_error",
      errorCode: "BUDGET_TRANSACTION_FAILED",
      transactionFailed: true,
    });
    expect(JSON.stringify(records[0])).not.toMatch(/999999|privado|SQL/iu);
    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        operation: "budget.write",
        stage: "write",
        errorCode: "BUDGET_TRANSACTION_FAILED",
        requestId: expect.any(String),
      }),
    );
  });
});
