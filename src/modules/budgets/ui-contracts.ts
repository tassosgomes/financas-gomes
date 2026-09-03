import type {
  BudgetBalanceBoundary,
  BudgetBoundary,
  BudgetErrorCode,
  BudgetGoalBoundary,
  BudgetMovementBoundary,
  BudgetPeriodBoundary,
  BudgetProgressBoundary,
  BudgetStatus,
} from "./contracts";

/**
 * Presentation boundary for S09. The server supplies the read models and the
 * labels; this module does not expose domain objects or client authority.
 */

export type BudgetListItemDTO = BudgetBoundary;

export interface BudgetListDTO {
  readonly items: readonly BudgetListItemDTO[];
  readonly nextCursor: string | null;
}

export type BudgetDetailDTO = {
  readonly budget: BudgetBoundary;
  readonly balance: BudgetBalanceBoundary;
  readonly period: BudgetPeriodBoundary;
  readonly movements: readonly BudgetMovementBoundary[];
  readonly progress: BudgetProgressBoundary;
  readonly spendableImpact: BudgetSpendableImpactDTO;
};

export type BudgetBalanceDTO = BudgetBalanceBoundary;
export type BudgetMovementDTO = BudgetMovementBoundary;
export type BudgetGoalDTO = BudgetGoalBoundary;
export type BudgetProgressDTO = BudgetProgressBoundary;
export type BudgetPeriodDTO = BudgetPeriodBoundary;
export type BudgetStatusDTO = Pick<BudgetBoundary, "status">;

export interface BudgetSpendableImpactDTO {
  readonly contractVersion: "s09.v1";
  readonly status: "AVAILABLE" | "UNAVAILABLE";
  readonly protectedCents: string;
  readonly appliedOpeningAdjustmentCents: string;
  /** The serializable component summary exposed by S08's public read model. */
  readonly components: readonly BudgetSpendableImpactComponentDTO[];
}

export interface BudgetSpendableImpactComponentDTO {
  readonly referenceId: string;
  readonly amountCents: string;
  readonly effectiveOn: string;
}

export type BudgetLifecycleState = "active" | "closed";
export type BudgetBalancePosition = "positive" | "zero" | "negative";
export type BudgetGoalState = "configured" | "without-goal";

export interface BudgetStatusViewModel {
  readonly status: BudgetStatus;
  readonly state: BudgetLifecycleState;
  readonly label: string;
}

export interface BudgetListItemViewModel extends BudgetListItemDTO {
  readonly statusView: BudgetStatusViewModel;
  readonly goalState: BudgetGoalState;
  readonly activeFromLabel: string;
  readonly closedOnLabel: string | null;
}

export interface BudgetListViewModel {
  /** Original server response; presentation adds labels without changing it. */
  readonly list: BudgetListDTO;
  readonly items: readonly BudgetListItemViewModel[];
}

export interface BudgetBalanceViewModel extends BudgetBalanceDTO {
  readonly position: BudgetBalancePosition;
  readonly asOfLabel: string;
  readonly balanceLabel: string;
  readonly protectedAmountLabel: string;
  readonly contributionLabel: string;
  readonly withdrawalLabel: string;
}

export interface BudgetMovementViewModel extends BudgetMovementDTO {
  readonly kindLabel: string;
  readonly effectiveOnLabel: string;
  /** Signed display impact; the server remains the authority for the amount. */
  readonly impactLabel: string;
}

export type BudgetGoalViewModel =
  | {
      readonly state: "configured";
      readonly goal: BudgetGoalDTO;
      readonly targetAmountLabel: string;
      readonly targetDateLabel: string;
    }
  | {
      readonly state: "without-goal";
      readonly goal: null;
      readonly targetAmountLabel: null;
      readonly targetDateLabel: null;
    };

export interface BudgetProgressViewModel extends BudgetProgressDTO {
  readonly targetAmountLabel: string | null;
  readonly targetDateLabel: string | null;
  readonly progressLabel: string;
  readonly remainingLabel: string;
  readonly suggestedMonthlyLabel: string | null;
  readonly statusLabel: string;
  readonly paceStatusLabel: string;
}

export interface BudgetPeriodViewModel extends BudgetPeriodDTO {
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly rolloverLabel: string;
  readonly openingBalanceLabel: string;
  readonly closingBalanceLabel: string;
  readonly contributionLabel: string;
  readonly withdrawalLabel: string;
  readonly netChangeLabel: string;
}

export type BudgetSpendableImpactViewModel =
  | (BudgetSpendableImpactDTO & {
      readonly status: "AVAILABLE";
      readonly availability: "available";
      readonly protectedAmountLabel: string;
      readonly appliedOpeningAdjustmentLabel: string;
    })
  | (BudgetSpendableImpactDTO & {
      readonly status: "UNAVAILABLE";
      readonly availability: "unavailable";
      readonly protectedAmountLabel: null;
      readonly appliedOpeningAdjustmentLabel: null;
      readonly message: string;
    });

export interface BudgetDetailViewModel {
  /** Original server response; no financial value is derived in this layer. */
  readonly detail: BudgetDetailDTO;
  readonly status: BudgetStatusViewModel;
  readonly balance: BudgetBalanceViewModel;
  readonly goal: BudgetGoalViewModel;
  readonly progress: BudgetProgressViewModel;
  readonly period: BudgetPeriodViewModel;
  readonly movements: readonly BudgetMovementViewModel[];
  readonly spendableImpact: BudgetSpendableImpactViewModel;
}

export interface BudgetOpaqueErrorViewModel {
  readonly code: BudgetErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export interface BudgetProviderUnavailableViewModel {
  readonly state: "provider-unavailable";
  readonly code: "PROVIDER_UNAVAILABLE";
  readonly message: string;
}

type ActiveBudgetDetail = BudgetDetailViewModel & {
  readonly status: BudgetStatusViewModel & { readonly state: "active" };
};

type ClosedBudgetDetail = BudgetDetailViewModel & {
  readonly status: BudgetStatusViewModel & { readonly state: "closed" };
};

type NegativeBudgetDetail = BudgetDetailViewModel & {
  readonly balance: BudgetBalanceViewModel & {
    readonly position: "negative";
  };
};

type NoGoalBudgetDetail = BudgetDetailViewModel & {
  readonly goal: Extract<BudgetGoalViewModel, { readonly state: "without-goal" }>;
};

/** Data states remain discriminated even when status, balance and goal vary independently. */
export type BudgetDetailDataState =
  | { readonly state: "active"; readonly data: ActiveBudgetDetail }
  | { readonly state: "closed"; readonly data: ClosedBudgetDetail }
  | { readonly state: "negative"; readonly data: NegativeBudgetDetail }
  | { readonly state: "without-goal"; readonly data: NoGoalBudgetDetail };

export type BudgetReadModelState<T> =
  | { readonly state: "loading" }
  | { readonly state: "empty" }
  | { readonly state: "error"; readonly error: BudgetOpaqueErrorViewModel }
  | {
      readonly state: "provider-unavailable";
      readonly provider: BudgetProviderUnavailableViewModel;
    }
  | { readonly state: "data"; readonly data: T };

export type BudgetListReadState = BudgetReadModelState<BudgetListViewModel>;
export type BudgetDetailReadState = BudgetReadModelState<BudgetDetailDataState>;
