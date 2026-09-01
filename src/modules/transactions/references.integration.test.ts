import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  accountEntries,
  applicationCommands,
  accounts,
  categories,
  financialEvents,
  householdMembers,
  households,
  user,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";

import {
  findAccountEntryForContext,
  findAccountForContext,
  findCategoryForContext,
  findFinancialEventForContext,
  getAccountForContext,
  getCategoryForContext,
  getFinancialEventForContext,
  insertAccountEntryForContext,
  insertFinancialEventForContext,
  validateManualTransactionReferencesForContext,
  type AccountEntryInsertValues,
  type FinancialEventInsertValues,
} from "./references";

/** T04 is opt-in because it deliberately exercises a real PostgreSQL DB. */
const integration =
  process.env.T04_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  users: {
    a: "00000000-0000-7000-8000-000000041101",
    b: "00000000-0000-7000-8000-000000041102",
  },
  households: {
    a: "00000000-0000-7000-8000-000000042101",
    b: "00000000-0000-7000-8000-000000042102",
  },
  accounts: {
    a: "00000000-0000-7000-8000-000000043101",
    b: "00000000-0000-7000-8000-000000043102",
    archivedA: "00000000-0000-7000-8000-000000043103",
  },
  categories: {
    expenseA: "00000000-0000-7000-8000-000000044101",
    incomeA: "00000000-0000-7000-8000-000000044102",
    archivedA: "00000000-0000-7000-8000-000000044103",
    expenseB: "00000000-0000-7000-8000-000000044104",
  },
  events: {
    a: "00000000-0000-7000-8000-000000045101",
    b: "00000000-0000-7000-8000-000000045102",
    helper: "00000000-0000-7000-8000-000000045103",
  },
  entries: {
    a: "00000000-0000-7000-8000-000000046101",
    b: "00000000-0000-7000-8000-000000046102",
    helper: "00000000-0000-7000-8000-000000046103",
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
    throw new Error("O banco de integração T04 não foi inicializado.");
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

async function cleanupT04(database: Database): Promise<void> {
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

async function seedT04(database: Database): Promise<void> {
  await database.insert(user).values([
    {
      id: FIXTURES.users.a,
      name: "T04 Owner A",
      email: "t04-owner-a@example.test",
    },
    {
      id: FIXTURES.users.b,
      name: "T04 Owner B",
      email: "t04-owner-b@example.test",
    },
  ]);
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T04 Household A" },
    { id: FIXTURES.households.b, name: "T04 Household B" },
  ]);
  await database.insert(householdMembers).values([
    { householdId: contextA.householdId, userId: contextA.userId },
    { householdId: contextB.householdId, userId: contextB.userId },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accounts.a,
      householdId: contextA.householdId,
      name: "T04 Account A",
      type: "CHECKING",
      trackingStartedOn: "2026-08-20",
    },
    {
      id: FIXTURES.accounts.b,
      householdId: contextB.householdId,
      name: "T04 Account B",
      type: "CHECKING",
    },
    {
      id: FIXTURES.accounts.archivedA,
      householdId: contextA.householdId,
      name: "T04 Archived Account A",
      type: "CHECKING",
      status: "ARCHIVED",
    },
  ]);
  await database.insert(categories).values([
    {
      id: FIXTURES.categories.expenseA,
      householdId: contextA.householdId,
      name: "T04 Expense A",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.incomeA,
      householdId: contextA.householdId,
      name: "T04 Income A",
      kind: "INCOME",
    },
    {
      id: FIXTURES.categories.archivedA,
      householdId: contextA.householdId,
      name: "T04 Archived Expense A",
      kind: "EXPENSE",
      status: "ARCHIVED",
    },
    {
      id: FIXTURES.categories.expenseB,
      householdId: contextB.householdId,
      name: "T04 Expense B",
      kind: "EXPENSE",
    },
  ]);
  await database.insert(financialEvents).values([
    {
      id: FIXTURES.events.a,
      householdId: contextA.householdId,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt("1250"),
      occurredOn: "2026-08-29",
      description: "T04 event A",
      categoryId: FIXTURES.categories.expenseA,
    },
    {
      id: FIXTURES.events.b,
      householdId: contextB.householdId,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt("1250"),
      occurredOn: "2026-08-29",
      description: "T04 event B",
      categoryId: FIXTURES.categories.expenseB,
    },
  ]);
  await database.insert(accountEntries).values([
    {
      id: FIXTURES.entries.a,
      financialEventId: FIXTURES.events.a,
      accountId: FIXTURES.accounts.a,
      householdId: contextA.householdId,
      amountCents: BigInt("-1250"),
      status: "POSTED",
      postedOn: "2026-08-29",
    },
    {
      id: FIXTURES.entries.b,
      financialEventId: FIXTURES.events.b,
      accountId: FIXTURES.accounts.b,
      householdId: contextB.householdId,
      amountCents: BigInt("-1250"),
      status: "POSTED",
      postedOn: "2026-08-29",
    },
  ]);
}

integration("T04 tenant-scoped transaction references", () => {
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
    const db = databaseOrThrow(database);
    await cleanupT04(db);
    await seedT04(db);
  });

  afterAll(async () => {
    if (database) {
      await cleanupT04(database);
    }
    await closeDb();
  });

  it("hides cross-tenant IDs for account, category, event and entry reads", async () => {
    const db = databaseOrThrow(database);

    await expect(
      findAccountForContext(db, contextA, FIXTURES.accounts.a),
    ).resolves.toMatchObject({ householdId: contextA.householdId });
    await expect(
      findAccountForContext(db, contextA, FIXTURES.accounts.b),
    ).resolves.toBeUndefined();
    await expect(
      getAccountForContext(db, contextA, FIXTURES.accounts.b),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND", status: 404 });

    await expect(
      findCategoryForContext(db, contextA, FIXTURES.categories.expenseB),
    ).resolves.toBeUndefined();
    await expect(
      getCategoryForContext(db, contextA, FIXTURES.categories.expenseB),
    ).rejects.toMatchObject({ code: "CATEGORY_NOT_FOUND", status: 404 });

    await expect(
      findFinancialEventForContext(db, contextA, FIXTURES.events.b),
    ).resolves.toBeUndefined();
    await expect(
      getFinancialEventForContext(db, contextA, FIXTURES.events.b),
    ).rejects.toMatchObject({ code: "EVENT_NOT_FOUND", status: 404 });

    await expect(
      findAccountEntryForContext(db, contextA, FIXTURES.entries.b),
    ).resolves.toBeUndefined();
  });

  it("revalidates active state, kind and tracking_started_on before writes", async () => {
    const db = databaseOrThrow(database);
    const valid = await validateManualTransactionReferencesForContext(
      db,
      contextA,
      {
        accountId: FIXTURES.accounts.a,
        categoryId: FIXTURES.categories.expenseA,
        occurredOn: "2026-08-29",
        kind: "EXPENSE",
      },
    );
    expect(valid).toMatchObject({
      account: { id: FIXTURES.accounts.a, status: "ACTIVE" },
      category: { id: FIXTURES.categories.expenseA, kind: "EXPENSE" },
    });
    expect(valid.occurredOn.toString()).toBe("2026-08-29");

    await expect(
      validateManualTransactionReferencesForContext(db, contextA, {
        accountId: FIXTURES.accounts.a,
        categoryId: null,
        occurredOn: "2026-08-19",
        kind: "EXPENSE",
      }),
    ).rejects.toMatchObject({
      code: "TRACKING_START_DATE_VIOLATION",
      field: "occurredOn",
    });
    await expect(
      validateManualTransactionReferencesForContext(db, contextA, {
        accountId: FIXTURES.accounts.archivedA,
        occurredOn: "2026-08-29",
        kind: "EXPENSE",
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_ARCHIVED", field: "accountId" });
    await expect(
      validateManualTransactionReferencesForContext(db, contextA, {
        accountId: FIXTURES.accounts.a,
        categoryId: FIXTURES.categories.archivedA,
        occurredOn: "2026-08-29",
        kind: "EXPENSE",
      }),
    ).rejects.toMatchObject({
      code: "RESOURCE_ARCHIVED",
      field: "categoryId",
    });
    await expect(
      validateManualTransactionReferencesForContext(db, contextA, {
        accountId: FIXTURES.accounts.a,
        categoryId: FIXTURES.categories.incomeA,
        occurredOn: "2026-08-29",
        kind: "EXPENSE",
      }),
    ).rejects.toMatchObject({
      code: "CATEGORY_KIND_MISMATCH",
      field: "categoryId",
    });
    await expect(
      validateManualTransactionReferencesForContext(db, contextA, {
        accountId: FIXTURES.accounts.a,
        categoryId: FIXTURES.categories.expenseB,
        occurredOn: "2026-08-29",
        kind: "EXPENSE",
      }),
    ).rejects.toMatchObject({ code: "CATEGORY_NOT_FOUND", field: "categoryId" });

    const [commandsBefore, eventsBefore, entriesBefore] = await Promise.all([
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
    expect(commandsBefore).toHaveLength(0);
    expect(eventsBefore).toHaveLength(1);
    expect(entriesBefore).toHaveLength(1);
  });

  it("derives tenant on event/entry inserts and rejects forged cross-tenant references", async () => {
    const db = databaseOrThrow(database);
    const forgedEvent = {
      id: FIXTURES.events.helper,
      householdId: contextB.householdId,
      kind: "EXPENSE" as const,
      status: "POSTED" as const,
      origin: "MANUAL" as const,
      amountCents: BigInt("300"),
      occurredOn: "2026-08-29",
      description: "T04 server context event",
      categoryId: FIXTURES.categories.expenseA,
    } as FinancialEventInsertValues;
    const event = await insertFinancialEventForContext(db, contextA, forgedEvent);
    expect(event.householdId).toBe(contextA.householdId);

    const forgedEntry = {
      id: FIXTURES.entries.helper,
      financialEventId: event.id,
      accountId: FIXTURES.accounts.a,
      householdId: contextB.householdId,
      amountCents: BigInt("-300"),
      status: "POSTED" as const,
      postedOn: "2026-08-29",
    } as AccountEntryInsertValues;
    const entry = await insertAccountEntryForContext(db, contextA, forgedEntry);
    expect(entry.householdId).toBe(contextA.householdId);

    await expect(
      insertFinancialEventForContext(db, contextA, {
        ...forgedEvent,
        id: "00000000-0000-7000-8000-000000045104",
        categoryId: FIXTURES.categories.expenseB,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );
    await expect(
      insertAccountEntryForContext(db, contextA, {
        ...forgedEntry,
        id: "00000000-0000-7000-8000-000000046104",
        financialEventId: event.id,
        accountId: FIXTURES.accounts.b,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );

    const persisted = await db
      .select({
        eventHouseholdId: financialEvents.householdId,
        entryHouseholdId: accountEntries.householdId,
      })
      .from(financialEvents)
      .innerJoin(
        accountEntries,
        and(
          eq(accountEntries.financialEventId, financialEvents.id),
          eq(accountEntries.householdId, financialEvents.householdId),
        ),
      )
      .where(eq(financialEvents.id, event.id));
    expect(persisted).toEqual([
      {
        eventHouseholdId: contextA.householdId,
        entryHouseholdId: contextA.householdId,
      },
    ]);
  });
});
