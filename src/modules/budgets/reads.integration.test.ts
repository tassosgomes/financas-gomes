import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  budgetAllocationRules,
  budgetMovements,
  budgets,
  categories,
  households,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";

import {
  getBudgetForContext,
  listBudgetsForContext,
} from "./service";

/** Opt-in because this suite seeds and reads a disposable PostgreSQL schema. */
const integration =
  process.env.T05_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  households: {
    a: "00000000-0000-7000-8000-000000505101",
    b: "00000000-0000-7000-8000-000000505102",
  },
  categories: {
    a: "00000000-0000-7000-8000-000000505201",
    b: "00000000-0000-7000-8000-000000505202",
  },
  budgets: {
    closed: "00000000-0000-7000-8000-000000505301",
    active: "00000000-0000-7000-8000-000000505302",
    foreign: "00000000-0000-7000-8000-000000505303",
  },
  movements: {
    closedContribution: "00000000-0000-7000-8000-000000505401",
    closedWithdrawal: "00000000-0000-7000-8000-000000505402",
    closedOnDate: "00000000-0000-7000-8000-000000505403",
    activeContribution: "00000000-0000-7000-8000-000000505404",
    activeWithdrawal: "00000000-0000-7000-8000-000000505405",
    foreignContribution: "00000000-0000-7000-8000-000000505406",
  },
  rules: {
    active: "00000000-0000-7000-8000-000000505501",
  },
} as const;

const householdIds = [
  FIXTURES.households.a,
  FIXTURES.households.b,
] as const;
const categoryIds = [
  FIXTURES.categories.a,
  FIXTURES.categories.b,
] as const;
const contextA: FinancialContext = {
  userId: "00000000-0000-7000-8000-000000505901",
  householdId: FIXTURES.households.a,
};

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco PostgreSQL de reads T05 não foi inicializado.");
  }
  return database;
}

async function cleanup(database: Database): Promise<void> {
  // budget_movements is append-only for application writes. TRUNCATE is
  // scoped to this disposable integration database and is maintenance-only.
  await database.execute(
    sql.raw(
      "truncate table budget_movements, budget_allocation_rules, budgets",
    ),
  );
  await database
    .delete(categories)
    .where(inArray(categories.id, [...categoryIds]));
  await database
    .delete(households)
    .where(inArray(households.id, [...householdIds]));
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T05 Household A" },
    { id: FIXTURES.households.b, name: "T05 Household B" },
  ]);
  await database.insert(categories).values([
    {
      id: FIXTURES.categories.a,
      householdId: FIXTURES.households.a,
      name: "T05 Expense A",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.b,
      householdId: FIXTURES.households.b,
      name: "T05 Expense B",
      kind: "EXPENSE",
    },
  ]);
  await database.insert(budgets).values([
    {
      id: FIXTURES.budgets.closed,
      householdId: FIXTURES.households.a,
      referenceId: "t05-closed-box",
      categoryId: FIXTURES.categories.a,
      name: "T05 Closed Box",
      status: "CLOSED",
      activeFrom: "2026-01-01",
      closedOn: "2026-08-31",
      targetAmountCents: BigInt("2000"),
      targetDate: "2026-12-31",
    },
    {
      id: FIXTURES.budgets.active,
      householdId: FIXTURES.households.a,
      referenceId: "t05-active-box",
      categoryId: FIXTURES.categories.a,
      name: "T05 Active Box",
      status: "ACTIVE",
      activeFrom: "2026-09-01",
      targetAmountCents: BigInt("1000"),
      targetDate: "2026-12-31",
    },
    {
      id: FIXTURES.budgets.foreign,
      householdId: FIXTURES.households.b,
      referenceId: "t05-foreign-box",
      categoryId: FIXTURES.categories.b,
      name: "T05 Foreign Box",
      status: "ACTIVE",
      activeFrom: "2026-01-01",
    },
  ]);
  await database.insert(budgetMovements).values([
    {
      id: FIXTURES.movements.closedContribution,
      householdId: FIXTURES.households.a,
      budgetId: FIXTURES.budgets.closed,
      referenceId: "t05-closed-contribution",
      kind: "CONTRIBUTION",
      amountCents: BigInt("1000"),
      effectiveOn: "2026-08-01",
    },
    {
      id: FIXTURES.movements.closedWithdrawal,
      householdId: FIXTURES.households.a,
      budgetId: FIXTURES.budgets.closed,
      referenceId: "t05-closed-withdrawal",
      kind: "WITHDRAWAL",
      amountCents: BigInt("250"),
      effectiveOn: "2026-08-15",
    },
    {
      id: FIXTURES.movements.closedOnDate,
      householdId: FIXTURES.households.a,
      budgetId: FIXTURES.budgets.closed,
      referenceId: "t05-closed-on-date",
      kind: "CONTRIBUTION",
      amountCents: BigInt("600"),
      effectiveOn: "2026-08-31",
    },
    {
      id: FIXTURES.movements.activeContribution,
      householdId: FIXTURES.households.a,
      budgetId: FIXTURES.budgets.active,
      referenceId: "t05-active-contribution",
      kind: "CONTRIBUTION",
      amountCents: BigInt("400"),
      effectiveOn: "2026-09-01",
    },
    {
      id: FIXTURES.movements.activeWithdrawal,
      householdId: FIXTURES.households.a,
      budgetId: FIXTURES.budgets.active,
      referenceId: "t05-active-withdrawal",
      kind: "WITHDRAWAL",
      amountCents: BigInt("50"),
      effectiveOn: "2026-09-02",
    },
    {
      id: FIXTURES.movements.foreignContribution,
      householdId: FIXTURES.households.b,
      budgetId: FIXTURES.budgets.foreign,
      referenceId: "t05-foreign-contribution",
      kind: "CONTRIBUTION",
      amountCents: BigInt("999999"),
      effectiveOn: "2026-09-01",
    },
  ]);
  await database.insert(budgetAllocationRules).values({
    id: FIXTURES.rules.active,
    householdId: FIXTURES.households.a,
    budgetId: FIXTURES.budgets.active,
    amountCents: BigInt("500"),
    effectiveFrom: "2026-09-01",
  });
}

integration("T05 PostgreSQL tenant-safe reads", () => {
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
    if (database) await cleanup(database);
    await closeDb();
  });

  it("maps only the resolved household and derives list balances as strings", async () => {
    const db = databaseOrThrow(database);
    const result = await listBudgetsForContext(
      contextA,
      { status: "ALL", asOf: "2026-09-02" },
      { database: db, today: "2026-09-02" },
    );

    expect(result.items.map((item) => item.referenceId)).toEqual([
      "t05-active-box",
      "t05-closed-box",
    ]);
    expect(result.items[0]).toMatchObject({
      category: {
        referenceId: FIXTURES.categories.a,
        name: "T05 Expense A",
        kind: "EXPENSE",
        status: "ACTIVE",
      },
      balance: {
        balanceCents: "350",
        protectedAmountCents: "350",
        contributionCents: "400",
        withdrawalCents: "50",
        activeAtCutoff: true,
      },
      progress: {
        targetAmountCents: "1000",
        progressCents: "350",
        remainingCents: "650",
      },
    });
    expect(result.items[1]).toMatchObject({
      balance: {
        balanceCents: "1350",
        protectedAmountCents: "0",
        activeAtCutoff: false,
      },
    });
    expect(result.items.every((item) => !Object.hasOwn(item, "householdId"))).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toContain(FIXTURES.households.b);
    expect(JSON.stringify(result)).not.toContain("999999");
  });

  it("keeps the closing date in derived history, applies effective rules and hides foreign detail", async () => {
    const db = databaseOrThrow(database);
    const closed = await getBudgetForContext(
      contextA,
      "t05-closed-box",
      {
        asOf: "2026-08-31",
        from: "2026-08-01",
        to: "2026-08-31",
        limit: 1,
      },
      { database: db, today: "2026-08-31" },
    );
    expect(closed.balance).toMatchObject({
      balanceCents: "1350",
      protectedAmountCents: "0",
      activeAtCutoff: false,
      movementReferenceIds: [
        "t05-closed-contribution",
        "t05-closed-withdrawal",
        "t05-closed-on-date",
      ],
    });
    expect(closed.period).toMatchObject({
      from: "2026-08-01",
      to: "2026-08-31",
      contributionCents: "1600",
      withdrawalCents: "250",
      closingBalanceCents: "1350",
    });
    expect(closed.movements).toHaveLength(1);
    expect(closed.movements[0]).toMatchObject({
      referenceId: "t05-closed-on-date",
      amountCents: "600",
      effectiveOn: "2026-08-31",
    });
    expect(closed.movementPageInfo.hasNextPage).toBe(true);

    const active = await getBudgetForContext(
      contextA,
      "t05-active-box",
      { asOf: "2026-09-02" },
      { database: db, today: "2026-09-02" },
    );
    expect(active.allocationRules).toEqual([
      {
        referenceId: FIXTURES.rules.active,
        budgetReferenceId: "t05-active-box",
        boxReferenceId: "t05-active-box",
        amountCents: "500",
        effectiveFrom: "2026-09-01",
        effectiveUntil: null,
      },
    ]);

    await expect(
      getBudgetForContext(
        contextA,
        "t05-foreign-box",
        { asOf: "2026-09-02" },
        { database: db, today: "2026-09-02" },
      ),
    ).rejects.toMatchObject({ code: "BUDGET_NOT_FOUND" });
  });
});
