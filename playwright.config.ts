import dotenv from "dotenv";

import { defineConfig } from "@playwright/test";

dotenv.config({ path: ".env.local" });

const e2ePort = Number(process.env.E2E_PORT ?? "3100");
const e2eBaseURL = `http://127.0.0.1:${e2ePort}`;
const e2eDatabaseURL =
  process.env.E2E_DATABASE_URL?.trim() ||
  "postgresql://postgres:postgres@localhost:5433/financas_gomes_test";

/**
 * The web server intentionally starts with a local-only fake Google provider.
 * The app itself refuses that provider unless it is running in development
 * with E2E_TEST_AUTH_ENABLED=true; Preview/production cannot use this path.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL: e2eBaseURL,
    actionTimeout: 30_000,
    // Development-mode route compilation can exceed the default 30 seconds
    // on a clean E2E process; keep navigation bounded but allow the first
    // server-owned page to finish compiling before the test is classified as
    // an application failure.
    navigationTimeout: 120_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${e2ePort}`,
    // Probe the listening socket instead of issuing an HTTP GET. Playwright's
    // URL probe has no per-request timeout, so an accepted connection can
    // otherwise leave the whole run waiting forever when a dev server stalls
    // inside compilation. Browser navigation still uses the explicit baseURL
    // and its configured navigation timeout below.
    port: e2ePort,
    // Opt in when debugging against an already-started local server. CI and
    // normal runs always own a fresh server with the fake provider settings.
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 120_000,
    env: {
      BETTER_AUTH_URL: e2eBaseURL,
      NEXT_PUBLIC_BETTER_AUTH_URL: e2eBaseURL,
      DATABASE_URL: e2eDatabaseURL,
      BETTER_AUTH_SECRET:
        process.env.E2E_BETTER_AUTH_SECRET ??
        process.env.BETTER_AUTH_SECRET ??
        "e2e-only-secret-never-used-outside-playwright",
      GOOGLE_CLIENT_ID:
        process.env.E2E_GOOGLE_CLIENT_ID ?? "e2e-google-client-id",
      GOOGLE_CLIENT_SECRET:
        process.env.E2E_GOOGLE_CLIENT_SECRET ??
        "e2e-google-client-secret",
      E2E_TEST_AUTH_ENABLED: "true",
      E2E_TEST_AUTH_EMAIL:
        process.env.E2E_TEST_AUTH_EMAIL ?? "e2e-auth@example.test",
      E2E_TEST_AUTH_NAME:
        process.env.E2E_TEST_AUTH_NAME ?? "E2E Google User",
      NEXT_DIST_DIR:
        process.env.E2E_NEXT_DIST_DIR?.trim() ?? ".next-e2e",
      NODE_ENV: "development",
    },
  },
});
