import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import { jobExecutions } from "@/db/schema";

import { runS11JobHeartbeat } from "./heartbeat";
import {
  JobDeterministicError,
  listRecentJobExecutions,
  runJob,
} from "./runtime";

const integration =
  process.env.S11_INTEGRATION === "1" ? describe : describe.skip;

const LOGICAL_WINDOW = "2026-09-03";

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("Defina DATABASE_URL antes de executar S11_INTEGRATION=1.");
  }
  return database;
}

integration("S11 job runtime (integration)", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      return;
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = databaseOrThrow(database);
    await db.delete(jobExecutions).where(eq(jobExecutions.logicalWindow, LOGICAL_WINDOW));
  });

  afterAll(async () => {
    await closeDb();
  });

  it("does not duplicate effect when the same logical window runs twice", async () => {
    const db = databaseOrThrow(database);
    let effectCount = 0;

    const first = await runJob({
      jobName: "s11.job.heartbeat",
      logicalWindow: LOGICAL_WINDOW,
      correlationId: "corr-double-run",
      database: db,
      effect: async () => {
        effectCount += 1;
      },
    });
    const second = await runJob({
      jobName: "s11.job.heartbeat",
      logicalWindow: LOGICAL_WINDOW,
      correlationId: "corr-double-run-2",
      database: db,
      effect: async () => {
        effectCount += 1;
      },
    });

    expect(first.status).toBe("SUCCEEDED");
    expect(second.status).toBe("SKIPPED_IDEMPOTENT");
    expect(effectCount).toBe(1);

    const rows = await db
      .select()
      .from(jobExecutions)
      .where(eq(jobExecutions.logicalWindow, LOGICAL_WINDOW));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("SUCCEEDED");
  });

  it("lets only one concurrent starter win for the same logical window", async () => {
    const db = databaseOrThrow(database);
    let effectCount = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const slowEffect = async () => {
      effectCount += 1;
      await gate;
    };

    const first = runJob({
      jobName: "s11.job.heartbeat",
      logicalWindow: LOGICAL_WINDOW,
      correlationId: "corr-concurrent-a",
      database: db,
      effect: slowEffect,
    });
    const second = runJob({
      jobName: "s11.job.heartbeat",
      logicalWindow: LOGICAL_WINDOW,
      correlationId: "corr-concurrent-b",
      database: db,
      effect: async () => {
        effectCount += 1;
      },
    }).then((result) => {
      release?.();
      return result;
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    const statuses = [firstResult.status, secondResult.status].sort();
    expect(statuses).toEqual(["SKIPPED_IDEMPOTENT", "SUCCEEDED"]);
    expect(effectCount).toBe(1);
  });

  it("resumes after a transient failure without duplicating success", async () => {
    const db = databaseOrThrow(database);
    let calls = 0;

    const failed = await runJob({
      jobName: "s11.job.heartbeat",
      logicalWindow: LOGICAL_WINDOW,
      correlationId: "corr-transient",
      database: db,
      sleep: async () => undefined,
      effect: async () => {
        calls += 1;
        throw new Error("transient");
      },
    });
    expect(failed.status).toBe("FAILED");
    expect(calls).toBe(3);

    calls = 0;
    const resumed = await runJob({
      jobName: "s11.job.heartbeat",
      logicalWindow: LOGICAL_WINDOW,
      correlationId: "corr-transient-resume",
      database: db,
      effect: async () => {
        calls += 1;
      },
    });

    expect(resumed.status).toBe("SUCCEEDED");
    expect(calls).toBe(1);

    const rows = await db
      .select()
      .from(jobExecutions)
      .where(eq(jobExecutions.logicalWindow, LOGICAL_WINDOW));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("SUCCEEDED");
  });

  it("records deterministic failure without retrying", async () => {
    const db = databaseOrThrow(database);
    let calls = 0;

    const result = await runJob({
      jobName: "s11.job.heartbeat",
      logicalWindow: LOGICAL_WINDOW,
      correlationId: "corr-deterministic",
      database: db,
      sleep: async () => undefined,
      effect: async () => {
        calls += 1;
        throw new JobDeterministicError("JOB_INVALID_INPUT");
      },
    });

    expect(result.status).toBe("FAILED");
    expect(result.errorCode).toBe("JOB_INVALID_INPUT");
    expect(calls).toBe(1);

    const rows = await db
      .select()
      .from(jobExecutions)
      .where(eq(jobExecutions.logicalWindow, LOGICAL_WINDOW));
    expect(rows[0]?.status).toBe("FAILED");
    expect(rows[0]?.errorCode).toBe("JOB_INVALID_INPUT");
  });

  it("emits job.finish with opaque state after deterministic failure", async () => {
    const db = databaseOrThrow(database);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const infoLog = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const result = await runJob({
      jobName: "s11.job.heartbeat",
      logicalWindow: LOGICAL_WINDOW,
      correlationId: "corr-finish-event",
      database: db,
      sleep: async () => undefined,
      effect: async () => {
        throw new JobDeterministicError("JOB_INVALID_INPUT");
      },
    });

    expect(result.status).toBe("FAILED");
    const payloads = [...errorLog.mock.calls, ...infoLog.mock.calls].map((call) =>
      String(call[0]),
    );
    const finish = payloads.find((payload) => payload.includes('"operation":"job.finish"'));
    expect(finish).toBeDefined();
    expect(finish).toContain('"result":"FAILED"');
    expect(finish).toContain('"operation":"job.finish"');
    expect(finish).not.toMatch(/household|amount|password|postgresql/iu);
    errorLog.mockRestore();
    infoLog.mockRestore();
  });

  it("exposes recent executions for operator diagnostics", async () => {
    const db = databaseOrThrow(database);
    await runS11JobHeartbeat({
      logicalWindow: LOGICAL_WINDOW,
      correlationId: "corr-operator",
      database: db,
    });

    const recent = await listRecentJobExecutions(10, db);
    expect(recent.some((row) => row.logicalWindow === LOGICAL_WINDOW)).toBe(true);
    expect(
      recent.every((row) => !JSON.stringify(row).match(/amount|household|password|sql/iu)),
    ).toBe(true);
  });
});
