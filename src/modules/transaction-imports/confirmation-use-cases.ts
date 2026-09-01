import { createHash } from "node:crypto";

import { Temporal } from "@js-temporal/polyfill";
import { and, eq } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  accounts,
  applicationCommands,
  type ApplicationCommandRecord,
} from "@/db/accounts-categories-schema";
import {
  transactionImportItems,
  transactionImportStaging,
  transactionImports,
  type TransactionImportRecord,
} from "@/db/transaction-imports-schema";
import { generateUuidV7 } from "@/lib/uuidv7";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import type { FinancialContext } from "@/modules/households/contracts";
import {
  formatFinancialDate,
  parseFinancialDate,
} from "@/modules/transactions/dates";
import {
  insertAccountEntryForContext,
  insertFinancialEventForContext,
  type TransactionReferenceTransaction,
} from "@/modules/transactions/references";

import {
  CSV_IMPORT_BIGINT_MAX,
  CSV_IMPORT_CONFIRM_OPERATION,
  CSV_IMPORT_ERROR_CODES,
  CSV_IMPORT_ERROR_MESSAGES,
  CSV_IMPORT_FORMAT_VERSION,
  CSV_IMPORT_MAX_DESCRIPTION_CODE_POINTS,
  CSV_IMPORT_MAX_EXTERNAL_ID_CODE_POINTS,
  type ConfirmTransactionImportCommand,
  type CsvImportCandidate,
  type CsvImportConfirmationResult,
  type CsvImportError,
  type CsvImportRowError,
} from "./contracts";
import {
  csvImportCommandIdSchema,
  parseConfirmTransactionImportCommand,
} from "./confirmation-validation";
import { fingerprintCsvImport } from "./fingerprint";
import {
  CsvImportDomainError,
  hashCsvImportPreviewToken,
} from "./use-cases";

/** The confirmation operation is shared with S03's application command table. */
export const TRANSACTION_IMPORT_CONFIRM_OPERATION =
  CSV_IMPORT_CONFIRM_OPERATION;

const SIGNED_DECIMAL_PATTERN = /^[+-]?[0-9]+$/u;
const CANONICAL_SIGNED_DECIMAL_PATTERN = /^-?[0-9]+$/u;
const ISO_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const ZERO = BigInt(0);

/** Injectable clock/options keep confirmation deterministic in integration tests. */
export interface CsvImportConfirmationUseCaseOptions {
  database?: Database;
  now?: Date;
  clock?: () => Date;
  /** Explicit server business date; never read from the browser. */
  today?: string | Temporal.PlainDate;
}

/** Port consumed by the authenticated confirmation Server Action adapter. */
export interface CsvImportConfirmationUseCasePort {
  confirm(
    context: FinancialContext,
    command: ConfirmTransactionImportCommand,
  ): Promise<CsvImportConfirmationResult>;
  confirmTransactionImport?(
    context: FinancialContext,
    command: ConfirmTransactionImportCommand,
  ): Promise<CsvImportConfirmationResult>;
  confirmCsvImport?(
    context: FinancialContext,
    command: ConfirmTransactionImportCommand,
  ): Promise<CsvImportConfirmationResult>;
  /** Convenience result envelope for non-Server-Action callers. */
  confirmResult?(
    context: FinancialContext,
    command: ConfirmTransactionImportCommand,
  ): Promise<CsvImportConfirmationResultEnvelope>;
}

export type CsvImportConfirmationResultEnvelope =
  | { ok: true; value: CsvImportConfirmationResult }
  | { ok: false; error: CsvImportError };

type ConfirmationTransaction = TransactionReferenceTransaction;

type StagingCandidatePayload = {
  candidates: CsvImportCandidate[];
  errors: CsvImportRowError[];
};

type CommandClaim =
  | { created: true; importId: string }
  | { created: false; record: ApplicationCommandRecord };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDatabase(value: unknown): value is Database {
  return isRecord(value) && "transaction" in value && "select" in value;
}

function resolveDatabase(database?: Database): Database {
  return database ?? getDb();
}

function resolveNow(options: CsvImportConfirmationUseCaseOptions): Date {
  const raw = options.clock?.() ?? options.now ?? new Date();
  const now = new Date(raw.getTime());
  if (!Number.isFinite(now.getTime())) {
    throw new Error("O relógio do servidor retornou uma data inválida.");
  }
  return now;
}

function businessDateFromNow(now: Date): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
}

function resolveBusinessDate(
  value: string | Temporal.PlainDate | undefined,
  now: Date,
): Temporal.PlainDate {
  if (value instanceof Temporal.PlainDate) {
    return value;
  }

  const serialized = value ?? businessDateFromNow(now);
  try {
    return parseFinancialDate(serialized);
  } catch {
    // This is server composition/configuration, not client data. Keep the
    // failure technical instead of exposing a misleading row error.
    throw new Error("A data de negócio do servidor é inválida.");
  }
}

function invalidCommand(): never {
  throw new CsvImportDomainError("INVALID_COMMAND", undefined, "confirmation");
}

function parseConfirmationCommand(
  input: unknown,
): ConfirmTransactionImportCommand {
  if (!isRecord(input)) {
    return invalidCommand();
  }

  const keys = Object.keys(input);
  if (keys.some((key) => key !== "commandId" && key !== "previewToken")) {
    return invalidCommand();
  }

  const commandIdResult = csvImportCommandIdSchema.safeParse(input.commandId);
  if (!commandIdResult.success) {
    throw new CsvImportDomainError(
      "INVALID_COMMAND_ID",
      "commandId",
      "confirmation",
    );
  }

  const parsed = parseConfirmTransactionImportCommand(input);
  if (!parsed) {
    throw new CsvImportDomainError(
      "INVALID_COMMAND",
      "previewToken",
      "confirmation",
    );
  }

  return parsed;
}

/**
 * Hashes only the server-resolved token identity. The raw bearer token and
 * any CSV payload never enter the command record or its comparison hash.
 */
export function hashCsvImportConfirmationPayload(tokenHash: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        operation: CSV_IMPORT_CONFIRM_OPERATION,
        previewTokenHash: tokenHash,
      }),
      "utf8",
    )
    .digest("hex");
}

export const hashTransactionImportConfirmationPayload =
  hashCsvImportConfirmationPayload;

function isCsvImportErrorCode(value: unknown): value is CsvImportError["code"] {
  return (
    typeof value === "string" &&
    CSV_IMPORT_ERROR_CODES.includes(value as CsvImportError["code"])
  );
}

function isRowErrorField(
  value: unknown,
): value is CsvImportRowError["field"] {
  return (
    value === undefined ||
    value === "occurredOn" ||
    value === "description" ||
    value === "amountCents" ||
    value === "externalId"
  );
}

/**
 * Rebuilds the public error vocabulary from JSONB without trusting stored
 * messages. Invalid staging JSON is an invariant failure and fails closed.
 */
function sanitizeStagingErrors(value: unknown): CsvImportRowError[] {
  if (!Array.isArray(value)) {
    throw new Error("O staging possui um relatório de erros inválido.");
  }

  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error("O staging possui um erro de linha inválido.");
    }
    const rowNumber = entry.rowNumber;
    const code = entry.code;
    const field = entry.field;
    if (
      !Number.isInteger(rowNumber) ||
      Number(rowNumber) < 2 ||
      !isCsvImportErrorCode(code) ||
      !isRowErrorField(field)
    ) {
      throw new Error("O staging possui um erro de linha inválido.");
    }

    return {
      rowNumber: Number(rowNumber),
      code,
      scope: "row" as const,
      message: CSV_IMPORT_ERROR_MESSAGES[code],
      ...(field === undefined ? {} : { field }),
    };
  });
}

function rowDomainError(
  code: CsvImportError["code"],
  rowNumber: number,
  field?: CsvImportError["field"],
): never {
  throw new CsvImportDomainError(code, field, "confirmation", rowNumber);
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function assertCanonicalDescription(
  value: unknown,
  rowNumber: number,
): asserts value is string {
  if (typeof value !== "string") {
    return rowDomainError("CSV_INVALID_DESCRIPTION", rowNumber, "description");
  }
  const normalized = value.normalize("NFKC");
  const canonical = normalized.trim().replace(/\s+/gu, " ");
  if (
    CONTROL_OR_FORMAT_CHARACTER.test(normalized) ||
    canonical !== value ||
    codePointLength(value) < 1 ||
    codePointLength(value) > CSV_IMPORT_MAX_DESCRIPTION_CODE_POINTS
  ) {
    return rowDomainError("CSV_INVALID_DESCRIPTION", rowNumber, "description");
  }
}

function assertCanonicalExternalId(
  value: unknown,
  rowNumber: number,
): asserts value is string | null {
  if (value === null) {
    return;
  }
  if (typeof value !== "string") {
    return rowDomainError("CSV_INVALID_EXTERNAL_ID", rowNumber, "externalId");
  }
  const normalized = value.normalize("NFKC").trim();
  if (
    CONTROL_OR_FORMAT_CHARACTER.test(normalized) ||
    normalized !== value ||
    codePointLength(value) < 1 ||
    codePointLength(value) > CSV_IMPORT_MAX_EXTERNAL_ID_CODE_POINTS
  ) {
    return rowDomainError("CSV_INVALID_EXTERNAL_ID", rowNumber, "externalId");
  }
}

function parseCandidateAmount(
  value: unknown,
  rowNumber: number,
): bigint {
  if (typeof value !== "string" || !SIGNED_DECIMAL_PATTERN.test(value)) {
    return rowDomainError("CSV_INVALID_AMOUNT", rowNumber, "amountCents");
  }

  let amount: bigint;
  try {
    amount = BigInt(value);
  } catch {
    return rowDomainError("CSV_INVALID_AMOUNT", rowNumber, "amountCents");
  }

  if (amount === ZERO) {
    return rowDomainError("CSV_ZERO_AMOUNT", rowNumber, "amountCents");
  }
  if (amount < ZERO || amount > CSV_IMPORT_BIGINT_MAX) {
    return rowDomainError("CSV_INVALID_AMOUNT", rowNumber, "amountCents");
  }
  if (amount.toString(10) !== value) {
    return rowDomainError("CSV_INVALID_AMOUNT", rowNumber, "amountCents");
  }
  return amount;
}

function parseCandidateSignedAmount(
  value: unknown,
  rowNumber: number,
): bigint {
  if (
    typeof value !== "string" ||
    !CANONICAL_SIGNED_DECIMAL_PATTERN.test(value)
  ) {
    return rowDomainError("CSV_INVALID_AMOUNT", rowNumber, "amountCents");
  }

  let signed: bigint;
  try {
    signed = BigInt(value);
  } catch {
    return rowDomainError("CSV_INVALID_AMOUNT", rowNumber, "amountCents");
  }

  if (signed === ZERO) {
    return rowDomainError("CSV_ZERO_AMOUNT", rowNumber, "amountCents");
  }
  if (signed > CSV_IMPORT_BIGINT_MAX || signed < -CSV_IMPORT_BIGINT_MAX) {
    return rowDomainError("CSV_AMOUNT_OVERFLOW", rowNumber, "amountCents");
  }
  if (signed.toString(10) !== value) {
    return rowDomainError("CSV_INVALID_AMOUNT", rowNumber, "amountCents");
  }
  return signed;
}

function assertCandidateDate(
  value: unknown,
  rowNumber: number,
  today: Temporal.PlainDate,
  trackingStartedOn: string | null,
): asserts value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return rowDomainError("CSV_INVALID_DATE", rowNumber, "occurredOn");
  }

  let occurredOn: Temporal.PlainDate;
  try {
    occurredOn = parseFinancialDate(value);
  } catch {
    return rowDomainError("CSV_INVALID_DATE", rowNumber, "occurredOn");
  }

  if (Temporal.PlainDate.compare(occurredOn, today) > 0) {
    return rowDomainError("CSV_DATE_IN_FUTURE", rowNumber, "occurredOn");
  }

  if (trackingStartedOn !== null) {
    let trackingDate: Temporal.PlainDate;
    try {
      trackingDate = parseFinancialDate(trackingStartedOn);
    } catch {
      throw new Error("A conta possui uma âncora temporal inválida.");
    }
    if (Temporal.PlainDate.compare(occurredOn, trackingDate) < 0) {
      return rowDomainError(
        "TRACKING_START_DATE_VIOLATION",
        rowNumber,
        "occurredOn",
      );
    }
  }
}

function validateCandidate(
  value: unknown,
  today: Temporal.PlainDate,
  trackingStartedOn: string | null,
): CsvImportCandidate {
  if (!isRecord(value)) {
    throw new Error("O staging possui uma candidata inválida.");
  }

  const rowNumber = value.rowNumber;
  if (!Number.isInteger(rowNumber) || Number(rowNumber) < 2) {
    throw new Error("O staging possui um número de linha inválido.");
  }
  const normalizedRowNumber = Number(rowNumber);

  const occurredOn = value.occurredOn;
  const description = value.description;
  const externalId = value.externalId;
  const amountCents = value.amountCents;
  const signedAmountCents = value.signedAmountCents;

  assertCandidateDate(
    occurredOn,
    normalizedRowNumber,
    today,
    trackingStartedOn,
  );
  assertCanonicalDescription(description, normalizedRowNumber);
  assertCanonicalExternalId(externalId, normalizedRowNumber);

  if (typeof amountCents !== "string") {
    return rowDomainError("CSV_INVALID_AMOUNT", normalizedRowNumber, "amountCents");
  }
  if (typeof signedAmountCents !== "string") {
    return rowDomainError("CSV_INVALID_AMOUNT", normalizedRowNumber, "amountCents");
  }
  const amount = parseCandidateAmount(amountCents, normalizedRowNumber);
  const signed = parseCandidateSignedAmount(
    signedAmountCents,
    normalizedRowNumber,
  );
  if ((signed < ZERO ? -signed : signed) !== amount) {
    return rowDomainError("CSV_INVALID_AMOUNT", normalizedRowNumber, "amountCents");
  }

  const expectedKind = signed > ZERO ? "INCOME" : "EXPENSE";
  if (value.kind !== expectedKind) {
    return rowDomainError("CSV_INVALID_AMOUNT", normalizedRowNumber, "amountCents");
  }

  return {
    rowNumber: normalizedRowNumber,
    occurredOn,
    description,
    amountCents,
    signedAmountCents,
    kind: expectedKind,
    externalId,
  };
}

function loadAndValidateStagingPayload(
  staging: typeof transactionImportStaging.$inferSelect,
  today: Temporal.PlainDate,
  trackingStartedOn: string | null,
): StagingCandidatePayload {
  if (
    staging.formatVersion !== CSV_IMPORT_FORMAT_VERSION ||
    !Array.isArray(staging.candidateRows) ||
    staging.validRows < 1 ||
    staging.processedRows !== staging.validRows + staging.invalidRows ||
    staging.candidateRows.length !== staging.validRows ||
    !/^[0-9a-f]{64}$/u.test(staging.datasetFingerprint)
  ) {
    throw new Error("O staging de importação não respeita suas invariantes.");
  }

  const errors = sanitizeStagingErrors(staging.errors);
  const errorRows = new Set(errors.map((error) => error.rowNumber));
  if (errorRows.size !== staging.invalidRows) {
    throw new Error("As contagens do relatório de staging são inválidas.");
  }

  const seenRows = new Set<number>();
  const candidates = staging.candidateRows.map((candidate) => {
    const validated = validateCandidate(candidate, today, trackingStartedOn);
    if (seenRows.has(validated.rowNumber)) {
      throw new Error("O staging possui números de linha repetidos.");
    }
    if (errorRows.has(validated.rowNumber)) {
      throw new Error("O staging mistura uma candidata e um erro da mesma linha.");
    }
    seenRows.add(validated.rowNumber);
    return validated;
  });

  const fingerprint = fingerprintCsvImport(candidates);
  if (fingerprint !== staging.datasetFingerprint) {
    throw new Error("O fingerprint do staging não corresponde às candidatas.");
  }

  return { candidates, errors };
}

async function findAccountForConfirmation(
  transaction: ConfirmationTransaction,
  context: FinancialContext,
  accountId: string,
) {
  const rows = await transaction
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.householdId, context.householdId),
      ),
    )
    .limit(1)
    .for("update");
  const account = rows[0];
  if (!account) {
    throw new CsvImportDomainError("ACCOUNT_NOT_FOUND", "accountId", "confirmation");
  }
  if (account.status !== "ACTIVE") {
    throw new CsvImportDomainError("RESOURCE_ARCHIVED", "accountId", "confirmation");
  }
  return account;
}

async function findStagingByToken(
  transaction: ConfirmationTransaction,
  context: FinancialContext,
  tokenHash: string,
) {
  const rows = await transaction
    .select()
    .from(transactionImportStaging)
    .where(
      and(
        eq(transactionImportStaging.householdId, context.householdId),
        eq(transactionImportStaging.tokenHash, tokenHash),
      ),
    )
    .limit(1)
    .for("update");
  return rows[0];
}

async function findCommand(
  transaction: ConfirmationTransaction,
  context: FinancialContext,
  commandId: string,
): Promise<ApplicationCommandRecord | undefined> {
  const rows = await transaction
    .select()
    .from(applicationCommands)
    .where(
      and(
        eq(applicationCommands.householdId, context.householdId),
        eq(applicationCommands.commandId, commandId),
      ),
    )
    .limit(1)
    .for("update");
  return rows[0];
}

async function readImport(
  transaction: ConfirmationTransaction,
  context: FinancialContext,
  importId: string,
): Promise<TransactionImportRecord> {
  const rows = await transaction
    .select()
    .from(transactionImports)
    .where(
      and(
        eq(transactionImports.id, importId),
        eq(transactionImports.householdId, context.householdId),
      ),
    )
    .limit(1);
  const record = rows[0];
  if (!record || record.status !== "CONFIRMED") {
    throw new Error("O lote associado ao command não foi encontrado.");
  }
  return record;
}

function countsFromImport(record: TransactionImportRecord) {
  return {
    processed: record.processedRows,
    valid: record.validRows,
    invalid: record.invalidRows,
    ignoredDuplicate: record.ignoredDuplicateRows,
    imported: record.importedRows,
  };
}

function importedResult(
  record: TransactionImportRecord,
): CsvImportConfirmationResult {
  return {
    status: "IMPORTED",
    importId: record.id,
    accountId: record.accountId,
    counts: countsFromImport(record),
    errors: sanitizeStagingErrors(record.errors),
  };
}

function duplicateResult(
  record: TransactionImportRecord,
  validRows: number,
  invalidRows: number,
  processedRows: number,
  errors: CsvImportRowError[],
): CsvImportConfirmationResult {
  return {
    status: "DUPLICATE_DATASET",
    existingImportId: record.id,
    accountId: record.accountId,
    counts: {
      processed: processedRows,
      valid: validRows,
      invalid: invalidRows,
      ignoredDuplicate: validRows,
      imported: 0,
    },
    errors,
  };
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRecordCounts(value: unknown): value is {
  processed: number;
  valid: number;
  invalid: number;
  ignoredDuplicate: number;
  imported: number;
} {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isSafeCount(value.processed) &&
    isSafeCount(value.valid) &&
    isSafeCount(value.invalid) &&
    isSafeCount(value.ignoredDuplicate) &&
    isSafeCount(value.imported)
  );
}

function sameCounts(
  left: {
    processed: number;
    valid: number;
    invalid: number;
    ignoredDuplicate: number;
    imported: number;
  },
  right: {
    processed: number;
    valid: number;
    invalid: number;
    ignoredDuplicate: number;
    imported: number;
  },
): boolean {
  return (
    left.processed === right.processed &&
    left.valid === right.valid &&
    left.invalid === right.invalid &&
    left.ignoredDuplicate === right.ignoredDuplicate &&
    left.imported === right.imported
  );
}

/**
 * Validates and sanitizes a result snapshot stored with an import command.
 * The nullable column keeps S02/S03 commands backwards compatible; every
 * non-null S04 snapshot is treated as an invariant and fails closed when it
 * does not match the associated confirmed batch.
 */
function resultFromCommandSnapshot(
  value: unknown,
  importRecord: TransactionImportRecord,
): CsvImportConfirmationResult | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || typeof value.status !== "string") {
    throw new Error("O command de importação possui resultado inválido.");
  }
  if (typeof value.accountId !== "string" || value.accountId !== importRecord.accountId) {
    throw new Error("O command de importação possui conta inválida.");
  }
  if (!isRecordCounts(value.counts)) {
    throw new Error("O command de importação possui contagens inválidas.");
  }

  const errors = sanitizeStagingErrors(value.errors);
  const errorRows = new Set(errors.map((error) => error.rowNumber));
  if (errorRows.size !== value.counts.invalid) {
    throw new Error("O command de importação possui erros inconsistentes.");
  }

  if (value.status === "IMPORTED") {
    if (
      value.importId !== importRecord.id ||
      !sameCounts(value.counts, countsFromImport(importRecord))
    ) {
      throw new Error("O resultado do command não corresponde ao lote.");
    }
    return {
      status: "IMPORTED",
      importId: importRecord.id,
      accountId: importRecord.accountId,
      counts: countsFromImport(importRecord),
      errors,
    };
  }

  if (
    value.status === "DUPLICATE_DATASET" &&
    value.existingImportId === importRecord.id &&
    value.counts.processed === value.counts.valid + value.counts.invalid &&
    value.counts.ignoredDuplicate === value.counts.valid &&
    value.counts.imported === 0
  ) {
    return {
      status: "DUPLICATE_DATASET",
      existingImportId: importRecord.id,
      accountId: importRecord.accountId,
      counts: value.counts,
      errors,
    };
  }

  throw new Error("O resultado do command de importação é inválido.");
}

/**
 * Rehydrates the exact outcome of a previously claimed command. A duplicate
 * dataset keeps its staging row so another command can still receive the
 * same conflict; checking for that row lets a retry preserve
 * `DUPLICATE_DATASET` instead of turning it into a misleading `IMPORTED`.
 */
async function resultForExistingCommand(
  transaction: ConfirmationTransaction,
  context: FinancialContext,
  commandRecord: ApplicationCommandRecord,
  tokenHash: string,
): Promise<CsvImportConfirmationResult> {
  if (!commandRecord.resourceId) {
    throw new Error("O command de confirmação não possui lote associado.");
  }

  const importRecord = await readImport(
    transaction,
    context,
    commandRecord.resourceId,
  );

  const storedResult = resultFromCommandSnapshot(
    commandRecord.result,
    importRecord,
  );
  if (storedResult) {
    return storedResult;
  }

  const staging = await findStagingByToken(transaction, context, tokenHash);

  if (!staging) {
    return importedResult(importRecord);
  }

  if (
    staging.accountId !== importRecord.accountId ||
    staging.datasetFingerprint !== importRecord.datasetFingerprint
  ) {
    throw new Error("O staging não corresponde ao lote associado ao command.");
  }

  return duplicateResult(
    importRecord,
    staging.validRows,
    staging.invalidRows,
    staging.processedRows,
    sanitizeStagingErrors(staging.errors),
  );
}

async function findConfirmedImport(
  transaction: ConfirmationTransaction,
  context: FinancialContext,
  accountId: string,
  fingerprint: string,
): Promise<TransactionImportRecord | undefined> {
  const rows = await transaction
    .select()
    .from(transactionImports)
    .where(
      and(
        eq(transactionImports.householdId, context.householdId),
        eq(transactionImports.accountId, accountId),
        eq(transactionImports.datasetFingerprint, fingerprint),
        eq(transactionImports.status, "CONFIRMED"),
      ),
    )
    .limit(1);
  return rows[0];
}

async function reserveCommand(
  transaction: ConfirmationTransaction,
  context: FinancialContext,
  commandId: string,
  payloadHash: string,
  importId: string,
  result: CsvImportConfirmationResult,
): Promise<CommandClaim> {
  const inserted = await transaction
    .insert(applicationCommands)
    .values({
      householdId: context.householdId,
      commandId,
      operation: CSV_IMPORT_CONFIRM_OPERATION,
      payloadHash,
      resourceId: importId,
      result,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) {
    return { created: true, importId };
  }

  const existing = await findCommand(transaction, context, commandId);
  if (!existing) {
    throw new Error("O registro de idempotência não foi encontrado após conflito.");
  }
  if (
    existing.operation !== CSV_IMPORT_CONFIRM_OPERATION ||
    existing.payloadHash !== payloadHash
  ) {
    throw new CsvImportDomainError("COMMAND_ID_REUSED", "commandId", "confirmation");
  }
  if (!existing.resourceId) {
    throw new Error("O command de confirmação não possui lote associado.");
  }
  return { created: false, record: existing };
}

async function findConsumedTokenCommand(
  transaction: ConfirmationTransaction,
  context: FinancialContext,
  payloadHash: string,
) {
  const rows = await transaction
    .select({ commandId: applicationCommands.commandId })
    .from(applicationCommands)
    .where(
      and(
        eq(applicationCommands.householdId, context.householdId),
        eq(applicationCommands.operation, CSV_IMPORT_CONFIRM_OPERATION),
        eq(applicationCommands.payloadHash, payloadHash),
      ),
    )
    .limit(1);
  return rows[0];
}

function assertConfirmationStagingDate(
  staging: typeof transactionImportStaging.$inferSelect,
  now: Date,
): void {
  if (staging.consumedAt !== null) {
    throw new CsvImportDomainError(
      "PREVIEW_ALREADY_CONSUMED",
      "previewToken",
      "confirmation",
    );
  }
  if (staging.expiresAt.getTime() <= now.getTime()) {
    throw new CsvImportDomainError("PREVIEW_EXPIRED", "previewToken", "confirmation");
  }
}

async function persistConfirmedImport(
  transaction: ConfirmationTransaction,
  context: FinancialContext,
  command: ConfirmTransactionImportCommand,
  tokenHash: string,
  staging: typeof transactionImportStaging.$inferSelect,
  candidates: CsvImportCandidate[],
  errors: CsvImportRowError[],
  account: Awaited<ReturnType<typeof findAccountForConfirmation>>,
  now: Date,
): Promise<CsvImportConfirmationResult> {
  const importId = generateUuidV7();
  const commandHash = hashCsvImportConfirmationPayload(tokenHash);
  const result: CsvImportConfirmationResult = {
    status: "IMPORTED",
    importId,
    accountId: account.id,
    counts: {
      processed: staging.processedRows,
      valid: candidates.length,
      invalid: staging.invalidRows,
      ignoredDuplicate: 0,
      imported: candidates.length,
    },
    errors,
  };
  const claim = await reserveCommand(
    transaction,
    context,
    command.commandId,
    commandHash,
    importId,
    result,
  );

  if (!claim.created) {
    return resultForExistingCommand(
      transaction,
      context,
      claim.record,
      tokenHash,
    );
  }

  await transaction.insert(transactionImports).values({
    id: importId,
    householdId: context.householdId,
    accountId: account.id,
    initiatedByUserId: context.userId,
    formatVersion: CSV_IMPORT_FORMAT_VERSION,
    datasetFingerprint: staging.datasetFingerprint,
    sourceFileSizeBytes: staging.sourceFileSizeBytes,
    sourceHasBom: staging.sourceHasBom,
    sourceColumns: staging.sourceColumns,
    processedRows: staging.processedRows,
    validRows: candidates.length,
    invalidRows: staging.invalidRows,
    ignoredDuplicateRows: 0,
    importedRows: candidates.length,
    errors,
    status: "CONFIRMED",
    createdAt: now,
    confirmedAt: now,
  });

  for (const candidate of candidates) {
    const eventId = generateUuidV7();
    const entryId = generateUuidV7();
    const itemId = generateUuidV7();
    const amountCents = BigInt(candidate.amountCents);
    const occurredOn = formatFinancialDate(parseFinancialDate(candidate.occurredOn));

    const event = await insertFinancialEventForContext(transaction, context, {
      id: eventId,
      kind: candidate.kind,
      status: "POSTED",
      origin: "IMPORT",
      amountCents,
      occurredOn,
      description: candidate.description,
      categoryId: null,
      reversalOfEventId: null,
    });

    await insertAccountEntryForContext(transaction, context, {
      id: entryId,
      financialEventId: event.id,
      accountId: account.id,
      amountCents: BigInt(candidate.signedAmountCents),
      status: "POSTED",
      expectedOn: null,
      postedOn: occurredOn,
    });

    await transaction.insert(transactionImportItems).values({
      id: itemId,
      householdId: context.householdId,
      importId,
      rowNumber: candidate.rowNumber,
      externalId: candidate.externalId,
      financialEventId: event.id,
    });
  }

  // Deletion is the consumption marker. The command hash above keeps a retry
  // safe, while a different command can still be told that this bearer was
  // consumed without retaining financial candidate JSON indefinitely.
  const deleted = await transaction
    .delete(transactionImportStaging)
    .where(
      and(
        eq(transactionImportStaging.id, staging.id),
        eq(transactionImportStaging.householdId, context.householdId),
        eq(transactionImportStaging.tokenHash, tokenHash),
      ),
    )
    .returning({ id: transactionImportStaging.id });
  if (!deleted[0]) {
    throw new Error("O staging não pôde ser consumido.");
  }

  return result;
}

function isUniqueViolation(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  if (error.code === "23505") {
    return true;
  }
  return isRecord(error.cause) && error.cause.code === "23505";
}

async function resolveDuplicateAfterRace(
  database: Database,
  context: FinancialContext,
  tokenHash: string,
): Promise<CsvImportConfirmationResult | null> {
  const stagingRows = await database
    .select()
    .from(transactionImportStaging)
    .where(
      and(
        eq(transactionImportStaging.householdId, context.householdId),
        eq(transactionImportStaging.tokenHash, tokenHash),
      ),
    )
    .limit(1);
  const staging = stagingRows[0];
  if (!staging) {
    return null;
  }
  const existingRows = await database
    .select()
    .from(transactionImports)
    .where(
      and(
        eq(transactionImports.householdId, context.householdId),
        eq(transactionImports.accountId, staging.accountId),
        eq(transactionImports.datasetFingerprint, staging.datasetFingerprint),
        eq(transactionImports.status, "CONFIRMED"),
      ),
    )
    .limit(1);
  const existing = existingRows[0];
  if (!existing) {
    return null;
  }
  const errors = sanitizeStagingErrors(staging.errors);
  return duplicateResult(
    existing,
    staging.validRows,
    staging.invalidRows,
    staging.processedRows,
    errors,
  );
}

async function executeConfirmation(
  database: Database,
  context: FinancialContext,
  input: unknown,
  options: CsvImportConfirmationUseCaseOptions,
): Promise<CsvImportConfirmationResult> {
  assertFinancialContext(context);
  const command = parseConfirmationCommand(input);
  const now = resolveNow(options);
  const today = resolveBusinessDate(options.today, now);
  const tokenHash = hashCsvImportPreviewToken(command.previewToken);
  const commandHash = hashCsvImportConfirmationPayload(tokenHash);

  try {
    return await database.transaction(async (transaction) => {
      const existingCommand = await findCommand(
        transaction,
        context,
        command.commandId,
      );
      if (existingCommand) {
        if (
          existingCommand.operation !== CSV_IMPORT_CONFIRM_OPERATION ||
          existingCommand.payloadHash !== commandHash
        ) {
          throw new CsvImportDomainError(
            "COMMAND_ID_REUSED",
            "commandId",
            "confirmation",
          );
        }
        return resultForExistingCommand(
          transaction,
          context,
          existingCommand,
          tokenHash,
        );
      }

      const staging = await findStagingByToken(transaction, context, tokenHash);
      if (!staging) {
        // A concurrent retry can have observed no command before waiting on
        // the staging row. Re-read the idempotency slot after that wait so
        // the same command receives its committed result instead of being
        // mistaken for a different bearer replay.
        const commandAfterStagingWait = await findCommand(
          transaction,
          context,
          command.commandId,
        );
        if (commandAfterStagingWait) {
          if (
            commandAfterStagingWait.operation !== CSV_IMPORT_CONFIRM_OPERATION ||
            commandAfterStagingWait.payloadHash !== commandHash
          ) {
            throw new CsvImportDomainError(
              "COMMAND_ID_REUSED",
              "commandId",
              "confirmation",
            );
          }
          return resultForExistingCommand(
            transaction,
            context,
            commandAfterStagingWait,
            tokenHash,
          );
        }

        const consumed = await findConsumedTokenCommand(
          transaction,
          context,
          commandHash,
        );
        if (consumed) {
          throw new CsvImportDomainError(
            "PREVIEW_ALREADY_CONSUMED",
            "previewToken",
            "confirmation",
          );
        }
        throw new CsvImportDomainError(
          "PREVIEW_NOT_FOUND",
          "previewToken",
          "confirmation",
        );
      }

      assertConfirmationStagingDate(staging, now);
      const account = await findAccountForConfirmation(
        transaction,
        context,
        staging.accountId,
      );
      const { candidates, errors } = loadAndValidateStagingPayload(
        staging,
        today,
        account.trackingStartedOn,
      );

      const existingImport = await findConfirmedImport(
        transaction,
        context,
        account.id,
        staging.datasetFingerprint,
      );
      if (existingImport) {
        const duplicate = duplicateResult(
          existingImport,
          candidates.length,
          staging.invalidRows,
          staging.processedRows,
          errors,
        );

        // Claim duplicate outcomes as well. This prevents a command that
        // already reported a duplicate set from being reused for another
        // preview and gives retries a durable command-to-batch association.
        const claim = await reserveCommand(
          transaction,
          context,
          command.commandId,
          commandHash,
          existingImport.id,
          duplicate,
        );
        if (!claim.created) {
          return resultForExistingCommand(
            transaction,
            context,
            claim.record,
            tokenHash,
          );
        }
        return duplicate;
      }

      return persistConfirmedImport(
        transaction,
        context,
        command,
        tokenHash,
        staging,
        candidates,
        errors,
        account,
        now,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const duplicate = await resolveDuplicateAfterRace(
        database,
        context,
        tokenHash,
      );
      if (duplicate) {
        return duplicate;
      }
    }
    throw error;
  }
}

function toOptions(
  databaseOrOptions?: Database | CsvImportConfirmationUseCaseOptions,
): CsvImportConfirmationUseCaseOptions {
  if (isDatabase(databaseOrOptions)) {
    return { database: databaseOrOptions };
  }
  return databaseOrOptions ?? {};
}

/** Builds the confirmation port with lazy database resolution. */
export function createCsvImportConfirmationUseCase(
  database?: Database,
): CsvImportConfirmationUseCasePort;
export function createCsvImportConfirmationUseCase(
  options?: CsvImportConfirmationUseCaseOptions,
): CsvImportConfirmationUseCasePort;
export function createCsvImportConfirmationUseCase(
  database: Database,
  options?: Omit<CsvImportConfirmationUseCaseOptions, "database">,
): CsvImportConfirmationUseCasePort;
export function createCsvImportConfirmationUseCase(
  databaseOrOptions?: Database | CsvImportConfirmationUseCaseOptions,
  extraOptions: Omit<CsvImportConfirmationUseCaseOptions, "database"> = {},
): CsvImportConfirmationUseCasePort {
  const options = {
    ...toOptions(databaseOrOptions),
    ...extraOptions,
  };
  const confirm = (
    context: FinancialContext,
    command: ConfirmTransactionImportCommand,
  ) =>
    executeConfirmation(
      resolveDatabase(options.database),
      context,
      command,
      options,
    );

  return {
    confirm,
    confirmTransactionImport: confirm,
    confirmCsvImport: confirm,
    async confirmResult(context, command) {
      try {
        return { ok: true, value: await confirm(context, command) };
      } catch (error) {
        if (error instanceof CsvImportDomainError) {
          return { ok: false, error: error.toError() };
        }
        throw error;
      }
    },
  };
}

export const createConfirmTransactionImportUseCase =
  createCsvImportConfirmationUseCase;
export const createTransactionImportConfirmationUseCase =
  createCsvImportConfirmationUseCase;
export const createConfirmCsvImportUseCase =
  createCsvImportConfirmationUseCase;
export const createCsvImportConfirmUseCase =
  createCsvImportConfirmationUseCase;
export const createTransactionImportConfirmUseCase =
  createCsvImportConfirmationUseCase;
export const createConfirmImportUseCase = createCsvImportConfirmationUseCase;

/** Lazily resolved production port used by the Server Action boundary. */
export const csvImportConfirmationUseCase =
  createCsvImportConfirmationUseCase();
export const transactionImportConfirmationUseCase =
  csvImportConfirmationUseCase;
export const transactionImportConfirmUseCase = csvImportConfirmationUseCase;
export const confirmTransactionImportUseCase = csvImportConfirmationUseCase;
export const confirmCsvImportUseCase = csvImportConfirmationUseCase;
export const confirmImportUseCase = csvImportConfirmationUseCase;

/** Convenience direct calls for server-side callers/tests. */
export async function confirmTransactionImport(
  context: FinancialContext,
  command: ConfirmTransactionImportCommand,
  databaseOrOptions?: Database | CsvImportConfirmationUseCaseOptions,
): Promise<CsvImportConfirmationResult> {
  return createCsvImportConfirmationUseCase(
    toOptions(databaseOrOptions),
  ).confirm(context, command);
}

export const ConfirmTransactionImport = confirmTransactionImport;
export const confirmCsvImport = confirmTransactionImport;
export const confirmImport = confirmTransactionImport;
export const confirmTransactionImportCsv = confirmTransactionImport;
