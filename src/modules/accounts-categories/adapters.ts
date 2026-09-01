import { requireFinancialContext } from "@/modules/households/context";
import { FinancialContextError } from "@/modules/households/contracts";
import type { FinancialContext } from "@/modules/households/contracts";
import { generateUuidV7, isUuidV7 } from "@/lib/uuidv7";
import { accountsUseCases } from "@/modules/accounts/use-cases";
import { categoryUseCasePort } from "@/modules/categories/use-cases";
import {
  createObservabilityRequestId,
  logS02CrudOperation,
  reportS02UnexpectedError,
  type S02CrudOperation,
} from "@/modules/observability/s02";

import {
  archiveAccountCommandSchema,
  archiveCategoryCommandSchema,
  createAccountCommandSchema,
  createCategoryCommandSchema,
  listAccountsQuerySchema,
  listCategoriesQuerySchema,
  toS02DomainError,
  updateAccountCommandSchema,
  updateCategoryCommandSchema,
} from "./validation";
import {
  failure,
  S02_ERROR_CODES,
  S02_ERROR_MESSAGES,
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
  type S02Error,
  type S02Result,
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
  ): Promise<S02Result<AccountReadModel>> | S02Result<AccountReadModel>;
  list(
    context: FinancialContext,
    query: ListAccountsQuery,
  ): Promise<S02Result<ListAccountsReadModel>> | S02Result<ListAccountsReadModel>;
  update(
    context: FinancialContext,
    command: UpdateAccountCommand,
  ): Promise<S02Result<AccountReadModel>> | S02Result<AccountReadModel>;
  archive(
    context: FinancialContext,
    command: ArchiveAccountCommand,
  ): Promise<S02Result<AccountReadModel>> | S02Result<AccountReadModel>;
}

/** The category counterpart of {@link AccountsUseCasePort}. */
export interface CategoriesUseCasePort {
  create(
    context: FinancialContext,
    command: CreateCategoryCommand,
  ): Promise<S02Result<CategoryReadModel>> | S02Result<CategoryReadModel>;
  list(
    context: FinancialContext,
    query: ListCategoriesQuery,
  ): Promise<S02Result<ListCategoriesReadModel>> | S02Result<ListCategoriesReadModel>;
  update(
    context: FinancialContext,
    command: UpdateCategoryCommand,
  ): Promise<S02Result<CategoryReadModel>> | S02Result<CategoryReadModel>;
  archive(
    context: FinancialContext,
    command: ArchiveCategoryCommand,
  ): Promise<S02Result<CategoryReadModel>> | S02Result<CategoryReadModel>;
}

export interface S02UseCasePorts {
  accounts: AccountsUseCasePort;
  categories: CategoriesUseCasePort;
}

export interface S02ActionDependencies {
  resolveContext: () => Promise<FinancialContext>;
  ports: S02UseCasePorts;
}

type Schema<T> = {
  safeParse(input: unknown):
    | { success: true; data: T }
    | { success: false; error: unknown };
};

function isResult<T>(value: unknown): value is S02Result<T> {
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
    S02_ERROR_CODES.includes(code as (typeof S02_ERROR_CODES)[number])
  );
}

type CrudActionOperation = S02CrudOperation["operation"];
type CrudActionEntity = S02CrudOperation["entityType"];

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
      S02_ERROR_CODES.includes(code as (typeof S02_ERROR_CODES)[number])) ||
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
export function toS02ActionError(error: unknown): S02Error {
  if (error instanceof FinancialContextError) {
    return {
      code: "UNAUTHENTICATED",
      message: S02_ERROR_MESSAGES.UNAUTHENTICATED,
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
      message: S02_ERROR_MESSAGES.UNAUTHENTICATED,
    };
  }

  return toS02DomainError(error).toError();
}

function parseInput<T>(schema: Schema<T>, input: unknown): S02Result<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  return { ok: false, error: toS02ActionError(parsed.error) };
}

async function runAction<TInput, TResult>(
  input: unknown,
  schema: Schema<TInput>,
  dependencies: S02ActionDependencies,
  descriptor: CrudActionDescriptor,
  operation: (context: FinancialContext, input: TInput) =>
    | Promise<S02Result<TResult>>
    | S02Result<TResult>,
): Promise<S02Result<TResult>> {
  const startedAt = monotonicNow();
  let unexpectedReported = false;
  const telemetry: S02CrudOperation = {
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
    reportS02UnexpectedError(
      error,
      telemetry,
      elapsedMs(startedAt),
      financialContext,
    );
  };
  let parsed: S02Result<TInput>;
  try {
    parsed = parseInput(schema, input);
  } catch (error) {
    reportUnexpected(error);
    throw error;
  }
  if (!parsed.ok) {
    logS02CrudOperation(
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
      const safeError = toS02ActionError(error);
      logS02CrudOperation(
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
        const completedTelemetry: S02CrudOperation = {
          ...telemetry,
          entityId:
            telemetry.entityId ??
            resourceIdFromResult(result.value),
        };
        logS02CrudOperation(
          completedTelemetry,
          "success",
          elapsedMs(startedAt),
          context,
        );
        return { ok: true, value: result.value };
      }

      const safeError = toS02ActionError(result.error);
      logS02CrudOperation(
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
      const safeError = toS02ActionError(error);
      logS02CrudOperation(
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

export interface S02ActionHandlers {
  createAccount(input: unknown): Promise<S02Result<AccountReadModel>>;
  listAccounts(input?: unknown): Promise<S02Result<ListAccountsReadModel>>;
  updateAccount(input: unknown): Promise<S02Result<AccountReadModel>>;
  archiveAccount(input: unknown): Promise<S02Result<AccountReadModel>>;
  createCategory(input: unknown): Promise<S02Result<CategoryReadModel>>;
  listCategories(input?: unknown): Promise<S02Result<ListCategoriesReadModel>>;
  updateCategory(input: unknown): Promise<S02Result<CategoryReadModel>>;
  archiveCategory(input: unknown): Promise<S02Result<CategoryReadModel>>;
}

/**
 * Builds all S02 Server Action adapters around explicit use-case ports.
 * Schemas are applied before context resolution, so malformed input cannot
 * reach authentication or persistence.
 */
export function createS02ActionHandlers(
  dependencies: S02ActionDependencies,
): S02ActionHandlers {
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

export function createMockS02UseCasePorts(): S02UseCasePorts {
  return {
    accounts: createMockAccountPort(),
    categories: createMockCategoryPort(),
  };
}

/**
 * T05/T06 are the production composition. Their ports resolve the database
 * lazily, so importing this module does not establish a connection during
 * route generation. Tests and early UI scaffolding can still replace them
 * with `configureS02UseCasePorts(createMockS02UseCasePorts())`.
 */
let configuredPorts: S02UseCasePorts = {
  accounts: accountsUseCases,
  categories: categoryUseCasePort,
};

/** Installs T05/T06 ports at composition time; never called by the browser. */
export function configureS02UseCasePorts(ports: S02UseCasePorts): void {
  configuredPorts = ports;
}

export function getS02UseCasePorts(): S02UseCasePorts {
  return configuredPorts;
}

export function getS02ActionHandlers(): S02ActionHandlers {
  return createS02ActionHandlers({
    resolveContext: () => requireFinancialContext(),
    ports: getS02UseCasePorts(),
  });
}
