import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

import { isUuidV7 } from "@/lib/uuidv7";
import {
  MANUAL_TRANSACTION_DESCRIPTION_MAX_LENGTH,
  MANUAL_TRANSACTION_KINDS,
  type CreateManualTransactionCommand,
} from "./contracts";
import {
  amountCentsSchema,
  descriptionSchema,
  occurredOnSchema,
} from "./validation";

export {
  MANUAL_TRANSACTION_DESCRIPTION_MAX_LENGTH,
  MANUAL_TRANSACTION_KINDS,
} from "./contracts";
export type { ManualTransactionKind } from "./contracts";
export type { CreateManualTransactionCommand } from "./contracts";

/**
 * The form intentionally keeps the date as a civil-date string. The server
 * maps the same boundary value to Temporal.PlainDate before applying domain
 * rules, so no JavaScript Date or timezone can cross this contract.
 */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;

/** Returns the local business date without converting it through UTC. */
export function getTodayIsoDate(): string {
  return Temporal.Now.plainDateISO().toString();
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Validates a YYYY-MM-DD civil date without relying on timezone conversion. */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  if (month < 1 || month > 12 || day < 1) {
    return false;
  }

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];

  return day <= daysInMonth;
}

function normalizeDescription(value: string): string | null {
  const normalized = value.normalize("NFKC");

  // Controls are rejected instead of being silently turned into spaces.
  if (CONTROL_OR_FORMAT_CHARACTER.test(normalized)) {
    return null;
  }

  const collapsed = normalized.trim().replace(/\s+/gu, " ");
  const codePointLength = Array.from(collapsed).length;

  if (
    codePointLength < 1 ||
    codePointLength > MANUAL_TRANSACTION_DESCRIPTION_MAX_LENGTH
  ) {
    return null;
  }

  return collapsed;
}

/** Shared description boundary used by both create and edit forms. */
export const manualTransactionDescriptionSchema = descriptionSchema;

const accountIdSchema = z.string().trim().refine(
  (value): boolean => Boolean(isUuidV7(value)),
  {
    message: "Selecione uma conta válida.",
  },
);

const categoryIdSchema = z.string().trim().refine(
  (value): boolean => Boolean(isUuidV7(value)),
  {
    message: "Selecione uma categoria válida.",
  },
);

/**
 * Returns the date-aware browser schema. The server can call this factory
 * with its own business date and revalidate the exact same serializable shape.
 */
export function createManualTransactionFormSchema(
  options: { today?: string } = {},
) {
  const today = options.today ?? getTodayIsoDate();

  return z
    .object({
      kind: z.enum(MANUAL_TRANSACTION_KINDS),
      amountCents: amountCentsSchema,
      occurredOn: occurredOnSchema.refine((value) => value <= today, {
          message: "A data não pode ser futura.",
        }),
      description: manualTransactionDescriptionSchema,
      accountId: accountIdSchema,
      categoryId: z
        .union([categoryIdSchema, z.literal(""), z.null(), z.undefined()])
        .transform((value) => (value === "" || value === undefined ? null : value)),
    })
    .strict();
}

/** The default browser schema uses the current local civil date. */
export const manualTransactionFormSchema = createManualTransactionFormSchema();

export type ManualTransactionFormValues = z.infer<
  typeof manualTransactionFormSchema
>;

/**
 * Adds the attempt ID at the application boundary and removes the UI-only
 * kind selector. The operation (expense/income) remains the action's source
 * of truth; all other fields retain their serializable command shape so the
 * server command schema can validate them again.
 */
export function toCreateManualTransactionCommand(
  values: ManualTransactionFormValues,
  commandId: string,
): CreateManualTransactionCommand {
  return {
    accountId: values.accountId,
    amountCents: values.amountCents,
    categoryId: values.categoryId,
    commandId,
    description: values.description,
    occurredOn: values.occurredOn,
  };
}

/** Compatibility aliases for callers that name the form after its screen. */
export const transactionFormSchema = manualTransactionFormSchema;
export const createTransactionFormSchema = createManualTransactionFormSchema;

export function normalizeManualTransactionDescription(value: string): string {
  const normalized = normalizeDescription(value);
  if (normalized === null) {
    throw new Error("Invalid manual transaction description");
  }

  return normalized;
}
