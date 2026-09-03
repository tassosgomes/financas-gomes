"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import {
  Controller,
  useForm,
  type FieldPath,
  type Resolver,
} from "react-hook-form";
import { z } from "zod";

import { DateInput } from "@/components/transactions/date-input";
import { MoneyInput } from "@/components/transactions/money-input";
import { Button } from "@/components/ui/button";
import { BudgetCloseConfirmation } from "@/components/budgets/budget-components";
import { formatBudgetDate, formatBudgetMovementImpact } from "@/components/budgets/formatters";
import {
  budgetDateSchema,
  budgetPositiveCentsSchema,
  type BudgetError,
  type BudgetMovementBoundary,
  type BudgetResult,
  type BudgetTransferBoundary,
} from "@/modules/budgets/contracts";
import { getTodayIsoDate } from "@/modules/transactions/form-contract";

const INPUT_CLASS_NAME =
  "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

export type BudgetMovementFormMode = "CONTRIBUTION" | "WITHDRAWAL" | "TRANSFER";

export interface BudgetTransferOption {
  readonly referenceId: string;
  readonly name: string;
}

export interface BudgetMovementFormPayload {
  readonly amountCents: string;
  readonly effectiveOn: string;
  readonly destinationBudgetReferenceId?: string;
}

export type BudgetMovementActionResult =
  | BudgetResult<BudgetMovementBoundary>
  | BudgetResult<BudgetTransferBoundary>;

export interface BudgetMovementFormProps {
  readonly mode: BudgetMovementFormMode;
  readonly destinations?: readonly BudgetTransferOption[];
  readonly onSubmit: (
    values: BudgetMovementFormPayload,
  ) => Promise<BudgetMovementActionResult | void> | BudgetMovementActionResult | void;
  readonly onCancel?: () => void;
  readonly testId?: string;
}

const movementFormSchema = z.object({
  amountCents: budgetPositiveCentsSchema,
  effectiveOn: budgetDateSchema,
  destinationBudgetReferenceId: z.string(),
});

type MovementFormValues = z.infer<typeof movementFormSchema>;

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
    message: "Não foi possível concluir o movimento. Tente novamente.",
  };
}

function modeCopy(mode: BudgetMovementFormMode): {
  readonly title: string;
  readonly submitLabel: string;
  readonly confirmLabel: string;
  readonly description: string;
  readonly kind: "CONTRIBUTION" | "WITHDRAWAL";
} {
  if (mode === "CONTRIBUTION") {
    return {
      title: "Novo aporte",
      submitLabel: "Revisar aporte",
      confirmLabel: "Confirmar aporte",
      description: "O aporte aumenta o saldo reservado e não é lançado como receita bancária.",
      kind: "CONTRIBUTION",
    };
  }
  if (mode === "WITHDRAWAL") {
    return {
      title: "Nova retirada",
      submitLabel: "Revisar retirada",
      confirmLabel: "Confirmar retirada",
      description: "A retirada reduz o saldo reservado e não é lançada como despesa bancária.",
      kind: "WITHDRAWAL",
    };
  }
  return {
    title: "Nova transferência",
    submitLabel: "Revisar transferência",
    confirmLabel: "Confirmar transferência",
    description: "A transferência cria uma retirada e um aporte atômicos entre Caixinhas.",
    kind: "CONTRIBUTION",
  };
}

function errorFieldName(field: BudgetError["field"]): FieldPath<MovementFormValues> | null {
  switch (field) {
    case "amountCents":
    case "effectiveOn":
    case "destinationBudgetReferenceId":
      return field;
    default:
      return null;
  }
}

/**
 * Amount/date movement form. Commands, tenant context, balances and source
 * references are intentionally absent: its parent creates opaque command and
 * lineage references immediately before calling the authenticated action.
 */
export function BudgetMovementForm({
  mode,
  destinations = [],
  onSubmit,
  onCancel,
  testId = "budget-movement-form",
}: BudgetMovementFormProps) {
  const copy = modeCopy(mode);
  const schema = useMemo(
    () =>
      movementFormSchema.superRefine((value, context) => {
        if (mode !== "TRANSFER") return;
        if (value.destinationBudgetReferenceId.trim() === "") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["destinationBudgetReferenceId"],
            message: "Selecione a Caixinha de destino.",
          });
        }
      }),
    [mode],
  );
  const form = useForm<MovementFormValues>({
    defaultValues: {
      amountCents: "",
      effectiveOn: getTodayIsoDate(),
      destinationBudgetReferenceId: "",
    },
    mode: "onBlur",
    resolver: zodResolver(schema) as Resolver<MovementFormValues>,
  });
  const [pendingValues, setPendingValues] = useState<MovementFormValues | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const errors = form.formState.errors as Record<
    string,
    { message?: unknown } | undefined
  >;
  const rootMessage =
    typeof form.formState.errors.root?.serverError?.message === "string"
      ? form.formState.errors.root.serverError.message
      : undefined;

  function submit(values: MovementFormValues): void {
    form.clearErrors("root.serverError");
    setPendingValues(values);
  }

  async function confirm(): Promise<void> {
    if (pendingValues === null || isConfirming) return;
    setIsConfirming(true);
    form.clearErrors("root.serverError");
    try {
      const payload: BudgetMovementFormPayload = {
        amountCents: pendingValues.amountCents,
        effectiveOn: pendingValues.effectiveOn,
        ...(mode === "TRANSFER"
          ? { destinationBudgetReferenceId: pendingValues.destinationBudgetReferenceId }
          : {}),
      };
      const result = await onSubmit(payload);
      if (!result || result.ok) {
        setPendingValues(null);
        form.reset({
          amountCents: "",
          effectiveOn: getTodayIsoDate(),
          destinationBudgetReferenceId: "",
        });
        return;
      }

      const field = errorFieldName(result.error.field);
      if (field) {
        form.setError(field, {
          type: "server",
          message: result.error.message,
        });
      }
      form.setError("root.serverError", {
        type: result.error.code,
        message: result.error.message,
      });
      // Closing/reopening the confirmation resets its duplicate-submit guard,
      // while preserving the values and server error for a retry.
      setPendingValues(null);
    } catch {
      const error = safeActionError();
      form.setError("root.serverError", {
        type: error.code,
        message: error.message,
      });
      setPendingValues(null);
    } finally {
      setIsConfirming(false);
    }
  }

  const destinationName =
    pendingValues && mode === "TRANSFER"
      ? destinations.find(
          (destination) =>
            destination.referenceId === pendingValues.destinationBudgetReferenceId,
        )?.name ?? "Caixinha selecionada"
      : null;

  return (
    <section
      aria-labelledby={`${testId}-title`}
      className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
      data-testid={testId}
    >
      <div className="space-y-1">
        <h2 className="text-xl font-semibold" id={`${testId}-title`}>
          {copy.title}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">{copy.description}</p>
      </div>

      <form
        aria-busy={form.formState.isSubmitting || isConfirming}
        className="space-y-5"
        data-testid={`${testId}-fields`}
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(submit)(event);
        }}
      >
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`${testId}-amount`}>
            Valor
          </label>
          <Controller
            control={form.control}
            name="amountCents"
            render={({ field }) => (
              <MoneyInput
                aria-describedby={
                  fieldError(errors, "amountCents") ? `${testId}-amount-error` : undefined
                }
                aria-invalid={fieldError(errors, "amountCents") ? true : undefined}
                aria-label="Valor"
                className={INPUT_CLASS_NAME}
                id={`${testId}-amount`}
                name={field.name}
                onBlur={field.onBlur}
                onCentsChange={field.onChange}
                ref={field.ref}
                value={field.value}
              />
            )}
          />
          {fieldError(errors, "amountCents") ? (
            <p aria-live="polite" className="text-xs text-destructive" id={`${testId}-amount-error`} role="alert">
              {fieldError(errors, "amountCents")}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`${testId}-effective-on`}>
            Data efetiva
          </label>
          <Controller
            control={form.control}
            name="effectiveOn"
            render={({ field }) => (
              <DateInput
                {...field}
                aria-describedby={
                  fieldError(errors, "effectiveOn") ? `${testId}-effective-on-error` : undefined
                }
                aria-invalid={fieldError(errors, "effectiveOn") ? true : undefined}
                className={INPUT_CLASS_NAME}
                id={`${testId}-effective-on`}
                maxDate="9999-12-31"
              />
            )}
          />
          {fieldError(errors, "effectiveOn") ? (
            <p aria-live="polite" className="text-xs text-destructive" id={`${testId}-effective-on-error`} role="alert">
              {fieldError(errors, "effectiveOn")}
            </p>
          ) : null}
        </div>

        {mode === "TRANSFER" ? (
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={`${testId}-destination`}>
              Caixinha de destino
            </label>
            <select
              aria-describedby={
                fieldError(errors, "destinationBudgetReferenceId")
                  ? `${testId}-destination-error`
                  : undefined
              }
              aria-invalid={fieldError(errors, "destinationBudgetReferenceId") ? true : undefined}
              className={INPUT_CLASS_NAME}
              disabled={destinations.length === 0}
              id={`${testId}-destination`}
              {...form.register("destinationBudgetReferenceId")}
            >
              <option value="">Selecione o destino</option>
              {destinations.map((destination) => (
                <option key={destination.referenceId} value={destination.referenceId}>
                  {destination.name}
                </option>
              ))}
            </select>
            {destinations.length === 0 ? (
              <p className="text-xs text-muted-foreground">Não há outra Caixinha ativa para receber o valor.</p>
            ) : null}
            {fieldError(errors, "destinationBudgetReferenceId") ? (
              <p aria-live="polite" className="text-xs text-destructive" id={`${testId}-destination-error`} role="alert">
                {fieldError(errors, "destinationBudgetReferenceId")}
              </p>
            ) : null}
          </div>
        ) : null}

        {rootMessage ? (
          <p aria-live="polite" className="text-sm text-destructive" role="alert">
            {rootMessage}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {onCancel ? (
            <Button className="w-full sm:w-auto" disabled={form.formState.isSubmitting || isConfirming} onClick={onCancel} type="button" variant="outline">
              Cancelar
            </Button>
          ) : null}
          <Button className="w-full sm:w-auto" disabled={form.formState.isSubmitting || isConfirming} type="submit">
            {form.formState.isSubmitting || isConfirming ? "Enviando…" : copy.submitLabel}
          </Button>
        </div>
      </form>

      <BudgetCloseConfirmation
        confirmLabel={copy.confirmLabel}
        confirmDisabled={isConfirming}
        description={
          pendingValues
            ? `${copy.description} Data efetiva: ${formatBudgetDate(pendingValues.effectiveOn)}.`
            : ""
        }
        descriptionId={`${testId}-confirmation-description`}
        onCancel={() => setPendingValues(null)}
        onConfirm={() => void confirm()}
        open={pendingValues !== null}
        testId={`${testId}-confirmation`}
        title={`Confirmar ${copy.title.toLocaleLowerCase("pt-BR")}`}
        titleId={`${testId}-confirmation-title`}
      >
        {pendingValues ? (
          <dl className="space-y-1 text-sm">
            <div>
              <dt className="inline font-medium">Valor: </dt>
              <dd className="inline">{formatBudgetMovementImpact(pendingValues.amountCents, copy.kind)}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Data efetiva: </dt>
              <dd className="inline">{formatBudgetDate(pendingValues.effectiveOn)}</dd>
            </div>
            {destinationName ? (
              <div>
                <dt className="inline font-medium">Destino: </dt>
                <dd className="inline">{destinationName}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </BudgetCloseConfirmation>
    </section>
  );
}

export { movementFormSchema };
