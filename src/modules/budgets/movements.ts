/**
 * Transactional movement commands for S09.
 *
 * The movement stream is append-only.  This module owns the server-side
 * transaction boundary, command idempotency and the small amount of mapping
 * needed to persist the pure T02/T04 results.  It deliberately does not keep
 * a balance column, create ledger events for box transfers, or expose the
 * household as caller-controlled input.
 */
import { createHash } from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  applicationCommands,
  categories,
  type ApplicationCommandRecord,
} from "@/db/accounts-categories-schema";
import {
  accountEntries,
  financialEvents,
  type AccountEntryRecord,
  type FinancialEventRecord,
} from "@/db/financial-events-schema";
import {
  budgetAllocationRules,
  budgetMovements,
  budgets,
  type BudgetMovementRecord,
  type BudgetRecord,
} from "@/db/budgets-schema";
import { generateUuidV7 } from "@/lib/uuidv7";
import type { FinancialContext } from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import {
  createS09BudgetOperation,
  measureS09Query,
  withS09BudgetObservability,
  type S09BudgetAggregateCounts,
  type S09BudgetCompletionOptions,
  type S09BudgetOperationOptions,
  type S09BudgetQueryOptions,
} from "@/modules/observability/s09";

import {
  distributeRealizedIncome,
  type AllocationDistribution,
  type AllocationBudgetReferenceInput,
  type AllocationRuleInput,
} from "./allocation-rules";
import {
  budgetMovementSchema,
  correctMovementCommandSchema,
  BudgetDomainError,
  budgetFailure,
  budgetOk,
  budgetOpaqueReferenceSchema,
  distributeRealizedIncomeCommandSchema,
  registerContributionCommandSchema,
  registerWithdrawalCommandSchema,
  transferBetweenBudgetsCommandSchema,
  type Budget,
  type BudgetCorrectionBoundary,
  type BudgetDistributionBoundary,
  type BudgetDistributionStatus,
  type BudgetErrorCode,
  type BudgetErrorField,
  type BudgetMovement,
  type BudgetMovementBoundary,
  type BudgetMovementSourceKind,
  type BudgetResult,
  type BudgetTransferBoundary,
  type CorrectMovementCommand,
  type DistributeRealizedIncomeCommand,
  type RegisterContributionCommand,
  type RegisterWithdrawalCommand,
  type TransferBetweenBudgetsCommand,
  BUDGET_MOVEMENT_SOURCE_KINDS,
} from "./contracts";
import {
  createBudgetTransfer,
  createContributionMovement,
  createWithdrawalMovement,
  correctBudgetMovement,
  normalizeBudget,
  normalizeBudgetCommandId,
  normalizeBudgetMovement,
  parseBudgetDate,
  serializeBudgetDate,
  serializeBudgetMovement,
} from "./domain";

/** Drizzle transaction type shared by node-postgres and Neon. */
export type BudgetMovementTransaction =
  Parameters<NonNullable<ReturnType<typeof getDb>["transaction"]>>[0] extends (
    transaction: infer Transaction,
  ) => Promise<unknown>
    ? Transaction
    : never;

export const BUDGET_MOVEMENT_COMMAND_OPERATIONS = {
  contribution: "budget.movement.contribution",
  withdrawal: "budget.movement.withdrawal",
  transfer: "budget.movement.transfer",
  correct: "budget.movement.correct",
  distribution: "budget.distribution",
} as const;

export type BudgetMovementCommandOperation =
  (typeof BUDGET_MOVEMENT_COMMAND_OPERATIONS)[keyof typeof BUDGET_MOVEMENT_COMMAND_OPERATIONS];

export interface BudgetMovementUseCasePort {
  registerContribution(
    context: FinancialContext,
    command: unknown,
  ): Promise<BudgetResult<BudgetMovementBoundary>>;
  registerWithdrawal(
    context: FinancialContext,
    command: unknown,
  ): Promise<BudgetResult<BudgetMovementBoundary>>;
  transferBetweenBudgets(
    context: FinancialContext,
    command: unknown,
  ): Promise<BudgetResult<BudgetTransferBoundary>>;
  correctMovement(
    context: FinancialContext,
    command: unknown,
  ): Promise<BudgetResult<BudgetCorrectionBoundary>>;
  distributeRealizedIncome(
    context: FinancialContext,
    command: unknown,
  ): Promise<BudgetResult<BudgetDistributionBoundary>>;
  /** Short aliases used by application callers. */
  contribution: BudgetMovementUseCasePort["registerContribution"];
  withdrawal: BudgetMovementUseCasePort["registerWithdrawal"];
  transfer: BudgetMovementUseCasePort["transferBetweenBudgets"];
  correct: BudgetMovementUseCasePort["correctMovement"];
  distribute: BudgetMovementUseCasePort["distributeRealizedIncome"];
}

export interface BudgetMovementUseCaseOptions {
  readonly database?: Database;
  /** Safe aggregate-only hooks for the movement transaction boundary. */
  readonly observability?:
    S09BudgetCompletionOptions & S09BudgetOperationOptions & S09BudgetQueryOptions;
}

/** The command parser is strict and keeps Zod out of the public error shape. */
function parseCommand<T>(
  schema: {
    safeParse(value: unknown):
      | { readonly success: true; readonly data: T }
      | {
          readonly success: false;
          readonly error: {
            readonly issues?: readonly {
              readonly path: readonly (string | number)[];
              readonly message?: string;
            }[];
          };
        };
  },
  value: unknown,
  fallback: BudgetErrorCode = "INVALID_COMMAND",
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  const path = parsed.error.issues?.[0]?.path ?? [];
  const issueMessage = parsed.error.issues?.[0]?.message;
  if (issueMessage === "origem e destino devem ser diferentes") {
    throw new BudgetDomainError("TRANSFER_SAME_BUDGET", "destinationBudgetReferenceId");
  }
  if (
    issueMessage === "as referências do par devem ser diferentes" ||
    issueMessage === "a correção precisa ter nova referência"
  ) {
    throw new BudgetDomainError(
      "DUPLICATE_REFERENCE",
      issueMessage === "a correção precisa ter nova referência"
        ? "correctionReferenceId"
        : "contributionReferenceId",
    );
  }
  const candidate = path[path.length - 1];
  const field =
    typeof candidate === "string" &&
    [
      "commandId",
      "referenceId",
      "budgetReferenceId",
      "boxReferenceId",
      "sourceReferenceId",
      "financialEventId",
      "accountEntryId",
      "sourceKind",
      "amountCents",
      "effectiveOn",
      "correctsReferenceId",
      "correctionReferenceId",
      "withdrawalReferenceId",
      "contributionReferenceId",
      "sourceBudgetReferenceId",
      "destinationBudgetReferenceId",
    ].includes(candidate)
      ? (candidate as BudgetErrorField)
      : undefined;

  if (field === "commandId") {
    throw new BudgetDomainError("INVALID_COMMAND_ID", field);
  }
  if (
    field === "referenceId" ||
    field === "budgetReferenceId" ||
    field === "boxReferenceId" ||
    field === "sourceReferenceId" ||
    field === "financialEventId" ||
    field === "accountEntryId" ||
    field === "correctsReferenceId" ||
    field === "correctionReferenceId" ||
    field === "withdrawalReferenceId" ||
    field === "contributionReferenceId" ||
    field === "sourceBudgetReferenceId" ||
    field === "destinationBudgetReferenceId"
  ) {
    throw new BudgetDomainError("INVALID_REFERENCE", field);
  }
  if (field === "amountCents") {
    throw new BudgetDomainError("INVALID_AMOUNT", field);
  }
  if (field === "effectiveOn") {
    throw new BudgetDomainError("INVALID_DATE", field);
  }
  throw new BudgetDomainError(fallback);
}

export function parseRegisterContributionCommand(
  value: unknown,
): RegisterContributionCommand {
  return parseCommand(registerContributionCommandSchema, value);
}

export function parseRegisterWithdrawalCommand(
  value: unknown,
): RegisterWithdrawalCommand {
  return parseCommand(registerWithdrawalCommandSchema, value);
}

export function parseTransferBetweenBudgetsCommand(
  value: unknown,
): TransferBetweenBudgetsCommand {
  return parseCommand(transferBetweenBudgetsCommandSchema, value);
}

export function parseCorrectMovementCommand(
  value: unknown,
): CorrectMovementCommand {
  return parseCommand(correctMovementCommandSchema, value);
}

export function parseDistributeRealizedIncomeCommand(
  value: unknown,
): DistributeRealizedIncomeCommand {
  return parseCommand(distributeRealizedIncomeCommandSchema, value);
}

function databaseFor(database?: Database): Database {
  return database ?? getDb();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function payloadHash(
  operation: BudgetMovementCommandOperation,
  payload: unknown,
): string {
  return createHash("sha256")
    .update(canonicalJson({ operation, payload }), "utf8")
    .digest("hex");
}

function commandPayload(command: RegisterContributionCommand | RegisterWithdrawalCommand) {
  return {
    budgetReferenceId: command.budgetReferenceId,
    amountCents: command.amountCents,
    effectiveOn: command.effectiveOn,
    referenceId: command.referenceId ?? null,
    sourceReferenceId: command.sourceReferenceId ?? null,
    financialEventId: command.financialEventId ?? null,
    accountEntryId: command.accountEntryId ?? null,
    sourceKind: command.sourceKind ?? "MANUAL",
  };
}

function transferReferenceForCommand(command: TransferBetweenBudgetsCommand): string {
  if (command.transferReferenceId !== undefined) return command.transferReferenceId;
  const reference = `transfer:${command.commandId}`;
  return reference.length <= 256
    ? reference
    : `transfer:${createHash("sha256").update(reference).digest("hex")}`;
}

function boundedDerivedReference(prefix: string, value: string): string {
  const candidate = `${prefix}:${value}`;
  return candidate.length <= 256
    ? candidate
    : `${prefix}:${createHash("sha256").update(candidate).digest("hex")}`;
}

function transferMovementReferenceForCommand(
  command: TransferBetweenBudgetsCommand,
  side: "withdrawal" | "contribution",
): string {
  const explicit =
    side === "withdrawal"
      ? command.withdrawalReferenceId
      : command.contributionReferenceId;
  return explicit ?? boundedDerivedReference(
    transferReferenceForCommand(command),
    side,
  );
}

function correctionReferenceForCommand(command: CorrectMovementCommand): string {
  return command.correctionReferenceId ??
    boundedDerivedReference("correction", command.commandId);
}

function transferPayload(command: TransferBetweenBudgetsCommand) {
  return {
    sourceBudgetReferenceId: command.sourceBudgetReferenceId,
    destinationBudgetReferenceId: command.destinationBudgetReferenceId,
    amountCents: command.amountCents,
    effectiveOn: command.effectiveOn,
    withdrawalReferenceId: transferMovementReferenceForCommand(command, "withdrawal"),
    contributionReferenceId: transferMovementReferenceForCommand(command, "contribution"),
    transferReferenceId: transferReferenceForCommand(command),
  };
}

function correctionPayload(command: CorrectMovementCommand) {
  return {
    budgetReferenceId: command.budgetReferenceId,
    correctsReferenceId: command.correctsReferenceId,
    correctionReferenceId: correctionReferenceForCommand(command),
    effectiveOn: command.effectiveOn ?? null,
    replacement: command.replacement ?? null,
  };
}

function distributionPayload(command: DistributeRealizedIncomeCommand) {
  return {
    financialEventId: command.financialEventId ?? command.incomeReferenceId,
    amountCents: command.amountCents ?? null,
    effectiveOn: command.effectiveOn ?? null,
  };
}

type CommandClaim =
  | { readonly created: true }
  | { readonly created: false; readonly record: ApplicationCommandRecord };

async function claimCommand(
  transaction: BudgetMovementTransaction,
  context: FinancialContext,
  commandId: string,
  operation: BudgetMovementCommandOperation,
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
  transaction: BudgetMovementTransaction,
  context: FinancialContext,
  commandId: string,
  operation: BudgetMovementCommandOperation,
  hash: string,
  result: unknown,
  resourceId?: string,
): Promise<void> {
  const updated = await transaction
    .update(applicationCommands)
    .set({
      result,
      ...(resourceId === undefined ? { resourceId: null } : { resourceId }),
    })
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

function uuid(value: string, field: BudgetErrorField): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  ) {
    throw new BudgetDomainError("INVALID_REFERENCE", field);
  }
  return value;
}

function persistenceCode(error: unknown): string | undefined {
  let candidate: unknown = error;
  for (let depth = 0; depth < 5 && candidate; depth += 1) {
    if (typeof candidate !== "object") return undefined;
    const value = candidate as { code?: unknown; cause?: unknown };
    if (typeof value.code === "string") return value.code;
    candidate = value.cause;
  }
  return undefined;
}

function persistenceConstraint(error: unknown): string | undefined {
  let candidate: unknown = error;
  for (let depth = 0; depth < 5 && candidate; depth += 1) {
    if (typeof candidate !== "object") return undefined;
    const value = candidate as { constraint?: unknown; cause?: unknown };
    if (typeof value.constraint === "string") return value.constraint;
    candidate = value.cause;
  }
  return undefined;
}

function persistenceError(error: unknown): BudgetDomainError | null {
  if (error instanceof BudgetDomainError) return error;
  const code = persistenceCode(error);
  const constraint = persistenceConstraint(error);
  if (code === "23505") {
    if (
      constraint === "budget_movements_household_reference_id_uq" ||
      constraint === "budget_movements_household_source_reference_uq" ||
      constraint === "budget_movements_household_account_entry_uq"
    ) {
      return new BudgetDomainError("DUPLICATE_REFERENCE", "referenceId");
    }
  }
  if (code === "23503") {
    if (constraint?.includes("correction")) {
      return new BudgetDomainError("MOVEMENT_NOT_FOUND", "correctsReferenceId");
    }
    if (constraint?.includes("financial_event")) {
      return new BudgetDomainError("INVALID_REFERENCE", "financialEventId");
    }
    if (constraint?.includes("account_entry")) {
      return new BudgetDomainError("INVALID_REFERENCE", "accountEntryId");
    }
    if (constraint?.includes("budget")) {
      return new BudgetDomainError("BUDGET_NOT_FOUND", "budgetReferenceId");
    }
  }
  if (code === "22P02") {
    return new BudgetDomainError("INVALID_REFERENCE", "referenceId");
  }
  if (code === "23514") {
    if (constraint?.includes("movement") || constraint?.includes("lifecycle")) {
      return new BudgetDomainError("BUDGET_CLOSED", "effectiveOn");
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

async function findBudgetByReference(
  transaction: BudgetMovementTransaction,
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

async function findMovementByReference(
  transaction: BudgetMovementTransaction,
  context: FinancialContext,
  budgetId: string,
  referenceId: string,
  lock = false,
): Promise<BudgetMovementRecord | undefined> {
  const query = transaction
    .select()
    .from(budgetMovements)
    .where(
      and(
        eq(budgetMovements.householdId, context.householdId),
        eq(budgetMovements.budgetId, budgetId),
        eq(budgetMovements.referenceId, referenceId),
      ),
    )
    .limit(1);
  return (lock ? await query.for("update") : await query)[0];
}

function budgetFromRecord(record: BudgetRecord): Budget {
  return normalizeBudget({
    referenceId: record.referenceId,
    name: record.name,
    categoryId: record.categoryId,
    status: record.status,
    activeFrom: record.activeFrom,
    closedOn: record.closedOn,
    targetAmountCents: record.targetAmountCents,
    targetDate: record.targetDate,
    householdId: record.householdId,
  });
}

async function movementFromRecord(
  transaction: BudgetMovementTransaction,
  context: FinancialContext,
  record: BudgetMovementRecord,
  budget?: Budget,
): Promise<BudgetMovement> {
  const aggregate =
    budget ??
    (() => {
      throw new Error("O aggregate da Caixinha é necessário para ler um movimento.");
    })();
  let correctsReferenceId: string | null = null;
  if (record.correctsMovementId !== null) {
    const original = await transaction
      .select({ referenceId: budgetMovements.referenceId })
      .from(budgetMovements)
      .where(
        and(
          eq(budgetMovements.householdId, context.householdId),
          eq(budgetMovements.id, record.correctsMovementId),
        ),
      )
      .limit(1);
    correctsReferenceId = original[0]?.referenceId ?? null;
  }
  return normalizeBudgetMovement(
    {
      referenceId: record.referenceId,
      boxReferenceId: aggregate.referenceId,
      kind: record.kind,
      amountCents: record.amountCents,
      effectiveOn: record.effectiveOn,
      correctsReferenceId,
      transferReferenceId: record.transferReferenceId,
      sourceReferenceId: record.sourceReferenceId,
    },
    aggregate,
  );
}

function parseStoredMovement(result: unknown): BudgetMovementBoundary | null {
  const parsed = budgetMovementSchema.safeParse(result);
  return parsed.success ? (parsed.data as BudgetMovementBoundary) : null;
}

function parseStoredTransfer(result: unknown): BudgetTransferBoundary | null {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const value = result as Record<string, unknown>;
  const source = budgetMovementSchema.safeParse(value.source);
  const destination = budgetMovementSchema.safeParse(value.destination);
  const movements = Array.isArray(value.movements) ? value.movements : [];
  const parsedMovements = movements.map((item) => budgetMovementSchema.safeParse(item));
  if (
    typeof value.transferReferenceId !== "string" ||
    !source.success ||
    !destination.success ||
    parsedMovements.length !== 2 ||
    parsedMovements.some((item) => !item.success)
  ) {
    return null;
  }
  return {
    transferReferenceId: value.transferReferenceId,
    source: source.data as BudgetMovementBoundary,
    destination: destination.data as BudgetMovementBoundary,
    movements: [
      parsedMovements[0]!.data as BudgetMovementBoundary,
      parsedMovements[1]!.data as BudgetMovementBoundary,
    ],
  };
}

function parseStoredCorrection(result: unknown): BudgetCorrectionBoundary | null {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const value = result as Record<string, unknown>;
  const original = budgetMovementSchema.safeParse(value.original);
  const compensation = budgetMovementSchema.safeParse(value.compensation);
  const replacement =
    value.replacement === null || value.replacement === undefined
      ? { success: true as const, data: null }
      : budgetMovementSchema.safeParse(value.replacement);
  const movements = Array.isArray(value.movements) ? value.movements : [];
  const parsedMovements = movements.map((item) => budgetMovementSchema.safeParse(item));
  if (
    !original.success ||
    !compensation.success ||
    !replacement.success ||
    parsedMovements.some((item) => !item.success)
  ) {
    return null;
  }
  return {
    original: original.data as BudgetMovementBoundary,
    compensation: compensation.data as BudgetMovementBoundary,
    replacement: replacement.data as BudgetMovementBoundary | null,
    movements: parsedMovements.map((item) => item.data as BudgetMovementBoundary),
  };
}

function parseStoredDistribution(result: unknown): BudgetDistributionBoundary | null {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const value = result as Record<string, unknown>;
  const contributions = Array.isArray(value.contributions)
    ? value.contributions.map((item) => budgetMovementSchema.safeParse(item))
    : [];
  if (
    typeof value.status !== "string" ||
    typeof value.incomeReferenceId !== "string" ||
    typeof value.effectiveOn !== "string" ||
    typeof value.originAmountCents !== "string" ||
    typeof value.distributedAmountCents !== "string" ||
    typeof value.remainingAmountCents !== "string" ||
    contributions.some((item) => !item.success)
  ) {
    return null;
  }
  return {
    status: value.status as BudgetDistributionStatus,
    incomeReferenceId: value.incomeReferenceId,
    effectiveOn: value.effectiveOn,
    originAmountCents: value.originAmountCents,
    distributedAmountCents: value.distributedAmountCents,
    remainingAmountCents: value.remainingAmountCents,
    contributions: contributions.map((item) => item.data as BudgetMovementBoundary),
    ruleReferenceIds: Array.isArray(value.ruleReferenceIds)
      ? value.ruleReferenceIds.filter((item): item is string => typeof item === "string")
      : [],
    reconciliationKey:
      typeof value.reconciliationKey === "string" ? value.reconciliationKey : null,
  };
}

async function retryMovement(
  transaction: BudgetMovementTransaction,
  context: FinancialContext,
  claim: Extract<CommandClaim, { readonly created: false }>,
): Promise<BudgetMovementBoundary> {
  const stored = parseStoredMovement(claim.record.result);
  if (stored) return stored;
  if (!claim.record.resourceId) {
    throw new Error("O comando de movimento não possui resultado persistido.");
  }
  const rows = await transaction
    .select()
    .from(budgetMovements)
    .where(
      and(
        eq(budgetMovements.householdId, context.householdId),
        eq(budgetMovements.id, claim.record.resourceId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("O movimento associado ao comando não foi encontrado.");
  const budgetRows = await transaction
    .select()
    .from(budgets)
    .where(
      and(
        eq(budgets.householdId, context.householdId),
        eq(budgets.id, row.budgetId),
      ),
    )
    .limit(1);
  const budget = budgetRows[0];
  if (!budget) throw new Error("A Caixinha associada ao comando não foi encontrada.");
  return serializeBudgetMovement(
    await movementFromRecord(transaction, context, row, budgetFromRecord(budget)),
  );
}

async function retryTransfer(
  transaction: BudgetMovementTransaction,
  context: FinancialContext,
  claim: Extract<CommandClaim, { readonly created: false }>,
): Promise<BudgetTransferBoundary> {
  const stored = parseStoredTransfer(claim.record.result);
  if (stored) return stored;
  throw new Error("A resposta de transferência não foi persistida.");
}

async function retryCorrection(
  claim: Extract<CommandClaim, { readonly created: false }>,
): Promise<BudgetCorrectionBoundary> {
  const stored = parseStoredCorrection(claim.record.result);
  if (stored) return stored;
  throw new Error("A resposta de correção não foi persistida.");
}

async function retryDistribution(
  claim: Extract<CommandClaim, { readonly created: false }>,
): Promise<BudgetDistributionBoundary> {
  const stored = parseStoredDistribution(claim.record.result);
  if (stored) return stored;
  throw new Error("A resposta de distribuição não foi persistida.");
}

function sourceKindFor(
  command: RegisterContributionCommand | RegisterWithdrawalCommand,
  kind: "CONTRIBUTION" | "WITHDRAWAL",
): BudgetMovementSourceKind {
  const sourceKind = command.sourceKind ?? "MANUAL";
  if (!(BUDGET_MOVEMENT_SOURCE_KINDS as readonly string[]).includes(sourceKind)) {
    throw new BudgetDomainError("INVALID_COMMAND", "sourceKind");
  }
  if (
    (sourceKind === "ALLOCATION" || sourceKind === "REFUND") &&
    kind !== "CONTRIBUTION"
  ) {
    throw new BudgetDomainError("INVALID_MOVEMENT_KIND", "kind");
  }
  if (sourceKind === "EXPENSE" && kind !== "WITHDRAWAL") {
    throw new BudgetDomainError("INVALID_MOVEMENT_KIND", "kind");
  }
  if (sourceKind === "CORRECTION" || sourceKind === "TRANSFER") {
    throw new BudgetDomainError("INVALID_COMMAND", "sourceKind");
  }
  return sourceKind;
}

async function findFinancialEvent(
  transaction: BudgetMovementTransaction,
  context: FinancialContext,
  eventId: string,
  lock = false,
): Promise<FinancialEventRecord | undefined> {
  const query = transaction
    .select()
    .from(financialEvents)
    .where(
      and(
        eq(financialEvents.householdId, context.householdId),
        eq(financialEvents.id, eventId),
      ),
    )
    .limit(1);
  return (lock ? await query.for("update") : await query)[0];
}

async function findAccountEntry(
  transaction: BudgetMovementTransaction,
  context: FinancialContext,
  entryId: string,
): Promise<AccountEntryRecord | undefined> {
  const rows = await transaction
    .select()
    .from(accountEntries)
    .where(
      and(
        eq(accountEntries.householdId, context.householdId),
        eq(accountEntries.id, entryId),
      ),
    )
    .limit(1);
  return rows[0];
}

interface SourceDetails {
  readonly sourceKind: BudgetMovementSourceKind;
  readonly sourceReferenceId: string | null;
  readonly financialEventId: string | null;
  readonly accountEntryId: string | null;
}

async function validateSource(
  transaction: BudgetMovementTransaction,
  context: FinancialContext,
  command: RegisterContributionCommand | RegisterWithdrawalCommand,
  kind: "CONTRIBUTION" | "WITHDRAWAL",
  amountCents: bigint,
  effectiveOn: string,
): Promise<SourceDetails> {
  const sourceKind = sourceKindFor(command, kind);
  const sourceReferenceId =
    command.sourceReferenceId === undefined
      ? null
      : budgetOpaqueReferenceSchema.parse(command.sourceReferenceId);
  const financialEventId =
    command.financialEventId === undefined
      ? null
      : uuid(command.financialEventId, "financialEventId");
  const accountEntryId =
    command.accountEntryId === undefined
      ? null
      : uuid(command.accountEntryId, "accountEntryId");

  if (sourceKind === "ALLOCATION" || sourceKind === "EXPENSE") {
    if (financialEventId === null) {
      throw new BudgetDomainError("INVALID_REFERENCE", "financialEventId");
    }
    const event = await findFinancialEvent(transaction, context, financialEventId);
    if (
      !event ||
      event.status !== "POSTED" ||
      (sourceKind === "ALLOCATION" && event.kind !== "INCOME") ||
      (sourceKind === "EXPENSE" &&
        event.kind !== "EXPENSE" &&
        event.kind !== "PURCHASE")
    ) {
      throw new BudgetDomainError("INVALID_REFERENCE", "financialEventId");
    }
    if (event.amountCents !== amountCents) {
      throw new BudgetDomainError("INVALID_AMOUNT", "amountCents");
    }
    if (event.occurredOn !== effectiveOn) {
      throw new BudgetDomainError("INVALID_DATE", "effectiveOn");
    }
  }

  if (accountEntryId !== null) {
    const entry = await findAccountEntry(transaction, context, accountEntryId);
    if (!entry || entry.status !== "POSTED" || entry.postedOn === null) {
      throw new BudgetDomainError("INVALID_REFERENCE", "accountEntryId");
    }
    if (financialEventId !== null && entry.financialEventId !== financialEventId) {
      throw new BudgetDomainError("INVALID_REFERENCE", "accountEntryId");
    }
    if (entry.amountCents < BigInt(0)
      ? -entry.amountCents !== amountCents
      : entry.amountCents !== amountCents) {
      throw new BudgetDomainError("INVALID_AMOUNT", "amountCents");
    }
  }

  if (
    sourceKind !== "MANUAL" &&
    sourceKind !== "REFUND" &&
    sourceReferenceId === null &&
    financialEventId === null
  ) {
    throw new BudgetDomainError("INVALID_REFERENCE", "sourceReferenceId");
  }

  return {
    sourceKind,
    sourceReferenceId: sourceReferenceId ?? financialEventId ?? accountEntryId,
    financialEventId,
    accountEntryId,
  };
}

async function insertMovement(
  transaction: BudgetMovementTransaction,
  context: FinancialContext,
  budget: BudgetRecord,
  movement: BudgetMovement,
  source: SourceDetails,
  id: string,
  correctsMovementId?: string | null,
): Promise<BudgetMovementRecord> {
  const rows = await transaction
    .insert(budgetMovements)
    .values({
      id,
      householdId: context.householdId,
      budgetId: budget.id,
      referenceId: movement.referenceId,
      kind: movement.kind,
      amountCents: movement.amount.cents,
      effectiveOn: serializeBudgetDate(movement.effectiveOn),
      sourceKind: source.sourceKind,
      sourceReferenceId: source.sourceReferenceId,
      financialEventId: source.financialEventId,
      accountEntryId: source.accountEntryId,
      correctsMovementId: correctsMovementId ?? null,
      transferReferenceId: movement.transferReferenceId,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("O movimento não foi persistido.");
  return row;
}

async function executeRegister(
  database: Database,
  context: FinancialContext,
  command: RegisterContributionCommand | RegisterWithdrawalCommand,
  kind: "CONTRIBUTION" | "WITHDRAWAL",
): Promise<BudgetMovementBoundary> {
  const commandId = normalizeBudgetCommandId(command.commandId);
  const operation =
    kind === "CONTRIBUTION"
      ? BUDGET_MOVEMENT_COMMAND_OPERATIONS.contribution
      : BUDGET_MOVEMENT_COMMAND_OPERATIONS.withdrawal;
  const hash = payloadHash(operation, commandPayload(command));
  const movementId = generateUuidV7();
  const movementReferenceId = command.referenceId ?? movementId;

  return database.transaction(async (transaction) => {
    const claim = await claimCommand(
      transaction,
      context,
      commandId,
      operation,
      hash,
      movementId,
    );
    if (!claim.created) return retryMovement(transaction, context, claim);

    const budgetRecord = await findBudgetByReference(
      transaction,
      context,
      command.budgetReferenceId,
      true,
    );
    if (!budgetRecord) {
      throw new BudgetDomainError("BUDGET_NOT_FOUND", "budgetReferenceId");
    }
    const budget = budgetFromRecord(budgetRecord);
    const date = parseBudgetDate(command.effectiveOn, "effectiveOn");
    const amount = command.amountCents;
    const movement =
      kind === "CONTRIBUTION"
        ? createContributionMovement(
            {
              referenceId: movementReferenceId,
              boxReferenceId: budget.referenceId,
              amountCents: amount,
              effectiveOn: date,
              sourceReferenceId: command.sourceReferenceId,
            },
            budget,
            { interactive: true },
          )
        : createWithdrawalMovement(
            {
              referenceId: movementReferenceId,
              boxReferenceId: budget.referenceId,
              amountCents: amount,
              effectiveOn: date,
              sourceReferenceId: command.sourceReferenceId,
            },
            budget,
            { interactive: true },
          );
    const source = await validateSource(
      transaction,
      context,
      command,
      kind,
      movement.amount.cents,
      serializeBudgetDate(date),
    );
    const persistedMovement = normalizeBudgetMovement(
      { ...movement, sourceReferenceId: source.sourceReferenceId },
      budget,
      { interactive: true },
    );
    const row = await insertMovement(
      transaction,
      context,
      budgetRecord,
      persistedMovement,
      source,
      movementId,
    );
    const result = serializeBudgetMovement(persistedMovement);
    await completeCommand(
      transaction,
      context,
      commandId,
      operation,
      hash,
      result,
      row.id,
    );
    return result;
  });
}

async function executeTransfer(
  database: Database,
  context: FinancialContext,
  command: TransferBetweenBudgetsCommand,
): Promise<BudgetTransferBoundary> {
  const commandId = normalizeBudgetCommandId(command.commandId);
  const hash = payloadHash(
    BUDGET_MOVEMENT_COMMAND_OPERATIONS.transfer,
    transferPayload(command),
  );
  const sourceId = generateUuidV7();
  const destinationId = generateUuidV7();
  const transferReferenceId = transferReferenceForCommand(command);

  return database.transaction(async (transaction) => {
    const claim = await claimCommand(
      transaction,
      context,
      commandId,
      BUDGET_MOVEMENT_COMMAND_OPERATIONS.transfer,
      hash,
      sourceId,
    );
    if (!claim.created) return retryTransfer(transaction, context, claim);

    const references = [
      command.sourceBudgetReferenceId,
      command.destinationBudgetReferenceId,
    ].sort();
    const locked = new Map<string, BudgetRecord>();
    for (const referenceId of references) {
      const row = await findBudgetByReference(transaction, context, referenceId, true);
      if (!row) throw new BudgetDomainError("BUDGET_NOT_FOUND", "budgetReferenceId");
      locked.set(referenceId, row);
    }
    const sourceRecord = locked.get(command.sourceBudgetReferenceId);
    const destinationRecord = locked.get(command.destinationBudgetReferenceId);
    if (!sourceRecord || !destinationRecord) {
      throw new BudgetDomainError("BUDGET_NOT_FOUND", "budgetReferenceId");
    }
    const pair = createBudgetTransfer({
      sourceBudget: budgetFromRecord(sourceRecord),
      destinationBudget: budgetFromRecord(destinationRecord),
      sourceBudgetReferenceId: command.sourceBudgetReferenceId,
      destinationBudgetReferenceId: command.destinationBudgetReferenceId,
      amountCents: command.amountCents,
      effectiveOn: command.effectiveOn,
      withdrawalReferenceId: transferMovementReferenceForCommand(command, "withdrawal"),
      contributionReferenceId: transferMovementReferenceForCommand(command, "contribution"),
      transferReferenceId,
    });
    const source = await insertMovement(
      transaction,
      context,
      sourceRecord,
      pair.source,
      {
        sourceKind: "TRANSFER",
        sourceReferenceId: transferReferenceId,
        financialEventId: null,
        accountEntryId: null,
      },
      sourceId,
    );
    await insertMovement(
      transaction,
      context,
      destinationRecord,
      pair.destination,
      {
        sourceKind: "TRANSFER",
        sourceReferenceId: `${transferReferenceId}:destination`,
        financialEventId: null,
        accountEntryId: null,
      },
      destinationId,
    );
    const result: BudgetTransferBoundary = {
      transferReferenceId,
      source: serializeBudgetMovement(pair.source),
      destination: serializeBudgetMovement(pair.destination),
      movements: [
        serializeBudgetMovement(pair.source),
        serializeBudgetMovement(pair.destination),
      ],
    };
    await completeCommand(
      transaction,
      context,
      commandId,
      BUDGET_MOVEMENT_COMMAND_OPERATIONS.transfer,
      hash,
      result,
      source.id,
    );
    return result;
  });
}

async function executeCorrection(
  database: Database,
  context: FinancialContext,
  command: CorrectMovementCommand,
): Promise<BudgetCorrectionBoundary> {
  const commandId = normalizeBudgetCommandId(command.commandId);
  const hash = payloadHash(
    BUDGET_MOVEMENT_COMMAND_OPERATIONS.correct,
    correctionPayload(command),
  );
  const compensationId = generateUuidV7();
  const replacementId =
    command.replacement === undefined || command.replacement === null
      ? null
      : generateUuidV7();

  return database.transaction(async (transaction) => {
    const claim = await claimCommand(
      transaction,
      context,
      commandId,
      BUDGET_MOVEMENT_COMMAND_OPERATIONS.correct,
      hash,
      compensationId,
    );
    if (!claim.created) return retryCorrection(claim);

    const budgetRecord = await findBudgetByReference(
      transaction,
      context,
      command.budgetReferenceId,
      true,
    );
    if (!budgetRecord) {
      throw new BudgetDomainError("BUDGET_NOT_FOUND", "budgetReferenceId");
    }
    const budget = budgetFromRecord(budgetRecord);
    const originalRecord = await findMovementByReference(
      transaction,
      context,
      budgetRecord.id,
      command.correctsReferenceId,
      true,
    );
    if (!originalRecord) {
      throw new BudgetDomainError("MOVEMENT_NOT_FOUND", "correctsReferenceId");
    }
    const existingCorrection = await transaction
      .select({ id: budgetMovements.id })
      .from(budgetMovements)
      .where(
        and(
          eq(budgetMovements.householdId, context.householdId),
          eq(budgetMovements.budgetId, budgetRecord.id),
          eq(budgetMovements.correctsMovementId, originalRecord.id),
        ),
      )
      .limit(1);
    if (existingCorrection[0]) {
      throw new BudgetDomainError("MOVEMENT_ALREADY_CORRECTED", "correctsReferenceId");
    }

    const original = await movementFromRecord(
      transaction,
      context,
      originalRecord,
      budget,
    );
    const correction = correctBudgetMovement({
      budget,
      originalMovement: original,
      correctsReferenceId: command.correctsReferenceId,
      correctionReferenceId: correctionReferenceForCommand(command),
      effectiveOn: command.effectiveOn,
      replacement:
        command.replacement === undefined || command.replacement === null
          ? null
          : command.replacement,
      existingMovements: [original],
    });
    // `sourceReferenceId` is unique for one economic source.  A compensating
    // row is a new source of audit lineage (`correctsMovementId`), so copying
    // an allocation/expense source would violate reconciliation uniqueness.
    const compensation = normalizeBudgetMovement(
      { ...correction.compensation, sourceReferenceId: null },
      budget,
      { interactive: false },
    );
    const compensationRecord = await insertMovement(
      transaction,
      context,
      budgetRecord,
      compensation,
      {
        sourceKind: "CORRECTION",
        sourceReferenceId: null,
        financialEventId: null,
        accountEntryId: null,
      },
      compensationId,
      originalRecord.id,
    );

    let replacementBoundary: BudgetMovementBoundary | null = null;
    if (correction.replacement !== null && replacementId !== null) {
      const replacementSourceReferenceId =
        correction.replacement.sourceReferenceId !== null &&
        correction.replacement.sourceReferenceId === original.sourceReferenceId
          ? null
          : correction.replacement.sourceReferenceId;
      const replacement = normalizeBudgetMovement(
        {
          ...correction.replacement,
          sourceReferenceId: replacementSourceReferenceId,
        },
        budget,
        { interactive: false },
      );
      await insertMovement(
        transaction,
        context,
        budgetRecord,
        replacement,
        {
          sourceKind: "MANUAL",
          sourceReferenceId: replacement.sourceReferenceId,
          financialEventId: null,
          accountEntryId: null,
        },
        replacementId,
      );
      replacementBoundary = serializeBudgetMovement(replacement);
    }

    const result: BudgetCorrectionBoundary = {
      original: serializeBudgetMovement(original),
      compensation: serializeBudgetMovement(compensation),
      replacement: replacementBoundary,
      movements: [
        serializeBudgetMovement(original),
        serializeBudgetMovement(compensation),
        ...(replacementBoundary === null ? [] : [replacementBoundary]),
      ],
    };
    await completeCommand(
      transaction,
      context,
      commandId,
      BUDGET_MOVEMENT_COMMAND_OPERATIONS.correct,
      hash,
      result,
      compensationRecord.id,
    );
    return result;
  });
}

function allocationRuleInputs(
  ruleRows: readonly (typeof budgetAllocationRules.$inferSelect)[],
  budgetRows: readonly BudgetRecord[],
): readonly AllocationRuleInput[] {
  const references = new Map(budgetRows.map((row) => [row.id, row.referenceId]));
  return ruleRows.flatMap((row) => {
    const boxReferenceId = references.get(row.budgetId);
    if (!boxReferenceId) return [];
    return [
      {
        id: row.id,
        referenceId: row.id,
        boxReferenceId,
        amountCents: row.amountCents,
        effectiveFrom: row.effectiveFrom,
        effectiveUntil: row.effectiveUntil,
      },
    ];
  });
}

function distributionBoundary(
  distribution: AllocationDistribution,
  contributions: readonly BudgetMovementBoundary[],
): BudgetDistributionBoundary {
  return {
    status: distribution.status,
    incomeReferenceId: distribution.incomeReferenceId,
    effectiveOn: serializeBudgetDate(distribution.effectiveOn),
    originAmountCents: distribution.originAmountCents.toString(10),
    distributedAmountCents: distribution.distributedAmountCents.toString(10),
    remainingAmountCents: distribution.remainingAmountCents.toString(10),
    contributions,
    ruleReferenceIds: distribution.ruleReferenceIds,
    reconciliationKey: distribution.reconciliationKey,
  };
}

async function executeDistribution(
  database: Database,
  context: FinancialContext,
  command: DistributeRealizedIncomeCommand,
): Promise<BudgetDistributionBoundary> {
  const commandId = normalizeBudgetCommandId(command.commandId);
  const eventId = command.financialEventId ?? command.incomeReferenceId;
  if (eventId === undefined) {
    throw new BudgetDomainError("INVALID_REFERENCE", "financialEventId");
  }
  const canonicalEventId = uuid(eventId, "financialEventId");
  const hash = payloadHash(
    BUDGET_MOVEMENT_COMMAND_OPERATIONS.distribution,
    distributionPayload(command),
  );

  return database.transaction(async (transaction) => {
    const claim = await claimCommand(
      transaction,
      context,
      commandId,
      BUDGET_MOVEMENT_COMMAND_OPERATIONS.distribution,
      hash,
    );
    if (!claim.created) return retryDistribution(claim);

    const event = await findFinancialEvent(
      transaction,
      context,
      canonicalEventId,
      true,
    );
    if (!event || event.kind !== "INCOME" || event.status !== "POSTED") {
      throw new BudgetDomainError("INVALID_REFERENCE", "financialEventId");
    }
    if (
      command.amountCents !== undefined &&
      BigInt(command.amountCents) !== event.amountCents
    ) {
      throw new BudgetDomainError("INVALID_AMOUNT", "amountCents");
    }
    if (
      command.effectiveOn !== undefined &&
      command.effectiveOn !== event.occurredOn
    ) {
      throw new BudgetDomainError("INVALID_DATE", "effectiveOn");
    }

    const budgetRows = await transaction
      .select()
      .from(budgets)
      .where(eq(budgets.householdId, context.householdId))
      .orderBy(asc(budgets.referenceId));
    const budgetIds = budgetRows.map((row) => row.id);
    const ruleRows =
      budgetIds.length === 0
        ? []
        : await transaction
            .select()
            .from(budgetAllocationRules)
            .where(
              and(
                eq(budgetAllocationRules.householdId, context.householdId),
                inArray(budgetAllocationRules.budgetId, budgetIds),
              ),
            )
            .orderBy(
              asc(budgetAllocationRules.effectiveFrom),
              asc(budgetAllocationRules.id),
            );
    const categoryIds = [...new Set(budgetRows.map((row) => row.categoryId))];
    const categoryRows =
      categoryIds.length === 0
        ? []
        : await transaction
            .select()
            .from(categories)
            .where(
              and(
                eq(categories.householdId, context.householdId),
                inArray(categories.id, categoryIds),
              ),
            );
    const categoryById = new Map(categoryRows.map((row) => [row.id, row]));
    const budgetsForPolicy: AllocationBudgetReferenceInput[] = budgetRows.map((row) => ({
      referenceId: row.referenceId,
      boxReferenceId: row.referenceId,
      budgetReferenceId: row.referenceId,
      categoryId: row.categoryId,
      activeFrom: row.activeFrom,
      closedOn: row.closedOn,
      status: row.status,
      categoryStatus: categoryById.get(row.categoryId)?.status,
      categoryArchivedOn: null,
    }));
    const rules = allocationRuleInputs(ruleRows, budgetRows);
    const existingRows = await transaction
      .select()
      .from(budgetMovements)
      .where(
        and(
          eq(budgetMovements.householdId, context.householdId),
          eq(budgetMovements.financialEventId, event.id),
        ),
      );
    const existingContributions = existingRows.map((row) => ({
      referenceId: row.referenceId,
      amountCents: row.amountCents,
    }));
    const distribution = distributeRealizedIncome({
      referenceId: event.id,
      financialEventId: event.id,
      kind: "INCOME",
      status: "POSTED",
      amountCents: event.amountCents,
      occurredOn: event.occurredOn,
      rules,
      budgets: budgetsForPolicy,
      existingContributions,
    });

    const byReference = new Map(budgetRows.map((row) => [row.referenceId, row]));
    const persisted: BudgetMovementBoundary[] = [];
    for (const contribution of distribution.contributions) {
      if (!contribution.materializable) continue;
      const budgetRecord = byReference.get(contribution.boxReferenceId);
      if (!budgetRecord) {
        throw new BudgetDomainError("BUDGET_NOT_FOUND", "budgetReferenceId");
      }
      const movement = createContributionMovement(
        {
          referenceId: contribution.referenceId,
          boxReferenceId: contribution.boxReferenceId,
          amountCents: contribution.amountCents,
          effectiveOn: contribution.effectiveOn,
          sourceReferenceId: contribution.referenceId,
        },
        budgetFromRecord(budgetRecord),
        { interactive: false },
      );
      await insertMovement(
        transaction,
        context,
        budgetRecord,
        movement,
        {
          sourceKind: "ALLOCATION",
          sourceReferenceId: contribution.referenceId,
          financialEventId: event.id,
          accountEntryId: null,
        },
        generateUuidV7(),
      );
      persisted.push(serializeBudgetMovement(movement));
    }
    const result = distributionBoundary(distribution, persisted);
    await completeCommand(
      transaction,
      context,
      commandId,
      BUDGET_MOVEMENT_COMMAND_OPERATIONS.distribution,
      hash,
      result,
      persisted.length === 0 ? undefined : undefined,
    );
    return result;
  });
}

function contextForUseCase(context: FinancialContext): void {
  assertFinancialContext(context);
}

type BudgetMovementWriteObservabilityOptions =
  S09BudgetCompletionOptions & S09BudgetOperationOptions & S09BudgetQueryOptions;

/**
 * Measures one T07 transaction without inspecting its command or boundary.
 * Movement references, amounts and persisted payloads stay exclusively in
 * the transaction; S09 receives only a bounded operation counter and the
 * server-generated request ID.
 */
async function withBudgetMovementWriteObservability<T>(
  context: FinancialContext,
  operation: BudgetMovementCommandOperation,
  work: () => Promise<T>,
  options: BudgetMovementWriteObservabilityOptions,
): Promise<T> {
  const movementCounts: S09BudgetAggregateCounts =
    operation === BUDGET_MOVEMENT_COMMAND_OPERATIONS.transfer
      ? { movementCount: 2 }
      : operation === BUDGET_MOVEMENT_COMMAND_OPERATIONS.distribution
        ? { distributionCount: 1 }
        : { movementCount: 1 };
  const safeOptions: BudgetMovementWriteObservabilityOptions = {
    ...options,
    ...movementCounts,
    technicalErrorCode: "BUDGET_TRANSACTION_FAILED",
  };
  const telemetry = createS09BudgetOperation(operation, safeOptions);
  return withS09BudgetObservability(
    telemetry,
    () => {
      contextForUseCase(context);
      return measureS09Query(telemetry, work, safeOptions);
    },
    safeOptions,
  );
}

export function createBudgetMovementUseCases(
  database?: Database,
): BudgetMovementUseCasePort;
export function createBudgetMovementUseCases(
  options?: BudgetMovementUseCaseOptions,
): BudgetMovementUseCasePort;
export function createBudgetMovementUseCases(
  databaseOrOptions?: Database | BudgetMovementUseCaseOptions,
): BudgetMovementUseCasePort {
  const options =
    databaseOrOptions &&
    typeof databaseOrOptions === "object" &&
    "transaction" in databaseOrOptions
      ? { database: databaseOrOptions as Database }
      : (databaseOrOptions ?? {});
  const database = () => databaseFor(options.database);
  const observability: BudgetMovementWriteObservabilityOptions =
    options.observability ?? {};
  const runMovement = <T>(
    context: FinancialContext,
    operation: BudgetMovementCommandOperation,
    work: () => Promise<T>,
  ): Promise<BudgetResult<T>> =>
    withBudgetMovementWriteObservability(
      context,
      operation,
      () => toResult(work),
      observability,
    );
  const registerContribution = async (
    context: FinancialContext,
    input: unknown,
  ): Promise<BudgetResult<BudgetMovementBoundary>> => {
    return runMovement(context, BUDGET_MOVEMENT_COMMAND_OPERATIONS.contribution, () =>
      executeRegister(
        database(),
        context,
        parseRegisterContributionCommand(input),
        "CONTRIBUTION",
      ),
    );
  };
  const registerWithdrawal = async (
    context: FinancialContext,
    input: unknown,
  ): Promise<BudgetResult<BudgetMovementBoundary>> => {
    return runMovement(context, BUDGET_MOVEMENT_COMMAND_OPERATIONS.withdrawal, () =>
      executeRegister(
        database(),
        context,
        parseRegisterWithdrawalCommand(input),
        "WITHDRAWAL",
      ),
    );
  };
  const transferBetweenBudgets = async (
    context: FinancialContext,
    input: unknown,
  ): Promise<BudgetResult<BudgetTransferBoundary>> => {
    return runMovement(context, BUDGET_MOVEMENT_COMMAND_OPERATIONS.transfer, () =>
      executeTransfer(
        database(),
        context,
        parseTransferBetweenBudgetsCommand(input),
      ),
    );
  };
  const correctMovement = async (
    context: FinancialContext,
    input: unknown,
  ): Promise<BudgetResult<BudgetCorrectionBoundary>> => {
    return runMovement(context, BUDGET_MOVEMENT_COMMAND_OPERATIONS.correct, () =>
      executeCorrection(
        database(),
        context,
        parseCorrectMovementCommand(input),
      ),
    );
  };
  const distribute = async (
    context: FinancialContext,
    input: unknown,
  ): Promise<BudgetResult<BudgetDistributionBoundary>> => {
    return runMovement(context, BUDGET_MOVEMENT_COMMAND_OPERATIONS.distribution, () =>
      executeDistribution(
        database(),
        context,
        parseDistributeRealizedIncomeCommand(input),
      ),
    );
  };
  return {
    registerContribution,
    registerWithdrawal,
    transferBetweenBudgets,
    correctMovement,
    distributeRealizedIncome: distribute,
    contribution: registerContribution,
    withdrawal: registerWithdrawal,
    transfer: transferBetweenBudgets,
    correct: correctMovement,
    distribute,
  };
}

export const createBudgetMovementsUseCases = createBudgetMovementUseCases;
export const createBudgetMovementUseCase = createBudgetMovementUseCases;
export const budgetMovementUseCases = createBudgetMovementUseCases();
export const budgetMovementsUseCases = budgetMovementUseCases;

export async function registerContribution(
  context: FinancialContext,
  command: unknown,
  database?: Database,
): Promise<BudgetResult<BudgetMovementBoundary>> {
  return createBudgetMovementUseCases(database).registerContribution(context, command);
}

export async function registerWithdrawal(
  context: FinancialContext,
  command: unknown,
  database?: Database,
): Promise<BudgetResult<BudgetMovementBoundary>> {
  return createBudgetMovementUseCases(database).registerWithdrawal(context, command);
}

export async function transferBetweenBudgets(
  context: FinancialContext,
  command: unknown,
  database?: Database,
): Promise<BudgetResult<BudgetTransferBoundary>> {
  return createBudgetMovementUseCases(database).transferBetweenBudgets(context, command);
}

export async function correctMovement(
  context: FinancialContext,
  command: unknown,
  database?: Database,
): Promise<BudgetResult<BudgetCorrectionBoundary>> {
  return createBudgetMovementUseCases(database).correctMovement(context, command);
}

export async function distributeRealizedIncomeCommand(
  context: FinancialContext,
  command: unknown,
  database?: Database,
): Promise<BudgetResult<BudgetDistributionBoundary>> {
  return createBudgetMovementUseCases(database).distributeRealizedIncome(context, command);
}

export const RegisterContribution = registerContribution;
export const RegisterWithdrawal = registerWithdrawal;
export const TransferBetweenBudgets = transferBetweenBudgets;
export const CorrectMovement = correctMovement;
export const DistributeRealizedIncome = distributeRealizedIncomeCommand;
