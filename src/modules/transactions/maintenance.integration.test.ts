import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

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

/** T07 is opt-in because it exercises a real PostgreSQL database. */
const integration =
  process.env.T07_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  users: {
    a: "00000000-0000-7000-8000-000000071101",
    b: "00000000-0000-7000-8000-000000071102",
  },
  households: {
    a: "00000000-0000-7000-8000-000000072101",
    b: "00000000-0000-7000-8000-000000072102",
  },
  accounts: {
    a: "00000000-0000-7000-8000-000000073101",
    b: "00000000-0000-7000-8000-000000073102",
  },
  categories: {
    expenseA: "00000000-0000-7000-8000-000000074101",
    expenseA2: "00000000-0000-7000-8000-000000074102",
    incomeA: "00000000-0000-7000-8000-000000074103",
    archivedA: "00000000-0000-7000-8000-000000074104",
    expenseB: "00000000-0000-7000-8000-000000074105",
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
    throw new Error("O banco de integração T07 não foi inicializado.");
  }
  return database;
}

async function cleanupT07(database: Database): Promise<void> {
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

async function seedT07(database: Database): Promise<void> {
  await database.insert(user).values([
    {
      id: FIXTURES.users.a,
      name: "T07 Owner A",
      email: "t07-owner-a@example.test",
    },
    {
      id: FIXTURES.users.b,
      name: "T07 Owner B",
      email: "t07-owner-b@example.test",
    },
  ]);
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T07 Household A" },
    { id: FIXTURES.households.b, name: "T07 Household B" },
  ]);
  await database.insert(householdMembers).values([
    { householdId: contextA.householdId, userId: contextA.userId },
    { householdId: contextB.householdId, userId: contextB.userId },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accounts.a,
      householdId: contextA.householdId,
      name: "T07 Account A",
      type: "CHECKING",
      trackingStartedOn: "2026-08-20",
    },
    {
      id: FIXTURES.accounts.b,
      householdId: contextB.householdId,
      name: "T07 Account B",
      type: "CHECKING",
    },
  ]);
  await database.insert(categories).values([
    {
      id: FIXTURES.categories.expenseA,
      householdId: contextA.householdId,
      name: "T07 Expense A",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.expenseA2,
      householdId: contextA.householdId,
      name: "T07 Expense A2",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.incomeA,
      householdId: contextA.householdId,
      name: "T07 Income A",
      kind: "INCOME",
    },
    {
      id: FIXTURES.categories.archivedA,
      householdId: contextA.householdId,
      name: "T07 Archived A",
      kind: "EXPENSE",
      status: "ARCHIVED",
    },
    {
      id: FIXTURES.categories.expenseB,
      householdId: contextB.householdId,
      name: "T07 Expense B",
      kind: "EXPENSE",
    },
  ]);
}

const expenseCommand = {
  commandId: "t07-create-expense-001",
  amountCents: "123456",
  occurredOn: "2026-08-29",
  description: "Mercado do mês",
  accountId: FIXTURES.accounts.a,
  categoryId: FIXTURES.categories.expenseA,
};

integration("T07 manual transaction maintenance", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar T07_INTEGRATION=1.",
      );
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = databaseOrThrow(database);
    await cleanupT07(db);
    await seedT07(db);
  });

  afterAll(async () => {
    if (database) {
      await cleanupT07(database);
    }
    await closeDb();
  });

  it("edits only metadata, validates category references and is idempotent", async () => {
    const db = databaseOrThrow(database);
    const useCases = createTransactionsUseCases(db, { today: "2026-08-29" });
    const created = await useCases.createExpense(contextA, expenseCommand);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await useCases.updateManualTransaction(contextA, {
      commandId: "t07-update-001",
      financialEventId: created.value.id,
      description: "  Mercado   do mês revisado ",
      categoryId: FIXTURES.categories.expenseA2,
    });
    expect(updated).toMatchObject({
      ok: true,
      value: {
        id: created.value.id,
        description: "Mercado do mês revisado",
        categoryId: FIXTURES.categories.expenseA2,
        amountCents: "123456",
        accountId: FIXTURES.accounts.a,
        entry: { amountCents: "-123456" },
      },
    });

    const retry = await useCases.updateManualTransaction(contextA, {
      commandId: "t07-update-001",
      financialEventId: created.value.id,
      description: "Mercado do mês revisado",
      categoryId: FIXTURES.categories.expenseA2,
    });
    expect(retry).toEqual(updated);

    const conflict = await useCases.updateManualTransaction(contextA, {
      commandId: "t07-update-001",
      financialEventId: created.value.id,
      description: "Outra intenção",
    });
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "COMMAND_ID_REUSED", field: "commandId" },
    });

    const removeCategory = await useCases.updateManualTransaction(contextA, {
      commandId: "t07-update-002",
      financialEventId: created.value.id,
      categoryId: null,
    });
    expect(removeCategory).toMatchObject({
      ok: true,
      value: { categoryId: null, amountCents: "123456" },
    });

    const invalidCategoryCases = [
      [FIXTURES.categories.expenseB, "CATEGORY_NOT_FOUND"],
      [FIXTURES.categories.incomeA, "CATEGORY_KIND_MISMATCH"],
      [FIXTURES.categories.archivedA, "RESOURCE_ARCHIVED"],
    ] as const;
    for (const [categoryId, code] of invalidCategoryCases) {
      const result = await useCases.updateManualTransaction(contextA, {
        commandId: `t07-invalid-category-${categoryId.slice(-4)}`,
        financialEventId: created.value.id,
        categoryId,
      });
      expect(result).toMatchObject({ ok: false, error: { code } });
    }

    const [event, entry, commands] = await Promise.all([
      db
        .select({
          amountCents: financialEvents.amountCents,
          occurredOn: financialEvents.occurredOn,
          kind: financialEvents.kind,
          status: financialEvents.status,
        })
        .from(financialEvents)
        .where(
          and(
            eq(financialEvents.id, created.value.id),
            eq(financialEvents.householdId, contextA.householdId),
          ),
        ),
      db
        .select({ amountCents: accountEntries.amountCents })
        .from(accountEntries)
        .where(eq(accountEntries.householdId, contextA.householdId)),
      db
        .select({ commandId: applicationCommands.commandId })
        .from(applicationCommands)
        .where(eq(applicationCommands.householdId, contextA.householdId)),
    ]);
    expect(event).toHaveLength(1);
    expect(event[0]).toMatchObject({
      amountCents: BigInt("123456"),
      occurredOn: "2026-08-29",
      kind: "EXPENSE",
      status: "POSTED",
    });
    expect(entry).toEqual([{ amountCents: BigInt("-123456") }]);
    expect(commands.map(({ commandId }) => commandId).sort()).toEqual([
      "t07-create-expense-001",
      "t07-update-001",
      "t07-update-002",
    ]);
  });

  it("cancels atomically with one reversal and preserves historical rows", async () => {
    const db = databaseOrThrow(database);
    const useCases = createTransactionsUseCases(db, { today: "2026-08-29" });
    const created = await useCases.createExpense(contextA, expenseCommand);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const cancelled = await useCases.cancelManualTransaction(contextA, {
      commandId: "t07-cancel-001",
      financialEventId: created.value.id,
    });
    expect(cancelled).toMatchObject({
      ok: true,
      value: {
        id: created.value.id,
        status: "CANCELLED",
        origin: "MANUAL",
        amountCents: "123456",
        entry: { amountCents: "-123456", status: "POSTED" },
        reversal: {
          amountCents: "123456",
          origin: "SYSTEM",
          status: "POSTED",
          occurredOn: "2026-08-29",
        },
      },
    });
    if (!cancelled.ok || !cancelled.value.reversal) return;

    const [events, entries, balance] = await Promise.all([
      db
        .select({
          id: financialEvents.id,
          kind: financialEvents.kind,
          status: financialEvents.status,
          origin: financialEvents.origin,
          amountCents: financialEvents.amountCents,
          reversalOfEventId: financialEvents.reversalOfEventId,
          occurredOn: financialEvents.occurredOn,
        })
        .from(financialEvents)
        .where(eq(financialEvents.householdId, contextA.householdId)),
      db
        .select({
          financialEventId: accountEntries.financialEventId,
          accountId: accountEntries.accountId,
          amountCents: accountEntries.amountCents,
          postedOn: accountEntries.postedOn,
          status: accountEntries.status,
        })
        .from(accountEntries)
        .where(eq(accountEntries.householdId, contextA.householdId)),
      db
        .select({
          total: sql<string>`coalesce(sum(${accountEntries.amountCents}), 0)::text`,
        })
        .from(accountEntries)
        .where(
          and(
            eq(accountEntries.householdId, contextA.householdId),
            eq(accountEntries.accountId, FIXTURES.accounts.a),
            eq(accountEntries.status, "POSTED"),
          ),
        ),
    ]);
    expect(events).toHaveLength(2);
    expect(events).toContainEqual({
      id: created.value.id,
      kind: "EXPENSE",
      status: "CANCELLED",
      origin: "MANUAL",
      amountCents: BigInt("123456"),
      reversalOfEventId: null,
      occurredOn: "2026-08-29",
    });
    expect(events).toContainEqual({
      id: cancelled.value.reversal.id,
      kind: "REVERSAL",
      status: "POSTED",
      origin: "SYSTEM",
      amountCents: BigInt("123456"),
      reversalOfEventId: created.value.id,
      occurredOn: "2026-08-29",
    });
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.amountCents.toString()).sort()).toEqual([
      "-123456",
      "123456",
    ]);
    expect(entries.every((entry) => entry.accountId === FIXTURES.accounts.a)).toBe(
      true,
    );
    expect(entries.every((entry) => entry.status === "POSTED")).toBe(true);
    expect(entries.every((entry) => entry.postedOn === "2026-08-29")).toBe(true);
    expect(balance).toEqual([{ total: "0" }]);

    const retry = await useCases.cancelManualTransaction(contextA, {
      commandId: "t07-cancel-001",
      financialEventId: created.value.id,
    });
    expect(retry).toEqual(cancelled);

    const secondCancellation = await useCases.cancelManualTransaction(contextA, {
      commandId: "t07-cancel-002",
      financialEventId: created.value.id,
    });
    expect(secondCancellation).toMatchObject({
      ok: false,
      error: { code: "EVENT_ALREADY_CANCELLED", field: "financialEventId" },
    });

    const cancelReversal = await useCases.cancelManualTransaction(contextA, {
      commandId: "t07-cancel-reversal-001",
      financialEventId: cancelled.value.reversal.id,
    });
    expect(cancelReversal).toMatchObject({
      ok: false,
      error: { code: "EVENT_NOT_MANUAL", field: "financialEventId" },
    });

    const crossTenant = await useCases.cancelManualTransaction(contextB, {
      commandId: "t07-cancel-cross-tenant-001",
      financialEventId: created.value.id,
    });
    expect(crossTenant).toMatchObject({
      ok: false,
      error: { code: "EVENT_NOT_FOUND", field: "financialEventId" },
    });

    const [eventCount, entryCount, commandCount] = await Promise.all([
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
    expect(eventCount).toHaveLength(2);
    expect(entryCount).toHaveLength(2);
    expect(commandCount.map(({ commandId }) => commandId).sort()).toEqual([
      "t07-cancel-001",
      "t07-create-expense-001",
    ]);
  });

  it("rolls back original status, reversal and command when the reversal entry fails", async () => {
    const db = databaseOrThrow(database);
    const useCases = createTransactionsUseCases(db, { today: "2026-08-29" });
    const created = await useCases.createExpense(contextA, expenseCommand);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await db.execute(sql`
      create or replace function t07_force_reversal_entry_failure()
      returns trigger
      language plpgsql
      as $function$
      begin
        raise exception 'T07 injected reversal entry failure';
      end;
      $function$;
    `);
    await db.execute(sql`
      create trigger t07_force_reversal_entry_failure_trigger
      before insert on account_entries
      for each row execute function t07_force_reversal_entry_failure();
    `);

    try {
      await expect(
        useCases.cancelManualTransaction(contextA, {
          commandId: "t07-cancel-rollback-001",
          financialEventId: created.value.id,
        }),
      ).rejects.toThrow();

      const [event, events, entries, command] = await Promise.all([
        db
          .select({ status: financialEvents.status })
          .from(financialEvents)
          .where(
            and(
              eq(financialEvents.id, created.value.id),
              eq(financialEvents.householdId, contextA.householdId),
            ),
          ),
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
      expect(event).toEqual([{ status: "POSTED" }]);
      expect(events).toHaveLength(1);
      expect(entries).toHaveLength(1);
      expect(command.map(({ commandId }) => commandId)).toEqual([
        "t07-create-expense-001",
      ]);
    } finally {
      await db.execute(sql`
        drop trigger if exists t07_force_reversal_entry_failure_trigger on account_entries;
        drop function if exists t07_force_reversal_entry_failure();
      `);
    }
  });

  it("does not reserve commands for missing events or cross-tenant updates", async () => {
    const db = databaseOrThrow(database);
    const useCases = createTransactionsUseCases(db, { today: "2026-08-29" });
    const missingId = "00000000-0000-7000-8000-000000079999";

    const missingUpdate = await useCases.updateManualTransaction(contextA, {
      commandId: "t07-update-missing-001",
      financialEventId: missingId,
      description: "Não deve persistir",
    });
    expect(missingUpdate).toMatchObject({
      ok: false,
      error: { code: "EVENT_NOT_FOUND", field: "financialEventId" },
    });

    const missingCancel = await useCases.cancelManualTransaction(contextA, {
      commandId: "t07-cancel-missing-001",
      financialEventId: missingId,
    });
    expect(missingCancel).toMatchObject({
      ok: false,
      error: { code: "EVENT_NOT_FOUND", field: "financialEventId" },
    });

    const commands = await db
      .select({ commandId: applicationCommands.commandId })
      .from(applicationCommands)
      .where(eq(applicationCommands.householdId, contextA.householdId));
    expect(commands).toEqual([]);
  });
});
