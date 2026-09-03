import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  creditCardBillingRules,
  creditCardPurchases,
  creditCards,
  installmentPlans,
  installments,
} from "./credit-cards-schema";

type DrizzleTable = Parameters<typeof getTableConfig>[0];

function tableMetadata(table: DrizzleTable) {
  const config = getTableConfig(table);

  return {
    name: config.name,
    columns: config.columns.map((column) => ({
      name: column.name,
      columnType: column.columnType,
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

function indexMetadata(table: DrizzleTable, name: string) {
  return tableMetadata(table).indexes.find((index) => index.name === name);
}

describe("credit-card schema metadata", () => {
  it("declares the card, billing-rule, purchase, plan and installment tables", () => {
    expect(
      [
        creditCards,
        creditCardBillingRules,
        creditCardPurchases,
        installmentPlans,
        installments,
      ].map((table) => tableMetadata(table).name),
    ).toEqual([
      "credit_cards",
      "credit_card_billing_rules",
      "credit_card_purchases",
      "installment_plans",
      "installments",
    ]);

    expect(tableMetadata(creditCards).columns.map(({ name }) => name)).toEqual([
      "id",
      "household_id",
      "account_id",
      "credit_limit_cents",
      "default_payment_account_id",
      "created_at",
      "updated_at",
    ]);
    expect(
      tableMetadata(creditCardBillingRules).columns.map(({ name }) => name),
    ).toEqual([
      "id",
      "household_id",
      "card_id",
      "closing_day",
      "due_day",
      "effective_from",
      "effective_until",
      "created_at",
    ]);
    expect(
      tableMetadata(creditCardPurchases).columns.map(({ name }) => name),
    ).toEqual([
      "id",
      "household_id",
      "card_id",
      "financial_event_id",
      "installment_plan_id",
      "created_at",
      "updated_at",
    ]);
    expect(tableMetadata(installmentPlans).columns.map(({ name }) => name)).toEqual([
      "id",
      "household_id",
      "purchase_id",
      "total_amount_cents",
      "installment_count",
      "created_at",
    ]);
    expect(tableMetadata(installments).columns.map(({ name }) => name)).toEqual([
      "id",
      "household_id",
      "plan_id",
      "purchase_id",
      "sequence",
      "amount_cents",
      "status",
      "billing_rule_id",
      "billing_cycle",
      "billing_closing_day",
      "billing_due_day",
      "billing_closing_on",
      "billing_due_on",
      "billing_due_on_override",
      "created_at",
    ]);
  });

  it("keeps every relationship restrictive and tenant-safe", () => {
    const tables = [
      creditCards,
      creditCardBillingRules,
      creditCardPurchases,
      installmentPlans,
      installments,
    ];

    for (const table of tables) {
      expect(tableMetadata(table).foreignKeys).not.toHaveLength(0);
      expect(tableMetadata(table).foreignKeys).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ onDelete: "restrict" }),
        ]),
      );
      expect(tableMetadata(table).foreignKeys.every(({ onDelete }) => onDelete === "restrict")).toBe(
        true,
      );
    }

    const expectedCompositeForeignKeys = [
      {
        table: creditCards,
        name: "credit_cards_account_household_fkey",
        columns: ["account_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "accounts",
      },
      {
        table: creditCards,
        name: "credit_cards_default_payment_account_household_fkey",
        columns: ["default_payment_account_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "accounts",
      },
      {
        table: creditCardBillingRules,
        name: "credit_card_billing_rules_card_household_fkey",
        columns: ["card_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "credit_cards",
      },
      {
        table: creditCardPurchases,
        name: "credit_card_purchases_card_household_fkey",
        columns: ["card_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "credit_cards",
      },
      {
        table: creditCardPurchases,
        name: "credit_card_purchases_event_household_fkey",
        columns: ["financial_event_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "financial_events",
      },
      {
        table: creditCardPurchases,
        name: "credit_card_purchases_installment_plan_household_fkey",
        columns: ["installment_plan_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "installment_plans",
      },
      {
        table: installmentPlans,
        name: "installment_plans_purchase_household_fkey",
        columns: ["purchase_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "credit_card_purchases",
      },
      {
        table: installments,
        name: "installments_plan_household_fkey",
        columns: ["plan_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "installment_plans",
      },
      {
        table: installments,
        name: "installments_plan_purchase_household_fkey",
        columns: ["plan_id", "purchase_id", "household_id"],
        foreignColumns: ["id", "purchase_id", "household_id"],
        foreignTable: "installment_plans",
      },
      {
        table: installments,
        name: "installments_purchase_household_fkey",
        columns: ["purchase_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "credit_card_purchases",
      },
      {
        table: installments,
        name: "installments_billing_rule_household_fkey",
        columns: ["billing_rule_id", "household_id"],
        foreignColumns: ["id", "household_id"],
        foreignTable: "credit_card_billing_rules",
      },
    ];

    for (const expected of expectedCompositeForeignKeys) {
      expect(tableMetadata(expected.table).foreignKeys).toContainEqual({
        name: expected.name,
        columns: expected.columns,
        foreignColumns: expected.foreignColumns,
        foreignTable: expected.foreignTable,
        onDelete: "restrict",
      });
    }
  });

  it("publishes the integrity checks and indexes used by S06 reads/writes", () => {
    expect(tableMetadata(creditCards).checks).toEqual(
      expect.arrayContaining([
        "credit_cards_credit_limit_positive_check",
        "credit_cards_default_payment_account_distinct_check",
      ]),
    );
    expect(tableMetadata(creditCardBillingRules).checks).toEqual(
      expect.arrayContaining([
        "credit_card_billing_rules_closing_day_check",
        "credit_card_billing_rules_due_day_check",
        "credit_card_billing_rules_effective_interval_check",
      ]),
    );
    expect(tableMetadata(installmentPlans).checks).toEqual(
      expect.arrayContaining([
        "installment_plans_total_amount_positive_check",
        "installment_plans_count_check",
      ]),
    );
    expect(tableMetadata(installments).checks).toEqual(
      expect.arrayContaining([
        "installments_sequence_check",
        "installments_amount_positive_check",
        "installments_billing_days_check",
        "installments_billing_dates_check",
        "installments_billing_cycle_first_day_check",
      ]),
    );

    for (const [table, name, columns] of [
      [creditCards, "credit_cards_account_id_uq", ["account_id"]],
      [creditCards, "credit_cards_household_account_idx", ["household_id", "account_id"]],
      [creditCardBillingRules, "credit_card_billing_rules_card_effective_from_uq", ["household_id", "card_id", "effective_from"]],
      [creditCardBillingRules, "credit_card_billing_rules_household_card_effective_idx", ["household_id", "card_id", "effective_from", "effective_until"]],
      [creditCardPurchases, "credit_card_purchases_event_id_uq", ["financial_event_id"]],
      [creditCardPurchases, "credit_card_purchases_installment_plan_id_uq", ["installment_plan_id"]],
      [creditCardPurchases, "credit_card_purchases_household_card_created_idx", ["household_id", "card_id", "created_at"]],
      [installmentPlans, "installment_plans_id_purchase_household_uq", ["id", "purchase_id", "household_id"]],
      [installmentPlans, "installment_plans_purchase_id_uq", ["purchase_id"]],
      [installmentPlans, "installment_plans_household_purchase_idx", ["household_id", "purchase_id"]],
      [installments, "installments_plan_sequence_uq", ["plan_id", "sequence"]],
      [installments, "installments_household_cycle_due_idx", ["household_id", "billing_cycle", "billing_due_on"]],
      [installments, "installments_household_status_due_idx", ["household_id", "status", "billing_due_on"]],
      [installments, "installments_household_purchase_sequence_idx", ["household_id", "purchase_id", "sequence"]],
    ] as const) {
      expect(indexMetadata(table, name)).toMatchObject({
        name,
        columns,
      });
    }

    for (const [table, name] of [
      [creditCards, "credit_cards_account_id_uq"],
      [creditCardBillingRules, "credit_card_billing_rules_card_effective_from_uq"],
      [creditCardPurchases, "credit_card_purchases_event_id_uq"],
      [creditCardPurchases, "credit_card_purchases_installment_plan_id_uq"],
      [installmentPlans, "installment_plans_id_purchase_household_uq"],
      [installmentPlans, "installment_plans_purchase_id_uq"],
      [installments, "installments_plan_sequence_uq"],
    ] as const) {
      expect(indexMetadata(table, name)?.unique).toBe(true);
    }
  });
});
