"use client";

import { useEffect, useRef } from "react";

import type { ReactNode } from "react";

import type {
  BudgetBalanceViewModel,
  BudgetMovementViewModel,
  BudgetProgressViewModel,
  BudgetReadModelState,
  BudgetSpendableImpactViewModel,
  BudgetStatusViewModel,
} from "@/modules/budgets/ui-contracts";

export type {
  BudgetBalanceViewModel,
  BudgetMovementViewModel,
  BudgetProgressViewModel,
  BudgetReadModelState,
  BudgetSpendableImpactViewModel,
  BudgetStatusViewModel,
} from "@/modules/budgets/ui-contracts";

export type BudgetStateViewProps<T> = {
  state: BudgetReadModelState<T>;
  renderData: (data: T) => ReactNode;
  title?: string;
  testId?: string;
};

export function BudgetStateView<T>({
  state,
  renderData,
  title,
  testId,
}: BudgetStateViewProps<T>) {
  const heading = title ? <h2>{title}</h2> : null;

  if (state.state === "loading") {
    return (
      <section
        aria-busy="true"
        aria-live="polite"
        role="status"
        data-testid={testId}
      >
        {heading}
        <p>Carregando orçamento…</p>
      </section>
    );
  }

  if (state.state === "empty") {
    return (
      <section data-testid={testId}>
        {heading}
        <h3>Nenhum orçamento encontrado</h3>
        <p>Não há dados de orçamento para exibir.</p>
      </section>
    );
  }

  if (state.state === "error") {
    return (
      <section role="alert" data-testid={testId}>
        {heading}
        <h3>Não foi possível carregar o orçamento</h3>
        <p>O orçamento não está disponível no momento. Tente novamente.</p>
      </section>
    );
  }

  if (state.state === "provider-unavailable") {
    return (
      <section role="alert" data-testid={testId}>
        {heading}
        <h3>Provedor indisponível</h3>
        <p>O provedor de orçamento está indisponível no momento.</p>
      </section>
    );
  }

  return (
    <section data-testid={testId}>
      {heading}
      {renderData(state.data)}
    </section>
  );
}

export function BudgetStatusBadge({
  status,
}: {
  status: BudgetStatusViewModel;
}) {
  return (
    <span aria-label={`${status.label}: ${status.state}`}>
      <span>{status.label}</span>
      <span className="sr-only">{status.state}</span>
    </span>
  );
}

export function BudgetBalanceCard({
  balance,
}: {
  balance: BudgetBalanceViewModel;
}) {
  const positionText = {
    negative: "Déficit: a proteção está zerada neste corte.",
    zero: "Saldo zerado neste corte.",
    positive: "Saldo positivo neste corte.",
  }[balance.position];

  return (
    <section data-position={balance.position}>
      <h2>Balanço</h2>
      <dl>
        <div>
          <dt>Saldo</dt>
          <dd>{balance.balanceLabel}</dd>
        </div>
        <div>
          <dt>Protegido</dt>
          <dd>{balance.protectedAmountLabel}</dd>
        </div>
        <div>
          <dt>Aportes</dt>
          <dd>{balance.contributionLabel}</dd>
        </div>
        <div>
          <dt>Retiradas</dt>
          <dd>{balance.withdrawalLabel}</dd>
        </div>
      </dl>
      <p>{positionText}</p>
      {!balance.activeAtCutoff && (
        <p>Não há proteção ativa no corte.</p>
      )}
    </section>
  );
}

export function BudgetMovementRow({
  movement,
}: {
  movement: BudgetMovementViewModel;
}) {
  return (
    <li>
      <span>{movement.kindLabel}</span>
      <span>{movement.impactLabel}</span>
      <time dateTime={movement.effectiveOn}>{movement.effectiveOnLabel}</time>
    </li>
  );
}

export function BudgetMovementList({
  movements,
}: {
  movements: readonly BudgetMovementViewModel[];
}) {
  return movements.length === 0 ? (
    <section aria-label="Movimentos do orçamento">
      <h2>Movimentos</h2>
      <p>Nenhum movimento de orçamento.</p>
    </section>
  ) : (
    <section aria-label="Movimentos do orçamento">
      <h2>Movimentos</h2>
      <ul>
        {movements.map((movement) => (
          <BudgetMovementRow key={movement.referenceId} movement={movement} />
        ))}
      </ul>
    </section>
  );
}

export function BudgetProgressCard({
  progress,
}: {
  progress: BudgetProgressViewModel;
}) {
  if (progress.targetAmountCents === null || progress.targetDate === null) {
    return (
      <section>
        <h2>Progresso do orçamento</h2>
        <p>Meta não configurada.</p>
      </section>
    );
  }

  // progressBps is computed by the server; this conversion only adapts the
  // serializable read model to the native progress element's DOM API.
  const progressValue = Number(progress.progressBps);

  return (
    <section>
      <h2>Progresso do orçamento</h2>
      <dl>
        <div>
          <dt>Meta</dt>
          <dd>{progress.targetAmountLabel}</dd>
        </div>
        <div>
          <dt>Data da meta</dt>
          <dd>{progress.targetDateLabel}</dd>
        </div>
        <div>
          <dt>Progresso</dt>
          <dd>{progress.progressLabel}</dd>
        </div>
        <div>
          <dt>Restante</dt>
          <dd>{progress.remainingLabel}</dd>
        </div>
        <div>
          <dt>Sugerido por mês</dt>
          <dd>{progress.suggestedMonthlyLabel ?? "Não há sugestão."}</dd>
        </div>
      </dl>
      <progress
        aria-label="Progresso da meta"
        aria-valuemax={10000}
        aria-valuenow={progressValue}
        max={10000}
        value={progressValue}
      />
      <p>{progress.statusLabel}</p>
      <p>{progress.paceStatusLabel}</p>
    </section>
  );
}

export type BudgetCloseConfirmationProps = {
  open: boolean;
  title: string;
  description: string;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  titleId?: string;
  descriptionId?: string;
  testId?: string;
};

export function BudgetCloseConfirmation({
  open,
  title,
  description,
  children,
  onConfirm,
  onCancel,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  confirmDisabled = false,
  titleId = "budget-close-title",
  descriptionId = "budget-close-description",
  testId = "budget-close-confirmation",
}: BudgetCloseConfirmationProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmedRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (open) {
      confirmedRef.current = false;
      cancelledRef.current = false;
      (dialogRef.current ?? cancelRef.current)?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !cancelledRef.current) {
        event.preventDefault();
        cancelledRef.current = true;
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const handleConfirm = () => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    onConfirm();
  };

  return (
    <div
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      data-testid={testId}
      ref={dialogRef}
      role="alertdialog"
      tabIndex={-1}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      {children}
      <button disabled={confirmDisabled} type="button" onClick={handleConfirm}>
        {confirmLabel}
      </button>
      <button ref={cancelRef} type="button" onClick={onCancel}>
        {cancelLabel}
      </button>
    </div>
  );
}

export function BudgetSpendableImpactMessage({
  impact,
}: {
  impact: BudgetSpendableImpactViewModel;
}) {
  if (impact.status === "UNAVAILABLE") {
    return (
      <div role="alert">
        <p>O provedor está indisponível; o impacto disponível não pode ser exibido.</p>
        <p>{impact.message}</p>
      </div>
    );
  }

  return (
    <div aria-live="polite" role="status">
      <p>Impacto na disponibilidade para gastar</p>
      <p>Protegido: {impact.protectedAmountLabel}</p>
      <p>Ajuste aplicado na abertura: {impact.appliedOpeningAdjustmentLabel}</p>
    </div>
  );
}
