import { timingSafeEqual } from "node:crypto";

import {
  captureServerException,
  flushSentrySafely,
} from "@/modules/observability/server";
import { getServerSentryConfig } from "@/modules/observability/server-config";

export const runtime = "nodejs";

function matchesProbeToken(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) {
    return false;
  }

  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(providedBytes, expectedBytes);
}

/**
 * Controlled Sentry smoke probe. It is unreachable unless explicitly enabled
 * and protected by a separately managed token; the token is never captured.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.SENTRY_TEST_MODE !== "true") {
    return new Response(null, { status: 404 });
  }

  if (
    !matchesProbeToken(
      request.headers.get("x-sentry-test-token"),
      process.env.SENTRY_TEST_TOKEN,
    )
  ) {
    return new Response(null, { status: 404 });
  }

  if (!getServerSentryConfig().dsn) {
    return Response.json(
      { ok: false, reason: "sentry_not_configured" },
      { status: 503 },
    );
  }

  const eventId = captureServerException(new Error("controlled_sentry_probe"), {
    event: "controlled_sentry_probe",
    useCase: "observability_validation",
    route: "/api/observability/test",
  });
  await flushSentrySafely();

  return Response.json({ ok: Boolean(eventId), eventId }, {
    status: eventId ? 202 : 503,
  });
}
