/**
 * Persistence contract for the S02 account and category metadata.
 *
 * This module intentionally contains no ledger columns. Balances, events and
 * entries belong to later slices; these tables only describe the resources
 * that those slices may reference.
 */
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@/lib/uuidv7";

import { households } from "./tenancy-schema";

/** Status shared by accounts and categories. Archived rows remain historical. */
export const accountStatusEnum = pgEnum("account_status", [
  "ACTIVE",
  "ARCHIVED",
]);

export const accountTypeEnum = pgEnum("account_type", [
  "CHECKING",
  "SAVINGS",
  "CASH",
  "CREDIT_CARD",
  "BENEFIT",
  "INVESTMENT",
  "OTHER",
]);

export const spendabilityEnum = pgEnum("spendability", [
  "GENERAL",
  "RESTRICTED",
  "EXCLUDED",
]);

export const liquidityEnum = pgEnum("liquidity", [
  "IMMEDIATE",
  "LIQUID",
  "RESTRICTED",
]);

export const categoryKindEnum = pgEnum("category_kind", [
  "EXPENSE",
  "INCOME",
]);

/**
 * Tenant-owned account metadata. `trackingStartedOn` is deliberately nullable
 * and has no default: the opening-balance flow owns that transition.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull(),
    status: accountStatusEnum("status").notNull().default("ACTIVE"),
    spendability: spendabilityEnum("spendability")
      .notNull()
      .default("GENERAL"),
    liquidity: liquidityEnum("liquidity").notNull().default("IMMEDIATE"),
    includeInNetWorth: boolean("include_in_net_worth")
      .notNull()
      .default(true),
    trackingStartedOn: date("tracking_started_on", { mode: "string" }),
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
      name: "accounts_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    // Future ledger tables use (id, household_id) composite references.
    uniqueIndex("accounts_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    uniqueIndex("accounts_household_name_ci_uq").on(
      table.householdId,
      sql`lower(${table.name})`,
    ),
    index("accounts_household_status_name_idx").on(
      table.householdId,
      table.status,
      table.name,
    ),
    check(
      "accounts_name_length_check",
      sql`char_length(${table.name}) between 1 and 120`,
    ),
    check(
      "accounts_name_no_control_check",
      sql`${table.name} !~ '[[:cntrl:]]'`,
    ),
  ],
);

/**
 * Tenant-owned category metadata. The composite parent FK makes it
 * impossible to point at a category from another household, while the
 * application/domain layer enforces the one-child-level rule.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    kind: categoryKindEnum("kind").notNull(),
    status: accountStatusEnum("status").notNull().default("ACTIVE"),
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
      name: "categories_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "categories_parent_same_household_fkey",
      columns: [table.parentId, table.householdId],
      foreignColumns: [table.id, table.householdId],
    }).onDelete("restrict"),
    // Future ledger tables need to reference a category without losing the
    // tenant key in the FK.
    unique("categories_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    // COALESCE turns NULL into one stable key, so two root categories with the
    // same normalized name conflict just like two siblings do.
    uniqueIndex("categories_household_parent_name_ci_uq").using(
      "btree",
      table.householdId,
      sql`coalesce(${table.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${table.name})`,
    ),
    index("categories_household_parent_status_name_idx").on(
      table.householdId,
      table.parentId,
      table.status,
      table.name,
    ),
    check(
      "categories_name_length_check",
      sql`char_length(${table.name}) between 1 and 120`,
    ),
    check(
      "categories_name_no_control_check",
      sql`${table.name} !~ '[[:cntrl:]]'`,
    ),
    check(
      "categories_parent_not_self_check",
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
  ],
);

/**
 * Shared idempotency record for all command-based writes.
 *
 * `resourceId` is intentionally polymorphic: future slices may point to an
 * event or import without adding a second command table. The payload hash is
 * retained so a reused command ID can be distinguished from a valid retry.
 */
export const applicationCommands = pgTable(
  "application_commands",
  {
    householdId: uuid("household_id").notNull(),
    commandId: text("command_id").notNull(),
    operation: text("operation").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resourceId: uuid("resource_id"),
    // Command retries need the exact serializable outcome, including a
    // duplicate-dataset conflict whose preview staging may later expire.
    // S02/S03 commands leave this nullable; S04 fills it only for imports.
    result: jsonb("result"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "application_commands_pkey",
      columns: [table.householdId, table.commandId],
    }),
    foreignKey({
      name: "application_commands_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    index("application_commands_household_created_at_idx").on(
      table.householdId,
      table.createdAt,
    ),
    check(
      "application_commands_command_id_check",
      sql`char_length(btrim(${table.commandId})) between 1 and 128`,
    ),
    check(
      "application_commands_operation_check",
      sql`char_length(btrim(${table.operation})) between 1 and 128`,
    ),
    // Keep command retries bounded to operations published by S02-S09. New
    // domain writes must add an explicit operation instead of persisting an
    // arbitrary caller-controlled string.
    check(
      "application_commands_operation_allowlist_check",
      sql`${table.operation} in (
        'accounts.create',
        'accounts.update',
        'accounts.archive',
        'categories.create',
        'categories.update',
        'categories.archive',
        'transactions.create.expense',
        'transactions.create.income',
        'transactions.update.manual',
        'transactions.cancel.manual',
        'transactions.import.preview',
        'transactions.import.confirm',
        'transactions.review.update',
        'credit_card.create',
        'credit_card.update',
        'credit_card.archive',
        'credit_card.billing_rule.create',
        'credit_card.billing_rule.update',
        'credit_card.purchase.create',
        'credit_card.purchase.update_metadata',
        'credit_card.purchase.cancel',
        'credit_card.payment.create',
        'recurring_rule.create',
        'recurring_rule.update_future',
        'recurring_rule.end',
        'recurring_occurrence.override',
        'recurring_occurrence.cancel',
        'recurring_occurrence.realize',
        'planned_event.create',
        'planned_event.update',
        'planned_event.cancel',
        'budget.create',
        'budget.update',
        'budget.close',
        'budget.movement.contribution',
        'budget.movement.withdrawal',
        'budget.movement.transfer',
        'budget.movement.correct',
        'budget.allocation.replace',
        'budget.distribution'
      )`,
    ),
  ],
);

export type AccountRecord = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type CategoryRecord = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type ApplicationCommandRecord =
  typeof applicationCommands.$inferSelect;
export type NewApplicationCommand = typeof applicationCommands.$inferInsert;
