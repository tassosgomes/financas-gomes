import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  applicationCommands,
  categories,
  financialEvents,
  householdMembers,
  households,
  user,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";

import { createTransactionsUseCases } from "./use-cases";

/** T05 is opt-in because it exercises a real PostgreSQL database. */
const integration =
  process.env.T05_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  users: {
    a: "00000000-0000-7000-8000-000000051101",
    b: "00000000-0000-7000-8000-000000051102",
  },
  households: {
    a: "00000000-0000-7000-8000-000000052101",
    b: "00000000-0000-7000-8000-000000052102",
  },
  accounts: {
    a: "00000000-0000-7000-8000-000000053101",
    b: "00000000-0000-7000-8000-000000053102",
    archivedA: "00000000-0000-7000-8000-000000053103",
  },
  categories: {
    expenseA: "00000000-0000-7000-8000-000000054101",
    incomeA: "00000000-0000-7000-8000-000000054102",
    archivedA: "00000000-0000-7000-8000-000000054103",
    expenseB: "00000000-0000-7000-8000-000000054104",
  },
} as const;

const contextA: FinancialContext = {
  userId: FIXTURES.users.a,
  householdId: FIXTURES.households.a,
};
const contextB: FinancialContext = {
  userId: FIXTURES.users.b,
  householdId: FIXTURES.households.b,
};
const householdIds = [FIXTURES.households.a, FIXTURES.households.b] as const;

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T05 não foi inicializado.");
  }
  return database;
}

async function cleanupT05(database: Database): Promise<void> {
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
    .delete(householdMembers)
    .where(inArray(householdMembers.householdId, householdIds));
  await database.delete(households).where(inArray(households.id, householdIds));
  await database
    .delete(user)
    .where(inArray(user.id, [FIXTURES.users.a, FIXTURES.users.b]));
}

async function seedT05(database: Database): Promise<void> {
  await database.insert(user).values([
    {
      id: FIXTURES.users.a,
      name: "T05 Owner A",
      email: "t05-owner-a@example.test",
    },
    {
      id: FIXTURES.users.b,
      name: "T05 Owner B",
      email: "t05-owner-b@example.test",
    },
  ]);
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T05 Household A" },
    { id: FIXTURES.households.b, name: "T05 Household B" },
  ]);
  await database.insert(householdMembers).values([
    { householdId: contextA.householdId, userId: contextA.userId },
    { householdId: contextB.householdId, userId: contextB.userId },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accounts.a,
      householdId: contextA.householdId,
      name: "T05 Account A",
      type: "CHECKING",
      trackingStartedOn: "2026-08-20",
    },
    {
      id: FIXTURES.accounts.b,
      householdId: contextB.householdId,
      name: "T05 Account B",
      type: "CHECKING",
    },
    {
      id: FIXTURES.accounts.archivedA,
      householdId: contextA.householdId,
      name: "T05 Archived Account A",
      type: "CHECKING",
      status: "ARCHIVED",
    },
  ]);
  await database.insert(categories).values([
    {
      id: FIXTURES.categories.expenseA,
      householdId: contextA.householdId,
      name: "T05 Expense A",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.incomeA,
      householdId: contextA.householdId,
      name: "T05 Income A",
      kind: "INCOME",
    },
    {
      id: FIXTURES.categories.archivedA,
      householdId: contextA.householdId,
      name: "T05 Archived Expense A",
      kind: "EXPENSE",
      status: "ARCHIVED",
    },
    {
      id: FIXTURES.categories.expenseB,
      householdId: contextB.householdId,
      name: "T05 Expense B",
      kind: "EXPENSE",
    },
  ]);
}

const expenseCommand = {
  commandId: "t05-expense-command-001",
  amountCents: "123456",
  occurredOn: "2026-08-29",
  description: "  Mercado   do mês  ",
  accountId: FIXTURES.accounts.a,
  categoryId: FIXTURES.categories.expenseA,
};

integration("T05 manual transaction write use cases", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar T05_INTEGRATION=1.",
      );
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = databaseOrThrow(database);
    await cleanupT05(db);
    await seedT05(db);
  });

  afterAll(async () => {
    if (database) {
      await cleanupT05(database);
    }
    await closeDb();
  });

  it("creates expense and income with absolute event amounts and signed entries", async () => {
    const db = databaseOrThrow(database);
    const useCases = createTransactionsUseCases(db, { today: "2026-08-29" });

    const expense = await useCases.createExpense(contextA, expenseCommand);
    expect(expense).toMatchObject({
      ok: true,
      value: {
        kind: "EXPENSE",
        origin: "MANUAL",
        status: "POSTED",
        amountCents: "123456",
        description: "Mercado do mês",
        accountId: FIXTURES.accounts.a,
        categoryId: FIXTURES.categories.expenseA,
        entry: {
          amountCents: "-123456",
          postedOn: "2026-08-29",
        },
      },
    });

    const income = await useCases.createIncome(contextA, {
      commandId: "t05-income-command-001",
      amountCents: "98765",
      occurredOn: "2026-08-29",
      description: "Salário",
      accountId: FIXTURES.accounts.a,
      categoryId: FIXTURES.categories.incomeA,
    });
    expect(income).toMatchObject({
      ok: true,
      value: {
        kind: "INCOME",
        origin: "MANUAL",
        status: "POSTED",
        amountCents: "98765",
        entry: { amountCents: "98765", postedOn: "2026-08-29" },
      },
    });

    const events = await db
      .select({
        kind: financialEvents.kind,
        amountCents: financialEvents.amountCents,
        origin: financialEvents.origin,
        status: financialEvents.status,
      })
      .from(financialEvents)
      .where(eq(financialEvents.householdId, contextA.householdId));
    const entries = await db
      .select({
        amountCents: accountEntries.amountCents,
        postedOn: accountEntries.postedOn,
      })
      .from(accountEntries)
      .where(eq(accountEntries.householdId, contextA.householdId));

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.amountCents.toString()).sort()).toEqual([
      "123456",
      "98765",
    ]);
    expect(events.every((event) => event.origin === "MANUAL")).toBe(true);
    expect(events.every((event) => event.status === "POSTED")).toBe(true);
    expect(entries.map((entry) => entry.amountCents.toString()).sort()).toEqual([
      "-123456",
      "98765",
    ]);
    expect(entries.every((entry) => entry.postedOn === "2026-08-29")).toBe(true);
  });

  it("revalidates future dates and references without leaving partial rows", async () => {
    const db = databaseOrThrow(database);
    const useCases = createTransactionsUseCases(db, { today: "2026-08-29" });

    const future = await useCases.createExpense(contextA, {
      ...expenseCommand,
      commandId: "t05-future-command-001",
      occurredOn: "2026-08-30",
    });
    expect(future).toMatchObject({
      ok: false,
      error: { code: "DATE_IN_FUTURE", field: "occurredOn" },
    });

    const crossTenantAccount = await useCases.createExpense(contextA, {
      ...expenseCommand,
      commandId: "t05-cross-account-command-001",
      accountId: FIXTURES.accounts.b,
    });
    expect(crossTenantAccount).toMatchObject({
      ok: false,
      error: { code: "ACCOUNT_NOT_FOUND", field: "accountId" },
    });

    const archived = await useCases.createExpense(contextA, {
      ...expenseCommand,
      commandId: "t05-archived-command-001",
      accountId: FIXTURES.accounts.archivedA,
    });
    expect(archived).toMatchObject({
      ok: false,
      error: { code: "RESOURCE_ARCHIVED", field: "accountId" },
    });

    const beforeRows = await Promise.all([
      db
        .select({ commandId: applicationCommands.commandId })
        .from(applicationCommands)
        .where(eq(applicationCommands.householdId, contextA.householdId)),
      db
        .select({ id: financialEvents.id })
        .from(financialEvents)
        .where(eq(financialEvents.householdId, contextA.householdId)),
      db
        .select({ id: accountEntries.id })
        .from(accountEntries)
        .where(eq(accountEntries.householdId, contextA.householdId)),
    ]);
    expect(beforeRows).toEqual([[], [], []]);
  });

  it("is idempotent per household and rejects a conflicting command payload", async () => {
    const db = databaseOrThrow(database);
    const useCases = createTransactionsUseCases(db, { today: "2026-08-29" });

    const first = await useCases.createExpense(contextA, expenseCommand);
    const retry = await useCases.createExpense(contextA, expenseCommand);
    expect(first).toEqual(retry);
    expect(first.ok).toBe(true);

    const conflict = await useCases.createExpense(contextA, {
      ...expenseCommand,
      description: "Outra intenção",
    });
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "COMMAND_ID_REUSED", field: "commandId" },
    });

    const otherHousehold = await useCases.createExpense(contextB, {
      ...expenseCommand,
      accountId: FIXTURES.accounts.b,
      categoryId: FIXTURES.categories.expenseB,
    });
    expect(otherHousehold).toMatchObject({
      ok: true,
      value: { householdId: contextB.householdId },
    });

    const [eventsA, entriesA, commandsA] = await Promise.all([
      db
        .select({ id: financialEvents.id })
        .from(financialEvents)
        .where(eq(financialEvents.householdId, contextA.householdId)),
      db
        .select({ id: accountEntries.id })
        .from(accountEntries)
        .where(eq(accountEntries.householdId, contextA.householdId)),
      db
        .select({ commandId: applicationCommands.commandId })
        .from(applicationCommands)
        .where(eq(applicationCommands.householdId, contextA.householdId)),
    ]);
    expect(eventsA).toHaveLength(1);
    expect(entriesA).toHaveLength(1);
    expect(commandsA).toHaveLength(1);
  });

  it("rolls back command and event when the entry insert fails", async () => {
    const db = databaseOrThrow(database);
    await db.execute(sql`
      create or replace function t05_force_entry_failure()
      returns trigger
      language plpgsql
      as $function$
      begin
        raise exception 'T05 injected entry failure';
      end;
      $function$;
    `);
    await db.execute(sql`
      create trigger t05_force_entry_failure_trigger
      before insert on account_entries
      for each row execute function t05_force_entry_failure();
    `);

    try {
      const useCases = createTransactionsUseCases(db, { today: "2026-08-29" });
      await expect(
        useCases.createExpense(contextA, {
          ...expenseCommand,
          commandId: "t05-rollback-command-001",
        }),
      ).rejects.toThrow();

      const [commands, events, entries] = await Promise.all([
        db
          .select({ commandId: applicationCommands.commandId })
          .from(applicationCommands)
          .where(eq(applicationCommands.householdId, contextA.householdId)),
        db
          .select({ id: financialEvents.id })
          .from(financialEvents)
          .where(eq(financialEvents.householdId, contextA.householdId)),
        db
          .select({ id: accountEntries.id })
          .from(accountEntries)
          .where(eq(accountEntries.householdId, contextA.householdId)),
      ]);
      expect(commands).toHaveLength(0);
      expect(events).toHaveLength(0);
      expect(entries).toHaveLength(0);
    } finally {
      await db.execute(sql`
        drop trigger if exists t05_force_entry_failure_trigger on account_entries;
        drop function if exists t05_force_entry_failure();
      `);
    }
  });
});
