import {
  auth as serverAuth,
  createAuth,
  AuthGuardError,
  AUTH_GUARD_ERROR_CODES,
  AUTH_GUARD_ERROR_MESSAGES,
  getAuthenticatedUser,
  getAuth,
  getAuthSession,
  getAuthRouteHandlers,
  getCurrentUser,
  getServerAuthSession,
  getServerSession,
  getServerUser,
  requireAuth,
  resetAuthInstance,
  toServerAuthSession,
  toLocalUserIdentity,
} from "@/modules/auth/server";

// Keep a direct `auth` export for Better Auth CLI discovery while preserving
// lazy runtime initialization in the underlying server module.
export const auth = serverAuth;

export default auth;

export {
  AuthGuardError,
  AUTH_GUARD_ERROR_CODES,
  AUTH_GUARD_ERROR_MESSAGES,
  createAuth,
  getAuthenticatedUser,
  getAuth,
  getAuthSession,
  getAuthRouteHandlers,
  getCurrentUser,
  getServerAuthSession,
  getServerSession,
  getServerUser,
  requireAuth,
  resetAuthInstance,
  toServerAuthSession,
  toLocalUserIdentity,
};

export type {
  AuthGuardErrorCode,
  BetterAuthInstance,
  BetterAuthSessionResult,
  LocalUserIdentity,
  ServerAuthSession,
} from "@/modules/auth/server";
