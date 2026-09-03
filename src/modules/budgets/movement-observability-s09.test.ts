import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/observability/server", () => ({
  addBreadcrumbSafely: vi.fn(),
  captureServerException: vi.fn(),
}));

import { captureServerException } from "@/modules/observability/server";
import type { Database } from "@/db";
import { createBudgetMovementActionHandlers } from "./actions";
import {
  budgetOk,
  type BudgetCorrectionBoundary,
  type BudgetDistributionBoundary,
  type BudgetMovementBoundary,
  type BudgetMovementUseCasePort,
  type BudgetResult,
  type BudgetTransferBoundary,
} from "./index";
import {
  BUDGET_MOVEMENT_COMMAND_OPERATIONS,
  createBudgetMovementUseCases,
} from "./movements";

const context = {
  userId: "00000000-0000-7000-8000-000000069201",
  householdId: "00000000-0000-7000-8000-000000069202",
} as const;

const movement: BudgetMovementBoundary = {
  referenceId: "movement-observability",
  boxReferenceId: "private-box-reference",
  kind: "CONTRIBUTION",
  amountCents: "999999",
  effectiveOn: "2026-09-01",
};

const transfer: BudgetTransferBoundary = {
  transferReferenceId: "transfer-observability",
  source: {
    ...movement,
    referenceId: "transfer-withdrawal",
    boxReferenceId: "source-box",
    kind: "WITHDRAWAL",
  },
  destination: {
    ...movement,
    referenceId: "transfer-contribution",
    boxReferenceId: "destination-box",
  },
  movements: [
    {
      ...movement,
      referenceId: "transfer-withdrawal",
      boxReferenceId: "source-box",
      kind: "WITHDRAWAL",
    },
    {
      ...movement,
      referenceId: "transfer-contribution",
      boxReferenceId: "destination-box",
    },
  ],
};

const correction: BudgetCorrectionBoundary = {
  original: movement,
  compensation: {
    ...movement,
    referenceId: "correction-compensation",
    kind: "WITHDRAWAL",
    correctsReferenceId: movement.referenceId,
  },
  replacement: null,
  movements: [movement],
};

const distribution: BudgetDistributionBoundary = {
  status: "DISTRIBUTED",
  incomeReferenceId: "00000000-0000-7000-8000-000000069203",
  effectiveOn: "2026-09-01",
  originAmountCents: "999999",
  distributedAmountCents: "999999",
  remainingAmountCents: "0",
  contributions: [movement],
  ruleReferenceIds: ["private-rule-reference"],
  reconciliationKey: null,
};

function movementPort(
  overrides: Partial<BudgetMovementUseCasePort> = {},
): BudgetMovementUseCasePort {
  const registerContribution = vi.fn(async () => budgetOk(movement));
  const registerWithdrawal = vi.fn(async () =>
    budgetOk<BudgetMovementBoundary>({ ...movement, kind: "WITHDRAWAL" }),
  );
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

const contributionCommand = {
  commandId: "movement-action-observability",
  budgetReferenceId: "private-box-reference",
  amountCents: "999999",
  effectiveOn: "2026-09-01",
  referenceId: "private-movement-reference",
  sourceReferenceId: "private-source-reference",
};

describe("T07 S09 movement and distribution observability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(captureServerException).mockClear();
  });

  it("observes movement and distribution actions with safe aggregate metadata", async () => {
    const records: unknown[] = [];
    const port = movementPort();
    const handlers = createBudgetMovementActionHandlers({
      resolveContext: vi.fn(async () => context),
      port,
      observability: { onRecord: (record) => records.push(record) },
    });

    const contribution = await handlers.registerContribution(contributionCommand);
    const realizedIncome = await handlers.distributeRealizedIncome({
      commandId: "distribution-action-observability",
      financialEventId: distribution.incomeReferenceId,
      amountCents: "999999",
      effectiveOn: "2026-09-01",
    });

    expect(contribution).toEqual({ ok: true, value: movement });
    expect(realizedIncome).toEqual({ ok: true, value: distribution });
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      operation: "budget.write",
      stage: "write",
      outcome: "success",
      movementCount: 1,
      requestId: expect.any(String),
    });
    expect(records[1]).toMatchObject({
      operation: "budget.distribution",
      stage: "distribution",
      outcome: "success",
      distributionCount: 1,
      requestId: expect.any(String),
    });
    const serialized = JSON.stringify(records);
    expect(serialized).not.toMatch(
      /999999|private-box-reference|private-movement-reference|private-source-reference|payload|commandId/iu,
    );
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("classifies malformed movement input as expected without resolving context or Sentry", async () => {
    const records: unknown[] = [];
    const resolveContext = vi.fn(async () => context);
    const handlers = createBudgetMovementActionHandlers({
      resolveContext,
      port: movementPort(),
      observability: { onRecord: (record) => records.push(record) },
    });

    const result = await handlers.registerContribution({
      ...contributionCommand,
      payload: { amountCents: "999999", name: "nome privado" },
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
    expect(JSON.stringify(records[0])).not.toMatch(/999999|nome privado|payload/iu);
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("captures an action technical failure without the command payload", async () => {
    const records: unknown[] = [];
    const error = new Error("SQL amount_cents=999999 reference=private");
    const registerContribution = vi.fn(async (): Promise<BudgetResult<BudgetMovementBoundary>> => {
      throw error;
    });
    const handlers = createBudgetMovementActionHandlers({
      resolveContext: vi.fn(async () => context),
      port: movementPort({ registerContribution }),
      observability: { onRecord: (record) => records.push(record) },
    });

    await expect(handlers.registerContribution(contributionCommand)).rejects.toBe(error);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      operation: "budget.write",
      stage: "write",
      outcome: "unexpected_error",
      errorCode: "UNEXPECTED_ERROR",
      requestId: expect.any(String),
    });
    expect(JSON.stringify(records[0])).not.toMatch(/999999|private|SQL|commandId/iu);
    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        operation: "budget.write",
        stage: "write",
        errorCode: "UNEXPECTED_ERROR",
        requestId: expect.any(String),
      }),
    );
  });

  it.each([
    ["contribution", BUDGET_MOVEMENT_COMMAND_OPERATIONS.contribution, 1],
    ["withdrawal", BUDGET_MOVEMENT_COMMAND_OPERATIONS.withdrawal, 1],
    ["transfer", BUDGET_MOVEMENT_COMMAND_OPERATIONS.transfer, 2],
    ["correction", BUDGET_MOVEMENT_COMMAND_OPERATIONS.correct, 1],
    ["distribution", BUDGET_MOVEMENT_COMMAND_OPERATIONS.distribution, undefined],
  ] as const)("keeps %s operation on the S09 allow-list", async (_name, operation, count) => {
    const records: unknown[] = [];
    const handlers = createBudgetMovementActionHandlers({
      resolveContext: vi.fn(async () => context),
      port: movementPort(),
      observability: { onRecord: (record) => records.push(record) },
    });
    const inputByOperation: Record<string, unknown> = {
      [BUDGET_MOVEMENT_COMMAND_OPERATIONS.contribution]: contributionCommand,
      [BUDGET_MOVEMENT_COMMAND_OPERATIONS.withdrawal]: {
        ...contributionCommand,
        commandId: "movement-withdrawal-observability",
      },
      [BUDGET_MOVEMENT_COMMAND_OPERATIONS.transfer]: {
        commandId: "movement-transfer-observability",
        sourceBudgetReferenceId: "source-box",
        destinationBudgetReferenceId: "destination-box",
        amountCents: "999999",
        effectiveOn: "2026-09-01",
      },
      [BUDGET_MOVEMENT_COMMAND_OPERATIONS.correct]: {
        commandId: "movement-correction-observability",
        budgetReferenceId: "private-box-reference",
        correctsReferenceId: "private-movement-reference",
      },
      [BUDGET_MOVEMENT_COMMAND_OPERATIONS.distribution]: {
        commandId: "movement-distribution-observability",
        financialEventId: distribution.incomeReferenceId,
      },
    };
    const handlerByOperation: Record<string, (input: unknown) => Promise<unknown>> = {
      [BUDGET_MOVEMENT_COMMAND_OPERATIONS.contribution]: handlers.registerContribution,
      [BUDGET_MOVEMENT_COMMAND_OPERATIONS.withdrawal]: handlers.registerWithdrawal,
      [BUDGET_MOVEMENT_COMMAND_OPERATIONS.transfer]: handlers.transferBetweenBudgets,
      [BUDGET_MOVEMENT_COMMAND_OPERATIONS.correct]: handlers.correctMovement,
      [BUDGET_MOVEMENT_COMMAND_OPERATIONS.distribution]: handlers.distributeRealizedIncome,
    };

    await handlerByOperation[operation](inputByOperation[operation]);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      operation: operation === BUDGET_MOVEMENT_COMMAND_OPERATIONS.distribution
        ? "budget.distribution"
        : "budget.write",
      ...(count === undefined ? { distributionCount: 1 } : { movementCount: count }),
    });
  });

  it("measures a movement transaction and captures only BUDGET_TRANSACTION_FAILED", async () => {
    const records: unknown[] = [];
    const error = new Error("SQL amount_cents=999999 reference=private");
    const database = {
      transaction: vi.fn(async () => {
        throw error;
      }),
    } as unknown as Database;
    const port = createBudgetMovementUseCases({
      database,
      observability: { onRecord: (record) => records.push(record) },
    });

    await expect(port.registerContribution(context, contributionCommand)).rejects.toBe(error);

    expect(database.transaction).toHaveBeenCalledOnce();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      operation: "budget.write",
      stage: "write",
      outcome: "unexpected_error",
      errorCode: "BUDGET_TRANSACTION_FAILED",
      transactionFailed: true,
      movementCount: 1,
    });
    expect(JSON.stringify(records[0])).not.toMatch(/999999|private|SQL|commandId/iu);
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
