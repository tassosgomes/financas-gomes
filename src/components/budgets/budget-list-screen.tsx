"use client";

import {
  Archive,
  CheckCircle2,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import {
  closeBudgetAction,
  createBudgetAction,
  listBudgetsAction,
  updateBudgetAction,
} from "@/app/actions/budgets";
import { DateInput } from "@/components/transactions/date-input";
import {
  BudgetCloseConfirmation,
  BudgetProgressCard,
  BudgetStatusBadge,
} from "@/components/budgets/budget-components";
import {
  BudgetForm,
  type BudgetCategoryOption,
  type BudgetFormPayload,
} from "@/components/budgets/budget-form";
import { formatBudgetDate, formatBudgetSignedCents } from "@/components/budgets/formatters";
import { EmptyState, ErrorState, LoadingState, SuccessFeedback } from "@/components/ui/async-state";
import { Button } from "@/components/ui/button";
import { DataTable, ResourceList } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { generateUuidV7 } from "@/lib/uuidv7";
import type {
  BudgetBoundary,
  BudgetError,
  BudgetResult,
  BudgetStatus,
} from "@/modules/budgets/contracts";
import type {
  BudgetListItemReadModel,
  BudgetReadErrorBoundary,
} from "@/modules/budgets/read-contracts";
import { BUDGETS_ROUTE, budgetDetailRoute } from "@/modules/budgets/routes";
import { getTodayIsoDate } from "@/modules/transactions/form-contract";

const FORM_DATE_MAX = "9999-12-31";

export interface BudgetCollectionScreenProps {
  readonly initialItems: readonly BudgetListItemReadModel[];
  /** Category options are reduced on the server before crossing to the client. */
  readonly categories: readonly BudgetCategoryOption[];
  readonly categoryError?: string | null;
}

type BudgetCollectionStatus = Extract<BudgetStatus, "ACTIVE" | "CLOSED">;

function safeUnexpectedError(): BudgetError {
  return {
    code: "QUERY_FAILED",
    message: "Não foi possível concluir a operação. Tente novamente.",
  };
}

function readErrorMessage(error: BudgetReadErrorBoundary): string {
  return error.message || "Não foi possível carregar as Caixinhas. Tente novamente.";
}

function statusView(status: BudgetStatus): {
  status: BudgetStatus;
  state: "active" | "closed";
  label: string;
} {
  return status === "ACTIVE"
    ? { status, state: "active", label: "Ativa" }
    : { status, state: "closed", label: "Encerrada" };
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

function progressStatusLabel(status: BudgetListItemReadModel["progress"]["status"]): string {
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
  status: BudgetListItemReadModel["progress"]["paceStatus"],
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

function balanceViewModel(item: BudgetListItemReadModel) {
  const period = item.period;
  return {
    ...item.balance,
    position: balancePosition(item.balance.balanceCents),
    asOfLabel: formatBudgetDate(item.balance.asOf),
    balanceLabel: formatBudgetSignedCents(item.balance.balanceCents),
    protectedAmountLabel: formatBudgetSignedCents(item.balance.protectedAmountCents),
    contributionLabel: formatBudgetSignedCents(
      period?.contributionCents ?? item.balance.contributionCents,
    ),
    withdrawalLabel: formatBudgetSignedCents(
      period?.withdrawalCents ?? item.balance.withdrawalCents,
    ),
    periodLabel: period
      ? `${formatBudgetDate(period.from)} a ${formatBudgetDate(period.to)}`
      : null,
  } as const;
}

function progressViewModel(item: BudgetListItemReadModel) {
  const progress = item.progress;
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

function BudgetNameCell({ item }: { item: BudgetListItemReadModel }) {
  const status = statusView(item.status);
  return (
    <div className="min-w-48 space-y-1">
      <Link
        className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={budgetDetailRoute(item.referenceId)}
      >
        {item.name}
      </Link>
      <p className="text-xs text-muted-foreground">
        {item.category?.name ?? "Categoria indisponível"}
      </p>
      <BudgetStatusBadge status={status} />
    </div>
  );
}

function BudgetActions({
  item,
  disabled,
  onEdit,
  onClose,
}: {
  item: BudgetListItemReadModel;
  disabled: boolean;
  onEdit: (item: BudgetListItemReadModel) => void;
  onClose: (item: BudgetListItemReadModel) => void;
}) {
  if (item.status === "CLOSED") {
    return (
      <span className="text-xs text-muted-foreground">
        Histórico preservado
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        aria-label={`Editar ${item.name}`}
        className="gap-2"
        data-testid={`budget-edit-${item.referenceId}`}
        disabled={disabled}
        onClick={() => onEdit(item)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Pencil aria-hidden="true" className="size-4" />
        <span className="sr-only sm:not-sr-only">Editar</span>
      </Button>
      <Button
        aria-label={`Encerrar ${item.name}`}
        className="gap-2"
        data-testid={`budget-close-${item.referenceId}`}
        disabled={disabled}
        onClick={() => onClose(item)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Archive aria-hidden="true" className="size-4" />
        <span className="sr-only sm:not-sr-only">Encerrar</span>
      </Button>
    </div>
  );
}

function BudgetMobileCard({
  item,
  disabled,
  onEdit,
  onClose,
}: {
  item: BudgetListItemReadModel;
  disabled: boolean;
  onEdit: (item: BudgetListItemReadModel) => void;
  onClose: (item: BudgetListItemReadModel) => void;
}) {
  const balance = balanceViewModel(item);
  const progress = progressViewModel(item);

  return (
    <article className="space-y-5" data-testid={`budget-card-${item.referenceId}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 className="truncate font-semibold">
            <Link
              className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={budgetDetailRoute(item.referenceId)}
            >
              {item.name}
            </Link>
          </h2>
          <p className="text-sm text-muted-foreground">
            {item.category?.name ?? "Categoria indisponível"}
          </p>
        </div>
        <BudgetStatusBadge status={statusView(item.status)} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Saldo acumulado</dt>
          <dd className="mt-1 font-medium tabular-nums">{balance.balanceLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Protegido</dt>
          <dd className="mt-1 font-medium tabular-nums">{balance.protectedAmountLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Aportes no mês</dt>
          <dd className="mt-1 tabular-nums">{balance.contributionLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Gastos/retiradas no mês</dt>
          <dd className="mt-1 tabular-nums">{balance.withdrawalLabel}</dd>
        </div>
      </dl>
      {balance.position === "negative" ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Saldo negativo: a proteção fica zerada neste corte.
        </p>
      ) : null}
      <div className="rounded-xl border bg-muted/20 p-4">
        <BudgetProgressCard progress={progress} />
      </div>
      <p className="text-xs text-muted-foreground">
        Corte do saldo: {balance.asOfLabel}. Os valores são derivados pelo servidor.
      </p>
      <div className="flex justify-end border-t pt-3">
        <BudgetActions
          disabled={disabled}
          item={item}
          onClose={onClose}
          onEdit={onEdit}
        />
      </div>
    </article>
  );
}

/**
 * Interactive collection: initial data is server-rendered; filters and writes
 * remain behind authenticated Server Actions. No browser payload carries a
 * household selector, balance, movement or tenancy authority.
 */
export function BudgetCollectionScreen({
  initialItems,
  categories,
  categoryError = null,
}: BudgetCollectionScreenProps) {
  const [status, setStatus] = useState<BudgetCollectionStatus>("ACTIVE");
  const [items, setItems] = useState<readonly BudgetListItemReadModel[]>(initialItems);
  const [isLoading, setIsLoading] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetListItemReadModel | undefined>();
  const [closeTarget, setCloseTarget] = useState<BudgetListItemReadModel | null>(null);
  const [closeDate, setCloseDate] = useState("");
  const [loadError, setLoadError] = useState<BudgetReadErrorBoundary | null>(null);
  const [operationError, setOperationError] = useState<BudgetError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const requestSequence = useRef(0);
  const closeTriggerRef = useRef<HTMLButtonElement | null>(null);

  async function loadItems(nextStatus: BudgetCollectionStatus = status): Promise<void> {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setIsLoading(true);
    setLoadError(null);

    try {
      const result = await listBudgetsAction({ status: nextStatus });
      if (requestId !== requestSequence.current) return;

      if (!result.ok) {
        setLoadError(result.error);
        return;
      }

      setItems(result.value.items);
    } catch {
      if (requestId === requestSequence.current) {
        setLoadError({ code: "QUERY_FAILED", message: "Não foi possível carregar as Caixinhas." });
      }
    } finally {
      if (requestId === requestSequence.current) setIsLoading(false);
    }
  }

  async function changeStatus(nextStatus: BudgetCollectionStatus): Promise<void> {
    if (isLoading || nextStatus === status) return;
    setStatus(nextStatus);
    setSuccessMessage(null);
    await loadItems(nextStatus);
  }

  function closeForm(): void {
    setIsFormOpen(false);
    setEditingBudget(undefined);
  }

  function openCreateForm(): void {
    setEditingBudget(undefined);
    setOperationError(null);
    setSuccessMessage(null);
    setIsFormOpen(true);
  }

  function openEditForm(item: BudgetListItemReadModel): void {
    setEditingBudget(item);
    setOperationError(null);
    setSuccessMessage(null);
    setIsFormOpen(true);
  }

  async function handleFormSubmit(payload: BudgetFormPayload): Promise<BudgetResult<BudgetBoundary>> {
    setOperationError(null);
    setSuccessMessage(null);

    try {
      const result = editingBudget
        ? await updateBudgetAction({
            commandId: generateUuidV7(),
            budgetReferenceId: editingBudget.referenceId,
            name: payload.name,
            goal: payload.goal,
          })
        : payload.categoryId && payload.activeFrom
          ? await createBudgetAction({
              commandId: generateUuidV7(),
              name: payload.name,
              categoryId: payload.categoryId,
              activeFrom: payload.activeFrom,
              goal: payload.goal,
            })
          : {
              ok: false as const,
              error: {
                code: "INVALID_COMMAND" as const,
                message: "Selecione a categoria e a data de início.",
              },
            };

      if (!result.ok) {
        setOperationError(result.error);
        return result;
      }

      setSuccessMessage(editingBudget ? "Caixinha atualizada." : "Caixinha criada.");
      closeForm();
      await loadItems(status);
      return result;
    } catch {
      const error = safeUnexpectedError();
      setOperationError(error);
      return { ok: false, error };
    }
  }

  function openCloseConfirmation(item: BudgetListItemReadModel): void {
    closeTriggerRef.current =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null;
    setOperationError(null);
    setSuccessMessage(null);
    const today = getTodayIsoDate();
    setCloseDate(today < item.activeFrom ? item.activeFrom : today);
    setCloseTarget(item);
  }

  function cancelClose(): void {
    setCloseTarget(null);
    setCloseDate("");
    closeTriggerRef.current?.focus();
  }

  async function confirmClose(): Promise<void> {
    if (!closeTarget || !closeDate || isClosing) return;
    setIsClosing(true);
    setOperationError(null);

    try {
      const result = await closeBudgetAction({
        commandId: generateUuidV7(),
        budgetReferenceId: closeTarget.referenceId,
        closedOn: closeDate,
      });

      if (!result.ok) {
        setOperationError(result.error);
        return;
      }

      setSuccessMessage(
        `Caixinha encerrada. A proteção deixa de valer a partir de ${formatBudgetDate(closeDate)}; o histórico permanece acessível.`,
      );
      setCloseTarget(null);
      setCloseDate("");
      closeTriggerRef.current?.focus();
      await loadItems(status);
    } catch {
      setOperationError(safeUnexpectedError());
    } finally {
      setIsClosing(false);
    }
  }

  const isClosedView = status === "CLOSED";
  const collectionLabel = isClosedView ? "Caixinhas encerradas" : "Caixinhas ativas";

  return (
    <section aria-label="Caixinhas" className="space-y-6" data-testid="budgets-screen">
      <PageHeader
        action={
          <Button
            className="w-full gap-2 sm:w-auto"
            data-testid="budgets-create-button"
            onClick={openCreateForm}
            type="button"
          >
            <Plus aria-hidden="true" className="size-4" />
            Nova Caixinha
          </Button>
        }
        description="Acompanhe o saldo reservado e mantenha seus objetivos sem alterar o histórico financeiro."
        eyebrow="Planejamento financeiro"
        title="Caixinhas"
      />

      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-foreground">
            {isClosedView ? (
              <EyeOff aria-hidden="true" className="size-5" />
            ) : (
              <CheckCircle2 aria-hidden="true" className="size-5" />
            )}
          </span>
          <div>
            <p className="font-medium">{isClosedView ? "Histórico de Caixinhas" : "Caixinhas disponíveis"}</p>
            <p className="text-sm text-muted-foreground">
              {isClosedView
                ? "Caixinhas encerradas continuam consultáveis para preservar o histórico."
                : "Somente Caixinhas ativas recebem novos movimentos."}
            </p>
          </div>
        </div>
        <Button
          aria-pressed={isClosedView}
          className="w-full gap-2 sm:w-auto"
          data-testid="budgets-closed-toggle"
          disabled={isLoading}
          onClick={() => void changeStatus(isClosedView ? "ACTIVE" : "CLOSED")}
          type="button"
          variant="outline"
        >
          {isClosedView ? (
            <>
              <Eye aria-hidden="true" className="size-4" />
              Voltar às ativas
            </>
          ) : (
            <>
              <Archive aria-hidden="true" className="size-4" />
              Ver encerradas
            </>
          )}
        </Button>
      </div>

      {isFormOpen ? (
        <BudgetForm
          key={editingBudget?.referenceId ?? "create"}
          budget={editingBudget}
          categories={categories}
          categoryError={categoryError}
          mode={editingBudget ? "edit" : "create"}
          onCancel={closeForm}
          onSubmit={handleFormSubmit}
          testId="budget-form"
        />
      ) : null}

      {successMessage ? (
        <SuccessFeedback message={successMessage} testId="budgets-success" />
      ) : null}

      {operationError && !isFormOpen ? (
        <ErrorState
          message={operationError.message}
          testId="budgets-operation-error"
          title="Não foi possível concluir a operação"
        />
      ) : null}

      {isLoading ? (
        <LoadingState label={`Carregando ${collectionLabel.toLowerCase()}…`} testId="budgets-loading" />
      ) : loadError ? (
        <ErrorState
          message={readErrorMessage(loadError)}
          retryHref={BUDGETS_ROUTE}
          testId="budgets-load-error"
        />
      ) : items.length === 0 ? (
        <EmptyState
          action={
            isClosedView ? undefined : (
              <Button className="gap-2" onClick={openCreateForm} type="button">
                <Plus aria-hidden="true" className="size-4" />
                Criar primeira Caixinha
              </Button>
            )
          }
          description={
            isClosedView
              ? "Caixinhas encerradas permanecem disponíveis aqui para consulta histórica."
              : "Crie sua primeira Caixinha para separar recursos por objetivo."
          }
          testId="budgets-empty"
          title={isClosedView ? "Nenhuma Caixinha encerrada" : "Nenhuma Caixinha cadastrada"}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              caption={`Lista de ${collectionLabel.toLowerCase()}`}
              columns={[
                {
                  key: "name",
                  header: "Caixinha",
                  render: (item) => <BudgetNameCell item={item} />,
                },
                {
                  key: "balance",
                  header: "Saldo acumulado",
                  render: (item) => {
                    const balance = balanceViewModel(item);
                    return (
                      <span className="font-medium tabular-nums">
                        {balance.balanceLabel}
                        {balance.position === "negative" ? (
                          <span className="sr-only">
                            Saldo negativo; proteção zerada neste corte.
                          </span>
                        ) : null}
                      </span>
                    );
                  },
                },
                {
                  key: "period",
                  header: "Aportes / gastos",
                  render: (item) => {
                    const balance = balanceViewModel(item);
                    return (
                      <span className="space-y-1 text-xs tabular-nums">
                        <span className="block">
                          Aportes no mês: {balance.contributionLabel}
                        </span>
                        <span className="block">
                          Gastos/retiradas no mês: {balance.withdrawalLabel}
                        </span>
                      </span>
                    );
                  },
                },
                {
                  key: "goal",
                  header: "Meta / progresso",
                  render: (item) => {
                    const progress = progressViewModel(item);
                    return progress.targetAmountLabel ? (
                      <span className="space-y-1 text-xs">
                        <span className="block">Meta: {progress.targetAmountLabel}</span>
                        <span className="block">{progress.progressLabel}</span>
                      </span>
                    ) : (
                      "Sem meta"
                    );
                  },
                },
                {
                  key: "actions",
                  header: "Ações",
                  className: "text-right",
                  render: (item) => (
                    <BudgetActions
                      disabled={isLoading}
                      item={item}
                      onClose={(value) => openCloseConfirmation(value)}
                      onEdit={openEditForm}
                    />
                  ),
                },
              ]}
              getRowKey={(item) => item.referenceId}
              rows={items}
              testId="budgets-table"
            />
          </div>
          <div className="md:hidden">
            <ResourceList
              getItemKey={(item) => item.referenceId}
              items={items}
              renderItem={(item) => (
                <BudgetMobileCard
                  disabled={isLoading}
                  item={item}
                  onClose={(value) => openCloseConfirmation(value)}
                  onEdit={openEditForm}
                />
              )}
              testId="budgets-list"
            />
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <p>
          {items.length === 1 ? "1 Caixinha" : `${items.length} Caixinhas`} exibida(s) em {isClosedView ? "encerradas" : "ativas"}.
        </p>
        <Button
          aria-label="Atualizar lista de Caixinhas"
          className="gap-2"
          data-testid="budgets-refresh-button"
          disabled={isLoading}
          onClick={() => void loadItems()}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          Atualizar
        </Button>
      </div>

      <p className="sr-only" data-testid="budgets-view-description">
        {isClosedView ? "Exibindo apenas Caixinhas encerradas." : "Exibindo apenas Caixinhas ativas."}
      </p>

      <BudgetCloseConfirmation
        confirmDisabled={!closeDate || isClosing}
        description={
          closeTarget
            ? `A proteção da Caixinha “${closeTarget.name}” deixa de valer a partir da data efetiva abaixo. O saldo e o histórico não serão apagados.`
            : ""
        }
        onCancel={cancelClose}
        onConfirm={() => void confirmClose()}
        open={closeTarget !== null}
        title="Encerrar Caixinha"
      >
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="budget-close-date">
            Data efetiva do encerramento
          </label>
          <DateInput
            aria-describedby="budget-close-date-help"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            id="budget-close-date"
            maxDate={FORM_DATE_MAX}
            minDate={closeTarget?.activeFrom}
            onChange={(event) => setCloseDate(event.target.value)}
            value={closeDate}
          />
          <p className="text-xs text-muted-foreground" id="budget-close-date-help">
            Na data escolhida e depois dela, a Caixinha fica encerrada; consultas anteriores mantêm a proteção histórica.
          </p>
        </div>
      </BudgetCloseConfirmation>
    </section>
  );
}
