import Link from "next/link";

import { cn } from "@/lib/utils";

export interface SpendableBadgeProps {
  label: string;
  tone?: "neutral" | "positive" | "warning" | "muted";
  className?: string;
  testId?: string;
}

const TONE_CLASSES: Record<NonNullable<SpendableBadgeProps["tone"]>, string> = {
  neutral: "bg-sky-100 text-sky-900",
  positive: "bg-emerald-100 text-emerald-900",
  warning: "bg-amber-100 text-amber-950",
  muted: "bg-secondary text-muted-foreground",
};

/** Text-first badge: meaning never depends on color alone. */
export function SpendableBadge({
  className,
  label,
  testId,
  tone = "neutral",
}: SpendableBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
      data-testid={testId}
    >
      {label}
    </span>
  );
}

export interface SpendableOriginLinkProps {
  /** A server-authorized href; callers do not construct it from referenceId. */
  href: string;
  label?: string;
  returnHref?: string;
  className?: string;
  testId?: string;
}

/** Accessible drill-down link for a causal item. */
export function SpendableOriginLink({
  className,
  href,
  label = "Ver origem",
  returnHref,
  testId = "spendable-origin-link",
}: SpendableOriginLinkProps) {
  const separator = href.includes("?") ? "&" : "?";
  const target = returnHref
    ? `${href}${separator}returnTo=${encodeURIComponent(returnHref)}`
    : href;

  return (
    <Link
      aria-label={`${label} do item que influencia o saldo mínimo`}
      className={cn(
        "underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      data-testid={testId}
      href={target}
    >
      {label}
    </Link>
  );
}

export const SpendableOrigin = SpendableOriginLink;

