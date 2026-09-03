"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef } from "react";
import {
  Controller,
  useForm,
  useWatch,
  type DefaultValues,
  type FieldPath,
  type Resolver,
} from "react-hook-form";

import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/transactions/date-input";
import {
  MoneyInput,
  formatMoneyInputCents,
} from "@/components/transactions/money-input";
import {
  MANUAL_TRANSACTION_DESCRIPTION_MAX_LENGTH,
  createManualTransactionFormSchema,
  getTodayIsoDate,
  type ManualTransactionFormValues,
} from "@/modules/transactions/form-contract";
import {
  MANUAL_TRANSACTION_KINDS,
  type ManualTransactionKind,
  type TransactionError,
  type TransactionResult,
} from "@/modules/transactions/contracts";

const INPUT_CLASS_NAME =
  "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 read-only:bg-muted/50";
const TEXTAREA_CLASS_NAME =
  "min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

const KIND_LABELS: Record<ManualTransactionKind, string> = {
  EXPENSE: "Despesa",
  INCOME: "Receita",
};

export interface TransactionAccountOption {
  id: string;
  name: string;
  status?: "ACTIVE" | "ARCHIVED";
  trackingStartedOn?: string | null;
}

export interface TransactionCategoryOption {
  id: string;
  name: string;
  kind: ManualTransactionKind;
  status?: "ACTIVE" | "ARCHIVED";
}

export interface TransactionFormTransaction {
  id?: string;
  kind: ManualTransactionKind;
  amountCents: string;
  occurredOn: string;
  description: string;
  accountId: string;
  categoryId?: string | null;
  accountName?: string;
  categoryName?: string | null;
  status?: "POSTED" | "CANCELLED";
}

export type TransactionFormMode = "create" | "edit";

export type TransactionFormError = Pick<TransactionError, "code" | "message"> & {
  field?: TransactionError["field"];
};

export interface TransactionFormProps {
  /** Defaults to edit when `transaction` is supplied, otherwise create. */
  mode?: TransactionFormMode;
  transaction?: TransactionFormTransaction;
  /** Useful when the edit read model is not available as a full transaction. */
  initialValues?: Partial<ManualTransactionFormValues>;
  /** Default kind for a new form; the user can switch it before submitting. */
  initialKind?: ManualTransactionKind;
  accounts: readonly TransactionAccountOption[];
  categories?: readonly TransactionCategoryOption[];
  onSubmit: (
    values: ManualTransactionFormValues,
  ) => Promise<TransactionResult<unknown> | void> | TransactionResult<unknown> | void;
  onCancel?: () => void;
  /** Used while account/category options or the action are pending. */
  isLoading?: boolean;
  /** Optional stable error returned by a parent action/read boundary. */
  error?: TransactionFormError | null;
  disabled?: boolean;
  /** Inject a deterministic business date in tests or a server-provided read. */
  today?: string;
  submitLabel?: string;
  pendingLabel?: string;
  className?: string;
  testId?: string;
}

/** Archived records are never offered as a new transaction reference. */
export function filterActiveAccounts(
  accounts: readonly TransactionAccountOption[],
): TransactionAccountOption[] {
  return accounts.filter((account) => account.status !== "ARCHIVED");
}

/** Kind filtering is applied after status filtering for a deterministic list. */
export function filterActiveCategories(
  categories: readonly TransactionCategoryOption[],
  kind: ManualTransactionKind,
): TransactionCategoryOption[] {
  return categories.filter(
    (category) =>
      category.status !== "ARCHIVED" && category.kind === kind,
  );
}

function textError(error: unknown): string | null {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return null;
}

function safeUnexpectedError(): TransactionFormError {
  return {
    code: "INVALID_COMMAND",
    message: "Não foi possível concluir o lançamento. Tente novamente.",
  };
}

function fieldError(
  errors: Record<string, unknown>,
  field: string,
): string | null {
  return textError(errors[field]);
}

function FieldMessage({
  error,
  id,
}: {
  error: string | null;
  id: string;
}) {
  return error ? (
    <p className="text-xs text-destructive" id={id} role="alert">
      {error}
    </p>
  ) : null;
}

function fieldDescribedBy(
  descriptionId: string,
  errorId: string,
  error: string | null,
): string {
  return error ? `${descriptionId} ${errorId}` : descriptionId;
}

function displayAccountName(
  account: TransactionAccountOption | undefined,
  transaction: TransactionFormTransaction | undefined,
  accountId: string,
): string {
  return account?.name ?? transaction?.accountName ?? accountId;
}

/**
 * Reusable create/edit island. Server Components own the initial option
 * reads; this component owns only form state and boundary presentation.
 */
export function TransactionForm({
  accounts,
  categories = [],
  className,
  disabled = false,
  error: externalError = null,
  initialKind = "EXPENSE",
  initialValues,
  isLoading = false,
  mode: requestedMode,
  onCancel,
  onSubmit,
  pendingLabel,
  submitLabel,
  testId = "transaction-form",
  today,
  transaction,
}: TransactionFormProps) {
  const mode: TransactionFormMode =
    requestedMode ?? (transaction ? "edit" : "create");
  const isEditing = mode === "edit";
  const businessDate = today ?? getTodayIsoDate();
  const schema = useMemo(
    () => createManualTransactionFormSchema({ today: businessDate }),
    [businessDate],
  );
  const activeAccounts = useMemo(() => filterActiveAccounts(accounts), [accounts]);
  const source = initialValues ?? transaction;
  const defaultValues: DefaultValues<ManualTransactionFormValues> = {
    accountId: source?.accountId ?? "",
    amountCents: source?.amountCents ?? "",
    categoryId: source?.categoryId ?? null,
    description: source?.description ?? "",
    kind: source?.kind ?? initialKind,
    occurredOn: source?.occurredOn ?? businessDate,
  };
  const form = useForm<ManualTransactionFormValues>({
    defaultValues,
    mode: "onBlur",
    resolver: zodResolver(schema) as Resolver<ManualTransactionFormValues>,
  });
  // React state and react-hook-form's `isSubmitting` update asynchronously.
  // Keep a synchronous guard as well so two submit events in the same turn
  // cannot reach a Server Action before the disabled button is re-rendered.
  const submitInFlightRef = useRef(false);
  const selectedKind = useWatch({ control: form.control, name: "kind" });
  const selectedAccountId = useWatch({
    control: form.control,
    name: "accountId",
  });
  const selectedCategoryId = useWatch({
    control: form.control,
    name: "categoryId",
  });
  const currentKind = selectedKind ?? initialKind;
  const activeCategories = useMemo(
    () => filterActiveCategories(categories, currentKind),
    [categories, currentKind],
  );
  const selectedAccount = activeAccounts.find(
    (account) => account.id === selectedAccountId,
  );
  const selectedCategory = categories.find(
    (category) => category.id === selectedCategoryId,
  );
  const selectedCategoryIsActive = activeCategories.some(
    (category) => category.id === selectedCategoryId,
  );
  const editArchivedCategory =
    isEditing &&
    Boolean(selectedCategoryId) &&
    Boolean(selectedCategory) &&
    !selectedCategoryIsActive;
  const allCategoryOptions = editArchivedCategory && selectedCategory
    ? [selectedCategory, ...activeCategories.filter((category) => category.id !== selectedCategory.id)]
    : activeCategories;
  const descriptionError = fieldError(
    form.formState.errors as Record<string, unknown>,
    "description",
  );
  const amountError = fieldError(
    form.formState.errors as Record<string, unknown>,
    "amountCents",
  );
  const dateError = fieldError(
    form.formState.errors as Record<string, unknown>,
    "occurredOn",
  );
  const accountError = fieldError(
    form.formState.errors as Record<string, unknown>,
    "accountId",
  );
  const categoryError = fieldError(
    form.formState.errors as Record<string, unknown>,
    "categoryId",
  );
  const kindError = fieldError(
    form.formState.errors as Record<string, unknown>,
    "kind",
  );
  const rootError =
    textError(form.formState.errors.root?.serverError) ??
    externalError?.message ??
    null;
  const formDisabled = disabled || isLoading || form.formState.isSubmitting;
  const descriptionHelpId = `${testId}-description-help`;
  const descriptionErrorId = `${testId}-description-error`;
  const amountHelpId = `${testId}-amount-help`;
  const amountErrorId = `${testId}-amount-error`;
  const dateHelpId = `${testId}-date-help`;
  const dateErrorId = `${testId}-date-error`;
  const accountHelpId = `${testId}-account-help`;
  const accountErrorId = `${testId}-account-error`;
  const categoryHelpId = `${testId}-category-help`;
  const categoryErrorId = `${testId}-category-error`;
  const kindErrorId = `${testId}-kind-error`;

  useEffect(() => {
    if (
      selectedCategoryId &&
      !selectedCategoryIsActive &&
      !editArchivedCategory
    ) {
      form.setValue("categoryId", null, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [editArchivedCategory, form, selectedCategoryId, selectedCategoryIsActive]);

  useEffect(() => {
    if (!externalError) {
      return;
    }

    if (
      externalError.field &&
      [
        "amountCents",
        "occurredOn",
        "description",
        "accountId",
        "categoryId",
      ].includes(externalError.field)
    ) {
      form.setError(externalError.field as FieldPath<ManualTransactionFormValues>, {
        type: "server",
        message: externalError.message,
      });
    }
    form.setError("root.serverError", {
      type: externalError.code,
      message: externalError.message,
    });
  }, [externalError, form]);

  async function handleValidSubmit(values: ManualTransactionFormValues) {
    if (submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;
    form.clearErrors("root.serverError");

    try {
      const result = await onSubmit(values);
      if (result && !result.ok) {
        if (
          result.error.field &&
          [
            "amountCents",
            "occurredOn",
            "description",
            "accountId",
            "categoryId",
          ].includes(result.error.field)
        ) {
          form.setError(result.error.field as FieldPath<ManualTransactionFormValues>, {
            type: "server",
            message: result.error.message,
          });
        }
        form.setError("root.serverError", {
          type: result.error.code,
          message: result.error.message,
        });
      }
    } catch {
      const unexpectedError = safeUnexpectedError();
      form.setError("root.serverError", {
        type: unexpectedError.code,
        message: unexpectedError.message,
      });
    } finally {
      submitInFlightRef.current = false;
    }
  }

  if (isLoading && activeAccounts.length === 0) {
    return (
      <section
        aria-busy="true"
        aria-live="polite"
        className={className}
        data-testid={`${testId}-loading`}
        role="status"
      >
        <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
          Carregando contas e categorias…
        </div>
      </section>
    );
  }

  if (!isEditing && activeAccounts.length === 0) {
    return (
      <section
        aria-labelledby={`${testId}-empty-title`}
        className={`rounded-2xl border border-dashed bg-card p-6 ${className ?? ""}`}
        data-testid={`${testId}-empty-accounts`}
      >
        <h2 className="text-lg font-semibold" id={`${testId}-empty-title`}>
          Cadastre uma conta antes de lançar
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          O lançamento precisa estar vinculado a uma conta ativa. Contas
          arquivadas não aparecem para novos lançamentos.
        </p>
        {onCancel ? (
          <Button className="mt-5" onClick={onCancel} type="button" variant="outline">
            Voltar
          </Button>
        ) : null}
      </section>
    );
  }

  return (
    <section
      aria-labelledby={`${testId}-title`}
      className={`rounded-2xl border bg-card p-5 shadow-sm sm:p-6 ${className ?? ""}`}
      data-testid={testId}
    >
      <div className="space-y-1">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {isEditing ? "Editar lançamento" : "Novo lançamento"}
        </p>
        <h2 className="text-xl font-semibold tracking-tight" id={`${testId}-title`}>
          {isEditing
            ? "Atualize a descrição ou categoria"
            : currentKind === "EXPENSE"
              ? "Registre uma despesa"
              : "Registre uma receita"}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {isEditing
            ? "Valor, data, tipo e conta preservam o histórico e não podem ser alterados aqui."
            : "Use o valor realizado e a data do lançamento. A categoria é opcional."}
        </p>
      </div>

      {isLoading ? (
        <p
          aria-live="polite"
          className="mt-4 text-sm text-muted-foreground"
          data-testid={`${testId}-loading-state`}
          role="status"
        >
          Atualizando opções…
        </p>
      ) : null}

      <form
        aria-busy={formDisabled}
        className="mt-6 space-y-5"
        data-testid={`${testId}-fields`}
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(handleValidSubmit)(event);
        }}
      >
        <fieldset disabled={formDisabled}>
          <legend className="text-sm font-medium">Tipo do lançamento</legend>
          <p className="mt-1 text-xs text-muted-foreground">
            O tipo também define as categorias disponíveis.
          </p>
          {isEditing ? (
            <>
              <input
                {...form.register("kind")}
                aria-hidden="true"
                className="sr-only"
                data-testid={`${testId}-kind-hidden`}
                tabIndex={-1}
                type="hidden"
              />
              <p className="mt-2 text-sm text-muted-foreground" data-testid={`${testId}-kind-readonly`}>
                {KIND_LABELS[currentKind]}
              </p>
            </>
          ) : (
            <div
              aria-describedby={kindError ? kindErrorId : undefined}
              aria-invalid={kindError ? true : undefined}
              className="mt-2 grid grid-cols-2 gap-2"
              data-testid={`${testId}-kind-input`}
              role="radiogroup"
            >
              {MANUAL_TRANSACTION_KINDS.map((kind) => (
                <label
                  className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary"
                  key={kind}
                >
                  <input
                    {...form.register("kind")}
                    className="size-4 accent-primary"
                    data-testid={`${testId}-kind-${kind.toLowerCase()}`}
                    type="radio"
                    value={kind}
                  />
                  {KIND_LABELS[kind]}
                </label>
              ))}
            </div>
          )}
          <FieldMessage error={kindError} id={kindErrorId} />
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={`${testId}-amount`}>
              Valor
            </label>
            <p className="text-xs text-muted-foreground" id={amountHelpId}>
              Digite em reais; os centavos são preservados sem arredondamento.
            </p>
            {isEditing ? (
              <>
                <MoneyInput
                  aria-describedby={fieldDescribedBy(amountHelpId, amountErrorId, amountError)}
                  aria-invalid={amountError ? true : undefined}
                  className={INPUT_CLASS_NAME}
                  data-testid={`${testId}-amount-input`}
                  id={`${testId}-amount`}
                  readOnly
                  value={form.getValues("amountCents")}
                />
                <input
                  {...form.register("amountCents")}
                  aria-hidden="true"
                  className="sr-only"
                  tabIndex={-1}
                  type="hidden"
                />
              </>
            ) : (
              <Controller
                control={form.control}
                name="amountCents"
                render={({ field }) => (
                  <MoneyInput
                    aria-describedby={fieldDescribedBy(amountHelpId, amountErrorId, amountError)}
                    aria-invalid={amountError ? true : undefined}
                    className={INPUT_CLASS_NAME}
                    data-testid={`${testId}-amount-input`}
                    id={`${testId}-amount`}
                    onCentsChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    value={field.value}
                  />
                )}
              />
            )}
            <FieldMessage error={amountError} id={amountErrorId} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={`${testId}-occurred-on`}>
              Data
            </label>
            <p className="text-xs text-muted-foreground" id={dateHelpId}>
              Informe a data em que o lançamento aconteceu. Não pode ser futura.
            </p>
            {isEditing ? (
              <>
                <DateInput
                  aria-describedby={fieldDescribedBy(dateHelpId, dateErrorId, dateError)}
                  aria-invalid={dateError ? true : undefined}
                  className={INPUT_CLASS_NAME}
                  data-testid={`${testId}-date-input`}
                  id={`${testId}-occurred-on`}
                  readOnly
                  value={form.getValues("occurredOn")}
                />
                <input
                  {...form.register("occurredOn")}
                  aria-hidden="true"
                  className="sr-only"
                  tabIndex={-1}
                  type="hidden"
                />
              </>
            ) : (
              <Controller
                control={form.control}
                name="occurredOn"
                render={({ field }) => (
                  <DateInput
                    aria-describedby={fieldDescribedBy(dateHelpId, dateErrorId, dateError)}
                    aria-invalid={dateError ? true : undefined}
                    className={INPUT_CLASS_NAME}
                    data-testid={`${testId}-date-input`}
                    id={`${testId}-occurred-on`}
                    maxDate={businessDate}
                    minDate={selectedAccount?.trackingStartedOn ?? undefined}
                    onBlur={field.onBlur}
                    onChange={field.onChange}
                    ref={field.ref}
                    value={field.value}
                  />
                )}
              />
            )}
            <FieldMessage error={dateError} id={dateErrorId} />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`${testId}-description`}>
            Descrição
          </label>
          <p className="text-xs text-muted-foreground" id={descriptionHelpId}>
            Até {MANUAL_TRANSACTION_DESCRIPTION_MAX_LENGTH} caracteres. Ex.: mercado, salário ou aluguel.
          </p>
          <textarea
            aria-describedby={fieldDescribedBy(descriptionHelpId, descriptionErrorId, descriptionError)}
            aria-invalid={descriptionError ? true : undefined}
            className={TEXTAREA_CLASS_NAME}
            data-testid={`${testId}-description-input`}
            id={`${testId}-description`}
            maxLength={MANUAL_TRANSACTION_DESCRIPTION_MAX_LENGTH}
            placeholder="Ex.: Mercado"
            {...form.register("description")}
          />
          <FieldMessage error={descriptionError} id={descriptionErrorId} />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`${testId}-account`}>
            Conta
          </label>
          <p className="text-xs text-muted-foreground" id={accountHelpId}>
            Escolha uma conta ativa para registrar o efeito no saldo.
          </p>
          {isEditing ? (
            <>
              <p
                aria-describedby={fieldDescribedBy(accountHelpId, accountErrorId, accountError)}
                className={`${INPUT_CLASS_NAME} flex items-center`}
                data-testid={`${testId}-account-readonly`}
                id={`${testId}-account`}
              >
                {displayAccountName(selectedAccount, transaction, selectedAccountId ?? "")}
              </p>
              <input
                {...form.register("accountId")}
                aria-hidden="true"
                className="sr-only"
                tabIndex={-1}
                type="hidden"
              />
            </>
          ) : (
            <select
              aria-describedby={fieldDescribedBy(accountHelpId, accountErrorId, accountError)}
              aria-invalid={accountError ? true : undefined}
              className={INPUT_CLASS_NAME}
              data-testid={`${testId}-account-input`}
              id={`${testId}-account`}
              {...form.register("accountId")}
            >
              <option value="">Selecione uma conta</option>
              {activeAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          )}
          <FieldMessage error={accountError} id={accountErrorId} />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`${testId}-category`}>
            Categoria (opcional)
          </label>
          <p className="text-xs text-muted-foreground" id={categoryHelpId}>
            {allCategoryOptions.length > 0
              ? `Categorias de ${KIND_LABELS[currentKind].toLowerCase()} ativas.`
              : "Nenhuma categoria ativa deste tipo; você pode continuar sem categoria."}
          </p>
          <select
            aria-describedby={fieldDescribedBy(categoryHelpId, categoryErrorId, categoryError)}
            aria-invalid={categoryError ? true : undefined}
            className={INPUT_CLASS_NAME}
            data-testid={`${testId}-category-input`}
            id={`${testId}-category`}
            {...form.register("categoryId")}
            onChange={(event) => {
              form.setValue(
                "categoryId",
                event.target.value || null,
                { shouldDirty: true, shouldValidate: true },
              );
            }}
            value={selectedCategoryId ?? ""}
          >
            <option value="">Sem categoria</option>
            {allCategoryOptions.map((category) => (
              <option
                disabled={category.status === "ARCHIVED"}
                key={category.id}
                value={category.id}
              >
                {category.name}
                {category.status === "ARCHIVED" ? " (arquivada)" : ""}
              </option>
            ))}
          </select>
          {editArchivedCategory && selectedCategory && selectedCategoryId ? (
            <p className="text-xs text-muted-foreground">
              A categoria atual está arquivada. Escolha “Sem categoria” para removê-la.
            </p>
          ) : null}
          <FieldMessage error={categoryError} id={categoryErrorId} />
        </div>

        {rootError ? (
          <p
            aria-live="polite"
            className="text-sm text-destructive"
            data-testid={`${testId}-general-error`}
            role="alert"
          >
            {rootError}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {onCancel ? (
            <Button
              className="w-full sm:w-auto"
              data-testid={`${testId}-cancel`}
              disabled={formDisabled}
              onClick={onCancel}
              type="button"
              variant="outline"
            >
              Cancelar
            </Button>
          ) : null}
          <Button
            className="w-full sm:w-auto"
            data-testid={`${testId}-submit`}
            disabled={formDisabled}
            type="submit"
          >
            {form.formState.isSubmitting
              ? pendingLabel ?? (isEditing ? "Salvando…" : "Lançando…")
              : submitLabel ?? (isEditing ? "Salvar alterações" : "Registrar lançamento")}
          </Button>
        </div>
      </form>
    </section>
  );
}

export { formatMoneyInputCents };
export type { ManualTransactionFormValues } from "@/modules/transactions/form-contract";
