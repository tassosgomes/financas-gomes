import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import { S11_DATASET_FILE_NAMES, S11_DATASET_IDS } from "@/modules/export/contract";
import {
  exportHouseholdData,
  maskManifestGeneratedAt,
  resetExportRateLimitStateForTests,
  S11_EXPORT_ARCHIVE_NAME,
  S11_EXPORT_MAX_DURATION_MS,
} from "@/modules/export/use-cases";
import { listZipEntryNames, readZipEntryText } from "@/modules/export/zip";
import {
  assertNoForbiddenObservabilityPayload,
  parseExportedCsvIds,
  reconcileExportZipWithSource,
  readExportedDatasetIds,
} from "../../../tests/fixtures/s11-operacao-confiavel/export-integration-helpers";
import {
  cleanupS11IntegrationHouseholds,
  contextA,
  contextEmpty,
  contextVolume,
  foreignIdsForHouseholdB,
  seedS11IntegrationHouseholds,
  seedS11VolumeHousehold,
  S11_INTEGRATION_FIXTURES,
  S11_VOLUME_MAX_EXPORT_MS,
  S11_VOLUME_TARGETS,
} from "../../../tests/fixtures/s11-operacao-confiavel/integration-fixtures";

const integration =
  process.env.S11_INTEGRATION === "1" ? describe : describe.skip;

const volumeIntegration =
  process.env.S11_VOLUME_INTEGRATION === "1" ? describe : describe.skip;

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error(
      "O banco PostgreSQL de integração S11 T07 não foi inicializado.",
    );
  }
  return database;
}

integration("S11 export use-case integration", () => {
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
    resetExportRateLimitStateForTests();
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

  it("never leaks household B rows into household A export CSVs", async () => {
    const foreignIds = new Set(foreignIdsForHouseholdB());
    const result = await exportHouseholdData(contextA, {}, {
      correlationId: "integration-isolation",
      generatedAt: () => "2026-09-03T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const zipText = result.zip.toString("utf8");
    for (const foreignId of foreignIds) {
      expect(zipText).not.toContain(foreignId);
    }
    expect(result.manifest.rowCountTotal).toBeGreaterThan(0);
  });

  it.each(S11_DATASET_IDS)(
    "isolates dataset %s in the exported ZIP from household B rows",
    async (datasetId) => {
      const result = await exportHouseholdData(contextA, {}, {
        correlationId: `integration-isolation-${datasetId}`,
        generatedAt: () => "2026-09-03T12:00:00.000Z",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const exportedIds = await readExportedDatasetIds(result.zip, datasetId);
      const foreignIds = new Set(foreignIdsForHouseholdB());
      for (const exportedId of exportedIds) {
        expect(foreignIds.has(exportedId)).toBe(false);
      }
    },
  );

  it("produces a valid ZIP for an empty household", async () => {
    const result = await exportHouseholdData(contextEmpty, {}, {
      correlationId: "integration-empty",
      generatedAt: () => "2026-09-03T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest.rowCountTotal).toBe(0);
    expect(listZipEntryNames(result.zip)).toEqual([
      "manifest.json",
      ...S11_DATASET_IDS.map((id) => S11_DATASET_FILE_NAMES[id]),
    ]);

    const fixtureDir = join(
      process.cwd(),
      "tests/fixtures/s11-operacao-confiavel",
    );
    writeFileSync(
      join(fixtureDir, "empty-export-manifest.json"),
      `${JSON.stringify(maskManifestGeneratedAt(result.manifest), null, 2)}\n`,
      "utf8",
    );
  });

  it("exports a full household and reconciles every dataset id with the source reads", async () => {
    const result = await exportHouseholdData(contextA, {}, {
      correlationId: "integration-full-reconcile",
      generatedAt: () => "2026-09-03T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest.rowCountTotal).toBeGreaterThan(0);
    expect(result.fileName).toBe(S11_EXPORT_ARCHIVE_NAME);
    await reconcileExportZipWithSource(databaseOrThrow(database), contextA, result.zip);
  });

  it("applies transaction filters to financial datasets and keeps catalog datasets complete", async () => {
    const filters = {
      from: "2026-02-01",
      to: "2026-02-01",
      kind: "EXPENSE" as const,
      status: "POSTED" as const,
      accountId: S11_INTEGRATION_FIXTURES.accounts.checkingA,
      categoryId: S11_INTEGRATION_FIXTURES.categories.a,
    };

    const result = await exportHouseholdData(contextA, { filters }, {
      correlationId: "integration-filters",
      generatedAt: () => "2026-09-03T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest.filtersApplied).toEqual(filters);
    const eventIds = parseExportedCsvIds(
      readZipEntryText(result.zip, S11_DATASET_FILE_NAMES.financial_events),
    );
    expect(eventIds).toEqual([S11_INTEGRATION_FIXTURES.events.a]);

    const accountIds = parseExportedCsvIds(
      readZipEntryText(result.zip, S11_DATASET_FILE_NAMES.accounts),
    );
    expect(accountIds).toContain(S11_INTEGRATION_FIXTURES.accounts.checkingA);
  });

  it("returns header-only financial datasets when filters match no rows", async () => {
    const filters = {
      from: "2099-01-01",
      to: "2099-12-31",
    };

    const result = await exportHouseholdData(contextA, { filters }, {
      correlationId: "integration-empty-filter",
      generatedAt: () => "2026-09-03T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const eventCsv = readZipEntryText(
      result.zip,
      S11_DATASET_FILE_NAMES.financial_events,
    );
    const entryCsv = readZipEntryText(
      result.zip,
      S11_DATASET_FILE_NAMES.account_entries,
    );
    expect(parseExportedCsvIds(eventCsv)).toEqual([]);
    expect(parseExportedCsvIds(entryCsv)).toEqual([]);

    const eventsDataset = result.manifest.datasets.find(
      (dataset) => dataset.id === "financial_events",
    );
    expect(eventsDataset?.rowCount).toBe(0);
  });

  it("redacts forbidden fields from manifest, filename and error payloads", async () => {
    const success = await exportHouseholdData(contextA, {}, {
      correlationId: "integration-redaction-success",
      generatedAt: () => "2026-09-03T12:00:00.000Z",
    });
    expect(success.ok).toBe(true);
    if (!success.ok) return;

    assertNoForbiddenObservabilityPayload(JSON.stringify(success.manifest));
    assertNoForbiddenObservabilityPayload(success.fileName);
    assertNoForbiddenObservabilityPayload(
      readZipEntryText(success.zip, "manifest.json"),
    );

    const tenancyRejected = await exportHouseholdData(
      contextA,
      { householdId: contextA.householdId },
      { correlationId: "integration-redaction-error" },
    );
    expect(tenancyRejected.ok).toBe(false);
    if (tenancyRejected.ok) return;
    assertNoForbiddenObservabilityPayload(JSON.stringify(tenancyRejected));
  });
});

volumeIntegration("S11 export volume integration", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL antes de executar S11_VOLUME_INTEGRATION=1.",
      );
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    resetExportRateLimitStateForTests();
    const db = databaseOrThrow(database);
    await cleanupS11IntegrationHouseholds(db);
    await seedS11VolumeHousehold(db);
  });

  afterAll(async () => {
    if (database) {
      await cleanupS11IntegrationHouseholds(database);
    }
    await closeDb();
  });

  it("exports representative volume within the ADR time limit", async () => {
    const startedAt = performance.now();
    const result = await exportHouseholdData(contextVolume, {}, {
      correlationId: "integration-volume",
      generatedAt: () => "2026-09-03T12:00:00.000Z",
    });
    const durationMs = performance.now() - startedAt;

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const eventsDataset = result.manifest.datasets.find(
      (dataset) => dataset.id === "financial_events",
    );
    const entriesDataset = result.manifest.datasets.find(
      (dataset) => dataset.id === "account_entries",
    );
    expect(eventsDataset?.rowCount).toBe(S11_VOLUME_TARGETS.financial_events);
    expect(entriesDataset?.rowCount).toBe(S11_VOLUME_TARGETS.account_entries);
    expect(durationMs).toBeLessThan(S11_VOLUME_MAX_EXPORT_MS);
    expect(S11_EXPORT_MAX_DURATION_MS).toBe(S11_VOLUME_MAX_EXPORT_MS);

    await reconcileExportZipWithSource(
      databaseOrThrow(database),
      contextVolume,
      result.zip,
    );

    // Recorded by T14 task file after test run.
    process.stdout.write(
      `\n[S11_VOLUME_EXPORT_MS] ${Math.round(durationMs)}\n`,
    );
  });
});
