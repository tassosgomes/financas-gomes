import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { requireAuthMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
}));

vi.mock("@/modules/auth/server", () => ({
  AuthGuardError: class AuthGuardError extends Error {
    readonly code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  getServerSession: vi.fn(),
  requireAuth: requireAuthMock,
  toLocalUserIdentity: (user: {
    id: string;
    email: string;
    name?: string | null;
    image?: string | null;
  }) => ({
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    image: user.image ?? null,
  }),
}));

import { closeDb, getDb, type Database } from "@/db";
import { households, householdMembers, user } from "@/db/schema";
import {
  cleanupFixture,
  T15_FIXTURES,
  toLocalUserIdentity,
  t15CleanupScope,
} from "@/test/fixtures";

import {
  acceptHouseholdInvite,
  createHouseholdInviteForContext,
} from "./server";

const integration =
  process.env.T15_INTEGRATION === "1" ? describe : describe.skip;

const owner = T15_FIXTURES.users.owner;
const guest = T15_FIXTURES.users.guest;
const sharedHouseholdId = T15_FIXTURES.households.shared;
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

function tokenFromInviteUrl(inviteUrl: string): string {
  const token = new URL(inviteUrl).searchParams.get("token");
  if (!token) {
    throw new Error("O convite de integração não retornou um token.");
  }
  return token;
}

integration("T15 invite acceptance entrypoint", () => {
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
    const db = databaseOrThrow(database);
    await cleanupFixture(db, t15CleanupScope());
    await seedSharedHousehold(db);
    requireAuthMock.mockResolvedValue({
      id: "t15-session",
      userId: guest.id,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      user: toLocalUserIdentity(guest),
    });
  });

  afterAll(async () => {
    if (database) {
      await cleanupFixture(database, t15CleanupScope());
    }
    await closeDb();
  });

  it("accepts a valid invite through the authenticated server entrypoint", async () => {
    const now = new Date("2026-08-29T12:00:00.000Z");
    const invitation = await createHouseholdInviteForContext({
      context: ownerContext,
      baseUrl: "https://financas.example.test",
      now,
    });

    const accepted = await acceptHouseholdInvite({
      token: tokenFromInviteUrl(invitation.inviteUrl),
      requestHeaders: { cookie: "better-auth.session_token=t15-session" },
      now,
    });

    expect(accepted).toMatchObject({
      accepted: true,
      householdId: sharedHouseholdId,
      membershipCreated: true,
      context: { userId: guest.id, householdId: sharedHouseholdId },
    });
    expect(requireAuthMock).toHaveBeenCalledWith({
      cookie: "better-auth.session_token=t15-session",
    });
  });
});
