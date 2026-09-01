import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

describe("controlled observability probe", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled by default", async () => {
    const response = await POST(
      new Request("http://localhost/api/observability/test", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
  });

  it("does not reveal whether the probe exists for an invalid token", async () => {
    vi.stubEnv("SENTRY_TEST_MODE", "true");
    vi.stubEnv("SENTRY_TEST_TOKEN", "expected-token");

    const response = await POST(
      new Request("http://localhost/api/observability/test", {
        method: "POST",
        headers: { "x-sentry-test-token": "wrong-token" },
      }),
    );

    expect(response.status).toBe(404);
  });

  it("returns a safe configuration response before attempting capture", async () => {
    vi.stubEnv("SENTRY_TEST_MODE", "true");
    vi.stubEnv("SENTRY_TEST_TOKEN", "expected-token");

    const response = await POST(
      new Request("http://localhost/api/observability/test", {
        method: "POST",
        headers: { "x-sentry-test-token": "expected-token" },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      reason: "sentry_not_configured",
    });
  });
});
