import { Temporal } from "@js-temporal/polyfill";

const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/u;
const INTEGER_CENTS_PATTERN = /^-?\d+$/u;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

const CSV_FIELD_QUOTE_PATTERN = /[",\n\r]/u;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTemporalPlainDate(value: unknown): value is Temporal.PlainDate {
  return (
    isPlainObject(value) &&
    typeof value.year === "number" &&
    typeof value.month === "number" &&
    typeof value.day === "number" &&
    value.constructor?.name === "PlainDate"
  );
}

/** Serializes integer cents without locale, symbol, or rounding. */
export function formatMoneyCents(value: bigint | string): string {
  if (typeof value === "bigint") {
    return value.toString(10);
  }

  if (typeof value !== "string" || !INTEGER_CENTS_PATTERN.test(value)) {
    throw new TypeError("formatMoneyCents expects bigint or integer-cent string");
  }

  return BigInt(value).toString(10);
}

/** Serializes a civil date as YYYY-MM-DD without timezone conversion. */
export function formatCivilDate(value: Temporal.PlainDate | string): string {
  if (typeof value === "string") {
    if (!ISO_DATE_PATTERN.test(value)) {
      throw new TypeError("formatCivilDate expects YYYY-MM-DD string");
    }
    return value;
  }

  if (!isTemporalPlainDate(value)) {
    throw new TypeError("formatCivilDate expects Temporal.PlainDate or ISO date string");
  }

  if (value.year < 0 || value.year > 9999) {
    throw new TypeError("formatCivilDate year must be between 0 and 9999");
  }

  return [
    value.year.toString(10).padStart(4, "0"),
    value.month.toString(10).padStart(2, "0"),
    value.day.toString(10).padStart(2, "0"),
  ].join("-");
}

/** Serializes a persisted instant as ISO-8601 UTC with milliseconds and Z. */
export function formatInstant(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("formatInstant expects a valid Date");
  }

  return value.toISOString();
}

/**
 * Prefixes formula-like values with a single apostrophe. The apostrophe is a
 * transport marker only; `parseS11CsvField` strips at most one leading `'`.
 */
export function neutralizeFormula(text: string): string {
  if (FORMULA_PREFIX_PATTERN.test(text)) {
    return `'${text}`;
  }
  return text;
}

/** Removes at most one leading apostrophe inserted by `neutralizeFormula`. */
export function parseS11CsvField(text: string): string {
  if (text.startsWith("'")) {
    return text.slice(1);
  }
  return text;
}

function serializeCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "bigint") {
    return formatMoneyCents(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new TypeError("CSV integers must be finite whole numbers");
    }
    return value.toString(10);
  }

  if (value instanceof Date) {
    return formatInstant(value);
  }

  if (isTemporalPlainDate(value)) {
    return formatCivilDate(value);
  }

  if (typeof value === "string") {
    return value;
  }

  throw new TypeError(`Unsupported CSV cell value: ${typeof value}`);
}

function encodeCsvField(text: string): string {
  const neutralized = neutralizeFormula(text);
  const mustQuote =
    neutralized.startsWith("'") || CSV_FIELD_QUOTE_PATTERN.test(neutralized);

  if (!mustQuote) {
    return neutralized;
  }

  return `"${neutralized.replace(/"/gu, '""')}"`;
}

/** Encodes one RFC 4180 CSV record from already-serialized field strings. */
export function encodeCsvLine(fields: readonly string[]): string {
  return fields.map(encodeCsvField).join(",");
}

function encodeCsvRow(
  columns: readonly string[],
  row: Record<string, unknown>,
): string {
  const fields = columns.map((column) => serializeCellValue(row[column]));
  return encodeCsvLine(fields);
}

/** Encodes a full CSV document with header, rows, and trailing LF. */
export function encodeCsvDocument(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  const lines = [encodeCsvLine(columns), ...rows.map((row) => encodeCsvRow(columns, row))];
  return `${lines.join("\n")}\n`;
}

/** Yields the header and one data line per row for streaming export. */
export function* encodeCsvStream(
  columns: readonly string[],
  rows: Iterable<Record<string, unknown>>,
): Generator<string> {
  yield `${encodeCsvLine(columns)}\n`;

  for (const row of rows) {
    yield `${encodeCsvRow(columns, row)}\n`;
  }
}

/** Encodes a dataset from ordered columns and unformatted row objects. */
export function encodeDatasetCsv(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  return encodeCsvDocument(columns, rows);
}

/** Encodes one data row (without trailing LF) for streaming export. */
export function encodeCsvDataLine(
  columns: readonly string[],
  row: Record<string, unknown>,
): string {
  return encodeCsvRow(columns, row);
}
