/**
 * Persistence primitives for S06 credit-card purchases and their schedule.
 *
 * A card is still an `accounts` row with `type = CREDIT_CARD`; this table is
 * only the one-to-one card configuration.  Purchases point at the existing
 * financial-event ledger and plans/installments describe the billing schedule
 * without introducing a second transaction or statement table.
 *
 * Every S06 table carries `household_id`.  The composite foreign keys below
 * deliberately keep that key in the relationship so an id copied from a
 * different household cannot be attached to a local aggregate.
 */
import {
  bigint as bigintColumn,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@/lib/uuidv7";

import { accounts } from "./accounts-categories-schema";
import { financialEvents } from "./financial-events-base-schema";
import { households } from "./tenancy-schema";

/** A schedule item is never independently paid in S06. */
export const installmentStatusEnum = pgEnum("installment_status", [
  "PLANNED",
  "POSTED",
  "CANCELLED",
]);

/**
 * Keep the cyclic purchase/plan edge lazy without making either table's
 * inferred TypeScript type recursive.  Drizzle resolves this callback while
 * it builds table metadata, after both declarations have initialized.
 */
function installmentPlanReferenceColumns(): [AnyPgColumn, AnyPgColumn] {
  return [installmentPlans.id, installmentPlans.householdId];
}

/**
 * PostgreSQL enforces the account specialization in the forward migration
 * with a trigger because a CHECK constraint cannot query `accounts.type`.
 */

/**
 * One configuration row per credit-card account.
 *
 * `id` is the opaque card resource id used by commands/read models while
 * `account_id` is the required one-to-one link to the ledger account.
 */
export const creditCards = pgTable(
  "credit_cards",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    accountId: uuid("account_id").notNull(),
    creditLimitCents: bigintColumn("credit_limit_cents", {
      mode: "bigint",
    }).notNull(),
    defaultPaymentAccountId: uuid("default_payment_account_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "credit_cards_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "credit_cards_account_household_fkey",
      columns: [table.accountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete("restrict"),
    foreignKey({
      name: "credit_cards_default_payment_account_household_fkey",
      columns: [table.defaultPaymentAccountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete("restrict"),
    // Child tables carry the card id and household id together.
    uniqueIndex("credit_cards_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    // The same account can have at most one S06 configuration.
    uniqueIndex("credit_cards_account_id_uq").on(table.accountId),
    index("credit_cards_household_account_idx").on(
      table.householdId,
      table.accountId,
    ),
    check(
      "credit_cards_credit_limit_positive_check",
      sql`${table.creditLimitCents} > 0`,
    ),
    check(
      "credit_cards_default_payment_account_distinct_check",
      sql`${table.defaultPaymentAccountId} is null
        or ${table.defaultPaymentAccountId} <> ${table.accountId}`,
    ),
  ],
);

/** Versioned civil-day rules used to materialize a schedule. */
export const creditCardBillingRules = pgTable(
  "credit_card_billing_rules",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    cardId: uuid("card_id").notNull(),
    closingDay: integer("closing_day").notNull(),
    dueDay: integer("due_day").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    effectiveUntil: date("effective_until", { mode: "string" }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "credit_card_billing_rules_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "credit_card_billing_rules_card_household_fkey",
      columns: [table.cardId, table.householdId],
      foreignColumns: [creditCards.id, creditCards.householdId],
    }).onDelete("restrict"),
    uniqueIndex("credit_card_billing_rules_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    // The exclusion constraint for overlapping ranges is added in the
    // forward migration (with btree_gist); this unique key gives deterministic
    // ordering and rejects two versions starting on the same date at the
    // schema layer.
    uniqueIndex("credit_card_billing_rules_card_effective_from_uq").on(
      table.householdId,
      table.cardId,
      table.effectiveFrom,
    ),
    index("credit_card_billing_rules_household_card_effective_idx").on(
      table.householdId,
      table.cardId,
      table.effectiveFrom,
      table.effectiveUntil,
    ),
    check(
      "credit_card_billing_rules_closing_day_check",
      sql`${table.closingDay} between 1 and 31`,
    ),
    check(
      "credit_card_billing_rules_due_day_check",
      sql`${table.dueDay} between 1 and 31`,
    ),
    check(
      "credit_card_billing_rules_effective_interval_check",
      sql`${table.effectiveUntil} is null
        or ${table.effectiveUntil} > ${table.effectiveFrom}`,
    ),
  ],
);

/**
 * Aggregate metadata for one economic purchase.  The amount and description
 * remain canonical on `financial_events`; this table stores only links and
 * aggregate identity.  The plan link is intentionally present so a purchase
 * cannot be mistaken for N independent financial events.
 *
 * The reverse FK to `installment_plans` is installed after both tables exist
 * by the S06 migration because the plan also points back to this purchase.
 */
export const creditCardPurchases = pgTable(
  "credit_card_purchases",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    cardId: uuid("card_id").notNull(),
    financialEventId: uuid("financial_event_id").notNull(),
    installmentPlanId: uuid("installment_plan_id").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "credit_card_purchases_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "credit_card_purchases_card_household_fkey",
      columns: [table.cardId, table.householdId],
      foreignColumns: [creditCards.id, creditCards.householdId],
    }).onDelete("restrict"),
    foreignKey({
      name: "credit_card_purchases_event_household_fkey",
      columns: [table.financialEventId, table.householdId],
      foreignColumns: [financialEvents.id, financialEvents.householdId],
    }).onDelete("restrict"),
    // The aggregate owns exactly one plan.  This reverse edge is deliberately
    // declared in the extra-config callback: Drizzle evaluates the callback
    // after this module has initialized `installmentPlans`, which lets the
    // database keep both sides of the one-to-one relationship tenant-safe.
    foreignKey({
      name: "credit_card_purchases_installment_plan_household_fkey",
      columns: [table.installmentPlanId, table.householdId],
      foreignColumns: installmentPlanReferenceColumns(),
    }).onDelete("restrict"),
    uniqueIndex("credit_card_purchases_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    uniqueIndex("credit_card_purchases_event_id_uq").on(
      table.financialEventId,
    ),
    uniqueIndex("credit_card_purchases_installment_plan_id_uq").on(
      table.installmentPlanId,
    ),
    index("credit_card_purchases_household_card_created_idx").on(
      table.householdId,
      table.cardId,
      table.createdAt,
    ),
  ],
);

/** One schedule aggregate per purchase; its total mirrors the event amount. */
export const installmentPlans = pgTable(
  "installment_plans",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    purchaseId: uuid("purchase_id").notNull(),
    totalAmountCents: bigintColumn("total_amount_cents", {
      mode: "bigint",
    }).notNull(),
    installmentCount: integer("installment_count").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "installment_plans_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "installment_plans_purchase_household_fkey",
      columns: [table.purchaseId, table.householdId],
      foreignColumns: [creditCardPurchases.id, creditCardPurchases.householdId],
    }).onDelete("restrict"),
    uniqueIndex("installment_plans_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    // Installments carry the denormalized purchase id for read-side joins;
    // this key lets their FK prove that the plan and purchase are the same
    // aggregate, not merely two valid rows from this household.
    uniqueIndex("installment_plans_id_purchase_household_uq").on(
      table.id,
      table.purchaseId,
      table.householdId,
    ),
    uniqueIndex("installment_plans_purchase_id_uq").on(table.purchaseId),
    index("installment_plans_household_purchase_idx").on(
      table.householdId,
      table.purchaseId,
    ),
    check(
      "installment_plans_total_amount_positive_check",
      sql`${table.totalAmountCents} > 0`,
    ),
    check(
      "installment_plans_count_check",
      sql`${table.installmentCount} between 1 and 120`,
    ),
  ],
);

/**
 * Materialized schedule rows.  Billing fields are snapshots: reads must not
 * recalculate old rows from the card's currently active rule.
 */
export const installments = pgTable(
  "installments",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    planId: uuid("plan_id").notNull(),
    purchaseId: uuid("purchase_id").notNull(),
    sequence: integer("sequence").notNull(),
    amountCents: bigintColumn("amount_cents", { mode: "bigint" }).notNull(),
    status: installmentStatusEnum("status").notNull().default("PLANNED"),
    billingRuleId: uuid("billing_rule_id").notNull(),
    billingCycle: date("billing_cycle", { mode: "string" }).notNull(),
    billingClosingDay: integer("billing_closing_day").notNull(),
    billingDueDay: integer("billing_due_day").notNull(),
    billingClosingOn: date("billing_closing_on", { mode: "string" }).notNull(),
    billingDueOn: date("billing_due_on", { mode: "string" }).notNull(),
    billingDueOnOverride: date("billing_due_on_override", { mode: "string" }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "installments_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "installments_plan_household_fkey",
      columns: [table.planId, table.householdId],
      foreignColumns: [installmentPlans.id, installmentPlans.householdId],
    }).onDelete("restrict"),
    foreignKey({
      name: "installments_plan_purchase_household_fkey",
      columns: [table.planId, table.purchaseId, table.householdId],
      foreignColumns: [
        installmentPlans.id,
        installmentPlans.purchaseId,
        installmentPlans.householdId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "installments_purchase_household_fkey",
      columns: [table.purchaseId, table.householdId],
      foreignColumns: [creditCardPurchases.id, creditCardPurchases.householdId],
    }).onDelete("restrict"),
    foreignKey({
      name: "installments_billing_rule_household_fkey",
      columns: [table.billingRuleId, table.householdId],
      foreignColumns: [
        creditCardBillingRules.id,
        creditCardBillingRules.householdId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("installments_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    uniqueIndex("installments_plan_sequence_uq").on(
      table.planId,
      table.sequence,
    ),
    index("installments_household_cycle_due_idx").on(
      table.householdId,
      table.billingCycle,
      table.billingDueOn,
    ),
    index("installments_household_status_due_idx").on(
      table.householdId,
      table.status,
      table.billingDueOn,
    ),
    index("installments_household_purchase_sequence_idx").on(
      table.householdId,
      table.purchaseId,
      table.sequence,
    ),
    check(
      "installments_sequence_check",
      sql`${table.sequence} between 1 and 120`,
    ),
    check(
      "installments_amount_positive_check",
      sql`${table.amountCents} > 0`,
    ),
    check(
      "installments_billing_days_check",
      sql`${table.billingClosingDay} between 1 and 31
        and ${table.billingDueDay} between 1 and 31`,
    ),
    check(
      "installments_billing_dates_check",
      sql`${table.billingDueOn} > ${table.billingClosingOn}
        and (
          ${table.billingDueOnOverride} is null
          or ${table.billingDueOnOverride} > ${table.billingClosingOn}
        )`,
    ),
    check(
      "installments_billing_cycle_first_day_check",
      sql`${table.billingCycle} = date_trunc('month', ${table.billingCycle})::date`,
    ),
  ],
);

export type CreditCardRecord = typeof creditCards.$inferSelect;
export type NewCreditCard = typeof creditCards.$inferInsert;
export type CreditCardBillingRuleRecord =
  typeof creditCardBillingRules.$inferSelect;
export type NewCreditCardBillingRule =
  typeof creditCardBillingRules.$inferInsert;
export type CreditCardPurchaseRecord = typeof creditCardPurchases.$inferSelect;
export type NewCreditCardPurchase = typeof creditCardPurchases.$inferInsert;
export type InstallmentPlanRecord = typeof installmentPlans.$inferSelect;
export type NewInstallmentPlan = typeof installmentPlans.$inferInsert;
export type InstallmentRecord = typeof installments.$inferSelect;
export type NewInstallment = typeof installments.$inferInsert;
