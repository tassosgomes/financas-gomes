/**
 * Public contracts for the S03 manual transaction domain.
 *
 * Commands intentionally contain only serializable values. Tenant, status,
 * origin and ledger signs are derived by the server from the authenticated
 * household and are not accepted as client authority.
 */

import type {
  AccountReadModel,
  CategoryReadModel,
} from "@/modules/accounts-categories/contracts";

export const MANUAL_TRANSACTION_KINDS = ["EXPENSE", "INCOME"] as const;
export type ManualTransactionKind = (typeof MANUAL_TRANSACTION_KINDS)[number];
export const TRANSACTION_KINDS = MANUAL_TRANSACTION_KINDS;
export type TransactionKind = ManualTransactionKind;

/** Financial events include the compensating event produced by cancellation. */
export const FINANCIAL_EVENT_KINDS = [
  "EXPENSE",
  "INCOME",
  "REVERSAL",
] as const;
export type FinancialEventKind = (typeof FINANCIAL_EVENT_KINDS)[number];

export const FINANCIAL_EVENT_STATUSES = ["POSTED", "CANCELLED"] as const;
export type FinancialEventStatus =
  (typeof FINANCIAL_EVENT_STATUSES)[number];
export const TRANSACTION_STATUSES = FINANCIAL_EVENT_STATUSES;
export type TransactionStatus = FinancialEventStatus;

/** Origins persisted by the ledger, including the S04 import specialization. */
export const FINANCIAL_EVENT_ORIGINS = ["MANUAL", "SYSTEM", "IMPORT"] as const;
export type FinancialEventOrigin = (typeof FINANCIAL_EVENT_ORIGINS)[number];
export const TRANSACTION_ORIGINS = FINANCIAL_EVENT_ORIGINS;
export type TransactionOrigin = FinancialEventOrigin;

export const MANUAL_TRANSACTION_ORIGIN = "MANUAL" as const;
export const SYSTEM_REVERSAL_ORIGIN = "SYSTEM" as const;
export const REVERSAL_EVENT_KIND = "REVERSAL" as const;

export const ACCOUNT_ENTRY_STATUSES = ["POSTED"] as const;
export type AccountEntryStatus = (typeof ACCOUNT_ENTRY_STATUSES)[number];

export const TRANSACTION_OPERATIONS = [
  "transactions.create.expense",
  "transactions.create.income",
  "transactions.update.manual",
  "transactions.cancel.manual",
] as const;
export type TransactionOperation = (typeof TRANSACTION_OPERATIONS)[number];
export const CREATE_EXPENSE_OPERATION = "transactions.create.expense" as const;
export const CREATE_INCOME_OPERATION = "transactions.create.income" as const;
export const UPDATE_MANUAL_TRANSACTION_OPERATION =
  "transactions.update.manual" as const;
export const CANCEL_MANUAL_TRANSACTION_OPERATION =
  "transactions.cancel.manual" as const;

export const MANUAL_TRANSACTION_DESCRIPTION_MAX_LENGTH = 240;
export const TRANSACTION_COMMAND_ID_MAX_LENGTH = 128;

/** The amount remains a decimal string until it enters the domain. */
export interface CreateManualTransactionCommand {
  commandId: string;
  amountCents: string;
  occurredOn: string;
  description: string;
  accountId: string;
  categoryId?: string | null;
}

export type CreateExpenseCommand = CreateManualTransactionCommand;
export type CreateIncomeCommand = CreateManualTransactionCommand;

export interface UpdateManualTransactionCommand {
  commandId: string;
  financialEventId: string;
  description?: string;
  categoryId?: string | null;
}

export interface CancelManualTransactionCommand {
  commandId: string;
  financialEventId: string;
}

/** Fields deliberately excluded from the S03 metadata update command. */
export const NON_EDITABLE_TRANSACTION_FIELDS = [
  "id",
  "householdId",
  "kind",
  "amountCents",
  "occurredOn",
  "accountId",
  "origin",
  "status",
  "entry",
  "reversal",
  "reversalOfEventId",
  "createdAt",
  "updatedAt",
] as const;
export type NonEditableTransactionField =
  (typeof NON_EDITABLE_TRANSACTION_FIELDS)[number];

export type S03ErrorField =
  | "commandId"
  | "amountCents"
  | "occurredOn"
  | "description"
  | "accountId"
  | "categoryId"
  | "financialEventId";

/** Stable, database-independent error vocabulary for all S03 boundaries. */
export const S03_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INVALID_COMMAND",
  "INVALID_COMMAND_ID",
  "INVALID_AMOUNT",
  "INVALID_DATE",
  "DATE_IN_FUTURE",
  "INVALID_DESCRIPTION",
  "ACCOUNT_NOT_FOUND",
  "CATEGORY_NOT_FOUND",
  "RESOURCE_ARCHIVED",
  "TRACKING_START_DATE_VIOLATION",
  "CATEGORY_KIND_MISMATCH",
  "EVENT_NOT_FOUND",
  "EVENT_NOT_MANUAL",
  "EVENT_NOT_POSTED",
  "EVENT_ALREADY_CANCELLED",
  "REVERSAL_ALREADY_EXISTS",
  "NON_EDITABLE_FIELD",
  "COMMAND_ID_REUSED",
] as const;
export type S03ErrorCode = (typeof S03_ERROR_CODES)[number];

export const S03_ERROR_MESSAGES: Record<S03ErrorCode, string> = {
  UNAUTHENTICATED: "É necessário entrar para acessar este recurso.",
  INVALID_COMMAND: "Os dados da operação são inválidos.",
  INVALID_COMMAND_ID: "O identificador da operação é inválido.",
  INVALID_AMOUNT: "Informe um valor inteiro positivo em centavos.",
  INVALID_DATE: "Informe uma data válida no formato AAAA-MM-DD.",
  DATE_IN_FUTURE: "A data do lançamento não pode estar no futuro.",
  INVALID_DESCRIPTION:
    "Informe uma descrição entre 1 e 240 caracteres válidos.",
  ACCOUNT_NOT_FOUND: "A conta não foi encontrada.",
  CATEGORY_NOT_FOUND: "A categoria não foi encontrada.",
  RESOURCE_ARCHIVED: "A conta ou categoria está arquivada e não pode ser usada.",
  TRACKING_START_DATE_VIOLATION:
    "A data do lançamento não pode preceder o início do acompanhamento da conta.",
  CATEGORY_KIND_MISMATCH:
    "A categoria precisa ter o mesmo tipo do lançamento.",
  EVENT_NOT_FOUND: "O lançamento não foi encontrado.",
  EVENT_NOT_MANUAL: "Somente lançamentos manuais podem ser alterados.",
  EVENT_NOT_POSTED: "O lançamento não está em um estado que permita esta operação.",
  EVENT_ALREADY_CANCELLED: "O lançamento já foi cancelado.",
  REVERSAL_ALREADY_EXISTS: "O lançamento já possui um cancelamento.",
  NON_EDITABLE_FIELD: "Este campo não pode ser alterado nesta operação.",
  COMMAND_ID_REUSED: "O identificador da operação já foi utilizado.",
};

export interface S03Error {
  code: S03ErrorCode;
  message: string;
  field?: S03ErrorField;
}

/** Generic result used by server actions and use cases. */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type S03Result<T> = Result<T, S03Error>;

export interface ManualTransactionEntryReadModel {
  id: string;
  amountCents: string;
  status: "POSTED";
  postedOn: string;
}

export interface ManualTransactionReversalReadModel {
  id: string;
  amountCents: string;
  origin: "SYSTEM";
  status: "POSTED";
  occurredOn: string;
}

/** Serializable read model shared by list, detail and mutation responses. */
export interface ManualTransactionReadModel {
  id: string;
  householdId: string;
  kind: ManualTransactionKind;
  status: "POSTED" | "CANCELLED";
  origin: "MANUAL";
  amountCents: string;
  occurredOn: string;
  description: string;
  accountId: string;
  categoryId: string | null;
  entry: ManualTransactionEntryReadModel;
  reversal: ManualTransactionReversalReadModel | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Serializable filters used by `/transactions`. `from`/`to` are the
 * canonical URL keys; date aliases are accepted by the server parser so
 * callers can adapt existing search-param names without another query model.
 * Origin is intentionally fixed to MANUAL in this slice.
 */
export interface ListManualTransactionsQuery {
  from?: string;
  to?: string;
  occurredOnFrom?: string;
  occurredOnTo?: string;
  dateFrom?: string;
  dateTo?: string;
  startDate?: string;
  endDate?: string;
  effectiveDateFrom?: string;
  effectiveDateTo?: string;
  periodStart?: string;
  periodEnd?: string;
  period?: { from?: string; to?: string };
  accountId?: string;
  categoryId?: string | null;
  kind?: ManualTransactionKind;
  /** Alias suitable for UIs that label the filter “type”. */
  type?: ManualTransactionKind;
  status?: FinancialEventStatus | "ALL";
  /** Accepted only as MANUAL; SYSTEM is outside the list contract. */
  origin?: "MANUAL";
}

export type ListTransactionsQuery = ListManualTransactionsQuery;

/** Filters for the account statement read model. */
export interface ListAccountMovementsQuery {
  from?: string;
  to?: string;
  occurredOnFrom?: string;
  occurredOnTo?: string;
  dateFrom?: string;
  dateTo?: string;
  startDate?: string;
  endDate?: string;
  effectiveDateFrom?: string;
  effectiveDateTo?: string;
  periodStart?: string;
  periodEnd?: string;
  period?: { from?: string; to?: string };
  categoryId?: string | null;
  kind?: FinancialEventKind;
  type?: FinancialEventKind;
  status?: FinancialEventStatus | "ALL";
}

/** Query response shape mirrors the flat S02 list read models. */
export interface ListManualTransactionsReadModel {
  items: ManualTransactionListItemReadModel[];
}

export type ListTransactionsReadModel = ListManualTransactionsReadModel;

/**
 * T06 joins the S02 records into list/detail rows. The base read model keeps
 * the stable ID-only contract used by mutation responses; this subtype adds
 * the denormalized account/category records needed by the transaction UI.
 */
export interface ManualTransactionListItemReadModel
  extends ManualTransactionReadModel {
  account: AccountReadModel;
  category: CategoryReadModel | null;
}

export type ManualTransactionDetailReadModel =
  ManualTransactionListItemReadModel;

/** Position of one account at a civil date, derived from posted entries. */
export interface AccountBalanceReadModel {
  accountId: string;
  householdId: string;
  asOf: string;
  balanceCents: string;
}

/** One posted ledger effect, including its economic event and references. */
export interface AccountMovementReadModel {
  /** AccountEntry ID; kept as the top-level movement identifier for S02 UI. */
  id: string;
  financialEventId: string;
  accountId: string;
  householdId: string;
  amountCents: string;
  status: "POSTED";
  expectedOn: null;
  postedOn: string;
  occurredOn: string;
  kind: FinancialEventKind;
  origin: FinancialEventOrigin;
  description: string;
  categoryId: string | null;
  account: AccountReadModel;
  category: CategoryReadModel | null;
  /** Nested event data is convenient for account-detail consumers. */
  event: {
    id: string;
    kind: FinancialEventKind;
    status: FinancialEventStatus;
    origin: FinancialEventOrigin;
    amountCents: string;
    occurredOn: string;
    description: string;
    categoryId: string | null;
    reversalOfEventId: string | null;
    createdAt: string;
    updatedAt: string;
  };
}

/** Flat list response compatible with the existing S02 `{ items }` shape. */
export interface ListAccountMovementsReadModel {
  account: AccountReadModel;
  balance: AccountBalanceReadModel;
  items: AccountMovementReadModel[];
}

export type AccountMovementsReadModel = ListAccountMovementsReadModel;

/** Minimal tenant-scoped records consumed by pure reference validators. */
export interface TransactionAccountReference {
  id: string;
  householdId: string;
  status: "ACTIVE" | "ARCHIVED";
  trackingStartedOn: string | null;
}

export interface TransactionCategoryReference {
  id: string;
  householdId: string;
  status: "ACTIVE" | "ARCHIVED";
  kind: ManualTransactionKind;
}

function statusForS03Error(code: S03ErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "ACCOUNT_NOT_FOUND":
    case "CATEGORY_NOT_FOUND":
    case "EVENT_NOT_FOUND":
      return 404;
    case "RESOURCE_ARCHIVED":
    case "TRACKING_START_DATE_VIOLATION":
    case "CATEGORY_KIND_MISMATCH":
    case "EVENT_NOT_MANUAL":
    case "EVENT_NOT_POSTED":
    case "EVENT_ALREADY_CANCELLED":
    case "REVERSAL_ALREADY_EXISTS":
    case "NON_EDITABLE_FIELD":
    case "COMMAND_ID_REUSED":
      return 409;
    default:
      return 400;
  }
}

/** Expected domain failure that can safely cross an application boundary. */
export class S03DomainError extends Error {
  readonly code: S03ErrorCode;
  readonly field: S03ErrorField | undefined;
  readonly status: number;
  readonly expected = true;

  constructor(code: S03ErrorCode, field?: S03ErrorField) {
    super(S03_ERROR_MESSAGES[code]);
    this.name = "S03DomainError";
    this.code = code;
    this.field = field;
    this.status = statusForS03Error(code);
  }

  toError(): S03Error {
    return {
      code: this.code,
      message: this.message,
      ...(this.field ? { field: this.field } : {}),
    };
  }
}

export const TransactionDomainError = S03DomainError;
export const DomainValidationError = S03DomainError;

export function ok<T>(value: T): S03Result<T> {
  return { ok: true, value };
}

export function failure<T = never>(
  code: S03ErrorCode,
  field?: S03ErrorField,
): S03Result<T> {
  return {
    ok: false,
    error: new S03DomainError(code, field).toError(),
  };
}

export const success = ok;
export const errorResult = failure;
