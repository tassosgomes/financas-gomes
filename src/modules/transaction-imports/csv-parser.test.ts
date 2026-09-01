import { describe, expect, it } from "vitest";

import {
  CSV_IMPORT_BIGINT_MAX,
  CSV_IMPORT_MAX_FIELD_BYTES,
  CSV_IMPORT_MAX_FILE_BYTES,
  CSV_IMPORT_MAX_ROWS,
  parseCsvImport,
  type CsvImportParseResult,
} from "./index";

const TODAY = "2026-08-30";
const HEADER = "occurred_on,description,amount_cents";

function validResult(result: CsvImportParseResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected a valid CSV, got ${result.error.code}`);
  }
  return result;
}

function errorResult(result: CsvImportParseResult, code: string) {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`expected a CSV error, got ${result.fingerprint}`);
  }
  expect(result.error.code).toBe(code);
  return result;
}

describe("T03 canonical CSV parser", () => {
  it("parses quoted commas, normalizes fields, and keeps signed amounts exact", () => {
    const result = validResult(
      parseCsvImport(
        [
          "occurred_on,description,amount_cents,external_id",
          '2026-08-29," Salário, mês 08 ",+000125000,sal-2026-08',
          "2026-08-30,Café,-0001875,",
        ].join("\r\n") + "\r\n",
        { today: TODAY },
      ),
    );

    expect(result.sourceColumns).toBe("WITH_EXTERNAL_ID");
    expect(result.sourceFileSizeBytes).toBeGreaterThan(0);
    expect(result.processedRows).toBe(2);
    expect(result.validRows).toBe(2);
    expect(result.invalidRows).toBe(0);
    expect(result.candidates).toEqual([
      {
        rowNumber: 2,
        occurredOn: "2026-08-29",
        description: "Salário, mês 08",
        amountCents: "125000",
        signedAmountCents: "125000",
        kind: "INCOME",
        externalId: "sal-2026-08",
      },
      {
        rowNumber: 3,
        occurredOn: "2026-08-30",
        description: "Café",
        amountCents: "1875",
        signedAmountCents: "-1875",
        kind: "EXPENSE",
        externalId: null,
      },
    ]);
    expect(result.counts).toEqual({
      processed: 2,
      valid: 2,
      invalid: 0,
      ignoredDuplicate: 0,
      imported: 0,
    });
    expect(JSON.stringify(result)).not.toContain("bigint");
  });

  it("accepts one leading UTF-8 BOM and rejects BOMs in content", () => {
    const csv = `${HEADER}\n2026-08-29,Café,100`;
    const encoded = new TextEncoder().encode(csv);
    const withBom = new Uint8Array(encoded.byteLength + 3);
    withBom.set([0xef, 0xbb, 0xbf]);
    withBom.set(encoded, 3);

    const result = validResult(parseCsvImport(withBom, { today: TODAY }));
    expect(result.sourceHasBom).toBe(true);
    expect(result.validRows).toBe(1);

    const middleBom = `${HEADER}\n2026-08-29,Café,100\uFEFF`;
    errorResult(parseCsvImport(middleBom, { today: TODAY }), "CSV_INVALID_BOM");

    const doubleBom = new Uint8Array(withBom.byteLength + 3);
    doubleBom.set(withBom);
    doubleBom.set([0xef, 0xbb, 0xbf], withBom.byteLength);
    errorResult(parseCsvImport(doubleBom, { today: TODAY }), "CSV_INVALID_BOM");
  });

  it("reports row errors independently while preserving valid preview rows", () => {
    const result = validResult(
      parseCsvImport(
        [
          HEADER,
          "2026-08-29,  Café   da manhã  ,0005",
          "2026-08-31,Data futura,10",
          "29/08/2026,Data inválida,12.50",
          ",,",
          "2026-08-29,Café,0",
          "2026-08-29,Café,9223372036854775808",
        ].join("\n"),
        {
          today: TODAY,
          trackingStartedOn: "2026-08-01",
        },
      ),
    );

    expect(result.counts).toMatchObject({
      processed: 6,
      valid: 1,
      invalid: 5,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      rowNumber: 2,
      description: "Café da manhã",
      signedAmountCents: "5",
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowNumber: 3,
          code: "CSV_DATE_IN_FUTURE",
          field: "occurredOn",
        }),
        expect.objectContaining({
          rowNumber: 4,
          code: "CSV_INVALID_DATE",
          field: "occurredOn",
        }),
        expect.objectContaining({ rowNumber: 4, code: "CSV_INVALID_AMOUNT" }),
        expect.objectContaining({ rowNumber: 5, code: "CSV_EMPTY_ROW" }),
        expect.objectContaining({ rowNumber: 6, code: "CSV_ZERO_AMOUNT" }),
        expect.objectContaining({ rowNumber: 7, code: "CSV_AMOUNT_OVERFLOW" }),
      ]),
    );
    expect(result.errors.every((error) => !error.message.includes("Café"))).toBe(
      true,
    );
  });

  it("enforces strict dates, tracking anchors, descriptions, and external ids", () => {
    const result = validResult(
      parseCsvImport(
        [
          `${HEADER},external_id`,
          "2026-02-29,Inválida,1,id-1",
          "2026-08-01,Antes do início,1,id-2",
          "2026-08-29,\u0001controle,1,id-3",
          `2026-08-29,Descrição válida,1,${"x".repeat(129)}`,
          "2026-08-29,Descrição válida,1,   ",
        ].join("\n"),
        { today: TODAY, trackingStartedOn: "2026-08-15" },
      ),
    );

    expect(result.validRows).toBe(0);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rowNumber: 2, code: "CSV_INVALID_DATE" }),
        expect.objectContaining({
          rowNumber: 3,
          code: "TRACKING_START_DATE_VIOLATION",
        }),
        expect.objectContaining({
          rowNumber: 4,
          code: "CSV_INVALID_DESCRIPTION",
        }),
        expect.objectContaining({
          rowNumber: 5,
          code: "CSV_INVALID_EXTERNAL_ID",
        }),
        expect.objectContaining({
          rowNumber: 6,
          code: "CSV_INVALID_EXTERNAL_ID",
        }),
      ]),
    );
  });

  it("rejects unsafe bytes, unsupported newlines, malformed quoting, and delimiters", () => {
    const invalidUtf8 = new Uint8Array([
      ...new TextEncoder().encode(HEADER),
      10,
      0xc3,
      0x28,
    ]);
    errorResult(
      parseCsvImport(invalidUtf8, { today: TODAY }),
      "CSV_INVALID_UTF8",
    );

    const nul = new Uint8Array([
      ...new TextEncoder().encode(`${HEADER}\n2026-08-29,Café,1`),
      0,
    ]);
    errorResult(parseCsvImport(nul, { today: TODAY }), "CSV_INVALID_UTF8");
    errorResult(
      parseCsvImport(`${HEADER}\r2026-08-29,Café,1`, { today: TODAY }),
      "CSV_INVALID_NEWLINE",
    );
    errorResult(
      parseCsvImport(`${HEADER}\n2026-08-29,"Café"oops,1`, {
        today: TODAY,
      }),
      "CSV_MALFORMED_QUOTING",
    );
    errorResult(
      parseCsvImport("occurred_on;description;amount_cents\n2026-08-29;Café;1", {
        today: TODAY,
      }),
      "CSV_INVALID_DELIMITER",
    );
  });

  it("classifies empty/header/width/field-size failures predictably", () => {
    errorResult(parseCsvImport("", { today: TODAY }), "CSV_EMPTY_FILE");
    errorResult(parseCsvImport("\uFEFF", { today: TODAY }), "CSV_EMPTY_FILE");
    errorResult(parseCsvImport(HEADER, { today: TODAY }), "CSV_NO_DATA_ROWS");
    errorResult(
      parseCsvImport(`${HEADER}\n,,`, { today: TODAY }),
      "CSV_NO_DATA_ROWS",
    );
    errorResult(
      parseCsvImport("data,description,amount_cents\n2026-08-29,Café,1", {
        today: TODAY,
      }),
      "CSV_UNKNOWN_COLUMN",
    );
    errorResult(
      parseCsvImport("occurred_on,description,description\n2026-08-29,Café,1", {
        today: TODAY,
      }),
      "CSV_DUPLICATE_COLUMN",
    );

    const result = validResult(
      parseCsvImport(
        `${HEADER}\n2026-08-29,Café\n2026-08-29,${"x".repeat(
          CSV_IMPORT_MAX_FIELD_BYTES + 1,
        )},1`,
        { today: TODAY },
      ),
    );
    expect(result.validRows).toBe(0);
    expect(result.invalidRows).toBe(2);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rowNumber: 2, code: "CSV_ROW_WIDTH_MISMATCH" }),
        expect.objectContaining({ rowNumber: 3, code: "CSV_FIELD_TOO_LARGE" }),
      ]),
    );
  });

  it("uses bigint parsing and applies the 10,000-row and 5 MiB limits", () => {
    const large = validResult(
      parseCsvImport(
        `${HEADER}\n2026-08-29,Grande,${CSV_IMPORT_BIGINT_MAX.toString(10)}`,
        { today: TODAY },
      ),
    );
    expect(large.rows[0].signedAmountCents).toBe(
      CSV_IMPORT_BIGINT_MAX.toString(10),
    );

    const tooManyRows = [HEADER];
    for (let row = 0; row < CSV_IMPORT_MAX_ROWS + 1; row += 1) {
      tooManyRows.push(`2026-08-29,Linha ${row},1`);
    }
    errorResult(
      parseCsvImport(tooManyRows.join("\n"), { today: TODAY }),
      "CSV_TOO_MANY_ROWS",
    );

    errorResult(
      parseCsvImport(new Uint8Array(CSV_IMPORT_MAX_FILE_BYTES + 1), {
        today: TODAY,
      }),
      "CSV_FILE_TOO_LARGE",
    );
  });

  it("fingerprints the normalized multiset independent of order, while preserving duplicates", () => {
    const first = validResult(
      parseCsvImport(
        [
          HEADER,
          "2026-08-29,  Café   ,+0005",
          "2026-08-30,Salário,10",
        ].join("\n"),
        { today: TODAY },
      ),
    );
    const reordered = validResult(
      parseCsvImport(
        [
          HEADER,
          "2026-08-30,Salário,00010",
          "2026-08-29,Café,5",
        ].join("\r\n") + "\r\n",
        { today: TODAY },
      ),
    );
    const withInvalidExtraRow = validResult(
      parseCsvImport(
        [
          HEADER,
          "2026-08-29,Café,5",
          "not-a-date,linha inválida,0",
          "2026-08-30,Salário,10",
        ].join("\n"),
        { today: TODAY },
      ),
    );
    const duplicate = validResult(
      parseCsvImport(
        [HEADER, "2026-08-29,Café,5", "2026-08-29,Café,5"].join("\n"),
        { today: TODAY },
      ),
    );

    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.fingerprint).toBe(reordered.fingerprint);
    expect(first.fingerprint).toBe(withInvalidExtraRow.fingerprint);
    expect(first.fingerprint).not.toBe(duplicate.fingerprint);
    expect(first.canonicalInput).toBe(reordered.canonicalInput);
    expect(first.canonicalInput).not.toContain("linha inválida");
  });
});
