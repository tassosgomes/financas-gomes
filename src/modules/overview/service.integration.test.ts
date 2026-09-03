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
import { readPeriodAggregationForContext } from "./query";
import { getOverviewForContext } from "./service";

const integration =
  process.env.T10_INTEGRATION === "1" ? describe : describe.skip;

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T10 não foi inicializado.");
  }
  return database;
}

integration("overview service integration", () => {
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

  it("isolates households and reconciles expense totals with aggregation", async () => {
    const db = databaseOrThrow(database);
    const aggregationA = await readPeriodAggregationForContext(contexts.a, period, {
      database: db,
    });
    const aggregationB = await readPeriodAggregationForContext(contexts.b, period, {
      database: db,
    });

    const resultA = await getOverviewForContext(
      contexts.a,
      { asOf: S10_VOLUME_AS_OF },
      { database: db },
    );
    const resultB = await getOverviewForContext(
      contexts.b,
      { asOf: S10_VOLUME_AS_OF },
      { database: db },
    );

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    if (!resultA.ok || !resultB.ok) return;

    expect(resultA.value.expensesByCategory.data?.totalExpenseCents).toBe(
      aggregationA.totalExpenseCents,
    );
    expect(resultA.value.periodSummary.data?.expenseCents).toBe(
      aggregationA.summary.expenseCents,
    );
    expect(resultB.value.expensesByCategory.data?.totalExpenseCents).toBe(
      aggregationB.totalExpenseCents,
    );
    expect(resultB.value.periodSummary.data?.expenseCents).toBe(
      aggregationB.summary.expenseCents,
    );
    expect(aggregationA.summary.expenseCents).not.toBe(
      aggregationB.summary.expenseCents,
    );

    const serializedA = JSON.stringify(resultA.value);
    const serializedB = JSON.stringify(resultB.value);
    expect(serializedA).not.toContain(S10_VOLUME_IDS.households.b);
    expect(serializedB).not.toContain(S10_VOLUME_IDS.households.a);
    expect(serializedA).not.toContain("T09 expense B");
    expect(serializedB).not.toContain("T09 installment purchase A");
  });

  it("does not leak neighbor names, references or links through forged context", async () => {
    const db = databaseOrThrow(database);
    const result = await getOverviewForContext(
      contexts.a,
      { asOf: S10_VOLUME_AS_OF },
      { database: db },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain(S10_VOLUME_IDS.categories.bFood);
    expect(serialized).not.toContain(S10_VOLUME_IDS.categories.bOther);
    expect(serialized).not.toContain(S10_VOLUME_IDS.events.purchaseB);
    expect(serialized).not.toContain(S10_VOLUME_IDS.events.transferA);
    expect(serialized).not.toContain("T09 single purchase B");
    expect(serialized).not.toContain("Alimentação B");
    expect(serialized).not.toContain("householdId");
  });
});

// Opt-in PostgreSQL reconciliation for T06/T13. Enable with `T10_INTEGRATION=1`.
