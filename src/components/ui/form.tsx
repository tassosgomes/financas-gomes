"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  useForm,
  type DefaultValues,
  type FieldError,
  type FieldValues,
  type Path,
  type Resolver,
  type UseFormRegisterReturn,
  type UseFormReturn,
} from "react-hook-form";
import type { z } from "zod";

export interface DomainActionError {
  code: string;
  message: string;
  field?: string;
}

export type DomainActionResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: DomainActionError };

export interface DomainFormProps<TFieldValues extends FieldValues> {
  schema: z.ZodTypeAny;
  defaultValues?: DefaultValues<TFieldValues>;
  onSubmit: (
    values: TFieldValues,
  ) => Promise<DomainActionResult<unknown> | void> | DomainActionResult<unknown> | void;
  children:
    | React.ReactNode
    | ((form: UseFormReturn<TFieldValues>) => React.ReactNode);
  submitLabel?: string;
  pendingLabel?: string;
  className?: string;
  testId?: string;
}

function errorMessage(error: unknown): string | null {
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

/**
 * Shared React Hook Form boundary. The same Zod schema can be supplied by a
 * form and by the Server Action, so client validation never replaces server
 * validation. Expected action errors are reflected in the form without
 * exposing database or tenancy details.
 */
export function DomainForm<TFieldValues extends FieldValues>({
  schema,
  defaultValues,
  onSubmit,
  children,
  submitLabel = "Salvar",
  pendingLabel = "Salvando…",
  className,
  testId = "domain-form",
}: DomainFormProps<TFieldValues>) {
  const form = useForm<TFieldValues>({
    defaultValues,
    resolver: zodResolver(schema) as Resolver<TFieldValues>,
    mode: "onBlur",
  });

  async function handleValidSubmit(values: TFieldValues) {
    form.clearErrors("root.serverError");
    const result = await onSubmit(values);

    if (result && !result.ok) {
      if (result.error.field) {
        form.setError(result.error.field as Path<TFieldValues>, {
          type: "server",
          message: result.error.message,
        });
      }

      form.setError("root.serverError", {
        type: result.error.code,
        message: result.error.message,
      });
    }
  }

  const renderedChildren =
    typeof children === "function" ? children(form) : children;
  const rootError = errorMessage(form.formState.errors.root?.serverError);

  return (
    <form
      aria-busy={form.formState.isSubmitting}
      className={className}
      data-testid={testId}
      noValidate
      onSubmit={(event) => {
        void form.handleSubmit(handleValidSubmit)(event);
      }}
    >
      {renderedChildren}
      {rootError ? (
        <p aria-live="polite" className="text-sm text-destructive" role="alert">
          {rootError}
        </p>
      ) : null}
      <button
        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        disabled={form.formState.isSubmitting}
        type="submit"
      >
        {form.formState.isSubmitting ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}

export interface FormFieldProps<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  name: Path<TFieldValues>;
  label: string;
  description?: string;
  children?: (field: UseFormRegisterReturn<Path<TFieldValues>>) => React.ReactNode;
}

/** Field wrapper with labels and server/client error presentation. */
export function FormField<TFieldValues extends FieldValues>({
  form,
  name,
  label,
  description,
  children,
}: FormFieldProps<TFieldValues>) {
  const id = String(name).replaceAll(".", "-");
  const message = errorMessage(form.formState.errors[name]);
  const field = form.register(name);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      {description ? (
        <p className="text-xs text-muted-foreground" id={`${id}-description`}>
          {description}
        </p>
      ) : null}
      {children ? (
        children(field)
      ) : (
        <input
          aria-describedby={
            [description ? `${id}-description` : null, message ? `${id}-error` : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
          aria-invalid={message ? true : undefined}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          id={id}
          {...field}
        />
      )}
      {message ? (
        <p className="text-xs text-destructive" id={`${id}-error`} role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({
  error,
}: {
  error?: FieldError;
}) {
  const message = errorMessage(error);
  return message ? <p className="text-xs text-destructive" role="alert">{message}</p> : null;
}
