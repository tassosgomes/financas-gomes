import type { SpendableBreakdown } from "@/modules/spendable/contracts";
import type {
  SpendableBreakdownViewModel,
  SpendableReadModelState,
} from "@/modules/spendable/ui-contracts";

import { SpendableBreakdownView } from "./spendable-breakdown";
import { SpendableCard } from "./spendable-card";

export interface SpendableReadModelProps {
  breakdown?: SpendableBreakdown | SpendableBreakdownViewModel | null;
  state?: SpendableReadModelState;
  error?: unknown;
  retryHref?: string;
  detailsHref?: string;
  detailsLabel?: string;
  getOriginHref?: React.ComponentProps<typeof SpendableBreakdownView>["getOriginHref"];
  sourceHrefs?: React.ComponentProps<typeof SpendableBreakdownView>["sourceHrefs"];
  returnHref?: string;
  testId?: string;
  className?: string;
  showBreakdown?: boolean;
}

/**
 * Optional shared composition for routes.  It owns no data access and does
 * not turn a read model into a new financial calculation.
 */
export function SpendableReadModel({
  breakdown,
  className,
  detailsHref,
  detailsLabel,
  error,
  getOriginHref,
  retryHref,
  returnHref,
  showBreakdown = false,
  sourceHrefs,
  state,
  testId = "spendable-read-model",
}: SpendableReadModelProps) {
  return (
    <div className={className} data-testid={testId}>
      <SpendableCard
        breakdown={breakdown}
        detailsHref={detailsHref}
        detailsLabel={detailsLabel}
        error={error}
        retryHref={retryHref}
        state={state}
        testId={`${testId}-card`}
      />
      {showBreakdown ? (
        <SpendableBreakdownView
          breakdown={breakdown}
          error={error}
          getOriginHref={getOriginHref}
          retryHref={retryHref}
          returnHref={returnHref}
          sourceHrefs={sourceHrefs}
          state={state}
          testId={`${testId}-breakdown`}
        />
      ) : null}
    </div>
  );
}

export const AvailableToSpendReadModel = SpendableReadModel;

