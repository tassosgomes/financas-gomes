"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import type { ZodError } from "zod";

import {
  cancelCreditCardPurchaseAction,
  updateCreditCardPurchaseAction,
} from "@/app/actions/credit-card-purchases";
import { ErrorState } from "@/components/ui/async-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { generateUuidV7 } from "@/lib/uuidv7";
import type { CreditCardPurchaseReadModel } from "@/modules/credit-cards/contracts";

import {
  CreditCardActionFeedback,
  CreditCardConfirmation,
  CreditCardFieldError,
  CreditCardSubmitButton,
  useCreditCardSubmitGuard,
} from "./feedback";
import {
  CreditCardScheduleSummary,
} from "./schedule-summary";
import type { CreditCardReadModelState } from "./read-models";
import type { CreditCardPurchaseCategoryOption } from "./purchase-screen";
import {
  parseCreditCardPurchaseDetail,
  toCancelPurchaseCommand,
  toCreditCardErrorViewModel,
  toUpdatePurchaseCommand,
  updatePurchaseFormSchema,
  type CreditCardPurchaseDetailViewModel,
} from "./ui-contracts";

const INPUT_CLASS_NAME =
  "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

type MetadataFormValues = {
  description: string;
  categoryId: string | null;
};

type MetadataFormErrors = Partial<Record<keyof MetadataFormValues, string>>;

export interface CreditCardPurchaseDetailScreenProps {
  /** Allow-listed T11 view model; authority fields never reach this island. */
  purchase: CreditCardPurchaseDetailViewModel;
  categories: readonly CreditCardPurchaseCategoryOption[];
  categoriesState?: CreditCardReadModelState;
  categoriesError?: unknown;
  cardName: string;
  backHref: string;
  retryHref?: string;
  testId?: string;
}

function metadataFieldErrors(error: ZodError): MetadataFormErrors {
  const result: MetadataFormErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (
      (field === "description" || field === "categoryId") &&
      !result[field]
    ) {
      result[field] = issue.message;
    }
  }
  return result;
}

function formatCents(value: string): string {
  try {
    const whole = value.slice(0, -2) || "0";
    const cents = value.slice(-2).padStart(2, "0");
    return `R$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ".")},${cents}`;
  } catch {
    return "Valor indisponível";
  }
}

function purchaseDetailFromReadModel(
  value: CreditCardPurchaseReadModel,
): CreditCardPurchaseDetailViewModel {
  const schedule = {
    purchaseId: value.schedule.purchaseId,
    totalAmountCents: value.schedule.totalAmountCents,
    installmentCount: value.schedule.installmentCount,
    items: value.schedule.installments.map((item) => ({
      id: item.id,
      purchaseId: item.purchaseId,
      installmentNumber: item.sequence,
      installmentCount: value.schedule.installmentCount,
      amountCents: item.amountCents,
      billingCycle: item.billingCycle,
      dueOn: item.billingDueOnOverride ?? item.billingDueOn,
      status: item.status,
      state: item.entryStatus === "POSTED" ? ("CONFIRMED" as const) : ("PROJECTED" as const),
    })),
  };

  return parseCreditCardPurchaseDetail({
    id: value.id,
    cardId: value.cardId,
    amountCents: value.amountCents,
    occurredOn: value.occurredOn,
    description: value.description,
    categoryId: value.categoryId,
    installmentCount: value.installmentCount,
    status: value.status ?? value.schedule.status,
    schedule,
  });
}

/**
 * Aggregate detail island. Only description/category can be sent back to
 * T09; amount, date and schedule are read-only projections. Cancellation is
 * always a single purchase command and never exposes an installment action.
 */
export function CreditCardPurchaseDetailScreen({
  backHref,
  cardName,
  categories,
  categoriesError,
  categoriesState = "ready",
  purchase,
  retryHref = backHref,
  testId = "credit-card-purchase-detail-screen",
}: CreditCardPurchaseDetailScreenProps) {
  const router = useRouter();
  const [currentPurchase, setCurrentPurchase] =
    React.useState<CreditCardPurchaseDetailViewModel>(purchase);
  const [values, setValues] = React.useState<MetadataFormValues>(() => ({
    description: purchase.description,
    categoryId: purchase.categoryId,
  }));
  const [errors, setErrors] = React.useState<MetadataFormErrors>({});
  const [actionError, setActionError] = React.useState<unknown>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const metadataCommandIdRef = React.useRef<string | null>(null);
  const cancelCommandIdRef = React.useRef<string | null>(null);
  const metadataGuard = useCreditCardSubmitGuard();
  const cancelGuard = useCreditCardSubmitGuard();

  const isCancelled = currentPurchase.status === "CANCELLED";
  const activeCategories = categories.filter(
    (category) =>
      category.kind === "EXPENSE" &&
      (category.status !== "ARCHIVED" || category.id === currentPurchase.categoryId),
  );
  const currentCategory = categories.find(
    (category) => category.id === currentPurchase.categoryId,
  );

  function updateValue<Field extends keyof MetadataFormValues>(
    field: Field,
    value: MetadataFormValues[Field],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setActionError(null);
    setSuccessMessage(null);
    metadataCommandIdRef.current = null;
  }

  async function submitMetadata(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setActionError(null);
    setSuccessMessage(null);

    const parsed = updatePurchaseFormSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(metadataFieldErrors(parsed.error));
      return;
    }

    metadataCommandIdRef.current ??= generateUuidV7();
    const command = toUpdatePurchaseCommand(
      parsed.data,
      currentPurchase.id,
      metadataCommandIdRef.current,
    );
    let result:
      | Awaited<ReturnType<typeof updateCreditCardPurchaseAction>>
      | undefined;
    try {
      result = await metadataGuard.run(() =>
        updateCreditCardPurchaseAction(command),
      );
    } catch {
      setActionError({ code: "RETRYABLE_ERROR" });
      return;
    }
    if (!result) return;
    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    metadataCommandIdRef.current = null;
    setCurrentPurchase(purchaseDetailFromReadModel(result.value));
    setValues({
      description: result.value.description,
      categoryId: result.value.categoryId,
    });
    setSuccessMessage("Dados da compra atualizados.");
    router.refresh();
  }

  async function cancelPurchase() {
    setActionError(null);
    setSuccessMessage(null);
    cancelCommandIdRef.current ??= generateUuidV7();
    const command = toCancelPurchaseCommand(
      currentPurchase.id,
      cancelCommandIdRef.current,
    );
    let result:
      | Awaited<ReturnType<typeof cancelCreditCardPurchaseAction>>
      | undefined;
    try {
      result = await cancelGuard.run(() =>
        cancelCreditCardPurchaseAction(command),
      );
    } catch {
      setActionError({ code: "RETRYABLE_ERROR" });
      return;
    }
    if (!result) return;
    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    cancelCommandIdRef.current = null;
    setCurrentPurchase(purchaseDetailFromReadModel(result.value));
    setSuccessMessage(
      "Compra cancelada. As parcelas futuras foram removidas do compromisso ativo e o histórico foi preservado.",
    );
    router.refresh();
  }

  const metadataDisabled = isCancelled || metadataGuard.isSubmitting;
  const statusLabel = isCancelled ? "Cancelada" : "Ativa";

  return (
    <section
      aria-labelledby={`${testId}-title`}
      className="space-y-6"
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          className={buttonVariants({ variant: "outline" })}
          href={backHref}
        >
          Voltar ao cartão
        </Link>
        <span
          aria-label={`Status da compra: ${statusLabel}`}
          className="rounded-full border px-3 py-1 text-sm font-medium"
        >
          {statusLabel}
        </span>
      </div>

      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Compra do cartão
        </p>
        <h1 className="text-3xl font-semibold tracking-tight" id={`${testId}-title`}>
          {currentPurchase.description}
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {cardName} · dados financeiros e schedule são imutáveis nesta tela;
          apenas descrição e categoria podem ser ajustadas.
        </p>
      </header>

      <CreditCardActionFeedback
        error={actionError}
        retryHref={retryHref}
        successMessage={successMessage ?? undefined}
        testId={`${testId}-feedback`}
      />

      <section
        aria-labelledby={`${testId}-summary-title`}
        className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
        data-testid={`${testId}-summary`}
      >
        <h2 className="text-xl font-semibold" id={`${testId}-summary-title`}>
          Resumo da compra
        </h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border bg-background px-4 py-3">
            <dt className="text-xs text-muted-foreground">Valor total</dt>
            <dd className="mt-1 font-semibold tabular-nums">
              {formatCents(currentPurchase.amountCents)}
            </dd>
          </div>
          <div className="rounded-lg border bg-background px-4 py-3">
            <dt className="text-xs text-muted-foreground">Data da compra</dt>
            <dd className="mt-1 font-semibold">{currentPurchase.occurredOn}</dd>
          </div>
          <div className="rounded-lg border bg-background px-4 py-3">
            <dt className="text-xs text-muted-foreground">Parcelamento</dt>
            <dd className="mt-1 font-semibold">
              {currentPurchase.installmentCount === 1
                ? "À vista"
                : `${currentPurchase.installmentCount} parcelas`}
            </dd>
          </div>
          <div className="rounded-lg border bg-background px-4 py-3">
            <dt className="text-xs text-muted-foreground">Categoria atual</dt>
            <dd className="mt-1 font-semibold">
              {currentCategory?.name ?? (currentPurchase.categoryId ? "Categoria indisponível" : "Sem categoria")}
            </dd>
          </div>
        </dl>
      </section>

      <section
        aria-labelledby={`${testId}-metadata-title`}
        className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
        data-testid={`${testId}-metadata`}
      >
        <h2 className="text-xl font-semibold" id={`${testId}-metadata-title`}>
          Editar metadata
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          A edição não altera valor, data, cartão ou nenhuma parcela do
          schedule.
        </p>
        <form
          className="mt-5 space-y-5"
          noValidate
          onSubmit={(event) => void submitMetadata(event)}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={`${testId}-description`}>
              Descrição
            </label>
            <input
              aria-describedby={`${testId}-description-help ${testId}-description-error`}
              aria-invalid={Boolean(errors.description)}
              className={INPUT_CLASS_NAME}
              disabled={metadataDisabled}
              id={`${testId}-description`}
              maxLength={240}
              onChange={(event) =>
                updateValue("description", event.currentTarget.value)
              }
              value={values.description}
            />
            <p
              className="text-xs text-muted-foreground"
              id={`${testId}-description-help`}
            >
              Use uma descrição curta; o valor econômico permanece inalterado.
            </p>
            {errors.description ? (
              <p
                aria-live="polite"
                className="text-sm text-destructive"
                id={`${testId}-description-error`}
                role="alert"
              >
                {errors.description}
              </p>
            ) : null}
            <CreditCardFieldError
              error={actionError}
              field="description"
              fieldId={`${testId}-description`}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={`${testId}-category`}>
              Categoria de despesa
            </label>
            <p
              className="text-xs text-muted-foreground"
              id={`${testId}-category-help`}
            >
              Categorias de receita e arquivadas não podem ser escolhidas.
            </p>
            <select
              aria-describedby={`${testId}-category-help ${testId}-category-error`}
              aria-invalid={Boolean(errors.categoryId)}
              className={INPUT_CLASS_NAME}
              disabled={metadataDisabled || categoriesState === "loading" || categoriesState === "error"}
              id={`${testId}-category`}
              onChange={(event) =>
                updateValue("categoryId", event.currentTarget.value || null)
              }
              value={values.categoryId ?? ""}
            >
              <option value="">Sem categoria</option>
              {activeCategories.map((category) => (
                <option
                  disabled={category.status === "ARCHIVED"}
                  key={category.id}
                  value={category.id}
                >
                  {category.name}{category.status === "ARCHIVED" ? " (arquivada)" : ""}
                </option>
              ))}
            </select>
            {categoriesState === "loading" ? (
              <p aria-live="polite" className="text-xs text-muted-foreground" role="status">
                Carregando categorias…
              </p>
            ) : null}
            {categoriesState === "empty" ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma categoria de despesa ativa está disponível.
              </p>
            ) : null}
            {categoriesState === "error" ? (
              <ErrorState
                message={toCreditCardErrorViewModel(categoriesError, "RETRYABLE_ERROR").message}
                retryHref={retryHref}
                testId={`${testId}-categories-error`}
              />
            ) : null}
            {errors.categoryId ? (
              <p
                aria-live="polite"
                className="text-sm text-destructive"
                id={`${testId}-category-error`}
                role="alert"
              >
                {errors.categoryId}
              </p>
            ) : null}
            <CreditCardFieldError
              error={actionError}
              field="categoryId"
              fieldId={`${testId}-category`}
            />
          </div>

          {!isCancelled ? (
            <div className="flex justify-end">
              <CreditCardSubmitButton
                disabled={categoriesState === "error"}
                isSubmitting={metadataGuard.isSubmitting}
                label="Salvar metadata"
                pendingLabel="Salvando…"
              />
            </div>
          ) : (
            <p className="rounded-lg border border-muted bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              Compras canceladas permanecem somente para consulta.
            </p>
          )}
        </form>
      </section>

      <CreditCardScheduleSummary
        purchaseHref={backHref}
        schedule={currentPurchase.schedule}
        state={currentPurchase.schedule.items.length > 0 ? "ready" : "empty"}
        successMessage="As competências e vencimentos vêm do schedule do servidor."
        testId={`${testId}-schedule`}
      />

      <section
        aria-labelledby={`${testId}-cancel-title`}
        className="rounded-2xl border border-destructive/30 bg-card p-5 shadow-sm sm:p-6"
        data-testid={`${testId}-cancel-section`}
      >
        <h2 className="text-xl font-semibold" id={`${testId}-cancel-title`}>
          Cancelar compra inteira
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          O cancelamento é do aggregate da compra. Ele não permite cancelar ou
          pagar uma parcela isolada.
        </p>
        {isCancelled ? (
          <p className="mt-4 rounded-lg border border-muted bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            Esta compra já está cancelada; o histórico foi preservado.
          </p>
        ) : (
          <>
            <div className="mt-4 flex justify-end">
              <Button
                disabled={cancelGuard.isSubmitting}
                onClick={() => setConfirmOpen(true)}
                type="button"
                variant="outline"
              >
                Cancelar compra inteira
              </Button>
            </div>
            <CreditCardConfirmation
              confirmLabel="Cancelar compra inteira"
              description="Todas as parcelas futuras serão canceladas e os efeitos já publicados serão compensados conforme o contrato. O histórico será preservado; não haverá hard delete."
              onConfirm={cancelPurchase}
              onOpenChange={setConfirmOpen}
              open={confirmOpen}
              pendingLabel="Cancelando…"
              title="Cancelar compra inteira?"
              testId={`${testId}-cancel-confirmation`}
            />
          </>
        )}
      </section>
    </section>
  );
}

export const CreditCardPurchaseDetail = CreditCardPurchaseDetailScreen;
