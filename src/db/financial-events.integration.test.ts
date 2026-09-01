import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations, getMigrationStatus } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  categories,
  financialEvents,
  householdMembers,
  households,
  user,
} from "@/db/schema";

/**
 * T03 is opt-in because the suite intentionally exercises a real PostgreSQL
 * schema. Use it with the disposable database from docker-compose.test.yml.
 */
const integration =
  process.env.T03_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  users: {
    a: "00000000-0000-7000-8000-000000031101",
    b: "00000000-0000-7000-8000-000000031102",
  },
  households: {
    a: "00000000-0000-7000-8000-000000032101",
    b: "00000000-0000-7000-8000-000000032102",
  },
  accounts: {
    a: "00000000-0000-7000-8000-000000033101",
    b: "00000000-0000-7000-8000-000000033102",
  },
  categories: {
    a: "00000000-0000-7000-8000-000000034101",
    b: "00000000-0000-7000-8000-000000034102",
  },
  events: {
    a: "00000000-0000-7000-8000-000000035101",
    reversalA: "00000000-0000-7000-8000-000000035102",
    invalid: "00000000-0000-7000-8000-000000035103",
  },
  entries: {
    a: "00000000-0000-7000-8000-000000036101",
    reversalA: "00000000-0000-7000-8000-000000036102",
    invalid: "00000000-0000-7000-8000-000000036103",
  },
} as const;

const householdIds = [FIXTURES.households.a, FIXTURES.households.b] as const;
const EVENT_CENTS = BigInt("1234");
const EXPENSE_ENTRY_CENTS = BigInt("-1234");
const ZERO_CENTS = BigInt("0");

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T03 não foi inicializado.");
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
  if (typeof candidate.cause?.code === "string") {
    return candidate.cause.code;
  }
  return undefined;
}

async function cleanupT03(database: Database): Promise<void> {
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

async function seedT03(database: Database): Promise<void> {
  await database.insert(user).values([
    {
      id: FIXTURES.users.a,
      name: "T03 Owner A",
      email: "t03-owner-a@example.test",
    },
    {
      id: FIXTURES.users.b,
      name: "T03 Owner B",
      email: "t03-owner-b@example.test",
    },
  ]);
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T03 Household A" },
    { id: FIXTURES.households.b, name: "T03 Household B" },
  ]);
  await database.insert(householdMembers).values([
    { householdId: FIXTURES.households.a, userId: FIXTURES.users.a },
    { householdId: FIXTURES.households.b, userId: FIXTURES.users.b },
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
      id: FIXTURES.categories.a,
      householdId: FIXTURES.households.a,
      name: "T03 Expense A",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.b,
      householdId: FIXTURES.households.b,
      name: "T03 Expense B",
      kind: "EXPENSE",
    },
  ]);
}

integration("T03 financial event and account entry PostgreSQL schema", () => {
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

  it("applies the migration and exposes tenant-safe ledger indexes", async () => {
    const db = databaseOrThrow(database);
    const status = await getMigrationStatus();
    expect(status).toMatchObject({ pending: 0, drifted: 0 });

    const tables = await db.execute<{ tablename: string }>(sql`
      select tablename
        from pg_catalog.pg_tables
       where schemaname = 'public'
         and tablename in ('account_entries', 'financial_events')
       order by tablename
    `);
    expect(tables.rows.map(({ tablename }) => tablename)).toEqual([
      "account_entries",
      "financial_events",
    ]);

    const indexes = await db.execute<{ indexname: string }>(sql`
      select indexname
        from pg_catalog.pg_indexes
       where schemaname = 'public'
         and tablename in ('account_entries', 'financial_events')
         and indexname in (
           'account_entries_household_account_posted_on_idx',
           'financial_events_household_occurred_on_idx',
           'financial_events_household_category_occurred_on_idx',
           'financial_events_reversal_of_event_uq'
         )
       order by indexname
    `);
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
      "account_entries_household_account_posted_on_idx",
      "financial_events_household_category_occurred_on_idx",
      "financial_events_household_occurred_on_idx",
      "financial_events_reversal_of_event_uq",
    ]);
  });

  it("persists an absolute event and signed entry for the same household", async () => {
    const db = databaseOrThrow(database);
    await db.insert(financialEvents).values({
      id: FIXTURES.events.a,
      householdId: FIXTURES.households.a,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: EVENT_CENTS,
      occurredOn: "2026-08-29",
      description: "T03 lunch",
      categoryId: FIXTURES.categories.a,
    });
    await db.insert(accountEntries).values({
      id: FIXTURES.entries.a,
      financialEventId: FIXTURES.events.a,
      accountId: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      amountCents: EXPENSE_ENTRY_CENTS,
      status: "POSTED",
      postedOn: "2026-08-29",
    });

    const persisted = await db
      .select({
        amountCents: financialEvents.amountCents,
        entryAmountCents: accountEntries.amountCents,
      })
      .from(financialEvents)
      .innerJoin(
        accountEntries,
        and(
          eq(accountEntries.financialEventId, financialEvents.id),
          eq(accountEntries.householdId, financialEvents.householdId),
        ),
      )
      .where(eq(financialEvents.id, FIXTURES.events.a));

    expect(persisted).toEqual([
      { amountCents: EVENT_CENTS, entryAmountCents: EXPENSE_ENTRY_CENTS },
    ]);
  });

  it("rejects zero amounts and all cross-tenant composite references", async () => {
    const db = databaseOrThrow(database);
    const zeroEvent = db.insert(financialEvents).values({
      id: FIXTURES.events.invalid,
      householdId: FIXTURES.households.a,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: ZERO_CENTS,
      occurredOn: "2026-08-29",
      description: "invalid",
    });
    await expect(zeroEvent).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );

    await db.insert(financialEvents).values({
      id: FIXTURES.events.a,
      householdId: FIXTURES.households.a,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: EVENT_CENTS,
      occurredOn: "2026-08-29",
      description: "valid",
    });

    await expect(
      db.insert(accountEntries).values({
        id: FIXTURES.entries.invalid,
        financialEventId: FIXTURES.events.a,
        accountId: FIXTURES.accounts.b,
        householdId: FIXTURES.households.a,
        amountCents: EXPENSE_ENTRY_CENTS,
        status: "POSTED",
        postedOn: "2026-08-29",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );

    await expect(
      db.insert(financialEvents).values({
        id: FIXTURES.events.invalid,
        householdId: FIXTURES.households.a,
        kind: "EXPENSE",
        status: "POSTED",
        origin: "MANUAL",
        amountCents: EVENT_CENTS,
        occurredOn: "2026-08-29",
        description: "cross tenant category",
        categoryId: FIXTURES.categories.b,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );
  });

  it("keeps reversal history unique and blocks deletion of referenced events", async () => {
    const db = databaseOrThrow(database);
    await db.insert(financialEvents).values({
      id: FIXTURES.events.a,
      householdId: FIXTURES.households.a,
      kind: "EXPENSE",
      status: "CANCELLED",
      origin: "MANUAL",
      amountCents: EVENT_CENTS,
      occurredOn: "2026-08-29",
      description: "original",
    });
    await db.insert(accountEntries).values({
      id: FIXTURES.entries.a,
      financialEventId: FIXTURES.events.a,
      accountId: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      amountCents: EXPENSE_ENTRY_CENTS,
      status: "POSTED",
      postedOn: "2026-08-29",
    });
    await db.insert(financialEvents).values({
      id: FIXTURES.events.reversalA,
      householdId: FIXTURES.households.a,
      kind: "REVERSAL",
      status: "POSTED",
      origin: "SYSTEM",
      amountCents: EVENT_CENTS,
      occurredOn: "2026-08-29",
      description: "reversal",
      reversalOfEventId: FIXTURES.events.a,
    });

    await expect(
      db.insert(financialEvents).values({
        id: FIXTURES.events.invalid,
        householdId: FIXTURES.households.a,
        kind: "REVERSAL",
        status: "POSTED",
        origin: "SYSTEM",
        amountCents: EVENT_CENTS,
        occurredOn: "2026-08-29",
        description: "duplicate reversal",
        reversalOfEventId: FIXTURES.events.a,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23505",
    );

    await expect(
      db.delete(financialEvents).where(eq(financialEvents.id, FIXTURES.events.a)),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );
  });
});
