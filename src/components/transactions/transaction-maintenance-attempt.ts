import { generateUuidV7 } from "@/lib/uuidv7";
import type {
  CancelManualTransactionCommand,
  UpdateManualTransactionCommand,
} from "@/modules/transactions/contracts";

/** The two editable values are kept in a stable, serializable shape. */
export interface TransactionUpdateValues {
  description: string;
  categoryId: string | null;
}

export interface TransactionMaintenanceAttempt {
  fingerprint: string;
  commandId: string;
}

export type TransactionMaintenanceAttemptRef = {
  current: TransactionMaintenanceAttempt | null;
};

/**
 * Builds a deterministic fingerprint for the effective metadata payload.
 * JSON is sufficient here because the values are already normalized by the
 * T09 form contract and the key order is fixed explicitly.
 */
export function transactionUpdateFingerprint(
  values: TransactionUpdateValues,
): string {
  return JSON.stringify({
    categoryId: values.categoryId,
    description: values.description,
  });
}

/**
 * Keeps one command ID while a user retries the same update. A changed
 * description/category starts a fresh idempotency slot, as required by T07.
 */
export function commandForTransactionUpdate(
  financialEventId: string,
  values: TransactionUpdateValues,
  attempt: TransactionMaintenanceAttemptRef,
): UpdateManualTransactionCommand {
  const fingerprint = transactionUpdateFingerprint(values);
  if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
    attempt.current = {
      commandId: generateUuidV7(),
      fingerprint,
    };
  }

  return {
    categoryId: values.categoryId,
    commandId: attempt.current.commandId,
    description: values.description,
    financialEventId,
  };
}

/** Keeps a cancellation retry on the same idempotency key. */
export function commandForTransactionCancellation(
  financialEventId: string,
  attempt: TransactionMaintenanceAttemptRef,
): CancelManualTransactionCommand {
  const fingerprint = JSON.stringify({ financialEventId });
  if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
    attempt.current = {
      commandId: generateUuidV7(),
      fingerprint,
    };
  }

  return {
    commandId: attempt.current.commandId,
    financialEventId,
  };
}

