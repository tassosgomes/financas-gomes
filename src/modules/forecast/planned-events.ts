import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  accounts,
  applicationCommands,
  categories,
  type ApplicationCommandRecord,
} from "@/db/accounts-categories-schema";
import {
  plannedEvents,
  type PlannedEventRecord,
} from "@/db/recurring-schema";
import { isUuidV7, generateUuidV7 } from "@/lib/uuidv7";
import type { FinancialContext } from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";

import {
  ForecastMaintenanceCommandError,
  parseCancelPlannedEventCommand,
  parseCreatePlannedEventCommand,
  parseUpdatePlannedEventCommand,
  PLANNED_EVENT_CANCEL_OPERATION,
  PLANNED_EVENT_CREATE_OPERATION,
  PLANNED_EVENT_UPDATE_OPERATION,
  type CancelPlannedEventCommand,
  type CreatePlannedEventCommand,
  type PlannedEventReadModel,
  type ForecastMaintenanceResult,
  type UpdatePlannedEventCommand,
} from "./maintenance-contracts";

/** Drizzle transaction type kept private to this server-side write module. */
export type PlannedEventTransaction =
  Parameters<NonNullable<ReturnType<typeof getDb>["transaction"]>>[0] extends (
    transaction: infer T,
  ) => Promise<unknown>
    ? T
    : never;

export interface PlannedEventUseCasePort {
  create(
    context: FinancialContext,
    command: unknown,
  ): Promise<ForecastMaintenanceResult<PlannedEventReadModel>>;
  update(
    context: FinancialContext,
    command: unknown,
  ): Promise<ForecastMaintenanceResult<PlannedEventReadModel>>;
  cancel(
    context: FinancialContext,
    command: unknown,
  ): Promise<ForecastMaintenanceResult<PlannedEventReadModel>>;
}

export interface PlannedEventUseCaseOptions {
  database?: Database;
}

type CommandClaim =
  | { created: true }
  | { created: false; record: ApplicationCommandRecord };

function databaseFor(value?: Database): Database {
  return value ?? getDb();
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

function payloadHash(operation: string, payload: unknown): string {
  return createHash("sha256")
    .update(canonicalJson({ operation, payload }), "utf8")
    .digest("hex");
}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function readModel(row: PlannedEventRecord): PlannedEventReadModel {
  return {
    id: row.id,
    accountId: row.accountId,
    categoryId: row.categoryId,
    kind: row.kind === "INCOME" ? "INCOME" : "EXPENSE",
    status:
      row.status === "EXPECTED" || row.status === "POSTED" || row.status === "CANCELLED"
        ? row.status
        : "PLANNED",
    amountCents: row.amountCents.toString(10),
    expectedOn: row.expectedOn,
    description: row.description,
    includeInConservativeForecast: row.includeInConservativeForecast,
    financialEventId: row.financialEventId,
    isPartial: row.isPartial,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  };
}

function plannedKind(value: PlannedEventRecord["kind"]): "EXPENSE" | "INCOME" {
  if (value === "EXPENSE" || value === "INCOME") return value;
  throw new ForecastMaintenanceCommandError(
    "INVALID_KIND",
    "O tipo do evento planejado é inválido.",
    "kind",
  );
}

function domainError(
  code: ConstructorParameters<typeof ForecastMaintenanceCommandError>[0],
  message: string,
  field?: string,
): never {
  throw new ForecastMaintenanceCommandError(code, message, field);
}

function errorCode(value: unknown): string | undefined {
  let candidate: unknown = value;
  for (let attempt = 0; attempt < 4; attempt += 1) {
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

function constraint(value: unknown): string | undefined {
  let candidate: unknown = value;
  for (let attempt = 0; attempt < 4; attempt += 1) {
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

function mapPersistenceError(error: unknown): ForecastMaintenanceCommandError | null {
  if (error instanceof ForecastMaintenanceCommandError) return error;
  const code = errorCode(error);
  if (code === "23503") {
    return new ForecastMaintenanceCommandError(
      "TENANT_RESOURCE_NOT_FOUND",
      "Recurso não encontrado.",
    );
  }
  if (code === "23505") {
    return new ForecastMaintenanceCommandError(
      "CONFLICT",
      "A operação conflita com outra fonte de compromisso.",
    );
  }
  if (code === "23514") {
    return new ForecastMaintenanceCommandError(
      "INVALID_COMMAND",
      "Os dados da operação são inválidos.",
    );
  }
  // Keep the helper's constraint traversal in the module; it is useful when
  // diagnosing a known conflict but its value never enters a public error.
  void constraint(error);
  return null;
}

async function toResult<T>(
  work: () => Promise<T>,
): Promise<ForecastMaintenanceResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    const mapped = mapPersistenceError(error);
    if (mapped) {
      return {
        ok: false,
        error: {
          code: mapped.code,
          message: mapped.message,
          ...(mapped.field ? { field: mapped.field } : {}),
        },
      };
    }
    throw error;
  }
}

async function reserveCommand(
  transaction: PlannedEventTransaction,
  context: FinancialContext,
  commandId: string,
  operation: string,
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
    domainError(
      "COMMAND_ID_REUSED",
      "O identificador da operação já foi utilizado.",
      "commandId",
    );
  }
  if (!record.resourceId) {
    throw new Error("O registro de idempotência não possui recurso associado.");
  }
  return { created: false, record };
}

async function completeCommand(
  transaction: PlannedEventTransaction,
  context: FinancialContext,
  commandId: string,
  result: PlannedEventReadModel,
): Promise<void> {
  await transaction
    .update(applicationCommands)
    .set({ result })
    .where(
      and(
        eq(applicationCommands.householdId, context.householdId),
        eq(applicationCommands.commandId, commandId),
      ),
    );
}

async function findById(
  transaction: PlannedEventTransaction,
  context: FinancialContext,
  plannedEventId: string,
  lock = false,
): Promise<PlannedEventRecord | undefined> {
  const query = transaction
    .select()
    .from(plannedEvents)
    .where(
      and(
        eq(plannedEvents.id, plannedEventId),
        eq(plannedEvents.householdId, context.householdId),
      ),
    )
    .limit(1);
  return (lock ? await query.for("update") : await query)[0];
}

async function assertReferences(
  transaction: PlannedEventTransaction,
  context: FinancialContext,
  values: {
    accountId?: string | null;
    categoryId?: string | null;
    kind: "EXPENSE" | "INCOME";
  },
): Promise<void> {
  if (values.accountId !== undefined && values.accountId !== null) {
    if (!isUuidV7(values.accountId)) {
      domainError("INVALID_ACCOUNT_ID", "A conta informada é inválida.", "accountId");
    }
    const rows = await transaction
      .select({ id: accounts.id, status: accounts.status })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, values.accountId),
          eq(accounts.householdId, context.householdId),
        ),
      )
      .limit(1);
    const account = rows[0];
    if (!account) domainError("ACCOUNT_NOT_FOUND", "A conta não foi encontrada.", "accountId");
    if (account.status === "ARCHIVED") {
      domainError("ACCOUNT_ARCHIVED", "A conta está arquivada.", "accountId");
    }
  }

  if (values.categoryId !== undefined && values.categoryId !== null) {
    if (!isUuidV7(values.categoryId)) {
      domainError("INVALID_CATEGORY_ID", "A categoria informada é inválida.", "categoryId");
    }
    const rows = await transaction
      .select({ id: categories.id, kind: categories.kind, status: categories.status })
      .from(categories)
      .where(
        and(
          eq(categories.id, values.categoryId),
          eq(categories.householdId, context.householdId),
        ),
      )
      .limit(1);
    const category = rows[0];
    if (!category) {
      domainError("CATEGORY_NOT_FOUND", "A categoria não foi encontrada.", "categoryId");
    }
    if (category.status === "ARCHIVED") {
      domainError("CATEGORY_ARCHIVED", "A categoria está arquivada.", "categoryId");
    }
    if (category.kind !== values.kind) {
      domainError(
        "CATEGORY_KIND_MISMATCH",
        "A categoria não corresponde ao tipo do evento.",
        "categoryId",
      );
    }
  }
}

function commandPayload(command: CreatePlannedEventCommand): object {
  return {
    accountId: command.accountId ?? null,
    categoryId: command.categoryId ?? null,
    kind: command.kind,
    amountCents: command.amountCents,
    expectedOn: command.expectedOn,
    description: command.description,
    includeInConservativeForecast: command.includeInConservativeForecast ?? true,
  };
}

function updatePayload(command: UpdatePlannedEventCommand): object {
  return {
    plannedEventId: command.plannedEventId,
    ...(command.accountId === undefined ? {} : { accountId: command.accountId }),
    ...(command.categoryId === undefined ? {} : { categoryId: command.categoryId }),
    ...(command.kind === undefined ? {} : { kind: command.kind }),
    ...(command.amountCents === undefined ? {} : { amountCents: command.amountCents }),
    ...(command.expectedOn === undefined ? {} : { expectedOn: command.expectedOn }),
    ...(command.description === undefined ? {} : { description: command.description }),
    ...(command.includeInConservativeForecast === undefined
      ? {}
      : { includeInConservativeForecast: command.includeInConservativeForecast }),
  };
}

async function executeCreate(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<PlannedEventReadModel> {
  const command = parseCreatePlannedEventCommand(input);
  const id = generateUuidV7();
  const hash = payloadHash(PLANNED_EVENT_CREATE_OPERATION, commandPayload(command));
  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(
      transaction,
      context,
      command.commandId,
      PLANNED_EVENT_CREATE_OPERATION,
      hash,
      id,
    );
    if (!claim.created) {
      const row = await findById(transaction, context, claim.record.resourceId as string);
      if (!row) throw new Error("O evento associado ao command não foi encontrado.");
      return readModel(row);
    }
    await assertReferences(transaction, context, command);
    const rows = await transaction
      .insert(plannedEvents)
      .values({
        id,
        householdId: context.householdId,
        accountId: command.accountId ?? null,
        categoryId: command.categoryId ?? null,
        kind: command.kind,
        status: "PLANNED",
        amountCents: BigInt(command.amountCents),
        expectedOn: command.expectedOn,
        description: command.description,
        includeInConservativeForecast: command.includeInConservativeForecast ?? true,
        financialEventId: null,
        isPartial: false,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("O evento planejado não foi criado.");
    const model = readModel(row);
    await completeCommand(transaction, context, command.commandId, model);
    return model;
  });
}

async function executeUpdate(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<PlannedEventReadModel> {
  const command = parseUpdatePlannedEventCommand(input);
  const hash = payloadHash(PLANNED_EVENT_UPDATE_OPERATION, updatePayload(command));
  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(
      transaction,
      context,
      command.commandId,
      PLANNED_EVENT_UPDATE_OPERATION,
      hash,
      command.plannedEventId,
    );
    if (!claim.created) {
      const row = await findById(transaction, context, claim.record.resourceId as string);
      if (!row) throw new Error("O evento associado ao command não foi encontrado.");
      return readModel(row);
    }
    const current = await findById(transaction, context, command.plannedEventId, true);
    if (!current) {
      domainError(
        "PLANNED_EVENT_NOT_FOUND",
        "O evento planejado não foi encontrado.",
        "plannedEventId",
      );
    }
    if (current.status === "POSTED" || current.status === "CANCELLED") {
      domainError(
        "PLANNED_EVENT_NOT_EDITABLE",
        "O evento não pode mais ser alterado.",
        "plannedEventId",
      );
    }
    const kind = command.kind ?? plannedKind(current.kind);
    const accountId = command.accountId === undefined ? current.accountId : command.accountId;
    const categoryId = command.categoryId === undefined ? current.categoryId : command.categoryId;
    await assertReferences(transaction, context, { accountId, categoryId, kind });
    const rows = await transaction
      .update(plannedEvents)
      .set({
        accountId,
        categoryId,
        kind,
        amountCents:
          command.amountCents === undefined
            ? current.amountCents
            : BigInt(command.amountCents),
        expectedOn: command.expectedOn ?? current.expectedOn,
        description: command.description ?? current.description,
        includeInConservativeForecast:
          command.includeInConservativeForecast ?? current.includeInConservativeForecast,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(plannedEvents.id, command.plannedEventId),
          eq(plannedEvents.householdId, context.householdId),
        ),
      )
      .returning();
    const row = rows[0];
    if (!row) throw new Error("O evento planejado não foi atualizado.");
    const model = readModel(row);
    await completeCommand(transaction, context, command.commandId, model);
    return model;
  });
}

async function executeCancel(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<PlannedEventReadModel> {
  const command = parseCancelPlannedEventCommand(input);
  const hash = payloadHash(PLANNED_EVENT_CANCEL_OPERATION, {
    plannedEventId: command.plannedEventId,
  });
  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(
      transaction,
      context,
      command.commandId,
      PLANNED_EVENT_CANCEL_OPERATION,
      hash,
      command.plannedEventId,
    );
    if (!claim.created) {
      const row = await findById(transaction, context, claim.record.resourceId as string);
      if (!row) throw new Error("O evento associado ao command não foi encontrado.");
      return readModel(row);
    }
    const current = await findById(transaction, context, command.plannedEventId, true);
    if (!current) {
      domainError(
        "PLANNED_EVENT_NOT_FOUND",
        "O evento planejado não foi encontrado.",
        "plannedEventId",
      );
    }
    if (current.status === "CANCELLED") {
      domainError(
        "PLANNED_EVENT_ALREADY_CANCELLED",
        "O evento planejado já foi cancelado.",
        "plannedEventId",
      );
    }
    if (current.status === "POSTED") {
      domainError(
        "PLANNED_EVENT_NOT_EDITABLE",
        "Um fato POSTED não pode ser cancelado por esta operação.",
        "plannedEventId",
      );
    }
    const rows = await transaction
      .update(plannedEvents)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(
        and(
          eq(plannedEvents.id, command.plannedEventId),
          eq(plannedEvents.householdId, context.householdId),
        ),
      )
      .returning();
    const row = rows[0];
    if (!row) throw new Error("O cancelamento do evento não foi salvo.");
    const model = readModel(row);
    await completeCommand(transaction, context, command.commandId, model);
    return model;
  });
}

/** Tenant-scoped create/update/cancel operations for explicit future events. */
export function createPlannedEventUseCases(
  options: PlannedEventUseCaseOptions = {},
): PlannedEventUseCasePort {
  const run = <T>(context: FinancialContext, work: () => Promise<T>) => {
    assertFinancialContext(context);
    return toResult(work);
  };
  const database = () => databaseFor(options.database);
  return {
    create: (context, input) => run(context, () => executeCreate(database(), context, input)),
    update: (context, input) => run(context, () => executeUpdate(database(), context, input)),
    cancel: (context, input) => run(context, () => executeCancel(database(), context, input)),
  };
}

/** Lazy compatibility port; importing contracts/components must not open a DB connection. */
export const plannedEventUseCases: PlannedEventUseCasePort = {
  create: (context, input) => createPlannedEventUseCases().create(context, input),
  update: (context, input) => createPlannedEventUseCases().update(context, input),
  cancel: (context, input) => createPlannedEventUseCases().cancel(context, input),
};

export async function createPlannedEvent(
  context: FinancialContext,
  input: unknown,
  database?: Database,
): Promise<ForecastMaintenanceResult<PlannedEventReadModel>> {
  return createPlannedEventUseCases({ database }).create(context, input);
}

export async function updatePlannedEvent(
  context: FinancialContext,
  input: unknown,
  database?: Database,
): Promise<ForecastMaintenanceResult<PlannedEventReadModel>> {
  return createPlannedEventUseCases({ database }).update(context, input);
}

export async function cancelPlannedEvent(
  context: FinancialContext,
  input: unknown,
  database?: Database,
): Promise<ForecastMaintenanceResult<PlannedEventReadModel>> {
  return createPlannedEventUseCases({ database }).cancel(context, input);
}

export type {
  CancelPlannedEventCommand,
  CreatePlannedEventCommand,
  UpdatePlannedEventCommand,
};
