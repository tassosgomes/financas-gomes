"use client";

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";

import {
  toCreditCardErrorViewModel,
  type CreditCardUiErrorField,
} from "./ui-contracts";

export interface CreditCardFieldErrorProps {
  /** Field name from the allow-listed UI error contract. */
  field: CreditCardUiErrorField;
  fieldId: string;
  error?: unknown;
  testId?: string;
}

/**
 * Associates a server error with its input without ever rendering an
 * exception/SQL message. Inputs should include `${fieldId}-error` in their
 * `aria-describedby` when this component is used.
 */
export function CreditCardFieldError({
  error,
  field,
  fieldId,
  testId = "credit-card-field-error",
}: CreditCardFieldErrorProps) {
  const safeError = toCreditCardErrorViewModel(error);
  if (!safeError.field || safeError.field !== field) {
    return null;
  }

  return (
    <p
      aria-live="polite"
      className="text-sm text-destructive"
      data-testid={testId}
      id={`${fieldId}-error`}
      role="alert"
    >
      {safeError.message}
    </p>
  );
}

export interface CreditCardActionFeedbackProps {
  error?: unknown;
  successMessage?: string;
  retryHref?: string;
  /** Focus the status region whenever the outcome changes. */
  focusOnChange?: boolean;
  testId?: string;
}

/**
 * Root action feedback with a focusable live region. A retry link is emitted
 * only for allow-listed retryable errors, and all copy comes from the stable
 * UI error map.
 */
export function CreditCardActionFeedback({
  error,
  focusOnChange = true,
  retryHref,
  successMessage,
  testId = "credit-card-action-feedback",
}: CreditCardActionFeedbackProps) {
  const regionRef = React.useRef<HTMLDivElement>(null);
  const safeError = error
    ? toCreditCardErrorViewModel(error)
    : null;
  const outcomeKey = safeError
    ? `error:${safeError.code}:${safeError.field ?? ""}`
    : successMessage
      ? `success:${successMessage}`
      : "idle";

  React.useEffect(() => {
    if (focusOnChange && outcomeKey !== "idle") {
      regionRef.current?.focus();
    }
  }, [focusOnChange, outcomeKey]);

  if (!safeError && !successMessage) {
    return null;
  }

  if (safeError) {
    return (
      <div
        aria-live="assertive"
        aria-atomic="true"
        className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        data-testid={testId}
        ref={regionRef}
        role="alert"
        tabIndex={-1}
      >
        <p className="font-medium">{safeError.message}</p>
        {safeError.retryable && retryHref ? (
          <Link
            className="inline-flex rounded-md border border-destructive/30 px-3 py-2 font-medium hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={retryHref}
          >
            Tentar novamente
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      data-testid={testId}
      ref={regionRef}
      role="status"
      tabIndex={-1}
    >
      {successMessage}
    </div>
  );
}

export interface CreditCardSubmitButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  isSubmitting?: boolean;
  label?: string;
  pendingLabel?: string;
}

/** Submit button shared by S06 forms; disabled state prevents a second click. */
export function CreditCardSubmitButton({
  isSubmitting = false,
  label = "Salvar",
  pendingLabel = "Salvando…",
  type = "submit",
  ...props
}: CreditCardSubmitButtonProps) {
  return (
    <Button
      {...props}
      aria-busy={isSubmitting}
      disabled={isSubmitting || props.disabled}
      type={type}
    >
      {isSubmitting ? pendingLabel : label}
    </Button>
  );
}

export interface CreditCardConfirmationProps {
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  confirmLabel?: string;
  pendingLabel?: string;
  cancelLabel?: string;
  testId?: string;
}

/**
 * Explicit confirmation island for archive/cancel aggregate commands. It has
 * a synchronous in-flight guard so two same-turn clicks cannot duplicate the
 * command, while the command itself remains idempotent on the server.
 */
export function CreditCardConfirmation({
  cancelLabel = "Voltar",
  confirmLabel = "Confirmar",
  description,
  onConfirm,
  onOpenChange,
  open,
  pendingLabel = "Confirmando…",
  testId = "credit-card-confirmation",
  title,
}: CreditCardConfirmationProps) {
  const [isConfirming, setIsConfirming] = React.useState(false);
  const inFlightRef = React.useRef(false);
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (open) {
      dialogRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  async function confirm() {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setIsConfirming(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      inFlightRef.current = false;
      setIsConfirming(false);
    }
  }

  return (
    <div
      aria-describedby={`${testId}-description`}
      aria-labelledby={`${testId}-title`}
      aria-modal="true"
      className="space-y-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4"
      data-testid={testId}
      ref={dialogRef}
      role="alertdialog"
      tabIndex={-1}
    >
      <div>
        <h2 className="font-semibold text-destructive" id={`${testId}-title`}>
          {title}
        </h2>
        <p className="mt-1 text-sm leading-6" id={`${testId}-description`}>
          {description}
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          disabled={isConfirming}
          onClick={() => onOpenChange(false)}
          type="button"
          variant="ghost"
        >
          {cancelLabel}
        </Button>
        <Button
          aria-busy={isConfirming}
          disabled={isConfirming}
          onClick={() => void confirm()}
          type="button"
        >
          {isConfirming ? pendingLabel : confirmLabel}
        </Button>
      </div>
    </div>
  );
}

export function useCreditCardSubmitGuard() {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const inFlightRef = React.useRef(false);

  const run = React.useCallback(async <T,>(work: () => Promise<T> | T) => {
    if (inFlightRef.current) {
      return undefined;
    }

    inFlightRef.current = true;
    setIsSubmitting(true);
    try {
      return await work();
    } finally {
      inFlightRef.current = false;
      setIsSubmitting(false);
    }
  }, []);

  return { isSubmitting, run };
}

/** Compatibility aliases for future S06 forms. */
export const ActionFeedback = CreditCardActionFeedback;
export const FieldError = CreditCardFieldError;
export const ConfirmCreditCardAction = CreditCardConfirmation;
