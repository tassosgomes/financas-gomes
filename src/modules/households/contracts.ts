/** Canonical persistence names. UI copy may call a household a “Espaço financeiro”. */
export const HOUSEHOLD_TABLE_NAME = "households" as const;
export const HOUSEHOLD_MEMBER_TABLE_NAME = "household_members" as const;
export const HOUSEHOLD_INVITE_TABLE_NAME = "household_invites" as const;

export interface Household {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface HouseholdMembership {
  householdId: string;
  userId: string;
  createdAt: Date;
}

export interface FinancialContext {
  userId: string;
  householdId: string;
}

/**
 * Input accepted by the server-side context resolver.
 * `requestedHouseholdId` is only a selection hint and must be checked against
 * the authenticated user's memberships before it can become active context.
 */
export interface HouseholdContextSelection {
  requestedHouseholdId?: string | null;
}

/**
 * Options accepted by the server guard. Request headers are used only to
 * read the Better Auth session; they never carry tenant authority.
 */
export interface RequireFinancialContextOptions
  extends HouseholdContextSelection {
  requestHeaders?: HeadersInit;
}

export const FINANCIAL_CONTEXT_ERROR_CODES = [
  "UNAUTHENTICATED",
  "HOUSEHOLD_MEMBERSHIP_REQUIRED",
  "HOUSEHOLD_SELECTION_REQUIRED",
  "INVALID_FINANCIAL_CONTEXT",
] as const;

export type FinancialContextErrorCode =
  (typeof FINANCIAL_CONTEXT_ERROR_CODES)[number];

export const FINANCIAL_CONTEXT_ERROR_MESSAGES: Record<
  FinancialContextErrorCode,
  string
> = {
  UNAUTHENTICATED: "É necessário entrar para acessar seu espaço financeiro.",
  HOUSEHOLD_MEMBERSHIP_REQUIRED:
    "Você não faz parte do espaço financeiro selecionado.",
  HOUSEHOLD_SELECTION_REQUIRED:
    "Selecione um espaço financeiro para continuar.",
  INVALID_FINANCIAL_CONTEXT:
    "Não foi possível validar seu espaço financeiro. Tente novamente.",
};

/** Expected, safe error for private tenancy boundaries. */
export class FinancialContextError extends Error {
  readonly code: FinancialContextErrorCode;
  readonly status: number;
  readonly expected = true;

  constructor(code: FinancialContextErrorCode) {
    super(FINANCIAL_CONTEXT_ERROR_MESSAGES[code]);
    this.name = "FinancialContextError";
    this.code = code;
    this.status =
      code === "UNAUTHENTICATED"
        ? 401
        : code === "INVALID_FINANCIAL_CONTEXT"
          ? 500
          : 403;
  }
}

export interface HouseholdContextResolver {
  resolve(
    userId: string,
    selection?: HouseholdContextSelection,
  ): Promise<FinancialContext>;
}
