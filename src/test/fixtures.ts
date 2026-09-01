import { createHash } from "node:crypto";

import {
  account,
  householdInvites,
  householdMembers,
  households,
  protectedResources,
  session,
  user,
} from "@/db/schema";
import type { Database } from "@/db";
import type { LocalUserIdentity } from "@/modules/auth/contracts";
import {
  inArray,
  like,
  or,
  type SQL,
} from "drizzle-orm";

/**
 * Fixed UUIDs keep integration fixtures reproducible and make a failed run
 * safe to clean up on the next invocation. Every test suite should use its
 * own numeric suffix range so suites can run against the same database.
 */
export const T15_FIXTURES = {
  users: {
    owner: {
      id: "00000000-0000-7000-8000-000000003101",
      name: "T15 Owner",
      email: "t15-owner@example.test",
    },
    guest: {
      id: "00000000-0000-7000-8000-000000003102",
      name: "T15 Guest",
      email: "t15-guest@example.test",
    },
    secondGuest: {
      id: "00000000-0000-7000-8000-000000003103",
      name: "T15 Second Guest",
      email: "t15-second-guest@example.test",
    },
    isolatedOwner: {
      id: "00000000-0000-7000-8000-000000003104",
      name: "T15 Isolated Owner",
      email: "t15-isolated-owner@example.test",
    },
  },
  households: {
    shared: "00000000-0000-7000-8000-000000004101",
    isolated: "00000000-0000-7000-8000-000000004102",
    rollbackCollision: "00000000-0000-7000-8000-000000004103",
  },
  invites: {
    valid: {
      id: "00000000-0000-7000-8000-000000005101",
      token: "t15-valid-fixture-invite-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
      usedAt: null,
    },
    expired: {
      id: "00000000-0000-7000-8000-000000005102",
      token: "t15-expired-fixture-invite-token",
      expiresAt: "2026-08-29T11:59:59.000Z",
      usedAt: null,
    },
    used: {
      id: "00000000-0000-7000-8000-000000005103",
      token: "t15-used-fixture-invite-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
      usedAt: "2026-08-29T12:00:00.000Z",
    },
  },
} as const;

export type FixtureUser = (typeof T15_FIXTURES.users)[keyof typeof T15_FIXTURES.users];
export type FixtureInvite =
  (typeof T15_FIXTURES.invites)[keyof typeof T15_FIXTURES.invites];

export const T15_FIXTURE_MEMBERSHIPS = {
  ownerShared: {
    householdId: T15_FIXTURES.households.shared,
    userId: T15_FIXTURES.users.owner.id,
  },
  isolatedOwner: {
    householdId: T15_FIXTURES.households.isolated,
    userId: T15_FIXTURES.users.isolatedOwner.id,
  },
} as const;

export function toLocalUserIdentity(fixture: FixtureUser): LocalUserIdentity {
  return {
    id: fixture.id,
    email: fixture.email,
    name: fixture.name,
    image: null,
  };
}

/** Stable SHA-256 digest used by deterministic invite fixtures. */
export function hashFixtureInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Inserts a deterministic invite row after its household/member fixture. */
export async function seedFixtureInvite(
  database: Database,
  kind: keyof typeof T15_FIXTURES.invites,
  overrides: {
    householdId?: string;
    createdBy?: string;
    expiresAt?: Date;
    usedAt?: Date | null;
  } = {},
): Promise<string> {
  const fixture: FixtureInvite = T15_FIXTURES.invites[kind];

  await database.insert(householdInvites).values({
    id: fixture.id,
    householdId: overrides.householdId ?? T15_FIXTURES.households.shared,
    tokenHash: hashFixtureInviteToken(fixture.token),
    expiresAt: overrides.expiresAt ?? new Date(fixture.expiresAt),
    usedAt:
      overrides.usedAt ??
      (fixture.usedAt ? new Date(fixture.usedAt) : null),
    createdBy: overrides.createdBy ?? T15_FIXTURES.users.owner.id,
  });

  return fixture.token;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function combine(
  conditions: Array<SQL<unknown> | undefined>,
): SQL<unknown> | undefined {
  const present = conditions.filter(
    (condition): condition is SQL<unknown> => condition !== undefined,
  );

  if (present.length === 0) {
    return undefined;
  }

  return present.length === 1 ? present[0] : or(...present);
}

export interface FixtureCleanupScope {
  userIds?: readonly string[];
  userEmails?: readonly string[];
  householdIds?: readonly string[];
  householdNamePrefix?: string;
}

/**
 * Removes only rows owned by the supplied fixture scope. It first discovers
 * household IDs through memberships/name prefixes so generated first-access
 * household IDs are also cleaned after a test failure.
 */
export async function cleanupFixture(
  database: Database,
  scope: FixtureCleanupScope,
): Promise<void> {
  const userIds = unique(scope.userIds ?? []);
  const userEmails = unique(scope.userEmails ?? []);
  const explicitHouseholdIds = unique(scope.householdIds ?? []);

  const membershipScope = combine([
    userIds.length > 0
      ? inArray(householdMembers.userId, userIds)
      : undefined,
    explicitHouseholdIds.length > 0
      ? inArray(householdMembers.householdId, explicitHouseholdIds)
      : undefined,
  ]);
  const relatedMemberships = membershipScope
    ? await database
        .select({ householdId: householdMembers.householdId })
        .from(householdMembers)
        .where(membershipScope)
    : [];

  const namedHouseholds = scope.householdNamePrefix
    ? await database
        .select({ id: households.id })
        .from(households)
        .where(like(households.name, `${scope.householdNamePrefix}%`))
    : [];

  const householdIds = unique([
    ...explicitHouseholdIds,
    ...relatedMemberships.map(({ householdId }) => householdId),
    ...namedHouseholds.map(({ id }) => id),
  ]);

  const resourceScope = combine([
    householdIds.length > 0
      ? inArray(protectedResources.householdId, householdIds)
      : undefined,
    userIds.length > 0
      ? inArray(protectedResources.createdBy, userIds)
      : undefined,
  ]);
  if (resourceScope) {
    await database.delete(protectedResources).where(resourceScope);
  }

  const inviteScope = combine([
    householdIds.length > 0
      ? inArray(householdInvites.householdId, householdIds)
      : undefined,
    userIds.length > 0
      ? inArray(householdInvites.createdBy, userIds)
      : undefined,
  ]);
  if (inviteScope) {
    await database.delete(householdInvites).where(inviteScope);
  }

  const memberDeleteScope = combine([
    householdIds.length > 0
      ? inArray(householdMembers.householdId, householdIds)
      : undefined,
    userIds.length > 0 ? inArray(householdMembers.userId, userIds) : undefined,
  ]);
  if (memberDeleteScope) {
    await database.delete(householdMembers).where(memberDeleteScope);
  }

  if (householdIds.length > 0) {
    await database.delete(households).where(inArray(households.id, householdIds));
  }

  const authUserScope = combine([
    userIds.length > 0 ? inArray(account.userId, userIds) : undefined,
  ]);
  if (authUserScope) {
    await database.delete(account).where(authUserScope);
    await database.delete(session).where(inArray(session.userId, userIds));
  }

  const userDeleteScope = combine([
    userIds.length > 0 ? inArray(user.id, userIds) : undefined,
    userEmails.length > 0 ? inArray(user.email, userEmails) : undefined,
  ]);
  if (userDeleteScope) {
    await database.delete(user).where(userDeleteScope);
  }
}

/** Scope covering all fixed T15 rows, including generated household names. */
export function t15CleanupScope(): FixtureCleanupScope {
  const users = Object.values(T15_FIXTURES.users);
  return {
    userIds: users.map(({ id }) => id),
    userEmails: users.map(({ email }) => email),
    householdIds: Object.values(T15_FIXTURES.households),
    householdNamePrefix: "T15 ",
  };
}
