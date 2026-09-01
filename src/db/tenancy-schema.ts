import {
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { generateUuidV7 } from "@/lib/uuidv7";

import { betterAuthUser as user } from "@/modules/auth/schema";

/** Root tenant for all shared financial data. */
export const households = pgTable("households", {
  id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** N:N relationship between Better Auth users and financial households. */
export const householdMembers = pgTable(
  "household_members",
  {
    householdId: uuid("household_id").notNull(),
    userId: uuid("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "household_members_pkey",
      columns: [table.householdId, table.userId],
    }),
    foreignKey({
      name: "household_members_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "household_members_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [user.id],
    }).onDelete("cascade"),
    index("household_members_user_id_idx").on(table.userId),
  ],
);

/**
 * Copyable invitations. Only a digest of the bearer token is persisted.
 *
 * The composite creator FK is intentional: an invite creator must be a
 * member of the household named by the same row, not merely an existing
 * Better Auth user.
 */
export const householdInvites = pgTable(
  "household_invites",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "household_invites_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "household_invites_created_by_fkey",
      columns: [table.createdBy],
      foreignColumns: [user.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "household_invites_creator_member_fkey",
      columns: [table.householdId, table.createdBy],
      foreignColumns: [householdMembers.householdId, householdMembers.userId],
    }).onDelete("cascade"),
    uniqueIndex("household_invites_token_hash_uq").on(table.tokenHash),
    index("household_invites_household_id_idx").on(table.householdId),
    index("household_invites_token_hash_expires_at_idx").on(
      table.tokenHash,
      table.expiresAt,
    ),
    index("household_invites_expires_at_idx").on(table.expiresAt),
  ],
);

/**
 * Small tenant-owned resource used to prove the access convention before a
 * financial aggregate exists. It is deliberately domain-neutral: future
 * slices can use the same repository shape without introducing the Ledger.
 *
 * `createdBy` is tied to `householdId` with a composite FK. This means a row
 * carrying a member from household A can never be inserted with household B,
 * even if an application caller tampers with both values.
 */
export const protectedResources = pgTable(
  "protected_resources",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    householdId: uuid("household_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "protected_resources_household_id_fkey",
      columns: [table.householdId],
      foreignColumns: [households.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "protected_resources_created_by_fkey",
      columns: [table.createdBy],
      foreignColumns: [user.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "protected_resources_creator_member_fkey",
      columns: [table.householdId, table.createdBy],
      foreignColumns: [householdMembers.householdId, householdMembers.userId],
    }).onDelete("cascade"),
    // Allows later domain tables to reference (resource, household) safely.
    uniqueIndex("protected_resources_id_household_id_uq").on(
      table.id,
      table.householdId,
    ),
    index("protected_resources_household_id_idx").on(table.householdId),
    index("protected_resources_household_id_created_at_idx").on(
      table.householdId,
      table.createdAt,
    ),
  ],
);

export type HouseholdRecord = typeof households.$inferSelect;
export type NewHousehold = typeof households.$inferInsert;
export type HouseholdMemberRecord = typeof householdMembers.$inferSelect;
export type NewHouseholdMember = typeof householdMembers.$inferInsert;
export type HouseholdInviteRecord = typeof householdInvites.$inferSelect;
export type NewHouseholdInvite = typeof householdInvites.$inferInsert;
export type ProtectedResourceRecord = typeof protectedResources.$inferSelect;
export type NewProtectedResource = typeof protectedResources.$inferInsert;
