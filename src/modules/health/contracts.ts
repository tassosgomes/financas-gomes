export type HealthStatus = "ok" | "degraded";

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  detail?: string;
}

export interface HealthReport {
  status: HealthStatus;
  checks: HealthCheck[];
  checkedAt: string;
}

/**
 * The probes intentionally expose only stable names and statuses. Runtime
 * errors (including PostgreSQL errors) must never cross the health endpoint.
 */
export const HEALTH_CHECK_NAMES = {
  process: "process",
  database: "database",
  schema: "schema",
} as const;
