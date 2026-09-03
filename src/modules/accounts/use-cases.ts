import { createHash } from "node:crypto";

import {
  and,
  asc,
  eq,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  accounts,
  applicationCommands,
  type AccountRecord,
  type ApplicationCommandRecord,
} from "@/db/accounts-categories-schema";
import { generateUuidV7 } from "@/lib/uuidv7";
import {
  assertFinancialContext,
} from "@/modules/households/tenant-scoped";
import type { FinancialContext } from "@/modules/households/contracts";

import type { AccountsUseCasePort } from "../accounts-categories/adapters";
import {
  AccountsCategoriesDomainError,
  failure,
  ok,
  type AccountReadModel,
  type ArchiveAccountCommand,
  type CreateAccountCommand,
  type ListAccountsQuery,
  type ListAccountsReadModel,
  type AccountsCategoriesError,
  type AccountsCategoriesResult,
  type UpdateAccountCommand,
} from "../accounts-categories/contracts";
import {
  applyAccountDefaults,
  assertAccountCanArchive,
  parseArchiveAccountCommand,
  parseCreateAccountCommand,
  parseListAccountsQuery,
  parseUpdateAccountCommand,
} from "../accounts-categories/validation";

/** Stable persistence operation names defined by ADR-003. */
export const ACCOUNT_COMMAND_OPERATIONS = {
  create: "accounts.create",
  update: "accounts.update",
  archive: "accounts.archive",
} as const;

export type AccountCommandOperation =
  (typeof ACCOUNT_COMMAND_OPERATIONS)[keyof typeof ACCOUNT_COMMAND_OPERATIONS];

/**
 * Drizzle exposes the transaction type through the callback parameter. Keep
 * this alias in one place so both node-postgres and Neon databases can use
 * the same use-case implementation without a repository-specific cast.
 */
export type AccountTransaction =
  Parameters<NonNullable<ReturnType<typeof getDb>["transaction"]>>[0] extends (
    transaction: infer T,
  ) => Promise<unknown>
    ? T
    : never;

type AccountWriteTransaction = AccountTransaction;

/** A database can be injected by integration tests; production stays lazy. */
export interface AccountsUseCaseOptions {
  database?: Database;
}

export type AccountsUseCases = AccountsUseCasePort;

function resolveDatabase(database?: Database): Database {
  return database ?? getDb();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function hashPayload(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function unwrapErrorCode(error: unknown): string | undefined {
  let candidate: unknown = error;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "code" in candidate &&
      typeof (candidate as { code?: unknown }).code === "string"
    ) {
      return (candidate as { code: string }).code;
    }

    if (
      !candidate ||
      typeof candidate !== "object" ||
      !("cause" in candidate)
    ) {
      return undefined;
    }

    candidate = (candidate as { cause?: unknown }).cause;
  }

  return undefined;
}

function unwrapConstraint(error: unknown): string | undefined {
  let candidate: unknown = error;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "constraint" in candidate &&
      typeof (candidate as { constraint?: unknown }).constraint === "string"
    ) {
      return (candidate as { constraint: string }).constraint;
    }

    if (
      !candidate ||
      typeof candidate !== "object" ||
      !("cause" in candidate)
    ) {
      return undefined;
    }

    candidate = (candidate as { cause?: unknown }).cause;
  }

  return undefined;
}

function mapAccountPersistenceError(error: unknown): AccountsCategoriesDomainError | null {
  if (error instanceof AccountsCategoriesDomainError) {
    return error;
  }

  // PostgreSQL's unique violation is expected when two requests race to use
  // the same normalized account name. The constraint name keeps unrelated
  // infrastructure failures out of the stable S02 error envelope.
  if (
    unwrapErrorCode(error) === "23505" &&
    unwrapConstraint(error) === "accounts_household_name_ci_uq"
  ) {
    return new AccountsCategoriesDomainError("ACCOUNT_NAME_CONFLICT", "name");
  }

  return null;
}

async function toResult<T>(operation: () => Promise<T>): Promise<AccountsCategoriesResult<T>> {
  try {
    return ok(await operation());
  } catch (error) {
    const expected = mapAccountPersistenceError(error);
    if (expected) {
      return failure(expected.code, expected.field);
    }

    // Unexpected failures intentionally escape this layer. The Server Action
    // and observability boundary own logging/sanitization for those failures.
    throw error;
  }
}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toAccountReadModel(row: AccountRecord): AccountReadModel {
  return {
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    type: row.type,
    status: row.status,
    spendability: row.spendability,
    liquidity: row.liquidity,
    includeInNetWorth: row.includeInNetWorth,
    trackingStartedOn: row.trackingStartedOn,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  };
}

function accountCommandPayload(command: CreateAccountCommand): object {
  return {
    name: command.name,
    type: command.type,
    spendability: command.spendability,
    liquidity: command.liquidity,
    includeInNetWorth: command.includeInNetWorth,
  };
}

function accountUpdatePayload(command: UpdateAccountCommand): object {
  return {
    accountId: command.accountId,
    ...(command.name === undefined ? {} : { name: command.name }),
    ...(command.spendability === undefined
      ? {}
      : { spendability: command.spendability }),
    ...(command.liquidity === undefined ? {} : { liquidity: command.liquidity }),
    ...(command.includeInNetWorth === undefined
      ? {}
      : { includeInNetWorth: command.includeInNetWorth }),
  };
}

function accountArchivePayload(command: ArchiveAccountCommand): object {
  return { accountId: command.accountId };
}

function resourceIdFromCommand(
  record: ApplicationCommandRecord,
): string {
  if (!record.resourceId) {
    throw new Error("O registro de idempotência não possui recurso associado.");
  }

  return record.resourceId;
}

async function findAccount(
  transaction: AccountWriteTransaction,
  context: FinancialContext,
  accountId: string,
  lock = false,
): Promise<AccountRecord | undefined> {
  const predicate = and(
    eq(accounts.id, accountId),
    // The resource identifier is never sufficient authorization. Every read
    // and write carries the server-resolved household predicate.
    eq(accounts.householdId, context.householdId),
  );

  if (lock) {
    const rows = await transaction
      .select()
      .from(accounts)
      .where(predicate)
      .limit(1)
      .for("update");
    return rows[0];
  }

  const rows = await transaction
    .select()
    .from(accounts)
    .where(predicate)
    .limit(1);
  return rows[0];
}

async function hasAccountNameConflict(
  transaction: AccountWriteTransaction,
  context: FinancialContext,
  name: string,
  exceptAccountId?: string,
): Promise<boolean> {
  const predicates = [
    eq(accounts.householdId, context.householdId),
    sql`lower(${accounts.name}) = lower(${name})`,
  ];

  if (exceptAccountId !== undefined) {
    predicates.push(ne(accounts.id, exceptAccountId));
  }

  const rows = await transaction
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(...predicates))
    .limit(1);

  return rows.length > 0;
}

/**
 * Atomically claims a command ID before the domain write. A conflicting
 * insert waits for the first transaction and then observes its committed
 * resource ID, which makes concurrent retries safe as well as sequential
 * retries.
 */
async function reserveCommand(
  transaction: AccountWriteTransaction,
  context: FinancialContext,
  commandId: string,
  operation: AccountCommandOperation,
  payloadHash: string,
  resourceId: string,
): Promise<{ created: true } | { created: false; record: ApplicationCommandRecord }> {
  const inserted = await transaction
    .insert(applicationCommands)
    .values({
      householdId: context.householdId,
      commandId,
      operation,
      payloadHash,
      resourceId,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) {
    return { created: true };
  }

  const existing = await transaction
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
  const record = existing[0];

  if (!record) {
    // This should be unreachable after ON CONFLICT unless the database has
    // been externally modified. Preserve it as an unexpected failure.
    throw new Error("O registro de idempotência não foi encontrado após conflito.");
  }

  if (record.operation !== operation || record.payloadHash !== payloadHash) {
    throw new AccountsCategoriesDomainError("COMMAND_ID_REUSED", "commandId");
  }

  if (!record.resourceId) {
    throw new Error("O registro de idempotência não possui recurso associado.");
  }

  return { created: false, record };
}

async function executeCreate(
  database: Database,
  context: FinancialContext,
  input: CreateAccountCommand,
): Promise<AccountReadModel> {
  const parsed = applyAccountDefaults(parseCreateAccountCommand(input));
  // A CREDIT_CARD account is a specialized aggregate. Creating it through
  // the generic account path would leave it without credit_cards/billing-rule
  // rows, so callers must use the atomic S06 card command.
  if (parsed.type === "CREDIT_CARD") {
    throw new AccountsCategoriesDomainError("CREDIT_CARD_REQUIRES_CONFIGURATION", "type");
  }
  const id = generateUuidV7();
  const payloadHash = hashPayload(accountCommandPayload(parsed));

  return database.transaction(async (transaction) => {
    const reservation = await reserveCommand(
      transaction,
      context,
      parsed.commandId,
      ACCOUNT_COMMAND_OPERATIONS.create,
      payloadHash,
      id,
    );

    if (!reservation.created) {
      const existing = await findAccount(
        transaction,
        context,
        resourceIdFromCommand(reservation.record),
      );
      if (!existing) {
        throw new Error("O recurso da operação de conta não foi encontrado.");
      }
      return toAccountReadModel(existing);
    }

    if (
      await hasAccountNameConflict(transaction, context, parsed.name)
    ) {
      throw new AccountsCategoriesDomainError("ACCOUNT_NAME_CONFLICT", "name");
    }

    const rows = await transaction
      .insert(accounts)
      .values({
        id,
        householdId: context.householdId,
        name: parsed.name,
        type: parsed.type,
        status: "ACTIVE",
        spendability: parsed.spendability,
        liquidity: parsed.liquidity,
        includeInNetWorth: parsed.includeInNetWorth,
        trackingStartedOn: null,
      })
      .returning();
    const row = rows[0];

    if (!row) {
      throw new Error("A criação da conta não retornou uma linha.");
    }

    return toAccountReadModel(row);
  });
}

async function executeList(
  database: Database,
  context: FinancialContext,
  input: ListAccountsQuery | undefined,
): Promise<ListAccountsReadModel> {
  const query = parseListAccountsQuery(input ?? {});
  const predicates: SQL<unknown>[] = [
    eq(accounts.householdId, context.householdId),
  ];
  const status = query.status ?? "ACTIVE";

  if (status !== "ALL") {
    predicates.push(eq(accounts.status, status));
  }

  const rows = await database
    .select()
    .from(accounts)
    .where(and(...predicates))
    .orderBy(sql`lower(${accounts.name})`, asc(accounts.id));

  return { items: rows.map(toAccountReadModel) };
}

async function executeUpdate(
  database: Database,
  context: FinancialContext,
  input: UpdateAccountCommand,
): Promise<AccountReadModel> {
  const command = parseUpdateAccountCommand(input);
  const payloadHash = hashPayload(accountUpdatePayload(command));

  return database.transaction(async (transaction) => {
    const reservation = await reserveCommand(
      transaction,
      context,
      command.commandId,
      ACCOUNT_COMMAND_OPERATIONS.update,
      payloadHash,
      command.accountId,
    );

    if (!reservation.created) {
      const existing = await findAccount(
        transaction,
        context,
        resourceIdFromCommand(reservation.record),
      );
      if (!existing) {
        throw new AccountsCategoriesDomainError("ACCOUNT_NOT_FOUND", "accountId");
      }
      return toAccountReadModel(existing);
    }

    const current = await findAccount(
      transaction,
      context,
      command.accountId,
      true,
    );
    if (!current) {
      throw new AccountsCategoriesDomainError("ACCOUNT_NOT_FOUND", "accountId");
    }

    if (current.type === "CREDIT_CARD") {
      throw new AccountsCategoriesDomainError("CREDIT_CARD_REQUIRES_CONFIGURATION", "accountId");
    }

    assertAccountCanArchive(current.status);

    if (
      command.name !== undefined &&
      (await hasAccountNameConflict(
        transaction,
        context,
        command.name,
        current.id,
      ))
    ) {
      throw new AccountsCategoriesDomainError("ACCOUNT_NAME_CONFLICT", "name");
    }

    const rows = await transaction
      .update(accounts)
      .set({
        ...(command.name === undefined ? {} : { name: command.name }),
        ...(command.spendability === undefined
          ? {}
          : { spendability: command.spendability }),
        ...(command.liquidity === undefined
          ? {}
          : { liquidity: command.liquidity }),
        ...(command.includeInNetWorth === undefined
          ? {}
          : { includeInNetWorth: command.includeInNetWorth }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(accounts.id, command.accountId),
          eq(accounts.householdId, context.householdId),
        ),
      )
      .returning();
    const row = rows[0];

    if (!row) {
      throw new AccountsCategoriesDomainError("ACCOUNT_NOT_FOUND", "accountId");
    }

    return toAccountReadModel(row);
  });
}

async function executeArchive(
  database: Database,
  context: FinancialContext,
  input: ArchiveAccountCommand,
): Promise<AccountReadModel> {
  const command = parseArchiveAccountCommand(input);
  const payloadHash = hashPayload(accountArchivePayload(command));

  return database.transaction(async (transaction) => {
    const reservation = await reserveCommand(
      transaction,
      context,
      command.commandId,
      ACCOUNT_COMMAND_OPERATIONS.archive,
      payloadHash,
      command.accountId,
    );

    if (!reservation.created) {
      const existing = await findAccount(
        transaction,
        context,
        resourceIdFromCommand(reservation.record),
      );
      if (!existing) {
        throw new AccountsCategoriesDomainError("ACCOUNT_NOT_FOUND", "accountId");
      }
      return toAccountReadModel(existing);
    }

    const current = await findAccount(
      transaction,
      context,
      command.accountId,
      true,
    );
    if (!current) {
      throw new AccountsCategoriesDomainError("ACCOUNT_NOT_FOUND", "accountId");
    }

    if (current.type === "CREDIT_CARD") {
      throw new AccountsCategoriesDomainError("CREDIT_CARD_REQUIRES_CONFIGURATION", "accountId");
    }

    assertAccountCanArchive(current.status);

    const rows = await transaction
      .update(accounts)
      .set({ status: "ARCHIVED", updatedAt: new Date() })
      .where(
        and(
          eq(accounts.id, command.accountId),
          eq(accounts.householdId, context.householdId),
        ),
      )
      .returning();
    const row = rows[0];

    if (!row) {
      throw new AccountsCategoriesDomainError("ACCOUNT_NOT_FOUND", "accountId");
    }

    return toAccountReadModel(row);
  });
}

function parseAccountContext(context: FinancialContext): void {
  // The type alone is not an authorization boundary; protect direct use-case
  // callers in addition to the Server Action adapter.
  assertFinancialContext(context);
}

function isDatabase(value: unknown): value is Database {
  return (
    typeof value === "object" &&
    value !== null &&
    "select" in value &&
    "transaction" in value
  );
}

function toAccountOptions(
  databaseOrOptions: Database | AccountsUseCaseOptions | undefined,
  options: Omit<AccountsUseCaseOptions, "database"> = {},
): AccountsUseCaseOptions {
  if (isDatabase(databaseOrOptions)) {
    return { ...options, database: databaseOrOptions };
  }

  return databaseOrOptions ?? options;
}

/** Builds the tenant-scoped, transactional account use cases. */
export function createAccountsUseCases(
  database?: Database,
): AccountsUseCases;
export function createAccountsUseCases(
  database: Database,
  options?: Omit<AccountsUseCaseOptions, "database">,
): AccountsUseCases;
export function createAccountsUseCases(
  options?: AccountsUseCaseOptions,
): AccountsUseCases;
export function createAccountsUseCases(
  databaseOrOptions?: Database | AccountsUseCaseOptions,
): AccountsUseCases;
export function createAccountsUseCases(
  databaseOrOptions?: Database | AccountsUseCaseOptions,
  options: Omit<AccountsUseCaseOptions, "database"> = {},
): AccountsUseCases {
  const resolvedDatabase = toAccountOptions(databaseOrOptions, options).database;

  return {
    async create(context, command) {
      parseAccountContext(context);
      return toResult(() =>
        executeCreate(resolveDatabase(resolvedDatabase), context, command),
      );
    },

    async list(context, query) {
      parseAccountContext(context);
      return toResult(() =>
        executeList(resolveDatabase(resolvedDatabase), context, query),
      );
    },

    async update(context, command) {
      parseAccountContext(context);
      return toResult(() =>
        executeUpdate(resolveDatabase(resolvedDatabase), context, command),
      );
    },

    async archive(context, command) {
      parseAccountContext(context);
      return toResult(() =>
        executeArchive(resolveDatabase(resolvedDatabase), context, command),
      );
    },
  };
}

/** Singular/plural aliases keep the factory discoverable at call sites. */
export const createAccountUseCases = createAccountsUseCases;
export const createAccountUseCase = createAccountsUseCases;
export const createAccountUseCasePort = createAccountsUseCases;
export const createAccountsUseCasePort = createAccountsUseCases;

/** Lazily resolved default port for server composition and Server Actions. */
export const accountsUseCases = createAccountsUseCases();
export const accountUseCases = accountsUseCases;
export const accountUseCasePort = accountsUseCases;
export const accountsUseCasePort = accountsUseCases;

/** Convenience functions for callers that do not need to retain a port. */
export async function createAccount(
  context: FinancialContext,
  command: CreateAccountCommand,
  databaseOrOptions?: Database | AccountsUseCaseOptions,
): Promise<AccountsCategoriesResult<AccountReadModel>> {
  return createAccountsUseCases(databaseOrOptions).create(context, command);
}

export async function listAccounts(
  context: FinancialContext,
  query: ListAccountsQuery = {},
  databaseOrOptions?: Database | AccountsUseCaseOptions,
): Promise<AccountsCategoriesResult<ListAccountsReadModel>> {
  return createAccountsUseCases(databaseOrOptions).list(context, query);
}

export async function updateAccount(
  context: FinancialContext,
  command: UpdateAccountCommand,
  databaseOrOptions?: Database | AccountsUseCaseOptions,
): Promise<AccountsCategoriesResult<AccountReadModel>> {
  return createAccountsUseCases(databaseOrOptions).update(context, command);
}

export async function archiveAccount(
  context: FinancialContext,
  command: ArchiveAccountCommand,
  databaseOrOptions?: Database | AccountsUseCaseOptions,
): Promise<AccountsCategoriesResult<AccountReadModel>> {
  return createAccountsUseCases(databaseOrOptions).archive(context, command);
}

export const CreateAccount = createAccount;
export const ListAccounts = listAccounts;
export const UpdateAccount = updateAccount;
export const ArchiveAccount = archiveAccount;

/** Type guard useful to consumers that only handle expected account errors. */
export function isAccountResultError(
  result: AccountsCategoriesResult<unknown>,
): result is { ok: false; error: AccountsCategoriesError } {
  return !result.ok;
}

/** Re-exported for tests and composition layers that inspect persistence rows. */
export type { AccountRecord };
