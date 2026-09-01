import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { requireFinancialContextMock } = vi.hoisted(() => ({
  requireFinancialContextMock: vi.fn(),
}));

vi.mock("./context", () => ({
  requireFinancialContext: requireFinancialContextMock,
}));

import { closeDb, getDb, type Database } from "@/db";
import {
  protectedResources,
  user,
  householdMembers,
  households,
} from "@/db/schema";
import { generateUuidV7 } from "@/lib/uuidv7";

import {
  createProtectedResourceRepository,
  ProtectedResourceError,
} from "./protected-resource";

const shouldRun = process.env.T08_INTEGRATION === "1";
const integration = shouldRun ? describe : describe.skip;

const contextA = {
  userId: "00000000-0000-7000-8000-0000000000a1",
  householdId: "00000000-0000-7000-8000-0000000000b1",
} as const;
const contextB = {
  userId: "00000000-0000-7000-8000-0000000000a2",
  householdId: "00000000-0000-7000-8000-0000000000b2",
} as const;

integration("protected resource tenant isolation", () => {
  let database: Database | undefined;
  let repository: ReturnType<typeof createProtectedResourceRepository>;

  beforeAll(async () => {
    database = getDb();
    repository = createProtectedResourceRepository(database);
    const db = database;

    // Make reruns safe even when a previous assertion stopped before cleanup.
    await db
      .delete(households)
      .where(
        inArray(households.id, [
          contextA.householdId,
          contextB.householdId,
        ]),
      );
    await db
      .delete(user)
      .where(inArray(user.id, [contextA.userId, contextB.userId]));

    await db.insert(user).values([
      {
        id: contextA.userId,
        name: "User A",
        email: "t08-user-a@example.test",
      },
      {
        id: contextB.userId,
        name: "User B",
        email: "t08-user-b@example.test",
      },
    ]);
    await db.insert(households).values([
      { id: contextA.householdId, name: "Household A" },
      { id: contextB.householdId, name: "Household B" },
    ]);
    await db.insert(householdMembers).values([
      { householdId: contextA.householdId, userId: contextA.userId },
      { householdId: contextB.householdId, userId: contextB.userId },
    ]);
  });

  afterAll(async () => {
    if (!database) {
      return;
    }
    const db = database;

    await db
      .delete(user)
      .where(
        inArray(user.id, [
          contextA.userId,
          contextB.userId,
        ]),
      );
    await db
      .delete(households)
      .where(
        inArray(households.id, [
          contextA.householdId,
          contextB.householdId,
        ]),
      );
    await closeDb();
  });

  it("lists and addresses resources only in the resolved household", async () => {
    requireFinancialContextMock.mockResolvedValue(contextA);
    const resourceA = await repository.create({ name: "A" });

    requireFinancialContextMock.mockResolvedValue(contextB);
    const resourceB = await repository.create({ name: "B" });

    requireFinancialContextMock.mockResolvedValue(contextA);
    await expect(repository.list()).resolves.toEqual([resourceA]);
    await expect(repository.findById(resourceB.id)).resolves.toBeNull();
    await expect(repository.getById(resourceB.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    await expect(
      repository.update(resourceB.id, { name: "forged" }),
    ).rejects.toBeInstanceOf(ProtectedResourceError);

    await expect(
      repository.update(resourceA.id, {
        name: "A updated",
        householdId: contextB.householdId,
      } as { name: string }),
    ).resolves.toMatchObject({
      name: "A updated",
      householdId: contextA.householdId,
    });

    requireFinancialContextMock.mockResolvedValue(contextB);
    await expect(repository.getById(resourceB.id)).resolves.toMatchObject({
      name: "B",
      householdId: contextB.householdId,
    });
  });

  it("ignores a forged household field in a create command", async () => {
    requireFinancialContextMock.mockResolvedValue(contextA);

    const resource = await repository.create({
      name: "server-owned",
      householdId: contextB.householdId,
    } as { name: string });

    expect(resource.householdId).toBe(contextA.householdId);
    expect(resource.createdBy).toBe(contextA.userId);
  });

  it("lets PostgreSQL reject a cross-tenant creator association", async () => {
    const db = database;
    if (!db) {
      throw new Error("O banco de integração não foi inicializado.");
    }

    const insert = db.insert(protectedResources).values({
      id: generateUuidV7(),
      householdId: contextB.householdId,
      createdBy: contextA.userId,
      name: "cross-tenant",
    });

    let caught: unknown;
    try {
      await insert;
    } catch (error) {
      caught = error;
      const code = (error as { cause?: { code?: string }; code?: string })
        .cause?.code ?? (error as { code?: string }).code;
      expect(error).toBeInstanceOf(Error);
      expect(code).toBe("23503");
    }
    expect(caught).toBeInstanceOf(Error);
  });
});
