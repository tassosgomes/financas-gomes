import { createHash } from "node:crypto";

import {
  and,
  asc,
  eq,
  sql,
} from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  applicationCommands,
  categories,
  type ApplicationCommandRecord,
  type CategoryRecord,
} from "@/db/accounts-categories-schema";
import { generateUuidV7 } from "@/lib/uuidv7";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import type { FinancialContext } from "@/modules/households/contracts";
import type { CategoriesUseCasePort } from "@/modules/accounts-categories/adapters";
import {
  failure,
  ok,
  S02DomainError,
  type CategoryReadModel,
  type CreateCategoryCommand,
  type ListCategoriesReadModel,
  type ListCategoriesQuery,
  type S02Result,
  type UpdateCategoryCommand,
  type ArchiveCategoryCommand,
} from "@/modules/accounts-categories/contracts";
import {
  assertCategoryCanArchive,
  assertCategoryParent,
  assertCategoryReparenting,
  isCategoryReparenting,
  parseArchiveCategoryCommand,
  parseCreateCategoryCommand,
  parseListCategoriesQuery,
  parseUpdateCategoryCommand,
} from "@/modules/accounts-categories/validation";

/**
 * The transaction type is intentionally inferred from the configured Drizzle
 * database. Both the node-postgres and Neon implementations expose the same
 * query surface, while keeping this module independent from a concrete
 * driver.
 */
export type CategoryTransaction =
  Parameters<NonNullable<ReturnType<typeof getDb>["transaction"]>>[0] extends (
    transaction: infer T,
  ) => Promise<unknown>
    ? T
    : never;

/**
 * A future ledger can provide this callback to make the usage check part of
 * the same category transaction. S02 has no financial-reference table yet,
 * so the default is false and no usage is inferred from children/status.
 */
export type CategoryUsageChecker = (
  categoryId: string,
  context: FinancialContext,
  transaction: CategoryTransaction,
) => Promise<boolean>;

export interface CategoryUseCaseOptions {
  /** Injectable only for tests/composition; the default resolves lazily. */
  database?: Database;
  /** Defaults to no usage until a later ledger slice supplies the check. */
  hasFinancialUsage?: CategoryUsageChecker;
}

/** Stable persistence operation names from ADR-003. */
export const CATEGORY_COMMAND_OPERATIONS = {
  create: "categories.create",
  update: "categories.update",
  archive: "categories.archive",
} as const;

export type CategoryCommandOperation =
  (typeof CATEGORY_COMMAND_OPERATIONS)[keyof typeof CATEGORY_COMMAND_OPERATIONS];

type CommandOperation = CategoryCommandOperation;

type CommandClaim =
  | { created: true }
  | { created: false; record: ApplicationCommandRecord };

function resolveDatabase(database: Database | undefined): Database {
  return database ?? getDb();
}

function toReadModel(record: CategoryRecord): CategoryReadModel {
  return {
    id: record.id,
    householdId: record.householdId,
    name: record.name,
    parentId: record.parentId,
    kind: record.kind,
    status: record.status,
    createdAt: toIsoTimestamp(record.createdAt),
    updatedAt: toIsoTimestamp(record.updatedAt),
  };
}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toHierarchyNode(record: CategoryRecord) {
  return {
    id: record.id,
    householdId: record.householdId,
    kind: record.kind,
    status: record.status,
    parentId: record.parentId,
  };
}

function normalizeContext(context: FinancialContext): FinancialContext {
  assertFinancialContext(context);
  return {
    userId: context.userId,
    householdId: context.householdId,
  };
}

/**
 * Commands contain only strings, booleans and nullable IDs. Sorting the
 * object keys makes the digest stable even if a caller constructs equivalent
 * payloads in a different property order. `commandId` is the lookup key and
 * is deliberately not part of the payload being compared.
 */
function payloadHash(
  operation: CommandOperation,
  payload: Record<string, unknown>,
): string {
  const canonical = JSON.stringify({
    operation,
    payload: Object.fromEntries(
      Object.entries(payload).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  });

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function databaseErrorCode(error: unknown): string | undefined {
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

function isUniqueViolation(error: unknown): boolean {
  return databaseErrorCode(error) === "23505";
}

function isForeignKeyViolation(error: unknown): boolean {
  return databaseErrorCode(error) === "23503";
}

function expectedErrorResult<T>(error: unknown): S02Result<T> | undefined {
  if (error instanceof S02DomainError) {
    return failure(error.code, error.field);
  }
  return undefined;
}

function mapPersistenceError<T>(
  error: unknown,
  field: "name" | "parentId" = "name",
): S02Result<T> | undefined {
  const expected = expectedErrorResult<T>(error);
  if (expected) {
    return expected;
  }

  if (isUniqueViolation(error)) {
    return failure("CATEGORY_NAME_CONFLICT", "name");
  }

  // Parent existence is validated before INSERT/UPDATE. This fallback keeps
  // a concurrent parent removal opaque if PostgreSQL reports the composite FK
  // before the transaction can observe the conflict.
  if (field === "parentId" && isForeignKeyViolation(error)) {
    return failure("CATEGORY_PARENT_NOT_FOUND", "parentId");
  }

  return undefined;
}

async function selectCategory(
  transaction: CategoryTransaction,
  context: FinancialContext,
  categoryId: string,
  lock = false,
): Promise<CategoryRecord | undefined> {
  const query = transaction
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.id, categoryId),
        // An ID from another household is intentionally indistinguishable
        // from an absent resource at every private read/write boundary.
        eq(categories.householdId, context.householdId),
      ),
    )
    .limit(1);

  const rows = lock ? await query.for("update") : await query;
  return rows[0];
}

async function selectParent(
  transaction: CategoryTransaction,
  context: FinancialContext,
  parentId: string,
): Promise<CategoryRecord | undefined> {
  // Locking the parent serializes create-child/update-parent with archive of
  // that parent. It prevents an active child from racing an archive check.
  return selectCategory(transaction, context, parentId, true);
}

async function claimCommand(
  transaction: CategoryTransaction,
  context: FinancialContext,
  commandId: string,
  operation: CommandOperation,
  hash: string,
): Promise<CommandClaim> {
  const inserted = await transaction
    .insert(applicationCommands)
    .values({
      householdId: context.householdId,
      commandId,
      operation,
      payloadHash: hash,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) {
    return { created: true };
  }

  // The conflict insert waits for a concurrent command transaction. Locking
  // the committed row makes its resource ID visible before returning a retry.
  const rows = await transaction
    .select()
    .from(applicationCommands)
    .where(
      and(
        eq(applicationCommands.householdId, context.householdId),
        eq(applicationCommands.commandId, commandId),
      ),
    )
    .limit(1)
    .for("update");
  const record = rows[0];

  if (!record) {
    throw new Error("O registro de idempotência não foi encontrado após conflito.");
  }

  if (record.operation !== operation || record.payloadHash !== hash) {
    throw new S02DomainError("COMMAND_ID_REUSED", "commandId");
  }

  if (!record.resourceId) {
    // A committed command without a resource is an internal invariant
    // violation. Returning a domain success here could hide a partial write.
    throw new Error("O registro de idempotência não possui recurso associado.");
  }

  return { created: false, record };
}

async function completeCommand(
  transaction: CategoryTransaction,
  context: FinancialContext,
  commandId: string,
  operation: CommandOperation,
  hash: string,
  resourceId: string,
): Promise<void> {
  const updated = await transaction
    .update(applicationCommands)
    .set({ resourceId })
    .where(
      and(
        eq(applicationCommands.householdId, context.householdId),
        eq(applicationCommands.commandId, commandId),
        eq(applicationCommands.operation, operation),
        eq(applicationCommands.payloadHash, hash),
      ),
    )
    .returning({ commandId: applicationCommands.commandId });

  if (!updated[0]) {
    throw new Error("Não foi possível concluir o registro de idempotência.");
  }
}

async function resultForClaim(
  transaction: CategoryTransaction,
  context: FinancialContext,
  claim: Extract<CommandClaim, { created: false }>,
): Promise<CategoryReadModel> {
  const record = await selectCategory(
    transaction,
    context,
    claim.record.resourceId as string,
  );
  if (!record) {
    // A category is never hard-deleted by this slice. A missing row therefore
    // indicates an external invariant violation, but the opaque public code
    // is still safer than exposing a raw database error.
    throw new S02DomainError("CATEGORY_NOT_FOUND", "categoryId");
  }
  return toReadModel(record);
}

async function selectActiveChild(
  transaction: CategoryTransaction,
  context: FinancialContext,
  categoryId: string,
): Promise<CategoryRecord | undefined> {
  const rows = await transaction
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.householdId, context.householdId),
        eq(categories.parentId, categoryId),
        eq(categories.status, "ACTIVE"),
      ),
    )
    .limit(1);
  return rows[0];
}

function categoryCreateHash(command: CreateCategoryCommand): string {
  return payloadHash("categories.create", {
    name: command.name,
    kind: command.kind,
    // Omitted and explicit null have the same create semantics.
    parentId: command.parentId ?? null,
  });
}

function categoryUpdateHash(command: UpdateCategoryCommand): string {
  return payloadHash("categories.update", {
    categoryId: command.categoryId,
    ...(command.name === undefined ? {} : { name: command.name }),
    ...(command.parentId === undefined ? {} : { parentId: command.parentId }),
  });
}

function categoryArchiveHash(command: ArchiveCategoryCommand): string {
  return payloadHash("categories.archive", {
    categoryId: command.categoryId,
  });
}

async function createCategoryForContext(
  database: Database | undefined,
  context: FinancialContext,
  input: unknown,
): Promise<S02Result<CategoryReadModel>> {
  try {
    const command = parseCreateCategoryCommand(input);
    const hash = categoryCreateHash(command);
    const value = await resolveDatabase(database).transaction(async (transaction) => {
      const claim = await claimCommand(
        transaction,
        context,
        command.commandId,
        "categories.create",
        hash,
      );
      if (!claim.created) {
        return resultForClaim(transaction, context, claim);
      }

      const parent = command.parentId
        ? await selectParent(transaction, context, command.parentId)
        : null;
      assertCategoryParent({
        householdId: context.householdId,
        kind: command.kind,
        parentId: command.parentId,
        parent: parent ? toHierarchyNode(parent) : parent,
      });

      let rows: CategoryRecord[];
      try {
        rows = await transaction
          .insert(categories)
          .values({
            id: generateUuidV7(),
            householdId: context.householdId,
            name: command.name,
            parentId: command.parentId ?? null,
            kind: command.kind,
            status: "ACTIVE",
          })
          .returning();
      } catch (error) {
        const mapped = mapPersistenceError<CategoryReadModel>(error);
        if (mapped && !mapped.ok) {
          throw new S02DomainError(mapped.error.code, mapped.error.field);
        }
        throw error;
      }

      const row = rows[0];
      if (!row) {
        throw new Error("A criação da categoria não retornou uma linha.");
      }

      await completeCommand(
        transaction,
        context,
        command.commandId,
        "categories.create",
        hash,
        row.id,
      );
      return toReadModel(row);
    });

    return ok(value);
  } catch (error) {
    const mapped = mapPersistenceError<CategoryReadModel>(error, "parentId");
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

async function listCategoriesForContext(
  database: Database | undefined,
  context: FinancialContext,
  input: unknown,
): Promise<S02Result<ListCategoriesReadModel>> {
  try {
    const query = parseListCategoriesQuery(input);
    const status = query.status ?? "ACTIVE";

    const rows = await resolveDatabase(database)
      .select()
      .from(categories)
      .where(
        status === "ALL"
          ? eq(categories.householdId, context.householdId)
          : and(
              eq(categories.householdId, context.householdId),
              eq(categories.status, status),
            ),
      )
      .orderBy(
        // A flat read model puts every root before every child. Consumers can
        // build a tree from parentId without a second database read.
        asc(sql`case when ${categories.parentId} is null then 0 else 1 end`),
        asc(sql`lower(${categories.name})`),
        asc(categories.id),
      );

    return ok({ items: rows.map(toReadModel) });
  } catch (error) {
    const mapped = mapPersistenceError<ListCategoriesReadModel>(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

async function updateCategoryForContext(
  database: Database | undefined,
  context: FinancialContext,
  input: unknown,
  hasFinancialUsage: CategoryUsageChecker,
): Promise<S02Result<CategoryReadModel>> {
  try {
    const command = parseUpdateCategoryCommand(input);
    const hash = categoryUpdateHash(command);
    const value = await resolveDatabase(database).transaction(async (transaction) => {
      const claim = await claimCommand(
        transaction,
        context,
        command.commandId,
        "categories.update",
        hash,
      );
      if (!claim.created) {
        return resultForClaim(transaction, context, claim);
      }

      const current = await selectCategory(
        transaction,
        context,
        command.categoryId,
        true,
      );
      if (!current) {
        throw new S02DomainError("CATEGORY_NOT_FOUND", "categoryId");
      }
      if (current.status === "ARCHIVED") {
        throw new S02DomainError("RESOURCE_ARCHIVED", "categoryId");
      }

      let parent: CategoryRecord | null | undefined;
      let hasUsage = false;
      if (command.parentId !== undefined) {
        parent = command.parentId
          ? await selectParent(transaction, context, command.parentId)
          : null;

        // Validate the requested parent before consulting financial usage. A
        // missing/cross-tenant parent must remain opaque even when a later
        // ledger callback says that this category has usage.
        assertCategoryParent({
          householdId: context.householdId,
          kind: current.kind,
          parentId: command.parentId,
          categoryId: current.id,
          parent: parent ? toHierarchyNode(parent) : parent,
        });

        const changed = isCategoryReparenting(
          current.parentId,
          command.parentId,
        );
        if (changed) {
          hasUsage = await hasFinancialUsage(
            current.id,
            context,
            transaction,
          );
        }
        assertCategoryReparenting({
          currentParentId: current.parentId,
          requestedParentId: command.parentId,
          hasFinancialUsage: hasUsage,
        });
      }

      let rows: CategoryRecord[];
      try {
        rows = await transaction
          .update(categories)
          .set({
            ...(command.name === undefined ? {} : { name: command.name }),
            ...(command.parentId === undefined
              ? {}
              : { parentId: command.parentId }),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(categories.id, current.id),
              eq(categories.householdId, context.householdId),
            ),
          )
          .returning();
      } catch (error) {
        const mapped = mapPersistenceError<CategoryReadModel>(error);
        if (mapped && !mapped.ok) {
          throw new S02DomainError(mapped.error.code, mapped.error.field);
        }
        throw error;
      }

      const row = rows[0];
      if (!row) {
        throw new S02DomainError("CATEGORY_NOT_FOUND", "categoryId");
      }

      await completeCommand(
        transaction,
        context,
        command.commandId,
        "categories.update",
        hash,
        row.id,
      );
      return toReadModel(row);
    });

    return ok(value);
  } catch (error) {
    const mapped = mapPersistenceError<CategoryReadModel>(error, "parentId");
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

async function archiveCategoryForContext(
  database: Database | undefined,
  context: FinancialContext,
  input: unknown,
): Promise<S02Result<CategoryReadModel>> {
  try {
    const command = parseArchiveCategoryCommand(input);
    const hash = categoryArchiveHash(command);
    const value = await resolveDatabase(database).transaction(async (transaction) => {
      const claim = await claimCommand(
        transaction,
        context,
        command.commandId,
        "categories.archive",
        hash,
      );
      if (!claim.created) {
        return resultForClaim(transaction, context, claim);
      }

      const current = await selectCategory(
        transaction,
        context,
        command.categoryId,
        true,
      );
      if (!current) {
        throw new S02DomainError("CATEGORY_NOT_FOUND", "categoryId");
      }
      if (current.status === "ARCHIVED") {
        throw new S02DomainError("RESOURCE_ARCHIVED", "categoryId");
      }

      const activeChild = await selectActiveChild(
        transaction,
        context,
        current.id,
      );
      assertCategoryCanArchive({
        status: current.status,
        hasActiveChildren: activeChild !== undefined,
      });

      const rows = await transaction
        .update(categories)
        .set({ status: "ARCHIVED", updatedAt: new Date() })
        .where(
          and(
            eq(categories.id, current.id),
            eq(categories.householdId, context.householdId),
          ),
        )
        .returning();
      const row = rows[0];
      if (!row) {
        throw new S02DomainError("CATEGORY_NOT_FOUND", "categoryId");
      }

      await completeCommand(
        transaction,
        context,
        command.commandId,
        "categories.archive",
        hash,
        row.id,
      );
      return toReadModel(row);
    });

    return ok(value);
  } catch (error) {
    const mapped = mapPersistenceError<CategoryReadModel>(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

/**
 * Builds the concrete T06 port. All methods accept an authenticated context,
 * never a client-provided household, and resolve the database lazily.
 */
export function createCategoryUseCasePort(
  options?: CategoryUseCaseOptions,
): CategoriesUseCasePort;
export function createCategoryUseCasePort(
  database: Database,
): CategoriesUseCasePort;
export function createCategoryUseCasePort(
  databaseOrOptions: Database | CategoryUseCaseOptions = {},
): CategoriesUseCasePort {
  const options = toCategoryOptions(databaseOrOptions);
  const hasFinancialUsage: CategoryUsageChecker =
    options.hasFinancialUsage ?? (async () => false);

  return {
    create: (context, command) =>
      createCategoryForContext(
        options.database,
        normalizeContext(context),
        command,
      ),
    list: (context, query) =>
      listCategoriesForContext(
        options.database,
        normalizeContext(context),
        query,
      ),
    update: (context, command) =>
      updateCategoryForContext(
        options.database,
        normalizeContext(context),
        command,
        hasFinancialUsage,
      ),
    archive: (context, command) =>
      archiveCategoryForContext(
        options.database,
        normalizeContext(context),
        command,
      ),
  };
}

export type CategoriesUseCases = CategoriesUseCasePort;

function isDatabase(value: unknown): value is Database {
  return (
    typeof value === "object" &&
    value !== null &&
    "select" in value &&
    "transaction" in value
  );
}

function toCategoryOptions(
  databaseOrOptions: Database | CategoryUseCaseOptions | undefined,
  options: Omit<CategoryUseCaseOptions, "database"> = {},
): CategoryUseCaseOptions {
  if (isDatabase(databaseOrOptions)) {
    return { ...options, database: databaseOrOptions };
  }
  return databaseOrOptions ?? options;
}

/** Builds the concrete T06 port, with database-first and options overloads. */
export function createCategoriesUseCases(
  database?: Database,
): CategoriesUseCases;
export function createCategoriesUseCases(
  database: Database,
  options?: Omit<CategoryUseCaseOptions, "database">,
): CategoriesUseCases;
export function createCategoriesUseCases(
  options?: CategoryUseCaseOptions,
): CategoriesUseCases;
export function createCategoriesUseCases(
  databaseOrOptions?: Database | CategoryUseCaseOptions,
): CategoriesUseCases;
export function createCategoriesUseCases(
  databaseOrOptions?: Database | CategoryUseCaseOptions,
  options: Omit<CategoryUseCaseOptions, "database"> = {},
): CategoriesUseCases {
  return createCategoryUseCasePort(
    toCategoryOptions(databaseOrOptions, options),
  );
}

/** Naming aliases keep composition code readable without changing behavior. */
export const createCategoriesUseCasePort = createCategoriesUseCases;
export const createCategoryUseCases = createCategoriesUseCases;
export const createCategoryUseCase = createCategoriesUseCases;

export async function createCategory(
  context: FinancialContext,
  command: CreateCategoryCommand,
  databaseOrOptions?: Database | CategoryUseCaseOptions,
): Promise<S02Result<CategoryReadModel>> {
  return createCategoriesUseCases(databaseOrOptions).create(context, command);
}

export async function listCategories(
  context: FinancialContext,
  query: ListCategoriesQuery = {},
  databaseOrOptions?: Database | CategoryUseCaseOptions,
): Promise<S02Result<ListCategoriesReadModel>> {
  return createCategoriesUseCases(databaseOrOptions).list(context, query);
}

/** Explicit read helper for future transaction-entry selectors. */
export async function listActiveCategories(
  context: FinancialContext,
  databaseOrOptions?: Database | CategoryUseCaseOptions,
): Promise<S02Result<ListCategoriesReadModel>> {
  return createCategoriesUseCases(databaseOrOptions).list(context, {
    status: "ACTIVE",
  });
}

export async function updateCategory(
  context: FinancialContext,
  command: UpdateCategoryCommand,
  databaseOrOptions?: Database | CategoryUseCaseOptions,
): Promise<S02Result<CategoryReadModel>> {
  return createCategoriesUseCases(databaseOrOptions).update(context, command);
}

export async function archiveCategory(
  context: FinancialContext,
  command: ArchiveCategoryCommand,
  databaseOrOptions?: Database | CategoryUseCaseOptions,
): Promise<S02Result<CategoryReadModel>> {
  return createCategoriesUseCases(databaseOrOptions).archive(context, command);
}

export const CreateCategory = createCategory;
export const ListCategories = listCategories;
export const UpdateCategory = updateCategory;
export const ArchiveCategory = archiveCategory;

/** Default lazy port for server composition. */
export const categoryUseCasePort = createCategoryUseCasePort();
export const categoriesUseCases = createCategoriesUseCases();
export const categoryUseCases = categoriesUseCases;
