import type { OverviewBlockState } from "@/modules/overview/ui-contracts";
import { cn } from "@/lib/utils";

export interface OverviewValueItemProps {
  label: string;
  valueLabel: string;
  dateLabel?: string;
  state?: OverviewBlockState;
  testId?: string;
  className?: string;
}

/**
 * List row with label and formatted value.  Never receives numeric money —
 * only pre-formatted labels from view models.
 */
export function OverviewValueItem({
  className,
  dateLabel,
  label,
  state = "ready",
  testId = "overview-value-item",
  valueLabel,
}: OverviewValueItemProps) {
  if (state === "loading") {
    return (
      <div
        aria-busy="true"
        aria-label={`Carregando ${label}`}
        className={cn(
          "flex min-w-0 items-center justify-between gap-3 rounded-lg border bg-background px-3 py-3",
          className,
        )}
        data-testid={`${testId}-loading`}
        role="status"
      >
        <div className="min-w-0 space-y-2">
          <div className="h-4 w-32 max-w-full rounded bg-muted" />
          {dateLabel ? <div className="h-3 w-20 max-w-full rounded bg-muted" /> : null}
        </div>
        <div className="h-5 w-24 shrink-0 rounded bg-muted" />
      </div>
    );
  }

  if (state === "empty") {
    return (
      <p
        className={cn("text-sm text-muted-foreground", className)}
        data-testid={`${testId}-empty`}
      >
        Sem itens para {label}.
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
        Não foi possível carregar {label}.
      </p>
    );
  }

  return (
    <div
      className={cn(
        "flex min-w-0 items-start justify-between gap-3 rounded-lg border bg-background px-3 py-3",
        className,
      )}
      data-testid={testId}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium break-words">{label}</p>
        {dateLabel ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{dateLabel}</p>
        ) : null}
      </div>
      <p
        className="shrink-0 text-sm font-semibold tabular-nums"
        data-testid={`${testId}-value`}
      >
        {valueLabel}
      </p>
    </div>
  );
}
