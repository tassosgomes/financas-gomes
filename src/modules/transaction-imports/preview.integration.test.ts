import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  financialEvents,
  householdMembers,
  households,
  transactionImportStaging,
  transactionImports,
  user,
} from "@/db/schema";

import {
  hashCsvImportPreviewToken,
  createCsvImportPreviewUseCase,
} from "./use-cases";

const integration =
  process.env.T06_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  users: {
    a: "00000000-0000-7000-8000-000000061101",
    b: "00000000-0000-7000-8000-000000061102",
  },
  households: {
    a: "00000000-0000-7000-8000-000000062101",
    b: "00000000-0000-7000-8000-000000062102",
  },
  accounts: {
    a: "00000000-0000-7000-8000-000000063101",
    b: "00000000-0000-7000-8000-000000063102",
  },
  imports: {
    a: "00000000-0000-7000-8000-000000064101",
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
    throw new Error("O banco de integração T06 não foi inicializado.");
  }
  return database;
}

async function cleanup(database: Database): Promise<void> {
  const householdIds = [FIXTURES.households.a, FIXTURES.households.b] as const;
  const userIds = [FIXTURES.users.a, FIXTURES.users.b] as const;
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
      name: "T06 Owner A",
      email: "t06-owner-a@example.test",
    },
    {
      id: FIXTURES.users.b,
      name: "T06 Owner B",
      email: "t06-owner-b@example.test",
    },
  ]);
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T06 Household A" },
    { id: FIXTURES.households.b, name: "T06 Household B" },
  ]);
  await database.insert(householdMembers).values([
    { householdId: FIXTURES.households.a, userId: FIXTURES.users.a },
    { householdId: FIXTURES.households.b, userId: FIXTURES.users.b },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      name: "T06 Account A",
      type: "CHECKING",
      trackingStartedOn: "2026-08-01",
    },
    {
      id: FIXTURES.accounts.b,
      householdId: FIXTURES.households.b,
      name: "T06 Account B",
      type: "CHECKING",
    },
  ]);
}

integration("T06 authenticated tenant-scoped preview", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar T06_INTEGRATION=1.",
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

  it("stages a normalized preview without touching the ledger", async () => {
    const db = databaseOrThrow(database);
    const token = "t06-preview-token-a";
    const useCase = createCsvImportPreviewUseCase({
      database: db,
      now: new Date("2026-08-30T10:00:00.000Z"),
      today: "2026-08-30",
      tokenFactory: () => token,
    });

    const preview = await useCase.preview(contextA, {
      accountId: FIXTURES.accounts.a,
      file: CSV,
    });

    expect(preview).toMatchObject({
      formatVersion: "s04-csv-v1",
      previewToken: token,
      expiresAt: "2026-08-30T10:15:00.000Z",
      accountId: FIXTURES.accounts.a,
      duplicateStatus: "NEW",
      existingImportId: null,
      counts: {
        processed: 3,
        valid: 2,
        invalid: 1,
        ignoredDuplicate: 0,
        imported: 0,
      },
    });
    expect(preview.rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        description: "Salário, mês 08",
        signedAmountCents: "125000",
      }),
      expect.objectContaining({
        rowNumber: 3,
        description: "Café",
        signedAmountCents: "-1875",
      }),
    ]);

    const staging = await db
      .select()
      .from(transactionImportStaging)
      .where(
        and(
          eq(transactionImportStaging.householdId, contextA.householdId),
          eq(transactionImportStaging.accountId, FIXTURES.accounts.a),
        ),
      );
    expect(staging).toHaveLength(1);
    expect(staging[0]?.tokenHash).toBe(hashCsvImportPreviewToken(token));
    expect(staging[0]?.tokenHash).not.toBe(token);
    expect(staging[0]?.candidateRows).toHaveLength(2);

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
  });

  it("rejects a cross-household account before parsing or staging", async () => {
    const db = databaseOrThrow(database);
    const useCase = createCsvImportPreviewUseCase({
      database: db,
      today: "2026-08-30",
    });

    await expect(
      useCase.preview(contextA, {
        accountId: FIXTURES.accounts.b,
        file: "not a CSV and should not be parsed",
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND", status: 404 });

    expect(
      await db
        .select({ id: transactionImportStaging.id })
        .from(transactionImportStaging)
        .where(eq(transactionImportStaging.householdId, contextA.householdId)),
    ).toEqual([]);
  });

  it("does not create a token for structural or no-valid-row failures", async () => {
    const db = databaseOrThrow(database);
    const useCase = createCsvImportPreviewUseCase({
      database: db,
      now: new Date("2026-08-30T10:00:00.000Z"),
      today: "2026-08-30",
      tokenFactory: () => "should-not-be-called",
    });

    await expect(
      useCase.preview(contextA, {
        accountId: FIXTURES.accounts.a,
        file: "data;description;amount_cents\n2026-08-30,Café,1",
      }),
    ).rejects.toMatchObject({ code: "CSV_INVALID_DELIMITER" });

    const noValidRows = await useCase.preview(contextA, {
      accountId: FIXTURES.accounts.a,
      file: [
        "occurred_on,description,amount_cents",
        "not-a-date,linha,1",
      ].join("\n"),
    });
    expect(noValidRows.previewToken).toBe("");
    expect(noValidRows.counts).toMatchObject({
      processed: 1,
      valid: 0,
      invalid: 1,
    });
    expect(
      await db
        .select({ id: transactionImportStaging.id })
        .from(transactionImportStaging)
        .where(eq(transactionImportStaging.householdId, contextA.householdId)),
    ).toEqual([]);
  });

  it("marks an existing same-tenant fingerprint as duplicate", async () => {
    const db = databaseOrThrow(database);
    const first = createCsvImportPreviewUseCase({
      database: db,
      now: new Date("2026-08-30T10:00:00.000Z"),
      today: "2026-08-30",
      tokenFactory: () => "t06-duplicate-preview",
    });
    const initialPreview = await first.preview(contextA, {
      accountId: FIXTURES.accounts.a,
      file: [
        "occurred_on,description,amount_cents",
        "2026-08-30,Café,-500",
      ].join("\n"),
    });
    const staging = await db
      .select({ fingerprint: transactionImportStaging.datasetFingerprint })
      .from(transactionImportStaging)
      .where(eq(transactionImportStaging.householdId, contextA.householdId));
    const fingerprint = staging[0]?.fingerprint;
    if (!fingerprint) {
      throw new Error("A fixture de preview não foi persistida.");
    }

    await db.insert(transactionImports).values({
      id: FIXTURES.imports.a,
      householdId: contextA.householdId,
      accountId: FIXTURES.accounts.a,
      initiatedByUserId: contextA.userId,
      formatVersion: "s04-csv-v1",
      datasetFingerprint: fingerprint,
      sourceFileSizeBytes: 64,
      sourceHasBom: false,
      sourceColumns: "BASE",
      processedRows: 1,
      validRows: 1,
      invalidRows: 0,
      ignoredDuplicateRows: 0,
      importedRows: 1,
      errors: [],
      status: "CONFIRMED",
      createdAt: new Date("2026-08-30T10:01:00.000Z"),
      confirmedAt: new Date("2026-08-30T10:02:00.000Z"),
    });

    const duplicate = await createCsvImportPreviewUseCase({
      database: db,
      now: new Date("2026-08-30T10:03:00.000Z"),
      today: "2026-08-30",
      tokenFactory: () => "t06-duplicate-preview-2",
    }).preview(contextA, {
      accountId: FIXTURES.accounts.a,
      file: [
        "occurred_on,description,amount_cents",
        "2026-08-30,Café,-500",
      ].join("\n"),
    });

    expect(initialPreview.duplicateStatus).toBe("NEW");
    expect(duplicate).toMatchObject({
      duplicateStatus: "ALREADY_IMPORTED",
      existingImportId: FIXTURES.imports.a,
      previewToken: "t06-duplicate-preview-2",
    });
    expect(
      await db
        .select({ id: transactionImports.id })
        .from(transactionImports)
        .where(eq(transactionImports.householdId, contextA.householdId)),
    ).toEqual([{ id: FIXTURES.imports.a }]);
  });

  it("does not reveal a token staged by another household", async () => {
    const db = databaseOrThrow(database);
    const useCase = createCsvImportPreviewUseCase({
      database: db,
      now: new Date("2026-08-30T10:00:00.000Z"),
      today: "2026-08-30",
      tokenFactory: () => "t06-household-b-token",
    });
    await useCase.preview(contextB, {
      accountId: FIXTURES.accounts.b,
      file: [
        "occurred_on,description,amount_cents",
        "2026-08-30,Privado,1",
      ].join("\n"),
    });

    const rowsForA = await db
      .select({ id: transactionImportStaging.id })
      .from(transactionImportStaging)
      .where(eq(transactionImportStaging.householdId, contextA.householdId));
    expect(rowsForA).toEqual([]);
    await expect(
      useCase.preview(contextA, {
        accountId: FIXTURES.accounts.a,
        file: [
          "occurred_on,description,amount_cents",
          "2026-08-30,Outro,1",
        ].join("\n"),
      }),
    ).resolves.toMatchObject({ accountId: FIXTURES.accounts.a });
  });
});
