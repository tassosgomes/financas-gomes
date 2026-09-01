import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, betterAuthMock } = vi.hoisted(() => {
  const getSession = vi.fn();
  return {
    getSessionMock: getSession,
    betterAuthMock: vi.fn(() => ({ api: { getSession } })),
  };
});

vi.mock("better-auth/minimal", () => ({ betterAuth: betterAuthMock }));
vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn(() => ({})),
}));
vi.mock("better-auth/next-js", () => ({
  nextCookies: vi.fn(() => ({})),
  toNextJsHandler: vi.fn(),
}));
vi.mock("@/db", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/env", () => ({
  getServerEnv: vi.fn(() => ({
    NODE_ENV: "test",
    BETTER_AUTH_URL: "http://localhost:3000",
    DATABASE_URL: "postgresql://test.invalid/database",
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
    GOOGLE_CLIENT_ID: "test-google-client-id",
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    SENTRY_DSN: undefined,
    SENTRY_ENVIRONMENT: "test",
    SENTRY_RELEASE: undefined,
    SENTRY_TEST_MODE: "false",
    SENTRY_TEST_TOKEN: undefined,
    E2E_TEST_AUTH_ENABLED: "false",
    E2E_TEST_AUTH_EMAIL: "e2e-auth@example.test",
    E2E_TEST_AUTH_NAME: "E2E Google User",
  })),
  isE2ETestAuthEnabled: vi.fn(() => false),
}));

import {
  getAuthenticatedUser,
  requireAuth,
  resetAuthInstance,
} from "./server";

const validSession = {
  session: {
    id: "session-id",
    userId: "user-id",
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
    updatedAt: new Date("2026-08-29T00:00:00.000Z"),
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    token: "opaque-session-token",
  },
  user: {
    id: "user-id",
    email: "person@example.test",
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
    updatedAt: new Date("2026-08-29T00:00:00.000Z"),
    emailVerified: true,
    name: "Person",
    image: null,
  },
} as const;

describe("server authentication guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthInstance();
    getSessionMock.mockResolvedValue(validSession);
  });

  it("resolves the local user identity without exposing session data", async () => {
    const user = await getAuthenticatedUser({
      cookie: "better-auth.session_token=opaque-session-token",
    });

    expect(user).toEqual({
      id: "user-id",
      email: "person@example.test",
      name: "Person",
      image: null,
    });
    expect(getSessionMock).toHaveBeenCalledWith({
      headers: expect.any(Headers),
    });
    const firstCall = getSessionMock.mock.calls[0] as
      | [{ headers: Headers }]
      | undefined;
    const headers = firstCall?.[0]?.headers;
    expect(headers).toBeInstanceOf(Headers);
    if (!headers) {
      throw new Error("A sessão não recebeu headers no teste.");
    }
    expect(headers.get("cookie")).toBe(
      "better-auth.session_token=opaque-session-token",
    );
  });

  it("requires and returns a validated server session", async () => {
    await expect(
      requireAuth({ authorization: "Bearer ignored-by-cookie-session" }),
    ).resolves.toEqual({
      id: "session-id",
      userId: "user-id",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      user: {
        id: "user-id",
        email: "person@example.test",
        name: "Person",
        image: null,
      },
    });
  });

  it("maps an absent session to the expected unauthenticated error", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    await expect(requireAuth({})).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
      expected: true,
    });
    getSessionMock.mockResolvedValueOnce(null);
    await expect(getAuthenticatedUser({})).resolves.toBeNull();
  });
});
