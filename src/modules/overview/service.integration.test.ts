import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  categories,
  financialEvents,
  households,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";

import { getOverviewForContext } from "./service";

const integration =
  process.env.T10_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  households: {
    a: "00000000-0000-7000-8000-000000101001",
    b: "00000000-0000-7000-8000-000000101002",
  },
  categories: {
    aFood: "00000000-0000-7000-8000-000000101101",
    aCard: "00000000-0000-7000-8000-000000101102",
    bOther: "00000000-0000-7000-8000-000000101103",
  },
  events: {
    expenseA: "00000000-0000-7000-8000-000000101201",
    purchaseA: "00000000-0000-7000-8000-000000101202",
    transferA: "00000000-0000-7000-8000-000000101203",
    expenseB: "00000000-0000-7000-8000-000000101204",
  },
} as const;

const householdIds = [
  FIXTURES.households.a,
  FIXTURES.households.b,
] as const;

const contextA: FinancialContext = {
  userId: "00000000-0000-7000-8000-000000101901",
  householdId: FIXTURES.households.a,
};

const contextB: FinancialContext = {
  userId: "00000000-0000-7000-8000-000000101902",
  householdId: FIXTURES.households.b,
};

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T10 não foi inicializado.");
  }
  return database;
}

async function cleanup(database: Database): Promise<void> {
  await database
    .delete(financialEvents)
    .where(inArray(financialEvents.householdId, householdIds));
  await database
    .delete(categories)
    .where(inArray(categories.householdId, householdIds));
  await database.delete(households).where(inArray(households.id, householdIds));
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T10 Overview Service A" },
    { id: FIXTURES.households.b, name: "T10 Overview Service B" },
  ]);

  await database.insert(categories).values([
    {
      id: FIXTURES.categories.aFood,
      householdId: FIXTURES.households.a,
      name: "Alimentação",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.aCard,
      householdId: FIXTURES.households.a,
      name: "Cartão",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.bOther,
      householdId: FIXTURES.households.b,
      name: "Vizinho",
      kind: "EXPENSE",
    },
  ]);

  await database.insert(financialEvents).values([
    {
      id: FIXTURES.events.expenseA,
      householdId: FIXTURES.households.a,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(2500),
      occurredOn: "2026-09-08",
      description: "T10 expense A",
      categoryId: FIXTURES.categories.aFood,
    },
    {
      id: FIXTURES.events.purchaseA,
      householdId: FIXTURES.households.a,
      kind: "PURCHASE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(30000),
      occurredOn: "2026-09-05",
      description: "T10 purchase A",
      categoryId: FIXTURES.categories.aCard,
    },
    {
      id: FIXTURES.events.transferA,
      householdId: FIXTURES.households.a,
      kind: "TRANSFER",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(10000),
      occurredOn: "2026-09-20",
      description: "T10 card payment transfer",
      categoryId: null,
    },
    {
      id: FIXTURES.events.expenseB,
      householdId: FIXTURES.households.b,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(99999),
      occurredOn: "2026-09-12",
      description: "T10 neighbor expense",
      categoryId: FIXTURES.categories.bOther,
    },
  ]);
}

integration("overview service integration", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    await cleanup(databaseOrThrow(database));
    await seed(databaseOrThrow(database));
  });

  afterAll(async () => {
    await cleanup(databaseOrThrow(database));
    await closeDb();
  });

  it("isolates households and reconciles expense totals with aggregation", async () => {
    const resultA = await getOverviewForContext(
      contextA,
      { asOf: "2026-09-15" },
      { database },
    );
    const resultB = await getOverviewForContext(
      contextB,
      { asOf: "2026-09-15" },
      { database },
    );

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    if (!resultA.ok || !resultB.ok) return;

    expect(resultA.value.expensesByCategory.data?.totalExpenseCents).toBe("32500");
    expect(resultB.value.expensesByCategory.data?.totalExpenseCents).toBe("99999");
    expect(JSON.stringify(resultA.value)).not.toContain(FIXTURES.households.b);
    expect(JSON.stringify(resultB.value)).not.toContain(FIXTURES.households.a);
  });
});

// Opt-in PostgreSQL reconciliation for T06. Enable with `T10_INTEGRATION=1`.
