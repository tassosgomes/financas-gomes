import type { ForecastTimeline } from "@/modules/forecast/contracts";
import type {
  ForecastReadModelState,
  ForecastTimelineViewModel,
} from "@/modules/forecast/ui-contracts";

import {
  ForecastPeriodSelector,
  type ForecastPeriodSelectorProps,
} from "./forecast-period-selector";
import {
  ForecastSummary,
} from "./forecast-summary";
import {
  ForecastTimelineView,
  type ForecastTimelineProps,
} from "./forecast-timeline";

export interface ForecastReadModelProps {
  timeline?: ForecastTimeline | ForecastTimelineViewModel | null;
  state?: ForecastReadModelState;
  error?: unknown;
  retryHref?: string;
  periodSelector?: ForecastPeriodSelectorProps;
  showPeriodSelector?: boolean;
  getSourceHref?: ForecastTimelineProps["getSourceHref"];
  sourceHrefs?: ForecastTimelineProps["sourceHrefs"];
  returnHref?: string;
  successMessage?: string;
  testId?: string;
  className?: string;
}

/**
 * Optional composition used by S09/S10 routes.  It composes shared islands
 * only; no route, database access or forecast rule lives in this component.
 */
export function ForecastReadModel({
  className,
  error,
  getSourceHref,
  periodSelector,
  retryHref,
  returnHref,
  showPeriodSelector = false,
  sourceHrefs,
  state,
  successMessage,
  testId = "forecast-read-model",
  timeline,
}: ForecastReadModelProps) {
  return (
    <div className={className} data-testid={testId}>
      {showPeriodSelector && periodSelector ? (
        <ForecastPeriodSelector {...periodSelector} />
      ) : null}
      <div className="mt-5 space-y-5">
        <ForecastSummary
          error={error}
          retryHref={retryHref}
          state={state}
          successMessage={successMessage}
          testId={`${testId}-summary`}
          timeline={timeline}
        />
        <ForecastTimelineView
          error={error}
          getSourceHref={getSourceHref}
          retryHref={retryHref}
          returnHref={returnHref}
          sourceHrefs={sourceHrefs}
          state={state}
          testId={`${testId}-timeline`}
          timeline={timeline}
        />
      </div>
    </div>
  );
}

export {
  ForecastCertaintyBadge,
  ForecastDirectionBadge,
  ForecastOriginLink,
  ForecastSourceBadge,
  ForecastStatusBadge,
} from "./forecast-badges";
export type {
  ForecastBadgeProps,
  ForecastCertaintyBadgeProps,
  ForecastDirectionBadgeProps,
  ForecastOriginLinkProps,
  ForecastSourceBadgeProps,
  ForecastStatusBadgeProps,
} from "./forecast-badges";
export {
  ForecastPeriodSelector,
  ForecastPeriodPicker,
  ForecastScenarioSelector,
  PeriodSelector,
} from "./forecast-period-selector";
export {
  ForecastSummary,
  ForecastProjectionSummary,
  ForecastSummaryCards,
} from "./forecast-summary";
export {
  ForecastDailyTimeline,
  ForecastTimeline,
  ForecastTimelineView,
} from "./forecast-timeline";
export {
  ForecastEmpty,
  ForecastEmptyState,
  ForecastError,
  ForecastErrorState,
  ForecastLoading,
  ForecastLoadingState,
} from "./forecast-states";
export type {
  ForecastEmptyStateProps,
  ForecastErrorStateProps,
  ForecastLoadingStateProps,
} from "./forecast-states";
