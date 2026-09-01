"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Check, RotateCcw, X } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ErrorState, SuccessFeedback } from "@/components/ui/async-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { TransactionForm, type TransactionAccountOption, type TransactionCategoryOption } from "@/components/transactions/transaction-form";
import type { ManualTransactionFormValues } from "@/modules/transactions/form-contract";
import type {
  AccountBalanceReadModel,
  CancelManualTransactionCommand,
  ManualTransactionReadModel,
  S03Error,
  S03Result,
} from "@/modules/transactions/contracts";
import type {
  S05Error,
  S05Result,
  TransactionDetailReadModel,
  UpdateReviewableTransactionCommand,
} from "@/modules/transactions/review-contracts";
import type { ReviewableTransactionUpdateReadModel } from "@/modules/transactions/review-use-cases";

import { CategoryQuickEdit, type CategoryQuickEditAction } from "./category-quick-edit";
import { TransactionReviewBadges, SourceDetails } from "./transaction-review-badges";
import {
  commandForTransactionUpdate,
  commandForTransactionCancellation,
  type TransactionMaintenanceAttemptRef,
} from "./transaction-maintenance-attempt";
import { formatDetailCents, formatDetailDate } from "./transaction-detail-utils";

/** The T06 action only accepts serializable editable metadata. */
export type TransactionReviewUpdateAction = (
  command: UpdateReviewableTransactionCommand,
) => Promise<S05Result<ReviewableTransactionUpdateReadModel>>;

export interface TransactionReviewDetailScreenProps {
  initialTransaction: TransactionDetailReadModel;
  categories: readonly TransactionCategoryOption[];
  accounts?: readonly TransactionAccountOption[];
  initialBalance?: AccountBalanceReadModel;
  backHref: string;
  updateAction: TransactionReviewUpdateAction;
  cancelAction?: (
    command: CancelManualTransactionCommand,
  ) => Promise<S03Result<ManualTransactionReadModel>>;
}

interface ReviewOperationError {
  code: string;
  message: string;
  field?: string;
}

const KIND_LABELS = {
  EXPENSE: "Despesa",
  INCOME: "Receita",
} as const;

const STATUS_LABELS = {
  POSTED: "Publicado",
  CANCELLED: "Cancelado",
} as const;

const ORIGIN_LABELS = {
  MANUAL: "Manual",
  IMPORT: "Importado",
} as const;

function reviewError(error: S05Error): ReviewOperationError {
  return { code: error.code, field: error.field, message: error.message };
}

function toFormError(error: ReviewOperationError | null): S03Error | null {
  if (!error) return null;
  const field = error.field === "description" || error.field === "categoryId"
    ? error.field
    : undefined;
  return {
    code: "INVALID_COMMAND",
    message: error.message,
    ...(field ? { field } : {}),
  };
}

function safeUnexpectedError(): ReviewOperationError {
  return {
    code: "UPDATE_FAILED",
    message: "Não foi possível atualizar o lançamento. Tente novamente.",
  };
}

function DetailBadge({
  children,
  className,
  testId,
}: {
  children: React.ReactNode;
  className: string;
  testId: string;
}) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${className}`} data-testid={testId}>
      {children}
    </span>
  );
}

function kindClassName(kind: TransactionDetailReadModel["kind"]): string {
  return kind === "INCOME" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800";
}

function statusClassName(status: TransactionDetailReadModel["status"]): string {
  return status === "CANCELLED" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800";
}

function ReadonlyField({ label, value, testId }: { label: string; value: React.ReactNode; testId: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm" data-testid={testId}>{value}</dd>
    </div>
  );
}

function EventDetails({ transaction }: { transaction: TransactionDetailReadModel }) {
  const Icon = transaction.kind === "INCOME" ? ArrowUpRight : ArrowDownLeft;
  return (
    <section aria-labelledby="review-event-title" className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-testid="review-event-details">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">Fato registrado</p>
          <h2 className="mt-1 text-xl font-semibold" id="review-event-title">Evento econômico</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <DetailBadge className={kindClassName(transaction.kind)} testId={`review-detail-kind-${transaction.kind.toLowerCase()}`}><Icon aria-hidden="true" className="mr-1 size-4" />{KIND_LABELS[transaction.kind]}</DetailBadge>
          <DetailBadge className={statusClassName(transaction.status)} testId={`review-detail-status-${transaction.status.toLowerCase()}`}>{STATUS_LABELS[transaction.status]}</DetailBadge>
        </div>
      </div>
      <dl className="mt-6 grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <ReadonlyField label="Valor do evento" testId="review-detail-event-amount" value={formatDetailCents(transaction.amountCents)} />
        <ReadonlyField label="Data do evento" testId="review-detail-occurred-on" value={<time dateTime={transaction.occurredOn}>{formatDetailDate(transaction.occurredOn)}</time>} />
        <ReadonlyField label="Conta" testId="review-detail-account" value={transaction.account.name} />
        <ReadonlyField label="Tipo" testId="review-detail-kind-label" value={KIND_LABELS[transaction.kind]} />
        <ReadonlyField label="Status" testId="review-detail-status-label" value={STATUS_LABELS[transaction.status]} />
        <ReadonlyField label="Identificador do evento" testId="review-detail-event-id" value={<code className="break-all text-xs">{transaction.id}</code>} />
      </dl>
    </section>
  );
}

function EntryDetails({ transaction }: { transaction: TransactionDetailReadModel }) {
  return (
    <section aria-labelledby="review-entry-title" className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-testid="review-entry-details">
      <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">Efeito no ledger</p>
      <h2 className="mt-1 text-xl font-semibold" id="review-entry-title">Entry da conta</h2>
      <dl className="mt-6 grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <ReadonlyField label="Valor assinado" testId="review-detail-entry-amount" value={formatDetailCents(transaction.entry.amountCents)} />
        <ReadonlyField label="Status do entry" testId="review-detail-entry-status" value="Publicado" />
        <ReadonlyField label="Data de postagem" testId="review-detail-entry-posted-on" value={<time dateTime={transaction.entry.postedOn}>{formatDetailDate(transaction.entry.postedOn)}</time>} />
        <ReadonlyField label="Identificador do entry" testId="review-detail-entry-id" value={<code className="break-all text-xs">{transaction.entry.id}</code>} />
      </dl>
      <p className="mt-5 text-sm leading-6 text-muted-foreground">Valor, data, status e entry são somente leitura. A revisão altera apenas descrição e categoria.</p>
    </section>
  );
}

function HistoryDetails({ transaction }: { transaction: TransactionDetailReadModel }) {
  return (
    <section aria-labelledby="review-history-title" className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-testid="review-history">
      <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">Trilha preservada</p>
      <h2 className="mt-1 text-xl font-semibold" id="review-history-title">Histórico do lançamento</h2>
      <div className="mt-5 rounded-xl border bg-background p-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <ReadonlyField label="Origem" testId="review-history-origin" value={ORIGIN_LABELS[transaction.origin]} />
          <ReadonlyField label="Estado de revisão" testId="review-history-review-state" value={transaction.reviewState === "NEEDS_REVIEW" ? "Precisa de revisão" : transaction.reviewState === "ORGANIZED" ? "Organizado" : "Não aplicável"} />
          <ReadonlyField label="Categoria" testId="review-history-category" value={transaction.category?.name ?? "Sem categoria"} />
        </dl>
        {transaction.reversal ? (
          <p className="mt-4 text-sm text-muted-foreground">Este lançamento possui um reversal preservado no histórico.</p>
        ) : null}
      </div>
    </section>
  );
}

function categoryOptions(categories: readonly TransactionCategoryOption[]) {
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    kind: category.kind,
    status: category.status,
  }));
}

function AccountBalanceDetails({ balance }: { balance: AccountBalanceReadModel }) {
  return (
    <section aria-labelledby="review-balance-title" className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-testid="review-account-balance">
      <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">Posição derivada</p>
      <h2 className="mt-1 text-xl font-semibold" id="review-balance-title">Saldo da conta</h2>
      <p className="mt-5 text-3xl font-semibold tracking-tight" data-testid="review-detail-balance-amount">{formatDetailCents(balance.balanceCents)}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Saldo líquido derivado dos entries publicados até {formatDetailDate(balance.asOf)}.</p>
    </section>
  );
}

function CancelTransactionConfirmation({
  disabled = false,
  onConfirm,
}: {
  disabled?: boolean;
  onConfirm: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (!open) {
    return (
      <Button className="w-full gap-2 sm:w-auto" data-testid="transaction-cancel-open" disabled={disabled} onClick={() => setOpen(true)} type="button" variant="outline">
        <RotateCcw aria-hidden="true" className="size-4" />
        Cancelar lançamento
      </Button>
    );
  }

  async function confirm() {
    if (confirming || disabled) return;
    setConfirming(true);
    try {
      if (await onConfirm()) setOpen(false);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div aria-label="Confirmar cancelamento do lançamento" className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4" data-testid="transaction-cancel-confirmation" role="group">
      <div className="space-y-1"><p className="font-medium text-destructive">Cancelar este lançamento?</p><p className="text-sm leading-6 text-destructive/90">O evento original e o entry serão preservados no histórico. Um efeito compensatório será registrado para neutralizar o saldo.</p></div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button data-testid="transaction-cancel-dismiss" disabled={confirming} onClick={() => setOpen(false)} type="button" variant="ghost"><X aria-hidden="true" className="mr-1 size-4" />Manter lançamento</Button>
        <Button aria-busy={confirming} data-testid="transaction-cancel-confirm" disabled={confirming || disabled} onClick={() => void confirm()} type="button"><Check aria-hidden="true" className="mr-1 size-4" />{confirming ? "Cancelando…" : "Confirmar cancelamento"}</Button>
      </div>
    </div>
  );
}

/** Detail/editor island for both manual and imported reviewable events. */
export function TransactionReviewDetailScreen({
  accounts = [],
  backHref,
  categories,
  cancelAction,
  initialBalance,
  initialTransaction,
  updateAction,
}: TransactionReviewDetailScreenProps) {
  const router = useRouter();
  const [transaction, setTransaction] = useState(initialTransaction);
  const [operationError, setOperationError] = useState<ReviewOperationError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const updateAttempt = useRef<TransactionMaintenanceAttemptRef["current"]>(null);
  const cancelAttempt = useRef<TransactionMaintenanceAttemptRef["current"]>(null);

  async function handleUpdate(values: ManualTransactionFormValues): Promise<S03Result<unknown>> {
    setOperationError(null);
    setSuccessMessage(null);
    setIsUpdating(true);
    try {
      const command = commandForTransactionUpdate(transaction.id, {
        categoryId: values.categoryId,
        description: values.description,
      }, updateAttempt);
      const result = await updateAction(command);
      if (!result.ok) {
        const error = reviewError(result.error);
        setOperationError(error);
        return { ok: false, error: toFormError(error) ?? { code: "INVALID_COMMAND", message: error.message } };
      }

      updateAttempt.current = null;
      setTransaction((current) => ({
        ...current,
        categoryId: result.value.categoryId,
        description: result.value.description,
        source: result.value.source,
        reviewState: result.value.reviewState,
        reviewReason: result.value.reviewReason,
        needsReview: result.value.needsReview,
        updatedAt: result.value.updatedAt,
      }));
      setSuccessMessage("Lançamento atualizado. Origem e efeito financeiro preservados.");
      router.refresh();
      return { ok: true, value: result.value };
    } catch {
      const error = safeUnexpectedError();
      setOperationError(error);
      return { ok: false, error: toFormError(error) ?? { code: "INVALID_COMMAND", message: error.message } };
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleCancellation(): Promise<boolean> {
    if (!cancelAction) return false;
    setOperationError(null);
    setSuccessMessage(null);
    setIsCancelling(true);
    try {
      const result = await cancelAction(
        commandForTransactionCancellation(transaction.id, cancelAttempt),
      );
      if (!result.ok) {
        setOperationError({ code: result.error.code, field: result.error.field, message: result.error.message });
        return false;
      }
      cancelAttempt.current = null;
      setTransaction((current) => ({
        ...current,
        status: "CANCELLED",
        reversal: result.value.reversal
          ? {
              id: result.value.reversal.id,
              amountCents: result.value.reversal.amountCents,
              origin: "SYSTEM",
              status: "POSTED",
              occurredOn: result.value.reversal.occurredOn,
            }
          : current.reversal,
        reviewState: "NOT_APPLICABLE",
        reviewReason: null,
        needsReview: false,
        updatedAt: result.value.updatedAt,
      }));
      setSuccessMessage("Lançamento cancelado. O histórico foi preservado.");
      router.refresh();
      return true;
    } catch {
      setOperationError(safeUnexpectedError());
      return false;
    } finally {
      setIsCancelling(false);
    }
  }

  const formTransaction = {
    id: transaction.id,
    kind: transaction.kind,
    amountCents: transaction.amountCents,
    occurredOn: transaction.occurredOn,
    description: transaction.description,
    accountId: transaction.accountId,
    categoryId: transaction.categoryId,
    accountName: transaction.account.name,
    categoryName: transaction.category?.name ?? null,
    status: transaction.status,
  } as const;
  const editable = transaction.status === "POSTED";
  const accountOptions = accounts.length > 0 ? accounts : [{
    id: transaction.account.id,
    name: transaction.account.name,
    status: transaction.account.status,
    trackingStartedOn: transaction.account.trackingStartedOn,
  }];
  const reviewCategories = categoryOptions(categories);
  const categoryQuickEditAction: CategoryQuickEditAction = async (command) => {
    const result = await updateAction(command);
    return result.ok
      ? { ok: true, value: { categoryId: result.value.categoryId } }
      : { ok: false, error: result.error };
  };

  return (
    <section className="space-y-6" data-testid="transaction-detail-screen">
      <PageHeader
        action={<Link className="inline-flex h-10 w-full items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto" data-testid="review-detail-back" href={backHref}>Voltar para lançamentos</Link>}
        description="Consulte o fato econômico, o efeito no ledger e a origem imutável deste lançamento."
        eyebrow="Movimentações"
        title={transaction.description}
      />
      <TransactionReviewBadges categoryId={transaction.categoryId} origin={transaction.origin} reviewState={transaction.reviewState} testId="review-detail-badges" />
      {successMessage ? <SuccessFeedback description="A lista e o detalhe foram revalidados." message={successMessage} testId="review-detail-success" /> : null}
      {operationError ? <ErrorState message={operationError.message} retryHref={backHref} testId="review-detail-operation-error" title="Não foi possível atualizar o lançamento" /> : null}
      <div className="grid gap-6 lg:grid-cols-2"><EventDetails transaction={transaction} /><EntryDetails transaction={transaction} />{initialBalance ? <AccountBalanceDetails balance={initialBalance} /> : null}<HistoryDetails transaction={transaction} /><SourceDetails source={transaction.source} /></div>
      {editable ? (
        <section aria-labelledby="review-maintenance-title" className="space-y-5" data-testid="review-maintenance">
          <div className="space-y-2"><p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">Manutenção segura</p><h2 className="text-2xl font-semibold" id="review-maintenance-title">Corrija os dados descritivos</h2><p className="max-w-3xl text-sm leading-6 text-muted-foreground">Somente descrição e categoria podem ser editadas. A categoria deve ser compatível com o tipo do lançamento; “Sem categoria” mantém a pendência explícita.</p></div>
          <TransactionForm accounts={accountOptions} categories={reviewCategories} disabled={isUpdating || isCancelling} error={toFormError(operationError)} key={transaction.updatedAt} mode="edit" onCancel={() => router.push(backHref)} onSubmit={handleUpdate} pendingLabel="Salvando…" submitLabel="Salvar alterações" testId="transaction-detail-edit-form" transaction={formTransaction} />
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950" data-testid="review-readonly-guidance">Valor, data, conta, tipo, status, origem, lote, linha, identificador externo e entry não podem ser editados nesta tela.</div>
          {transaction.origin === "IMPORT" ? <CategoryQuickEdit action={categoryQuickEditAction} categories={reviewCategories} categoryId={transaction.categoryId} currentCategory={transaction.category} disabled={isUpdating} financialEventId={transaction.id} kind={transaction.kind} label="Atalho de categoria" testId="review-detail-category-quick-edit" /> : null}
          {transaction.origin === "MANUAL" && cancelAction ? <div aria-labelledby="review-cancel-title" className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-testid="transaction-cancel-section"><h2 className="text-lg font-semibold" id="review-cancel-title">Cancelar lançamento</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">O cancelamento adiciona um reversal compensatório e mantém o lançamento consultável.</p><div className="mt-4"><CancelTransactionConfirmation disabled={isUpdating || isCancelling} onConfirm={handleCancellation} /></div></div> : null}
        </section>
      ) : (
        <aside className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950" data-testid="review-not-editable-guidance"><p className="font-medium">Lançamento cancelado</p><p className="mt-1 text-sm leading-6 text-amber-900/80">Este fato permanece disponível para consulta, mas não pode ser revisado.</p></aside>
      )}
    </section>
  );
}
