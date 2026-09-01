import { Temporal } from "@js-temporal/polyfill";
import { parse as parseCsvRecords } from "csv-parse/sync";

import {
  CSV_IMPORT_BASE_COLUMNS,
  CSV_IMPORT_BIGINT_MAX,
  CSV_IMPORT_ERROR_MESSAGES,
  CSV_IMPORT_EXTERNAL_ID_COLUMNS,
  CSV_IMPORT_FORMAT_VERSION,
  CSV_IMPORT_MAX_DESCRIPTION_CODE_POINTS,
  CSV_IMPORT_MAX_EXTERNAL_ID_CODE_POINTS,
  CSV_IMPORT_MAX_FIELD_BYTES,
  CSV_IMPORT_MAX_FILE_BYTES,
  CSV_IMPORT_MAX_ROWS,
  type CsvImportCandidate,
  type CsvImportError,
  type CsvImportFingerprintCandidate,
  type CsvImportInput,
  type CsvImportKind,
  type CsvImportParseFailure,
  type CsvImportParseResult,
  type CsvImportParseSuccess,
  type CsvImportParserOptions,
  type CsvImportPreviewRow,
  type CsvImportRowError,
  type CsvImportSourceColumns,
} from "./contracts";
import {
  buildCsvImportCanonicalInput,
  fingerprintCsvImport,
} from "./fingerprint";

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const SIGNED_DECIMAL_PATTERN = /^[+-]?[0-9]+$/u;
const ISO_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const textEncoder = new TextEncoder();
const ZERO_AMOUNT = BigInt(0);

const HEADER_COLUMN_NAMES = [
  "occurredOn",
  "description",
  "amountCents",
  "externalId",
] as const;

const TOO_MANY_ROWS = Symbol("CSV_TOO_MANY_ROWS");

function emptyCounts() {
  return {
    processed: 0,
    valid: 0,
    invalid: 0,
    ignoredDuplicate: 0,
    imported: 0,
  } as const;
}

function fileError(
  code: CsvImportError["code"],
  metadata: Pick<CsvImportParseFailure, "sourceFileSizeBytes" | "sourceHasBom"> & {
    sourceColumns?: CsvImportSourceColumns | null;
  },
): CsvImportParseFailure {
  const error: CsvImportError = {
    code,
    scope: "file",
    message: CSV_IMPORT_ERROR_MESSAGES[code],
  };

  return {
    ok: false,
    formatVersion: CSV_IMPORT_FORMAT_VERSION,
    sourceFileSizeBytes: metadata.sourceFileSizeBytes,
    sourceHasBom: metadata.sourceHasBom,
    sourceColumns: metadata.sourceColumns ?? null,
    processedRows: 0,
    validRows: 0,
    invalidRows: 0,
    candidates: [],
    rows: [],
    errors: [error],
    counts: emptyCounts(),
    error,
    canonicalInput: "",
    canonicalInputHex: "",
    fingerprint: null,
  };
}

function isUtf16UnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function inputToBytes(input: unknown): Uint8Array | null {
  if (typeof input === "string") {
    if (isUtf16UnpairedSurrogate(input)) {
      return null;
    }
    return textEncoder.encode(input);
  }

  if (input instanceof Uint8Array) {
    return new Uint8Array(input);
  }

  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input.slice(0));
  }

  return null;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.byteLength < prefix.length) {
    return false;
  }
  return prefix.every((byte, index) => bytes[index] === byte);
}

function countUtf8Boms(bytes: Uint8Array): number {
  let count = 0;
  for (let index = 0; index <= bytes.byteLength - UTF8_BOM.length; index += 1) {
    if (
      bytes[index] === UTF8_BOM[0] &&
      bytes[index + 1] === UTF8_BOM[1] &&
      bytes[index + 2] === UTF8_BOM[2]
    ) {
      count += 1;
      index += UTF8_BOM.length - 1;
    }
  }
  return count;
}

function containsNul(bytes: Uint8Array): boolean {
  return bytes.some((byte) => byte === 0);
}

/**
 * Checks CR only outside quoted fields. RFC-4180 permits CR/LF in a quoted
 * field; field validation later rejects those controls where the S04 column
 * contract does not permit them.
 */
function hasBareCarriageReturn(value: string): boolean {
  let inQuotes = false;
  let fieldStart = true;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (inQuotes) {
      if (character === '"') {
        if (value[index + 1] === '"') {
          index += 1;
        } else {
          inQuotes = false;
          fieldStart = false;
        }
      }
      continue;
    }

    if (character === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
      continue;
    }

    if (character === ",") {
      fieldStart = true;
      continue;
    }

    if (character === "\n") {
      fieldStart = true;
      continue;
    }

    if (character === "\r") {
      if (value[index + 1] !== "\n") {
        return true;
      }
      index += 1;
      fieldStart = true;
      continue;
    }

    fieldStart = false;
  }

  return false;
}

function firstLogicalRecord(value: string): string {
  let inQuotes = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (inQuotes) {
      if (character === '"') {
        if (value[index + 1] === '"') {
          index += 1;
        } else {
          inQuotes = false;
        }
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    if (character === "\n") {
      return value[index - 1] === "\r"
        ? value.slice(0, index - 1)
        : value.slice(0, index);
    }
  }
  return value;
}

function containsUnquotedCharacter(value: string, target: string): boolean {
  let inQuotes = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (inQuotes) {
      if (character === '"') {
        if (value[index + 1] === '"') {
          index += 1;
        } else {
          inQuotes = false;
        }
      }
      continue;
    }
    if (character === '"') {
      inQuotes = true;
      continue;
    }
    if (character === target) {
      return true;
    }
  }
  return false;
}

function parseBoundaryDate(
  value: string | Temporal.PlainDate | null | undefined,
): Temporal.PlainDate | null {
  if (value instanceof Temporal.PlainDate) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  if (!ISO_DATE_PATTERN.test(value)) {
    return null;
  }
  try {
    return Temporal.PlainDate.from(value, { overflow: "reject" });
  } catch {
    return null;
  }
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function fieldByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function rowError(
  rowNumber: number,
  code: CsvImportError["code"],
  field?: CsvImportRowError["field"],
): CsvImportRowError {
  return {
    rowNumber,
    code,
    scope: "row",
    ...(field ? { field } : {}),
    message: CSV_IMPORT_ERROR_MESSAGES[code],
  };
}

function normalizeDescription(value: string): string | null {
  const normalized = value.normalize("NFKC");
  if (CONTROL_OR_FORMAT_CHARACTER.test(normalized)) {
    return null;
  }
  const collapsed = normalized.trim().replace(/\s+/gu, " ");
  const length = codePointLength(collapsed);
  if (
    length < 1 ||
    length > CSV_IMPORT_MAX_DESCRIPTION_CODE_POINTS
  ) {
    return null;
  }
  return collapsed;
}

function normalizeExternalId(value: string): string | null {
  if (value === "") {
    return null;
  }
  const normalized = value.normalize("NFKC").trim();
  if (
    normalized.length === 0 ||
    CONTROL_OR_FORMAT_CHARACTER.test(normalized) ||
    codePointLength(normalized) > CSV_IMPORT_MAX_EXTERNAL_ID_CODE_POINTS
  ) {
    return null;
  }
  return normalized;
}

function canonicalDate(value: string): Temporal.PlainDate | null {
  if (!ISO_DATE_PATTERN.test(value)) {
    return null;
  }
  try {
    return Temporal.PlainDate.from(value, { overflow: "reject" });
  } catch {
    return null;
  }
}

function isAllEmptyRow(row: readonly string[]): boolean {
  return row.length > 0 && row.every((field) => field === "");
}

function asPreviewRow(candidate: CsvImportCandidate): CsvImportPreviewRow {
  return {
    rowNumber: candidate.rowNumber,
    occurredOn: candidate.occurredOn,
    description: candidate.description,
    signedAmountCents: candidate.signedAmountCents,
    kind: candidate.kind,
    externalId: candidate.externalId,
  };
}

function isExpectedHeader(
  header: readonly string[],
  rawHeader: string,
): CsvImportSourceColumns | null {
  const isBase =
    header.length === CSV_IMPORT_BASE_COLUMNS.length &&
    header.every((column, index) => column === CSV_IMPORT_BASE_COLUMNS[index]) &&
    rawHeader === CSV_IMPORT_BASE_COLUMNS.join(",");
  if (isBase) {
    return "BASE";
  }

  const hasExternalId =
    header.length === CSV_IMPORT_EXTERNAL_ID_COLUMNS.length &&
    header.every(
      (column, index) => column === CSV_IMPORT_EXTERNAL_ID_COLUMNS[index],
    ) &&
    rawHeader === CSV_IMPORT_EXTERNAL_ID_COLUMNS.join(",");
  return hasExternalId ? "WITH_EXTERNAL_ID" : null;
}

function parseRecords(value: string): string[][] | CsvImportParseFailure["error"] {
  let seenRecords = 0;

  try {
    return parseCsvRecords(value, {
      bom: false,
      cast: false,
      columns: false,
      comment: false,
      delimiter: ",",
      encoding: "utf8",
      escape: '"',
      ltrim: false,
      max_record_size: CSV_IMPORT_MAX_FILE_BYTES,
      quote: '"',
      record_delimiter: ["\r\n", "\n"],
      relax_column_count: true,
      relax_column_count_less: true,
      relax_column_count_more: true,
      relax_quotes: false,
      rtrim: false,
      skip_empty_lines: false,
      skip_records_with_empty_values: false,
      skip_records_with_error: false,
      trim: false,
      on_record(record: string[]) {
        seenRecords += 1;
        if (seenRecords > CSV_IMPORT_MAX_ROWS + 1) {
          throw TOO_MANY_ROWS;
        }
        return record;
      },
    }) as string[][];
  } catch (error) {
    const code = error === TOO_MANY_ROWS ? "CSV_TOO_MANY_ROWS" : "CSV_MALFORMED_QUOTING";
    return {
      code,
      scope: "file",
      message: CSV_IMPORT_ERROR_MESSAGES[code],
    };
  }
}

function buildSuccess(
  bytes: Uint8Array,
  sourceHasBom: boolean,
  sourceColumns: CsvImportSourceColumns,
  records: readonly string[][],
  options: CsvImportParserOptions,
): CsvImportParseSuccess {
  const dataRecords = records.slice(1);
  const businessDate =
    parseBoundaryDate(options.today) ?? Temporal.Now.plainDateISO();
  const trackingStartedOn = parseBoundaryDate(
    options.trackingStartedOn ?? options.accountTrackingStartedOn,
  );
  const expectedWidth =
    sourceColumns === "BASE"
      ? CSV_IMPORT_BASE_COLUMNS.length
      : CSV_IMPORT_EXTERNAL_ID_COLUMNS.length;
  const candidates: CsvImportCandidate[] = [];
  const errors: CsvImportRowError[] = [];

  for (let index = 0; index < dataRecords.length; index += 1) {
    const row = dataRecords[index];
    const rowNumber = index + 2;

    if (row.length !== expectedWidth) {
      errors.push(rowError(rowNumber, "CSV_ROW_WIDTH_MISMATCH"));
      continue;
    }

    const oversizedFields = row
      .map((field, fieldIndex) => ({ field, fieldIndex }))
      .filter(({ field }) => fieldByteLength(field) > CSV_IMPORT_MAX_FIELD_BYTES);
    if (oversizedFields.length > 0) {
      for (const { fieldIndex } of oversizedFields) {
        errors.push(
          rowError(
            rowNumber,
            "CSV_FIELD_TOO_LARGE",
            HEADER_COLUMN_NAMES[fieldIndex],
          ),
        );
      }
      continue;
    }

    const rowErrors: CsvImportRowError[] = [];
    if (isAllEmptyRow(row)) {
      rowErrors.push(rowError(rowNumber, "CSV_EMPTY_ROW"));
    }

    const date = canonicalDate(row[0]);
    if (date === null) {
      rowErrors.push(rowError(rowNumber, "CSV_INVALID_DATE", "occurredOn"));
    } else {
      if (Temporal.PlainDate.compare(date, businessDate) > 0) {
        rowErrors.push(
          rowError(rowNumber, "CSV_DATE_IN_FUTURE", "occurredOn"),
        );
      }
      if (
        trackingStartedOn !== null &&
        Temporal.PlainDate.compare(date, trackingStartedOn) < 0
      ) {
        rowErrors.push(
          rowError(
            rowNumber,
            "TRACKING_START_DATE_VIOLATION",
            "occurredOn",
          ),
        );
      }
    }

    const description = normalizeDescription(row[1]);
    if (description === null) {
      rowErrors.push(
        rowError(rowNumber, "CSV_INVALID_DESCRIPTION", "description"),
      );
    }

    let signedAmount: bigint | null = null;
    if (!SIGNED_DECIMAL_PATTERN.test(row[2])) {
      rowErrors.push(rowError(rowNumber, "CSV_INVALID_AMOUNT", "amountCents"));
    } else {
      try {
        signedAmount = BigInt(row[2]);
      } catch {
        rowErrors.push(
          rowError(rowNumber, "CSV_INVALID_AMOUNT", "amountCents"),
        );
      }
      if (signedAmount !== null) {
        const magnitude = signedAmount < ZERO_AMOUNT ? -signedAmount : signedAmount;
        if (magnitude > CSV_IMPORT_BIGINT_MAX) {
          rowErrors.push(
            rowError(rowNumber, "CSV_AMOUNT_OVERFLOW", "amountCents"),
          );
        } else if (signedAmount === ZERO_AMOUNT) {
          rowErrors.push(rowError(rowNumber, "CSV_ZERO_AMOUNT", "amountCents"));
        }
      }
    }

    const rawExternalId =
      sourceColumns === "WITH_EXTERNAL_ID" ? row[3] : "";
    const externalId = normalizeExternalId(rawExternalId);
    if (rawExternalId !== "" && externalId === null) {
      rowErrors.push(
        rowError(rowNumber, "CSV_INVALID_EXTERNAL_ID", "externalId"),
      );
    }

    if (rowErrors.length > 0 || date === null || description === null || signedAmount === null) {
      errors.push(...rowErrors);
      continue;
    }

    const signedAmountCents = signedAmount.toString(10);
    const amountCents =
      (signedAmount < ZERO_AMOUNT ? -signedAmount : signedAmount).toString(10);
    const kind: CsvImportKind =
      signedAmount > ZERO_AMOUNT ? "INCOME" : "EXPENSE";
    candidates.push({
      rowNumber,
      occurredOn: date.toString(),
      description,
      amountCents,
      signedAmountCents,
      kind,
      externalId,
    });
  }

  const fingerprintCandidates: CsvImportFingerprintCandidate[] = candidates;
  const canonicalInput = buildCsvImportCanonicalInput(fingerprintCandidates);
  const fingerprint = fingerprintCsvImport(fingerprintCandidates);
  const processedRows = dataRecords.length;
  const invalidRows = new Set(errors.map((error) => error.rowNumber)).size;
  const validRows = candidates.length;

  return {
    ok: true,
    formatVersion: CSV_IMPORT_FORMAT_VERSION,
    sourceFileSizeBytes: bytes.byteLength,
    sourceHasBom,
    sourceColumns,
    processedRows,
    validRows,
    invalidRows,
    candidates,
    rows: candidates.map(asPreviewRow),
    errors,
    counts: {
      processed: processedRows,
      valid: validRows,
      invalid: invalidRows,
      ignoredDuplicate: 0,
      imported: 0,
    },
    canonicalInput,
    canonicalInputHex: canonicalInput,
    fingerprint,
  };
}

/**
 * Parses and validates the canonical S04 CSV without throwing for input
 * validation failures. Structural failures return `ok: false`; row failures
 * remain in `errors` while valid candidates continue to the preview.
 */
export function parseCsvImport(
  input: CsvImportInput,
  options: CsvImportParserOptions = {},
): CsvImportParseResult {
  const bytes = inputToBytes(input);
  if (bytes === null) {
    return fileError("CSV_FILE_REQUIRED", {
      sourceFileSizeBytes: 0,
      sourceHasBom: false,
    });
  }

  const sourceFileSizeBytes = bytes.byteLength;
  const sourceHasBom = hasPrefix(bytes, UTF8_BOM);

  if (sourceFileSizeBytes > CSV_IMPORT_MAX_FILE_BYTES) {
    return fileError("CSV_FILE_TOO_LARGE", {
      sourceFileSizeBytes,
      sourceHasBom,
    });
  }

  const bomCount = countUtf8Boms(bytes);
  if (bomCount > 1 || (bomCount === 1 && !sourceHasBom)) {
    return fileError("CSV_INVALID_BOM", {
      sourceFileSizeBytes,
      sourceHasBom,
    });
  }

  if (containsNul(bytes)) {
    return fileError("CSV_INVALID_UTF8", {
      sourceFileSizeBytes,
      sourceHasBom,
    });
  }

  const payload = sourceHasBom ? bytes.subarray(UTF8_BOM.length) : bytes;
  let value: string;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    return fileError("CSV_INVALID_UTF8", {
      sourceFileSizeBytes,
      sourceHasBom,
    });
  }

  if (value.includes("\ufeff")) {
    return fileError("CSV_INVALID_BOM", {
      sourceFileSizeBytes,
      sourceHasBom,
    });
  }

  if (value.length === 0 || /^\s*$/u.test(value)) {
    return fileError("CSV_EMPTY_FILE", {
      sourceFileSizeBytes,
      sourceHasBom,
    });
  }

  if (hasBareCarriageReturn(value)) {
    return fileError("CSV_INVALID_NEWLINE", {
      sourceFileSizeBytes,
      sourceHasBom,
    });
  }

  const recordsOrError = parseRecords(value);
  if (!Array.isArray(recordsOrError)) {
    return {
      ...fileError(recordsOrError.code, {
        sourceFileSizeBytes,
        sourceHasBom,
      }),
      error: recordsOrError,
      errors: [recordsOrError],
    };
  }

  const records = recordsOrError;
  if (records.length === 0) {
    return fileError("CSV_EMPTY_FILE", {
      sourceFileSizeBytes,
      sourceHasBom,
    });
  }

  const rawHeader = firstLogicalRecord(value);
  if (
    containsUnquotedCharacter(rawHeader, ";") ||
    containsUnquotedCharacter(rawHeader, "\t")
  ) {
    return fileError("CSV_INVALID_DELIMITER", {
      sourceFileSizeBytes,
      sourceHasBom,
    });
  }

  const header = records[0];
  const duplicateColumns = header.some(
    (column, index) => header.indexOf(column) !== index,
  );
  if (duplicateColumns) {
    return fileError("CSV_DUPLICATE_COLUMN", {
      sourceFileSizeBytes,
      sourceHasBom,
    });
  }

  const knownColumns = new Set([
    ...CSV_IMPORT_BASE_COLUMNS,
    "external_id",
  ]);
  if (header.some((column) => !knownColumns.has(column))) {
    return fileError("CSV_UNKNOWN_COLUMN", {
      sourceFileSizeBytes,
      sourceHasBom,
    });
  }

  const sourceColumns = isExpectedHeader(header, rawHeader);
  if (sourceColumns === null) {
    return fileError("CSV_INVALID_HEADER", {
      sourceFileSizeBytes,
      sourceHasBom,
    });
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length === 0 || dataRecords.every(isAllEmptyRow)) {
    return fileError("CSV_NO_DATA_ROWS", {
      sourceFileSizeBytes,
      sourceHasBom,
      sourceColumns,
    });
  }

  return buildSuccess(
    bytes,
    sourceHasBom,
    sourceColumns,
    records,
    options,
  );
}

export const safeParseCsvImport = parseCsvImport;
export const parseCsvImportBytes = parseCsvImport;
export const parseS04Csv = parseCsvImport;
export const validateCsvImport = parseCsvImport;
