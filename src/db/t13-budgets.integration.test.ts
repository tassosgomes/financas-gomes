import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

import postgresFixtures from "../../tests/fixtures/s09-caixinhas/postgres-fixtures.json";
import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations, getMigrationStatus } from "@/db/migrate";

import {
  budgetAllocationRules,
  budgetMovements,
  budgets,
  categories,
  households,
} from "./schema";

const integration =
  process.env.T13_INTEGRATION === "1" ? describe : describe.skip;

type HouseholdKey = keyof typeof postgresFixtures.households;
type CategoryKey = keyof typeof postgresFixtures.categories;
type BudgetKey = keyof typeof postgresFixtures.budgets;
type MovementKey = keyof typeof postgresFixtures.movements;

const householdIds = [
  postgresFixtures.households.a.id,
  postgresFixtures.households.b.id,
] as const;
const categoryIds = [
  postgresFixtures.categories.expenseA.id,
  postgresFixtures.categories.expenseB.id,
] as const;
function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco PostgreSQL da T13 não foi inicializado.");
  }
  return database;
}

function postgresErrorCode(error: unknown): string | undefined {
  let candidate: unknown = error;
  for (let depth = 0; depth < 5 && candidate; depth += 1) {
    if (typeof candidate !== "object") return undefined;
    const value = candidate as { code?: unknown; cause?: unknown };
    if (typeof value.code === "string") return value.code;
    candidate = value.cause;
  }
  return undefined;
}

function householdId(key: string): string {
  const fixture = postgresFixtures.households[key as HouseholdKey];
  if (!fixture) throw new Error(`Fixture household ausente: ${key}`);
  return fixture.id;
}

function categoryId(key: string): string {
  const fixture = postgresFixtures.categories[key as CategoryKey];
  if (!fixture) throw new Error(`Fixture category ausente: ${key}`);
  return fixture.id;
}

function budgetValues(key: string) {
  const fixture = postgresFixtures.budgets[key as BudgetKey];
  if (!fixture) throw new Error(`Fixture budget ausente: ${key}`);
  return {
    id: fixture.id,
    householdId: householdId(fixture.household),
    referenceId: fixture.referenceId,
    categoryId: categoryId(fixture.category),
    name: fixture.name,
    activeFrom: fixture.activeFrom,
  } as const;
}

function movementValues(key: MovementKey) {
  const fixture = postgresFixtures.movements[key];
  return {
    id: fixture.id,
    householdId: householdId(fixture.household),
    budgetId: budgetValues(fixture.budget).id,
    referenceId: fixture.referenceId,
    kind: fixture.kind as "CONTRIBUTION" | "WITHDRAWAL",
    amountCents: BigInt(fixture.amountCents),
    effectiveOn: fixture.effectiveOn,
  };
}

async function cleanupT13(database: Database): Promise<void> {
  // The production append-only trigger intentionally rejects DELETE. This is
  // a disposable PostgreSQL database, so table-level TRUNCATE is the only
  // maintenance cleanup that cannot be confused with an application delete.
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

async function seedT13(database: Database): Promise<void> {
  await database.insert(households).values([
    postgresFixtures.households.a,
    postgresFixtures.households.b,
  ]);
  await database.insert(categories).values([
    {
      ...postgresFixtures.categories.expenseA,
      householdId: householdId(postgresFixtures.categories.expenseA.household),
      kind: "EXPENSE" as const,
    },
    {
      ...postgresFixtures.categories.expenseB,
      householdId: householdId(postgresFixtures.categories.expenseB.household),
      kind: "EXPENSE" as const,
    },
  ]);
}

integration("T13 S09 PostgreSQL boundaries", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar T13_INTEGRATION=1.",
      );
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = databaseOrThrow(database);
    await cleanupT13(db);
    await seedT13(db);
  });

  afterAll(async () => {
    if (database) await cleanupT13(database);
    await closeDb();
  });

  it("applies migrations and has no persisted balance or Spendable snapshot", async () => {
    const db = databaseOrThrow(database);
    await applyMigrations();
    await expect(getMigrationStatus()).resolves.toMatchObject({
      pending: 0,
      drifted: 0,
    });

    const derivedColumns = await db.execute<{
      table_name: string;
      column_name: string;
    }>(
      sql.raw(
        "select table_name, column_name " +
          "from information_schema.columns " +
          "where table_schema = 'public' " +
          "and table_name in ('budgets', 'budget_movements', 'budget_allocation_rules') " +
          "and lower(column_name) like any (array['%balance%', '%snapshot%', '%protected_amount%']) " +
          "order by table_name, column_name",
      ),
    );
    expect(derivedColumns.rows).toEqual([]);
  });

  it("rejects cross-household budget, category and allocation references", async () => {
    const db = databaseOrThrow(database);
    await db.insert(budgets).values([budgetValues("a"), budgetValues("b")]);

    await expect(
      db.insert(budgetMovements).values({
        ...movementValues("seed"),
        id: postgresFixtures.probes.crossHouseholdMovementId,
        householdId: householdId("b"),
        budgetId: postgresFixtures.budgets.a.id,
        referenceId: "t13-cross-household-movement",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );

    await expect(
      db.insert(budgets).values({
        ...budgetValues("a"),
        id: postgresFixtures.probes.crossCategoryBudgetId,
        householdId: householdId("b"),
        referenceId: "t13-cross-category-budget",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );

    await expect(
      db.insert(budgetAllocationRules).values({
        id: postgresFixtures.probes.crossHouseholdRuleId,
        householdId: householdId("b"),
        budgetId: postgresFixtures.budgets.a.id,
        amountCents: BigInt("100"),
        effectiveFrom: "2026-01-01",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );
  });

  it("keeps child rows and allocation rules protected by restrictive deletes", async () => {
    const db = databaseOrThrow(database);
    await db.insert(budgets).values(budgetValues("a"));
    await db.insert(budgetMovements).values(movementValues("seed"));
    await expect(
      db.delete(budgets).where(eq(budgets.id, postgresFixtures.budgets.a.id)),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );
  });

  it("rolls back a budget, movement and allocation rule as one transaction", async () => {
    const db = databaseOrThrow(database);
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(budgets).values(budgetValues("rollback"));
        await tx.insert(budgetMovements).values(movementValues("rollback"));
        await tx.insert(budgetAllocationRules).values({
          id: postgresFixtures.allocationRules.rollback.id,
          householdId: householdId("a"),
          budgetId: postgresFixtures.budgets.rollback.id,
          amountCents: BigInt("100"),
          effectiveFrom: "2026-01-01",
        });
        throw new Error("force T13 rollback");
      }),
    ).rejects.toThrow("force T13 rollback");

    const rows = await db.execute<{
      budgets_count: number;
      movements_count: number;
      rules_count: number;
    }>(
      sql.raw(
        "select " +
          "(select count(*) from budgets where id = '00000000-0000-7000-8000-000000133303')::int as budgets_count, " +
          "(select count(*) from budget_movements where id = '00000000-0000-7000-8000-000000134302')::int as movements_count, " +
          "(select count(*) from budget_allocation_rules where id = '00000000-0000-7000-8000-000000135301')::int as rules_count",
      ),
    );
    expect(rows.rows).toEqual([
      { budgets_count: 0, movements_count: 0, rules_count: 0 },
    ]);
  });
});
