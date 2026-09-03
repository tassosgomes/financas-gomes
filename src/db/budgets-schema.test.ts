import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  BUDGET_COMMAND_OPERATIONS,
  budgetAllocationRules,
  budgetMovements,
  budgets,
} from "./budgets-schema";
import * as databaseSchema from "./schema";

type DrizzleTable = Parameters<typeof getTableConfig>[0];

function tableMetadata(table: DrizzleTable) {
  const config = getTableConfig(table);

  return {
    name: config.name,
    columns: config.columns.map((column) => ({
      name: column.name,
      notNull: column.notNull,
    })),
    indexes: config.indexes.map((index) => ({
      name: index.config.name,
      unique: index.config.unique,
      columns: index.config.columns.map((column) => {
        const candidate = column as { name?: unknown };
        return typeof candidate.name === "string"
          ? candidate.name
          : String(column);
      }),
    })),
    foreignKeys: config.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();

      return {
        name: foreignKey.getName(),
        columns: reference.columns.map((column) => column.name),
        foreignColumns: reference.foreignColumns.map((column) => column.name),
        foreignTable: getTableConfig(reference.foreignColumns[0]!.table).name,
        onDelete: foreignKey.onDelete,
      };
    }),
    checks: config.checks.map((check) => check.name),
  };
}

describe("S09 Caixinhas schema metadata", () => {
  it("declares canonical persistence tables without balance or snapshots", () => {
    expect(
      [budgets, budgetMovements, budgetAllocationRules].map(
        (table) => tableMetadata(table).name,
      ),
    ).toEqual([
      "budgets",
      "budget_movements",
      "budget_allocation_rules",
    ]);

    expect(tableMetadata(budgets).columns.map(({ name }) => name)).toEqual([
      "id",
      "household_id",
      "reference_id",
      "category_id",
      "name",
      "status",
      "active_from",
      "closed_on",
      "target_amount_cents",
      "target_date",
      "created_at",
      "updated_at",
    ]);
    expect(
      tableMetadata(budgetMovements).columns.map(({ name }) => name),
    ).toEqual([
      "id",
      "household_id",
      "budget_id",
      "reference_id",
      "kind",
      "amount_cents",
      "effective_on",
      "source_kind",
      "source_reference_id",
      "financial_event_id",
      "account_entry_id",
      "corrects_movement_id",
      "transfer_reference_id",
      "created_at",
    ]);
    expect(
      tableMetadata(budgetAllocationRules).columns.map(({ name }) => name),
    ).toEqual([
      "id",
      "household_id",
      "budget_id",
      "amount_cents",
      "effective_from",
      "effective_until",
      "created_at",
    ]);

    expect(databaseSchema.schema.budgets).toBe(budgets);
    expect(databaseSchema.schema.budgetMovements).toBe(budgetMovements);
    expect(databaseSchema.schema.budgetAllocationRules).toBe(
      budgetAllocationRules,
    );
    const persistedColumnNames = [
      budgets,
      budgetMovements,
      budgetAllocationRules,
    ].flatMap((table) => tableMetadata(table).columns.map(({ name }) => name));
    expect(persistedColumnNames.join(",")).not.toMatch(
      /balance|protected_amount|spendable_snapshot/i,
    );
  });

  it("publishes tenant-safe restrictive composite foreign keys", () => {
    const expected = [
      {
        table: budgets,
        name: "budgets_category_household_fkey",
        columns: ["category_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "categories",
      },
      {
        table: budgetMovements,
        name: "budget_movements_budget_household_fkey",
        columns: ["budget_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "budgets",
      },
      {
        table: budgetMovements,
        name: "budget_movements_financial_event_household_fkey",
        columns: ["financial_event_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "financial_events",
      },
      {
        table: budgetMovements,
        name: "budget_movements_account_entry_household_fkey",
        columns: ["account_entry_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "account_entries",
      },
      {
        table: budgetMovements,
        name: "budget_movements_correction_household_fkey",
        columns: ["corrects_movement_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "budget_movements",
      },
      {
        table: budgetAllocationRules,
        name: "budget_allocation_rules_budget_household_fkey",
        columns: ["budget_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "budgets",
      },
    ];

    for (const { table, ...foreignKey } of expected) {
      expect(tableMetadata(table).foreignKeys).toContainEqual({
        ...foreignKey,
        onDelete: "restrict",
      });
    }

    for (const table of [budgets, budgetMovements, budgetAllocationRules]) {
      expect(
        tableMetadata(table).foreignKeys.every(
          ({ onDelete }) => onDelete === "restrict",
        ),
      ).toBe(true);
    }
  });

  it("publishes temporal, amount, lineage and reference integrity metadata", () => {
    expect(tableMetadata(budgets).checks).toEqual(
      expect.arrayContaining([
        "budgets_reference_id_shape_check",
        "budgets_reference_id_no_control_check",
        "budgets_name_length_check",
        "budgets_name_no_control_check",
        "budgets_status_shape_check",
        "budgets_closed_on_range_check",
        "budgets_target_shape_check",
      ]),
    );
    expect(tableMetadata(budgetMovements).checks).toEqual(
      expect.arrayContaining([
        "budget_movements_reference_id_shape_check",
        "budget_movements_reference_id_no_control_check",
        "budget_movements_amount_positive_check",
        "budget_movements_source_reference_shape_check",
        "budget_movements_transfer_reference_shape_check",
      ]),
    );
    expect(tableMetadata(budgetAllocationRules).checks).toEqual(
      expect.arrayContaining([
        "budget_allocation_rules_amount_nonnegative_check",
        "budget_allocation_rules_effective_interval_check",
      ]),
    );

    expect(tableMetadata(budgets).indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "budgets_id_household_id_uq",
          unique: true,
        }),
        expect.objectContaining({
          name: "budgets_household_reference_id_uq",
          unique: true,
        }),
      ]),
    );
    expect(tableMetadata(budgetMovements).indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "budget_movements_id_household_id_uq",
          unique: true,
        }),
        expect.objectContaining({
          name: "budget_movements_household_reference_id_uq",
          unique: true,
        }),
        expect.objectContaining({
          name: "budget_movements_household_budget_effective_on_id_idx",
        }),
      ]),
    );
    expect(tableMetadata(budgetAllocationRules).indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "budget_allocation_rules_budget_effective_from_uq",
          unique: true,
        }),
      ]),
    );
  });

  it("keeps application command operations finite and S09-specific", () => {
    expect(BUDGET_COMMAND_OPERATIONS).toEqual([
      "budget.create",
      "budget.update",
      "budget.close",
      "budget.movement.contribution",
      "budget.movement.withdrawal",
      "budget.movement.transfer",
      "budget.movement.correct",
      "budget.allocation.replace",
      "budget.distribution",
    ]);
    expect(BUDGET_COMMAND_OPERATIONS).not.toContain("budget.delete");
  });
});
