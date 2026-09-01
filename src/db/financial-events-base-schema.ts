/**
 * Persistence contract for the S03 financial event fact.
 *
 * This module intentionally contains only the event table.  Account entries
 * live in `financial-events-schema.ts`, which can then attach the optional
 * installment lineage without creating a module cycle with the S06 tables.
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

import { categories } from "./accounts-categories-schema";
import { households } from "./tenancy-schema";

/** Financial facts supported by S03 and the S06 card/payment aggregate. */
export const financialEventKindEnum = pgEnum("financial_event_kind", [
  "EXPENSE",
  "INCOME",
  "REVERSAL",
  "PURCHASE",
  "TRANSFER",
]);

export const financialEventStatusEnum = pgEnum("financial_event_status", [
  "PLANNED",
  "EXPECTED",
  "PENDING",
  "POSTED",
  "CANCELLED",
]);

export const financialEventOriginEnum = pgEnum("financial_event_origin", [
  "MANUAL",
  "SYSTEM",
  "IMPORT",
]);

/** Entries may be expected future obligations or realized posted effects. */
export const accountEntryStatusEnum = pgEnum("account_entry_status", [
  "EXPECTED",
  "POSTED",
]);

export const financialEvents = pgTable(
  "financial_events",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    kind: financialEventKindEnum("kind").notNull(),
    status: financialEventStatusEnum("status").notNull().default("POSTED"),
    origin: financialEventOriginEnum("origin").notNull(),
    amountCents: bigintColumn("amount_cents", { mode: "bigint" }).notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    categoryId: uuid("category_id"),
    reversalOfEventId: uuid("reversal_of_event_id"),
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
      name: "financial_events_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "financial_events_category_household_fkey",
      columns: [table.categoryId, table.householdId],
      foreignColumns: [categories.id, categories.householdId],
    }).onDelete("restrict"),
    // The self-reference includes the tenant key, preventing a reversal from
    // pointing at an event belonging to another household.
    foreignKey({
      name: "financial_events_reversal_of_event_household_fkey",
      columns: [table.reversalOfEventId, table.householdId],
      foreignColumns: [table.id, table.householdId],
    }).onDelete("restrict"),
    // Required by the composite FKs from categories/entries and useful for
    // tenant-safe joins without dropping the household predicate.
    uniqueIndex("financial_events_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    index("financial_events_household_occurred_on_idx").on(
      table.householdId,
      table.occurredOn,
    ),
    index("financial_events_household_category_occurred_on_idx").on(
      table.householdId,
      table.categoryId,
      table.occurredOn,
    ),
    // S05's review listing orders by date and id after scoping by origin. The
    // shorter S03/S04 indexes remain in place for compatibility and queries
    // that do not constrain origin or category.
    index("financial_events_household_origin_occurred_on_id_idx").on(
      table.householdId,
      table.origin,
      table.occurredOn,
      table.id,
    ),
    index("financial_events_household_category_occurred_on_id_idx").on(
      table.householdId,
      table.categoryId,
      table.occurredOn,
      table.id,
    ),
    // At most one effective reversal may exist for an original event. The
    // predicate keeps the nullable relation open for ordinary events.
    uniqueIndex("financial_events_reversal_of_event_uq")
      .on(table.reversalOfEventId)
      .where(sql`${table.reversalOfEventId} is not null`),
    check(
      "financial_events_amount_positive_check",
      sql`${table.amountCents} > 0`,
    ),
    check(
      "financial_events_description_length_check",
      sql`char_length(${table.description}) between 1 and 240`,
    ),
    check(
      "financial_events_description_no_control_check",
      sql`${table.description} !~ '[[:cntrl:]]'`,
    ),
    // A reversal is always a system-posted event tied to an original event;
    // ordinary S03/S06 events use the MANUAL or IMPORT origins.  Keeping the
    // shape check here preserves the original S03 invariants while allowing
    // PURCHASE and TRANSFER facts introduced by S06.
    check(
      "financial_events_reversal_shape_check",
      sql`(
        (${table.kind} = 'REVERSAL'
          and ${table.origin} = 'SYSTEM'
          and ${table.status} = 'POSTED'
          and ${table.reversalOfEventId} is not null)
        or
        (${table.kind} <> 'REVERSAL'
          and ${table.origin}::text in ('MANUAL', 'IMPORT')
          and (${table.origin}::text = 'MANUAL' or ${table.status} = 'POSTED')
          and ${table.reversalOfEventId} is null)
      )`,
    ),
  ],
);

export type FinancialEventRecord = typeof financialEvents.$inferSelect;
export type NewFinancialEvent = typeof financialEvents.$inferInsert;
