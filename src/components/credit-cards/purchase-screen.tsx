"use client";

import Link from "next/link";
import * as React from "react";
import type { ZodError } from "zod";

import { createCreditCardPurchaseAction } from "@/app/actions/credit-card-purchases";
import { EmptyState } from "@/components/ui/async-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { generateUuidV7 } from "@/lib/uuidv7";
import type { CreditCardPurchaseReadModel } from "@/modules/credit-cards/contracts";
import { getTodayIsoDate } from "@/modules/transactions/form-contract";

import {
  CreditCardActionFeedback,
  CreditCardFieldError,
  CreditCardSubmitButton,
  useCreditCardSubmitGuard,
} from "./feedback";
import { CreditCardDateField, CreditCardMoneyField } from "./form-fields";
import { CreditCardScheduleSummary } from "./schedule-summary";
import { CreditCardSelector } from "./selectors";
import {
  createPurchaseFormSchema,
  creditCardHref,
  creditCardPurchaseHref,
  toCreatePurchaseCommand,
} from "./ui-contracts";
import { purchaseScheduleViewModel } from "./purchase-schedule-view-model";

const INPUT_CLASS_NAME =
  "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

export interface CreditCardPurchaseCardOption {
  id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
}

export interface CreditCardPurchaseCategoryOption {
  id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  kind: "EXPENSE" | "INCOME";
}

export interface CreditCardPurchaseScreenProps {
  cards: readonly CreditCardPurchaseCardOption[];
  categories: readonly CreditCardPurchaseCategoryOption[];
  initialCardId?: string;
}

type PurchaseFormValues = {
  cardId: string;
  amountCents: string;
  occurredOn: string;
  description: string;
  categoryId: string | null;
  installmentCount: string;
};

type FormErrors = Partial<Record<keyof PurchaseFormValues, string>>;

const EMPTY_FORM = (initialCardId?: string): PurchaseFormValues => ({
  cardId: initialCardId ?? "",
  amountCents: "",
  occurredOn: getTodayIsoDate(),
  description: "",
  categoryId: null,
  installmentCount: "1",
});

function formFieldErrors(error: ZodError): FormErrors {
  const result: FormErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (
      typeof field === "string" &&
      field in EMPTY_FORM() &&
      !result[field as keyof PurchaseFormValues]
    ) {
      result[field as keyof PurchaseFormValues] = issue.message;
    }
  }
  return result;
}

function inlineError(id: string, message?: string) {
  return message ? (
    <p aria-live="polite" className="text-sm text-destructive" id={`${id}-error`} role="alert">
      {message}
    </p>
  ) : null;
}

/**
 * Purchase create island. The command ID is retained after an expected action
 * failure, so retrying the same payload is idempotent; editing any field
 * starts a new attempt. No purchase action runs while the user is only
 * reviewing the form.
 */
export function CreditCardPurchaseScreen({
  cards,
  categories,
  initialCardId,
}: CreditCardPurchaseScreenProps) {
  const [values, setValues] = React.useState<PurchaseFormValues>(() => EMPTY_FORM(initialCardId));
  const [errors, setErrors] = React.useState<FormErrors>({});
  const [actionError, setActionError] = React.useState<unknown>(null);
  const [created, setCreated] = React.useState<CreditCardPurchaseReadModel | null>(null);
  const commandIdRef = React.useRef<string | null>(null);
  const { isSubmitting, run } = useCreditCardSubmitGuard();

  const activeCards = cards.filter((card) => card.status !== "ARCHIVED");
  const activeCategories = categories.filter(
    (category) => category.status !== "ARCHIVED" && category.kind === "EXPENSE",
  );

  function updateValue<Field extends keyof PurchaseFormValues>(field: Field, value: PurchaseFormValues[Field]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setActionError(null);
    setCreated(null);
    commandIdRef.current = null;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setActionError(null);
    setCreated(null);

    const parsed = createPurchaseFormSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(formFieldErrors(parsed.error));
      return;
    }

    commandIdRef.current ??= generateUuidV7();
    const command = toCreatePurchaseCommand(parsed.data, commandIdRef.current);
    const result = await run(() => createCreditCardPurchaseAction(command));
    if (!result) return;
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    commandIdRef.current = null;
    setCreated(result.value);
  }

  if (activeCards.length === 0) {
    return (
      <EmptyState
        action={
          <Link className={buttonVariants()} href="/credit-cards/new">
            Cadastrar cartão
          </Link>
        }
        description="Compras novas só podem ser associadas a um cartão ativo. Cartões arquivados permanecem no histórico."
        testId="credit-card-purchase-no-active-cards"
        title="Nenhum cartão ativo"
      />
    );
  }

  if (created) {
    const schedule = purchaseScheduleViewModel(created);
    return (
      <section className="space-y-5" data-testid="credit-card-purchase-success">
        <CreditCardActionFeedback
          successMessage="Compra registrada. O schedule abaixo foi calculado pelo servidor."
          testId="credit-card-purchase-success-feedback"
        />
        <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
          <h2 className="text-xl font-semibold">Compra confirmada</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {created.description} · realizada em {created.occurredOn}. O total econômico é mostrado uma única vez; os valores abaixo são as parcelas retornadas pelo servidor.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Link className={`${buttonVariants({ variant: "outline" })} w-full sm:w-auto`} href={creditCardHref(created.cardId)}>
              Ver cartão
            </Link>
            <Button className="w-full sm:w-auto" onClick={() => setCreated(null)} type="button">
              Registrar outra compra
            </Button>
          </div>
        </div>
        <CreditCardScheduleSummary
          purchaseHref={creditCardPurchaseHref(created.cardId, created.id)}
          schedule={schedule}
          state="success"
          successMessage="Parcelamento confirmado; competências e vencimentos vêm do schedule do servidor."
          testId="credit-card-purchase-schedule"
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="credit-card-purchase-form-title" className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-testid="credit-card-purchase-form">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold" id="credit-card-purchase-form-title">Dados da compra</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Informe o valor total da compra. A quantidade de parcelas é uma escolha da compra; valores, rounding, competências e vencimentos vêm do servidor após a confirmação.
        </p>
      </div>

      <form className="mt-6 space-y-5" noValidate onSubmit={(event) => void submit(event)}>
        <CreditCardSelector
          cards={activeCards}
          description="Somente cartões ativos aceitam novas compras."
          error={errors.cardId}
          id="credit-card-purchase-card"
          label="Cartão"
          onChange={(event) => updateValue("cardId", event.currentTarget.value)}
          testId="credit-card-purchase-card-field"
          value={values.cardId}
        />
        <CreditCardFieldError error={actionError} field="cardId" fieldId="credit-card-purchase-card" />

        <CreditCardMoneyField
          description="O valor informado é o total econômico da compra."
          error={errors.amountCents}
          id="credit-card-purchase-amount"
          label="Valor total da compra"
          onCentsChange={(value) => updateValue("amountCents", value)}
          testId="credit-card-purchase-amount-field"
          value={values.amountCents}
        />
        <CreditCardFieldError error={actionError} field="amountCents" fieldId="credit-card-purchase-amount" />

        <CreditCardDateField
          description="A data não pode estar no futuro."
          error={errors.occurredOn}
          id="credit-card-purchase-date"
          label="Data da compra"
          onChange={(event) => updateValue("occurredOn", event.currentTarget.value)}
          testId="credit-card-purchase-date-field"
          value={values.occurredOn}
        />
        <CreditCardFieldError error={actionError} field="occurredOn" fieldId="credit-card-purchase-date" />

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="credit-card-purchase-description">Descrição</label>
          <input
            aria-describedby="credit-card-purchase-description-error"
            aria-invalid={Boolean(errors.description)}
            className={INPUT_CLASS_NAME}
            id="credit-card-purchase-description"
            onChange={(event) => updateValue("description", event.currentTarget.value)}
            value={values.description}
          />
          {inlineError("credit-card-purchase-description", errors.description)}
          <CreditCardFieldError error={actionError} field="description" fieldId="credit-card-purchase-description" />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="credit-card-purchase-category">Categoria de despesa (opcional)</label>
            <p className="text-xs text-muted-foreground" id="credit-card-purchase-category-description">Categorias arquivadas ou de receita não aparecem.</p>
            <select
              aria-describedby="credit-card-purchase-category-description credit-card-purchase-category-error"
              aria-invalid={Boolean(errors.categoryId)}
              className={INPUT_CLASS_NAME}
              id="credit-card-purchase-category"
              onChange={(event) => updateValue("categoryId", event.currentTarget.value || null)}
              value={values.categoryId ?? ""}
            >
              <option value="">Sem categoria</option>
              {activeCategories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            {inlineError("credit-card-purchase-category", errors.categoryId)}
            <CreditCardFieldError error={actionError} field="categoryId" fieldId="credit-card-purchase-category" />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="credit-card-purchase-installments">Quantidade de parcelas</label>
            <p className="text-xs text-muted-foreground" id="credit-card-purchase-installments-description">Use 1 para uma compra à vista ou informe de 2 a 120 para parcelar.</p>
            <input
              aria-describedby="credit-card-purchase-installments-description credit-card-purchase-installments-error"
              aria-invalid={Boolean(errors.installmentCount)}
              className={INPUT_CLASS_NAME}
              id="credit-card-purchase-installments"
              inputMode="numeric"
              max={120}
              min={1}
              onChange={(event) => updateValue("installmentCount", event.currentTarget.value)}
              type="number"
              value={values.installmentCount}
            />
            {inlineError("credit-card-purchase-installments", errors.installmentCount)}
            <CreditCardFieldError error={actionError} field="installmentCount" fieldId="credit-card-purchase-installments" />
          </div>
        </div>

        <CreditCardActionFeedback error={actionError} retryHref="/credit-cards/purchases/new" />
        <div className="flex justify-end">
          <CreditCardSubmitButton isSubmitting={isSubmitting} label="Confirmar compra" pendingLabel="Confirmando…" />
        </div>
      </form>
    </section>
  );
}
