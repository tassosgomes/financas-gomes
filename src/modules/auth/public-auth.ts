import { toAuthClientError } from "./contracts";

export type PublicAuthErrorKind =
  | "cancelled"
  | "callback"
  | "session-expired"
  | "request";

export interface PublicAuthError {
  kind: PublicAuthErrorKind;
  message: string;
}

const PUBLIC_AUTH_MESSAGES = {
  cancelled: "Login cancelado. Você pode tentar novamente quando quiser.",
  callback: "Não foi possível concluir o login com o Google. Tente novamente.",
  sessionExpired: "Sua sessão expirou. Entre novamente para continuar.",
  request:
    "Não foi possível concluir a autenticação. Tente novamente em instantes.",
} as const;

type ErrorLike = {
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

function getErrorLike(error: unknown): ErrorLike | null {
  return error && typeof error === "object"
    ? (error as ErrorLike)
    : null;
}

function getErrorCode(error: unknown): string | null {
  const code = getErrorLike(error)?.code;
  return typeof code === "string" ? code.trim().toLowerCase() : null;
}

function isSessionExpiredCode(code: string | null): boolean {
  return code === "auth_session_expired" || code === "session_expired";
}

function isSessionExpiredError(error: unknown): boolean {
  const candidate = getErrorLike(error);
  const status = candidate?.status ?? candidate?.statusCode;

  return (
    isSessionExpiredCode(getErrorCode(error)) ||
    status === 401 ||
    status === 419
  );
}

function isCancelledCode(code: string | null): boolean {
  return (
    code === "access_denied" ||
    code === "cancelled" ||
    code === "canceled" ||
    code === "user_cancelled" ||
    code === "user_canceled"
  );
}

function isCallbackCode(code: string | null): boolean {
  return (
    code === "auth_callback_error" ||
    code === "callback_error" ||
    code === "callback_incomplete" ||
    code === "invalid_callback" ||
    code === "oauth_callback_error" ||
    code === "state_mismatch"
  );
}

function isTemporaryCode(code: string | null): boolean {
  return (
    code === "network_error" ||
    code === "request_failed" ||
    code === "server_error" ||
    code === "temporarily_unavailable" ||
    code === "timeout"
  );
}

/**
 * Converts provider and Better Auth failures into a small, non-sensitive UI
 * vocabulary. Raw provider messages are intentionally never returned. The
 * default treats HTTP status values as a generic request failure; callers
 * reading a session can opt into `sessionError: true` for 401/419 handling.
 */
export function toPublicAuthError(
  error: unknown,
  options: { sessionError?: boolean } = {},
): PublicAuthError {
  const code = getErrorCode(error);

  if (
    isSessionExpiredCode(code) ||
    (options.sessionError === true && isSessionExpiredError(error))
  ) {
    return {
      kind: "session-expired",
      message: PUBLIC_AUTH_MESSAGES.sessionExpired,
    };
  }

  if (isCancelledCode(code)) {
    return { kind: "cancelled", message: PUBLIC_AUTH_MESSAGES.cancelled };
  }

  if (isTemporaryCode(code)) {
    return { kind: "request", message: PUBLIC_AUTH_MESSAGES.request };
  }

  if (isCallbackCode(code)) {
    return { kind: "callback", message: PUBLIC_AUTH_MESSAGES.callback };
  }

  const safeError = toAuthClientError(error);
  if (safeError.code === "AUTH_CALLBACK_ERROR") {
    return { kind: "callback", message: PUBLIC_AUTH_MESSAGES.callback };
  }

  if (safeError.code === "AUTH_SESSION_EXPIRED") {
    return {
      kind: "session-expired",
      message: PUBLIC_AUTH_MESSAGES.sessionExpired,
    };
  }

  return { kind: "request", message: PUBLIC_AUTH_MESSAGES.request };
}

export interface SearchParamsReader {
  get(name: string): string | null;
}

/**
 * Maps OAuth callback query values to safe copy. `error_description` is only
 * used as a signal; its contents must never be shown to the user.
 */
export function getPublicAuthErrorFromSearchParams(
  searchParams: SearchParamsReader,
): PublicAuthError | null {
  const rawCode = searchParams.get("error");
  const code = rawCode?.trim().toLowerCase() || null;
  const hasErrorDescription = Boolean(searchParams.get("error_description"));

  if (!code && !hasErrorDescription) {
    return null;
  }

  if (isCancelledCode(code)) {
    return { kind: "cancelled", message: PUBLIC_AUTH_MESSAGES.cancelled };
  }

  if (isSessionExpiredCode(code)) {
    return {
      kind: "session-expired",
      message: PUBLIC_AUTH_MESSAGES.sessionExpired,
    };
  }

  if (isTemporaryCode(code)) {
    return { kind: "request", message: PUBLIC_AUTH_MESSAGES.request };
  }

  if (isCallbackCode(code) || hasErrorDescription) {
    return { kind: "callback", message: PUBLIC_AUTH_MESSAGES.callback };
  }

  return { kind: "request", message: PUBLIC_AUTH_MESSAGES.request };
}
