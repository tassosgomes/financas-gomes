"use server";

import { headers } from "next/headers";

import { requireFinancialContext } from "@/modules/households/context";
import {
  requestHouseholdExport,
  type ExportHouseholdDataFailure,
} from "@/modules/export/use-cases";

export type RequestHouseholdExportResult =
  | {
      ok: true;
      downloadUrl: "/api/export";
      filters: import("@/modules/export/reads").S11TransactionFilters | null;
    }
  | ExportHouseholdDataFailure;

/**
 * Validates export filters and confirms the session before the browser
 * downloads `/api/export` with credentials.
 */
export async function requestHouseholdExportAction(
  input?: unknown,
): Promise<RequestHouseholdExportResult> {
  const context = await requireFinancialContext({
    requestHeaders: await headers(),
  });
  return requestHouseholdExport(context, input);
}
