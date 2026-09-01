import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  financialEvents,
  households,
  plannedEvents,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";

import { getForecast } from "./service";

const integration =
  process.env.T06_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  householdA: "00000000-0000-7000-8000-000000061101",
  householdB: "00000000-0000-7000-8000-000000061102",
  accountA: "00000000-0000-7000-8000-000000061111",
  accountB: "00000000-0000-7000-8000-000000061112",
  openingEventA: "00000000-0000-7000-8000-000000061121",
  openingEntryA: "00000000-0000-7000-8000-000000061131",
  plannedA: "00000000-0000-7000-8000-000000061141",
  plannedB: "00000000-0000-7000-8000-000000061142",
} as const;

const HOUSEHOLDS = [FIXTURES.householdA, FIXTURES.householdB] as const;
const contextA: FinancialContext = {
  userId: "t06-user-a",
  householdId: FIXTURES.householdA,
};

function dbOrThrow(database: Database | undefined): Database {
  if (!database) throw new Error("Banco T06 não inicializado.");
  return database;
}

async function cleanup(database: Database): Promise<void> {
  await database
    .delete(plannedEvents)
    .where(inArray(plannedEvents.id, [FIXTURES.plannedA, FIXTURES.plannedB]));
  await database
    .delete(accountEntries)
    .where(inArray(accountEntries.id, [FIXTURES.openingEntryA]));
  await database
    .delete(financialEvents)
    .where(inArray(financialEvents.id, [FIXTURES.openingEventA]));
  await database
    .delete(accounts)
    .where(inArray(accounts.id, [FIXTURES.accountA, FIXTURES.accountB]));
  await database
    .delete(households)
    .where(inArray(households.id, HOUSEHOLDS));
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.householdA, name: "T06 A" },
    { id: FIXTURES.householdB, name: "T06 B" },
  ]);
  await database.insert(accounts).values([
    { id: FIXTURES.accountA, householdId: FIXTURES.householdA, name: "T06 checking A", type: "CHECKING" },
    { id: FIXTURES.accountB, householdId: FIXTURES.householdB, name: "T06 checking B", type: "CHECKING" },
  ]);
  await database.insert(financialEvents).values({
    id: FIXTURES.openingEventA,
    householdId: FIXTURES.householdA,
    kind: "INCOME",
    status: "POSTED",
    origin: "MANUAL",
    amountCents: BigInt(1000),
    occurredOn: "2026-08-31",
    description: "T06 synthetic opening",
  });
  await database.insert(accountEntries).values({
    id: FIXTURES.openingEntryA,
    financialEventId: FIXTURES.openingEventA,
    accountId: FIXTURES.accountA,
    householdId: FIXTURES.householdA,
    amountCents: BigInt(1000),
    status: "POSTED",
    postedOn: "2026-08-31",
  });
  await database.insert(plannedEvents).values([
    {
      id: FIXTURES.plannedA,
      householdId: FIXTURES.householdA,
      accountId: FIXTURES.accountA,
      kind: "EXPENSE",
      status: "PLANNED",
      amountCents: BigInt(300),
      expectedOn: "2026-09-10",
      description: "T06 synthetic commitment A",
    },
    {
      id: FIXTURES.plannedB,
      householdId: FIXTURES.householdB,
      accountId: FIXTURES.accountB,
      kind: "EXPENSE",
      status: "PLANNED",
      amountCents: BigInt(900),
      expectedOn: "2026-09-10",
      description: "T06 synthetic commitment B",
    },
  ]);
}

integration("S07 T06 forecast service PostgreSQL boundary", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("Defina DATABASE_URL para executar T06_INTEGRATION=1.");
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
      await closeDb();
    }
  });

  it("derives opening balance and projected commitments only for the resolved household", async () => {
    const result = await getForecast(
      { from: "2026-09-01", to: "2026-09-30", scenario: "EXPECTED" },
      {
        database,
        resolveContext: () => contextA,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        openingBalanceCents: "1000",
        openingProjectedBalanceCents: "1000",
        closingProjectedBalanceCents: "700",
        totals: {
          inflowCents: "0",
          outflowCents: "300",
          projectedOutflowCents: "300",
        },
      },
    });
    if (!result.ok) return;
    const items = result.value.days.flatMap(({ items: dayItems }) => dayItems);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      referenceId: FIXTURES.plannedA,
      source: { referenceId: FIXTURES.plannedA },
    });
    expect(JSON.stringify(result)).not.toContain(FIXTURES.householdB);
  });
});

