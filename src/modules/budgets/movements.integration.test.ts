import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  applicationCommands,
  budgetAllocationRules,
  budgetMovements,
  budgets,
  categories,
  financialEvents,
  households,
} from "@/db/schema";

import { deriveBudgetBalance } from "./balance";
import { allocationContributionReferenceId } from "./allocation-rules";
import {
  createBudget,
  normalizeBudgetMovement,
} from "./domain";
import { BUDGET_MOVEMENT_FIXTURE } from "./movement-fixtures";
import { createBudgetMovementUseCases } from "./movements";

const integration =
  process.env.T07_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  householdA: "00000000-0000-7000-8000-000000071101",
  householdB: "00000000-0000-7000-8000-000000071102",
  accountA: "00000000-0000-7000-8000-000000071201",
  categoryExpenseA: "00000000-0000-7000-8000-000000071301",
  categoryExpenseB: "00000000-0000-7000-8000-000000071302",
  categoryIncomeA: "00000000-0000-7000-8000-000000071303",
  budgetA: "00000000-0000-7000-8000-000000071401",
  budgetB: "00000000-0000-7000-8000-000000071402",
  incomeEvent: "00000000-0000-7000-8000-000000071501",
  plannedIncomeEvent: "00000000-0000-7000-8000-000000071502",
  expenseEvent: "00000000-0000-7000-8000-000000071503",
  expenseEntry: "00000000-0000-7000-8000-000000071601",
  ruleA: "00000000-0000-7000-8000-000000071701",
  ruleB: "00000000-0000-7000-8000-000000071702",
} as const;

const CONTEXT_A = {
  userId: "00000000-0000-7000-8000-000000071801",
  householdId: FIXTURES.householdA,
} as const;
const CONTEXT_B = {
  userId: "00000000-0000-7000-8000-000000071802",
  householdId: FIXTURES.householdB,
} as const;

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) throw new Error("O banco de integração T07 não foi inicializado.");
  return database;
}

async function cleanup(database: Database): Promise<void> {
  // The append-only trigger intentionally rejects ordinary movement DELETEs.
  // TRUNCATE is limited to the disposable integration database, as in T03.
  await database.execute(
    sql.raw(
      "truncate table budget_movements, budget_allocation_rules, budgets",
    ),
  );
  await database
    .delete(applicationCommands)
    .where(inArray(applicationCommands.householdId, [FIXTURES.householdA, FIXTURES.householdB]));
  await database
    .delete(accountEntries)
    .where(inArray(accountEntries.householdId, [FIXTURES.householdA, FIXTURES.householdB]));
  await database
    .delete(financialEvents)
    .where(inArray(financialEvents.householdId, [FIXTURES.householdA, FIXTURES.householdB]));
  await database
    .delete(categories)
    .where(inArray(categories.householdId, [FIXTURES.householdA, FIXTURES.householdB]));
  await database
    .delete(accounts)
    .where(inArray(accounts.householdId, [FIXTURES.householdA, FIXTURES.householdB]));
  await database
    .delete(households)
    .where(inArray(households.id, [FIXTURES.householdA, FIXTURES.householdB]));
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.householdA, name: "T07 Household A" },
    { id: FIXTURES.householdB, name: "T07 Household B" },
  ]);
  await database.insert(accounts).values({
    id: FIXTURES.accountA,
    householdId: FIXTURES.householdA,
    name: "T07 Checking",
    type: "CHECKING",
  });
  await database.insert(categories).values([
    {
      id: FIXTURES.categoryExpenseA,
      householdId: FIXTURES.householdA,
      name: "T07 Expense A",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categoryExpenseB,
      householdId: FIXTURES.householdA,
      name: "T07 Expense B",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categoryIncomeA,
      householdId: FIXTURES.householdA,
      name: "T07 Income A",
      kind: "INCOME",
    },
  ]);
  await database.insert(financialEvents).values([
    {
      id: FIXTURES.incomeEvent,
      householdId: FIXTURES.householdA,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt("1150000"),
      occurredOn: "2026-09-01",
      description: "T07 posted income",
      categoryId: FIXTURES.categoryIncomeA,
    },
    {
      id: FIXTURES.plannedIncomeEvent,
      householdId: FIXTURES.householdA,
      kind: "INCOME",
      status: "EXPECTED",
      origin: "MANUAL",
      amountCents: BigInt("300000"),
      occurredOn: "2026-09-01",
      description: "T07 planned income",
      categoryId: FIXTURES.categoryIncomeA,
    },
    {
      id: FIXTURES.expenseEvent,
      householdId: FIXTURES.householdA,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt("1200"),
      occurredOn: "2026-09-02",
      description: "T07 posted expense",
      categoryId: FIXTURES.categoryExpenseA,
    },
  ]);
  await database.insert(accountEntries).values({
    id: FIXTURES.expenseEntry,
    financialEventId: FIXTURES.expenseEvent,
    accountId: FIXTURES.accountA,
    householdId: FIXTURES.householdA,
    amountCents: BigInt("-1200"),
    status: "POSTED",
    postedOn: "2026-09-02",
  });
  await database.insert(budgets).values([
    {
      id: FIXTURES.budgetA,
      householdId: FIXTURES.householdA,
      referenceId: "box-movement-a",
      categoryId: FIXTURES.categoryExpenseA,
      name: "T07 Budget A",
      activeFrom: "2026-01-01",
    },
    {
      id: FIXTURES.budgetB,
      householdId: FIXTURES.householdA,
      referenceId: "box-movement-b",
      categoryId: FIXTURES.categoryExpenseB,
      name: "T07 Budget B",
      activeFrom: "2026-01-01",
    },
  ]);
  await database.insert(budgetAllocationRules).values([
    {
      id: FIXTURES.ruleA,
      householdId: FIXTURES.householdA,
      budgetId: FIXTURES.budgetA,
      amountCents: BigInt("3"),
      effectiveFrom: "2026-01-01",
    },
    {
      id: FIXTURES.ruleB,
      householdId: FIXTURES.householdA,
      budgetId: FIXTURES.budgetB,
      amountCents: BigInt("1"),
      effectiveFrom: "2026-01-01",
    },
  ]);
}

function aggregate(referenceId: "box-movement-a" | "box-movement-b") {
  return createBudget({
    referenceId,
    name: `T07 ${referenceId}`,
    categoryId:
      referenceId === "box-movement-a"
        ? FIXTURES.categoryExpenseA
        : FIXTURES.categoryExpenseB,
    activeFrom: "2026-01-01",
  });
}

async function rowsForBudget(
  database: Database,
  budgetId: string,
  householdId = FIXTURES.householdA,
) {
  return database
    .select()
    .from(budgetMovements)
    .where(
      and(
        eq(budgetMovements.householdId, householdId),
        eq(budgetMovements.budgetId, budgetId),
      ),
    )
    .orderBy(budgetMovements.effectiveOn, budgetMovements.id);
}

function movementInputs(
  rows: Awaited<ReturnType<typeof rowsForBudget>>,
  referenceId: "box-movement-a" | "box-movement-b",
) {
  return rows.map((row) =>
    normalizeBudgetMovement(
      {
        referenceId: row.referenceId,
        boxReferenceId: referenceId,
        kind: row.kind,
        amountCents: row.amountCents,
        effectiveOn: row.effectiveOn,
        correctsReferenceId: null,
        transferReferenceId: row.transferReferenceId,
        sourceReferenceId: row.sourceReferenceId,
      },
      aggregate(referenceId),
    ),
  );
}

integration("T07 transactional budget movements", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de T07_INTEGRATION=1.",
      );
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = databaseOrThrow(database);
    await cleanup(db);
    await seed(db);
  });

  afterAll(async () => {
    if (database) await cleanup(database);
    await closeDb();
  });

  it("persists signed contribution/withdrawal rows and retries the same result", async () => {
    const db = databaseOrThrow(database);
    const useCases = createBudgetMovementUseCases(db);
    const contribution = await useCases.registerContribution(
      CONTEXT_A,
      BUDGET_MOVEMENT_FIXTURE.contribution,
    );
    const withdrawal = await useCases.registerWithdrawal(
      CONTEXT_A,
      BUDGET_MOVEMENT_FIXTURE.withdrawal,
    );
    expect(contribution).toMatchObject({
      ok: true,
      value: {
        referenceId: "t07-contribution-reference",
        kind: "CONTRIBUTION",
        amountCents: "10000",
      },
    });
    expect(withdrawal).toMatchObject({
      ok: true,
      value: {
        referenceId: "t07-withdrawal-reference",
        kind: "WITHDRAWAL",
        amountCents: "3000",
      },
    });
    const retried = await useCases.registerContribution(
      CONTEXT_A,
      BUDGET_MOVEMENT_FIXTURE.contribution,
    );
    expect(retried).toEqual(contribution);

    const rows = await rowsForBudget(db, FIXTURES.budgetA);
    const balance = deriveBudgetBalance(
      aggregate("box-movement-a"),
      movementInputs(rows, "box-movement-a"),
      "2026-09-30",
    );
    expect(balance.balance.cents).toBe(BigInt("7000"));
    expect(rows).toHaveLength(2);

    const reusedCommand = await useCases.registerContribution(CONTEXT_A, {
      ...BUDGET_MOVEMENT_FIXTURE.contribution,
      amountCents: "10001",
    });
    expect(reusedCommand).toMatchObject({ ok: false, error: { code: "COMMAND_ID_REUSED" } });
    const reusedReference = await useCases.registerContribution(CONTEXT_A, {
      ...BUDGET_MOVEMENT_FIXTURE.contribution,
      commandId: "t07-contribution-new-command",
      amountCents: "10001",
    });
    expect(reusedReference).toMatchObject({ ok: false, error: { code: "DUPLICATE_REFERENCE" } });
  });

  it("links an expense to its posted event/entry and isolates another household", async () => {
    const db = databaseOrThrow(database);
    const useCases = createBudgetMovementUseCases(db);
    const expense = await useCases.registerWithdrawal(CONTEXT_A, {
      commandId: "t07-expense-withdrawal",
      budgetReferenceId: "box-movement-a",
      amountCents: "1200",
      effectiveOn: "2026-09-02",
      referenceId: "t07-expense-reference",
      sourceKind: "EXPENSE",
      sourceReferenceId: FIXTURES.expenseEvent,
      financialEventId: FIXTURES.expenseEvent,
      accountEntryId: FIXTURES.expenseEntry,
    });
    expect(expense).toMatchObject({ ok: true, value: { kind: "WITHDRAWAL" } });
    const row = await db
      .select()
      .from(budgetMovements)
      .where(eq(budgetMovements.referenceId, "t07-expense-reference"));
    expect(row[0]).toMatchObject({
      sourceKind: "EXPENSE",
      sourceReferenceId: FIXTURES.expenseEvent,
      financialEventId: FIXTURES.expenseEvent,
      accountEntryId: FIXTURES.expenseEntry,
    });

    const foreign = await useCases.registerContribution(CONTEXT_B, {
      commandId: "t07-cross-tenant",
      budgetReferenceId: "box-movement-a",
      amountCents: "1",
      effectiveOn: "2026-09-01",
    });
    expect(foreign).toMatchObject({ ok: false, error: { code: "BUDGET_NOT_FOUND" } });
    const tenantRows = await db
      .select({ id: budgetMovements.id })
      .from(budgetMovements)
      .where(eq(budgetMovements.householdId, FIXTURES.householdB));
    expect(tenantRows).toEqual([]);
  });

  it("writes transfer pairs atomically without a financial event or bank entry", async () => {
    const db = databaseOrThrow(database);
    const useCases = createBudgetMovementUseCases(db);
    const beforeEvents = await db
      .select({ id: financialEvents.id })
      .from(financialEvents)
      .where(eq(financialEvents.householdId, FIXTURES.householdA));
    const result = await useCases.transferBetweenBudgets(
      CONTEXT_A,
      BUDGET_MOVEMENT_FIXTURE.transfer,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        transferReferenceId: "t07-transfer-reference",
        source: { kind: "WITHDRAWAL", amountCents: "2500" },
        destination: { kind: "CONTRIBUTION", amountCents: "2500" },
      },
    });
    const retry = await useCases.transferBetweenBudgets(
      CONTEXT_A,
      BUDGET_MOVEMENT_FIXTURE.transfer,
    );
    expect(retry).toEqual(result);
    const pair = await db
      .select()
      .from(budgetMovements)
      .where(eq(budgetMovements.transferReferenceId, "t07-transfer-reference"));
    expect(pair).toHaveLength(2);
    expect(new Set(pair.map((row) => row.referenceId))).toEqual(
      new Set(["t07-transfer-withdrawal", "t07-transfer-contribution"]),
    );
    const afterEvents = await db
      .select({ id: financialEvents.id })
      .from(financialEvents)
      .where(eq(financialEvents.householdId, FIXTURES.householdA));
    expect(afterEvents).toEqual(beforeEvents);
    const householdAccountEntries = await db
      .select()
      .from(accountEntries)
      .where(eq(accountEntries.householdId, FIXTURES.householdA));
    expect(householdAccountEntries).toHaveLength(1);

    const minimal = await useCases.transferBetweenBudgets(CONTEXT_A, {
      commandId: "t07-derived-transfer",
      sourceBudgetReferenceId: "box-movement-a",
      destinationBudgetReferenceId: "box-movement-b",
      amountCents: "1",
      effectiveOn: "2026-09-04",
    });
    expect(minimal).toMatchObject({
      ok: true,
      value: {
        transferReferenceId: "transfer:t07-derived-transfer",
        source: { referenceId: "transfer:t07-derived-transfer:withdrawal" },
        destination: { referenceId: "transfer:t07-derived-transfer:contribution" },
      },
    });
  });

  it("rolls back a failed second transfer insert and removes the uncompleted claim", async () => {
    const db = databaseOrThrow(database);
    const useCases = createBudgetMovementUseCases(db);
    const seedContribution = await useCases.registerContribution(CONTEXT_A, {
      commandId: "t07-destination-seed",
      budgetReferenceId: "box-movement-b",
      amountCents: "1",
      effectiveOn: "2026-09-01",
      referenceId: "t07-conflicting-destination-reference",
    });
    expect(seedContribution.ok).toBe(true);
    const failed = await useCases.transferBetweenBudgets(CONTEXT_A, {
      ...BUDGET_MOVEMENT_FIXTURE.transfer,
      commandId: "t07-atomic-failure",
      withdrawalReferenceId: "t07-atomic-source-reference",
      contributionReferenceId: "t07-conflicting-destination-reference",
    });
    expect(failed).toMatchObject({ ok: false, error: { code: "DUPLICATE_REFERENCE" } });

    const sourceRows = await db
      .select({ referenceId: budgetMovements.referenceId })
      .from(budgetMovements)
      .where(eq(budgetMovements.referenceId, "t07-atomic-source-reference"));
    expect(sourceRows).toEqual([]);
    const claims = await db
      .select({ commandId: applicationCommands.commandId })
      .from(applicationCommands)
      .where(eq(applicationCommands.commandId, "t07-atomic-failure"));
    expect(claims).toEqual([]);
  });

  it("rolls back a partial realized-income distribution and its command claim", async () => {
    const db = databaseOrThrow(database);
    const useCases = createBudgetMovementUseCases(db);
    const conflictingReference = allocationContributionReferenceId(
      FIXTURES.incomeEvent,
      FIXTURES.ruleB,
    );
    const seedContribution = await useCases.registerContribution(CONTEXT_A, {
      commandId: "t07-distribution-conflict-seed",
      budgetReferenceId: "box-movement-b",
      amountCents: "1",
      effectiveOn: "2026-09-01",
      referenceId: conflictingReference,
    });
    expect(seedContribution).toMatchObject({ ok: true });

    const failed = await useCases.distributeRealizedIncome(CONTEXT_A, {
      commandId: "t07-partial-distribution-failure",
      financialEventId: FIXTURES.incomeEvent,
    });
    expect(failed).toMatchObject({ ok: false, error: { code: "DUPLICATE_REFERENCE" } });
    const allocationRows = await db
      .select({ id: budgetMovements.id })
      .from(budgetMovements)
      .where(
        and(
          eq(budgetMovements.householdId, FIXTURES.householdA),
          eq(budgetMovements.financialEventId, FIXTURES.incomeEvent),
        ),
      );
    expect(allocationRows).toEqual([]);
    const claims = await db
      .select({ commandId: applicationCommands.commandId })
      .from(applicationCommands)
      .where(eq(applicationCommands.commandId, "t07-partial-distribution-failure"));
    expect(claims).toEqual([]);
  });

  it("appends a correction and materializes posted income once with deterministic allocation", async () => {
    const db = databaseOrThrow(database);
    const useCases = createBudgetMovementUseCases(db);
    const original = await useCases.registerContribution(CONTEXT_A, {
      commandId: "t07-correction-original",
      budgetReferenceId: "box-movement-a",
      amountCents: "1000",
      effectiveOn: "2026-09-01",
      referenceId: "t07-corrected-original",
    });
    expect(original.ok).toBe(true);
    const correction = await useCases.correctMovement(CONTEXT_A, {
      commandId: "t07-correction-command",
      budgetReferenceId: "box-movement-a",
      correctsReferenceId: "t07-corrected-original",
      correctionReferenceId: "t07-compensating-withdrawal",
      effectiveOn: "2026-09-03",
    });
    expect(correction).toMatchObject({
      ok: true,
      value: {
        compensation: {
          kind: "WITHDRAWAL",
          correctsReferenceId: "t07-corrected-original",
          amountCents: "1000",
        },
      },
    });
    expect(await useCases.correctMovement(CONTEXT_A, {
      commandId: "t07-correction-command",
      budgetReferenceId: "box-movement-a",
      correctsReferenceId: "t07-corrected-original",
      correctionReferenceId: "t07-compensating-withdrawal",
      effectiveOn: "2026-09-03",
    })).toEqual(correction);
    const secondCorrection = await useCases.correctMovement(CONTEXT_A, {
      commandId: "t07-second-correction-command",
      budgetReferenceId: "box-movement-a",
      correctsReferenceId: "t07-corrected-original",
      correctionReferenceId: "t07-second-compensation",
    });
    expect(secondCorrection).toMatchObject({
      ok: false,
      error: { code: "MOVEMENT_ALREADY_CORRECTED" },
    });

    const distributed = await useCases.distributeRealizedIncome(CONTEXT_A, {
      ...BUDGET_MOVEMENT_FIXTURE.distribution,
      financialEventId: FIXTURES.incomeEvent,
    });
    expect(distributed).toMatchObject({
      ok: true,
      value: {
        status: "DISTRIBUTED",
        originAmountCents: "1150000",
        distributedAmountCents: "1150000",
        remainingAmountCents: "0",
        contributions: expect.arrayContaining([
          expect.objectContaining({ kind: "CONTRIBUTION" }),
        ]),
      },
    });
    if (!distributed.ok) return;
    expect(
      distributed.value.contributions.reduce(
        (total, row) => total + BigInt(row.amountCents),
        BigInt(0),
      ),
    ).toBe(BigInt("1150000"));
    const correctedAllocation = distributed.value.contributions[0];
    expect(correctedAllocation).toBeDefined();
    const automaticCorrection = await useCases.correctMovement(CONTEXT_A, {
      commandId: "t07-allocation-correction",
      budgetReferenceId: correctedAllocation!.boxReferenceId,
      correctsReferenceId: correctedAllocation!.referenceId,
      correctionReferenceId: "t07-allocation-compensation",
    });
    expect(automaticCorrection).toMatchObject({
      ok: true,
      value: { compensation: { kind: "WITHDRAWAL", correctsReferenceId: correctedAllocation!.referenceId } },
    });
    const distributionRetry = await useCases.distributeRealizedIncome(CONTEXT_A, {
      ...BUDGET_MOVEMENT_FIXTURE.distribution,
      financialEventId: FIXTURES.incomeEvent,
    });
    expect(distributionRetry).toEqual(distributed);
    const freshDistributionCommand = await useCases.distributeRealizedIncome(CONTEXT_A, {
      commandId: "t07-distribution-reconciliation",
      financialEventId: FIXTURES.incomeEvent,
    });
    expect(freshDistributionCommand).toMatchObject({ ok: true, value: { status: "ALREADY_RECONCILED" } });
    const planned = await useCases.distributeRealizedIncome(CONTEXT_A, {
      commandId: "t07-planned-distribution",
      financialEventId: FIXTURES.plannedIncomeEvent,
    });
    expect(planned).toMatchObject({ ok: false, error: { code: "INVALID_REFERENCE" } });
    const plannedClaim = await db
      .select({ commandId: applicationCommands.commandId })
      .from(applicationCommands)
      .where(eq(applicationCommands.commandId, "t07-planned-distribution"));
    expect(plannedClaim).toEqual([]);
  });
});
