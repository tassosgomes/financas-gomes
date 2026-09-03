import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations, getMigrationStatus } from "@/db/migrate";

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
} from "./schema";

const integration =
  process.env.T03_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  households: {
    a: "00000000-0000-7000-8000-000000031101",
    b: "00000000-0000-7000-8000-000000031102",
  },
  accounts: {
    a: "00000000-0000-7000-8000-000000032101",
    b: "00000000-0000-7000-8000-000000032102",
  },
  categories: {
    expenseA: "00000000-0000-7000-8000-000000033101",
    expenseB: "00000000-0000-7000-8000-000000033102",
    incomeA: "00000000-0000-7000-8000-000000033103",
    archivedA: "00000000-0000-7000-8000-000000033104",
  },
  events: {
    expenseA: "00000000-0000-7000-8000-000000034101",
    expenseB: "00000000-0000-7000-8000-000000034102",
  },
  entries: {
    expenseA: "00000000-0000-7000-8000-000000035101",
  },
  budgets: {
    a: "00000000-0000-7000-8000-000000036101",
    b: "00000000-0000-7000-8000-000000036102",
    rollback: "00000000-0000-7000-8000-000000036103",
  },
  movements: {
    seed: "00000000-0000-7000-8000-000000037101",
    closing: "00000000-0000-7000-8000-000000037102",
    rollback: "00000000-0000-7000-8000-000000037103",
  },
  rules: {
    first: "00000000-0000-7000-8000-000000038101",
    adjacent: "00000000-0000-7000-8000-000000038102",
    rollback: "00000000-0000-7000-8000-000000038103",
  },
} as const;

const householdIds = [
  FIXTURES.households.a,
  FIXTURES.households.b,
] as const;

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T03 não foi inicializado.");
  }
  return database;
}

function postgresErrorCode(error: unknown): string | undefined {
  let candidate: unknown = error;

  for (let depth = 0; depth < 5 && candidate; depth += 1) {
    if (typeof candidate !== "object") {
      return undefined;
    }

    const value = candidate as {
      code?: unknown;
      cause?: unknown;
    };
    if (typeof value.code === "string") {
      return value.code;
    }
    candidate = value.cause;
  }

  return undefined;
}

async function cleanupT03(database: Database): Promise<void> {
  // TRUNCATE bypasses row triggers and is scoped to the disposable T03
  // fixtures; ordinary application deletes remain protected by append-only
  // and restrictive FK rules.
  await database.execute(
    sql.raw(
      "truncate table budget_movements, budget_allocation_rules, budgets",
    ),
  );
  await database
    .delete(applicationCommands)
    .where(inArray(applicationCommands.householdId, householdIds));
  await database
    .delete(accountEntries)
    .where(inArray(accountEntries.householdId, householdIds));
  await database
    .delete(financialEvents)
    .where(inArray(financialEvents.householdId, householdIds));
  await database
    .delete(categories)
    .where(inArray(categories.householdId, householdIds));
  await database
    .delete(accounts)
    .where(inArray(accounts.householdId, householdIds));
  await database
    .delete(households)
    .where(inArray(households.id, householdIds));
}

async function seedT03(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T03 Household A" },
    { id: FIXTURES.households.b, name: "T03 Household B" },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      name: "T03 Account A",
      type: "CHECKING",
    },
    {
      id: FIXTURES.accounts.b,
      householdId: FIXTURES.households.b,
      name: "T03 Account B",
      type: "CHECKING",
    },
  ]);
  await database.insert(categories).values([
    {
      id: FIXTURES.categories.expenseA,
      householdId: FIXTURES.households.a,
      name: "T03 Expense A",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.expenseB,
      householdId: FIXTURES.households.b,
      name: "T03 Expense B",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.incomeA,
      householdId: FIXTURES.households.a,
      name: "T03 Income A",
      kind: "INCOME",
    },
    {
      id: FIXTURES.categories.archivedA,
      householdId: FIXTURES.households.a,
      name: "T03 Archived A",
      kind: "EXPENSE",
      status: "ARCHIVED",
    },
  ]);
  await database.insert(financialEvents).values([
    {
      id: FIXTURES.events.expenseA,
      householdId: FIXTURES.households.a,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt("1234"),
      occurredOn: "2026-01-05",
      description: "T03 expense A",
      categoryId: FIXTURES.categories.expenseA,
    },
    {
      id: FIXTURES.events.expenseB,
      householdId: FIXTURES.households.b,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt("1234"),
      occurredOn: "2026-01-05",
      description: "T03 expense B",
      categoryId: FIXTURES.categories.expenseB,
    },
  ]);
  await database.insert(accountEntries).values({
    id: FIXTURES.entries.expenseA,
    financialEventId: FIXTURES.events.expenseA,
    accountId: FIXTURES.accounts.a,
    householdId: FIXTURES.households.a,
    amountCents: BigInt("-1234"),
    status: "POSTED",
    postedOn: "2026-01-05",
  });
}

function budgetValues(
  id: string,
  householdId: string,
  categoryId: string,
  referenceId: string,
) {
  return {
    id,
    householdId,
    referenceId,
    categoryId,
    name: "T03 " + referenceId,
    activeFrom: "2026-01-01",
  } as const;
}

function movementValues(
  id: string,
  householdId: string,
  budgetId: string,
  referenceId: string,
) {
  return {
    id,
    householdId,
    budgetId,
    referenceId,
    kind: "CONTRIBUTION" as const,
    amountCents: BigInt("1000"),
    effectiveOn: "2026-01-05",
  };
}

integration("S09 Caixinhas PostgreSQL schema and migration", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar T03_INTEGRATION=1.",
      );
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = databaseOrThrow(database);
    await cleanupT03(db);
    await seedT03(db);
  });

  afterAll(async () => {
    if (database) {
      await cleanupT03(database);
    }
    await closeDb();
  });

  it("applies forward-only migration idempotently without persisted snapshots", async () => {
    const db = databaseOrThrow(database);
    await applyMigrations();
    const status = await getMigrationStatus();
    expect(status).toMatchObject({ pending: 0, drifted: 0 });

    const forbidden = await db.execute<{ table_name: string; column_name: string }>(
      sql.raw(
        "select table_name, column_name " +
          "from information_schema.columns " +
          "where table_schema = 'public' " +
          "and table_name in ('budgets', 'budget_movements', 'budget_allocation_rules') " +
          "and lower(column_name) in " +
          "('balance', 'balance_cents', 'protected_amount', " +
          "'protected_amount_cents', 'spendable_snapshot') " +
          "order by table_name, column_name",
      ),
    );
    expect(forbidden.rows).toEqual([]);

    const exclusions = await db.execute<{ conname: string; contype: string }>(
      sql.raw(
        "select conname, contype " +
          "from pg_catalog.pg_constraint " +
          "where conname in " +
          "('budgets_category_active_window_no_overlap_excl', " +
          "'budget_allocation_rules_budget_window_no_overlap_excl') " +
          "order by conname",
      ),
    );
    expect(exclusions.rows).toEqual([
      {
        conname: "budget_allocation_rules_budget_window_no_overlap_excl",
        contype: "x",
      },
      {
        conname: "budgets_category_active_window_no_overlap_excl",
        contype: "x",
      },
    ]);
  });

  it("rejects cross-household budget, category and ledger source references", async () => {
    const db = databaseOrThrow(database);
    await db.insert(budgets).values([
      budgetValues(
        FIXTURES.budgets.a,
        FIXTURES.households.a,
        FIXTURES.categories.expenseA,
        "budget-a",
      ),
      budgetValues(
        FIXTURES.budgets.b,
        FIXTURES.households.b,
        FIXTURES.categories.expenseB,
        "budget-b",
      ),
    ]);

    await expect(
      db.insert(budgetMovements).values(
        movementValues(
          FIXTURES.movements.seed,
          FIXTURES.households.b,
          FIXTURES.budgets.a,
          "cross-budget",
        ),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );

    await expect(
      db.insert(budgets).values(
        budgetValues(
          "00000000-0000-7000-8000-000000036104",
          FIXTURES.households.b,
          FIXTURES.categories.expenseA,
          "cross-category",
        ),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );

    await expect(
      db.insert(budgetMovements).values({
        ...movementValues(
          "00000000-0000-7000-8000-000000037104",
          FIXTURES.households.a,
          FIXTURES.budgets.a,
          "cross-event",
        ),
        financialEventId: FIXTURES.events.expenseB,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );
  });

  it("enforces category kind/status, positive amounts and source/reference uniqueness", async () => {
    const db = databaseOrThrow(database);
    await db.insert(budgets).values(
      budgetValues(
        FIXTURES.budgets.a,
        FIXTURES.households.a,
        FIXTURES.categories.expenseA,
        "budget-a",
      ),
    );

    await expect(
      db.insert(budgets).values({
        ...budgetValues(
          "00000000-0000-7000-8000-000000036109",
          FIXTURES.households.a,
          FIXTURES.categories.expenseA,
          "invalid-close",
        ),
        status: "CLOSED",
        closedOn: "2025-12-31",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );
    await expect(
      db.insert(budgets).values(
        budgetValues(
          "00000000-0000-7000-8000-000000036105",
          FIXTURES.households.a,
          FIXTURES.categories.incomeA,
          "income-budget",
        ),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );
    await expect(
      db.insert(budgets).values(
        budgetValues(
          "00000000-0000-7000-8000-000000036106",
          FIXTURES.households.a,
          FIXTURES.categories.archivedA,
          "archived-budget",
        ),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );

    await expect(
      db.insert(budgetMovements).values({
        ...movementValues(
          "00000000-0000-7000-8000-000000037105",
          FIXTURES.households.a,
          FIXTURES.budgets.a,
          "zero-movement",
        ),
        amountCents: BigInt("0"),
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );
    await expect(
      db.insert(budgetMovements).values({
        ...movementValues(
          "00000000-0000-7000-8000-000000037106",
          FIXTURES.households.a,
          FIXTURES.budgets.a,
          "negative-movement",
        ),
        amountCents: BigInt("-1"),
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );

    await db.insert(budgetMovements).values({
      ...movementValues(
        FIXTURES.movements.seed,
        FIXTURES.households.a,
        FIXTURES.budgets.a,
        "source-a",
      ),
      kind: "WITHDRAWAL",
      sourceKind: "EXPENSE",
      sourceReferenceId: "event-a",
      financialEventId: FIXTURES.events.expenseA,
      accountEntryId: FIXTURES.entries.expenseA,
    });

    await expect(
      db.insert(budgetMovements).values({
        ...movementValues(
          "00000000-0000-7000-8000-000000037107",
          FIXTURES.households.a,
          FIXTURES.budgets.a,
          "source-b",
        ),
        sourceReferenceId: "event-a",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23505",
    );
    await expect(
      db.insert(budgetMovements).values({
        ...movementValues(
          "00000000-0000-7000-8000-000000037108",
          FIXTURES.households.a,
          FIXTURES.budgets.a,
          "source-a",
        ),
        sourceReferenceId: "event-b",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23505",
    );
  });

  it("enforces half-open budget and allocation windows", async () => {
    const db = databaseOrThrow(database);
    await db.insert(budgets).values(
      budgetValues(
        FIXTURES.budgets.a,
        FIXTURES.households.a,
        FIXTURES.categories.expenseA,
        "window-a",
      ),
    );
    await expect(
      db.insert(budgets).values({
        ...budgetValues(
          "00000000-0000-7000-8000-000000036107",
          FIXTURES.households.a,
          FIXTURES.categories.expenseA,
          "window-overlap",
        ),
        activeFrom: "2026-01-15",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23P01",
    );
    await expect(
      db.insert(budgets).values({
        ...budgetValues(
          "00000000-0000-7000-8000-000000036108",
          FIXTURES.households.a,
          FIXTURES.categories.expenseA,
          "closed-overlap",
        ),
        status: "CLOSED",
        activeFrom: "2026-01-15",
        closedOn: "2026-02-15",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23P01",
    );

    await db.insert(budgetAllocationRules).values({
      id: FIXTURES.rules.first,
      householdId: FIXTURES.households.a,
      budgetId: FIXTURES.budgets.a,
      amountCents: BigInt("100"),
      effectiveFrom: "2026-01-01",
      effectiveUntil: "2026-02-01",
    });
    await db.insert(budgetAllocationRules).values({
      id: FIXTURES.rules.adjacent,
      householdId: FIXTURES.households.a,
      budgetId: FIXTURES.budgets.a,
      amountCents: BigInt("0"),
      effectiveFrom: "2026-02-01",
      effectiveUntil: "2026-03-01",
    });
    await expect(
      db.insert(budgetAllocationRules).values({
        id: FIXTURES.rules.rollback,
        householdId: FIXTURES.households.a,
        budgetId: FIXTURES.budgets.a,
        amountCents: BigInt("100"),
        effectiveFrom: "2026-01-15",
        effectiveUntil: "2026-02-15",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23P01",
    );
    await expect(
      db.insert(budgetAllocationRules).values({
        id: "00000000-0000-7000-8000-000000038104",
        householdId: FIXTURES.households.a,
        budgetId: FIXTURES.budgets.a,
        amountCents: BigInt("-1"),
        effectiveFrom: "2026-03-01",
        effectiveUntil: "2026-03-01",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );
  });

  it("keeps closed budgets historical and movements append-only", async () => {
    const db = databaseOrThrow(database);
    await db.insert(budgets).values(
      budgetValues(
        FIXTURES.budgets.a,
        FIXTURES.households.a,
        FIXTURES.categories.expenseA,
        "lifecycle-a",
      ),
    );
    await db.insert(budgetMovements).values(
      movementValues(
        FIXTURES.movements.seed,
        FIXTURES.households.a,
        FIXTURES.budgets.a,
        "before-close",
      ),
    );
    await db
      .update(budgets)
      .set({ status: "CLOSED", closedOn: "2026-01-10" })
      .where(eq(budgets.id, FIXTURES.budgets.a));

    await db.insert(budgetMovements).values({
      ...movementValues(
        FIXTURES.movements.closing,
        FIXTURES.households.a,
        FIXTURES.budgets.a,
        "on-close",
      ),
      effectiveOn: "2026-01-10",
    });
    await expect(
      db.insert(budgetMovements).values({
        ...movementValues(
          "00000000-0000-7000-8000-000000037109",
          FIXTURES.households.a,
          FIXTURES.budgets.a,
          "after-close",
        ),
        effectiveOn: "2026-01-11",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );
    await expect(
      db
        .update(budgets)
        .set({ status: "ACTIVE", closedOn: null })
        .where(eq(budgets.id, FIXTURES.budgets.a)),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );
    await expect(
      db
        .update(budgetMovements)
        .set({ amountCents: BigInt("2000") })
        .where(eq(budgetMovements.id, FIXTURES.movements.seed)),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );
    await expect(
      db
        .delete(budgetMovements)
        .where(eq(budgetMovements.id, FIXTURES.movements.seed)),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );
    await expect(
      db.delete(budgets).where(eq(budgets.id, FIXTURES.budgets.a)),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );

    await db.insert(applicationCommands).values({
      householdId: FIXTURES.households.a,
      commandId: "t03-budget-command",
      operation: "budget.create",
      payloadHash: "t03-hash",
      resourceId: FIXTURES.budgets.a,
    });
    await expect(
      db.insert(applicationCommands).values({
        householdId: FIXTURES.households.a,
        commandId: "t03-invalid-command",
        operation: "budget.delete",
        payloadHash: "t03-hash",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );
  });

  it("rolls back a complete budget write set atomically", async () => {
    const db = databaseOrThrow(database);
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(budgets).values(
          budgetValues(
            FIXTURES.budgets.rollback,
            FIXTURES.households.a,
            FIXTURES.categories.expenseA,
            "rollback-budget",
          ),
        );
        await tx.insert(budgetMovements).values(
          movementValues(
            FIXTURES.movements.rollback,
            FIXTURES.households.a,
            FIXTURES.budgets.rollback,
            "rollback-movement",
          ),
        );
        await tx.insert(budgetAllocationRules).values({
          id: FIXTURES.rules.rollback,
          householdId: FIXTURES.households.a,
          budgetId: FIXTURES.budgets.rollback,
          amountCents: BigInt("100"),
          effectiveFrom: "2026-01-01",
        });
        await tx.insert(applicationCommands).values({
          householdId: FIXTURES.households.a,
          commandId: "t03-rollback-command",
          operation: "budget.create",
          payloadHash: "rollback-hash",
          resourceId: FIXTURES.budgets.rollback,
        });
        throw new Error("force T03 rollback");
      }),
    ).rejects.toThrow("force T03 rollback");

    const rows = await db.execute<{
      budgets_count: number;
      movements_count: number;
      rules_count: number;
      commands_count: number;
    }>(
      sql.raw(
        "select " +
          "(select count(*) from budgets " +
          "where id = '00000000-0000-7000-8000-000000036103')::int as budgets_count, " +
          "(select count(*) from budget_movements " +
          "where id = '00000000-0000-7000-8000-000000037103')::int as movements_count, " +
          "(select count(*) from budget_allocation_rules " +
          "where id = '00000000-0000-7000-8000-000000038103')::int as rules_count, " +
          "(select count(*) from application_commands " +
          "where command_id = 't03-rollback-command')::int as commands_count",
      ),
    );
    expect(rows.rows).toEqual([
      {
        budgets_count: 0,
        movements_count: 0,
        rules_count: 0,
        commands_count: 0,
      },
    ]);
  });
});
