/**
 * Shared contract for the S02 accounts and categories domain.
 *
 * The public boundary uses camelCase. Database column names (for example
 * `household_id`) deliberately do not appear in commands so a browser cannot
 * turn a tenant identifier into write authority.
 */

export const ACCOUNT_TYPES = [
  "CHECKING",
  "SAVINGS",
  "CASH",
  "CREDIT_CARD",
  "BENEFIT",
  "INVESTMENT",
  "OTHER",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_TYPE_VALUES = ACCOUNT_TYPES;

export const ACCOUNT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export type CategoryStatus = AccountStatus;
export const ACCOUNT_STATUS_VALUES = ACCOUNT_STATUSES;

/** Categories intentionally share the persisted status vocabulary with accounts. */
export const CATEGORY_STATUSES = ACCOUNT_STATUSES;

export const SPENDABILITIES = [
  "GENERAL",
  "RESTRICTED",
  "EXCLUDED",
] as const;

export type Spendability = (typeof SPENDABILITIES)[number];
export const SPENDABILITY_VALUES = SPENDABILITIES;

export const LIQUIDITIES = [
  "IMMEDIATE",
  "LIQUID",
  "RESTRICTED",
] as const;

export type Liquidity = (typeof LIQUIDITIES)[number];
export const LIQUIDITY_VALUES = LIQUIDITIES;

export const CATEGORY_KINDS = ["EXPENSE", "INCOME"] as const;

export type CategoryKind = (typeof CATEGORY_KINDS)[number];
export const CATEGORY_KIND_VALUES = CATEGORY_KINDS;

export const STATUS_FILTERS = ["ACTIVE", "ARCHIVED", "ALL"] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const STATUS_FILTER_VALUES = STATUS_FILTERS;

export const DEFAULT_ACCOUNT_SPENDABILITY: Spendability = "GENERAL";
export const DEFAULT_ACCOUNT_LIQUIDITY: Liquidity = "IMMEDIATE";
export const DEFAULT_ACCOUNT_INCLUDE_IN_NET_WORTH = true;

export const ACCOUNT_NAME_MAX_LENGTH = 120;
export const CATEGORY_NAME_MAX_LENGTH = 120;
export const ACCOUNTS_CATEGORIES_NAME_MAX_LENGTH = 120;
export const COMMAND_ID_MAX_LENGTH = 128;

export interface CreateAccountCommand {
  commandId: string;
  name: string;
  type: AccountType;
  spendability?: Spendability;
  liquidity?: Liquidity;
  includeInNetWorth?: boolean;
}

export interface UpdateAccountCommand {
  commandId: string;
  accountId: string;
  name?: string;
  spendability?: Spendability;
  liquidity?: Liquidity;
  includeInNetWorth?: boolean;
}

export interface ArchiveAccountCommand {
  commandId: string;
  accountId: string;
}

export interface CreateCategoryCommand {
  commandId: string;
  name: string;
  kind: CategoryKind;
  parentId?: string | null;
}

export interface UpdateCategoryCommand {
  commandId: string;
  categoryId: string;
  name?: string;
  parentId?: string | null;
}

export interface ArchiveCategoryCommand {
  commandId: string;
  categoryId: string;
}

export interface ListQuery {
  status?: StatusFilter;
}

export type ListAccountsQuery = ListQuery;
export type ListCategoriesQuery = ListQuery;

export interface AccountReadModel {
  id: string;
  householdId: string;
  name: string;
  type: AccountType;
  status: AccountStatus;
  spendability: Spendability;
  liquidity: Liquidity;
  includeInNetWorth: boolean;
  trackingStartedOn: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Domain/read aliases keep the vocabulary ergonomic without another model. */
export type Account = AccountReadModel;

export interface CategoryReadModel {
  id: string;
  householdId: string;
  name: string;
  parentId: string | null;
  kind: CategoryKind;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

export type Category = CategoryReadModel;

export interface ListAccountsReadModel {
  items: AccountReadModel[];
}

export interface ListCategoriesReadModel {
  items: CategoryReadModel[];
}

/**
 * Stable expected-error vocabulary for the S02 boundary. These codes are
 * intentionally independent of PostgreSQL/Drizzle error strings.
 */
export const ACCOUNTS_CATEGORIES_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INVALID_COMMAND",
  "INVALID_COMMAND_ID",
  "INVALID_NAME",
  "INVALID_ACCOUNT_TYPE",
  "INVALID_SPENDABILITY",
  "INVALID_LIQUIDITY",
  "INVALID_CATEGORY_KIND",
  "INVALID_STATUS_FILTER",
  "ACCOUNT_NOT_FOUND",
  "CREDIT_CARD_REQUIRES_CONFIGURATION",
  "CATEGORY_NOT_FOUND",
  "ACCOUNT_NAME_CONFLICT",
  "CATEGORY_NAME_CONFLICT",
  "RESOURCE_ARCHIVED",
  "COMMAND_ID_REUSED",
  "CATEGORY_PARENT_NOT_FOUND",
  "CATEGORY_PARENT_ARCHIVED",
  "CATEGORY_PARENT_KIND_MISMATCH",
  "CATEGORY_SELF_PARENT",
  "CATEGORY_MAX_DEPTH",
  "CATEGORY_REPARENTING_FORBIDDEN",
  "CATEGORY_HAS_ACTIVE_CHILDREN",
] as const;

export type AccountsCategoriesErrorCode = (typeof ACCOUNTS_CATEGORIES_ERROR_CODES)[number];

export const ACCOUNTS_CATEGORIES_ERROR_MESSAGES: Record<AccountsCategoriesErrorCode, string> = {
  UNAUTHENTICATED: "É necessário entrar para acessar este recurso.",
  INVALID_COMMAND: "Os dados da operação são inválidos.",
  INVALID_COMMAND_ID: "O identificador da operação é inválido.",
  INVALID_NAME: "Informe um nome entre 1 e 120 caracteres válidos.",
  INVALID_ACCOUNT_TYPE: "O tipo de conta informado é inválido.",
  INVALID_SPENDABILITY: "A regra de disponibilidade informada é inválida.",
  INVALID_LIQUIDITY: "A liquidez informada é inválida.",
  INVALID_CATEGORY_KIND: "O tipo de categoria informado é inválido.",
  INVALID_STATUS_FILTER: "O filtro de status informado é inválido.",
  ACCOUNT_NOT_FOUND: "A conta não foi encontrada.",
  CREDIT_CARD_REQUIRES_CONFIGURATION:
    "Cartões devem ser criados pelo fluxo de cartão, com configuração de billing.",
  CATEGORY_NOT_FOUND: "A categoria não foi encontrada.",
  ACCOUNT_NAME_CONFLICT: "Já existe uma conta com este nome.",
  CATEGORY_NAME_CONFLICT: "Já existe uma categoria com este nome neste nível.",
  RESOURCE_ARCHIVED: "O recurso já está arquivado e não pode ser editado.",
  COMMAND_ID_REUSED: "O identificador da operação já foi utilizado.",
  CATEGORY_PARENT_NOT_FOUND: "A categoria pai não foi encontrada.",
  CATEGORY_PARENT_ARCHIVED: "A categoria pai está arquivada.",
  CATEGORY_PARENT_KIND_MISMATCH:
    "A categoria pai precisa ter o mesmo tipo da categoria filha.",
  CATEGORY_SELF_PARENT: "Uma categoria não pode ser pai de si mesma.",
  CATEGORY_MAX_DEPTH: "Categorias podem ter no máximo dois níveis.",
  CATEGORY_REPARENTING_FORBIDDEN:
    "Uma categoria utilizada não pode mudar de categoria pai.",
  CATEGORY_HAS_ACTIVE_CHILDREN:
    "Arquive as categorias filhas ativas antes de arquivar esta categoria.",
};

export type AccountsCategoriesErrorField =
  | "commandId"
  | "name"
  | "type"
  | "spendability"
  | "liquidity"
  | "includeInNetWorth"
  | "accountId"
  | "categoryId"
  | "kind"
  | "parentId";

export interface AccountsCategoriesError {
  code: AccountsCategoriesErrorCode;
  message: string;
  field?: AccountsCategoriesErrorField;
}

export type AccountsCategoriesResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AccountsCategoriesError };

function statusForAccountsCategoriesError(code: AccountsCategoriesErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "ACCOUNT_NOT_FOUND":
    case "CATEGORY_NOT_FOUND":
    case "CATEGORY_PARENT_NOT_FOUND":
      return 404;
    case "ACCOUNT_NAME_CONFLICT":
    case "CREDIT_CARD_REQUIRES_CONFIGURATION":
    case "CATEGORY_NAME_CONFLICT":
    case "RESOURCE_ARCHIVED":
    case "COMMAND_ID_REUSED":
    case "CATEGORY_PARENT_ARCHIVED":
    case "CATEGORY_PARENT_KIND_MISMATCH":
    case "CATEGORY_SELF_PARENT":
    case "CATEGORY_MAX_DEPTH":
    case "CATEGORY_REPARENTING_FORBIDDEN":
    case "CATEGORY_HAS_ACTIVE_CHILDREN":
      return 409;
    default:
      return 400;
  }
}

/** Safe, expected domain error used before an operation reaches persistence. */
export class AccountsCategoriesDomainError extends Error {
  readonly code: AccountsCategoriesErrorCode;
  readonly field: AccountsCategoriesErrorField | undefined;
  readonly status: number;
  readonly expected = true;

  constructor(code: AccountsCategoriesErrorCode, field?: AccountsCategoriesErrorField) {
    super(ACCOUNTS_CATEGORIES_ERROR_MESSAGES[code]);
    this.name = "AccountsCategoriesDomainError";
    this.code = code;
    this.field = field;
    this.status = statusForAccountsCategoriesError(code);
  }

  toError(): AccountsCategoriesError {
    return {
      code: this.code,
      message: this.message,
      ...(this.field ? { field: this.field } : {}),
    };
  }
}

/** Compatibility aliases for callers that use a more specific error name. */
export const DomainValidationError = AccountsCategoriesDomainError;

export function ok<T>(value: T): AccountsCategoriesResult<T> {
  return { ok: true, value };
}

export function failure<T = never>(
  code: AccountsCategoriesErrorCode,
  field?: AccountsCategoriesErrorField,
): AccountsCategoriesResult<T> {
  return {
    ok: false,
    error: new AccountsCategoriesDomainError(code, field).toError(),
  };
}

export const success = ok;
export const errorResult = failure;

/**
 * A category-shaped record is enough for every hierarchy invariant. Keeping
 * this type independent from the database schema allows client and server
 * validation to share it without importing Drizzle.
 */
export interface CategoryHierarchyNode {
  id: string;
  householdId: string;
  kind: CategoryKind;
  status: AccountStatus;
  parentId: string | null;
}

export interface CategoryParentValidationInput {
  householdId: string;
  kind: CategoryKind;
  parentId?: string | null;
  categoryId?: string;
  parent?: CategoryHierarchyNode | null;
}

export interface CategoryReparentingValidationInput {
  currentParentId?: string | null;
  requestedParentId?: string | null;
  /** Canonical name used by the use cases. */
  hasFinancialUsage?: boolean;
  /** Alias accepted by domain adapters and deterministic tests. */
  isUsed?: boolean;
  /** Alias matching the wording in the ADR. */
  used?: boolean;
}

export interface CategoryArchiveValidationInput {
  status: AccountStatus;
  /** Number is useful for repository reads; boolean keeps the pure rule small. */
  activeChildCount?: number;
  hasActiveChildren?: boolean;
}

export interface AccountArchiveValidationInput {
  status: AccountStatus;
}
