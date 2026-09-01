"use client";

import * as React from "react";

import {
  billingDayFormSchema,
  installmentCountFormSchema,
  MAX_INSTALLMENT_COUNT,
} from "./ui-contracts";

const INPUT_CLASS_NAME =
  "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

type NumericInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  | "type"
  | "min"
  | "max"
  | "step"
  | "value"
  | "defaultValue"
  | "onChange"
  | "aria-describedby"
  | "aria-invalid"
  | "autoFocus"
>;

interface LabeledNumericInputProps extends NumericInputProps {
  value?: number | string;
  defaultValue?: number | string;
  label: string;
  description?: string;
  error?: string;
  testId: string;
  onNativeChange?: React.ChangeEventHandler<HTMLInputElement>;
  inputRef?: React.Ref<HTMLInputElement>;
  autoFocusOnError?: boolean;
  type?: "number";
  min?: number;
  max?: number;
  step?: number;
}

function fieldIds(id: string, description: string | undefined, error: string | undefined) {
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy = [description ? descriptionId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");
  return { descriptionId, errorId, describedBy: describedBy || undefined };
}

function NumericField({
  autoFocusOnError = true,
  className,
  defaultValue,
  description,
  error,
  id,
  inputRef,
  label,
  name,
  onNativeChange,
  testId,
  value,
  ...props
}: LabeledNumericInputProps) {
  const resolvedId = id ?? testId;
  const { descriptionId, errorId, describedBy } = fieldIds(
    resolvedId,
    description,
    error,
  );

  return (
    <div className="space-y-2" data-testid={testId}>
      <label className="text-sm font-medium" htmlFor={resolvedId}>
        {label}
      </label>
      {description ? (
        <p className="text-xs text-muted-foreground" id={descriptionId}>
          {description}
        </p>
      ) : null}
      <input
        {...props}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        autoFocus={autoFocusOnError && Boolean(error)}
        className={`${INPUT_CLASS_NAME}${className ? ` ${className}` : ""}`}
        defaultValue={defaultValue}
        id={resolvedId}
        name={name}
        onChange={onNativeChange}
        ref={inputRef}
        value={value}
      />
      {error ? (
        <p
          aria-live="polite"
          className="text-sm text-destructive"
          data-testid={`${testId}-error`}
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface BillingDayInputProps extends NumericInputProps {
  value?: number | string;
  defaultValue?: number | string;
  label?: string;
  description?: string;
  error?: string;
  onDayChange?: (value: number | undefined) => void;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  autoFocusOnError?: boolean;
  testId?: string;
}

/**
 * Closing/due day input.  The schema performs the string-to-number adaptation;
 * this component never creates a calendar date or changes a billing rule.
 */
export const BillingDayInput = React.forwardRef<
  HTMLInputElement,
  BillingDayInputProps
>(function BillingDayInput(
  {
    "aria-label": ariaLabel,
    autoFocusOnError,
    defaultValue,
    description = "Escolha um dia civil entre 1 e 31.",
    error,
    id,
    label = "Dia do mês",
    onChange,
    onDayChange,
    testId = "credit-card-billing-day-input",
    value,
    ...props
  },
  ref,
) {
  return (
    <NumericField
      {...props}
      aria-label={ariaLabel}
      autoFocusOnError={autoFocusOnError}
      defaultValue={defaultValue}
      description={description}
      error={error}
      id={id}
      label={label}
      inputRef={ref}
      max={31}
      min={1}
      step={1}
      testId={testId}
      type="number"
      value={value}
      onNativeChange={(event) => {
        const parsed = billingDayFormSchema.safeParse(event.currentTarget.value);
        onDayChange?.(parsed.success ? parsed.data : undefined);
        onChange?.(event);
      }}
    />
  );
});

BillingDayInput.displayName = "BillingDayInput";

export interface InstallmentCountInputProps extends NumericInputProps {
  value?: number | string;
  defaultValue?: number | string;
  label?: string;
  description?: string;
  error?: string;
  onCountChange?: (value: number | undefined) => void;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  autoFocusOnError?: boolean;
  testId?: string;
}

/** Quantity input shared by purchase forms; schedule values remain server data. */
export const InstallmentCountInput = React.forwardRef<
  HTMLInputElement,
  InstallmentCountInputProps
>(function InstallmentCountInput(
  {
    "aria-label": ariaLabel,
    autoFocusOnError,
    defaultValue,
    description = "Informe de 1 a 120 parcelas.",
    error,
    id,
    label = "Quantidade de parcelas",
    onChange,
    onCountChange,
    testId = "credit-card-installment-count-input",
    value,
    ...props
  },
  ref,
) {
  return (
    <NumericField
      {...props}
      aria-label={ariaLabel}
      autoFocusOnError={autoFocusOnError}
      defaultValue={defaultValue}
      description={description}
      error={error}
      id={id}
      label={label}
      inputRef={ref}
      max={MAX_INSTALLMENT_COUNT}
      min={1}
      step={1}
      testId={testId}
      type="number"
      value={value}
      onNativeChange={(event) => {
        const parsed = installmentCountFormSchema.safeParse(
          event.currentTarget.value,
        );
        onCountChange?.(parsed.success ? parsed.data : undefined);
        onChange?.(event);
      }}
    />
  );
});

InstallmentCountInput.displayName = "InstallmentCountInput";

export const DayOfMonthInput = BillingDayInput;
export const CreditCardInstallmentCountInput = InstallmentCountInput;
