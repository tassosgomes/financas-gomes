import { z } from "zod";

import { isUuidV7 } from "@/lib/uuidv7";

/** Commands published by T01/T03 for forecast-source maintenance. */
export const PLANNED_EVENT_CREATE_OPERATION = "planned_event.create" as const;
export const PLANNED_EVENT_UPDATE_OPERATION = "planned_event.update" as const;
export const PLANNED_EVENT_CANCEL_OPERATION = "planned_event.cancel" as const;

export const PLANNED_EVENT_OPERATIONS = [
  PLANNED_EVENT_CREATE_OPERATION,
  PLANNED_EVENT_UPDATE_OPERATION,
  PLANNED_EVENT_CANCEL_OPERATION,
] as const;
export type PlannedEventOperation = (typeof PLANNED_EVENT_OPERATIONS)[number];

export interface CreatePlannedEventCommand {
  commandId: string;
  accountId?: string | null;
  categoryId?: string | null;
  kind: "EXPENSE" | "INCOME";
  amountCents: string;
  expectedOn: string;
  description: string;
  includeInConservativeForecast?: boolean;
}

export interface UpdatePlannedEventCommand {
  commandId: string;
  plannedEventId: string;
  accountId?: string | null;
  categoryId?: string | null;
  kind?: "EXPENSE" | "INCOME";
  amountCents?: string;
  expectedOn?: string;
  description?: string;
  includeInConservativeForecast?: boolean;
}

export interface CancelPlannedEventCommand {
  commandId: string;
  plannedEventId: string;
}

export interface PlannedEventReadModel {
  id: string;
  accountId: string | null;
  categoryId: string | null;
  kind: "EXPENSE" | "INCOME";
  status: "PLANNED" | "EXPECTED" | "POSTED" | "CANCELLED";
  amountCents: string;
  expectedOn: string;
  description: string;
  includeInConservativeForecast: boolean;
  financialEventId: string | null;
  isPartial: boolean;
  createdAt: string;
  updatedAt: string;
}

export const FORECAST_MAINTENANCE_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INVALID_COMMAND",
  "INVALID_COMMAND_ID",
  "INVALID_AMOUNT",
  "INVALID_DATE",
  "INVALID_KIND",
  "INVALID_DESCRIPTION",
  "NON_EDITABLE_FIELD",
  "INVALID_ACCOUNT_ID",
  "INVALID_CATEGORY_ID",
  "ACCOUNT_NOT_FOUND",
  "ACCOUNT_ARCHIVED",
  "CATEGORY_NOT_FOUND",
  "CATEGORY_ARCHIVED",
  "CATEGORY_KIND_MISMATCH",
  "PLANNED_EVENT_NOT_FOUND",
  "PLANNED_EVENT_ALREADY_CANCELLED",
  "PLANNED_EVENT_NOT_EDITABLE",
  "RULE_NOT_FOUND",
  "OCCURRENCE_NOT_FOUND",
  "COMMAND_ID_REUSED",
  "TENANT_RESOURCE_NOT_FOUND",
  "CONFLICT",
] as const;
export type ForecastMaintenanceErrorCode =
  (typeof FORECAST_MAINTENANCE_ERROR_CODES)[number];

export interface ForecastMaintenanceError {
  code: ForecastMaintenanceErrorCode;
  message: string;
  field?: string;
}

export type ForecastMaintenanceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ForecastMaintenanceError };

export class ForecastMaintenanceCommandError extends Error {
  readonly code: ForecastMaintenanceErrorCode;
  readonly field?: string;

  constructor(
    code: ForecastMaintenanceErrorCode,
    message: string,
    field?: string,
  ) {
    super(message);
    this.name = "ForecastMaintenanceCommandError";
    this.code = code;
    this.field = field;
  }
}

const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const DECIMAL_INTEGER_PATTERN = /^\d+$/u;
const COMMAND_ID_MAX_LENGTH = 128;
const DESCRIPTION_MAX_LENGTH = 240;

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
    const maximum = BigInt("9223372036854775807");
    return cents > BigInt(0) && cents <= maximum ? cents.toString(10) : null;
  } catch {
    return null;
  }
}

function normalizedDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leap ? 29 : 28,
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
  return daysInMonth !== undefined && day >= 1 && day <= daysInMonth
    ? value
    : null;
}

const commandId = z.string().transform((value, context) => {
  const normalized = normalizedCommandId(value);
  if (normalized === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "identificador de operação inválido",
    });
    return z.NEVER;
  }
  return normalized;
});

const resourceId = z.string().transform((value, context) => {
  const normalized = normalizedUuid(value);
  if (normalized === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "identificador de recurso inválido",
    });
    return z.NEVER;
  }
  return normalized;
});

const positiveCents = z.string().transform((value, context) => {
  const normalized = normalizedCents(value);
  if (normalized === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "valor em centavos inválido",
    });
    return z.NEVER;
  }
  return normalized;
});

const date = z.string().transform((value, context) => {
  const normalized = normalizedDate(value);
  if (normalized === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "data inválida",
    });
    return z.NEVER;
  }
  return normalized;
});

const description = z.string().transform((value, context) => {
  const normalized = normalizedText(value, DESCRIPTION_MAX_LENGTH);
  if (normalized === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "descrição inválida",
    });
    return z.NEVER;
  }
  return normalized;
});

const optionalResourceId = resourceId.nullable().optional();

const createFields = {
  accountId: optionalResourceId,
  categoryId: optionalResourceId,
  kind: z.enum(["EXPENSE", "INCOME"]),
  amountCents: positiveCents,
  expectedOn: date,
  description,
  includeInConservativeForecast: z.boolean().optional().default(true),
} as const;

export const createPlannedEventCommandSchema = z
  .object({ commandId, ...createFields })
  .strict();

export const updatePlannedEventCommandSchema = z
  .object({
    commandId,
    plannedEventId: resourceId,
    accountId: optionalResourceId,
    categoryId: optionalResourceId,
    kind: z.enum(["EXPENSE", "INCOME"]).optional(),
    amountCents: positiveCents.optional(),
    expectedOn: date.optional(),
    description: description.optional(),
    includeInConservativeForecast: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const editable = [
      "accountId",
      "categoryId",
      "kind",
      "amountCents",
      "expectedOn",
      "description",
      "includeInConservativeForecast",
    ] as const;
    if (!editable.some((field) => value[field] !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ao menos um campo editável é obrigatório",
      });
    }
  });

export const cancelPlannedEventCommandSchema = z
  .object({ commandId, plannedEventId: resourceId })
  .strict();

function knownNonEditableField(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const fields = [
    "status",
    "financialEventId",
    "installmentId",
    "entryId",
    "entries",
    "postedOn",
    "householdId",
    "userId",
  ] as const;
  return fields.find((field) => field in input);
}

function parse<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const field = knownNonEditableField(input) ?? result.error.issues[0]?.path[0];
    const code = knownNonEditableField(input)
      ? "NON_EDITABLE_FIELD"
      : field === "commandId"
        ? "INVALID_COMMAND_ID"
        : field === "amountCents"
          ? "INVALID_AMOUNT"
          : field === "expectedOn"
            ? "INVALID_DATE"
            : field === "description"
              ? "INVALID_DESCRIPTION"
              : "INVALID_COMMAND";
    throw new ForecastMaintenanceCommandError(
      code,
      "Os dados da operação são inválidos.",
      typeof field === "string" ? field : undefined,
    );
  }
  return result.data;
}

export function parseCreatePlannedEventCommand(
  input: unknown,
): CreatePlannedEventCommand {
  return parse(createPlannedEventCommandSchema, input) as CreatePlannedEventCommand;
}

export function parseUpdatePlannedEventCommand(
  input: unknown,
): UpdatePlannedEventCommand {
  return parse(updatePlannedEventCommandSchema, input) as UpdatePlannedEventCommand;
}

export function parseCancelPlannedEventCommand(
  input: unknown,
): CancelPlannedEventCommand {
  return parse(cancelPlannedEventCommandSchema, input) as CancelPlannedEventCommand;
}

function validationResult<T>(
  parser: (input: unknown) => T,
  input: unknown,
): ForecastMaintenanceResult<T> {
  try {
    return { ok: true, value: parser(input) };
  } catch (error) {
    if (!(error instanceof ForecastMaintenanceCommandError)) throw error;
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.field ? { field: error.field } : {}),
      },
    };
  }
}

export function validateCreatePlannedEventCommand(
  input: unknown,
): ForecastMaintenanceResult<CreatePlannedEventCommand> {
  return validationResult(parseCreatePlannedEventCommand, input);
}

export function validateUpdatePlannedEventCommand(
  input: unknown,
): ForecastMaintenanceResult<UpdatePlannedEventCommand> {
  return validationResult(parseUpdatePlannedEventCommand, input);
}

export function validateCancelPlannedEventCommand(
  input: unknown,
): ForecastMaintenanceResult<CancelPlannedEventCommand> {
  return validationResult(parseCancelPlannedEventCommand, input);
}
