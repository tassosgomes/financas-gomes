import { z } from "zod";

import { isUuidV7 } from "@/lib/uuidv7";
import {
  RecurrenceDomainError,
  formatRecurrenceDate,
  normalizeRecurringRule,
  parseRecurrenceDate,
} from "@/modules/recurrences";

import {
  RECURRING_ERROR_CODES,
  RecurringCommandError,
  type CancelRecurringOccurrenceCommand,
  type CreateRecurringRuleCommand,
  type EndRecurringRuleCommand,
  type OverrideRecurringOccurrenceCommand,
  type RealizeRecurringOccurrenceCommand,
  type RecurringErrorCode,
  type RecurringResult,
  type UpdateRecurringRuleFutureCommand,
} from "./contracts";

const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const DECIMAL_INTEGER_PATTERN = /^\d+$/u;
const COMMAND_ID_MAX_LENGTH = 128;
const DESCRIPTION_MAX_LENGTH = 240;

function issue(context: z.RefinementCtx, message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, message });
}

function normalizedText(value: string, maximum: number): string | null {
  const normalized = value.normalize("NFKC");
  if (CONTROL_OR_FORMAT_CHARACTER.test(normalized)) return null;
  const collapsed = normalized.trim().replace(/\s+/gu, " ");
  const length = Array.from(collapsed).length;
  return length >= 1 && length <= maximum ? collapsed : null;
}

function normalizedCents(value: string): string | null {
  if (!DECIMAL_INTEGER_PATTERN.test(value)) return null;
  try {
    const cents = BigInt(value);
    const max = BigInt("9223372036854775807");
    return cents > BigInt(0) && cents <= max ? cents.toString(10) : null;
  } catch {
    return null;
  }
}

function normalizedCommandId(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 &&
    normalized.length <= COMMAND_ID_MAX_LENGTH &&
    !CONTROL_OR_FORMAT_CHARACTER.test(normalized)
    ? normalized
    : null;
}

function normalizedUuid(value: string): string | null {
  const normalized = value.trim();
  return isUuidV7(normalized) ? normalized : null;
}

function normalizedDate(value: string): string | null {
  try {
    return formatRecurrenceDate(parseRecurrenceDate(value));
  } catch {
    return null;
  }
}

const commandId = z.string().transform((value, context) => {
  const normalized = normalizedCommandId(value);
  if (normalized === null) {
    issue(context, "identificador de operação inválido");
    return z.NEVER;
  }
  return normalized;
});

const resourceId = z.string().transform((value, context) => {
  const normalized = normalizedUuid(value);
  if (normalized === null) {
    issue(context, "identificador de recurso inválido");
    return z.NEVER;
  }
  return normalized;
});

const positiveCents = z.string().transform((value, context) => {
  const normalized = normalizedCents(value);
  if (normalized === null) {
    issue(context, "valor em centavos inválido");
    return z.NEVER;
  }
  return normalized;
});

const date = z.string().transform((value, context) => {
  const normalized = normalizedDate(value);
  if (normalized === null) {
    issue(context, "data inválida");
    return z.NEVER;
  }
  return normalized;
});

const description = z.string().transform((value, context) => {
  const normalized = normalizedText(value, DESCRIPTION_MAX_LENGTH);
  if (normalized === null) {
    issue(context, "descrição inválida");
    return z.NEVER;
  }
  return normalized;
});

const recurringFields = {
  accountId: resourceId.nullable().optional(),
  categoryId: resourceId.nullable().optional(),
  kind: z.enum(["EXPENSE", "INCOME"]),
  amountCents: positiveCents,
  description,
  frequency: z.enum(["MONTHLY", "YEARLY"]),
  dayRule: z.enum(["FIXED_DAY", "FIRST_BUSINESS_DAY", "LAST_BUSINESS_DAY"]),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  startOn: date,
  endOn: date.nullable().optional(),
  includeInConservativeForecast: z.boolean().optional().default(true),
} as const;

export const createRecurringRuleCommandSchema = z
  .object({ commandId, ...recurringFields })
  .strict();

export const updateRecurringRuleFutureCommandSchema = z
  .object({
    commandId,
    recurringRuleId: resourceId,
    effectiveFrom: date,
    accountId: resourceId.nullable().optional(),
    categoryId: resourceId.nullable().optional(),
    kind: z.enum(["EXPENSE", "INCOME"]).optional(),
    amountCents: positiveCents.optional(),
    description: description.optional(),
    frequency: z.enum(["MONTHLY", "YEARLY"]).optional(),
    dayRule: z
      .enum(["FIXED_DAY", "FIRST_BUSINESS_DAY", "LAST_BUSINESS_DAY"])
      .optional(),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    startOn: date.optional(),
    endOn: date.nullable().optional(),
    includeInConservativeForecast: z.boolean().optional(),
  })
  .strict()
  .superRefine((command, context) => {
    const editable = [
      "accountId",
      "categoryId",
      "kind",
      "amountCents",
      "description",
      "frequency",
      "dayRule",
      "dayOfMonth",
      "startOn",
      "endOn",
      "includeInConservativeForecast",
    ] as const;
    if (!editable.some((field) => command[field] !== undefined)) {
      issue(context, "ao menos um campo editável é obrigatório");
    }
  });

export const endRecurringRuleCommandSchema = z
  .object({ commandId, recurringRuleId: resourceId, endOn: date })
  .strict();

const occurrenceBase = {
  commandId,
  recurringRuleId: resourceId,
  occurrenceKey: z.string().regex(/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/u),
} as const;

export const overrideRecurringOccurrenceCommandSchema = z
  .object({
    ...occurrenceBase,
    amountCents: positiveCents.optional(),
    expectedOn: date.optional(),
  })
  .strict()
  .superRefine((command, context) => {
    if (command.amountCents === undefined && command.expectedOn === undefined) {
      issue(context, "valor ou data substituta é obrigatório");
    }
  });

export const cancelRecurringOccurrenceCommandSchema = z
  .object(occurrenceBase)
  .strict();

export const realizeRecurringOccurrenceCommandSchema = z
  .object({
    ...occurrenceBase,
    financialEventId: resourceId,
    isPartial: z.boolean().optional().default(false),
  })
  .strict();

export function parseRecurringCommand<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issuePath = parsed.error.issues[0]?.path[0];
    throw new RecurringCommandError(
      "INVALID_COMMAND",
      "Os dados da operação são inválidos.",
      typeof issuePath === "string" ? issuePath : undefined,
    );
  }
  return parsed.data;
}

export function parseCreateRecurringRuleCommand(
  input: unknown,
): CreateRecurringRuleCommand {
  const command = parseRecurringCommand(createRecurringRuleCommandSchema, input) as CreateRecurringRuleCommand;
  normalizeRecurringRule({
    ...command,
    direction: command.kind === "INCOME" ? "INFLOW" : "OUTFLOW",
  });
  return command;
}

export function parseUpdateRecurringRuleFutureCommand(
  input: unknown,
): UpdateRecurringRuleFutureCommand {
  return parseRecurringCommand(
    updateRecurringRuleFutureCommandSchema,
    input,
  ) as UpdateRecurringRuleFutureCommand;
}

export function parseEndRecurringRuleCommand(
  input: unknown,
): EndRecurringRuleCommand {
  return parseRecurringCommand(endRecurringRuleCommandSchema, input) as EndRecurringRuleCommand;
}

export function parseOverrideRecurringOccurrenceCommand(
  input: unknown,
): OverrideRecurringOccurrenceCommand {
  return parseRecurringCommand(
    overrideRecurringOccurrenceCommandSchema,
    input,
  ) as OverrideRecurringOccurrenceCommand;
}

export function parseCancelRecurringOccurrenceCommand(
  input: unknown,
): CancelRecurringOccurrenceCommand {
  return parseRecurringCommand(
    cancelRecurringOccurrenceCommandSchema,
    input,
  ) as CancelRecurringOccurrenceCommand;
}

export function parseRealizeRecurringOccurrenceCommand(
  input: unknown,
): RealizeRecurringOccurrenceCommand {
  return parseRecurringCommand(
    realizeRecurringOccurrenceCommandSchema,
    input,
  ) as RealizeRecurringOccurrenceCommand;
}

function isRecurringErrorCode(value: unknown): value is RecurringErrorCode {
  return typeof value === "string" &&
    (RECURRING_ERROR_CODES as readonly string[]).includes(value);
}

export function toRecurringCommandError(
  error: unknown,
  fallback: RecurringErrorCode = "INVALID_COMMAND",
): RecurringCommandError {
  if (error instanceof RecurringCommandError) return error;
  if (error instanceof RecurrenceDomainError) {
    const code = error.code === "RULE_NOT_FOUND" || error.code === "TENANT_RESOURCE_NOT_FOUND"
      ? error.code
      : isRecurringErrorCode(error.code)
        ? error.code
        : fallback;
    return new RecurringCommandError(code, "A operação não pôde ser concluída.", error.field);
  }
  if (error && typeof error === "object" && "code" in error) {
    const candidate = (error as { code?: unknown }).code;
    if (isRecurringErrorCode(candidate)) {
      return new RecurringCommandError(
        candidate,
        "A operação não pôde ser concluída.",
        "field" in error && typeof (error as { field?: unknown }).field === "string"
          ? (error as { field: string }).field
          : undefined,
      );
    }
  }
  return new RecurringCommandError(fallback, "A operação não pôde ser concluída.");
}

export function recurringErrorResult<T>(
  error: unknown,
): RecurringResult<T> {
  const mapped = toRecurringCommandError(error);
  return {
    ok: false,
    error: {
      code: mapped.code,
      message: mapped.message,
      ...(mapped.field ? { field: mapped.field } : {}),
    },
  };
}
