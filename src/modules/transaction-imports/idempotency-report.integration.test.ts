import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

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

import { confirmTransactionImport } from "./confirmation-use-cases";
import { createCsvImportPreviewUseCase } from "./use-cases";
import {
  findCsvImportReportForContext,
  getCsvImportReport,
} from "./reports";

const integration =
  process.env.T08_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  users: {
    a: "00000000-0000-7000-8000-000000081101",
    b: "00000000-0000-7000-8000-000000081102",
  },
  households: {
    a: "00000000-0000-7000-8000-000000082101",
    b: "00000000-0000-7000-8000-000000082102",
  },
  accounts: {
    a: "00000000-0000-7000-8000-000000083101",
    b: "00000000-0000-7000-8000-000000083102",
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
  "occurred_on,description,amount_cents",
  "2026-08-29,Salário,125000",
  "2026-08-30,Café,-1875",
  "2026-08-30,linha inválida,0",
].join("\n");

const REORDERED_CSV = [
  "occurred_on,description,amount_cents",
  "2026-08-30,Café,-1875",
  "2026-08-29,Salário,125000",
  "2026-08-30,linha inválida,0",
].join("\n");

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T08 não foi inicializado.");
  }
  return database;
}

async function cleanup(database: Database): Promise<void> {
  const householdIds = [FIXTURES.households.a, FIXTURES.households.b] as const;
  const userIds = [FIXTURES.users.a, FIXTURES.users.b] as const;

  await database
    .delete(transactionImportItems)
    .where(inArray(transactionImportItems.householdId, householdIds));
  await database
    .delete(transactionImportStaging)
    .where(inArray(transactionImportStaging.householdId, householdIds));
  await database
    .delete(transactionImports)
    .where(inArray(transactionImports.householdId, householdIds));
  await database
    .delete(accountEntries)
    .where(inArray(accountEntries.householdId, householdIds));
  await database
    .delete(financialEvents)
    .where(inArray(financialEvents.householdId, householdIds));
  await database
    .delete(applicationCommands)
    .where(inArray(applicationCommands.householdId, householdIds));
  await database
    .delete(accounts)
    .where(inArray(accounts.householdId, householdIds));
  await database
    .delete(householdMembers)
    .where(inArray(householdMembers.householdId, householdIds));
  await database.delete(households).where(inArray(households.id, householdIds));
  await database.delete(user).where(inArray(user.id, userIds));
}

async function seed(database: Database): Promise<void> {
  await database.insert(user).values([
    {
      id: FIXTURES.users.a,
      name: "T08 Owner A",
      email: "t08-owner-a@example.test",
    },
    {
      id: FIXTURES.users.b,
      name: "T08 Owner B",
      email: "t08-owner-b@example.test",
    },
  ]);
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T08 Household A" },
    { id: FIXTURES.households.b, name: "T08 Household B" },
  ]);
  await database.insert(householdMembers).values([
    { householdId: FIXTURES.households.a, userId: FIXTURES.users.a },
    { householdId: FIXTURES.households.b, userId: FIXTURES.users.b },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      name: "T08 Account A",
      type: "CHECKING",
      trackingStartedOn: "2026-08-01",
    },
    {
      id: FIXTURES.accounts.b,
      householdId: FIXTURES.households.b,
      name: "T08 Account B",
      type: "CHECKING",
    },
  ]);
}

async function createPreview(
  database: Database,
  token: string,
  csv = CSV,
  now = new Date("2026-08-30T10:00:00.000Z"),
) {
  return createCsvImportPreviewUseCase({
    database,
    now,
    today: "2026-08-30",
    tokenFactory: () => token,
  }).preview(contextA, {
    accountId: FIXTURES.accounts.a,
    file: csv,
  });
}

const confirmationOptions = {
  now: new Date("2026-08-30T10:05:00.000Z"),
  today: "2026-08-30" as const,
};

integration("T08 import idempotency and persisted report", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar T08_INTEGRATION=1.",
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

  it("persists a report, returns it tenant-safely, and retries duplicate outcomes", async () => {
    const db = databaseOrThrow(database);
    const firstPreview = await createPreview(db, "t08-report-token-1");
    const first = await confirmTransactionImport(
      contextA,
      { commandId: "t08-report-command-1", previewToken: firstPreview.previewToken },
      { database: db, ...confirmationOptions },
    );

    expect(first.status).toBe("IMPORTED");
    if (first.status !== "IMPORTED") {
      throw new Error("A primeira confirmação deve importar o conjunto.");
    }

    const report = await getCsvImportReport(
      contextA,
      first.importId,
      db,
    );
    expect(report).toEqual(first);
    expect(
      await findCsvImportReportForContext(db, contextB, first.importId),
    ).toBeUndefined();

    const duplicatePreview = await createPreview(
      db,
      "t08-report-token-2",
      REORDERED_CSV,
    );
    expect(duplicatePreview.duplicateStatus).toBe("ALREADY_IMPORTED");
    expect(duplicatePreview.existingImportId).toBe(first.importId);

    const duplicateCommand = {
      commandId: "t08-report-command-2",
      previewToken: duplicatePreview.previewToken,
    };
    const duplicate = await confirmTransactionImport(
      contextA,
      duplicateCommand,
      { database: db, ...confirmationOptions },
    );
    expect(duplicate).toMatchObject({
      status: "DUPLICATE_DATASET",
      existingImportId: first.importId,
      accountId: FIXTURES.accounts.a,
      counts: {
        processed: 3,
        valid: 2,
        invalid: 1,
        ignoredDuplicate: 2,
        imported: 0,
      },
    });

    // Preview cleanup can remove expired staging. The command snapshot still
    // has to preserve the original duplicate result after that retention
    // boundary, rather than falling back to an imported response.
    await createPreview(
      db,
      "t08-report-token-cleanup",
      CSV,
      new Date("2026-08-30T10:20:00.000Z"),
    );
    expect(
      await confirmTransactionImport(contextA, duplicateCommand, {
        database: db,
        now: new Date("2026-08-30T10:20:00.000Z"),
        today: "2026-08-30",
      }),
    ).toEqual(duplicate);

    expect(
      await db
        .select({ id: transactionImports.id })
        .from(transactionImports)
        .where(eq(transactionImports.householdId, contextA.householdId)),
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: financialEvents.id })
        .from(financialEvents)
        .where(eq(financialEvents.householdId, contextA.householdId)),
    ).toHaveLength(2);
  });

  it("resolves concurrent confirmations as one import and one duplicate", async () => {
    const db = databaseOrThrow(database);
    const firstPreview = await createPreview(db, "t08-race-token-1");
    const secondPreview = await createPreview(db, "t08-race-token-2");

    const [first, second] = await Promise.all([
      confirmTransactionImport(
        contextA,
        { commandId: "t08-race-command-1", previewToken: firstPreview.previewToken },
        { database: db, ...confirmationOptions },
      ),
      confirmTransactionImport(
        contextA,
        { commandId: "t08-race-command-2", previewToken: secondPreview.previewToken },
        { database: db, ...confirmationOptions },
      ),
    ]);

    expect(new Set([first.status, second.status])).toEqual(
      new Set(["IMPORTED", "DUPLICATE_DATASET"]),
    );
    expect(
      await db
        .select({ id: transactionImports.id })
        .from(transactionImports)
        .where(eq(transactionImports.householdId, contextA.householdId)),
    ).toHaveLength(1);
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
        .where(eq(transactionImports.householdId, contextB.householdId)),
    ).toHaveLength(0);
  });
});
