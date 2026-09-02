"use server";

import {
  getSpendable as readSpendable,
} from "@/modules/spendable/service";
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
  return readSpendable(input);
}

export async function getSpendable(input?: GetSpendableInput) {
  return getSpendableAction(input);
}

export async function getAvailableToSpend(input?: GetSpendableInput) {
  return getSpendableAction(input);
}
