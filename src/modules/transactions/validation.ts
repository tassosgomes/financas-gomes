import { z } from "zod";

import { isUuidV7 } from "@/lib/uuidv7";

import {
  assertDateNotFuture,
  currentFinancialDate,
  parseFinancialDate,
  type FinancialDate,
} from "./dates";
import {
  TransactionDomainError,
  TRANSACTION_ERROR_CODES,
  TRANSACTION_ERROR_MESSAGES,
  ACCOUNT_ENTRY_STATUSES,
  FINANCIAL_EVENT_KINDS,
  FINANCIAL_EVENT_ORIGINS,
  FINANCIAL_EVENT_STATUSES,
  MANUAL_TRANSACTION_KINDS,
  TRANSACTION_COMMAND_ID_MAX_LENGTH,
  MANUAL_TRANSACTION_DESCRIPTION_MAX_LENGTH,
  NON_EDITABLE_TRANSACTION_FIELDS,
  type CancelManualTransactionCommand,
  type CreateExpenseCommand,
  type CreateIncomeCommand,
  type CreateManualTransactionCommand,
  type TransactionError,
  type TransactionErrorCode,
  type TransactionErrorField,
  type TransactionResult,
  type UpdateManualTransactionCommand,
} from "./contracts";
import { canonicalAmountCents } from "./money";

const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const PROTECTED_CLIENT_FIELDS = new Set<string>([
  ...NON_EDITABLE_TRANSACTION_FIELDS,
  "financialEventId",
  "householdId",
  "reversalOfEventId",
  "amount",
  "type",
]);

function addIssue(context: z.RefinementCtx, message: string): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message,
  });
}

function parseWithDomain<T>(
  parser: () => T,
  context: z.RefinementCtx,
  message: string,
): T | typeof z.NEVER {
  try {
    return parser();
  } catch {
    addIssue(context, message);
    return z.NEVER;
  }
}

function normalizeDescriptionValue(value: string): string | null {
  const normalized = value.normalize("NFKC");
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

/** NFKC + edge trim + internal whitespace collapse for financial details. */
export function normalizeDescription(value: unknown): string {
  if (typeof value !== "string") {
    throw new TransactionDomainError("INVALID_DESCRIPTION", "description");
  }

  const normalized = normalizeDescriptionValue(value);
  if (normalized === null) {
    throw new TransactionDomainError("INVALID_DESCRIPTION", "description");
  }
  return normalized;
}

export const descriptionSchema = z.string().transform((value, context) => {
  const normalized = normalizeDescriptionValue(value);
  if (normalized === null) {
    addIssue(context, "descrição inválida");
    return z.NEVER;
  }
  return normalized;
});

/** Decimal centavos boundary; its output remains a string after validation. */
export const amountCentsSchema = z.string().transform((value, context) =>
  parseWithDomain(
    () => canonicalAmountCents(value),
    context,
    "valor em centavos inválido",
  ),
);

/** Strict civil-date boundary; future checking is an injected server rule. */
export const occurredOnSchema = z.string().transform((value, context) => {
  const date = parseWithDomain(
    () => parseFinancialDate(value),
    context,
    "data inválida",
  );
  if (date === z.NEVER) {
    return z.NEVER;
  }
  return [
    date.year.toString(10).padStart(4, "0"),
    date.month.toString(10).padStart(2, "0"),
    date.day.toString(10).padStart(2, "0"),
  ].join("-");
});

export const commandIdSchema = z.string().transform((value, context) => {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > TRANSACTION_COMMAND_ID_MAX_LENGTH ||
    CONTROL_OR_FORMAT_CHARACTER.test(normalized)
  ) {
    addIssue(context, "identificador de operação inválido");
    return z.NEVER;
  }
  return normalized;
});

export const uuidV7Schema = z.string().trim().refine(isUuidV7, {
  message: "identificador de recurso inválido",
});
export const resourceIdSchema = uuidV7Schema;
export const accountIdSchema = resourceIdSchema;
export const categoryIdSchema = resourceIdSchema;
export const financialEventIdSchema = resourceIdSchema;

export const manualTransactionKindSchema = z.enum(MANUAL_TRANSACTION_KINDS);
export const transactionKindSchema = manualTransactionKindSchema;
export const financialEventKindSchema = z.enum(FINANCIAL_EVENT_KINDS);
export const financialEventStatusSchema = z.enum(FINANCIAL_EVENT_STATUSES);
export const financialEventOriginSchema = z.enum(FINANCIAL_EVENT_ORIGINS);
export const accountEntryStatusSchema = z.enum(ACCOUNT_ENTRY_STATUSES);

const manualTransactionCommandShape = {
  commandId: commandIdSchema,
  amountCents: amountCentsSchema,
  occurredOn: occurredOnSchema,
  description: descriptionSchema,
  accountId: accountIdSchema,
  categoryId: categoryIdSchema.nullable().optional(),
} as const;

/** Create commands intentionally have no free `kind`, status or origin. */
export const createManualTransactionCommandSchema = z
  .object(manualTransactionCommandShape)
  .strict();

export const createExpenseCommandSchema =
  createManualTransactionCommandSchema;
export const createIncomeCommandSchema = createManualTransactionCommandSchema;
export const createExpenseSchema = createExpenseCommandSchema;
export const createIncomeSchema = createIncomeCommandSchema;

export const updateManualTransactionCommandSchema = z
  .object({
    commandId: commandIdSchema,
    financialEventId: financialEventIdSchema,
    description: descriptionSchema.optional(),
    categoryId: categoryIdSchema.nullable().optional(),
  })
  .strict()
  .superRefine((command, context) => {
    if (command.description === undefined && command.categoryId === undefined) {
      addIssue(context, "ao menos um campo editável é obrigatório");
    }
  });

export const cancelManualTransactionCommandSchema = z
  .object({
    commandId: commandIdSchema,
    financialEventId: financialEventIdSchema,
  })
  .strict();
export const updateManualTransactionSchema = updateManualTransactionCommandSchema;
export const cancelManualTransactionSchema = cancelManualTransactionCommandSchema;

export const createExpenseHttpSchema = createExpenseCommandSchema;
export const createExpenseServerActionSchema = createExpenseCommandSchema;
export const createExpenseFormSchema = createExpenseCommandSchema;
export const createIncomeHttpSchema = createIncomeCommandSchema;
export const createIncomeServerActionSchema = createIncomeCommandSchema;
export const createIncomeFormSchema = createIncomeCommandSchema;
export const updateManualTransactionHttpSchema =
  updateManualTransactionCommandSchema;
export const updateManualTransactionServerActionSchema =
  updateManualTransactionCommandSchema;
export const updateManualTransactionFormSchema =
  updateManualTransactionCommandSchema;
export const cancelManualTransactionHttpSchema =
  cancelManualTransactionCommandSchema;
export const cancelManualTransactionServerActionSchema =
  cancelManualTransactionCommandSchema;
export const cancelManualTransactionFormSchema =
  cancelManualTransactionCommandSchema;

function fieldForPath(
  path: readonly (string | number)[],
): TransactionErrorField | undefined {
  const field = path[0];
  switch (field) {
    case "commandId":
    case "amountCents":
    case "occurredOn":
    case "description":
    case "accountId":
    case "categoryId":
    case "financialEventId":
      return field;
    default:
      return undefined;
  }
}

function codeForField(field: TransactionErrorField | undefined): TransactionErrorCode {
  switch (field) {
    case "commandId":
      return "INVALID_COMMAND_ID";
    case "amountCents":
      return "INVALID_AMOUNT";
    case "occurredOn":
      return "INVALID_DATE";
    case "description":
      return "INVALID_DESCRIPTION";
    default:
      return "INVALID_COMMAND";
  }
}

function codeForZodIssue(issue: z.ZodIssue): TransactionErrorCode {
  if (issue.code === "unrecognized_keys") {
    const keys = "keys" in issue ? issue.keys : [];
    return keys.some((key) => PROTECTED_CLIENT_FIELDS.has(key))
      ? "NON_EDITABLE_FIELD"
      : "INVALID_COMMAND";
  }

  return codeForField(fieldForPath(issue.path));
}

/** Converts Zod and domain exceptions to the allow-listed S03 envelope. */
export function toTransactionDomainError(
  error: unknown,
  fallback: TransactionErrorCode = "INVALID_COMMAND",
): TransactionDomainError {
  if (error instanceof TransactionDomainError) {
    return error;
  }

  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    if (issue) {
      const field = fieldForPath(issue.path);
      return new TransactionDomainError(codeForZodIssue(issue), field);
    }
    return new TransactionDomainError(fallback);
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const candidate = (error as { code?: unknown }).code;
    if (
      typeof candidate === "string" &&
      TRANSACTION_ERROR_CODES.includes(candidate as TransactionErrorCode)
    ) {
      const candidateField =
        "field" in error ? (error as { field?: unknown }).field : undefined;
      const field =
        typeof candidateField === "string" &&
        [
          "commandId",
          "amountCents",
          "occurredOn",
          "description",
          "accountId",
          "categoryId",
          "financialEventId",
        ].includes(candidateField)
          ? (candidateField as TransactionErrorField)
          : undefined;
      return new TransactionDomainError(candidate as TransactionErrorCode, field);
    }
  }

  return new TransactionDomainError(fallback);
}

export function toTransactionError(
  error: unknown,
  fallback: TransactionErrorCode = "INVALID_COMMAND",
): TransactionError {
  return toTransactionDomainError(error, fallback).toError();
}

/** Parses a schema while retaining the domain-only error envelope. */
export function parseTransactionCommand<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw toTransactionDomainError(result.error);
  }
  return result.data;
}

export function safeParseTransactionCommand<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): TransactionResult<z.output<T>> {
  const result = schema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: toTransactionError(result.error) };
}

export interface PostingDateValidationOptions {
  /** Server business date; omitted means Temporal's current ISO date. */
  today?: FinancialDate | string;
}

function assertPostingDate(
  command: CreateManualTransactionCommand,
  options?: PostingDateValidationOptions,
): CreateManualTransactionCommand {
  const today = options?.today ?? currentFinancialDate();
  assertDateNotFuture(command.occurredOn, today);
  return command;
}

export function parseCreateExpenseCommand(
  input: unknown,
  options?: PostingDateValidationOptions,
): CreateExpenseCommand {
  return assertPostingDate(
    parseTransactionCommand(createExpenseCommandSchema, input),
    options,
  ) as CreateExpenseCommand;
}

export function parseCreateIncomeCommand(
  input: unknown,
  options?: PostingDateValidationOptions,
): CreateIncomeCommand {
  return assertPostingDate(
    parseTransactionCommand(createIncomeCommandSchema, input),
    options,
  ) as CreateIncomeCommand;
}

export function parseCreateManualTransactionCommand(
  input: unknown,
  options?: PostingDateValidationOptions,
): CreateManualTransactionCommand {
  return assertPostingDate(
    parseTransactionCommand(createManualTransactionCommandSchema, input),
    options,
  ) as CreateManualTransactionCommand;
}

export function parseUpdateManualTransactionCommand(
  input: unknown,
): UpdateManualTransactionCommand {
  return parseTransactionCommand(
    updateManualTransactionCommandSchema,
    input,
  ) as UpdateManualTransactionCommand;
}

export function parseCancelManualTransactionCommand(
  input: unknown,
): CancelManualTransactionCommand {
  return parseTransactionCommand(
    cancelManualTransactionCommandSchema,
    input,
  ) as CancelManualTransactionCommand;
}

export function safeParseCreateExpenseCommand(
  input: unknown,
  options?: PostingDateValidationOptions,
): TransactionResult<CreateExpenseCommand> {
  try {
    return { ok: true, value: parseCreateExpenseCommand(input, options) };
  } catch (error) {
    return { ok: false, error: toTransactionError(error) };
  }
}

export function safeParseCreateIncomeCommand(
  input: unknown,
  options?: PostingDateValidationOptions,
): TransactionResult<CreateIncomeCommand> {
  try {
    return { ok: true, value: parseCreateIncomeCommand(input, options) };
  } catch (error) {
    return { ok: false, error: toTransactionError(error) };
  }
}

export function safeParseUpdateManualTransactionCommand(
  input: unknown,
): TransactionResult<UpdateManualTransactionCommand> {
  try {
    return {
      ok: true,
      value: parseUpdateManualTransactionCommand(input),
    };
  } catch (error) {
    return { ok: false, error: toTransactionError(error) };
  }
}

export function safeParseCancelManualTransactionCommand(
  input: unknown,
): TransactionResult<CancelManualTransactionCommand> {
  try {
    return {
      ok: true,
      value: parseCancelManualTransactionCommand(input),
    };
  } catch (error) {
    return { ok: false, error: toTransactionError(error) };
  }
}

export const validateCreateExpenseCommand = safeParseCreateExpenseCommand;
export const validateCreateIncomeCommand = safeParseCreateIncomeCommand;
export const validateUpdateManualTransactionCommand =
  safeParseUpdateManualTransactionCommand;
export const validateCancelManualTransactionCommand =
  safeParseCancelManualTransactionCommand;

/** Generic aliases for adapters that select the operation separately. */
export const parseCommand = parseTransactionCommand;
export const safeParseCommand = safeParseTransactionCommand;

export { TRANSACTION_ERROR_MESSAGES };
