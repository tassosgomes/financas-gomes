/** S02 routes use the canonical paths from the frontend architecture. */
export const ACCOUNTS_ROUTE = "/accounts" as const;
export const ACCOUNT_DETAIL_ROUTE = (accountId: string) =>
  `${ACCOUNTS_ROUTE}/${encodeURIComponent(accountId)}`;
export const SETTINGS_ROUTE = "/settings" as const;
export const CATEGORIES_SETTINGS_ROUTE = `${SETTINGS_ROUTE}/categories` as const;

/**
 * The current authenticated home remains `/app`; these aliases let the
 * navigation converge on the canonical feature URLs without duplicating UI.
 */
export const APP_ACCOUNTS_ROUTE = `/app${ACCOUNTS_ROUTE}` as const;
export const APP_CATEGORIES_SETTINGS_ROUTE =
  `/app${CATEGORIES_SETTINGS_ROUTE}` as const;
