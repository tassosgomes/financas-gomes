"use server";

import { getOverview as readOverview } from "@/modules/overview/service";
import type { GetOverviewInput, OverviewReadModel } from "@/modules/overview/contracts";
import type { OverviewResult } from "@/modules/overview/read-contracts";

/**
 * Server Action boundary for the S10 read. Household authority is resolved by
 * `requireFinancialContext`; this action accepts only the public overview query.
 */
export async function getOverviewAction(
  input?: GetOverviewInput,
): Promise<OverviewResult<OverviewReadModel>> {
  try {
    return await readOverview(input);
  } catch {
    return { ok: false, error: { code: "OVERVIEW_QUERY_FAILED", field: null } };
  }
}
