"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import {
  getBudgetAction,
  registerContributionAction,
  registerWithdrawalAction,
  transferBetweenBudgetsAction,
} from "@/app/actions/budgets";
import { getSpendableAction } from "@/app/actions/spendable";
import {
  BudgetBalanceCard,
  BudgetMovementList,
  BudgetProgressCard,
  BudgetSpendableImpactMessage,
  BudgetStatusBadge,
} from "@/components/budgets/budget-components";
import {
  BudgetMovementForm,
  type BudgetMovementActionResult,
  type BudgetMovementFormMode,
  type BudgetMovementFormPayload,
  type BudgetTransferOption,
} from "@/components/budgets/budget-movement-form";
import {
  formatBudgetDate,
  formatBudgetMovementImpact,
  formatBudgetSignedCents,
} from "@/components/budgets/formatters";
import { ErrorState, SuccessFeedback } from "@/components/ui/async-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { generateUuidV7 } from "@/lib/uuidv7";
import type {
  BudgetError,
  BudgetMovementBoundary,
  BudgetResult,
  BudgetTransferBoundary,
} from "@/modules/budgets/contracts";
import type {
  BudgetDetailReadModel,
  BudgetReadResult,
} from "@/modules/budgets/read-contracts";
import type { SpendableBreakdown } from "@/modules/spendable/contracts";
import type { SpendableResult } from "@/modules/spendable/service";
import { toSpendableErrorViewModel } from "@/modules/spendable/ui-contracts";
import {
  BUDGETS_ROUTE,
  SPENDABLE_BREAKDOWN_ROUTE,
  budgetDetailRoute,
} from "@/modules/budgets/routes";
import type { BudgetSpendableImpactViewModel } from "@/modules/budgets/ui-contracts";

const DETAIL_PAGE_LIMIT = 50;

export interface BudgetDetailScreenProps {
  readonly initialDetail: BudgetDetailReadModel;
  readonly destinations?: readonly BudgetTransferOption[];
  readonly destinationError?: string | null;
  /** Result obtained by the authenticated S08 action on the server route. */
  readonly initialSpendable?: SpendableResult<SpendableBreakdown>;
  /** Server-authorized destination; the client never builds it from a ref. */
  readonly spendableHref?: string;
}

const unavailableSpendable: SpendableResult<SpendableBreakdown> = {
  ok: false,
  error: { code: "SPENDABLE_QUERY_FAILED", field: null },
};

function toSpendableImpactViewModel(
  result: SpendableResult<SpendableBreakdown>,
): BudgetSpendableImpactViewModel {
  if (!result.ok) {
    return {
      contractVersion: "s09.v1",
      status: "UNAVAILABLE",
      protectedCents: "0",
      appliedOpeningAdjustmentCents: "0",
      components: [],
      availability: "unavailable",
      protectedAmountLabel: null,
      appliedOpeningAdjustmentLabel: null,
      message: toSpendableErrorViewModel(result.error).message,
    };
  }

  const reserve = result.value.reserve;
  if (reserve.status === "UNAVAILABLE") {
    return {
      contractVersion: "s09.v1",
      status: "UNAVAILABLE",
      protectedCents: "0",
      appliedOpeningAdjustmentCents: "0",
      components: [],
      availability: "unavailable",
      protectedAmountLabel: null,
      appliedOpeningAdjustmentLabel: null,
      message: "O provider de reserva está indisponível no momento.",
    };
  }

  return {
    contractVersion: "s09.v1",
    status: "AVAILABLE",
    protectedCents: reserve.protectedCents,
    appliedOpeningAdjustmentCents: reserve.appliedOpeningAdjustmentCents,
    components: reserve.components.map((component) => ({
      referenceId: component.referenceId,
      amountCents: component.amountCents,
      effectiveOn: component.effectiveOn,
    })),
    availability: "available",
    protectedAmountLabel: formatBudgetSignedCents(reserve.protectedCents),
    appliedOpeningAdjustmentLabel: formatBudgetSignedCents(
      reserve.appliedOpeningAdjustmentCents,
    ),
  };
}

function safeUnexpectedError(): BudgetError {
  return {
    code: "QUERY_FAILED",
    message: "Não foi possível concluir a operação. Tente novamente.",
  };
}

function isZeroCents(value: string): boolean {
  return /^-?0+$/u.test(value);
}

function balancePosition(value: string): "positive" | "zero" | "negative" {
  if (value.startsWith("-")) return "negative";
  return isZeroCents(value) ? "zero" : "positive";
}

function progressBpsLabel(value: string): string {
  if (!/^\d+$/u.test(value)) return "Progresso indisponível";
  const digits = value.replace(/^0+(?=\d)/u, "");
  const whole = digits.length > 2 ? digits.slice(0, -2) : "0";
  const fraction = digits.length > 2 ? digits.slice(-2) : digits.padStart(2, "0");
  return `${whole},${fraction}%`;
}

function statusView(status: BudgetDetailReadModel["status"]) {
  return status === "ACTIVE"
    ? { status, state: "active" as const, label: "Ativa" }
    : { status, state: "closed" as const, label: "Encerrada" };
}

function progressStatusLabel(status: BudgetDetailReadModel["progress"]["status"]): string {
  switch (status) {
    case "ACHIEVED":
      return "Meta atingida";
    case "IN_PROGRESS":
      return "Meta em andamento";
    default:
      return "Meta não configurada";
  }
}

function paceStatusLabel(
  status: BudgetDetailReadModel["progress"]["paceStatus"],
): string {
  switch (status) {
    case "ON_TRACK":
      return "Ritmo dentro do esperado";
    case "BEHIND":
      return "Ritmo abaixo do necessário";
    default:
      return "Ritmo não aplicável";
  }
}

function toBalanceViewModel(detail: BudgetDetailReadModel) {
  const balance = detail.balance;
  return {
    ...balance,
    position: balancePosition(balance.balanceCents),
    asOfLabel: formatBudgetDate(balance.asOf),
    balanceLabel: formatBudgetSignedCents(balance.balanceCents),
    protectedAmountLabel: formatBudgetSignedCents(balance.protectedAmountCents),
    contributionLabel: formatBudgetSignedCents(
      detail.period?.contributionCents ?? balance.contributionCents,
    ),
    withdrawalLabel: formatBudgetSignedCents(
      detail.period?.withdrawalCents ?? balance.withdrawalCents,
    ),
  } as const;
}

function toProgressViewModel(detail: BudgetDetailReadModel) {
  const progress = detail.progress;
  return {
    ...progress,
    targetAmountLabel:
      progress.targetAmountCents === null
        ? null
        : formatBudgetSignedCents(progress.targetAmountCents),
    targetDateLabel:
      progress.targetDate === null ? null : formatBudgetDate(progress.targetDate),
    progressLabel: `${progressBpsLabel(progress.progressBps)} do alvo`,
    remainingLabel: formatBudgetSignedCents(progress.remainingCents),
    suggestedMonthlyLabel:
      progress.suggestedMonthlyCents === null
        ? null
        : `${formatBudgetSignedCents(progress.suggestedMonthlyCents)}/mês`,
    statusLabel: progressStatusLabel(progress.status),
    paceStatusLabel: paceStatusLabel(progress.paceStatus),
  } as const;
}

function movementKindLabel(movement: BudgetMovementBoundary): string {
  const base = movement.kind === "CONTRIBUTION" ? "Aporte" : "Retirada";
  if (movement.correctsReferenceId) return `${base} (correção)`;
  if (movement.transferReferenceId) return `${base} (transferência)`;
  if (movement.sourceReferenceId) return `${base} (origem vinculada)`;
  return base;
}

function toMovementViewModel(movement: BudgetMovementBoundary) {
  return {
    ...movement,
    kindLabel: movementKindLabel(movement),
    effectiveOnLabel: formatBudgetDate(movement.effectiveOn),
    impactLabel: formatBudgetMovementImpact(movement.amountCents, movement.kind),
  } as const;
}

function queryFor(
  detail: BudgetDetailReadModel,
  cursor?: string,
): { asOf: string; from?: string; to?: string; limit: number; cursor?: string } {
  return {
    asOf: detail.balance.asOf,
    ...(detail.period ? { from: detail.period.from, to: detail.period.to } : {}),
    limit: DETAIL_PAGE_LIMIT,
    ...(cursor ? { cursor } : {}),
  };
}

function actionErrorResult(
  error: BudgetError,
): BudgetResult<BudgetMovementBoundary> {
  return { ok: false, error };
}

/**
 * Server-read detail with client-only display state. Balance, period,
 * progress and movement values are formatted from DTOs; no reserve or
 * spendable formula is reimplemented here.
 */
export function BudgetDetailScreen({
  initialDetail,
  destinations = [],
  destinationError = null,
  initialSpendable,
  spendableHref,
}: BudgetDetailScreenProps) {
  const [detail, setDetail] = useState(initialDetail);
  const [spendableResult, setSpendableResult] = useState<
    SpendableResult<SpendableBreakdown>
  >(initialSpendable ?? unavailableSpendable);
  const [activeForm, setActiveForm] = useState<BudgetMovementFormMode | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<BudgetError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const balance = toBalanceViewModel(detail);
  const progress = toProgressViewModel(detail);
  const spendableImpact = toSpendableImpactViewModel(spendableResult);
  const status = statusView(detail.status);
  const isClosed = detail.status === "CLOSED";

  async function refreshSpendable(asOf: string, requestId: number): Promise<void> {
    try {
      const result = await getSpendableAction({ asOf });
      if (requestId !== requestSequence.current) return;
      setSpendableResult(result);
    } catch {
      if (requestId === requestSequence.current) {
        setSpendableResult(unavailableSpendable);
      }
    }
  }

  async function refreshDetail(): Promise<void> {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setLoadError(null);
    try {
      const result = await getBudgetAction(detail.referenceId, queryFor(detail));
      if (requestId !== requestSequence.current) return;
      if (!result.ok) {
        setLoadError(result.error.message);
        return;
      }
      setDetail(result.value);
      await refreshSpendable(result.value.balance.asOf, requestId);
    } catch {
      if (requestId === requestSequence.current) {
        setLoadError("Não foi possível atualizar a Caixinha. Tente novamente.");
      }
    }
  }

  async function loadMore(): Promise<void> {
    const cursor = detail.movementPageInfo.nextCursor;
    if (isLoadingMore || !detail.movementPageInfo.hasNextPage || !cursor) return;
    setIsLoadingMore(true);
    setLoadError(null);
    try {
      const result = await getBudgetAction(detail.referenceId, queryFor(detail, cursor));
      if (!result.ok) {
        setLoadError(result.error.message);
        return;
      }
      setDetail((current) => ({
        ...current,
        balance: result.value.balance,
        period: result.value.period,
        progress: result.value.progress,
        movements: [...current.movements, ...result.value.movements],
        movementPageInfo: result.value.movementPageInfo,
      }));
    } catch {
      setLoadError("Não foi possível carregar mais movimentos. Tente novamente.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function handleMovement(
    payload: BudgetMovementFormPayload,
  ): Promise<BudgetMovementActionResult> {
    setOperationError(null);
    setSuccessMessage(null);
    try {
      let result: BudgetMovementActionResult;
      const commandId = generateUuidV7();
      if (activeForm === "CONTRIBUTION") {
        result = await registerContributionAction({
          commandId,
          budgetReferenceId: detail.referenceId,
          amountCents: payload.amountCents,
          effectiveOn: payload.effectiveOn,
        });
      } else if (activeForm === "WITHDRAWAL") {
        result = await registerWithdrawalAction({
          commandId,
          budgetReferenceId: detail.referenceId,
          amountCents: payload.amountCents,
          effectiveOn: payload.effectiveOn,
        });
      } else if (activeForm === "TRANSFER" && payload.destinationBudgetReferenceId) {
        result = await transferBetweenBudgetsAction({
          commandId,
          sourceBudgetReferenceId: detail.referenceId,
          destinationBudgetReferenceId: payload.destinationBudgetReferenceId,
          amountCents: payload.amountCents,
          effectiveOn: payload.effectiveOn,
          withdrawalReferenceId: generateUuidV7(),
          contributionReferenceId: generateUuidV7(),
          transferReferenceId: generateUuidV7(),
        });
      } else {
        const error = {
          ...safeUnexpectedError(),
          code: "INVALID_COMMAND" as const,
          message: "Selecione a Caixinha de destino.",
          field: "destinationBudgetReferenceId" as const,
        };
        setOperationError(error);
        return actionErrorResult(error);
      }

      if (!result.ok) {
        setOperationError(result.error);
        return result;
      }

      setActiveForm(null);
      setSuccessMessage(
        activeForm === "CONTRIBUTION"
          ? "Aporte registrado; saldo e histórico atualizados."
          : activeForm === "WITHDRAWAL"
            ? "Retirada registrada; saldo e histórico atualizados."
            : "Transferência registrada nas duas Caixinhas.",
      );
      await refreshDetail();
      return result;
    } catch {
      const error = safeUnexpectedError();
      setOperationError(error);
      return actionErrorResult(error);
    }
  }

  return (
    <section aria-label="Detalhe da Caixinha" className="space-y-6" data-testid="budget-detail-screen">
      <PageHeader
        action={
          <Link
            className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={BUDGETS_ROUTE}
          >
            Voltar às Caixinhas
          </Link>
        }
        description="Consulte saldo, progresso e histórico. Os valores financeiros são calculados no servidor."
        eyebrow="Planejamento financeiro"
        title={`Caixinha: ${detail.name}`}
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
        <BudgetStatusBadge status={status} />
        <span className="text-sm text-muted-foreground">Categoria: {detail.category?.name ?? "Categoria indisponível"}</span>
        <span className="text-sm text-muted-foreground">Vigência desde {formatBudgetDate(detail.activeFrom)}</span>
        {detail.closedOn ? (
          <span className="text-sm text-muted-foreground">Encerrada em {formatBudgetDate(detail.closedOn)}</span>
        ) : null}
      </div>

      {isClosed ? (
        <section className="rounded-xl border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-950" data-testid="budget-closed-message">
          <h2 className="font-semibold">Caixinha encerrada</h2>
          <p className="mt-1">Novos movimentos não estão disponíveis. O saldo e o histórico permanecem acessíveis para consulta.</p>
        </section>
      ) : null}

      {balance.position === "negative" ? (
        <section className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="budget-negative-message">
          <h2 className="font-semibold">Saldo negativo</h2>
          <p className="mt-1">A proteção fica zerada neste corte; não há proteção positiva enquanto o saldo for negativo.</p>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <BudgetBalanceCard balance={balance} />
        <BudgetProgressCard progress={progress} />
      </div>

      {detail.period ? (
        <section aria-label="Resumo do período" className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-xl font-semibold">Resumo do período</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatBudgetDate(detail.period.from)} a {formatBudgetDate(detail.period.to)}. Rollover e saldos são fornecidos pelo servidor.
          </p>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-muted-foreground">Rollover</dt><dd className="font-medium tabular-nums">{formatBudgetSignedCents(detail.period.rolloverCents)}</dd></div>
            <div><dt className="text-muted-foreground">Saldo inicial</dt><dd className="font-medium tabular-nums">{formatBudgetSignedCents(detail.period.openingBalanceCents)}</dd></div>
            <div><dt className="text-muted-foreground">Saldo final</dt><dd className="font-medium tabular-nums">{formatBudgetSignedCents(detail.period.closingBalanceCents)}</dd></div>
            <div><dt className="text-muted-foreground">Aportes no período</dt><dd className="font-medium tabular-nums">{formatBudgetSignedCents(detail.period.contributionCents)}</dd></div>
            <div><dt className="text-muted-foreground">Retiradas no período</dt><dd className="font-medium tabular-nums">{formatBudgetSignedCents(detail.period.withdrawalCents)}</dd></div>
            <div><dt className="text-muted-foreground">Variação líquida</dt><dd className="font-medium tabular-nums">{formatBudgetSignedCents(detail.period.netChangeCents)}</dd></div>
          </dl>
        </section>
      ) : null}

      {successMessage ? <SuccessFeedback message={successMessage} testId="budget-detail-success" /> : null}
      {operationError ? (
        <ErrorState
          message={operationError.message}
          testId="budget-detail-operation-error"
          title="Não foi possível concluir o movimento"
        />
      ) : null}
      {loadError ? (
        <ErrorState
          message={loadError}
          retryHref={budgetDetailRoute(detail.referenceId)}
          testId="budget-detail-load-error"
        />
      ) : null}

      <section aria-label="Operações de movimento" className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Movimentar Caixinha</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Aporte e retirada movimentam a reserva; não são receita, despesa bancária ou pagamento de cartão.
        </p>
        {isClosed ? (
          <p className="mt-4 text-sm text-muted-foreground">Caixinha encerrada; novos movimentos indisponíveis.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            {(["CONTRIBUTION", "WITHDRAWAL", "TRANSFER"] as const).map((mode) => (
              <Button
                key={mode}
                data-testid={`budget-movement-${mode.toLowerCase()}-button`}
                onClick={() => {
                  setOperationError(null);
                  setSuccessMessage(null);
                  setActiveForm(mode);
                }}
                type="button"
                variant={activeForm === mode ? "default" : "outline"}
              >
                {mode === "CONTRIBUTION" ? "Aportar" : mode === "WITHDRAWAL" ? "Retirar" : "Transferir"}
              </Button>
            ))}
          </div>
        )}
      </section>

      {!isClosed && activeForm ? (
        <BudgetMovementForm
          destinations={destinations}
          mode={activeForm}
          onCancel={() => setActiveForm(null)}
          onSubmit={handleMovement}
          testId="budget-movement-form"
        />
      ) : null}

      <BudgetMovementList movements={detail.movements.map(toMovementViewModel)} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" data-testid="budget-movement-pagination">
        <p className="text-xs text-muted-foreground">
          {detail.movements.length === 0
            ? "Nenhuma movimentação registrada para este período."
            : `${detail.movements.length} movimento(s) carregado(s).`}
        </p>
        {detail.movementPageInfo.hasNextPage ? (
          <Button disabled={isLoadingMore} onClick={() => void loadMore()} type="button" variant="outline">
            {isLoadingMore ? "Carregando…" : "Carregar mais movimentos"}
          </Button>
        ) : null}
      </div>

      <section aria-label="Impacto na disponibilidade" className="rounded-2xl border bg-muted/20 p-5" data-testid="budget-spendable-impact">
        <h2 className="text-xl font-semibold">Quanto posso gastar</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          O impacto desta Caixinha vem do read model autorizado s09.v1. Esta tela apenas apresenta os valores fornecidos pelo provider, sem recalcular a fórmula.
        </p>
        <div className="mt-4">
          <BudgetSpendableImpactMessage impact={spendableImpact} />
        </div>
        <Link
          className="mt-4 inline-flex rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href={spendableHref ?? SPENDABLE_BREAKDOWN_ROUTE}
        >
          Consultar disponibilidade autorizada
        </Link>
        {destinationError ? <p className="mt-2 text-xs text-muted-foreground">{destinationError}</p> : null}
      </section>
    </section>
  );
}

export type BudgetDetailActionResult = BudgetReadResult<BudgetDetailReadModel>;
export type BudgetTransferActionResult = BudgetResult<BudgetTransferBoundary>;
