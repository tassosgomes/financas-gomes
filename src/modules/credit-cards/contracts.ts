/**
 * Public, database-independent contracts for the S06 credit-card CRUD.
 *
 * Commands deliberately contain only serializable values.  The household,
 * account type, status and authorization are resolved by the server and are
 * therefore represented only by the read-side/reference contracts below.
 */

export const CREDIT_CARD_ACCOUNT_TYPE = "CREDIT_CARD" as const;
export type CreditCardAccountType = typeof CREDIT_CARD_ACCOUNT_TYPE;

export const CREDIT_CARD_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type CreditCardStatus = (typeof CREDIT_CARD_STATUSES)[number];
export const CREDIT_CARD_STATUS_VALUES = CREDIT_CARD_STATUSES;

export const CREDIT_CARD_STATUS_FILTERS = ["ACTIVE", "ARCHIVED", "ALL"] as const;
export type CreditCardStatusFilter = (typeof CREDIT_CARD_STATUS_FILTERS)[number];
export const CREDIT_CARD_STATUS_FILTER_VALUES = CREDIT_CARD_STATUS_FILTERS;

export const CREDIT_CARD_COMMAND_OPERATIONS = [
  "credit_card.create",
  "credit_card.update",
  "credit_card.archive",
  "credit_card.billing_rule.create",
  "credit_card.billing_rule.update",
  "credit_card.purchase.create",
  "credit_card.purchase.update_metadata",
  "credit_card.purchase.cancel",
  "credit_card.payment.create",
] as const;
export type CreditCardCommandOperation =
  (typeof CREDIT_CARD_COMMAND_OPERATIONS)[number];

export const CREATE_CREDIT_CARD_OPERATION = "credit_card.create" as const;
export const UPDATE_CREDIT_CARD_OPERATION = "credit_card.update" as const;
export const ARCHIVE_CREDIT_CARD_OPERATION = "credit_card.archive" as const;
export const CREATE_CREDIT_CARD_BILLING_RULE_OPERATION =
  "credit_card.billing_rule.create" as const;
export const UPDATE_CREDIT_CARD_BILLING_RULE_OPERATION =
  "credit_card.billing_rule.update" as const;
export const CREATE_CREDIT_CARD_PURCHASE_OPERATION =
  "credit_card.purchase.create" as const;
export const UPDATE_CREDIT_CARD_PURCHASE_OPERATION =
  "credit_card.purchase.update_metadata" as const;
export const CANCEL_CREDIT_CARD_PURCHASE_OPERATION =
  "credit_card.purchase.cancel" as const;
export const CREATE_CREDIT_CARD_PAYMENT_OPERATION =
  "credit_card.payment.create" as const;
/** Naming aliases used by payment adapters and command handlers. */
export const REGISTER_CREDIT_CARD_PAYMENT_OPERATION =
  CREATE_CREDIT_CARD_PAYMENT_OPERATION;

export const CREDIT_CARD_NAME_MAX_LENGTH = 120;
export const CREDIT_CARD_COMMAND_ID_MAX_LENGTH = 128;
export const CREDIT_CARD_MAX_CENTS = "9223372036854775807";
export const MIN_CREDIT_CARD_BILLING_DAY = 1;
export const MAX_CREDIT_CARD_BILLING_DAY = 31;
export const CREDIT_CARD_PURCHASE_DESCRIPTION_MAX_LENGTH = 240;
export const MIN_CREDIT_CARD_INSTALLMENT_COUNT = 1;
export const MAX_CREDIT_CARD_INSTALLMENT_COUNT = 120;

/**
 * The create command provisions the ledger account and its one-to-one card
 * configuration atomically. `effectiveFrom` is optional because the server
 * may use its business date when the caller does not provide one.
 */
export interface CreateCreditCardCommand {
  commandId: string;
  name: string;
  creditLimitCents: string;
  closingDay: number;
  dueDay: number;
  defaultPaymentAccountId?: string | null;
  effectiveFrom?: string;
}

/** Card metadata/configuration update; it never changes a billing snapshot. */
export interface UpdateCreditCardCommand {
  commandId: string;
  cardId: string;
  name?: string;
  creditLimitCents?: string;
  defaultPaymentAccountId?: string | null;
}

/**
 * Billing changes are a new version, rather than an overwrite of a rule used
 * by an existing purchase.  The caller supplies only the new effective date
 * and civil days; overlap/ordering is checked against server-loaded rules.
 */
export interface UpdateCreditCardBillingRuleCommand {
  commandId: string;
  cardId: string;
  closingDay: number;
  dueDay: number;
  effectiveFrom: string;
}

/** Archive is a reversible-looking UI action but not a hard delete. */
export interface ArchiveCreditCardCommand {
  commandId: string;
  cardId: string;
}

/** Purchase commands contain only user-entered serializable facts. */
export interface CreateCreditCardPurchaseCommand {
  commandId: string;
  cardId: string;
  amountCents: string;
  occurredOn: string;
  description: string;
  categoryId?: string | null;
  installmentCount: number;
  billingDueOnOverride?: string;
}

export type CreatePurchaseCommand = CreateCreditCardPurchaseCommand;

/** Metadata-only aggregate update; financial facts and schedule are immutable. */
export interface UpdateCreditCardPurchaseCommand {
  commandId: string;
  purchaseId: string;
  description?: string;
  categoryId?: string | null;
}

export type UpdatePurchaseCommand = UpdateCreditCardPurchaseCommand;

/** Cancellation always targets the whole purchase aggregate. */
export interface CancelCreditCardPurchaseCommand {
  commandId: string;
  purchaseId: string;
}

export type CancelPurchaseCommand = CancelCreditCardPurchaseCommand;

/** Read-only aggregate query; household authorization remains server-owned. */
export interface GetCreditCardPurchaseQuery {
  purchaseId: string;
}

/**
 * A card payment is a global transfer.  The command deliberately has no
 * statement/ installment target, tenant, status or ledger sign; those values
 * are derived by the server from the authenticated household and card.
 */
export interface RegisterCreditCardPaymentCommand {
  commandId: string;
  cardId: string;
  sourceAccountId: string;
  amountCents: string;
  occurredOn: string;
  description?: string;
}

export type CreateCreditCardPaymentCommand = RegisterCreditCardPaymentCommand;
export type CreatePaymentCommand = RegisterCreditCardPaymentCommand;
export type CreditCardPaymentCommand = RegisterCreditCardPaymentCommand;
export type RegisterPaymentCommand = RegisterCreditCardPaymentCommand;

export interface CreditCardPaymentEntryReadModel {
  id: string;
  financialEventId: string;
  householdId: string;
  accountId: string;
  amountCents: string;
  status: "POSTED";
  installmentId: null;
  expectedOn: null;
  postedOn: string;
}

/** Serializable result of the one-event/two-entry payment transfer. */
export interface CreditCardPaymentReadModel {
  id: string;
  paymentId: string;
  financialEventId: string;
  householdId: string;
  cardId: string;
  creditCardAccountId: string;
  sourceAccountId: string;
  kind: "TRANSFER";
  origin: "MANUAL";
  status: "POSTED";
  amountCents: string;
  occurredOn: string;
  description: string;
  entries: readonly [
    CreditCardPaymentEntryReadModel,
    CreditCardPaymentEntryReadModel,
  ];
}

export interface CreditCardInstallmentReadModel {
  id: string;
  planId: string;
  purchaseId: string;
  sequence: number;
  amountCents: string;
  status: "PLANNED" | "POSTED" | "CANCELLED";
  billingRuleId: string;
  billingCycle: string;
  cycle: string;
  competence: string;
  billingClosingDay: number;
  billingDueDay: number;
  billingClosingOn: string;
  billingDueOn: string;
  billingDueOnOverride: string | null;
  billingSnapshot: {
    billingRuleId: string | null;
    billingCycle: string;
    cycle: string;
    competence: string;
    closingOn: string;
    dueOn: string;
    closingDay: number;
    dueDay: number;
    billingDueOnOverride: string | null;
    dueDateSource: "RULE" | "OVERRIDE";
  };
  entryId: string;
  entryStatus: "EXPECTED" | "POSTED";
}

export interface CreditCardPurchaseReadModel {
  id: string;
  householdId: string;
  cardId: string;
  financialEventId: string;
  installmentPlanId: string;
  amountCents: string;
  occurredOn: string;
  description: string;
  categoryId: string | null;
  installmentCount: number;
  status?: "ACTIVE" | "CANCELLED";
  installments: readonly CreditCardInstallmentReadModel[];
  schedule: {
    id: string;
    planId: string;
    purchaseId: string;
    totalAmountCents: string;
    installmentCount: number;
    status: "ACTIVE" | "CANCELLED";
    installments: readonly CreditCardInstallmentReadModel[];
  };
}

/** State shown for a schedule row; payment never mutates this state. */
export type CreditCardProjectionItemState = "PROJECTED" | "CONFIRMED";
export type CreditCardProjectionPaymentState =
  | "UNPAID"
  | "PARTIALLY_PAID"
  | "PAID"
  | "CREDIT";

/** One canonical invoice line, sourced only from an active installment. */
export interface CreditCardStatementItemReadModel {
  /** Stable drill-down key; S07 can consume it without knowing the table. */
  referenceId: string;
  purchaseId: string;
  installmentId: string;
  financialEventId: string;
  cardId: string;
  description: string;
  amountCents: string;
  occurredOn: string;
  billingCycle: string;
  dueOn: string;
  installmentNumber: number;
  installmentCount: number;
  installmentStatus: "PLANNED" | "POSTED" | "CANCELLED";
  entryStatus: "EXPECTED" | "POSTED";
  state: CreditCardProjectionItemState;
  origin: "PURCHASE";
}

export interface CreditCardStatementPaymentReadModel {
  state: CreditCardProjectionPaymentState;
  statementAmountCents: string;
  paidAmountCents: string;
  remainingAmountCents: string;
  creditAmountCents: string;
}

/** A non-persisted invoice projection for one billing competence. */
export interface CreditCardStatementReadModel {
  householdId: string;
  cardId: string;
  period: string;
  kind: "CURRENT" | "FUTURE";
  dueOn: string | null;
  totalAmountCents: string;
  items: readonly CreditCardStatementItemReadModel[];
  payment: CreditCardStatementPaymentReadModel;
}

/** The six distinct card concepts consumed by T11/T14 and S07. */
export interface CreditCardProjectionSummaryReadModel {
  householdId: string;
  cardId: string;
  asOf: string;
  currentPeriod: string;
  nextPeriod: string | null;
  currentStatementAmountCents: string;
  projectedStatementAmountCents: string;
  nextStatementAmountCents: string;
  remainingFutureInstallmentsCents: string;
  contractualObligationCents: string;
  outstandingCardObligationCents: string;
  committedCreditLimitCents: string;
  availableCreditLimitCents: string;
  currentPostedCardPositionCents: string;
  cardNetPositionCents: string;
  cardCreditBalanceCents: string;
  paymentState: CreditCardProjectionPaymentState;
  totalPaidAmountCents: string;
}

/** Combined read shape avoids forcing clients to reconstruct projections. */
export interface CreditCardProjectionReadModel {
  householdId: string;
  cardId: string;
  asOf: string;
  summary: CreditCardProjectionSummaryReadModel;
  current: CreditCardStatementReadModel;
  next: CreditCardStatementReadModel | null;
  statements: readonly CreditCardStatementReadModel[];
}

/** Query input contains only resource/filter dates; household is server-owned. */
export interface CreditCardProjectionQuery {
  cardId: string;
  period?: string;
  from?: string;
  to?: string;
  asOf?: string;
}

/** Compatibility names used by the existing UI contracts and future actions. */
export type CreateCardCommand = CreateCreditCardCommand;
export type UpdateCardCommand = UpdateCreditCardCommand;
export type ArchiveCardCommand = ArchiveCreditCardCommand;
export type CreateCreditCardBillingRuleCommand =
  UpdateCreditCardBillingRuleCommand;
export type CreditCardBillingRuleCommand = UpdateCreditCardBillingRuleCommand;

export interface ListCreditCardsQuery {
  status?: CreditCardStatusFilter;
}

export interface GetCreditCardQuery {
  cardId: string;
}

/** Civil, versioned rule returned by card reads and consumed by T06/T07. */
export interface CreditCardBillingRuleReadModel {
  id: string;
  cardId: string;
  closingDay: number;
  dueDay: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

export type BillingRuleReadModel = CreditCardBillingRuleReadModel;

/**
 * A card read never needs a persisted statement.  Billing history is exposed
 * as rules so old installment snapshots remain explainable after an update.
 */
export interface CreditCardReadModel {
  id: string;
  householdId: string;
  accountId: string;
  name: string;
  type: CreditCardAccountType;
  status: CreditCardStatus;
  creditLimitCents: string;
  defaultPaymentAccountId: string | null;
  activeBillingRule: CreditCardBillingRuleReadModel | null;
  billingRules: readonly CreditCardBillingRuleReadModel[];
}

export type CreditCard = CreditCardReadModel;

export interface ListCreditCardsReadModel {
  items: readonly CreditCardReadModel[];
}

export type CreditCardsReadModel = ListCreditCardsReadModel;

/** Minimal server-loaded reference used by pure tenant/status guards. */
export interface CreditCardReference {
  id: string;
  householdId: string;
  accountId: string;
  status: CreditCardStatus;
  type?: CreditCardAccountType | string;
}

export interface AccountReference {
  id: string;
  householdId: string;
  status: "ACTIVE" | "ARCHIVED";
  type: string;
}

export type PaymentAccountReference = AccountReference;

export interface CreditCardReferenceValidationInput {
  card: CreditCardReference | null | undefined;
  householdId: string;
  /** Set when the loaded account row is available to verify specialization. */
  account?: AccountReference | null;
}

export interface DefaultPaymentAccountValidationInput {
  householdId: string;
  cardAccountId?: string | null;
  defaultPaymentAccountId?: string | null;
  account?: PaymentAccountReference | null;
}

export interface BillingRuleVersionValidationInput {
  cardId: string;
  householdId?: string;
  closingDay: number;
  dueDay: number;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  existingRules?: readonly CreditCardBillingRuleReadModel[];
}

/** Fields that can never be changed through a card CRUD command. */
export const NON_EDITABLE_CREDIT_CARD_FIELDS = [
  "id",
  "householdId",
  "accountId",
  "type",
  "status",
  "createdAt",
  "updatedAt",
  "balance",
  "statementId",
  "installmentId",
  "amountCents",
  "cardId",
  "occurredOn",
  "installmentCount",
  "billingCycle",
  "billingDueOn",
  "entries",
] as const;
export type NonEditableCreditCardField =
  (typeof NON_EDITABLE_CREDIT_CARD_FIELDS)[number];

/**
 * Stable expected errors.  The aliases are retained for adapters that use
 * `creditCard*` terminology; all are mapped to safe, non-database messages.
 */
export const CREDIT_CARD_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INVALID_COMMAND",
  "INVALID_COMMAND_ID",
  "INVALID_NAME",
  "INVALID_AMOUNT",
  "INVALID_DATE",
  "INVALID_BILLING_DAY",
  "INVALID_CLOSING_DAY",
  "INVALID_DUE_DAY",
  "INVALID_ACCOUNT_ID",
  "INVALID_CARD_ID",
  "INVALID_CREDIT_CARD_ID",
  "INVALID_BILLING_RULE_ID",
  "INVALID_BILLING_RULE",
  "INVALID_BILLING_RULE_RANGE",
  "INVALID_BILLING_DUE_OVERRIDE",
  "BILLING_DUE_OVERRIDE_NOT_AFTER_CLOSING",
  "INVALID_STATUS_FILTER",
  "INVALID_DESCRIPTION",
  "INVALID_INSTALLMENT_COUNT",
  "INSTALLMENT_COUNT_OUT_OF_RANGE",
  "INVALID_STATEMENT_PERIOD",
  "INVALID_PROJECTION_QUERY",
  "AMOUNT_OUT_OF_RANGE",
  "DATE_IN_FUTURE",
  "TRACKING_START_DATE_VIOLATION",
  "ACCOUNT_NOT_FOUND",
  "ACCOUNT_ARCHIVED",
  "ACCOUNT_NOT_CREDIT_CARD",
  "CATEGORY_NOT_FOUND",
  "CATEGORY_ARCHIVED",
  "CATEGORY_KIND_MISMATCH",
  "PAYMENT_ACCOUNT_NOT_FOUND",
  "PAYMENT_ACCOUNT_ARCHIVED",
  "PAYMENT_ACCOUNT_INVALID",
  "CARD_NOT_FOUND",
  "CREDIT_CARD_NOT_FOUND",
  "CARD_ARCHIVED",
  "CREDIT_CARD_ARCHIVED",
  "CARD_NOT_ACTIVE",
  "CREDIT_CARD_INVALID",
  "CREDIT_CARD_NAME_CONFLICT",
  "CARD_NAME_CONFLICT",
  "BILLING_RULE_NOT_FOUND",
  "BILLING_RULE_NOT_APPLICABLE",
  "BILLING_RULE_OVERLAP",
  "BILLING_RULE_CONFLICT",
  "RESOURCE_ARCHIVED",
  "COMMAND_ID_REUSED",
  "NON_EDITABLE_FIELD",
  "CONFLICT",
  "PURCHASE_NOT_FOUND",
  "PURCHASE_ALREADY_CANCELLED",
  "PURCHASE_NOT_EDITABLE",
  "INVALID_PURCHASE_ID",
  "SCHEDULE_INVARIANT_VIOLATION",
] as const;

export type CreditCardErrorCode = (typeof CREDIT_CARD_ERROR_CODES)[number];
export type CardErrorCode = CreditCardErrorCode;

export type CreditCardErrorField =
  | "commandId"
  | "name"
  | "description"
  | "creditLimitCents"
  | "amountCents"
  | "occurredOn"
  | "installmentCount"
  | "period"
  | "asOf"
  | "from"
  | "to"
  | "categoryId"
  | "closingDay"
  | "dueDay"
  | "effectiveFrom"
  | "effectiveUntil"
  | "cardId"
  | "purchaseId"
  | "accountId"
  | "sourceAccountId"
  | "defaultPaymentAccountId"
  | "status";

export interface CreditCardError {
  code: CreditCardErrorCode;
  message: string;
  field?: CreditCardErrorField;
}

export type CreditCardResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CreditCardError };

export type CardResult<T> = CreditCardResult<T>;

export const CREDIT_CARD_ERROR_MESSAGES: Readonly<
  Record<CreditCardErrorCode, string>
> = {
  UNAUTHENTICATED: "É necessário entrar para acessar este recurso.",
  INVALID_COMMAND: "Os dados da operação são inválidos.",
  INVALID_COMMAND_ID: "O identificador da operação é inválido.",
  INVALID_NAME: "Informe um nome entre 1 e 120 caracteres válidos.",
  INVALID_AMOUNT: "Informe um valor inteiro positivo em centavos.",
  INVALID_DATE: "Informe uma data válida no formato AAAA-MM-DD.",
  INVALID_BILLING_DAY: "Informe um dia de billing entre 1 e 31.",
  INVALID_CLOSING_DAY: "Informe um dia de fechamento entre 1 e 31.",
  INVALID_DUE_DAY: "Informe um dia de vencimento entre 1 e 31.",
  INVALID_ACCOUNT_ID: "A conta de pagamento informada é inválida.",
  INVALID_CARD_ID: "O cartão informado é inválido.",
  INVALID_CREDIT_CARD_ID: "O cartão informado é inválido.",
  INVALID_BILLING_RULE_ID: "A regra de billing informada é inválida.",
  INVALID_BILLING_RULE: "A regra de billing informada é inválida.",
  INVALID_BILLING_RULE_RANGE: "O intervalo da regra de billing é inválido.",
  INVALID_BILLING_DUE_OVERRIDE: "O vencimento informado é inválido.",
  BILLING_DUE_OVERRIDE_NOT_AFTER_CLOSING:
    "O vencimento deve ser posterior ao fechamento.",
  INVALID_STATUS_FILTER: "O filtro de status informado é inválido.",
  INVALID_DESCRIPTION: "Informe uma descrição entre 1 e 240 caracteres válidos.",
  INVALID_INSTALLMENT_COUNT: "A quantidade de parcelas deve ser um inteiro positivo.",
  INSTALLMENT_COUNT_OUT_OF_RANGE: "A quantidade de parcelas excede o limite permitido.",
  INVALID_STATEMENT_PERIOD: "Informe uma competência válida no formato AAAA-MM.",
  INVALID_PROJECTION_QUERY: "Os filtros da projeção são inválidos.",
  AMOUNT_OUT_OF_RANGE: "O valor excede o limite suportado.",
  DATE_IN_FUTURE: "A data da compra não pode estar no futuro.",
  TRACKING_START_DATE_VIOLATION: "A data da compra não pode preceder o início do acompanhamento.",
  ACCOUNT_NOT_FOUND: "A conta não foi encontrada.",
  ACCOUNT_ARCHIVED: "A conta está arquivada e não pode ser usada.",
  ACCOUNT_NOT_CREDIT_CARD: "A conta informada não é uma conta de cartão.",
  CATEGORY_NOT_FOUND: "A categoria não foi encontrada.",
  CATEGORY_ARCHIVED: "A categoria está arquivada e não pode ser usada.",
  CATEGORY_KIND_MISMATCH: "A categoria precisa ser de despesa.",
  PAYMENT_ACCOUNT_NOT_FOUND: "A conta de pagamento não foi encontrada.",
  PAYMENT_ACCOUNT_ARCHIVED:
    "A conta de pagamento está arquivada e não pode ser usada.",
  PAYMENT_ACCOUNT_INVALID: "A conta de pagamento informada não é válida.",
  CARD_NOT_FOUND: "O cartão não foi encontrado.",
  CREDIT_CARD_NOT_FOUND: "O cartão não foi encontrado.",
  CARD_ARCHIVED: "O cartão está arquivado e não aceita novas operações.",
  CREDIT_CARD_ARCHIVED:
    "O cartão está arquivado e não aceita novas operações.",
  CARD_NOT_ACTIVE: "O cartão não está ativo para esta operação.",
  CREDIT_CARD_INVALID: "A configuração do cartão é inválida.",
  CREDIT_CARD_NAME_CONFLICT: "Já existe um cartão com este nome.",
  CARD_NAME_CONFLICT: "Já existe um cartão com este nome.",
  BILLING_RULE_NOT_FOUND: "A regra de billing não foi encontrada.",
  BILLING_RULE_NOT_APPLICABLE:
    "Não há regra de billing vigente para a data informada.",
  BILLING_RULE_OVERLAP:
    "As vigências das regras de billing não podem se sobrepor.",
  BILLING_RULE_CONFLICT:
    "A nova regra de billing entra em conflito com uma vigência existente.",
  RESOURCE_ARCHIVED: "O cartão está arquivado e não pode ser editado.",
  COMMAND_ID_REUSED: "O identificador da operação já foi utilizado.",
  NON_EDITABLE_FIELD: "Este campo não pode ser alterado nesta operação.",
  CONFLICT: "Os dados mudaram. Atualize a página e tente novamente.",
  PURCHASE_NOT_FOUND: "A compra não foi encontrada.",
  PURCHASE_ALREADY_CANCELLED: "A compra já foi cancelada.",
  PURCHASE_NOT_EDITABLE: "A compra não pode mais ser editada.",
  INVALID_PURCHASE_ID: "A compra informada é inválida.",
  SCHEDULE_INVARIANT_VIOLATION: "O schedule da compra é inválido.",
};

function statusForCreditCardError(code: CreditCardErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "CARD_NOT_FOUND":
    case "CREDIT_CARD_NOT_FOUND":
    case "ACCOUNT_NOT_FOUND":
    case "PAYMENT_ACCOUNT_NOT_FOUND":
    case "BILLING_RULE_NOT_FOUND":
    case "PURCHASE_NOT_FOUND":
    case "INVALID_PURCHASE_ID":
    case "CATEGORY_NOT_FOUND":
      return 404;
    case "ACCOUNT_ARCHIVED":
    case "PAYMENT_ACCOUNT_ARCHIVED":
    case "CARD_ARCHIVED":
    case "CREDIT_CARD_ARCHIVED":
    case "CARD_NOT_ACTIVE":
    case "CREDIT_CARD_NAME_CONFLICT":
    case "CARD_NAME_CONFLICT":
    case "BILLING_RULE_OVERLAP":
    case "BILLING_RULE_CONFLICT":
    case "RESOURCE_ARCHIVED":
    case "COMMAND_ID_REUSED":
    case "NON_EDITABLE_FIELD":
    case "CONFLICT":
    case "PURCHASE_ALREADY_CANCELLED":
    case "PURCHASE_NOT_EDITABLE":
      return 409;
    default:
      return 400;
  }
}

/** Safe expected error used by pure validation and by future use cases. */
export class CreditCardDomainError extends Error {
  readonly code: CreditCardErrorCode;
  readonly field: CreditCardErrorField | undefined;
  readonly status: number;
  readonly expected = true;

  constructor(code: CreditCardErrorCode, field?: CreditCardErrorField) {
    super(CREDIT_CARD_ERROR_MESSAGES[code]);
    this.name = "CreditCardDomainError";
    this.code = code;
    this.field = field;
    this.status = statusForCreditCardError(code);
  }

  toError(): CreditCardError {
    return {
      code: this.code,
      message: this.message,
      ...(this.field ? { field: this.field } : {}),
    };
  }
}

export const CardDomainError = CreditCardDomainError;
export const CreditCardError = CreditCardDomainError;
export const CreditCardValidationError = CreditCardDomainError;
export const DomainValidationError = CreditCardDomainError;

export function ok<T>(value: T): CreditCardResult<T> {
  return { ok: true, value };
}

export function failure<T = never>(
  code: CreditCardErrorCode,
  field?: CreditCardErrorField,
): CreditCardResult<T> {
  return {
    ok: false,
    error: new CreditCardDomainError(code, field).toError(),
  };
}

export const success = ok;
export const errorResult = failure;
