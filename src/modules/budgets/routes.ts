/** Canonical routes invalidated after a Caixinha write. */
export const BUDGETS_ROUTE = "/budgets" as const;
export const BUDGET_DETAIL_ROUTE_PATTERN = "/budgets/[referenceId]" as const;
export const BUDGET_DASHBOARD_ROUTE = "/app" as const;
export const SPENDABLE_ROUTE = "/spendable" as const;
export const SPENDABLE_BREAKDOWN_ROUTE = "/spendable/breakdown" as const;

export function budgetDetailRoute(referenceId: string): string {
  return `${BUDGETS_ROUTE}/${encodeURIComponent(referenceId)}`;
}

export const boxDetailRoute = budgetDetailRoute;

