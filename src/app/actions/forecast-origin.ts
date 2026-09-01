"use server";

import { requireFinancialContext } from "@/modules/households/context";
import { FinancialContextError } from "@/modules/households/contracts";
import {
  resolveForecastOriginForContext,
} from "@/modules/forecast/origins";
import type {
  ForecastOriginResult,
} from "@/modules/forecast/origin-contracts";

/**
 * Server-only origin lookup. The browser supplies an opaque source query;
 * household and authorization are resolved from the authenticated session.
 */
export async function getForecastOriginAction(
  input: unknown,
): Promise<ForecastOriginResult> {
  try {
    const context = await requireFinancialContext();
    return resolveForecastOriginForContext(context, input);
  } catch (error) {
    if (error instanceof FinancialContextError) {
      return {
        ok: false,
        error: { code: "FINANCIAL_CONTEXT_REQUIRED", field: null },
      };
    }
    throw error;
  }
}

export async function getForecastOrigin(input: unknown) {
  return getForecastOriginAction(input);
}

export async function getForecastSourceAction(input: unknown) {
  return getForecastOriginAction(input);
}
