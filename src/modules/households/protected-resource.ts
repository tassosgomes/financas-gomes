import {
  and,
  asc,
  eq,
} from "drizzle-orm";

import { getDb, type Database } from "@/db";
import { protectedResources } from "@/db/schema";
import type { ProtectedResourceRecord } from "@/db/tenancy-schema";

import {
  assertFinancialContext,
  withFinancialContext,
} from "./tenant-scoped";
import type {
  FinancialContext,
  RequireFinancialContextOptions,
} from "./contracts";

/**
 * A deliberately small resource used as the S01 isolation fixture. It is
 * not a financial aggregate and must not be used as a substitute for the
 * Ledger in later slices.
 */
export const PROTECTED_RESOURCE_NAME_MAX_LENGTH = 120;

export const PROTECTED_RESOURCE_ERROR_CODES = [
  "NOT_FOUND",
  "INVALID_NAME",
  "INVALID_ID",
] as const;

export type ProtectedResourceErrorCode =
  (typeof PROTECTED_RESOURCE_ERROR_CODES)[number];

export const PROTECTED_RESOURCE_ERROR_MESSAGES: Record<
  ProtectedResourceErrorCode,
  string
> = {
  NOT_FOUND: "Recurso não encontrado neste espaço financeiro.",
  INVALID_NAME: "Informe um nome válido para o recurso.",
  INVALID_ID: "O identificador do recurso não é válido.",
};

/** Expected error that can safely cross a route or Server Action boundary. */
export class ProtectedResourceError extends Error {
  readonly code: ProtectedResourceErrorCode;
  readonly status: number;
  readonly expected = true;

  constructor(code: ProtectedResourceErrorCode) {
    super(PROTECTED_RESOURCE_ERROR_MESSAGES[code]);
    this.name = "ProtectedResourceError";
    this.code = code;
    this.status = code === "INVALID_NAME" || code === "INVALID_ID" ? 400 : 404;
  }
}

export interface CreateProtectedResourceCommand {
  /** No household ID is accepted: it comes from `requireFinancialContext`. */
  name: string;
}

export interface UpdateProtectedResourceCommand {
  /** The household and resource IDs are never editable fields. */
  name: string;
}

export type ProtectedResourceAccessOptions = RequireFinancialContextOptions;

export interface ProtectedResourceRepository {
  /** Lists only rows in the authenticated user's resolved household. */
  list(
    options?: ProtectedResourceAccessOptions,
  ): Promise<ProtectedResourceRecord[]>;
  /** Returns null for an ID outside the active household, without disclosure. */
  findById(
    id: string,
    options?: ProtectedResourceAccessOptions,
  ): Promise<ProtectedResourceRecord | null>;
  /** Same as findById, but maps both missing and cross-tenant IDs to NOT_FOUND. */
  getById(
    id: string,
    options?: ProtectedResourceAccessOptions,
  ): Promise<ProtectedResourceRecord>;
  /** Creates a row with household/user IDs taken only from the server context. */
  create(
    command: CreateProtectedResourceCommand,
    options?: ProtectedResourceAccessOptions,
  ): Promise<ProtectedResourceRecord>;
  /** Updates only a row belonging to the active household. */
  update(
    id: string,
    command: UpdateProtectedResourceCommand,
    options?: ProtectedResourceAccessOptions,
  ): Promise<ProtectedResourceRecord>;
}

function resolveDatabase(database: Database | undefined): Database {
  return database ?? getDb();
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string") {
    throw new ProtectedResourceError("INVALID_NAME");
  }

  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > PROTECTED_RESOURCE_NAME_MAX_LENGTH
  ) {
    throw new ProtectedResourceError("INVALID_NAME");
  }

  return normalized;
}

function normalizeId(value: unknown): string {
  if (typeof value !== "string") {
    throw new ProtectedResourceError("INVALID_ID");
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 128) {
    throw new ProtectedResourceError("INVALID_ID");
  }

  return normalized;
}

async function listForContext(
  database: Database,
  context: FinancialContext,
): Promise<ProtectedResourceRecord[]> {
  assertFinancialContext(context);

  return database
    .select()
    .from(protectedResources)
    .where(eq(protectedResources.householdId, context.householdId))
    .orderBy(
      asc(protectedResources.createdAt),
      asc(protectedResources.id),
    );
}

async function findByIdForContext(
  database: Database,
  context: FinancialContext,
  id: string,
): Promise<ProtectedResourceRecord | null> {
  assertFinancialContext(context);
  const normalizedId = normalizeId(id);

  const rows = await database
    .select()
    .from(protectedResources)
    .where(
      and(
        eq(protectedResources.id, normalizedId),
        // Never make the resource ID the only predicate. A known ID from
        // another household must behave exactly like a missing resource.
        eq(protectedResources.householdId, context.householdId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function createForContext(
  database: Database,
  context: FinancialContext,
  command: CreateProtectedResourceCommand,
): Promise<ProtectedResourceRecord> {
  assertFinancialContext(context);
  const name = normalizeName(command?.name);

  const rows = await database
    .insert(protectedResources)
    .values({
      // Both tenant fields are intentionally server-derived. The composite
      // FK provides a second, database-level barrier for the association.
      householdId: context.householdId,
      createdBy: context.userId,
      name,
    })
    .returning();

  const resource = rows[0];
  if (!resource) {
    throw new Error("A criação do recurso protegido não retornou uma linha.");
  }

  return resource;
}

async function updateForContext(
  database: Database,
  context: FinancialContext,
  id: string,
  command: UpdateProtectedResourceCommand,
): Promise<ProtectedResourceRecord> {
  assertFinancialContext(context);
  const normalizedId = normalizeId(id);
  const name = normalizeName(command?.name);

  const rows = await database
    .update(protectedResources)
    .set({ name, updatedAt: new Date() })
    .where(
      and(
        eq(protectedResources.id, normalizedId),
        // The household predicate is mandatory on every private write.
        eq(protectedResources.householdId, context.householdId),
      ),
    )
    .returning();

  const resource = rows[0];
  if (!resource) {
    // Deliberately do not distinguish “missing” from “belongs to B”.
    throw new ProtectedResourceError("NOT_FOUND");
  }

  return resource;
}

/**
 * Builds the server-only repository. Every public operation resolves its
 * tenant through `requireFinancialContext` via `withFinancialContext`.
 * `database` is injectable solely for deterministic integration tests.
 */
export function createProtectedResourceRepository(
  database?: Database,
): ProtectedResourceRepository {
  return {
    async list(options = {}) {
      return withFinancialContext(
        (context) => listForContext(resolveDatabase(database), context),
        options,
      );
    },

    async findById(id, options = {}) {
      return withFinancialContext(
        (context) =>
          findByIdForContext(resolveDatabase(database), context, id),
        options,
      );
    },

    async getById(id, options = {}) {
      const resource = await withFinancialContext(
        (context) =>
          findByIdForContext(resolveDatabase(database), context, id),
        options,
      );

      if (!resource) {
        throw new ProtectedResourceError("NOT_FOUND");
      }

      return resource;
    },

    async create(command, options = {}) {
      return withFinancialContext(
        (context) =>
          createForContext(resolveDatabase(database), context, command),
        options,
      );
    },

    async update(id, command, options = {}) {
      return withFinancialContext(
        (context) =>
          updateForContext(resolveDatabase(database), context, id, command),
        options,
      );
    },
  };
}

/** Default server repository; no database connection is opened on import. */
export const protectedResourceRepository = createProtectedResourceRepository();

// Function aliases keep route/action call sites small while retaining the
// repository factory for tests and future slices.
export const listProtectedResources = (
  options?: ProtectedResourceAccessOptions,
) => protectedResourceRepository.list(options);
export const findProtectedResource = (
  id: string,
  options?: ProtectedResourceAccessOptions,
) => protectedResourceRepository.findById(id, options);
export const getProtectedResource = (
  id: string,
  options?: ProtectedResourceAccessOptions,
) => protectedResourceRepository.getById(id, options);
export const createProtectedResource = (
  command: CreateProtectedResourceCommand,
  options?: ProtectedResourceAccessOptions,
) => protectedResourceRepository.create(command, options);
export const updateProtectedResource = (
  id: string,
  command: UpdateProtectedResourceCommand,
  options?: ProtectedResourceAccessOptions,
) => protectedResourceRepository.update(id, command, options);
