import type {
  BetterAuthPlugin,
  OAuth2Tokens,
  OAuthProvider,
} from "better-auth";

export const E2E_GOOGLE_AUTHORIZATION_PATH =
  "/api/e2e/google/authorize" as const;
export const E2E_GOOGLE_AUTHORIZATION_CODE =
  "e2e-google-authorization-code" as const;
const E2E_GOOGLE_AUTHORIZATION_CODE_PREFIX =
  `${E2E_GOOGLE_AUTHORIZATION_CODE}:` as const;
const E2E_GOOGLE_IDENTITY_PATTERN = /^e2e-[a-z0-9-]+@example\.test$/u;

interface E2EGoogleProfile {
  email: string;
  email_verified: boolean;
  name: string;
  picture: string;
  sub: string;
}

export interface E2EGoogleProviderOptions {
  applicationBaseURL: string;
  email: string;
  name: string;
}

/**
 * Encodes a synthetic identity in the local-only authorization code. This is
 * deliberately narrow: Playwright may select only `e2e-*@example.test`, and
 * the value is accepted nowhere outside the E2E authorization route.
 */
export function createE2EGoogleAuthorizationCode(
  email: string,
): string | null {
  const normalizedEmail = email.trim().toLowerCase();
  if (!E2E_GOOGLE_IDENTITY_PATTERN.test(normalizedEmail)) {
    return null;
  }

  return `${E2E_GOOGLE_AUTHORIZATION_CODE_PREFIX}${encodeURIComponent(normalizedEmail)}`;
}

function identityFromAuthorizationCode(
  code: string,
  fallbackEmail: string,
): string | null {
  if (code === E2E_GOOGLE_AUTHORIZATION_CODE) {
    return fallbackEmail;
  }

  if (!code.startsWith(E2E_GOOGLE_AUTHORIZATION_CODE_PREFIX)) {
    return null;
  }

  let email: string;
  try {
    email = decodeURIComponent(
      code.slice(E2E_GOOGLE_AUTHORIZATION_CODE_PREFIX.length),
    );
  } catch {
    return null;
  }

  return E2E_GOOGLE_IDENTITY_PATTERN.test(email) ? email : null;
}

function profileForEmail(
  options: E2EGoogleProviderOptions,
  email: string,
): E2EGoogleProfile {
  return {
    sub: `e2e-google-user:${email}`,
    email,
    email_verified: true,
    name: email === options.email ? options.name : `E2E Google User (${email})`,
    picture: "",
  };
}

function createE2EGoogleProvider(
  options: E2EGoogleProviderOptions,
): OAuthProvider<E2EGoogleProfile> {
  return {
    id: "google",
    name: "Google (E2E)",
    accountIssuer: "https://e2e.google.invalid",
    accountSubject: ({ profile: providerProfile }) => providerProfile.sub,
    async createAuthorizationURL({ state, redirectURI, loginHint }) {
      const authorizationURL = new URL(
        E2E_GOOGLE_AUTHORIZATION_PATH,
        new URL(options.applicationBaseURL).origin,
      );

      // The local callback validates both values before redirecting. A
      // synthetic login hint is carried only to select a deterministic E2E
      // identity; no credential or provider token is accepted here.
      authorizationURL.searchParams.set("state", state);
      authorizationURL.searchParams.set("redirect_uri", redirectURI);
      if (loginHint) {
        authorizationURL.searchParams.set("login_hint", loginHint);
      }
      return authorizationURL;
    },
    async validateAuthorizationCode({ code }): Promise<OAuth2Tokens | null> {
      const email = identityFromAuthorizationCode(code, options.email);
      if (!email) {
        return null;
      }

      // The default identity keeps the original tokenless fixture contract.
      // Alternate synthetic identities use a non-secret marker so getUserInfo
      // can resolve the selected profile during the normal callback flow.
      return email === options.email
        ? {}
        : { accessToken: code };
    },
    async getUserInfo(tokens) {
      const email = tokens.accessToken
        ? identityFromAuthorizationCode(tokens.accessToken, options.email)
        : options.email;
      if (!email) {
        return null;
      }

      const profile = profileForEmail(options, email);
      return {
        user: {
          name: profile.name,
          email: profile.email,
          image: undefined,
          emailVerified: profile.email_verified,
        },
        data: profile,
      };
    },
  };
}

/**
 * Replaces only the in-memory Google provider for the local E2E server.
 * Better Auth's normal Google configuration remains untouched everywhere else.
 */
export function createE2EGoogleProviderPlugin(
  options: E2EGoogleProviderOptions,
): BetterAuthPlugin {
  const provider = createE2EGoogleProvider(options);

  return {
    id: "e2e-google-provider",
    init() {
      return {
        context: {
          socialProviders: [provider],
        },
      };
    },
  };
}
