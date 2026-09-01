import type { ManualTransactionKind } from "./contracts";

/** Canonical private routes for the manual transaction experience. */
export const TRANSACTIONS_ROUTE = "/transactions" as const;
export const TRANSACTION_NEW_ROUTE = `${TRANSACTIONS_ROUTE}/new` as const;
/** Canonical route for the S04 CSV import flow. */
export const TRANSACTION_IMPORT_ROUTE = `${TRANSACTIONS_ROUTE}/import` as const;

export function transactionCreateRoute(
  kind?: ManualTransactionKind,
): string {
  if (!kind) {
    return TRANSACTION_NEW_ROUTE;
  }

  return `${TRANSACTION_NEW_ROUTE}?kind=${encodeURIComponent(kind)}`;
}

export const TRANSACTION_DETAIL_ROUTE = (financialEventId: string): string =>
  `${TRANSACTIONS_ROUTE}/${encodeURIComponent(financialEventId)}`;

/** Naming aliases keep links discoverable at route call sites. */
export const NEW_TRANSACTION_ROUTE = TRANSACTION_NEW_ROUTE;
export const createTransactionRoute = transactionCreateRoute;
export const transactionRoute = TRANSACTION_DETAIL_ROUTE;
export const TRANSACTIONS_IMPORT_ROUTE = TRANSACTION_IMPORT_ROUTE;
export const transactionImportRoute = TRANSACTION_IMPORT_ROUTE;
