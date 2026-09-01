import {
  getServerEnv,
  type ServerEnv,
} from "@/lib/env";

import {
  AUTH_API_BASE_PATH,
  AUTH_GOOGLE_CALLBACK_PATH,
} from "./contracts";

export interface AuthRuntimeConfiguration {
  baseURL: string;
  googleCallbackURL: string;
  secret: string;
  googleClientId: string;
  googleClientSecret: string;
}

/**
 * Resolves the callback from the environment-specific application URL.
 * Query strings and fragments are intentionally discarded from callback URLs.
 */
export function getGoogleOAuthCallbackURL(baseURL: string): string {
  const parsed = new URL(baseURL);
  const basePath = parsed.pathname.replace(/\/+$/u, "");

  parsed.pathname = `${basePath}${AUTH_GOOGLE_CALLBACK_PATH}`;
  parsed.search = "";
  parsed.hash = "";

  return parsed.toString();
}

export function getAuthRuntimeConfiguration(
  env: ServerEnv = getServerEnv(),
): AuthRuntimeConfiguration {
  return {
    baseURL: env.BETTER_AUTH_URL,
    googleCallbackURL: getGoogleOAuthCallbackURL(env.BETTER_AUTH_URL),
    secret: env.BETTER_AUTH_SECRET,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}

/** Explicit paths are kept in one place for deployment and frontend tests. */
export const AUTH_ROUTE_CONFIGURATION = {
  basePath: AUTH_API_BASE_PATH,
  googleCallbackPath: AUTH_GOOGLE_CALLBACK_PATH,
} as const;
