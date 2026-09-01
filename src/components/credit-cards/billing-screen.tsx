"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import type { ZodError } from "zod";

import { registerCreditCardPaymentAction } from "@/app/actions/credit-cards";
import {
  EmptyState,
  ErrorState,
} from "@/components/ui/async-state";
import { buttonVariants } from "@/components/ui/button";
import { generateUuidV7 } from "@/lib/uuidv7";
import { getTodayIsoDate } from "@/modules/transactions/form-contract";

import {
  CreditCardActionFeedback,
  CreditCardFieldError,
  CreditCardSubmitButton,
  useCreditCardSubmitGuard,
} from "./feedback";
import { CreditCardDateField, CreditCardMoneyField } from "./form-fields";
import {
  CreditCardPaymentStatus,
  CreditCardProjectionSummary,
  CreditCardStatementsOverview,
  type CreditCardReadModelState,
} from "./read-models";
import { CreditCardAccountSelector } from "./selectors";
import {
  createPaymentFormSchema,
  creditCardPeriodHref,
  toCreatePaymentCommand,
  toCreditCardErrorViewModel,
  type AccountOptionViewModel,
  type CreditCardPaymentStatusViewModel,
  type CreditCardProjectionSummaryViewModel,
  type CreditCardStatementViewModel,
} from "./ui-contracts";

const INPUT_CLASS_NAME =
  "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

type PaymentFormValues = {
  sourceAccountId: string;
  amountCents: string;
  occurredOn: string;
  description: string;
};

type PaymentFormErrors = Partial<Record<keyof PaymentFormValues, string>>;

const EMPTY_PAYMENT_FORM = (): PaymentFormValues => ({
  sourceAccountId: "",
  amountCents: "",
  occurredOn: getTodayIsoDate(),
  description: "",
});

function fieldErrors(error: ZodError): PaymentFormErrors {
  const result: PaymentFormErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (
      typeof field === "string" &&
      field in EMPTY_PAYMENT_FORM() &&
      !result[field as keyof PaymentFormValues]
    ) {
      result[field as keyof PaymentFormValues] = issue.message;
    }
  }
  return result;
}

function inlineError(id: string, message?: string) {
  return message ? (
    <p
      aria-live="polite"
      className="text-sm text-destructive"
      id={`${id}-error`}
      role="alert"
    >
      {message}
    </p>
  ) : null;
}

function isUsablePaymentAccount(account: AccountOptionViewModel): boolean {
  return account.status !== "ARCHIVED" && account.type !== "CREDIT_CARD";
}

export interface CreditCardGlobalPaymentFormProps {
  cardId: string;
  cardName: string;
  cardStatus: "ACTIVE" | "ARCHIVED";
  accounts: readonly AccountOptionViewModel[];
  defaultSourceAccountId?: string | null;
  accountsState?: CreditCardReadModelState;
  accountsError?: unknown;
  retryHref?: string;
  testId?: string;
}

/**
 * Registers the only payment supported by S06: one global transfer for the
 * card. The form never receives or builds a statement/installment target.
 */
export function CreditCardGlobalPaymentForm({
  accounts,
  accountsError,
  accountsState = "ready",
  cardId,
  cardName,
  cardStatus,
  defaultSourceAccountId,
  retryHref,
  testId = "credit-card-global-payment-form",
}: CreditCardGlobalPaymentFormProps) {
  const router = useRouter();
  const usableAccounts = accounts.filter(isUsablePaymentAccount);
  const initialSourceAccountId =
    defaultSourceAccountId &&
    usableAccounts.some((account) => account.id === defaultSourceAccountId)
      ? defaultSourceAccountId
      : "";
  const [values, setValues] = React.useState<PaymentFormValues>(() => ({
    ...EMPTY_PAYMENT_FORM(),
    sourceAccountId: initialSourceAccountId,
  }));
  const [errors, setErrors] = React.useState<PaymentFormErrors>({});
  const [actionError, setActionError] = React.useState<unknown>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const commandIdRef = React.useRef<string | null>(null);
  const { isSubmitting, run } = useCreditCardSubmitGuard();

  function updateValue<Field extends keyof PaymentFormValues>(
    field: Field,
    value: PaymentFormValues[Field],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setActionError(null);
    setSuccessMessage(null);
    commandIdRef.current = null;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setActionError(null);
    setSuccessMessage(null);

    const parsed = createPaymentFormSchema.safeParse({
      cardId,
      ...values,
      description: values.description || undefined,
    });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    commandIdRef.current ??= generateUuidV7();
    const command = toCreatePaymentCommand(parsed.data, commandIdRef.current);
    let result: Awaited<ReturnType<typeof registerCreditCardPaymentAction>> | undefined;
    try {
      result = await run(() => registerCreditCardPaymentAction(command));
    } catch {
      setActionError({ code: "RETRYABLE_ERROR" });
      return;
    }
    if (!result) return;
    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    commandIdRef.current = null;
    setSuccessMessage(
      "Pagamento global registrado. O estado derivado do cartão será atualizado.",
    );
    router.refresh();
  }

  if (cardStatus === "ARCHIVED") {
    return (
      <EmptyState
        description="Cartões arquivados permanecem no histórico e não aceitam novos pagamentos."
        testId={`${testId}-archived`}
        title="Cartão arquivado"
      />
    );
  }

  if (accountsState === "loading") {
    return (
      <section
        aria-labelledby={`${testId}-title`}
        className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
        data-testid={testId}
      >
        <h2 className="text-xl font-semibold" id={`${testId}-title`}>
          Pagar fatura global
        </h2>
        <p className="text-sm text-muted-foreground" role="status">
          Carregando contas de origem…
        </p>
      </section>
    );
  }

  if (accountsState === "error") {
    const safeError = toCreditCardErrorViewModel(
      accountsError,
      "RETRYABLE_ERROR",
    );
    return (
      <ErrorState
        message={safeError.message}
        retryHref={retryHref}
        testId={`${testId}-error`}
      />
    );
  }

  if (usableAccounts.length === 0) {
    return (
      <EmptyState
        action={
          <Link className={buttonVariants()} href="/accounts">
            Cadastrar conta
          </Link>
        }
        description="O pagamento global precisa de uma conta ativa que não seja um cartão de crédito."
        testId={`${testId}-empty-accounts`}
        title="Nenhuma conta de origem disponível"
      />
    );
  }

  const fieldDisabled = isSubmitting;
  return (
    <section
      aria-labelledby={`${testId}-title`}
      className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
      data-testid={testId}
    >
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Pagamento global
        </p>
        <h2 className="mt-1 text-xl font-semibold" id={`${testId}-title`}>
          Pagar a fatura de {cardName}
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          O pagamento é uma transferência do cartão como um todo. Ele não
          quita, edita ou cria uma ação para uma parcela individual.
        </p>
      </div>

      <form
        className="space-y-5"
        data-testid={`${testId}-form`}
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <CreditCardAccountSelector
          accounts={usableAccounts}
          description="Somente contas ativas que não são cartões podem financiar esta transferência."
          disabled={fieldDisabled}
          error={errors.sourceAccountId}
          id={`${testId}-source-account`}
          label="Conta de origem"
          onChange={(event) =>
            updateValue("sourceAccountId", event.currentTarget.value)
          }
          testId={`${testId}-source-account-field`}
          value={values.sourceAccountId}
        />
        <CreditCardFieldError
          error={actionError}
          field="sourceAccountId"
          fieldId={`${testId}-source-account`}
        />

        <CreditCardMoneyField
          description="Informe o valor da transferência em reais; o servidor recebe centavos inteiros."
          disabled={fieldDisabled}
          error={errors.amountCents}
          id={`${testId}-amount`}
          label="Valor do pagamento"
          onCentsChange={(value) => updateValue("amountCents", value)}
          testId={`${testId}-amount-field`}
          value={values.amountCents}
        />
        <CreditCardFieldError
          error={actionError}
          field="amountCents"
          fieldId={`${testId}-amount`}
        />

        <CreditCardDateField
          description="Use a data civil da transferência."
          disabled={fieldDisabled}
          error={errors.occurredOn}
          id={`${testId}-date`}
          label="Data do pagamento"
          maxDate={getTodayIsoDate()}
          onChange={(event) =>
            updateValue("occurredOn", event.currentTarget.value)
          }
          testId={`${testId}-date-field`}
          value={values.occurredOn}
        />
        <CreditCardFieldError
          error={actionError}
          field="occurredOn"
          fieldId={`${testId}-date`}
        />

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`${testId}-description`}>
            Descrição (opcional)
          </label>
          <input
            aria-describedby={`${testId}-description-help ${testId}-description-error`}
            aria-invalid={Boolean(errors.description)}
            className={INPUT_CLASS_NAME}
            disabled={fieldDisabled}
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
            A descrição é opcional e não define a competência da fatura.
          </p>
          {inlineError(`${testId}-description`, errors.description)}
          <CreditCardFieldError
            error={actionError}
            field="description"
            fieldId={`${testId}-description`}
          />
        </div>

        <CreditCardActionFeedback
          error={actionError}
          retryHref={retryHref}
          successMessage={successMessage ?? undefined}
          testId={`${testId}-feedback`}
        />
        <div className="flex justify-end">
          <CreditCardSubmitButton
            isSubmitting={isSubmitting}
            label="Confirmar pagamento global"
            pendingLabel="Registrando pagamento…"
          />
        </div>
      </form>
    </section>
  );
}

export interface CreditCardBillingScreenProps {
  cardId: string;
  cardName: string;
  cardStatus: "ACTIVE" | "ARCHIVED";
  defaultSourceAccountId?: string | null;
  accounts: readonly AccountOptionViewModel[];
  accountsState?: CreditCardReadModelState;
  accountsError?: unknown;
  currentStatement?: CreditCardStatementViewModel | null;
  futureStatements?: readonly CreditCardStatementViewModel[];
  projectionSummary?: CreditCardProjectionSummaryViewModel | null;
  paymentStatus?: CreditCardPaymentStatusViewModel | null;
  projectionState?: CreditCardReadModelState;
  projectionError?: unknown;
  retryHref?: string;
  testId?: string;
}

/**
 * Composes server-provided T07 projections and the T08 global payment form.
 * The client only renders serializable T11 view models and never recomputes
 * invoice, obligation, limit, credit or payment allocation values.
 */
export function CreditCardBillingScreen({
  accounts,
  accountsError,
  accountsState = "ready",
  cardId,
  cardName,
  cardStatus,
  currentStatement,
  defaultSourceAccountId,
  futureStatements = [],
  paymentStatus,
  projectionError,
  projectionState = "ready",
  projectionSummary,
  retryHref,
  testId = "credit-card-billing-screen",
}: CreditCardBillingScreenProps) {
  const statements = [
    ...(currentStatement ? [currentStatement] : []),
    ...futureStatements,
  ];
  const periods = [...new Set(statements.map((statement) => statement.period))];

  return (
    <section
      aria-labelledby={`${testId}-title`}
      className="space-y-6"
      data-testid={testId}
    >
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Faturas e comprometimento
        </p>
        <h2 className="text-2xl font-semibold" id={`${testId}-title`}>
          Posição financeira do cartão
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Fatura, obrigação contratual, limite e crédito são projeções distintas
          calculadas no servidor em uma data de referência.
        </p>
      </header>

      <CreditCardProjectionSummary
        error={projectionError}
        retryHref={retryHref}
        state={projectionState}
        summary={projectionSummary}
        testId={`${testId}-projection`}
      />

      <CreditCardPaymentStatus
        error={projectionError}
        retryHref={retryHref}
        state={projectionState}
        status={paymentStatus}
        testId={`${testId}-payment-status`}
      />

      <section
        aria-labelledby={`${testId}-statements-title`}
        className="space-y-4"
        data-testid={`${testId}-statements-section`}
      >
        <div>
          <h2 className="text-xl font-semibold" id={`${testId}-statements-title`}>
            Fatura atual e competências futuras
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            A primeira competência futura é a próxima fatura; as demais seguem
            como projeções. Cada item aponta para a compra originadora.
          </p>
        </div>
        {periods.length > 0 ? (
          <nav
            aria-label="Consultar competência da fatura"
            className="flex flex-wrap gap-2"
            data-testid={`${testId}-period-links`}
          >
            {periods.map((period) => (
              <Link
                className={`${buttonVariants({ variant: "outline", size: "sm" })} focus-visible:ring-2`}
                href={creditCardPeriodHref(cardId, { cycle: period })}
                key={period}
              >
                Consultar {period}
              </Link>
            ))}
          </nav>
        ) : null}
        <CreditCardStatementsOverview
          cardId={cardId}
          current={currentStatement}
          error={projectionError}
          future={futureStatements}
          retryHref={retryHref}
          state={projectionState}
          testId={`${testId}-statements`}
        />
      </section>

      <CreditCardGlobalPaymentForm
        accounts={accounts}
        accountsError={accountsError}
        accountsState={accountsState}
        cardId={cardId}
        cardName={cardName}
        cardStatus={cardStatus}
        defaultSourceAccountId={defaultSourceAccountId}
        retryHref={retryHref}
        testId={`${testId}-payment-form`}
      />
    </section>
  );
}

export const CreditCardInvoiceScreen = CreditCardBillingScreen;
export const CreditCardPaymentForm = CreditCardGlobalPaymentForm;
