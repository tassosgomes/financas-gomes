import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations, getMigrationStatus } from "@/db/migrate";
import {
  accounts,
  applicationCommands,
  categories,
  householdInvites,
  householdMembers,
  households,
  protectedResources,
  user,
} from "@/db/schema";
import { generateUuidV7 } from "@/lib/uuidv7";
import type { FinancialContext } from "@/modules/households/contracts";
import { createAccountsUseCases } from "@/modules/accounts/use-cases";
import { createCategoriesUseCases } from "@/modules/categories/use-cases";
import type {
  S02ErrorCode,
  S02Result,
} from "./contracts";

/**
 * T11 is opt-in because these tests intentionally mutate a real PostgreSQL
 * database. The integration command points at the disposable compose service.
 */
const integration =
  process.env.T11_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  users: {
    ownerA: {
      id: "00000000-0000-7000-8000-000000011101",
      name: "T11 Owner A",
      email: "t11-owner-a@example.test",
    },
    ownerB: {
      id: "00000000-0000-7000-8000-000000011102",
      name: "T11 Owner B",
      email: "t11-owner-b@example.test",
    },
  },
  households: {
    a: "00000000-0000-7000-8000-000000012101",
    b: "00000000-0000-7000-8000-000000012102",
  },
} as const;

const contextA: FinancialContext = {
  userId: FIXTURES.users.ownerA.id,
  householdId: FIXTURES.households.a,
};
const contextB: FinancialContext = {
  userId: FIXTURES.users.ownerB.id,
  householdId: FIXTURES.households.b,
};
const householdIds = [FIXTURES.households.a, FIXTURES.households.b] as const;

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T11 não foi inicializado.");
  }
  return database;
}

function resultValue<T>(result: S02Result<T>): T {
  if (!result.ok) {
    throw new Error(`Resultado S02 inesperado: ${result.error.code}`);
  }
  return result.value;
}

function expectResultError<T>(
  result: S02Result<T>,
  code: S02ErrorCode,
): void {
  expect(result).toMatchObject({
    ok: false,
    error: { code },
  });
}

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as {
    code?: unknown;
    cause?: { code?: unknown };
  };
  if (typeof candidate.code === "string") {
    return candidate.code;
  }
  if (typeof candidate.cause?.code === "string") {
    return candidate.cause.code;
  }
  return undefined;
}

async function cleanupT11(database: Database): Promise<void> {
  // Delete dependants first. The parent FK is intentionally RESTRICT, so a
  // cleanup must not rely on cascading historical S02 rows away.
  await database
    .delete(applicationCommands)
    .where(inArray(applicationCommands.householdId, householdIds));
  await database
    .delete(protectedResources)
    .where(inArray(protectedResources.householdId, householdIds));
  await database
    .delete(householdInvites)
    .where(inArray(householdInvites.householdId, householdIds));
  await database
    .delete(categories)
    .where(
      and(
        inArray(categories.householdId, householdIds),
        sql`${categories.parentId} is not null`,
      ),
    );
  await database
    .delete(categories)
    .where(inArray(categories.householdId, householdIds));
  await database
    .delete(accounts)
    .where(inArray(accounts.householdId, householdIds));
  await database
    .delete(householdMembers)
    .where(inArray(householdMembers.householdId, householdIds));
  await database
    .delete(households)
    .where(inArray(households.id, householdIds));
  await database
    .delete(user)
    .where(
      inArray(user.id, [FIXTURES.users.ownerA.id, FIXTURES.users.ownerB.id]),
    );
}

async function seedT11(database: Database): Promise<void> {
  await database.insert(user).values([
    FIXTURES.users.ownerA,
    FIXTURES.users.ownerB,
  ]);
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T11 Household A" },
    { id: FIXTURES.households.b, name: "T11 Household B" },
  ]);
  await database.insert(householdMembers).values([
    { householdId: FIXTURES.households.a, userId: FIXTURES.users.ownerA.id },
    { householdId: FIXTURES.households.b, userId: FIXTURES.users.ownerB.id },
  ]);
}

function everyBelongsTo<T extends { householdId: string }>(
  items: readonly T[],
  householdId: string,
): void {
  expect(items.length).toBeGreaterThan(0);
  expect(items.every((item) => item.householdId === householdId)).toBe(true);
}

integration("T11 S02 PostgreSQL integration", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar T11_INTEGRATION=1.",
      );
    }
    if (
      process.env.MIGRATION_DATABASE_URL &&
      process.env.MIGRATION_DATABASE_URL !== process.env.DATABASE_URL
    ) {
      throw new Error(
        "T11 exige DATABASE_URL e MIGRATION_DATABASE_URL apontando para o mesmo PostgreSQL de teste.",
      );
    }

    // Applying migrations here keeps the suite reproducible when it is run
    // against the empty database created by docker-compose.test.yml.
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = databaseOrThrow(database);
    await cleanupT11(db);
    await seedT11(db);
  });

  afterAll(async () => {
    if (database) {
      await cleanupT11(database);
    }
    await closeDb();
  });

  it("applies the forward-only migrations and exposes the essential schema", async () => {
    const db = databaseOrThrow(database);
    const status = await getMigrationStatus();

    expect(status.applied).toBeGreaterThan(0);
    expect(status.pending).toBe(0);
    expect(status.drifted).toBe(0);

    const tableRows = await db.execute<{ tablename: string }>(sql`
      select tablename
        from pg_catalog.pg_tables
       where schemaname = 'public'
         and tablename in ('accounts', 'categories', 'application_commands')
       order by tablename
    `);
    expect(tableRows.rows.map(({ tablename }) => tablename)).toEqual([
      "accounts",
      "application_commands",
      "categories",
    ]);

    const indexRows = await db.execute<{ indexname: string }>(sql`
      select indexname
        from pg_catalog.pg_indexes
       where schemaname = 'public'
         and indexname in (
           'accounts_household_name_ci_uq',
           'accounts_household_status_name_idx',
           'categories_household_parent_name_ci_uq',
           'categories_household_parent_status_name_idx',
           'application_commands_household_created_at_idx'
         )
       order by indexname
    `);
    expect(indexRows.rows.map(({ indexname }) => indexname)).toEqual([
      "accounts_household_name_ci_uq",
      "accounts_household_status_name_idx",
      "application_commands_household_created_at_idx",
      "categories_household_parent_name_ci_uq",
      "categories_household_parent_status_name_idx",
    ]);
  });

  it("runs account CRUD through PostgreSQL while keeping reads and writes tenant-scoped", async () => {
    const db = databaseOrThrow(database);
    const useCases = createAccountsUseCases(db);

    const accountA = resultValue(
      await useCases.create(contextA, {
        commandId: "t11-account-create-a",
        name: "Checking A",
        type: "CHECKING",
      }),
    );
    const accountB = resultValue(
      await useCases.create(contextB, {
        commandId: "t11-account-create-b",
        name: "Checking B",
        type: "CHECKING",
      }),
    );

    expect(accountA).toMatchObject({
      householdId: contextA.householdId,
      status: "ACTIVE",
      spendability: "GENERAL",
      liquidity: "IMMEDIATE",
      includeInNetWorth: true,
      trackingStartedOn: null,
    });
    expect(accountB.householdId).toBe(contextB.householdId);

    const listedA = resultValue(await useCases.list(contextA, {}));
    const listedB = resultValue(await useCases.list(contextB, {}));
    everyBelongsTo(listedA.items, contextA.householdId);
    everyBelongsTo(listedB.items, contextB.householdId);
    expect(listedA.items.map(({ id }) => id)).toEqual([accountA.id]);
    expect(listedB.items.map(({ id }) => id)).toEqual([accountB.id]);

    const updated = resultValue(
      await useCases.update(contextA, {
        commandId: "t11-account-update-a",
        accountId: accountA.id,
        name: "Checking A Renamed",
      }),
    );
    expect(updated.name).toBe("Checking A Renamed");

    const forgedUpdate = await useCases.update(contextA, {
      commandId: "t11-account-update-cross-tenant",
      accountId: accountB.id,
      name: "Must not leak",
    });
    expectResultError(forgedUpdate, "ACCOUNT_NOT_FOUND");

    const forgedArchive = await useCases.archive(contextA, {
      commandId: "t11-account-archive-cross-tenant",
      accountId: accountB.id,
    });
    expectResultError(forgedArchive, "ACCOUNT_NOT_FOUND");

    const persistedB = await db
      .select({ name: accounts.name, status: accounts.status })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountB.id),
          eq(accounts.householdId, contextB.householdId),
        ),
      );
    expect(persistedB).toEqual([{ name: "Checking B", status: "ACTIVE" }]);

    const archived = resultValue(
      await useCases.archive(contextA, {
        commandId: "t11-account-archive-a",
        accountId: accountA.id,
      }),
    );
    expect(archived.status).toBe("ARCHIVED");

    const activeAfterArchive = resultValue(await useCases.list(contextA, {}));
    expect(activeAfterArchive.items).toEqual([]);
    const allAfterArchive = resultValue(
      await useCases.list(contextA, { status: "ALL" }),
    );
    expect(allAfterArchive.items).toHaveLength(1);
    expect(allAfterArchive.items[0]).toMatchObject({
      id: accountA.id,
      status: "ARCHIVED",
    });

    const persistedA = await db
      .select({ id: accounts.id, status: accounts.status })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountA.id),
          eq(accounts.householdId, contextA.householdId),
        ),
      );
    expect(persistedA).toEqual([{ id: accountA.id, status: "ARCHIVED" }]);
  });

  it("runs category CRUD, hierarchy and explicit cross-tenant checks on PostgreSQL", async () => {
    const db = databaseOrThrow(database);
    const useCases = createCategoriesUseCases(db);

    const rootA = resultValue(
      await useCases.create(contextA, {
        commandId: "t11-category-root-a",
        name: "Expense root A",
        kind: "EXPENSE",
      }),
    );
    const rootB = resultValue(
      await useCases.create(contextB, {
        commandId: "t11-category-root-b",
        name: "Expense root B",
        kind: "EXPENSE",
      }),
    );
    const childA = resultValue(
      await useCases.create(contextA, {
        commandId: "t11-category-child-a",
        name: "Child A",
        kind: "EXPENSE",
        parentId: rootA.id,
      }),
    );
    const incomeA = resultValue(
      await useCases.create(contextA, {
        commandId: "t11-category-income-a",
        name: "Income A",
        kind: "INCOME",
      }),
    );

    expect(rootA.parentId).toBeNull();
    expect(childA.parentId).toBe(rootA.id);
    expect(incomeA.kind).toBe("INCOME");

    const listedA = resultValue(await useCases.list(contextA, {}));
    const listedB = resultValue(await useCases.list(contextB, {}));
    everyBelongsTo(listedA.items, contextA.householdId);
    everyBelongsTo(listedB.items, contextB.householdId);
    expect(new Set(listedA.items.map(({ id }) => id))).toEqual(
      new Set([rootA.id, childA.id, incomeA.id]),
    );
    expect(listedB.items.map(({ id }) => id)).toEqual([rootB.id]);

    const crossTenantParent = await useCases.create(contextA, {
      commandId: "t11-category-cross-tenant-parent",
      name: "Invalid cross tenant child",
      kind: "EXPENSE",
      parentId: rootB.id,
    });
    expectResultError(crossTenantParent, "CATEGORY_PARENT_NOT_FOUND");

    const thirdLevel = await useCases.create(contextA, {
      commandId: "t11-category-third-level",
      name: "Invalid third level",
      kind: "EXPENSE",
      parentId: childA.id,
    });
    expectResultError(thirdLevel, "CATEGORY_MAX_DEPTH");

    const failedCommandRows = await db
      .select({ commandId: applicationCommands.commandId })
      .from(applicationCommands)
      .where(
        and(
          eq(applicationCommands.householdId, contextA.householdId),
          inArray(applicationCommands.commandId, [
            "t11-category-cross-tenant-parent",
            "t11-category-third-level",
          ]),
        ),
      );
    // claimCommand runs before hierarchy validation; a failed operation must
    // roll back that claim along with the rest of the composed transaction.
    expect(failedCommandRows).toEqual([]);

    const renamed = resultValue(
      await useCases.update(contextA, {
        commandId: "t11-category-rename-child",
        categoryId: childA.id,
        name: "Child A Renamed",
      }),
    );
    expect(renamed.name).toBe("Child A Renamed");

    const alternateParent = resultValue(
      await useCases.create(contextA, {
        commandId: "t11-category-alternate-parent",
        name: "Alternate parent A",
        kind: "EXPENSE",
      }),
    );
    const categoriesWithUsage = createCategoriesUseCases({
      database: db,
      hasFinancialUsage: async () => true,
    });
    const reparentedUsedCategory = await categoriesWithUsage.update(contextA, {
      commandId: "t11-category-reparent-used",
      categoryId: childA.id,
      parentId: alternateParent.id,
    });
    expectResultError(reparentedUsedCategory, "CATEGORY_REPARENTING_FORBIDDEN");

    const persistedChild = await db
      .select({ name: categories.name, parentId: categories.parentId })
      .from(categories)
      .where(
        and(
          eq(categories.id, childA.id),
          eq(categories.householdId, contextA.householdId),
        ),
      );
    expect(persistedChild).toEqual([
      { name: "Child A Renamed", parentId: rootA.id },
    ]);
  });

  it("preserves archived categories and rejects destructive parent deletion", async () => {
    const db = databaseOrThrow(database);
    const useCases = createCategoriesUseCases(db);

    const parent = resultValue(
      await useCases.create(contextA, {
        commandId: "t11-archive-parent-create",
        name: "Archive parent",
        kind: "EXPENSE",
      }),
    );
    const child = resultValue(
      await useCases.create(contextA, {
        commandId: "t11-archive-child-create",
        name: "Archive child",
        kind: "EXPENSE",
        parentId: parent.id,
      }),
    );

    const parentWithActiveChild = await useCases.archive(contextA, {
      commandId: "t11-archive-parent-with-active-child",
      categoryId: parent.id,
    });
    expectResultError(parentWithActiveChild, "CATEGORY_HAS_ACTIVE_CHILDREN");

    const archivedChild = resultValue(
      await useCases.archive(contextA, {
        commandId: "t11-archive-child",
        categoryId: child.id,
      }),
    );
    expect(archivedChild.status).toBe("ARCHIVED");

    const archivedParent = resultValue(
      await useCases.archive(contextA, {
        commandId: "t11-archive-parent",
        categoryId: parent.id,
      }),
    );
    expect(archivedParent.status).toBe("ARCHIVED");

    const active = resultValue(await useCases.list(contextA, {}));
    expect(active.items).toEqual([]);
    const all = resultValue(await useCases.list(contextA, { status: "ALL" }));
    expect(new Set(all.items.map(({ id }) => id))).toEqual(
      new Set([parent.id, child.id]),
    );
    expect(all.items.every(({ status }) => status === "ARCHIVED")).toBe(true);

    let deletionError: unknown;
    try {
      await db
        .delete(categories)
        .where(
          and(
            eq(categories.id, parent.id),
            eq(categories.householdId, contextA.householdId),
          ),
        );
    } catch (error) {
      deletionError = error;
    }
    expect(deletionError).toBeInstanceOf(Error);
    expect(postgresErrorCode(deletionError)).toBe("23503");

    const persisted = await db
      .select({ id: categories.id, status: categories.status })
      .from(categories)
      .where(
        and(
          inArray(categories.id, [parent.id, child.id]),
          eq(categories.householdId, contextA.householdId),
        ),
      );
    expect(persisted).toHaveLength(2);
    expect(persisted.every(({ status }) => status === "ARCHIVED")).toBe(true);
  });

  it("keeps command retries idempotent in the database for accounts and categories", async () => {
    const db = databaseOrThrow(database);
    const accountUseCases = createAccountsUseCases(db);
    const categoryUseCases = createCategoriesUseCases(db);

    const accountCommand = {
      commandId: "t11-idempotent-account",
      name: "Idempotent account",
      type: "SAVINGS" as const,
    };
    const firstAccount = resultValue(
      await accountUseCases.create(contextA, accountCommand),
    );
    const retriedAccount = resultValue(
      await accountUseCases.create(contextA, accountCommand),
    );
    expect(retriedAccount.id).toBe(firstAccount.id);

    const incompatibleRetry = await accountUseCases.create(contextA, {
      ...accountCommand,
      name: "Different payload",
    });
    expectResultError(incompatibleRetry, "COMMAND_ID_REUSED");

    const accountRows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, contextA.householdId),
          eq(accounts.name, accountCommand.name),
        ),
      );
    expect(accountRows).toEqual([{ id: firstAccount.id }]);

    const categoryCommand = {
      commandId: "t11-idempotent-category",
      name: "Idempotent category",
      kind: "INCOME" as const,
    };
    const firstCategory = resultValue(
      await categoryUseCases.create(contextA, categoryCommand),
    );
    const retriedCategory = resultValue(
      await categoryUseCases.create(contextA, categoryCommand),
    );
    expect(retriedCategory.id).toBe(firstCategory.id);

    const commandRows = await db
      .select({
        commandId: applicationCommands.commandId,
        operation: applicationCommands.operation,
        resourceId: applicationCommands.resourceId,
      })
      .from(applicationCommands)
      .where(
        and(
          eq(applicationCommands.householdId, contextA.householdId),
          inArray(applicationCommands.commandId, [
            accountCommand.commandId,
            categoryCommand.commandId,
          ]),
        ),
      );
    expect(commandRows).toEqual(
      expect.arrayContaining([
        {
          commandId: accountCommand.commandId,
          operation: "accounts.create",
          resourceId: firstAccount.id,
        },
        {
          commandId: categoryCommand.commandId,
          operation: "categories.create",
          resourceId: firstCategory.id,
        },
      ]),
    );
    expect(commandRows).toHaveLength(2);
  });

  it("lets PostgreSQL enforce the composite parent FK across households", async () => {
    const db = databaseOrThrow(database);
    const parentB = resultValue(
      await createCategoriesUseCases(db).create(contextB, {
        commandId: "t11-direct-fk-parent-b",
        name: "Direct FK parent B",
        kind: "EXPENSE",
      }),
    );

    let foreignKeyError: unknown;
    try {
      await db.insert(categories).values({
        id: generateUuidV7(),
        householdId: contextA.householdId,
        name: "Direct cross tenant FK violation",
        parentId: parentB.id,
        kind: "EXPENSE",
        status: "ACTIVE",
      });
    } catch (error) {
      foreignKeyError = error;
    }

    expect(foreignKeyError).toBeInstanceOf(Error);
    expect(postgresErrorCode(foreignKeyError)).toBe("23503");

    const leaked = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.householdId, contextA.householdId),
          eq(categories.name, "Direct cross tenant FK violation"),
        ),
      );
    expect(leaked).toEqual([]);
  });
});
