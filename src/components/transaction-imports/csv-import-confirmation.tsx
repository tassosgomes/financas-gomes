"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CSV_IMPORT_ERROR_MESSAGES,
  type CsvImportConfirmationResult,
  type CsvImportErrorCode,
} from "@/modules/transaction-imports/contracts";
import {
  commandForCsvImportAttempt,
  type CsvImportConfirmationAttemptRef,
  type CsvImportConfirmationAction,
} from "@/modules/transaction-imports/ui-contracts";

export interface CsvImportConfirmationFailure {
  code?: CsvImportErrorCode;
}

export interface CsvImportConfirmationProps {
  /** Opaque server-issued token. It is never rendered or altered. */
  previewToken: string;
  onConfirm: CsvImportConfirmationAction;
  disabled?: boolean;
  blockReason?: string | null;
  errorCode?: CsvImportErrorCode;
  onCompleted?: (result: CsvImportConfirmationResult) => void;
  onFailed?: (error: CsvImportConfirmationFailure) => void;
  label?: string;
  retryLabel?: string;
  testId?: string;
  className?: string;
}

/**
 * Confirm/retry control for a preview. It creates a command containing only
 * `commandId` and `previewToken`; the same command ID is reused for retries of
 * one preview, while a different token starts a new attempt.
 */
export function CsvImportConfirmation({
  previewToken,
  onConfirm,
  disabled = false,
  blockReason = null,
  errorCode,
  onCompleted,
  onFailed,
  label = "Confirmar importação",
  retryLabel = "Tentar novamente",
  testId = "csv-import-confirmation",
  className,
}: CsvImportConfirmationProps) {
  const attemptRef = React.useRef<CsvImportConfirmationAttemptRef>({ current: null });
  const inFlightRef = React.useRef(false);
  const [state, setState] = React.useState<
    "idle" | "confirming" | "retryable-error" | "completed" | "duplicate"
  >("idle");
  const [localErrorCode, setLocalErrorCode] = React.useState<CsvImportErrorCode | undefined>(undefined);

  React.useEffect(() => {
    attemptRef.current.current = null;
    inFlightRef.current = false;
    setState("idle");
    setLocalErrorCode(undefined);
  }, [previewToken]);

  const effectiveErrorCode = errorCode ?? localErrorCode;
  const canSubmit = !disabled && !blockReason && previewToken.length > 0 && state !== "confirming" && state !== "completed" && state !== "duplicate";

  async function handleConfirm() {
    if (!canSubmit || inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setState("confirming");
    setLocalErrorCode(undefined);

    try {
      const command = commandForCsvImportAttempt(previewToken, attemptRef.current);
      const result = await onConfirm(command);
      const nextState = result.status === "DUPLICATE_DATASET" ? "duplicate" : "completed";
      setState(nextState);
      onCompleted?.(result);
    } catch (error) {
      const candidate = error as Partial<CsvImportConfirmationFailure> | null;
      const code = candidate?.code;
      const knownCode = typeof code === "string" && code in CSV_IMPORT_ERROR_MESSAGES
        ? (code as CsvImportErrorCode)
        : undefined;
      setLocalErrorCode(knownCode);
      setState("retryable-error");
      onFailed?.({ code: knownCode });
    } finally {
      inFlightRef.current = false;
    }
  }

  const statusMessage =
    state === "confirming"
      ? "Confirmando importação…"
      : state === "completed"
        ? "Importação confirmada."
        : state === "duplicate"
          ? "Este conjunto já foi importado."
          : state === "retryable-error"
            ? CSV_IMPORT_ERROR_MESSAGES[effectiveErrorCode ?? "INVALID_COMMAND"]
            : null;

  return (
    <div className={className} data-testid={testId}>
      {blockReason ? (
        <p
          aria-live="polite"
          className="mb-3 text-sm text-muted-foreground"
          data-testid={`${testId}-blocked`}
          role="alert"
        >
          {blockReason}
        </p>
      ) : null}
      {statusMessage ? (
        <p
          aria-live="polite"
          className={`mb-3 flex items-center gap-2 text-sm ${state === "retryable-error" ? "text-destructive" : "text-muted-foreground"}`}
          data-testid={`${testId}-status`}
          role={state === "confirming" || state === "completed" ? "status" : "alert"}
        >
          {state === "confirming" ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : state === "completed" ? (
            <CheckCircle2 aria-hidden="true" className="size-4" />
          ) : (
            <AlertCircle aria-hidden="true" className="size-4" />
          )}
          {statusMessage}
        </p>
      ) : null}
      <Button
        className="w-full sm:w-auto"
        data-testid={`${testId}-submit`}
        disabled={!canSubmit}
        onClick={handleConfirm}
        type="button"
      >
        {state === "retryable-error" ? retryLabel : label}
      </Button>
    </div>
  );
}

export const ConfirmImportButton = CsvImportConfirmation;
export const CsvImportConfirmButton = CsvImportConfirmation;
