import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  user,
} from "@/db/schema";
import { S03_FIXTURES, S03_HOUSEHOLD_IDS, S03_USER_IDS } from "@/test/s03-fixtures";

/** T13's remaining database-level boundary check is opt-in like T03-T07. */
const integration =
  process.env.T13_INTEGRATION === "1" ? describe : describe.skip;

const negativeEventId = "00000000-0000-7000-8000-000000135102";

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T13 não foi inicializado.");
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

async function cleanup(database: Database): Promise<void> {
  await database
    .delete(applicationCommands)
    .where(inArray(applicationCommands.householdId, S03_HOUSEHOLD_IDS));
  await database
    .delete(accountEntries)
    .where(inArray(accountEntries.householdId, S03_HOUSEHOLD_IDS));
  await database
    .delete(financialEvents)
    .where(inArray(financialEvents.householdId, S03_HOUSEHOLD_IDS));
  await database
    .delete(categories)
    .where(inArray(categories.householdId, S03_HOUSEHOLD_IDS));
  await database
    .delete(accounts)
    .where(inArray(accounts.householdId, S03_HOUSEHOLD_IDS));
  await database
    .delete(householdMembers)
    .where(inArray(householdMembers.householdId, S03_HOUSEHOLD_IDS));
  await database
    .delete(households)
    .where(inArray(households.id, S03_HOUSEHOLD_IDS));
  await database.delete(user).where(inArray(user.id, S03_USER_IDS));
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: S03_FIXTURES.households.a, name: "T13 Household A" },
    { id: S03_FIXTURES.households.b, name: "T13 Household B" },
  ]);
}

integration("T13 PostgreSQL boundary checks", () => {
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
    await cleanup(db);
    await seed(db);
  });

  afterAll(async () => {
    if (database) {
      await cleanup(database);
    }
    await closeDb();
  });

  it("rejects a negative absolute event amount and leaves no row", async () => {
    const db = databaseOrThrow(database);

    await expect(
      db.insert(financialEvents).values({
        id: negativeEventId,
        householdId: S03_FIXTURES.households.a,
        kind: "EXPENSE",
        status: "POSTED",
        origin: "MANUAL",
        amountCents: BigInt("-1"),
        occurredOn: "2026-08-29",
        description: "T13 negative amount",
        categoryId: null,
        reversalOfEventId: null,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );

    const rows = await db
      .select({ id: financialEvents.id })
      .from(financialEvents)
      .where(eq(financialEvents.id, negativeEventId));
    expect(rows).toEqual([]);
  });
});

