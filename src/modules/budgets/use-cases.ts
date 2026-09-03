import { createHash } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  applicationCommands,
  categories,
  type ApplicationCommandRecord,
  type CategoryRecord,
} from "@/db/accounts-categories-schema";
import {
  budgets,
  budgetMovements,
  type BudgetRecord,
} from "@/db/budgets-schema";
import { generateUuidV7 } from "@/lib/uuidv7";
import type { FinancialContext } from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import {
  createS09BudgetOperation,
  measureS09Query,
  withS09BudgetObservability,
  type S09BudgetCompletionOptions,
  type S09BudgetOperationOptions,
  type S09BudgetOperationContext,
  type S09BudgetQueryOptions,
} from "@/modules/observability/s09";

import {
  budgetBoundarySchema,
  closeBudgetCommandSchema,
  createBudgetCommandSchema,
  updateBudgetCommandSchema,
  BudgetDomainError,
  budgetFailure,
  budgetOk,
  type Budget,
  type BudgetBoundary,
  type BudgetError,
  type BudgetErrorCode,
  type BudgetErrorField,
  type BudgetGoalBoundary,
  type BudgetResult,
  type CloseBudgetCommand,
  type CreateBudgetCommand,
  type UpdateBudgetCommand,
} from "./contracts";
import {
  compareBudgetDates,
  normalizeBudget,
  normalizeBudgetCommandId,
  parseBudgetDate,
  serializeBudget,
  serializeBudgetDate,
} from "./domain";

/** Operation names are deliberately finite and match the T03 SQL allow-list. */
export const BUDGET_COMMAND_OPERATIONS = {
  create: "budget.create",
  update: "budget.update",
  close: "budget.close",
} as const;

export const CREATE_BUDGET_OPERATION = BUDGET_COMMAND_OPERATIONS.create;
export const UPDATE_BUDGET_OPERATION = BUDGET_COMMAND_OPERATIONS.update;
export const CLOSE_BUDGET_OPERATION = BUDGET_COMMAND_OPERATIONS.close;

export type BudgetCommandOperation =
  (typeof BUDGET_COMMAND_OPERATIONS)[keyof typeof BUDGET_COMMAND_OPERATIONS];

export interface BudgetUseCasePort {
  create(
    context: FinancialContext,
    command: unknown,
  ): Promise<BudgetResult<BudgetBoundary>>;
  update(
    context: FinancialContext,
    command: unknown,
  ): Promise<BudgetResult<BudgetBoundary>>;
  close(
    context: FinancialContext,
    command: unknown,
  ): Promise<BudgetResult<BudgetBoundary>>;
}

export interface BudgetUseCaseOptions {
  /** Injectable only for integration/unit composition; production is lazy. */
  readonly database?: Database;
  /** Safe aggregate-only hooks for the server-side write boundary. */
  readonly observability?:
    S09BudgetCompletionOptions & S09BudgetOperationOptions & S09BudgetQueryOptions;
}

export type BudgetTransaction =
  Parameters<NonNullable<ReturnType<typeof getDb>["transaction"]>>[0] extends (
    transaction: infer Transaction,
  ) => Promise<unknown>
    ? Transaction
    : never;

type CommandClaim =
  | { readonly created: true }
  | { readonly created: false; readonly record: ApplicationCommandRecord };

function databaseFor(database?: Database): Database {
  return database ?? getDb();
}

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

function payloadHash(
  operation: BudgetCommandOperation,
  payload: unknown,
): string {
  return createHash("sha256")
    .update(canonicalJson({ operation, payload }), "utf8")
    .digest("hex");
}

function errorCode(value: unknown): string | undefined {
  let candidate: unknown = value;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "code" in candidate &&
      typeof (candidate as { code?: unknown }).code === "string"
    ) {
      return (candidate as { code: string }).code;
    }

    candidate =
      candidate && typeof candidate === "object" && "cause" in candidate
        ? (candidate as { cause?: unknown }).cause
        : undefined;
  }

  return undefined;
}

function constraintName(value: unknown): string | undefined {
  let candidate: unknown = value;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "constraint" in candidate &&
      typeof (candidate as { constraint?: unknown }).constraint === "string"
    ) {
      return (candidate as { constraint: string }).constraint;
    }

    candidate =
      candidate && typeof candidate === "object" && "cause" in candidate
        ? (candidate as { cause?: unknown }).cause
        : undefined;
  }

  return undefined;
}

function persistenceError(
  value: unknown,
): BudgetDomainError | null {
  if (value instanceof BudgetDomainError) return value;

  const code = errorCode(value);
  const constraint = constraintName(value);

  if (
    code === "23P01" &&
    constraint === "budgets_category_active_window_no_overlap_excl"
  ) {
    return new BudgetDomainError(
      "CATEGORY_ACTIVE_BUDGET_CONFLICT",
      "categoryId",
    );
  }

  if (
    code === "23505" &&
    constraint === "budgets_household_reference_id_uq"
  ) {
    return new BudgetDomainError("DUPLICATE_REFERENCE", "referenceId");
  }

  if (
    code === "23503" &&
    constraint === "budgets_category_household_fkey"
  ) {
    return new BudgetDomainError("CATEGORY_NOT_FOUND", "categoryId");
  }

  if (
    code === "23503" &&
    (constraint === "application_commands_household_id_fkey" ||
      constraint === "budgets_household_id_fkey")
  ) {
    return new BudgetDomainError("FINANCIAL_CONTEXT_REQUIRED");
  }

  if (code === "22P02") {
    // A malformed UUID is an absent category/resource at this boundary. The
    // database message itself must never cross the action boundary.
    return new BudgetDomainError("CATEGORY_NOT_FOUND", "categoryId");
  }

  if (code === "23514") {
    if (constraint === "budgets_lifecycle_guard") {
      return new BudgetDomainError("BUDGET_CLOSED", "budgetReferenceId");
    }
    if (constraint === "budgets_target_shape_check") {
      return new BudgetDomainError("INVALID_GOAL", "targetAmountCents");
    }
    if (constraint === "budgets_closed_on_range_check") {
      return new BudgetDomainError("INVALID_DATE_RANGE", "closedOn");
    }
  }

  return null;
}

async function toResult<T>(work: () => Promise<T>): Promise<BudgetResult<T>> {
  try {
    return budgetOk(await work());
  } catch (error) {
    const expected = persistenceError(error);
    if (expected) return budgetFailure(expected.code, expected.field);
    throw error;
  }
}

function issueField(path: readonly (string | number)[]): BudgetErrorField | undefined {
  const field = path[path.length - 1];
  return typeof field === "string" &&
    ([
      "commandId",
      "name",
      "referenceId",
      "boxReferenceId",
      "budgetReferenceId",
      "categoryId",
      "status",
      "asOf",
      "amountCents",
      "effectiveOn",
      "activeFrom",
      "closedOn",
      "targetAmountCents",
      "targetDate",
    ] as readonly string[]).includes(field)
    ? (field as BudgetErrorField)
    : undefined;
}

function parseCommand<T>(
  schema: {
    safeParse(value: unknown):
      | { readonly success: true; readonly data: T }
      | { readonly success: false; readonly error: { readonly issues?: readonly { readonly path: readonly (string | number)[] }[] } };
  },
  value: unknown,
  invalidCode: BudgetErrorCode,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  const path = parsed.error.issues?.[0]?.path ?? [];
  const field = issueField(path);
  if (field === "commandId") throw new BudgetDomainError("INVALID_COMMAND_ID", field);
  if (field === "name") throw new BudgetDomainError("INVALID_NAME", field);
  if (field === "categoryId") throw new BudgetDomainError("INVALID_REFERENCE", field);
  if (field === "budgetReferenceId") {
    throw new BudgetDomainError("INVALID_REFERENCE", field);
  }
  if (field === "activeFrom" || field === "closedOn") {
    throw new BudgetDomainError(
      field === "closedOn" ? "INVALID_DATE" : "INVALID_DATE",
      field,
    );
  }
  if (field === "targetAmountCents") {
    throw new BudgetDomainError("INVALID_TARGET_AMOUNT", field);
  }
  if (field === "targetDate") {
    throw new BudgetDomainError("INVALID_TARGET_DATE", field);
  }

  throw new BudgetDomainError(invalidCode);
}

/** Parses and normalizes a create command without leaking ZodError. */
export function parseCreateBudgetCommand(
  value: unknown,
): CreateBudgetCommand {
  return parseCommand(createBudgetCommandSchema, value, "INVALID_COMMAND");
}

/** Parses and normalizes an update command without leaking ZodError. */
export function parseUpdateBudgetCommand(
  value: unknown,
): UpdateBudgetCommand {
  return parseCommand(updateBudgetCommandSchema, value, "INVALID_COMMAND");
}

/** Parses and normalizes a close command without leaking ZodError. */
export function parseCloseBudgetCommand(
  value: unknown,
): CloseBudgetCommand {
  return parseCommand(closeBudgetCommandSchema, value, "INVALID_COMMAND");
}

function goalBoundaryFromRow(row: BudgetRecord): BudgetGoalBoundary | null {
  const hasAmount = row.targetAmountCents !== null;
  const hasDate = row.targetDate !== null;

  if (hasAmount !== hasDate) {
    throw new BudgetDomainError("INVALID_GOAL");
  }

  return hasAmount && hasDate
    ? {
        targetAmountCents: row.targetAmountCents!.toString(10),
        targetDate: row.targetDate!,
      }
    : null;
}

function budgetFromRow(row: BudgetRecord): Budget {
  const goal = goalBoundaryFromRow(row);
  return normalizeBudget({
    referenceId: row.referenceId,
    name: row.name,
    categoryId: row.categoryId,
    status: row.status,
    activeFrom: row.activeFrom,
    closedOn: row.closedOn,
    goal,
    householdId: row.householdId,
  });
}

function boundaryFromRow(row: BudgetRecord): BudgetBoundary {
  return serializeBudget(budgetFromRow(row));
}

function storedBoundary(record: ApplicationCommandRecord): BudgetBoundary | null {
  if (record.result === null || record.result === undefined) return null;

  const parsed = budgetBoundarySchema.safeParse(record.result);
  if (!parsed.success) {
    throw new Error("O resultado persistido da operação de Caixinha é inválido.");
  }
  return parsed.data;
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

async function claimCommand(
  transaction: BudgetTransaction,
  context: FinancialContext,
  commandId: string,
  operation: BudgetCommandOperation,
  hash: string,
  resourceId?: string,
): Promise<CommandClaim> {
  const inserted = await transaction
    .insert(applicationCommands)
    .values({
      householdId: context.householdId,
      commandId,
      operation,
      payloadHash: hash,
      ...(resourceId === undefined ? {} : { resourceId }),
    })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) return { created: true };

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
    throw new BudgetDomainError("COMMAND_ID_REUSED", "commandId");
  }

  return { created: false, record };
}

async function completeCommand(
  transaction: BudgetTransaction,
  context: FinancialContext,
  commandId: string,
  operation: BudgetCommandOperation,
  hash: string,
  resourceId: string,
  result: BudgetBoundary,
): Promise<void> {
  const updated = await transaction
    .update(applicationCommands)
    .set({ resourceId, result })
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

async function findBudgetByReference(
  transaction: BudgetTransaction,
  context: FinancialContext,
  referenceId: string,
  lock = false,
): Promise<BudgetRecord | undefined> {
  const query = transaction
    .select()
    .from(budgets)
    .where(
      and(
        eq(budgets.householdId, context.householdId),
        eq(budgets.referenceId, referenceId),
      ),
    )
    .limit(1);

  return (lock ? await query.for("update") : await query)[0];
}

async function findBudgetById(
  transaction: BudgetTransaction,
  context: FinancialContext,
  id: string,
  lock = false,
): Promise<BudgetRecord | undefined> {
  const query = transaction
    .select()
    .from(budgets)
    .where(
      and(eq(budgets.householdId, context.householdId), eq(budgets.id, id)),
    )
    .limit(1);

  return (lock ? await query.for("update") : await query)[0];
}

async function findCategoryForCreate(
  transaction: BudgetTransaction,
  context: FinancialContext,
  categoryId: string,
): Promise<CategoryRecord> {
  if (!validUuid(categoryId)) {
    throw new BudgetDomainError("CATEGORY_NOT_FOUND", "categoryId");
  }

  const rows = await transaction
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.householdId, context.householdId),
        eq(categories.id, categoryId),
      ),
    )
    .limit(1)
    .for("update");
  const category = rows[0];

  if (!category) {
    throw new BudgetDomainError("CATEGORY_NOT_FOUND", "categoryId");
  }
  if (category.kind !== "EXPENSE") {
    throw new BudgetDomainError("CATEGORY_KIND_MISMATCH", "categoryId");
  }
  if (category.status === "ARCHIVED") {
    throw new BudgetDomainError("CATEGORY_ARCHIVED", "categoryId");
  }

  return category;
}

function createPayload(command: CreateBudgetCommand): object {
  return {
    name: command.name,
    categoryId: command.categoryId,
    activeFrom: command.activeFrom,
    goal: command.goal ?? null,
  };
}

function updatePayload(command: UpdateBudgetCommand): object {
  return {
    budgetReferenceId: command.budgetReferenceId,
    ...(command.name === undefined ? {} : { name: command.name }),
    ...(command.goal === undefined ? {} : { goal: command.goal }),
  };
}

function closePayload(command: CloseBudgetCommand): object {
  return {
    budgetReferenceId: command.budgetReferenceId,
    closedOn: command.closedOn,
  };
}

function resultForRetry(
  transaction: BudgetTransaction,
  context: FinancialContext,
  claim: Extract<CommandClaim, { readonly created: false }>,
): Promise<BudgetBoundary> {
  const persisted = storedBoundary(claim.record);
  if (persisted) return Promise.resolve(persisted);

  if (!claim.record.resourceId) {
    throw new Error("O registro de idempotência não possui resultado associado.");
  }

  return findBudgetById(transaction, context, claim.record.resourceId).then((row) => {
    if (!row) {
      throw new Error("A Caixinha associada ao command não foi encontrada.");
    }
    return boundaryFromRow(row);
  });
}

async function executeCreate(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<BudgetBoundary> {
  const command = parseCreateBudgetCommand(input);
  const commandId = normalizeBudgetCommandId(command.commandId);
  const hash = payloadHash(BUDGET_COMMAND_OPERATIONS.create, createPayload(command));
  const id = generateUuidV7();
  const referenceId = generateUuidV7();

  return database.transaction(async (transaction) => {
    const claim = await claimCommand(
      transaction,
      context,
      commandId,
      BUDGET_COMMAND_OPERATIONS.create,
      hash,
      id,
    );
    if (!claim.created) return resultForRetry(transaction, context, claim);

    await findCategoryForCreate(transaction, context, command.categoryId);
    const goal = command.goal ?? null;
    const normalized = normalizeBudget({
      referenceId,
      name: command.name,
      categoryId: command.categoryId,
      activeFrom: command.activeFrom,
      goal,
      householdId: context.householdId,
    });

    const rows = await transaction
      .insert(budgets)
      .values({
        id,
        householdId: context.householdId,
        referenceId: normalized.referenceId,
        categoryId: normalized.categoryId,
        name: normalized.name,
        status: "ACTIVE",
        activeFrom: serializeBudgetDate(normalized.activeFrom),
        closedOn: null,
        targetAmountCents: normalized.goal?.targetAmount.cents ?? null,
        targetDate:
          normalized.goal === null
            ? null
            : serializeBudgetDate(normalized.goal.targetDate),
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("A criação da Caixinha não retornou uma linha.");

    const result = boundaryFromRow(row);
    await completeCommand(
      transaction,
      context,
      commandId,
      BUDGET_COMMAND_OPERATIONS.create,
      hash,
      row.id,
      result,
    );
    return result;
  });
}

async function executeUpdate(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<BudgetBoundary> {
  const command = parseUpdateBudgetCommand(input);
  const commandId = normalizeBudgetCommandId(command.commandId);
  const hash = payloadHash(BUDGET_COMMAND_OPERATIONS.update, updatePayload(command));

  return database.transaction(async (transaction) => {
    const claim = await claimCommand(
      transaction,
      context,
      commandId,
      BUDGET_COMMAND_OPERATIONS.update,
      hash,
    );
    if (!claim.created) return resultForRetry(transaction, context, claim);

    const current = await findBudgetByReference(
      transaction,
      context,
      command.budgetReferenceId,
      true,
    );
    if (!current) {
      throw new BudgetDomainError("BUDGET_NOT_FOUND", "budgetReferenceId");
    }

    const currentBudget = budgetFromRow(current);
    const nextGoal =
      command.goal === undefined ? serializeBudget(currentBudget).goal : command.goal;
    const nextBudget = normalizeBudget({
      referenceId: currentBudget.referenceId,
      name: command.name ?? currentBudget.name,
      categoryId: currentBudget.categoryId,
      status: currentBudget.status,
      activeFrom: currentBudget.activeFrom,
      closedOn: currentBudget.closedOn,
      goal: nextGoal,
      householdId: context.householdId,
    });

    const rows = await transaction
      .update(budgets)
      .set({
        name: nextBudget.name,
        targetAmountCents: nextBudget.goal?.targetAmount.cents ?? null,
        targetDate:
          nextBudget.goal === null
            ? null
            : serializeBudgetDate(nextBudget.goal.targetDate),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(budgets.id, current.id),
          eq(budgets.householdId, context.householdId),
        ),
      )
      .returning();
    const row = rows[0];
    if (!row) throw new BudgetDomainError("BUDGET_NOT_FOUND", "budgetReferenceId");

    const result = boundaryFromRow(row);
    await completeCommand(
      transaction,
      context,
      commandId,
      BUDGET_COMMAND_OPERATIONS.update,
      hash,
      row.id,
      result,
    );
    return result;
  });
}

async function executeClose(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<BudgetBoundary> {
  const command = parseCloseBudgetCommand(input);
  const commandId = normalizeBudgetCommandId(command.commandId);
  const hash = payloadHash(BUDGET_COMMAND_OPERATIONS.close, closePayload(command));

  return database.transaction(async (transaction) => {
    const claim = await claimCommand(
      transaction,
      context,
      commandId,
      BUDGET_COMMAND_OPERATIONS.close,
      hash,
    );
    if (!claim.created) return resultForRetry(transaction, context, claim);

    const current = await findBudgetByReference(
      transaction,
      context,
      command.budgetReferenceId,
      true,
    );
    if (!current) {
      throw new BudgetDomainError("BUDGET_NOT_FOUND", "budgetReferenceId");
    }
    if (current.status === "CLOSED") {
      throw new BudgetDomainError("BUDGET_CLOSED", "budgetReferenceId");
    }

    const currentBudget = budgetFromRow(current);
    const closedOn = parseBudgetDate(command.closedOn, "closedOn");
    if (compareBudgetDates(closedOn, currentBudget.activeFrom) < 0) {
      throw new BudgetDomainError("INVALID_DATE_RANGE", "closedOn");
    }

    // A close cannot make an already-recorded future movement fall outside
    // the aggregate's historical interval. T07 takes the same budget row
    // lock before appending movements, so this check is serialized with a
    // concurrent movement write.
    const futureMovements = await transaction
      .select({ id: budgetMovements.id })
      .from(budgetMovements)
      .where(
        and(
          eq(budgetMovements.householdId, context.householdId),
          eq(budgetMovements.budgetId, current.id),
          gt(budgetMovements.effectiveOn, serializeBudgetDate(closedOn)),
        ),
      )
      .limit(1);
    if (futureMovements[0]) {
      throw new BudgetDomainError("INVALID_DATE_RANGE", "closedOn");
    }

    const nextBudget = normalizeBudget({
      referenceId: currentBudget.referenceId,
      name: currentBudget.name,
      categoryId: currentBudget.categoryId,
      status: "CLOSED",
      activeFrom: currentBudget.activeFrom,
      closedOn,
      goal: serializeBudget(currentBudget).goal,
      householdId: context.householdId,
    });

    const rows = await transaction
      .update(budgets)
      .set({
        status: "CLOSED",
        closedOn: serializeBudgetDate(nextBudget.closedOn!),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(budgets.id, current.id),
          eq(budgets.householdId, context.householdId),
          eq(budgets.status, "ACTIVE"),
        ),
      )
      .returning();
    const row = rows[0];
    if (!row) throw new BudgetDomainError("BUDGET_CLOSED", "budgetReferenceId");

    const result = boundaryFromRow(row);
    await completeCommand(
      transaction,
      context,
      commandId,
      BUDGET_COMMAND_OPERATIONS.close,
      hash,
      row.id,
      result,
    );
    return result;
  });
}

function contextForUseCase(context: FinancialContext): void {
  // The use case remains protected when called directly by a worker/test;
  // Server Actions resolve this context from the authenticated session.
  assertFinancialContext(context);
}

type BudgetWriteObservabilityOptions =
  S09BudgetCompletionOptions & S09BudgetOperationOptions & S09BudgetQueryOptions;

/**
 * Measures the T06 transaction boundary without inspecting a command or a
 * returned budget.  The S09 operation generates a server-side correlation ID;
 * command IDs, names, references and payloads never enter telemetry.
 */
async function withBudgetWriteObservability<T>(
  operation: S09BudgetOperationContext,
  work: () => Promise<T>,
  options: BudgetWriteObservabilityOptions,
): Promise<T> {
  const safeOptions: BudgetWriteObservabilityOptions = {
    ...options,
    technicalErrorCode: "BUDGET_TRANSACTION_FAILED",
  };
  return withS09BudgetObservability(
    operation,
    () =>
      measureS09Query(operation, work, safeOptions),
    safeOptions,
  );
}

export function createBudgetUseCases(
  database?: Database,
): BudgetUseCasePort;
export function createBudgetUseCases(
  options?: BudgetUseCaseOptions,
): BudgetUseCasePort;
export function createBudgetUseCases(
  databaseOrOptions?: Database | BudgetUseCaseOptions,
): BudgetUseCasePort {
  const options =
    databaseOrOptions &&
    typeof databaseOrOptions === "object" &&
    "transaction" in databaseOrOptions
      ? { database: databaseOrOptions as Database }
      : (databaseOrOptions ?? {});
  const database = () => databaseFor(options.database);
  const observability: BudgetWriteObservabilityOptions =
    options.observability ?? {};

  const runWrite = <T>(
    context: FinancialContext,
    work: () => Promise<BudgetResult<T>>,
  ): Promise<BudgetResult<T>> => {
    const operation = createS09BudgetOperation(
      "budget.write",
      observability,
    );
    return withBudgetWriteObservability(operation, async () => {
      contextForUseCase(context);
      return work();
    }, observability);
  };

  return {
    create: (context, command) =>
      runWrite(context, () =>
        toResult(() => executeCreate(database(), context, command)),
      ),
    update: (context, command) =>
      runWrite(context, () =>
        toResult(() => executeUpdate(database(), context, command)),
      ),
    close: (context, command) =>
      runWrite(context, () =>
        toResult(() => executeClose(database(), context, command)),
      ),
  };
}

/** Singular/plural aliases keep the port discoverable across call sites. */
export const createBudgetsUseCases = createBudgetUseCases;
export const createBudgetUseCase = createBudgetUseCases;
export const createBudgetsUseCase = createBudgetUseCases;
export const createBudgetUseCasePort = createBudgetUseCases;
export const createBudgetsUseCasePort = createBudgetUseCases;

/** Lazy default port; importing contracts/components does not open a DB. */
export const budgetUseCases = createBudgetUseCases();
export const budgetsUseCases = budgetUseCases;
export const budgetUseCasePort = budgetUseCases;
export const budgetsUseCasePort = budgetUseCases;

export async function createBudget(
  context: FinancialContext,
  command: unknown,
  database?: Database,
): Promise<BudgetResult<BudgetBoundary>> {
  return createBudgetUseCases(database).create(context, command);
}

export async function updateBudget(
  context: FinancialContext,
  command: unknown,
  database?: Database,
): Promise<BudgetResult<BudgetBoundary>> {
  return createBudgetUseCases(database).update(context, command);
}

export async function closeBudget(
  context: FinancialContext,
  command: unknown,
  database?: Database,
): Promise<BudgetResult<BudgetBoundary>> {
  return createBudgetUseCases(database).close(context, command);
}

export const CreateBudget = createBudget;
export const UpdateBudget = updateBudget;
export const CloseBudget = closeBudget;
export const createBox = createBudget;
export const updateBox = updateBudget;
export const closeBox = closeBudget;
export const CreateBox = createBudget;
export const UpdateBox = updateBudget;
export const CloseBox = closeBudget;

export function isBudgetResultError(
  result: BudgetResult<unknown>,
): result is { readonly ok: false; readonly error: BudgetError } {
  return !result.ok;
}
