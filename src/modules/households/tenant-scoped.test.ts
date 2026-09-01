import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireFinancialContextMock } = vi.hoisted(() => ({
  requireFinancialContextMock: vi.fn(),
}));

vi.mock("./context", () => ({
  requireFinancialContext: requireFinancialContextMock,
}));

import {
  FinancialContextError,
  type FinancialContext,
} from "./contracts";
import {
  assertFinancialContext,
  isFinancialContext,
  withFinancialContext,
} from "./tenant-scoped";

const context = {
  userId: "user-a",
  householdId: "household-a",
} as const;

describe("tenant-scoped boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the server context once and passes it to the operation", async () => {
    requireFinancialContextMock.mockResolvedValue(context);
    const operation = vi.fn(async (resolvedContext: FinancialContext) =>
      resolvedContext.householdId,
    );
    const options = { requestedHouseholdId: context.householdId };

    await expect(withFinancialContext(operation, options)).resolves.toBe(
      context.householdId,
    );
    expect(requireFinancialContextMock).toHaveBeenCalledOnce();
    expect(requireFinancialContextMock).toHaveBeenCalledWith(options);
    expect(operation).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledWith(context);
  });

  it("does not invoke the private operation when authentication fails", async () => {
    const error = new FinancialContextError("UNAUTHENTICATED");
    requireFinancialContextMock.mockRejectedValue(error);
    const operation = vi.fn(async () => "must not run");

    await expect(withFinancialContext(operation)).rejects.toBe(error);
    expect(operation).not.toHaveBeenCalled();
  });

  it("rejects malformed resolver output before it can reach a query", async () => {
    requireFinancialContextMock.mockResolvedValue({
      userId: "user-a",
      householdId: " household-a ",
    });
    const operation = vi.fn(async () => "must not run");

    await expect(withFinancialContext(operation)).rejects.toMatchObject({
      code: "INVALID_FINANCIAL_CONTEXT",
      status: 500,
      expected: true,
    });
    expect(operation).not.toHaveBeenCalled();
  });

  it("accepts only non-empty, canonical context IDs", () => {
    expect(isFinancialContext(context)).toBe(true);
    expect(isFinancialContext({ userId: "", householdId: "household-a" })).toBe(
      false,
    );
    expect(
      isFinancialContext({ userId: "user-a", householdId: " household-a" }),
    ).toBe(false);

    expect(() =>
      assertFinancialContext({ userId: "user-a", householdId: "" }),
    ).toThrowError(FinancialContextError);
  });
});
