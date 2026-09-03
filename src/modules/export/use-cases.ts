import { generateUuidV7 } from "@/lib/uuidv7";
import type { FinancialContext } from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import {
  instrumentS11ExportBoundary,
  wrapDatasetRead,
  type S11DatasetId as ObservabilityDatasetId,
} from "@/modules/observability/s11";

import {
  S11_CONTRACT_VERSION,
  S11_DATASET_COLUMNS,
  S11_DATASET_FILE_NAMES,
  S11_DATASET_IDS,
  type S11DatasetId,
} from "./contract";
import { encodeCsvDataLine, encodeCsvLine } from "./csv";
import {
  ExportReadError,
  readExportDataset,
  type ExportDatasetRow,
  type S11DatasetAvailability,
  type S11TransactionFilters,
} from "./reads";
import { createZipArchive } from "./zip";

export const S11_EXPORT_ARCHIVE_NAME = "financas-gomes-export-s11v1.zip" as const;
export const S11_EXPORT_MAX_DURATION_MS = 25_000;
export const S11_EXPORT_MAX_ZIP_BYTES = 50 * 1024 * 1024;
export const S11_EXPORT_RATE_LIMIT_MS = 60_000;
export const S11_MANIFEST_FILE_NAME = "manifest.json" as const;

export type S11UnavailableReason = "SLICE_NOT_PUBLISHED" | "READING_NOT_READY";

export interface S11ManifestDataset {
  id: S11DatasetId;
  fileName: string | null;
  availability: S11DatasetAvailability;
  unavailableReason?: S11UnavailableReason;
  rowCount: number;
  byteCount: number;
  sort: string;
}

export interface S11ExportManifest {
  contractVersion: typeof S11_CONTRACT_VERSION;
  generatedAt: string;
  datasetCount: number;
  availableCount: number;
  unavailableCount: number;
  rowCountTotal: number;
  byteCountTotal: number;
  filtersApplied: S11TransactionFilters | null;
  datasets: S11ManifestDataset[];
}

export type ExportUseCaseErrorCode =
  | "EXPORT_IN_PROGRESS"
  | "EXPORT_RATE_LIMITED"
  | "EXPORT_TIMEOUT"
  | "EXPORT_TOO_LARGE"
  | "EXPORT_UNAVAILABLE"
  | "EXPORT_FAILED";

export class ExportUseCaseError extends Error {
  readonly code: ExportUseCaseErrorCode;

  readonly correlationId: string;

  constructor(code: ExportUseCaseErrorCode, correlationId: string) {
    super(code);
    this.name = "ExportUseCaseError";
    this.code = code;
    this.correlationId = correlationId;
  }
}

export interface ExportHouseholdDataSuccess {
  ok: true;
  zip: Buffer;
  fileName: typeof S11_EXPORT_ARCHIVE_NAME;
  manifest: S11ExportManifest;
  correlationId: string;
}

export interface ExportHouseholdDataFailure {
  ok: false;
  error: { code: ExportUseCaseErrorCode };
  correlationId: string;
}

export type ExportHouseholdDataResult =
  | ExportHouseholdDataSuccess
  | ExportHouseholdDataFailure;

export interface ExportHouseholdDataInput {
  filters?: S11TransactionFilters;
}

export interface ExportHouseholdDataOptions {
  filters?: S11TransactionFilters;
  correlationId?: string;
  now?: () => number;
  maxDurationMs?: number;
  maxZipBytes?: number;
  rateLimitMs?: number;
  generatedAt?: () => string;
  readDataset?: typeof readExportDataset;
}

const REJECTED_TENANCY_FIELDS = [
  "householdId",
  "userId",
  "tenantId",
  "requestedHouseholdId",
  "datasets",
  "datasetIds",
  "dataset",
] as const;

const inProgressHouseholds = new Set<string>();
const lastCompletedByHousehold = new Map<string, number>();

function wallClockNow(): number {
  return Date.now();
}

function defaultGeneratedAt(): string {
  return new Date().toISOString();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findRejectedTenancyField(
  input: unknown,
): (typeof REJECTED_TENANCY_FIELDS)[number] | undefined {
  if (!isPlainObject(input)) {
    return undefined;
  }
  return REJECTED_TENANCY_FIELDS.find((field) => field in input);
}

/** Parses optional export filters and rejects client tenancy authority fields. */
export function parseExportHouseholdDataInput(
  input: unknown,
  correlationId: string = generateUuidV7(),
): ExportHouseholdDataInput {
  if (input === undefined || input === null) {
    return {};
  }
  if (!isPlainObject(input)) {
    throw new ExportUseCaseError("EXPORT_FAILED", correlationId);
  }

  const rejected = findRejectedTenancyField(input);
  if (rejected !== undefined) {
    throw new ExportUseCaseError("EXPORT_FAILED", correlationId);
  }

  const filtersInput = input.filters;
  if (filtersInput === undefined) {
    return {};
  }
  if (!isPlainObject(filtersInput)) {
    throw new ExportUseCaseError("EXPORT_FAILED", correlationId);
  }

  const rejectedFilterField = findRejectedTenancyField(filtersInput);
  if (rejectedFilterField !== undefined) {
    throw new ExportUseCaseError("EXPORT_FAILED", correlationId);
  }

  const filters: S11TransactionFilters = {};
  if (filtersInput.from !== undefined) filters.from = String(filtersInput.from);
  if (filtersInput.to !== undefined) filters.to = String(filtersInput.to);
  if (filtersInput.accountId !== undefined) {
    filters.accountId = String(filtersInput.accountId);
  }
  if (filtersInput.categoryId !== undefined) {
    filters.categoryId =
      filtersInput.categoryId === null ? null : String(filtersInput.categoryId);
  }
  if (filtersInput.kind !== undefined) {
    filters.kind = filtersInput.kind as S11TransactionFilters["kind"];
  }
  if (filtersInput.status !== undefined) {
    filters.status = filtersInput.status as S11TransactionFilters["status"];
  }

  return { filters };
}

function createCorrelationId(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim();
  }
  return generateUuidV7();
}

function acquireExportSlot(
  householdId: string,
  now: number,
  rateLimitMs: number,
  correlationId: string,
): void {
  if (inProgressHouseholds.has(householdId)) {
    throw new ExportUseCaseError("EXPORT_IN_PROGRESS", correlationId);
  }

  const lastCompleted = lastCompletedByHousehold.get(householdId);
  if (
    lastCompleted !== undefined &&
    now - lastCompleted < rateLimitMs
  ) {
    throw new ExportUseCaseError("EXPORT_RATE_LIMITED", correlationId);
  }

  inProgressHouseholds.add(householdId);
}

function releaseExportSlot(householdId: string, completedAt?: number): void {
  inProgressHouseholds.delete(householdId);
  if (completedAt !== undefined) {
    lastCompletedByHousehold.set(householdId, completedAt);
  }
}

function assertWithinDeadline(
  startedAt: number,
  now: () => number,
  maxDurationMs: number,
  correlationId: string,
): void {
  if (now() - startedAt > maxDurationMs) {
    throw new ExportUseCaseError("EXPORT_TIMEOUT", correlationId);
  }
}

function unavailableReasonFor(
  availability: S11DatasetAvailability,
): S11UnavailableReason | undefined {
  if (availability === "AVAILABLE") {
    return undefined;
  }
  return "SLICE_NOT_PUBLISHED";
}

async function serializeDatasetCsv(
  datasetId: S11DatasetId,
  rows: AsyncIterable<ExportDatasetRow>,
): Promise<{ csv: Buffer; rowCount: number }> {
  const columns = S11_DATASET_COLUMNS[datasetId];
  const chunks: Buffer[] = [Buffer.from(`${encodeCsvLine(columns)}\n`, "utf8")];
  let rowCount = 0;

  for await (const row of rows) {
    rowCount += 1;
    chunks.push(Buffer.from(`${encodeCsvDataLine(columns, row)}\n`, "utf8"));
  }

  return {
    csv: Buffer.concat(chunks),
    rowCount,
  };
}

function buildManifest(
  datasets: S11ManifestDataset[],
  filtersApplied: S11TransactionFilters | null,
  generatedAt: string,
): S11ExportManifest {
  const availableCount = datasets.filter(
    (dataset) => dataset.availability === "AVAILABLE",
  ).length;
  const unavailableCount = datasets.length - availableCount;
  const rowCountTotal = datasets.reduce(
    (total, dataset) => total + dataset.rowCount,
    0,
  );
  const byteCountTotal = datasets.reduce(
    (total, dataset) => total + dataset.byteCount,
    0,
  );

  return {
    contractVersion: S11_CONTRACT_VERSION,
    generatedAt,
    datasetCount: datasets.length,
    availableCount,
    unavailableCount,
    rowCountTotal,
    byteCountTotal,
    filtersApplied,
    datasets,
  };
}

function mapExportReadError(
  error: unknown,
  correlationId: string,
): never {
  if (error instanceof ExportReadError) {
    throw new ExportUseCaseError("EXPORT_FAILED", correlationId);
  }
  throw error;
}

interface DatasetExportPayload {
  availability: S11DatasetAvailability;
  sort: string;
  csv: Buffer | null;
  rowCount: number;
}

async function readDatasetForExport(
  context: FinancialContext,
  datasetId: S11DatasetId,
  filters: S11TransactionFilters | undefined,
  correlationId: string,
  readDataset: typeof readExportDataset,
): Promise<DatasetExportPayload> {
  try {
    return await wrapDatasetRead(
      datasetId as ObservabilityDatasetId,
      async () => {
        const readResult = await readDataset(context, datasetId, { filters });
        if (readResult.availability !== "AVAILABLE") {
          return {
            availability: readResult.availability,
            sort: readResult.sort,
            csv: null,
            rowCount: 0,
          };
        }

        const serialized = await serializeDatasetCsv(datasetId, readResult.rows);
        return {
          availability: readResult.availability,
          sort: readResult.sort,
          csv: serialized.csv,
          rowCount: serialized.rowCount,
        };
      },
      { correlationId, datasetId },
    );
  } catch (error) {
    mapExportReadError(error, correlationId);
  }
}

const runExportRequest = instrumentS11ExportBoundary(
  "export.request",
  async (
    context: FinancialContext,
    options: ExportHouseholdDataOptions & { input: ExportHouseholdDataInput },
  ): Promise<ExportHouseholdDataSuccess> => {
    assertFinancialContext(context);
    const correlationId = createCorrelationId(options.correlationId);
    const now = options.now ?? wallClockNow;
    const maxDurationMs = options.maxDurationMs ?? S11_EXPORT_MAX_DURATION_MS;
    const maxZipBytes = options.maxZipBytes ?? S11_EXPORT_MAX_ZIP_BYTES;
    const rateLimitMs = options.rateLimitMs ?? S11_EXPORT_RATE_LIMIT_MS;
    const generatedAt = options.generatedAt ?? defaultGeneratedAt;
    const readDataset = options.readDataset ?? readExportDataset;
    const startedAt = now();

    acquireExportSlot(context.householdId, startedAt, rateLimitMs, correlationId);

    try {
      const manifestDatasets: S11ManifestDataset[] = [];
      const zipEntries: { name: string; data: Buffer }[] = [];
      const filtersApplied = options.input.filters ?? null;
      let csvBytesTotal = 0;

      for (const datasetId of S11_DATASET_IDS) {
        assertWithinDeadline(startedAt, now, maxDurationMs, correlationId);

        const readResult = await readDatasetForExport(
          context,
          datasetId,
          filtersApplied ?? undefined,
          correlationId,
          readDataset,
        );

        if (readResult.availability !== "AVAILABLE" || readResult.csv === null) {
          manifestDatasets.push({
            id: datasetId,
            fileName: null,
            availability: readResult.availability,
            unavailableReason: unavailableReasonFor(readResult.availability),
            rowCount: 0,
            byteCount: 0,
            sort: readResult.sort,
          });
          continue;
        }

        const serializedCsv = await instrumentS11ExportBoundary(
          "export.serialize",
          async () => readResult.csv as Buffer,
          {
            correlationId,
            datasetId,
            rowCount: readResult.rowCount,
            byteCount: readResult.csv.length,
          },
        )();

        csvBytesTotal += serializedCsv.length;
        if (csvBytesTotal > maxZipBytes) {
          throw new ExportUseCaseError("EXPORT_TOO_LARGE", correlationId);
        }

        const fileName = S11_DATASET_FILE_NAMES[datasetId];
        manifestDatasets.push({
          id: datasetId,
          fileName,
          availability: "AVAILABLE",
          rowCount: readResult.rowCount,
          byteCount: serializedCsv.length,
          sort: readResult.sort,
        });
        zipEntries.push({ name: fileName, data: serializedCsv });
      }

      const manifest = buildManifest(
        manifestDatasets,
        filtersApplied,
        generatedAt(),
      );
      const manifestBuffer = Buffer.from(
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );

      const zip = await instrumentS11ExportBoundary(
        "export.deliver",
        async () =>
          createZipArchive([
            { name: S11_MANIFEST_FILE_NAME, data: manifestBuffer },
            ...zipEntries,
          ]),
        {
          correlationId,
          datasetCount: manifest.datasetCount,
          rowCount: manifest.rowCountTotal,
          byteCount: manifest.byteCountTotal + manifestBuffer.length,
        },
      )();

      if (zip.length > maxZipBytes) {
        throw new ExportUseCaseError("EXPORT_TOO_LARGE", correlationId);
      }

      return {
        ok: true,
        zip,
        fileName: S11_EXPORT_ARCHIVE_NAME,
        manifest,
        correlationId,
      };
    } finally {
      releaseExportSlot(context.householdId, now());
    }
  },
  {},
);

/** Exports every contracted dataset for the resolved financial context. */
export async function exportHouseholdData(
  context: FinancialContext,
  input: unknown = {},
  options: ExportHouseholdDataOptions = {},
): Promise<ExportHouseholdDataResult> {
  const correlationId = createCorrelationId(options.correlationId);

  try {
    const parsed = parseExportHouseholdDataInput(input, correlationId);
    const result = await runExportRequest(context, {
      ...options,
      correlationId,
      input: parsed,
    });
    return result;
  } catch (error) {
    if (error instanceof ExportUseCaseError) {
      return {
        ok: false,
        error: { code: error.code },
        correlationId: error.correlationId,
      };
    }
    throw error;
  }
}

/** Validates filters and returns the download route for cookie-authenticated fetch. */
export async function requestHouseholdExport(
  context: FinancialContext,
  input: unknown = {},
): Promise<
  | { ok: true; downloadUrl: "/api/export"; filters: S11TransactionFilters | null }
  | ExportHouseholdDataFailure
> {
  const correlationId = createCorrelationId();

  try {
    const parsed = parseExportHouseholdDataInput(input, correlationId);
    assertFinancialContext(context);
    return {
      ok: true,
      downloadUrl: "/api/export",
      filters: parsed.filters ?? null,
    };
  } catch (error) {
    if (error instanceof ExportUseCaseError) {
      return {
        ok: false,
        error: { code: error.code },
        correlationId: error.correlationId,
      };
    }
    throw error;
  }
}

/** Resets in-memory export concurrency and rate limits (tests only). */
export function resetExportRateLimitStateForTests(): void {
  inProgressHouseholds.clear();
  lastCompletedByHousehold.clear();
}

/** Masks generatedAt for deterministic manifest comparisons in tests. */
export function maskManifestGeneratedAt(manifest: S11ExportManifest): S11ExportManifest {
  return {
    ...manifest,
    generatedAt: "2000-01-01T00:00:00.000Z",
  };
}
