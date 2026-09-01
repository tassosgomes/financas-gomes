import { createHash, randomBytes } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";

import { and, eq, lte } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import { accounts } from "@/db/accounts-categories-schema";
import {
  transactionImportStaging,
  transactionImports,
} from "@/db/transaction-imports-schema";
import { isUuidV7 } from "@/lib/uuidv7";
import {
  assertFinancialContext,
} from "@/modules/households/tenant-scoped";
import {
  FinancialContextError,
  type FinancialContext,
} from "@/modules/households/contracts";
import { generateUuidV7 } from "@/lib/uuidv7";

import {
  CSV_IMPORT_ERROR_CODES,
  CSV_IMPORT_ERROR_MESSAGES,
  CSV_IMPORT_FORMAT_VERSION,
  type CsvImportCandidate,
  type CsvImportError,
  type CsvImportInput,
  type CsvImportParseFailure,
  type CsvImportParserOptions,
  type CsvImportPreview,
  type CsvImportPreviewCommand,
  type CsvImportPreviewFile,
  type CsvImportPreviewResult,
  type CsvImportPreviewRow,
  type CsvImportRowError,
} from "./contracts";
import { fingerprintCsvImport } from "./fingerprint";
import { parseCsvImport } from "./csv-parser";

/** Preview tokens are short-lived bearer capabilities and never persisted raw. */
export const CSV_IMPORT_PREVIEW_TTL_MS = 15 * 60 * 1000;
export const CSV_IMPORT_PREVIEW_TTL_SECONDS = CSV_IMPORT_PREVIEW_TTL_MS / 1000;

/** Stable operation name useful to adapters and observability consumers. */
export const CSV_IMPORT_PREVIEW_OPERATION = "transactions.import.preview" as const;
export const TRANSACTION_IMPORT_PREVIEW_OPERATION =
  CSV_IMPORT_PREVIEW_OPERATION;

type PreviewTransaction =
  Parameters<NonNullable<ReturnType<typeof getDb>["transaction"]>>[0] extends (
    transaction: infer T,
  ) => Promise<unknown>
    ? T
    : never;

type PreviewExecutor = Database | PreviewTransaction;

/** Options are injectable only for deterministic tests/composition. */
export interface CsvImportPreviewUseCaseOptions {
  database?: Database;
  /** Fixed server clock. Production should omit this and use the system clock. */
  now?: Date;
  /** Alternative clock hook useful to integration tests. */
  clock?: () => Date;
  /** Explicit server business date; never read from the browser. */
  today?: CsvImportParserOptions["today"];
  /** Cryptographic token factory override for deterministic tests only. */
  tokenFactory?: () => string;
  /** Alias accepted by composition layers that call this a token generator. */
  tokenGenerator?: () => string;
}

/** Port consumed by the authenticated Server Action adapter. */
export interface CsvImportPreviewUseCasePort {
  preview(
    context: FinancialContext,
    command: CsvImportPreviewCommand,
  ): Promise<CsvImportPreview>;
  previewCsvImport?(
    context: FinancialContext,
    command: CsvImportPreviewCommand,
  ): Promise<CsvImportPreview>;
  createPreview?(
    context: FinancialContext,
    command: CsvImportPreviewCommand,
  ): Promise<CsvImportPreview>;
  /** Result-form convenience for callers that do not use exception boundaries. */
  previewResult?(
    context: FinancialContext,
    command: CsvImportPreviewCommand,
  ): Promise<CsvImportPreviewResult>;
}

/** Expected domain failure with a stable ADR-005 public code. */
export class CsvImportDomainError extends Error {
  readonly code: CsvImportError["code"];
  readonly field: CsvImportError["field"] | undefined;
  readonly scope: CsvImportError["scope"];
  readonly rowNumber: number | undefined;
  readonly status: number;
  readonly expected = true;

  constructor(
    code: CsvImportError["code"],
    field?: CsvImportError["field"],
    scope: CsvImportError["scope"] = "preview",
    rowNumber?: number,
  ) {
    super(CSV_IMPORT_ERROR_MESSAGES[code]);
    this.name = "CsvImportDomainError";
    this.code = code;
    this.field = field;
    this.scope = scope;
    this.rowNumber = rowNumber;
    this.status = statusForCsvImportError(code);
  }

  toError(): CsvImportError {
    return {
      code: this.code,
      scope: this.scope,
      message: CSV_IMPORT_ERROR_MESSAGES[this.code],
      ...(this.rowNumber === undefined ? {} : { rowNumber: this.rowNumber }),
      ...(this.field === undefined ? {} : { field: this.field }),
    };
  }

  static from(error: CsvImportError): CsvImportDomainError {
    return new CsvImportDomainError(
      error.code,
      error.field,
      error.scope,
      error.rowNumber,
    );
  }
}

/** Compatibility aliases for callers that use a more generic domain name. */
export const TransactionImportDomainError = CsvImportDomainError;
export const CsvPreviewDomainError = CsvImportDomainError;

function statusForCsvImportError(code: CsvImportError["code"]): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "ACCOUNT_NOT_FOUND":
    case "PREVIEW_NOT_FOUND":
      return 404;
    case "RESOURCE_ARCHIVED":
    case "PREVIEW_EXPIRED":
    case "PREVIEW_ALREADY_CONSUMED":
    case "IMPORT_DATASET_ALREADY_IMPORTED":
    case "COMMAND_ID_REUSED":
      return 409;
    default:
      return 400;
  }
}

function isCsvImportErrorCode(value: unknown): value is CsvImportError["code"] {
  return (
    typeof value === "string" &&
    CSV_IMPORT_ERROR_CODES.includes(value as CsvImportError["code"])
  );
}

/**
 * Converts only the allow-listed CSV error fields across a boundary. Parser
 * messages are intentionally ignored so a future parser cannot leak input or
 * implementation details into a Server Action response.
 */
export function toSafeCsvImportError(error: unknown): CsvImportError {
  if (error instanceof CsvImportDomainError) {
    return error.toError();
  }

  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      code?: unknown;
      scope?: unknown;
      field?: unknown;
      rowNumber?: unknown;
    };
    if (isCsvImportErrorCode(candidate.code)) {
      const rowNumber =
        Number.isInteger(candidate.rowNumber) &&
        Number(candidate.rowNumber) >= 2
          ? Number(candidate.rowNumber)
          : undefined;
      const scope: CsvImportError["scope"] =
        candidate.scope === "file" ||
        candidate.scope === "row" ||
        candidate.scope === "preview" ||
        candidate.scope === "confirmation"
          ? candidate.scope
          : "preview";
      const field = isCsvImportErrorField(candidate.field)
        ? candidate.field
        : undefined;
      return {
        code: candidate.code,
        scope,
        message: CSV_IMPORT_ERROR_MESSAGES[candidate.code],
        ...(rowNumber === undefined ? {} : { rowNumber }),
        ...(field === undefined ? {} : { field }),
      };
    }
  }

  return {
    code: "INVALID_COMMAND",
    scope: "preview",
    message: CSV_IMPORT_ERROR_MESSAGES.INVALID_COMMAND,
  };
}

function isCsvImportErrorField(value: unknown): value is CsvImportError["field"] {
  return (
    value === "commandId" ||
    value === "accountId" ||
    value === "previewToken" ||
    value === "occurredOn" ||
    value === "description" ||
    value === "amountCents" ||
    value === "externalId"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeAccountId(value: unknown): string {
  if (typeof value !== "string") {
    throw new CsvImportDomainError("ACCOUNT_NOT_FOUND", "accountId");
  }

  const normalized = value.trim();
  // Do not send attacker-controlled malformed UUIDs to PostgreSQL. A valid
  // UUID from another household still reaches the tenant predicate and is
  // intentionally indistinguishable from an absent account.
  if (!isUuidV7(normalized)) {
    throw new CsvImportDomainError("ACCOUNT_NOT_FOUND", "accountId");
  }

  return normalized;
}

function assertPreviewCommand(value: unknown): asserts value is CsvImportPreviewCommand {
  if (!isRecord(value)) {
    throw new CsvImportDomainError("INVALID_COMMAND", undefined, "preview");
  }

  const keys = Object.keys(value);
  if (keys.some((key) => key !== "accountId" && key !== "file")) {
    throw new CsvImportDomainError("INVALID_COMMAND", undefined, "preview");
  }

  normalizeAccountId(value.accountId);
  if (!("file" in value) || value.file === undefined || value.file === null) {
    throw new CsvImportDomainError("CSV_FILE_REQUIRED", undefined, "file");
  }
}

function resolveNow(options: CsvImportPreviewUseCaseOptions): Date {
  const raw = options.clock?.() ?? options.now ?? new Date();
  const now = new Date(raw.getTime());
  if (!Number.isFinite(now.getTime())) {
    throw new Error("O relógio do servidor retornou uma data inválida.");
  }
  return now;
}

function businessDateFromNow(now: Date): string {
  // Use the server process' civil timezone, matching Temporal.Now's default in
  // T03. A caller with a product-specific business timezone can still provide
  // the explicit `today` option at composition time.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
}

function isCsvInput(value: unknown): value is CsvImportInput {
  return (
    typeof value === "string" ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer
  );
}

async function readUpload(value: CsvImportPreviewFile): Promise<CsvImportInput> {
  if (isCsvInput(value)) {
    return value;
  }

  if (isRecord(value) && typeof value.arrayBuffer === "function") {
    try {
      const result = await value.arrayBuffer();
      if (isCsvInput(result)) {
        return result;
      }
    } catch {
      // A failed upload read is an actionable input failure; the underlying
      // browser/runtime error must not cross the Server Action boundary.
    }
  }

  throw new CsvImportDomainError("CSV_FILE_REQUIRED", undefined, "file");
}

async function findAccount(
  executor: PreviewExecutor,
  context: FinancialContext,
  accountId: string,
  lock = false,
) {
  const predicate = and(
    eq(accounts.id, accountId),
    eq(accounts.householdId, context.householdId),
  );

  if (lock) {
    const rows = await executor
      .select()
      .from(accounts)
      .where(predicate)
      .limit(1)
      .for("update");
    return rows[0];
  }

  const rows = await executor
    .select()
    .from(accounts)
    .where(predicate)
    .limit(1);
  return rows[0];
}

function assertAccountCanReceivePreview(
  account: Awaited<ReturnType<typeof findAccount>>,
): NonNullable<Awaited<ReturnType<typeof findAccount>>> {
  if (!account) {
    throw new CsvImportDomainError("ACCOUNT_NOT_FOUND", "accountId");
  }
  if (account.status !== "ACTIVE") {
    throw new CsvImportDomainError("RESOURCE_ARCHIVED", "accountId");
  }
  return account;
}

function sanitizeRowErrors(
  errors: readonly CsvImportRowError[],
): CsvImportRowError[] {
  return errors.map((error) => ({
    rowNumber: error.rowNumber,
    code: error.code,
    scope: "row",
    message: CSV_IMPORT_ERROR_MESSAGES[error.code],
    ...(error.field === undefined ? {} : { field: error.field }),
  }));
}

function toPreviewRow(candidate: CsvImportCandidate): CsvImportPreviewRow {
  return {
    rowNumber: candidate.rowNumber,
    occurredOn: candidate.occurredOn,
    description: candidate.description,
    signedAmountCents: candidate.signedAmountCents,
    kind: candidate.kind,
    externalId: candidate.externalId,
  };
}

function createPreviewToken(options: CsvImportPreviewUseCaseOptions): string {
  const factory = options.tokenFactory ?? options.tokenGenerator;
  const token = factory ? factory() : randomBytes(32).toString("base64url");
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    /[\p{Cc}\p{Cf}]/u.test(token)
  ) {
    throw new Error("A fábrica de token de prévia retornou um valor inválido.");
  }
  return token;
}

export function hashCsvImportPreviewToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export const hashTransactionImportPreviewToken = hashCsvImportPreviewToken;

function parseOptions(
  databaseOrOptions?: Database | CsvImportPreviewUseCaseOptions,
  extraOptions: Omit<CsvImportPreviewUseCaseOptions, "database"> = {},
): CsvImportPreviewUseCaseOptions {
  if (isRecord(databaseOrOptions) && "select" in databaseOrOptions) {
    return {
      ...extraOptions,
      database: databaseOrOptions as unknown as Database,
    };
  }
  return databaseOrOptions === undefined
    ? extraOptions
    : (databaseOrOptions as CsvImportPreviewUseCaseOptions);
}

function resolveDatabase(database?: Database): Database {
  return database ?? getDb();
}

function previewFromParse(
  parsed: Exclude<Awaited<ReturnType<typeof parseCsvImport>>, CsvImportParseFailure>,
  accountId: string,
  token: string,
  expiresAt: Date,
  duplicateStatus: CsvImportPreview["duplicateStatus"],
  existingImportId: string | null,
): CsvImportPreview {
  return {
    formatVersion: CSV_IMPORT_FORMAT_VERSION,
    previewToken: token,
    expiresAt: expiresAt.toISOString(),
    accountId,
    duplicateStatus,
    existingImportId,
    counts: {
      processed: parsed.processedRows,
      valid: parsed.candidates.length,
      invalid: new Set(parsed.errors.map((error) => error.rowNumber)).size,
      ignoredDuplicate: 0,
      imported: 0,
    },
    rows: parsed.candidates.map(toPreviewRow),
    errors: sanitizeRowErrors(parsed.errors),
  };
}

/**
 * Executes the authenticated preview boundary. The first account lookup is
 * deliberately before reading/parsing the upload; the transaction repeats it
 * with a lock to close the archive race before staging is inserted.
 */
async function executePreview(
  database: Database,
  context: FinancialContext,
  command: CsvImportPreviewCommand,
  options: CsvImportPreviewUseCaseOptions,
): Promise<CsvImportPreview> {
  assertFinancialContext(context);
  assertPreviewCommand(command);
  const accountId = normalizeAccountId(command.accountId);
  const account = assertAccountCanReceivePreview(
    await findAccount(database, context, accountId),
  );
  const now = resolveNow(options);
  const expiresAt = new Date(now.getTime() + CSV_IMPORT_PREVIEW_TTL_MS);
  const input = await readUpload(command.file);

  const parserOptions: CsvImportParserOptions = {
    today: options.today ?? businessDateFromNow(now),
    trackingStartedOn: account.trackingStartedOn,
  };
  const parsed = parseCsvImport(input, parserOptions);
  if (!parsed.ok) {
    throw CsvImportDomainError.from(parsed.error);
  }

  // Recompute from candidates at this boundary: parser metadata is not a
  // client authority, and T07 will resolve the same normalized payload from
  // staging rather than accepting anything from the browser.
  const fingerprint = fingerprintCsvImport(parsed.candidates);
  const safeErrors = sanitizeRowErrors(parsed.errors);
  const previewToken = parsed.candidates.length > 0 ? createPreviewToken(options) : "";
  const preview = previewFromParse(
    parsed,
    account.id,
    previewToken,
    expiresAt,
    "NEW",
    null,
  );

  if (parsed.candidates.length === 0) {
    // A report with no valid rows is useful to the UI, but has no bearer
    // capability and therefore cannot be confirmed.
    return preview;
  }

  const tokenHash = hashCsvImportPreviewToken(previewToken);
  return database.transaction(async (transaction) => {
    const currentAccount = assertAccountCanReceivePreview(
      await findAccount(transaction, context, account.id, true),
    );

    // Expired capabilities are no longer useful and may contain normalized
    // financial candidates, so remove them opportunistically within the
    // current household boundary before creating the next staging row.
    await transaction
      .delete(transactionImportStaging)
      .where(
        and(
          eq(transactionImportStaging.householdId, context.householdId),
          lte(transactionImportStaging.expiresAt, now),
        ),
      );

    const existingImports = await transaction
      .select({ id: transactionImports.id })
      .from(transactionImports)
      .where(
        and(
          eq(transactionImports.householdId, context.householdId),
          eq(transactionImports.accountId, currentAccount.id),
          eq(transactionImports.datasetFingerprint, fingerprint),
          eq(transactionImports.status, "CONFIRMED"),
        ),
      )
      .limit(1);
    const existingImportId = existingImports[0]?.id ?? null;
    const duplicateStatus = existingImportId ? "ALREADY_IMPORTED" : "NEW";

    await transaction.insert(transactionImportStaging).values({
      id: generateUuidV7(),
      householdId: context.householdId,
      accountId: currentAccount.id,
      tokenHash,
      datasetFingerprint: fingerprint,
      formatVersion: CSV_IMPORT_FORMAT_VERSION,
      sourceFileSizeBytes: parsed.sourceFileSizeBytes,
      sourceHasBom: parsed.sourceHasBom,
      sourceColumns: parsed.sourceColumns,
      processedRows: parsed.processedRows,
      validRows: parsed.candidates.length,
      invalidRows: preview.counts.invalid,
      errors: safeErrors,
      candidateRows: parsed.candidates,
      expiresAt,
      createdAt: now,
    });

    return {
      ...preview,
      accountId: currentAccount.id,
      duplicateStatus,
      existingImportId,
    };
  });
}

/** Builds the server-side port with lazy database resolution. */
export function createCsvImportPreviewUseCase(
  database?: Database,
): CsvImportPreviewUseCasePort;
export function createCsvImportPreviewUseCase(
  options?: CsvImportPreviewUseCaseOptions,
): CsvImportPreviewUseCasePort;
export function createCsvImportPreviewUseCase(
  database: Database,
  options?: Omit<CsvImportPreviewUseCaseOptions, "database">,
): CsvImportPreviewUseCasePort;
export function createCsvImportPreviewUseCase(
  databaseOrOptions?: Database | CsvImportPreviewUseCaseOptions,
  extraOptions: Omit<CsvImportPreviewUseCaseOptions, "database"> = {},
): CsvImportPreviewUseCasePort {
  const options = parseOptions(databaseOrOptions, extraOptions);
  const database = options.database;
  const preview = (context: FinancialContext, command: CsvImportPreviewCommand) =>
    executePreview(resolveDatabase(database), context, command, options);
  return {
    preview,
    previewCsvImport: preview,
    createPreview: preview,
    async previewResult(context, command) {
      try {
        return { ok: true, value: await preview(context, command) };
      } catch (error) {
        if (error instanceof CsvImportDomainError) {
          return { ok: false, error: error.toError() };
        }
        if (error instanceof FinancialContextError) {
          return {
            ok: false,
            error: {
              code: "UNAUTHENTICATED",
              scope: "preview",
              message: CSV_IMPORT_ERROR_MESSAGES.UNAUTHENTICATED,
            },
          };
        }
        throw error;
      }
    },
  };
}

/** Naming aliases keep the port discoverable from T06/T07 composition code. */
export const createTransactionImportPreviewUseCase =
  createCsvImportPreviewUseCase;
export const createPreviewCsvImportUseCase = createCsvImportPreviewUseCase;
export const createCsvImportPreviewUseCases = createCsvImportPreviewUseCase;

/** Lazily resolved production port used by the Server Action adapter. */
export const csvImportPreviewUseCase = createCsvImportPreviewUseCase();
export const transactionImportPreviewUseCase = csvImportPreviewUseCase;

/** Convenience direct call for server-side callers/tests. */
export async function previewCsvImport(
  context: FinancialContext,
  command: CsvImportPreviewCommand,
  databaseOrOptions?: Database | CsvImportPreviewUseCaseOptions,
): Promise<CsvImportPreview> {
  return createCsvImportPreviewUseCase(parseOptions(databaseOrOptions)).preview(
    context,
    command,
  );
}

export const previewTransactionImport = previewCsvImport;
export const createCsvImportPreview = previewCsvImport;
export const previewImport = previewCsvImport;

// T07 keeps confirmation persistence in a focused module while preserving the
// historical `use-cases` barrel used by slice consumers and integration tests.
export {
  ConfirmTransactionImport,
  confirmCsvImport,
  confirmImport,
  confirmTransactionImport,
  confirmTransactionImportCsv,
  confirmTransactionImportUseCase,
  confirmCsvImportUseCase,
  confirmImportUseCase,
  createConfirmImportUseCase,
  createCsvImportConfirmUseCase,
  createConfirmCsvImportUseCase,
  createConfirmTransactionImportUseCase,
  createCsvImportConfirmationUseCase,
  createTransactionImportConfirmUseCase,
  createTransactionImportConfirmationUseCase,
  csvImportConfirmationUseCase,
  hashCsvImportConfirmationPayload,
  hashTransactionImportConfirmationPayload,
  transactionImportConfirmUseCase,
  transactionImportConfirmationUseCase,
} from "./confirmation-use-cases";
export type {
  CsvImportConfirmationResultEnvelope,
  CsvImportConfirmationUseCaseOptions,
  CsvImportConfirmationUseCasePort,
} from "./confirmation-use-cases";

// T08 report reads share the same context-first boundary as confirmation and
// remain available from the historical use-cases barrel used by T10–T13.
export {
  createCsvImportReportAccess,
  createCsvImportReportQueries,
  createTransactionImportReportQueries,
  csvImportReportAccess,
  findCsvImportReport,
  findCsvImportReportForContext,
  findTransactionImportReport,
  findTransactionImportReportForContext,
  getCsvImportReport,
  getCsvImportReportForContext,
  getTransactionImportReport,
  getTransactionImportReportForContext,
  readCsvImportReport,
  readCsvImportReportForContext,
  readTransactionImportReport,
  readTransactionImportReportForContext,
  sanitizeCsvImportReportErrors,
  toCsvImportReport,
  transactionImportReportAccess,
} from "./reports";
export type {
  CsvImportReport,
  CsvImportReportAccess,
  CsvImportReportExecutor,
  CsvImportReportQueries,
  CsvImportReportReadModel,
} from "./reports";
