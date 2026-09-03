import { parse } from "csv-parse/sync";
import { expect } from "vitest";

import type { FinancialContext } from "@/modules/households/contracts";
import {
  S11_DATASET_FILE_NAMES,
  S11_DATASET_IDS,
  type S11DatasetId,
} from "@/modules/export/contract";
import {
  readExportDataset,
  type ExportDatasetRow,
  type S11TransactionFilters,
} from "@/modules/export/reads";
import { readZipEntryText } from "@/modules/export/zip";

import type { Database } from "@/db";

const FORBIDDEN_OBSERVABILITY_PATTERN =
  /householdId|userId|membro@|postgresql:\/\/|amount_cents|BETTER_AUTH_SECRET|Authorization|session=/iu;

export async function collectExportRows(
  generator: AsyncGenerator<ExportDatasetRow>,
): Promise<ExportDatasetRow[]> {
  const rows: ExportDatasetRow[] = [];
  for await (const row of generator) {
    rows.push(row);
  }
  return rows;
}

export async function readSourceDatasetIds(
  database: Database,
  context: FinancialContext,
  datasetId: S11DatasetId,
  filters?: S11TransactionFilters,
): Promise<string[]> {
  const result = await readExportDataset(context, datasetId, {
    database,
    filters,
  });
  const rows = await collectExportRows(result.rows);
  return rows.map((row) => String(row.id));
}

export function parseExportedCsvIds(csvText: string): string[] {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Array<Record<string, string>>;

  return records.map((row) => row.id).filter((id): id is string => Boolean(id));
}

export async function readExportedDatasetIds(
  zip: Buffer,
  datasetId: S11DatasetId,
): Promise<string[]> {
  const csvText = readZipEntryText(zip, S11_DATASET_FILE_NAMES[datasetId]);
  return parseExportedCsvIds(csvText);
}

export async function reconcileExportZipWithSource(
  database: Database,
  context: FinancialContext,
  zip: Buffer,
  filters?: S11TransactionFilters,
): Promise<void> {
  for (const datasetId of S11_DATASET_IDS) {
    const sourceIds = await readSourceDatasetIds(
      database,
      context,
      datasetId,
      filters,
    );
    const exportedIds = await readExportedDatasetIds(zip, datasetId);
    expect(exportedIds).toEqual(sourceIds);
  }
}

export function assertNoForbiddenObservabilityPayload(serialized: string): void {
  expect(serialized).not.toMatch(FORBIDDEN_OBSERVABILITY_PATTERN);
}
