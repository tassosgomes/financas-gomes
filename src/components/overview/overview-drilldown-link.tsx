import Link from "next/link";

import { cn } from "@/lib/utils";

export interface OverviewDrilldownLinkProps {
  /** Server-authorized href; callers never construct it from opaque IDs. */
  href: string;
  label: string;
  /** Descriptive label for assistive tech, e.g. "Ver todas as despesas do período". */
  ariaLabel?: string;
  className?: string;
  testId?: string;
}

/**
 * Accessible drill-down link with a minimum ~44px touch target on mobile.
 */
export function OverviewDrilldownLink({
  ariaLabel,
  className,
  href,
  label,
  testId = "overview-drilldown-link",
}: OverviewDrilldownLinkProps) {
  return (
    <Link
      aria-label={ariaLabel ?? label}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center rounded-md px-3 py-2 text-sm font-medium",
        "underline-offset-4 hover:bg-accent hover:underline",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      data-testid={testId}
      href={href}
    >
      {label}
    </Link>
  );
}
