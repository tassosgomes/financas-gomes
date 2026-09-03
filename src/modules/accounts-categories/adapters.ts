import { requireFinancialContext } from "@/modules/households/context";
import { FinancialContextError } from "@/modules/households/contracts";
import type { FinancialContext } from "@/modules/households/contracts";
import { generateUuidV7, isUuidV7 } from "@/lib/uuidv7";
import { accountsUseCases } from "@/modules/accounts/use-cases";
import { categoryUseCasePort } from "@/modules/categories/use-cases";
import {
  createObservabilityRequestId,
  logCrudOperation,
  reportCrudUnexpectedError,
  type CrudOperation,
} from "@/modules/observability/accounts-categories";

import {
  archiveAccountCommandSchema,
  archiveCategoryCommandSchema,
  createAccountCommandSchema,
  createCategoryCommandSchema,
  listAccountsQuerySchema,
  listCategoriesQuerySchema,
  toAccountsCategoriesDomainError,
  updateAccountCommandSchema,
  updateCategoryCommandSchema,
} from "./validation";
import {
  failure,
  ACCOUNTS_CATEGORIES_ERROR_CODES,
  ACCOUNTS_CATEGORIES_ERROR_MESSAGES,
  type AccountReadModel,
  type ArchiveAccountCommand,
  type ArchiveCategoryCommand,
  type CategoryReadModel,
  type CreateAccountCommand,
  type CreateCategoryCommand,
  type ListAccountsQuery,
  type ListAccountsReadModel,
  type ListCategoriesQuery,
  type ListCategoriesReadModel,
  type AccountsCategoriesError,
  type AccountsCategoriesResult,
  type UpdateAccountCommand,
  type UpdateCategoryCommand,
} from "./contracts";

/**
 * A use-case port keeps the Server Action independent from the persistence
 * implementation. T05/T06 can provide an implementation without changing
 * forms, routes or the serializable action contract.
 */
export interface AccountsUseCasePort {
  create(
    context: FinancialContext,
    command: CreateAccountCommand,
  ): Promise<AccountsCategoriesResult<AccountReadModel>> | AccountsCategoriesResult<AccountReadModel>;
  list(
    context: FinancialContext,
    query: ListAccountsQuery,
  ): Promise<AccountsCategoriesResult<ListAccountsReadModel>> | AccountsCategoriesResult<ListAccountsReadModel>;
  update(
    context: FinancialContext,
    command: UpdateAccountCommand,
  ): Promise<AccountsCategoriesResult<AccountReadModel>> | AccountsCategoriesResult<AccountReadModel>;
  archive(
    context: FinancialContext,
    command: ArchiveAccountCommand,
  ): Promise<AccountsCategoriesResult<AccountReadModel>> | AccountsCategoriesResult<AccountReadModel>;
}

/** The category counterpart of {@link AccountsUseCasePort}. */
export interface CategoriesUseCasePort {
  create(
    context: FinancialContext,
    command: CreateCategoryCommand,
  ): Promise<AccountsCategoriesResult<CategoryReadModel>> | AccountsCategoriesResult<CategoryReadModel>;
  list(
    context: FinancialContext,
    query: ListCategoriesQuery,
  ): Promise<AccountsCategoriesResult<ListCategoriesReadModel>> | AccountsCategoriesResult<ListCategoriesReadModel>;
  update(
    context: FinancialContext,
    command: UpdateCategoryCommand,
  ): Promise<AccountsCategoriesResult<CategoryReadModel>> | AccountsCategoriesResult<CategoryReadModel>;
  archive(
    context: FinancialContext,
    command: ArchiveCategoryCommand,
  ): Promise<AccountsCategoriesResult<CategoryReadModel>> | AccountsCategoriesResult<CategoryReadModel>;
}

export interface AccountsCategoriesUseCasePorts {
  accounts: AccountsUseCasePort;
  categories: CategoriesUseCasePort;
}

export interface AccountsCategoriesActionDependencies {
  resolveContext: () => Promise<FinancialContext>;
  ports: AccountsCategoriesUseCasePorts;
}

type Schema<T> = {
  safeParse(input: unknown):
    | { success: true; data: T }
    | { success: false; error: unknown };
};

function isResult<T>(value: unknown): value is AccountsCategoriesResult<T> {
  if (
    typeof value !== "object" ||
    value === null ||
    !("ok" in value) ||
    typeof (value as { ok?: unknown }).ok !== "boolean"
  ) {
    return false;
  }

  if ((value as { ok: boolean }).ok) {
    return "value" in value;
  }

  const error = (value as { error?: unknown }).error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return (
    typeof code === "string" &&
    ACCOUNTS_CATEGORIES_ERROR_CODES.includes(code as (typeof ACCOUNTS_CATEGORIES_ERROR_CODES)[number])
  );
}

type CrudActionOperation = CrudOperation["operation"];
type CrudActionEntity = CrudOperation["entityType"];

interface CrudActionDescriptor {
  operation: CrudActionOperation;
  entityType: CrudActionEntity;
}

const CRUD_ACTIONS = {
  createAccount: { operation: "create", entityType: "account" },
  listAccounts: { operation: "list", entityType: "account" },
  updateAccount: { operation: "update", entityType: "account" },
  archiveAccount: { operation: "archive", entityType: "account" },
  createCategory: { operation: "create", entityType: "category" },
  listCategories: { operation: "list", entityType: "category" },
  updateCategory: { operation: "update", entityType: "category" },
  archiveCategory: { operation: "archive", entityType: "category" },
} as const satisfies Record<string, CrudActionDescriptor>;

function monotonicNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(monotonicNow() - startedAt));
}

/** Only parsed UUID resource IDs are eligible for observability context. */
function resourceIdForAction(
  input: unknown,
  entityType: CrudActionEntity,
): string | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }

  const key = entityType === "account" ? "accountId" : "categoryId";
  const candidate = (input as Record<string, unknown>)[key];
  return typeof candidate === "string" && isUuidV7(candidate)
    ? candidate
    : undefined;
}

function resourceIdFromResult(
  value: unknown,
): string | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value)
  ) {
    return undefined;
  }

  const candidate = (value as { id?: unknown }).id;
  return typeof candidate === "string" && isUuidV7(candidate)
    ? candidate
    : undefined;
}

function errorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }

  return undefined;
}

function isExpectedError(error: unknown): boolean {
  if (error instanceof FinancialContextError) {
    return true;
  }

  const code = errorCode(error);
  return (
    (typeof code === "string" &&
      ACCOUNTS_CATEGORIES_ERROR_CODES.includes(code as (typeof ACCOUNTS_CATEGORIES_ERROR_CODES)[number])) ||
    code === "UNAUTHENTICATED" ||
    code === "HOUSEHOLD_MEMBERSHIP_REQUIRED" ||
    code === "HOUSEHOLD_SELECTION_REQUIRED" ||
    code === "INVALID_FINANCIAL_CONTEXT"
  );
}

/**
 * Error conversion used by every action. Only the allow-listed S02 envelope
 * crosses the React/Next boundary; database messages and context internals
 * are never returned to the browser.
 */
export function toAccountsCategoriesActionError(error: unknown): AccountsCategoriesError {
  if (error instanceof FinancialContextError) {
    return {
      code: "UNAUTHENTICATED",
      message: ACCOUNTS_CATEGORIES_ERROR_MESSAGES.UNAUTHENTICATED,
    };
  }

  const code = errorCode(error);
  if (
    code === "UNAUTHENTICATED" ||
    code === "HOUSEHOLD_MEMBERSHIP_REQUIRED" ||
    code === "HOUSEHOLD_SELECTION_REQUIRED" ||
    code === "INVALID_FINANCIAL_CONTEXT"
  ) {
    return {
      code: "UNAUTHENTICATED",
      message: ACCOUNTS_CATEGORIES_ERROR_MESSAGES.UNAUTHENTICATED,
    };
  }

  return toAccountsCategoriesDomainError(error).toError();
}

function parseInput<T>(schema: Schema<T>, input: unknown): AccountsCategoriesResult<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  return { ok: false, error: toAccountsCategoriesActionError(parsed.error) };
}

async function runAction<TInput, TResult>(
  input: unknown,
  schema: Schema<TInput>,
  dependencies: AccountsCategoriesActionDependencies,
  descriptor: CrudActionDescriptor,
  operation: (context: FinancialContext, input: TInput) =>
    | Promise<AccountsCategoriesResult<TResult>>
    | AccountsCategoriesResult<TResult>,
): Promise<AccountsCategoriesResult<TResult>> {
  const startedAt = monotonicNow();
  let unexpectedReported = false;
  const telemetry: CrudOperation = {
    ...descriptor,
    requestId: createObservabilityRequestId(),
    entityId: resourceIdForAction(input, descriptor.entityType),
  };
  const reportUnexpected = (
    error: unknown,
    financialContext?: FinancialContext,
  ): void => {
    if (unexpectedReported) {
      return;
    }
    unexpectedReported = true;
    reportCrudUnexpectedError(
      error,
      telemetry,
      elapsedMs(startedAt),
      financialContext,
    );
  };
  let parsed: AccountsCategoriesResult<TInput>;
  try {
    parsed = parseInput(schema, input);
  } catch (error) {
    reportUnexpected(error);
    throw error;
  }
  if (!parsed.ok) {
    logCrudOperation(
      telemetry,
      "expected_error",
      elapsedMs(startedAt),
      undefined,
      parsed.error.code,
    );
    return parsed;
  }

  let context: FinancialContext;
  try {
    context = await dependencies.resolveContext();
  } catch (error) {
    if (isExpectedError(error)) {
      const safeError = toAccountsCategoriesActionError(error);
      logCrudOperation(
        telemetry,
        "expected_error",
        elapsedMs(startedAt),
        undefined,
        safeError.code,
      );
      return { ok: false, error: safeError };
    }

    reportUnexpected(error);
    throw error;
  }

  try {
    const result = await operation(context, parsed.value);
    if (isResult<TResult>(result)) {
      if (result.ok) {
        const completedTelemetry: CrudOperation = {
          ...telemetry,
          entityId:
            telemetry.entityId ??
            resourceIdFromResult(result.value),
        };
        logCrudOperation(
          completedTelemetry,
          "success",
          elapsedMs(startedAt),
          context,
        );
        return { ok: true, value: result.value };
      }

      const safeError = toAccountsCategoriesActionError(result.error);
      logCrudOperation(
        telemetry,
        "expected_error",
        elapsedMs(startedAt),
        context,
        safeError.code,
      );
      return { ok: false, error: safeError };
    }

    const invalidResultError = new Error("invalid use-case result");
    reportUnexpected(invalidResultError, context);
    throw invalidResultError;
  } catch (error) {
    if (isExpectedError(error)) {
      const safeError = toAccountsCategoriesActionError(error);
      logCrudOperation(
        telemetry,
        "expected_error",
        elapsedMs(startedAt),
        context,
        safeError.code,
      );
      return { ok: false, error: safeError };
    }

    reportUnexpected(error, context);
    throw error;
  }
}

export interface AccountsCategoriesActionHandlers {
  createAccount(input: unknown): Promise<AccountsCategoriesResult<AccountReadModel>>;
  listAccounts(input?: unknown): Promise<AccountsCategoriesResult<ListAccountsReadModel>>;
  updateAccount(input: unknown): Promise<AccountsCategoriesResult<AccountReadModel>>;
  archiveAccount(input: unknown): Promise<AccountsCategoriesResult<AccountReadModel>>;
  createCategory(input: unknown): Promise<AccountsCategoriesResult<CategoryReadModel>>;
  listCategories(input?: unknown): Promise<AccountsCategoriesResult<ListCategoriesReadModel>>;
  updateCategory(input: unknown): Promise<AccountsCategoriesResult<CategoryReadModel>>;
  archiveCategory(input: unknown): Promise<AccountsCategoriesResult<CategoryReadModel>>;
}

/**
 * Builds all S02 Server Action adapters around explicit use-case ports.
 * Schemas are applied before context resolution, so malformed input cannot
 * reach authentication or persistence.
 */
export function createAccountsCategoriesActionHandlers(
  dependencies: AccountsCategoriesActionDependencies,
): AccountsCategoriesActionHandlers {
  return {
    createAccount: (input) =>
      runAction(
        input,
        createAccountCommandSchema,
        dependencies,
        CRUD_ACTIONS.createAccount,
        (context, command) => dependencies.ports.accounts.create(context, command),
      ),
    listAccounts: (input = {}) =>
      runAction(
        input,
        listAccountsQuerySchema,
        dependencies,
        CRUD_ACTIONS.listAccounts,
        (context, query) => dependencies.ports.accounts.list(context, query),
      ),
    updateAccount: (input) =>
      runAction(
        input,
        updateAccountCommandSchema,
        dependencies,
        CRUD_ACTIONS.updateAccount,
        (context, command) => dependencies.ports.accounts.update(context, command),
      ),
    archiveAccount: (input) =>
      runAction(
        input,
        archiveAccountCommandSchema,
        dependencies,
        CRUD_ACTIONS.archiveAccount,
        (context, command) => dependencies.ports.accounts.archive(context, command),
      ),
    createCategory: (input) =>
      runAction(
        input,
        createCategoryCommandSchema,
        dependencies,
        CRUD_ACTIONS.createCategory,
        (context, command) => dependencies.ports.categories.create(context, command),
      ),
    listCategories: (input = {}) =>
      runAction(
        input,
        listCategoriesQuerySchema,
        dependencies,
        CRUD_ACTIONS.listCategories,
        (context, query) => dependencies.ports.categories.list(context, query),
      ),
    updateCategory: (input) =>
      runAction(
        input,
        updateCategoryCommandSchema,
        dependencies,
        CRUD_ACTIONS.updateCategory,
        (context, command) => dependencies.ports.categories.update(context, command),
      ),
    archiveCategory: (input) =>
      runAction(
        input,
        archiveCategoryCommandSchema,
        dependencies,
        CRUD_ACTIONS.archiveCategory,
        (context, command) => dependencies.ports.categories.archive(context, command),
      ),
  };
}

/**
 * The mock is intentionally a replaceable development/test port. It stores
 * only metadata and never attempts to model balances, ledger rules or
 * tenancy authority; the context supplied by the action remains the key.
 */
function createMockAccountPort(): AccountsUseCasePort {
  const records = new Map<string, AccountReadModel>();

  return {
    create: (context, command) => {
      const now = new Date().toISOString();
      const value: AccountReadModel = {
        id: generateUuidV7(),
        householdId: context.householdId,
        name: command.name,
        type: command.type,
        status: "ACTIVE",
        spendability: command.spendability ?? "GENERAL",
        liquidity: command.liquidity ?? "IMMEDIATE",
        includeInNetWorth: command.includeInNetWorth ?? true,
        trackingStartedOn: null,
        createdAt: now,
        updatedAt: now,
      };
      records.set(`${context.householdId}:${value.id}`, value);
      return { ok: true, value };
    },
    list: (context, query) => ({
      ok: true,
      value: {
        items: [...records.values()]
          .filter(
            (record) =>
              record.householdId === context.householdId &&
              (query.status === "ALL" || record.status === query.status),
          )
          .sort((left, right) =>
            `${left.name.toLocaleLowerCase()}:${left.id}`.localeCompare(
              `${right.name.toLocaleLowerCase()}:${right.id}`,
            ),
          ),
      },
    }),
    update: (context, command) => {
      const key = `${context.householdId}:${command.accountId}`;
      const current = records.get(key);
      if (!current) {
        return failure("ACCOUNT_NOT_FOUND");
      }

      const value = {
        ...current,
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
        updatedAt: new Date().toISOString(),
      };
      records.set(key, value);
      return { ok: true, value };
    },
    archive: (context, command) => {
      const key = `${context.householdId}:${command.accountId}`;
      const current = records.get(key);
      if (!current) {
        return failure("ACCOUNT_NOT_FOUND");
      }

      const value = {
        ...current,
        status: "ARCHIVED" as const,
        updatedAt: new Date().toISOString(),
      };
      records.set(key, value);
      return { ok: true, value };
    },
  };
}

function createMockCategoryPort(): CategoriesUseCasePort {
  const records = new Map<string, CategoryReadModel>();

  return {
    create: (context, command) => {
      const now = new Date().toISOString();
      const value: CategoryReadModel = {
        id: generateUuidV7(),
        householdId: context.householdId,
        name: command.name,
        parentId: command.parentId ?? null,
        kind: command.kind,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      };
      records.set(`${context.householdId}:${value.id}`, value);
      return { ok: true, value };
    },
    list: (context, query) => ({
      ok: true,
      value: {
        items: [...records.values()]
          .filter(
            (record) =>
              record.householdId === context.householdId &&
              (query.status === "ALL" || record.status === query.status),
          )
          .sort((left, right) =>
            `${left.parentId ? "1" : "0"}:${left.name.toLocaleLowerCase()}:${left.id}`.localeCompare(
              `${right.parentId ? "1" : "0"}:${right.name.toLocaleLowerCase()}:${right.id}`,
            ),
          ),
      },
    }),
    update: (context, command) => {
      const key = `${context.householdId}:${command.categoryId}`;
      const current = records.get(key);
      if (!current) {
        return failure("CATEGORY_NOT_FOUND");
      }

      const value = {
        ...current,
        ...(command.name === undefined ? {} : { name: command.name }),
        ...(command.parentId === undefined
          ? {}
          : { parentId: command.parentId }),
        updatedAt: new Date().toISOString(),
      };
      records.set(key, value);
      return { ok: true, value };
    },
    archive: (context, command) => {
      const key = `${context.householdId}:${command.categoryId}`;
      const current = records.get(key);
      if (!current) {
        return failure("CATEGORY_NOT_FOUND");
      }

      const value = {
        ...current,
        status: "ARCHIVED" as const,
        updatedAt: new Date().toISOString(),
      };
      records.set(key, value);
      return { ok: true, value };
    },
  };
}

export function createMockAccountsCategoriesUseCasePorts(): AccountsCategoriesUseCasePorts {
  return {
    accounts: createMockAccountPort(),
    categories: createMockCategoryPort(),
  };
}

/**
 * T05/T06 are the production composition. Their ports resolve the database
 * lazily, so importing this module does not establish a connection during
 * route generation. Tests and early UI scaffolding can still replace them
 * with `configureAccountsCategoriesUseCasePorts(createMockAccountsCategoriesUseCasePorts())`.
 */
let configuredPorts: AccountsCategoriesUseCasePorts = {
  accounts: accountsUseCases,
  categories: categoryUseCasePort,
};

/** Installs T05/T06 ports at composition time; never called by the browser. */
export function configureAccountsCategoriesUseCasePorts(ports: AccountsCategoriesUseCasePorts): void {
  configuredPorts = ports;
}

export function getAccountsCategoriesUseCasePorts(): AccountsCategoriesUseCasePorts {
  return configuredPorts;
}

export function getAccountsCategoriesActionHandlers(): AccountsCategoriesActionHandlers {
  return createAccountsCategoriesActionHandlers({
    resolveContext: () => requireFinancialContext(),
    ports: getAccountsCategoriesUseCasePorts(),
  });
}
