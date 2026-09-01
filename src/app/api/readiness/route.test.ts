import { describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const { getReadinessReport } = vi.hoisted(() => ({
  getReadinessReport: vi.fn(),
}));

vi.mock("@/modules/health", async () => {
  const actual = await vi.importActual<typeof import("@/modules/health")>(
    "@/modules/health",
  );

  return {
    ...actual,
    getReadinessReport,
  };
});

describe("GET /api/readiness", () => {
  it("returns 200 for a ready report", async () => {
    getReadinessReport.mockResolvedValueOnce({
      status: "ok",
      checks: [
        { name: "database", status: "ok" },
        { name: "schema", status: "ok" },
      ],
      checkedAt: "2026-08-29T15:00:00.000Z",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("returns 503 without leaking dependency details", async () => {
    getReadinessReport.mockResolvedValueOnce({
      status: "degraded",
      checks: [{ name: "database", status: "degraded" }],
      checkedAt: "2026-08-29T15:00:00.000Z",
    });

    const response = await GET();

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('"status":"degraded"');
    expect(body).not.toContain("DATABASE_URL");
    expect(body).not.toContain("postgresql://");
  });
});
