import { z } from "zod";

import { isUuidV7 } from "@/lib/uuidv7";

import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  CATEGORY_KINDS,
  COMMAND_ID_MAX_LENGTH,
  DEFAULT_ACCOUNT_INCLUDE_IN_NET_WORTH,
  DEFAULT_ACCOUNT_LIQUIDITY,
  DEFAULT_ACCOUNT_SPENDABILITY,
  LIQUIDITIES,
  S02_ERROR_CODES,
  S02_NAME_MAX_LENGTH,
  SPENDABILITIES,
  STATUS_FILTERS,
  S02DomainError,
  type AccountStatus,
  type AccountArchiveValidationInput,
  type AccountType,
  type ArchiveAccountCommand,
  type ArchiveCategoryCommand,
  type CategoryArchiveValidationInput,
  type CategoryHierarchyNode,
  type CategoryKind,
  type CategoryParentValidationInput,
  type CategoryReparentingValidationInput,
  type CreateAccountCommand,
  type CreateCategoryCommand,
  type ListQuery,
  type S02Error,
  type S02ErrorCode,
  type S02ErrorField,
  type S02Result,
  type Spendability,
  type Liquidity,
  type UpdateAccountCommand,
  type UpdateCategoryCommand,
} from "./contracts";

/**
 * Unicode normalization is deliberately kept at the boundary. Every write
 * path should persist the output of this function, so database uniqueness and
 * read ordering see exactly the same representation as the UI.
 */
const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;

function invalidName(): never {
  throw new S02DomainError("INVALID_NAME", "name");
}

function normalizeNameValue(value: string): string | null {
  const normalized = value.normalize("NFKC");

  // Check before whitespace collapsing: newline, tab and other controls must
  // not be silently converted into an apparently valid name.
  if (CONTROL_OR_FORMAT_CHARACTER.test(normalized)) {
    return null;
  }

  const collapsed = normalized.trim().replace(/\s+/gu, " ");
  const codePointLength = Array.from(collapsed).length;

  if (
    codePointLength < 1 ||
    codePointLength > S02_NAME_MAX_LENGTH
  ) {
    return null;
  }

  return collapsed;
}

/** NFKC + edge trim + internal whitespace collapse, preserving case. */
export function normalizeName(value: unknown): string {
  if (typeof value !== "string") {
    return invalidName();
  }

  return normalizeNameValue(value) ?? invalidName();
}

/** Compatibility aliases used by account/category adapters. */
export const normalizeAccountName = normalizeName;
export const normalizeCategoryName = normalizeName;
export const normalizeEntityName = normalizeName;

function addIssue(
  context: z.RefinementCtx,
  message: string,
): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message,
  });
}

/** Zod keeps malformed input inside a ZodError instead of leaking domain errors. */
export const nameSchema = z.string().transform((value, context) => {
  const normalized = normalizeNameValue(value);
  if (normalized === null) {
    addIssue(context, "nome inválido");
    return z.NEVER;
  }

  return normalized;
});

export const accountNameSchema = nameSchema;
export const categoryNameSchema = nameSchema;

export const commandIdSchema = z.string().transform((value, context) => {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > COMMAND_ID_MAX_LENGTH
  ) {
    addIssue(context, "identificador de operação inválido");
    return z.NEVER;
  }

  return normalized;
});

/** Resource IDs are serialized strings and must be UUIDv7 at the boundary. */
export const uuidV7Schema = z.string().trim().refine(isUuidV7, {
  message: "identificador de recurso inválido",
});

export const resourceIdSchema = uuidV7Schema;
export const accountIdSchema = resourceIdSchema;
export const categoryIdSchema = resourceIdSchema;

export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export const accountStatusSchema = z.enum(ACCOUNT_STATUSES);
export const spendabilitySchema = z.enum(SPENDABILITIES);
export const liquiditySchema = z.enum(LIQUIDITIES);
export const categoryKindSchema = z.enum(CATEGORY_KINDS);
export const statusFilterSchema = z.enum(STATUS_FILTERS);

const commandIdField = commandIdSchema;

/** Strict schemas reject tenant/status/immutable fields sent by a client. */
export const createAccountCommandSchema = z
  .object({
    commandId: commandIdField,
    name: accountNameSchema,
    type: accountTypeSchema,
    spendability: spendabilitySchema.optional(),
    liquidity: liquiditySchema.optional(),
    includeInNetWorth: z.boolean().optional(),
  })
  .strict();

export const updateAccountCommandSchema = z
  .object({
    commandId: commandIdField,
    accountId: accountIdSchema,
    name: accountNameSchema.optional(),
    spendability: spendabilitySchema.optional(),
    liquidity: liquiditySchema.optional(),
    includeInNetWorth: z.boolean().optional(),
  })
  .strict()
  .superRefine((command, context) => {
    if (
      command.name === undefined &&
      command.spendability === undefined &&
      command.liquidity === undefined &&
      command.includeInNetWorth === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ao menos um campo editável é obrigatório",
      });
    }
  });

export const archiveAccountCommandSchema = z
  .object({
    commandId: commandIdField,
    accountId: accountIdSchema,
  })
  .strict();

export const createCategoryCommandSchema = z
  .object({
    commandId: commandIdField,
    name: categoryNameSchema,
    kind: categoryKindSchema,
    parentId: resourceIdSchema.nullable().optional(),
  })
  .strict();

export const updateCategoryCommandSchema = z
  .object({
    commandId: commandIdField,
    categoryId: categoryIdSchema,
    name: categoryNameSchema.optional(),
    parentId: resourceIdSchema.nullable().optional(),
  })
  .strict()
  .superRefine((command, context) => {
    if (command.name === undefined && command.parentId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ao menos um campo editável é obrigatório",
      });
    }
  });

export const archiveCategoryCommandSchema = z
  .object({
    commandId: commandIdField,
    categoryId: categoryIdSchema,
  })
  .strict();

/** Lists default to active; callers must explicitly request archived/all. */
export const listQuerySchema = z
  .object({
    status: statusFilterSchema.optional().default("ACTIVE"),
  })
  .strict();

export const listAccountsQuerySchema = listQuerySchema;
export const listCategoriesQuerySchema = listQuerySchema;

/*
 * These names make the same contract explicit at each adapter boundary.
 * Keeping aliases (rather than separate subtly divergent schemas) prevents a
 * form from accepting a payload the HTTP/Server Action parser would reject.
 */
export const createAccountHttpSchema = createAccountCommandSchema;
export const updateAccountHttpSchema = updateAccountCommandSchema;
export const archiveAccountHttpSchema = archiveAccountCommandSchema;
export const createCategoryHttpSchema = createCategoryCommandSchema;
export const updateCategoryHttpSchema = updateCategoryCommandSchema;
export const archiveCategoryHttpSchema = archiveCategoryCommandSchema;

export const createAccountServerActionSchema = createAccountCommandSchema;
export const updateAccountServerActionSchema = updateAccountCommandSchema;
export const archiveAccountServerActionSchema = archiveAccountCommandSchema;
export const createCategoryServerActionSchema = createCategoryCommandSchema;
export const updateCategoryServerActionSchema = updateCategoryCommandSchema;
export const archiveCategoryServerActionSchema = archiveCategoryCommandSchema;

export const createAccountFormSchema = createAccountCommandSchema;
export const updateAccountFormSchema = updateAccountCommandSchema;
export const archiveAccountFormSchema = archiveAccountCommandSchema;
export const createCategoryFormSchema = createCategoryCommandSchema;
export const updateCategoryFormSchema = updateCategoryCommandSchema;
export const archiveCategoryFormSchema = archiveCategoryCommandSchema;

/** Parsed create defaults are applied in the server use case, never by type. */
export type NormalizedCreateAccountCommand = Required<
  Pick<
    CreateAccountCommand,
    "commandId" | "name" | "type" | "spendability" | "liquidity" | "includeInNetWorth"
  >
>;

export function applyAccountDefaults(
  command: CreateAccountCommand,
): NormalizedCreateAccountCommand {
  return {
    commandId: command.commandId,
    name: normalizeName(command.name),
    type: command.type,
    spendability: command.spendability ?? DEFAULT_ACCOUNT_SPENDABILITY,
    liquidity: command.liquidity ?? DEFAULT_ACCOUNT_LIQUIDITY,
    includeInNetWorth:
      command.includeInNetWorth ?? DEFAULT_ACCOUNT_INCLUDE_IN_NET_WORTH,
  };
}

export const withAccountDefaults = applyAccountDefaults;
export const normalizeCreateAccountCommand = applyAccountDefaults;

function fieldForPath(path: readonly (string | number)[]): S02ErrorField | undefined {
  const field = path[0];
  switch (field) {
    case "commandId":
    case "name":
    case "type":
    case "spendability":
    case "liquidity":
    case "includeInNetWorth":
    case "accountId":
    case "categoryId":
    case "kind":
    case "parentId":
      return field;
    default:
      return undefined;
  }
}

function codeForZodIssue(
  issue: z.ZodIssue,
  fallback: S02ErrorCode,
): S02ErrorCode {
  if (issue.path[0] === "status") {
    return "INVALID_STATUS_FILTER";
  }

  const field = fieldForPath(issue.path);
  switch (field) {
    case "commandId":
      return "INVALID_COMMAND_ID";
    case "name":
      return "INVALID_NAME";
    case "type":
      return "INVALID_ACCOUNT_TYPE";
    case "spendability":
      return "INVALID_SPENDABILITY";
    case "liquidity":
      return "INVALID_LIQUIDITY";
    case "kind":
      return "INVALID_CATEGORY_KIND";
    case "parentId":
      return "INVALID_COMMAND";
    default:
      return fallback;
  }
}

/** Converts Zod/unknown failures into the allow-listed S02 error envelope. */
export function toS02DomainError(
  error: unknown,
  fallback: S02ErrorCode = "INVALID_COMMAND",
): S02DomainError {
  if (error instanceof S02DomainError) {
    return error;
  }

  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const code = issue ? codeForZodIssue(issue, fallback) : fallback;
    return new S02DomainError(code, issue ? fieldForPath(issue.path) : undefined);
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error
  ) {
    const candidate = (error as { code?: unknown }).code;
    if (
      typeof candidate === "string" &&
      S02_ERROR_CODES.includes(candidate as S02ErrorCode)
    ) {
      const field =
        "field" in error &&
        typeof (error as { field?: unknown }).field === "string" &&
        [
          "commandId",
          "name",
          "type",
          "spendability",
          "liquidity",
          "includeInNetWorth",
          "accountId",
          "categoryId",
          "kind",
          "parentId",
        ].includes((error as { field: string }).field)
          ? ((error as { field: S02ErrorField }).field)
          : undefined;
      return new S02DomainError(candidate as S02ErrorCode, field);
    }
  }

  return new S02DomainError(fallback);
}

export function toS02Error(
  error: unknown,
  fallback: S02ErrorCode = "INVALID_COMMAND",
): S02Error {
  return toS02DomainError(error, fallback).toError();
}

/** Throws a stable domain error for malformed command input. */
export function parseS02Command<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw toS02DomainError(result.error);
  }

  return result.data;
}

export function safeParseS02Command<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): S02Result<z.output<T>> {
  const result = schema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: toS02Error(result.error) };
}

export const parseCommand = parseS02Command;
export const safeParseCommand = safeParseS02Command;

export function parseCreateAccountCommand(
  input: unknown,
): CreateAccountCommand {
  return parseS02Command(createAccountCommandSchema, input);
}

export function parseUpdateAccountCommand(
  input: unknown,
): UpdateAccountCommand {
  return parseS02Command(updateAccountCommandSchema, input);
}

export function parseArchiveAccountCommand(
  input: unknown,
): ArchiveAccountCommand {
  return parseS02Command(archiveAccountCommandSchema, input);
}

export function parseCreateCategoryCommand(
  input: unknown,
): CreateCategoryCommand {
  return parseS02Command(createCategoryCommandSchema, input);
}

export function parseUpdateCategoryCommand(
  input: unknown,
): UpdateCategoryCommand {
  return parseS02Command(updateCategoryCommandSchema, input);
}

export function parseArchiveCategoryCommand(
  input: unknown,
): ArchiveCategoryCommand {
  return parseS02Command(archiveCategoryCommandSchema, input);
}

export function parseListQuery(input: unknown = {}): ListQuery {
  return parseS02Command(listQuerySchema, input);
}

export const parseListAccountsQuery = parseListQuery;
export const parseListCategoriesQuery = parseListQuery;

export function validateCreateAccountCommand(
  input: unknown,
): S02Result<CreateAccountCommand> {
  return safeParseS02Command(createAccountCommandSchema, input);
}

export function validateUpdateAccountCommand(
  input: unknown,
): S02Result<UpdateAccountCommand> {
  return safeParseS02Command(updateAccountCommandSchema, input);
}

export function validateCreateCategoryCommand(
  input: unknown,
): S02Result<CreateCategoryCommand> {
  return safeParseS02Command(createCategoryCommandSchema, input);
}

export function validateUpdateCategoryCommand(
  input: unknown,
): S02Result<UpdateCategoryCommand> {
  return safeParseS02Command(updateCategoryCommandSchema, input);
}

function normalizedParentId(value: string | null | undefined): string | null {
  return value === undefined || value === null ? null : value.trim();
}

/** Returns true only when an explicit parent field changes the relationship. */
export function isCategoryReparenting(
  currentParentId: string | null | undefined,
  requestedParentId: string | null | undefined,
): boolean {
  return (
    normalizedParentId(currentParentId) !== normalizedParentId(requestedParentId)
  );
}

/**
 * Validates a proposed category parent. The caller supplies the parent row
 * read inside its tenant-scoped transaction; this function never trusts a
 * household ID received from the browser.
 */
export function assertCategoryParent(
  input: CategoryParentValidationInput,
): void {
  const parentId = input.parentId;
  if (parentId === undefined || parentId === null) {
    return;
  }

  const parent = input.parent;
  if (!parent) {
    throw new S02DomainError("CATEGORY_PARENT_NOT_FOUND", "parentId");
  }

  if (input.categoryId !== undefined && parent.id === input.categoryId) {
    throw new S02DomainError("CATEGORY_SELF_PARENT", "parentId");
  }

  if (parent.id !== parentId || parent.householdId !== input.householdId) {
    // Cross-household IDs intentionally look exactly like missing parents.
    throw new S02DomainError("CATEGORY_PARENT_NOT_FOUND", "parentId");
  }

  if (parent.status === "ARCHIVED") {
    throw new S02DomainError("CATEGORY_PARENT_ARCHIVED", "parentId");
  }

  if (parent.kind !== input.kind) {
    throw new S02DomainError("CATEGORY_PARENT_KIND_MISMATCH", "parentId");
  }

  if (parent.parentId !== null && parent.parentId !== undefined) {
    throw new S02DomainError("CATEGORY_MAX_DEPTH", "parentId");
  }
}

export const assertCategoryHierarchy = assertCategoryParent;
export const validateCategoryParent = assertCategoryParent;

export function categoryParentResult(
  input: CategoryParentValidationInput,
): S02Result<void> {
  try {
    assertCategoryParent(input);
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error: toS02Error(error) };
  }
}

/**
 * Used by UpdateCategory after loading the current row. `requestedParentId`
 * is undefined when the field was omitted, while null explicitly means root.
 */
export function assertCategoryReparenting(
  input: CategoryReparentingValidationInput,
): void {
  if (input.requestedParentId === undefined) {
    return;
  }

  const changed = isCategoryReparenting(
    input.currentParentId,
    input.requestedParentId,
  );
  const used =
    input.hasFinancialUsage ?? input.isUsed ?? input.used ?? false;

  if (changed && used) {
    throw new S02DomainError("CATEGORY_REPARENTING_FORBIDDEN", "parentId");
  }
}

export const assertCategoryCanReparent = assertCategoryReparenting;
export const validateCategoryReparenting = assertCategoryReparenting;

export function categoryReparentingResult(
  input: CategoryReparentingValidationInput,
): S02Result<void> {
  try {
    assertCategoryReparenting(input);
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error: toS02Error(error) };
  }
}

/** Archived resources are immutable in S02; no reactivation is implicit. */
export function assertResourceIsActive(status: AccountStatus): void {
  if (status === "ARCHIVED") {
    throw new S02DomainError("RESOURCE_ARCHIVED");
  }
}

export function assertAccountCanArchive(
  input: AccountStatus | AccountArchiveValidationInput,
): void {
  assertResourceIsActive(typeof input === "string" ? input : input.status);
}

export function assertCategoryCanArchive(
  input: CategoryArchiveValidationInput,
): void {
  assertResourceIsActive(input.status);

  const hasActiveChildren =
    input.hasActiveChildren === true ||
    (input.activeChildCount !== undefined && input.activeChildCount > 0);
  if (hasActiveChildren) {
    throw new S02DomainError("CATEGORY_HAS_ACTIVE_CHILDREN");
  }
}

export function archiveAccountStatus(
  input: AccountStatus | AccountArchiveValidationInput,
): "ARCHIVED" {
  assertAccountCanArchive(input);
  return "ARCHIVED";
}

export function archiveCategoryStatus(
  input: CategoryArchiveValidationInput,
): "ARCHIVED" {
  assertCategoryCanArchive(input);
  return "ARCHIVED";
}

export const assertCanArchiveAccount = assertAccountCanArchive;
export const assertCanArchiveCategory = assertCategoryCanArchive;

/** A command cannot carry persisted immutable fields or a delete operation. */
export const ACCOUNT_IMMUTABLE_FIELDS = [
  "id",
  "householdId",
  "type",
  "status",
  "trackingStartedOn",
  "createdAt",
  "updatedAt",
  "balance",
] as const;

export const CATEGORY_IMMUTABLE_FIELDS = [
  "id",
  "householdId",
  "kind",
  "status",
  "createdAt",
  "updatedAt",
] as const;

export type AccountImmutableField = (typeof ACCOUNT_IMMUTABLE_FIELDS)[number];
export type CategoryImmutableField = (typeof CATEGORY_IMMUTABLE_FIELDS)[number];

export function assertAccountUpdateIsMutable(input: unknown): void {
  parseUpdateAccountCommand(input);
}

export function assertCategoryUpdateIsMutable(input: unknown): void {
  parseUpdateCategoryCommand(input);
}

export const assertOnlyEditableAccountFields = assertAccountUpdateIsMutable;
export const assertOnlyEditableCategoryFields = assertCategoryUpdateIsMutable;

/**
 * Combines update parsing with the read-side invariants that need current
 * state. This is intentionally pure; repository/use-case code supplies rows.
 */
export interface CategoryUpdateInvariantInput {
  command: unknown;
  householdId: string;
  currentCategory: CategoryHierarchyNode;
  parent?: CategoryHierarchyNode | null;
  hasFinancialUsage?: boolean;
  isUsed?: boolean;
  used?: boolean;
}

export function assertCategoryUpdateInvariants(
  input: CategoryUpdateInvariantInput,
): UpdateCategoryCommand {
  const command = parseUpdateCategoryCommand(input.command);
  assertResourceIsActive(input.currentCategory.status);

  assertCategoryReparenting({
    currentParentId: input.currentCategory.parentId,
    requestedParentId: command.parentId,
    hasFinancialUsage: input.hasFinancialUsage,
    isUsed: input.isUsed,
    used: input.used,
  });

  if (command.parentId !== undefined) {
    assertCategoryParent({
      householdId: input.householdId,
      kind: input.currentCategory.kind,
      parentId: command.parentId,
      categoryId: input.currentCategory.id,
      parent: input.parent,
    });
  }

  return command;
}

/** Convenience conversion for adapters that want a Result instead of throw. */
export function categoryUpdateInvariantResult(
  input: CategoryUpdateInvariantInput,
): S02Result<UpdateCategoryCommand> {
  try {
    return { ok: true, value: assertCategoryUpdateInvariants(input) };
  } catch (error) {
    return { ok: false, error: toS02Error(error) };
  }
}

/** Type-only helpers for consumers that need exhaustive switches. */
export function isAccountType(value: unknown): value is AccountType {
  return typeof value === "string" && ACCOUNT_TYPES.includes(value as AccountType);
}

export function isCategoryKind(value: unknown): value is CategoryKind {
  return typeof value === "string" && CATEGORY_KINDS.includes(value as CategoryKind);
}

export function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === "string" && ACCOUNT_STATUSES.includes(value as AccountStatus);
}

export function isSpendability(value: unknown): value is Spendability {
  return typeof value === "string" && SPENDABILITIES.includes(value as Spendability);
}

export function isLiquidity(value: unknown): value is Liquidity {
  return typeof value === "string" && LIQUIDITIES.includes(value as Liquidity);
}
