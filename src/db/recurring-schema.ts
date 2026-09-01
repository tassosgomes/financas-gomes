/**
 * Persistence primitives for S07 recurring commitments and planned events.
 *
 * The forecast is deliberately derived at read time.  These tables retain
 * only the rule, explicit exceptions and explicit planned events that are
 * needed to build that derivation; no balance, timeline or generated normal
 * occurrence is stored here.
 *
 * Every relationship carries `household_id` as part of its foreign key.  A
 * UUID copied from another household therefore cannot be attached to a
 * local rule, occurrence, event or account by accident or by a forged
 * application payload.
 */
import {
  bigint as bigintColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
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
  accounts,
  categories,
} from "./accounts-categories-schema";
import { financialEvents, financialEventKindEnum } from "./financial-events-base-schema";
import { households } from "./tenancy-schema";

/** Frequencies intentionally limited to the V1 S07 contract. */
export const recurringFrequencyEnum = pgEnum("recurring_frequency", [
  "MONTHLY",
  "YEARLY",
]);

/** Civil-day rules supported by the V1 business calendar. */
export const recurringDayRuleEnum = pgEnum("recurring_day_rule", [
  "FIXED_DAY",
  "FIRST_BUSINESS_DAY",
  "LAST_BUSINESS_DAY",
]);

/** A persisted exception is either projected, realized or explicitly canceled. */
export const recurringOccurrenceStatusEnum = pgEnum(
  "recurring_occurrence_status",
  ["PLANNED", "EXPECTED", "POSTED", "CANCELLED"],
);

/** Explicit planned events share the public S07 source states. */
export const plannedEventStatusEnum = pgEnum("planned_event_status", [
  "PLANNED",
  "EXPECTED",
  "POSTED",
  "CANCELLED",
]);

/**
 * A monthly or yearly commitment rule.  `start_on`/`end_on` are inclusive
 * civil-date bounds.  Ordinary occurrences are virtual; rows in
 * `recurring_occurrences` exist only when an exception or realization must be
 * retained.
 */
export const recurringRules = pgTable(
  "recurring_rules",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    /** Optional account projection target; household forecast does not require it. */
    accountId: uuid("account_id"),
    categoryId: uuid("category_id"),
    /** Only EXPENSE and INCOME are valid recurring economic directions. */
    kind: financialEventKindEnum("kind").notNull(),
    amountCents: bigintColumn("amount_cents", { mode: "bigint" }).notNull(),
    description: text("description").notNull(),
    frequency: recurringFrequencyEnum("frequency").notNull(),
    dayRule: recurringDayRuleEnum("day_rule").notNull(),
    /** Required only for FIXED_DAY; business-day rules derive their date. */
    dayOfMonth: integer("day_of_month"),
    startOn: date("start_on", { mode: "string" }).notNull(),
    endOn: date("end_on", { mode: "string" }),
    includeInConservativeForecast: boolean("include_in_conservative_forecast")
      .notNull()
      .default(true),
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
      name: "recurring_rules_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "recurring_rules_account_household_fkey",
      columns: [table.accountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete("restrict"),
    foreignKey({
      name: "recurring_rules_category_household_fkey",
      columns: [table.categoryId, table.householdId],
      foreignColumns: [categories.id, categories.householdId],
    }).onDelete("restrict"),
    // Child rows reference this key so they retain their tenant predicate.
    uniqueIndex("recurring_rules_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    index("recurring_rules_household_active_window_idx").on(
      table.householdId,
      table.startOn,
      table.endOn,
    ),
    index("recurring_rules_household_frequency_start_idx").on(
      table.householdId,
      table.frequency,
      table.startOn,
    ),
    index("recurring_rules_household_kind_idx").on(
      table.householdId,
      table.kind,
    ),
    check(
      "recurring_rules_kind_check",
      sql`${table.kind} in ('EXPENSE', 'INCOME')`,
    ),
    check(
      "recurring_rules_amount_positive_check",
      sql`${table.amountCents} > 0`,
    ),
    check(
      "recurring_rules_description_length_check",
      sql`char_length(${table.description}) between 1 and 240`,
    ),
    check(
      "recurring_rules_description_no_control_check",
      sql`${table.description} !~ '[[:cntrl:]]'`,
    ),
    check(
      "recurring_rules_effective_interval_check",
      sql`${table.endOn} is null or ${table.endOn} >= ${table.startOn}`,
    ),
    check(
      "recurring_rules_day_rule_shape_check",
      sql`(
        (${table.dayRule} = 'FIXED_DAY'
          and ${table.dayOfMonth} between 1 and 31)
        or
        (${table.dayRule} <> 'FIXED_DAY'
          and ${table.dayOfMonth} is null)
      )`,
    ),
  ],
);

/**
 * A durable exception for one virtual occurrence.  A missing row means the
 * normal rule is used.  `amount_cents` and `expected_on` are nullable
 * overrides; they never replace the rule's canonical amount/date in history.
 */
export const recurringOccurrences = pgTable(
  "recurring_occurrences",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    recurringRuleId: uuid("recurring_rule_id").notNull(),
    /** YYYY-MM for MONTHLY and YYYY for YEARLY; uniqueness is the identity. */
    occurrenceKey: text("occurrence_key").notNull(),
    status: recurringOccurrenceStatusEnum("status")
      .notNull()
      .default("PLANNED"),
    amountCents: bigintColumn("amount_cents", { mode: "bigint" }),
    expectedOn: date("expected_on", { mode: "string" }),
    /** A POSTED occurrence must point at the canonical S03 fact. */
    financialEventId: uuid("financial_event_id"),
    /** Partial realization is explicit; never inferred from dates or balances. */
    isPartial: boolean("is_partial").notNull().default(false),
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
      name: "recurring_occurrences_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "recurring_occurrences_rule_household_fkey",
      columns: [table.recurringRuleId, table.householdId],
      foreignColumns: [recurringRules.id, recurringRules.householdId],
    }).onDelete("restrict"),
    foreignKey({
      name: "recurring_occurrences_event_household_fkey",
      columns: [table.financialEventId, table.householdId],
      foreignColumns: [financialEvents.id, financialEvents.householdId],
    }).onDelete("restrict"),
    uniqueIndex("recurring_occurrences_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    // This is the reconciliation key; it also makes override + realization
    // collision impossible because both are represented by the same row.
    uniqueIndex("recurring_occurrences_rule_key_uq").on(
      table.recurringRuleId,
      table.occurrenceKey,
    ),
    // A posted fact may realize only one occurrence in this household.
    uniqueIndex("recurring_occurrences_financial_event_id_uq")
      .on(table.financialEventId)
      .where(sql`${table.financialEventId} is not null`),
    index("recurring_occurrences_household_expected_on_idx").on(
      table.householdId,
      table.expectedOn,
    ),
    index("recurring_occurrences_household_status_expected_on_idx").on(
      table.householdId,
      table.status,
      table.expectedOn,
    ),
    index("recurring_occurrences_household_rule_key_idx").on(
      table.householdId,
      table.recurringRuleId,
      table.occurrenceKey,
    ),
    check(
      "recurring_occurrences_key_format_check",
      sql`${table.occurrenceKey} ~ '^[0-9]{4}(-((0[1-9])|(1[0-2])))?$'`,
    ),
    check(
      "recurring_occurrences_amount_positive_check",
      sql`${table.amountCents} is null or ${table.amountCents} > 0`,
    ),
    check(
      "recurring_occurrences_status_shape_check",
      sql`(
        ${table.status}::text = 'POSTED'
        and ${table.financialEventId} is not null
      )
      or (
        ${table.status}::text <> 'POSTED'
        and ${table.financialEventId} is null
        and ${table.isPartial} = false
      )`,
    ),
  ],
);

/** Manually managed household business-calendar exceptions. */
export const holidays = pgTable(
  "holidays",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    name: text("name").notNull(),
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
      name: "holidays_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    uniqueIndex("holidays_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    uniqueIndex("holidays_household_date_uq").on(
      table.householdId,
      table.date,
    ),
    index("holidays_household_date_idx").on(table.householdId, table.date),
    check(
      "holidays_name_length_check",
      sql`char_length(${table.name}) between 1 and 240`,
    ),
    check(
      "holidays_name_no_control_check",
      sql`${table.name} !~ '[[:cntrl:]]'`,
    ),
  ],
);

/**
 * A one-off commitment/exception that is not generated by a recurring rule.
 * Its optional event link reconciles a POSTED fact without creating another
 * FinancialEvent or AccountEntry.
 */
export const plannedEvents = pgTable(
  "planned_events",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    accountId: uuid("account_id"),
    categoryId: uuid("category_id"),
    kind: financialEventKindEnum("kind").notNull(),
    status: plannedEventStatusEnum("status").notNull().default("PLANNED"),
    amountCents: bigintColumn("amount_cents", { mode: "bigint" }).notNull(),
    expectedOn: date("expected_on", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    includeInConservativeForecast: boolean("include_in_conservative_forecast")
      .notNull()
      .default(true),
    financialEventId: uuid("financial_event_id"),
    isPartial: boolean("is_partial").notNull().default(false),
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
      name: "planned_events_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "planned_events_account_household_fkey",
      columns: [table.accountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete("restrict"),
    foreignKey({
      name: "planned_events_category_household_fkey",
      columns: [table.categoryId, table.householdId],
      foreignColumns: [categories.id, categories.householdId],
    }).onDelete("restrict"),
    foreignKey({
      name: "planned_events_event_household_fkey",
      columns: [table.financialEventId, table.householdId],
      foreignColumns: [financialEvents.id, financialEvents.householdId],
    }).onDelete("restrict"),
    uniqueIndex("planned_events_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    uniqueIndex("planned_events_financial_event_id_uq")
      .on(table.financialEventId)
      .where(sql`${table.financialEventId} is not null`),
    index("planned_events_household_expected_on_idx").on(
      table.householdId,
      table.expectedOn,
    ),
    index("planned_events_household_status_expected_on_idx").on(
      table.householdId,
      table.status,
      table.expectedOn,
    ),
    index("planned_events_household_kind_expected_on_idx").on(
      table.householdId,
      table.kind,
      table.expectedOn,
    ),
    check(
      "planned_events_kind_check",
      sql`${table.kind} in ('EXPENSE', 'INCOME')`,
    ),
    check(
      "planned_events_amount_positive_check",
      sql`${table.amountCents} > 0`,
    ),
    check(
      "planned_events_description_length_check",
      sql`char_length(${table.description}) between 1 and 240`,
    ),
    check(
      "planned_events_description_no_control_check",
      sql`${table.description} !~ '[[:cntrl:]]'`,
    ),
    check(
      "planned_events_status_shape_check",
      sql`(
        ${table.status}::text = 'POSTED'
        and ${table.financialEventId} is not null
      )
      or (
        ${table.status}::text <> 'POSTED'
        and ${table.financialEventId} is null
        and ${table.isPartial} = false
      )`,
    ),
  ],
);

export type RecurringRuleRecord = typeof recurringRules.$inferSelect;
export type NewRecurringRule = typeof recurringRules.$inferInsert;
export type RecurringOccurrenceRecord =
  typeof recurringOccurrences.$inferSelect;
export type NewRecurringOccurrence = typeof recurringOccurrences.$inferInsert;
export type HolidayRecord = typeof holidays.$inferSelect;
export type NewHoliday = typeof holidays.$inferInsert;
export type PlannedEventRecord = typeof plannedEvents.$inferSelect;
export type NewPlannedEvent = typeof plannedEvents.$inferInsert;

