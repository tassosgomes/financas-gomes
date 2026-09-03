import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import { financialEvents } from "@/db/schema";
import {
  OVERVIEW_BLOCK_TIMEOUT_MS,
  OVERVIEW_SLOW_QUERY_THRESHOLD_MS,
} from "@/modules/observability/s10";
import {
  cleanupS10VolumeFixtures,
  createS10VolumeContexts,
  describeS10VolumeSeed,
  S10_VOLUME_AS_OF,
  S10_VOLUME_EXPECTED_INDEXES,
  S10_VOLUME_HOUSEHOLD_IDS,
  S10_VOLUME_IDS,
  seedS10VolumeFixtures,
} from "../../../tests/fixtures/s10-visao-consolidada/seed";

import { civilMonthPeriod } from "./period";
import {
  explainPeriodAggregationQuery,
  readPeriodAggregationForContext,
} from "./query";

const integration =
  process.env.T10_INTEGRATION === "1" ? describe : describe.skip;

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T09 não foi inicializado.");
  }
  return database;
}

integration("T09 overview volume seed and query plan", () => {
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

  it("documents the T09 performance budget constants", () => {
    expect(OVERVIEW_SLOW_QUERY_THRESHOLD_MS).toBe(500);
    expect(OVERVIEW_BLOCK_TIMEOUT_MS).toBe(2_500);
  });

  it("seeds representative volume with deterministic counts", async () => {
    const stats = describeS10VolumeSeed();
    expect(stats.months).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(stats.categoryCount).toBeGreaterThanOrEqual(16);

    const db = databaseOrThrow(database);
    const counts = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(financialEvents)
      .where(inArray(financialEvents.householdId, S10_VOLUME_HOUSEHOLD_IDS));

    const total = Number(counts[0]?.count ?? 0);
    expect(total).toBeGreaterThanOrEqual(50);
    expect(total).toBeLessThanOrEqual(200);
    expect(total).toBe(stats.financialEventCount);
  });

  it("excludes TRANSFER from period aggregation while counting purchase once", async () => {
    const db = databaseOrThrow(database);
    const result = await readPeriodAggregationForContext(contexts.a, period, {
      database: db,
    });

    expect(result.summary.purchaseEventCount).toBe(1);
    expect(result.summary.expenseEventCount).toBeGreaterThanOrEqual(9);

    const transferRows = await db
      .select({ id: financialEvents.id })
      .from(financialEvents)
      .where(eq(financialEvents.id, S10_VOLUME_IDS.events.transferA));
    expect(transferRows).toHaveLength(1);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(S10_VOLUME_IDS.events.transferA);
  });

  it("documents tenant-aware indexes for the period aggregation query", async () => {
    const db = databaseOrThrow(database);
    const plan = await explainPeriodAggregationQuery(contexts.a, period, {
      database: db,
    });

    expect(plan).toMatch(/financial_events/i);
    expect(plan).toMatch(/household/i);
    expect(plan).not.toMatch(/Seq Scan on financial_events/i);

    const matchedIndex = S10_VOLUME_EXPECTED_INDEXES.some(
      (indexName: string) => plan.includes(indexName),
    );
    expect(matchedIndex).toBe(true);
  });

  it("records EXPLAIN (ANALYZE) for T13/T15 when PostgreSQL is available", async () => {
    const db = databaseOrThrow(database);
    const plan = await explainPeriodAggregationQuery(contexts.a, period, {
      database: db,
      analyze: true,
    });

    expect(plan).toMatch(/Execution Time/i);
    expect(plan).toMatch(/financial_events/i);
  });
});
