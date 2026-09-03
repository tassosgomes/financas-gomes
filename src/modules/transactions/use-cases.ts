import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  applicationCommands,
  categories,
  type ApplicationCommandRecord,
  type CategoryRecord,
} from "@/db/accounts-categories-schema";
import {
  accountEntries,
  financialEvents,
  type AccountEntryRecord,
  type FinancialEventRecord,
} from "@/db/financial-events-schema";
import { generateUuidV7 } from "@/lib/uuidv7";
import type { FinancialContext } from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";

import {
  ACCOUNT_ENTRY_STATUSES,
  CANCEL_MANUAL_TRANSACTION_OPERATION,
  CREATE_EXPENSE_OPERATION,
  CREATE_INCOME_OPERATION,
  failure,
  FINANCIAL_EVENT_STATUSES,
  MANUAL_TRANSACTION_ORIGIN,
  ok,
  REVERSAL_EVENT_KIND,
  TransactionDomainError,
  SYSTEM_REVERSAL_ORIGIN,
  UPDATE_MANUAL_TRANSACTION_OPERATION,
  type CancelManualTransactionCommand,
  type CreateExpenseCommand,
  type CreateIncomeCommand,
  type FinancialEventKind,
  type ManualTransactionKind,
  type ManualTransactionReadModel,
  type TransactionResult,
  type TransactionOperation,
  type UpdateManualTransactionCommand,
} from "./contracts";
import {
  assertCategoryReference,
  assertManualEventCanCancel,
  assertManualEventCanUpdate,
  formatFinancialDate,
  Money,
  type FinancialDate,
} from "./domain";
import {
  insertAccountEntryForContext,
  insertFinancialEventForContext,
  validateManualTransactionReferencesForContext,
  type TransactionReferenceTransaction,
} from "./references";
import {
  parseCancelManualTransactionCommand,
  parseCreateExpenseCommand,
  parseCreateIncomeCommand,
  parseUpdateManualTransactionCommand,
} from "./validation";

/**
 * Drizzle exposes the transaction session through the callback parameter.
 * Reusing T04's alias keeps this use case independent of a concrete driver.
 */
export type TransactionWriteTransaction = TransactionReferenceTransaction;

/** Database and deterministic date options used by tests/composition. */
export interface TransactionsUseCaseOptions {
  /** Injectable only for tests/composition; production resolves lazily. */
  database?: Database;
  /** Server business date used to reject a future POSTED date. */
  today?: FinancialDate | string;
}

export interface TransactionsCreateUseCases {
  createExpense(
    context: FinancialContext,
    command: CreateExpenseCommand,
  ): Promise<TransactionResult<ManualTransactionReadModel>>;
  createIncome(
    context: FinancialContext,
    command: CreateIncomeCommand,
  ): Promise<TransactionResult<ManualTransactionReadModel>>;
}

export interface TransactionsMaintenanceUseCases {
  updateManualTransaction(
    context: FinancialContext,
    command: UpdateManualTransactionCommand,
  ): Promise<TransactionResult<ManualTransactionReadModel>>;
  cancelManualTransaction(
    context: FinancialContext,
    command: CancelManualTransactionCommand,
  ): Promise<TransactionResult<ManualTransactionReadModel>>;
  /** Short aliases for adapters that expose generic transaction mutations. */
  update(
    context: FinancialContext,
    command: UpdateManualTransactionCommand,
  ): Promise<TransactionResult<ManualTransactionReadModel>>;
  cancel(
    context: FinancialContext,
    command: CancelManualTransactionCommand,
  ): Promise<TransactionResult<ManualTransactionReadModel>>;
}

/** Complete T05 + T07 port used by production composition. */
export type TransactionsUseCases =
  TransactionsCreateUseCases & TransactionsMaintenanceUseCases;

/** Explicit port consumed by a Server Action adapter. */
export type TransactionsUseCasePort = TransactionsCreateUseCases;
/** T07 maintenance port consumed by the detail/cancel adapters. */
export type TransactionsMaintenanceUseCasePort = TransactionsMaintenanceUseCases;

type CommandClaim =
  | { created: true }
  | { created: false; record: ApplicationCommandRecord };

type CreatedEventKind = Exclude<FinancialEventKind, "REVERSAL">;

const EXPECTED_MANUAL_EVENT_ORIGIN = MANUAL_TRANSACTION_ORIGIN;
const EXPECTED_POSTED_STATUS = FINANCIAL_EVENT_STATUSES[0];
const EXPECTED_ENTRY_STATUS = ACCOUNT_ENTRY_STATUSES[0];

function resolveDatabase(database?: Database): Database {
  return database ?? getDb();
}

/**
 * Canonical JSON is intentionally small and deterministic because all values
 * in a create command are already strings or null after Zod parsing.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function hashOperationPayload(
  operation: TransactionOperation,
  payload: unknown,
): string {
  // commandId identifies the idempotency slot and is deliberately not part
  // of the effective payload being compared for a retry.
  return createHash("sha256")
    .update(canonicalJson({ operation, payload }), "utf8")
    .digest("hex");
}

function createPayload(
  command: CreateExpenseCommand | CreateIncomeCommand,
): object {
  return {
    accountId: command.accountId,
    amountCents: command.amountCents,
    categoryId: command.categoryId ?? null,
    description: command.description,
    occurredOn: command.occurredOn,
  };
}

function updatePayload(command: UpdateManualTransactionCommand): object {
  return {
    financialEventId: command.financialEventId,
    ...(command.description === undefined
      ? {}
      : { description: command.description }),
    ...(command.categoryId === undefined
      ? {}
      : { categoryId: command.categoryId }),
  };
}

function cancelPayload(command: CancelManualTransactionCommand): object {
  return { financialEventId: command.financialEventId };
}

function resourceIdFromCommand(record: ApplicationCommandRecord): string {
  if (!record.resourceId) {
    throw new Error("O registro de idempotência não possui recurso associado.");
  }
  return record.resourceId;
}

/**
 * Claims the tenant-scoped command before the financial writes. PostgreSQL
 * waits on a concurrent primary-key conflict, and the row lock then makes
 * the committed resource ID visible to a retry.
 */
async function reserveCommand(
  transaction: TransactionWriteTransaction,
  context: FinancialContext,
  commandId: string,
  operation: TransactionOperation,
  hash: string,
  resourceId: string,
): Promise<CommandClaim> {
  const inserted = await transaction
    .insert(applicationCommands)
    .values({
      householdId: context.householdId,
      commandId,
      operation,
      payloadHash: hash,
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
    // This is unreachable after ON CONFLICT unless an external actor removed
    // the row. It is an invariant/infra failure, not a public domain error.
    throw new Error("O registro de idempotência não foi encontrado após conflito.");
  }

  if (record.operation !== operation || record.payloadHash !== hash) {
    throw new TransactionDomainError("COMMAND_ID_REUSED", "commandId");
  }

  if (!record.resourceId) {
    throw new Error("O registro de idempotência não possui recurso associado.");
  }

  return { created: false, record };
}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function assertCreatedEvent(
  event: FinancialEventRecord,
): asserts event is FinancialEventRecord & {
  kind: CreatedEventKind;
  origin: "MANUAL";
  status: "POSTED" | "CANCELLED";
} {
  if (
    event.origin !== EXPECTED_MANUAL_EVENT_ORIGIN ||
    (event.kind !== "EXPENSE" && event.kind !== "INCOME") ||
    (event.status !== "POSTED" && event.status !== "CANCELLED")
  ) {
    throw new Error("O evento associado ao command não é um lançamento manual válido.");
  }
}

function assertPostedEntry(
  entry: AccountEntryRecord,
): asserts entry is AccountEntryRecord & {
  status: "POSTED";
  postedOn: string;
} {
  if (
    entry.status !== EXPECTED_ENTRY_STATUS ||
    entry.postedOn === null ||
    entry.expectedOn !== null
  ) {
    throw new Error("O entry associado ao command não é um efeito POSTED válido.");
  }
}

function toReversalReadModel(
  reversal: FinancialEventRecord,
): ManualTransactionReadModel["reversal"] {
  if (
    reversal.kind !== "REVERSAL" ||
    reversal.origin !== "SYSTEM" ||
    reversal.status !== "POSTED"
  ) {
    throw new Error("O reversal associado ao lançamento não é válido.");
  }

  return {
    id: reversal.id,
    amountCents: reversal.amountCents.toString(10),
    origin: "SYSTEM",
    status: "POSTED",
    occurredOn: reversal.occurredOn,
  };
}

function toReadModel(
  event: FinancialEventRecord,
  entry: AccountEntryRecord,
  reversal: FinancialEventRecord | null = null,
): ManualTransactionReadModel {
  assertCreatedEvent(event);
  assertPostedEntry(entry);

  if (event.kind !== "EXPENSE" && event.kind !== "INCOME") {
    throw new Error("Um lançamento manual não pode usar um tipo de reversal.");
  }

  return {
    id: event.id,
    householdId: event.householdId,
    kind: event.kind,
    status: event.status,
    origin: "MANUAL",
    amountCents: event.amountCents.toString(10),
    occurredOn: event.occurredOn,
    description: event.description,
    accountId: entry.accountId,
    categoryId: event.categoryId,
    entry: {
      id: entry.id,
      amountCents: entry.amountCents.toString(10),
      status: "POSTED",
      postedOn: entry.postedOn,
    },
    reversal: reversal ? toReversalReadModel(reversal) : null,
    createdAt: toIsoTimestamp(event.createdAt),
    updatedAt: toIsoTimestamp(event.updatedAt),
  };
}

/**
 * Rehydrates the resource stored in application_commands. The tenant
 * predicate is mandatory even though resourceId is already known, and the
 * two-table read fails closed if an impossible partial record is observed.
 */
async function readCreatedTransaction(
  transaction: TransactionWriteTransaction,
  context: FinancialContext,
  resourceId: string,
): Promise<ManualTransactionReadModel> {
  const eventRows = await transaction
    .select()
    .from(financialEvents)
    .where(
      and(
        eq(financialEvents.id, resourceId),
        eq(financialEvents.householdId, context.householdId),
      ),
    )
    .limit(1);
  const event = eventRows[0];

  if (!event) {
    throw new Error("O evento associado ao command não foi encontrado.");
  }

  const entryRows = await transaction
    .select()
    .from(accountEntries)
    .where(
      and(
        eq(accountEntries.financialEventId, event.id),
        eq(accountEntries.householdId, context.householdId),
      ),
    )
    .limit(2);

  if (entryRows.length !== 1) {
    throw new Error("O lançamento deve possuir exatamente um entry associado.");
  }

  const reversalRows = await transaction
    .select()
    .from(financialEvents)
    .where(
      and(
        eq(financialEvents.reversalOfEventId, event.id),
        eq(financialEvents.householdId, context.householdId),
      ),
    )
    .limit(1);

  return toReadModel(event, entryRows[0], reversalRows[0] ?? null);
}

/** Loads a tenant-scoped event while serializing maintenance mutations. */
async function findFinancialEventForUpdate(
  transaction: TransactionWriteTransaction,
  context: FinancialContext,
  financialEventId: string,
): Promise<FinancialEventRecord | undefined> {
  const rows = await transaction
    .select()
    .from(financialEvents)
    .where(
      and(
        eq(financialEvents.id, financialEventId),
        eq(financialEvents.householdId, context.householdId),
      ),
    )
    .limit(1)
    .for("update");

  return rows[0];
}

/** A reversal relation is historical even if a corrupted row has bad shape. */
async function findAnyReversalForEvent(
  transaction: TransactionWriteTransaction,
  context: FinancialContext,
  financialEventId: string,
): Promise<FinancialEventRecord | undefined> {
  const rows = await transaction
    .select()
    .from(financialEvents)
    .where(
      and(
        eq(financialEvents.householdId, context.householdId),
        eq(financialEvents.reversalOfEventId, financialEventId),
      ),
    )
    .limit(1);

  return rows[0];
}

/** Ensures the original event has exactly one usable historical entry. */
async function findPostedEntryForEvent(
  transaction: TransactionWriteTransaction,
  context: FinancialContext,
  financialEventId: string,
): Promise<AccountEntryRecord> {
  const rows = await transaction
    .select()
    .from(accountEntries)
    .where(
      and(
        eq(accountEntries.financialEventId, financialEventId),
        eq(accountEntries.householdId, context.householdId),
      ),
    )
    .limit(2);

  if (rows.length !== 1) {
    throw new Error("O lançamento manual deve possuir exatamente um entry.");
  }

  const entry = rows[0];
  assertPostedEntry(entry);
  return entry;
}

/** Loads and validates a newly selected category under the current tenant. */
async function findActiveCategoryForUpdate(
  transaction: TransactionWriteTransaction,
  context: FinancialContext,
  categoryId: string,
  kind: ManualTransactionKind,
): Promise<CategoryRecord> {
  const rows = await transaction
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.id, categoryId),
        eq(categories.householdId, context.householdId),
      ),
    )
    .limit(1)
    .for("update");
  const category = rows[0];

  if (!category) {
    throw new TransactionDomainError("CATEGORY_NOT_FOUND", "categoryId");
  }

  assertCategoryReference({
    householdId: context.householdId,
    categoryId,
    category: {
      id: category.id,
      householdId: category.householdId,
      status: category.status,
      kind: category.kind,
    },
    kind,
  });

  return category;
}

/** Rehydrates a cancellation retry from the reversal ID stored in its command. */
async function readCancelledTransaction(
  transaction: TransactionWriteTransaction,
  context: FinancialContext,
  reversalId: string,
): Promise<ManualTransactionReadModel> {
  const rows = await transaction
    .select()
    .from(financialEvents)
    .where(
      and(
        eq(financialEvents.id, reversalId),
        eq(financialEvents.householdId, context.householdId),
        eq(financialEvents.kind, REVERSAL_EVENT_KIND),
        eq(financialEvents.origin, SYSTEM_REVERSAL_ORIGIN),
        eq(financialEvents.status, "POSTED"),
      ),
    )
    .limit(1);
  const reversal = rows[0];

  if (!reversal || !reversal.reversalOfEventId) {
    throw new Error("O reversal associado ao command não foi encontrado.");
  }

  return readCreatedTransaction(
    transaction,
    context,
    reversal.reversalOfEventId,
  );
}

function signedEntryAmount(amount: Money, kind: ManualTransactionKind): bigint {
  return kind === "EXPENSE" ? amount.negate().cents : amount.cents;
}

function parseCreateCommand(
  kind: ManualTransactionKind,
  input: unknown,
  today?: FinancialDate | string,
): CreateExpenseCommand | CreateIncomeCommand {
  return kind === "EXPENSE"
    ? parseCreateExpenseCommand(input, today === undefined ? undefined : { today })
    : parseCreateIncomeCommand(input, today === undefined ? undefined : { today });
}

/**
 * Shared write implementation. The operation-specific public methods below
 * fix the kind and operation, so a client cannot contradict the method name.
 */
async function executeCreate(
  database: Database,
  context: FinancialContext,
  input: unknown,
  kind: ManualTransactionKind,
  operation: TransactionOperation,
  today?: FinancialDate | string,
): Promise<ManualTransactionReadModel> {
  const command = parseCreateCommand(kind, input, today);
  const amount = Money.fromCents(command.amountCents);
  const eventId = generateUuidV7();
  const entryId = generateUuidV7();
  const hash = hashOperationPayload(operation, createPayload(command));

  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(
      transaction,
      context,
      command.commandId,
      operation,
      hash,
      eventId,
    );

    if (!claim.created) {
      return readCreatedTransaction(
        transaction,
        context,
        resourceIdFromCommand(claim.record),
      );
    }

    const references = await validateManualTransactionReferencesForContext(
      transaction,
      context,
      {
        accountId: command.accountId,
        categoryId: command.categoryId,
        occurredOn: command.occurredOn,
        kind,
      },
    );
    const occurredOn = formatFinancialDate(references.occurredOn);

    const event = await insertFinancialEventForContext(transaction, context, {
      id: eventId,
      kind,
      status: EXPECTED_POSTED_STATUS,
      origin: EXPECTED_MANUAL_EVENT_ORIGIN,
      amountCents: amount.cents,
      occurredOn,
      description: command.description,
      categoryId: references.category?.id ?? null,
      reversalOfEventId: null,
    });

    const entry = await insertAccountEntryForContext(transaction, context, {
      id: entryId,
      financialEventId: event.id,
      accountId: references.account.id,
      amountCents: signedEntryAmount(amount, kind),
      status: EXPECTED_ENTRY_STATUS,
      expectedOn: null,
      postedOn: occurredOn,
    });

    return toReadModel(event, entry);
  });
}

/** Updates only the metadata explicitly allowed by ADR-004. */
async function executeUpdateManualTransaction(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<ManualTransactionReadModel> {
  const command = parseUpdateManualTransactionCommand(input);
  const hash = hashOperationPayload(
    UPDATE_MANUAL_TRANSACTION_OPERATION,
    updatePayload(command),
  );

  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(
      transaction,
      context,
      command.commandId,
      UPDATE_MANUAL_TRANSACTION_OPERATION,
      hash,
      command.financialEventId,
    );

    if (!claim.created) {
      return readCreatedTransaction(
        transaction,
        context,
        resourceIdFromCommand(claim.record),
      );
    }

    const event = await findFinancialEventForUpdate(
      transaction,
      context,
      command.financialEventId,
    );
    if (!event) {
      throw new TransactionDomainError("EVENT_NOT_FOUND", "financialEventId");
    }

    assertManualEventCanUpdate({
      householdId: context.householdId,
      financialEventId: command.financialEventId,
      event,
    });
    // Map non-manual resources (including reversals) through the public
    // domain contract before narrowing the read-model shape. This keeps a
    // rejected maintenance command from escaping as a technical error.
    assertCreatedEvent(event);

    const kind: ManualTransactionKind =
      event.kind === "EXPENSE" || event.kind === "INCOME"
        ? event.kind
        : (() => {
            throw new Error("O evento manual possui um tipo inválido.");
          })();

    let categoryId = event.categoryId;
    if (command.categoryId !== undefined) {
      categoryId = command.categoryId;
      if (command.categoryId !== null) {
        const category = await findActiveCategoryForUpdate(
          transaction,
          context,
          command.categoryId,
          kind,
        );
        categoryId = category.id;
      }
    }

    const rows = await transaction
      .update(financialEvents)
      .set({
        ...(command.description === undefined
          ? {}
          : { description: command.description }),
        ...(command.categoryId === undefined ? {} : { categoryId }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(financialEvents.id, event.id),
          eq(financialEvents.householdId, context.householdId),
        ),
      )
      .returning();
    if (!rows[0]) {
      throw new TransactionDomainError("EVENT_NOT_FOUND", "financialEventId");
    }

    return readCreatedTransaction(transaction, context, event.id);
  });
}

/** Cancels a manual event by appending one compensating reversal. */
async function executeCancelManualTransaction(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<ManualTransactionReadModel> {
  const command = parseCancelManualTransactionCommand(input);
  const hash = hashOperationPayload(
    CANCEL_MANUAL_TRANSACTION_OPERATION,
    cancelPayload(command),
  );
  const reversalId = generateUuidV7();
  const reversalEntryId = generateUuidV7();

  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(
      transaction,
      context,
      command.commandId,
      CANCEL_MANUAL_TRANSACTION_OPERATION,
      hash,
      reversalId,
    );

    if (!claim.created) {
      return readCancelledTransaction(
        transaction,
        context,
        resourceIdFromCommand(claim.record),
      );
    }

    const event = await findFinancialEventForUpdate(
      transaction,
      context,
      command.financialEventId,
    );
    if (!event) {
      throw new TransactionDomainError("EVENT_NOT_FOUND", "financialEventId");
    }

    assertManualEventCanCancel({
      householdId: context.householdId,
      financialEventId: command.financialEventId,
      event,
      hasReversal: Boolean(
        await findAnyReversalForEvent(
          transaction,
          context,
          command.financialEventId,
        ),
      ),
    });
    // Reversals and other non-manual facts must return EVENT_NOT_MANUAL from
    // the command boundary, rather than failing the internal read-model
    // assertion below as an unexpected exception.
    assertCreatedEvent(event);

    const originalEntry = await findPostedEntryForEvent(
      transaction,
      context,
      event.id,
    );

    const reversal = await insertFinancialEventForContext(transaction, context, {
      id: reversalId,
      kind: REVERSAL_EVENT_KIND,
      status: "POSTED",
      origin: SYSTEM_REVERSAL_ORIGIN,
      amountCents: event.amountCents,
      occurredOn: event.occurredOn,
      // Keeping the original description makes the compensating fact
      // searchable while origin/kind/relation distinguish it from the intent.
      description: event.description,
      categoryId: event.categoryId,
      reversalOfEventId: event.id,
    });

    await insertAccountEntryForContext(transaction, context, {
      id: reversalEntryId,
      financialEventId: reversal.id,
      accountId: originalEntry.accountId,
      amountCents: -originalEntry.amountCents,
      status: "POSTED",
      expectedOn: null,
      postedOn: event.occurredOn,
    });

    const updatedRows = await transaction
      .update(financialEvents)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(
        and(
          eq(financialEvents.id, event.id),
          eq(financialEvents.householdId, context.householdId),
          eq(financialEvents.status, "POSTED"),
        ),
      )
      .returning();
    if (!updatedRows[0]) {
      throw new TransactionDomainError("EVENT_ALREADY_CANCELLED", "financialEventId");
    }

    return readCreatedTransaction(transaction, context, event.id);
  });
}

function isDatabase(value: unknown): value is Database {
  return (
    typeof value === "object" &&
    value !== null &&
    "select" in value &&
    "transaction" in value
  );
}

function toOptions(
  databaseOrOptions: Database | TransactionsUseCaseOptions | undefined,
): TransactionsUseCaseOptions {
  return isDatabase(databaseOrOptions)
    ? { database: databaseOrOptions }
    : databaseOrOptions ?? {};
}

async function toResult<T>(operation: () => Promise<T>): Promise<TransactionResult<T>> {
  try {
    return ok(await operation());
  } catch (error) {
    if (error instanceof TransactionDomainError) {
      return failure(error.code, error.field);
    }

    // Technical errors intentionally escape. The T08 action adapter owns
    // reportTransactionUnexpectedError and the generic response boundary.
    throw error;
  }
}

function assertContext(context: FinancialContext): void {
  assertFinancialContext(context);
}

/** Builds the tenant-scoped CreateExpense/CreateIncome port. */
export function createTransactionsUseCases(
  database?: Database,
): TransactionsUseCases;
export function createTransactionsUseCases(
  database: Database,
  options?: Omit<TransactionsUseCaseOptions, "database">,
): TransactionsUseCases;
export function createTransactionsUseCases(
  options?: TransactionsUseCaseOptions,
): TransactionsUseCases;
export function createTransactionsUseCases(
  databaseOrOptions?: Database | TransactionsUseCaseOptions,
): TransactionsUseCases;
export function createTransactionsUseCases(
  databaseOrOptions?: Database | TransactionsUseCaseOptions,
  extraOptions: Omit<TransactionsUseCaseOptions, "database"> = {},
): TransactionsUseCases {
  const selected = toOptions(databaseOrOptions);
  const options: TransactionsUseCaseOptions = {
    ...selected,
    ...extraOptions,
  };

  const updateManualTransaction = async (
    context: FinancialContext,
    command: UpdateManualTransactionCommand,
  ): Promise<TransactionResult<ManualTransactionReadModel>> => {
    assertContext(context);
    return toResult(() =>
      executeUpdateManualTransaction(
        resolveDatabase(options.database),
        context,
        command,
      ),
    );
  };

  const cancelManualTransaction = async (
    context: FinancialContext,
    command: CancelManualTransactionCommand,
  ): Promise<TransactionResult<ManualTransactionReadModel>> => {
    assertContext(context);
    return toResult(() =>
      executeCancelManualTransaction(
        resolveDatabase(options.database),
        context,
        command,
      ),
    );
  };

  return {
    async createExpense(context, command) {
      assertContext(context);
      return toResult(() =>
        executeCreate(
          resolveDatabase(options.database),
          context,
          command,
          "EXPENSE",
          CREATE_EXPENSE_OPERATION,
          options.today,
        ),
      );
    },

    async createIncome(context, command) {
      assertContext(context);
      return toResult(() =>
        executeCreate(
          resolveDatabase(options.database),
          context,
          command,
          "INCOME",
          CREATE_INCOME_OPERATION,
          options.today,
        ),
      );
    },

    updateManualTransaction,
    cancelManualTransaction,
    update: updateManualTransaction,
    cancel: cancelManualTransaction,
  };
}

export const createTransactionsUseCase = createTransactionsUseCases;
export const createTransactionUseCases = createTransactionsUseCases;
export const createTransactionUseCase = createTransactionsUseCases;

/** Lazily composed production port; no database connection is opened here. */
export const transactionsUseCases = createTransactionsUseCases();
export const transactionUseCases = transactionsUseCases;
export const transactionUseCasePort = transactionsUseCases;
export const transactionsUseCasePort = transactionsUseCases;

export async function createExpense(
  context: FinancialContext,
  command: CreateExpenseCommand,
  databaseOrOptions?: Database | TransactionsUseCaseOptions,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return createTransactionsUseCases(databaseOrOptions).createExpense(
    context,
    command,
  );
}

export async function createIncome(
  context: FinancialContext,
  command: CreateIncomeCommand,
  databaseOrOptions?: Database | TransactionsUseCaseOptions,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return createTransactionsUseCases(databaseOrOptions).createIncome(
    context,
    command,
  );
}

export async function updateManualTransaction(
  context: FinancialContext,
  command: UpdateManualTransactionCommand,
  databaseOrOptions?: Database | TransactionsUseCaseOptions,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return createTransactionsUseCases(databaseOrOptions).updateManualTransaction(
    context,
    command,
  );
}

export async function cancelManualTransaction(
  context: FinancialContext,
  command: CancelManualTransactionCommand,
  databaseOrOptions?: Database | TransactionsUseCaseOptions,
): Promise<TransactionResult<ManualTransactionReadModel>> {
  return createTransactionsUseCases(databaseOrOptions).cancelManualTransaction(
    context,
    command,
  );
}

export const CreateExpense = createExpense;
export const CreateIncome = createIncome;
export const UpdateManualTransaction = updateManualTransaction;
export const CancelManualTransaction = cancelManualTransaction;
export const createExpenseUseCase = createExpense;
export const createIncomeUseCase = createIncome;
export const updateManualTransactionUseCase = updateManualTransaction;
export const cancelManualTransactionUseCase = cancelManualTransaction;
