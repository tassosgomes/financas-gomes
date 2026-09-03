import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";

import {
  S11_DATASET_IDS,
  readExportDataset,
  type ExportDatasetRow,
  type S11DatasetId,
} from "./reads";
import {
  collectExportRows,
  readSourceDatasetIds,
} from "../../../tests/fixtures/s11-operacao-confiavel/export-integration-helpers";
import {
  cleanupS11IntegrationHouseholds,
  contextA,
  contextEmpty,
  foreignIdsForHouseholdB,
  seedS11IntegrationHouseholds,
  S11_INTEGRATION_FIXTURES,
} from "../../../tests/fixtures/s11-operacao-confiavel/integration-fixtures";

const integration =
  process.env.S11_INTEGRATION === "1" ? describe : describe.skip;

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco PostgreSQL de integração S11 T06 não foi inicializado.");
  }
  return database;
}

async function readDatasetRows(
  database: Database,
  datasetId: S11DatasetId,
  filters?: Parameters<typeof readExportDataset>[2],
): Promise<ExportDatasetRow[]> {
  const result = await readExportDataset(contextA, datasetId, {
    ...filters,
    database,
  });
  expect(result.availability).toBe("AVAILABLE");
  return collectExportRows(result.rows);
}

integration("S11 export reads tenant isolation", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar S11_INTEGRATION=1.",
      );
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = databaseOrThrow(database);
    await cleanupS11IntegrationHouseholds(db);
    await seedS11IntegrationHouseholds(db);
  });

  afterAll(async () => {
    if (database) {
      await cleanupS11IntegrationHouseholds(database);
    }
    await closeDb();
  });

  it.each(S11_DATASET_IDS)(
    "never returns household B rows for dataset %s when context is A",
    async (datasetId) => {
      const db = databaseOrThrow(database);
      const rows = await readDatasetRows(db, datasetId);
      const foreignIds = new Set(foreignIdsForHouseholdB());

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        for (const value of Object.values(row)) {
          if (typeof value === "string" && foreignIds.has(value)) {
            throw new Error(
              `Dataset ${datasetId} vazou id de outro espaço: ${value}`,
            );
          }
        }
        expect(row).not.toHaveProperty("householdId");
      }
    },
  );

  it("returns zero rows for an empty household without error", async () => {
    const db = databaseOrThrow(database);
    for (const datasetId of S11_DATASET_IDS) {
      const result = await readExportDataset(contextEmpty, datasetId, {
        database: db,
      });
      expect(result.availability).toBe("AVAILABLE");
      const rows = await collectExportRows(result.rows);
      expect(rows).toEqual([]);
    }
  });

  it("treats foreign account and category filters as absence for financial datasets", async () => {
    const db = databaseOrThrow(database);
    const eventRows = await readDatasetRows(db, "financial_events", {
      filters: {
        accountId: S11_INTEGRATION_FIXTURES.accounts.checkingB,
        categoryId: S11_INTEGRATION_FIXTURES.categories.b,
      },
    });
    const entryRows = await readDatasetRows(db, "account_entries", {
      filters: {
        accountId: S11_INTEGRATION_FIXTURES.accounts.checkingB,
        categoryId: S11_INTEGRATION_FIXTURES.categories.b,
      },
    });

    expect(eventRows).toEqual([]);
    expect(entryRows).toEqual([]);
  });

  it("returns zero financial rows when valid filters exclude every event", async () => {
    const db = databaseOrThrow(database);
    const eventRows = await readDatasetRows(db, "financial_events", {
      filters: {
        from: "2099-01-01",
        to: "2099-12-31",
      },
    });
    const entryRows = await readDatasetRows(db, "account_entries", {
      filters: {
        from: "2099-01-01",
        to: "2099-12-31",
      },
    });

    expect(eventRows).toEqual([]);
    expect(entryRows).toEqual([]);
  });

  it("keeps non-transaction datasets complete when transaction filters are provided", async () => {
    const db = databaseOrThrow(database);
    const accountRows = await readDatasetRows(db, "accounts", {
      filters: {
        from: "2099-01-01",
        accountId: S11_INTEGRATION_FIXTURES.accounts.checkingB,
      },
    });
    expect(accountRows.some((row) => row.id === S11_INTEGRATION_FIXTURES.accounts.checkingA)).toBe(
      true,
    );
  });

  it.each(S11_DATASET_IDS)(
    "reconciles exported ids for dataset %s with the source read order",
    async (datasetId) => {
      const db = databaseOrThrow(database);
      const ids = await readSourceDatasetIds(db, contextA, datasetId);
      const rows = await readDatasetRows(db, datasetId);
      expect(rows.map((row) => String(row.id))).toEqual(ids);
    },
  );

  it("filters financial events by kind, status and date range from the transactions screen", async () => {
    const db = databaseOrThrow(database);
    const rows = await readDatasetRows(db, "financial_events", {
      filters: {
        from: "2026-02-01",
        to: "2026-02-15",
        kind: "EXPENSE",
        status: "POSTED",
        accountId: S11_INTEGRATION_FIXTURES.accounts.checkingA,
        categoryId: S11_INTEGRATION_FIXTURES.categories.a,
      },
    });

    expect(rows.map((row) => row.id)).toEqual([S11_INTEGRATION_FIXTURES.events.a]);
  });
});
