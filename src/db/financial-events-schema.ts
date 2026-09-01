/** Persistence contract for the S03 account ledger and S06 installment link. */
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

import { accounts } from "./accounts-categories-schema";
import { installments } from "./credit-cards-schema";
import {
  accountEntryStatusEnum,
  financialEvents,
} from "./financial-events-base-schema";

export {
  accountEntryStatusEnum,
  financialEventKindEnum,
  financialEventOriginEnum,
  financialEventStatusEnum,
  financialEvents,
} from "./financial-events-base-schema";
export type {
  FinancialEventRecord,
  NewFinancialEvent,
} from "./financial-events-base-schema";

export const accountEntries = pgTable(
  "account_entries",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    financialEventId: uuid("financial_event_id").notNull(),
    // S06 materializes at most one card entry for each installment. Payments
    // and ordinary S03 entries leave this nullable.
    installmentId: uuid("installment_id"),
    accountId: uuid("account_id").notNull(),
    householdId: uuid("household_id").notNull(),
    amountCents: bigintColumn("amount_cents", { mode: "bigint" }).notNull(),
    status: accountEntryStatusEnum("status").notNull().default("POSTED"),
    expectedOn: date("expected_on", { mode: "string" }),
    postedOn: date("posted_on", { mode: "string" }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "account_entries_financial_event_household_fkey",
      columns: [table.financialEventId, table.householdId],
      foreignColumns: [financialEvents.id, financialEvents.householdId],
    }).onDelete("restrict"),
    foreignKey({
      name: "account_entries_account_household_fkey",
      columns: [table.accountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete("restrict"),
    foreignKey({
      name: "account_entries_installment_household_fkey",
      columns: [table.installmentId, table.householdId],
      foreignColumns: [installments.id, installments.householdId],
    }).onDelete("restrict"),
    index("account_entries_household_account_posted_on_idx").on(
      table.householdId,
      table.accountId,
      table.postedOn,
    ),
    index("account_entries_household_event_idx").on(
      table.householdId,
      table.financialEventId,
    ),
    uniqueIndex("account_entries_installment_id_uq")
      .on(table.installmentId)
      .where(sql`${table.installmentId} is not null`),
    check(
      "account_entries_amount_nonzero_check",
      sql`${table.amountCents} <> 0`,
    ),
    // Expected entries are future obligations and cannot enter the realized
    // balance; posted entries carry only their posted date.
    check(
      "account_entries_status_shape_check",
      sql`(
        ${table.status}::text = 'POSTED'
        and ${table.postedOn} is not null
        and ${table.expectedOn} is null
      )
      or (
        ${table.status}::text = 'EXPECTED'
        and ${table.expectedOn} is not null
        and ${table.postedOn} is null
      )`,
    ),
  ],
);

export type AccountEntryRecord = typeof accountEntries.$inferSelect;
export type NewAccountEntry = typeof accountEntries.$inferInsert;
