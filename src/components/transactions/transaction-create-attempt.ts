import { generateUuidV7 } from "@/lib/uuidv7";
import {
  toCreateManualTransactionCommand,
  type ManualTransactionFormValues,
} from "@/modules/transactions/form-contract";

export interface TransactionCreateAttempt {
  commandId: string;
  fingerprint: string;
}

export type TransactionCreateCommand = ReturnType<
  typeof toCreateManualTransactionCommand
>;

export function transactionCommandFingerprint(
  command: TransactionCreateCommand,
): string {
  return JSON.stringify([
    command.accountId,
    command.amountCents,
    command.categoryId ?? null,
    command.description,
    command.occurredOn,
  ]);
}

/**
 * Keeps one command ID for a retry of the same payload. Editing a field starts
 * a fresh attempt, avoiding a command-id conflict after a corrected error.
 */
export function commandForTransactionAttempt(
  values: ManualTransactionFormValues,
  attempt: { current: TransactionCreateAttempt | null },
): TransactionCreateCommand {
  const provisional = toCreateManualTransactionCommand(values, "pending");
  const fingerprint = transactionCommandFingerprint(provisional);
  if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
    attempt.current = {
      commandId: generateUuidV7(),
      fingerprint,
    };
  }

  return toCreateManualTransactionCommand(values, attempt.current.commandId);
}
