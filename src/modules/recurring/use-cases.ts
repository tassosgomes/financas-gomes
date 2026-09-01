import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  applicationCommands,
  accounts,
  categories,
  type ApplicationCommandRecord,
} from "@/db/accounts-categories-schema";
import {
  financialEvents,
  type FinancialEventRecord,
} from "@/db/financial-events-schema";
import {
  recurringOccurrences,
  recurringRules,
  type RecurringOccurrenceRecord,
  type RecurringRuleRecord,
} from "@/db/recurring-schema";
import { generateUuidV7 } from "@/lib/uuidv7";
import type { FinancialContext } from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import {
  RecurrenceDomainError,
  compareRecurrenceDates,
  createProspectiveRuleVersion,
  formatRecurrenceDate,
  normalizeRecurringRule,
  parseRecurrenceDate,
  validateOccurrenceKey,
} from "@/modules/recurrences";

import {
  RECURRING_OCCURRENCE_CANCEL_OPERATION,
  RECURRING_OCCURRENCE_OVERRIDE_OPERATION,
  RECURRING_OCCURRENCE_REALIZE_OPERATION,
  RECURRING_RULE_CREATE_OPERATION,
  RECURRING_RULE_END_OPERATION,
  RECURRING_RULE_UPDATE_FUTURE_OPERATION,
  RecurringCommandError,
  type RecurringOperation,
  type RecurringOccurrenceReadModel,
  type RecurringResult,
  type RecurringRuleReadModel,
} from "./contracts";
import {
  parseCancelRecurringOccurrenceCommand,
  parseCreateRecurringRuleCommand,
  parseEndRecurringRuleCommand,
  parseOverrideRecurringOccurrenceCommand,
  parseRealizeRecurringOccurrenceCommand,
  parseUpdateRecurringRuleFutureCommand,
  toRecurringCommandError,
} from "./validation";

/** Drizzle transaction type exposed for tests and composition. */
export type RecurringTransaction =
  Parameters<NonNullable<ReturnType<typeof getDb>["transaction"]>>[0] extends (
    transaction: infer T,
  ) => Promise<unknown>
    ? T
    : never;

export interface RecurringUseCaseOptions {
  database?: Database;
}

export interface RecurringUseCasePort {
  createRule(
    context: FinancialContext,
    command: unknown,
  ): Promise<RecurringResult<RecurringRuleReadModel>>;
  updateRuleFuture(
    context: FinancialContext,
    command: unknown,
  ): Promise<RecurringResult<RecurringRuleReadModel>>;
  endRule(
    context: FinancialContext,
    command: unknown,
  ): Promise<RecurringResult<RecurringRuleReadModel>>;
  overrideOccurrence(
    context: FinancialContext,
    command: unknown,
  ): Promise<RecurringResult<RecurringOccurrenceReadModel>>;
  cancelOccurrence(
    context: FinancialContext,
    command: unknown,
  ): Promise<RecurringResult<RecurringOccurrenceReadModel>>;
  realizeOccurrence(
    context: FinancialContext,
    command: unknown,
  ): Promise<RecurringResult<RecurringOccurrenceReadModel>>;
  create: RecurringUseCasePort["createRule"];
  updateFuture: RecurringUseCasePort["updateRuleFuture"];
  end: RecurringUseCasePort["endRule"];
  override: RecurringUseCasePort["overrideOccurrence"];
  cancel: RecurringUseCasePort["cancelOccurrence"];
  realize: RecurringUseCasePort["realizeOccurrence"];
}

type CommandClaim =
  | { created: true }
  | { created: false; record: ApplicationCommandRecord };

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
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function payloadHash(operation: RecurringOperation, payload: unknown): string {
  return createHash("sha256")
    .update(canonicalJson({ operation, payload }), "utf8")
    .digest("hex");
}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function ruleReadModel(row: RecurringRuleRecord): RecurringRuleReadModel {
  return {
    id: row.id,
    householdId: row.householdId,
    accountId: row.accountId,
    categoryId: row.categoryId,
    kind: recurringKind(row.kind),
    amountCents: row.amountCents.toString(10),
    description: row.description,
    frequency: row.frequency,
    dayRule: row.dayRule,
    dayOfMonth: row.dayOfMonth,
    startOn: row.startOn,
    endOn: row.endOn,
    includeInConservativeForecast: row.includeInConservativeForecast,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  };
}

function occurrenceReadModel(
  row: RecurringOccurrenceRecord,
): RecurringOccurrenceReadModel {
  return {
    id: row.id,
    householdId: row.householdId,
    recurringRuleId: row.recurringRuleId,
    occurrenceKey: row.occurrenceKey,
    status: row.status,
    amountCents: row.amountCents === null ? null : row.amountCents.toString(10),
    expectedOn: row.expectedOn,
    financialEventId: row.financialEventId,
    isPartial: row.isPartial,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  };
}

function recurringKind(value: FinancialEventRecord["kind"]): "EXPENSE" | "INCOME" {
  if (value === "EXPENSE" || value === "INCOME") return value;
  recurringDomainError("INVALID_RULE", "Tipo de recorrência inválido.", "kind");
}

function recurringDomainError(
  code: ConstructorParameters<typeof RecurringCommandError>[0],
  message: string,
  field?: string,
): never {
  throw new RecurringCommandError(code, message, field);
}

function dbCode(error: unknown, key: "code" | "constraint"): string | undefined {
  let candidate: unknown = error;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (
      candidate &&
      typeof candidate === "object" &&
      key in candidate &&
      typeof (candidate as Record<string, unknown>)[key] === "string"
    ) {
      return (candidate as Record<string, string>)[key];
    }
    candidate =
      candidate && typeof candidate === "object" && "cause" in candidate
        ? (candidate as { cause?: unknown }).cause
        : undefined;
  }
  return undefined;
}

function mapPersistenceError(error: unknown): RecurringCommandError | null {
  const code = dbCode(error, "code");
  const constraint = dbCode(error, "constraint");
  if (code === "23505") {
    return new RecurringCommandError(
      "CONFLICT",
      "A operação conflita com outra fonte de compromisso.",
      constraint?.includes("occurrences") ? "occurrenceKey" : undefined,
    );
  }
  if (code === "23503") {
    return new RecurringCommandError(
      "TENANT_RESOURCE_NOT_FOUND",
      "Recurso não encontrado.",
    );
  }
  if (code === "23514") {
    return new RecurringCommandError(
      "INVALID_OCCURRENCE",
      "A ocorrência viola uma regra de integridade.",
    );
  }
  return null;
}

async function toResult<T>(work: () => Promise<T>): Promise<RecurringResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    const mapped =
      error instanceof RecurringCommandError
        ? error
        : error instanceof RecurrenceDomainError
          ? toRecurringCommandError(error)
          : mapPersistenceError(error);
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
  transaction: RecurringTransaction,
  context: FinancialContext,
  commandId: string,
  operation: RecurringOperation,
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
    recurringDomainError("COMMAND_ID_REUSED", "O identificador da operação já foi utilizado.", "commandId");
  }
  if (!record.resourceId) {
    throw new Error("O registro de idempotência não possui recurso associado.");
  }
  return { created: false, record };
}

async function setCommandResource(
  transaction: RecurringTransaction,
  context: FinancialContext,
  commandId: string,
  resourceId: string,
): Promise<void> {
  await transaction
    .update(applicationCommands)
    .set({ resourceId })
    .where(
      and(
        eq(applicationCommands.householdId, context.householdId),
        eq(applicationCommands.commandId, commandId),
      ),
    );
}

async function findRule(
  transaction: RecurringTransaction,
  context: FinancialContext,
  ruleId: string,
  lock = false,
): Promise<RecurringRuleRecord | undefined> {
  const query = transaction
    .select()
    .from(recurringRules)
    .where(
      and(
        eq(recurringRules.id, ruleId),
        eq(recurringRules.householdId, context.householdId),
      ),
    )
    .limit(1);
  return (lock ? await query.for("update") : await query)[0];
}

async function findOccurrence(
  transaction: RecurringTransaction,
  context: FinancialContext,
  ruleId: string,
  occurrenceKey: string,
  lock = false,
): Promise<RecurringOccurrenceRecord | undefined> {
  const query = transaction
    .select()
    .from(recurringOccurrences)
    .where(
      and(
        eq(recurringOccurrences.recurringRuleId, ruleId),
        eq(recurringOccurrences.occurrenceKey, occurrenceKey),
        eq(recurringOccurrences.householdId, context.householdId),
      ),
    )
    .limit(1);
  return (lock ? await query.for("update") : await query)[0];
}

async function findOccurrenceById(
  transaction: RecurringTransaction,
  context: FinancialContext,
  occurrenceId: string,
): Promise<RecurringOccurrenceRecord | undefined> {
  const rows = await transaction
    .select()
    .from(recurringOccurrences)
    .where(
      and(
        eq(recurringOccurrences.id, occurrenceId),
        eq(recurringOccurrences.householdId, context.householdId),
      ),
    )
    .limit(1);
  return rows[0];
}

async function findFinancialEvent(
  transaction: RecurringTransaction,
  context: FinancialContext,
  eventId: string,
): Promise<FinancialEventRecord | undefined> {
  const rows = await transaction
    .select()
    .from(financialEvents)
    .where(
      and(
        eq(financialEvents.id, eventId),
        eq(financialEvents.householdId, context.householdId),
      ),
    )
    .limit(1);
  return rows[0];
}

async function assertReferences(
  transaction: RecurringTransaction,
  context: FinancialContext,
  values: { accountId?: string | null; categoryId?: string | null; kind: "EXPENSE" | "INCOME" },
): Promise<void> {
  if (values.accountId !== undefined && values.accountId !== null) {
    const account = await transaction
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, values.accountId), eq(accounts.householdId, context.householdId)))
      .limit(1);
    if (!account[0]) recurringDomainError("TENANT_RESOURCE_NOT_FOUND", "Recurso não encontrado.", "accountId");
  }
  if (values.categoryId !== undefined && values.categoryId !== null) {
    const category = await transaction
      .select({ id: categories.id, kind: categories.kind })
      .from(categories)
      .where(and(eq(categories.id, values.categoryId), eq(categories.householdId, context.householdId)))
      .limit(1);
    if (!category[0]) recurringDomainError("TENANT_RESOURCE_NOT_FOUND", "Recurso não encontrado.", "categoryId");
    if (category[0].kind !== values.kind) {
      recurringDomainError("INVALID_RULE", "A categoria não corresponde ao tipo da recorrência.", "categoryId");
    }
  }
}

function pureRule(row: RecurringRuleRecord): Parameters<typeof normalizeRecurringRule>[0] {
  return {
    id: row.id,
    householdId: row.householdId,
    kind: recurringKind(row.kind),
    amountCents: row.amountCents.toString(10),
    frequency: row.frequency,
    dayRule: row.dayRule,
    dayOfMonth: row.dayOfMonth,
    startOn: row.startOn,
    endOn: row.endOn,
    includeInConservativeForecast: row.includeInConservativeForecast,
  };
}

async function executeCreateRule(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<RecurringRuleReadModel> {
  const command = parseCreateRecurringRuleCommand(input);
  normalizeRecurringRule({
    ...command,
    direction: command.kind === "INCOME" ? "INFLOW" : "OUTFLOW",
    label: command.description,
  });
  const id = generateUuidV7();
  const hash = payloadHash(RECURRING_RULE_CREATE_OPERATION, { ...command, commandId: undefined });
  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(transaction, context, command.commandId, RECURRING_RULE_CREATE_OPERATION, hash, id);
    if (!claim.created) {
      const row = await findRule(transaction, context, claim.record.resourceId as string);
      if (!row) throw new Error("A regra associada ao command não foi encontrada.");
      return ruleReadModel(row);
    }
    await assertReferences(transaction, context, command);
    const rows = await transaction
      .insert(recurringRules)
      .values({
        id,
        householdId: context.householdId,
        accountId: command.accountId ?? null,
        categoryId: command.categoryId ?? null,
        kind: command.kind,
        amountCents: BigInt(command.amountCents),
        description: command.description,
        frequency: command.frequency,
        dayRule: command.dayRule,
        dayOfMonth: command.dayOfMonth ?? null,
        startOn: command.startOn,
        endOn: command.endOn ?? null,
        includeInConservativeForecast: command.includeInConservativeForecast ?? true,
      })
      .returning();
    if (!rows[0]) throw new Error("A regra não foi criada.");
    return ruleReadModel(rows[0]);
  });
}

async function executeUpdateRuleFuture(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<RecurringRuleReadModel> {
  const command = parseUpdateRecurringRuleFutureCommand(input);
  const id = generateUuidV7();
  const hash = payloadHash(RECURRING_RULE_UPDATE_FUTURE_OPERATION, { ...command, commandId: undefined });
  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(transaction, context, command.commandId, RECURRING_RULE_UPDATE_FUTURE_OPERATION, hash, id);
    if (!claim.created) {
      const row = await findRule(transaction, context, claim.record.resourceId as string);
      if (!row) throw new Error("A regra associada ao command não foi encontrada.");
      return ruleReadModel(row);
    }
    const current = await findRule(transaction, context, command.recurringRuleId, true);
    if (!current) recurringDomainError("RULE_NOT_FOUND", "Regra não encontrada.", "recurringRuleId");
    const currentPure = pureRule(current);
    const currentKind = recurringKind(current.kind);
    const nextInput = {
      ...currentPure,
      ...command,
      id,
      recurringRuleId: id,
      householdId: context.householdId,
      startOn: command.effectiveFrom,
      endOn: command.endOn === undefined ? current.endOn : command.endOn,
      // The persisted row uses `kind`; direction is derived by the pure rule.
      direction: (command.kind ?? currentKind) === "INCOME" ? "INFLOW" as const : "OUTFLOW" as const,
      amountCents: command.amountCents ?? current.amountCents.toString(10),
      description: command.description ?? current.description,
      frequency: command.frequency ?? current.frequency,
      dayRule: command.dayRule ?? current.dayRule,
      dayOfMonth: command.dayOfMonth === undefined ? current.dayOfMonth : command.dayOfMonth,
      // T02 stores the annual month in start_on; monthly versions must not
      // inherit the old annual month as an invalid monthly field.
      monthOfYear:
        (command.frequency ?? current.frequency) === "MONTHLY"
          ? null
          : undefined,
      includeInConservativeForecast:
        command.includeInConservativeForecast ?? current.includeInConservativeForecast,
    };
    const change = createProspectiveRuleVersion(currentPure, nextInput, command.effectiveFrom);
    const next = change.next;
    const previousEnd = change.previous.endOn;
    if (previousEnd === null) {
      recurringDomainError(
        "INVALID_RULE_RANGE",
        "A nova versão não possui encerramento anterior.",
      );
    }
    await assertReferences(transaction, context, {
      accountId: command.accountId === undefined ? current.accountId : command.accountId,
      categoryId: command.categoryId === undefined ? current.categoryId : command.categoryId,
      kind: command.kind ?? currentKind,
    });
    await transaction
      .update(recurringRules)
      .set({ endOn: formatRecurrenceDate(previousEnd), updatedAt: new Date() })
      .where(and(eq(recurringRules.id, current.id), eq(recurringRules.householdId, context.householdId)));
    const rows = await transaction
      .insert(recurringRules)
      .values({
        id,
        householdId: context.householdId,
        accountId: command.accountId === undefined ? current.accountId : command.accountId,
        categoryId: command.categoryId === undefined ? current.categoryId : command.categoryId,
        kind: command.kind ?? currentKind,
        amountCents: BigInt(next.amountCents),
        description: command.description ?? current.description,
        frequency: command.frequency ?? current.frequency,
        dayRule: command.dayRule ?? current.dayRule,
        dayOfMonth: next.dayOfMonth,
        startOn: formatRecurrenceDate(next.startOn),
        endOn: next.endOn ? formatRecurrenceDate(next.endOn) : null,
        includeInConservativeForecast:
          command.includeInConservativeForecast ?? current.includeInConservativeForecast,
      })
      .returning();
    if (!rows[0]) throw new Error("A nova versão da regra não foi criada.");
    return ruleReadModel(rows[0]);
  });
}

async function executeEndRule(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<RecurringRuleReadModel> {
  const command = parseEndRecurringRuleCommand(input);
  const hash = payloadHash(RECURRING_RULE_END_OPERATION, { ...command, commandId: undefined });
  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(transaction, context, command.commandId, RECURRING_RULE_END_OPERATION, hash, command.recurringRuleId);
    if (!claim.created) {
      const row = await findRule(transaction, context, claim.record.resourceId as string);
      if (!row) throw new Error("A regra associada ao command não foi encontrada.");
      return ruleReadModel(row);
    }
    const current = await findRule(transaction, context, command.recurringRuleId, true);
    if (!current) recurringDomainError("RULE_NOT_FOUND", "Regra não encontrada.", "recurringRuleId");
    const nextEnd = parseRecurrenceDate(command.endOn, "endOn");
    const currentStart = parseRecurrenceDate(current.startOn, "startOn");
    if (compareRecurrenceDates(nextEnd, currentStart) < 0) {
      recurringDomainError("INVALID_RULE_RANGE", "endOn deve ser posterior ao início da regra.", "endOn");
    }
    if (current.endOn !== null && nextEnd.toString() > current.endOn) {
      recurringDomainError("RULE_ALREADY_ENDED", "A regra já possui um encerramento anterior.", "endOn");
    }
    const rows = await transaction
      .update(recurringRules)
      .set({ endOn: formatRecurrenceDate(nextEnd), updatedAt: new Date() })
      .where(and(eq(recurringRules.id, current.id), eq(recurringRules.householdId, context.householdId)))
      .returning();
    if (!rows[0]) throw new Error("A regra não foi encerrada.");
    return ruleReadModel(rows[0]);
  });
}

async function executeOverrideOccurrence(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<RecurringOccurrenceReadModel> {
  const command = parseOverrideRecurringOccurrenceCommand(input);
  const hash = payloadHash(RECURRING_OCCURRENCE_OVERRIDE_OPERATION, { ...command, commandId: undefined });
  const commandResourceId = generateUuidV7();
  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(transaction, context, command.commandId, RECURRING_OCCURRENCE_OVERRIDE_OPERATION, hash, commandResourceId);
    if (!claim.created) {
      const row = await findOccurrenceById(transaction, context, claim.record.resourceId as string);
      if (!row) throw new Error("A ocorrência associada ao command não foi encontrada.");
      return occurrenceReadModel(row);
    }
    const rule = await findRule(transaction, context, command.recurringRuleId, true);
    if (!rule) recurringDomainError("RULE_NOT_FOUND", "Regra não encontrada.", "recurringRuleId");
    validateOccurrenceKey(rule.frequency, command.occurrenceKey);
    const existing = await findOccurrence(transaction, context, rule.id, command.occurrenceKey, true);
    if (existing?.status === "POSTED") recurringDomainError("OCCURRENCE_ALREADY_REALIZED", "A ocorrência já foi realizada.", "occurrenceKey");
    if (existing?.status === "CANCELLED") recurringDomainError("INVALID_OCCURRENCE", "A ocorrência está cancelada.", "occurrenceKey");
    const values = {
      amountCents: command.amountCents === undefined ? existing?.amountCents ?? null : BigInt(command.amountCents),
      expectedOn: command.expectedOn === undefined ? existing?.expectedOn ?? null : command.expectedOn,
    };
    const row = existing
      ? (await transaction
          .update(recurringOccurrences)
          .set({ ...values, updatedAt: new Date() })
          .where(and(eq(recurringOccurrences.id, existing.id), eq(recurringOccurrences.householdId, context.householdId)))
          .returning())[0]
      : (await transaction
          .insert(recurringOccurrences)
          .values({
            id: commandResourceId,
            householdId: context.householdId,
            recurringRuleId: rule.id,
            occurrenceKey: command.occurrenceKey,
            status: "PLANNED",
            ...values,
            financialEventId: null,
            isPartial: false,
          })
          .returning())[0];
    if (!row) throw new Error("O override da ocorrência não foi salvo.");
    if (row.id !== commandResourceId) await setCommandResource(transaction, context, command.commandId, row.id);
    return occurrenceReadModel(row);
  });
}

async function executeCancelOccurrence(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<RecurringOccurrenceReadModel> {
  const command = parseCancelRecurringOccurrenceCommand(input);
  const hash = payloadHash(RECURRING_OCCURRENCE_CANCEL_OPERATION, { ...command, commandId: undefined });
  const commandResourceId = generateUuidV7();
  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(transaction, context, command.commandId, RECURRING_OCCURRENCE_CANCEL_OPERATION, hash, commandResourceId);
    if (!claim.created) {
      const row = await findOccurrenceById(transaction, context, claim.record.resourceId as string);
      if (!row) throw new Error("A ocorrência associada ao command não foi encontrada.");
      return occurrenceReadModel(row);
    }
    const rule = await findRule(transaction, context, command.recurringRuleId, true);
    if (!rule) recurringDomainError("RULE_NOT_FOUND", "Regra não encontrada.", "recurringRuleId");
    validateOccurrenceKey(rule.frequency, command.occurrenceKey);
    const existing = await findOccurrence(transaction, context, rule.id, command.occurrenceKey, true);
    if (existing?.status === "POSTED") recurringDomainError("OCCURRENCE_ALREADY_REALIZED", "A ocorrência já foi realizada.", "occurrenceKey");
    const row = existing
      ? (await transaction
          .update(recurringOccurrences)
          .set({ status: "CANCELLED", financialEventId: null, isPartial: false, updatedAt: new Date() })
          .where(and(eq(recurringOccurrences.id, existing.id), eq(recurringOccurrences.householdId, context.householdId)))
          .returning())[0]
      : (await transaction
          .insert(recurringOccurrences)
          .values({
            id: commandResourceId,
            householdId: context.householdId,
            recurringRuleId: rule.id,
            occurrenceKey: command.occurrenceKey,
            status: "CANCELLED",
            amountCents: null,
            expectedOn: null,
            financialEventId: null,
            isPartial: false,
          })
          .returning())[0];
    if (!row) throw new Error("O cancelamento da ocorrência não foi salvo.");
    if (row.id !== commandResourceId) await setCommandResource(transaction, context, command.commandId, row.id);
    return occurrenceReadModel(row);
  });
}

async function executeRealizeOccurrence(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<RecurringOccurrenceReadModel> {
  const command = parseRealizeRecurringOccurrenceCommand(input);
  const hash = payloadHash(RECURRING_OCCURRENCE_REALIZE_OPERATION, { ...command, commandId: undefined });
  const commandResourceId = generateUuidV7();
  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(transaction, context, command.commandId, RECURRING_OCCURRENCE_REALIZE_OPERATION, hash, commandResourceId);
    if (!claim.created) {
      const row = await findOccurrenceById(transaction, context, claim.record.resourceId as string);
      if (!row) throw new Error("A ocorrência associada ao command não foi encontrada.");
      return occurrenceReadModel(row);
    }
    const rule = await findRule(transaction, context, command.recurringRuleId, true);
    if (!rule) recurringDomainError("RULE_NOT_FOUND", "Regra não encontrada.", "recurringRuleId");
    validateOccurrenceKey(rule.frequency, command.occurrenceKey);
    const event = await findFinancialEvent(transaction, context, command.financialEventId);
    if (!event) recurringDomainError("TENANT_RESOURCE_NOT_FOUND", "Recurso não encontrado.", "financialEventId");
    if (event.status !== "POSTED" || event.kind !== rule.kind) {
      recurringDomainError("INVALID_OCCURRENCE", "Realização exige fato POSTED do mesmo tipo.", "financialEventId");
    }
    const existing = await findOccurrence(transaction, context, rule.id, command.occurrenceKey, true);
    if (existing?.status === "CANCELLED") recurringDomainError("INVALID_OCCURRENCE", "A ocorrência está cancelada.", "occurrenceKey");
    if (existing?.status === "POSTED") {
      if (existing.financialEventId === event.id && existing.isPartial === command.isPartial) {
        return occurrenceReadModel(existing);
      }
      recurringDomainError("OCCURRENCE_ALREADY_REALIZED", "A ocorrência já foi realizada.", "occurrenceKey");
    }
    const row = existing
      ? (await transaction
          .update(recurringOccurrences)
          .set({ status: "POSTED", financialEventId: event.id, isPartial: command.isPartial, updatedAt: new Date() })
          .where(and(eq(recurringOccurrences.id, existing.id), eq(recurringOccurrences.householdId, context.householdId)))
          .returning())[0]
      : (await transaction
          .insert(recurringOccurrences)
          .values({
            id: commandResourceId,
            householdId: context.householdId,
            recurringRuleId: rule.id,
            occurrenceKey: command.occurrenceKey,
            status: "POSTED",
            amountCents: null,
            expectedOn: null,
            financialEventId: event.id,
            isPartial: command.isPartial,
          })
          .returning())[0];
    if (!row) throw new Error("A realização da ocorrência não foi salva.");
    if (row.id !== commandResourceId) await setCommandResource(transaction, context, command.commandId, row.id);
    return occurrenceReadModel(row);
  });
}

function isDatabase(value: unknown): value is Database {
  return typeof value === "object" && value !== null && "select" in value && "transaction" in value;
}

function toOptions(value: Database | RecurringUseCaseOptions | undefined): RecurringUseCaseOptions {
  return isDatabase(value) ? { database: value } : value ?? {};
}

/** Composes all tenant-safe recurring writes around one transaction boundary. */
export function createRecurringUseCases(database?: Database): RecurringUseCasePort;
export function createRecurringUseCases(options?: RecurringUseCaseOptions): RecurringUseCasePort;
export function createRecurringUseCases(databaseOrOptions?: Database | RecurringUseCaseOptions): RecurringUseCasePort {
  const options = toOptions(databaseOrOptions);
  const run = <T>(context: FinancialContext, work: (database: Database) => Promise<T>) => {
    assertFinancialContext(context);
    return toResult(() => work(resolveDatabase(options.database)));
  };
  const port = {
    createRule: (context: FinancialContext, command: unknown) => run(context, (database) => executeCreateRule(database, context, command)),
    updateRuleFuture: (context: FinancialContext, command: unknown) => run(context, (database) => executeUpdateRuleFuture(database, context, command)),
    endRule: (context: FinancialContext, command: unknown) => run(context, (database) => executeEndRule(database, context, command)),
    overrideOccurrence: (context: FinancialContext, command: unknown) => run(context, (database) => executeOverrideOccurrence(database, context, command)),
    cancelOccurrence: (context: FinancialContext, command: unknown) => run(context, (database) => executeCancelOccurrence(database, context, command)),
    realizeOccurrence: (context: FinancialContext, command: unknown) => run(context, (database) => executeRealizeOccurrence(database, context, command)),
  } as RecurringUseCasePort;
  return {
    ...port,
    create: port.createRule,
    updateFuture: port.updateRuleFuture,
    end: port.endRule,
    override: port.overrideOccurrence,
    cancel: port.cancelOccurrence,
    realize: port.realizeOccurrence,
  };
}

export const recurringUseCases = createRecurringUseCases();
export const recurringUseCasePort = recurringUseCases;

export async function createRecurringRule(context: FinancialContext, command: unknown, database?: Database): Promise<RecurringResult<RecurringRuleReadModel>> {
  return createRecurringUseCases(database).createRule(context, command);
}
export async function updateRecurringRuleFuture(context: FinancialContext, command: unknown, database?: Database): Promise<RecurringResult<RecurringRuleReadModel>> {
  return createRecurringUseCases(database).updateRuleFuture(context, command);
}
export async function endRecurringRule(context: FinancialContext, command: unknown, database?: Database): Promise<RecurringResult<RecurringRuleReadModel>> {
  return createRecurringUseCases(database).endRule(context, command);
}
export async function overrideRecurringOccurrence(context: FinancialContext, command: unknown, database?: Database): Promise<RecurringResult<RecurringOccurrenceReadModel>> {
  return createRecurringUseCases(database).overrideOccurrence(context, command);
}
export async function cancelRecurringOccurrence(context: FinancialContext, command: unknown, database?: Database): Promise<RecurringResult<RecurringOccurrenceReadModel>> {
  return createRecurringUseCases(database).cancelOccurrence(context, command);
}
export async function realizeRecurringOccurrence(context: FinancialContext, command: unknown, database?: Database): Promise<RecurringResult<RecurringOccurrenceReadModel>> {
  return createRecurringUseCases(database).realizeOccurrence(context, command);
}

export const CreateRecurringRule = createRecurringRule;
export const UpdateRecurringRuleFuture = updateRecurringRuleFuture;
export const EndRecurringRule = endRecurringRule;
export const OverrideRecurringOccurrence = overrideRecurringOccurrence;
export const CancelRecurringOccurrence = cancelRecurringOccurrence;
export const RealizeRecurringOccurrence = realizeRecurringOccurrence;
