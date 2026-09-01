import { getServerEnv, isE2ETestAuthEnabled } from "@/lib/env";
import { AUTH_GOOGLE_CALLBACK_PATH } from "@/modules/auth/contracts";
import {
  createE2EGoogleAuthorizationCode,
  E2E_GOOGLE_AUTHORIZATION_CODE,
} from "@/modules/auth/e2e-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isEnabled(): boolean {
  try {
    return isE2ETestAuthEnabled(getServerEnv());
  } catch {
    // A missing/invalid runtime configuration must never turn this route into
    // an authentication surface.
    return false;
  }
}

/**
 * Local-only authorization server used by Playwright. It accepts Better
 * Auth's state/callback pair and, only for a strict synthetic test identity,
 * a login hint. It never handles credentials or real provider tokens.
 */
export function GET(request: Request): Response {
  if (!isEnabled()) {
    return new Response(null, { status: 404 });
  }

  const requestURL = new URL(request.url);
  const state = requestURL.searchParams.get("state");
  const redirectURI = requestURL.searchParams.get("redirect_uri");
  const loginHint = requestURL.searchParams.get("login_hint");

  if (!state || !redirectURI) {
    return Response.json(
      { error: "invalid_e2e_authorization_request" },
      { status: 400 },
    );
  }

  let callbackURL: URL;
  try {
    callbackURL = new URL(redirectURI);
  } catch {
    return Response.json({ error: "invalid_e2e_callback" }, { status: 400 });
  }

  // Do not become an open redirect. Better Auth's callback must stay on this
  // exact local origin and on its Google callback path.
  const configuredOrigin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
  if (
    callbackURL.origin !== configuredOrigin ||
    callbackURL.pathname !== AUTH_GOOGLE_CALLBACK_PATH
  ) {
    return Response.json({ error: "invalid_e2e_callback" }, { status: 400 });
  }

  const authorizationCode =
    loginHint === null
      ? E2E_GOOGLE_AUTHORIZATION_CODE
      : createE2EGoogleAuthorizationCode(loginHint);
  if (!authorizationCode) {
    return Response.json({ error: "invalid_e2e_identity" }, { status: 400 });
  }

  callbackURL.searchParams.set("code", authorizationCode);
  callbackURL.searchParams.set("state", state);

  return Response.redirect(callbackURL, 302);
}
