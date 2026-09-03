import type { ReactNode } from "react";

import type { OverviewBlockState } from "@/modules/overview/ui-contracts";
import { cn } from "@/lib/utils";

import { OverviewDrilldownLink } from "./overview-drilldown-link";
import {
  OverviewEmptyState,
  OverviewErrorState,
  OverviewLoadingState,
} from "./overview-states";

export interface OverviewSectionCardProps {
  title: string;
  description?: string;
  state: OverviewBlockState;
  testId: string;
  drillDownHref?: string;
  drillDownLabel?: string;
  drillDownAriaLabel?: string;
  error?: unknown;
  retryHref?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  loadingLabel?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * Section card with independent block state.  Ready content is passed as
 * children; loading, empty and error never fabricate monetary values.
 */
export function OverviewSectionCard({
  children,
  className,
  description,
  drillDownAriaLabel,
  drillDownHref,
  drillDownLabel,
  emptyDescription,
  emptyTitle,
  error,
  loadingLabel,
  retryHref,
  state,
  testId,
  title,
}: OverviewSectionCardProps) {
  const titleId = `${testId}-title`;
  const descriptionId = description ? `${testId}-description` : undefined;

  if (state === "loading") {
    return (
      <section
        aria-busy="true"
        aria-labelledby={titleId}
        className={cn("space-y-4", className)}
        data-testid={testId}
      >
        <header>
          <h2 className="text-lg font-semibold" id={titleId}>{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground" id={descriptionId}>
              {description}
            </p>
          ) : null}
        </header>
        <OverviewLoadingState
          label={loadingLabel}
          testId={`${testId}-loading`}
        />
      </section>
    );
  }

  if (state === "error") {
    return (
      <section
        aria-labelledby={titleId}
        className={cn("space-y-4", className)}
        data-testid={testId}
      >
        <header>
          <h2 className="text-lg font-semibold" id={titleId}>{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground" id={descriptionId}>
              {description}
            </p>
          ) : null}
        </header>
        <OverviewErrorState
          error={error}
          retryHref={retryHref}
          testId={`${testId}-error`}
        />
      </section>
    );
  }

  if (state === "empty") {
    return (
      <section
        aria-labelledby={titleId}
        className={cn("space-y-4", className)}
        data-testid={testId}
      >
        <header>
          <h2 className="text-lg font-semibold" id={titleId}>{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground" id={descriptionId}>
              {description}
            </p>
          ) : null}
        </header>
        <OverviewEmptyState
          description={emptyDescription}
          testId={`${testId}-empty`}
          title={emptyTitle}
        />
      </section>
    );
  }

  return (
    <section
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={cn(
        "space-y-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5",
        className,
      )}
      data-testid={testId}
    >
      <header className="flex flex-col gap-3 min-w-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold break-words" id={titleId}>
            {title}
          </h2>
          {description ? (
            <p
              className="mt-1 text-sm leading-6 text-muted-foreground break-words"
              id={descriptionId}
            >
              {description}
            </p>
          ) : null}
        </div>
        {drillDownHref && drillDownLabel ? (
          <OverviewDrilldownLink
            ariaLabel={drillDownAriaLabel}
            className="shrink-0 self-start"
            href={drillDownHref}
            label={drillDownLabel}
            testId={`${testId}-drilldown`}
          />
        ) : null}
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
