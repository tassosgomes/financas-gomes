import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  applicationCommands,
  financialEvents,
  householdMembers,
  households,
  transactionImportItems,
  transactionImportStaging,
  transactionImports,
  user,
} from "@/db/schema";

import {
  confirmTransactionImport,
} from "./confirmation-use-cases";
import { createCsvImportPreviewUseCase } from "./use-cases";

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
} as const;

const contextA = {
  userId: FIXTURES.users.a,
  householdId: FIXTURES.households.a,
} as const;

const contextB = {
  userId: FIXTURES.users.b,
  householdId: FIXTURES.households.b,
} as const;

const CSV = [
  "occurred_on,description,amount_cents,external_id",
  '2026-08-29," Salário, mês 08 ",+000125000,sal-2026-08',
  "2026-08-30,Café,-0001875,",
  "2026-08-30,inválida,0,invalid",
].join("\n");

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T07 não foi inicializado.");
  }
  return database;
}

async function cleanup(database: Database): Promise<void> {
  const householdsToClean = [
    FIXTURES.households.a,
    FIXTURES.households.b,
  ] as const;
  const usersToClean = [FIXTURES.users.a, FIXTURES.users.b] as const;

  await database
    .delete(transactionImportItems)
    .where(inArray(transactionImportItems.householdId, householdsToClean));
  await database
    .delete(transactionImportStaging)
    .where(inArray(transactionImportStaging.householdId, householdsToClean));
  await database
    .delete(transactionImports)
    .where(inArray(transactionImports.householdId, householdsToClean));
  await database
    .delete(accountEntries)
    .where(inArray(accountEntries.householdId, householdsToClean));
  await database
    .delete(financialEvents)
    .where(inArray(financialEvents.householdId, householdsToClean));
  await database
    .delete(applicationCommands)
    .where(inArray(applicationCommands.householdId, householdsToClean));
  await database
    .delete(accounts)
    .where(inArray(accounts.householdId, householdsToClean));
  await database
    .delete(householdMembers)
    .where(inArray(householdMembers.householdId, householdsToClean));
  await database.delete(households).where(inArray(households.id, householdsToClean));
  await database.delete(user).where(inArray(user.id, usersToClean));
}

async function seed(database: Database): Promise<void> {
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
    { householdId: FIXTURES.households.a, userId: FIXTURES.users.a },
    { householdId: FIXTURES.households.b, userId: FIXTURES.users.b },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      name: "T07 Account A",
      type: "CHECKING",
      trackingStartedOn: "2026-08-01",
    },
    {
      id: FIXTURES.accounts.b,
      householdId: FIXTURES.households.b,
      name: "T07 Account B",
      type: "CHECKING",
    },
  ]);
}

async function createPreview(database: Database, token: string) {
  return createCsvImportPreviewUseCase({
    database,
    now: new Date("2026-08-30T10:00:00.000Z"),
    today: "2026-08-30",
    tokenFactory: () => token,
  }).preview(contextA, {
    accountId: FIXTURES.accounts.a,
    file: CSV,
  });
}

integration("T07 confirmation and canonical ledger PostgreSQL", () => {
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
    await cleanup(db);
    await seed(db);
  });

  afterAll(async () => {
    if (database) {
      await cleanup(database);
    }
    await closeDb();
  });

  it("persists valid rows atomically in the S03 ledger and removes staging", async () => {
    const db = databaseOrThrow(database);
    const preview = await createPreview(db, "t07-confirm-token");

    const result = await confirmTransactionImport(
      contextA,
      { commandId: "t07-command-1", previewToken: preview.previewToken },
      {
        database: db,
        now: new Date("2026-08-30T10:05:00.000Z"),
        today: "2026-08-30",
      },
    );

    expect(result).toMatchObject({
      status: "IMPORTED",
      accountId: FIXTURES.accounts.a,
      counts: {
        processed: 3,
        valid: 2,
        invalid: 1,
        ignoredDuplicate: 0,
        imported: 2,
      },
      errors: [
        expect.objectContaining({
          rowNumber: 4,
          code: "CSV_ZERO_AMOUNT",
        }),
      ],
    });

    const events = await db
      .select()
      .from(financialEvents)
      .where(eq(financialEvents.householdId, contextA.householdId))
      .orderBy(financialEvents.occurredOn);
    expect(events).toHaveLength(2);
    expect(events.map((event) => [event.kind, event.origin, event.amountCents])).toEqual([
      ["INCOME", "IMPORT", BigInt("125000")],
      ["EXPENSE", "IMPORT", BigInt("1875")],
    ]);

    const entries = await db
      .select()
      .from(accountEntries)
      .where(eq(accountEntries.householdId, contextA.householdId));
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.accountId === FIXTURES.accounts.a)).toBe(true);
    expect(entries.map((entry) => entry.amountCents).sort()).toEqual([
      BigInt("-1875"),
      BigInt("125000"),
    ]);
    expect(entries.every((entry) => entry.status === "POSTED" && entry.expectedOn === null)).toBe(
      true,
    );

    const items = await db
      .select()
      .from(transactionImportItems)
      .where(eq(transactionImportItems.householdId, contextA.householdId));
    expect(items).toHaveLength(2);
    expect(
      await db
        .select({ id: transactionImportStaging.id })
        .from(transactionImportStaging)
        .where(eq(transactionImportStaging.householdId, contextA.householdId)),
    ).toEqual([]);
    expect(
      await db
        .select({ operation: applicationCommands.operation })
        .from(applicationCommands)
        .where(eq(applicationCommands.householdId, contextA.householdId)),
    ).toEqual([{ operation: "transactions.import.confirm" }]);
  });

  it("returns the original result on command retry without duplicating effects", async () => {
    const db = databaseOrThrow(database);
    const preview = await createPreview(db, "t07-retry-token");
    const command = { commandId: "t07-retry-command", previewToken: preview.previewToken };
    const options = {
      database: db,
      now: new Date("2026-08-30T10:05:00.000Z"),
      today: "2026-08-30" as const,
    };

    const first = await confirmTransactionImport(contextA, command, options);
    const retry = await confirmTransactionImport(contextA, command, options);
    expect(retry).toEqual(first);
    expect(
      await db
        .select({ id: financialEvents.id })
        .from(financialEvents)
        .where(eq(financialEvents.householdId, contextA.householdId)),
    ).toHaveLength(2);
    expect(
      await db
        .select({ id: transactionImports.id })
        .from(transactionImports)
        .where(eq(transactionImports.householdId, contextA.householdId)),
    ).toHaveLength(1);
  });

  it("makes concurrent retries with the same command id idempotent", async () => {
    const db = databaseOrThrow(database);
    const preview = await createPreview(db, "t07-concurrent-token");
    const command = {
      commandId: "t07-concurrent-command",
      previewToken: preview.previewToken,
    };
    const options = {
      database: db,
      now: new Date("2026-08-30T10:05:00.000Z"),
      today: "2026-08-30" as const,
    };

    const [first, second] = await Promise.all([
      confirmTransactionImport(contextA, command, options),
      confirmTransactionImport(contextA, command, options),
    ]);
    expect(second).toEqual(first);
    expect(
      await db
        .select({ id: financialEvents.id })
        .from(financialEvents)
        .where(eq(financialEvents.householdId, contextA.householdId)),
    ).toHaveLength(2);
    expect(
      await db
        .select({ commandId: applicationCommands.commandId })
        .from(applicationCommands)
        .where(eq(applicationCommands.householdId, contextA.householdId)),
    ).toEqual([{ commandId: command.commandId }]);
  });

  it("does not allow another household to consume a preview token", async () => {
    const db = databaseOrThrow(database);
    const preview = await createPreview(db, "t07-isolated-token");

    await expect(
      confirmTransactionImport(
        contextB,
        { commandId: "t07-cross-tenant", previewToken: preview.previewToken },
        { database: db, now: new Date("2026-08-30T10:05:00.000Z"), today: "2026-08-30" },
      ),
    ).rejects.toMatchObject({ code: "PREVIEW_NOT_FOUND" });
    expect(
      await db
        .select({ id: transactionImportStaging.id })
        .from(transactionImportStaging)
        .where(eq(transactionImportStaging.householdId, contextA.householdId)),
    ).toHaveLength(1);
  });

  it("keeps every write out when a ledger insert fails", async () => {
    const db = databaseOrThrow(database);
    const preview = await createPreview(db, "t07-rollback-token");
    await db.execute(sql`
      create or replace function t07_fail_import_item()
      returns trigger language plpgsql as $$
      begin
        raise exception 't07 injected item failure';
      end;
      $$
    `);
    await db.execute(sql`
      create trigger t07_fail_import_item_trigger
      before insert on transaction_import_items
      for each row execute function t07_fail_import_item()
    `);

    try {
      await expect(
        confirmTransactionImport(
          contextA,
          { commandId: "t07-rollback-command", previewToken: preview.previewToken },
          { database: db, now: new Date("2026-08-30T10:05:00.000Z"), today: "2026-08-30" },
        ),
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger if exists t07_fail_import_item_trigger on transaction_import_items`);
      await db.execute(sql`drop function if exists t07_fail_import_item()`);
    }

    expect(
      await db
        .select({ id: transactionImports.id })
        .from(transactionImports)
        .where(eq(transactionImports.householdId, contextA.householdId)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: financialEvents.id })
        .from(financialEvents)
        .where(eq(financialEvents.householdId, contextA.householdId)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: accountEntries.id })
        .from(accountEntries)
        .where(eq(accountEntries.householdId, contextA.householdId)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: applicationCommands.commandId })
        .from(applicationCommands)
        .where(eq(applicationCommands.householdId, contextA.householdId)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: transactionImportStaging.id })
        .from(transactionImportStaging)
        .where(eq(transactionImportStaging.householdId, contextA.householdId)),
    ).toHaveLength(1);
  });

  it("revalidates account state and token expiry at confirmation", async () => {
    const db = databaseOrThrow(database);
    const preview = await createPreview(db, "t07-state-token");
    await db
      .update(accounts)
      .set({ status: "ARCHIVED" })
      .where(
        and(eq(accounts.id, FIXTURES.accounts.a), eq(accounts.householdId, contextA.householdId)),
      );

    await expect(
      confirmTransactionImport(
        contextA,
        { commandId: "t07-archived-command", previewToken: preview.previewToken },
        { database: db, now: new Date("2026-08-30T10:05:00.000Z"), today: "2026-08-30" },
      ),
    ).rejects.toMatchObject({ code: "RESOURCE_ARCHIVED" });

    await db
      .update(accounts)
      .set({ status: "ACTIVE" })
      .where(
        and(eq(accounts.id, FIXTURES.accounts.a), eq(accounts.householdId, contextA.householdId)),
      );
    await expect(
      confirmTransactionImport(
        contextA,
        { commandId: "t07-expired-command", previewToken: preview.previewToken },
        { database: db, now: new Date("2026-08-30T10:16:00.000Z"), today: "2026-08-30" },
      ),
    ).rejects.toMatchObject({ code: "PREVIEW_EXPIRED" });
  });

  it("rejects a command ID reused for another preview", async () => {
    const db = databaseOrThrow(database);
    const first = await createPreview(db, "t07-command-token-1");
    await confirmTransactionImport(
      contextA,
      { commandId: "t07-reused-command", previewToken: first.previewToken },
      { database: db, now: new Date("2026-08-30T10:05:00.000Z"), today: "2026-08-30" },
    );

    const second = await createPreview(db, "t07-command-token-2");
    await expect(
      confirmTransactionImport(
        contextA,
        { commandId: "t07-reused-command", previewToken: second.previewToken },
        { database: db, now: new Date("2026-08-30T10:06:00.000Z"), today: "2026-08-30" },
      ),
    ).rejects.toMatchObject({ code: "COMMAND_ID_REUSED" });
  });
});
