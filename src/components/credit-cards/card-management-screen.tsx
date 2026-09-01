"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import type { ZodError } from "zod";

import {
  archiveCreditCardAction,
  createCreditCardAction,
  listCreditCardsAction,
  updateCreditCardAction,
  updateCreditCardBillingRuleAction,
} from "@/app/actions/credit-cards";
import { BillingDayInput } from "./billing-inputs";
import {
  CreditCardActionFeedback,
  CreditCardConfirmation,
  CreditCardFieldError,
  CreditCardSubmitButton,
  useCreditCardSubmitGuard,
} from "./feedback";
import { CreditCardDateField, CreditCardMoneyField } from "./form-fields";
import { CreditCardAccountSelector } from "./selectors";
import { EmptyState, ErrorState, LoadingState, SuccessFeedback } from "@/components/ui/async-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable, ResourceList } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { generateUuidV7 } from "@/lib/uuidv7";
import type {
  CreditCardReadModel,
  CreditCardStatusFilter,
} from "@/modules/credit-cards/contracts";
import { formatMoneyBRL } from "@/modules/transactions/money";

import {
  archiveCardCommandSchema,
  createCardFormSchema,
  toArchiveCardCommand,
  toCreateCardCommand,
  toCreditCardErrorViewModel,
  toUpdateBillingRuleCommand,
  toUpdateCardCommand,
  updateBillingRuleFormSchema,
  updateCardFormSchema,
  type AccountOptionViewModel,
} from "./ui-contracts";
import { creditCardHref, CREDIT_CARD_ROUTES } from "./ui-contracts";

export type CreditCardAccountOption = AccountOptionViewModel;

const FORM_CONTROL_CLASS =
  "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

type FormErrors = Partial<Record<string, string>>;

function formatCents(value: string): string {
  try {
    return formatMoneyBRL(value);
  } catch {
    return "Valor indisponível";
  }
}

function latestRule(card: CreditCardReadModel) {
  return card.billingRules[card.billingRules.length - 1] ?? null;
}

function fieldErrors(error: ZodError): FormErrors {
  const result: FormErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !result[field]) {
      result[field] = issue.message;
    }
  }
  return result;
}

function fieldError(errors: FormErrors, field: string): string | undefined {
  return errors[field];
}

function accountName(
  accountId: string | null,
  accounts: readonly CreditCardAccountOption[],
): string {
  if (!accountId) return "Nenhuma conta padrão definida";
  return accounts.find((account) => account.id === accountId)?.name ?? "Conta arquivada ou indisponível";
}

function cardRuleDescription(card: CreditCardReadModel): string {
  const rule = card.activeBillingRule ?? latestRule(card);
  return rule
    ? `Fechamento no dia ${rule.closingDay} · vencimento no dia ${rule.dueDay}`
    : "Regra de cobrança indisponível";
}

function CardListItem({ card }: { card: CreditCardReadModel }) {
  return (
    <article className="space-y-4" data-testid={`credit-card-item-${card.id}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <Link
            className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={creditCardHref(card.id)}
          >
            {card.name}
          </Link>
          <p className="text-xs text-muted-foreground">{cardRuleDescription(card)}</p>
        </div>
        <StatusBadge status={card.status} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Limite contratual</dt>
          <dd className="mt-1 font-medium tabular-nums">{formatCents(card.creditLimitCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Conta de pagamento</dt>
          <dd className="mt-1">{card.defaultPaymentAccountId ? "Configurada" : "Não configurada"}</dd>
        </div>
      </dl>
      <div className="flex justify-end border-t pt-3">
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={creditCardHref(card.id)}>
          Consultar cartão
        </Link>
      </div>
    </article>
  );
}

export interface CreditCardCollectionScreenProps {
  initialCards: readonly CreditCardReadModel[];
}

/**
 * Card collection read island. The initial read is server-side and status
 * changes go back through the T05 action boundary; no household identifier is
 * accepted by this component or copied into a browser request.
 */
export function CreditCardCollectionScreen({ initialCards }: CreditCardCollectionScreenProps) {
  const [status, setStatus] = React.useState<CreditCardStatusFilter>("ACTIVE");
  const [cards, setCards] = React.useState<readonly CreditCardReadModel[]>(initialCards);
  const [isLoading, setIsLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<unknown>(null);
  const requestSequence = React.useRef(0);

  async function loadCards(nextStatus: CreditCardStatusFilter) {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await listCreditCardsAction({ status: nextStatus });
      if (requestId !== requestSequence.current) return;
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setCards(result.value.items);
    } catch {
      if (requestId === requestSequence.current) setLoadError({ code: "UNEXPECTED_ERROR" });
    } finally {
      if (requestId === requestSequence.current) setIsLoading(false);
    }
  }

  async function changeStatus(nextStatus: CreditCardStatusFilter) {
    if (nextStatus === status || isLoading) return;
    setStatus(nextStatus);
    await loadCards(nextStatus);
  }

  const archived = status === "ARCHIVED";
  const collectionLabel = archived ? "cartões arquivados" : "cartões ativos";

  return (
    <section className="space-y-6" data-testid="credit-card-collection-screen">
      <PageHeader
        action={
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link className={`${buttonVariants({ variant: "outline" })} w-full sm:w-auto`} href="/credit-cards/purchases/new">
              Nova compra
            </Link>
            <Link className={`${buttonVariants()} w-full sm:w-auto`} href={CREDIT_CARD_ROUTES.create}>
              Novo cartão
            </Link>
          </div>
        }
        description="Cadastre cartões e consulte sua configuração contratual sem tratar limite como saldo disponível."
        eyebrow="Cartões"
        title="Cartões de crédito"
      />

      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">{archived ? "Histórico de cartões" : "Cartões disponíveis"}</p>
          <p className="text-sm text-muted-foreground">
            {archived
              ? "Cartões arquivados permanecem consultáveis para preservar o histórico."
              : "Somente cartões ativos aparecem em novos fluxos."}
          </p>
        </div>
        <Button
          aria-pressed={archived}
          className="w-full sm:w-auto"
          data-testid="credit-card-archived-toggle"
          disabled={isLoading}
          onClick={() => void changeStatus(archived ? "ACTIVE" : "ARCHIVED")}
          type="button"
          variant="outline"
        >
          {archived ? "Voltar aos ativos" : "Ver arquivados"}
        </Button>
      </div>

      {isLoading ? (
        <LoadingState label={`Carregando ${collectionLabel}…`} testId="credit-card-loading" />
      ) : loadError ? (
        <ErrorState
          message={toCreditCardErrorViewModel(loadError).message}
          retryHref={CREDIT_CARD_ROUTES.collection}
          testId="credit-card-load-error"
        />
      ) : cards.length === 0 ? (
        <EmptyState
          action={
            archived ? undefined : (
              <Link className={buttonVariants()} href={CREDIT_CARD_ROUTES.create}>
                Cadastrar primeiro cartão
              </Link>
            )
          }
          description={
            archived
              ? "Cartões arquivados ficam disponíveis aqui para consulta histórica."
              : "Cadastre seu primeiro cartão para organizar as próximas compras."
          }
          testId="credit-card-empty"
          title={archived ? "Nenhum cartão arquivado" : "Nenhum cartão cadastrado"}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              caption={`Lista de ${collectionLabel}`}
              columns={[
                {
                  key: "name",
                  header: "Cartão",
                  render: (card) => <CardListItem card={card} />,
                },
                {
                  key: "limit",
                  header: "Limite contratual",
                  render: (card) => <span className="tabular-nums">{formatCents(card.creditLimitCents)}</span>,
                },
                {
                  key: "billing",
                  header: "Regra vigente",
                  render: (card) => cardRuleDescription(card),
                },
                {
                  key: "status",
                  header: "Status",
                  render: (card) => <StatusBadge status={card.status} />,
                },
                {
                  key: "action",
                  header: "Ação",
                  className: "text-right",
                  render: (card) => (
                    <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={creditCardHref(card.id)}>
                      Consultar
                    </Link>
                  ),
                },
              ]}
              getRowKey={(card) => card.id}
              rows={cards}
              testId="credit-card-table"
            />
          </div>
          <div className="md:hidden">
            <ResourceList
              getItemKey={(card) => card.id}
              items={cards}
              renderItem={(card) => <CardListItem card={card} />}
              testId="credit-card-list"
            />
          </div>
        </>
      )}
    </section>
  );
}

function FormFieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p aria-live="polite" className="text-sm text-destructive" id={`${id}-error`} role="alert">
      {message}
    </p>
  );
}

interface CreateCardFormProps {
  accounts: readonly CreditCardAccountOption[];
  onCancel?: () => void;
}

const EMPTY_CREATE_VALUES = {
  name: "",
  creditLimitCents: "",
  closingDay: "",
  dueDay: "",
  defaultPaymentAccountId: "",
} as const;

/** Card creation island using only the T05 action and the T11 form contract. */
export function CreditCardCreateForm({ accounts, onCancel }: CreateCardFormProps) {
  const router = useRouter();
  const [values, setValues] = React.useState<Record<string, string>>(EMPTY_CREATE_VALUES);
  const [errors, setErrors] = React.useState<FormErrors>({});
  const [actionError, setActionError] = React.useState<unknown>(null);
  const [created, setCreated] = React.useState<CreditCardReadModel | null>(null);
  const { isSubmitting, run } = useCreditCardSubmitGuard();

  function updateValue(field: string, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setActionError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setActionError(null);
    setCreated(null);

    const parsed = createCardFormSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    const command = toCreateCardCommand(parsed.data, generateUuidV7());
    const result = await run(() => createCreditCardAction(command));
    if (!result) return;
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setCreated(result.value);
  }

  if (created) {
    return (
      <section className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-testid="credit-card-create-success">
        <SuccessFeedback
          description={`${created.name} · limite contratual ${formatCents(created.creditLimitCents)}.`}
          message="Cartão cadastrado com sucesso."
          testId="credit-card-create-success-feedback"
        />
        <p className="text-sm leading-6 text-muted-foreground">
          A configuração de cobrança foi criada. O cartão já pode ser usado por seletores de novos fluxos.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button onClick={() => setCreated(null)} type="button" variant="outline">
            Cadastrar outro
          </Button>
          <Link className={buttonVariants()} href={creditCardHref(created.id)}>
            Consultar cartão
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="credit-card-create-form-title" className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-testid="credit-card-create-form">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold" id="credit-card-create-form-title">Dados do cartão</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          O limite é contratual e não representa saldo disponível ou valor da fatura.
        </p>
      </div>
      <form className="mt-6 space-y-5" noValidate onSubmit={(event) => void submit(event)}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="credit-card-name">Nome do cartão</label>
          <input
            aria-describedby="credit-card-name-error"
            aria-invalid={Boolean(fieldError(errors, "name"))}
            autoComplete="off"
            className={FORM_CONTROL_CLASS}
            data-testid="credit-card-name-input"
            id="credit-card-name"
            onChange={(event) => updateValue("name", event.currentTarget.value)}
            value={values.name}
          />
          <FormFieldError id="credit-card-name" message={fieldError(errors, "name")} />
          <CreditCardFieldError error={actionError} field="name" fieldId="credit-card-name" />
        </div>

        <CreditCardMoneyField
          description="Digite o valor em reais; o servidor recebe centavos inteiros."
          error={fieldError(errors, "creditLimitCents")}
          id="credit-card-limit"
          label="Limite contratual"
          onCentsChange={(value) => updateValue("creditLimitCents", value)}
          testId="credit-card-limit-field"
          value={values.creditLimitCents}
        />
        <CreditCardFieldError error={actionError} field="creditLimitCents" fieldId="credit-card-limit" />

        <div className="grid gap-5 sm:grid-cols-2">
          <BillingDayInput
            aria-describedby="credit-card-closing-day-error"
            error={fieldError(errors, "closingDay")}
            id="credit-card-closing-day"
            label="Dia de fechamento"
            onChange={(event) => updateValue("closingDay", event.currentTarget.value)}
            testId="credit-card-closing-day-field"
            value={values.closingDay}
          />
          <BillingDayInput
            aria-describedby="credit-card-due-day-error"
            error={fieldError(errors, "dueDay")}
            id="credit-card-due-day"
            label="Dia de vencimento"
            onChange={(event) => updateValue("dueDay", event.currentTarget.value)}
            testId="credit-card-due-day-field"
            value={values.dueDay}
          />
        </div>
        <CreditCardFieldError error={actionError} field="closingDay" fieldId="credit-card-closing-day" />
        <CreditCardFieldError error={actionError} field="dueDay" fieldId="credit-card-due-day" />

        <CreditCardAccountSelector
          accounts={accounts}
          description="Opcional. Contas de cartão não podem ser usadas como conta de pagamento."
          error={fieldError(errors, "defaultPaymentAccountId")}
          id="credit-card-payment-account"
          label="Conta padrão de pagamento"
          onChange={(event) => updateValue("defaultPaymentAccountId", event.currentTarget.value)}
          testId="credit-card-payment-account-field"
          value={values.defaultPaymentAccountId}
        />
        <CreditCardFieldError error={actionError} field="defaultPaymentAccountId" fieldId="credit-card-payment-account" />

        <CreditCardActionFeedback error={actionError} retryHref={CREDIT_CARD_ROUTES.create} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            disabled={isSubmitting}
            onClick={onCancel ?? (() => router.push(CREDIT_CARD_ROUTES.collection))}
            type="button"
            variant="ghost"
          >
            Cancelar
          </Button>
          <CreditCardSubmitButton isSubmitting={isSubmitting} label="Cadastrar cartão" pendingLabel="Cadastrando…" />
        </div>
      </form>
    </section>
  );
}

interface CardMaintenanceProps {
  card: CreditCardReadModel;
  accounts: readonly CreditCardAccountOption[];
}

/** Metadata, versioned billing rule and archive actions for one card. */
export function CreditCardMaintenance({ card: initialCard, accounts }: CardMaintenanceProps) {
  const router = useRouter();
  const [card, setCard] = React.useState(initialCard);
  const [metadataValues, setMetadataValues] = React.useState({
    name: initialCard.name,
    creditLimitCents: initialCard.creditLimitCents,
    defaultPaymentAccountId: initialCard.defaultPaymentAccountId ?? "",
  });
  const currentRule = card.activeBillingRule ?? latestRule(card);
  const [billingValues, setBillingValues] = React.useState({
    closingDay: currentRule ? String(currentRule.closingDay) : "",
    dueDay: currentRule ? String(currentRule.dueDay) : "",
    effectiveFrom: "",
  });
  const [metadataErrors, setMetadataErrors] = React.useState<FormErrors>({});
  const [billingErrors, setBillingErrors] = React.useState<FormErrors>({});
  const [operationError, setOperationError] = React.useState<unknown>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = React.useState(false);
  const metadataGuard = useCreditCardSubmitGuard();
  const billingGuard = useCreditCardSubmitGuard();
  const archiveGuard = useCreditCardSubmitGuard();

  function clearOutcome() {
    setOperationError(null);
    setSuccessMessage(null);
  }

  async function updateMetadata(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearOutcome();
    setMetadataErrors({});
    const parsed = updateCardFormSchema.safeParse(metadataValues);
    if (!parsed.success) {
      setMetadataErrors(fieldErrors(parsed.error));
      return;
    }
    const command = toUpdateCardCommand(parsed.data, card.id, generateUuidV7());
    const result = await metadataGuard.run(() => updateCreditCardAction(command));
    if (!result) return;
    if (!result.ok) {
      setOperationError(result.error);
      return;
    }
    setCard(result.value);
    setMetadataValues({
      name: result.value.name,
      creditLimitCents: result.value.creditLimitCents,
      defaultPaymentAccountId: result.value.defaultPaymentAccountId ?? "",
    });
    setSuccessMessage("Dados do cartão atualizados.");
  }

  async function updateBilling(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearOutcome();
    setBillingErrors({});
    const parsed = updateBillingRuleFormSchema.safeParse(billingValues);
    if (!parsed.success) {
      setBillingErrors(fieldErrors(parsed.error));
      return;
    }
    const command = toUpdateBillingRuleCommand(parsed.data, card.id, generateUuidV7());
    const result = await billingGuard.run(() => updateCreditCardBillingRuleAction(command));
    if (!result) return;
    if (!result.ok) {
      setOperationError(result.error);
      return;
    }
    setCard(result.value);
    const nextRule = result.value.billingRules[result.value.billingRules.length - 1];
    setBillingValues({
      closingDay: nextRule ? String(nextRule.closingDay) : "",
      dueDay: nextRule ? String(nextRule.dueDay) : "",
      effectiveFrom: "",
    });
    setSuccessMessage("Nova regra de cobrança criada. Compras antigas mantêm suas datas.");
  }

  async function archive() {
    clearOutcome();
    const parsed = archiveCardCommandSchema.safeParse(toArchiveCardCommand(card.id, generateUuidV7()));
    if (!parsed.success) {
      setOperationError({ code: "INVALID_CARD_ID" });
      return;
    }
    const result = await archiveGuard.run(() => archiveCreditCardAction(parsed.data));
    if (!result) return;
    if (!result.ok) {
      setOperationError(result.error);
      return;
    }
    setCard(result.value);
    setConfirmArchive(false);
    setSuccessMessage("Cartão arquivado. O histórico continua disponível em modo somente leitura.");
  }

  const isArchived = card.status === "ARCHIVED";
  const metadataDisabled = isArchived || metadataGuard.isSubmitting;
  const billingDisabled = isArchived || billingGuard.isSubmitting;

  return (
    <section className="space-y-6" data-testid="credit-card-maintenance">
      <CreditCardActionFeedback error={operationError} successMessage={successMessage ?? undefined} retryHref={creditCardHref(card.id)} />

      {!isArchived ? (
        <div className="flex justify-end">
          <Link className={buttonVariants({ variant: "outline" })} href={`${creditCardHref(card.id)}/purchases/new`}>
            Registrar compra neste cartão
          </Link>
        </div>
      ) : null}

      <section aria-labelledby="credit-card-metadata-title" className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">Configuração do cartão</p>
            <h2 className="text-xl font-semibold" id="credit-card-metadata-title">Dados contratuais</h2>
            <p className="text-sm leading-6 text-muted-foreground">O limite exibido é contratual; obrigações, faturas e créditos serão projeções próprias quando integradas.</p>
          </div>
          <StatusBadge status={card.status} />
        </div>
        <form className="mt-6 space-y-5" noValidate onSubmit={(event) => void updateMetadata(event)}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="credit-card-edit-name">Nome do cartão</label>
            <input
              aria-describedby="credit-card-edit-name-error"
              aria-invalid={Boolean(fieldError(metadataErrors, "name"))}
              className={FORM_CONTROL_CLASS}
              disabled={metadataDisabled}
              id="credit-card-edit-name"
              onChange={(event) => {
                const name = event.currentTarget.value;
                setMetadataValues((current) => ({ ...current, name }));
              }}
              value={metadataValues.name}
            />
            <FormFieldError id="credit-card-edit-name" message={fieldError(metadataErrors, "name")} />
            <CreditCardFieldError error={operationError} field="name" fieldId="credit-card-edit-name" />
          </div>
          <CreditCardMoneyField
            description="A alteração não é saldo disponível."
            disabled={metadataDisabled}
            error={fieldError(metadataErrors, "creditLimitCents")}
            id="credit-card-edit-limit"
            label="Limite contratual"
            onCentsChange={(value) => setMetadataValues((current) => ({ ...current, creditLimitCents: value }))}
            testId="credit-card-edit-limit-field"
            value={metadataValues.creditLimitCents}
          />
          <CreditCardFieldError error={operationError} field="creditLimitCents" fieldId="credit-card-edit-limit" />
          <CreditCardAccountSelector
            accounts={accounts}
            disabled={metadataDisabled}
            description={accountName(metadataValues.defaultPaymentAccountId || null, accounts)}
            error={fieldError(metadataErrors, "defaultPaymentAccountId")}
            id="credit-card-edit-payment-account"
            label="Conta padrão de pagamento"
            onChange={(event) => {
              const defaultPaymentAccountId = event.currentTarget.value;
              setMetadataValues((current) => ({ ...current, defaultPaymentAccountId }));
            }}
            testId="credit-card-edit-payment-account-field"
            value={metadataValues.defaultPaymentAccountId}
          />
          <CreditCardFieldError error={operationError} field="defaultPaymentAccountId" fieldId="credit-card-edit-payment-account" />
          <div className="flex justify-end">
            <CreditCardSubmitButton disabled={isArchived} isSubmitting={metadataGuard.isSubmitting} label="Salvar dados" pendingLabel="Salvando…" />
          </div>
        </form>
      </section>

      <section aria-labelledby="credit-card-billing-title" className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="text-xl font-semibold" id="credit-card-billing-title">Regra de cobrança</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Uma alteração cria uma nova versão a partir da vigência informada. Compras e parcelas antigas mantêm o snapshot de suas datas.
        </p>
        {currentRule ? (
          <dl className="mt-4 grid gap-4 rounded-lg border bg-background p-4 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">Vigente desde</dt><dd className="mt-1 font-medium">{currentRule.effectiveFrom}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Fechamento</dt><dd className="mt-1 font-medium">Dia {currentRule.closingDay}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Vencimento</dt><dd className="mt-1 font-medium">Dia {currentRule.dueDay}</dd></div>
          </dl>
        ) : null}
        <form className="mt-6 space-y-5" noValidate onSubmit={(event) => void updateBilling(event)}>
          <div className="grid gap-5 sm:grid-cols-2">
            <BillingDayInput
              disabled={billingDisabled}
              error={fieldError(billingErrors, "closingDay")}
              id="credit-card-edit-closing-day"
              label="Novo dia de fechamento"
              onChange={(event) => {
                const closingDay = event.currentTarget.value;
                setBillingValues((current) => ({ ...current, closingDay }));
              }}
              testId="credit-card-edit-closing-day-field"
              value={billingValues.closingDay}
            />
            <BillingDayInput
              disabled={billingDisabled}
              error={fieldError(billingErrors, "dueDay")}
              id="credit-card-edit-due-day"
              label="Novo dia de vencimento"
              onChange={(event) => {
                const dueDay = event.currentTarget.value;
                setBillingValues((current) => ({ ...current, dueDay }));
              }}
              testId="credit-card-edit-due-day-field"
              value={billingValues.dueDay}
            />
          </div>
          <CreditCardDateField
            description="Use uma data posterior à última vigência."
            disabled={billingDisabled}
            error={fieldError(billingErrors, "effectiveFrom")}
            id="credit-card-effective-from"
            label="Nova vigência"
            maxDate="9999-12-31"
            onChange={(event) => {
              const effectiveFrom = event.currentTarget.value;
              setBillingValues((current) => ({ ...current, effectiveFrom }));
            }}
            testId="credit-card-effective-from-field"
            value={billingValues.effectiveFrom}
          />
          <CreditCardFieldError error={operationError} field="closingDay" fieldId="credit-card-edit-closing-day" />
          <CreditCardFieldError error={operationError} field="dueDay" fieldId="credit-card-edit-due-day" />
          <CreditCardFieldError error={operationError} field="effectiveFrom" fieldId="credit-card-effective-from" />
          <div className="flex justify-end">
            <CreditCardSubmitButton disabled={isArchived} isSubmitting={billingGuard.isSubmitting} label="Criar nova regra" pendingLabel="Criando…" />
          </div>
        </form>
      </section>

      <section aria-labelledby="credit-card-archive-title" className="rounded-2xl border border-destructive/30 bg-card p-5 shadow-sm sm:p-6">
        <h2 className="text-xl font-semibold" id="credit-card-archive-title">Arquivar cartão</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">Arquivar retira o cartão de novos seletores, mas não apaga compras, parcelas ou regras históricas.</p>
        {isArchived ? (
          <p className="mt-4 text-sm font-medium text-muted-foreground">Este cartão está arquivado e permanece disponível somente para consulta.</p>
        ) : (
          <>
            <div className="mt-4 flex justify-end">
              <Button disabled={archiveGuard.isSubmitting} onClick={() => setConfirmArchive(true)} type="button" variant="outline">Arquivar cartão</Button>
            </div>
            <CreditCardConfirmation
              description="O cartão deixará de aparecer para novas compras e pagamentos. O histórico continuará preservado."
              onConfirm={archive}
              onOpenChange={setConfirmArchive}
              open={confirmArchive}
              pendingLabel="Arquivando…"
              title={`Arquivar ${card.name}?`}
              testId="credit-card-archive-confirmation"
            />
          </>
        )}
      </section>

      <div className="flex justify-end">
        <Button onClick={() => router.push(CREDIT_CARD_ROUTES.collection)} type="button" variant="ghost">Voltar para cartões</Button>
      </div>
    </section>
  );
}
