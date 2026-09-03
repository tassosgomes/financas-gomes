import { requireFinancialContext } from "@/modules/households/context";
import { captureServerException } from "@/modules/observability/server";

import {
  exportDownloadHeaders,
  exportNoStoreHeaders,
  mapExportFailureToHttp,
  mapExportRouteError,
} from "@/modules/export/http";
import { exportHouseholdData } from "@/modules/export/use-cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readJsonBody(request: Request): Promise<unknown> {
  const body = await request.text();
  if (!body.trim()) {
    return {};
  }
  return JSON.parse(body) as unknown;
}

/**
 * Authenticated ZIP export for the server-resolved financial space.
 * Optional JSON body may carry transaction filters only; tenancy fields are rejected.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const context = await requireFinancialContext({
      requestHeaders: request.headers,
    });

    let body: unknown = {};
    try {
      body = await readJsonBody(request);
    } catch {
      return Response.json(
        mapExportRouteError(new Error("invalid json")).body,
        {
          status: 400,
          headers: exportNoStoreHeaders(),
        },
      );
    }

    const result = await exportHouseholdData(context, body);
    if (!result.ok) {
      const mapped = mapExportFailureToHttp(result);
      return Response.json(mapped.body, {
        status: mapped.status,
        headers: exportNoStoreHeaders(),
      });
    }

    return new Response(new Uint8Array(result.zip), {
      status: 200,
      headers: exportDownloadHeaders(result.manifest.rowCountTotal),
    });
  } catch (error) {
    const mapped = mapExportRouteError(error);

    if (!mapped.expected) {
      try {
        captureServerException(new Error("export route failed"), {
          event: "export_route_error",
          useCase: "export.request",
          route: "/api/export",
          statusCode: mapped.status,
        });
      } catch {
        // Observability is best effort and must not alter the HTTP contract.
      }
    }

    return Response.json(mapped.body, {
      status: mapped.status,
      headers: exportNoStoreHeaders(),
    });
  }
}
