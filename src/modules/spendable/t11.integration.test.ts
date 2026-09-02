import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  financialEvents,
  households,
  plannedEvents,
  spendableSettings,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";

import {
  readSpendableBufferForContext,
  readSpendableOpeningBalanceForContext,
} from "./query";
import { getSpendable } from "./service";

/** T11 integration is opt-in and always targets a real PostgreSQL database. */
const integration =
  process.env.T11_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  householdA: "00000000-0000-7000-8000-000000081101",
  householdB: "00000000-0000-7000-8000-000000081102",
  rollbackHousehold: "00000000-0000-7000-8000-000000081103",
  accountGeneralA: "00000000-0000-7000-8000-000000081111",
  accountRestrictedA: "00000000-0000-7000-8000-000000081112",
  accountExcludedA: "00000000-0000-7000-8000-000000081113",
  accountGeneralB: "00000000-0000-7000-8000-000000081114",
  rollbackAccount: "00000000-0000-7000-8000-000000081115",
  openingEventA: "00000000-0000-7000-8000-000000081121",
  restrictedEventA: "00000000-0000-7000-8000-000000081122",
  excludedEventA: "00000000-0000-7000-8000-000000081123",
  openingEventB: "00000000-0000-7000-8000-000000081124",
  futureEventA: "00000000-0000-7000-8000-000000081125",
  rollbackEvent: "00000000-0000-7000-8000-000000081126",
  openingEntryA: "00000000-0000-7000-8000-000000081131",
  restrictedEntryA: "00000000-0000-7000-8000-000000081132",
  excludedEntryA: "00000000-0000-7000-8000-000000081133",
  openingEntryB: "00000000-0000-7000-8000-000000081134",
  futureEntryA: "00000000-0000-7000-8000-000000081135",
  rollbackEntry: "00000000-0000-7000-8000-000000081136",
  knownExpense: "00000000-0000-7000-8000-000000081141",
  uncertainIncome: "00000000-0000-7000-8000-000000081142",
  cancelledExpense: "00000000-0000-7000-8000-000000081143",
  settingA: "00000000-0000-7000-8000-000000081151",
  settingAFuture: "00000000-0000-7000-8000-000000081152",
} as const;

const CONTEXT_A: FinancialContext = {
  userId: "t11-s08-user-a",
  householdId: FIXTURES.householdA,
};
const CONTEXT_B: FinancialContext = {
  userId: "t11-s08-user-b",
  householdId: FIXTURES.householdB,
};

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco PostgreSQL T11 não foi inicializado.");
  }
  return database;
}

async function cleanup(database: Database): Promise<void> {
  await database
    .delete(plannedEvents)
    .where(inArray(plannedEvents.id, [
      FIXTURES.knownExpense,
      FIXTURES.uncertainIncome,
      FIXTURES.cancelledExpense,
    ]));
  await database
    .delete(spendableSettings)
    .where(inArray(spendableSettings.id, [FIXTURES.settingA, FIXTURES.settingAFuture]));
  await database
    .delete(accountEntries)
    .where(inArray(accountEntries.id, [
      FIXTURES.openingEntryA,
      FIXTURES.restrictedEntryA,
      FIXTURES.excludedEntryA,
      FIXTURES.openingEntryB,
      FIXTURES.futureEntryA,
      FIXTURES.rollbackEntry,
    ]));
  await database
    .delete(financialEvents)
    .where(inArray(financialEvents.id, [
      FIXTURES.openingEventA,
      FIXTURES.restrictedEventA,
      FIXTURES.excludedEventA,
      FIXTURES.openingEventB,
      FIXTURES.futureEventA,
      FIXTURES.rollbackEvent,
    ]));
  await database
    .delete(accounts)
    .where(inArray(accounts.id, [
      FIXTURES.accountGeneralA,
      FIXTURES.accountRestrictedA,
      FIXTURES.accountExcludedA,
      FIXTURES.accountGeneralB,
      FIXTURES.rollbackAccount,
    ]));
  await database
    .delete(households)
    .where(inArray(households.id, [
      FIXTURES.householdA,
      FIXTURES.householdB,
      FIXTURES.rollbackHousehold,
    ]));
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.householdA, name: "T11 S08 household A" },
    { id: FIXTURES.householdB, name: "T11 S08 household B" },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accountGeneralA,
      householdId: FIXTURES.householdA,
      name: "T11 S08 general A",
      type: "CHECKING",
      spendability: "GENERAL",
    },
    {
      id: FIXTURES.accountRestrictedA,
      householdId: FIXTURES.householdA,
      name: "T11 S08 restricted A",
      type: "BENEFIT",
      spendability: "RESTRICTED",
    },
    {
      id: FIXTURES.accountExcludedA,
      householdId: FIXTURES.householdA,
      name: "T11 S08 excluded A",
      type: "INVESTMENT",
      spendability: "EXCLUDED",
    },
    {
      id: FIXTURES.accountGeneralB,
      householdId: FIXTURES.householdB,
      name: "T11 S08 general B",
      type: "CHECKING",
      spendability: "GENERAL",
    },
  ]);
  await database.insert(financialEvents).values([
    {
      id: FIXTURES.openingEventA,
      householdId: FIXTURES.householdA,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(1_000),
      occurredOn: "2026-08-31",
      description: "T11 S08 general opening",
    },
    {
      id: FIXTURES.restrictedEventA,
      householdId: FIXTURES.householdA,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(9_000),
      occurredOn: "2026-08-31",
      description: "T11 S08 restricted balance",
    },
    {
      id: FIXTURES.excludedEventA,
      householdId: FIXTURES.householdA,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(5_000),
      occurredOn: "2026-08-31",
      description: "T11 S08 excluded balance",
    },
    {
      id: FIXTURES.openingEventB,
      householdId: FIXTURES.householdB,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(7_000),
      occurredOn: "2026-08-31",
      description: "T11 S08 other household opening",
    },
    {
      id: FIXTURES.futureEventA,
      householdId: FIXTURES.householdA,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(750),
      occurredOn: "2026-09-02",
      description: "T11 S08 future posted expense",
    },
  ]);
  await database.insert(accountEntries).values([
    {
      id: FIXTURES.openingEntryA,
      financialEventId: FIXTURES.openingEventA,
      accountId: FIXTURES.accountGeneralA,
      householdId: FIXTURES.householdA,
      amountCents: BigInt(1_000),
      status: "POSTED",
      postedOn: "2026-08-31",
    },
    {
      id: FIXTURES.restrictedEntryA,
      financialEventId: FIXTURES.restrictedEventA,
      accountId: FIXTURES.accountRestrictedA,
      householdId: FIXTURES.householdA,
      amountCents: BigInt(9_000),
      status: "POSTED",
      postedOn: "2026-08-31",
    },
    {
      id: FIXTURES.excludedEntryA,
      financialEventId: FIXTURES.excludedEventA,
      accountId: FIXTURES.accountExcludedA,
      householdId: FIXTURES.householdA,
      amountCents: BigInt(5_000),
      status: "POSTED",
      postedOn: "2026-08-31",
    },
    {
      id: FIXTURES.openingEntryB,
      financialEventId: FIXTURES.openingEventB,
      accountId: FIXTURES.accountGeneralB,
      householdId: FIXTURES.householdB,
      amountCents: BigInt(7_000),
      status: "POSTED",
      postedOn: "2026-08-31",
    },
    {
      id: FIXTURES.futureEntryA,
      financialEventId: FIXTURES.futureEventA,
      accountId: FIXTURES.accountGeneralA,
      householdId: FIXTURES.householdA,
      amountCents: BigInt(-750),
      status: "POSTED",
      postedOn: "2026-09-02",
    },
  ]);
  await database.insert(plannedEvents).values([
    {
      id: FIXTURES.knownExpense,
      householdId: FIXTURES.householdA,
      accountId: FIXTURES.accountGeneralA,
      kind: "EXPENSE",
      status: "PLANNED",
      amountCents: BigInt(200),
      expectedOn: "2026-09-01",
      description: "T11 S08 reliable future expense",
      includeInConservativeForecast: true,
    },
    {
      id: FIXTURES.uncertainIncome,
      householdId: FIXTURES.householdA,
      accountId: FIXTURES.accountGeneralA,
      kind: "INCOME",
      status: "EXPECTED",
      amountCents: BigInt(500),
      expectedOn: "2026-09-01",
      description: "T11 S08 uncertain future income",
      includeInConservativeForecast: false,
    },
    {
      id: FIXTURES.cancelledExpense,
      householdId: FIXTURES.householdA,
      accountId: FIXTURES.accountGeneralA,
      kind: "EXPENSE",
      status: "CANCELLED",
      amountCents: BigInt(900_000),
      expectedOn: "2026-09-01",
      description: "T11 S08 cancelled future expense",
      includeInConservativeForecast: true,
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
  ]);
}

integration("T11 S08 PostgreSQL source and tenant boundaries", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar T11_INTEGRATION=1.",
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

  it("sums only POSTED GENERAL entries and excludes RESTRICTED/EXCLUDED balances", async () => {
    const db = databaseOrThrow(database);
    const opening = await readSpendableOpeningBalanceForContext(
      CONTEXT_A,
      "2026-08-31",
      { database: db },
    );

    expect(opening).toMatchObject({
      householdId: FIXTURES.householdA,
      asOf: "2026-08-31",
      openingBalanceCents: "1000",
      generalAccountCount: 1,
    });
    expect(JSON.stringify(opening)).not.toContain("9000");
    expect(JSON.stringify(opening)).not.toContain("5000");
  });

  it("applies effective-dated buffers, defaults absent configuration to zero, and honors date boundaries", async () => {
    const db = databaseOrThrow(database);
    const beforeFutureSetting = await readSpendableBufferForContext(
      CONTEXT_A,
      "2026-08-31",
      { database: db },
    );
    const onFutureSetting = await readSpendableBufferForContext(
      CONTEXT_A,
      "2026-09-01",
      { database: db },
    );
    const absent = await readSpendableBufferForContext(
      CONTEXT_B,
      "2026-08-31",
      { database: db },
    );
    const beforeFutureEntry = await readSpendableOpeningBalanceForContext(
      CONTEXT_A,
      "2026-09-01",
      { database: db },
    );
    const afterFutureEntry = await readSpendableOpeningBalanceForContext(
      CONTEXT_A,
      "2026-09-02",
      { database: db },
    );

    expect(beforeFutureSetting).toMatchObject({
      amountCents: "100",
      source: "CONFIGURED",
      effectiveFrom: "2026-08-01",
      revision: FIXTURES.settingA,
    });
    expect(onFutureSetting).toMatchObject({
      amountCents: "300",
      source: "CONFIGURED",
      effectiveFrom: "2026-09-01",
      revision: FIXTURES.settingAFuture,
    });
    expect(absent).toEqual({
      householdId: FIXTURES.householdB,
      amountCents: "0",
      source: "ABSENT_DEFAULT_ZERO",
      effectiveFrom: null,
      revision: null,
    });
    expect(beforeFutureEntry.openingBalanceCents).toBe("1000");
    expect(afterFutureEntry.openingBalanceCents).toBe("250");
  });

  it("composes horizon, certainty and cancellation through the real S07 reader", async () => {
    const db = databaseOrThrow(database);
    const conservative = await getSpendable(
      { asOf: "2026-08-31", scenario: "CONSERVATIVE", horizon: { days: 1 } },
      { database: db, resolveContext: () => CONTEXT_A },
    );
    const expected = await getSpendable(
      { asOf: "2026-08-31", scenario: "EXPECTED", horizon: { days: 1 } },
      { database: db, resolveContext: () => CONTEXT_A },
    );
    const extended = await getSpendable(
      { asOf: "2026-08-31", scenario: "EXPECTED", horizon: { days: 2 } },
      { database: db, resolveContext: () => CONTEXT_A },
    );

    expect(conservative).toMatchObject({
      ok: true,
      value: {
        period: { from: "2026-09-01", to: "2026-09-01", scenario: "CONSERVATIVE" },
        openingBalanceCents: "1000",
        minimumProjectedBalanceCents: "800",
        rawSpendableCents: "700",
        operationalBuffer: { amountCents: "100" },
      },
    });
    expect(expected).toMatchObject({
      ok: true,
      value: {
        period: { from: "2026-09-01", to: "2026-09-01", scenario: "EXPECTED" },
        minimumProjectedBalanceCents: "1000",
        rawSpendableCents: "900",
      },
    });
    expect(extended).toMatchObject({
      ok: true,
      value: {
        period: { from: "2026-09-01", to: "2026-09-02", horizonDays: 2 },
        minimumProjectedBalanceCents: "550",
        rawSpendableCents: "450",
      },
    });
    expect(JSON.stringify(conservative)).not.toContain("900000");
  });

  it("keeps households isolated, including the absent-buffer fallback", async () => {
    const db = databaseOrThrow(database);
    const resultA = await getSpendable(
      { asOf: "2026-08-31", horizon: { days: 1 } },
      { database: db, resolveContext: () => CONTEXT_A },
    );
    const resultB = await getSpendable(
      { asOf: "2026-08-31", horizon: { days: 1 } },
      { database: db, resolveContext: () => CONTEXT_B },
    );

    expect(resultA).toMatchObject({ ok: true, value: { openingBalanceCents: "1000" } });
    expect(resultB).toMatchObject({
      ok: true,
      value: {
        openingBalanceCents: "7000",
        operationalBuffer: { amountCents: "0", source: "ABSENT_DEFAULT_ZERO" },
        rawSpendableCents: "7000",
      },
    });
    expect(JSON.stringify(resultA)).not.toContain(FIXTURES.householdB);
    expect(JSON.stringify(resultB)).not.toContain("1000");
    expect(JSON.stringify(resultB)).not.toContain(FIXTURES.householdA);
  });

  it("rolls back a failed PostgreSQL transaction with no partial event or entry", async () => {
    const db = databaseOrThrow(database);

    await expect(
      db.transaction(async (transaction) => {
        await transaction.insert(households).values({
          id: FIXTURES.rollbackHousehold,
          name: "T11 rollback household",
        });
        await transaction.insert(accounts).values({
          id: FIXTURES.rollbackAccount,
          householdId: FIXTURES.rollbackHousehold,
          name: "T11 rollback account",
          type: "CHECKING",
          spendability: "GENERAL",
        });
        await transaction.insert(financialEvents).values({
          id: FIXTURES.rollbackEvent,
          householdId: FIXTURES.rollbackHousehold,
          kind: "EXPENSE",
          status: "POSTED",
          origin: "MANUAL",
          amountCents: BigInt(25),
          occurredOn: "2026-08-31",
          description: "T11 rollback event",
        });
        await transaction.insert(accountEntries).values({
          id: FIXTURES.rollbackEntry,
          financialEventId: FIXTURES.rollbackEvent,
          accountId: FIXTURES.rollbackAccount,
          householdId: FIXTURES.rollbackHousehold,
          amountCents: BigInt(-25),
          status: "POSTED",
          postedOn: "2026-08-31",
        });
        throw new Error("T11 injected failure");
      }),
    ).rejects.toThrow("T11 injected failure");

    const [householdRows, eventRows, entryRows] = await Promise.all([
      db
        .select({ id: households.id })
        .from(households)
        .where(eq(households.id, FIXTURES.rollbackHousehold)),
      db
        .select({ id: financialEvents.id })
        .from(financialEvents)
        .where(eq(financialEvents.id, FIXTURES.rollbackEvent)),
      db
        .select({ id: accountEntries.id })
        .from(accountEntries)
        .where(eq(accountEntries.id, FIXTURES.rollbackEntry)),
    ]);
    expect(householdRows).toEqual([]);
    expect(eventRows).toEqual([]);
    expect(entryRows).toEqual([]);
  });
});
