import { createExportOpaqueError, type ExportErrorCode } from "@/components/export/contracts";
import { FinancialContextError } from "@/modules/households/contracts";
import { toS11ErrorEnvelope } from "@/modules/observability/s11";

import {
  ExportUseCaseError,
  type ExportHouseholdDataFailure,
  type ExportUseCaseErrorCode,
} from "./use-cases";

export interface ExportHttpErrorBody {
  ok: false;
  error: {
    code: ExportErrorCode;
    message: string;
    correlationId?: string;
  };
}

export interface ExportHttpErrorMapping {
  status: number;
  body: ExportHttpErrorBody;
  expected: boolean;
}

function isExportUseCaseCode(value: string): value is ExportUseCaseErrorCode {
  return [
    "EXPORT_IN_PROGRESS",
    "EXPORT_RATE_LIMITED",
    "EXPORT_TIMEOUT",
    "EXPORT_TOO_LARGE",
    "EXPORT_UNAVAILABLE",
    "EXPORT_FAILED",
  ].includes(value);
}

function statusForExportCode(code: ExportErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "EXPORT_IN_PROGRESS":
    case "EXPORT_RATE_LIMITED":
      return 429;
    case "EXPORT_TIMEOUT":
      return 504;
    case "EXPORT_TOO_LARGE":
      return 413;
    case "EXPORT_UNAVAILABLE":
      return 503;
    default:
      return 500;
  }
}

function toHttpBody(
  code: ExportErrorCode,
  correlationId?: string,
): ExportHttpErrorBody {
  const opaque = createExportOpaqueError(code, correlationId);
  return {
    ok: false,
    error: {
      code: opaque.code,
      message: opaque.message,
      ...(opaque.correlationId !== undefined
        ? { correlationId: opaque.correlationId }
        : {}),
    },
  };
}

export function mapExportFailureToHttp(
  failure: ExportHouseholdDataFailure,
): ExportHttpErrorMapping {
  const code = isExportUseCaseCode(failure.error.code)
    ? failure.error.code
    : "EXPORT_FAILED";
  return {
    status: statusForExportCode(code),
    body: toHttpBody(code, failure.correlationId),
    expected: true,
  };
}

export function mapExportRouteError(
  error: unknown,
  fallbackCode: ExportErrorCode = "EXPORT_FAILED",
): ExportHttpErrorMapping {
  if (error instanceof FinancialContextError) {
    const code =
      error.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : fallbackCode;
    return {
      status: error.status,
      body: toHttpBody(code),
      expected: true,
    };
  }

  if (error instanceof ExportUseCaseError) {
    const code = isExportUseCaseCode(error.code) ? error.code : fallbackCode;
    return {
      status: statusForExportCode(code),
      body: toHttpBody(code, error.correlationId),
      expected: true,
    };
  }

  const envelope = toS11ErrorEnvelope(error);
  const code = isExportUseCaseCode(envelope.error.code)
    ? envelope.error.code
    : fallbackCode;
  return {
    status: statusForExportCode(code),
    body: toHttpBody(code),
    expected: false,
  };
}

export function exportDownloadHeaders(): HeadersInit {
  return {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="financas-gomes-export-s11v1.zip"`,
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  };
}

export function exportNoStoreHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  };
}
