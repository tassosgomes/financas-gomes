import type { OverviewBlockState } from "@/modules/overview/ui-contracts";
import { cn } from "@/lib/utils";

export interface OverviewCategoryBarProps {
  label: string;
  percent: number;
  amountLabel: string;
  percentLabel: string;
  state?: OverviewBlockState;
  testId?: string;
  className?: string;
}

/**
 * Participation bar driven by server-supplied integer percent (0–100).
 * Width is set from percent only — no money-based calculation.
 */
export function OverviewCategoryBar({
  amountLabel,
  className,
  label,
  percent,
  percentLabel,
  state = "ready",
  testId = "overview-category-bar",
}: OverviewCategoryBarProps) {
  const clampedPercent = Math.max(0, Math.min(100, percent));

  if (state === "loading") {
    return (
      <div
        aria-busy="true"
        aria-label="Carregando categoria"
        className={cn("min-w-0 space-y-2", className)}
        data-testid={`${testId}-loading`}
        role="status"
      >
        <div className="flex justify-between gap-3">
          <div className="h-4 w-40 max-w-full rounded bg-muted" />
          <div className="h-4 w-16 shrink-0 rounded bg-muted" />
        </div>
        <div className="h-2 w-full rounded-full bg-muted" />
      </div>
    );
  }

  if (state === "empty") {
    return (
      <p
        className={cn("text-sm text-muted-foreground", className)}
        data-testid={`${testId}-empty`}
      >
        Sem categorias para exibir.
      </p>
    );
  }

  if (state === "error") {
    return (
      <p
        className={cn("text-sm text-destructive", className)}
        data-testid={`${testId}-error`}
        role="alert"
      >
        Não foi possível carregar as categorias.
      </p>
    );
  }

  return (
    <div
      aria-label={`${label}: ${percentLabel} do total, ${amountLabel}`}
      className={cn("min-w-0 space-y-2", className)}
      data-testid={testId}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium break-words">{label}</p>
        <div className="shrink-0 text-right text-sm tabular-nums">
          <span className="font-semibold">{amountLabel}</span>
          <span className="ml-2 text-muted-foreground">{percentLabel}</span>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
    </div>
  );
}
