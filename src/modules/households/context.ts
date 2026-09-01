import {
  AuthGuardError,
  requireAuth,
} from "@/modules/auth/server";
import type { ServerAuthSession } from "@/modules/auth/contracts";

import {
  HouseholdProvisioningError,
  provisionFirstAccess,
  type ProvisionFirstAccessResult,
} from "./server";
import {
  FINANCIAL_CONTEXT_ERROR_CODES,
  FinancialContextError,
  type FinancialContext,
  type FinancialContextErrorCode,
  type RequireFinancialContextOptions,
} from "./contracts";

/**
 * A context guard is intentionally a server-only boundary. It authenticates
 * through Better Auth, then consumes T06's transactional provisioning result;
 * callers receive only opaque IDs needed by tenant-scoped use cases.
 */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeRequestedHouseholdId(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new FinancialContextError("INVALID_FINANCIAL_CONTEXT");
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  // Household IDs are UUIDs today. Keep this check format-agnostic so the
  // guard remains usable with deterministic repository fixtures, while still
  // rejecting unbounded input before it reaches the provisioning use case.
  if (normalized.length > 128) {
    throw new FinancialContextError("INVALID_FINANCIAL_CONTEXT");
  }

  return normalized;
}

function isFinancialContextErrorCode(
  value: unknown,
): value is FinancialContextErrorCode {
  return (
    typeof value === "string" &&
    FINANCIAL_CONTEXT_ERROR_CODES.includes(value as FinancialContextErrorCode)
  );
}

function hasErrorCode(value: unknown): value is { code: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

function mapExpectedContextError(error: unknown): FinancialContextError | null {
  if (error instanceof FinancialContextError) {
    return error;
  }

  if (error instanceof AuthGuardError) {
    return new FinancialContextError(
      error.code === "UNAUTHENTICATED"
        ? "UNAUTHENTICATED"
        : "INVALID_FINANCIAL_CONTEXT",
    );
  }

  if (error instanceof HouseholdProvisioningError || hasErrorCode(error)) {
    const code = error.code;
    if (code === "UNAUTHENTICATED") {
      return new FinancialContextError("UNAUTHENTICATED");
    }
    if (code === "HOUSEHOLD_MEMBERSHIP_REQUIRED") {
      return new FinancialContextError("HOUSEHOLD_MEMBERSHIP_REQUIRED");
    }
    if (code === "HOUSEHOLD_SELECTION_REQUIRED") {
      return new FinancialContextError("HOUSEHOLD_SELECTION_REQUIRED");
    }
    if (
      code === "INVALID_USER" ||
      code === "PROVISIONING_FAILED" ||
      code === "INVITATION_INVALID" ||
      code === "INVITATION_EXPIRED" ||
      code === "INVITATION_ALREADY_USED" ||
      isFinancialContextErrorCode(code)
    ) {
      return new FinancialContextError(
        isFinancialContextErrorCode(code) ? code : "INVALID_FINANCIAL_CONTEXT",
      );
    }
  }

  return null;
}

/**
 * Validates the result returned by T06 before a context crosses a module
 * boundary. This prevents a malformed or stale result from becoming tenant
 * authority and deliberately strips household/user records from the return.
 */
export function toFinancialContext(
  result: ProvisionFirstAccessResult,
  expectedUserId?: string,
): FinancialContext {
  const resolvedUser = result?.user;
  const context = result?.context;
  const household = result?.household;
  const membership = result?.membership;

  if (
    !resolvedUser ||
    !isNonEmptyString(resolvedUser.id) ||
    !context ||
    !isNonEmptyString(context.userId) ||
    !isNonEmptyString(context.householdId) ||
    !household ||
    !isNonEmptyString(household.id) ||
    !membership ||
    !isNonEmptyString(membership.userId) ||
    !isNonEmptyString(membership.householdId) ||
    resolvedUser.id !== context.userId ||
    context.userId !== membership.userId ||
    context.householdId !== membership.householdId ||
    context.householdId !== household.id ||
    (expectedUserId !== undefined && context.userId !== expectedUserId)
  ) {
    throw new FinancialContextError("INVALID_FINANCIAL_CONTEXT");
  }

  return {
    userId: context.userId,
    householdId: context.householdId,
  };
}

/** Alias useful at boundaries that name the conversion explicitly. */
export const normalizeFinancialContext = toFinancialContext;

/**
 * Resolves the active household exclusively from the authenticated session
 * and persisted membership. `requestedHouseholdId` is only a server-checked
 * selection hint for users with multiple memberships; a `householdId` field
 * supplied by a browser is intentionally not part of this API.
 */
export async function requireFinancialContext(
  options: RequireFinancialContextOptions = {},
): Promise<FinancialContext> {
  const requestedHouseholdId = normalizeRequestedHouseholdId(
    options.requestedHouseholdId,
  );

  try {
    const authenticated: ServerAuthSession = await requireAuth(
      options.requestHeaders,
    );

    // T06 owns the transaction, membership revalidation and first-access
    // idempotency. Only the identity from the server auth helper enters it.
    const provisioned = await provisionFirstAccess({
      user: authenticated.user,
      requestedHouseholdId,
    });

    return toFinancialContext(provisioned, authenticated.userId);
  } catch (error) {
    const expected = mapExpectedContextError(error);
    if (expected) {
      throw expected;
    }

    // Unexpected infrastructure failures intentionally retain their original
    // error for the existing observability boundary; no request data is added.
    throw error;
  }
}

/** Explicit alias for callers that use “resolve” terminology. */
export const resolveFinancialContext = requireFinancialContext;
