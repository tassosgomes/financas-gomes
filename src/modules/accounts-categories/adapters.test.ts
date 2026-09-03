import { afterEach, describe, expect, it, vi } from "vitest";

import { FinancialContextError } from "@/modules/households/contracts";

vi.mock("@/modules/observability/server", () => ({
  captureServerException: vi.fn(),
}));

import {
  createAccountsCategoriesActionHandlers,
  type AccountsCategoriesUseCasePorts,
} from "./adapters";
import {
  type AccountReadModel,
  type CategoryReadModel,
  type AccountsCategoriesResult,
} from "./contracts";
import { captureServerException } from "@/modules/observability/server";

const context = {
  userId: "user-1",
  householdId: "household-1",
};

const account: AccountReadModel = {
  id: "018f4f26-7c1b-7abc-8a7f-56d2b1a89f0e",
  householdId: context.householdId,
  name: "Conta principal",
  type: "CHECKING",
  status: "ACTIVE",
  spendability: "GENERAL",
  liquidity: "IMMEDIATE",
  includeInNetWorth: true,
  trackingStartedOn: null,
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
};

const category: CategoryReadModel = {
  id: "018f4f26-7c1b-7abc-8a7f-56d2b1a89f0f",
  householdId: context.householdId,
  name: "Casa",
  parentId: null,
  kind: "EXPENSE",
  status: "ACTIVE",
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
};

function ok<T>(value: T): AccountsCategoriesResult<T> {
  return { ok: true, value };
}

function createPorts(): AccountsCategoriesUseCasePorts {
  return {
    accounts: {
      create: vi.fn(async () => ok(account)),
      list: vi.fn(async () => ok({ items: [account] })),
      update: vi.fn(async () => ok(account)),
      archive: vi.fn(async (): Promise<AccountsCategoriesResult<AccountReadModel>> =>
        ok({ ...account, status: "ARCHIVED" }),
      ),
    },
    categories: {
      create: vi.fn(async () => ok(category)),
      list: vi.fn(async () => ok({ items: [category] })),
      update: vi.fn(async () => ok(category)),
      archive: vi.fn(async (): Promise<AccountsCategoriesResult<CategoryReadModel>> =>
        ok({ ...category, status: "ARCHIVED" }),
      ),
    },
  };
}

describe("action adapters", () => {
  afterEach(() => {
    vi.mocked(captureServerException).mockClear();
  });

  it("rejects tenant authority before resolving financial context", async () => {
    const resolveContext = vi.fn(async () => context);
    const ports = createPorts();
    const handlers = createAccountsCategoriesActionHandlers({ resolveContext, ports });

    const result = await handlers.createAccount({
      commandId: "account-create-1",
      name: "Conta",
      type: "CHECKING",
      householdId: "attacker-household",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INVALID_COMMAND",
        message: "Os dados da operação são inválidos.",
      },
    });
    expect(resolveContext).not.toHaveBeenCalled();
    expect(ports.accounts.create).not.toHaveBeenCalled();
  });

  it("passes only the server context and parsed command to a use case", async () => {
    const resolveContext = vi.fn(async () => context);
    const ports = createPorts();
    const handlers = createAccountsCategoriesActionHandlers({ resolveContext, ports });

    const result = await handlers.createAccount({
      commandId: "account-create-2",
      name: "  Conta   principal  ",
      type: "CHECKING",
    });

    expect(result).toEqual({ ok: true, value: account });
    expect(ports.accounts.create).toHaveBeenCalledWith(context, {
      commandId: "account-create-2",
      name: "Conta principal",
      type: "CHECKING",
    });
  });

  it("maps context and expected use-case errors to safe serializable envelopes", async () => {
    const contextErrorHandlers = createAccountsCategoriesActionHandlers({
      resolveContext: async () => {
        throw new FinancialContextError("HOUSEHOLD_MEMBERSHIP_REQUIRED");
      },
      ports: createPorts(),
    });

    await expect(
      contextErrorHandlers.listAccounts(),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "É necessário entrar para acessar este recurso.",
      },
    });

    const ports = createPorts();
    ports.accounts.create = vi.fn(async (): Promise<AccountsCategoriesResult<AccountReadModel>> => ({
      ok: false as const,
      error: {
        code: "ACCOUNT_NAME_CONFLICT" as const,
        message: "raw database detail",
        field: "name" as const,
      },
    }));
    const handlers = createAccountsCategoriesActionHandlers({
      resolveContext: async () => context,
      ports,
    });

    await expect(
      handlers.createAccount({
        commandId: "account-create-3",
        name: "Conta",
        type: "CHECKING",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "ACCOUNT_NAME_CONFLICT",
        message: "Já existe uma conta com este nome.",
        field: "name",
      },
    });
  });

  it("reports unexpected use-case failures with technical context and rethrows", async () => {
    const expectedError = new Error("database amount=1234 description=private");
    const resolveContext = vi.fn(async () => context);
    const ports = createPorts();
    ports.accounts.create = vi.fn(async () => {
      throw expectedError;
    });
    const handlers = createAccountsCategoriesActionHandlers({ resolveContext, ports });

    await expect(
      handlers.createAccount({
        commandId: "account-create-unexpected",
        name: "Conta",
        type: "CHECKING",
      }),
    ).rejects.toBe(expectedError);

    expect(captureServerException).toHaveBeenCalledWith(
      expectedError,
      expect.objectContaining({
        operation: "create",
        entityType: "account",
        useCase: "accounts.create",
      }),
    );
    const contextArgument = vi.mocked(captureServerException).mock.calls[0]?.[1];
    expect(JSON.stringify(contextArgument)).not.toContain("1234");
    expect(JSON.stringify(contextArgument)).not.toContain("private");
  });
});
