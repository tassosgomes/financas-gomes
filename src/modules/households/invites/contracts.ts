import type { FinancialContext } from "../contracts";

/** Canonical API paths consumed by the invite UI. */
export const HOUSEHOLD_INVITES_API_PATH = "/api/invites" as const;
export const HOUSEHOLD_INVITE_ACCEPT_API_PATH =
  `${HOUSEHOLD_INVITES_API_PATH}/accept` as const;

/** The URL shown to a guest. Acceptance is always a POST operation. */
export const HOUSEHOLD_INVITE_ACCEPT_PATH = "/invite" as const;
export const HOUSEHOLD_INVITE_QUERY_PARAMETER = "token" as const;

/**
 * A week is long enough for a household member to share a link without
 * keeping an invitation alive indefinitely. Callers may override it per
 * invite, and deployments may set HOUSEHOLD_INVITE_TTL_SECONDS.
 */
export const DEFAULT_HOUSEHOLD_INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

export const HOUSEHOLD_INVITE_TOKEN_BYTES = 32;

export interface InviteExpirationOptions {
  /** Positive integer number of seconds for which a link remains valid. */
  expiresInSeconds?: number;
  /** Compatibility alias for callers that model the value as a duration. */
  expiresIn?: number;
  /** Compatibility alias used by a few server-side integrations. */
  ttlSeconds?: number;
}

export interface CreateHouseholdInviteCommand
  extends InviteExpirationOptions {
  /** Headers used to resolve the Better Auth session. */
  requestHeaders?: HeadersInit;
  /** A server-validated selection hint when the user has many memberships. */
  requestedHouseholdId?: string | null;
  /**
   * Browser input may use `householdId` as a selection hint. It is never
   * trusted directly; the implementation passes it through the guard as
   * `requestedHouseholdId` and revalidates the membership in the transaction.
   */
  householdId?: string | null;
  /** Injectable clock for deterministic expiry tests. */
  now?: Date;
  /** Origin used to build the returned link; routes pass the request origin. */
  baseUrl?: string;
}

export interface CreateHouseholdInviteForContextCommand
  extends InviteExpirationOptions {
  context: FinancialContext;
  now?: Date;
  baseUrl?: string;
}

export interface HouseholdInviteResult {
  id: string;
  householdId: string;
  expiresAt: Date;
  createdAt: Date;
  /** The bearer token exists only inside this URL response, never in storage. */
  inviteUrl: string;
}

export interface AcceptHouseholdInviteCommand {
  /** Raw bearer token supplied by the authenticated guest. */
  token: string;
  requestHeaders?: HeadersInit;
  now?: Date;
}

export interface AcceptedHouseholdInvite {
  accepted: true;
  householdId: string;
  household: {
    id: string;
    name: string;
  };
  membershipCreated: boolean;
  context: FinancialContext;
}

export const HOUSEHOLD_INVITE_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INVITATION_INVALID",
  "INVITATION_EXPIRED",
  "INVITATION_ALREADY_USED",
  "HOUSEHOLD_MEMBERSHIP_REQUIRED",
  "HOUSEHOLD_SELECTION_REQUIRED",
  "INVALID_FINANCIAL_CONTEXT",
  "INVITE_INPUT_INVALID",
  "INVITE_CREATION_FAILED",
  "PROVISIONING_FAILED",
] as const;

export type HouseholdInviteErrorCode =
  (typeof HOUSEHOLD_INVITE_ERROR_CODES)[number];

export const HOUSEHOLD_INVITE_ERROR_MESSAGES: Record<
  HouseholdInviteErrorCode,
  string
> = {
  UNAUTHENTICATED: "É necessário entrar para continuar.",
  INVITATION_INVALID: "O convite não existe ou não é válido.",
  INVITATION_EXPIRED: "O convite expirou. Solicite um novo link.",
  INVITATION_ALREADY_USED: "O convite já foi utilizado.",
  HOUSEHOLD_MEMBERSHIP_REQUIRED:
    "Você não faz parte do espaço financeiro selecionado.",
  HOUSEHOLD_SELECTION_REQUIRED:
    "Selecione um espaço financeiro para continuar.",
  INVALID_FINANCIAL_CONTEXT:
    "Não foi possível validar seu espaço financeiro. Tente novamente.",
  INVITE_INPUT_INVALID: "Os dados do convite são inválidos.",
  INVITE_CREATION_FAILED:
    "Não foi possível criar o convite. Tente novamente em instantes.",
  PROVISIONING_FAILED:
    "Não foi possível concluir o convite. Tente novamente em instantes.",
};

/** Safe, expected error raised by invite-specific input/persistence guards. */
export class HouseholdInviteError extends Error {
  readonly code: HouseholdInviteErrorCode;
  readonly expected = true;

  constructor(code: HouseholdInviteErrorCode) {
    super(HOUSEHOLD_INVITE_ERROR_MESSAGES[code]);
    this.name = "HouseholdInviteError";
    this.code = code;
  }
}

/** Wire shape returned by POST /api/invites. */
export interface CreateHouseholdInviteHttpResponse {
  invite: {
    id: string;
    householdId: string;
    expiresAt: string;
    inviteUrl: string;
  };
}

/** Wire shape returned by POST /api/invites/accept. */
export type AcceptHouseholdInviteHttpResponse = Omit<
  AcceptedHouseholdInvite,
  "context"
>;

export interface HouseholdInviteHttpError {
  error: {
    code: HouseholdInviteErrorCode;
    message: string;
  };
}
