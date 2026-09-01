/**
 * T05 review update boundary and use case.
 *
 * The first section contains the pure T05-A helpers. The persistence section
 * below keeps the same boundary and adds the T05-B transaction/lock port;
 * callers still receive only serializable S05 values and errors.
 */

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import { applicationCommands, categories } from "@/db/accounts-categories-schema";
import {
  financialEvents,
  type FinancialEventRecord,
} from "@/db/financial-events-schema";
import { transactionImportItems } from "@/db/transaction-imports-schema";
import { isFinancialContext } from "@/modules/households/tenant-scoped";
import type { FinancialContext } from "@/modules/households/contracts";

import {
  REVIEWABLE_TRANSACTION_UPDATE_OPERATION,
  S05DomainError,
  failure,
  ok,
  parseUpdateReviewableTransactionCommand,
  parseReviewableTransactionSource,
  projectTransactionReview,
  type UpdateReviewableTransactionCommand,
  type ReviewableTransactionKind,
  type ReviewableTransactionOrigin,
  type ReviewableTransactionStatus,
  type S05Result,
  type TransactionReviewProjection,
  type TransactionSource,
} from "./review-contracts";
import { assertCategoryReference } from "./domain";
import { S03DomainError } from "./contracts";
import type { TransactionReferenceTransaction } from "./references";

/** Delegates to the strict S05 command schema and its protected-field errors. */
export function parseReviewUpdateCommand(
  input: unknown,
): UpdateReviewableTransactionCommand {
  return parseUpdateReviewableTransactionCommand(input);
}

export interface CanonicalReviewUpdatePayload {
  financialEventId: string;
  description?: string;
  categoryId?: string | null;
}

/**
 * Returns only the normalized, effective fields of the update command.
 * `commandId` is an idempotency slot and is intentionally excluded.
 */
export function canonicalReviewUpdatePayload(
  command: UpdateReviewableTransactionCommand,
): CanonicalReviewUpdatePayload {
  const parsed = parseReviewUpdateCommand(command);

  return {
    financialEventId: parsed.financialEventId,
    ...(parsed.description === undefined
      ? {}
      : { description: parsed.description }),
    ...(parsed.categoryId === undefined
      ? {}
      : { categoryId: parsed.categoryId }),
  };
}

/** Small deterministic JSON serializer for the known command payload shape. */
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

/**
 * Hashes the canonical operation and effective payload. The command ID,
 * household and server-derived event fields never enter this digest.
 */
export function hashReviewUpdateCommand(
  command: UpdateReviewableTransactionCommand,
): string {
  const payload = canonicalReviewUpdatePayload(command);

  return createHash("sha256")
    .update(
      canonicalJson({
        operation: REVIEWABLE_TRANSACTION_UPDATE_OPERATION,
        payload,
      }),
      "utf8",
    )
    .digest("hex");
}

export interface ReviewableUpdateEvent {
  status: "POSTED";
  kind: ReviewableTransactionKind;
  origin: ReviewableTransactionOrigin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Enforces the closed set of events that T05-B may update. IMPORT must have
 * exactly one lineage row; MANUAL does not accept or require import lineage.
 */
export function assertReviewableUpdatePolicy(
  event: unknown,
  lineageCount: number,
): asserts event is ReviewableUpdateEvent {
  if (
    !isRecord(event) ||
    event.status !== "POSTED" ||
    (event.kind !== "EXPENSE" && event.kind !== "INCOME") ||
    (event.origin !== "MANUAL" && event.origin !== "IMPORT")
  ) {
    throw new S05DomainError("EVENT_NOT_REVIEWABLE");
  }

  if (event.origin === "IMPORT" && lineageCount !== 1) {
    throw new S05DomainError("IMPORT_LINEAGE_INVALID");
  }
}

export interface ReviewUpdateSet {
  description?: string;
  categoryId?: string | null;
  updatedAt: Date;
}

/**
 * Builds the only metadata set allowed by ADR-006. The optional timestamp is
 * injectable for deterministic composition; production callers may omit it.
 */
export function buildReviewUpdateSet(
  command: UpdateReviewableTransactionCommand,
  updatedAt: Date = new Date(),
): ReviewUpdateSet {
  const parsed = parseReviewUpdateCommand(command);

  return {
    ...(parsed.description === undefined
      ? {}
      : { description: parsed.description }),
    ...(parsed.categoryId === undefined
      ? {}
      : { categoryId: parsed.categoryId }),
    updatedAt: new Date(updatedAt.getTime()),
  };
}

/**
 * The mutation response is intentionally smaller than the list/detail read
 * model. It contains the fields T06 needs to update its local row and the
 * public S05 source shape, but never returns amount, date, account, entry,
 * import CSV/token data or the application command payload.
 */
export interface ReviewableTransactionUpdateReadModel
  extends TransactionReviewProjection {
  id: string;
  kind: ReviewableTransactionKind;
  status: ReviewableTransactionStatus;
  origin: ReviewableTransactionOrigin;
  description: string;
  categoryId: string | null;
  source: TransactionSource;
  updatedAt: string;
}

/** Database and clock dependencies are explicit so T06/tests can compose the port. */
export interface ReviewableTransactionUseCaseOptions {
  database?: Database;
  now?: () => Date;
}

export interface ReviewableTransactionUseCasePort {
  updateReviewableTransaction(
    context: FinancialContext,
    input: unknown,
  ): Promise<S05Result<ReviewableTransactionUpdateReadModel>>;
}

/** Compatibility vocabulary for consumers that call this the review port. */
export type ReviewTransactionUseCasePort = ReviewableTransactionUseCasePort;
export type ReviewableTransactionUpdateUseCasePort =
  ReviewableTransactionUseCasePort;

type ReviewLineage = {
  importId: string;
  rowNumber: number;
  externalId: string | null;
};

type ReviewCommandClaim =
  | { created: true }
  | { created: false; resourceId: string };

function resolveReviewDatabase(database?: Database): Database {
  return database ?? getDb();
}

function isDatabase(value: unknown): value is Database {
  return (
    typeof value === "object" &&
    value !== null &&
    "select" in value &&
    "transaction" in value
  );
}

function toReviewOptions(
  databaseOrOptions:
    | Database
    | ReviewableTransactionUseCaseOptions
    | undefined,
): ReviewableTransactionUseCaseOptions {
  return isDatabase(databaseOrOptions)
    ? { database: databaseOrOptions }
    : databaseOrOptions ?? {};
}

function assertReviewContext(value: unknown): asserts value is FinancialContext {
  if (!isFinancialContext(value)) {
    throw new S05DomainError("INVALID_FINANCIAL_CONTEXT");
  }
}

/**
 * Inserts the idempotency slot before any event mutation. The primary-key
 * conflict is tenant-scoped, and PostgreSQL waits for a concurrent claimant
 * before this transaction reads the committed command row.
 */
async function reserveReviewCommand(
  transaction: TransactionReferenceTransaction,
  context: FinancialContext,
  command: UpdateReviewableTransactionCommand,
  hash: string,
): Promise<ReviewCommandClaim> {
  const inserted = await transaction
    .insert(applicationCommands)
    .values({
      householdId: context.householdId,
      commandId: command.commandId,
      operation: REVIEWABLE_TRANSACTION_UPDATE_OPERATION,
      payloadHash: hash,
      resourceId: command.financialEventId,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) {
    return { created: true };
  }

  const existingRows = await transaction
    .select({
      operation: applicationCommands.operation,
      payloadHash: applicationCommands.payloadHash,
      resourceId: applicationCommands.resourceId,
    })
    .from(applicationCommands)
    .where(
      and(
        eq(applicationCommands.householdId, context.householdId),
        eq(applicationCommands.commandId, command.commandId),
      ),
    )
    .limit(1)
    .for("update");
  const existing = existingRows[0];

  if (!existing) {
    // This can only happen if an external actor removed a row between the
    // conflict and the locked read. Keep that invariant technical and opaque.
    throw new Error("O registro de idempotência não foi encontrado.");
  }

  if (
    existing.operation !== REVIEWABLE_TRANSACTION_UPDATE_OPERATION ||
    existing.payloadHash !== hash
  ) {
    throw new S05DomainError("COMMAND_ID_REUSED", "commandId");
  }

  if (!existing.resourceId) {
    throw new Error("O registro de idempotência não possui recurso associado.");
  }

  return { created: false, resourceId: existing.resourceId };
}

/** Locks only the current tenant's event; an ID alone never grants access. */
async function findLockedReviewEvent(
  transaction: TransactionReferenceTransaction,
  context: FinancialContext,
  financialEventId: string,
): Promise<FinancialEventRecord> {
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
  const event = rows[0];

  if (!event) {
    throw new S05DomainError("EVENT_NOT_FOUND", "financialEventId");
  }

  return event;
}

/** Reads at most two rows so both zero and duplicate lineage fail closed. */
async function findReviewLineage(
  transaction: TransactionReferenceTransaction,
  context: FinancialContext,
  financialEventId: string,
): Promise<ReviewLineage[]> {
  return transaction
    .select({
      importId: transactionImportItems.importId,
      rowNumber: transactionImportItems.rowNumber,
      externalId: transactionImportItems.externalId,
    })
    .from(transactionImportItems)
    .where(
      and(
        eq(transactionImportItems.financialEventId, financialEventId),
        eq(transactionImportItems.householdId, context.householdId),
      ),
    )
    .limit(2);
}

function assertReviewableEventIdentity(
  event: FinancialEventRecord,
): asserts event is FinancialEventRecord & {
  kind: ReviewableTransactionKind;
  origin: ReviewableTransactionOrigin;
  status: ReviewableTransactionStatus;
} {
  if (
    (event.kind !== "EXPENSE" && event.kind !== "INCOME") ||
    (event.origin !== "MANUAL" && event.origin !== "IMPORT") ||
    (event.status !== "POSTED" && event.status !== "CANCELLED")
  ) {
    throw new S05DomainError("EVENT_NOT_REVIEWABLE");
  }
}

function assertManualLineageIsEmpty(lineage: readonly ReviewLineage[]): void {
  if (lineage.length !== 0) {
    throw new S05DomainError("IMPORT_LINEAGE_INVALID");
  }
}

function reviewSourceFromLineage(
  event: FinancialEventRecord,
  lineage: readonly ReviewLineage[],
): TransactionSource {
  assertReviewableEventIdentity(event);

  if (event.origin === "MANUAL") {
    assertManualLineageIsEmpty(lineage);
    return parseReviewableTransactionSource({
      origin: "MANUAL",
      import: null,
    });
  }

  if (lineage.length !== 1) {
    throw new S05DomainError("IMPORT_LINEAGE_INVALID");
  }

  return parseReviewableTransactionSource({
    origin: "IMPORT",
    import: lineage[0],
  });
}

function toReviewUpdateReadModel(
  event: FinancialEventRecord,
  lineage: readonly ReviewLineage[],
): ReviewableTransactionUpdateReadModel {
  assertReviewableEventIdentity(event);
  const source = reviewSourceFromLineage(event, lineage);
  const review = projectTransactionReview(event.status, event.categoryId);

  return {
    id: event.id,
    kind: event.kind,
    status: event.status,
    origin: event.origin,
    description: event.description,
    categoryId: event.categoryId,
    source,
    ...review,
    updatedAt: toIsoTimestamp(event.updatedAt),
  };
}

function toS05CategoryError(error: unknown): never {
  if (error instanceof S03DomainError) {
    switch (error.code) {
      case "CATEGORY_NOT_FOUND":
        throw new S05DomainError("CATEGORY_NOT_FOUND", "categoryId");
      case "RESOURCE_ARCHIVED":
        throw new S05DomainError("RESOURCE_ARCHIVED", "categoryId");
      case "CATEGORY_KIND_MISMATCH":
        throw new S05DomainError("CATEGORY_KIND_MISMATCH", "categoryId");
      default:
        break;
    }
  }

  throw error;
}

/** Validates only a newly selected category; historical archived values stay untouched. */
async function validateReviewCategory(
  transaction: TransactionReferenceTransaction,
  context: FinancialContext,
  categoryId: string,
  kind: ReviewableTransactionKind,
): Promise<string> {
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
    throw new S05DomainError("CATEGORY_NOT_FOUND", "categoryId");
  }

  try {
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
  } catch (error) {
    toS05CategoryError(error);
  }

  return category.id;
}

function reviewEventForNewCommand(
  event: FinancialEventRecord,
  lineage: readonly ReviewLineage[],
): asserts event is FinancialEventRecord & {
  kind: ReviewableTransactionKind;
  origin: ReviewableTransactionOrigin;
  status: "POSTED";
} {
  assertReviewableUpdatePolicy(event, lineage.length);
  // T05-A's policy is intentionally permissive for MANUAL (it neither
  // requires nor uses lineage); the write path fails closed if corrupt data
  // has a lineage row under a manual event.
  if (event.origin === "MANUAL") {
    assertManualLineageIsEmpty(lineage);
  }
}

async function executeReviewableTransactionUpdate(
  database: Database,
  context: FinancialContext,
  command: UpdateReviewableTransactionCommand,
  now: () => Date,
): Promise<ReviewableTransactionUpdateReadModel> {
  const hash = hashReviewUpdateCommand(command);

  return database.transaction(async (transaction) => {
    const claim = await reserveReviewCommand(transaction, context, command, hash);
    const event = await findLockedReviewEvent(
      transaction,
      context,
      claim.created ? command.financialEventId : claim.resourceId,
    );
    const lineage = await findReviewLineage(transaction, context, event.id);

    if (!claim.created) {
      // The command row already proves operation + canonical payload equality;
      // rehydrate the tenant-scoped resource without applying the update twice.
      return toReviewUpdateReadModel(event, lineage);
    }

    reviewEventForNewCommand(event, lineage);

    if (command.categoryId !== undefined && command.categoryId !== null) {
      await validateReviewCategory(
        transaction,
        context,
        command.categoryId,
        event.kind,
      );
    }

    const updateSet = buildReviewUpdateSet(command, now());
    const updatedRows = await transaction
      .update(financialEvents)
      .set(updateSet)
      .where(
        and(
          eq(financialEvents.id, event.id),
          eq(financialEvents.householdId, context.householdId),
        ),
      )
      .returning();
    const updatedEvent = updatedRows[0];

    if (!updatedEvent) {
      throw new S05DomainError("EVENT_NOT_FOUND", "financialEventId");
    }

    return toReviewUpdateReadModel(updatedEvent, lineage);
  });
}

async function runReviewableTransactionUpdate(
  context: FinancialContext,
  input: unknown,
  options: ReviewableTransactionUseCaseOptions,
): Promise<S05Result<ReviewableTransactionUpdateReadModel>> {
  try {
    // Boundary parsing is deliberately before context/database resolution.
    const command = parseReviewUpdateCommand(input);
    assertReviewContext(context);

    const value = await executeReviewableTransactionUpdate(
      resolveReviewDatabase(options.database),
      context,
      command,
      options.now ?? (() => new Date()),
    );
    return ok(value);
  } catch (error) {
    if (error instanceof S05DomainError) {
      return failure(error.code, error.field);
    }

    // Technical/database errors stay out of the public Result. T06/T10 own
    // their sanitized reporting and generic action response boundary.
    throw error;
  }
}

/** Builds the tenant-scoped T05-B update port with an injectable database. */
export function createReviewableTransactionUseCases(
  database?: Database,
): ReviewableTransactionUseCasePort;
export function createReviewableTransactionUseCases(
  options?: ReviewableTransactionUseCaseOptions,
): ReviewableTransactionUseCasePort;
export function createReviewableTransactionUseCases(
  databaseOrOptions?: Database | ReviewableTransactionUseCaseOptions,
): ReviewableTransactionUseCasePort;
export function createReviewableTransactionUseCases(
  databaseOrOptions?: Database | ReviewableTransactionUseCaseOptions,
): ReviewableTransactionUseCasePort {
  const options = toReviewOptions(databaseOrOptions);

  return {
    updateReviewableTransaction: (context, input) =>
      runReviewableTransactionUpdate(context, input, options),
  };
}

export const createReviewableTransactionUseCase =
  createReviewableTransactionUseCases;
export const createReviewUseCases = createReviewableTransactionUseCases;

/** Lazily composed production port; no database connection is opened here. */
export const reviewableTransactionUseCases =
  createReviewableTransactionUseCases();
export const reviewableTransactionUseCasePort = reviewableTransactionUseCases;
export const reviewUseCases = reviewableTransactionUseCases;

export async function updateReviewableTransaction(
  context: FinancialContext,
  input: unknown,
  databaseOrOptions?: Database | ReviewableTransactionUseCaseOptions,
): Promise<S05Result<ReviewableTransactionUpdateReadModel>> {
  return createReviewableTransactionUseCases(databaseOrOptions).updateReviewableTransaction(
    context,
    input,
  );
}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
