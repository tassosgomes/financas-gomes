/**
 * Persistence contract for the S04 CSV import boundary.
 *
 * The import tables are deliberately separate from the ledger: the ledger is
 * still the source of truth for financial facts and balances, while these
 * rows retain only the audit trail, tokenized preview and origin links needed
 * to make a confirmation safe and idempotent.
 */
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@/lib/uuidv7";

import { betterAuthUser as user } from "@/modules/auth/schema";

import { accounts } from "./accounts-categories-schema";
import { financialEvents } from "./financial-events-schema";
import { householdMembers, households } from "./tenancy-schema";

/** A confirmed row is the only durable import-batch state in V1. */
export const transactionImportStatusEnum = pgEnum("transaction_import_status", [
  "CONFIRMED",
]);

/** Technical source-column metadata, not a parser authority. */
export const transactionImportSourceColumnsEnum = pgEnum(
  "transaction_import_source_columns",
  ["BASE", "WITH_EXTERNAL_ID"],
);

export type TransactionImportRowError = {
  rowNumber: number;
  code: string;
  field?: string;
  message: string;
};

export type TransactionImportCandidate = {
  rowNumber: number;
  occurredOn: string;
  description: string;
  amountCents: string;
  signedAmountCents: string;
  kind: "INCOME" | "EXPENSE";
  externalId: string | null;
};

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 10_000;

/**
 * A durable, atomically confirmed import batch. It never stores the original
 * file or raw invalid rows; `errors` contains only sanitized public errors.
 */
export const transactionImports = pgTable(
  "transaction_imports",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    accountId: uuid("account_id").notNull(),
    initiatedByUserId: uuid("initiated_by_user_id"),
    formatVersion: text("format_version").notNull(),
    datasetFingerprint: text("dataset_fingerprint").notNull(),
    sourceFileSizeBytes: integer("source_file_size_bytes").notNull(),
    sourceHasBom: boolean("source_has_bom").notNull(),
    sourceColumns: transactionImportSourceColumnsEnum("source_columns").notNull(),
    processedRows: integer("processed_rows").notNull(),
    validRows: integer("valid_rows").notNull(),
    invalidRows: integer("invalid_rows").notNull(),
    ignoredDuplicateRows: integer("ignored_duplicate_rows").notNull(),
    importedRows: integer("imported_rows").notNull(),
    errors: jsonb("errors")
      .$type<TransactionImportRowError[]>()
      .notNull()
      .default([]),
    status: transactionImportStatusEnum("status").notNull().default("CONFIRMED"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    confirmedAt: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "transaction_imports_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "transaction_imports_account_household_fkey",
      columns: [table.accountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete("restrict"),
    foreignKey({
      name: "transaction_imports_initiated_by_user_id_fkey",
      columns: [table.initiatedByUserId],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    // An optional initiator must be a member of the same household. This is
    // metadata integrity only; authorization still comes from the session.
    foreignKey({
      name: "transaction_imports_initiator_member_fkey",
      columns: [table.householdId, table.initiatedByUserId],
      foreignColumns: [householdMembers.householdId, householdMembers.userId],
    }).onDelete("restrict"),
    // Children need a composite parent key to carry tenant identity through
    // every import lookup and prevent a forged household_id.
    uniqueIndex("transaction_imports_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    index("transaction_imports_household_account_created_at_idx").on(
      table.householdId,
      table.accountId,
      table.createdAt,
    ),
    index("transaction_imports_household_status_created_at_idx").on(
      table.householdId,
      table.status,
      table.createdAt,
    ),
    // A preview for an already-confirmed fingerprint must resolve only
    // within the current household and account.
    uniqueIndex("transaction_imports_household_account_fingerprint_uq")
      .on(table.householdId, table.accountId, table.datasetFingerprint)
      .where(sql`${table.status} = 'CONFIRMED'`),
    check(
      "transaction_imports_format_version_check",
      sql`${table.formatVersion} = 's04-csv-v1'`,
    ),
    check(
      "transaction_imports_fingerprint_check",
      sql`${table.datasetFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "transaction_imports_source_file_size_check",
      sql`${table.sourceFileSizeBytes} between 0 and ${sql.raw(String(MAX_IMPORT_BYTES))}`,
    ),
    check(
      "transaction_imports_processed_rows_check",
      sql`${table.processedRows} between 0 and ${sql.raw(String(MAX_IMPORT_ROWS))}`,
    ),
    check(
      "transaction_imports_valid_rows_check",
      sql`${table.validRows} between 1 and ${sql.raw(String(MAX_IMPORT_ROWS))}`,
    ),
    check(
      "transaction_imports_invalid_rows_check",
      sql`${table.invalidRows} between 0 and ${sql.raw(String(MAX_IMPORT_ROWS))}`,
    ),
    check(
      "transaction_imports_ignored_duplicate_rows_check",
      sql`${table.ignoredDuplicateRows} between 0 and ${sql.raw(String(MAX_IMPORT_ROWS))}`,
    ),
    check(
      "transaction_imports_imported_rows_check",
      sql`${table.importedRows} between 0 and ${sql.raw(String(MAX_IMPORT_ROWS))}`,
    ),
    check(
      "transaction_imports_count_partition_check",
      sql`${table.processedRows} = ${table.validRows} + ${table.invalidRows}`,
    ),
    check(
      "transaction_imports_count_result_check",
      sql`${table.importedRows} + ${table.ignoredDuplicateRows} <= ${table.validRows}`,
    ),
    // A durable row is created only by a successful confirmation. A duplicate
    // dataset returns the existing row and never creates a second batch.
    check(
      "transaction_imports_confirmed_count_check",
      sql`${table.status} = 'CONFIRMED'
        and ${table.ignoredDuplicateRows} = 0
        and ${table.importedRows} = ${table.validRows}
        and ${table.confirmedAt} >= ${table.createdAt}`,
    ),
    check(
      "transaction_imports_errors_array_check",
      sql`jsonb_typeof(${table.errors}) = 'array'`,
    ),
  ],
);

/**
 * Server-side preview state. The bearer token itself is never persisted;
 * callers store only its SHA-256 digest and must load this row with the
 * current household predicate before confirmation.
 */
export const transactionImportStaging = pgTable(
  "transaction_import_staging",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    accountId: uuid("account_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    datasetFingerprint: text("dataset_fingerprint").notNull(),
    formatVersion: text("format_version").notNull(),
    sourceFileSizeBytes: integer("source_file_size_bytes").notNull(),
    sourceHasBom: boolean("source_has_bom").notNull(),
    sourceColumns: transactionImportSourceColumnsEnum("source_columns").notNull(),
    processedRows: integer("processed_rows").notNull(),
    validRows: integer("valid_rows").notNull(),
    invalidRows: integer("invalid_rows").notNull(),
    errors: jsonb("errors")
      .$type<TransactionImportRowError[]>()
      .notNull()
      .default([]),
    candidateRows: jsonb("candidate_rows")
      .$type<TransactionImportCandidate[]>()
      .notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    consumedAt: timestamp("consumed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "transaction_import_staging_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "transaction_import_staging_account_household_fkey",
      columns: [table.accountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete("restrict"),
    uniqueIndex("transaction_import_staging_household_token_hash_uq").on(
      table.householdId,
      table.tokenHash,
    ),
    index("transaction_import_staging_household_expires_at_idx").on(
      table.householdId,
      table.expiresAt,
    ),
    index("transaction_import_staging_household_fingerprint_idx").on(
      table.householdId,
      table.accountId,
      table.datasetFingerprint,
    ),
    check(
      "transaction_import_staging_token_hash_check",
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "transaction_import_staging_format_version_check",
      sql`${table.formatVersion} = 's04-csv-v1'`,
    ),
    check(
      "transaction_import_staging_fingerprint_check",
      sql`${table.datasetFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "transaction_import_staging_source_file_size_check",
      sql`${table.sourceFileSizeBytes} between 0 and ${sql.raw(String(MAX_IMPORT_BYTES))}`,
    ),
    check(
      "transaction_import_staging_processed_rows_check",
      sql`${table.processedRows} between 1 and ${sql.raw(String(MAX_IMPORT_ROWS))}`,
    ),
    check(
      "transaction_import_staging_valid_rows_check",
      sql`${table.validRows} between 1 and ${sql.raw(String(MAX_IMPORT_ROWS))}`,
    ),
    check(
      "transaction_import_staging_count_partition_check",
      sql`${table.processedRows} = ${table.validRows} + ${table.invalidRows}`,
    ),
    check(
      "transaction_import_staging_invalid_rows_check",
      sql`${table.invalidRows} between 0 and ${sql.raw(String(MAX_IMPORT_ROWS))}`,
    ),
    check(
      "transaction_import_staging_errors_array_check",
      sql`jsonb_typeof(${table.errors}) = 'array'`,
    ),
    check(
      "transaction_import_staging_candidates_array_check",
      sql`jsonb_typeof(${table.candidateRows}) = 'array'
        and jsonb_array_length(${table.candidateRows}) = ${table.validRows}`,
    ),
    check(
      "transaction_import_staging_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "transaction_import_staging_consumed_at_check",
      sql`${table.consumedAt} is null or ${table.consumedAt} >= ${table.createdAt}`,
    ),
  ],
);

/**
 * Tenant-safe lineage from each valid CSV row to the canonical ledger event.
 * Amount, date and description remain authoritative in `financial_events`;
 * this table stores only row identity and optional external provenance.
 */
export const transactionImportItems = pgTable(
  "transaction_import_items",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    importId: uuid("import_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    externalId: text("external_id"),
    financialEventId: uuid("financial_event_id").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "transaction_import_items_import_household_fkey",
      columns: [table.importId, table.householdId],
      foreignColumns: [transactionImports.id, transactionImports.householdId],
    }).onDelete("restrict"),
    foreignKey({
      name: "transaction_import_items_event_household_fkey",
      columns: [table.financialEventId, table.householdId],
      foreignColumns: [financialEvents.id, financialEvents.householdId],
    }).onDelete("restrict"),
    uniqueIndex("transaction_import_items_import_row_uq").on(
      table.importId,
      table.rowNumber,
    ),
    index("transaction_import_items_household_import_row_idx").on(
      table.householdId,
      table.importId,
      table.rowNumber,
    ),
    index("transaction_import_items_household_event_idx").on(
      table.householdId,
      table.financialEventId,
    ),
    // Each imported event has exactly one tenant-scoped lineage row. This is
    // additive to the existing non-unique join index for compatibility.
    uniqueIndex("transaction_import_items_household_event_uq").on(
      table.householdId,
      table.financialEventId,
    ),
    check(
      "transaction_import_items_row_number_check",
      sql`${table.rowNumber} >= 2`,
    ),
    check(
      "transaction_import_items_external_id_check",
      sql`${table.externalId} is null
        or (char_length(${table.externalId}) between 1 and 128
          and ${table.externalId} !~ '[[:cntrl:]]')`,
    ),
  ],
);

export type TransactionImportRecord = typeof transactionImports.$inferSelect;
export type NewTransactionImport = typeof transactionImports.$inferInsert;
export type TransactionImportStagingRecord =
  typeof transactionImportStaging.$inferSelect;
export type NewTransactionImportStaging =
  typeof transactionImportStaging.$inferInsert;
export type TransactionImportItemRecord =
  typeof transactionImportItems.$inferSelect;
export type NewTransactionImportItem = typeof transactionImportItems.$inferInsert;
