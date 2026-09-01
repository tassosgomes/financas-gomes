/** The V1 deliberately has one authentication provider and no local password flow. */
export const SUPPORTED_AUTH_PROVIDERS = ["google"] as const;

export type SupportedAuthProvider = (typeof SUPPORTED_AUTH_PROVIDERS)[number];

export const AUTH_SESSION_MAX_AGE_DAYS = 30;
export const AUTH_SESSION_MAX_AGE_SECONDS =
  AUTH_SESSION_MAX_AGE_DAYS * 24 * 60 * 60;

/** Public route contract shared by the server handler and the browser client. */
export const AUTH_API_BASE_PATH = "/api/auth" as const;
export const AUTH_GOOGLE_CALLBACK_PATH =
  `${AUTH_API_BASE_PATH}/callback/google` as const;

export const AUTH_CLIENT_STATUSES = [
  "loading",
  "authenticated",
  "unauthenticated",
  "error",
] as const;

export type AuthClientStatus = (typeof AUTH_CLIENT_STATUSES)[number];

export const AUTH_ERROR_CODES = [
  "AUTH_CONFIGURATION_ERROR",
  "AUTH_CALLBACK_ERROR",
  "AUTH_SESSION_EXPIRED",
  "AUTH_REQUEST_FAILED",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  AUTH_CONFIGURATION_ERROR:
    "A autenticação está temporariamente indisponível. Tente novamente mais tarde.",
  AUTH_CALLBACK_ERROR:
    "Não foi possível concluir o login com o Google. Tente novamente.",
  AUTH_SESSION_EXPIRED:
    "Sua sessão expirou. Entre novamente para continuar.",
  AUTH_REQUEST_FAILED:
    "Não foi possível concluir a autenticação. Tente novamente em instantes.",
};

/** Safe, user-facing error shape. Never put provider details or credentials here. */
export interface AuthClientError {
  code: AuthErrorCode;
  message: string;
}

/**
 * Converts Better Auth/fetch failures to a stable, non-sensitive UI error.
 * Provider messages, response bodies and credentials are intentionally ignored.
 */
export function toAuthClientError(error: unknown): AuthClientError {
  const candidate =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  const code = AUTH_ERROR_CODES.includes(candidate as AuthErrorCode)
    ? (candidate as AuthErrorCode)
    : "AUTH_REQUEST_FAILED";

  return { code, message: AUTH_ERROR_MESSAGES[code] };
}

/** Contract consumed by the public auth UI (T10). */
export interface AuthClientViewState {
  status: AuthClientStatus;
  error: AuthClientError | null;
}

export const AUTH_CLIENT_CONTRACT = {
  provider: "google",
  apiBasePath: AUTH_API_BASE_PATH,
  googleCallbackPath: AUTH_GOOGLE_CALLBACK_PATH,
  passwordAuth: false,
  statuses: AUTH_CLIENT_STATUSES,
} as const;

export const AUTHENTICATION_CONTRACT = {
  userSource: "better-auth-user",
  provider: "google",
  passwordAuth: false,
  sessionMaxAgeDays: AUTH_SESSION_MAX_AGE_DAYS,
} as const;

/** Minimum identity shape shared across server auth and household membership code. */
export interface LocalUserIdentity {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface AuthenticatedSession {
  id: string;
  userId: string;
  expiresAt: Date;
}

/** Session shape returned by the server helper and useful to T07 guards. */
export interface ServerAuthSession extends AuthenticatedSession {
  user: LocalUserIdentity;
}
