import { afterEach, describe, expect, it, vi } from "vitest";

import {
  S11_CONTRACT_VERSION,
  S11_DATASET_FILE_NAMES,
  S11_DATASET_IDS,
} from "./contract";
import type { ExportDatasetReadResult } from "./reads";
import {
  exportHouseholdData,
  maskManifestGeneratedAt,
  parseExportHouseholdDataInput,
  resetExportRateLimitStateForTests,
  S11_EXPORT_ARCHIVE_NAME,
  S11_EXPORT_MAX_ZIP_BYTES,
  S11_MANIFEST_FILE_NAME,
  type S11ExportManifest,
} from "./use-cases";
import { createZipArchive, listZipEntryNames } from "./zip";

const context = {
  userId: "00000000-0000-7000-8000-000000508001",
  householdId: "00000000-0000-7000-8000-000000506101",
};

function emptyReadResult(sort: string): ExportDatasetReadResult {
  return {
    availability: "AVAILABLE",
    sort,
    rows: (async function* empty() {})(),
  };
}

function unavailableReadResult(sort: string): ExportDatasetReadResult {
  return {
    availability: "UNAVAILABLE_EXTERNAL_GATE",
    sort,
    rows: (async function* unavailable() {})(),
  };
}

function createReadDatasetMock(
  overrides: Partial<
    Record<
      (typeof S11_DATASET_IDS)[number],
      () => Promise<ExportDatasetReadResult>
    >
  > = {},
) {
  return vi.fn(async (_context, datasetId: (typeof S11_DATASET_IDS)[number]) => {
    if (overrides[datasetId]) {
      return overrides[datasetId]!();
    }
    return emptyReadResult(`${datasetId} ASC`);
  });
}

describe("createZipArchive", () => {
  it("stores entries in caller order with deflate compression", () => {
    const zip = createZipArchive([
      { name: S11_MANIFEST_FILE_NAME, data: Buffer.from('{"ok":true}\n', "utf8") },
      { name: "accounts.csv", data: Buffer.from("id,name\n", "utf8") },
    ]);

    expect(zip.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(listZipEntryNames(zip)).toEqual([
      S11_MANIFEST_FILE_NAME,
      "accounts.csv",
    ]);
  });
});

describe("parseExportHouseholdDataInput", () => {
  it("rejects client tenancy fields", () => {
    expect(() =>
      parseExportHouseholdDataInput({ householdId: "forged" }, "corr-1"),
    ).toThrowError(expect.objectContaining({ code: "EXPORT_FAILED" }));
    expect(() =>
      parseExportHouseholdDataInput({ userId: "forged" }, "corr-2"),
    ).toThrowError(expect.objectContaining({ code: "EXPORT_FAILED" }));
    expect(() =>
      parseExportHouseholdDataInput({ datasets: ["accounts"] }, "corr-3"),
    ).toThrowError(expect.objectContaining({ code: "EXPORT_FAILED" }));
  });

  it("accepts optional transaction filters", () => {
    expect(
      parseExportHouseholdDataInput({
        filters: { from: "2026-01-01", status: "POSTED" },
      }),
    ).toEqual({
      filters: { from: "2026-01-01", status: "POSTED" },
    });
  });
});

describe("exportHouseholdData", () => {
  afterEach(() => {
    resetExportRateLimitStateForTests();
    vi.restoreAllMocks();
  });

  it("returns a valid empty-space ZIP with header-only CSVs", async () => {
    const readDataset = createReadDatasetMock();
    const result = await exportHouseholdData(
      context,
      {},
      {
        correlationId: "export-empty",
        generatedAt: () => "2026-09-03T12:00:00.000Z",
        readDataset,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fileName).toBe(S11_EXPORT_ARCHIVE_NAME);
    expect(result.manifest.contractVersion).toBe(S11_CONTRACT_VERSION);
    expect(result.manifest.rowCountTotal).toBe(0);
    expect(result.manifest.availableCount).toBe(S11_DATASET_IDS.length);
    expect(result.manifest.unavailableCount).toBe(0);
    expect(result.zip.subarray(0, 4).toString("hex")).toBe("504b0304");

    const entryNames = listZipEntryNames(result.zip);
    expect(entryNames[0]).toBe(S11_MANIFEST_FILE_NAME);
    expect(entryNames).toEqual([
      S11_MANIFEST_FILE_NAME,
      ...S11_DATASET_IDS.map((id) => S11_DATASET_FILE_NAMES[id]),
    ]);
  });

  it("omits CSV files for unavailable datasets but lists them in the manifest", async () => {
    const readDataset = createReadDatasetMock({
      budgets: async () => unavailableReadResult("name ASC, id ASC"),
    });

    const result = await exportHouseholdData(context, {}, {
      correlationId: "export-gate",
      generatedAt: () => "2026-09-03T12:00:00.000Z",
      readDataset,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const budgets = result.manifest.datasets.find((dataset) => dataset.id === "budgets");
    expect(budgets).toMatchObject({
      availability: "UNAVAILABLE_EXTERNAL_GATE",
      fileName: null,
      rowCount: 0,
      unavailableReason: "SLICE_NOT_PUBLISHED",
    });
    expect(listZipEntryNames(result.zip)).not.toContain("budgets.csv");
  });

  it("rejects tenancy fields in the request body", async () => {
    const result = await exportHouseholdData(
      context,
      { householdId: context.householdId },
      { correlationId: "reject-tenancy" },
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "EXPORT_FAILED" },
      correlationId: "reject-tenancy",
    });
  });

  it("enforces one concurrent export per household", async () => {
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const readDataset = vi.fn(async () => {
      await gate;
      return emptyReadResult("id ASC");
    });

    const first = exportHouseholdData(context, {}, {
      correlationId: "in-progress-1",
      readDataset,
    });
    const second = await exportHouseholdData(context, {}, {
      correlationId: "in-progress-2",
      readDataset,
    });

    expect(second).toEqual({
      ok: false,
      error: { code: "EXPORT_IN_PROGRESS" },
      correlationId: "in-progress-2",
    });

    releaseFirst?.();
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
  });

  it("rate-limits completed exports to one per 60 seconds", async () => {
    let now = 1_000;
    const readDataset = createReadDatasetMock();

    const first = await exportHouseholdData(context, {}, {
      correlationId: "rate-1",
      now: () => now,
      rateLimitMs: 60_000,
      readDataset,
      generatedAt: () => "2026-09-03T12:00:00.000Z",
    });
    expect(first.ok).toBe(true);

    now = 30_000;
    const second = await exportHouseholdData(context, {}, {
      correlationId: "rate-2",
      now: () => now,
      rateLimitMs: 60_000,
      readDataset,
    });
    expect(second).toEqual({
      ok: false,
      error: { code: "EXPORT_RATE_LIMITED" },
      correlationId: "rate-2",
    });

    now = 61_500;
    const third = await exportHouseholdData(context, {}, {
      correlationId: "rate-3",
      now: () => now,
      rateLimitMs: 60_000,
      readDataset,
      generatedAt: () => "2026-09-03T12:01:00.000Z",
    });
    expect(third.ok).toBe(true);
  });

  it("fails with EXPORT_TIMEOUT before returning a truncated ZIP", async () => {
    let now = 0;
    const readDataset = vi.fn(async () => {
      now += 30_000;
      return emptyReadResult("id ASC");
    });

    const result = await exportHouseholdData(context, {}, {
      correlationId: "timeout",
      now: () => now,
      maxDurationMs: 25_000,
      readDataset,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "EXPORT_TIMEOUT" },
      correlationId: "timeout",
    });
  });

  it("fails with EXPORT_TOO_LARGE before returning a truncated ZIP", async () => {
    const readDataset = vi.fn(async () => ({
      availability: "AVAILABLE" as const,
      sort: "id ASC",
      rows: (async function* oneRow() {
        yield {
          id: "00000000-0000-7000-8000-000000000001",
          name: "x".repeat(1024 * 1024),
          type: "CHECKING",
          status: "ACTIVE",
          spendability: "GENERAL",
          liquidity: "IMMEDIATE",
          includeInNetWorth: true,
          trackingStartedOn: "",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
      })(),
    }));

    const result = await exportHouseholdData(context, {}, {
      correlationId: "too-large",
      maxZipBytes: 32_768,
      readDataset: vi.fn(async (_ctx, datasetId) => {
        if (datasetId === "accounts") {
          return readDataset();
        }
        return emptyReadResult("id ASC");
      }),
      generatedAt: () => "2026-09-03T12:00:00.000Z",
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "EXPORT_TOO_LARGE" },
      correlationId: "too-large",
    });
    expect(S11_EXPORT_MAX_ZIP_BYTES).toBe(50 * 1024 * 1024);
  });

  it("never exposes householdId, userId or email in the manifest", async () => {
    const result = await exportHouseholdData(context, {}, {
      correlationId: "manifest-redaction",
      generatedAt: () => "2026-09-03T12:00:00.000Z",
      readDataset: createReadDatasetMock(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.manifest);
    expect(serialized).not.toContain("householdId");
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("@");
    expect(result.manifest.contractVersion).toBe("s11.v1");
  });
});

describe("maskManifestGeneratedAt", () => {
  it("masks generatedAt for deterministic comparisons", () => {
    const manifest: S11ExportManifest = {
      contractVersion: S11_CONTRACT_VERSION,
      generatedAt: "2026-09-03T12:34:56.789Z",
      datasetCount: 1,
      availableCount: 1,
      unavailableCount: 0,
      rowCountTotal: 0,
      byteCountTotal: 0,
      filtersApplied: null,
      datasets: [],
    };

    expect(maskManifestGeneratedAt(manifest).generatedAt).toBe(
      "2000-01-01T00:00:00.000Z",
    );
  });
});
