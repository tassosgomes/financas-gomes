import {
  requireFinancialContext,
} from "./context";
import {
  FinancialContextError,
  type FinancialContext,
  type RequireFinancialContextOptions,
} from "./contracts";

/**
 * Runtime guard shared by every tenant-scoped operation.
 *
 * `FinancialContext` is a TypeScript boundary only; a mocked resolver,
 * stale adapter, or future context implementation can still hand an invalid
 * value to an operation at runtime. Failing with the stable context error
 * keeps malformed tenant authority out of Drizzle predicates.
 */
export function isFinancialContext(value: unknown): value is FinancialContext {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<FinancialContext>;

  return [candidate.userId, candidate.householdId].every(
    (id) =>
      typeof id === "string" &&
      id.length > 0 &&
      id.trim().length === id.length,
  );
}

export function assertFinancialContext(
  value: unknown,
): asserts value is FinancialContext {
  if (!isFinancialContext(value)) {
    throw new FinancialContextError("INVALID_FINANCIAL_CONTEXT");
  }
}

/**
 * A private operation always receives the context resolved by the server
 * guard. Callers should put all tenant-scoped reads and writes behind this
 * boundary instead of accepting `householdId` in a browser command.
 */
export type TenantScopedOperation<Result> = (
  context: FinancialContext,
) => Promise<Result>;

/**
 * Resolves authentication and membership exactly once for an operation.
 * `requestedHouseholdId`, when present, is only a server-side selection hint;
 * `requireFinancialContext` revalidates it against persisted memberships.
 */
export async function withFinancialContext<Result>(
  operation: TenantScopedOperation<Result>,
  options: RequireFinancialContextOptions = {},
): Promise<Result> {
  if (typeof operation !== "function") {
    throw new TypeError("Uma operação tenant-scoped deve ser uma função.");
  }

  const context = await requireFinancialContext(options);
  assertFinancialContext(context);
  return operation(context);
}

/** Alias that makes the server-only nature explicit at call sites. */
export const withRequiredFinancialContext = withFinancialContext;
