import { z } from "zod";

import { isUuidV7 } from "@/lib/uuidv7";

import {
  parseBillingDate,
  serializeBillingDate,
  validateBillingRules,
  type BillingRule,
} from "./billing-cycle";
import {
  CREDIT_CARD_ACCOUNT_TYPE,
  CREDIT_CARD_COMMAND_ID_MAX_LENGTH,
  CREDIT_CARD_ERROR_CODES,
  CREDIT_CARD_MAX_CENTS,
  CREDIT_CARD_NAME_MAX_LENGTH,
  CREDIT_CARD_PURCHASE_DESCRIPTION_MAX_LENGTH,
  CREDIT_CARD_STATUSES,
  CREDIT_CARD_STATUS_FILTERS,
  MAX_CREDIT_CARD_BILLING_DAY,
  MAX_CREDIT_CARD_INSTALLMENT_COUNT,
  MIN_CREDIT_CARD_BILLING_DAY,
  MIN_CREDIT_CARD_INSTALLMENT_COUNT,
  NON_EDITABLE_CREDIT_CARD_FIELDS,
  CreditCardDomainError,
  failure,
  type AccountReference,
  type ArchiveCreditCardCommand,
  type BillingRuleVersionValidationInput,
  type CreditCardError,
  type CreditCardErrorCode,
  type CreditCardErrorField,
  type CreditCardReference,
  type CreditCardReferenceValidationInput,
  type CreditCardResult,
  type CreateCreditCardCommand,
  type CreateCreditCardPurchaseCommand,
  type UpdateCreditCardPurchaseCommand,
  type CancelCreditCardPurchaseCommand,
  type RegisterCreditCardPaymentCommand,
  type DefaultPaymentAccountValidationInput,
  type GetCreditCardQuery,
  type GetCreditCardPurchaseQuery,
  type ListCreditCardsQuery,
  type UpdateCreditCardBillingRuleCommand,
  type UpdateCreditCardCommand,
} from "./contracts";

/** Values are kept as strings at the React/Next boundary and bigint in domain code. */
export const CREDIT_LIMIT_MAX_CENTS = CREDIT_CARD_MAX_CENTS;
export const MIN_BILLING_DAY = MIN_CREDIT_CARD_BILLING_DAY;
export const MAX_BILLING_DAY = MAX_CREDIT_CARD_BILLING_DAY;

const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const DECIMAL_INTEGER_PATTERN = /^\d+$/u;
const DAY_STRING_PATTERN = /^(?:[1-9]|[12]\d|3[01])$/u;

function addIssue(context: z.RefinementCtx, message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, message });
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function normalizeText(value: string, maximum: number): string | null {
  const normalized = value.normalize("NFKC");
  if (CONTROL_OR_FORMAT_CHARACTER.test(normalized)) {
    return null;
  }

  const collapsed = normalized.trim().replace(/\s+/gu, " ");
  const length = codePointLength(collapsed);
  return length >= 1 && length <= maximum ? collapsed : null;
}

function canonicalPositiveCents(value: string): string | null {
  if (!DECIMAL_INTEGER_PATTERN.test(value)) {
    return null;
  }

  try {
    const cents = BigInt(value);
    const maximum = BigInt(CREDIT_CARD_MAX_CENTS);
    if (cents <= BigInt(0) || cents > maximum) {
      return null;
    }
    return cents.toString(10);
  } catch {
    return null;
  }
}

function normalizeCommandId(value: string): string | null {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > CREDIT_CARD_COMMAND_ID_MAX_LENGTH ||
    CONTROL_OR_FORMAT_CHARACTER.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function normalizeUuid(value: string): string | null {
  const normalized = value.trim();
  return isUuidV7(normalized) ? normalized : null;
}

function normalizeIsoDate(value: string): string | null {
  try {
    return serializeBillingDate(parseBillingDate(value));
  } catch {
    return null;
  }
}

/** Positive integer cents bounded by PostgreSQL BIGINT. */
export const positiveCentsSchema = z.string().transform((value, context) => {
  const normalized = canonicalPositiveCents(value);
  if (normalized === null) {
    addIssue(context, "valor em centavos inválido");
    return z.NEVER;
  }
  return normalized;
});

export const creditLimitCentsSchema = positiveCentsSchema;
export const amountCentsSchema = positiveCentsSchema;

/** Opaque retry key; it is never interpreted as tenant or authorization data. */
export const commandIdSchema = z.string().transform((value, context) => {
  const normalized = normalizeCommandId(value);
  if (normalized === null) {
    addIssue(context, "identificador de operação inválido");
    return z.NEVER;
  }
  return normalized;
});

/** Resource identifiers are UUIDv7 strings at the application boundary. */
export const uuidV7Schema = z.string().transform((value, context) => {
  const normalized = normalizeUuid(value);
  if (normalized === null) {
    addIssue(context, "identificador de recurso inválido");
    return z.NEVER;
  }
  return normalized;
});

export const resourceIdSchema = uuidV7Schema;
export const cardIdSchema = resourceIdSchema;
export const creditCardIdSchema = cardIdSchema;
export const accountIdSchema = resourceIdSchema;

/** Strict civil date; no native Date or timezone enters this module. */
export const isoDateSchema = z.string().transform((value, context) => {
  const normalized = normalizeIsoDate(value);
  if (normalized === null) {
    addIssue(context, "data inválida");
    return z.NEVER;
  }
  return normalized;
});

export const effectiveFromSchema = isoDateSchema;
export const effectiveUntilSchema = isoDateSchema;

export const creditCardNameSchema = z.string().transform((value, context) => {
  const normalized = normalizeText(value, CREDIT_CARD_NAME_MAX_LENGTH);
  if (normalized === null) {
    addIssue(context, "nome inválido");
    return z.NEVER;
  }
  return normalized;
});

export const cardNameSchema = creditCardNameSchema;
export const nameSchema = creditCardNameSchema;

export const billingDaySchema = z
  .number()
  .int()
  .min(MIN_CREDIT_CARD_BILLING_DAY)
  .max(MAX_CREDIT_CARD_BILLING_DAY);
export const closingDaySchema = billingDaySchema;
export const dueDaySchema = billingDaySchema;
export const dayOfMonthSchema = billingDaySchema;

/** HTML number inputs are adapted to the numeric command shape. */
export const billingDayFormSchema = z.union([
  billingDaySchema,
  z.string().regex(DAY_STRING_PATTERN, "dia do mês inválido").transform(Number),
]);

const optionalCommandPaymentAccountIdSchema = accountIdSchema
  .nullable()
  .optional();
const optionalFormPaymentAccountIdSchema = z
  .union([accountIdSchema, z.literal(""), z.null(), z.undefined()])
  .transform((value) => (value === "" || value === undefined ? null : value));

/** Fields accepted by the card creation form before commandId is attached. */
export const createCreditCardFormSchema = z
  .object({
    name: creditCardNameSchema,
    creditLimitCents: creditLimitCentsSchema,
    closingDay: billingDayFormSchema,
    dueDay: billingDayFormSchema,
    defaultPaymentAccountId: optionalFormPaymentAccountIdSchema,
    effectiveFrom: effectiveFromSchema.optional(),
  })
  .strict();

/**
 * Strict create command.  The account row, status, household and initial
 * billing rule ownership are all server-derived and cannot be supplied here.
 */
export const createCreditCardCommandSchema = z
  .object({
    commandId: commandIdSchema,
    name: creditCardNameSchema,
    creditLimitCents: creditLimitCentsSchema,
    closingDay: billingDaySchema,
    dueDay: billingDaySchema,
    defaultPaymentAccountId: optionalCommandPaymentAccountIdSchema,
    effectiveFrom: effectiveFromSchema.optional(),
  })
  .strict();

export const createCardFormSchema = createCreditCardFormSchema;
export const createCardCommandSchema = createCreditCardCommandSchema;
export const createCreditCardSchema = createCreditCardCommandSchema;

/** Purchase descriptions use the same control-character policy as metadata. */
export const creditCardPurchaseDescriptionSchema = z.string().transform(
  (value, context) => {
    const normalized = normalizeText(
      value,
      CREDIT_CARD_PURCHASE_DESCRIPTION_MAX_LENGTH,
    );
    if (normalized === null) {
      addIssue(context, "descrição inválida");
      return z.NEVER;
    }
    return normalized;
  },
);
export const purchaseDescriptionSchema = creditCardPurchaseDescriptionSchema;
export const descriptionSchema = creditCardPurchaseDescriptionSchema;
export const creditCardPaymentDescriptionSchema =
  creditCardPurchaseDescriptionSchema;
export const paymentDescriptionSchema = creditCardPaymentDescriptionSchema;
export const installmentCountSchema = z
  .number()
  .int()
  .min(MIN_CREDIT_CARD_INSTALLMENT_COUNT)
  .max(MAX_CREDIT_CARD_INSTALLMENT_COUNT);

/** Strict T06 purchase command; every schedule value is server-derived. */
export const createCreditCardPurchaseCommandSchema = z
  .object({
    commandId: commandIdSchema,
    cardId: cardIdSchema,
    amountCents: amountCentsSchema,
    occurredOn: isoDateSchema,
    description: creditCardPurchaseDescriptionSchema,
    categoryId: accountIdSchema.nullable().optional(),
    installmentCount: installmentCountSchema,
    billingDueOnOverride: isoDateSchema.optional(),
  })
  .strict();
export const createPurchaseCommandSchema =
  createCreditCardPurchaseCommandSchema;
export const createCreditCardPurchaseSchema =
  createCreditCardPurchaseCommandSchema;

/** Only purchase metadata is editable; amount/schedule/entries stay immutable. */
export const updateCreditCardPurchaseCommandSchema = z
  .object({
    commandId: commandIdSchema,
    purchaseId: resourceIdSchema,
    description: creditCardPurchaseDescriptionSchema.optional(),
    categoryId: accountIdSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.description === undefined && value.categoryId === undefined) {
      addIssue(context, "ao menos um campo editável é obrigatório");
    }
  });

export const updatePurchaseCommandSchema = updateCreditCardPurchaseCommandSchema;

/** Cancellation is aggregate-scoped and never accepts an installment id. */
export const cancelCreditCardPurchaseCommandSchema = z
  .object({ commandId: commandIdSchema, purchaseId: resourceIdSchema })
  .strict();
export const cancelPurchaseCommandSchema = cancelCreditCardPurchaseCommandSchema;

/** Strict tenant-scoped purchase read query; no client authority fields. */
export const getCreditCardPurchaseQuerySchema = z
  .object({ purchaseId: resourceIdSchema })
  .strict();
export const getPurchaseQuerySchema = getCreditCardPurchaseQuerySchema;

/** Strict global payment command; installment/statement allocation is forbidden. */
export const registerCreditCardPaymentCommandSchema = z
  .object({
    commandId: commandIdSchema,
    cardId: cardIdSchema,
    sourceAccountId: accountIdSchema,
    amountCents: amountCentsSchema,
    occurredOn: isoDateSchema,
    description: creditCardPaymentDescriptionSchema.optional(),
  })
  .strict();
export const createCreditCardPaymentCommandSchema =
  registerCreditCardPaymentCommandSchema;
export const createPaymentCommandSchema = registerCreditCardPaymentCommandSchema;
export const registerPaymentCommandSchema = registerCreditCardPaymentCommandSchema;

/** Card update changes metadata/configuration, never a materialized rule. */
export const updateCreditCardFormSchema = z
  .object({
    name: creditCardNameSchema.optional(),
    creditLimitCents: creditLimitCentsSchema.optional(),
    defaultPaymentAccountId: optionalFormPaymentAccountIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.name === undefined &&
      value.creditLimitCents === undefined &&
      value.defaultPaymentAccountId === undefined
    ) {
      addIssue(context, "ao menos um campo editável é obrigatório");
    }
  });

export const updateCreditCardCommandSchema = z
  .object({
    commandId: commandIdSchema,
    cardId: cardIdSchema,
    name: creditCardNameSchema.optional(),
    creditLimitCents: creditLimitCentsSchema.optional(),
    defaultPaymentAccountId: optionalCommandPaymentAccountIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.name === undefined &&
      value.creditLimitCents === undefined &&
      value.defaultPaymentAccountId === undefined
    ) {
      addIssue(context, "ao menos um campo editável é obrigatório");
    }
  });

export const updateCardFormSchema = updateCreditCardFormSchema;
export const updateCardCommandSchema = updateCreditCardCommandSchema;

/** A new billing rule is versioned by effectiveFrom and checked server-side. */
export const updateCreditCardBillingRuleFormSchema = z
  .object({
    closingDay: billingDayFormSchema,
    dueDay: billingDayFormSchema,
    effectiveFrom: effectiveFromSchema,
  })
  .strict();

export const updateCreditCardBillingRuleCommandSchema = z
  .object({
    commandId: commandIdSchema,
    cardId: cardIdSchema,
    closingDay: billingDaySchema,
    dueDay: billingDaySchema,
    effectiveFrom: effectiveFromSchema,
  })
  .strict();

export const updateBillingRuleFormSchema = updateCreditCardBillingRuleFormSchema;
export const updateBillingRuleCommandSchema =
  updateCreditCardBillingRuleCommandSchema;
export const createCreditCardBillingRuleFormSchema =
  updateCreditCardBillingRuleFormSchema;
export const createCreditCardBillingRuleCommandSchema =
  updateCreditCardBillingRuleCommandSchema;

export const archiveCreditCardCommandSchema = z
  .object({ commandId: commandIdSchema, cardId: cardIdSchema })
  .strict();
export const archiveCardCommandSchema = archiveCreditCardCommandSchema;

/** List defaults to active cards; archived/all are explicit server queries. */
export const creditCardStatusSchema = z.enum(CREDIT_CARD_STATUSES);
export const creditCardStatusFilterSchema = z.enum(CREDIT_CARD_STATUS_FILTERS);
export const listCreditCardsQuerySchema = z
  .object({ status: creditCardStatusFilterSchema.optional().default("ACTIVE") })
  .strict();
export const getCreditCardQuerySchema = z
  .object({ cardId: cardIdSchema })
  .strict();

export type CreateCardFormValues = z.infer<typeof createCreditCardFormSchema>;
export type UpdateCardFormValues = z.infer<typeof updateCreditCardFormSchema>;
export type CreateCreditCardCommandOutput = z.infer<
  typeof createCreditCardCommandSchema
>;

function fieldForPath(
  path: readonly (string | number)[],
): CreditCardErrorField | undefined {
  switch (path[0]) {
    case "commandId":
    case "name":
    case "description":
    case "creditLimitCents":
    case "amountCents":
    case "occurredOn":
    case "installmentCount":
    case "categoryId":
    case "closingDay":
    case "dueDay":
    case "effectiveFrom":
    case "effectiveUntil":
    case "cardId":
    case "purchaseId":
    case "accountId":
    case "sourceAccountId":
    case "defaultPaymentAccountId":
    case "status":
      return path[0];
    default:
      return undefined;
  }
}

function isCreditCardErrorCode(value: unknown): value is CreditCardErrorCode {
  return (
    typeof value === "string" &&
    CREDIT_CARD_ERROR_CODES.includes(value as CreditCardErrorCode)
  );
}

function isCreditCardErrorField(value: unknown): value is CreditCardErrorField {
  return (
    typeof value === "string" &&
    [
      "commandId",
      "name",
      "description",
      "creditLimitCents",
      "amountCents",
      "occurredOn",
      "installmentCount",
      "categoryId",
      "closingDay",
      "dueDay",
      "effectiveFrom",
      "effectiveUntil",
      "cardId",
      "purchaseId",
      "accountId",
      "sourceAccountId",
      "defaultPaymentAccountId",
      "status",
    ].includes(value)
  );
}

function codeForZodIssue(issue: z.ZodIssue): CreditCardErrorCode {
  if (issue.code === "unrecognized_keys") {
    const keys = "keys" in issue ? issue.keys : [];
    return keys.some((key) =>
      (NON_EDITABLE_CREDIT_CARD_FIELDS as readonly string[]).includes(key),
    )
      ? "NON_EDITABLE_FIELD"
      : "INVALID_COMMAND";
  }

  switch (issue.path[0]) {
    case "commandId":
      return "INVALID_COMMAND_ID";
    case "name":
      return "INVALID_NAME";
    case "description":
      return "INVALID_DESCRIPTION";
    case "creditLimitCents":
    case "amountCents":
      return "INVALID_AMOUNT";
    case "occurredOn":
      return "INVALID_DATE";
    case "installmentCount":
      return issue.code === "too_big"
        ? "INSTALLMENT_COUNT_OUT_OF_RANGE"
        : "INVALID_INSTALLMENT_COUNT";
    case "closingDay":
      return "INVALID_BILLING_DAY";
    case "dueDay":
      return "INVALID_BILLING_DAY";
    case "effectiveFrom":
    case "effectiveUntil":
      return "INVALID_DATE";
    case "cardId":
      return "INVALID_CARD_ID";
    case "purchaseId":
      return "INVALID_PURCHASE_ID";
    case "accountId":
    case "defaultPaymentAccountId":
      return "INVALID_ACCOUNT_ID";
    case "status":
      return "INVALID_STATUS_FILTER";
    default:
      return "INVALID_COMMAND";
  }
}

/** Converts Zod/domain/unknown failures into an allow-listed domain error. */
export function toCreditCardDomainError(
  error: unknown,
  fallback: CreditCardErrorCode = "INVALID_COMMAND",
): CreditCardDomainError {
  if (error instanceof CreditCardDomainError) {
    return error;
  }

  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    if (!issue) {
      return new CreditCardDomainError(fallback);
    }
    return new CreditCardDomainError(
      codeForZodIssue(issue),
      fieldForPath(issue.path),
    );
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const candidate = (error as { code?: unknown }).code;
    if (isCreditCardErrorCode(candidate)) {
      const candidateField =
        "field" in error ? (error as { field?: unknown }).field : undefined;
      return new CreditCardDomainError(
        candidate,
        isCreditCardErrorField(candidateField) ? candidateField : undefined,
      );
    }
  }

  return new CreditCardDomainError(fallback);
}

export const toCreditCardError = (
  error: unknown,
  fallback: CreditCardErrorCode = "INVALID_COMMAND",
): CreditCardError => toCreditCardDomainError(error, fallback).toError();

export const toCardDomainError = toCreditCardDomainError;
export const toCardError = toCreditCardError;

/** Parses a strict schema while exposing only the safe domain error envelope. */
export function parseCreditCardCommand<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw toCreditCardDomainError(parsed.error);
  }
  return parsed.data;
}

export function safeParseCreditCardCommand<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): CreditCardResult<z.output<T>> {
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: toCreditCardError(parsed.error) };
}

export const parseCommand = parseCreditCardCommand;
export const safeParseCommand = safeParseCreditCardCommand;

export function parseCreateCreditCardCommand(
  input: unknown,
): CreateCreditCardCommand {
  return parseCreditCardCommand(
    createCreditCardCommandSchema,
    input,
  ) as CreateCreditCardCommand;
}

export function parseCreateCreditCardPurchaseCommand(
  input: unknown,
): CreateCreditCardPurchaseCommand {
  return parseCreditCardCommand(
    createCreditCardPurchaseCommandSchema,
    input,
  ) as CreateCreditCardPurchaseCommand;
}

export function parseRegisterCreditCardPaymentCommand(
  input: unknown,
): RegisterCreditCardPaymentCommand {
  return parseCreditCardCommand(
    registerCreditCardPaymentCommandSchema,
    input,
  ) as RegisterCreditCardPaymentCommand;
}

export function parseUpdateCreditCardPurchaseCommand(
  input: unknown,
): UpdateCreditCardPurchaseCommand {
  return parseCreditCardCommand(
    updateCreditCardPurchaseCommandSchema,
    input,
  ) as UpdateCreditCardPurchaseCommand;
}

export function parseCancelCreditCardPurchaseCommand(
  input: unknown,
): CancelCreditCardPurchaseCommand {
  return parseCreditCardCommand(
    cancelCreditCardPurchaseCommandSchema,
    input,
  ) as CancelCreditCardPurchaseCommand;
}

export function parseGetCreditCardPurchaseQuery(
  input: unknown,
): GetCreditCardPurchaseQuery {
  return parseCreditCardCommand(
    getCreditCardPurchaseQuerySchema,
    input,
  ) as GetCreditCardPurchaseQuery;
}

export const parseUpdatePurchaseCommand = parseUpdateCreditCardPurchaseCommand;
export const parseCancelPurchaseCommand = parseCancelCreditCardPurchaseCommand;
export const parseGetPurchaseQuery = parseGetCreditCardPurchaseQuery;

export const parseCreateCreditCardPaymentCommand =
  parseRegisterCreditCardPaymentCommand;
export const parseCreatePaymentCommand = parseRegisterCreditCardPaymentCommand;
export const parseRegisterPaymentCommand = parseRegisterCreditCardPaymentCommand;

export function parseUpdateCreditCardCommand(
  input: unknown,
): UpdateCreditCardCommand {
  return parseCreditCardCommand(
    updateCreditCardCommandSchema,
    input,
  ) as UpdateCreditCardCommand;
}

export function parseUpdateCreditCardBillingRuleCommand(
  input: unknown,
): UpdateCreditCardBillingRuleCommand {
  return parseCreditCardCommand(
    updateCreditCardBillingRuleCommandSchema,
    input,
  ) as UpdateCreditCardBillingRuleCommand;
}

export function parseArchiveCreditCardCommand(
  input: unknown,
): ArchiveCreditCardCommand {
  return parseCreditCardCommand(
    archiveCreditCardCommandSchema,
    input,
  ) as ArchiveCreditCardCommand;
}

export function parseListCreditCardsQuery(
  input: unknown = {},
): ListCreditCardsQuery {
  return parseCreditCardCommand(
    listCreditCardsQuerySchema,
    input,
  ) as ListCreditCardsQuery;
}

export function parseGetCreditCardQuery(input: unknown): GetCreditCardQuery {
  return parseCreditCardCommand(
    getCreditCardQuerySchema,
    input,
  ) as GetCreditCardQuery;
}

export const parseCreateCardCommand = parseCreateCreditCardCommand;
export const parseUpdateCardCommand = parseUpdateCreditCardCommand;
export const parseUpdateBillingRuleCommand =
  parseUpdateCreditCardBillingRuleCommand;
export const parseArchiveCardCommand = parseArchiveCreditCardCommand;

export function validateCreateCreditCardCommand(
  input: unknown,
): CreditCardResult<CreateCreditCardCommand> {
  return safeParseCreditCardCommand(createCreditCardCommandSchema, input);
}

export function validateCreateCreditCardPurchaseCommand(
  input: unknown,
): CreditCardResult<CreateCreditCardPurchaseCommand> {
  return safeParseCreditCardCommand(
    createCreditCardPurchaseCommandSchema,
    input,
  );
}

export const parseCreatePurchaseCommand = parseCreateCreditCardPurchaseCommand;
export const validateCreatePurchaseCommand =
  validateCreateCreditCardPurchaseCommand;

export function validateRegisterCreditCardPaymentCommand(
  input: unknown,
): CreditCardResult<RegisterCreditCardPaymentCommand> {
  return safeParseCreditCardCommand(
    registerCreditCardPaymentCommandSchema,
    input,
  );
}

export const validateCreateCreditCardPaymentCommand =
  validateRegisterCreditCardPaymentCommand;
export const validateCreatePaymentCommand =
  validateRegisterCreditCardPaymentCommand;
export const validateRegisterPaymentCommand =
  validateRegisterCreditCardPaymentCommand;

export function validateUpdateCreditCardPurchaseCommand(
  input: unknown,
): CreditCardResult<UpdateCreditCardPurchaseCommand> {
  return safeParseCreditCardCommand(updateCreditCardPurchaseCommandSchema, input);
}

export function validateCancelCreditCardPurchaseCommand(
  input: unknown,
): CreditCardResult<CancelCreditCardPurchaseCommand> {
  return safeParseCreditCardCommand(cancelCreditCardPurchaseCommandSchema, input);
}

export const validateUpdatePurchaseCommand = validateUpdateCreditCardPurchaseCommand;
export const validateCancelPurchaseCommand = validateCancelCreditCardPurchaseCommand;

export function validateUpdateCreditCardCommand(
  input: unknown,
): CreditCardResult<UpdateCreditCardCommand> {
  return safeParseCreditCardCommand(updateCreditCardCommandSchema, input);
}

export function validateUpdateCreditCardBillingRuleCommand(
  input: unknown,
): CreditCardResult<UpdateCreditCardBillingRuleCommand> {
  return safeParseCreditCardCommand(
    updateCreditCardBillingRuleCommandSchema,
    input,
  );
}

export function validateArchiveCreditCardCommand(
  input: unknown,
): CreditCardResult<ArchiveCreditCardCommand> {
  return safeParseCreditCardCommand(archiveCreditCardCommandSchema, input);
}

export const validateCreateCardCommand = validateCreateCreditCardCommand;
export const validateUpdateCardCommand = validateUpdateCreditCardCommand;
export const validateArchiveCardCommand = validateArchiveCreditCardCommand;

/** Server-side defaulting keeps a missing initial date out of the browser contract. */
export function normalizeCreateCreditCardCommand(
  command: CreateCreditCardCommand,
  effectiveFrom: string,
): CreateCreditCardCommand {
  const parsedDate = normalizeIsoDate(effectiveFrom);
  if (parsedDate === null) {
    throw new CreditCardDomainError("INVALID_DATE", "effectiveFrom");
  }

  return {
    ...command,
    effectiveFrom: command.effectiveFrom ?? parsedDate,
    ...(command.defaultPaymentAccountId === undefined
      ? { defaultPaymentAccountId: null }
      : {}),
  };
}

export const applyCreditCardDefaults = normalizeCreateCreditCardCommand;

export function normalizeCreditCardName(value: unknown): string {
  if (typeof value !== "string") {
    throw new CreditCardDomainError("INVALID_NAME", "name");
  }
  const normalized = normalizeText(value, CREDIT_CARD_NAME_MAX_LENGTH);
  if (normalized === null) {
    throw new CreditCardDomainError("INVALID_NAME", "name");
  }
  return normalized;
}

export function parseCreditLimitCents(value: unknown): bigint {
  if (typeof value !== "string") {
    throw new CreditCardDomainError("INVALID_AMOUNT", "creditLimitCents");
  }
  const normalized = canonicalPositiveCents(value);
  if (normalized === null) {
    throw new CreditCardDomainError("INVALID_AMOUNT", "creditLimitCents");
  }
  return BigInt(normalized);
}

export const parsePositiveCents = parseCreditLimitCents;

function cardValidationInput(
  input: CreditCardReferenceValidationInput | CreditCardReference,
  householdId?: string,
): CreditCardReferenceValidationInput {
  return "card" in input
    ? input
    : { card: input, householdId: householdId ?? input.householdId };
}

/** Cross-household IDs are intentionally indistinguishable from absence. */
export function assertCreditCardBelongsToHousehold(
  input: CreditCardReferenceValidationInput | CreditCardReference,
  householdId?: string,
): CreditCardReference {
  const value = cardValidationInput(input, householdId);
  if (
    !value.card ||
    value.card.householdId !== value.householdId ||
    !value.card.id ||
    !value.card.accountId
  ) {
    throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
  }
  return value.card;
}

export const assertCardBelongsToHousehold = assertCreditCardBelongsToHousehold;
export const assertCreditCardTenant = assertCreditCardBelongsToHousehold;

/** A card must remain an active, specialized account for new writes. */
export function assertCreditCardIsActive(
  input: CreditCardReferenceValidationInput | CreditCardReference,
  householdId?: string,
): CreditCardReference {
  const value = cardValidationInput(input, householdId);
  const card = assertCreditCardBelongsToHousehold(value);

  if (card.status === "ARCHIVED") {
    throw new CreditCardDomainError("CARD_ARCHIVED", "cardId");
  }

  if (card.type !== undefined && card.type !== CREDIT_CARD_ACCOUNT_TYPE) {
    throw new CreditCardDomainError("ACCOUNT_NOT_CREDIT_CARD", "accountId");
  }

  const account = value.account;
  if (account) {
    if (
      account.id !== card.accountId ||
      account.householdId !== value.householdId
    ) {
      throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
    }
    if (account.type !== CREDIT_CARD_ACCOUNT_TYPE) {
      throw new CreditCardDomainError("ACCOUNT_NOT_CREDIT_CARD", "accountId");
    }
    if (account.status === "ARCHIVED") {
      throw new CreditCardDomainError("CARD_ARCHIVED", "cardId");
    }
  }

  return card;
}

export const assertCardIsActive = assertCreditCardIsActive;
export const assertCreditCardActive = assertCreditCardIsActive;
export const assertCardWriteAllowed = assertCreditCardIsActive;

export function assertCreditCardAccount(
  account: AccountReference | null | undefined,
  householdId?: string,
): AccountReference {
  if (!account || (householdId !== undefined && account.householdId !== householdId)) {
    throw new CreditCardDomainError("ACCOUNT_NOT_FOUND", "accountId");
  }
  if (account.type !== CREDIT_CARD_ACCOUNT_TYPE) {
    throw new CreditCardDomainError("ACCOUNT_NOT_CREDIT_CARD", "accountId");
  }
  return account;
}

export const assertAccountIsCreditCard = assertCreditCardAccount;
export const validateCreditCardAccount = assertCreditCardAccount;

/**
 * Validates the optional payment account after the server has loaded it with
 * the household predicate.  A cross-household ID is reported as not found,
 * avoiding a tenant oracle; archived/non-card accounts are actionable.
 */
export function assertDefaultPaymentAccount(
  input: DefaultPaymentAccountValidationInput,
): void {
  const id = input.defaultPaymentAccountId;
  if (id === undefined || id === null) {
    return;
  }

  const account = input.account;
  if (
    !account ||
    account.id !== id ||
    account.householdId !== input.householdId
  ) {
    throw new CreditCardDomainError(
      "PAYMENT_ACCOUNT_NOT_FOUND",
      "defaultPaymentAccountId",
    );
  }
  if (
    input.cardAccountId !== undefined &&
    input.cardAccountId !== null &&
    account.id === input.cardAccountId
  ) {
    throw new CreditCardDomainError(
      "PAYMENT_ACCOUNT_INVALID",
      "defaultPaymentAccountId",
    );
  }
  if (account.status === "ARCHIVED") {
    throw new CreditCardDomainError(
      "PAYMENT_ACCOUNT_ARCHIVED",
      "defaultPaymentAccountId",
    );
  }
  if (account.type === CREDIT_CARD_ACCOUNT_TYPE) {
    throw new CreditCardDomainError(
      "PAYMENT_ACCOUNT_INVALID",
      "defaultPaymentAccountId",
    );
  }
}

export const validateDefaultPaymentAccount = assertDefaultPaymentAccount;
export const assertPaymentAccount = assertDefaultPaymentAccount;

/**
 * Validates the source of a global card payment after the server has loaded it
 * with the household predicate. A missing/cross-tenant row is intentionally
 * opaque; the card account itself can never fund its own payment.
 */
export function assertCreditCardPaymentSourceAccount(
  input: DefaultPaymentAccountValidationInput & {
    sourceAccountId: string;
  },
): AccountReference {
  const account = input.account;
  if (
    !account ||
    account.id !== input.sourceAccountId ||
    account.householdId !== input.householdId
  ) {
    throw new CreditCardDomainError("PAYMENT_ACCOUNT_NOT_FOUND", "sourceAccountId");
  }
  if (
    input.cardAccountId !== undefined &&
    input.cardAccountId !== null &&
    account.id === input.cardAccountId
  ) {
    throw new CreditCardDomainError("PAYMENT_ACCOUNT_INVALID", "sourceAccountId");
  }
  if (account.status === "ARCHIVED") {
    throw new CreditCardDomainError(
      "PAYMENT_ACCOUNT_ARCHIVED",
      "sourceAccountId",
    );
  }
  if (account.type === CREDIT_CARD_ACCOUNT_TYPE) {
    throw new CreditCardDomainError("PAYMENT_ACCOUNT_INVALID", "sourceAccountId");
  }
  return account;
}

export const assertPaymentSourceAccount = assertCreditCardPaymentSourceAccount;
export const validateCreditCardPaymentSourceAccount =
  assertCreditCardPaymentSourceAccount;

/** Pure status guard used before an archive write; no hard-delete semantics. */
export function assertCreditCardCanArchive(
  input: CreditCardReferenceValidationInput | CreditCardReference,
  householdId?: string,
): CreditCardReference {
  const card = assertCreditCardBelongsToHousehold(input, householdId);
  if (card.status === "ARCHIVED") {
    throw new CreditCardDomainError("CARD_ARCHIVED", "cardId");
  }
  return card;
}

export const assertCanArchiveCreditCard = assertCreditCardCanArchive;
export const assertCanArchiveCard = assertCreditCardCanArchive;

/**
 * Checks a candidate billing version against server-loaded versions.  T03 is
 * the source of date/range semantics; this adapter only maps its failures to
 * the stable S06 error vocabulary and verifies card ownership.
 */
export function assertBillingRuleVersion(
  input: BillingRuleVersionValidationInput,
): void {
  const cardId = normalizeUuid(input.cardId);
  if (cardId === null) {
    throw new CreditCardDomainError("INVALID_CARD_ID", "cardId");
  }

  const effectiveFrom = normalizeIsoDate(input.effectiveFrom);
  if (effectiveFrom === null) {
    throw new CreditCardDomainError("INVALID_DATE", "effectiveFrom");
  }

  const effectiveUntil =
    input.effectiveUntil === undefined || input.effectiveUntil === null
      ? null
      : normalizeIsoDate(input.effectiveUntil);
  if (input.effectiveUntil !== undefined && effectiveUntil === null) {
    throw new CreditCardDomainError("INVALID_DATE", "effectiveUntil");
  }

  if (
    !Number.isInteger(input.closingDay) ||
    input.closingDay < MIN_CREDIT_CARD_BILLING_DAY ||
    input.closingDay > MAX_CREDIT_CARD_BILLING_DAY
  ) {
    throw new CreditCardDomainError("INVALID_BILLING_DAY", "closingDay");
  }
  if (
    !Number.isInteger(input.dueDay) ||
    input.dueDay < MIN_CREDIT_CARD_BILLING_DAY ||
    input.dueDay > MAX_CREDIT_CARD_BILLING_DAY
  ) {
    throw new CreditCardDomainError("INVALID_BILLING_DAY", "dueDay");
  }

  const candidate: BillingRule = {
    id: undefined,
    cardId,
    closingDay: input.closingDay,
    dueDay: input.dueDay,
    effectiveFrom,
    effectiveUntil,
  };

  try {
    validateBillingRules([
      ...(input.existingRules ?? []).map((rule) => ({ ...rule }) as BillingRule),
      candidate,
    ]);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "BILLING_RULE_OVERLAP"
    ) {
      throw new CreditCardDomainError(
        "BILLING_RULE_OVERLAP",
        "effectiveFrom",
      );
    }
    throw new CreditCardDomainError("INVALID_BILLING_RULE", "effectiveFrom");
  }
}

export const validateBillingRuleVersion = assertBillingRuleVersion;
export const assertBillingRuleCanBeAdded = assertBillingRuleVersion;
export const validateCreditCardBillingRule = assertBillingRuleVersion;

/** Result helper for adapters that do not want exceptions at their boundary. */
export function billingRuleVersionResult(
  input: BillingRuleVersionValidationInput,
): CreditCardResult<void> {
  try {
    assertBillingRuleVersion(input);
    return { ok: true, value: undefined };
  } catch (error) {
    return failure(toCreditCardDomainError(error).code, "effectiveFrom");
  }
}

export const creditCardBillingRuleResult = billingRuleVersionResult;
