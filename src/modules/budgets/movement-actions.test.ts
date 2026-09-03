import { describe, expect, it, vi } from "vitest";

import { FinancialContextError } from "@/modules/households/contracts";

import {
  createBudgetMovementActionHandlers,
} from "./actions";
import {
  budgetOk,
  type BudgetCorrectionBoundary,
  type BudgetDistributionBoundary,
  type BudgetMovementBoundary,
  type BudgetTransferBoundary,
  type BudgetResult,
} from "./contracts";
import type { BudgetMovementUseCasePort } from "./movements";

const context = {
  userId: "00000000-0000-7000-8000-000000070101",
  householdId: "00000000-0000-7000-8000-000000070102",
} as const;

const movement: BudgetMovementBoundary = {
  referenceId: "t07-action-movement",
  boxReferenceId: "box-action",
  kind: "CONTRIBUTION",
  amountCents: "1000",
  effectiveOn: "2026-09-01",
};

const transfer: BudgetTransferBoundary = {
  transferReferenceId: "t07-action-transfer",
  source: { ...movement, referenceId: "t07-action-withdrawal", boxReferenceId: "box-action-a", kind: "WITHDRAWAL" },
  destination: { ...movement, referenceId: "t07-action-contribution", boxReferenceId: "box-action-b" },
  movements: [
    { ...movement, referenceId: "t07-action-withdrawal", boxReferenceId: "box-action-a", kind: "WITHDRAWAL" },
    { ...movement, referenceId: "t07-action-contribution", boxReferenceId: "box-action-b" },
  ],
};

const correction: BudgetCorrectionBoundary = {
  original: movement,
  compensation: { ...movement, referenceId: "t07-action-compensation", kind: "WITHDRAWAL", correctsReferenceId: movement.referenceId },
  replacement: null,
  movements: [movement],
};

const distribution: BudgetDistributionBoundary = {
  status: "DISTRIBUTED",
  incomeReferenceId: "00000000-0000-7000-8000-000000070401",
  effectiveOn: "2026-09-01",
  originAmountCents: "1000",
  distributedAmountCents: "1000",
  remainingAmountCents: "0",
  contributions: [movement],
  ruleReferenceIds: ["t07-action-rule"],
  reconciliationKey: null,
};

function movementPort(
  overrides: Partial<BudgetMovementUseCasePort> = {},
): BudgetMovementUseCasePort {
  const registerContribution = vi.fn(async () => budgetOk(movement));
  const registerWithdrawal = vi.fn(async () => budgetOk<BudgetMovementBoundary>({ ...movement, kind: "WITHDRAWAL" }));
  const transferBetweenBudgets = vi.fn(async () => budgetOk(transfer));
  const correctMovement = vi.fn(async () => budgetOk(correction));
  const distributeRealizedIncome = vi.fn(async () => budgetOk(distribution));
  return {
    registerContribution,
    registerWithdrawal,
    transferBetweenBudgets,
    correctMovement,
    distributeRealizedIncome,
    contribution: registerContribution,
    withdrawal: registerWithdrawal,
    transfer: transferBetweenBudgets,
    correct: correctMovement,
    distribute: distributeRealizedIncome,
    ...overrides,
  };
}

describe("T07 movement Server Action adapter", () => {
  it("parses before context, delegates and revalidates successful contributions", async () => {
    const resolveContext = vi.fn(async () => context);
    const revalidate = vi.fn();
    const port = movementPort();
    const handlers = createBudgetMovementActionHandlers({
      resolveContext,
      port,
      revalidateBudgetViews: revalidate,
    });

    const result = await handlers.registerContribution({
      commandId: "t07-action-contribution",
      budgetReferenceId: "box-action",
      amountCents: "1000",
      effectiveOn: "2026-09-01",
      referenceId: "t07-action-movement",
    });

    expect(result).toEqual({ ok: true, value: movement });
    expect(resolveContext).toHaveBeenCalledTimes(1);
    expect(port.registerContribution).toHaveBeenCalledWith(context, {
      commandId: "t07-action-contribution",
      budgetReferenceId: "box-action",
      amountCents: "1000",
      effectiveOn: "2026-09-01",
      referenceId: "t07-action-movement",
    });
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("does not resolve context or revalidate malformed/failed commands", async () => {
    const resolveContext = vi.fn(async () => context);
    const revalidate = vi.fn();
    const registerContribution = vi.fn(async () =>
      ({
        ok: false as const,
        error: { code: "DUPLICATE_REFERENCE" as const, message: "duplicado" },
      } satisfies BudgetResult<BudgetMovementBoundary>),
    );
    const handlers = createBudgetMovementActionHandlers({
      resolveContext,
      port: movementPort({ registerContribution }),
      revalidateBudgetViews: revalidate,
    });

    const malformed = await handlers.registerContribution({
      commandId: "bad",
      budgetReferenceId: "box-action",
      amountCents: "0",
      effectiveOn: "2026-09-01",
    });
    expect(malformed).toMatchObject({ ok: false, error: { code: "INVALID_AMOUNT" } });
    expect(resolveContext).not.toHaveBeenCalled();

    const failure = await handlers.registerContribution({
      commandId: "t07-action-contribution",
      budgetReferenceId: "box-action",
      amountCents: "1000",
      effectiveOn: "2026-09-01",
    });
    expect(failure).toMatchObject({ ok: false, error: { code: "DUPLICATE_REFERENCE" } });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("maps missing authenticated context and supports transfer/correction aliases", async () => {
    const port = movementPort();
    const handlers = createBudgetMovementActionHandlers({
      resolveContext: vi.fn(async () => {
        throw new FinancialContextError("HOUSEHOLD_MEMBERSHIP_REQUIRED");
      }),
      port,
    });
    const transferResult = await handlers.transfer({
      commandId: "t07-action-transfer",
      sourceBudgetReferenceId: "box-action-a",
      destinationBudgetReferenceId: "box-action-b",
      amountCents: "1000",
      effectiveOn: "2026-09-01",
      withdrawalReferenceId: "t07-action-withdrawal",
      contributionReferenceId: "t07-action-contribution",
    });
    expect(transferResult).toEqual({
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "É necessário entrar para acessar este recurso.",
      },
    });
    expect(port.transferBetweenBudgets).not.toHaveBeenCalled();
  });

  it("revalidates each successful movement class through one public adapter", async () => {
    const revalidate = vi.fn();
    const port = movementPort();
    const handlers = createBudgetMovementActionHandlers({
      resolveContext: vi.fn(async () => context),
      port,
      revalidateBudgetViews: revalidate,
    });
    await handlers.withdrawal({
      commandId: "t07-action-withdrawal",
      budgetReferenceId: "box-action",
      amountCents: "1000",
      effectiveOn: "2026-09-01",
    });
    await handlers.transfer({
      commandId: "t07-action-transfer",
      sourceBudgetReferenceId: "box-action-a",
      destinationBudgetReferenceId: "box-action-b",
      amountCents: "1000",
      effectiveOn: "2026-09-01",
      withdrawalReferenceId: "t07-action-withdrawal",
      contributionReferenceId: "t07-action-contribution",
    });
    await handlers.correct({
      commandId: "t07-action-correction",
      budgetReferenceId: "box-action",
      correctsReferenceId: "t07-action-movement",
      correctionReferenceId: "t07-action-compensation",
    });
    await handlers.distribute({
      commandId: "t07-action-distribution",
      financialEventId: distribution.incomeReferenceId,
    });
    expect(revalidate).toHaveBeenCalledTimes(4);
    expect(port.registerWithdrawal).toHaveBeenCalledTimes(1);
    expect(port.transferBetweenBudgets).toHaveBeenCalledTimes(1);
    expect(port.correctMovement).toHaveBeenCalledTimes(1);
    expect(port.distributeRealizedIncome).toHaveBeenCalledTimes(1);
  });
});
