import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";

const { generateUuidV7Mock } = vi.hoisted(() => ({
  generateUuidV7Mock: vi.fn(),
}));

vi.mock("@/lib/uuidv7", async () => {
  const actual = await vi.importActual<typeof import("@/lib/uuidv7")>(
    "@/lib/uuidv7",
  );
  return { ...actual, generateUuidV7: generateUuidV7Mock };
});

import { closeDb, getDb, type Database } from "@/db";
import { households, householdMembers, user } from "@/db/schema";
import { cleanupFixture, T15_FIXTURES, toLocalUserIdentity, t15CleanupScope } from "@/test/fixtures";

import {
  HouseholdProvisioningError,
  provisionFirstAccess,
} from "./server";

const integration =
  process.env.T15_INTEGRATION === "1" ? describe : describe.skip;

const collisionHouseholdId = T15_FIXTURES.households.rollbackCollision;
const attemptedUser = T15_FIXTURES.users.owner;

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T15 não foi inicializado.");
  }
  return database;
}

integration("T15 provisioning transaction rollback", () => {
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
    await db.insert(households).values({
      id: collisionHouseholdId,
      name: "T15 Rollback collision",
    });
    generateUuidV7Mock.mockReturnValue(collisionHouseholdId);
  });

  afterAll(async () => {
    if (database) {
      await cleanupFixture(database, t15CleanupScope());
    }
    await closeDb();
  });

  it("rolls back a user inserted before a later household constraint failure", async () => {
    const db = databaseOrThrow(database);

    await expect(
      provisionFirstAccess({
        user: toLocalUserIdentity(attemptedUser),
        householdName: "T15 should roll back",
      }),
    ).rejects.toMatchObject({
      code: "PROVISIONING_FAILED",
    } satisfies Partial<HouseholdProvisioningError>);

    const persistedUser = await db
      .select()
      .from(user)
      .where(eq(user.id, attemptedUser.id));
    const persistedMemberships = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, attemptedUser.id));
    const collisionHousehold = await db
      .select()
      .from(households)
      .where(eq(households.id, collisionHouseholdId));

    expect(persistedUser).toHaveLength(0);
    expect(persistedMemberships).toHaveLength(0);
    expect(collisionHousehold).toHaveLength(1);
    expect(generateUuidV7Mock).toHaveBeenCalled();
  });
});
