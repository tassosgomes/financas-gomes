import { and, desc, eq } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  jobExecutions,
  type JobExecutionRecord,
  type JobExecutionStatus,
} from "@/db/jobs-schema";
import { generateUuidV7 } from "@/lib/uuidv7";
import {
  createS11Operation,
  logS11JobFinish,
  logS11JobStart,
  reportS11UnexpectedError,
  withJobAttempt,
  type S11JobName,
  type S11TechnicalErrorCode,
} from "@/modules/observability/s11";

export const JOB_RETRY_BACKOFF_MS = [1_000, 4_000, 16_000] as const;
export const MAX_JOB_ATTEMPTS = 3;

export type JobErrorKind = "transient" | "deterministic";

export type JobWriteTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export interface JobEffectContext {
  transaction: JobWriteTransaction;
  jobName: S11JobName;
  logicalWindow: string;
  executionId: string;
  correlationId: string;
  attempt: number;
}

export interface JobRunResult {
  status: JobExecutionStatus;
  jobName: S11JobName;
  logicalWindow: string;
  executionId: string;
  correlationId: string;
  attempt: number;
  errorCode?: string;
}

export interface RunJobOptions {
  jobName: S11JobName;
  logicalWindow: string;
  effect: (context: JobEffectContext) => Promise<void> | void;
  classifyError?: (error: unknown) => JobErrorKind;
  correlationId?: string;
  database?: Database;
  technicalErrorCode?: S11TechnicalErrorCode;
  sleep?: (milliseconds: number) => Promise<void>;
}

const LOGICAL_WINDOW_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;

/** Returns the UTC civil day key (`YYYY-MM-DD`) for a job logical window. */
export function utcLogicalWindowForDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Deterministic failures stop retrying immediately with a safe opaque code. */
export class JobDeterministicError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "JobDeterministicError";
    this.code = code;
  }
}

export function defaultClassifyJobError(error: unknown): JobErrorKind {
  if (error instanceof JobDeterministicError) {
    return "deterministic";
  }
  return "transient";
}

function resolveDatabase(database?: Database): Database {
  return database ?? getDb();
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function assertLogicalWindow(logicalWindow: string): void {
  if (!LOGICAL_WINDOW_PATTERN.test(logicalWindow)) {
    throw new JobDeterministicError(
      "JOB_INVALID_LOGICAL_WINDOW",
      "logicalWindow must be UTC YYYY-MM-DD",
    );
  }
}

function opaqueErrorCode(error: unknown): string {
  if (error instanceof JobDeterministicError) {
    return error.code;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    const code = (error as { code: string }).code;
    if (/^[A-Z][A-Z0-9_]{0,63}$/u.test(code)) {
      return code;
    }
  }
  return "JOB_FAILED";
}

interface ClaimedExecution {
  record: JobExecutionRecord;
  skipped: boolean;
}

async function claimJobExecution(
  database: Database,
  input: {
    jobName: S11JobName;
    logicalWindow: string;
    executionId: string;
    correlationId: string;
  },
): Promise<ClaimedExecution> {
  return database.transaction(async (transaction) => {
    const inserted = await transaction
      .insert(jobExecutions)
      .values({
        jobName: input.jobName,
        logicalWindow: input.logicalWindow,
        executionId: input.executionId,
        attempt: 1,
        status: "RUNNING",
        correlationId: input.correlationId,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) {
      return { record: inserted[0], skipped: false };
    }

    const existingRows = await transaction
      .select()
      .from(jobExecutions)
      .where(
        and(
          eq(jobExecutions.jobName, input.jobName),
          eq(jobExecutions.logicalWindow, input.logicalWindow),
        ),
      )
      .limit(1)
      .for("update");

    const existing = existingRows[0];
    if (!existing) {
      throw new Error("Job execution row missing after unique conflict.");
    }

    if (existing.status === "SUCCEEDED") {
      return { record: existing, skipped: true };
    }

    if (existing.status === "RUNNING") {
      return { record: existing, skipped: true };
    }

    if (existing.status === "SKIPPED_IDEMPOTENT") {
      return { record: existing, skipped: true };
    }

    const resumed = await transaction
      .update(jobExecutions)
      .set({
        executionId: input.executionId,
        attempt: 1,
        status: "RUNNING",
        startedAt: new Date(),
        finishedAt: null,
        errorCode: null,
        correlationId: input.correlationId,
      })
      .where(eq(jobExecutions.id, existing.id))
      .returning();

    const record = resumed[0];
    if (!record) {
      throw new Error("Failed to resume job execution.");
    }

    return { record, skipped: false };
  });
}

async function markJobFailed(
  database: Database,
  recordId: string,
  attempt: number,
  errorCode: string,
): Promise<void> {
  await database
    .update(jobExecutions)
    .set({
      status: "FAILED",
      attempt,
      finishedAt: new Date(),
      errorCode,
    })
    .where(eq(jobExecutions.id, recordId));
}

async function runAttempt(
  database: Database,
  input: {
    recordId: string;
    jobName: S11JobName;
    logicalWindow: string;
    executionId: string;
    correlationId: string;
    attempt: number;
    effect: RunJobOptions["effect"];
    technicalErrorCode: S11TechnicalErrorCode;
  },
): Promise<void> {
  await withJobAttempt(
    async () => {
      await database.transaction(async (transaction) => {
        await input.effect({
          transaction,
          jobName: input.jobName,
          logicalWindow: input.logicalWindow,
          executionId: input.executionId,
          correlationId: input.correlationId,
          attempt: input.attempt,
        });

        await transaction
          .update(jobExecutions)
          .set({
            status: "SUCCEEDED",
            attempt: input.attempt,
            finishedAt: new Date(),
            errorCode: null,
          })
          .where(eq(jobExecutions.id, input.recordId));
      });
    },
    {
      jobName: input.jobName,
      attempt: input.attempt,
      executionId: input.executionId,
      correlationId: input.correlationId,
      technicalErrorCode: input.technicalErrorCode,
    },
  );
}

/**
 * Idempotent job runtime: one successful logical window never repeats the
 * effect; transient failures retry with bounded backoff.
 */
export async function runJob(options: RunJobOptions): Promise<JobRunResult> {
  assertLogicalWindow(options.logicalWindow);

  const database = resolveDatabase(options.database);
  const classifyError = options.classifyError ?? defaultClassifyJobError;
  const sleep = options.sleep ?? defaultSleep;
  const technicalErrorCode = options.technicalErrorCode ?? "JOB_FAILED";
  const correlationId = options.correlationId ?? generateUuidV7();
  const executionId = generateUuidV7();

  logS11JobStart({
    jobName: options.jobName,
    executionId,
    correlationId,
  });

  const claimed = await claimJobExecution(database, {
    jobName: options.jobName,
    logicalWindow: options.logicalWindow,
    executionId,
    correlationId,
  });

  if (claimed.skipped) {
    logS11JobFinish("success", {
      jobName: options.jobName,
      executionId: claimed.record.executionId,
      correlationId: claimed.record.correlationId ?? correlationId,
      attempt: claimed.record.attempt,
      result: "SKIPPED_IDEMPOTENT",
    });

    return {
      status: "SKIPPED_IDEMPOTENT",
      jobName: options.jobName,
      logicalWindow: options.logicalWindow,
      executionId: claimed.record.executionId,
      correlationId: claimed.record.correlationId ?? correlationId,
      attempt: claimed.record.attempt,
      errorCode: claimed.record.errorCode ?? undefined,
    };
  }

  let attempt = 1;
  let lastErrorCode = "JOB_FAILED";

  while (attempt <= MAX_JOB_ATTEMPTS) {
    try {
      await runAttempt(database, {
        recordId: claimed.record.id,
        jobName: options.jobName,
        logicalWindow: options.logicalWindow,
        executionId,
        correlationId,
        attempt,
        effect: options.effect,
        technicalErrorCode,
      });

      logS11JobFinish("success", {
        jobName: options.jobName,
        executionId,
        correlationId,
        attempt,
        result: "SUCCESS",
      });

      return {
        status: "SUCCEEDED",
        jobName: options.jobName,
        logicalWindow: options.logicalWindow,
        executionId,
        correlationId,
        attempt,
      };
    } catch (error) {
      lastErrorCode = opaqueErrorCode(error);
      const kind = classifyError(error);

      if (kind === "deterministic" || attempt >= MAX_JOB_ATTEMPTS) {
        await markJobFailed(database, claimed.record.id, attempt, lastErrorCode);
        const operation = createS11Operation("job.finish", {
          jobName: options.jobName,
          executionId,
          correlationId,
          attempt,
        });
        reportS11UnexpectedError(error, operation, {
          technicalErrorCode,
          errorCode: lastErrorCode,
          result: "FAILED",
        });
        logS11JobFinish("unexpected_error", {
          jobName: options.jobName,
          executionId,
          correlationId,
          attempt,
          result: "FAILED",
          errorCode: lastErrorCode,
        });

        return {
          status: "FAILED",
          jobName: options.jobName,
          logicalWindow: options.logicalWindow,
          executionId,
          correlationId,
          attempt,
          errorCode: lastErrorCode,
        };
      }

      const backoffMs = JOB_RETRY_BACKOFF_MS[attempt - 1] ?? 16_000;
      await database
        .update(jobExecutions)
        .set({ attempt })
        .where(eq(jobExecutions.id, claimed.record.id));
      await sleep(backoffMs);
      attempt += 1;
    }
  }

  await markJobFailed(database, claimed.record.id, attempt, lastErrorCode);
  return {
    status: "FAILED",
    jobName: options.jobName,
    logicalWindow: options.logicalWindow,
    executionId,
    correlationId,
    attempt,
    errorCode: lastErrorCode,
  };
}

export interface RecentJobExecutionRow {
  jobName: string;
  logicalWindow: string;
  status: string;
  attempt: number;
  startedAt: Date;
  finishedAt: Date | null;
  errorCode: string | null;
  executionId: string;
  correlationId: string | null;
}

/** Operator-facing read of recent job executions (no financial payload). */
export async function listRecentJobExecutions(
  limit = 50,
  database?: Database,
): Promise<RecentJobExecutionRow[]> {
  const boundedLimit = Math.min(Math.max(1, Math.round(limit)), 200);
  const rows = await resolveDatabase(database)
    .select({
      jobName: jobExecutions.jobName,
      logicalWindow: jobExecutions.logicalWindow,
      status: jobExecutions.status,
      attempt: jobExecutions.attempt,
      startedAt: jobExecutions.startedAt,
      finishedAt: jobExecutions.finishedAt,
      errorCode: jobExecutions.errorCode,
      executionId: jobExecutions.executionId,
      correlationId: jobExecutions.correlationId,
    })
    .from(jobExecutions)
    .orderBy(desc(jobExecutions.startedAt))
    .limit(boundedLimit);

  return rows;
}
