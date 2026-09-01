import {
  HOUSEHOLD_INVITE_ERROR_CODES,
  HOUSEHOLD_INVITE_ERROR_MESSAGES,
  HOUSEHOLD_INVITE_ACCEPT_API_PATH,
  HOUSEHOLD_INVITES_API_PATH,
  type AcceptHouseholdInviteHttpResponse,
  type CreateHouseholdInviteHttpResponse,
  type HouseholdInviteErrorCode,
} from "./contracts";

/**
 * Safe browser-side error for the invite endpoints. The server's response
 * message is deliberately ignored: only the allow-listed code is allowed to
 * reach a component, so provider/driver details cannot leak into the UI.
 */
export class HouseholdInviteClientError extends Error {
  readonly code: HouseholdInviteErrorCode;

  constructor(code: HouseholdInviteErrorCode) {
    super(HOUSEHOLD_INVITE_ERROR_MESSAGES[code]);
    this.name = "HouseholdInviteClientError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHouseholdInviteErrorCode(
  value: unknown,
): value is HouseholdInviteErrorCode {
  return (
    typeof value === "string" &&
    HOUSEHOLD_INVITE_ERROR_CODES.includes(value as HouseholdInviteErrorCode)
  );
}

function codeFromPayload(value: unknown): HouseholdInviteErrorCode | null {
  if (!isRecord(value) || !isRecord(value.error)) {
    return null;
  }

  const code = value.error.code;
  return isHouseholdInviteErrorCode(code) ? code : null;
}

function codeFromStatus(
  status: number,
  operation: "create" | "accept",
): HouseholdInviteErrorCode | null {
  if (status === 401) {
    return "UNAUTHENTICATED";
  }

  if (status === 403) {
    return "HOUSEHOLD_MEMBERSHIP_REQUIRED";
  }

  if (status === 409) {
    return "HOUSEHOLD_SELECTION_REQUIRED";
  }

  if (status === 400) {
    return "INVITE_INPUT_INVALID";
  }

  if (operation === "accept" && status === 404) {
    return "INVITATION_INVALID";
  }

  // A 410 response is intentionally not classified without the allow-listed
  // server code: expired and already-used links have different copy, and the
  // backend is the only authority that can distinguish them.
  return null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readCreatedInvite(
  value: unknown,
): CreateHouseholdInviteHttpResponse {
  const invite = isRecord(value) ? value.invite : null;

  if (
    !isRecord(invite) ||
    typeof invite.id !== "string" ||
    typeof invite.householdId !== "string" ||
    typeof invite.expiresAt !== "string" ||
    typeof invite.inviteUrl !== "string" ||
    !invite.id.trim() ||
    !invite.householdId.trim() ||
    !invite.expiresAt.trim() ||
    !invite.inviteUrl.trim()
  ) {
    throw new HouseholdInviteClientError("INVITE_CREATION_FAILED");
  }

  return {
    invite: {
      id: invite.id,
      householdId: invite.householdId,
      expiresAt: invite.expiresAt,
      inviteUrl: invite.inviteUrl,
    },
  };
}

function readAcceptedInvite(
  value: unknown,
): AcceptHouseholdInviteHttpResponse {
  const response = isRecord(value) ? value : null;
  const household = response?.household;

  if (
    !response ||
    response.accepted !== true ||
    typeof response.householdId !== "string" ||
    !response.householdId.trim() ||
    !isRecord(household) ||
    typeof household.id !== "string" ||
    typeof household.name !== "string" ||
    !household.id.trim() ||
    !household.name.trim() ||
    typeof response.membershipCreated !== "boolean"
  ) {
    throw new HouseholdInviteClientError("PROVISIONING_FAILED");
  }

  return {
    accepted: true,
    householdId: response.householdId,
    household: {
      id: household.id,
      name: household.name,
    },
    membershipCreated: response.membershipCreated,
  };
}

async function request<T>(
  path: string,
  body: Record<string, unknown>,
  fallback: HouseholdInviteErrorCode,
  operation: "create" | "accept",
  parse: (value: unknown) => T,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(body),
    });
  } catch {
    throw new HouseholdInviteClientError(fallback);
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const code =
      codeFromPayload(payload) ??
      codeFromStatus(response.status, operation) ??
      fallback;
    throw new HouseholdInviteClientError(code);
  }

  try {
    return parse(payload);
  } catch (error) {
    if (error instanceof HouseholdInviteClientError) {
      throw error;
    }

    throw new HouseholdInviteClientError(fallback);
  }
}

export function createHouseholdInviteRequest(): Promise<CreateHouseholdInviteHttpResponse> {
  return request(
    HOUSEHOLD_INVITES_API_PATH,
    {},
    "INVITE_CREATION_FAILED",
    "create",
    readCreatedInvite,
  );
}

export function acceptHouseholdInviteRequest(
  token: string,
): Promise<AcceptHouseholdInviteHttpResponse> {
  return request(
    HOUSEHOLD_INVITE_ACCEPT_API_PATH,
    { token },
    "PROVISIONING_FAILED",
    "accept",
    readAcceptedInvite,
  );
}
