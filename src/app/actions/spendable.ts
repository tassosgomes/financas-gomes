"use server";

import {
  getSpendable as readSpendable,
} from "@/modules/spendable/service";
import { createBudgetReserveAdapter } from "@/modules/budgets/reserve-source";
import type {
  GetSpendableInput,
  SpendableBreakdown,
} from "@/modules/spendable/contracts";
import type { SpendableResult } from "@/modules/spendable/service";

/**
 * Server Action boundary for the S08 read. Only the versioned public query is
 * accepted; household authority is resolved by `requireFinancialContext`.
 */
export async function getSpendableAction(
  input?: GetSpendableInput,
): Promise<SpendableResult<SpendableBreakdown>> {
  return readSpendable(input, {
    // S09 tenancy is captured by the S08 service before this factory's
    // adapter callback receives only the versioned ReserveAdapterContext.
    reserveAdapterFactory: (context) => createBudgetReserveAdapter(context),
  });
}

export async function getSpendable(input?: GetSpendableInput) {
  return getSpendableAction(input);
}

export async function getAvailableToSpend(input?: GetSpendableInput) {
  return getSpendableAction(input);
}
