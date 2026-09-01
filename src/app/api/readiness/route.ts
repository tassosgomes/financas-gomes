import {
  getReadinessReport,
  healthHttpStatus,
  HEALTH_RESPONSE_HEADERS,
} from "@/modules/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public readiness probe for PostgreSQL and the versioned schema metadata. */
export async function GET(): Promise<Response> {
  const report = await getReadinessReport();

  return Response.json(report, {
    status: healthHttpStatus(report),
    headers: HEALTH_RESPONSE_HEADERS,
  });
}
