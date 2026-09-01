import { sql } from "drizzle-orm";

import { getDb } from "@/db";

import {
  HEALTH_CHECK_NAMES,
  type HealthCheck,
  type HealthReport,
} from "./contracts";

export * from "./contracts";

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

/** Headers shared by both probes to prevent intermediary caching. */
export const HEALTH_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

function reportStatus(checks: HealthCheck[]): HealthReport["status"] {
  return checks.every(({ status }) => status === "ok") ? "ok" : "degraded";
}

function createReport(checks: HealthCheck[], checkedAt = new Date()): HealthReport {
  return {
    status: reportStatus(checks),
    checks,
    checkedAt: checkedAt.toISOString(),
  };
}

/**
 * Liveness is deliberately independent from every external dependency. If
 * this function can run, the application process is alive enough to answer.
 */
export function getLivenessReport(checkedAt = new Date()): HealthReport {
  return createReport(
    [{ name: HEALTH_CHECK_NAMES.process, status: "ok" }],
    checkedAt,
  );
}

/**
 * Check the runtime database and the migration metadata relation installed by
 * T02. The latter is the only schema contract stable before the auth and
 * household migrations land, and the query is read-only. No migration is
 * started by this probe.
 */
export async function getReadinessReport(
  checkedAt = new Date(),
): Promise<HealthReport> {
  const checks: HealthCheck[] = [];

  try {
    const database = getDb();
    await database.execute(sql`SELECT 1`);
    checks.push({ name: HEALTH_CHECK_NAMES.database, status: "ok" });

    // A missing migration relation means the database has not received the
    // versioned schema yet. Keep the relation name out of the response.
    await database.execute(
      sql.raw(
        `SELECT 1 FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" LIMIT 1`,
      ),
    );
    checks.push({ name: HEALTH_CHECK_NAMES.schema, status: "ok" });
  } catch {
    // Expected dependency failures are represented by a stable status only;
    // connection strings and driver error messages never leave this module.
    if (!checks.some(({ name }) => name === HEALTH_CHECK_NAMES.database)) {
      checks.push({ name: HEALTH_CHECK_NAMES.database, status: "degraded" });
    } else {
      checks.push({ name: HEALTH_CHECK_NAMES.schema, status: "degraded" });
    }
  }

  return createReport(checks, checkedAt);
}

export function healthHttpStatus(report: HealthReport): number {
  return report.status === "ok" ? 200 : 503;
}
