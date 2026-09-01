import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations, getMigrationStatus } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  financialEvents,
  householdMembers,
  households,
  transactionImportItems,
  transactionImportStaging,
  transactionImports,
  user,
} from "@/db/schema";
import type {
  TransactionImportCandidate,
  TransactionImportRowError,
} from "./transaction-imports-schema";

/** T02 deliberately uses a disposable PostgreSQL database when opted in. */
const integration =
  process.env.T02_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  users: {
    a: "00000000-0000-7000-8000-000000021101",
    b: "00000000-0000-7000-8000-000000021102",
  },
  households: {
    a: "00000000-0000-7000-8000-000000022101",
    b: "00000000-0000-7000-8000-000000022102",
  },
  accounts: {
    a: "00000000-0000-7000-8000-000000023101",
    b: "00000000-0000-7000-8000-000000023102",
  },
  imports: {
    a: "00000000-0000-7000-8000-000000024101",
    b: "00000000-0000-7000-8000-000000024102",
  },
  staging: {
    a: "00000000-0000-7000-8000-000000025101",
    b: "00000000-0000-7000-8000-000000025102",
    otherHousehold: "00000000-0000-7000-8000-000000025103",
  },
  events: {
    a: "00000000-0000-7000-8000-000000026101",
    b: "00000000-0000-7000-8000-000000026102",
  },
  entries: {
    a: "00000000-0000-7000-8000-000000027101",
    b: "00000000-0000-7000-8000-000000027102",
  },
  items: {
    a: "00000000-0000-7000-8000-000000028101",
    b: "00000000-0000-7000-8000-000000028102",
  },
} as const;

const HOUSEHOLD_IDS = [FIXTURES.households.a, FIXTURES.households.b] as const;
const FINGERPRINT_A = "a".repeat(64);
const FINGERPRINT_B = "b".repeat(64);
const TOKEN_HASH_A = "1".repeat(64);
const TOKEN_HASH_B = "2".repeat(64);
const EVENT_AMOUNT = BigInt("1250");

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T02 não foi inicializado.");
  }
  return database;
}

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as {
    code?: unknown;
    cause?: { code?: unknown };
  };
  if (typeof candidate.code === "string") {
    return candidate.code;
  }
  return typeof candidate.cause?.code === "string"
    ? candidate.cause.code
    : undefined;
}

async function cleanupT02(database: Database): Promise<void> {
  await database
    .delete(transactionImportItems)
    .where(inArray(transactionImportItems.householdId, HOUSEHOLD_IDS));
  await database
    .delete(transactionImportStaging)
    .where(inArray(transactionImportStaging.householdId, HOUSEHOLD_IDS));
  await database
    .delete(transactionImports)
    .where(inArray(transactionImports.householdId, HOUSEHOLD_IDS));
  await database
    .delete(accountEntries)
    .where(inArray(accountEntries.householdId, HOUSEHOLD_IDS));
  await database
    .delete(financialEvents)
    .where(inArray(financialEvents.householdId, HOUSEHOLD_IDS));
  await database
    .delete(accounts)
    .where(inArray(accounts.householdId, HOUSEHOLD_IDS));
  await database
    .delete(householdMembers)
    .where(inArray(householdMembers.householdId, HOUSEHOLD_IDS));
  await database.delete(households).where(inArray(households.id, HOUSEHOLD_IDS));
  await database
    .delete(user)
    .where(inArray(user.id, [FIXTURES.users.a, FIXTURES.users.b]));
}

async function seedT02(database: Database): Promise<void> {
  await database.insert(user).values([
    {
      id: FIXTURES.users.a,
      name: "T02 Owner A",
      email: "t02-owner-a@example.test",
    },
    {
      id: FIXTURES.users.b,
      name: "T02 Owner B",
      email: "t02-owner-b@example.test",
    },
  ]);
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T02 Household A" },
    { id: FIXTURES.households.b, name: "T02 Household B" },
  ]);
  await database.insert(householdMembers).values([
    { householdId: FIXTURES.households.a, userId: FIXTURES.users.a },
    { householdId: FIXTURES.households.b, userId: FIXTURES.users.b },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      name: "T02 Account A",
      type: "CHECKING",
    },
    {
      id: FIXTURES.accounts.b,
      householdId: FIXTURES.households.b,
      name: "T02 Account B",
      type: "CHECKING",
    },
  ]);
}

const validCandidates: TransactionImportCandidate[] = [
  {
    rowNumber: 2,
    occurredOn: "2026-08-29",
    description: "T02 import",
    amountCents: "1250",
    signedAmountCents: "1250",
    kind: "INCOME",
    externalId: "external-2",
  },
  {
    rowNumber: 3,
    occurredOn: "2026-08-30",
    description: "T02 second import",
    amountCents: "500",
    signedAmountCents: "-500",
    kind: "EXPENSE",
    externalId: null,
  },
];

const rowErrors: TransactionImportRowError[] = [
  {
    rowNumber: 4,
    code: "CSV_INVALID_AMOUNT",
    field: "amountCents",
    message: "valor em centavos inválido",
  },
];

integration("T02 import schema and integrity PostgreSQL", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar T02_INTEGRATION=1.",
      );
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = databaseOrThrow(database);
    await cleanupT02(db);
    await seedT02(db);
  });

  afterAll(async () => {
    if (database) {
      await cleanupT02(database);
    }
    await closeDb();
  });

  it("applies the migration and exposes the tenant-safe import model", async () => {
    const db = databaseOrThrow(database);
    const status = await getMigrationStatus();
    expect(status).toMatchObject({ pending: 0, drifted: 0 });

    const tables = await db.execute<{ tablename: string }>(sql`
      select tablename
        from pg_catalog.pg_tables
       where schemaname = 'public'
         and tablename in (
           'transaction_imports',
           'transaction_import_staging',
           'transaction_import_items'
         )
       order by tablename
    `);
    expect(tables.rows.map(({ tablename }) => tablename)).toEqual([
      "transaction_import_items",
      "transaction_import_staging",
      "transaction_imports",
    ]);

    const indexes = await db.execute<{ indexname: string }>(sql`
      select indexname
        from pg_catalog.pg_indexes
       where schemaname = 'public'
         and tablename in (
           'transaction_imports',
           'transaction_import_staging',
           'transaction_import_items'
         )
         and indexname in (
           'transaction_imports_household_account_created_at_idx',
           'transaction_imports_household_account_fingerprint_uq',
           'transaction_import_staging_household_token_hash_uq',
           'transaction_import_staging_household_expires_at_idx',
           'transaction_import_items_household_import_row_idx',
           'transaction_import_items_household_event_idx'
         )
       order by indexname
    `);
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
      "transaction_import_items_household_event_idx",
      "transaction_import_items_household_import_row_idx",
      "transaction_import_staging_household_expires_at_idx",
      "transaction_import_staging_household_token_hash_uq",
      "transaction_imports_household_account_created_at_idx",
      "transaction_imports_household_account_fingerprint_uq",
    ]);

    const columns = await db.execute<{
      column_name: string;
      data_type: string;
    }>(sql`
      select column_name, data_type
        from information_schema.columns
       where table_schema = 'public'
         and table_name in ('transaction_imports', 'transaction_import_items')
         and column_name in ('amount_cents', 'source_file_size_bytes')
    `);
    expect(columns.rows.some(({ column_name }) => column_name === "amount_cents")).toBe(
      false,
    );
    expect(
      columns.rows.find(({ column_name }) => column_name === "source_file_size_bytes")
        ?.data_type,
    ).toBe("integer");

    const balanceColumns = await db.execute<{ column_name: string }>(sql`
      select column_name
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'accounts'
         and column_name = 'balance'
    `);
    expect(balanceColumns.rows).toEqual([]);

    const floatingPointColumns = await db.execute<{
      table_name: string;
      column_name: string;
    }>(sql`
      select table_name, column_name
        from information_schema.columns
       where table_schema = 'public'
         and table_name in (
           'accounts',
           'transaction_imports',
           'transaction_import_staging',
           'transaction_import_items'
         )
         and data_type in ('real', 'double precision')
    `);
    expect(floatingPointColumns.rows).toEqual([]);
  });

  it("persists a confirmed batch, staging candidate payload and event lineage", async () => {
    const db = databaseOrThrow(database);
    const createdAt = new Date("2026-08-30T10:00:00.000Z");
    const confirmedAt = new Date("2026-08-30T10:01:00.000Z");
    const expiresAt = new Date("2026-08-30T10:15:00.000Z");

    await db.insert(transactionImportStaging).values({
      id: FIXTURES.staging.a,
      householdId: FIXTURES.households.a,
      accountId: FIXTURES.accounts.a,
      tokenHash: TOKEN_HASH_A,
      datasetFingerprint: FINGERPRINT_A,
      formatVersion: "s04-csv-v1",
      sourceFileSizeBytes: 256,
      sourceHasBom: false,
      sourceColumns: "WITH_EXTERNAL_ID",
      processedRows: 3,
      validRows: 2,
      invalidRows: 1,
      errors: rowErrors,
      candidateRows: validCandidates,
      expiresAt,
      createdAt,
    });

    await db.insert(transactionImports).values({
      id: FIXTURES.imports.a,
      householdId: FIXTURES.households.a,
      accountId: FIXTURES.accounts.a,
      initiatedByUserId: FIXTURES.users.a,
      formatVersion: "s04-csv-v1",
      datasetFingerprint: FINGERPRINT_A,
      sourceFileSizeBytes: 256,
      sourceHasBom: false,
      sourceColumns: "WITH_EXTERNAL_ID",
      processedRows: 3,
      validRows: 2,
      invalidRows: 1,
      ignoredDuplicateRows: 0,
      importedRows: 2,
      errors: rowErrors,
      status: "CONFIRMED",
      createdAt,
      confirmedAt,
    });

    await db.insert(financialEvents).values([
      {
        id: FIXTURES.events.a,
        householdId: FIXTURES.households.a,
        kind: "INCOME",
        status: "POSTED",
        origin: "IMPORT",
        amountCents: EVENT_AMOUNT,
        occurredOn: "2026-08-29",
        description: "T02 import",
      },
      {
        id: FIXTURES.events.b,
        householdId: FIXTURES.households.a,
        kind: "EXPENSE",
        status: "POSTED",
        origin: "IMPORT",
        amountCents: BigInt("500"),
        occurredOn: "2026-08-30",
        description: "T02 second import",
      },
    ]);
    await db.insert(accountEntries).values([
      {
        id: FIXTURES.entries.a,
        financialEventId: FIXTURES.events.a,
        accountId: FIXTURES.accounts.a,
        householdId: FIXTURES.households.a,
        amountCents: EVENT_AMOUNT,
        status: "POSTED",
        postedOn: "2026-08-29",
      },
      {
        id: FIXTURES.entries.b,
        financialEventId: FIXTURES.events.b,
        accountId: FIXTURES.accounts.a,
        householdId: FIXTURES.households.a,
        amountCents: BigInt("-500"),
        status: "POSTED",
        postedOn: "2026-08-30",
      },
    ]);
    await db.insert(transactionImportItems).values([
      {
        id: FIXTURES.items.a,
        householdId: FIXTURES.households.a,
        importId: FIXTURES.imports.a,
        rowNumber: 2,
        externalId: "external-2",
        financialEventId: FIXTURES.events.a,
      },
      {
        id: FIXTURES.items.b,
        householdId: FIXTURES.households.a,
        importId: FIXTURES.imports.a,
        rowNumber: 3,
        externalId: null,
        financialEventId: FIXTURES.events.b,
      },
    ]);

    const lineage = await db
      .select({
        rowNumber: transactionImportItems.rowNumber,
        externalId: transactionImportItems.externalId,
        eventOrigin: financialEvents.origin,
        amountCents: financialEvents.amountCents,
      })
      .from(transactionImportItems)
      .innerJoin(
        financialEvents,
        and(
          eq(transactionImportItems.financialEventId, financialEvents.id),
          eq(transactionImportItems.householdId, financialEvents.householdId),
        ),
      )
      .where(eq(transactionImportItems.householdId, FIXTURES.households.a))
      .orderBy(transactionImportItems.rowNumber);

    expect(lineage).toEqual([
      {
        rowNumber: 2,
        externalId: "external-2",
        eventOrigin: "IMPORT",
        amountCents: EVENT_AMOUNT,
      },
      {
        rowNumber: 3,
        externalId: null,
        eventOrigin: "IMPORT",
        amountCents: BigInt("500"),
      },
    ]);

    const staging = await db
      .select({
        candidateRows: transactionImportStaging.candidateRows,
        errors: transactionImportStaging.errors,
      })
      .from(transactionImportStaging)
      .where(
        and(
          eq(transactionImportStaging.householdId, FIXTURES.households.a),
          eq(transactionImportStaging.tokenHash, TOKEN_HASH_A),
        ),
      );
    expect(staging).toEqual([
      { candidateRows: validCandidates, errors: rowErrors },
    ]);
  });

  it("rejects cross-tenant references and duplicate confirmed fingerprints", async () => {
    const db = databaseOrThrow(database);
    const baseImport = {
      id: FIXTURES.imports.a,
      householdId: FIXTURES.households.a,
      accountId: FIXTURES.accounts.a,
      initiatedByUserId: FIXTURES.users.a,
      formatVersion: "s04-csv-v1" as const,
      datasetFingerprint: FINGERPRINT_A,
      sourceFileSizeBytes: 100,
      sourceHasBom: false,
      sourceColumns: "BASE" as const,
      processedRows: 1,
      validRows: 1,
      invalidRows: 0,
      ignoredDuplicateRows: 0,
      importedRows: 1,
      errors: [],
      status: "CONFIRMED" as const,
    };
    await db.insert(transactionImports).values(baseImport);

    await expect(
      db.insert(transactionImports).values({
        ...baseImport,
        id: FIXTURES.imports.b,
        accountId: FIXTURES.accounts.b,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );

    await expect(
      db.insert(transactionImports).values({
        ...baseImport,
        id: FIXTURES.imports.b,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23505",
    );

    await db.insert(transactionImports).values({
      ...baseImport,
      id: FIXTURES.imports.b,
      householdId: FIXTURES.households.b,
      accountId: FIXTURES.accounts.b,
      initiatedByUserId: FIXTURES.users.b,
      datasetFingerprint: FINGERPRINT_B,
    });

    const scoped = await db
      .select({ id: transactionImports.id })
      .from(transactionImports)
      .where(eq(transactionImports.householdId, FIXTURES.households.b));
    expect(scoped).toEqual([{ id: FIXTURES.imports.b }]);
  });

  it("enforces import event shape, count invariants and one-use staging token", async () => {
    const db = databaseOrThrow(database);
    const now = new Date("2026-08-30T10:00:00.000Z");
    const expiresAt = new Date("2026-08-30T10:15:00.000Z");
    await db.insert(transactionImportStaging).values({
      id: FIXTURES.staging.a,
      householdId: FIXTURES.households.a,
      accountId: FIXTURES.accounts.a,
      tokenHash: TOKEN_HASH_A,
      datasetFingerprint: FINGERPRINT_A,
      formatVersion: "s04-csv-v1",
      sourceFileSizeBytes: 128,
      sourceHasBom: false,
      sourceColumns: "BASE",
      processedRows: 1,
      validRows: 1,
      invalidRows: 0,
      errors: [],
      candidateRows: [validCandidates[0]],
      expiresAt,
      createdAt: now,
    });

    await expect(
      db.insert(transactionImportStaging).values({
        id: FIXTURES.staging.b,
        householdId: FIXTURES.households.a,
        accountId: FIXTURES.accounts.a,
        tokenHash: TOKEN_HASH_A,
        datasetFingerprint: FINGERPRINT_B,
        formatVersion: "s04-csv-v1",
        sourceFileSizeBytes: 128,
        sourceHasBom: false,
        sourceColumns: "BASE",
        processedRows: 1,
        validRows: 1,
        invalidRows: 0,
        errors: [],
        candidateRows: [validCandidates[0]],
        expiresAt,
        createdAt: now,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23505",
    );

    await expect(
      db.insert(transactionImportStaging).values({
        id: FIXTURES.staging.b,
        householdId: FIXTURES.households.a,
        accountId: FIXTURES.accounts.a,
        tokenHash: TOKEN_HASH_B,
        datasetFingerprint: FINGERPRINT_B,
        formatVersion: "s04-csv-v1",
        sourceFileSizeBytes: 128,
        sourceHasBom: false,
        sourceColumns: "BASE",
        processedRows: 2,
        validRows: 1,
        invalidRows: 1,
        errors: [],
        candidateRows: [],
        expiresAt,
        createdAt: now,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );

    await expect(
      db.insert(financialEvents).values({
        id: FIXTURES.events.a,
        householdId: FIXTURES.households.a,
        kind: "INCOME",
        status: "CANCELLED",
        origin: "IMPORT",
        amountCents: EVENT_AMOUNT,
        occurredOn: "2026-08-30",
        description: "invalid import state",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );

    await db.insert(transactionImportStaging).values({
      id: FIXTURES.staging.otherHousehold,
      householdId: FIXTURES.households.b,
      accountId: FIXTURES.accounts.b,
      tokenHash: TOKEN_HASH_A,
      datasetFingerprint: FINGERPRINT_A,
      formatVersion: "s04-csv-v1",
      sourceFileSizeBytes: 128,
      sourceHasBom: false,
      sourceColumns: "BASE",
      processedRows: 1,
      validRows: 1,
      invalidRows: 0,
      errors: [],
      candidateRows: [validCandidates[0]],
      expiresAt,
      createdAt: now,
    });

    const sameTokenOtherHousehold = await db
      .select({ id: transactionImportStaging.id })
      .from(transactionImportStaging)
      .where(eq(transactionImportStaging.tokenHash, TOKEN_HASH_A));
    expect(sameTokenOtherHousehold).toHaveLength(2);

    await db
      .delete(transactionImportStaging)
      .where(
        and(
          eq(transactionImportStaging.householdId, FIXTURES.households.a),
          eq(transactionImportStaging.tokenHash, TOKEN_HASH_A),
        ),
      );
    const consumed = await db
      .select({ id: transactionImportStaging.id })
      .from(transactionImportStaging)
      .where(eq(transactionImportStaging.householdId, FIXTURES.households.a));
    expect(consumed).toEqual([]);
  });
});
