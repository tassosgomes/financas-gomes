import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  categories,
  financialEvents,
  households,
  transactionImportItems,
  transactionImports,
} from "@/db/schema";

import {
  findReviewableTransactionForContext,
  getTransactionReviewSummaryForContext,
  listReviewableTransactionsForContext,
} from "./review-reads";

const integration =
  process.env.T04_INTEGRATION === "1" ? describe : describe.skip;

const F = {
  householdA: "00000000-0000-7000-8000-000000041101",
  householdB: "00000000-0000-7000-8000-000000041102",
  accountA: "00000000-0000-7000-8000-000000042101",
  accountB: "00000000-0000-7000-8000-000000042102",
  categoryA: "00000000-0000-7000-8000-000000043101",
  categoryB: "00000000-0000-7000-8000-000000043102",
  importA: "00000000-0000-7000-8000-000000044101",
  manualPending: "00000000-0000-7000-8000-000000045101",
  manualOrganized: "00000000-0000-7000-8000-000000045102",
  importedPending: "00000000-0000-7000-8000-000000045103",
  cancelled: "00000000-0000-7000-8000-000000045104",
  reversal: "00000000-0000-7000-8000-000000045105",
  otherTenant: "00000000-0000-7000-8000-000000045106",
  entryManualPending: "00000000-0000-7000-8000-000000046101",
  entryManualOrganized: "00000000-0000-7000-8000-000000046102",
  entryImportedPending: "00000000-0000-7000-8000-000000046103",
  entryCancelled: "00000000-0000-7000-8000-000000046104",
  entryOtherTenant: "00000000-0000-7000-8000-000000046105",
  itemImportedPending: "00000000-0000-7000-8000-000000047101",
  invalidImport: "00000000-0000-7000-8000-000000045107",
  invalidImportEntry: "00000000-0000-7000-8000-000000046106",
} as const;

const contextA = {
  userId: "00000000-0000-7000-8000-000000048101",
  householdId: F.householdA,
};

const householdIds = [F.householdA, F.householdB] as const;

function dbOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T04 não foi inicializado.");
  }
  return database;
}

function importValues() {
  const createdAt = new Date("2026-08-30T10:00:00.000Z");
  return {
    id: F.importA,
    householdId: F.householdA,
    accountId: F.accountA,
    formatVersion: "s04-csv-v1" as const,
    datasetFingerprint: "4".repeat(64),
    sourceFileSizeBytes: 128,
    sourceHasBom: false,
    sourceColumns: "WITH_EXTERNAL_ID" as const,
    processedRows: 1,
    validRows: 1,
    invalidRows: 0,
    ignoredDuplicateRows: 0,
    importedRows: 1,
    errors: [],
    status: "CONFIRMED" as const,
    createdAt,
    confirmedAt: new Date("2026-08-30T10:01:00.000Z"),
  };
}

async function cleanup(database: Database): Promise<void> {
  await database
    .delete(transactionImportItems)
    .where(inArray(transactionImportItems.householdId, householdIds));
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
    .delete(categories)
    .where(inArray(categories.householdId, householdIds));
  await database
    .delete(accounts)
    .where(inArray(accounts.householdId, householdIds));
  await database
    .delete(households)
    .where(inArray(households.id, householdIds));
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: F.householdA, name: "T04 review household A" },
    { id: F.householdB, name: "T04 review household B" },
  ]);
  await database.insert(accounts).values([
    {
      id: F.accountA,
      householdId: F.householdA,
      name: "T04 review account A",
      type: "CHECKING",
    },
    {
      id: F.accountB,
      householdId: F.householdB,
      name: "T04 review account B",
      type: "CHECKING",
    },
  ]);
  await database.insert(categories).values([
    {
      id: F.categoryA,
      householdId: F.householdA,
      name: "T04 expense A",
      kind: "EXPENSE",
    },
    {
      id: F.categoryB,
      householdId: F.householdB,
      name: "T04 expense B",
      kind: "EXPENSE",
    },
  ]);
  await database.insert(transactionImports).values(importValues());

  await database.insert(financialEvents).values([
    {
      id: F.manualPending,
      householdId: F.householdA,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(1000),
      occurredOn: "2026-08-30",
      description: "Mercado 100%",
    },
    {
      id: F.manualOrganized,
      householdId: F.householdA,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(2000),
      occurredOn: "2026-08-30",
      description: "Conta de luz",
      categoryId: F.categoryA,
    },
    {
      id: F.importedPending,
      householdId: F.householdA,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "IMPORT",
      amountCents: BigInt(3000),
      occurredOn: "2026-08-29",
      description: "Compra _ importada",
    },
    {
      id: F.cancelled,
      householdId: F.householdA,
      kind: "EXPENSE",
      status: "CANCELLED",
      origin: "MANUAL",
      amountCents: BigInt(4000),
      occurredOn: "2026-08-28",
      description: "Lançamento cancelado",
    },
    {
      id: F.reversal,
      householdId: F.householdA,
      kind: "REVERSAL",
      status: "POSTED",
      origin: "SYSTEM",
      amountCents: BigInt(4000),
      occurredOn: "2026-08-28",
      description: "Reversal técnico",
      reversalOfEventId: F.cancelled,
    },
    {
      id: F.otherTenant,
      householdId: F.householdB,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(5000),
      occurredOn: "2026-08-30",
      description: "Outro household",
    },
  ]);
  await database.insert(accountEntries).values([
    {
      id: F.entryManualPending,
      financialEventId: F.manualPending,
      accountId: F.accountA,
      householdId: F.householdA,
      amountCents: BigInt(-1000),
      status: "POSTED",
      postedOn: "2026-08-30",
    },
    {
      id: F.entryManualOrganized,
      financialEventId: F.manualOrganized,
      accountId: F.accountA,
      householdId: F.householdA,
      amountCents: BigInt(-2000),
      status: "POSTED",
      postedOn: "2026-08-30",
    },
    {
      id: F.entryImportedPending,
      financialEventId: F.importedPending,
      accountId: F.accountA,
      householdId: F.householdA,
      amountCents: BigInt(-3000),
      status: "POSTED",
      postedOn: "2026-08-29",
    },
    {
      id: F.entryCancelled,
      financialEventId: F.cancelled,
      accountId: F.accountA,
      householdId: F.householdA,
      amountCents: BigInt(-4000),
      status: "POSTED",
      postedOn: "2026-08-28",
    },
    {
      id: F.entryOtherTenant,
      financialEventId: F.otherTenant,
      accountId: F.accountB,
      householdId: F.householdB,
      amountCents: BigInt(-5000),
      status: "POSTED",
      postedOn: "2026-08-30",
    },
  ]);
  await database.insert(transactionImportItems).values({
    id: F.itemImportedPending,
    householdId: F.householdA,
    importId: F.importA,
    rowNumber: 2,
    externalId: "ext_%_2",
    financialEventId: F.importedPending,
  });
}

integration("T04 review reads PostgreSQL", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar T04_INTEGRATION=1.",
      );
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = dbOrThrow(database);
    await cleanup(db);
    await seed(db);
  });

  afterAll(async () => {
    if (database) {
      await cleanup(database);
    }
    await closeDb();
  });

  it("lists both origins, derives review state and excludes reversals/other tenants", async () => {
    const result = await listReviewableTransactionsForContext(
      dbOrThrow(database),
      contextA,
    );

    expect(result.items).toHaveLength(4);
    expect(result.items.map((item) => item.id)).toEqual([
      F.manualOrganized,
      F.manualPending,
      F.importedPending,
      F.cancelled,
    ]);
    expect(result.items.map((item) => item.origin)).toEqual([
      "MANUAL",
      "MANUAL",
      "IMPORT",
      "MANUAL",
    ]);
    expect(result.items[0]?.reviewState).toBe("ORGANIZED");
    expect(result.items[1]?.reviewState).toBe("NEEDS_REVIEW");
    expect(result.items[2]?.source).toEqual({
      origin: "IMPORT",
      import: {
        importId: F.importA,
        rowNumber: 2,
        externalId: "ext_%_2",
      },
    });
    expect(result.items[3]?.reviewState).toBe("NOT_APPLICABLE");
    expect(result.items[3]?.entry.amountCents).toBe("-4000");
    expect(result.pageInfo).toEqual({ hasNextPage: false, nextCursor: null });
  });

  it("combines filters, treats search wildcards literally and validates resources in the tenant", async () => {
    const db = dbOrThrow(database);
    const filtered = await listReviewableTransactionsForContext(db, contextA, {
      categoryId: null,
      origin: "IMPORT",
      review: "NEEDS_REVIEW",
      search: " _ importada",
    });
    expect(filtered.items.map((item) => item.id)).toEqual([F.importedPending]);

    await expect(
      listReviewableTransactionsForContext(db, contextA, {
        accountId: F.accountB,
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
    await expect(
      listReviewableTransactionsForContext(db, contextA, {
        categoryId: F.categoryB,
      }),
    ).rejects.toMatchObject({ code: "CATEGORY_NOT_FOUND" });
  });

  it("continues by keyset and rejects a cursor reused with different filters", async () => {
    const db = dbOrThrow(database);
    const first = await listReviewableTransactionsForContext(db, contextA, {
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.pageInfo.hasNextPage).toBe(true);
    expect(first.pageInfo.nextCursor).toEqual(expect.any(String));

    const second = await listReviewableTransactionsForContext(db, contextA, {
      limit: 2,
      cursor: first.pageInfo.nextCursor ?? undefined,
    });
    expect(second.items.map((item) => item.id)).toEqual([
      F.importedPending,
      F.cancelled,
    ]);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(4);

    await expect(
      listReviewableTransactionsForContext(db, contextA, {
        limit: 1,
        cursor: first.pageInfo.nextCursor ?? undefined,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });

  it("returns an opaque cross-tenant detail error and keeps import lineage in detail", async () => {
    const db = dbOrThrow(database);
    const imported = await findReviewableTransactionForContext(
      db,
      contextA,
      F.importedPending,
    );
    expect(imported?.source).toEqual({
      origin: "IMPORT",
      import: {
        importId: F.importA,
        rowNumber: 2,
        externalId: "ext_%_2",
      },
    });
    expect(imported?.reversal).toBeNull();
    expect(
      await findReviewableTransactionForContext(db, contextA, F.otherTenant),
    ).toBeUndefined();
    expect(
      await findReviewableTransactionForContext(db, contextA, F.reversal),
    ).toBeUndefined();
  });

  it("counts the same pending projection as the list and excludes cancelled rows", async () => {
    const db = dbOrThrow(database);
    await expect(
      getTransactionReviewSummaryForContext(db, contextA),
    ).resolves.toEqual({ needsReviewCount: 2 });
    await expect(
      getTransactionReviewSummaryForContext(db, contextA, {
        origin: "IMPORT",
      }),
    ).resolves.toEqual({ needsReviewCount: 1 });
    await expect(
      getTransactionReviewSummaryForContext(db, contextA, {
        status: "CANCELLED",
      }),
    ).resolves.toEqual({ needsReviewCount: 0 });
  });

  it("fails closed when an imported event has no valid lineage", async () => {
    const db = dbOrThrow(database);
    await db.insert(financialEvents).values({
      id: F.invalidImport,
      householdId: F.householdA,
      kind: "INCOME",
      status: "POSTED",
      origin: "IMPORT",
      amountCents: BigInt(6000),
      occurredOn: "2026-08-27",
      description: "invalid lineage",
    });
    await db.insert(accountEntries).values({
      id: F.invalidImportEntry,
      financialEventId: F.invalidImport,
      accountId: F.accountA,
      householdId: F.householdA,
      amountCents: BigInt(6000),
      status: "POSTED",
      postedOn: "2026-08-27",
    });

    await expect(
      listReviewableTransactionsForContext(db, contextA, { origin: "IMPORT" }),
    ).rejects.toMatchObject({ code: "IMPORT_LINEAGE_INVALID" });
    await expect(
      getTransactionReviewSummaryForContext(db, contextA, {
        origin: "IMPORT",
      }),
    ).rejects.toMatchObject({ code: "IMPORT_LINEAGE_INVALID" });
  });
});
