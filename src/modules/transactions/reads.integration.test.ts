import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  categories,
  financialEvents,
  households,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";

import {
  getAccountBalanceForContext,
  getManualTransactionForContext,
  listAccountMovementsForContext,
  listManualTransactionsForContext,
} from "./reads";

/** Opt-in because this suite intentionally writes to a real PostgreSQL schema. */
const integration =
  process.env.T06_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  households: {
    a: "00000000-0000-7000-8000-000000061001",
    b: "00000000-0000-7000-8000-000000061002",
  },
  accounts: {
    a: "00000000-0000-7000-8000-000000061101",
    b: "00000000-0000-7000-8000-000000061102",
  },
  categories: {
    a: "00000000-0000-7000-8000-000000061201",
    b: "00000000-0000-7000-8000-000000061202",
  },
  events: {
    expense: "00000000-0000-7000-8000-000000061301",
    income: "00000000-0000-7000-8000-000000061302",
    cancelled: "00000000-0000-7000-8000-000000061303",
    reversal: "00000000-0000-7000-8000-000000061304",
    otherTenant: "00000000-0000-7000-8000-000000061305",
  },
  entries: {
    expense: "00000000-0000-7000-8000-000000061401",
    income: "00000000-0000-7000-8000-000000061402",
    cancelled: "00000000-0000-7000-8000-000000061403",
    reversal: "00000000-0000-7000-8000-000000061404",
    otherTenant: "00000000-0000-7000-8000-000000061405",
  },
} as const;

const householdIds = [
  FIXTURES.households.a,
  FIXTURES.households.b,
] as const;
const contextA: FinancialContext = {
  userId: "00000000-0000-7000-8000-000000061901",
  householdId: FIXTURES.households.a,
};
const contextB: FinancialContext = {
  userId: "00000000-0000-7000-8000-000000061902",
  householdId: FIXTURES.households.b,
};

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T06 não foi inicializado.");
  }
  return database;
}

async function cleanup(database: Database): Promise<void> {
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
  await database.delete(households).where(inArray(households.id, householdIds));
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T06 Household A" },
    { id: FIXTURES.households.b, name: "T06 Household B" },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      name: "T06 Checking A",
      type: "CHECKING",
    },
    {
      id: FIXTURES.accounts.b,
      householdId: FIXTURES.households.b,
      name: "T06 Checking B",
      type: "CHECKING",
    },
  ]);
  await database.insert(categories).values([
    {
      id: FIXTURES.categories.a,
      householdId: FIXTURES.households.a,
      name: "T06 Expense A",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.b,
      householdId: FIXTURES.households.b,
      name: "T06 Expense B",
      kind: "EXPENSE",
    },
  ]);
  await database.insert(financialEvents).values([
    {
      id: FIXTURES.events.expense,
      householdId: FIXTURES.households.a,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt("1250"),
      occurredOn: "2026-08-29",
      description: "T06 expense",
      categoryId: FIXTURES.categories.a,
    },
    {
      id: FIXTURES.events.income,
      householdId: FIXTURES.households.a,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt("3000"),
      occurredOn: "2026-08-29",
      description: "T06 income",
      categoryId: null,
    },
    {
      id: FIXTURES.events.cancelled,
      householdId: FIXTURES.households.a,
      kind: "EXPENSE",
      status: "CANCELLED",
      origin: "MANUAL",
      amountCents: BigInt("500"),
      occurredOn: "2026-08-28",
      description: "T06 cancelled expense",
      categoryId: FIXTURES.categories.a,
    },
    {
      id: FIXTURES.events.reversal,
      householdId: FIXTURES.households.a,
      kind: "REVERSAL",
      status: "POSTED",
      origin: "SYSTEM",
      amountCents: BigInt("500"),
      occurredOn: "2026-08-28",
      description: "T06 reversal",
      categoryId: null,
      reversalOfEventId: FIXTURES.events.cancelled,
    },
    {
      id: FIXTURES.events.otherTenant,
      householdId: FIXTURES.households.b,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt("990"),
      occurredOn: "2026-08-29",
      description: "T06 other tenant",
      categoryId: FIXTURES.categories.b,
    },
  ]);
  await database.insert(accountEntries).values([
    {
      id: FIXTURES.entries.expense,
      financialEventId: FIXTURES.events.expense,
      accountId: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      amountCents: BigInt("-1250"),
      status: "POSTED",
      expectedOn: null,
      postedOn: "2026-08-29",
    },
    {
      id: FIXTURES.entries.income,
      financialEventId: FIXTURES.events.income,
      accountId: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      amountCents: BigInt("3000"),
      status: "POSTED",
      expectedOn: null,
      postedOn: "2026-08-29",
    },
    {
      id: FIXTURES.entries.cancelled,
      financialEventId: FIXTURES.events.cancelled,
      accountId: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      amountCents: BigInt("-500"),
      status: "POSTED",
      expectedOn: null,
      postedOn: "2026-08-28",
    },
    {
      id: FIXTURES.entries.reversal,
      financialEventId: FIXTURES.events.reversal,
      accountId: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      amountCents: BigInt("500"),
      status: "POSTED",
      expectedOn: null,
      postedOn: "2026-08-28",
    },
    {
      id: FIXTURES.entries.otherTenant,
      financialEventId: FIXTURES.events.otherTenant,
      accountId: FIXTURES.accounts.b,
      householdId: FIXTURES.households.b,
      amountCents: BigInt("-990"),
      status: "POSTED",
      expectedOn: null,
      postedOn: "2026-08-29",
    },
  ]);
}

integration("T06 transaction reads and derived balance", () => {
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

  it("lists manual events with joined references in deterministic order", async () => {
    const db = databaseOrThrow(database);
    const result = await listManualTransactionsForContext(db, contextA, {
      from: "2026-08-01",
      to: "2026-08-31",
    });

    expect(result.items.map(({ id }) => id)).toEqual([
      FIXTURES.events.income,
      FIXTURES.events.expense,
      FIXTURES.events.cancelled,
    ]);
    expect(result.items[0]).toMatchObject({
      kind: "INCOME",
      amountCents: "3000",
      category: null,
      account: { id: FIXTURES.accounts.a, name: "T06 Checking A" },
      entry: { amountCents: "3000", postedOn: "2026-08-29" },
    });
    expect(result.items[1]).toMatchObject({
      kind: "EXPENSE",
      amountCents: "1250",
      category: { id: FIXTURES.categories.a },
      entry: { amountCents: "-1250" },
    });
  });

  it("combines filters without allowing another household's rows", async () => {
    const db = databaseOrThrow(database);
    const own = await listManualTransactionsForContext(db, contextA, {
      accountId: FIXTURES.accounts.a,
      categoryId: FIXTURES.categories.a,
      kind: "EXPENSE",
      status: "CANCELLED",
    });
    expect(own.items.map(({ id }) => id)).toEqual([FIXTURES.events.cancelled]);

    const forgedAccount = await listManualTransactionsForContext(db, contextA, {
      accountId: FIXTURES.accounts.b,
    });
    expect(forgedAccount.items).toEqual([]);

    const tenantB = await listManualTransactionsForContext(db, contextB);
    expect(tenantB.items.map(({ id }) => id)).toEqual([
      FIXTURES.events.otherTenant,
    ]);
  });

  it("returns cancelled history with its reversal and hides another tenant detail", async () => {
    const db = databaseOrThrow(database);
    const detail = await getManualTransactionForContext(
      db,
      contextA,
      FIXTURES.events.cancelled,
    );
    expect(detail).toMatchObject({
      id: FIXTURES.events.cancelled,
      status: "CANCELLED",
      reversal: {
        id: FIXTURES.events.reversal,
        amountCents: "500",
        origin: "SYSTEM",
        status: "POSTED",
      },
    });

    await expect(
      getManualTransactionForContext(db, contextA, FIXTURES.events.otherTenant),
    ).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
  });

  it("derives the account balance from posted entries, including neutralizing reversal", async () => {
    const db = databaseOrThrow(database);
    await expect(
      getAccountBalanceForContext(
        db,
        contextA,
        FIXTURES.accounts.a,
        "2026-08-27",
      ),
    ).resolves.toMatchObject({ balanceCents: "0" });
    await expect(
      getAccountBalanceForContext(
        db,
        contextA,
        FIXTURES.accounts.a,
        "2026-08-28",
      ),
    ).resolves.toMatchObject({ balanceCents: "0" });
    await expect(
      getAccountBalanceForContext(
        db,
        contextA,
        FIXTURES.accounts.a,
        "2026-08-29",
      ),
    ).resolves.toMatchObject({ balanceCents: "1750" });

    await expect(
      getAccountBalanceForContext(db, contextA, FIXTURES.accounts.b),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
  });

  it("exposes an S02-shaped account statement with the derived balance", async () => {
    const db = databaseOrThrow(database);
    const statement = await listAccountMovementsForContext(
      db,
      contextA,
      FIXTURES.accounts.a,
      { to: "2026-08-29" },
    );

    expect(statement.account).toMatchObject({
      id: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
    });
    expect(statement.balance).toMatchObject({ balanceCents: "1750" });
    expect(statement.items).toHaveLength(4);
    expect(statement.items.map(({ kind }) => kind)).toContain("REVERSAL");
    expect(statement.items.map(({ amountCents }) => amountCents)).toEqual([
      "3000",
      "-1250",
      "500",
      "-500",
    ]);
  });

  it("retains the tenant predicate in joined rows", async () => {
    const db = databaseOrThrow(database);
    const rows = await db
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
      .where(eq(financialEvents.householdId, contextA.householdId));
    expect(rows.every((row) => row.eventHouseholdId === row.entryHouseholdId)).toBe(
      true,
    );
  });
});

