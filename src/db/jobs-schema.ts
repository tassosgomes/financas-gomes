/**
 * Operational job execution registry for S11 (T08).
 *
 * Unlike `application_commands`, these rows are process-scoped (no household)
 * and never store financial payloads. One row represents the logical execution
 * for `(job_name, logical_window)`; retries update `attempt` in place.
 */
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@/lib/uuidv7";
import { S11_JOB_NAMES } from "@/modules/observability/s11";

/** Closed job names allowed at the persistence boundary (ADR-014). */
export const JOB_EXECUTION_JOB_NAMES = S11_JOB_NAMES;

export const JOB_EXECUTION_STATUSES = [
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED_IDEMPOTENT",
] as const;

export type JobExecutionStatus = (typeof JOB_EXECUTION_STATUSES)[number];

const JOB_NAME_ALLOWLIST_SQL = sql.join(
  JOB_EXECUTION_JOB_NAMES.map((name) => sql`${name}`),
  sql`, `,
);

const JOB_STATUS_ALLOWLIST_SQL = sql.join(
  JOB_EXECUTION_STATUSES.map((status) => sql`${status}`),
  sql`, `,
);

/**
 * One logical job run per UTC civil day (`logical_window` = `YYYY-MM-DD`).
 * Concurrent starters contend on the unique `(job_name, logical_window)` key.
 */
export const jobExecutions = pgTable(
  "job_executions",
  {
    id: uuid("id").primaryKey().$defaultFn(generateUuidV7),
    jobName: text("job_name").notNull(),
    logicalWindow: text("logical_window").notNull(),
    executionId: text("execution_id").notNull(),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", {
      withTimezone: true,
      mode: "date",
    }),
    errorCode: text("error_code"),
    correlationId: text("correlation_id"),
  },
  (table) => [
    uniqueIndex("job_executions_job_name_logical_window_uq").on(
      table.jobName,
      table.logicalWindow,
    ),
    index("job_executions_started_at_idx").on(table.startedAt),
    index("job_executions_job_name_started_at_idx").on(
      table.jobName,
      table.startedAt,
    ),
    check(
      "job_executions_job_name_allowlist_check",
      sql`${table.jobName} in (${JOB_NAME_ALLOWLIST_SQL})`,
    ),
    check(
      "job_executions_status_allowlist_check",
      sql`${table.status} in (${JOB_STATUS_ALLOWLIST_SQL})`,
    ),
    check(
      "job_executions_logical_window_shape_check",
      sql`${table.logicalWindow} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
    ),
    check(
      "job_executions_execution_id_shape_check",
      sql`char_length(btrim(${table.executionId})) between 1 and 160`,
    ),
    check(
      "job_executions_attempt_positive_check",
      sql`${table.attempt} between 1 and 99`,
    ),
    check(
      "job_executions_error_code_shape_check",
      sql`${table.errorCode} is null or (
        char_length(btrim(${table.errorCode})) between 1 and 64
        and ${table.errorCode} ~ '^[A-Z][A-Z0-9_]{0,63}$'
      )`,
    ),
    check(
      "job_executions_correlation_id_shape_check",
      sql`${table.correlationId} is null or (
        char_length(btrim(${table.correlationId})) between 1 and 160
      )`,
    ),
    check(
      "job_executions_finished_at_shape_check",
      sql`(
        (${table.status}::text = 'RUNNING' and ${table.finishedAt} is null)
        or
        (${table.status}::text <> 'RUNNING' and ${table.finishedAt} is not null)
      )`,
    ),
  ],
);

export type JobExecutionRecord = typeof jobExecutions.$inferSelect;
export type NewJobExecution = typeof jobExecutions.$inferInsert;
