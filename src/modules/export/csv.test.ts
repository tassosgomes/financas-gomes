import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  S11_CONTRACT_VERSION,
  S11_DATASET_COLUMNS,
  S11_DATASET_IDS,
} from "./contract";
import {
  encodeCsvDocument,
  encodeCsvLine,
  encodeCsvStream,
  encodeDatasetCsv,
  formatCivilDate,
  formatInstant,
  formatMoneyCents,
  neutralizeFormula,
  parseS11CsvField,
} from "./csv";

const FIXTURE_DIR = join(
  process.cwd(),
  "tests/fixtures/s11-operacao-confiavel",
);

describe("S11 CSV encoder", () => {
  describe("formatMoneyCents", () => {
    it.each([
      [BigInt(0), "0"],
      [BigInt(1500), "1500"],
      [BigInt(-1500), "-1500"],
      ["0", "0"],
      ["-1500", "-1500"],
      [BigInt("999999999999999"), "999999999999999"],
    ])("formats %s as %s", (input, expected) => {
      expect(formatMoneyCents(input)).toBe(expected);
    });
  });

  describe("formatCivilDate", () => {
    it("formats PlainDate and ISO strings", () => {
      expect(formatCivilDate("2026-01-01")).toBe("2026-01-01");
      expect(
        formatCivilDate(Temporal.PlainDate.from("2026-12-31")),
      ).toBe("2026-12-31");
    });
  });

  describe("formatInstant", () => {
    it("emits UTC milliseconds with Z", () => {
      expect(formatInstant(new Date("2026-01-01T12:00:00.000Z"))).toBe(
        "2026-01-01T12:00:00.000Z",
      );
    });
  });

  describe("neutralizeFormula and parseS11CsvField", () => {
    it.each([
      ["=1+1", "'=1+1"],
      ["+100", "'+100"],
      ["-1500", "'-1500"],
      ["@SUM(A1)", "'@SUM(A1)"],
      ["\tvalue", "'\tvalue"],
      ["\rvalue", "'\rvalue"],
      ["safe", "safe"],
      ["1500", "1500"],
    ])("neutralizes %j as %j", (input, expected) => {
      expect(neutralizeFormula(input)).toBe(expected);
      expect(parseS11CsvField(expected)).toBe(input);
    });

    it("strips at most one leading apostrophe", () => {
      expect(parseS11CsvField("''=1+1")).toBe("'=1+1");
    });
  });

  describe("encodeCsvLine", () => {
    it.each([
      {
        name: "plain fields",
        fields: ["a", "b", "c"],
        expected: "a,b,c",
      },
      {
        name: "comma in field",
        fields: ["a", "b,c", "d"],
        expected: 'a,"b,c",d',
      },
      {
        name: "quotes in field",
        fields: ['say "hi"'],
        expected: '"say ""hi"""',
      },
      {
        name: "newline in field",
        fields: ["line1\nline2"],
        expected: '"line1\nline2"',
      },
      {
        name: "unicode",
        fields: ["café", "日本語"],
        expected: "café,日本語",
      },
      {
        name: "empty field",
        fields: ["a", "", "c"],
        expected: "a,,c",
      },
      {
        name: "formula neutralization",
        fields: ["'=1+1", "'-1500"],
        expected: `"'=1+1","'-1500"`,
      },
    ])("$name", ({ fields, expected }) => {
      expect(encodeCsvLine(fields)).toBe(expected);
    });
  });

  describe("encodeCsvDocument", () => {
    it("serializes null, boolean, and empty values", () => {
      const csv = encodeCsvDocument(["id", "active", "note"], [
        { id: "1", active: true, note: null },
        { id: "2", active: false, note: undefined },
      ]);

      expect(csv).toBe("id,active,note\n1,true,\n2,false,\n");
    });

    it("produces identical output for repeated encoding", () => {
      const rows = [
        {
          id: "018f1a2b-0000-7000-8000-000000000001",
          description: "=cmd",
          amountCents: BigInt(-99),
        },
      ];
      const columns = ["id", "description", "amountCents"] as const;
      const first = encodeCsvDocument(columns, rows);
      const second = encodeCsvDocument(columns, rows);
      expect(first).toBe(second);
    });
  });

  describe("encodeCsvStream", () => {
    it("yields header then one line per row", () => {
      const chunks = [
        ...encodeCsvStream(["a", "b"], [{ a: "1", b: "2" }, { a: "3", b: "4" }]),
      ];

      expect(chunks).toEqual(["a,b\n", "1,2\n", "3,4\n"]);
    });
  });

  describe("contract", () => {
    it("exposes every ADR dataset with ordered columns", () => {
      expect(S11_CONTRACT_VERSION).toBe("s11.v1");
      expect(S11_DATASET_IDS).toHaveLength(17);
      for (const datasetId of S11_DATASET_IDS) {
        const columns = S11_DATASET_COLUMNS[datasetId];
        expect(columns.length).toBeGreaterThan(0);
        expect(new Set(columns).size).toBe(columns.length);
      }
    });
  });

  describe("byte-stability fixture", () => {
    const fixture = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "csv-byte-stability.json"), "utf8"),
    ) as {
      columns: string[];
      rows: Array<Record<string, string | boolean | null>>;
    };

    const rows = fixture.rows.map((row) => ({
      ...row,
      amountCents:
        row.amountCents === null || row.amountCents === undefined
          ? null
          : BigInt(row.amountCents as string),
      createdAt: new Date(row.createdAt as string),
      updatedAt: new Date(row.updatedAt as string),
    }));

    it("matches the versioned CSV byte-for-byte", () => {
      const expected = readFileSync(
        join(FIXTURE_DIR, "csv-byte-stability.csv"),
        "utf8",
      );
      const actual = encodeDatasetCsv(fixture.columns, rows);

      expect(actual).toBe(expected);
      expect(actual.endsWith("\n")).toBe(true);
      expect(actual).not.toMatch(/^\uFEFF/u);
    });
  });
});
