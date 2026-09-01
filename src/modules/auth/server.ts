import { nextCookies, toNextJsHandler } from "better-auth/next-js";
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { User } from "better-auth";

import { getDb } from "@/db";
import {
  getServerEnv,
  isE2ETestAuthEnabled,
  type ServerEnv,
} from "@/lib/env";
import { generateUuidV7 } from "@/lib/uuidv7";

import {
  AUTH_API_BASE_PATH,
  AUTH_SESSION_MAX_AGE_SECONDS,
  type LocalUserIdentity,
  type ServerAuthSession,
} from "./contracts";
import { getAuthRuntimeConfiguration } from "./config";
import { createE2EGoogleProviderPlugin } from "./e2e-provider";
import { betterAuthSchema } from "./schema";

const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

/** The server-side Better Auth instance is created only after runtime config is valid. */
export function createAuth(env: ServerEnv = getServerEnv()) {
  const configuration = getAuthRuntimeConfiguration(env);
  const plugins = [
    nextCookies(),
    ...(isE2ETestAuthEnabled(env)
      ? [
          createE2EGoogleProviderPlugin({
            applicationBaseURL: configuration.baseURL,
            email: env.E2E_TEST_AUTH_EMAIL,
            name: env.E2E_TEST_AUTH_NAME,
          }),
        ]
      : []),
  ];

  return betterAuth({
    appName: "Finanças Gomes",
    baseURL: configuration.baseURL,
    basePath: AUTH_API_BASE_PATH,
    secret: configuration.secret,
    trustedOrigins: [new URL(configuration.baseURL).origin],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: betterAuthSchema,
    }),
    socialProviders: {
      google: {
        clientId: configuration.googleClientId,
        clientSecret: configuration.googleClientSecret,
        redirectURI: configuration.googleCallbackURL,
      },
    },
    // V1 is Google OAuth only. Enabling this would expose a local password API.
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: AUTH_SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    advanced: {
      database: {
        // One point of generation for user/session/account/verification IDs.
        generateId: () => generateUuidV7(),
        joins: false,
      },
    },
    // Enables safe cookie reads/writes from Next server actions and RSC flows.
    plugins,
    // Better Auth's default logger may print adapter/provider arguments. Auth
    // failures are surfaced through the safe HTTP contract and Sentry's
    // global sanitized boundary, so credentials never enter application logs.
    logger: { disabled: true },
  });
}

export type BetterAuthInstance = ReturnType<typeof createAuth>;

let authInstance: BetterAuthInstance | undefined;

export function getAuth(): BetterAuthInstance {
  authInstance ??= createAuth();
  return authInstance;
}

/** Test/development hook; production code should keep the singleton. */
export function resetAuthInstance(): void {
  authInstance = undefined;
}

/**
 * Compatibility facade for server callers that expect `auth.api.getSession`.
 * The proxy keeps environment/database validation lazy until a server method
 * is actually used.
 */
export const auth = new Proxy({} as BetterAuthInstance, {
  get(_target, property) {
    return Reflect.get(getAuth(), property);
  },
});

export type BetterAuthSessionResult = Awaited<
  ReturnType<BetterAuthInstance["api"]["getSession"]>
>;

export type { LocalUserIdentity, ServerAuthSession } from "./contracts";

/** Stable errors raised by the server-side authentication guard. */
export const AUTH_GUARD_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INVALID_SESSION",
] as const;

export type AuthGuardErrorCode = (typeof AUTH_GUARD_ERROR_CODES)[number];

export const AUTH_GUARD_ERROR_MESSAGES: Record<
  AuthGuardErrorCode,
  string
> = {
  UNAUTHENTICATED: "É necessário entrar para continuar.",
  INVALID_SESSION: "Sua sessão não é válida. Entre novamente para continuar.",
};

/**
 * Expected error for private routes, layouts and server actions.
 *
 * The error intentionally contains no provider/adapter details, so callers
 * can map it to a redirect or a safe HTTP response at their boundary.
 */
export class AuthGuardError extends Error {
  readonly code: AuthGuardErrorCode;
  readonly status = 401;
  readonly expected = true;

  constructor(code: AuthGuardErrorCode) {
    super(AUTH_GUARD_ERROR_MESSAGES[code]);
    this.name = "AuthGuardError";
    this.code = code;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toSessionDate(value: unknown): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Converts Better Auth's response to the small, safe server contract shared
 * with domain modules. Raw session tokens and provider fields never cross it.
 */
export function toServerAuthSession(
  result: BetterAuthSessionResult,
  now = new Date(),
): ServerAuthSession {
  const session = result?.session;
  const user = result?.user;

  if (!session || !user) {
    throw new AuthGuardError("UNAUTHENTICATED");
  }

  const identity = toLocalUserIdentity(user);
  const expiresAt = toSessionDate(session.expiresAt);

  if (
    !isNonEmptyString(session.id) ||
    !isNonEmptyString(session.userId) ||
    !isNonEmptyString(identity.id) ||
    !isNonEmptyString(identity.email) ||
    session.userId !== identity.id ||
    !expiresAt ||
    expiresAt <= now
  ) {
    throw new AuthGuardError(
      expiresAt && expiresAt <= now ? "UNAUTHENTICATED" : "INVALID_SESSION",
    );
  }

  return {
    id: session.id,
    userId: identity.id,
    expiresAt,
    user: identity,
  };
}

/**
 * Reads a persistent Better Auth session on the server. T07 can pass request
 * headers explicitly, while Server Components can rely on Next's request
 * scoped headers store.
 */
export async function getServerSession(
  requestHeaders?: HeadersInit,
): Promise<BetterAuthSessionResult> {
  const headers = requestHeaders
    ? new Headers(requestHeaders)
    : new Headers(await (await import("next/headers")).headers());

  return getAuth().api.getSession({ headers });
}

export const getServerAuthSession = getServerSession;
export const getAuthSession = getServerSession;

/**
 * Returns the authenticated local identity, or null when no session exists.
 * This is safe for public entry points that need to inspect auth state without
 * turning an absent session into an exception.
 */
export async function getAuthenticatedUser(
  requestHeaders?: HeadersInit,
): Promise<LocalUserIdentity | null> {
  const result = await getServerSession(requestHeaders);
  if (!result) {
    return null;
  }

  return toServerAuthSession(result).user;
}

/**
 * Requires a valid server-side session for private routes, layouts and
 * actions. `requestHeaders` is optional because Server Components/actions can
 * use Next's request-scoped headers store; route handlers should pass the
 * incoming request headers explicitly.
 */
export async function requireAuth(
  requestHeaders?: HeadersInit,
): Promise<ServerAuthSession> {
  const result = await getServerSession(requestHeaders);
  return toServerAuthSession(result);
}

export const getServerUser = getAuthenticatedUser;
export const getCurrentUser = getAuthenticatedUser;

/** Maps Better Auth's persisted identity to the cross-module local contract. */
export function toLocalUserIdentity(user: User): LocalUserIdentity {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    image: user.image ?? null,
  };
}

/** Public route adapter used by the App Router catch-all endpoint. */
export function getAuthRouteHandlers(): ReturnType<typeof toNextJsHandler> {
  return toNextJsHandler(getAuth());
}
