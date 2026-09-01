"use client";

import { createAuthClient } from "better-auth/react";

import { getPublicEnv } from "@/lib/env";

import { AUTH_API_BASE_PATH } from "./contracts";

const publicEnv = getPublicEnv();

/** Browser client: credentials are sent as HttpOnly cookies by default. */
export const authClient = createAuthClient({
  baseURL: publicEnv.NEXT_PUBLIC_BETTER_AUTH_URL,
  basePath: AUTH_API_BASE_PATH,
});

export type AuthClient = typeof authClient;

/** Starts the only supported V1 login flow. Better Auth performs the redirect. */
export function signInWithGoogle(options?: {
  callbackURL?: string;
  errorCallbackURL?: string;
  newUserCallbackURL?: string;
}) {
  return authClient.signIn.social({
    provider: "google",
    ...options,
  });
}

/** Invalidates the current persistent session and clears the client state. */
export function signOut() {
  return authClient.signOut();
}

export const logout = signOut;

/** Hook consumed by T10 for loading, authenticated and error states. */
export function useAuthSession() {
  return authClient.useSession();
}
