import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireFinancialContextMock } = vi.hoisted(() => ({
  requireFinancialContextMock: vi.fn(),
}));

vi.mock("@/modules/households/context", () => ({
  requireFinancialContext: requireFinancialContextMock,
}));

import type { Database } from "@/db";
import type { AccountRecord } from "@/db/accounts-categories-schema";

import {
  createTransactionReferenceAccess,
  findAccountForContext,
} from "./references";

const context = {
  userId: "00000000-0000-7000-8000-000000047101",
  householdId: "00000000-0000-7000-8000-000000047201",
} as const;
const accountId = "00000000-0000-7000-8000-000000047301";

function fakeDatabase(rows: unknown[] = []): Database {
  const query = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };

  return {
    select: vi.fn().mockReturnValue(query),
  } as unknown as Database;
}

describe("S03 tenant-scoped reference access", () => {
  beforeEach(() => {
    requireFinancialContextMock.mockReset();
    requireFinancialContextMock.mockResolvedValue(context);
  });

  it("resolves the authenticated context even when the optional category is null", async () => {
    const database = fakeDatabase();
    const access = createTransactionReferenceAccess(database);

    await expect(access.findCategoryById(null)).resolves.toBeNull();
    expect(requireFinancialContextMock).toHaveBeenCalledOnce();
    expect(database.select).not.toHaveBeenCalled();
  });

  it("maps an absent ID to an opaque null/not-found result", async () => {
    const database = fakeDatabase();
    const access = createTransactionReferenceAccess(database);

    await expect(access.findAccountById(accountId)).resolves.toBeNull();
    await expect(access.getAccountById(accountId)).rejects.toMatchObject({
      code: "ACCOUNT_NOT_FOUND",
      status: 404,
    });
    expect(requireFinancialContextMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed context before building a tenant query", async () => {
    const database = fakeDatabase();

    await expect(
      findAccountForContext(database, {
        userId: "",
        householdId: context.householdId,
      }, accountId),
    ).rejects.toMatchObject({ code: "INVALID_FINANCIAL_CONTEXT" });
    expect(database.select).not.toHaveBeenCalled();
  });

  it("returns a row only through the server-resolved tenant predicate", async () => {
    const account = {
      id: accountId,
      householdId: context.householdId,
      name: "Checking",
      type: "CHECKING",
      status: "ACTIVE",
      spendability: "GENERAL",
      liquidity: "IMMEDIATE",
      includeInNetWorth: true,
      trackingStartedOn: null,
      createdAt: new Date("2026-08-29T00:00:00.000Z"),
      updatedAt: new Date("2026-08-29T00:00:00.000Z"),
    } satisfies AccountRecord;
    const database = fakeDatabase([account]);
    const access = createTransactionReferenceAccess(database);

    await expect(access.findAccountById(accountId)).resolves.toMatchObject({
      id: accountId,
      householdId: context.householdId,
    });
    expect(database.select).toHaveBeenCalledOnce();
  });
});

