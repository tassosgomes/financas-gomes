import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  financialEvents,
  households,
  spendableSettings,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";

import { getSpendable } from "./service";

const integration =
  process.env.T06_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  householdA: "00000000-0000-7000-8000-000000086101",
  householdB: "00000000-0000-7000-8000-000000086102",
  accountGeneralA: "00000000-0000-7000-8000-000000086111",
  accountRestrictedA: "00000000-0000-7000-8000-000000086112",
  accountExcludedA: "00000000-0000-7000-8000-000000086113",
  accountGeneralB: "00000000-0000-7000-8000-000000086114",
  eventGeneralA: "00000000-0000-7000-8000-000000086121",
  eventRestrictedA: "00000000-0000-7000-8000-000000086122",
  eventExcludedA: "00000000-0000-7000-8000-000000086123",
  eventGeneralB: "00000000-0000-7000-8000-000000086124",
  entryGeneralA: "00000000-0000-7000-8000-000000086131",
  entryRestrictedA: "00000000-0000-7000-8000-000000086132",
  entryExcludedA: "00000000-0000-7000-8000-000000086133",
  entryGeneralB: "00000000-0000-7000-8000-000000086134",
  settingA: "00000000-0000-7000-8000-000000086141",
  settingAFuture: "00000000-0000-7000-8000-000000086142",
  settingB: "00000000-0000-7000-8000-000000086143",
} as const;

const HOUSEHOLDS = [FIXTURES.householdA, FIXTURES.householdB] as const;
const contextA: FinancialContext = {
  userId: "t06-s08-user-a",
  householdId: FIXTURES.householdA,
};
const contextB: FinancialContext = {
  userId: "t06-s08-user-b",
  householdId: FIXTURES.householdB,
};

function dbOrThrow(database: Database | undefined): Database {
  if (!database) throw new Error("Banco T06 S08 não inicializado.");
  return database;
}

async function cleanup(database: Database): Promise<void> {
  await database.delete(spendableSettings).where(
    inArray(spendableSettings.id, [
      FIXTURES.settingA,
      FIXTURES.settingAFuture,
      FIXTURES.settingB,
    ]),
  );
  await database.delete(accountEntries).where(
    inArray(accountEntries.id, [
      FIXTURES.entryGeneralA,
      FIXTURES.entryRestrictedA,
      FIXTURES.entryExcludedA,
      FIXTURES.entryGeneralB,
    ]),
  );
  await database.delete(financialEvents).where(
    inArray(financialEvents.id, [
      FIXTURES.eventGeneralA,
      FIXTURES.eventRestrictedA,
      FIXTURES.eventExcludedA,
      FIXTURES.eventGeneralB,
    ]),
  );
  await database.delete(accounts).where(
    inArray(accounts.id, [
      FIXTURES.accountGeneralA,
      FIXTURES.accountRestrictedA,
      FIXTURES.accountExcludedA,
      FIXTURES.accountGeneralB,
    ]),
  );
  await database.delete(households).where(inArray(households.id, HOUSEHOLDS));
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.householdA, name: "S08 T06 A" },
    { id: FIXTURES.householdB, name: "S08 T06 B" },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accountGeneralA,
      householdId: FIXTURES.householdA,
      name: "S08 general A",
      type: "CHECKING",
      spendability: "GENERAL",
    },
    {
      id: FIXTURES.accountRestrictedA,
      householdId: FIXTURES.householdA,
      name: "S08 restricted A",
      type: "BENEFIT",
      spendability: "RESTRICTED",
    },
    {
      id: FIXTURES.accountExcludedA,
      householdId: FIXTURES.householdA,
      name: "S08 excluded A",
      type: "INVESTMENT",
      spendability: "EXCLUDED",
    },
    {
      id: FIXTURES.accountGeneralB,
      householdId: FIXTURES.householdB,
      name: "S08 general B",
      type: "CHECKING",
      spendability: "GENERAL",
    },
  ]);
  await database.insert(financialEvents).values([
    {
      id: FIXTURES.eventGeneralA,
      householdId: FIXTURES.householdA,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(1_000),
      occurredOn: "2026-08-31",
      description: "S08 general opening A",
    },
    {
      id: FIXTURES.eventRestrictedA,
      householdId: FIXTURES.householdA,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(9_000),
      occurredOn: "2026-08-31",
      description: "S08 restricted opening A",
    },
    {
      id: FIXTURES.eventExcludedA,
      householdId: FIXTURES.householdA,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(5_000),
      occurredOn: "2026-08-31",
      description: "S08 excluded opening A",
    },
    {
      id: FIXTURES.eventGeneralB,
      householdId: FIXTURES.householdB,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(7_000),
      occurredOn: "2026-08-31",
      description: "S08 general opening B",
    },
  ]);
  await database.insert(accountEntries).values([
    {
      id: FIXTURES.entryGeneralA,
      financialEventId: FIXTURES.eventGeneralA,
      accountId: FIXTURES.accountGeneralA,
      householdId: FIXTURES.householdA,
      amountCents: BigInt(1_000),
      status: "POSTED",
      postedOn: "2026-08-31",
    },
    {
      id: FIXTURES.entryRestrictedA,
      financialEventId: FIXTURES.eventRestrictedA,
      accountId: FIXTURES.accountRestrictedA,
      householdId: FIXTURES.householdA,
      amountCents: BigInt(9_000),
      status: "POSTED",
      postedOn: "2026-08-31",
    },
    {
      id: FIXTURES.entryExcludedA,
      financialEventId: FIXTURES.eventExcludedA,
      accountId: FIXTURES.accountExcludedA,
      householdId: FIXTURES.householdA,
      amountCents: BigInt(5_000),
      status: "POSTED",
      postedOn: "2026-08-31",
    },
    {
      id: FIXTURES.entryGeneralB,
      financialEventId: FIXTURES.eventGeneralB,
      accountId: FIXTURES.accountGeneralB,
      householdId: FIXTURES.householdB,
      amountCents: BigInt(7_000),
      status: "POSTED",
      postedOn: "2026-08-31",
    },
  ]);
  await database.insert(spendableSettings).values([
    {
      id: FIXTURES.settingA,
      householdId: FIXTURES.householdA,
      effectiveFrom: "2026-08-01",
      operationalBufferCents: BigInt(100),
    },
    {
      id: FIXTURES.settingAFuture,
      householdId: FIXTURES.householdA,
      effectiveFrom: "2026-09-01",
      operationalBufferCents: BigInt(300),
    },
    {
      id: FIXTURES.settingB,
      householdId: FIXTURES.householdB,
      effectiveFrom: "2026-08-01",
      operationalBufferCents: BigInt(900),
    },
  ]);
}

integration("S08 T06 PostgreSQL tenant-safe availability", () => {
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

  it("sums only POSTED GENERAL entries and picks the effective tenant buffer", async () => {
    const result = await getSpendable(
      { asOf: "2026-08-31", horizon: { days: 1 } },
      { database, resolveContext: () => contextA },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        openingBalanceCents: "1000",
        operationalBuffer: {
          amountCents: "100",
          source: "CONFIGURED",
          effectiveFrom: "2026-08-01",
          revision: FIXTURES.settingA,
        },
        rawSpendableCents: "900",
      },
    });
    expect(JSON.stringify(result)).not.toContain("9000");
    expect(JSON.stringify(result)).not.toContain("5000");
  });

  it("keeps households isolated while selecting each household's own setting", async () => {
    const databaseValue = dbOrThrow(database);
    const resultA = await getSpendable(
      { asOf: "2026-08-31", horizon: { days: 1 } },
      { database: databaseValue, resolveContext: () => contextA },
    );
    const resultB = await getSpendable(
      { asOf: "2026-08-31", horizon: { days: 1 } },
      { database: databaseValue, resolveContext: () => contextB },
    );

    expect(resultA).toMatchObject({ ok: true, value: { openingBalanceCents: "1000" } });
    expect(resultB).toMatchObject({
      ok: true,
      value: {
        openingBalanceCents: "7000",
        operationalBuffer: { amountCents: "900", revision: FIXTURES.settingB },
      },
    });
    const serializedA = JSON.stringify(resultA);
    const serializedB = JSON.stringify(resultB);
    expect(serializedA).not.toContain('"openingBalanceCents":"7000"');
    expect(serializedA).not.toContain('"rawSpendableCents":"7000"');
    expect(serializedB).not.toContain('"openingBalanceCents":"1000"');
    expect(serializedB).not.toContain('"rawSpendableCents":"1000"');
  });
});
