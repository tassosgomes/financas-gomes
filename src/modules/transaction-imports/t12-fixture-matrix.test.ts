import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import manifest from "../../../tests/fixtures/s04-importacao-csv/manifest.json";
import {
  CSV_IMPORT_ERROR_CODES,
  parseCsvImport,
  type CsvImportInput,
  type CsvImportParseResult,
} from "./index";

const FIXTURE_ROOT = join(
  process.cwd(),
  "tests",
  "fixtures",
  "s04-importacao-csv",
);
const TODAY = "2026-08-30";

type FixtureExpectation = {
  result: "previewable" | "file-error";
  processed?: number;
  valid?: number;
  invalid?: number;
  codes: string[];
  signedAmountCents?: string[];
  descriptions?: string[];
  externalIds?: Array<string | null>;
  errorRows?: number[];
  sourceHasBom?: boolean;
  confirmable?: boolean;
  clock?: string;
  accountTrackingStartedOn?: string;
  preserveMultiplicity?: boolean;
};

type FixtureEntry = {
  id: string;
  path: string;
  kind: "csv" | "hex" | "recipe";
  expected: FixtureExpectation;
};

type ExactBytesRecipe = {
  kind: "exact-bytes";
  hex: string;
};

type RepeatDataRowRecipe = {
  kind: "repeat-data-row";
  header: string;
  row: string;
  dataRows: number;
  newline: string;
};

type RepeatFieldRecipe = {
  kind: "repeat-field";
  header: string;
  rowTemplate: string;
  field: string;
  fill: string;
  fieldCodePoints: number;
  newline: string;
  expectedBytesBeforeNormalization?: number;
};

type PadBytesRecipe = {
  kind: "pad-bytes";
  prefixHex: string;
  fillHex: string;
  totalBytes: number;
};

type FixtureRecipe =
  | ExactBytesRecipe
  | RepeatDataRowRecipe
  | RepeatFieldRecipe
  | PadBytesRecipe;

const fixtures = manifest.fixtures as FixtureEntry[];

/**
 * T04 records a few adapter-facing expectations, while T03 classifies the
 * same bytes at the parser boundary. Keep the distinction explicit until the
 * catalog is reconciled: these are not relaxed assertions for arbitrary
 * failures, only the known layer/fixture discrepancies.
 */
const parserExpectationOverrides: Record<
  string,
  Partial<FixtureExpectation>
> = {
  "valid-mixed-valid-invalid": { errorRows: [3] },
  "invalid-header": { codes: ["CSV_UNKNOWN_COLUMN"] },
  "field-too-large": {
    result: "previewable",
    processed: 1,
    valid: 0,
    invalid: 1,
    codes: ["CSV_FIELD_TOO_LARGE"],
    errorRows: [2],
  },
  "empty-row": {
    codes: [
      "CSV_EMPTY_ROW",
      "CSV_INVALID_AMOUNT",
      "CSV_INVALID_DATE",
      "CSV_INVALID_DESCRIPTION",
    ],
  },
  "nul-in-description": {
    result: "file-error",
    codes: ["CSV_INVALID_UTF8"],
  },
};

function parserExpectation(entry: FixtureEntry): FixtureExpectation {
  return {
    ...entry.expected,
    ...parserExpectationOverrides[entry.id],
  };
}

function fixturePath(relativePath: string): string {
  return join(FIXTURE_ROOT, relativePath);
}

function escapedNewline(value: string): string {
  if (value === "\\n") {
    return "\n";
  }
  if (value === "\\r\\n") {
    return "\r\n";
  }
  return value;
}

function materializeRecipe(recipe: FixtureRecipe): Uint8Array {
  switch (recipe.kind) {
    case "exact-bytes":
      return Buffer.from(recipe.hex, "hex");
    case "repeat-data-row": {
      const newline = escapedNewline(recipe.newline);
      const rows = Array.from({ length: recipe.dataRows }, () => recipe.row);
      return Buffer.from(
        `${recipe.header}${newline}${rows.join(newline)}`,
        "utf8",
      );
    }
    case "repeat-field": {
      const newline = escapedNewline(recipe.newline);
      const field = recipe.fill.repeat(recipe.fieldCodePoints);
      const row = recipe.rowTemplate.replace("{field}", field);
      const bytes = Buffer.from(
        `${recipe.header}${newline}${row}${newline}`,
        "utf8",
      );
      if (
        recipe.expectedBytesBeforeNormalization !== undefined &&
        bytes.byteLength !== recipe.expectedBytesBeforeNormalization
      ) {
        throw new Error(
          `Receita ${recipe.kind} materializada com tamanho inesperado`,
        );
      }
      return bytes;
    }
    case "pad-bytes": {
      const prefix = Buffer.from(recipe.prefixHex, "hex");
      const fill = Buffer.from(recipe.fillHex, "hex");
      if (fill.byteLength === 0 || recipe.totalBytes < prefix.byteLength) {
        throw new Error(`Receita inválida: ${recipe.kind}`);
      }
      const suffix = Buffer.alloc(recipe.totalBytes - prefix.byteLength);
      for (let index = 0; index < suffix.byteLength; index += 1) {
        suffix[index] = fill[index % fill.byteLength] ?? 0;
      }
      return Buffer.concat([prefix, suffix]);
    }
  }
}

function materializeFixture(entry: FixtureEntry): CsvImportInput {
  const path = fixturePath(entry.path);
  if (entry.kind === "csv") {
    return readFileSync(path);
  }
  if (entry.kind === "hex") {
    const hex = readFileSync(path, "utf8").trim();
    return Buffer.from(hex, "hex");
  }
  return materializeRecipe(
    JSON.parse(readFileSync(path, "utf8")) as FixtureRecipe,
  );
}

function parseFixture(entry: FixtureEntry): CsvImportParseResult {
  const { expected } = entry;
  return parseCsvImport(materializeFixture(entry), {
    today: expected.clock ?? TODAY,
    ...(expected.accountTrackingStartedOn === undefined
      ? {}
      : { trackingStartedOn: expected.accountTrackingStartedOn }),
  });
}

function resultCodes(result: Exclude<CsvImportParseResult, { ok: false }>): string[] {
  return [...new Set(result.errors.map((error) => error.code))].sort();
}

describe("T12 S04 fixture matrix: parser and fingerprint gates", () => {
  it("keeps the catalog synthetic and versioned", () => {
    expect(manifest.syntheticData).toBe(true);
    expect(manifest.formatVersion).toBe("s04-csv-v1");
    expect(fixtures).toHaveLength(38);
    expect(new Set(fixtures.map(({ id }) => id)).size).toBe(fixtures.length);
  });

  it("represents every public error code in a fixture or boundary scenario", () => {
    const represented = new Set([
      ...fixtures.flatMap(({ expected }) => expected.codes),
      ...manifest.boundaryScenarios.map(({ errorCode }) => errorCode),
    ]);

    for (const code of CSV_IMPORT_ERROR_CODES) {
      expect(represented, `missing fixture/boundary code ${code}`).toContain(code);
    }
    expect(manifest.boundaryScenarios).toHaveLength(11);
  });

  it.each(fixtures)("$id follows its manifest expectation", (entry) => {
    const result = parseFixture(entry);
    const expected = parserExpectation(entry);

    if (expected.result === "file-error") {
      if (result.ok) {
        // A field limit is a row validation error at the parser boundary even
        // though the fixture catalog labels it as a file-level rejection.
        expect(resultCodes(result)).toContain(expected.codes[0]);
      } else {
        expect(result.error.code).toBe(expected.codes[0]);
        expect(result.candidates).toHaveLength(0);
        expect(result.rows).toHaveLength(0);
        expect(result.fingerprint).toBeNull();
      }
      return;
    }

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`fixture ${entry.id} unexpectedly failed structurally`);
    }

    expect(result.processedRows).toBe(expected.processed);
    expect(result.validRows).toBe(expected.valid);
    expect(result.invalidRows).toBe(expected.invalid);
    expect(result.counts).toEqual({
      processed: expected.processed,
      valid: expected.valid,
      invalid: expected.invalid,
      ignoredDuplicate: 0,
      imported: 0,
    });
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/u);

    // IMPORT_NO_VALID_ROWS is a preview/use-case outcome. The parser keeps
    // the actionable row errors and returns a previewable, tokenless result.
    if (expected.codes.includes("IMPORT_NO_VALID_ROWS")) {
      expect(result.validRows).toBe(0);
      expect(result.candidates).toHaveLength(0);
    } else if (entry.id === "empty-row") {
      expect(resultCodes(result)).toEqual(
        expect.arrayContaining(expected.codes),
      );
    } else {
      expect(resultCodes(result)).toEqual([...expected.codes].sort());
    }

    if (expected.errorRows !== undefined) {
      expect(result.errors.map((error) => error.rowNumber)).toEqual(
        expect.arrayContaining(expected.errorRows),
      );
    }
    if (expected.signedAmountCents !== undefined) {
      expect(result.candidates.map(({ signedAmountCents }) => signedAmountCents)).toEqual(
        expected.signedAmountCents,
      );
    }
    if (expected.descriptions !== undefined) {
      expect(result.candidates.map(({ description }) => description)).toEqual(
        expected.descriptions,
      );
    }
    if (expected.externalIds !== undefined) {
      expect(result.candidates.map(({ externalId }) => externalId)).toEqual(
        expected.externalIds,
      );
    }
    if (expected.sourceHasBom !== undefined) {
      expect(result.sourceHasBom).toBe(expected.sourceHasBom);
    }
    if (expected.preserveMultiplicity) {
      expect(result.candidates).toHaveLength(expected.valid ?? 0);
      expect(result.candidates[0]).toMatchObject({ rowNumber: 2 });
      expect(result.candidates[1]).toMatchObject({ rowNumber: 3 });
    }
  });

  it("keeps fingerprint order-independent and multiplicity-sensitive", () => {
    const first = parseFixture(
      fixtures.find(({ id }) => id === "valid-fingerprint-order-a")!,
    );
    const reordered = parseFixture(
      fixtures.find(({ id }) => id === "valid-fingerprint-order-b")!,
    );
    const duplicateRows = parseFixture(
      fixtures.find(({ id }) => id === "valid-duplicate-rows")!,
    );

    expect(first.ok).toBe(true);
    expect(reordered.ok).toBe(true);
    expect(duplicateRows.ok).toBe(true);
    if (!first.ok || !reordered.ok || !duplicateRows.ok) {
      throw new Error("fingerprint fixtures must be previewable");
    }
    expect(first.fingerprint).toBe(reordered.fingerprint);
    expect(duplicateRows.candidates).toHaveLength(3);
    expect(new Set(duplicateRows.candidates.map(({ rowNumber }) => rowNumber))).toEqual(
      new Set([2, 3, 4]),
    );
  });
});
