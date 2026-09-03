import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSpendable: vi.fn(),
  createBudgetReserveAdapter: vi.fn(),
}));

vi.mock("@/modules/spendable/service", () => ({
  getSpendable: mocks.readSpendable,
}));
vi.mock("@/modules/budgets/reserve-source", () => ({
  createBudgetReserveAdapter: mocks.createBudgetReserveAdapter,
}));

import { getSpendableAction } from "./spendable";

describe("S08 production spendable action composition", () => {
  it("passes a server-composed S09 reserve factory without exposing tenancy to the port", async () => {
    const reserveAdapter = {
      contractVersion: "s09.v1" as const,
      getReserve: vi.fn(),
    };
    const result = { ok: true as const, value: { marker: "breakdown" } };
    mocks.createBudgetReserveAdapter.mockReturnValue(reserveAdapter);
    mocks.readSpendable.mockResolvedValue(result);

    const input = {
      asOf: "2026-09-02",
      scenario: "CONSERVATIVE" as const,
      horizon: { days: 1 },
    };
    await expect(getSpendableAction(input)).resolves.toBe(result);

    expect(mocks.readSpendable).toHaveBeenCalledWith(
      input,
      { reserveAdapterFactory: expect.any(Function) },
    );
    const dependencies = mocks.readSpendable.mock.calls[0]?.[1] as {
      reserveAdapterFactory: (context: { userId: string; householdId: string }) => unknown;
    };
    expect(dependencies.reserveAdapterFactory({
      userId: "server-user",
      householdId: "server-household",
    })).toBe(reserveAdapter);
    expect(mocks.createBudgetReserveAdapter).toHaveBeenCalledWith({
      userId: "server-user",
      householdId: "server-household",
    });
  });
});
