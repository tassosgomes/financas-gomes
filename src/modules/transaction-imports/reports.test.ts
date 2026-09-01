import { describe, expect, it } from "vitest";

import { toCsvImportReport } from "./reports";

const baseRecord = {
  id: "018f4f26-7c1b-7abc-8a7f-56d2b1a89f0f",
  householdId: "018f4f26-7c1b-7abc-8a7f-56d2b1a89f01",
  accountId: "018f4f26-7c1b-7abc-8a7f-56d2b1a89f02",
  initiatedByUserId: null,
  formatVersion: "s04-csv-v1",
  datasetFingerprint: "a".repeat(64),
  sourceFileSizeBytes: 128,
  sourceHasBom: false,
  sourceColumns: "BASE" as const,
  processedRows: 2,
  validRows: 1,
  invalidRows: 1,
  ignoredDuplicateRows: 0,
  importedRows: 1,
  errors: [
    {
      rowNumber: 3,
      code: "CSV_INVALID_AMOUNT",
      field: "amountCents",
      message: "raw value must not cross the report boundary",
    },
  ],
  status: "CONFIRMED" as const,
  createdAt: new Date("2026-08-30T10:00:00.000Z"),
  confirmedAt: new Date("2026-08-30T10:00:01.000Z"),
};

describe("T08 persisted CSV import reports", () => {
  it("returns serializable counts and allow-listed messages only", () => {
    const report = toCsvImportReport(baseRecord);

    expect(report).toEqual({
      status: "IMPORTED",
      importId: baseRecord.id,
      accountId: baseRecord.accountId,
      counts: {
        processed: 2,
        valid: 1,
        invalid: 1,
        ignoredDuplicate: 0,
        imported: 1,
      },
      errors: [
        {
          rowNumber: 3,
          code: "CSV_INVALID_AMOUNT",
          field: "amountCents",
          scope: "row",
          message: "Informe um valor inteiro em centavos, sem moeda ou separador.",
        },
      ],
    });
    expect(JSON.stringify(report)).not.toContain("raw value");
    expect(JSON.stringify(report)).not.toContain("datasetFingerprint");
    expect(JSON.stringify(report)).not.toContain("sourceFileSizeBytes");
  });

  it("fails closed when persisted counts do not match the report", () => {
    expect(() =>
      toCsvImportReport({
        ...baseRecord,
        importedRows: 0,
      }),
    ).toThrow();
  });

  it("fails closed when errors do not identify each invalid row once", () => {
    expect(() =>
      toCsvImportReport({
        ...baseRecord,
        errors: [],
      }),
    ).toThrow();
  });
});

