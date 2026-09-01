import { describe, expect, it } from "vitest";

import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  CATEGORY_STATUSES,
  CATEGORY_KINDS,
  LIQUIDITIES,
  SPENDABILITIES,
  S02DomainError,
  type S02Result,
} from "./contracts";
import {
  applyAccountDefaults,
  accountStatusSchema,
  assertAccountCanArchive,
  assertCategoryCanArchive,
  assertCategoryParent,
  assertCategoryReparenting,
  assertCategoryUpdateInvariants,
  archiveAccountStatus,
  archiveCategoryStatus,
  categoryKindSchema,
  categoryParentResult,
  categoryReparentingResult,
  createAccountCommandSchema,
  createAccountFormSchema,
  createAccountServerActionSchema,
  isAccountStatus,
  isAccountType,
  isCategoryKind,
  isCategoryReparenting,
  isLiquidity,
  isSpendability,
  listCategoriesQuerySchema,
  normalizeAccountName,
  normalizeCategoryName,
  parseCreateAccountCommand,
  parseCreateCategoryCommand,
  parseListQuery,
  parseUpdateAccountCommand,
  parseUpdateCategoryCommand,
  normalizeName,
  safeParseS02Command,
  toS02Error,
} from "./validation";

const rootId = "018f47b7-6c3a-7abc-8def-1234567890ab";
const childId = "018f47b7-6c3a-7abc-8def-1234567890ac";
const grandparentId = "018f47b7-6c3a-7abc-8def-1234567890ad";

const activeRoot = {
  id: rootId,
  householdId: "household-a",
  kind: "EXPENSE" as const,
  status: "ACTIVE" as const,
  parentId: null,
};

function expectDomainCode(
  run: () => unknown,
  code: string,
  field?: string,
): void {
  expect(run).toThrowError(S02DomainError);

  try {
    run();
  } catch (error) {
    const mapped = toS02Error(error);
    expect(mapped.code).toBe(code);
    if (field !== undefined) {
      expect(mapped.field).toBe(field);
    }
  }
}

function expectFailedResult(
  result: S02Result<unknown>,
  code: string,
  field?: string,
): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
    if (field !== undefined) {
      expect(result.error.field).toBe(field);
    }
  }
}

describe("S02 boundary normalization and schemas", () => {
  it("normalizes NFKC, edge whitespace and internal whitespace without changing case", () => {
    expect(normalizeName("  Ｃafé\u00a0\u00a0da\u2003Manhã  ")).toBe(
      "Café da Manhã",
    );
  });

  it("counts Unicode code points and rejects controls", () => {
    expect(() => normalizeName("\u0007valid")).toThrowError(
      S02DomainError,
    );
    expect(() => normalizeName("😀".repeat(121))).toThrowError(
      S02DomainError,
    );
    expect(() => normalizeName(" \n ")).toThrowError(S02DomainError);
  });

  it("accepts only the contract enums and applies defaults in one place", () => {
    expect(ACCOUNT_TYPES).toEqual([
      "CHECKING",
      "SAVINGS",
      "CASH",
      "CREDIT_CARD",
      "BENEFIT",
      "INVESTMENT",
      "OTHER",
    ]);
    expect(CATEGORY_KINDS).toEqual(["EXPENSE", "INCOME"]);

    const command = parseCreateAccountCommand({
      commandId: " create-1 ",
      name: "  Carteira  ",
      type: "CASH",
    });
    expect(applyAccountDefaults(command)).toMatchObject({
      commandId: "create-1",
      name: "Carteira",
      type: "CASH",
      spendability: "GENERAL",
      liquidity: "IMMEDIATE",
      includeInNetWorth: true,
    });
  });

  it("shares one strict schema between form, server action and HTTP boundaries", () => {
    expect(createAccountFormSchema).toBe(createAccountServerActionSchema);
    expect(createAccountCommandSchema.safeParse({
      commandId: "create-1",
      name: "Conta",
      type: "CHECKING",
      householdId: "forged",
    }).success).toBe(false);
  });

  it("rejects empty updates and persisted immutable fields", () => {
    expect(() => parseUpdateAccountCommand({
      commandId: "update-1",
      accountId: rootId,
    })).toThrowError(S02DomainError);

    try {
      parseUpdateAccountCommand({
        commandId: "update-1",
        accountId: rootId,
        status: "ARCHIVED",
      });
      throw new Error("expected immutable field rejection");
    } catch (error) {
      expect(toS02Error(error).code).toBe("INVALID_COMMAND");
    }
  });

  it("defaults list queries to ACTIVE and rejects unknown statuses", () => {
    expect(parseListQuery({})).toEqual({ status: "ACTIVE" });
    try {
      parseListQuery({ status: "DELETED" });
      throw new Error("expected status rejection");
    } catch (error) {
      expect(toS02Error(error).code).toBe("INVALID_STATUS_FILTER");
    }
  });
});

describe("S02 account domain rules", () => {
  const validCreate = {
    commandId: "account-create-1",
    name: "Conta principal",
    type: "CHECKING" as const,
  };

  it.each(ACCOUNT_TYPES)("accepts the account type %s", (type) => {
    expect(
      parseCreateAccountCommand({ ...validCreate, type }),
    ).toMatchObject({ type });
  });

  it.each([
    ["name omitted", { commandId: validCreate.commandId, type: validCreate.type }],
    ["name undefined", { name: undefined }],
    ["name null", { name: null }],
    ["name empty", { name: "" }],
    ["name whitespace only", { name: " \t " }],
    ["name with a control", { name: "Conta\u0000" }],
  ])("rejects an account with %s", (_label, name) => {
    expectDomainCode(
      () =>
        parseCreateAccountCommand(
          _label === "name omitted" ? name : { ...validCreate, ...name },
        ),
      "INVALID_NAME",
      "name",
    );
  });

  it.each([
    ["type omitted", undefined],
    ["type null", null],
    ["type empty", ""],
    ["type unsupported", "DEBIT"],
  ])("rejects an account with %s", (_label, type) => {
    expectDomainCode(
      () => parseCreateAccountCommand({ ...validCreate, type }),
      "INVALID_ACCOUNT_TYPE",
      "type",
    );
  });

  it.each([
    ["spendability", "INVALID_SPENDABILITY"],
    ["liquidity", "INVALID_LIQUIDITY"],
  ])("maps an invalid account %s to its stable error code", (field, code) => {
    expectDomainCode(
      () =>
        parseCreateAccountCommand({
          ...validCreate,
          [field]: "UNKNOWN",
        }),
      code,
      field,
    );
  });

  it("preserves explicitly supplied account metadata while applying only omitted defaults", () => {
    const command = parseCreateAccountCommand({
      ...validCreate,
      spendability: "RESTRICTED",
      liquidity: "LIQUID",
      includeInNetWorth: false,
    });

    expect(applyAccountDefaults(command)).toMatchObject({
      spendability: "RESTRICTED",
      liquidity: "LIQUID",
      includeInNetWorth: false,
    });
  });

  it.each(ACCOUNT_STATUSES)("accepts account status %s", (status) => {
    expect(accountStatusSchema.safeParse(status).success).toBe(true);
    expect(isAccountStatus(status)).toBe(true);
  });

  it("rejects unknown account statuses and does not silently reactivate archived accounts", () => {
    expect(accountStatusSchema.safeParse("DELETED").success).toBe(false);
    expect(isAccountStatus("DELETED")).toBe(false);
    expectDomainCode(
      () => assertAccountCanArchive("ARCHIVED"),
      "RESOURCE_ARCHIVED",
    );
  });

  it("transitions an active account to ARCHIVED without a destructive operation", () => {
    expect(assertAccountCanArchive("ACTIVE")).toBeUndefined();
    expect(archiveAccountStatus("ACTIVE")).toBe("ARCHIVED");
  });

  it.each([
    "id",
    "householdId",
    "type",
    "status",
    "trackingStartedOn",
    "createdAt",
    "updatedAt",
    "balance",
  ])("rejects persisted immutable account field %s in an update", (field) => {
    expectDomainCode(
      () =>
        parseUpdateAccountCommand({
          commandId: "account-update-immutable",
          accountId: rootId,
          name: "Nome editado",
          [field]: field === "status" ? "ARCHIVED" : "forged",
        }),
      "INVALID_COMMAND",
    );
  });

  it("allows each account update field and normalizes an updated name", () => {
    expect(
      parseUpdateAccountCommand({
        commandId: " account-update-1 ",
        accountId: rootId,
        name: "  Conta   editada ",
        spendability: "EXCLUDED",
        liquidity: "RESTRICTED",
        includeInNetWorth: false,
      }),
    ).toEqual({
      commandId: "account-update-1",
      accountId: rootId,
      name: "Conta editada",
      spendability: "EXCLUDED",
      liquidity: "RESTRICTED",
      includeInNetWorth: false,
    });
  });

  it("validates command IDs as trimmed, non-empty, bounded operation keys", () => {
    expect(
      parseCreateAccountCommand({
        ...validCreate,
        commandId: "  retryable-operation  ",
      }).commandId,
    ).toBe("retryable-operation");
    expectDomainCode(
      () => parseCreateAccountCommand({ ...validCreate, commandId: " \t " }),
      "INVALID_COMMAND_ID",
      "commandId",
    );
    expectDomainCode(
      () =>
        parseCreateAccountCommand({
          ...validCreate,
          commandId: "x".repeat(129),
        }),
      "INVALID_COMMAND_ID",
      "commandId",
    );
  });
});

describe("S02 category invariants", () => {
  const validCreate = {
    commandId: "category-create-1",
    name: "Alimentação",
    kind: "EXPENSE" as const,
  };

  it.each(CATEGORY_KINDS)("accepts category kind %s", (kind) => {
    expect(categoryKindSchema.safeParse(kind).success).toBe(true);
    expect(isCategoryKind(kind)).toBe(true);
    expect(
      parseCreateCategoryCommand({ ...validCreate, kind }),
    ).toMatchObject({ kind });
  });

  it.each([
    ["name omitted", { commandId: validCreate.commandId, kind: validCreate.kind }],
    ["name undefined", { name: undefined }],
    ["name null", { name: null }],
    ["name empty", { name: "" }],
    ["name whitespace only", { name: "  " }],
    ["name with a control", { name: "Lazer\u0007" }],
  ])("rejects a category with %s", (_label, name) => {
    expectDomainCode(
      () =>
        parseCreateCategoryCommand(
          _label === "name omitted" ? name : { ...validCreate, ...name },
        ),
      "INVALID_NAME",
      "name",
    );
  });

  it.each([
    ["kind omitted", undefined],
    ["kind null", null],
    ["kind empty", ""],
    ["kind unsupported", "TRANSFER"],
  ])("rejects a category with %s", (_label, kind) => {
    expectDomainCode(
      () => parseCreateCategoryCommand({ ...validCreate, kind }),
      "INVALID_CATEGORY_KIND",
      "kind",
    );
  });

  it("accepts both omitted and explicit null parents for root categories", () => {
    expect(parseCreateCategoryCommand(validCreate).parentId).toBeUndefined();
    expect(
      parseCreateCategoryCommand({ ...validCreate, parentId: null }).parentId,
    ).toBeNull();
    expect(
      listCategoriesQuerySchema.safeParse({ status: "ACTIVE" }).success,
    ).toBe(true);
  });

  it("accepts a valid UUIDv7 parent at the command boundary", () => {
    expect(
      parseCreateCategoryCommand({ ...validCreate, parentId: rootId }),
    ).toMatchObject({ parentId: rootId });
  });

  it("rejects malformed parent IDs with the parent field error", () => {
    expectDomainCode(
      () => parseCreateCategoryCommand({ ...validCreate, parentId: "not-an-id" }),
      "INVALID_COMMAND",
      "parentId",
    );
  });

  it("rejects immutable category fields and empty updates", () => {
    expectDomainCode(
      () =>
        parseUpdateCategoryCommand({
          commandId: "category-update-empty",
          categoryId: childId,
        }),
      "INVALID_COMMAND",
    );

    for (const field of [
      "id",
      "householdId",
      "kind",
      "status",
      "createdAt",
      "updatedAt",
    ]) {
      expectDomainCode(
        () =>
          parseUpdateCategoryCommand({
            commandId: "category-update-immutable",
            categoryId: childId,
            name: "Nome editado",
            [field]: field === "status" ? "ARCHIVED" : "forged",
          }),
        "INVALID_COMMAND",
      );
    }
  });

  it("accepts a same-household active root parent", () => {
    expect(() => assertCategoryParent({
      householdId: "household-a",
      kind: "EXPENSE",
      parentId: rootId,
      categoryId: childId,
      parent: activeRoot,
    })).not.toThrow();
  });

  it("accepts a null parent as the root-level hierarchy invariant", () => {
    expect(() =>
      assertCategoryParent({
        householdId: "household-a",
        kind: "EXPENSE",
        parentId: null,
        parent: null,
      }),
    ).not.toThrow();
  });

  it("maps missing and cross-household parents to the same opaque error", () => {
    for (const parent of [null, { ...activeRoot, householdId: "household-b" }]) {
      expect(() => assertCategoryParent({
        householdId: "household-a",
        kind: "EXPENSE",
        parentId: rootId,
        categoryId: childId,
        parent,
      })).toThrowError(S02DomainError);

      try {
        assertCategoryParent({
          householdId: "household-a",
          kind: "EXPENSE",
          parentId: rootId,
          categoryId: childId,
          parent,
        });
      } catch (error) {
        expect(toS02Error(error).code).toBe("CATEGORY_PARENT_NOT_FOUND");
      }
    }
  });

  it.each([
    ["CATEGORY_SELF_PARENT", { ...activeRoot, id: childId }],
    ["CATEGORY_PARENT_ARCHIVED", { ...activeRoot, status: "ARCHIVED" as const }],
    ["CATEGORY_PARENT_KIND_MISMATCH", { ...activeRoot, kind: "INCOME" as const }],
    ["CATEGORY_MAX_DEPTH", { ...activeRoot, parentId: grandparentId }],
  ])("rejects invalid parent (%s)", (expectedCode, parent) => {
    try {
      assertCategoryParent({
        householdId: "household-a",
        kind: "EXPENSE",
        parentId: rootId,
        categoryId: childId,
        parent,
      });
      throw new Error("expected parent rejection");
    } catch (error) {
      expect(toS02Error(error).code).toBe(expectedCode);
    }
  });

  it("forbids only a changed parent when the category has usage", () => {
    expect(() => assertCategoryReparenting({
      currentParentId: rootId,
      requestedParentId: rootId,
      hasFinancialUsage: true,
    })).not.toThrow();
    expect(() => assertCategoryReparenting({
      currentParentId: null,
      requestedParentId: rootId,
      hasFinancialUsage: true,
    })).toThrowError(S02DomainError);
  });

  it("keeps an explicit root request idempotent for an already-root used category", () => {
    expect(() =>
      assertCategoryReparenting({
        currentParentId: null,
        requestedParentId: null,
        hasFinancialUsage: true,
      }),
    ).not.toThrow();
    expect(isCategoryReparenting(null, null)).toBe(false);
    expect(isCategoryReparenting(rootId, ` ${rootId} `)).toBe(false);
  });

  it.each([
    ["hasFinancialUsage", { hasFinancialUsage: true }],
    ["isUsed alias", { isUsed: true }],
    ["used alias", { used: true }],
  ])("blocks used-category reparenting through the %s flag", (_label, usage) => {
    expectDomainCode(
      () =>
        assertCategoryReparenting({
          currentParentId: null,
          requestedParentId: rootId,
          ...usage,
        }),
      "CATEGORY_REPARENTING_FORBIDDEN",
      "parentId",
    );
  });

  it("returns stable result envelopes for parent and reparenting failures", () => {
    expectFailedResult(
      categoryParentResult({
        householdId: "household-a",
        kind: "EXPENSE",
        parentId: rootId,
        categoryId: childId,
        parent: null,
      }),
      "CATEGORY_PARENT_NOT_FOUND",
      "parentId",
    );
    expectFailedResult(
      categoryReparentingResult({
        currentParentId: null,
        requestedParentId: rootId,
        used: true,
      }),
      "CATEGORY_REPARENTING_FORBIDDEN",
      "parentId",
    );
  });

  it("combines current state, parent hierarchy and usage rules without persistence", () => {
    const currentCategory = {
      id: childId,
      householdId: "household-a",
      kind: "EXPENSE" as const,
      status: "ACTIVE" as const,
      parentId: rootId,
    };

    expect(
      assertCategoryUpdateInvariants({
        command: {
          commandId: "category-rename-used",
          categoryId: childId,
          name: "  Alimentação   fora  ",
        },
        householdId: "household-a",
        currentCategory,
        hasFinancialUsage: true,
      }),
    ).toMatchObject({ name: "Alimentação fora" });

    expectDomainCode(
      () =>
        assertCategoryUpdateInvariants({
          command: {
            commandId: "category-reparent-used",
            categoryId: childId,
            parentId: null,
          },
          householdId: "household-a",
          currentCategory,
          hasFinancialUsage: true,
        }),
      "CATEGORY_REPARENTING_FORBIDDEN",
      "parentId",
    );
  });

  it("archives explicitly and protects active children/history", () => {
    expect(() => assertCategoryCanArchive({
      status: "ACTIVE",
      activeChildCount: 0,
    })).not.toThrow();
    expect(() => assertCategoryCanArchive({
      status: "ACTIVE",
      hasActiveChildren: true,
    })).toThrowError(S02DomainError);
    expectDomainCode(
      () => assertCategoryCanArchive({ status: "ARCHIVED" }),
      "RESOURCE_ARCHIVED",
    );
    expect(archiveCategoryStatus({ status: "ACTIVE", activeChildCount: 0 })).toBe(
      "ARCHIVED",
    );
    expectDomainCode(
      () => archiveCategoryStatus({ status: "ACTIVE", activeChildCount: 1 }),
      "CATEGORY_HAS_ACTIVE_CHILDREN",
    );
  });
});

describe("S02 shared domain contracts", () => {
  it("keeps account and category name boundaries on the same normalizer", () => {
    const raw = "  Ｃaixa\u00a0\u00a0de\u2003emergência  ";
    const normalized = "Caixa de emergência";

    expect(normalizeName(raw)).toBe(normalized);
    expect(normalizeAccountName(raw)).toBe(normalized);
    expect(normalizeCategoryName(raw)).toBe(normalized);
  });

  it("exposes exhaustive type guards for every domain enum", () => {
    for (const type of ACCOUNT_TYPES) {
      expect(isAccountType(type)).toBe(true);
    }
    for (const kind of CATEGORY_KINDS) {
      expect(isCategoryKind(kind)).toBe(true);
    }
    for (const status of ACCOUNT_STATUSES) {
      expect(isAccountStatus(status)).toBe(true);
    }
    for (const spendability of SPENDABILITIES) {
      expect(isSpendability(spendability)).toBe(true);
    }
    for (const liquidity of LIQUIDITIES) {
      expect(isLiquidity(liquidity)).toBe(true);
    }

    const invalidValues: unknown[] = [undefined, null, "", "UNKNOWN", 1];
    for (const value of invalidValues) {
      expect(isAccountType(value)).toBe(false);
      expect(isCategoryKind(value)).toBe(false);
      expect(isAccountStatus(value)).toBe(false);
      expect(isSpendability(value)).toBe(false);
      expect(isLiquidity(value)).toBe(false);
    }
  });

  it("uses one status vocabulary for accounts and categories", () => {
    expect(CATEGORY_STATUSES).toEqual(ACCOUNT_STATUSES);
    expect(CATEGORY_STATUSES).toEqual(["ACTIVE", "ARCHIVED"]);
  });

  it("returns typed, stable failures from safe command parsing", () => {
    const result = safeParseS02Command(createAccountCommandSchema, {
      commandId: "account-create-invalid",
      name: "",
      type: "CHECKING",
    });

    expectFailedResult(result, "INVALID_NAME", "name");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBeTruthy();
      expect(result.error).not.toHaveProperty("database");
    }
  });

  it("preserves the domain error type while mapping to a serializable contract", () => {
    const domainError = new S02DomainError("INVALID_NAME", "name");

    expect(toS02Error(domainError)).toEqual({
      code: "INVALID_NAME",
      message: domainError.message,
      field: "name",
    });
    expect(toS02Error(new Error("driver detail"), "INVALID_STATUS_FILTER").code).toBe(
      "INVALID_STATUS_FILTER",
    );
  });

  it("is deterministic for a retried command before any persistence boundary", () => {
    const input = {
      commandId: " retryable-command ",
      name: "  Conta   compartilhada ",
      type: "OTHER" as const,
    };

    expect(parseCreateAccountCommand(input)).toEqual(
      parseCreateAccountCommand(input),
    );
    expect(safeParseS02Command(createAccountCommandSchema, input)).toEqual(
      safeParseS02Command(createAccountCommandSchema, input),
    );
  });
});
