import Link from "next/link";

import type { SpendableBreakdown } from "@/modules/spendable/contracts";
import {
  toSpendableBreakdownViewModel,
  type SpendableBreakdownViewModel,
  type SpendableReadModelState,
} from "@/modules/spendable/ui-contracts";
import { cn } from "@/lib/utils";

import {
  SpendableEmptyState,
  SpendableErrorState,
  SpendableLoadingState,
} from "./spendable-states";

export interface SpendableCardProps {
  /** Read model produced by the server; no balance is calculated here. */
  breakdown?: SpendableBreakdown | SpendableBreakdownViewModel | null;
  state?: SpendableReadModelState;
  error?: unknown;
  retryHref?: string;
  /** Server-authorized route for the detailed breakdown. */
  detailsHref?: string;
  detailsLabel?: string;
  testId?: string;
  className?: string;
}

function toViewModel(
  value: SpendableCardProps["breakdown"],
): SpendableBreakdownViewModel | null {
  if (!value) return null;
  return "breakdown" in value ? value : toSpendableBreakdownViewModel(value);
}

/**
 * Shared highlight card.  It consumes the display/raw/deficit fields returned
 * by the engine and only chooses accessible copy for their already-defined
 * states.  It never adds, subtracts or clamps monetary values.
 */
export function SpendableCard({
  breakdown,
  className,
  detailsHref,
  detailsLabel = "Ver composição do disponível para gastar",
  error,
  retryHref,
  state,
  testId = "spendable-card",
}: SpendableCardProps) {
  const model = toViewModel(breakdown);
  const resolvedState: SpendableReadModelState =
    state ?? (model ? "ready" : "empty");

  if (resolvedState === "loading") {
    return <SpendableLoadingState testId={`${testId}-loading`} />;
  }

  if (resolvedState === "error") {
    return (
      <SpendableErrorState
        error={error}
        retryHref={retryHref}
        testId={`${testId}-error`}
      />
    );
  }

  if (resolvedState === "empty" || !model) {
    return <SpendableEmptyState testId={`${testId}-empty`} />;
  }

  const { breakdown: readModel } = model;
  const isDeficit = model.availabilityStatus === "deficit";
  const isZero = model.availabilityStatus === "zero";
  const displayLabel = model.displaySpendableLabel;
  const rawLabel = model.rawSpendableLabel;
  const statusLabel = isDeficit
    ? "Déficit"
    : isZero
      ? "Zero disponível"
      : "Disponível";

  return (
    <section
      aria-describedby={`${testId}-description`}
      aria-labelledby={`${testId}-title`}
      className={cn(
        "space-y-5 rounded-2xl border bg-card p-5 shadow-sm sm:p-6",
        className,
      )}
      data-state={model.availabilityStatus}
      data-testid={testId}
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Disponibilidade para gastar
          </p>
          <h2 className="mt-1 text-xl font-semibold" id={`${testId}-title`}>
            Quanto pode gastar
          </h2>
          <p
            className="mt-1 text-sm leading-6 text-muted-foreground"
            id={`${testId}-description`}
          >
            Cenário {model.scenarioLabel} · referência em {model.asOfLabel} ·
            horizonte de {model.horizonLabel}.
          </p>
        </div>
        <span
          aria-label={`Estado da disponibilidade: ${statusLabel}`}
          className="self-start"
        >
          <span className="sr-only">Estado: </span>
          {statusLabel}
        </span>
      </header>

      <div
        aria-label={`Pode gastar: ${displayLabel}`}
        className="rounded-xl border bg-background px-4 py-5 sm:px-5"
        data-testid={`${testId}-primary-value`}
      >
        <p className="text-sm font-medium text-muted-foreground">Pode gastar</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
          {displayLabel}
        </p>
        {isDeficit ? (
          <p
            className="mt-3 text-sm font-medium text-destructive"
            data-testid={`${testId}-deficit`}
          >
            Déficit para preservar a reserva: {model.deficitToPreserveReserveLabel}
          </p>
        ) : null}
        {isZero ? (
          <p className="mt-3 text-sm text-muted-foreground" data-testid={`${testId}-zero`}>
            O valor bruto alcança exatamente o limite de proteção; zero não é
            um erro nem um déficit.
          </p>
        ) : null}
      </div>

      <dl
        aria-label="Referências do cálculo de disponibilidade"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="rounded-lg border bg-background px-3 py-2">
          <dt className="text-xs text-muted-foreground">Período</dt>
          <dd className="mt-1 text-sm font-medium">{model.periodLabel}</dd>
        </div>
        <div className="rounded-lg border bg-background px-3 py-2">
          <dt className="text-xs text-muted-foreground">Menor saldo projetado</dt>
          <dd className="mt-1 text-sm font-medium tabular-nums">
            {model.minimumProjectedBalanceLabel}
          </dd>
        </div>
        <div className="rounded-lg border bg-background px-3 py-2">
          <dt className="text-xs text-muted-foreground">Buffer operacional</dt>
          <dd className="mt-1 text-sm font-medium tabular-nums">
            {model.bufferAmountLabel}
          </dd>
          <dd className="text-xs text-muted-foreground">{model.bufferSourceLabel}</dd>
          <dd className="text-xs text-muted-foreground">
            Vigente desde {model.bufferEffectiveFromLabel}
          </dd>
        </div>
        <div className="rounded-lg border bg-background px-3 py-2">
          <dt className="text-xs text-muted-foreground">Resultado bruto</dt>
          <dd className="mt-1 text-sm font-medium tabular-nums">{rawLabel}</dd>
        </div>
      </dl>

      <p className="text-xs leading-5 text-muted-foreground">
        Regra {readModel.ruleVersion}. O valor exibido e o bruto são campos
        fornecidos pelo servidor; esta apresentação não recalcula o saldo.
      </p>

      {detailsHref ? (
        <Link
          className="inline-flex min-h-10 items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={`${testId}-details-link`}
          href={detailsHref}
        >
          {detailsLabel}
        </Link>
      ) : null}
    </section>
  );
}

export const SpendableSummaryCard = SpendableCard;
export const AvailableToSpendCard = SpendableCard;
