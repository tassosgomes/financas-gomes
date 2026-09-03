/**
 * Persistence contract for S09 Caixinhas (Budget aggregates).
 *
 * The tables retain configuration, immutable movement facts and effective-
 * dated allocation rules only. A budget balance, protected amount or
 * Spendable snapshot is intentionally not persisted here.
 */
import {
  bigint as bigintColumn,
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@/lib/uuidv7";

import {
  accountEntries,
  financialEvents,
} from "./financial-events-schema";
import { categories } from "./accounts-categories-schema";
import { households } from "./tenancy-schema";

/** Persisted aggregate state; closing is historical, not deletion. */
export const budgetStatusEnum = pgEnum("budget_status", [
  "ACTIVE",
  "CLOSED",
]);

/** Movement amount is always positive; this enum supplies its sign. */
export const budgetMovementKindEnum = pgEnum("budget_movement_kind", [
  "CONTRIBUTION",
  "WITHDRAWAL",
]);

/** Optional source classification used by S09 reconciliation/readers. */
export const budgetMovementSourceKindEnum = pgEnum(
  "budget_movement_source_kind",
  ["MANUAL", "ALLOCATION", "EXPENSE", "REFUND", "CORRECTION", "TRANSFER"],
);

/** Closed command vocabulary persisted by application_commands for S09. */
export const BUDGET_COMMAND_OPERATIONS = [
  "budget.create",
  "budget.update",
  "budget.close",
  "budget.movement.contribution",
  "budget.movement.withdrawal",
  "budget.movement.transfer",
  "budget.movement.correct",
  "budget.allocation.replace",
  "budget.distribution",
] as const;

/**
 * One tenant-owned Caixinha. `referenceId` is the opaque S09 boundary key;
 * `id` remains an internal UUIDv7 persistence identifier.
 */
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    referenceId: text("reference_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    name: text("name").notNull(),
    status: budgetStatusEnum("status").notNull().default("ACTIVE"),
    activeFrom: date("active_from", { mode: "string" }).notNull(),
    closedOn: date("closed_on", { mode: "string" }),
    targetAmountCents: bigintColumn("target_amount_cents", {
      mode: "bigint",
    }),
    targetDate: date("target_date", { mode: "string" }),
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
      name: "budgets_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "budgets_category_household_fkey",
      columns: [table.categoryId, table.householdId],
      foreignColumns: [categories.id, categories.householdId],
    }).onDelete("restrict"),
    // Child rows always carry household_id in their composite FK.
    uniqueIndex("budgets_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    uniqueIndex("budgets_household_reference_id_uq").on(
      table.householdId,
      table.referenceId,
    ),
    index("budgets_household_status_active_from_idx").on(
      table.householdId,
      table.status,
      table.activeFrom,
    ),
    index("budgets_household_category_active_from_idx").on(
      table.householdId,
      table.categoryId,
      table.activeFrom,
    ),
    check(
      "budgets_reference_id_shape_check",
      sql`char_length(${table.referenceId}) between 1 and 256`,
    ),
    check(
      "budgets_reference_id_no_control_check",
      sql`${table.referenceId} !~ '[[:cntrl:]]'`,
    ),
    check(
      "budgets_name_length_check",
      sql`char_length(${table.name}) between 1 and 120`,
    ),
    check(
      "budgets_name_no_control_check",
      sql`${table.name} !~ '[[:cntrl:]]'`,
    ),
    check(
      "budgets_status_shape_check",
      sql`(
        (${table.status}::text = 'ACTIVE' and ${table.closedOn} is null)
        or
        (${table.status}::text = 'CLOSED' and ${table.closedOn} is not null)
      )`,
    ),
    check(
      "budgets_closed_on_range_check",
      sql`${table.closedOn} is null or ${table.closedOn} >= ${table.activeFrom}`,
    ),
    check(
      "budgets_target_shape_check",
      sql`(
        (${table.targetAmountCents} is null and ${table.targetDate} is null)
        or
        (
          ${table.targetAmountCents} > 0
          and ${table.targetDate} is not null
          and ${table.targetDate} >= ${table.activeFrom}
        )
      )`,
    ),
  ],
);

/**
 * Immutable signed-by-kind movement stream. Optional source columns preserve
 * links to ledger/forecast facts without creating a second financial source.
 */
export const budgetMovements = pgTable(
  "budget_movements",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    budgetId: uuid("budget_id").notNull(),
    referenceId: text("reference_id").notNull(),
    kind: budgetMovementKindEnum("kind").notNull(),
    amountCents: bigintColumn("amount_cents", { mode: "bigint" }).notNull(),
    effectiveOn: date("effective_on", { mode: "string" }).notNull(),
    sourceKind: budgetMovementSourceKindEnum("source_kind")
      .notNull()
      .default("MANUAL"),
    sourceReferenceId: text("source_reference_id"),
    financialEventId: uuid("financial_event_id"),
    accountEntryId: uuid("account_entry_id"),
    correctsMovementId: uuid("corrects_movement_id"),
    transferReferenceId: text("transfer_reference_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "budget_movements_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "budget_movements_budget_household_fkey",
      columns: [table.budgetId, table.householdId],
      foreignColumns: [budgets.id, budgets.householdId],
    }).onDelete("restrict"),
    foreignKey({
      name: "budget_movements_financial_event_household_fkey",
      columns: [table.financialEventId, table.householdId],
      foreignColumns: [financialEvents.id, financialEvents.householdId],
    }).onDelete("restrict"),
    foreignKey({
      name: "budget_movements_account_entry_household_fkey",
      columns: [table.accountEntryId, table.householdId],
      foreignColumns: [accountEntries.id, accountEntries.householdId],
    }).onDelete("restrict"),
    foreignKey({
      name: "budget_movements_correction_household_fkey",
      columns: [table.correctsMovementId, table.householdId],
      foreignColumns: [table.id, table.householdId],
    }).onDelete("restrict"),
    uniqueIndex("budget_movements_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    uniqueIndex("budget_movements_household_reference_id_uq").on(
      table.householdId,
      table.referenceId,
    ),
    // One economic source can materialize at most one Caixinha movement per
    // household.  The partial indexes keep ordinary manual movements (which
    // have no source reference) unrestricted while making retries and
    // reconciliation safe at the database boundary.
    uniqueIndex("budget_movements_household_source_reference_uq")
      .on(table.householdId, table.sourceReferenceId)
      .where(sql`${table.sourceReferenceId} is not null`),
    uniqueIndex("budget_movements_household_account_entry_uq")
      .on(table.householdId, table.accountEntryId)
      .where(sql`${table.accountEntryId} is not null`),
    index("budget_movements_household_budget_effective_on_id_idx").on(
      table.householdId,
      table.budgetId,
      table.effectiveOn,
      table.id,
    ),
    index("budget_movements_household_effective_on_budget_idx").on(
      table.householdId,
      table.effectiveOn,
      table.budgetId,
    ),
    index("budget_movements_household_source_reference_idx").on(
      table.householdId,
      table.sourceReferenceId,
    ),
    check(
      "budget_movements_reference_id_shape_check",
      sql`char_length(${table.referenceId}) between 1 and 256`,
    ),
    check(
      "budget_movements_reference_id_no_control_check",
      sql`${table.referenceId} !~ '[[:cntrl:]]'`,
    ),
    check(
      "budget_movements_amount_positive_check",
      sql`${table.amountCents} > 0`,
    ),
    check(
      "budget_movements_source_reference_shape_check",
      sql`${table.sourceReferenceId} is null or (
        char_length(${table.sourceReferenceId}) between 1 and 256
        and ${table.sourceReferenceId} !~ '[[:cntrl:]]'
      )`,
    ),
    check(
      "budget_movements_transfer_reference_shape_check",
      sql`${table.transferReferenceId} is null or (
        char_length(${table.transferReferenceId}) between 1 and 256
        and ${table.transferReferenceId} !~ '[[:cntrl:]]'
      )`,
    ),
  ],
);

/** Effective-dated nominal allocation weights; never a balance snapshot. */
export const budgetAllocationRules = pgTable(
  "budget_allocation_rules",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    budgetId: uuid("budget_id").notNull(),
    amountCents: bigintColumn("amount_cents", { mode: "bigint" }).notNull(),
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
      name: "budget_allocation_rules_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "budget_allocation_rules_budget_household_fkey",
      columns: [table.budgetId, table.householdId],
      foreignColumns: [budgets.id, budgets.householdId],
    }).onDelete("restrict"),
    uniqueIndex("budget_allocation_rules_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    uniqueIndex("budget_allocation_rules_budget_effective_from_uq").on(
      table.budgetId,
      table.effectiveFrom,
    ),
    index("budget_allocation_rules_household_budget_effective_from_idx").on(
      table.householdId,
      table.budgetId,
      table.effectiveFrom,
    ),
    index("budget_allocation_rules_household_effective_from_idx").on(
      table.householdId,
      table.effectiveFrom,
    ),
    check(
      "budget_allocation_rules_amount_nonnegative_check",
      sql`${table.amountCents} >= 0`,
    ),
    check(
      "budget_allocation_rules_effective_interval_check",
      sql`${table.effectiveUntil} is null or ${table.effectiveUntil} > ${table.effectiveFrom}`,
    ),
  ],
);

export type BudgetRecord = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type BudgetMovementRecord = typeof budgetMovements.$inferSelect;
export type NewBudgetMovement = typeof budgetMovements.$inferInsert;
export type BudgetAllocationRuleRecord =
  typeof budgetAllocationRules.$inferSelect;
export type NewBudgetAllocationRule = typeof budgetAllocationRules.$inferInsert;
