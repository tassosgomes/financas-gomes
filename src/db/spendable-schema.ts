/** Persistence contract for effective-dated S08 spendable settings. */
import {
  bigint as bigintColumn,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@/lib/uuidv7";

import { households } from "./tenancy-schema";

/**
 * A setting is a version of the absolute operational buffer for one
 * household. Keeping `effectiveFrom` in the key preserves historical reads
 * when a household changes its buffer for a future date.
 */
export const spendableSettings = pgTable(
  "spendable_settings",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    operationalBufferCents: bigintColumn("operational_buffer_cents", {
      mode: "bigint",
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "spendable_settings_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    // Preserve a tenant key when a setting id is used in a future relation.
    uniqueIndex("spendable_settings_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    uniqueIndex("spendable_settings_household_effective_from_uq").on(
      table.householdId,
      table.effectiveFrom,
    ),
    index("spendable_settings_household_effective_from_idx").on(
      table.householdId,
      table.effectiveFrom,
    ),
    check(
      "spendable_settings_operational_buffer_nonnegative_check",
      sql`${table.operationalBufferCents} >= 0`,
    ),
  ],
);

export type SpendableSettingRecord = typeof spendableSettings.$inferSelect;
export type NewSpendableSetting = typeof spendableSettings.$inferInsert;
