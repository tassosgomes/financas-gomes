import { z } from "zod";

import {
  acceptHouseholdInvite,
  mapHouseholdInviteHttpError,
  type AcceptHouseholdInviteHttpResponse,
} from "@/modules/households/invites";
import { captureServerException } from "@/modules/observability/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const acceptInviteBodySchema = z
  .object({
    token: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" };
}

async function readJson(request: Request): Promise<unknown> {
  const body = await request.text();
  if (!body.trim()) {
    return {};
  }

  return JSON.parse(body) as unknown;
}

function invalidInputResponse(): Response {
  const mapped = mapHouseholdInviteHttpError(
    { code: "INVITE_INPUT_INVALID" },
    "INVITE_INPUT_INVALID",
  );
  return Response.json(mapped.body, {
    status: mapped.status,
    headers: noStoreHeaders(),
  });
}

/**
 * Consumes an invitation for the authenticated guest. The token may be sent
 * in JSON or as `?token=` so the UI can forward the URL it received without
 * ever treating the browser as a tenant authority.
 */
export async function POST(request: Request): Promise<Response> {
  let body: z.infer<typeof acceptInviteBodySchema>;

  try {
    body = acceptInviteBodySchema.parse(await readJson(request));
  } catch {
    return invalidInputResponse();
  }

  const queryToken = new URL(request.url).searchParams.get("token");
  const token = body.token ?? queryToken ?? undefined;
  if (!token) {
    return invalidInputResponse();
  }

  try {
    const result = await acceptHouseholdInvite({
      token,
      requestHeaders: request.headers,
    });

    const response: AcceptHouseholdInviteHttpResponse = {
      accepted: result.accepted,
      householdId: result.householdId,
      household: result.household,
      membershipCreated: result.membershipCreated,
    };

    return Response.json(response, {
      status: 200,
      headers: noStoreHeaders(),
    });
  } catch (error) {
    const mapped = mapHouseholdInviteHttpError(error, "PROVISIONING_FAILED");

    if (!mapped.expected) {
      try {
        captureServerException(new Error("household invite acceptance failed"), {
          event: "household_invite_acceptance_route_error",
          useCase: "accept_household_invite",
          route: "/api/invites/accept",
          statusCode: mapped.status,
        });
      } catch {
        // Observability is best effort and must not alter the HTTP contract.
      }
    }

    return Response.json(mapped.body, {
      status: mapped.status,
      headers: noStoreHeaders(),
    });
  }
}
