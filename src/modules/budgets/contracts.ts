import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

import type { Money as MoneyValue } from "@/modules/transactions/money";

/** Versioned vocabulary owned by the S09 domain. */
export const BUDGET_CONTRACT_VERSION = "s09.v1" as const;

export const BUDGET_STATUSES = ["ACTIVE", "CLOSED"] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];
export const BUDGET_STATUS_VALUES = BUDGET_STATUSES;

export const BUDGET_MOVEMENT_KINDS = ["CONTRIBUTION", "WITHDRAWAL"] as const;
export type BudgetMovementKind = (typeof BUDGET_MOVEMENT_KINDS)[number];
export const MOVEMENT_KINDS = BUDGET_MOVEMENT_KINDS;

/** Persisted lineage categories; the sign is still carried by `kind`. */
export const BUDGET_MOVEMENT_SOURCE_KINDS = [
  "MANUAL",
  "ALLOCATION",
  "EXPENSE",
  "REFUND",
  "CORRECTION",
  "TRANSFER",
] as const;
export type BudgetMovementSourceKind =
  (typeof BUDGET_MOVEMENT_SOURCE_KINDS)[number];

export const BUDGET_GOAL_PROGRESS_STATUSES = [
  "IN_PROGRESS",
  "ACHIEVED",
] as const;
export type BudgetGoalProgressStatus =
  (typeof BUDGET_GOAL_PROGRESS_STATUSES)[number];

export const BUDGET_PACE_STATUSES = [
  "ON_TRACK",
  "BEHIND",
  "NOT_APPLICABLE",
] as const;
export type BudgetPaceStatus = (typeof BUDGET_PACE_STATUSES)[number];

export const BUDGET_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FINANCIAL_CONTEXT_REQUIRED",
  "INVALID_COMMAND",
  "INVALID_COMMAND_ID",
  "INVALID_NAME",
  "INVALID_AMOUNT",
  "AMOUNT_OUT_OF_RANGE",
  "INVALID_DATE",
  "INVALID_DATE_RANGE",
  "INVALID_REFERENCE",
  "INVALID_MOVEMENT_KIND",
  "INVALID_STATUS",
  "INVALID_GOAL",
  "INVALID_TARGET_AMOUNT",
  "INVALID_TARGET_DATE",
  "BUDGET_NOT_FOUND",
  "CATEGORY_NOT_FOUND",
  "MOVEMENT_NOT_FOUND",
  "MOVEMENT_BUDGET_MISMATCH",
  "CATEGORY_ARCHIVED",
  "CATEGORY_KIND_MISMATCH",
  "BUDGET_CLOSED",
  "BUDGET_NOT_ACTIVE_AT_DATE",
  "CATEGORY_ACTIVE_BUDGET_CONFLICT",
  "ALLOCATION_OVERLAP",
  "ALLOCATION_NO_POSITIVE_WEIGHT",
  "DUPLICATE_REFERENCE",
  "COMMAND_ID_REUSED",
  "MOVEMENT_ALREADY_CORRECTED",
  "TRANSFER_SAME_BUDGET",
  "REFUND_EXCEEDS_ORIGINAL",
  "PROVIDER_UNAVAILABLE",
  "CONTRACT_VERSION_MISMATCH",
  "QUERY_FAILED",
] as const;
export type BudgetErrorCode = (typeof BUDGET_ERROR_CODES)[number];

export const BUDGET_ERROR_MESSAGES: Record<BudgetErrorCode, string> = {
  UNAUTHENTICATED: "É necessário entrar para acessar este recurso.",
  FINANCIAL_CONTEXT_REQUIRED: "O contexto financeiro não está disponível.",
  INVALID_COMMAND: "Os dados da operação são inválidos.",
  INVALID_COMMAND_ID: "O identificador da operação é inválido.",
  INVALID_NAME: "Informe um nome entre 1 e 120 caracteres válidos.",
  INVALID_AMOUNT: "Informe um valor inteiro positivo em centavos.",
  AMOUNT_OUT_OF_RANGE: "O valor excede o limite financeiro permitido.",
  INVALID_DATE: "Informe uma data válida no formato AAAA-MM-DD.",
  INVALID_DATE_RANGE: "O intervalo de datas informado é inválido.",
  INVALID_REFERENCE: "A referência opaca é inválida.",
  INVALID_MOVEMENT_KIND: "O tipo de movimento informado é inválido.",
  INVALID_STATUS: "O status da Caixinha é inválido.",
  INVALID_GOAL: "A meta da Caixinha é inválida.",
  INVALID_TARGET_AMOUNT: "O alvo da meta deve ser positivo.",
  INVALID_TARGET_DATE: "A data-alvo da meta é inválida.",
  BUDGET_NOT_FOUND: "A Caixinha não foi encontrada.",
  CATEGORY_NOT_FOUND: "A categoria não foi encontrada.",
  MOVEMENT_NOT_FOUND: "O movimento não foi encontrado.",
  MOVEMENT_BUDGET_MISMATCH: "O movimento não pertence à Caixinha.",
  CATEGORY_ARCHIVED: "A categoria está arquivada.",
  CATEGORY_KIND_MISMATCH: "A categoria precisa ser de despesa.",
  BUDGET_CLOSED: "A Caixinha está encerrada.",
  BUDGET_NOT_ACTIVE_AT_DATE:
    "A Caixinha não estava vigente na data informada.",
  CATEGORY_ACTIVE_BUDGET_CONFLICT:
    "Já existe uma Caixinha vigente para esta categoria.",
  ALLOCATION_OVERLAP: "As vigências de alocação não podem se sobrepor.",
  ALLOCATION_NO_POSITIVE_WEIGHT:
    "É necessária ao menos uma regra de alocação positiva.",
  DUPLICATE_REFERENCE: "A referência já foi utilizada.",
  COMMAND_ID_REUSED: "O identificador da operação já foi utilizado.",
  MOVEMENT_ALREADY_CORRECTED: "O movimento já foi corrigido.",
  TRANSFER_SAME_BUDGET: "A origem e o destino devem ser diferentes.",
  REFUND_EXCEEDS_ORIGINAL: "O estorno excede o valor original.",
  PROVIDER_UNAVAILABLE: "A fonte de reserva está indisponível.",
  CONTRACT_VERSION_MISMATCH: "A versão do contrato é incompatível.",
  QUERY_FAILED: "Não foi possível consultar a Caixinha.",
};

export type BudgetErrorField =
  | "commandId"
  | "name"
  | "referenceId"
  | "boxReferenceId"
  | "budgetReferenceId"
  | "categoryId"
  | "status"
  | "asOf"
  | "from"
  | "to"
  | "amountCents"
  | "balanceCents"
  | "kind"
  | "effectiveOn"
  | "sourceBudgetReferenceId"
  | "destinationBudgetReferenceId"
  | "activeFrom"
  | "closedOn"
  | "targetAmountCents"
  | "targetDate"
  | "correctsReferenceId"
  | "correctionReferenceId"
  | "transferReferenceId"
  | "sourceReferenceId"
  | "sourceKind"
  | "financialEventId"
  | "accountEntryId"
  | "withdrawalReferenceId"
  | "contributionReferenceId";

function statusForBudgetError(code: BudgetErrorCode): number {
  switch (code) {
    case "BUDGET_NOT_FOUND":
    case "CATEGORY_NOT_FOUND":
    case "MOVEMENT_NOT_FOUND":
      return 404;
    case "CATEGORY_ARCHIVED":
    case "CATEGORY_KIND_MISMATCH":
    case "BUDGET_CLOSED":
    case "BUDGET_NOT_ACTIVE_AT_DATE":
    case "CATEGORY_ACTIVE_BUDGET_CONFLICT":
    case "ALLOCATION_OVERLAP":
    case "ALLOCATION_NO_POSITIVE_WEIGHT":
    case "DUPLICATE_REFERENCE":
    case "COMMAND_ID_REUSED":
    case "MOVEMENT_ALREADY_CORRECTED":
    case "TRANSFER_SAME_BUDGET":
    case "REFUND_EXCEEDS_ORIGINAL":
      return 409;
    case "UNAUTHENTICATED":
      return 401;
    default:
      return 400;
  }
}

/** Stable error object shared by pure rules and future server boundaries. */
export class BudgetDomainError extends Error {
  readonly code: BudgetErrorCode;
  readonly field: BudgetErrorField | undefined;
  readonly status: number;
  readonly expected = true;

  constructor(code: BudgetErrorCode, field?: BudgetErrorField) {
    super(BUDGET_ERROR_MESSAGES[code]);
    this.name = "BudgetDomainError";
    this.code = code;
    this.field = field;
    this.status = statusForBudgetError(code);
  }

  toError(): BudgetError {
    return {
      code: this.code,
      message: this.message,
      ...(this.field ? { field: this.field } : {}),
    };
  }
}

export const S09DomainError = BudgetDomainError;
export const BudgetValidationError = BudgetDomainError;

export interface BudgetError {
  code: BudgetErrorCode;
  message: string;
  field?: BudgetErrorField;
}

export type BudgetResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: BudgetError };

export function budgetOk<T>(value: T): BudgetResult<T> {
  return { ok: true, value };
}

export function budgetFailure<T = never>(
  code: BudgetErrorCode,
  field?: BudgetErrorField,
): BudgetResult<T> {
  return { ok: false, error: new BudgetDomainError(code, field).toError() };
}

export const ok = budgetOk;
export const failure = budgetFailure;

export type OpaqueReference = string;
export type BudgetReferenceId = OpaqueReference;
export type BoxReferenceId = OpaqueReference;
export type BudgetDateInput = string | Temporal.PlainDate;
export type BudgetAmountInput =
  | string
  | bigint
  | MoneyValue
  | { readonly cents: bigint }
  | { readonly toCentsString: () => string };
export type BudgetCentsInput = BudgetAmountInput;

/** Serializable goal shape. Both fields are present or the goal is absent. */
export interface BudgetGoalBoundary {
  readonly targetAmountCents: string;
  readonly targetDate: string;
}

/** Public/read shape; no Money, bigint or Temporal crosses this boundary. */
export interface BudgetBoundary {
  readonly referenceId: OpaqueReference;
  readonly name: string;
  readonly categoryId: OpaqueReference;
  readonly status: BudgetStatus;
  readonly activeFrom: string;
  readonly closedOn: string | null;
  readonly goal: BudgetGoalBoundary | null;
}

export type BudgetReadModel = BudgetBoundary;
export type BudgetDTO = BudgetBoundary;

export interface BudgetMovementBoundary {
  readonly referenceId: OpaqueReference;
  readonly boxReferenceId: OpaqueReference;
  readonly kind: BudgetMovementKind;
  readonly amountCents: string;
  readonly effectiveOn: string;
  readonly correctsReferenceId?: OpaqueReference | null;
  readonly transferReferenceId?: OpaqueReference | null;
  readonly sourceReferenceId?: OpaqueReference | null;
}

export type BudgetMovementReadModel = BudgetMovementBoundary;
export type BudgetMovementDTO = BudgetMovementBoundary;

export interface BudgetBalanceBoundary {
  readonly boxReferenceId: OpaqueReference;
  readonly asOf: string;
  readonly balanceCents: string;
  readonly protectedAmountCents: string;
  readonly contributionCents: string;
  readonly withdrawalCents: string;
  readonly activeAtCutoff: boolean;
  readonly movementReferenceIds: readonly OpaqueReference[];
  readonly contributionReferenceIds: readonly OpaqueReference[];
  readonly withdrawalReferenceIds: readonly OpaqueReference[];
}

export interface BudgetPeriodBoundary {
  readonly from: string;
  readonly to: string;
  readonly rolloverCents: string;
  readonly openingBalanceCents: string;
  readonly closingBalanceCents: string;
  readonly contributionCents: string;
  readonly withdrawalCents: string;
  readonly netChangeCents: string;
  readonly contributionReferenceIds: readonly OpaqueReference[];
  readonly withdrawalReferenceIds: readonly OpaqueReference[];
}

export interface BudgetProgressBoundary {
  readonly targetAmountCents: string | null;
  readonly targetDate: string | null;
  readonly progressCents: string;
  readonly remainingCents: string;
  readonly progressBps: string;
  readonly remainingMonths: number | null;
  readonly suggestedMonthlyCents: string | null;
  readonly status: BudgetGoalProgressStatus | "NOT_APPLICABLE";
  readonly paceStatus: BudgetPaceStatus;
}

export interface BudgetReserveComponentBoundary {
  readonly kind: "BOX_BALANCE";
  readonly rule: "BOX_BALANCE_PROTECTED";
  readonly referenceId: OpaqueReference;
  readonly boxReferenceId: OpaqueReference;
  readonly amountCents: string;
  readonly appliedAmountCents: string;
  readonly effectiveOn: string;
  readonly movementReferenceIds: readonly OpaqueReference[];
  readonly appliedMovementReferenceIds: readonly OpaqueReference[];
}

/** Domain aggregate: civil dates and Money remain internal to pure rules. */
export interface Budget {
  readonly referenceId: OpaqueReference;
  readonly name: string;
  readonly categoryId: OpaqueReference;
  readonly status: BudgetStatus;
  readonly activeFrom: Temporal.PlainDate;
  readonly closedOn: Temporal.PlainDate | null;
  readonly goal: BudgetGoal | null;
  /** Optional server-side lineage; never serialized by serializeBudget. */
  readonly householdId?: OpaqueReference | null;
}

export type Box = Budget;
export type BudgetEnvelope = Budget;

export interface BudgetGoal {
  readonly targetAmount: MoneyValue;
  readonly targetDate: Temporal.PlainDate;
}

export interface BudgetInput {
  readonly referenceId?: OpaqueReference;
  readonly budgetReferenceId?: OpaqueReference;
  readonly boxReferenceId?: OpaqueReference;
  readonly id?: OpaqueReference;
  readonly name: string;
  readonly categoryId: OpaqueReference;
  readonly status?: BudgetStatus;
  readonly activeFrom: BudgetDateInput;
  readonly closedOn?: BudgetDateInput | null;
  readonly goal?: BudgetGoalInput | null;
  readonly targetAmountCents?: BudgetAmountInput | null;
  readonly targetDate?: BudgetDateInput | null;
  readonly householdId?: OpaqueReference | null;
}

export interface BudgetGoalInput {
  readonly targetAmount?: BudgetAmountInput;
  readonly targetAmountCents?: BudgetAmountInput;
  readonly targetDate?: BudgetDateInput;
}

export interface BudgetMovement {
  readonly referenceId: OpaqueReference;
  readonly boxReferenceId: OpaqueReference;
  readonly kind: BudgetMovementKind;
  readonly amount: MoneyValue;
  readonly effectiveOn: Temporal.PlainDate;
  readonly correctsReferenceId: OpaqueReference | null;
  readonly transferReferenceId: OpaqueReference | null;
  readonly sourceReferenceId: OpaqueReference | null;
}

export type BoxMovement = BudgetMovement;

export interface BudgetMovementInput {
  readonly referenceId?: OpaqueReference;
  readonly movementReferenceId?: OpaqueReference;
  readonly id?: OpaqueReference;
  readonly boxReferenceId?: OpaqueReference;
  readonly budgetReferenceId?: OpaqueReference;
  readonly kind?: BudgetMovementKind;
  readonly amount?: BudgetAmountInput;
  readonly amountCents?: BudgetAmountInput;
  readonly effectiveOn?: BudgetDateInput;
  readonly date?: BudgetDateInput;
  readonly correctsReferenceId?: OpaqueReference | null;
  readonly transferReferenceId?: OpaqueReference | null;
  readonly sourceReferenceId?: OpaqueReference | null;
}

export interface BudgetBalance {
  readonly rule: "BOX_BALANCE_PROTECTED";
  readonly boxReferenceId: OpaqueReference;
  readonly asOf: Temporal.PlainDate;
  readonly balance: MoneyValue;
  readonly protectedAmount: MoneyValue;
  readonly contributions: MoneyValue;
  readonly withdrawals: MoneyValue;
  readonly activeAtCutoff: boolean;
  readonly movementReferenceIds: readonly OpaqueReference[];
  readonly contributionReferenceIds: readonly OpaqueReference[];
  readonly withdrawalReferenceIds: readonly OpaqueReference[];
}

export type BoxBalance = BudgetBalance;

export interface BudgetPeriodSummary {
  readonly from: Temporal.PlainDate;
  readonly to: Temporal.PlainDate;
  readonly rollover: MoneyValue;
  readonly openingBalance: MoneyValue;
  readonly closingBalance: MoneyValue;
  readonly contributions: MoneyValue;
  readonly withdrawals: MoneyValue;
  readonly netChange: MoneyValue;
  readonly contributionReferenceIds: readonly OpaqueReference[];
  readonly withdrawalReferenceIds: readonly OpaqueReference[];
}

export type BudgetPeriodBalance = BudgetPeriodSummary;

export interface BudgetProgress {
  readonly targetAmount: MoneyValue | null;
  readonly targetDate: Temporal.PlainDate | null;
  readonly progress: MoneyValue;
  readonly remaining: MoneyValue;
  readonly progressBps: bigint;
  readonly remainingMonths: number | null;
  readonly suggestedMonthlyAmount: MoneyValue | null;
  readonly status: BudgetGoalProgressStatus | "NOT_APPLICABLE";
  readonly paceStatus: BudgetPaceStatus;
}

export interface BudgetReserveComponent {
  readonly kind: "BOX_BALANCE";
  readonly rule: "BOX_BALANCE_PROTECTED";
  readonly referenceId: OpaqueReference;
  readonly boxReferenceId: OpaqueReference;
  readonly amount: MoneyValue;
  readonly appliedAmount: MoneyValue;
  readonly effectiveOn: Temporal.PlainDate;
  readonly movementReferenceIds: readonly OpaqueReference[];
  readonly appliedMovementReferenceIds: readonly OpaqueReference[];
}

export type ProtectedBudgetComponent = BudgetReserveComponent;

export interface CreateBudgetCommand {
  readonly commandId: string;
  readonly name: string;
  readonly categoryId: OpaqueReference;
  readonly activeFrom: string;
  readonly goal?: BudgetGoalBoundary | null;
}

export interface UpdateBudgetCommand {
  readonly commandId: string;
  readonly budgetReferenceId: OpaqueReference;
  readonly name?: string;
  readonly goal?: BudgetGoalBoundary | null;
}

export interface CloseBudgetCommand {
  readonly commandId: string;
  readonly budgetReferenceId: OpaqueReference;
  readonly closedOn: string;
}

export interface RegisterBudgetMovementCommand {
  readonly commandId: string;
  readonly budgetReferenceId: OpaqueReference;
  readonly amountCents: string;
  readonly effectiveOn: string;
  /** Optional caller-provided movement reference; generated server-side when omitted. */
  readonly referenceId?: OpaqueReference;
  /** Optional server-authorized lineage for reconciliation writes. */
  readonly sourceReferenceId?: OpaqueReference;
  readonly financialEventId?: OpaqueReference;
  readonly accountEntryId?: OpaqueReference;
  readonly sourceKind?: BudgetMovementSourceKind;
}

export type RegisterContributionCommand = RegisterBudgetMovementCommand;
export type RegisterWithdrawalCommand = RegisterBudgetMovementCommand;

export interface TransferBetweenBudgetsCommand {
  readonly commandId: string;
  readonly sourceBudgetReferenceId: OpaqueReference;
  readonly destinationBudgetReferenceId: OpaqueReference;
  readonly amountCents: string;
  readonly effectiveOn: string;
  /** Optional client refs; the server derives stable refs from commandId. */
  readonly withdrawalReferenceId?: OpaqueReference;
  readonly contributionReferenceId?: OpaqueReference;
  readonly transferReferenceId?: OpaqueReference;
}

export interface CorrectMovementCommand {
  readonly commandId: string;
  readonly budgetReferenceId: OpaqueReference;
  readonly correctsReferenceId: OpaqueReference;
  /** Optional client ref; the server derives one from commandId. */
  readonly correctionReferenceId?: OpaqueReference;
  readonly effectiveOn?: string;
  readonly replacement?: BudgetMovementBoundary | null;
}

/** Command that materializes one authoritative POSTED income event. */
export interface DistributeRealizedIncomeCommand {
  readonly commandId: string;
  /** The S03 event ID; `incomeReferenceId` is a compatibility alias. */
  readonly financialEventId?: OpaqueReference;
  readonly incomeReferenceId?: OpaqueReference;
  /** Optional assertions; the server always reads the authoritative event. */
  readonly amountCents?: string;
  readonly effectiveOn?: string;
}

/** Result of an append-only correction; all rows share one transaction. */
export interface BudgetCorrectionBoundary {
  readonly original: BudgetMovementBoundary;
  readonly compensation: BudgetMovementBoundary;
  readonly replacement: BudgetMovementBoundary | null;
  readonly movements: readonly BudgetMovementBoundary[];
}

/** Result of a transfer pair; no bank/ledger event is created. */
export interface BudgetTransferBoundary {
  readonly transferReferenceId: OpaqueReference;
  readonly source: BudgetMovementBoundary;
  readonly destination: BudgetMovementBoundary;
  readonly movements: readonly [BudgetMovementBoundary, BudgetMovementBoundary];
}

export type BudgetDistributionStatus =
  | "DISTRIBUTED"
  | "NO_CONFIGURATION"
  | "NOT_REALIZED"
  | "ALREADY_RECONCILED";

export interface BudgetDistributionBoundary {
  readonly status: BudgetDistributionStatus;
  readonly incomeReferenceId: OpaqueReference;
  readonly effectiveOn: string;
  readonly originAmountCents: string;
  readonly distributedAmountCents: string;
  readonly remainingAmountCents: string;
  readonly contributions: readonly BudgetMovementBoundary[];
  readonly ruleReferenceIds: readonly OpaqueReference[];
  readonly reconciliationKey: OpaqueReference | null;
}

/** Atomic result returned by the pure transfer rule. */
export interface BudgetTransfer {
  readonly transferReferenceId: OpaqueReference | null;
  readonly source: BudgetMovement;
  readonly destination: BudgetMovement;
  readonly movements: readonly [BudgetMovement, BudgetMovement];
}

/** Atomic append-only result returned by the pure correction rule. */
export interface BudgetCorrection {
  readonly original: BudgetMovement;
  readonly compensation: BudgetMovement;
  readonly replacement: BudgetMovement | null;
  readonly movements: readonly BudgetMovement[];
}

export interface BudgetTransferInput {
  readonly sourceBudget?: Budget | BudgetInput;
  readonly destinationBudget?: Budget | BudgetInput;
  readonly fromBudget?: Budget | BudgetInput;
  readonly toBudget?: Budget | BudgetInput;
  readonly sourceBudgetReferenceId?: OpaqueReference;
  readonly destinationBudgetReferenceId?: OpaqueReference;
  readonly amount?: BudgetAmountInput;
  readonly amountCents?: BudgetAmountInput;
  readonly effectiveOn: BudgetDateInput;
  readonly withdrawalReferenceId?: OpaqueReference;
  readonly contributionReferenceId?: OpaqueReference;
  readonly sourceReferenceId?: OpaqueReference;
  readonly destinationReferenceId?: OpaqueReference;
  readonly transferReferenceId?: OpaqueReference | null;
}

export interface BudgetCorrectionInput {
  readonly budget?: Budget | BudgetInput;
  readonly originalMovement?: BudgetMovement | BudgetMovementInput;
  readonly movement?: BudgetMovement | BudgetMovementInput;
  readonly original?: BudgetMovement | BudgetMovementInput;
  readonly correctsReferenceId?: OpaqueReference;
  readonly movementReferenceId?: OpaqueReference;
  readonly correctionReferenceId?: OpaqueReference;
  readonly compensationReferenceId?: OpaqueReference;
  readonly effectiveOn?: BudgetDateInput;
  readonly replacement?: BudgetMovement | BudgetMovementInput | null;
  readonly existingMovements?: readonly (BudgetMovement | BudgetMovementInput)[];
}

export interface BudgetMovementValidationOptions {
  readonly interactive?: boolean;
  readonly existingMovements?: readonly (BudgetMovement | BudgetMovementInput)[];
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DECIMAL_CENTS_PATTERN = /^\d+$/u;
const SIGNED_CENTS_PATTERN = /^-?\d+$/u;
const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;
export const MAX_PERSISTABLE_CENTS = BigInt("9223372036854775807");
export const MIN_PERSISTABLE_CENTS = -MAX_PERSISTABLE_CENTS;
export const BUDGET_NAME_MAX_LENGTH = 120;
export const BUDGET_COMMAND_ID_MAX_LENGTH = 128;
export const BUDGET_REFERENCE_MAX_LENGTH = 256;

function validIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  try {
    Temporal.PlainDate.from(value, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}

function validPositiveCents(value: string): boolean {
  if (!DECIMAL_CENTS_PATTERN.test(value)) return false;
  try {
    const cents = BigInt(value);
    return cents > BigInt(0) && cents <= MAX_PERSISTABLE_CENTS;
  } catch {
    return false;
  }
}

function validNonNegativeCents(value: string): boolean {
  if (!DECIMAL_CENTS_PATTERN.test(value)) return false;
  try {
    return BigInt(value) <= MAX_PERSISTABLE_CENTS;
  } catch {
    return false;
  }
}

function validSignedCents(value: string): boolean {
  if (!SIGNED_CENTS_PATTERN.test(value)) return false;
  try {
    const cents = BigInt(value);
    return cents >= MIN_PERSISTABLE_CENTS && cents <= MAX_PERSISTABLE_CENTS;
  } catch {
    return false;
  }
}

const opaqueReferenceSchema = z
  .string()
  .min(1)
  .max(BUDGET_REFERENCE_MAX_LENGTH)
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER.test(value), {
    message: "referência inválida",
  });

const commandIdSchema = z
  .string()
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER.test(value), {
    message: "identificador de operação inválido",
  })
  .transform((value) => value.trim())
  .refine(
    (value) =>
      value.length >= 1 &&
      value.length <= BUDGET_COMMAND_ID_MAX_LENGTH &&
      !CONTROL_OR_FORMAT_CHARACTER.test(value),
    { message: "identificador de operação inválido" },
  );

const dateSchema = z.string().refine(validIsoDate, {
  message: "data inválida",
});

const positiveCentsSchema = z.string().refine(validPositiveCents, {
  message: "centavos positivos inválidos",
});

const nonNegativeCentsSchema = z.string().refine(validNonNegativeCents, {
  message: "centavos não negativos inválidos",
});

const signedCentsSchema = z.string().refine(validSignedCents, {
  message: "centavos assinados inválidos",
});

const nameSchema = z
  .string()
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER.test(value), {
    message: "nome inválido",
  })
  .transform((value) => value.normalize("NFKC").trim().replace(/\s+/gu, " "))
  .refine(
    (value) =>
      value.length >= 1 &&
      value.length <= BUDGET_NAME_MAX_LENGTH,
    { message: "nome inválido" },
  );

export const budgetStatusSchema = z.enum(BUDGET_STATUSES);
export const budgetMovementKindSchema = z.enum(BUDGET_MOVEMENT_KINDS);

export const budgetGoalSchema = z
  .object({
    targetAmountCents: positiveCentsSchema,
    targetDate: dateSchema,
  })
  .strict();

export const budgetBoundarySchema = z
  .object({
    referenceId: opaqueReferenceSchema,
    name: nameSchema,
    categoryId: opaqueReferenceSchema,
    status: budgetStatusSchema,
    activeFrom: dateSchema,
    closedOn: dateSchema.nullable(),
    goal: budgetGoalSchema.nullable(),
  })
  .strict();

export const budgetMovementSchema = z
  .object({
    referenceId: opaqueReferenceSchema,
    boxReferenceId: opaqueReferenceSchema,
    kind: budgetMovementKindSchema,
    amountCents: positiveCentsSchema,
    effectiveOn: dateSchema,
    correctsReferenceId: opaqueReferenceSchema.nullable().optional(),
    transferReferenceId: opaqueReferenceSchema.nullable().optional(),
    sourceReferenceId: opaqueReferenceSchema.nullable().optional(),
  })
  .strict();

export const budgetBalanceSchema = z
  .object({
    boxReferenceId: opaqueReferenceSchema,
    asOf: dateSchema,
    balanceCents: signedCentsSchema,
    protectedAmountCents: signedCentsSchema,
    contributionCents: signedCentsSchema,
    withdrawalCents: signedCentsSchema,
    activeAtCutoff: z.boolean(),
    movementReferenceIds: z.array(opaqueReferenceSchema),
    contributionReferenceIds: z.array(opaqueReferenceSchema),
    withdrawalReferenceIds: z.array(opaqueReferenceSchema),
  })
  .strict();

export const budgetPeriodSchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    rolloverCents: signedCentsSchema,
    openingBalanceCents: signedCentsSchema,
    closingBalanceCents: signedCentsSchema,
    contributionCents: signedCentsSchema,
    withdrawalCents: signedCentsSchema,
    netChangeCents: signedCentsSchema,
    contributionReferenceIds: z.array(opaqueReferenceSchema),
    withdrawalReferenceIds: z.array(opaqueReferenceSchema),
  })
  .strict()
  .refine((value) => value.from <= value.to, {
    message: "intervalo inválido",
  });

export const budgetProgressSchema = z
  .object({
    targetAmountCents: positiveCentsSchema.nullable(),
    targetDate: dateSchema.nullable(),
    progressCents: signedCentsSchema,
    remainingCents: signedCentsSchema,
    progressBps: nonNegativeCentsSchema,
    remainingMonths: z.number().int().nonnegative().nullable(),
    suggestedMonthlyCents: nonNegativeCentsSchema.nullable(),
    status: z.enum(["IN_PROGRESS", "ACHIEVED", "NOT_APPLICABLE"] as const),
    paceStatus: z.enum(BUDGET_PACE_STATUSES),
  })
  .strict();

export const budgetReserveComponentSchema = z
  .object({
    kind: z.literal("BOX_BALANCE"),
    rule: z.literal("BOX_BALANCE_PROTECTED"),
    referenceId: opaqueReferenceSchema,
    boxReferenceId: opaqueReferenceSchema,
    amountCents: positiveCentsSchema,
    appliedAmountCents: signedCentsSchema,
    effectiveOn: dateSchema,
    movementReferenceIds: z.array(opaqueReferenceSchema),
    appliedMovementReferenceIds: z.array(opaqueReferenceSchema),
  })
  .strict();

const goalCommandSchema = budgetGoalSchema.nullable().optional();

export const createBudgetCommandSchema = z
  .object({
    commandId: commandIdSchema,
    name: nameSchema,
    categoryId: opaqueReferenceSchema,
    activeFrom: dateSchema,
    goal: goalCommandSchema,
  })
  .strict();

export const updateBudgetCommandSchema = z
  .object({
    commandId: commandIdSchema,
    budgetReferenceId: opaqueReferenceSchema,
    name: nameSchema.optional(),
    goal: goalCommandSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.name === undefined && value.goal === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ao menos um campo editável é obrigatório",
      });
    }
  });

export const closeBudgetCommandSchema = z
  .object({
    commandId: commandIdSchema,
    budgetReferenceId: opaqueReferenceSchema,
    closedOn: dateSchema,
  })
  .strict();

const movementCommandShape = {
  commandId: commandIdSchema,
  budgetReferenceId: opaqueReferenceSchema,
  amountCents: positiveCentsSchema,
  effectiveOn: dateSchema,
  referenceId: opaqueReferenceSchema.optional(),
  sourceReferenceId: opaqueReferenceSchema.optional(),
  financialEventId: opaqueReferenceSchema.optional(),
  accountEntryId: opaqueReferenceSchema.optional(),
  sourceKind: z.enum(BUDGET_MOVEMENT_SOURCE_KINDS).optional(),
} as const;

export const registerContributionCommandSchema = z
  .object(movementCommandShape)
  .strict();
export const registerWithdrawalCommandSchema = z
  .object(movementCommandShape)
  .strict();

export const transferBetweenBudgetsCommandSchema = z
  .object({
    commandId: commandIdSchema,
    sourceBudgetReferenceId: opaqueReferenceSchema,
    destinationBudgetReferenceId: opaqueReferenceSchema,
    amountCents: positiveCentsSchema,
    effectiveOn: dateSchema,
    withdrawalReferenceId: opaqueReferenceSchema.optional(),
    contributionReferenceId: opaqueReferenceSchema.optional(),
    transferReferenceId: opaqueReferenceSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sourceBudgetReferenceId === value.destinationBudgetReferenceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destinationBudgetReferenceId"],
        message: "origem e destino devem ser diferentes",
      });
    }
    if (
      value.withdrawalReferenceId !== undefined &&
      value.contributionReferenceId !== undefined &&
      value.withdrawalReferenceId === value.contributionReferenceId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contributionReferenceId"],
        message: "as referências do par devem ser diferentes",
      });
    }
  });

export const correctMovementCommandSchema = z
  .object({
    commandId: commandIdSchema,
    budgetReferenceId: opaqueReferenceSchema,
    correctsReferenceId: opaqueReferenceSchema,
    correctionReferenceId: opaqueReferenceSchema.optional(),
    effectiveOn: dateSchema.optional(),
    replacement: budgetMovementSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.correctsReferenceId === value.correctionReferenceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["correctionReferenceId"],
        message: "a correção precisa ter nova referência",
      });
    }
  });

export const distributeRealizedIncomeCommandSchema = z
  .object({
    commandId: commandIdSchema,
    financialEventId: opaqueReferenceSchema.optional(),
    incomeReferenceId: opaqueReferenceSchema.optional(),
    amountCents: positiveCentsSchema.optional(),
    effectiveOn: dateSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.financialEventId === undefined && value.incomeReferenceId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["financialEventId"],
        message: "a receita realizada precisa de uma referência",
      });
    }
    if (
      value.financialEventId !== undefined &&
      value.incomeReferenceId !== undefined &&
      value.financialEventId !== value.incomeReferenceId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["financialEventId"],
        message: "as referências da receita precisam ser iguais",
      });
    }
  })
  .transform((value) => {
    const eventId = value.financialEventId ?? value.incomeReferenceId;
    return {
      ...value,
      financialEventId: eventId,
      incomeReferenceId: eventId,
    };
  });

export const parseBudgetBoundary = (value: unknown): BudgetBoundary =>
  budgetBoundarySchema.parse(value) as BudgetBoundary;
export const parseBudgetMovementBoundary = (
  value: unknown,
): BudgetMovementBoundary => budgetMovementSchema.parse(value) as BudgetMovementBoundary;
export const parseBudgetBalanceBoundary = (value: unknown): BudgetBalanceBoundary =>
  budgetBalanceSchema.parse(value) as BudgetBalanceBoundary;
export const parseBudgetPeriodBoundary = (value: unknown): BudgetPeriodBoundary =>
  budgetPeriodSchema.parse(value) as BudgetPeriodBoundary;
export const parseBudgetProgressBoundary = (
  value: unknown,
): BudgetProgressBoundary => budgetProgressSchema.parse(value) as BudgetProgressBoundary;
export const parseBudgetReserveComponentBoundary = (
  value: unknown,
): BudgetReserveComponentBoundary =>
  budgetReserveComponentSchema.parse(value) as BudgetReserveComponentBoundary;

export const isBudgetBoundary = (value: unknown): value is BudgetBoundary =>
  budgetBoundarySchema.safeParse(value).success;
export const isBudgetMovementBoundary = (
  value: unknown,
): value is BudgetMovementBoundary => budgetMovementSchema.safeParse(value).success;
export const isBudgetBalanceBoundary = (
  value: unknown,
): value is BudgetBalanceBoundary => budgetBalanceSchema.safeParse(value).success;

export const budgetOpaqueReferenceSchema = opaqueReferenceSchema;
export const budgetCommandIdSchema = commandIdSchema;
export const budgetDateSchema = dateSchema;
export const budgetPositiveCentsSchema = positiveCentsSchema;
export const budgetNonNegativeCentsSchema = nonNegativeCentsSchema;
export const budgetSignedCentsSchema = signedCentsSchema;
