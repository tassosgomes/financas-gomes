import {
  getLivenessReport,
  HEALTH_RESPONSE_HEADERS,
} from "@/modules/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public liveness probe. It must remain healthy while PostgreSQL is down. */
export async function GET(): Promise<Response> {
  return Response.json(getLivenessReport(), {
    status: 200,
    headers: HEALTH_RESPONSE_HEADERS,
  });
}
