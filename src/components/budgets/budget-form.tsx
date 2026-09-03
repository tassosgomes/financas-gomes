"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo } from "react";
import {
  Controller,
  useForm,
  type DefaultValues,
  type FieldPath,
  type Resolver,
} from "react-hook-form";
import { z } from "zod";

import { DateInput } from "@/components/transactions/date-input";
import { MoneyInput } from "@/components/transactions/money-input";
import { Button } from "@/components/ui/button";
import type {
  BudgetBoundary,
  BudgetError,
  BudgetGoalBoundary,
  BudgetResult,
} from "@/modules/budgets/contracts";
import {
  BUDGET_NAME_MAX_LENGTH,
  budgetDateSchema,
  budgetPositiveCentsSchema,
} from "@/modules/budgets/contracts";
import type { BudgetListItemReadModel } from "@/modules/budgets/read-contracts";

const INPUT_CLASS_NAME =
  "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 read-only:bg-muted/50";

const budgetFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Informe um nome para a Caixinha.")
      .max(
        BUDGET_NAME_MAX_LENGTH,
        `Use no máximo ${BUDGET_NAME_MAX_LENGTH} caracteres.`,
      ),
    categoryId: z.string().trim().min(1, "Selecione uma categoria."),
    activeFrom: budgetDateSchema,
    goalEnabled: z.boolean(),
    targetAmountCents: z.string(),
    targetDate: z.string(),
  })
  .superRefine((value, context) => {
    if (!value.goalEnabled) return;

    const amount = budgetPositiveCentsSchema.safeParse(value.targetAmountCents);
    if (!amount.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe uma meta positiva.",
        path: ["targetAmountCents"],
      });
    }

    const date = budgetDateSchema.safeParse(value.targetDate);
    if (!date.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe uma data válida para a meta.",
        path: ["targetDate"],
      });
    } else if (value.targetDate < value.activeFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A data da meta deve ser igual ou posterior ao início.",
        path: ["targetDate"],
      });
    }
  });

export type BudgetFormValues = z.infer<typeof budgetFormSchema>;

export interface BudgetCategoryOption {
  readonly id: string;
  readonly name: string;
}

export interface BudgetFormPayload {
  readonly name: string;
  readonly categoryId?: string;
  readonly activeFrom?: string;
  readonly goal: BudgetGoalBoundary | null;
}

export type BudgetFormMode = "create" | "edit";

export interface BudgetFormProps {
  readonly mode?: BudgetFormMode;
  readonly budget?: BudgetListItemReadModel;
  readonly categories: readonly BudgetCategoryOption[];
  readonly onSubmit: (
    values: BudgetFormPayload,
  ) => Promise<BudgetResult<BudgetBoundary> | void> | BudgetResult<BudgetBoundary> | void;
  readonly onCancel?: () => void;
  readonly categoryError?: string | null;
  readonly testId?: string;
}

function initialValues(
  budget: BudgetListItemReadModel | undefined,
): DefaultValues<BudgetFormValues> {
  return {
    name: budget?.name ?? "",
    categoryId: budget?.categoryId ?? "",
    activeFrom: budget?.activeFrom ?? "",
    goalEnabled: budget?.goal !== null && budget?.goal !== undefined,
    targetAmountCents: budget?.goal?.targetAmountCents ?? "",
    targetDate: budget?.goal?.targetDate ?? "",
  };
}

function fieldError(
  errors: Record<string, { message?: unknown } | undefined>,
  field: string,
): string | undefined {
  const message = errors[field]?.message;
  return typeof message === "string" ? message : undefined;
}

function safeActionError(): BudgetError {
  return {
    code: "QUERY_FAILED",
    message: "Não foi possível concluir a operação. Tente novamente.",
  };
}

function goalFromValues(values: BudgetFormValues): BudgetGoalBoundary | null {
  return values.goalEnabled
    ? {
        targetAmountCents: values.targetAmountCents,
        targetDate: values.targetDate,
      }
    : null;
}

/** Converts browser form values to the narrow T06 write payload. */
export function toBudgetFormPayload(
  values: BudgetFormValues,
  mode: BudgetFormMode,
): BudgetFormPayload {
  return {
    name: values.name,
    ...(mode === "create"
      ? { categoryId: values.categoryId, activeFrom: values.activeFrom }
      : {}),
    goal: goalFromValues(values),
  };
}

function FieldMessage({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p aria-live="polite" className="text-xs text-destructive" id={id} role="alert">
      {message}
    </p>
  ) : null;
}

/**
 * Short RHF/Zod form for creating and maintaining a Caixinha. The component
 * accepts no household, balance or movement values and sends only the T06
 * command fields through its parent action boundary.
 */
export function BudgetForm({
  mode: requestedMode,
  budget,
  categories,
  onSubmit,
  onCancel,
  categoryError,
  testId = "budget-form",
}: BudgetFormProps) {
  const mode: BudgetFormMode = requestedMode ?? (budget ? "edit" : "create");
  const isEditing = mode === "edit";
  const schema = useMemo(() => budgetFormSchema, []);
  const form = useForm<BudgetFormValues>({
    defaultValues: initialValues(budget),
    mode: "onBlur",
    resolver: zodResolver(schema) as Resolver<BudgetFormValues>,
  });
  const goalEnabled = form.watch("goalEnabled");
  const errors = form.formState.errors as Record<
    string,
    { message?: unknown } | undefined
  >;

  async function submit(values: BudgetFormValues): Promise<void> {
    form.clearErrors("root.serverError");

    try {
      const result = await onSubmit(toBudgetFormPayload(values, mode));
      if (!result || result.ok) return;

      const field = result.error.field;
      if (
        field === "name" ||
        field === "categoryId" ||
        field === "activeFrom" ||
        field === "targetAmountCents" ||
        field === "targetDate"
      ) {
        form.setError(field as FieldPath<BudgetFormValues>, {
          type: "server",
          message: result.error.message,
        });
      }
      form.setError("root.serverError", {
        type: result.error.code,
        message: result.error.message,
      });
    } catch {
      const error = safeActionError();
      form.setError("root.serverError", {
        type: error.code,
        message: error.message,
      });
    }
  }

  const rootError = form.formState.errors.root?.serverError;
  const rootMessage =
    rootError && typeof rootError.message === "string"
      ? rootError.message
      : undefined;
  const title = isEditing ? "Editar Caixinha" : "Nova Caixinha";

  return (
    <section
      aria-labelledby={`${testId}-title`}
      className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
      data-testid={testId}
    >
      <div className="space-y-1">
        <h2 className="text-xl font-semibold" id={`${testId}-title`}>
          {title}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {isEditing
            ? "Atualize o nome ou a meta. A categoria e a vigência preservam o histórico."
            : "Associe a Caixinha a uma categoria de despesa e, se quiser, configure uma meta."}
        </p>
      </div>

      <form
        aria-busy={form.formState.isSubmitting}
        className="space-y-5"
        data-testid={`${testId}-fields`}
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(submit)(event);
        }}
      >
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`${testId}-name`}>
            Nome
          </label>
          <input
            aria-describedby={
              fieldError(errors, "name") ? `${testId}-name-error` : undefined
            }
            aria-invalid={fieldError(errors, "name") ? true : undefined}
            className={INPUT_CLASS_NAME}
            id={`${testId}-name`}
            {...form.register("name")}
          />
          <FieldMessage
            id={`${testId}-name-error`}
            message={fieldError(errors, "name")}
          />
        </div>

        {isEditing ? (
          <div className="space-y-2">
            <span className="text-sm font-medium">Categoria</span>
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              {budget?.category?.name ?? "Categoria indisponível"}
            </p>
            <p className="text-xs text-muted-foreground">
              A associação da categoria não muda em uma edição para preservar o histórico.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={`${testId}-category`}>
              Categoria de despesa
            </label>
            <select
              aria-describedby={
                fieldError(errors, "categoryId")
                  ? `${testId}-category-error`
                  : categoryError
                    ? `${testId}-category-help`
                    : undefined
              }
              aria-invalid={fieldError(errors, "categoryId") ? true : undefined}
              className={INPUT_CLASS_NAME}
              disabled={categories.length === 0 || Boolean(categoryError)}
              id={`${testId}-category`}
              {...form.register("categoryId")}
            >
              <option value="">Selecione uma categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {categoryError ? (
              <p className="text-xs text-destructive" id={`${testId}-category-help`} role="alert">
                {categoryError}
              </p>
            ) : null}
            <FieldMessage
              id={`${testId}-category-error`}
              message={fieldError(errors, "categoryId")}
            />
          </div>
        )}

        {isEditing ? null : (
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={`${testId}-active-from`}>
              Início da vigência
            </label>
            <Controller
              control={form.control}
              name="activeFrom"
              render={({ field }) => (
                <DateInput
                  {...field}
                  aria-describedby={
                    fieldError(errors, "activeFrom")
                      ? `${testId}-active-from-error`
                      : undefined
                  }
                  aria-invalid={fieldError(errors, "activeFrom") ? true : undefined}
                  className={INPUT_CLASS_NAME}
                  id={`${testId}-active-from`}
                  maxDate="9999-12-31"
                />
              )}
            />
            <p className="text-xs text-muted-foreground">
              A proteção começa nesta data; datas futuras são permitidas.
            </p>
            <FieldMessage
              id={`${testId}-active-from-error`}
              message={fieldError(errors, "activeFrom")}
            />
          </div>
        )}

        <fieldset className="space-y-3 rounded-xl border p-4">
          <legend className="px-1 text-sm font-medium">Meta (opcional)</legend>
          <label className="flex items-start gap-3 text-sm">
            <input
              className="mt-1 size-4 accent-primary"
              type="checkbox"
              {...form.register("goalEnabled")}
            />
            <span>
              Definir valor e data-alvo
              <span className="mt-1 block text-xs text-muted-foreground">
                O progresso é calculado e enviado pelo servidor.
              </span>
            </span>
          </label>

          {goalEnabled ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor={`${testId}-target-amount`}>
                  Valor da meta
                </label>
                <Controller
                  control={form.control}
                  name="targetAmountCents"
                  render={({ field }) => (
                    <MoneyInput
                      aria-describedby={
                        fieldError(errors, "targetAmountCents")
                          ? `${testId}-target-amount-error`
                          : undefined
                      }
                      aria-invalid={
                        fieldError(errors, "targetAmountCents") ? true : undefined
                      }
                      className={INPUT_CLASS_NAME}
                      id={`${testId}-target-amount`}
                      name={field.name}
                      onBlur={field.onBlur}
                      onCentsChange={field.onChange}
                      ref={field.ref}
                      value={field.value}
                    />
                  )}
                />
                <p className="text-xs text-muted-foreground">Informe o valor em reais.</p>
                <FieldMessage
                  id={`${testId}-target-amount-error`}
                  message={fieldError(errors, "targetAmountCents")}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor={`${testId}-target-date`}>
                  Data da meta
                </label>
                <Controller
                  control={form.control}
                  name="targetDate"
                  render={({ field }) => (
                    <DateInput
                      {...field}
                      aria-describedby={
                        fieldError(errors, "targetDate")
                          ? `${testId}-target-date-error`
                          : undefined
                      }
                      aria-invalid={fieldError(errors, "targetDate") ? true : undefined}
                      className={INPUT_CLASS_NAME}
                      id={`${testId}-target-date`}
                      maxDate="9999-12-31"
                    />
                  )}
                />
                <FieldMessage
                  id={`${testId}-target-date-error`}
                  message={fieldError(errors, "targetDate")}
                />
              </div>
            </div>
          ) : null}
        </fieldset>

        {rootMessage ? (
          <p aria-live="polite" className="text-sm text-destructive" role="alert">
            {rootMessage}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {onCancel ? (
            <Button
              className="w-full sm:w-auto"
              disabled={form.formState.isSubmitting}
              onClick={onCancel}
              type="button"
              variant="outline"
            >
              Cancelar
            </Button>
          ) : null}
          <Button
            className="w-full sm:w-auto"
            disabled={form.formState.isSubmitting}
            type="submit"
          >
            {form.formState.isSubmitting
              ? "Salvando…"
              : isEditing
                ? "Salvar alterações"
                : "Criar Caixinha"}
          </Button>
        </div>
      </form>
    </section>
  );
}

export { budgetFormSchema };
