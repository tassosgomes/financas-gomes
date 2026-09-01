"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Check, RotateCcw, X } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  cancelManualTransactionAction,
  updateManualTransactionAction,
} from "@/app/actions/transactions";
import {
  ErrorState,
  SuccessFeedback,
} from "@/components/ui/async-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { TransactionForm } from "@/components/transactions/transaction-form";
import type { ManualTransactionFormValues } from "@/modules/transactions/form-contract";
import type {
  AccountBalanceReadModel,
  ManualTransactionDetailReadModel,
  ManualTransactionReadModel,
  S03Error,
  S03Result,
} from "@/modules/transactions/contracts";
import {
  formatDetailCents,
  formatDetailDate,
} from "./transaction-detail-utils";
import {
  commandForTransactionCancellation,
  commandForTransactionUpdate,
  type TransactionMaintenanceAttemptRef,
} from "./transaction-maintenance-attempt";
import type {
  TransactionAccountOption,
  TransactionCategoryOption,
} from "./transaction-form";
import {
  TransactionReviewDetailScreen,
  type TransactionReviewDetailScreenProps,
} from "./transaction-review-detail-screen";
import type { TransactionDetailReadModel } from "@/modules/transactions/review-contracts";

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
  SYSTEM: "Sistema",
} as const;

interface LegacyTransactionDetailScreenProps {
  initialTransaction: ManualTransactionDetailReadModel;
  initialBalance: AccountBalanceReadModel;
  accounts: readonly TransactionAccountOption[];
  categories: readonly TransactionCategoryOption[];
  backHref: string;
}

export type TransactionDetailScreenProps =
  | LegacyTransactionDetailScreenProps
  | TransactionReviewDetailScreenProps;

function safeUnexpectedError(): S03Error {
  return {
    code: "INVALID_COMMAND",
    message: "Não foi possível concluir a operação. Tente novamente.",
  };
}

function formatAbsoluteCents(value: string): string {
  try {
    const cents = BigInt(value);
    return formatDetailCents(
      (cents < BigInt(0) ? -cents : cents).toString(10),
    ).replace(/^\+/u, "");
  } catch {
    return value;
  }
}

function negateCents(value: string): string {
  try {
    return (-BigInt(value)).toString(10);
  } catch {
    return value;
  }
}

function statusClassName(status: ManualTransactionDetailReadModel["status"]): string {
  return status === "CANCELLED"
    ? "bg-amber-100 text-amber-900"
    : "bg-emerald-100 text-emerald-800";
}

function kindClassName(kind: ManualTransactionDetailReadModel["kind"]): string {
  return kind === "INCOME"
    ? "bg-emerald-100 text-emerald-800"
    : "bg-rose-100 text-rose-800";
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
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

function ReadonlyDetailField({
  label,
  value,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  testId?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function EventDetails({
  transaction,
}: {
  transaction: ManualTransactionDetailReadModel;
}) {
  const KindIcon = transaction.kind === "INCOME" ? ArrowUpRight : ArrowDownLeft;

  return (
    <section
      aria-labelledby="transaction-event-title"
      className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
      data-testid="transaction-event-details"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Fato registrado
          </p>
          <h2 className="mt-1 text-xl font-semibold" id="transaction-event-title">
            Evento econômico
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <DetailBadge
            className={kindClassName(transaction.kind)}
            testId={`transaction-detail-kind-${transaction.kind.toLowerCase()}`}
          >
            <KindIcon aria-hidden="true" className="mr-1 size-4" />
            {KIND_LABELS[transaction.kind]}
          </DetailBadge>
          <DetailBadge
            className={statusClassName(transaction.status)}
            testId={`transaction-detail-status-${transaction.status.toLowerCase()}`}
          >
            {STATUS_LABELS[transaction.status]}
          </DetailBadge>
        </div>
      </div>

      <dl className="mt-6 grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <ReadonlyDetailField
          label="Valor do evento"
          testId="transaction-detail-event-amount"
          value={formatAbsoluteCents(transaction.amountCents)}
        />
        <ReadonlyDetailField
          label="Data do evento"
          testId="transaction-detail-occurred-on"
          value={
            <time dateTime={transaction.occurredOn}>
              {formatDetailDate(transaction.occurredOn)}
            </time>
          }
        />
        <ReadonlyDetailField
          label="Conta"
          testId="transaction-detail-account"
          value={transaction.account.name}
        />
        <ReadonlyDetailField
          label="Categoria"
          testId="transaction-detail-category"
          value={transaction.category?.name ?? "Sem categoria"}
        />
        <ReadonlyDetailField
          label="Origem"
          testId="transaction-detail-origin"
          value={ORIGIN_LABELS[transaction.origin]}
        />
        <ReadonlyDetailField
          label="Identificador do evento"
          testId="transaction-detail-event-id"
          value={<code className="break-all text-xs">{transaction.id}</code>}
        />
      </dl>
    </section>
  );
}

function LedgerEntryDetails({
  transaction,
}: {
  transaction: ManualTransactionDetailReadModel;
}) {
  return (
    <section
      aria-labelledby="transaction-entry-title"
      className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
      data-testid="transaction-entry-details"
    >
      <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Efeito no ledger
      </p>
      <h2 className="mt-1 text-xl font-semibold" id="transaction-entry-title">
        Entry da conta
      </h2>
      <dl className="mt-6 grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <ReadonlyDetailField
          label="Valor assinado"
          testId="transaction-detail-entry-amount"
              value={formatDetailCents(transaction.entry.amountCents)}
        />
        <ReadonlyDetailField
          label="Status do entry"
          testId="transaction-detail-entry-status"
          value={STATUS_LABELS[transaction.entry.status]}
        />
        <ReadonlyDetailField
          label="Data de postagem"
          testId="transaction-detail-entry-posted-on"
          value={
            <time dateTime={transaction.entry.postedOn}>
              {formatDetailDate(transaction.entry.postedOn)}
            </time>
          }
        />
        <ReadonlyDetailField
          label="Identificador do entry"
          testId="transaction-detail-entry-id"
          value={<code className="break-all text-xs">{transaction.entry.id}</code>}
        />
      </dl>
      <p className="mt-5 text-sm leading-6 text-muted-foreground">
        O saldo é derivado da soma dos entries publicados. O entry original é
        preservado mesmo quando o evento é cancelado.
      </p>
    </section>
  );
}

function AccountBalanceDetails({
  balance,
}: {
  balance: AccountBalanceReadModel;
}) {
  return (
    <section
      aria-labelledby="transaction-balance-title"
      className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
      data-testid="transaction-account-balance"
    >
      <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Posição derivada
      </p>
      <h2 className="mt-1 text-xl font-semibold" id="transaction-balance-title">
        Saldo da conta
      </h2>
      <p
        className="mt-5 text-3xl font-semibold tracking-tight"
        data-testid="transaction-detail-balance-amount"
      >
        {formatDetailCents(balance.balanceCents)}
      </p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Saldo líquido derivado dos entries publicados até {formatDetailDate(balance.asOf)}.
      </p>
    </section>
  );
}

function TransactionHistory({
  transaction,
}: {
  transaction: ManualTransactionDetailReadModel;
}) {
  return (
    <section
      aria-labelledby="transaction-history-title"
      className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
      data-testid="transaction-history"
    >
      <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Trilha preservada
      </p>
      <h2 className="mt-1 text-xl font-semibold" id="transaction-history-title">
        Histórico de cancelamento
      </h2>

      <div className="mt-6 space-y-4">
        <article
          className="rounded-xl border bg-background p-4"
          data-testid="transaction-history-original"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-medium">Lançamento original</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Evento {transaction.status === "CANCELLED" ? "cancelado" : "publicado"}
              </p>
            </div>
            <DetailBadge
              className={statusClassName(transaction.status)}
              testId="transaction-history-original-status"
            >
              {STATUS_LABELS[transaction.status]}
            </DetailBadge>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <ReadonlyDetailField
              label="Valor"
              testId="transaction-history-original-amount"
              value={formatDetailCents(transaction.entry.amountCents)}
            />
            <ReadonlyDetailField
              label="Data"
              value={formatDetailDate(transaction.occurredOn)}
            />
            <ReadonlyDetailField
              label="Origem"
              value={ORIGIN_LABELS[transaction.origin]}
            />
          </dl>
        </article>

        {transaction.reversal ? (
          <article
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950"
            data-testid="transaction-history-reversal"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-medium">Efeito compensatório (reversal)</h3>
                <p className="mt-1 text-sm text-amber-900/80">
                  O cancelamento neutralizou o efeito financeiro sem apagar o histórico.
                </p>
              </div>
              <DetailBadge className="bg-amber-200 text-amber-950" testId="transaction-history-reversal-status">
                Publicado
              </DetailBadge>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <ReadonlyDetailField
                label="Valor assinado"
                testId="transaction-history-reversal-amount"
                value={formatDetailCents(negateCents(transaction.entry.amountCents))}
              />
              <ReadonlyDetailField
                label="Data"
                testId="transaction-history-reversal-date"
                value={formatDetailDate(transaction.reversal.occurredOn)}
              />
              <ReadonlyDetailField
                label="Origem"
                testId="transaction-history-reversal-origin"
                value={ORIGIN_LABELS[transaction.reversal.origin]}
              />
            </dl>
            <p className="mt-4 text-xs text-amber-900/80">
              ID do reversal: <code className="break-all">{transaction.reversal.id}</code>
            </p>
          </article>
        ) : (
          <p
            className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground"
            data-testid="transaction-history-empty"
          >
            Nenhum cancelamento foi registrado para este lançamento.
          </p>
        )}
      </div>
    </section>
  );
}

interface CancelTransactionConfirmationProps {
  disabled?: boolean;
  onConfirm: () => Promise<boolean>;
}

/** A transaction-specific confirmation; it never offers hard delete wording. */
export function CancelTransactionConfirmation({
  disabled = false,
  onConfirm,
}: CancelTransactionConfirmationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  async function confirm() {
    if (isConfirming || disabled) {
      return;
    }

    setIsConfirming(true);
    try {
      const succeeded = await onConfirm();
      if (succeeded) {
        setIsOpen(false);
      }
    } finally {
      setIsConfirming(false);
    }
  }

  if (!isOpen) {
    return (
      <Button
        className="w-full gap-2 sm:w-auto"
        data-testid="transaction-cancel-open"
        disabled={disabled}
        onClick={() => setIsOpen(true)}
        type="button"
        variant="outline"
      >
        <RotateCcw aria-hidden="true" className="size-4" />
        Cancelar lançamento
      </Button>
    );
  }

  return (
    <div
      aria-label="Confirmar cancelamento do lançamento"
      className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4"
      data-testid="transaction-cancel-confirmation"
      role="group"
    >
      <div className="space-y-1">
        <p className="font-medium text-destructive">Cancelar este lançamento?</p>
        <p className="text-sm leading-6 text-destructive/90">
          O evento original e o entry serão preservados no histórico. Um efeito
          compensatório será registrado para neutralizar o saldo da conta.
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          data-testid="transaction-cancel-dismiss"
          disabled={isConfirming}
          onClick={() => setIsOpen(false)}
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" className="mr-1 size-4" />
          Manter lançamento
        </Button>
        <Button
          aria-busy={isConfirming}
          data-testid="transaction-cancel-confirm"
          disabled={isConfirming || disabled}
          onClick={() => void confirm()}
          type="button"
          variant="default"
        >
          <Check aria-hidden="true" className="mr-1 size-4" />
          {isConfirming ? "Cancelando…" : "Confirmar cancelamento"}
        </Button>
      </div>
    </div>
  );
}

function withReferences(
  value: ManualTransactionReadModel,
  current: ManualTransactionDetailReadModel,
  categories: readonly TransactionCategoryOption[],
): ManualTransactionDetailReadModel {
  const category = value.categoryId
    ? categories.find((item) => item.id === value.categoryId) ??
      (current.categoryId === value.categoryId ? current.category : null)
    : null;

  return {
    ...value,
    account: current.account,
    category: category
      ? {
          ...category,
          householdId: current.householdId,
          parentId:
            current.categoryId === category.id ? current.category?.parentId ?? null : null,
          status: category.status ?? "ACTIVE",
          createdAt: current.category?.createdAt ?? current.createdAt,
          updatedAt: current.category?.updatedAt ?? current.updatedAt,
        }
      : null,
  };
}

function nextBalanceAfterCancellation(
  balance: AccountBalanceReadModel,
  entryAmountCents: string,
): AccountBalanceReadModel {
  try {
    return {
      ...balance,
      balanceCents: (BigInt(balance.balanceCents) - BigInt(entryAmountCents)).toString(10),
    };
  } catch {
    return balance;
  }
}

/**
 * Client island for T12. The server owns initial reads and tenant context;
 * this component owns only mutation state, confirmation and presentation.
 */
function LegacyTransactionDetailScreen({
  accounts,
  backHref,
  categories,
  initialBalance,
  initialTransaction,
}: LegacyTransactionDetailScreenProps) {
  const router = useRouter();
  const [transaction, setTransaction] = useState(initialTransaction);
  const [balance, setBalance] = useState(initialBalance);
  const [operationError, setOperationError] = useState<S03Error | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const updateAttempt = useRef<TransactionMaintenanceAttemptRef["current"]>(null);
  const cancelAttempt = useRef<TransactionMaintenanceAttemptRef["current"]>(null);

  const accountOptions = accounts;
  const categoryOptions = categories;

  async function handleUpdate(
    values: ManualTransactionFormValues,
  ): Promise<S03Result<unknown>> {
    setOperationError(null);
    setSuccessMessage(null);
    setIsUpdating(true);

    try {
      const command = commandForTransactionUpdate(
        transaction.id,
        {
          categoryId: values.categoryId,
          description: values.description,
        },
        updateAttempt,
      );
      const result = await updateManualTransactionAction(command);

      if (!result.ok) {
        setOperationError(result.error);
        return result;
      }

      updateAttempt.current = null;
      setTransaction((current) =>
        withReferences(result.value, current, categoryOptions),
      );
      setSuccessMessage("Lançamento atualizado. O efeito financeiro foi preservado.");
      router.refresh();
      return result;
    } catch {
      const error = safeUnexpectedError();
      setOperationError(error);
      return { ok: false, error };
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleCancellation(): Promise<boolean> {
    setOperationError(null);
    setSuccessMessage(null);
    setIsCancelling(true);

    try {
      const command = commandForTransactionCancellation(
        transaction.id,
        cancelAttempt,
      );
      const result = await cancelManualTransactionAction(command);

      if (!result.ok) {
        setOperationError(result.error);
        if (
          result.error.code === "EVENT_ALREADY_CANCELLED" ||
          result.error.code === "EVENT_NOT_POSTED"
        ) {
          router.refresh();
        }
        return false;
      }

      cancelAttempt.current = null;
      setTransaction((current) =>
        withReferences(result.value, current, categoryOptions),
      );
      setBalance((current) =>
        transaction.status === "POSTED" && !transaction.reversal
          ? nextBalanceAfterCancellation(current, transaction.entry.amountCents)
          : current,
      );
      setSuccessMessage(
        "Lançamento cancelado. O histórico foi preservado e o saldo foi neutralizado.",
      );
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

  const canEdit = transaction.status === "POSTED";

  return (
    <section className="space-y-6" data-testid="transaction-detail-screen">
      <PageHeader
        action={
          <Link
            className="inline-flex h-10 w-full items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
            data-testid="transaction-detail-back"
            href={backHref}
          >
            Voltar para lançamentos
          </Link>
        }
        description="Consulte o fato econômico, o efeito na conta e o histórico de manutenção deste lançamento."
        eyebrow="Movimentações"
        title={transaction.description}
      />

      {successMessage ? (
        <SuccessFeedback
          description="A tela e as leituras relacionadas foram atualizadas."
          message={successMessage}
          testId="transaction-detail-success"
        />
      ) : null}

      {operationError && !canEdit ? (
        <ErrorState
          message={operationError.message}
          testId="transaction-detail-operation-error"
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <EventDetails transaction={transaction} />
        <LedgerEntryDetails transaction={transaction} />
        <AccountBalanceDetails balance={balance} />
        <TransactionHistory transaction={transaction} />
      </div>

      {canEdit ? (
        <section
          aria-labelledby="transaction-maintenance-title"
          className="space-y-5"
          data-testid="transaction-maintenance"
        >
          <div className="space-y-2">
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Manutenção segura
            </p>
            <h2 className="text-2xl font-semibold" id="transaction-maintenance-title">
              Corrija os dados descritivos
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Somente descrição e categoria podem ser editadas. Valor, data,
              tipo e conta são somente leitura para não alterar silenciosamente
              o efeito já publicado.
            </p>
          </div>

          <TransactionForm
            accounts={accountOptions}
            categories={categoryOptions}
            disabled={isCancelling}
            error={operationError}
            key={transaction.updatedAt}
            mode="edit"
            onCancel={() => router.push(backHref)}
            onSubmit={handleUpdate}
            pendingLabel="Salvando…"
            submitLabel="Salvar alterações"
            testId="transaction-detail-edit-form"
            transaction={formTransaction}
          />

          <aside
            className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950"
            data-testid="transaction-posted-guidance"
          >
            <p className="font-medium">Precisa corrigir valor, data, tipo ou conta?</p>
            <p className="mt-1 text-sm leading-6 text-amber-900/80">
              Esses campos preservam o fato publicado. Cancele este lançamento
              e registre outro com os dados corretos quando essa alteração for
              necessária.
            </p>
          </aside>

          <div
            aria-labelledby="transaction-cancel-title"
            className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
            data-testid="transaction-cancel-section"
          >
            <h2 className="text-lg font-semibold" id="transaction-cancel-title">
              Cancelar lançamento
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              O cancelamento adiciona um reversal compensatório e mantém o
              lançamento original consultável. Ele não apaga o histórico.
            </p>
            <div className="mt-4">
              <CancelTransactionConfirmation
                disabled={isUpdating || isCancelling}
                onConfirm={handleCancellation}
              />
            </div>
          </div>
        </section>
      ) : (
        <aside
          className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950"
          data-testid="transaction-cancelled-guidance"
        >
          <p className="font-medium">Lançamento cancelado</p>
          <p className="mt-1 text-sm leading-6 text-amber-900/80">
            O histórico e o efeito compensatório permanecem disponíveis para
            consulta. Este lançamento não pode ser cancelado novamente.
          </p>
        </aside>
      )}
    </section>
  );
}

function isReviewDetail(
  value: ManualTransactionDetailReadModel | TransactionDetailReadModel,
): value is TransactionDetailReadModel {
  return "source" in value && "reviewState" in value && "needsReview" in value;
}

/**
 * Keeps the S03 detail contract stable while routing S05 read models through
 * the generic manual/import detail editor when T06 provides its action.
 */
export function TransactionDetailScreen(props: TransactionDetailScreenProps) {
  if (isReviewDetail(props.initialTransaction)) {
    if (!("updateAction" in props)) {
      return (
        <ErrorState
          message="A edição deste lançamento ainda não está disponível."
          retryHref={props.backHref}
          testId="transaction-review-action-missing"
        />
      );
    }

    return <TransactionReviewDetailScreen {...props} />;
  }

  return <LegacyTransactionDetailScreen
    {...(props as LegacyTransactionDetailScreenProps)}
  />;
}
