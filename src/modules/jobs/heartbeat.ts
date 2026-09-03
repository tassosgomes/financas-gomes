import type { Database } from "@/db";

import {
  runJob,
  utcLogicalWindowForDate,
  type JobRunResult,
} from "./runtime";

export interface RunS11JobHeartbeatOptions {
  logicalWindow?: string;
  correlationId?: string;
  database?: Database;
}

/**
 * Operational heartbeat for S11: records that the job runtime executed for the
 * UTC logical window. No financial payload or external side effects.
 */
export async function runS11JobHeartbeat(
  options: RunS11JobHeartbeatOptions = {},
): Promise<JobRunResult> {
  const logicalWindow = options.logicalWindow ?? utcLogicalWindowForDate();

  return runJob({
    jobName: "s11.job.heartbeat",
    logicalWindow,
    correlationId: options.correlationId,
    database: options.database,
    technicalErrorCode: "JOB_HEARTBEAT_FAILED",
    effect: async () => {
      // The heartbeat effect is the persisted execution row itself; success is
      // recorded atomically by the runtime after this no-op completes.
    },
  });
}
