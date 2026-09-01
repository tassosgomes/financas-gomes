import type { Temporal } from "@js-temporal/polyfill";

/** The only CSV format accepted by the S04 import boundary. */
export const CSV_IMPORT_FORMAT_VERSION = "s04-csv-v1" as const;
export type CsvImportFormatVersion = typeof CSV_IMPORT_FORMAT_VERSION;

export const CSV_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const CSV_IMPORT_MAX_ROWS = 10_000;
export const CSV_IMPORT_MAX_FIELD_BYTES = 16 * 1024;
export const CSV_IMPORT_MAX_DESCRIPTION_CODE_POINTS = 240;
export const CSV_IMPORT_MAX_EXTERNAL_ID_CODE_POINTS = 128;
export const CSV_IMPORT_COMMAND_ID_MAX_LENGTH = 128;
export const CSV_IMPORT_BIGINT_MAX = BigInt("9223372036854775807");

export const CSV_IMPORT_BASE_COLUMNS = [
  "occurred_on",
  "description",
  "amount_cents",
] as const;
export const CSV_IMPORT_EXTERNAL_ID_COLUMNS = [
  ...CSV_IMPORT_BASE_COLUMNS,
  "external_id",
] as const;

export type CsvImportSourceColumns = "BASE" | "WITH_EXTERNAL_ID";

export const CSV_IMPORT_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INVALID_COMMAND",
  "INVALID_COMMAND_ID",
  "CSV_FILE_REQUIRED",
  "CSV_FILE_TOO_LARGE",
  "CSV_TOO_MANY_ROWS",
  "CSV_INVALID_UTF8",
  "CSV_INVALID_BOM",
  "CSV_INVALID_NEWLINE",
  "CSV_INVALID_HEADER",
  "CSV_UNKNOWN_COLUMN",
  "CSV_DUPLICATE_COLUMN",
  "CSV_INVALID_DELIMITER",
  "CSV_MALFORMED_QUOTING",
  "CSV_EMPTY_FILE",
  "CSV_NO_DATA_ROWS",
  "CSV_FIELD_TOO_LARGE",
  "CSV_ROW_WIDTH_MISMATCH",
  "CSV_EMPTY_ROW",
  "CSV_INVALID_DATE",
  "CSV_DATE_IN_FUTURE",
  "CSV_INVALID_DESCRIPTION",
  "CSV_INVALID_AMOUNT",
  "CSV_ZERO_AMOUNT",
  "CSV_AMOUNT_OVERFLOW",
  "CSV_INVALID_EXTERNAL_ID",
  "ACCOUNT_NOT_FOUND",
  "RESOURCE_ARCHIVED",
  "TRACKING_START_DATE_VIOLATION",
  "IMPORT_NO_VALID_ROWS",
  "PREVIEW_NOT_FOUND",
  "PREVIEW_EXPIRED",
  "PREVIEW_ALREADY_CONSUMED",
  "IMPORT_DATASET_ALREADY_IMPORTED",
  "COMMAND_ID_REUSED",
] as const;

export type CsvImportErrorCode = (typeof CSV_IMPORT_ERROR_CODES)[number];

export type CsvImportErrorScope = "file" | "row" | "preview" | "confirmation";

export type CsvImportErrorField =
  | "commandId"
  | "accountId"
  | "previewToken"
  | "occurredOn"
  | "description"
  | "amountCents"
  | "externalId";

export interface CsvImportError {
  code: CsvImportErrorCode;
  scope: CsvImportErrorScope;
  message: string;
  rowNumber?: number;
  field?: CsvImportErrorField;
}

export type CsvImportRowError = CsvImportError & {
  scope: "row";
  rowNumber: number;
  field?: Extract<
    CsvImportErrorField,
    "occurredOn" | "description" | "amountCents" | "externalId"
  >;
};

export const CSV_IMPORT_ERROR_MESSAGES: Readonly<
  Record<CsvImportErrorCode, string>
> = {
  UNAUTHENTICATED: "É necessário entrar para acessar este recurso.",
  INVALID_COMMAND: "Os dados da operação são inválidos.",
  INVALID_COMMAND_ID: "O identificador da operação é inválido.",
  CSV_FILE_REQUIRED: "Selecione um arquivo CSV.",
  CSV_FILE_TOO_LARGE: "O arquivo CSV excede o limite de 5 MiB.",
  CSV_TOO_MANY_ROWS: "O arquivo CSV excede o limite de 10.000 registros.",
  CSV_INVALID_UTF8: "O arquivo CSV precisa usar UTF-8 válido.",
  CSV_INVALID_BOM: "O arquivo CSV contém uma marca BOM inválida.",
  CSV_INVALID_NEWLINE: "Use somente quebras de linha LF ou CRLF no arquivo CSV.",
  CSV_INVALID_HEADER: "O cabeçalho não corresponde ao formato CSV aceito.",
  CSV_UNKNOWN_COLUMN: "O cabeçalho contém uma coluna desconhecida.",
  CSV_DUPLICATE_COLUMN: "O cabeçalho contém uma coluna repetida.",
  CSV_INVALID_DELIMITER: "Use vírgula como delimitador do CSV.",
  CSV_MALFORMED_QUOTING: "Há aspas ou escapes inválidos no CSV.",
  CSV_EMPTY_FILE: "O arquivo CSV está vazio.",
  CSV_NO_DATA_ROWS: "O arquivo CSV não contém registros de dados.",
  CSV_FIELD_TOO_LARGE: "Um campo excede o limite permitido de 16 KiB.",
  CSV_ROW_WIDTH_MISMATCH: "A linha não possui as colunas esperadas.",
  CSV_EMPTY_ROW: "A linha está vazia; informe todos os campos obrigatórios.",
  CSV_INVALID_DATE: "Informe uma data válida no formato AAAA-MM-DD.",
  CSV_DATE_IN_FUTURE: "A data do lançamento não pode estar no futuro.",
  CSV_INVALID_DESCRIPTION:
    "Informe uma descrição entre 1 e 240 caracteres válidos.",
  CSV_INVALID_AMOUNT:
    "Informe um valor inteiro em centavos, sem moeda ou separador.",
  CSV_ZERO_AMOUNT: "O valor em centavos não pode ser zero.",
  CSV_AMOUNT_OVERFLOW: "O valor em centavos excede o limite suportado.",
  CSV_INVALID_EXTERNAL_ID: "Informe um identificador externo válido.",
  ACCOUNT_NOT_FOUND: "A conta não foi encontrada.",
  RESOURCE_ARCHIVED: "A conta está arquivada e não pode ser usada.",
  TRACKING_START_DATE_VIOLATION:
    "A data do lançamento não pode preceder o início do acompanhamento da conta.",
  IMPORT_NO_VALID_ROWS: "O arquivo não contém linhas válidas para importar.",
  PREVIEW_NOT_FOUND: "A prévia não foi encontrada.",
  PREVIEW_EXPIRED: "A prévia expirou; envie o arquivo novamente.",
  PREVIEW_ALREADY_CONSUMED: "A prévia já foi utilizada.",
  IMPORT_DATASET_ALREADY_IMPORTED: "Este conjunto de dados já foi importado.",
  COMMAND_ID_REUSED: "O identificador da operação já foi utilizado.",
};

export type CsvImportKind = "INCOME" | "EXPENSE";

/**
 * A normalized line ready for the preview/confirmation staging boundary.
 * Amounts remain strings so no bigint crosses a React/Next serialization
 * boundary; `amountCents` is the positive event amount and
 * `signedAmountCents` is the ledger effect.
 */
export interface CsvImportCandidate {
  rowNumber: number;
  occurredOn: string;
  description: string;
  amountCents: string;
  signedAmountCents: string;
  kind: CsvImportKind;
  externalId: string | null;
}

export interface CsvImportPreviewRow {
  rowNumber: number;
  occurredOn: string;
  description: string;
  signedAmountCents: string;
  kind: CsvImportKind;
  externalId: string | null;
}

export interface CsvImportCounts {
  processed: number;
  valid: number;
  invalid: number;
  ignoredDuplicate: number;
  imported: number;
}

/**
 * The duplicate decision is made by the server for the selected account.
 * The client may render it, but it cannot override it or provide a dataset
 * fingerprint as confirmation authority.
 */
export type CsvImportDuplicateStatus = "NEW" | "ALREADY_IMPORTED";

/**
 * Serializable preview returned by the authenticated preview adapter.
 * `accountId` is display context only; confirmation accepts no account,
 * household, candidate, or fingerprint fields from the browser.
 */
export interface CsvImportPreview {
  formatVersion: CsvImportFormatVersion;
  previewToken: string;
  expiresAt: string;
  accountId: string;
  duplicateStatus: CsvImportDuplicateStatus;
  existingImportId: string | null;
  counts: CsvImportCounts;
  rows: CsvImportPreviewRow[];
  errors: CsvImportRowError[];
}

/**
 * Untrusted preview input. `accountId` is only a selection hint: the preview
 * use case resolves the authenticated household and re-reads the account on
 * the server before it consumes `file` or writes staging.
 */
export interface CsvImportPreviewCommand {
  accountId: string;
  file: CsvImportPreviewFile;
}

export type PreviewCsvImportCommand = CsvImportPreviewCommand;

/** Server Action-friendly upload value; browser `File` satisfies this shape. */
export interface CsvImportUpload {
  arrayBuffer(): Promise<ArrayBuffer | Uint8Array>;
}

export type CsvImportPreviewFile = CsvImportInput | CsvImportUpload;

/** Result envelope used by the Server Action boundary for preview. */
export type CsvImportPreviewResult =
  | { ok: true; value: CsvImportPreview }
  | { ok: false; error: CsvImportError };

/** Stable operation name shared by the confirmation command adapter. */
export const CSV_IMPORT_CONFIRM_OPERATION = "transactions.import.confirm" as const;
export const TRANSACTION_IMPORT_CONFIRM_OPERATION = CSV_IMPORT_CONFIRM_OPERATION;

/**
 * The only client-supplied fields accepted by confirmation. Both values are
 * opaque: the server resolves the token to server-side staging and derives
 * every financial/tenant value from that staging and the authenticated
 * context.
 */
export interface ConfirmTransactionImportCommand {
  commandId: string;
  previewToken: string;
}

export type CsvImportConfirmationCommand = ConfirmTransactionImportCommand;

/** Result returned after a new dataset is committed atomically. */
export interface ConfirmedCsvImportResult {
  status: "IMPORTED";
  importId: string;
  accountId: string;
  counts: CsvImportCounts;
  errors: CsvImportRowError[];
}

/** Result returned when the normalized dataset already exists for the scope. */
export interface DuplicateCsvImportResult {
  status: "DUPLICATE_DATASET";
  existingImportId: string;
  accountId: string;
  counts: CsvImportCounts;
  errors: CsvImportRowError[];
}

export type CsvImportConfirmationResult =
  | ConfirmedCsvImportResult
  | DuplicateCsvImportResult;

/** Alias used by report-oriented callers without introducing another shape. */
export type CsvImportResult = CsvImportConfirmationResult;

/** ADR-005 names this envelope `S04Error`; the CSV adapter uses the same shape. */
export type S04Error = CsvImportError;

export interface CsvImportParserOptions {
  /** Browser-provided MIME is informational only and never authorizes parsing. */
  mimeType?: string;
  /** Server business date used for the POSTED/future-date invariant. */
  today?: string | Temporal.PlainDate;
  /** Optional account tracking anchor checked for every valid candidate. */
  trackingStartedOn?: string | Temporal.PlainDate | null;
  /** Alias useful to callers that name the account field explicitly. */
  accountTrackingStartedOn?: string | Temporal.PlainDate | null;
}

export interface CsvImportParseSuccess {
  ok: true;
  formatVersion: CsvImportFormatVersion;
  sourceFileSizeBytes: number;
  sourceHasBom: boolean;
  sourceColumns: CsvImportSourceColumns;
  processedRows: number;
  validRows: number;
  invalidRows: number;
  candidates: CsvImportCandidate[];
  rows: CsvImportPreviewRow[];
  errors: CsvImportRowError[];
  counts: CsvImportCounts;
  /** Hex encoding of the exact bytes fed into the SHA-256 digest. */
  canonicalInput: string;
  canonicalInputHex: string;
  fingerprint: string;
}

export interface CsvImportParseFailure {
  ok: false;
  formatVersion: CsvImportFormatVersion;
  sourceFileSizeBytes: number;
  sourceHasBom: boolean;
  sourceColumns: CsvImportSourceColumns | null;
  processedRows: 0;
  validRows: 0;
  invalidRows: 0;
  candidates: [];
  rows: [];
  errors: [CsvImportError];
  counts: CsvImportCounts;
  error: CsvImportError;
  canonicalInput: "";
  canonicalInputHex: "";
  fingerprint: null;
}

export type CsvImportParseResult =
  | CsvImportParseSuccess
  | CsvImportParseFailure;

/** Input accepted by the parser; strings are encoded as UTF-8 for tests/UI adapters. */
export type CsvImportInput = Uint8Array | ArrayBuffer | string;

/** Public shape accepted by the fingerprint helper. */
export type CsvImportFingerprintCandidate = Pick<
  CsvImportCandidate,
  "occurredOn" | "description" | "signedAmountCents" | "externalId"
>;
