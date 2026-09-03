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

import { civilMonthPeriod } from "./period";
import {
  assertGroupsReconcileWithTotal,
  explainPeriodAggregationQuery,
  readPeriodAggregationForContext,
} from "./query";

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

const period = civilMonthPeriod("2026-09-15");

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
    { id: FIXTURES.households.a, name: "T10 Overview A" },
    { id: FIXTURES.households.b, name: "T10 Overview B" },
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

integration("T10 overview period aggregation", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    await applyMigrations();
    database = getDb();
    await cleanup(databaseOrThrow(database));
    await seed(databaseOrThrow(database));
  });

  beforeEach(async () => {
    await cleanup(databaseOrThrow(database));
    await seed(databaseOrThrow(database));
  });

  afterAll(async () => {
    if (database) {
      await cleanup(database);
      await closeDb();
    }
  });

  it("does not let a neighbor household affect totals", async () => {
    const result = await readPeriodAggregationForContext(contextA, period, {
      database: databaseOrThrow(database),
    });

    expect(result.summary.expenseCents).toBe("32500");
    expect(result.summary.expenseEventCount).toBe(1);
    expect(result.summary.purchaseEventCount).toBe(1);
    expect(result.groups.map((group) => group.amountCents)).toEqual([
      "30000",
      "2500",
    ]);
  });

  it("counts purchase once when a payment transfer exists in the same period", async () => {
    const result = await readPeriodAggregationForContext(contextA, period, {
      database: databaseOrThrow(database),
    });

    expect(result.summary.expenseCents).toBe("32500");
    expect(result.totalExpenseCents).toBe("32500");
    assertGroupsReconcileWithTotal(result);
  });

  it("keeps household B isolated from household A", async () => {
    const result = await readPeriodAggregationForContext(contextB, period, {
      database: databaseOrThrow(database),
    });

    expect(result.summary.expenseCents).toBe("99999");
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.amountCents).toBe("99999");
    assertGroupsReconcileWithTotal(result);
  });

  it("documents the period query plan for EXPLAIN review", async () => {
    const plan = await explainPeriodAggregationQuery(contextA, period, {
      database: databaseOrThrow(database),
    });

    expect(plan).toMatch(/financial_events/i);
    expect(plan).toMatch(/household/i);
  });
});
