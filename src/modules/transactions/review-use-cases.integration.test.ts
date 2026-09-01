import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { eq, inArray } from "drizzle-orm";

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
  transactionImportItems,
  transactionImports,
  user,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";

import {
  REVIEWABLE_TRANSACTION_UPDATE_OPERATION,
} from "./review-contracts";
import { createReviewableTransactionUseCases } from "./review-use-cases";

/** Review-write integration is opt-in and runs against disposable PostgreSQL. */
const integration =
  process.env.T05_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  users: {
    a: "00000000-0000-7000-8000-000000055101",
    b: "00000000-0000-7000-8000-000000055102",
  },
  households: {
    a: "00000000-0000-7000-8000-000000056101",
    b: "00000000-0000-7000-8000-000000056102",
  },
  accounts: {
    a: "00000000-0000-7000-8000-000000057101",
    b: "00000000-0000-7000-8000-000000057102",
  },
  categories: {
    expenseA: "00000000-0000-7000-8000-000000058101",
    incomeA: "00000000-0000-7000-8000-000000058102",
    archivedA: "00000000-0000-7000-8000-000000058103",
    expenseB: "00000000-0000-7000-8000-000000058104",
  },
  imports: {
    a: "00000000-0000-7000-8000-000000059101",
  },
  events: {
    imported: "00000000-0000-7000-8000-00000005a101",
    manual: "00000000-0000-7000-8000-00000005a102",
    cancelled: "00000000-0000-7000-8000-00000005a103",
    otherTenant: "00000000-0000-7000-8000-00000005a104",
  },
  entries: {
    imported: "00000000-0000-7000-8000-00000005b101",
    manual: "00000000-0000-7000-8000-00000005b102",
    cancelled: "00000000-0000-7000-8000-00000005b103",
    otherTenant: "00000000-0000-7000-8000-00000005b104",
  },
  items: {
    imported: "00000000-0000-7000-8000-00000005c101",
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
    throw new Error("O banco de integração T05 review não foi inicializado.");
  }
  return database;
}

async function cleanup(database: Database): Promise<void> {
  await database
    .delete(transactionImportItems)
    .where(inArray(transactionImportItems.householdId, householdIds));
  await database
    .delete(transactionImports)
    .where(inArray(transactionImports.householdId, householdIds));
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

async function seed(database: Database): Promise<void> {
  await database.insert(user).values([
    {
      id: FIXTURES.users.a,
      name: "T05 Review Owner A",
      email: "t05-review-owner-a@example.test",
    },
    {
      id: FIXTURES.users.b,
      name: "T05 Review Owner B",
      email: "t05-review-owner-b@example.test",
    },
  ]);
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T05 Review Household A" },
    { id: FIXTURES.households.b, name: "T05 Review Household B" },
  ]);
  await database.insert(householdMembers).values([
    { householdId: contextA.householdId, userId: contextA.userId },
    { householdId: contextB.householdId, userId: contextB.userId },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accounts.a,
      householdId: contextA.householdId,
      name: "T05 Review Account A",
      type: "CHECKING",
      trackingStartedOn: "2026-08-01",
    },
    {
      id: FIXTURES.accounts.b,
      householdId: contextB.householdId,
      name: "T05 Review Account B",
      type: "CHECKING",
    },
  ]);
  await database.insert(categories).values([
    {
      id: FIXTURES.categories.expenseA,
      householdId: contextA.householdId,
      name: "T05 Review Expense",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.incomeA,
      householdId: contextA.householdId,
      name: "T05 Review Income",
      kind: "INCOME",
    },
    {
      id: FIXTURES.categories.archivedA,
      householdId: contextA.householdId,
      name: "T05 Review Archived",
      kind: "EXPENSE",
      status: "ARCHIVED",
    },
    {
      id: FIXTURES.categories.expenseB,
      householdId: contextB.householdId,
      name: "T05 Review Other Tenant",
      kind: "EXPENSE",
    },
  ]);

  const createdAt = new Date("2026-08-30T10:00:00.000Z");
  await database.insert(transactionImports).values({
    id: FIXTURES.imports.a,
    householdId: contextA.householdId,
    accountId: FIXTURES.accounts.a,
    initiatedByUserId: contextA.userId,
    formatVersion: "s04-csv-v1",
    datasetFingerprint: "a".repeat(64),
    sourceFileSizeBytes: 100,
    sourceHasBom: false,
    sourceColumns: "BASE",
    processedRows: 1,
    validRows: 1,
    invalidRows: 0,
    ignoredDuplicateRows: 0,
    importedRows: 1,
    errors: [],
    status: "CONFIRMED",
    createdAt,
    confirmedAt: createdAt,
  });
  await database.insert(financialEvents).values([
    {
      id: FIXTURES.events.imported,
      householdId: contextA.householdId,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "IMPORT",
      amountCents: BigInt("1234"),
      occurredOn: "2026-08-29",
      description: "Importado original",
      categoryId: null,
      reversalOfEventId: null,
    },
    {
      id: FIXTURES.events.manual,
      householdId: contextA.householdId,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt("2222"),
      occurredOn: "2026-08-29",
      description: "Manual original",
      categoryId: null,
      reversalOfEventId: null,
    },
    {
      id: FIXTURES.events.cancelled,
      householdId: contextA.householdId,
      kind: "EXPENSE",
      status: "CANCELLED",
      origin: "MANUAL",
      amountCents: BigInt("3333"),
      occurredOn: "2026-08-29",
      description: "Cancelado",
      categoryId: null,
      reversalOfEventId: null,
    },
    {
      id: FIXTURES.events.otherTenant,
      householdId: contextB.householdId,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "IMPORT",
      amountCents: BigInt("4444"),
      occurredOn: "2026-08-29",
      description: "Outro tenant",
      categoryId: null,
      reversalOfEventId: null,
    },
  ]);
  await database.insert(accountEntries).values([
    {
      id: FIXTURES.entries.imported,
      financialEventId: FIXTURES.events.imported,
      accountId: FIXTURES.accounts.a,
      householdId: contextA.householdId,
      amountCents: BigInt("-1234"),
      status: "POSTED",
      expectedOn: null,
      postedOn: "2026-08-29",
    },
    {
      id: FIXTURES.entries.manual,
      financialEventId: FIXTURES.events.manual,
      accountId: FIXTURES.accounts.a,
      householdId: contextA.householdId,
      amountCents: BigInt("-2222"),
      status: "POSTED",
      expectedOn: null,
      postedOn: "2026-08-29",
    },
    {
      id: FIXTURES.entries.cancelled,
      financialEventId: FIXTURES.events.cancelled,
      accountId: FIXTURES.accounts.a,
      householdId: contextA.householdId,
      amountCents: BigInt("-3333"),
      status: "POSTED",
      expectedOn: null,
      postedOn: "2026-08-29",
    },
    {
      id: FIXTURES.entries.otherTenant,
      financialEventId: FIXTURES.events.otherTenant,
      accountId: FIXTURES.accounts.b,
      householdId: contextB.householdId,
      amountCents: BigInt("-4444"),
      status: "POSTED",
      expectedOn: null,
      postedOn: "2026-08-29",
    },
  ]);
  await database.insert(transactionImportItems).values({
    id: FIXTURES.items.imported,
    householdId: contextA.householdId,
    importId: FIXTURES.imports.a,
    rowNumber: 2,
    externalId: "external-001",
    financialEventId: FIXTURES.events.imported,
  });
}

integration("T05 review update PostgreSQL boundary", () => {
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
    await cleanup(db);
    await seed(db);
  });

  afterAll(async () => {
    if (database) {
      await cleanup(database);
    }
    await closeDb();
  });

  it("updates imported metadata without changing ledger or lineage", async () => {
    const db = databaseOrThrow(database);
    const useCases = createReviewableTransactionUseCases({
      database: db,
      now: () => new Date("2026-08-30T12:00:00.000Z"),
    });

    const result = await useCases.updateReviewableTransaction(contextA, {
      commandId: "t05-review-import-update-001",
      financialEventId: FIXTURES.events.imported,
      description: "Importado revisado",
      categoryId: FIXTURES.categories.expenseA,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: FIXTURES.events.imported,
        origin: "IMPORT",
        categoryId: FIXTURES.categories.expenseA,
        source: {
          origin: "IMPORT",
          import: {
            importId: FIXTURES.imports.a,
            rowNumber: 2,
            externalId: "external-001",
          },
        },
        reviewState: "ORGANIZED",
      },
    });

    const [event, entry, lineage, command] = await Promise.all([
      db
        .select()
        .from(financialEvents)
        .where(eq(financialEvents.id, FIXTURES.events.imported)),
      db
        .select()
        .from(accountEntries)
        .where(eq(accountEntries.id, FIXTURES.entries.imported)),
      db
        .select()
        .from(transactionImportItems)
        .where(eq(transactionImportItems.id, FIXTURES.items.imported)),
      db
        .select()
        .from(applicationCommands)
        .where(eq(applicationCommands.commandId, "t05-review-import-update-001")),
    ]);
    expect(event[0]).toMatchObject({
      id: FIXTURES.events.imported,
      description: "Importado revisado",
      categoryId: FIXTURES.categories.expenseA,
      origin: "IMPORT",
      amountCents: BigInt("1234"),
    });
    expect(entry[0]).toMatchObject({
      id: FIXTURES.entries.imported,
      financialEventId: FIXTURES.events.imported,
      amountCents: BigInt("-1234"),
    });
    expect(lineage[0]).toMatchObject({
      importId: FIXTURES.imports.a,
      rowNumber: 2,
      externalId: "external-001",
    });
    expect(command[0]).toMatchObject({
      operation: REVIEWABLE_TRANSACTION_UPDATE_OPERATION,
      resourceId: FIXTURES.events.imported,
    });
  });

  it("accepts category null and returns NEEDS_REVIEW without financial changes", async () => {
    const db = databaseOrThrow(database);
    const useCases = createReviewableTransactionUseCases({
      database: db,
      now: () => new Date("2026-08-30T12:01:00.000Z"),
    });

    await useCases.updateReviewableTransaction(contextA, {
      commandId: "t05-review-null-001",
      financialEventId: FIXTURES.events.imported,
      categoryId: FIXTURES.categories.expenseA,
    });
    const result = await useCases.updateReviewableTransaction(contextA, {
      commandId: "t05-review-null-002",
      financialEventId: FIXTURES.events.imported,
      categoryId: null,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        categoryId: null,
        reviewState: "NEEDS_REVIEW",
        reviewReason: "UNCATEGORIZED",
        needsReview: true,
      },
    });
    const event = await db
      .select()
      .from(financialEvents)
      .where(eq(financialEvents.id, FIXTURES.events.imported));
    expect(event[0]).toMatchObject({
      amountCents: BigInt("1234"),
      occurredOn: "2026-08-29",
      origin: "IMPORT",
      status: "POSTED",
      categoryId: null,
    });
  });

  it("rolls back command reservation on archived/type-mismatched/cross-tenant failures", async () => {
    const db = databaseOrThrow(database);
    const useCases = createReviewableTransactionUseCases({ database: db });

    const archived = await useCases.updateReviewableTransaction(contextA, {
      commandId: "t05-review-archived-001",
      financialEventId: FIXTURES.events.imported,
      categoryId: FIXTURES.categories.archivedA,
    });
    const mismatch = await useCases.updateReviewableTransaction(contextA, {
      commandId: "t05-review-mismatch-001",
      financialEventId: FIXTURES.events.imported,
      categoryId: FIXTURES.categories.incomeA,
    });
    const crossTenant = await useCases.updateReviewableTransaction(contextA, {
      commandId: "t05-review-cross-tenant-001",
      financialEventId: FIXTURES.events.otherTenant,
      categoryId: null,
    });

    expect(archived).toMatchObject({ ok: false, error: { code: "RESOURCE_ARCHIVED" } });
    expect(mismatch).toMatchObject({ ok: false, error: { code: "CATEGORY_KIND_MISMATCH" } });
    expect(crossTenant).toMatchObject({ ok: false, error: { code: "EVENT_NOT_FOUND" } });

    const commands = await db
      .select()
      .from(applicationCommands)
      .where(eq(applicationCommands.householdId, contextA.householdId));
    expect(commands).toHaveLength(0);
    const event = await db
      .select()
      .from(financialEvents)
      .where(eq(financialEvents.id, FIXTURES.events.imported));
    expect(event[0]).toMatchObject({
      description: "Importado original",
      categoryId: null,
      amountCents: BigInt("1234"),
    });
  });

  it("rejects cancelled events and preserves retry idempotency", async () => {
    const db = databaseOrThrow(database);
    const useCases = createReviewableTransactionUseCases({
      database: db,
      now: () => new Date("2026-08-30T12:02:00.000Z"),
    });

    const cancelled = await useCases.updateReviewableTransaction(contextA, {
      commandId: "t05-review-cancelled-001",
      financialEventId: FIXTURES.events.cancelled,
      categoryId: null,
    });
    expect(cancelled).toMatchObject({ ok: false, error: { code: "EVENT_NOT_REVIEWABLE" } });

    const command = {
      commandId: "t05-review-retry-001",
      financialEventId: FIXTURES.events.manual,
      description: "Manual revisado",
      categoryId: FIXTURES.categories.expenseA,
    };
    const first = await useCases.updateReviewableTransaction(contextA, command);
    const retry = await useCases.updateReviewableTransaction(contextA, command);
    const conflict = await useCases.updateReviewableTransaction(contextA, {
      ...command,
      description: "Outra intenção",
    });

    expect(first).toEqual(retry);
    expect(conflict).toMatchObject({ ok: false, error: { code: "COMMAND_ID_REUSED" } });
    const [events, entries, commands] = await Promise.all([
      db
        .select()
        .from(financialEvents)
        .where(eq(financialEvents.id, FIXTURES.events.manual)),
      db
        .select()
        .from(accountEntries)
        .where(eq(accountEntries.financialEventId, FIXTURES.events.manual)),
      db
        .select()
        .from(applicationCommands)
        .where(eq(applicationCommands.commandId, command.commandId)),
    ]);
    expect(events).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(commands).toHaveLength(1);
  });

  it("serializes concurrent retries on one tenant-scoped command", async () => {
    const db = databaseOrThrow(database);
    const useCases = createReviewableTransactionUseCases({
      database: db,
      now: () => new Date("2026-08-30T12:03:00.000Z"),
    });
    const command = {
      commandId: "t05-review-concurrent-001",
      financialEventId: FIXTURES.events.imported,
      description: "Importado concorrente",
      categoryId: FIXTURES.categories.expenseA,
    };

    const [first, second] = await Promise.all([
      useCases.updateReviewableTransaction(contextA, command),
      useCases.updateReviewableTransaction(contextA, command),
    ]);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      value: { description: "Importado concorrente" },
    });
    const [events, entries, commands] = await Promise.all([
      db
        .select()
        .from(financialEvents)
        .where(eq(financialEvents.id, FIXTURES.events.imported)),
      db
        .select()
        .from(accountEntries)
        .where(eq(accountEntries.financialEventId, FIXTURES.events.imported)),
      db
        .select()
        .from(applicationCommands)
        .where(eq(applicationCommands.commandId, command.commandId)),
    ]);
    expect(events).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(commands).toHaveLength(1);
  });
});
