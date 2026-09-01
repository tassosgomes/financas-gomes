import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAuthMock, provisionFirstAccessMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  provisionFirstAccessMock: vi.fn(),
}));

vi.mock("@/modules/auth/server", () => ({
  AuthGuardError: class AuthGuardError extends Error {
    readonly code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  requireAuth: requireAuthMock,
}));

vi.mock("./server", () => ({
  HouseholdProvisioningError: class HouseholdProvisioningError extends Error {
    readonly code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  provisionFirstAccess: provisionFirstAccessMock,
}));

import {
  requireFinancialContext,
  toFinancialContext,
} from "./context";
import { FinancialContextError } from "./contracts";
import { AuthGuardError } from "@/modules/auth/server";

const authenticated = {
  id: "session-id",
  userId: "user-id",
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  user: {
    id: "user-id",
    email: "person@example.test",
    name: "Person",
    image: null,
  },
};

const provisioned = {
  user: authenticated.user,
  household: {
    id: "household-id",
    name: "Espaço financeiro",
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
    updatedAt: new Date("2026-08-29T00:00:00.000Z"),
  },
  membership: {
    householdId: "household-id",
    userId: "user-id",
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
  },
  context: { userId: "user-id", householdId: "household-id" },
  created: { user: false, household: false, membership: false },
  invitationAccepted: false,
};

describe("requireFinancialContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue(authenticated);
    provisionFirstAccessMock.mockResolvedValue(provisioned);
  });

  it("returns only the authenticated, persisted financial context", async () => {
    await expect(requireFinancialContext()).resolves.toEqual({
      userId: "user-id",
      householdId: "household-id",
    });
    expect(provisionFirstAccessMock).toHaveBeenCalledWith({
      user: authenticated.user,
      requestedHouseholdId: undefined,
    });
  });

  it("maps an unauthenticated request to a stable context error", async () => {
    requireAuthMock.mockRejectedValueOnce(new AuthGuardError("UNAUTHENTICATED"));

    await expect(requireFinancialContext()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
      expected: true,
    });
    expect(provisionFirstAccessMock).not.toHaveBeenCalled();
  });

  it("does not let a forged household selection cross the membership guard", async () => {
    provisionFirstAccessMock.mockRejectedValueOnce({
      code: "HOUSEHOLD_MEMBERSHIP_REQUIRED",
    });

    await expect(
      requireFinancialContext({
        requestedHouseholdId: "forged-household-id",
      }),
    ).rejects.toMatchObject({
      code: "HOUSEHOLD_MEMBERSHIP_REQUIRED",
      status: 403,
    });
    expect(provisionFirstAccessMock).toHaveBeenCalledWith({
      user: authenticated.user,
      requestedHouseholdId: "forged-household-id",
    });
  });

  it("maps an ambiguous multi-membership selection to the expected context error", async () => {
    provisionFirstAccessMock.mockRejectedValueOnce({
      code: "HOUSEHOLD_SELECTION_REQUIRED",
    });

    await expect(requireFinancialContext()).rejects.toMatchObject({
      code: "HOUSEHOLD_SELECTION_REQUIRED",
      status: 403,
      expected: true,
    });
  });

  it("rejects malformed household selection hints before resolving a tenant", async () => {
    await expect(
      requireFinancialContext({ requestedHouseholdId: 42 as never }),
    ).rejects.toMatchObject({
      code: "INVALID_FINANCIAL_CONTEXT",
      status: 500,
      expected: true,
    });
    expect(requireAuthMock).not.toHaveBeenCalled();
    expect(provisionFirstAccessMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed provisioning result instead of returning client data", async () => {
    expect(() =>
      toFinancialContext({
        ...provisioned,
        context: { userId: "user-id", householdId: "forged-household-id" },
      }),
    ).toThrowError(FinancialContextError);
  });

  it("rejects a provisioning result whose user record disagrees with context", async () => {
    expect(() =>
      toFinancialContext({
        ...provisioned,
        user: {
          ...provisioned.user,
          id: "forged-user-id",
        },
      }),
    ).toThrowError(FinancialContextError);
  });
});
