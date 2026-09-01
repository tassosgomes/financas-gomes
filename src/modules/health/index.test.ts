import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/db";

import {
  getLivenessReport,
  getReadinessReport,
  healthHttpStatus,
} from ".";

vi.mock("@/db", () => ({
  getDb: vi.fn(),
}));

describe("health probes", () => {
  const execute = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue({ execute } as never);
  });

  it("does not access PostgreSQL for liveness", () => {
    const report = getLivenessReport(new Date("2026-08-29T15:00:00.000Z"));

    expect(report).toEqual({
      status: "ok",
      checks: [{ name: "process", status: "ok" }],
      checkedAt: "2026-08-29T15:00:00.000Z",
    });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("reports PostgreSQL as degraded without exposing the driver error", async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error("postgresql://user:secret@db.internal/password");
    });

    const report = await getReadinessReport(
      new Date("2026-08-29T15:00:00.000Z"),
    );

    expect(report).toEqual({
      status: "degraded",
      checks: [{ name: "database", status: "degraded" }],
      checkedAt: "2026-08-29T15:00:00.000Z",
    });
    expect(JSON.stringify(report)).not.toContain("secret");
    expect(healthHttpStatus(report)).toBe(503);
  });

  it("requires the migration metadata relation for readiness", async () => {
    execute.mockResolvedValueOnce({}).mockRejectedValueOnce(
      new Error('relation "drizzle.__drizzle_migrations" does not exist'),
    );

    const report = await getReadinessReport(
      new Date("2026-08-29T15:00:00.000Z"),
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect(report).toEqual({
      status: "degraded",
      checks: [
        { name: "database", status: "ok" },
        { name: "schema", status: "degraded" },
      ],
      checkedAt: "2026-08-29T15:00:00.000Z",
    });
    expect(JSON.stringify(report)).not.toContain("drizzle");
    expect(healthHttpStatus(report)).toBe(503);
  });

  it("returns ready only when both probes succeed", async () => {
    execute.mockResolvedValue({});

    const report = await getReadinessReport(
      new Date("2026-08-29T15:00:00.000Z"),
    );

    expect(report).toEqual({
      status: "ok",
      checks: [
        { name: "database", status: "ok" },
        { name: "schema", status: "ok" },
      ],
      checkedAt: "2026-08-29T15:00:00.000Z",
    });
    expect(healthHttpStatus(report)).toBe(200);
  });
});
