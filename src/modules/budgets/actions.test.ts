import { describe, expect, it, vi } from "vitest";

import { FinancialContextError } from "@/modules/households/contracts";

import {
  createBudgetActionHandlers,
} from "./actions";
import { budgetOk, type BudgetBoundary } from "./contracts";

const context = {
  userId: "00000000-0000-7000-8000-000000060101",
  householdId: "00000000-0000-7000-8000-000000060102",
} as const;

const budget: BudgetBoundary = {
  referenceId: "budget-reference",
  name: "Reserva",
  categoryId: "00000000-0000-7000-8000-000000060103",
  status: "ACTIVE",
  activeFrom: "2026-09-01",
  closedOn: null,
  goal: null,
};

describe("budget Server Action adapter", () => {
  it("resolves the server context, delegates once and revalidates after success", async () => {
    const revalidate = vi.fn();
    const port = {
      create: vi.fn(async () => budgetOk(budget)),
      update: vi.fn(async () => budgetOk(budget)),
      close: vi.fn(async () =>
        budgetOk<BudgetBoundary>({
          ...budget,
          status: "CLOSED",
          closedOn: "2026-10-01",
        }),
      ),
    };
    const handlers = createBudgetActionHandlers({
      resolveContext: vi.fn(async () => context),
      port,
      revalidateBudgetViews: revalidate,
    });

    const result = await handlers.createBudget({
      commandId: "create-1",
      name: "Reserva",
      categoryId: budget.categoryId,
      activeFrom: "2026-09-01",
    });

    expect(result).toEqual({ ok: true, value: budget });
    expect(port.create).toHaveBeenCalledWith(context, {
      commandId: "create-1",
      name: "Reserva",
      categoryId: budget.categoryId,
      activeFrom: "2026-09-01",
    });
    expect(revalidate).toHaveBeenCalledWith(budget);
  });

  it("does not revalidate an expected domain failure", async () => {
    const revalidate = vi.fn();
    const handlers = createBudgetActionHandlers({
      resolveContext: vi.fn(async () => context),
      port: {
        create: vi.fn(async () => ({
          ok: false as const,
          error: {
            code: "CATEGORY_NOT_FOUND" as const,
            message: "A categoria não foi encontrada.",
          },
        })),
        update: vi.fn(async () => budgetOk(budget)),
        close: vi.fn(async () => budgetOk(budget)),
      },
      revalidateBudgetViews: revalidate,
    });

    const result = await handlers.createBudget({
      commandId: "create-1",
      name: "Reserva",
      categoryId: budget.categoryId,
      activeFrom: "2026-09-01",
    });

    expect(result.ok).toBe(false);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("maps an unavailable authenticated context to the stable public error", async () => {
    const handlers = createBudgetActionHandlers({
      resolveContext: vi.fn(async () => {
        throw new FinancialContextError("HOUSEHOLD_MEMBERSHIP_REQUIRED");
      }),
      port: {
        create: vi.fn(async () => budgetOk(budget)),
        update: vi.fn(async () => budgetOk(budget)),
        close: vi.fn(async () => budgetOk(budget)),
      },
    });

    await expect(handlers.createBudget({
      commandId: "create-1",
      name: "Reserva",
      categoryId: budget.categoryId,
      activeFrom: "2026-09-01",
    })).resolves.toEqual({
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "É necessário entrar para acessar este recurso.",
      },
    });
  });

  it("rejects malformed browser input before resolving tenant context", async () => {
    const resolveContext = vi.fn(async () => context);
    const handlers = createBudgetActionHandlers({
      resolveContext,
      port: {
        create: vi.fn(async () => budgetOk(budget)),
        update: vi.fn(async () => budgetOk(budget)),
        close: vi.fn(async () => budgetOk(budget)),
      },
    });

    const result = await handlers.createBudget({
      commandId: "invalid",
      name: "Reserva",
      categoryId: budget.categoryId,
      activeFrom: "2026-09-01",
      householdId: "forged-household",
    });

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(resolveContext).not.toHaveBeenCalled();
  });

  it("offers box aliases without adding a tenant or balance field", async () => {
    const create = vi.fn(async () => budgetOk(budget));
    const handlers = createBudgetActionHandlers({
      resolveContext: vi.fn(async () => context),
      port: {
        create,
        update: vi.fn(async () => budgetOk(budget)),
        close: vi.fn(async () => budgetOk(budget)),
      },
    });

    const result = await handlers.createBox({
      commandId: "create-1",
      name: "Reserva",
      categoryId: budget.categoryId,
      activeFrom: "2026-09-01",
    });

    expect(result).toEqual({ ok: true, value: budget });
    expect(create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(/household|balance|targetAmount/iu);
  });
});
