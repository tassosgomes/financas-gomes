import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  transactionImportItems,
  transactionImportStaging,
  transactionImports,
} from "./transaction-imports-schema";

function tableMetadata(table: Parameters<typeof getTableConfig>[0]) {
  const config = getTableConfig(table);
  return {
    columns: config.columns.map(
      (column) => [column.name, column.columnType] as const,
    ),
    indexes: config.indexes.map((index) => index.config.name),
    foreignKeys: config.foreignKeys.map((foreignKey) => foreignKey.getName()),
    checks: config.checks.map((check) => check.name),
  };
}

describe("T12 S04 schema contract", () => {
  it("keeps durable imports tenant-safe and free of financial payload columns", () => {
    const metadata = tableMetadata(transactionImports);
    const columnNames = metadata.columns.map(([name]) => name);

    expect(columnNames).toEqual([
      "id",
      "household_id",
      "account_id",
      "initiated_by_user_id",
      "format_version",
      "dataset_fingerprint",
      "source_file_size_bytes",
      "source_has_bom",
      "source_columns",
      "processed_rows",
      "valid_rows",
      "invalid_rows",
      "ignored_duplicate_rows",
      "imported_rows",
      "errors",
      "status",
      "created_at",
      "confirmed_at",
    ]);
    expect(columnNames).not.toContain("amount_cents");
    expect(columnNames).not.toContain("balance");
    expect(metadata.indexes).toEqual(
      expect.arrayContaining([
        "transaction_imports_household_account_fingerprint_uq",
        "transaction_imports_household_account_created_at_idx",
      ]),
    );
    expect(metadata.foreignKeys).toEqual(
      expect.arrayContaining([
        "transaction_imports_account_household_fkey",
        "transaction_imports_initiator_member_fkey",
      ]),
    );
    expect(metadata.checks).toEqual(
      expect.arrayContaining([
        "transaction_imports_count_partition_check",
        "transaction_imports_count_result_check",
        "transaction_imports_confirmed_count_check",
        "transaction_imports_errors_array_check",
      ]),
    );
  });

  it("keeps preview staging tokenized, expiring and candidate-count constrained", () => {
    const metadata = tableMetadata(transactionImportStaging);
    const columnTypes = new Map(metadata.columns);

    expect(columnTypes.get("token_hash")).toBe("PgText");
    expect(columnTypes.get("dataset_fingerprint")).toBe("PgText");
    expect(columnTypes.get("candidate_rows")).toBe("PgJsonb");
    expect(columnTypes.get("errors")).toBe("PgJsonb");
    expect(metadata.indexes).toEqual(
      expect.arrayContaining([
        "transaction_import_staging_household_token_hash_uq",
        "transaction_import_staging_household_expires_at_idx",
      ]),
    );
    expect(metadata.foreignKeys).toContain(
      "transaction_import_staging_account_household_fkey",
    );
    expect(metadata.checks).toEqual(
      expect.arrayContaining([
        "transaction_import_staging_token_hash_check",
        "transaction_import_staging_count_partition_check",
        "transaction_import_staging_candidates_array_check",
        "transaction_import_staging_expiry_check",
      ]),
    );
  });

  it("keeps item lineage tenant-safe and row-addressable", () => {
    const metadata = tableMetadata(transactionImportItems);
    const columnNames = metadata.columns.map(([name]) => name);

    expect(columnNames).toEqual([
      "id",
      "household_id",
      "import_id",
      "row_number",
      "external_id",
      "financial_event_id",
      "created_at",
    ]);
    expect(metadata.indexes).toEqual(
      expect.arrayContaining([
        "transaction_import_items_import_row_uq",
        "transaction_import_items_household_event_idx",
      ]),
    );
    expect(metadata.foreignKeys).toEqual(
      expect.arrayContaining([
        "transaction_import_items_import_household_fkey",
        "transaction_import_items_event_household_fkey",
      ]),
    );
    expect(metadata.checks).toEqual(
      expect.arrayContaining([
        "transaction_import_items_row_number_check",
        "transaction_import_items_external_id_check",
      ]),
    );
  });
});
