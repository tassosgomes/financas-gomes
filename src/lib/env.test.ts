import { describe, expect, it } from "vitest";

import {
  isE2ETestAuthEnabled,
  parseServerEnv,
} from "@/lib/env";

const validEnvironment = {
  NODE_ENV: "test",
  BETTER_AUTH_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/financas_gomes",
  BETTER_AUTH_SECRET: "a-secure-test-secret-with-at-least-32-characters",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
};

describe("server environment contract", () => {
  it("accepts the required values and defaults optional settings", () => {
    expect(parseServerEnv(validEnvironment)).toMatchObject({
      NODE_ENV: "test",
      SENTRY_ENVIRONMENT: "development",
    });
  });

  it("reports all missing required keys without echoing values", () => {
    expect(() => parseServerEnv({})).toThrowError(
      /BETTER_AUTH_URL|DATABASE_URL|BETTER_AUTH_SECRET|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET/,
    );
    expect(() => parseServerEnv({})).not.toThrowError(/postgres|secret|client-id/);
  });

  it("keeps the E2E provider disabled outside a local development process", () => {
    expect(
      isE2ETestAuthEnabled({
        NODE_ENV: "production",
        E2E_TEST_AUTH_ENABLED: "true",
      }),
    ).toBe(false);

    expect(
      isE2ETestAuthEnabled({
        NODE_ENV: "development",
        E2E_TEST_AUTH_ENABLED: "true",
      }),
    ).toBe(true);

    expect(
      isE2ETestAuthEnabled({
        NODE_ENV: "test",
        E2E_TEST_AUTH_ENABLED: "true",
      }),
    ).toBe(true);
  });
});
