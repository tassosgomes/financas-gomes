import { z } from "zod";

import {
  CSV_IMPORT_COMMAND_ID_MAX_LENGTH,
  type ConfirmTransactionImportCommand,
} from "./contracts";

const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;

/**
 * Command IDs are canonicalized like S03 IDs: surrounding whitespace is
 * removed, while control/format characters and empty/oversized values fail.
 */
export const csvImportCommandIdSchema = z.string().transform((value, context) => {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > CSV_IMPORT_COMMAND_ID_MAX_LENGTH ||
    CONTROL_OR_FORMAT_CHARACTER.test(normalized)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "identificador de operação inválido",
    });
    return z.NEVER;
  }
  return normalized;
});

/** Tokens are opaque and must not be trimmed or otherwise interpreted. */
export const csvImportPreviewTokenSchema = z.string().min(1, {
  message: "token de prévia ausente",
});

/** Strictly rejects account, tenant, row, fingerprint and force fields. */
export const confirmTransactionImportCommandSchema = z
  .object({
    commandId: csvImportCommandIdSchema,
    previewToken: csvImportPreviewTokenSchema,
  })
  .strict();

export const confirmCsvImportCommandSchema = confirmTransactionImportCommandSchema;
export const csvImportConfirmationCommandSchema =
  confirmTransactionImportCommandSchema;

export type ParsedConfirmTransactionImportCommand = z.infer<
  typeof confirmTransactionImportCommandSchema
>;

/** Safe parser for adapters that want a typed command without throwing. */
export function parseConfirmTransactionImportCommand(
  input: unknown,
): ParsedConfirmTransactionImportCommand | null {
  const parsed = confirmTransactionImportCommandSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** Ensures callers can use the inferred shape under the public command name. */
export function toConfirmTransactionImportCommand(
  input: unknown,
): ConfirmTransactionImportCommand | null {
  return parseConfirmTransactionImportCommand(input);
}

