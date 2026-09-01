import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  holidays,
  plannedEvents,
  recurringOccurrences,
  recurringRules,
} from "./recurring-schema";

type DrizzleTable = Parameters<typeof getTableConfig>[0];

function metadata(table: DrizzleTable) {
  const config = getTableConfig(table);
  return {
    name: config.name,
    columns: config.columns.map((column) => column.name),
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
        onDelete: foreignKey.onDelete,
      };
    }),
    checks: config.checks.map((check) => check.name),
  };
}

describe("S07 recurring persistence schema", () => {
  it("declares only source data and exposes no forecast/saldo table", () => {
    expect(
      [recurringRules, recurringOccurrences, holidays, plannedEvents].map(
        (table) => metadata(table).name,
      ),
    ).toEqual([
      "recurring_rules",
      "recurring_occurrences",
      "holidays",
      "planned_events",
    ]);

    expect(metadata(recurringRules).columns).toEqual([
      "id",
      "household_id",
      "account_id",
      "category_id",
      "kind",
      "amount_cents",
      "description",
      "frequency",
      "day_rule",
      "day_of_month",
      "start_on",
      "end_on",
      "include_in_conservative_forecast",
      "created_at",
      "updated_at",
    ]);
    expect(metadata(recurringOccurrences).columns).toEqual([
      "id",
      "household_id",
      "recurring_rule_id",
      "occurrence_key",
      "status",
      "amount_cents",
      "expected_on",
      "financial_event_id",
      "is_partial",
      "created_at",
      "updated_at",
    ]);
    expect(metadata(holidays).columns).toEqual([
      "id",
      "household_id",
      "date",
      "name",
      "created_at",
      "updated_at",
    ]);
    expect(metadata(plannedEvents).columns).toEqual([
      "id",
      "household_id",
      "account_id",
      "category_id",
      "kind",
      "status",
      "amount_cents",
      "expected_on",
      "description",
      "include_in_conservative_forecast",
      "financial_event_id",
      "is_partial",
      "created_at",
      "updated_at",
    ]);
  });

  it("publishes composite tenant foreign keys and occurrence reconciliation key", () => {
    expect(metadata(recurringOccurrences).foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "recurring_occurrences_rule_household_fkey",
          columns: ["recurring_rule_id", "household_id"],
          foreignColumns: ["id", "household_id"],
          onDelete: "restrict",
        }),
        expect.objectContaining({
          name: "recurring_occurrences_event_household_fkey",
          columns: ["financial_event_id", "household_id"],
          foreignColumns: ["id", "household_id"],
          onDelete: "restrict",
        }),
      ]),
    );
    expect(metadata(plannedEvents).foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "planned_events_account_household_fkey",
          columns: ["account_id", "household_id"],
          foreignColumns: ["id", "household_id"],
          onDelete: "restrict",
        }),
        expect.objectContaining({
          name: "planned_events_event_household_fkey",
          columns: ["financial_event_id", "household_id"],
          foreignColumns: ["id", "household_id"],
          onDelete: "restrict",
        }),
      ]),
    );
    expect(metadata(recurringOccurrences).indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "recurring_occurrences_rule_key_uq",
          unique: true,
          columns: ["recurring_rule_id", "occurrence_key"],
        }),
      ]),
    );
  });

  it("publishes positive-value, status, interval and day-rule checks", () => {
    expect(metadata(recurringRules).checks).toEqual(
      expect.arrayContaining([
        "recurring_rules_amount_positive_check",
        "recurring_rules_effective_interval_check",
        "recurring_rules_day_rule_shape_check",
      ]),
    );
    expect(metadata(recurringOccurrences).checks).toEqual(
      expect.arrayContaining([
        "recurring_occurrences_key_format_check",
        "recurring_occurrences_amount_positive_check",
        "recurring_occurrences_status_shape_check",
      ]),
    );
    expect(metadata(plannedEvents).checks).toEqual(
      expect.arrayContaining([
        "planned_events_amount_positive_check",
        "planned_events_status_shape_check",
      ]),
    );
  });
});

