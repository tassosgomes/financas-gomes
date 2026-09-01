import Link from "next/link";

import { cn } from "@/lib/utils";
import type {
  ForecastCertainty as ForecastCertaintyValue,
  ForecastDirection as ForecastDirectionValue,
  ForecastItemStatus,
  ForecastSource as ForecastSourceValue,
  ForecastSourceKind,
} from "@/modules/forecast/contracts";
import {
  FORECAST_CERTAINTY_LABELS,
  FORECAST_DIRECTION_LABELS,
  FORECAST_ITEM_STATUS_LABELS,
  FORECAST_SOURCE_KIND_LABELS,
} from "@/modules/forecast/ui-contracts";

export interface ForecastBadgeProps {
  label: string;
  tone?: "neutral" | "positive" | "warning" | "muted";
  className?: string;
  testId?: string;
}

const TONE_CLASSES: Record<NonNullable<ForecastBadgeProps["tone"]>, string> = {
  neutral: "bg-sky-100 text-sky-900",
  positive: "bg-emerald-100 text-emerald-900",
  warning: "bg-amber-100 text-amber-950",
  muted: "bg-secondary text-muted-foreground",
};

/** Small text-first badge; meaning never relies on color alone. */
export function ForecastBadge({
  className,
  label,
  testId,
  tone = "neutral",
}: ForecastBadgeProps) {
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

export interface ForecastCertaintyBadgeProps {
  certainty: ForecastCertaintyValue;
  className?: string;
  testId?: string;
}

export function ForecastCertaintyBadge({
  certainty,
  className,
  testId = "forecast-certainty-badge",
}: ForecastCertaintyBadgeProps) {
  const tone = certainty === "REALIZED" ? "positive" : certainty === "EXPECTED" ? "warning" : "neutral";
  const label = FORECAST_CERTAINTY_LABELS[certainty];
  return (
    <ForecastBadge
      className={className}
      label={`Certeza: ${label}`}
      testId={testId}
      tone={tone}
    />
  );
}

export interface ForecastStatusBadgeProps {
  status: ForecastItemStatus;
  className?: string;
  testId?: string;
}

export function ForecastStatusBadge({
  className,
  status,
  testId = "forecast-status-badge",
}: ForecastStatusBadgeProps) {
  const tone = status === "POSTED" ? "positive" : status === "EXPECTED" ? "warning" : "muted";
  return (
    <ForecastBadge
      className={className}
      label={`Estado: ${FORECAST_ITEM_STATUS_LABELS[status]}`}
      testId={testId}
      tone={tone}
    />
  );
}

export interface ForecastDirectionBadgeProps {
  direction: ForecastDirectionValue;
  className?: string;
  testId?: string;
}

export function ForecastDirectionBadge({
  className,
  direction,
  testId = "forecast-direction-badge",
}: ForecastDirectionBadgeProps) {
  return (
    <ForecastBadge
      className={className}
      label={`Tipo: ${FORECAST_DIRECTION_LABELS[direction]}`}
      testId={testId}
      tone={direction === "INFLOW" ? "positive" : "warning"}
    />
  );
}

export interface ForecastSourceBadgeProps {
  source: Pick<ForecastSourceValue, "kind"> | ForecastSourceKind;
  className?: string;
  testId?: string;
}

export function ForecastSourceBadge({
  className,
  source,
  testId = "forecast-source-badge",
}: ForecastSourceBadgeProps) {
  const kind = typeof source === "string" ? source : source.kind;
  return (
    <ForecastBadge
      className={className}
      label={`Origem: ${FORECAST_SOURCE_KIND_LABELS[kind]}`}
      testId={testId}
      tone={kind === "REALIZED_EVENT" ? "positive" : "neutral"}
    />
  );
}

export interface ForecastOriginLinkProps {
  /** A server-authorized href; callers do not construct it from referenceId. */
  href: string;
  label?: string;
  returnHref?: string;
  className?: string;
  testId?: string;
}

/** Accessible drill-down link with an optional return path to the projection. */
export function ForecastOriginLink({
  className,
  href,
  label = "Ver origem",
  returnHref,
  testId = "forecast-origin-link",
}: ForecastOriginLinkProps) {
  const separator = href.includes("?") ? "&" : "?";
  const target = returnHref
    ? `${href}${separator}returnTo=${encodeURIComponent(returnHref)}`
    : href;

  return (
    <Link
      aria-label={`${label} do compromisso`}
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

export const ForecastCertainty = ForecastCertaintyBadge;
export const ForecastStatus = ForecastStatusBadge;
export const ForecastSource = ForecastSourceBadge;
export const ForecastDirection = ForecastDirectionBadge;
export const ForecastOrigin = ForecastOriginLink;
