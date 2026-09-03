import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/observability/server", () => ({
  addBreadcrumbSafely: vi.fn(),
  captureServerException: vi.fn(),
}));

import { captureServerException } from "@/modules/observability/server";

import {
  JOB_RETRY_BACKOFF_MS,
  JobDeterministicError,
  defaultClassifyJobError,
  runJob,
} from "./runtime";

function createRunningRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "exec-row-1",
    jobName: "s11.job.heartbeat",
    logicalWindow: "2026-09-03",
    executionId: "exec-1",
    attempt: 1,
    status: "RUNNING",
    startedAt: new Date(),
    finishedAt: null,
    errorCode: null,
    correlationId: "corr-1",
    ...overrides,
  };
}

function createDatabaseMock(
  claimTransaction: (tx: Record<string, unknown>) => Record<string, unknown>,
) {
  return {
    transaction: async (work: (tx: Record<string, unknown>) => Promise<unknown>) =>
      work(claimTransaction({})),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  } as never;
}

function createClaimInsertTx(record: Record<string, unknown>) {
  return {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => [record],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  };
}

function createAttemptTx() {
  return {
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  };
}

describe("S11 job runtime (unit)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(captureServerException).mockClear();
  });

  it("classifies deterministic errors without retrying", async () => {
    const sleep = vi.fn(async () => undefined);
    const effect = vi.fn(async () => {
      throw new JobDeterministicError("JOB_INVALID_INPUT");
    });
    let transactionCalls = 0;

    const database = {
      transaction: async (work: (tx: Record<string, unknown>) => Promise<unknown>) => {
        transactionCalls += 1;
        if (transactionCalls === 1) {
          return work(createClaimInsertTx(createRunningRecord()));
        }
        return work(createAttemptTx());
      },
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
    } as never;

    const result = await runJob({
      jobName: "s11.job.heartbeat",
      logicalWindow: "2026-09-03",
      correlationId: "corr-1",
      database,
      effect,
      sleep,
    });

    expect(result.status).toBe("FAILED");
    expect(result.errorCode).toBe("JOB_INVALID_INPUT");
    expect(effect).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries transient failures with bounded backoff", async () => {
    const sleep = vi.fn(async () => undefined);
    let calls = 0;
    const effect = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("transient network");
      }
    });
    let transactionCalls = 0;

    const database = {
      transaction: async (work: (tx: Record<string, unknown>) => Promise<unknown>) => {
        transactionCalls += 1;
        if (transactionCalls === 1) {
          return work(createClaimInsertTx(createRunningRecord({ correlationId: "corr-retry" })));
        }
        return work(createAttemptTx());
      },
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
    } as never;

    const result = await runJob({
      jobName: "s11.job.heartbeat",
      logicalWindow: "2026-09-03",
      correlationId: "corr-retry",
      database,
      effect,
      sleep,
      classifyError: defaultClassifyJobError,
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(effect).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map((call) => Number(call.at(0)))).toEqual([
      JOB_RETRY_BACKOFF_MS[0],
      JOB_RETRY_BACKOFF_MS[1],
    ]);
  });

  it("returns SKIPPED_IDEMPOTENT when the logical window already succeeded", async () => {
    const effect = vi.fn(async () => undefined);
    const database = createDatabaseMock(() => ({
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: async () => [],
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => ({
              for: async () => [
                createRunningRecord({
                  status: "SUCCEEDED",
                  executionId: "exec-existing",
                  correlationId: "corr-existing",
                  finishedAt: new Date("2026-09-03T00:00:01.000Z"),
                }),
              ],
            }),
          }),
        }),
      }),
    }));

    const result = await runJob({
      jobName: "s11.job.heartbeat",
      logicalWindow: "2026-09-03",
      correlationId: "corr-new",
      database,
      effect,
    });

    expect(result.status).toBe("SKIPPED_IDEMPOTENT");
    expect(result.executionId).toBe("exec-existing");
    expect(effect).not.toHaveBeenCalled();
  });

  it("shares correlationId across job.start, attempts and job.finish", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const correlationId = "job-correlation-shared";
    let transactionCalls = 0;

    const database = {
      transaction: async (work: (tx: Record<string, unknown>) => Promise<unknown>) => {
        transactionCalls += 1;
        if (transactionCalls === 1) {
          return work(
            createClaimInsertTx(createRunningRecord({ correlationId, executionId: "exec-1" })),
          );
        }
        return work(createAttemptTx());
      },
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
    } as never;

    await runJob({
      jobName: "s11.job.heartbeat",
      logicalWindow: "2026-09-03",
      correlationId,
      database,
      effect: async () => undefined,
    });

    const payloads = info.mock.calls.map((call) => String(call[0]));
    const correlated = payloads.filter((payload) =>
      payload.includes(`"requestId":"${correlationId}"`),
    );
    expect(correlated.length).toBeGreaterThanOrEqual(3);
    expect(correlated.some((payload) => payload.includes('"operation":"job.start"'))).toBe(
      true,
    );
    expect(correlated.some((payload) => payload.includes('"operation":"job.attempt"'))).toBe(
      true,
    );
    expect(correlated.some((payload) => payload.includes('"operation":"job.finish"'))).toBe(
      true,
    );
  });
});
