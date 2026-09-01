import { and, eq } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  transactionImportItems,
  transactionImports,
  type TransactionImportRecord,
} from "@/db/transaction-imports-schema";
import { isUuidV7 } from "@/lib/uuidv7";
import {
  assertFinancialContext,
  withFinancialContext,
} from "@/modules/households/tenant-scoped";
import type {
  FinancialContext,
  RequireFinancialContextOptions,
} from "@/modules/households/contracts";
import type { TransactionReferenceExecutor } from "@/modules/transactions/references";

import {
  CSV_IMPORT_ERROR_CODES,
  CSV_IMPORT_ERROR_MESSAGES,
  CSV_IMPORT_FORMAT_VERSION,
  type ConfirmedCsvImportResult,
  type CsvImportCounts,
  type CsvImportRowError,
} from "./contracts";

/** A persisted report exposes only the same safe shape as confirmation. */
export type CsvImportReport = ConfirmedCsvImportResult;
export type CsvImportReportReadModel = CsvImportReport;

/** A report query can run against the application DB or an existing tx. */
export type CsvImportReportExecutor = TransactionReferenceExecutor;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveDatabase(database?: Database): Database {
  return database ?? getDb();
}

function normalizeImportId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return isUuidV7(normalized) ? normalized : undefined;
}

function isCsvImportErrorCode(value: unknown): value is CsvImportRowError["code"] {
  return (
    typeof value === "string" &&
    CSV_IMPORT_ERROR_CODES.includes(value as CsvImportRowError["code"])
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
 * Rebuilds messages from the stable ADR vocabulary. Persisted JSON is not
 * trusted as a source of user-facing text, even though T06/T07 already
 * sanitize it before writing.
 */
export function sanitizeCsvImportReportErrors(
  value: unknown,
): CsvImportRowError[] {
  if (!Array.isArray(value)) {
    throw new Error("O relatório de importação possui erros inválidos.");
  }

  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error("O relatório de importação possui um erro inválido.");
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
      throw new Error("O relatório de importação possui um erro inválido.");
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

function assertNonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`O relatório de importação possui ${field} inválido.`);
  }
}

function countsFromRecord(record: TransactionImportRecord): CsvImportCounts {
  assertNonNegativeInteger(record.processedRows, "processedRows");
  assertNonNegativeInteger(record.validRows, "validRows");
  assertNonNegativeInteger(record.invalidRows, "invalidRows");
  assertNonNegativeInteger(
    record.ignoredDuplicateRows,
    "ignoredDuplicateRows",
  );
  assertNonNegativeInteger(record.importedRows, "importedRows");

  if (
    record.formatVersion !== CSV_IMPORT_FORMAT_VERSION ||
    record.status !== "CONFIRMED" ||
    record.validRows < 1 ||
    record.processedRows !== record.validRows + record.invalidRows ||
    record.importedRows + record.ignoredDuplicateRows > record.validRows ||
    record.ignoredDuplicateRows !== 0 ||
    record.importedRows !== record.validRows
  ) {
    throw new Error("O relatório de importação não respeita suas contagens.");
  }

  return {
    processed: record.processedRows,
    valid: record.validRows,
    invalid: record.invalidRows,
    ignoredDuplicate: record.ignoredDuplicateRows,
    imported: record.importedRows,
  };
}

/**
 * Maps only durable report fields. No filename, CSV bytes, candidate payload,
 * token, fingerprint or account name crosses this read boundary.
 */
export function toCsvImportReport(
  record: TransactionImportRecord,
): CsvImportReport {
  const counts = countsFromRecord(record);
  const errors = sanitizeCsvImportReportErrors(record.errors);
  const errorRows = new Set(errors.map((error) => error.rowNumber));
  if (errorRows.size !== record.invalidRows) {
    throw new Error("O relatório de importação possui erros inconsistentes.");
  }

  return {
    status: "IMPORTED",
    importId: record.id,
    accountId: record.accountId,
    counts,
    errors,
  };
}

/**
 * Finds a confirmed import only inside the authenticated household. Invalid
 * or cross-household IDs intentionally look like an absent report.
 */
export async function findCsvImportReportForContext(
  executor: CsvImportReportExecutor,
  context: FinancialContext,
  importId: unknown,
): Promise<CsvImportReport | undefined> {
  assertFinancialContext(context);
  const normalizedId = normalizeImportId(importId);
  if (!normalizedId) {
    return undefined;
  }

  const rows = await executor
    .select()
    .from(transactionImports)
    .where(
      and(
        eq(transactionImports.id, normalizedId),
        eq(transactionImports.householdId, context.householdId),
        eq(transactionImports.status, "CONFIRMED"),
      ),
    )
    .limit(1);
  const record = rows[0];
  if (!record) {
    return undefined;
  }

  // The report is only valid when its persisted lineage agrees with the
  // durable imported count. The composite tenant predicate is repeated on
  // the child query so an impossible cross-household row fails closed.
  const items = await executor
    .select({ id: transactionImportItems.id })
    .from(transactionImportItems)
    .where(
      and(
        eq(transactionImportItems.importId, record.id),
        eq(transactionImportItems.householdId, context.householdId),
      ),
    );
  if (items.length !== record.importedRows) {
    throw new Error("O relatório de importação não corresponde à linhagem.");
  }

  return toCsvImportReport(record);
}

/** Explicit alias for callers that prefer the transaction-import vocabulary. */
export const findTransactionImportReportForContext =
  findCsvImportReportForContext;
export const readCsvImportReportForContext = findCsvImportReportForContext;
export const readTransactionImportReportForContext =
  findCsvImportReportForContext;

/**
 * `get` keeps a discoverable read API while preserving the opaque not-found
 * behavior of `find`: a report from another household is `undefined`.
 */
export async function getCsvImportReportForContext(
  executor: CsvImportReportExecutor,
  context: FinancialContext,
  importId: unknown,
): Promise<CsvImportReport | undefined> {
  return findCsvImportReportForContext(executor, context, importId);
}

export const getTransactionImportReportForContext = getCsvImportReportForContext;

export interface CsvImportReportQueries {
  find(
    context: FinancialContext,
    importId: unknown,
  ): Promise<CsvImportReport | undefined>;
  get(
    context: FinancialContext,
    importId: unknown,
  ): Promise<CsvImportReport | undefined>;
}

/** Builds context-explicit report reads with an injectable database. */
export function createCsvImportReportQueries(
  database?: Database,
): CsvImportReportQueries {
  return {
    find: (context, importId) =>
      findCsvImportReportForContext(
        resolveDatabase(database),
        context,
        importId,
      ),
    get: (context, importId) =>
      getCsvImportReportForContext(
        resolveDatabase(database),
        context,
        importId,
      ),
  };
}

export const createTransactionImportReportQueries =
  createCsvImportReportQueries;

export async function findCsvImportReport(
  context: FinancialContext,
  importId: unknown,
  database?: Database,
): Promise<CsvImportReport | undefined> {
  return findCsvImportReportForContext(
    resolveDatabase(database),
    context,
    importId,
  );
}

export async function getCsvImportReport(
  context: FinancialContext,
  importId: unknown,
  database?: Database,
): Promise<CsvImportReport | undefined> {
  return getCsvImportReportForContext(
    resolveDatabase(database),
    context,
    importId,
  );
}

export const findTransactionImportReport = findCsvImportReport;
export const getTransactionImportReport = getCsvImportReport;
export const readCsvImportReport = getCsvImportReport;
export const readTransactionImportReport = getCsvImportReport;

/** Optional auth-resolving facade for Server Components and T11. */
export interface CsvImportReportAccess {
  find(
    importId: unknown,
    options?: RequireFinancialContextOptions,
  ): Promise<CsvImportReport | undefined>;
  get(
    importId: unknown,
    options?: RequireFinancialContextOptions,
  ): Promise<CsvImportReport | undefined>;
}

export function createCsvImportReportAccess(
  database?: Database,
): CsvImportReportAccess {
  const queries = createCsvImportReportQueries(database);
  return {
    find(importId, options = {}) {
      return withFinancialContext(
        (context) => queries.find(context, importId),
        options,
      );
    },
    get(importId, options = {}) {
      return withFinancialContext(
        (context) => queries.get(context, importId),
        options,
      );
    },
  };
}

export const csvImportReportAccess = createCsvImportReportAccess();
export const transactionImportReportAccess = csvImportReportAccess;

