/**
 * Serializable boundary contracts for S05 transaction review.
 *
 * This module is deliberately independent from Drizzle and from a request
 * context. A household is resolved by the server; it is never accepted as a
 * query/command authority. Likewise, origin, account destination, import
 * lineage and CSV data are either derived server-side or exposed read-only.
 */

import { z } from "zod";

import { isUuidV7 } from "@/lib/uuidv7";
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  CATEGORY_KINDS,
  LIQUIDITIES,
  SPENDABILITIES,
  type AccountReadModel,
  type CategoryReadModel,
} from "@/modules/accounts-categories/contracts";

export const REVIEWABLE_TRANSACTION_ORIGINS = ["MANUAL", "IMPORT"] as const;
export type ReviewableTransactionOrigin =
  (typeof REVIEWABLE_TRANSACTION_ORIGINS)[number];
export const REVIEWABLE_TRANSACTION_ORIGIN_VALUES =
  REVIEWABLE_TRANSACTION_ORIGINS;

export const REVIEWABLE_TRANSACTION_KINDS = ["EXPENSE", "INCOME"] as const;
export type ReviewableTransactionKind =
  (typeof REVIEWABLE_TRANSACTION_KINDS)[number];

export const REVIEWABLE_TRANSACTION_STATUSES = [
  "POSTED",
  "CANCELLED",
] as const;
export type ReviewableTransactionStatus =
  (typeof REVIEWABLE_TRANSACTION_STATUSES)[number];

export const TRANSACTION_REVIEW_STATES = [
  "NEEDS_REVIEW",
  "ORGANIZED",
  "NOT_APPLICABLE",
] as const;
export type TransactionReviewState = (typeof TRANSACTION_REVIEW_STATES)[number];
export const TRANSACTION_REVIEW_STATE_VALUES = TRANSACTION_REVIEW_STATES;

export const TRANSACTION_REVIEW_REASONS = ["UNCATEGORIZED"] as const;
export type TransactionReviewReason =
  | (typeof TRANSACTION_REVIEW_REASONS)[number]
  | null;
export const TRANSACTION_REVIEW_REASON_VALUES = TRANSACTION_REVIEW_REASONS;

export const DEFAULT_REVIEW_PAGE_LIMIT = 50;
export const MAX_REVIEW_PAGE_LIMIT = 100;
export const REVIEW_SEARCH_MAX_CODE_POINTS = 120;
export const REVIEW_CURSOR_VERSION = 1 as const;
export const MAX_REVIEW_CURSOR_BYTES = 512;
export const REVIEW_CURSOR_MAX_BYTES = MAX_REVIEW_CURSOR_BYTES;
export const REVIEWABLE_TRANSACTION_DESCRIPTION_MAX_CODE_POINTS = 240;
export const REVIEW_COMMAND_ID_MAX_LENGTH = 128;
export const REVIEW_CURSOR_FILTER_HASH_LENGTH = 64;

/**
 * Origin is intentionally narrower than the persisted ledger origin enum.
 * `SYSTEM` and reversal events cannot be represented by this type.
 */
export const reviewableTransactionOriginSchema = z.enum(
  REVIEWABLE_TRANSACTION_ORIGINS,
);
export const reviewableTransactionKindSchema = z.enum(
  REVIEWABLE_TRANSACTION_KINDS,
);
export const reviewableTransactionStatusSchema = z.enum(
  REVIEWABLE_TRANSACTION_STATUSES,
);
export const transactionReviewStateSchema = z.enum(TRANSACTION_REVIEW_STATES);
export const transactionReviewReasonSchema = z
  .literal("UNCATEGORIZED")
  .nullable();

export const uuidV7StringSchema = z.string().refine(isUuidV7, {
  message: "identificador de recurso inválido",
});

const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const ABSOLUTE_CENTS_PATTERN = /^[1-9]\d*$/u;
const SIGNED_CENTS_PATTERN = /^-?(?:0|[1-9]\d*)$/u;
const FILTER_HASH_PATTERN = /^[0-9a-f]{64}$/u;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeReviewDescriptionValue(value: string): string | null {
  const normalized = value.normalize("NFKC");
  if (CONTROL_OR_FORMAT_CHARACTER.test(normalized)) {
    return null;
  }

  const collapsed = normalized.trim().replace(/\s+/gu, " ");
  const length = codePointLength(collapsed);
  if (
    length < 1 ||
    length > REVIEWABLE_TRANSACTION_DESCRIPTION_MAX_CODE_POINTS
  ) {
    return null;
  }

  return collapsed;
}

/** Uses the same NFKC/whitespace rules as S03 for the editable field. */
export function normalizeReviewDescription(value: unknown): string {
  if (typeof value !== "string") {
    throw new S05DomainError("INVALID_COMMAND", "description");
  }

  const normalized = normalizeReviewDescriptionValue(value);
  if (normalized === null) {
    throw new S05DomainError("INVALID_COMMAND", "description");
  }
  return normalized;
}

/** Search is a literal description substring; SQL wildcard characters stay literal. */
export function normalizeReviewSearch(value: unknown): string {
  if (typeof value !== "string") {
    throw new S05DomainError("INVALID_QUERY", "search");
  }

  const normalized = value.normalize("NFKC").trim();
  if (
    normalized.length === 0 ||
    CONTROL_OR_FORMAT_CHARACTER.test(normalized) ||
    codePointLength(normalized) > REVIEW_SEARCH_MAX_CODE_POINTS
  ) {
    throw new S05DomainError("INVALID_QUERY", "search");
  }

  return normalized;
}

function isValidIsoTimestamp(value: string): boolean {
  return (
    ISO_TIMESTAMP_PATTERN.test(value) &&
    isValidCivilDateString(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value))
  );
}

function normalizeCommandId(value: unknown): string {
  if (typeof value !== "string") {
    throw new S05DomainError("INVALID_COMMAND_ID", "commandId");
  }

  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > REVIEW_COMMAND_ID_MAX_LENGTH ||
    CONTROL_OR_FORMAT_CHARACTER.test(normalized)
  ) {
    throw new S05DomainError("INVALID_COMMAND_ID", "commandId");
  }
  return normalized;
}

function normalizeUuid(value: unknown, field: S05ErrorField): string {
  if (typeof value !== "string") {
    throw new S05DomainError("INVALID_COMMAND", field);
  }

  const normalized = value.trim();
  if (!isUuidV7(normalized)) {
    throw new S05DomainError("INVALID_COMMAND", field);
  }
  return normalized;
}

function normalizeIsoDate(value: unknown, field: S05ErrorField): string {
  if (typeof value !== "string" || !isValidCivilDateString(value)) {
    throw new S05DomainError("INVALID_QUERY", field);
  }
  return value;
}

function isValidCivilDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    Number.isFinite(date.getTime()) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export type TransactionSource =
  | { origin: "MANUAL"; import: null }
  | {
      origin: "IMPORT";
      import: {
        importId: string;
        rowNumber: number;
        externalId: string | null;
      };
    };

const manualTransactionSourceSchema = z
  .object({
    origin: z.literal("MANUAL"),
    import: z.null(),
  })
  .strict();

const importedTransactionSourceSchema = z
  .object({
    origin: z.literal("IMPORT"),
    import: z
      .object({
        importId: uuidV7StringSchema,
        rowNumber: z.number().int().min(2),
        externalId: z
          .string()
          .min(1)
          .refine((value) => codePointLength(value) <= 128)
          .refine((value) => !CONTROL_OR_FORMAT_CHARACTER.test(value))
          .nullable(),
      })
      .strict(),
  })
  .strict();

export const transactionSourceSchema = z.union([
  manualTransactionSourceSchema,
  importedTransactionSourceSchema,
]);
export const reviewableTransactionSourceSchema = transactionSourceSchema;

export function parseTransactionSource(input: unknown): TransactionSource {
  const result = transactionSourceSchema.safeParse(input);
  if (!result.success) {
    throw new S05DomainError("IMPORT_LINEAGE_INVALID");
  }
  return result.data as TransactionSource;
}

export const parseReviewableTransactionSource = parseTransactionSource;

export function isReviewableTransactionOrigin(
  value: unknown,
): value is ReviewableTransactionOrigin {
  return (
    typeof value === "string" &&
    REVIEWABLE_TRANSACTION_ORIGINS.includes(
      value as ReviewableTransactionOrigin,
    )
  );
}

export interface TransactionEntryReadModel {
  id: string;
  /** Signed ledger effect: expense negative, income positive. */
  amountCents: string;
  status: "POSTED";
  postedOn: string;
}

export interface TransactionReversalReadModel {
  id: string;
  amountCents: string;
  origin: "SYSTEM";
  status: "POSTED";
  occurredOn: string;
}

export interface TransactionListItemReadModel {
  id: string;
  /** Informational legacy field; never accepted as client tenancy authority. */
  householdId: string;
  kind: ReviewableTransactionKind;
  status: ReviewableTransactionStatus;
  origin: ReviewableTransactionOrigin;
  /** Absolute event value; the signed effect is in `entry.amountCents`. */
  amountCents: string;
  occurredOn: string;
  description: string;
  accountId: string;
  categoryId: string | null;
  account: AccountReadModel;
  category: CategoryReadModel | null;
  entry: TransactionEntryReadModel;
  source: TransactionSource;
  reviewState: TransactionReviewState;
  reviewReason: TransactionReviewReason;
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionDetailReadModel extends TransactionListItemReadModel {
  reversal: TransactionReversalReadModel | null;
}

export interface TransactionListPageInfo {
  hasNextPage: boolean;
  nextCursor: string | null;
}

export interface TransactionListReadModel {
  items: TransactionListItemReadModel[];
  pageInfo: TransactionListPageInfo;
}

export interface TransactionReviewSummaryReadModel {
  needsReviewCount: number;
}

/** Compatibility aliases for consumers that use the shorter S05 vocabulary. */
export type ReviewableTransactionListItemReadModel =
  TransactionListItemReadModel;
export type ReviewableTransactionDetailReadModel = TransactionDetailReadModel;
export type ReviewableTransactionListReadModel = TransactionListReadModel;
export type ReviewableTransactionEntryReadModel = TransactionEntryReadModel;

export interface TransactionReviewProjection {
  reviewState: TransactionReviewState;
  reviewReason: TransactionReviewReason;
  needsReview: boolean;
}

/**
 * Single source of truth for state, reason and the convenience boolean used
 * by list/detail/summary implementations. The UI should consume this result.
 */
export function projectTransactionReview(
  status: ReviewableTransactionStatus,
  categoryId: string | null,
): TransactionReviewProjection {
  if (status === "CANCELLED") {
    return {
      reviewState: "NOT_APPLICABLE",
      reviewReason: null,
      needsReview: false,
    };
  }

  if (categoryId === null) {
    return {
      reviewState: "NEEDS_REVIEW",
      reviewReason: "UNCATEGORIZED",
      needsReview: true,
    };
  }

  return {
    reviewState: "ORGANIZED",
    reviewReason: null,
    needsReview: false,
  };
}

export const deriveTransactionReview = projectTransactionReview;
export const getTransactionReviewProjection = projectTransactionReview;

export interface ListReviewableTransactionsQuery {
  from?: string;
  to?: string;
  /** Filter hint only; the server revalidates it in the current household. */
  accountId?: string;
  categoryId?: string | null;
  kind?: ReviewableTransactionKind;
  status?: ReviewableTransactionStatus | "ALL";
  origin?: ReviewableTransactionOrigin | "ALL";
  review?: Exclude<TransactionReviewState, "NOT_APPLICABLE"> | "ALL";
  search?: string;
  limit?: number;
  cursor?: string;

  /** Legacy S03 date aliases accepted only for server-side canonicalization. */
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
}

export type ReviewableTransactionsQuery = ListReviewableTransactionsQuery;
export type TransactionReviewSummaryQuery = ListReviewableTransactionsQuery;

export interface NormalizedListReviewableTransactionsQuery {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string | null;
  kind?: ReviewableTransactionKind;
  status?: ReviewableTransactionStatus;
  origin?: ReviewableTransactionOrigin;
  review?: Exclude<TransactionReviewState, "NOT_APPLICABLE">;
  search?: string;
  limit: number;
  cursor?: string;
}

export type NormalizedReviewableTransactionsQuery =
  NormalizedListReviewableTransactionsQuery;

export type NormalizedTransactionReviewSummaryQuery = Omit<
  NormalizedListReviewableTransactionsQuery,
  "limit" | "cursor" | "review"
>;

const REVIEW_QUERY_KEYS = new Set([
  "from",
  "to",
  "accountId",
  "categoryId",
  "kind",
  "status",
  "origin",
  "review",
  "search",
  "limit",
  "cursor",
  "occurredOnFrom",
  "occurredOnTo",
  "dateFrom",
  "dateTo",
  "startDate",
  "endDate",
  "effectiveDateFrom",
  "effectiveDateTo",
  "periodStart",
  "periodEnd",
  "period",
]);

const PROTECTED_REVIEW_COMMAND_FIELDS = new Set([
  "householdId",
  "origin",
  "source",
  "kind",
  "status",
  "amountCents",
  "occurredOn",
  "accountId",
  "entry",
  "reversal",
  "reversalOfEventId",
  "importId",
  "rowNumber",
  "externalId",
  "token",
  "fingerprint",
  "CSV",
  "csv",
  "createdAt",
  "updatedAt",
]);

export type S05ErrorField =
  | "commandId"
  | "financialEventId"
  | "description"
  | "categoryId"
  | "accountId"
  | "from"
  | "to"
  | "kind"
  | "status"
  | "origin"
  | "review"
  | "search"
  | "limit"
  | "cursor";

export const S05_ERROR_CODES = [
  "UNAUTHENTICATED",
  "HOUSEHOLD_MEMBERSHIP_REQUIRED",
  "HOUSEHOLD_SELECTION_REQUIRED",
  "INVALID_FINANCIAL_CONTEXT",
  "INVALID_QUERY",
  "INVALID_CURSOR",
  "ACCOUNT_NOT_FOUND",
  "CATEGORY_NOT_FOUND",
  "EVENT_NOT_FOUND",
  "EVENT_NOT_REVIEWABLE",
  "IMPORT_LINEAGE_INVALID",
  "INVALID_COMMAND",
  "INVALID_COMMAND_ID",
  "RESOURCE_ARCHIVED",
  "CATEGORY_KIND_MISMATCH",
  "NON_EDITABLE_FIELD",
  "COMMAND_ID_REUSED",
] as const;
export type S05ErrorCode = (typeof S05_ERROR_CODES)[number];

export const S05_ERROR_MESSAGES: Readonly<Record<S05ErrorCode, string>> = {
  UNAUTHENTICATED: "É necessário entrar para acessar este recurso.",
  HOUSEHOLD_MEMBERSHIP_REQUIRED:
    "Não foi possível acessar o espaço financeiro atual.",
  HOUSEHOLD_SELECTION_REQUIRED:
    "Selecione um espaço financeiro para continuar.",
  INVALID_FINANCIAL_CONTEXT:
    "Não foi possível validar o contexto financeiro.",
  INVALID_QUERY: "Os filtros da consulta são inválidos.",
  INVALID_CURSOR: "O cursor da consulta é inválido.",
  ACCOUNT_NOT_FOUND: "A conta não foi encontrada.",
  CATEGORY_NOT_FOUND: "A categoria não foi encontrada.",
  EVENT_NOT_FOUND: "O lançamento não foi encontrado.",
  EVENT_NOT_REVIEWABLE: "O lançamento não pode ser revisado.",
  IMPORT_LINEAGE_INVALID: "A origem do lançamento não pôde ser validada.",
  INVALID_COMMAND: "Os dados da operação são inválidos.",
  INVALID_COMMAND_ID: "O identificador da operação é inválido.",
  RESOURCE_ARCHIVED: "O recurso está arquivado e não pode ser usado.",
  CATEGORY_KIND_MISMATCH:
    "A categoria precisa ter o mesmo tipo do lançamento.",
  NON_EDITABLE_FIELD: "Este campo não pode ser alterado nesta operação.",
  COMMAND_ID_REUSED: "O identificador da operação já foi utilizado.",
};

export interface S05Error {
  code: S05ErrorCode;
  message: string;
  field?: S05ErrorField;
}

export type S05Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: S05Error };

function statusForS05Error(code: S05ErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "HOUSEHOLD_MEMBERSHIP_REQUIRED":
    case "HOUSEHOLD_SELECTION_REQUIRED":
    case "INVALID_FINANCIAL_CONTEXT":
      return 403;
    case "ACCOUNT_NOT_FOUND":
    case "CATEGORY_NOT_FOUND":
    case "EVENT_NOT_FOUND":
      return 404;
    case "EVENT_NOT_REVIEWABLE":
    case "IMPORT_LINEAGE_INVALID":
    case "RESOURCE_ARCHIVED":
    case "CATEGORY_KIND_MISMATCH":
    case "NON_EDITABLE_FIELD":
    case "COMMAND_ID_REUSED":
      return 409;
    default:
      return 400;
  }
}

export class S05DomainError extends Error {
  readonly code: S05ErrorCode;
  readonly field: S05ErrorField | undefined;
  readonly status: number;
  readonly expected = true;

  constructor(code: S05ErrorCode, field?: S05ErrorField) {
    super(S05_ERROR_MESSAGES[code]);
    this.name = "S05DomainError";
    this.code = code;
    this.field = field;
    this.status = statusForS05Error(code);
  }

  toError(): S05Error {
    return {
      code: this.code,
      message: this.message,
      ...(this.field ? { field: this.field } : {}),
    };
  }
}

export const ReviewContractError = S05DomainError;

export function ok<T>(value: T): S05Result<T> {
  return { ok: true, value };
}

export function failure<T = never>(
  code: S05ErrorCode,
  field?: S05ErrorField,
): S05Result<T> {
  return { ok: false, error: new S05DomainError(code, field).toError() };
}

export const success = ok;
export const errorResult = failure;

function fieldFromPath(path: readonly (string | number)[]):
  | S05ErrorField
  | undefined {
  const field = path[0];
  switch (field) {
    case "commandId":
    case "financialEventId":
    case "description":
    case "categoryId":
    case "accountId":
    case "from":
    case "to":
    case "kind":
    case "status":
    case "origin":
    case "review":
    case "search":
    case "limit":
    case "cursor":
      return field;
    default:
      return undefined;
  }
}

function isS05ErrorCode(value: unknown): value is S05ErrorCode {
  return (
    typeof value === "string" &&
    S05_ERROR_CODES.includes(value as S05ErrorCode)
  );
}

export function toS05DomainError(
  error: unknown,
  fallback: S05ErrorCode = "INVALID_COMMAND",
): S05DomainError {
  if (error instanceof S05DomainError) {
    return error;
  }

  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    if (issue?.code === "unrecognized_keys") {
      const keys = "keys" in issue ? issue.keys : [];
      return new S05DomainError(
        keys.some((key) => PROTECTED_REVIEW_COMMAND_FIELDS.has(key))
          ? "NON_EDITABLE_FIELD"
          : fallback,
      );
    }
    const field = issue ? fieldFromPath(issue.path) : undefined;
    const code =
      field === "commandId" &&
      issue?.message === S05_ERROR_MESSAGES.INVALID_COMMAND_ID
        ? "INVALID_COMMAND_ID"
        : fallback;
    return new S05DomainError(code, field);
  }

  if (isPlainObject(error) && isS05ErrorCode(error.code)) {
    const field = fieldFromPath(
      typeof error.field === "string" ? [error.field] : [],
    );
    return new S05DomainError(error.code, field);
  }

  return new S05DomainError(fallback);
}

export function toS05Error(
  error: unknown,
  fallback: S05ErrorCode = "INVALID_COMMAND",
): S05Error {
  return toS05DomainError(error, fallback).toError();
}

export interface UpdateReviewableTransactionCommand {
  commandId: string;
  financialEventId: string;
  description?: string;
  categoryId?: string | null;
}

export const REVIEWABLE_TRANSACTION_UPDATE_OPERATION =
  "transactions.review.update" as const;
export const TRANSACTION_REVIEW_UPDATE_OPERATION =
  REVIEWABLE_TRANSACTION_UPDATE_OPERATION;
export const UPDATE_REVIEWABLE_TRANSACTION_OPERATION =
  REVIEWABLE_TRANSACTION_UPDATE_OPERATION;
export const REVIEWABLE_TRANSACTION_OPERATIONS = [
  REVIEWABLE_TRANSACTION_UPDATE_OPERATION,
] as const;

const commandIdSchema = z.string().transform((value, context) => {
  try {
    return normalizeCommandId(value);
  } catch {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: S05_ERROR_MESSAGES.INVALID_COMMAND_ID,
    });
    return z.NEVER;
  }
});

const descriptionCommandSchema = z.string().transform((value, context) => {
  const normalized = normalizeReviewDescriptionValue(value);
  if (normalized === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: S05_ERROR_MESSAGES.INVALID_COMMAND,
    });
    return z.NEVER;
  }
  return normalized;
});

const resourceUuidCommandSchema = z.string().transform((value, context) => {
  const normalized = value.trim();
  if (!isUuidV7(normalized)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: S05_ERROR_MESSAGES.INVALID_COMMAND,
    });
    return z.NEVER;
  }
  return normalized;
});

export const updateReviewableTransactionCommandSchema = z
  .object({
    commandId: commandIdSchema,
    financialEventId: resourceUuidCommandSchema,
    description: descriptionCommandSchema.optional(),
    categoryId: resourceUuidCommandSchema.nullable().optional(),
  })
  .strict()
  .superRefine((command, context) => {
    if (command.description === undefined && command.categoryId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ao menos um campo editável é obrigatório",
      });
    }
  });

export const updateReviewableTransactionSchema =
  updateReviewableTransactionCommandSchema;
export const reviewableTransactionUpdateCommandSchema =
  updateReviewableTransactionCommandSchema;

export function parseUpdateReviewableTransactionCommand(
  input: unknown,
): UpdateReviewableTransactionCommand {
  const result = updateReviewableTransactionCommandSchema.safeParse(input);
  if (!result.success) {
    throw toS05DomainError(result.error);
  }
  return result.data as UpdateReviewableTransactionCommand;
}

export function safeParseUpdateReviewableTransactionCommand(
  input: unknown,
): S05Result<UpdateReviewableTransactionCommand> {
  try {
    return ok(parseUpdateReviewableTransactionCommand(input));
  } catch (error) {
    return { ok: false, error: toS05Error(error) };
  }
}

export const validateUpdateReviewableTransactionCommand =
  safeParseUpdateReviewableTransactionCommand;

function scalarQueryValue(
  values: Record<string, unknown>,
  key: string,
  field: S05ErrorField = key as S05ErrorField,
): unknown {
  const value = values[key];
  if (
    Array.isArray(value) ||
    (typeof value === "object" && value !== null && key !== "period")
  ) {
    throw new S05DomainError("INVALID_QUERY", field);
  }
  return value;
}

function normalizeDateAliases(
  values: Record<string, unknown>,
  canonicalKey: "from" | "to",
): string | undefined {
  const aliases =
    canonicalKey === "from"
      ? [
          "from",
          "occurredOnFrom",
          "dateFrom",
          "startDate",
          "effectiveDateFrom",
          "periodStart",
          "__periodFrom",
        ]
      : [
          "to",
          "occurredOnTo",
          "dateTo",
          "endDate",
          "effectiveDateTo",
          "periodEnd",
          "__periodTo",
        ];

  const normalizedValues: string[] = [];
  for (const alias of aliases) {
    const value = scalarQueryValue(values, alias, canonicalKey);
    if (value === undefined) {
      continue;
    }
    normalizedValues.push(normalizeIsoDate(value, canonicalKey));
  }

  if (normalizedValues.length === 0) {
    return undefined;
  }

  const first = normalizedValues[0];
  if (normalizedValues.some((value) => value !== first)) {
    throw new S05DomainError("INVALID_QUERY", canonicalKey);
  }
  return first;
}

function addPeriodAliases(values: Record<string, unknown>): Record<string, unknown> {
  const rawPeriod = scalarQueryValue(values, "period");
  if (rawPeriod === undefined) {
    return values;
  }
  if (!isPlainObject(rawPeriod)) {
    throw new S05DomainError("INVALID_QUERY");
  }

  for (const key of Object.keys(rawPeriod)) {
    if (key !== "from" && key !== "to") {
      throw new S05DomainError("INVALID_QUERY");
    }
  }

  return {
    ...values,
    ...(rawPeriod.from === undefined ? {} : { __periodFrom: rawPeriod.from }),
    ...(rawPeriod.to === undefined ? {} : { __periodTo: rawPeriod.to }),
  };
}

function normalizeOptionalQueryId(
  values: Record<string, unknown>,
  key: "accountId" | "categoryId",
): string | null | undefined {
  const value = scalarQueryValue(values, key, key);
  if (value === undefined) {
    return undefined;
  }
  if (key === "categoryId" && value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new S05DomainError("INVALID_QUERY", key);
  }

  const normalized = value.trim();
  if (key === "categoryId" && normalized === "__none") {
    return null;
  }
  if (normalized.length === 0 || normalized === "null") {
    throw new S05DomainError("INVALID_QUERY", key);
  }
  if (!isUuidV7(normalized)) {
    throw new S05DomainError("INVALID_QUERY", key);
  }
  return normalized;
}

function normalizeEnumFilter<T extends string>(
  values: Record<string, unknown>,
  key: S05ErrorField,
  allowed: readonly T[],
): T | undefined {
  const value = scalarQueryValue(values, key, key);
  if (value === undefined || value === "ALL") {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new S05DomainError("INVALID_QUERY", key);
  }
  return value as T;
}

function normalizeReviewFilter(
  values: Record<string, unknown>,
): NormalizedListReviewableTransactionsQuery["review"] {
  const value = scalarQueryValue(values, "review", "review");
  if (value === undefined || value === "ALL") {
    return undefined;
  }
  if (value !== "NEEDS_REVIEW" && value !== "ORGANIZED") {
    throw new S05DomainError("INVALID_QUERY", "review");
  }
  return value;
}

function normalizeLimitValue(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_REVIEW_PAGE_LIMIT;
  }

  let candidate: number;
  if (typeof value === "number") {
    candidate = value;
  } else if (typeof value === "string" && /^\d+$/u.test(value)) {
    candidate = Number(value);
  } else {
    throw new S05DomainError("INVALID_QUERY", "limit");
  }

  if (
    !Number.isSafeInteger(candidate) ||
    candidate < 1 ||
    candidate > MAX_REVIEW_PAGE_LIMIT
  ) {
    throw new S05DomainError("INVALID_QUERY", "limit");
  }
  return candidate;
}

function normalizeQueryObject(input: unknown): Record<string, unknown> {
  if (!isPlainObject(input)) {
    throw new S05DomainError("INVALID_QUERY");
  }
  const values = input;
  for (const key of Object.keys(values)) {
    if (!REVIEW_QUERY_KEYS.has(key)) {
      throw new S05DomainError("INVALID_QUERY");
    }
  }
  return values;
}

interface NormalizeQueryOptions {
  validateCursor: boolean;
  includePagination: boolean;
}

function normalizeQuery(
  input: unknown,
  options: NormalizeQueryOptions,
): NormalizedListReviewableTransactionsQuery {
  const original = normalizeQueryObject(input);
  const values = addPeriodAliases(original);
  const from = normalizeDateAliases(values, "from");
  const to = normalizeDateAliases(values, "to");

  if (from !== undefined && to !== undefined && from > to) {
    throw new S05DomainError("INVALID_QUERY");
  }

  const accountIdValue = normalizeOptionalQueryId(values, "accountId");
  if (accountIdValue === null) {
    throw new S05DomainError("INVALID_QUERY", "accountId");
  }
  const accountId = accountIdValue;
  const categoryId = normalizeOptionalQueryId(values, "categoryId");
  const kind = normalizeEnumFilter(
    values,
    "kind",
    REVIEWABLE_TRANSACTION_KINDS,
  );
  const status = normalizeEnumFilter(
    values,
    "status",
    REVIEWABLE_TRANSACTION_STATUSES,
  );
  const origin = normalizeEnumFilter(
    values,
    "origin",
    REVIEWABLE_TRANSACTION_ORIGINS,
  );
  const review = normalizeReviewFilter(values);

  const rawSearch = scalarQueryValue(values, "search", "search");
  const search =
    rawSearch === undefined ? undefined : normalizeReviewSearch(rawSearch);

  const rawLimit = scalarQueryValue(values, "limit", "limit");
  const limit = options.includePagination
    ? normalizeLimitValue(rawLimit)
    : DEFAULT_REVIEW_PAGE_LIMIT;

  const rawCursor = scalarQueryValue(values, "cursor", "cursor");
  let cursor: string | undefined;
  if (options.includePagination && rawCursor !== undefined) {
    if (typeof rawCursor !== "string" || rawCursor.length === 0) {
      throw new S05DomainError("INVALID_CURSOR", "cursor");
    }
    cursor = rawCursor;
  } else if (options.includePagination && rawCursor === undefined) {
    cursor = undefined;
  }

  const normalized: NormalizedListReviewableTransactionsQuery = {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(accountId === undefined ? {} : { accountId }),
    ...(categoryId === undefined ? {} : { categoryId }),
    ...(kind === undefined ? {} : { kind }),
    ...(status === undefined ? {} : { status }),
    ...(origin === undefined ? {} : { origin }),
    ...(review === undefined ? {} : { review }),
    ...(search === undefined ? {} : { search }),
    limit,
    ...(cursor === undefined ? {} : { cursor }),
  };

  if (options.validateCursor && cursor !== undefined) {
    const expectedFilterHash = hashNormalizedReviewFilters(normalized);
    decodeReviewCursor(cursor, {
      expectedFilterHash,
      expectedLimit: normalized.limit,
    });
  }

  return normalized;
}

/** Canonicalizes URL/query input and rejects unknown fields and invalid values. */
export function parseListReviewableTransactionsQuery(
  input: unknown = {},
): NormalizedListReviewableTransactionsQuery {
  return normalizeQuery(input, {
    validateCursor: true,
    includePagination: true,
  });
}

export const normalizeListReviewableTransactionsQuery =
  parseListReviewableTransactionsQuery;
export const parseReviewableTransactionsQuery =
  parseListReviewableTransactionsQuery;

export function safeParseListReviewableTransactionsQuery(
  input: unknown = {},
): S05Result<NormalizedListReviewableTransactionsQuery> {
  try {
    return ok(parseListReviewableTransactionsQuery(input));
  } catch (error) {
    return { ok: false, error: toS05Error(error, "INVALID_QUERY") };
  }
}

/**
 * Summary intentionally ignores pagination and review selection. It still
 * rejects unknown/non-scalar query fields, while cursor/limit/review are not
 * used to change the count.
 */
export function parseTransactionReviewSummaryQuery(
  input: unknown = {},
): NormalizedTransactionReviewSummaryQuery {
  const normalized = normalizeQuery(input, {
    validateCursor: false,
    includePagination: false,
  });
  return Object.fromEntries(
    Object.entries(normalized).filter(
      ([key]) => key !== "limit" && key !== "cursor" && key !== "review",
    ),
  ) as NormalizedTransactionReviewSummaryQuery;
}

export const parseReviewSummaryQuery = parseTransactionReviewSummaryQuery;
export const normalizeTransactionReviewSummaryQuery =
  parseTransactionReviewSummaryQuery;

export function safeParseTransactionReviewSummaryQuery(
  input: unknown = {},
): S05Result<NormalizedTransactionReviewSummaryQuery> {
  try {
    return ok(parseTransactionReviewSummaryQuery(input));
  } catch (error) {
    return { ok: false, error: toS05Error(error, "INVALID_QUERY") };
  }
}

export interface CanonicalReviewFilterSet {
  from: string | null;
  to: string | null;
  accountId: string | null;
  /** `__any` means no category predicate; `__none` means category IS NULL. */
  categoryId: string | "__any" | "__none";
  kind: ReviewableTransactionKind | null;
  status: ReviewableTransactionStatus | "ALL";
  origin: ReviewableTransactionOrigin | "ALL";
  review: Exclude<TransactionReviewState, "NOT_APPLICABLE"> | "ALL";
  search: string | null;
  limit: number;
}

export function canonicalReviewFilterSet(
  query: ListReviewableTransactionsQuery | NormalizedListReviewableTransactionsQuery,
): CanonicalReviewFilterSet {
  const normalized = normalizeQuery(query, {
    validateCursor: false,
    includePagination: true,
  });
  return {
    from: normalized.from ?? null,
    to: normalized.to ?? null,
    accountId: normalized.accountId ?? null,
    categoryId:
      normalized.categoryId === undefined
        ? "__any"
        : normalized.categoryId === null
          ? "__none"
          : normalized.categoryId,
    kind: normalized.kind ?? null,
    status: normalized.status ?? "ALL",
    origin: normalized.origin ?? "ALL",
    review: normalized.review ?? "ALL",
    search: normalized.search ?? null,
    limit: normalized.limit,
  };
}

export function serializeCanonicalReviewFilters(
  query: ListReviewableTransactionsQuery | NormalizedListReviewableTransactionsQuery,
): string {
  return JSON.stringify(canonicalReviewFilterSet(query));
}

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/*
 * A small synchronous SHA-256 implementation keeps this shared contract
 * usable by browser adapters as well as server reads. It hashes only the
 * canonical filter framing; the digest is not an authorization credential.
 */
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function sha256Hex(value: string): string {
  const input = new TextEncoder().encode(value);
  const bitLength = input.byteLength * 8;
  const paddedLength = Math.ceil((input.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = new Uint32Array(64);
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rightRotate(words[index - 15], 7) ^
        rightRotate(words[index - 15], 18) ^
        (words[index - 15] >>> 3);
      const s1 =
        rightRotate(words[index - 2], 17) ^
        rightRotate(words[index - 2], 19) ^
        (words[index - 2] >>> 10);
      words[index] =
        (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let index = 0; index < 64; index += 1) {
      const S1 =
        rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h + S1 + choice + SHA256_K[index] + words[index]) >>> 0;
      const S0 =
        rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (S0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((part) => part.toString(16).padStart(8, "0"))
    .join("");
}

function hashNormalizedReviewFilters(
  query: NormalizedListReviewableTransactionsQuery,
): string {
  return sha256Hex(serializeCanonicalReviewFilters(query));
}

export function hashReviewableTransactionFilters(
  query: ListReviewableTransactionsQuery | NormalizedListReviewableTransactionsQuery,
): string {
  return hashNormalizedReviewFilters(
    normalizeQuery(query, {
      validateCursor: false,
      includePagination: true,
    }),
  );
}

export const hashReviewFilters = hashReviewableTransactionFilters;
export const computeReviewFilterHash = hashReviewableTransactionFilters;
export const reviewFilterHash = hashReviewableTransactionFilters;

export interface ReviewCursorV1 {
  v: 1;
  occurredOn: string;
  id: string;
  filterHash: string;
  limit: number;
}

export interface ReviewCursorExpectation {
  expectedFilterHash?: string;
  expectedLimit?: number;
}

export type ReviewCursorExpectedQuery =
  | ReviewCursorExpectation
  | ListReviewableTransactionsQuery
  | NormalizedListReviewableTransactionsQuery;

function normalizeCursorExpectation(
  expectation: ReviewCursorExpectedQuery | undefined,
): ReviewCursorExpectation | undefined {
  if (expectation === undefined) {
    return undefined;
  }

  if (
    isPlainObject(expectation) &&
    ("expectedFilterHash" in expectation || "expectedLimit" in expectation)
  ) {
    return {
      expectedFilterHash:
        typeof expectation.expectedFilterHash === "string"
          ? expectation.expectedFilterHash
          : undefined,
      expectedLimit:
        typeof expectation.expectedLimit === "number"
          ? expectation.expectedLimit
          : undefined,
    };
  }

  const normalized = normalizeQuery(expectation, {
    validateCursor: false,
    includePagination: true,
  });
  return {
    expectedFilterHash: hashNormalizedReviewFilters(normalized),
    expectedLimit: normalized.limit,
  };
}

function validateCursorPayload(
  input: unknown,
  requireCanonicalKeyOrder = false,
): ReviewCursorV1 {
  if (!isPlainObject(input)) {
    throw new S05DomainError("INVALID_CURSOR", "cursor");
  }

  const expectedKeys = ["v", "occurredOn", "id", "filterHash", "limit"];
  const keys = Object.keys(input);
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !keys.includes(key)) ||
    (requireCanonicalKeyOrder &&
      expectedKeys.some((key, index) => keys[index] !== key))
  ) {
    throw new S05DomainError("INVALID_CURSOR", "cursor");
  }

  if (input.v !== REVIEW_CURSOR_VERSION) {
    throw new S05DomainError("INVALID_CURSOR", "cursor");
  }
  const occurredOn = normalizeIsoDate(input.occurredOn, "cursor");
  const id = normalizeUuid(input.id, "cursor");
  if (
    typeof input.filterHash !== "string" ||
    !FILTER_HASH_PATTERN.test(input.filterHash)
  ) {
    throw new S05DomainError("INVALID_CURSOR", "cursor");
  }
  if (
    typeof input.limit !== "number" ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_REVIEW_PAGE_LIMIT
  ) {
    throw new S05DomainError("INVALID_CURSOR", "cursor");
  }

  return {
    v: REVIEW_CURSOR_VERSION,
    occurredOn,
    id,
    filterHash: input.filterHash,
    limit: input.limit,
  };
}

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeBase64Url(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : undefined;
    const third = index + 2 < bytes.length ? bytes[index + 2] : undefined;
    output += BASE64URL_ALPHABET[first >>> 2];
    output += BASE64URL_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >>> 4)];
    if (second !== undefined) {
      output += BASE64URL_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >>> 6)];
    }
    if (third !== undefined) {
      output += BASE64URL_ALPHABET[third & 0x3f];
    }
  }
  return output;
}

function decodeBase64Url(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length > MAX_REVIEW_CURSOR_BYTES ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new S05DomainError("INVALID_CURSOR", "cursor");
  }

  const output: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of value) {
    buffer = (buffer << 6) | BASE64URL_ALPHABET.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >>> bits) & 0xff);
    }
  }

  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new S05DomainError("INVALID_CURSOR", "cursor");
  }
  return new Uint8Array(output);
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new S05DomainError("INVALID_CURSOR", "cursor");
  }
}

export function encodeReviewCursor(input: ReviewCursorV1): string {
  const payload = validateCursorPayload(input);
  const json = JSON.stringify(payload);
  const encoded = encodeBase64Url(new TextEncoder().encode(json));
  if (encoded.length > MAX_REVIEW_CURSOR_BYTES) {
    throw new S05DomainError("INVALID_CURSOR", "cursor");
  }
  return encoded;
}

export function decodeReviewCursor(
  value: unknown,
  expectation?: ReviewCursorExpectedQuery,
): ReviewCursorV1 {
  if (typeof value !== "string") {
    throw new S05DomainError("INVALID_CURSOR", "cursor");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decodeUtf8(decodeBase64Url(value))) as unknown;
  } catch (error) {
    if (error instanceof S05DomainError) {
      throw error;
    }
    throw new S05DomainError("INVALID_CURSOR", "cursor");
  }
  const cursor = validateCursorPayload(payload, true);
  const expected = normalizeCursorExpectation(expectation);
  if (
    expected?.expectedFilterHash !== undefined &&
    cursor.filterHash !== expected.expectedFilterHash
  ) {
    throw new S05DomainError("INVALID_CURSOR", "cursor");
  }
  if (
    expected?.expectedLimit !== undefined &&
    cursor.limit !== expected.expectedLimit
  ) {
    throw new S05DomainError("INVALID_CURSOR", "cursor");
  }
  return cursor;
}

export const parseReviewCursor = decodeReviewCursor;
export const decodeTransactionReviewCursor = decodeReviewCursor;

export function createReviewCursor(
  position: Pick<ReviewCursorV1, "occurredOn" | "id">,
  query: ListReviewableTransactionsQuery | NormalizedListReviewableTransactionsQuery,
): string {
  const normalized = normalizeQuery(query, {
    validateCursor: false,
    includePagination: true,
  });
  return encodeReviewCursor({
    v: REVIEW_CURSOR_VERSION,
    occurredOn: position.occurredOn,
    id: position.id,
    filterHash: hashNormalizedReviewFilters(normalized),
    limit: normalized.limit,
  });
}

export const buildReviewCursor = createReviewCursor;
export const makeReviewCursor = createReviewCursor;

export const transactionEntryReadModelSchema = z
  .object({
    id: uuidV7StringSchema,
    amountCents: z.string().refine((value) => SIGNED_CENTS_PATTERN.test(value)),
    status: z.literal("POSTED"),
    postedOn: z.string().refine(isValidCivilDateString),
  })
  .strict();

export const transactionReversalReadModelSchema = z
  .object({
    id: uuidV7StringSchema,
    amountCents: z.string().refine((value) => ABSOLUTE_CENTS_PATTERN.test(value)),
    origin: z.literal("SYSTEM"),
    status: z.literal("POSTED"),
    occurredOn: z.string().refine(isValidCivilDateString),
  })
  .strict();

const accountReadModelSchema = z
  .object({
    id: uuidV7StringSchema,
    householdId: uuidV7StringSchema,
    name: z.string().min(1).max(120),
    type: z.enum(ACCOUNT_TYPES),
    status: z.enum(ACCOUNT_STATUSES),
    spendability: z.enum(SPENDABILITIES),
    liquidity: z.enum(LIQUIDITIES),
    includeInNetWorth: z.boolean(),
    trackingStartedOn: z
      .string()
      .refine(isValidCivilDateString)
      .nullable(),
    createdAt: z.string().refine(isValidIsoTimestamp),
    updatedAt: z.string().refine(isValidIsoTimestamp),
  })
  .strict();

const categoryReadModelSchema = z
  .object({
    id: uuidV7StringSchema,
    householdId: uuidV7StringSchema,
    name: z.string().min(1).max(120),
    parentId: uuidV7StringSchema.nullable(),
    kind: z.enum(CATEGORY_KINDS),
    status: z.enum(ACCOUNT_STATUSES),
    createdAt: z.string().refine(isValidIsoTimestamp),
    updatedAt: z.string().refine(isValidIsoTimestamp),
  })
  .strict();

const transactionListItemBaseSchema = z
  .object({
    id: uuidV7StringSchema,
    householdId: uuidV7StringSchema,
    kind: z.enum(REVIEWABLE_TRANSACTION_KINDS),
    status: z.enum(REVIEWABLE_TRANSACTION_STATUSES),
    origin: z.enum(REVIEWABLE_TRANSACTION_ORIGINS),
    amountCents: z.string().refine((value) => ABSOLUTE_CENTS_PATTERN.test(value)),
    occurredOn: z.string().refine(isValidCivilDateString),
    description: z
      .string()
      .min(1)
      .refine((value) => codePointLength(value) <= 240)
      .refine((value) => !CONTROL_OR_FORMAT_CHARACTER.test(value)),
    accountId: uuidV7StringSchema,
    categoryId: uuidV7StringSchema.nullable(),
    account: accountReadModelSchema,
    category: categoryReadModelSchema.nullable(),
    entry: transactionEntryReadModelSchema,
    source: transactionSourceSchema,
    reviewState: transactionReviewStateSchema,
    reviewReason: transactionReviewReasonSchema,
    needsReview: z.boolean(),
    createdAt: z.string().refine(isValidIsoTimestamp),
    updatedAt: z.string().refine(isValidIsoTimestamp),
  })
  .strict();

function addTransactionListItemConsistencyIssues(
  item: z.infer<typeof transactionListItemBaseSchema>,
  context: z.RefinementCtx,
): void {
    if (item.origin !== item.source.origin) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message: "origem inconsistente",
      });
    }
    if (item.account.id !== item.accountId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accountId"],
        message: "conta inconsistente",
      });
    }
    if (item.account.householdId !== item.householdId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["account"],
        message: "contexto inconsistente",
      });
    }
    if (
      item.category !== null &&
      (item.category.id !== item.categoryId ||
        item.category.householdId !== item.householdId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["category"],
        message: "categoria inconsistente",
      });
    }

    const expected = projectTransactionReview(item.status, item.categoryId);
    if (
      item.reviewState !== expected.reviewState ||
      item.reviewReason !== expected.reviewReason ||
      item.needsReview !== expected.needsReview
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewState"],
        message: "estado de revisão inconsistente",
      });
    }
}

export const transactionListItemReadModelSchema = transactionListItemBaseSchema
  .superRefine(addTransactionListItemConsistencyIssues);
export const reviewableTransactionListItemReadModelSchema =
  transactionListItemReadModelSchema;

export const transactionDetailReadModelSchema = transactionListItemBaseSchema
  .extend({
    reversal: transactionReversalReadModelSchema.nullable(),
  })
  .strict()
  .superRefine((item, context) => {
    addTransactionListItemConsistencyIssues(item, context);
  });

export const reviewableTransactionDetailReadModelSchema =
  transactionDetailReadModelSchema;

export const transactionListPageInfoSchema = z
  .object({
    hasNextPage: z.boolean(),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const transactionListReadModelSchema = z
  .object({
    items: z.array(transactionListItemReadModelSchema),
    pageInfo: transactionListPageInfoSchema,
  })
  .strict();

export const transactionReviewSummaryReadModelSchema = z
  .object({
    needsReviewCount: z.number().int().nonnegative(),
  })
  .strict();

export const reviewCursorV1Schema = z
  .object({
    v: z.literal(REVIEW_CURSOR_VERSION),
    occurredOn: z.string(),
    id: z.string(),
    filterHash: z.string(),
    limit: z.number().int().min(1).max(MAX_REVIEW_PAGE_LIMIT),
  })
  .strict()
  .superRefine((value, context) => {
    if (!isValidCivilDateString(value.occurredOn)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["occurredOn"],
        message: "data inválida",
      });
    }
    if (!isUuidV7(value.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "identificador inválido",
      });
    }
    if (!FILTER_HASH_PATTERN.test(value.filterHash)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filterHash"],
        message: "hash inválido",
      });
    }
  });

export function parseReviewCursorV1(input: unknown): ReviewCursorV1 {
  return validateCursorPayload(input);
}

export function safeParseReviewCursorV1(
  input: unknown,
): S05Result<ReviewCursorV1> {
  try {
    return ok(parseReviewCursorV1(input));
  } catch (error) {
    return { ok: false, error: toS05Error(error, "INVALID_CURSOR") };
  }
}

export type ReviewCursor = ReviewCursorV1;
export const reviewCursorSchema = reviewCursorV1Schema;
export const transactionReviewCursorSchema = reviewCursorV1Schema;
export const pageInfoSchema = transactionListPageInfoSchema;
export const reviewableTransactionListReadModelSchema =
  transactionListReadModelSchema;
export const listReviewableTransactionsReadModelSchema =
  transactionListReadModelSchema;
export const reviewSummaryReadModelSchema =
  transactionReviewSummaryReadModelSchema;
export const transactionReviewSummarySchema =
  transactionReviewSummaryReadModelSchema;

export const encodeCursor = encodeReviewCursor;
export const decodeCursor = decodeReviewCursor;
export const serializeReviewCursor = encodeReviewCursor;

export const listReviewableTransactionsQuerySchema = z
  .unknown()
  .transform((input, context) => {
    try {
      return parseListReviewableTransactionsQuery(input);
    } catch (error) {
      const safe = toS05Error(error, "INVALID_QUERY");
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: safe.message,
      });
      return z.NEVER;
    }
  });

export const reviewableTransactionsQuerySchema =
  listReviewableTransactionsQuerySchema;

export function parseReviewReadModel<T>(
  schema: z.ZodType<T>,
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new S05DomainError("INVALID_COMMAND");
  }
  return result.data;
}

export { accountReadModelSchema, categoryReadModelSchema };
