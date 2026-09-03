import {
  OVERVIEW_STATE_BADGE_LABELS,
  type OverviewStateBadgeVariant,
} from "@/modules/overview/ui-contracts";
import { cn } from "@/lib/utils";

export interface OverviewStateBadgeProps {
  variant: OverviewStateBadgeVariant;
  className?: string;
  testId?: string;
}

const VARIANT_CLASSES: Record<OverviewStateBadgeVariant, string> = {
  normal: "bg-secondary text-secondary-foreground",
  attention: "bg-amber-100 text-amber-950",
  critical: "bg-destructive/15 text-destructive",
};

/**
 * Text-first severity badge.  Meaning is conveyed by label and color together.
 */
export function OverviewStateBadge({
  className,
  testId,
  variant,
}: OverviewStateBadgeProps) {
  const label = OVERVIEW_STATE_BADGE_LABELS[variant];
  return (
    <span
      aria-label={`Estado: ${label}`}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        VARIANT_CLASSES[variant],
        className,
      )}
      data-testid={testId}
    >
      {label}
    </span>
  );
}
