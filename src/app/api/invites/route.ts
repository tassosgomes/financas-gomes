import { z } from "zod";

import {
  createHouseholdInvite,
  HouseholdInviteError,
  mapHouseholdInviteHttpError,
  type CreateHouseholdInviteHttpResponse,
} from "@/modules/households/invites";
import { captureServerException } from "@/modules/observability/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const safePositiveInteger = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger);

const createInviteBodySchema = z
  .object({
    /** Selection hint only; the server guard remains the authority. */
    householdId: z.string().trim().min(1).max(128).optional(),
    /** Alias accepted by server-side callers while the UI uses householdId. */
    requestedHouseholdId: z.string().trim().min(1).max(128).optional(),
    expiresInSeconds: safePositiveInteger.optional(),
  })
  .strict()
  .refine(
    ({ householdId, requestedHouseholdId }) =>
      !householdId || !requestedHouseholdId || householdId === requestedHouseholdId,
    { message: "household selection hints must match" },
  );

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
    new HouseholdInviteError("INVITE_INPUT_INVALID"),
    "INVITE_INPUT_INVALID",
  );
  return Response.json(mapped.body, {
    status: mapped.status,
    headers: noStoreHeaders(),
  });
}

/**
 * Creates a copyable invitation for the household resolved by the session.
 * The response contains the one-time bearer link; no token is logged or
 * persisted in raw form.
 */
export async function POST(request: Request): Promise<Response> {
  let body: z.infer<typeof createInviteBodySchema>;

  try {
    body = createInviteBodySchema.parse(await readJson(request));
  } catch {
    return invalidInputResponse();
  }

  try {
    const result = await createHouseholdInvite({
      requestHeaders: request.headers,
      requestedHouseholdId:
        body.requestedHouseholdId ?? body.householdId,
      expiresInSeconds: body.expiresInSeconds,
      baseUrl: new URL(request.url).origin,
    });

    const response: CreateHouseholdInviteHttpResponse = {
      invite: {
        id: result.id,
        householdId: result.householdId,
        expiresAt: result.expiresAt.toISOString(),
        inviteUrl: result.inviteUrl,
      },
    };

    return Response.json(response, {
      status: 201,
      headers: noStoreHeaders(),
    });
  } catch (error) {
    const mapped = mapHouseholdInviteHttpError(
      error,
      "INVITE_CREATION_FAILED",
    );

    if (!mapped.expected) {
      try {
        captureServerException(new Error("household invite route failed"), {
          event: "household_invite_route_error",
          useCase: "create_household_invite",
          route: "/api/invites",
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
