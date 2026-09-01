import { captureServerException } from "@/modules/observability/server";
import {
  AUTH_API_BASE_PATH,
  type AuthErrorCode,
} from "@/modules/auth";
import { getAuthRouteHandlers } from "@/modules/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_ROUTE_FAILURE: {
  code: AuthErrorCode;
  message: string;
} = {
  code: "AUTH_REQUEST_FAILED",
  message:
    "Não foi possível concluir a autenticação. Tente novamente em instantes.",
};

function safeAuthFailureResponse(): Response {
  return Response.json(
    { error: AUTH_ROUTE_FAILURE },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function isAuthErrorRoute(request: Request): boolean {
  const pathname = new URL(request.url).pathname.replace(/\/+$/u, "");
  return pathname.endsWith(`${AUTH_API_BASE_PATH}/error`);
}

/**
 * Better Auth normally redirects callback failures with an optional provider
 * `error_description`. Do not reflect that untrusted text (which may contain
 * credentials or tokens) back to the browser.
 */
function sanitizeAuthResponse(
  request: Request,
  response: Response,
): Response {
  if (isAuthErrorRoute(request)) {
    return safeAuthFailureResponse();
  }

  if (response.status < 300 || response.status >= 400) {
    return response;
  }

  const location = response.headers.get("location");
  if (!location) {
    return response;
  }

  try {
    const redirect = new URL(location, request.url);
    if (!redirect.searchParams.has("error_description")) {
      return response;
    }

    redirect.searchParams.delete("error_description");
    const headers = new Headers(response.headers);
    headers.set("location", redirect.toString());

    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    // A malformed provider redirect is still handled as a generic failure.
    return safeAuthFailureResponse();
  }
}

async function dispatch(request: Request): Promise<Response> {
  try {
    // Better Auth returns generic responses for expected callback/session
    // failures; only unexpected setup/runtime exceptions reach this boundary.
    const response = await getAuthRouteHandlers().GET(request);
    return sanitizeAuthResponse(request, response);
  } catch (error) {
    captureServerException(error, {
      event: "auth_request_error",
      route: `${AUTH_API_BASE_PATH}/[...all]`,
    });
    return safeAuthFailureResponse();
  }
}

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;
