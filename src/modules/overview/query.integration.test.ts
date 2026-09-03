import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  cleanupS10VolumeFixtures,
  createS10VolumeContexts,
  S10_VOLUME_AS_OF,
  S10_VOLUME_IDS,
  seedS10VolumeFixtures,
} from "../../../tests/fixtures/s10-visao-consolidada/seed";

import { civilMonthPeriod } from "./period";
import {
  assertGroupsReconcileWithTotal,
  explainPeriodAggregationQuery,
  readPeriodAggregationForContext,
} from "./query";

const integration =
  process.env.T10_INTEGRATION === "1" ? describe : describe.skip;

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T10 não foi inicializado.");
  }
  return database;
}

integration("T10 overview period aggregation", () => {
  const contexts = createS10VolumeContexts();
  const period = civilMonthPeriod(S10_VOLUME_AS_OF);
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar T10_INTEGRATION=1.",
      );
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = databaseOrThrow(database);
    await cleanupS10VolumeFixtures(db);
    await seedS10VolumeFixtures(db);
  });

  afterAll(async () => {
    if (database) {
      await cleanupS10VolumeFixtures(database);
      await closeDb();
    }
  });

  it("does not let a neighbor household affect totals", async () => {
    const db = databaseOrThrow(database);
    const result = await readPeriodAggregationForContext(contexts.a, period, {
      database: db,
    });

    expect(result.summary.purchaseEventCount).toBe(1);
    expect(result.summary.expenseEventCount).toBeGreaterThanOrEqual(9);
    assertGroupsReconcileWithTotal(result);
    expect(JSON.stringify(result)).not.toContain(S10_VOLUME_IDS.households.b);
    expect(JSON.stringify(result)).not.toContain("T09 expense B");
  });

  it("counts purchase once when a payment transfer exists in the same period", async () => {
    const db = databaseOrThrow(database);
    const result = await readPeriodAggregationForContext(contexts.a, period, {
      database: db,
    });

    expect(result.summary.purchaseEventCount).toBe(1);
    const cardGroup = result.groups.find(
      (group) => group.key === S10_VOLUME_IDS.categories.aCard,
    );
    expect(cardGroup?.amountCents).toBe("48000");
    expect(cardGroup?.purchaseEventCount).toBe(1);
    expect(result.summary.expenseCents).toBe(result.totalExpenseCents);
    expect(JSON.stringify(result)).not.toContain(S10_VOLUME_IDS.events.transferA);
    assertGroupsReconcileWithTotal(result);
  });

  it("keeps household B isolated from household A", async () => {
    const db = databaseOrThrow(database);
    const resultA = await readPeriodAggregationForContext(contexts.a, period, {
      database: db,
    });
    const resultB = await readPeriodAggregationForContext(contexts.b, period, {
      database: db,
    });

    expect(resultA.summary.expenseCents).not.toBe(resultB.summary.expenseCents);
    expect(resultB.summary.expenseCents).not.toBe("0");
    expect(resultB.groups.length).toBeGreaterThan(0);
    assertGroupsReconcileWithTotal(resultA);
    assertGroupsReconcileWithTotal(resultB);

    const serializedB = JSON.stringify(resultB);
    expect(serializedB).not.toContain(S10_VOLUME_IDS.households.a);
    expect(serializedB).not.toContain("T09 salary A");
    expect(serializedB).not.toContain(S10_VOLUME_IDS.categories.aFood);
  });

  it("rejects forged neighbor identifiers in category groups", async () => {
    const db = databaseOrThrow(database);
    const result = await readPeriodAggregationForContext(contexts.a, period, {
      database: db,
    });

    const groupKeys = result.groups.map((group) => group.key);
    expect(groupKeys).not.toContain(S10_VOLUME_IDS.categories.bFood);
    expect(groupKeys).not.toContain(S10_VOLUME_IDS.categories.bOther);
    expect(JSON.stringify(result)).not.toContain(S10_VOLUME_IDS.events.purchaseB);
    expect(JSON.stringify(result)).not.toContain("T09 single purchase B");
  });

  it("documents the period query plan for EXPLAIN review", async () => {
    const db = databaseOrThrow(database);
    const plan = await explainPeriodAggregationQuery(contexts.a, period, {
      database: db,
    });

    expect(plan).toMatch(/financial_events/i);
    expect(plan).toMatch(/household/i);
  });
});

// Opt-in PostgreSQL reconciliation for T06/T13. Enable with `T10_INTEGRATION=1`.
