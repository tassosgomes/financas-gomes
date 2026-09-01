import { AuthGuardError } from "@/modules/auth/server";

import { FinancialContextError } from "../contracts";
import { HouseholdProvisioningError } from "../server";
import {
  HOUSEHOLD_INVITE_ERROR_CODES,
  HOUSEHOLD_INVITE_ERROR_MESSAGES,
  HouseholdInviteError,
  type HouseholdInviteErrorCode,
  type HouseholdInviteHttpError,
} from "./contracts";

export interface HouseholdInviteHttpErrorMapping
  extends Omit<HouseholdInviteHttpError, "error"> {
  body: HouseholdInviteHttpError;
  status: number;
  expected: boolean;
}

function hasCode(value: unknown): value is { code: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

function isInviteCode(value: unknown): value is HouseholdInviteErrorCode {
  return (
    typeof value === "string" &&
    HOUSEHOLD_INVITE_ERROR_CODES.includes(value as HouseholdInviteErrorCode)
  );
}

function statusForInviteCode(code: HouseholdInviteErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "HOUSEHOLD_MEMBERSHIP_REQUIRED":
      return 403;
    case "HOUSEHOLD_SELECTION_REQUIRED":
      return 409;
    case "INVITATION_INVALID":
      // Do not reveal whether a token was ever issued.
      return 404;
    case "INVITATION_EXPIRED":
    case "INVITATION_ALREADY_USED":
      return 410;
    case "INVALID_FINANCIAL_CONTEXT":
      return 500;
    case "INVITE_INPUT_INVALID":
      return 400;
    case "INVITE_CREATION_FAILED":
    case "PROVISIONING_FAILED":
      return 503;
  }
}

function normalizeCode(
  error: unknown,
  fallback: HouseholdInviteErrorCode,
): HouseholdInviteErrorCode {
  if (
    (error instanceof AuthGuardError && error.code === "INVALID_SESSION") ||
    (hasCode(error) && error.code === "INVALID_SESSION")
  ) {
    return "UNAUTHENTICATED";
  }

  if (error instanceof FinancialContextError) {
    return error.code;
  }

  if (
    error instanceof HouseholdInviteError ||
    error instanceof HouseholdProvisioningError ||
    hasCode(error)
  ) {
    return isInviteCode(error.code) ? error.code : fallback;
  }

  return fallback;
}

/**
 * Converts expected server errors to a stable wire contract. The original
 * error message is never reflected because it may contain provider/driver
 * details; only the allow-listed Portuguese messages leave this boundary.
 */
export function mapHouseholdInviteHttpError(
  error: unknown,
  fallback: HouseholdInviteErrorCode,
): HouseholdInviteHttpErrorMapping {
  const code = normalizeCode(error, fallback);
  const known =
    error instanceof AuthGuardError ||
    error instanceof FinancialContextError ||
    error instanceof HouseholdInviteError ||
    error instanceof HouseholdProvisioningError ||
    (hasCode(error) && isInviteCode(error.code));

  return {
    status: statusForInviteCode(code),
    expected: known,
    body: {
      error: {
        code,
        message: HOUSEHOLD_INVITE_ERROR_MESSAGES[code],
      },
    },
  };
}
