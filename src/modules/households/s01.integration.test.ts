import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { eq, inArray } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import {
  householdInvites,
  householdMembers,
  households,
  user,
} from "@/db/schema";

import {
  hashHouseholdInviteToken,
  HouseholdProvisioningError,
  provisionFirstAccess,
} from "./server";
import {
  createHouseholdInviteForContext,
  HouseholdInviteError,
} from "./invites";
import {
  cleanupFixture,
  seedFixtureInvite,
  T15_FIXTURES,
  toLocalUserIdentity,
  t15CleanupScope,
} from "@/test/fixtures";

const integration =
  process.env.T15_INTEGRATION === "1" ? describe : describe.skip;

const owner = T15_FIXTURES.users.owner;
const guest = T15_FIXTURES.users.guest;
const secondGuest = T15_FIXTURES.users.secondGuest;
const isolatedOwner = T15_FIXTURES.users.isolatedOwner;
const sharedHouseholdId = T15_FIXTURES.households.shared;
const isolatedHouseholdId = T15_FIXTURES.households.isolated;

const ownerContext = {
  userId: owner.id,
  householdId: sharedHouseholdId,
} as const;

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T15 não foi inicializado.");
  }
  return database;
}

async function seedSharedHousehold(database: Database): Promise<void> {
  await database.insert(user).values({
    id: owner.id,
    name: owner.name,
    email: owner.email,
  });
  await database.insert(households).values({
    id: sharedHouseholdId,
    name: "T15 Shared household",
  });
  await database.insert(householdMembers).values({
    householdId: sharedHouseholdId,
    userId: owner.id,
  });
}

async function seedTwoHouseholds(database: Database): Promise<void> {
  await database.insert(user).values([
    {
      id: owner.id,
      name: owner.name,
      email: owner.email,
    },
    {
      id: isolatedOwner.id,
      name: isolatedOwner.name,
      email: isolatedOwner.email,
    },
  ]);
  await database.insert(households).values([
    { id: sharedHouseholdId, name: "T15 Shared household" },
    { id: isolatedHouseholdId, name: "T15 Isolated household" },
  ]);
  await database.insert(householdMembers).values([
    { householdId: sharedHouseholdId, userId: owner.id },
    { householdId: isolatedHouseholdId, userId: isolatedOwner.id },
  ]);
}

function tokenFromInviteUrl(inviteUrl: string): string {
  const token = new URL(inviteUrl).searchParams.get("token");
  if (!token) {
    throw new Error("O convite de integração não retornou um token.");
  }
  return token;
}

integration("T15 household authentication and tenancy integration", () => {
  let database: Database | undefined;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL antes de executar T15_INTEGRATION=1.",
      );
    }
    database = getDb();
  });

  beforeEach(async () => {
    await cleanupFixture(databaseOrThrow(database), t15CleanupScope());
  });

  afterAll(async () => {
    if (database) {
      await cleanupFixture(database, t15CleanupScope());
    }
    await closeDb();
  });

  it("creates exactly one local user, household and membership on first access", async () => {
    const db = databaseOrThrow(database);
    const result = await provisionFirstAccess({
      user: toLocalUserIdentity(owner),
      householdName: "T15 First access household",
    });

    expect(result.created).toEqual({
      user: true,
      household: true,
      membership: true,
    });
    expect(result.context).toEqual({
      userId: owner.id,
      householdId: result.household.id,
    });

    const users = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, owner.id));
    const memberships = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, owner.id));
    const persistedHousehold = await db
      .select()
      .from(households)
      .where(eq(households.id, result.household.id));

    expect(users).toHaveLength(1);
    expect(memberships).toHaveLength(1);
    expect(persistedHousehold).toHaveLength(1);
  });

  it("is idempotent when first access is repeated", async () => {
    const db = databaseOrThrow(database);
    const command = {
      user: toLocalUserIdentity(owner),
      householdName: "T15 Idempotent household",
    };

    const first = await provisionFirstAccess(command);
    const second = await provisionFirstAccess(command);

    expect(first.created).toEqual({
      user: true,
      household: true,
      membership: true,
    });
    expect(second.created).toEqual({
      user: false,
      household: false,
      membership: false,
    });
    expect(second.context).toEqual(first.context);

    const memberships = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, owner.id));
    expect(memberships).toHaveLength(1);
  });

  it("serializes concurrent first access calls for one user", async () => {
    const db = databaseOrThrow(database);
    const command = {
      user: toLocalUserIdentity(owner),
      householdName: "T15 Concurrent household",
    };

    const results = await Promise.all([
      provisionFirstAccess(command),
      provisionFirstAccess(command),
    ]);

    expect(new Set(results.map(({ household }) => household.id)).size).toBe(1);
    expect(
      results.filter(({ created }) => created.household).length,
    ).toBe(1);

    const memberships = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, owner.id));
    expect(memberships).toHaveLength(1);
  });

  it("associates two authenticated users with one household via a valid invite", async () => {
    const db = databaseOrThrow(database);
    await seedSharedHousehold(db);
    const now = new Date("2026-08-29T12:00:00.000Z");

    const invitation = await createHouseholdInviteForContext({
      context: ownerContext,
      baseUrl: "https://financas.example.test",
      expiresInSeconds: 3_600,
      now,
    });
    const token = tokenFromInviteUrl(invitation.inviteUrl);
    const storedInvite = await db
      .select()
      .from(householdInvites)
      .where(eq(householdInvites.id, invitation.id));

    expect(storedInvite).toHaveLength(1);
    expect(storedInvite[0]?.tokenHash).toBe(hashHouseholdInviteToken(token));
    expect(storedInvite[0]?.tokenHash).not.toBe(token);

    const accepted = await provisionFirstAccess({
      user: toLocalUserIdentity(guest),
      inviteToken: token,
      now,
    });

    expect(accepted.invitationAccepted).toBe(true);
    expect(accepted.created.household).toBe(false);
    expect(accepted.created.membership).toBe(true);
    expect(accepted.context).toEqual({
      userId: guest.id,
      householdId: sharedHouseholdId,
    });

    const members = await db
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, sharedHouseholdId));
    const householdsForGuest = await db
      .select({ id: households.id })
      .from(householdMembers)
      .innerJoin(households, eq(householdMembers.householdId, households.id))
      .where(eq(householdMembers.userId, guest.id));

    expect(members.map(({ userId }) => userId).sort()).toEqual(
      [owner.id, guest.id].sort(),
    );
    expect(householdsForGuest).toEqual([{ id: sharedHouseholdId }]);
  });

  it("accepts an invite only once", async () => {
    const db = databaseOrThrow(database);
    await seedSharedHousehold(db);
    const now = new Date("2026-08-29T12:00:00.000Z");
    const token = await seedFixtureInvite(db, "valid");

    await provisionFirstAccess({
      user: toLocalUserIdentity(guest),
      inviteToken: token,
      now,
    });

    await expect(
      provisionFirstAccess({
        user: toLocalUserIdentity(secondGuest),
        inviteToken: token,
        now,
      }),
    ).rejects.toMatchObject({
      code: "INVITATION_ALREADY_USED",
    } satisfies Partial<HouseholdProvisioningError>);

    const secondGuestRows = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, secondGuest.id));
    expect(secondGuestRows).toHaveLength(0);
  });

  it("rejects expired and invalid invites without creating a membership", async () => {
    const db = databaseOrThrow(database);
    await seedSharedHousehold(db);
    const now = new Date("2026-08-29T12:00:00.000Z");
    const expiredToken = await seedFixtureInvite(db, "expired");

    await expect(
      provisionFirstAccess({
        user: toLocalUserIdentity(guest),
        inviteToken: expiredToken,
        now,
      }),
    ).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });

    await expect(
      provisionFirstAccess({
        user: toLocalUserIdentity(secondGuest),
        inviteToken: "definitely-not-a-real-token",
        now,
      }),
    ).rejects.toMatchObject({ code: "INVITATION_INVALID" });

    const memberships = await db
      .select()
      .from(householdMembers)
      .where(
        inArray(householdMembers.userId, [guest.id, secondGuest.id]),
      );
    expect(memberships).toHaveLength(0);
  });

  it("rejects cross-tenant invite creation and the corresponding FK violation", async () => {
    const db = databaseOrThrow(database);
    await seedTwoHouseholds(db);

    await expect(
      createHouseholdInviteForContext({
        context: {
          userId: isolatedOwner.id,
          householdId: sharedHouseholdId,
        },
        baseUrl: "https://financas.example.test",
      }),
    ).rejects.toMatchObject({
      code: "HOUSEHOLD_MEMBERSHIP_REQUIRED",
    } satisfies Partial<HouseholdInviteError>);

    let caught: unknown;
    try {
      await db.insert(householdInvites).values({
        id: "00000000-0000-7000-8000-000000004199",
        householdId: sharedHouseholdId,
        tokenHash: hashHouseholdInviteToken("t15-cross-tenant-token"),
        expiresAt: new Date("2026-09-01T12:00:00.000Z"),
        createdBy: isolatedOwner.id,
      });
    } catch (error) {
      caught = error;
      const code = (error as { cause?: { code?: string }; code?: string })
        .cause?.code ?? (error as { code?: string }).code;
      expect(code).toBe("23503");
    }
    expect(caught).toBeInstanceOf(Error);
  });
});
