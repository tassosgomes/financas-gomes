import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  applicationCommands,
  budgetAllocationRules,
  budgetMovements,
  budgets,
  categories,
  households,
} from "@/db/schema";
import { createBudgetUseCases } from "./use-cases";

const integration =
  process.env.T06_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  households: {
    a: "00000000-0000-7000-8000-000000061101",
    b: "00000000-0000-7000-8000-000000061102",
  },
  categories: {
    expenseA: "00000000-0000-7000-8000-000000061201",
    expenseB: "00000000-0000-7000-8000-000000061202",
    incomeA: "00000000-0000-7000-8000-000000061203",
    archivedA: "00000000-0000-7000-8000-000000061204",
  },
} as const;

const contextA = {
  userId: "00000000-0000-7000-8000-000000061301",
  householdId: FIXTURES.households.a,
} as const;
const contextB = {
  userId: "00000000-0000-7000-8000-000000061302",
  householdId: FIXTURES.households.b,
} as const;

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) throw new Error("O banco de integração T06 não foi inicializado.");
  return database;
}

async function cleanup(database: Database): Promise<void> {
  const householdIds = [FIXTURES.households.a, FIXTURES.households.b];
  await database
    .delete(applicationCommands)
    .where(inArray(applicationCommands.householdId, householdIds));
  // The application never hard-deletes these rows; fixture cleanup is the
  // only direct removal and still follows the FK dependency order.
  await database
    .delete(budgetMovements)
    .where(inArray(budgetMovements.householdId, householdIds));
  await database
    .delete(budgetAllocationRules)
    .where(inArray(budgetAllocationRules.householdId, householdIds));
  await database
    .delete(budgets)
    .where(inArray(budgets.householdId, householdIds));
  await database
    .delete(categories)
    .where(inArray(categories.householdId, householdIds));
  await database
    .delete(households)
    .where(inArray(households.id, householdIds));
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T06 Household A" },
    { id: FIXTURES.households.b, name: "T06 Household B" },
  ]);
  await database.insert(categories).values([
    {
      id: FIXTURES.categories.expenseA,
      householdId: FIXTURES.households.a,
      name: "T06 Expense A",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.expenseB,
      householdId: FIXTURES.households.b,
      name: "T06 Expense B",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.incomeA,
      householdId: FIXTURES.households.a,
      name: "T06 Income A",
      kind: "INCOME",
    },
    {
      id: FIXTURES.categories.archivedA,
      householdId: FIXTURES.households.a,
      name: "T06 Archived A",
      kind: "EXPENSE",
      status: "ARCHIVED",
    },
  ]);
}

integration("T06 budget CRUD and lifecycle use cases", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de T06_INTEGRATION=1.",
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

  it("creates atomically and retries with the exact persisted result", async () => {
    const db = databaseOrThrow(database);
    const useCases = createBudgetUseCases({ database: db });
    const command = {
      commandId: "t06-create-1",
      name: "  Reserva   de emergência ",
      categoryId: FIXTURES.categories.expenseA,
      activeFrom: "2026-09-01",
      goal: { targetAmountCents: "10000", targetDate: "2026-12-01" },
    } as const;

    const created = await useCases.create(contextA, command);
    const retried = await useCases.create(contextA, command);

    expect(created.ok).toBe(true);
    expect(retried).toEqual(created);
    if (!created.ok) return;

    const rows = await db
      .select({ id: applicationCommands.commandId })
      .from(applicationCommands)
      .where(
        and(
          eq(applicationCommands.householdId, FIXTURES.households.a),
          eq(applicationCommands.commandId, command.commandId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(created.value.name).toBe("Reserva de emergência");
    expect(created.value.goal).toEqual({
      targetAmountCents: "10000",
      targetDate: "2026-12-01",
    });
  });

  it("rejects command reuse, invalid categories and invalid goals without leaving claims", async () => {
    const db = databaseOrThrow(database);
    const useCases = createBudgetUseCases({ database: db });
    const created = await useCases.create(contextA, {
      commandId: "t06-create-reuse",
      name: "Reserva",
      categoryId: FIXTURES.categories.expenseA,
      activeFrom: "2026-09-01",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const reused = await useCases.create(contextA, {
      commandId: "t06-create-reuse",
      name: "Outra reserva",
      categoryId: FIXTURES.categories.expenseA,
      activeFrom: "2026-09-01",
    });
    expect(reused).toMatchObject({ ok: false, error: { code: "COMMAND_ID_REUSED" } });

    const archived = await useCases.create(contextA, {
      commandId: "t06-archived",
      name: "Arquivada",
      categoryId: FIXTURES.categories.archivedA,
      activeFrom: "2026-09-01",
    });
    expect(archived).toMatchObject({ ok: false, error: { code: "CATEGORY_ARCHIVED" } });

    const income = await useCases.create(contextA, {
      commandId: "t06-income",
      name: "Receita",
      categoryId: FIXTURES.categories.incomeA,
      activeFrom: "2026-09-01",
    });
    expect(income).toMatchObject({ ok: false, error: { code: "CATEGORY_KIND_MISMATCH" } });

    const foreign = await useCases.create(contextA, {
      commandId: "t06-foreign",
      name: "Estrangeira",
      categoryId: FIXTURES.categories.expenseB,
      activeFrom: "2026-09-01",
    });
    expect(foreign).toMatchObject({ ok: false, error: { code: "CATEGORY_NOT_FOUND" } });

    const invalidGoal = await useCases.update(contextA, {
      commandId: "t06-invalid-goal",
      budgetReferenceId: created.value.referenceId,
      goal: { targetAmountCents: "0", targetDate: "2026-12-01" },
    });
    expect(invalidGoal).toMatchObject({ ok: false, error: { code: "INVALID_TARGET_AMOUNT" } });

    const claims = await db
      .select({ commandId: applicationCommands.commandId })
      .from(applicationCommands)
      .where(inArray(applicationCommands.commandId, [
        "t06-archived",
        "t06-income",
        "t06-foreign",
        "t06-invalid-goal",
      ]));
    expect(claims).toEqual([]);
  });

  it("updates metadata idempotently and keeps the original result after later edits", async () => {
    const db = databaseOrThrow(database);
    const useCases = createBudgetUseCases({ database: db });
    const created = await useCases.create(contextA, {
      commandId: "t06-update-create",
      name: "Original",
      categoryId: FIXTURES.categories.expenseA,
      activeFrom: "2026-09-01",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await useCases.update(contextA, {
      commandId: "t06-update-1",
      budgetReferenceId: created.value.referenceId,
      name: "Primeira versão",
    });
    const later = await useCases.update(contextA, {
      commandId: "t06-update-2",
      budgetReferenceId: created.value.referenceId,
      name: "Segunda versão",
    });
    const retryFirst = await useCases.update(contextA, {
      commandId: "t06-update-1",
      budgetReferenceId: created.value.referenceId,
      name: "Primeira versão",
    });

    expect(first).toMatchObject({ ok: true, value: { name: "Primeira versão" } });
    expect(later).toMatchObject({ ok: true, value: { name: "Segunda versão" } });
    expect(retryFirst).toEqual(first);
  });

  it("closes effectively, preserves the row, rejects overlap and isolates households", async () => {
    const db = databaseOrThrow(database);
    const useCases = createBudgetUseCases({ database: db });
    const created = await useCases.create(contextA, {
      commandId: "t06-close-create",
      name: "Encerrável",
      categoryId: FIXTURES.categories.expenseA,
      activeFrom: "2026-09-01",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const foreignUpdate = await useCases.update(contextB, {
      commandId: "t06-foreign-update",
      budgetReferenceId: created.value.referenceId,
      name: "Vazamento",
    });
    expect(foreignUpdate).toMatchObject({ ok: false, error: { code: "BUDGET_NOT_FOUND" } });

    const closed = await useCases.close(contextA, {
      commandId: "t06-close-1",
      budgetReferenceId: created.value.referenceId,
      closedOn: "2026-10-01",
    });
    const retry = await useCases.close(contextA, {
      commandId: "t06-close-1",
      budgetReferenceId: created.value.referenceId,
      closedOn: "2026-10-01",
    });
    expect(closed).toMatchObject({
      ok: true,
      value: { status: "CLOSED", closedOn: "2026-10-01" },
    });
    expect(retry).toEqual(closed);

    const row = await db
      .select({ status: budgets.status })
      .from(budgets)
      .where(eq(budgets.referenceId, created.value.referenceId));
    expect(row).toEqual([{ status: "CLOSED" }]);

    const overlap = await useCases.create(contextA, {
      commandId: "t06-overlap",
      name: "Sobreposição",
      categoryId: FIXTURES.categories.expenseA,
      activeFrom: "2026-09-15",
    });
    expect(overlap).toMatchObject({
      ok: false,
      error: { code: "CATEGORY_ACTIVE_BUDGET_CONFLICT" },
    });

    const adjacent = await useCases.create(contextA, {
      commandId: "t06-adjacent",
      name: "Nova vigência",
      categoryId: FIXTURES.categories.expenseA,
      activeFrom: "2026-10-01",
    });
    expect(adjacent.ok).toBe(true);
  });

  it("serializes concurrent creates for one category without leaving a second claim", async () => {
    const db = databaseOrThrow(database);
    const useCases = createBudgetUseCases({ database: db });
    const [left, right] = await Promise.all([
      useCases.create(contextA, {
        commandId: "t06-concurrent-left",
        name: "Concorrente A",
        categoryId: FIXTURES.categories.expenseA,
        activeFrom: "2026-09-01",
      }),
      useCases.create(contextA, {
        commandId: "t06-concurrent-right",
        name: "Concorrente B",
        categoryId: FIXTURES.categories.expenseA,
        activeFrom: "2026-09-01",
      }),
    ]);
    const results = [left, right];

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) =>
      !result.ok && result.error.code === "CATEGORY_ACTIVE_BUDGET_CONFLICT",
    )).toHaveLength(1);

    const claimRows = await db
      .select({ commandId: applicationCommands.commandId })
      .from(applicationCommands)
      .where(inArray(applicationCommands.commandId, [
        "t06-concurrent-left",
        "t06-concurrent-right",
      ]));
    expect(claimRows).toHaveLength(1);
  });
});
