"use client";

import * as React from "react";

import { DateInput, type DateInputProps } from "@/components/transactions/date-input";
import { MoneyInput, type MoneyInputProps } from "@/components/transactions/money-input";

const FIELD_CLASS_NAME =
  "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

interface LabeledFieldProps {
  id: string;
  label: string;
  description?: string;
  error?: string;
  autoFocusOnError?: boolean;
  testId?: string;
}

function describedBy(id: string, description: string | undefined, error: string | undefined) {
  return [description ? `${id}-description` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ") || undefined;
}

export interface CreditCardMoneyFieldProps
  extends Omit<MoneyInputProps, "aria-describedby" | "aria-invalid" | "id">,
    LabeledFieldProps {}

/** Accessible S06 wrapper around the canonical S03 MoneyInput primitive. */
export const CreditCardMoneyField = React.forwardRef<
  HTMLInputElement,
  CreditCardMoneyFieldProps
>(function CreditCardMoneyField(
  {
    autoFocusOnError = true,
    description,
    error,
    id,
    label,
    testId = "credit-card-money-field",
    ...props
  },
  ref,
) {
  return (
    <div className="space-y-2" data-testid={testId}>
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      {description ? (
        <p className="text-xs text-muted-foreground" id={`${id}-description`}>
          {description}
        </p>
      ) : null}
      <MoneyInput
        {...props}
        aria-describedby={describedBy(id, description, error)}
        aria-invalid={error ? true : undefined}
        autoFocus={autoFocusOnError && Boolean(error)}
        className={`${FIELD_CLASS_NAME}${props.className ? ` ${props.className}` : ""}`}
        id={id}
        ref={ref}
      />
      {error ? (
        <p
          aria-live="polite"
          className="text-sm text-destructive"
          id={`${id}-error`}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
});

CreditCardMoneyField.displayName = "CreditCardMoneyField";

export interface CreditCardDateFieldProps
  extends Omit<DateInputProps, "aria-describedby" | "aria-invalid" | "id">,
    LabeledFieldProps {}

/** Accessible S06 wrapper around the canonical S03 DateInput primitive. */
export const CreditCardDateField = React.forwardRef<
  HTMLInputElement,
  CreditCardDateFieldProps
>(function CreditCardDateField(
  {
    autoFocusOnError = true,
    description,
    error,
    id,
    label,
    testId = "credit-card-date-field",
    ...props
  },
  ref,
) {
  return (
    <div className="space-y-2" data-testid={testId}>
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      {description ? (
        <p className="text-xs text-muted-foreground" id={`${id}-description`}>
          {description}
        </p>
      ) : null}
      <DateInput
        {...props}
        aria-describedby={describedBy(id, description, error)}
        aria-invalid={error ? true : undefined}
        autoFocus={autoFocusOnError && Boolean(error)}
        className={`${FIELD_CLASS_NAME}${props.className ? ` ${props.className}` : ""}`}
        id={id}
        ref={ref}
      />
      {error ? (
        <p
          aria-live="polite"
          className="text-sm text-destructive"
          id={`${id}-error`}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
});

CreditCardDateField.displayName = "CreditCardDateField";

export const MoneyField = CreditCardMoneyField;
export const DateField = CreditCardDateField;
