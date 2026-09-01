import { and, eq } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  accountEntries,
  financialEvents,
  type AccountEntryRecord,
  type FinancialEventRecord,
  type NewAccountEntry,
  type NewFinancialEvent,
} from "@/db/financial-events-schema";
import {
  accounts,
  categories,
  type AccountRecord,
  type CategoryRecord,
} from "@/db/accounts-categories-schema";
import { isUuidV7 } from "@/lib/uuidv7";
import {
  assertFinancialContext,
  withFinancialContext,
} from "@/modules/households/tenant-scoped";
import type {
  FinancialContext,
  RequireFinancialContextOptions,
} from "@/modules/households/contracts";

import {
  assertManualTransactionReferences,
  type FinancialDate,
} from "./domain";
import { S03DomainError } from "./contracts";
import type {
  ManualTransactionKind,
  TransactionAccountReference,
  TransactionCategoryReference,
} from "./contracts";

/**
 * Drizzle exposes the transaction session through the callback parameter.
 * Keeping this type here lets T05/T06 use the same reference accessors from
 * inside their single PostgreSQL transaction without opening a nested one.
 */
export type TransactionReferenceTransaction =
  Parameters<NonNullable<ReturnType<typeof getDb>["transaction"]>>[0] extends (
    transaction: infer T,
  ) => Promise<unknown>
    ? T
    : never;

/** A query executor can be the application database or an existing tx. */
export type TransactionReferenceExecutor =
  | Database
  | TransactionReferenceTransaction;

export type TransactionReferenceAccessOptions = RequireFinancialContextOptions;

/** Input shared by create use cases before their event/entry write. */
export interface ManualTransactionReferenceInput {
  accountId: string;
  categoryId?: string | null;
  occurredOn: FinancialDate | string;
  kind: ManualTransactionKind;
}

export interface ValidatedManualTransactionReferences {
  occurredOn: FinancialDate;
  account: AccountRecord;
  category: CategoryRecord | null;
}

/**
 * New event values deliberately omit householdId. The tenant is added by the
 * server-side context accessor, so a browser command cannot choose it.
 */
export type FinancialEventInsertValues = Omit<NewFinancialEvent, "householdId">;

/** Same server-owned tenant boundary for account ledger entries. */
export type AccountEntryInsertValues = Omit<NewAccountEntry, "householdId">;

function resolveDatabase(database?: Database): Database {
  return database ?? getDb();
}

/**
 * Invalid UUIDs are treated as absent references. This avoids sending an
 * attacker-controlled value to a PostgreSQL uuid parameter and preserves the
 * same opaque *_NOT_FOUND contract as an ID from another household.
 */
function normalizeReferenceId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return isUuidV7(normalized) ? normalized : undefined;
}

function toAccountReference(row: AccountRecord): TransactionAccountReference {
  return {
    id: row.id,
    householdId: row.householdId,
    status: row.status,
    trackingStartedOn: row.trackingStartedOn,
  };
}

function toCategoryReference(
  row: CategoryRecord,
): TransactionCategoryReference {
  return {
    id: row.id,
    householdId: row.householdId,
    status: row.status,
    kind: row.kind,
  };
}

/**
 * Finds an account only inside the server-resolved household. `undefined`
 * intentionally represents both an absent ID and a cross-tenant ID.
 */
export async function findAccountForContext(
  database: TransactionReferenceExecutor,
  context: FinancialContext,
  accountId: unknown,
): Promise<AccountRecord | undefined> {
  assertFinancialContext(context);
  const normalizedId = normalizeReferenceId(accountId);
  if (!normalizedId) {
    return undefined;
  }

  const rows = await database
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, normalizedId),
        // Resource IDs never authorize access without the tenant predicate.
        eq(accounts.householdId, context.householdId),
      ),
    )
    .limit(1);

  return rows[0];
}

/** Finds a category only inside the server-resolved household. */
export async function findCategoryForContext(
  database: TransactionReferenceExecutor,
  context: FinancialContext,
  categoryId: unknown,
): Promise<CategoryRecord | undefined> {
  assertFinancialContext(context);
  const normalizedId = normalizeReferenceId(categoryId);
  if (!normalizedId) {
    return undefined;
  }

  const rows = await database
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.id, normalizedId),
        eq(categories.householdId, context.householdId),
      ),
    )
    .limit(1);

  return rows[0];
}

/** Finds an event only inside the server-resolved household. */
export async function findFinancialEventForContext(
  database: TransactionReferenceExecutor,
  context: FinancialContext,
  financialEventId: unknown,
): Promise<FinancialEventRecord | undefined> {
  assertFinancialContext(context);
  const normalizedId = normalizeReferenceId(financialEventId);
  if (!normalizedId) {
    return undefined;
  }

  const rows = await database
    .select()
    .from(financialEvents)
    .where(
      and(
        eq(financialEvents.id, normalizedId),
        eq(financialEvents.householdId, context.householdId),
      ),
    )
    .limit(1);

  return rows[0];
}

/** Finds an account entry only inside the server-resolved household. */
export async function findAccountEntryForContext(
  database: TransactionReferenceExecutor,
  context: FinancialContext,
  accountEntryId: unknown,
): Promise<AccountEntryRecord | undefined> {
  assertFinancialContext(context);
  const normalizedId = normalizeReferenceId(accountEntryId);
  if (!normalizedId) {
    return undefined;
  }

  const rows = await database
    .select()
    .from(accountEntries)
    .where(
      and(
        eq(accountEntries.id, normalizedId),
        eq(accountEntries.householdId, context.householdId),
      ),
    )
    .limit(1);

  return rows[0];
}

/** Maps a missing/cross-tenant account to the stable public error. */
export async function getAccountForContext(
  database: TransactionReferenceExecutor,
  context: FinancialContext,
  accountId: unknown,
): Promise<AccountRecord> {
  const account = await findAccountForContext(database, context, accountId);
  if (!account) {
    throw new S03DomainError("ACCOUNT_NOT_FOUND", "accountId");
  }
  return account;
}

/** Maps a missing/cross-tenant category to the stable public error. */
export async function getCategoryForContext(
  database: TransactionReferenceExecutor,
  context: FinancialContext,
  categoryId: unknown,
): Promise<CategoryRecord> {
  const category = await findCategoryForContext(database, context, categoryId);
  if (!category) {
    throw new S03DomainError("CATEGORY_NOT_FOUND", "categoryId");
  }
  return category;
}

/** Maps a missing/cross-tenant event to the stable public error. */
export async function getFinancialEventForContext(
  database: TransactionReferenceExecutor,
  context: FinancialContext,
  financialEventId: unknown,
): Promise<FinancialEventRecord> {
  const event = await findFinancialEventForContext(
    database,
    context,
    financialEventId,
  );
  if (!event) {
    throw new S03DomainError("EVENT_NOT_FOUND", "financialEventId");
  }
  return event;
}

/**
 * Entries are internal effects rather than a public command resource. Their
 * opaque missing result is therefore represented by EVENT_NOT_FOUND, the
 * only stable S03 resource code available at the transaction boundary.
 */
export async function getAccountEntryForContext(
  database: TransactionReferenceExecutor,
  context: FinancialContext,
  accountEntryId: unknown,
): Promise<AccountEntryRecord> {
  const entry = await findAccountEntryForContext(
    database,
    context,
    accountEntryId,
  );
  if (!entry) {
    throw new S03DomainError("EVENT_NOT_FOUND", "financialEventId");
  }
  return entry;
}

/**
 * Loads all references and applies the T02 invariants against records already
 * restricted by household_id. The domain validator still checks the tenant
 * fields, making accidental cross-tenant fixtures fail closed as well.
 */
export async function validateManualTransactionReferencesForContext(
  database: TransactionReferenceExecutor,
  context: FinancialContext,
  input: ManualTransactionReferenceInput,
): Promise<ValidatedManualTransactionReferences> {
  assertFinancialContext(context);

  const account = await getAccountForContext(
    database,
    context,
    input.accountId,
  );
  const category =
    input.categoryId === undefined || input.categoryId === null
      ? null
      : await getCategoryForContext(database, context, input.categoryId);

  const validated = assertManualTransactionReferences({
    householdId: context.householdId,
    accountId: input.accountId,
    account: toAccountReference(account),
    categoryId: input.categoryId,
    category: category ? toCategoryReference(category) : null,
    occurredOn: input.occurredOn,
    kind: input.kind,
  });

  return {
    occurredOn: validated.occurredOn,
    account,
    category,
  };
}

/**
 * Inserts an event with householdId derived from context. The spread order is
 * intentional: even an untyped caller trying to smuggle householdId cannot
 * overwrite the server-resolved tenant.
 */
export async function insertFinancialEventForContext(
  database: TransactionReferenceExecutor,
  context: FinancialContext,
  values: FinancialEventInsertValues,
): Promise<FinancialEventRecord> {
  assertFinancialContext(context);
  const rows = await database
    .insert(financialEvents)
    .values({
      ...values,
      householdId: context.householdId,
    })
    .returning();
  const event = rows[0];
  if (!event) {
    throw new Error("A criação do evento financeiro não retornou uma linha.");
  }
  return event;
}

/** Inserts an entry with householdId derived from context. */
export async function insertAccountEntryForContext(
  database: TransactionReferenceExecutor,
  context: FinancialContext,
  values: AccountEntryInsertValues,
): Promise<AccountEntryRecord> {
  assertFinancialContext(context);
  const rows = await database
    .insert(accountEntries)
    .values({
      ...values,
      householdId: context.householdId,
    })
    .returning();
  const entry = rows[0];
  if (!entry) {
    throw new Error("A criação do entry não retornou uma linha.");
  }
  return entry;
}

export interface TransactionReferenceAccess {
  findAccountById(
    accountId: string,
    options?: TransactionReferenceAccessOptions,
  ): Promise<AccountRecord | null>;
  getAccountById(
    accountId: string,
    options?: TransactionReferenceAccessOptions,
  ): Promise<AccountRecord>;
  findCategoryById(
    categoryId: string | null | undefined,
    options?: TransactionReferenceAccessOptions,
  ): Promise<CategoryRecord | null>;
  getCategoryById(
    categoryId: string,
    options?: TransactionReferenceAccessOptions,
  ): Promise<CategoryRecord>;
  findFinancialEventById(
    financialEventId: string,
    options?: TransactionReferenceAccessOptions,
  ): Promise<FinancialEventRecord | null>;
  getFinancialEventById(
    financialEventId: string,
    options?: TransactionReferenceAccessOptions,
  ): Promise<FinancialEventRecord>;
  findAccountEntryById(
    accountEntryId: string,
    options?: TransactionReferenceAccessOptions,
  ): Promise<AccountEntryRecord | null>;
  getAccountEntryById(
    accountEntryId: string,
    options?: TransactionReferenceAccessOptions,
  ): Promise<AccountEntryRecord>;
  validateManualTransactionReferences(
    input: ManualTransactionReferenceInput,
    options?: TransactionReferenceAccessOptions,
  ): Promise<ValidatedManualTransactionReferences>;
}

/**
 * Server-only access facade. Each public method resolves the authenticated
 * household through requireFinancialContext (via withFinancialContext).
 */
export function createTransactionReferenceAccess(
  database?: Database,
): TransactionReferenceAccess {
  return {
    async findAccountById(accountId, options = {}) {
      const row = await withFinancialContext(
        (context) =>
          findAccountForContext(resolveDatabase(database), context, accountId),
        options,
      );
      return row ?? null;
    },

    async getAccountById(accountId, options = {}) {
      return withFinancialContext(
        (context) =>
          getAccountForContext(resolveDatabase(database), context, accountId),
        options,
      );
    },

    async findCategoryById(categoryId, options = {}) {
      const row = await withFinancialContext(
        async (context) =>
          categoryId === undefined || categoryId === null
            ? null
            : findCategoryForContext(
                resolveDatabase(database),
                context,
                categoryId,
              ),
        options,
      );
      return row ?? null;
    },

    async getCategoryById(categoryId, options = {}) {
      return withFinancialContext(
        (context) =>
          getCategoryForContext(resolveDatabase(database), context, categoryId),
        options,
      );
    },

    async findFinancialEventById(financialEventId, options = {}) {
      const row = await withFinancialContext(
        (context) =>
          findFinancialEventForContext(
            resolveDatabase(database),
            context,
            financialEventId,
          ),
        options,
      );
      return row ?? null;
    },

    async getFinancialEventById(financialEventId, options = {}) {
      return withFinancialContext(
        (context) =>
          getFinancialEventForContext(
            resolveDatabase(database),
            context,
            financialEventId,
          ),
        options,
      );
    },

    async findAccountEntryById(accountEntryId, options = {}) {
      const row = await withFinancialContext(
        (context) =>
          findAccountEntryForContext(
            resolveDatabase(database),
            context,
            accountEntryId,
          ),
        options,
      );
      return row ?? null;
    },

    async getAccountEntryById(accountEntryId, options = {}) {
      return withFinancialContext(
        (context) =>
          getAccountEntryForContext(
            resolveDatabase(database),
            context,
            accountEntryId,
          ),
        options,
      );
    },

    async validateManualTransactionReferences(input, options = {}) {
      return withFinancialContext(
        (context) =>
          validateManualTransactionReferencesForContext(
            resolveDatabase(database),
            context,
            input,
          ),
        options,
      );
    },
  };
}

export const transactionReferenceAccess = createTransactionReferenceAccess();

/** Function aliases for small server actions and use-case composition. */
export const findTransactionAccount = (
  accountId: string,
  options?: TransactionReferenceAccessOptions,
) => transactionReferenceAccess.findAccountById(accountId, options);
export const getTransactionAccount = (
  accountId: string,
  options?: TransactionReferenceAccessOptions,
) => transactionReferenceAccess.getAccountById(accountId, options);
export const findTransactionCategory = (
  categoryId: string | null | undefined,
  options?: TransactionReferenceAccessOptions,
) => transactionReferenceAccess.findCategoryById(categoryId, options);
export const getTransactionCategory = (
  categoryId: string,
  options?: TransactionReferenceAccessOptions,
) => transactionReferenceAccess.getCategoryById(categoryId, options);
export const findTransactionEvent = (
  financialEventId: string,
  options?: TransactionReferenceAccessOptions,
) => transactionReferenceAccess.findFinancialEventById(financialEventId, options);
export const getTransactionEvent = (
  financialEventId: string,
  options?: TransactionReferenceAccessOptions,
) => transactionReferenceAccess.getFinancialEventById(financialEventId, options);
export const findTransactionEntry = (
  accountEntryId: string,
  options?: TransactionReferenceAccessOptions,
) => transactionReferenceAccess.findAccountEntryById(accountEntryId, options);
export const getTransactionEntry = (
  accountEntryId: string,
  options?: TransactionReferenceAccessOptions,
) => transactionReferenceAccess.getAccountEntryById(accountEntryId, options);
