import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { generateUuidV7 } from "@/lib/uuidv7";

/**
 * Better Auth's PostgreSQL contract, isolated so T05 can compose it with the
 * tenancy schema and generate one forward-only migration. IDs remain UUID
 * columns while the auth callback supplies UUIDv7 values before INSERT.
 */
export const betterAuthUser = pgTable(
  "user",
  {
    id: uuid("id").$defaultFn(generateUuidV7).primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    emailUnique: uniqueIndex("better_auth_user_email_unique").on(table.email),
  }),
);

export const betterAuthSession = pgTable(
  "session",
  {
    id: uuid("id").$defaultFn(generateUuidV7).primaryKey(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => betterAuthUser.id, { onDelete: "cascade" }),
  },
  (table) => ({
    tokenUnique: uniqueIndex("better_auth_session_token_unique").on(
      table.token,
    ),
    userIndex: index("better_auth_session_user_id_idx").on(table.userId),
  }),
);

export const betterAuthAccount = pgTable(
  "account",
  {
    id: uuid("id").$defaultFn(generateUuidV7).primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => betterAuthUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    // Required by Better Auth's core schema, unused while password auth is off.
    password: text("password"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    issuerAccountUnique: uniqueIndex(
      "better_auth_account_issuer_account_id_unique",
    ).on(table.issuer, table.accountId),
    userIndex: index("better_auth_account_user_id_idx").on(table.userId),
  }),
);

export const betterAuthVerification = pgTable(
  "verification",
  {
    id: uuid("id").$defaultFn(generateUuidV7).primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    identifierIndex: index("better_auth_verification_identifier_idx").on(
      table.identifier,
    ),
  }),
);

/** Adapter keys intentionally match Better Auth's singular model names. */
export const betterAuthSchema = {
  user: betterAuthUser,
  session: betterAuthSession,
  account: betterAuthAccount,
  verification: betterAuthVerification,
} as const;

/** Alias consumed by Drizzle composition in T05. */
export const authSchema = betterAuthSchema;

// Familiar names make the isolated schema easy to merge into src/db/schema.ts.
export const user = betterAuthUser;
export const session = betterAuthSession;
export const account = betterAuthAccount;
export const verification = betterAuthVerification;

export type BetterAuthUser = typeof betterAuthUser.$inferSelect;
export type BetterAuthSession = typeof betterAuthSession.$inferSelect;
export type BetterAuthAccount = typeof betterAuthAccount.$inferSelect;
export type BetterAuthVerification =
  typeof betterAuthVerification.$inferSelect;
