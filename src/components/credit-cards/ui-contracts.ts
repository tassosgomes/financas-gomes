import { z } from "zod";

import { isValidIsoDate } from "@/modules/transactions/form-contract";
import { isUuidV7 } from "@/lib/uuidv7";

/**
 * UI boundary contracts for S06.  These schemas contain only values that can
 * cross a React/Next serialization boundary.  Household, status, origin,
 * ledger signs and every calculated amount are deliberately absent; the
 * server derives those values from the authenticated financial context.
 */

export const CREDIT_CARD_NAME_MAX_LENGTH = 120;
export const CREDIT_CARD_DESCRIPTION_MAX_LENGTH = 240;
export const CREDIT_CARD_COMMAND_ID_MAX_LENGTH = 128;
export const MAX_INSTALLMENT_COUNT = 120;

/** PostgreSQL bigint upper bound used for positive cent values. */
export const MAX_CREDIT_CARD_CENTS = "9223372036854775807";

const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const DECIMAL_INTEGER_PATTERN = /^\d+$/u;
const DAY_STRING_PATTERN = /^(?:[1-9]|[12]\d|3[01])$/u;
const INSTALLMENT_STRING_PATTERN = /^(?:[1-9]|[1-9]\d|1[01]\d|120)$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function addIssue(context: z.RefinementCtx, message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, message });
}

function parsePositiveCents(value: string, context: z.RefinementCtx): string {
  if (!DECIMAL_INTEGER_PATTERN.test(value)) {
    addIssue(context, "valor em centavos inválido");
    return z.NEVER;
  }

  let cents: bigint;
  try {
    cents = BigInt(value);
  } catch {
    addIssue(context, "valor em centavos inválido");
    return z.NEVER;
  }

  if (cents <= BigInt(0) || cents > BigInt(MAX_CREDIT_CARD_CENTS)) {
    addIssue(context, "valor em centavos inválido");
    return z.NEVER;
  }

  return cents.toString(10);
}

/** Positive integer cents; floats, signs and zero are not accepted. */
export const positiveCentsSchema = z.string().transform(parsePositiveCents);
export const amountCentsSchema = positiveCentsSchema;
export const creditLimitCentsSchema = positiveCentsSchema;

/** Opaque command ID, normalized but never interpreted as tenant authority. */
export const commandIdSchema = z.string().transform((value, context) => {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > CREDIT_CARD_COMMAND_ID_MAX_LENGTH ||
    CONTROL_OR_FORMAT_CHARACTER.test(normalized)
  ) {
    addIssue(context, "identificador de operação inválido");
    return z.NEVER;
  }
  return normalized;
});

/** Resource IDs are UUIDv7 strings; no domain object crosses this boundary. */
export const uuidV7Schema = z.string().trim().refine(isUuidV7, {
  message: "identificador de recurso inválido",
});
export const resourceIdSchema = uuidV7Schema;
export const cardIdSchema = resourceIdSchema;
export const creditCardIdSchema = cardIdSchema;
export const accountIdSchema = resourceIdSchema;
export const sourceAccountIdSchema = accountIdSchema;
export const categoryIdSchema = resourceIdSchema;

const nullableOptionalIdSchema = z
  .union([resourceIdSchema, z.literal(""), z.null(), z.undefined()])
  .transform((value) => (value === "" || value === undefined ? null : value));

function validDateSchema(message = "data inválida") {
  return z.string().refine(isValidIsoDate, { message });
}

/** Financial dates remain civil-date strings and never become `Date` objects. */
export const isoDateSchema = validDateSchema();
export const occurredOnSchema = isoDateSchema;

export const nameSchema = z.string().transform((value, context) => {
  const normalized = normalizeText(value, CREDIT_CARD_NAME_MAX_LENGTH);
  if (normalized === null) {
    addIssue(context, "nome inválido");
    return z.NEVER;
  }
  return normalized;
});

export const descriptionSchema = z.string().transform((value, context) => {
  const normalized = normalizeText(value, CREDIT_CARD_DESCRIPTION_MAX_LENGTH);
  if (normalized === null) {
    addIssue(context, "descrição inválida");
    return z.NEVER;
  }
  return normalized;
});

/** Billing days are intentionally numbers in commands, not date objects. */
export const billingDaySchema = z.number().int().min(1).max(31);
export const dayOfMonthSchema = billingDaySchema;
export const closingDaySchema = billingDaySchema;
export const dueDaySchema = billingDaySchema;

/** HTML number inputs can be adapted to the numeric command representation. */
export const billingDayFormSchema = z.union([
  billingDaySchema,
  z.string().regex(DAY_STRING_PATTERN, "dia do mês inválido").transform(Number),
]);

export const installmentCountSchema = z.number().int().min(1).max(MAX_INSTALLMENT_COUNT);
export const installmentCountFormSchema = z.union([
  installmentCountSchema,
  z
    .string()
    .regex(INSTALLMENT_STRING_PATTERN, "quantidade de parcelas inválida")
    .transform(Number),
]);

const optionalDescriptionSchema = descriptionSchema.optional();
const optionalCategoryIdSchema = categoryIdSchema.nullable().optional();
const optionalDefaultPaymentAccountIdSchema =
  accountIdSchema.nullable().optional();
const optionalFormDefaultPaymentAccountIdSchema = z.union([
  resourceIdSchema,
  z.literal(""),
  z.null(),
  z.undefined(),
]);

/** Fields rendered by the card form; commandId is attached by its adapter. */
export const createCardFormSchema = z
  .object({
    name: nameSchema,
    creditLimitCents: creditLimitCentsSchema,
    closingDay: billingDayFormSchema,
    dueDay: billingDayFormSchema,
    defaultPaymentAccountId: nullableOptionalIdSchema,
    effectiveFrom: isoDateSchema.optional(),
  })
  .strict();

/** Strict create-card command; tenant and server-owned fields are impossible. */
export const createCardCommandSchema = z
  .object({
    commandId: commandIdSchema,
    name: nameSchema,
    creditLimitCents: creditLimitCentsSchema,
    closingDay: billingDaySchema,
    dueDay: billingDaySchema,
    defaultPaymentAccountId: optionalDefaultPaymentAccountIdSchema,
    effectiveFrom: isoDateSchema.optional(),
  })
  .strict();

/** Fields rendered by the purchase form; schedule values are server output. */
export const createPurchaseFormSchema = z
  .object({
    cardId: cardIdSchema,
    amountCents: amountCentsSchema,
    occurredOn: occurredOnSchema,
    description: descriptionSchema,
    categoryId: optionalCategoryIdSchema,
    installmentCount: installmentCountFormSchema,
    billingDueOnOverride: isoDateSchema.optional(),
  })
  .strict();

/** Strict purchase command; no total/parcel values or financial signs. */
export const createPurchaseCommandSchema = z
  .object({
    commandId: commandIdSchema,
    cardId: cardIdSchema,
    amountCents: amountCentsSchema,
    occurredOn: occurredOnSchema,
    description: descriptionSchema,
    categoryId: optionalCategoryIdSchema,
    installmentCount: installmentCountSchema,
    billingDueOnOverride: isoDateSchema.optional(),
  })
  .strict();

/** Fields rendered by the global card-payment form. */
export const createPaymentFormSchema = z
  .object({
    cardId: cardIdSchema,
    sourceAccountId: sourceAccountIdSchema,
    amountCents: amountCentsSchema,
    occurredOn: occurredOnSchema,
    description: optionalDescriptionSchema,
  })
  .strict();

/** Strict payment command; payment is global and has no statement/installment ID. */
export const createPaymentCommandSchema = z
  .object({
    commandId: commandIdSchema,
    cardId: cardIdSchema,
    sourceAccountId: sourceAccountIdSchema,
    amountCents: amountCentsSchema,
    occurredOn: occurredOnSchema,
    description: optionalDescriptionSchema,
  })
  .strict();

export type CreateCardFormValues = z.infer<typeof createCardFormSchema>;
export type CreateCardCommand = z.infer<typeof createCardCommandSchema>;
export type CreatePurchaseFormValues = z.infer<typeof createPurchaseFormSchema>;
export type CreatePurchaseCommand = z.infer<typeof createPurchaseCommandSchema>;
export type CreatePaymentFormValues = z.infer<typeof createPaymentFormSchema>;
export type CreatePaymentCommand = z.infer<typeof createPaymentCommandSchema>;

export function toCreateCardCommand(
  values: CreateCardFormValues,
  commandId: string,
): CreateCardCommand {
  return createCardCommandSchema.parse({ ...values, commandId });
}

export function toCreatePurchaseCommand(
  values: CreatePurchaseFormValues,
  commandId: string,
): CreatePurchaseCommand {
  return createPurchaseCommandSchema.parse({ ...values, commandId });
}

export function toCreatePaymentCommand(
  values: CreatePaymentFormValues,
  commandId: string,
): CreatePaymentCommand {
  return createPaymentCommandSchema.parse({ ...values, commandId });
}

/**
 * Return only the fields that can be sent to a Server Action.  This helper is
 * useful at call sites that start with an object assembled by a form library;
 * the strict schema remains the final authority and rejects any extra key.
 */
export function parseCreateCardCommand(input: unknown): CreateCardCommand {
  return createCardCommandSchema.parse(input);
}

export function parseCreatePurchaseCommand(
  input: unknown,
): CreatePurchaseCommand {
  return createPurchaseCommandSchema.parse(input);
}

export function parseCreatePaymentCommand(input: unknown): CreatePaymentCommand {
  return createPaymentCommandSchema.parse(input);
}

/** Compatibility names used by future actions and screens. */
export const createCreditCardFormSchema = createCardFormSchema;
export const createCreditCardCommandSchema = createCardCommandSchema;
export const createCreditCardPurchaseFormSchema = createPurchaseFormSchema;
export const createCreditCardPurchaseCommandSchema = createPurchaseCommandSchema;
export const registerCreditCardPaymentFormSchema = createPaymentFormSchema;
export const registerCreditCardPaymentCommandSchema = createPaymentCommandSchema;
export const createCreditCardPaymentFormSchema = createPaymentFormSchema;
export const createCreditCardPaymentCommandSchema = createPaymentCommandSchema;

export const toCreateCreditCardCommand = toCreateCardCommand;
export const toCreateCreditCardPurchaseCommand = toCreatePurchaseCommand;
export const toRegisterCreditCardPaymentCommand = toCreatePaymentCommand;

/**
 * Metadata-only card update.  A limit may be changed only through the
 * explicit card configuration command; billing dates use the versioned rule
 * command below and never overwrite a rule already used by a purchase.
 */
export const updateCardFormSchema = z
  .object({
    name: nameSchema.optional(),
    creditLimitCents: creditLimitCentsSchema.optional(),
    defaultPaymentAccountId: optionalFormDefaultPaymentAccountIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.name === undefined &&
      value.creditLimitCents === undefined &&
      value.defaultPaymentAccountId === null
    ) {
      addIssue(context, "ao menos um campo editável é obrigatório");
    }
  });

export const updateCardCommandSchema = z
  .object({
    commandId: commandIdSchema,
    cardId: cardIdSchema,
    name: nameSchema.optional(),
    creditLimitCents: creditLimitCentsSchema.optional(),
    defaultPaymentAccountId: optionalDefaultPaymentAccountIdSchema,
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

export const archiveCardCommandSchema = z
  .object({
    commandId: commandIdSchema,
    cardId: cardIdSchema,
  })
  .strict();

/** A billing update creates a new effective version on the server. */
export const updateBillingRuleFormSchema = z
  .object({
    closingDay: billingDayFormSchema,
    dueDay: billingDayFormSchema,
    effectiveFrom: isoDateSchema,
  })
  .strict();

export const updateBillingRuleCommandSchema = z
  .object({
    commandId: commandIdSchema,
    cardId: cardIdSchema,
    closingDay: billingDaySchema,
    dueDay: billingDaySchema,
    effectiveFrom: isoDateSchema,
  })
  .strict();

/** Only non-financial purchase metadata can be edited in S06. */
export const updatePurchaseFormSchema = z
  .object({
    description: descriptionSchema.optional(),
    categoryId: optionalCategoryIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.description === undefined && value.categoryId === undefined) {
      addIssue(context, "ao menos um campo editável é obrigatório");
    }
  });

export const updatePurchaseCommandSchema = z
  .object({
    commandId: commandIdSchema,
    purchaseId: resourceIdSchema,
    description: descriptionSchema.optional(),
    categoryId: optionalCategoryIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.description === undefined && value.categoryId === undefined) {
      addIssue(context, "ao menos um campo editável é obrigatório");
    }
  });

/** Cancelling always targets the purchase aggregate, never an installment. */
export const cancelPurchaseCommandSchema = z
  .object({
    commandId: commandIdSchema,
    purchaseId: resourceIdSchema,
  })
  .strict();

export type UpdateCardFormValues = z.infer<typeof updateCardFormSchema>;
export type UpdateCardCommand = z.infer<typeof updateCardCommandSchema>;
export type ArchiveCardCommand = z.infer<typeof archiveCardCommandSchema>;
export type UpdateBillingRuleFormValues = z.infer<
  typeof updateBillingRuleFormSchema
>;
export type UpdateBillingRuleCommand = z.infer<
  typeof updateBillingRuleCommandSchema
>;
export type UpdatePurchaseFormValues = z.infer<typeof updatePurchaseFormSchema>;
export type UpdatePurchaseCommand = z.infer<typeof updatePurchaseCommandSchema>;
export type CancelPurchaseCommand = z.infer<typeof cancelPurchaseCommandSchema>;

export function toUpdateCardCommand(
  values: UpdateCardFormValues,
  cardId: string,
  commandId: string,
): UpdateCardCommand {
  return updateCardCommandSchema.parse({
    ...values,
    ...(values.defaultPaymentAccountId !== undefined
      ? {
          defaultPaymentAccountId:
            values.defaultPaymentAccountId === ""
              ? null
              : values.defaultPaymentAccountId,
        }
      : {}),
    cardId,
    commandId,
  });
}

export function toUpdateBillingRuleCommand(
  values: UpdateBillingRuleFormValues,
  cardId: string,
  commandId: string,
): UpdateBillingRuleCommand {
  return updateBillingRuleCommandSchema.parse({ ...values, cardId, commandId });
}

export function toUpdatePurchaseCommand(
  values: UpdatePurchaseFormValues,
  purchaseId: string,
  commandId: string,
): UpdatePurchaseCommand {
  return updatePurchaseCommandSchema.parse({
    ...values,
    purchaseId,
    commandId,
  });
}

export function toArchiveCardCommand(
  cardId: string,
  commandId: string,
): ArchiveCardCommand {
  return archiveCardCommandSchema.parse({ cardId, commandId });
}

export function toCancelPurchaseCommand(
  purchaseId: string,
  commandId: string,
): CancelPurchaseCommand {
  return cancelPurchaseCommandSchema.parse({ purchaseId, commandId });
}

/** Compatibility aliases matching the use-case names in the S06 tasks. */
export const createCreditCardSchema = createCardCommandSchema;
export const updateCreditCardFormSchema = updateCardFormSchema;
export const updateCreditCardCommandSchema = updateCardCommandSchema;
export const archiveCreditCardCommandSchema = archiveCardCommandSchema;
export const createCreditCardBillingRuleFormSchema = updateBillingRuleFormSchema;
export const updateCreditCardBillingRuleFormSchema = updateBillingRuleFormSchema;
export const createCreditCardBillingRuleCommandSchema =
  updateBillingRuleCommandSchema;
export const updateCreditCardBillingRuleCommandSchema =
  updateBillingRuleCommandSchema;
export const updateCreditCardPurchaseFormSchema = updatePurchaseFormSchema;
export const updateCreditCardPurchaseCommandSchema = updatePurchaseCommandSchema;
export const cancelCreditCardPurchaseCommandSchema = cancelPurchaseCommandSchema;

export const toUpdateCreditCardCommand = toUpdateCardCommand;
export const toUpdateCreditCardBillingRuleCommand = toUpdateBillingRuleCommand;
export const toUpdateCreditCardPurchaseCommand = toUpdatePurchaseCommand;
export const toArchiveCreditCardCommand = toArchiveCardCommand;
export const toCancelCreditCardPurchaseCommand = toCancelPurchaseCommand;

/**
 * Stable, non-sensitive errors that may be presented by shared components.
 * Raw exception messages are never copied into this model: adapters map their
 * domain error code to one of these messages before rendering.
 */
export const CREDIT_CARD_UI_ERROR_CODES = [
  "INVALID_COMMAND",
  "INVALID_COMMAND_ID",
  "INVALID_NAME",
  "INVALID_AMOUNT",
  "INVALID_DATE",
  "INVALID_BILLING_DAY",
  "INVALID_CLOSING_DAY",
  "INVALID_DUE_DAY",
  "INVALID_BILLING_RULE",
  "INVALID_BILLING_RULE_RANGE",
  "INVALID_BILLING_DUE_OVERRIDE",
  "BILLING_DUE_OVERRIDE_NOT_AFTER_CLOSING",
  "INVALID_BILLING_RULE_ID",
  "INVALID_INSTALLMENT_COUNT",
  "INSTALLMENT_COUNT_OUT_OF_RANGE",
  "AMOUNT_OUT_OF_RANGE",
  "DATE_IN_FUTURE",
  "TRACKING_START_DATE_VIOLATION",
  "INVALID_CARD_ID",
  "INVALID_ACCOUNT_ID",
  "CARD_NOT_FOUND",
  "CARD_ARCHIVED",
  "CARD_NOT_ACTIVE",
  "ACCOUNT_NOT_FOUND",
  "ACCOUNT_ARCHIVED",
  "ACCOUNT_NOT_CREDIT_CARD",
  "PAYMENT_ACCOUNT_NOT_FOUND",
  "PAYMENT_ACCOUNT_ARCHIVED",
  "PAYMENT_ACCOUNT_INVALID",
  "CATEGORY_NOT_FOUND",
  "BILLING_RULE_NOT_FOUND",
  "BILLING_RULE_NOT_APPLICABLE",
  "CATEGORY_ARCHIVED",
  "CATEGORY_KIND_MISMATCH",
  "BILLING_RULE_OVERLAP",
  "BILLING_RULE_CONFLICT",
  "COMMAND_ID_REUSED",
  "NON_EDITABLE_FIELD",
  "INSTALLMENT_MUTATION_FORBIDDEN",
  "PAYMENT_INSTALLMENT_FORBIDDEN",
  "CONFLICT",
  "PURCHASE_NOT_FOUND",
  "PURCHASE_ALREADY_CANCELLED",
  "PURCHASE_NOT_EDITABLE",
  "INVALID_PURCHASE_ID",
  "SCHEDULE_INVARIANT_VIOLATION",
  "RETRYABLE_ERROR",
  "UNEXPECTED_ERROR",
] as const;
export type CreditCardUiErrorCode = (typeof CREDIT_CARD_UI_ERROR_CODES)[number];

export type CreditCardUiErrorField =
  | "commandId"
  | "name"
  | "creditLimitCents"
  | "closingDay"
  | "dueDay"
  | "effectiveFrom"
  | "cardId"
  | "accountId"
  | "defaultPaymentAccountId"
  | "sourceAccountId"
  | "amountCents"
  | "occurredOn"
  | "description"
  | "categoryId"
  | "installmentCount"
  | "purchaseId";

export const CREDIT_CARD_UI_ERROR_MESSAGES: Readonly<
  Record<CreditCardUiErrorCode, string>
> = {
  INVALID_COMMAND: "Confira os dados informados.",
  INVALID_COMMAND_ID: "Não foi possível identificar esta tentativa. Tente novamente.",
  INVALID_NAME: "Informe um nome válido.",
  INVALID_AMOUNT: "Informe um valor positivo em centavos.",
  INVALID_DATE: "Informe uma data válida.",
  INVALID_BILLING_DAY: "Informe um dia entre 1 e 31.",
  INVALID_CLOSING_DAY: "Informe um dia de fechamento entre 1 e 31.",
  INVALID_DUE_DAY: "Informe um dia de vencimento entre 1 e 31.",
  INVALID_BILLING_RULE: "Informe uma regra de cobrança válida.",
  INVALID_BILLING_RULE_RANGE: "O intervalo da regra de cobrança é inválido.",
  INVALID_BILLING_DUE_OVERRIDE: "O vencimento informado é inválido.",
  BILLING_DUE_OVERRIDE_NOT_AFTER_CLOSING:
    "O vencimento deve ser posterior ao fechamento.",
  INVALID_BILLING_RULE_ID: "A regra de cobrança informada é inválida.",
  INVALID_INSTALLMENT_COUNT: `Informe entre 1 e ${MAX_INSTALLMENT_COUNT} parcelas.`,
  INSTALLMENT_COUNT_OUT_OF_RANGE: `Informe entre 1 e ${MAX_INSTALLMENT_COUNT} parcelas.`,
  AMOUNT_OUT_OF_RANGE: "O valor informado excede o limite permitido.",
  DATE_IN_FUTURE: "A data da compra não pode estar no futuro.",
  TRACKING_START_DATE_VIOLATION:
    "A data da compra precede o início do acompanhamento.",
  INVALID_CARD_ID: "Selecione um cartão válido.",
  INVALID_ACCOUNT_ID: "Selecione uma conta válida.",
  CARD_NOT_FOUND: "O cartão não foi encontrado.",
  CARD_ARCHIVED: "Este cartão está arquivado e não aceita novas operações.",
  CARD_NOT_ACTIVE: "Este cartão não está ativo para esta operação.",
  ACCOUNT_NOT_FOUND: "A conta não foi encontrada.",
  ACCOUNT_ARCHIVED: "A conta está arquivada e não pode ser usada.",
  ACCOUNT_NOT_CREDIT_CARD: "A conta informada não é um cartão.",
  PAYMENT_ACCOUNT_NOT_FOUND: "A conta de pagamento não foi encontrada.",
  PAYMENT_ACCOUNT_ARCHIVED: "A conta de pagamento está arquivada.",
  PAYMENT_ACCOUNT_INVALID: "A conta de pagamento informada não é válida.",
  CATEGORY_NOT_FOUND: "A categoria não foi encontrada.",
  CATEGORY_ARCHIVED: "A categoria está arquivada e não pode ser usada.",
  CATEGORY_KIND_MISMATCH: "A categoria precisa ser de despesa.",
  BILLING_RULE_NOT_FOUND: "A regra de cobrança não foi encontrada.",
  BILLING_RULE_NOT_APPLICABLE: "Não há regra de cobrança para esta data.",
  BILLING_RULE_OVERLAP: "As vigências das regras de cobrança não podem se sobrepor.",
  BILLING_RULE_CONFLICT: "A nova regra de cobrança entra em conflito com outra.",
  COMMAND_ID_REUSED: "Esta tentativa já foi processada. Atualize os dados antes de tentar novamente.",
  NON_EDITABLE_FIELD: "Este campo não pode ser alterado nesta operação.",
  INSTALLMENT_MUTATION_FORBIDDEN: "A parcela só pode ser alterada pela compra inteira.",
  PAYMENT_INSTALLMENT_FORBIDDEN: "O pagamento é global e não quita uma parcela isolada.",
  CONFLICT: "Os dados mudaram. Atualize a página e tente novamente.",
  PURCHASE_NOT_FOUND: "A compra não foi encontrada.",
  PURCHASE_ALREADY_CANCELLED: "A compra já foi cancelada.",
  PURCHASE_NOT_EDITABLE: "A compra não pode mais ser editada.",
  INVALID_PURCHASE_ID: "A compra informada é inválida.",
  SCHEDULE_INVARIANT_VIOLATION:
    "O schedule retornado é inválido. Tente novamente.",
  RETRYABLE_ERROR: "Não foi possível concluir agora. Tente novamente.",
  UNEXPECTED_ERROR: "Não foi possível concluir a operação. Tente novamente.",
};

export interface CreditCardUiErrorViewModel {
  code: CreditCardUiErrorCode;
  message: string;
  field?: CreditCardUiErrorField;
  retryable: boolean;
}

const ERROR_FIELDS = new Set<CreditCardUiErrorField>([
  "commandId",
  "name",
  "creditLimitCents",
  "closingDay",
  "dueDay",
  "effectiveFrom",
  "cardId",
  "accountId",
  "defaultPaymentAccountId",
  "sourceAccountId",
  "amountCents",
  "occurredOn",
  "description",
  "categoryId",
  "installmentCount",
  "purchaseId",
]);

function isCreditCardUiErrorCode(value: unknown): value is CreditCardUiErrorCode {
  return (
    typeof value === "string" &&
    CREDIT_CARD_UI_ERROR_CODES.includes(value as CreditCardUiErrorCode)
  );
}

/** Maps untrusted action failures to an allow-listed and actionable message. */
export function toCreditCardErrorViewModel(
  input: unknown,
  fallback: CreditCardUiErrorCode = "UNEXPECTED_ERROR",
): CreditCardUiErrorViewModel {
  const record = isRecord(input) ? input : {};
  const code = isCreditCardUiErrorCode(record.code) ? record.code : fallback;
  const field =
    typeof record.field === "string" &&
    ERROR_FIELDS.has(record.field as CreditCardUiErrorField)
      ? (record.field as CreditCardUiErrorField)
      : undefined;

  return {
    code,
    message: CREDIT_CARD_UI_ERROR_MESSAGES[code],
    ...(field ? { field } : {}),
    retryable: code === "RETRYABLE_ERROR" || code === "UNEXPECTED_ERROR",
  };
}

export const CREDIT_CARD_UI_STATES = [
  "idle",
  "loading",
  "empty",
  "error",
  "conflict",
  "success",
  "retry",
  "confirming",
] as const;
export type CreditCardUiState = (typeof CREDIT_CARD_UI_STATES)[number];

export interface CreditCardUiStateViewModel {
  state: CreditCardUiState;
  error: CreditCardUiErrorViewModel | null;
  successMessage: string | null;
}

export type CreditCardStatus = "ACTIVE" | "ARCHIVED";
export type InstallmentStatus = "PLANNED" | "POSTED" | "CANCELLED";
export type CreditCardStatementItemState = "PROJECTED" | "CONFIRMED";
export type CreditCardPaymentState =
  | "UNPAID"
  | "PARTIALLY_PAID"
  | "PAID"
  | "CREDIT";

export interface CreditCardOptionViewModel {
  id: string;
  accountId: string;
  name: string;
  status: CreditCardStatus;
}

export interface AccountOptionViewModel {
  id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  type?: string;
}

export interface CreditCardScheduleItemViewModel {
  id: string;
  purchaseId: string;
  installmentNumber: number;
  installmentCount: number;
  amountCents: string;
  billingCycle: string;
  dueOn: string;
  status: InstallmentStatus;
  state: CreditCardStatementItemState;
}

export interface CreditCardScheduleViewModel {
  purchaseId: string;
  totalAmountCents: string;
  installmentCount: number;
  items: readonly CreditCardScheduleItemViewModel[];
}

/**
 * Allow-listed purchase detail crossing from a server route to a client
 * island. Financial authority fields (household/event/plan IDs) are omitted;
 * the schedule is already a server projection and is never recomputed here.
 */
export interface CreditCardPurchaseDetailViewModel {
  id: string;
  cardId: string;
  amountCents: string;
  occurredOn: string;
  description: string;
  categoryId: string | null;
  installmentCount: number;
  status: "ACTIVE" | "CANCELLED";
  schedule: CreditCardScheduleViewModel;
}

export interface CreditCardStatementItemViewModel {
  referenceId: string;
  purchaseId: string;
  installmentId: string | null;
  description: string;
  amountCents: string;
  occurredOn: string;
  billingCycle: string;
  dueOn: string;
  installmentNumber: number | null;
  installmentCount: number | null;
  state: CreditCardStatementItemState;
}

export interface CreditCardStatementViewModel {
  period: string;
  kind: "CURRENT" | "FUTURE";
  dueOn: string | null;
  totalAmountCents: string;
  items: readonly CreditCardStatementItemViewModel[];
}

export interface CreditCardProjectionSummaryViewModel {
  currentStatementAmountCents: string;
  projectedStatementAmountCents: string;
  outstandingCardObligationCents: string;
  committedCreditLimitCents: string;
  availableCreditLimitCents: string;
  cardCreditBalanceCents: string;
  asOf: string;
}

export interface CreditCardPaymentStatusViewModel {
  state: CreditCardPaymentState;
  statementAmountCents: string;
  paidAmountCents: string;
  remainingAmountCents: string;
  creditAmountCents: string;
}

const nonNegativeCentsReadSchema = z.string().regex(
  /^(?:0|[1-9]\d*)$/u,
  "centavos serializados inválidos",
);
const billingCycleReadSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u);

/** Server-provided schedule/read models remain strict and JSON-compatible. */
export const creditCardScheduleItemSchema = z
  .object({
    id: resourceIdSchema,
    purchaseId: resourceIdSchema,
    installmentNumber: z.number().int().min(1).max(MAX_INSTALLMENT_COUNT),
    installmentCount: installmentCountSchema,
    amountCents: nonNegativeCentsReadSchema,
    billingCycle: billingCycleReadSchema,
    dueOn: isoDateSchema,
    status: z.enum(["PLANNED", "POSTED", "CANCELLED"]),
    state: z.enum(["PROJECTED", "CONFIRMED"]),
  })
  .strict();

export const creditCardScheduleSchema = z
  .object({
    purchaseId: resourceIdSchema,
    totalAmountCents: nonNegativeCentsReadSchema,
    installmentCount: installmentCountSchema,
    items: z.array(creditCardScheduleItemSchema),
  })
  .strict();

/** Strict read contract for aggregate detail; no persisted authority leaks. */
export const creditCardPurchaseDetailSchema = z
  .object({
    id: resourceIdSchema,
    cardId: resourceIdSchema,
    amountCents: nonNegativeCentsReadSchema,
    occurredOn: isoDateSchema,
    description: descriptionSchema,
    categoryId: resourceIdSchema.nullable(),
    installmentCount: installmentCountSchema,
    status: z.enum(["ACTIVE", "CANCELLED"]),
    schedule: creditCardScheduleSchema,
  })
  .strict();

export const creditCardStatementItemSchema = z
  .object({
    referenceId: resourceIdSchema,
    purchaseId: resourceIdSchema,
    installmentId: resourceIdSchema.nullable(),
    description: descriptionSchema,
    amountCents: nonNegativeCentsReadSchema,
    occurredOn: isoDateSchema,
    billingCycle: billingCycleReadSchema,
    dueOn: isoDateSchema,
    installmentNumber: z.number().int().min(1).max(MAX_INSTALLMENT_COUNT).nullable(),
    installmentCount: installmentCountSchema.nullable(),
    state: z.enum(["PROJECTED", "CONFIRMED"]),
  })
  .strict();

export const creditCardStatementSchema = z
  .object({
    period: billingCycleReadSchema,
    kind: z.enum(["CURRENT", "FUTURE"]),
    dueOn: isoDateSchema.nullable(),
    totalAmountCents: nonNegativeCentsReadSchema,
    items: z.array(creditCardStatementItemSchema),
  })
  .strict();

export const creditCardProjectionSummarySchema = z
  .object({
    currentStatementAmountCents: nonNegativeCentsReadSchema,
    projectedStatementAmountCents: nonNegativeCentsReadSchema,
    outstandingCardObligationCents: nonNegativeCentsReadSchema,
    committedCreditLimitCents: nonNegativeCentsReadSchema,
    availableCreditLimitCents: nonNegativeCentsReadSchema,
    cardCreditBalanceCents: nonNegativeCentsReadSchema,
    asOf: isoDateSchema,
  })
  .strict();

export const creditCardPaymentStatusSchema = z
  .object({
    state: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID", "CREDIT"]),
    statementAmountCents: nonNegativeCentsReadSchema,
    paidAmountCents: nonNegativeCentsReadSchema,
    remainingAmountCents: nonNegativeCentsReadSchema,
    creditAmountCents: nonNegativeCentsReadSchema,
  })
  .strict();

/** Parse helpers keep the server/client boundary strict and serializable. */
export function parseCreditCardSchedule(
  input: unknown,
): CreditCardScheduleViewModel {
  return creditCardScheduleSchema.parse(input);
}

export function parseCreditCardPurchaseDetail(
  input: unknown,
): CreditCardPurchaseDetailViewModel {
  return creditCardPurchaseDetailSchema.parse(input);
}

export function parseCreditCardStatement(
  input: unknown,
): CreditCardStatementViewModel {
  return creditCardStatementSchema.parse(input);
}

export function parseCreditCardProjectionSummary(
  input: unknown,
): CreditCardProjectionSummaryViewModel {
  return creditCardProjectionSummarySchema.parse(input);
}

export function parseCreditCardPaymentStatus(
  input: unknown,
): CreditCardPaymentStatusViewModel {
  return creditCardPaymentStatusSchema.parse(input);
}

export function safeParseCreditCardSchedule(input: unknown) {
  return creditCardScheduleSchema.safeParse(input);
}

export function safeParseCreditCardPurchaseDetail(input: unknown) {
  return creditCardPurchaseDetailSchema.safeParse(input);
}

export function safeParseCreditCardStatement(input: unknown) {
  return creditCardStatementSchema.safeParse(input);
}

export function safeParseCreditCardProjectionSummary(input: unknown) {
  return creditCardProjectionSummarySchema.safeParse(input);
}

export function safeParseCreditCardPaymentStatus(input: unknown) {
  return creditCardPaymentStatusSchema.safeParse(input);
}

/** Canonical route helpers carry only opaque resource IDs and period filters. */
export const CREDIT_CARD_ROUTES = {
  collection: "/credit-cards",
  create: "/credit-cards/new",
} as const;

export interface CreditCardPeriodFilter {
  from?: string;
  to?: string;
  cycle?: string;
}

function isValidBillingCycle(value: string): boolean {
  return /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value);
}

function readSearchParam(
  input: URLSearchParams | Record<string, unknown>,
  key: string,
): string | undefined {
  if (input instanceof URLSearchParams) {
    return input.get(key) ?? undefined;
  }
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

/** Drops unknown/financial keys instead of copying them into a URL. */
export function parseCreditCardPeriodFilter(
  input: URLSearchParams | Record<string, unknown>,
): CreditCardPeriodFilter {
  const from = readSearchParam(input, "from");
  const to = readSearchParam(input, "to");
  const cycle = readSearchParam(input, "cycle");
  return {
    ...(from && isValidIsoDate(from) ? { from } : {}),
    ...(to && isValidIsoDate(to) ? { to } : {}),
    ...(cycle && isValidBillingCycle(cycle) ? { cycle } : {}),
  };
}

export function encodeCreditCardPeriodFilter(
  filter: CreditCardPeriodFilter = {},
): string {
  const params = new URLSearchParams();
  if (filter.from && isValidIsoDate(filter.from)) params.set("from", filter.from);
  if (filter.to && isValidIsoDate(filter.to)) params.set("to", filter.to);
  if (filter.cycle && isValidBillingCycle(filter.cycle)) {
    params.set("cycle", filter.cycle);
  }
  return params.toString();
}

export function creditCardHref(cardId: string): string {
  return isUuidV7(cardId)
    ? `${CREDIT_CARD_ROUTES.collection}/${encodeURIComponent(cardId)}`
    : CREDIT_CARD_ROUTES.collection;
}

export function creditCardPurchaseHref(
  cardId: string,
  purchaseId: string,
): string {
  if (!isUuidV7(cardId) || !isUuidV7(purchaseId)) return creditCardHref(cardId);
  return `${creditCardHref(cardId)}/purchases/${encodeURIComponent(purchaseId)}`;
}

export function creditCardPeriodHref(
  cardId: string,
  filter: CreditCardPeriodFilter = {},
): string {
  const href = creditCardHref(cardId);
  const query = encodeCreditCardPeriodFilter(filter);
  return query ? `${href}?${query}` : href;
}

export const getCreditCardHref = creditCardHref;
export const getCreditCardPurchaseHref = creditCardPurchaseHref;
export const getCreditCardPeriodHref = creditCardPeriodHref;
export const parseCreditCardFilters = parseCreditCardPeriodFilter;
export const encodeCreditCardFilters = encodeCreditCardPeriodFilter;
