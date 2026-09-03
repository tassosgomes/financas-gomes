import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

import {
  BUDGET_ERROR_MESSAGES,
  BUDGET_MOVEMENT_KINDS,
  BUDGET_STATUSES,
  BudgetDomainError,
  type BudgetBalanceBoundary,
  type BudgetBoundary,
  type BudgetDateInput,
  type BudgetErrorCode,
  type BudgetMovementBoundary,
  type BudgetProgressBoundary,
  type BudgetPeriodBoundary,
  type BudgetStatus,
} from "./contracts";
import { FinancialContextError } from "@/modules/households/contracts";
import { parseBudgetDate, serializeBudgetDate } from "./domain";

export const DEFAULT_BUDGET_PAGE_LIMIT = 25;
export const MAX_BUDGET_PAGE_LIMIT = 100;
export const DEFAULT_BUDGET_HISTORY_LIMIT = 50;
export const MAX_BUDGET_HISTORY_LIMIT = 100;

export const BUDGET_READ_ERROR_CODES = [
  "FINANCIAL_CONTEXT_REQUIRED",
  "INVALID_QUERY",
  "INVALID_CURSOR",
  "BUDGET_NOT_FOUND",
  "CATEGORY_NOT_FOUND",
  "QUERY_FAILED",
] as const;

export type BudgetReadErrorCode = (typeof BUDGET_READ_ERROR_CODES)[number];

export type BudgetReadErrorField =
  | "asOf"
  | "from"
  | "to"
  | "status"
  | "limit"
  | "cursor"
  | "budgetReferenceId"
  | "categoryId";

const BUDGET_READ_ERROR_MESSAGES: Readonly<
  Record<BudgetReadErrorCode, string>
> = {
  FINANCIAL_CONTEXT_REQUIRED: BUDGET_ERROR_MESSAGES.FINANCIAL_CONTEXT_REQUIRED,
  INVALID_QUERY: "Os filtros da consulta de Caixinhas são inválidos.",
  INVALID_CURSOR: "O cursor da consulta de Caixinhas é inválido.",
  BUDGET_NOT_FOUND: BUDGET_ERROR_MESSAGES.BUDGET_NOT_FOUND,
  CATEGORY_NOT_FOUND: BUDGET_ERROR_MESSAGES.CATEGORY_NOT_FOUND,
  QUERY_FAILED: BUDGET_ERROR_MESSAGES.QUERY_FAILED,
};

const BUDGET_READ_ERROR_STATUS: Readonly<Record<BudgetReadErrorCode, number>> = {
  FINANCIAL_CONTEXT_REQUIRED: 401,
  INVALID_QUERY: 400,
  INVALID_CURSOR: 400,
  BUDGET_NOT_FOUND: 404,
  CATEGORY_NOT_FOUND: 404,
  QUERY_FAILED: 500,
};

/** Safe, stable error for the read boundary. Technical details never escape. */
export class BudgetReadError extends Error {
  readonly code: BudgetReadErrorCode;
  readonly field: BudgetReadErrorField | undefined;
  readonly status: number;
  readonly expected = true;

  constructor(code: BudgetReadErrorCode, field?: BudgetReadErrorField) {
    super(BUDGET_READ_ERROR_MESSAGES[code]);
    this.name = "BudgetReadError";
    this.code = code;
    this.field = field;
    this.status = BUDGET_READ_ERROR_STATUS[code];
  }

  toError(): BudgetReadErrorBoundary {
    return {
      code: this.code,
      message: this.message,
      ...(this.field === undefined ? {} : { field: this.field }),
    };
  }
}

export interface BudgetReadErrorBoundary {
  readonly code: BudgetReadErrorCode;
  readonly message: string;
  readonly field?: BudgetReadErrorField;
}

export type BudgetReadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: BudgetReadErrorBoundary };

export function budgetReadOk<T>(value: T): BudgetReadResult<T> {
  return { ok: true, value };
}

export function budgetReadFailure<T = never>(
  code: BudgetReadErrorCode,
  field?: BudgetReadErrorField,
): BudgetReadResult<T> {
  return { ok: false, error: new BudgetReadError(code, field).toError() };
}

export const readOk = budgetReadOk;
export const readFailure = budgetReadFailure;

export type BudgetStatusFilter = BudgetStatus | "ALL";

export interface ListBudgetsQuery {
  readonly status?: BudgetStatusFilter;
  readonly asOf?: string;
  readonly limit?: number | string;
  readonly cursor?: string;
}

export interface ListBudgetMovementsQuery {
  readonly asOf?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number | string;
  readonly cursor?: string;
}

export type GetBudgetQuery = ListBudgetMovementsQuery;

export interface NormalizedListBudgetsQuery {
  readonly status: BudgetStatusFilter;
  readonly asOf: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface NormalizedListBudgetMovementsQuery {
  readonly asOf: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit: number;
  readonly cursor?: string;
}

export type NormalizedGetBudgetQuery = NormalizedListBudgetMovementsQuery;

export interface BudgetPageInfo {
  readonly hasNextPage: boolean;
  readonly nextCursor: string | null;
}

export interface BudgetCategoryReadModel {
  readonly referenceId: string;
  readonly name: string;
  readonly parentReferenceId: string | null;
  readonly kind: "EXPENSE" | "INCOME";
  readonly status: "ACTIVE" | "ARCHIVED";
}

export interface BudgetAllocationRuleReadModel {
  readonly referenceId: string;
  readonly budgetReferenceId: string;
  readonly boxReferenceId: string;
  readonly amountCents: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
}

/** One list item combines configuration with values derived at the cutoff. */
export interface BudgetListItemReadModel extends BudgetBoundary {
  readonly category: BudgetCategoryReadModel | null;
  readonly balance: BudgetBalanceBoundary;
  readonly progress: BudgetProgressBoundary;
  /** Current month summary at the same server-owned `asOf` cutoff as balance. */
  readonly period: BudgetPeriodBoundary | null;
}

export interface BudgetMovementPageReadModel {
  readonly items: readonly BudgetMovementBoundary[];
  readonly pageInfo: BudgetPageInfo;
}

export interface BudgetHistoryReadModel {
  readonly boxReferenceId: string;
  readonly asOf: string;
  readonly balance: BudgetBalanceBoundary;
  readonly period: BudgetPeriodBoundary | null;
  readonly movements: BudgetMovementPageReadModel;
}

export interface BudgetDetailReadModel extends BudgetListItemReadModel {
  readonly period: BudgetPeriodBoundary | null;
  readonly movements: readonly BudgetMovementBoundary[];
  readonly movementPageInfo: BudgetPageInfo;
  readonly allocationRules: readonly BudgetAllocationRuleReadModel[];
}

export interface ListBudgetsReadModel {
  readonly items: readonly BudgetListItemReadModel[];
  readonly pageInfo: BudgetPageInfo;
}

export type BudgetListReadModel = ListBudgetsReadModel;
export type BudgetReadModel = BudgetDetailReadModel;
export type BudgetHistoryPageReadModel = BudgetHistoryReadModel;

export interface BudgetReadClock {
  readonly today?: string | Temporal.PlainDate;
  readonly clock?: () => string | Temporal.PlainDate;
}

export interface BudgetReadDependencies extends BudgetReadClock {
  readonly database?: unknown;
}

export interface BudgetListCursorV1 {
  readonly v: 1;
  readonly activeFrom: string;
  readonly id: string;
  readonly filterHash: string;
  readonly limit: number;
}

export interface BudgetMovementCursorV1 {
  readonly v: 1;
  readonly effectiveOn: string;
  readonly id: string;
  readonly filterHash: string;
  readonly limit: number;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HASH_PATTERN = /^[0-9a-f]{16}$/u;
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function failQuery(field?: BudgetReadErrorField): never {
  throw new BudgetReadError("INVALID_QUERY", field);
}

function failCursor(): never {
  throw new BudgetReadError("INVALID_CURSOR", "cursor");
}

function normalizeDate(value: unknown, field: "asOf" | "from" | "to"): string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return failQuery(field);
  }
  try {
    return serializeBudgetDate(parseBudgetDate(value, field));
  } catch {
    return failQuery(field);
  }
}

export function normalizeBudgetReadDate(
  value: BudgetDateInput,
  field: "asOf" | "from" | "to" = "asOf",
): string {
  try {
    return serializeBudgetDate(parseBudgetDate(value, field));
  } catch {
    return failQuery(field);
  }
}

function normalizeLimit(
  value: unknown,
  defaultValue: number,
  maximum: number,
): number {
  if (value === undefined) return defaultValue;
  const candidate =
    typeof value === "string" && /^\d+$/u.test(value.trim())
      ? Number(value.trim())
      : value;
  if (
    typeof candidate !== "number" ||
    !Number.isSafeInteger(candidate) ||
    candidate < 1 ||
    candidate > maximum
  ) {
    return failQuery("limit");
  }
  return candidate;
}

function normalizeCursor(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    return failQuery("cursor");
  }
  return value;
}

function ensureAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return failQuery();
  }
}

function normalizeStatus(value: unknown): BudgetStatusFilter {
  if (value === undefined) return "ACTIVE";
  if (
    value !== "ALL" &&
    !BUDGET_STATUSES.includes(value as BudgetStatus)
  ) {
    return failQuery("status");
  }
  return value as BudgetStatusFilter;
}

function normalizeDateDefault(
  value: unknown,
  fallback: string | Temporal.PlainDate | undefined,
  field: "asOf",
): string {
  if (value !== undefined) return normalizeDate(value, field);
  if (fallback === undefined) return failQuery(field);
  return normalizeBudgetReadDate(fallback, field);
}

export function normalizeListBudgetsQuery(
  input: unknown = {},
  defaults: BudgetReadClock = {},
): NormalizedListBudgetsQuery {
  if (!isPlainRecord(input)) return failQuery();
  ensureAllowedKeys(input, ["status", "asOf", "limit", "cursor"]);
  const fallback = defaults.clock?.() ?? defaults.today;
  const normalized: NormalizedListBudgetsQuery = {
    status: normalizeStatus(input.status),
    asOf: normalizeDateDefault(input.asOf, fallback, "asOf"),
    limit: normalizeLimit(
      input.limit,
      DEFAULT_BUDGET_PAGE_LIMIT,
      MAX_BUDGET_PAGE_LIMIT,
    ),
    ...(normalizeCursor(input.cursor) === undefined
      ? {}
      : { cursor: normalizeCursor(input.cursor) }),
  };
  return normalized;
}

export function normalizeListBudgetMovementsQuery(
  input: unknown = {},
  defaults: BudgetReadClock = {},
): NormalizedListBudgetMovementsQuery {
  if (!isPlainRecord(input)) return failQuery();
  ensureAllowedKeys(input, ["asOf", "from", "to", "limit", "cursor"]);
  const fallback = defaults.clock?.() ?? defaults.today;
  const asOf = normalizeDateDefault(input.asOf, fallback, "asOf");
  const from =
    input.from === undefined ? undefined : normalizeDate(input.from, "from");
  const to = input.to === undefined ? undefined : normalizeDate(input.to, "to");
  if (from !== undefined && to !== undefined && from > to) {
    return failQuery("from");
  }
  return {
    asOf,
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    limit: normalizeLimit(
      input.limit,
      DEFAULT_BUDGET_HISTORY_LIMIT,
      MAX_BUDGET_HISTORY_LIMIT,
    ),
    ...(normalizeCursor(input.cursor) === undefined
      ? {}
      : { cursor: normalizeCursor(input.cursor) }),
  };
}

export const parseListBudgetsQuery = normalizeListBudgetsQuery;
export const parseListBudgetMovementsQuery = normalizeListBudgetMovementsQuery;
export const parseBudgetReadQuery = normalizeListBudgetsQuery;
export const parseBudgetHistoryQuery = normalizeListBudgetMovementsQuery;

function bytesToBase64Url(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const value =
      (first << 16) | ((second ?? 0) << 8) | (third === undefined ? 0 : third);
    result += BASE64URL_ALPHABET[(value >>> 18) & 63];
    result += BASE64URL_ALPHABET[(value >>> 12) & 63];
    if (second !== undefined) result += BASE64URL_ALPHABET[(value >>> 6) & 63];
    if (third !== undefined) result += BASE64URL_ALPHABET[value & 63];
  }
  return result;
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) {
    return failCursor();
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
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) return failCursor();
  return new Uint8Array(output);
}

function hashString(value: string): string {
  let hash = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  const mask = BigInt("0xffffffffffffffff");
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function listFilterHash(query: Omit<NormalizedListBudgetsQuery, "cursor">): string {
  return hashString(
    JSON.stringify({ status: query.status, asOf: query.asOf }),
  );
}

function movementFilterHash(
  query: Omit<NormalizedListBudgetMovementsQuery, "cursor">,
): string {
  return hashString(
    JSON.stringify({ asOf: query.asOf, from: query.from ?? null, to: query.to ?? null }),
  );
}

export function budgetListFilterHash(query: NormalizedListBudgetsQuery): string {
  return listFilterHash(query);
}

export function budgetMovementFilterHash(
  query: NormalizedListBudgetMovementsQuery,
): string {
  return movementFilterHash(query);
}

function encodeCursor(payload: BudgetListCursorV1 | BudgetMovementCursorV1): string {
  const json = JSON.stringify(payload);
  return bytesToBase64Url(new TextEncoder().encode(json));
}

function parseCursorPayload(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    return failCursor();
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      base64UrlToBytes(value),
    );
    const payload: unknown = JSON.parse(decoded);
    if (!isPlainRecord(payload)) return failCursor();
    return payload;
  } catch {
    return failCursor();
  }
}

function requireCursorKeys(
  payload: Record<string, unknown>,
  keys: readonly string[],
): void {
  const actual = Object.keys(payload);
  if (
    actual.length !== keys.length ||
    keys.some((key, index) => actual[index] !== key)
  ) {
    return failCursor();
  }
}

function requireCursorPositionDate(value: unknown): string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return failCursor();
  }
  try {
    return serializeBudgetDate(parseBudgetDate(value, "asOf"));
  } catch {
    return failCursor();
  }
}

function requireCursorId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return failCursor();
  return value;
}

function requireCursorCommon(
  payload: Record<string, unknown>,
  filterHash: string,
  limit: number,
): void {
  if (
    payload.v !== 1 ||
    typeof payload.filterHash !== "string" ||
    !HASH_PATTERN.test(payload.filterHash) ||
    payload.filterHash !== filterHash ||
    payload.limit !== limit
  ) {
    return failCursor();
  }
}

export function encodeBudgetListCursor(
  input: Omit<BudgetListCursorV1, "v">,
): string {
  const activeFrom = requireCursorPositionDate(input.activeFrom);
  const id = requireCursorId(input.id);
  if (!HASH_PATTERN.test(input.filterHash)) return failCursor();
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_BUDGET_PAGE_LIMIT
  ) {
    return failCursor();
  }
  return encodeCursor({
    v: 1,
    activeFrom,
    id,
    filterHash: input.filterHash,
    limit: input.limit,
  });
}

export function decodeBudgetListCursor(
  value: unknown,
  query?: NormalizedListBudgetsQuery,
): BudgetListCursorV1 {
  const payload = parseCursorPayload(value);
  requireCursorKeys(payload, ["v", "activeFrom", "id", "filterHash", "limit"]);
  const cursor: BudgetListCursorV1 = {
    v: 1,
    activeFrom: requireCursorPositionDate(payload.activeFrom),
    id: requireCursorId(payload.id),
    filterHash: String(payload.filterHash),
    limit: payload.limit as number,
  };
  requireCursorCommon(
    payload,
    query === undefined ? cursor.filterHash : listFilterHash(query),
    query === undefined ? cursor.limit : query.limit,
  );
  return cursor;
}

export function createBudgetListCursor(
  position: Pick<BudgetListCursorV1, "activeFrom" | "id">,
  query: NormalizedListBudgetsQuery,
): string {
  return encodeBudgetListCursor({
    ...position,
    filterHash: listFilterHash(query),
    limit: query.limit,
  });
}

export function encodeBudgetMovementCursor(
  input: Omit<BudgetMovementCursorV1, "v">,
): string {
  const effectiveOn = requireCursorPositionDate(input.effectiveOn);
  const id = requireCursorId(input.id);
  if (!HASH_PATTERN.test(input.filterHash)) return failCursor();
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_BUDGET_HISTORY_LIMIT
  ) {
    return failCursor();
  }
  return encodeCursor({
    v: 1,
    effectiveOn,
    id,
    filterHash: input.filterHash,
    limit: input.limit,
  });
}

export function decodeBudgetMovementCursor(
  value: unknown,
  query?: NormalizedListBudgetMovementsQuery,
): BudgetMovementCursorV1 {
  const payload = parseCursorPayload(value);
  requireCursorKeys(payload, ["v", "effectiveOn", "id", "filterHash", "limit"]);
  const cursor: BudgetMovementCursorV1 = {
    v: 1,
    effectiveOn: requireCursorPositionDate(payload.effectiveOn),
    id: requireCursorId(payload.id),
    filterHash: String(payload.filterHash),
    limit: payload.limit as number,
  };
  requireCursorCommon(
    payload,
    query === undefined ? cursor.filterHash : movementFilterHash(query),
    query === undefined ? cursor.limit : query.limit,
  );
  return cursor;
}

export function createBudgetMovementCursor(
  position: Pick<BudgetMovementCursorV1, "effectiveOn" | "id">,
  query: NormalizedListBudgetMovementsQuery,
): string {
  return encodeBudgetMovementCursor({
    ...position,
    filterHash: movementFilterHash(query),
    limit: query.limit,
  });
}

export const encodeBudgetPageCursor = encodeBudgetListCursor;
export const decodeBudgetPageCursor = decodeBudgetListCursor;
export const encodeBudgetHistoryCursor = encodeBudgetMovementCursor;
export const decodeBudgetHistoryCursor = decodeBudgetMovementCursor;

/** Guards exported DTOs against accidental domain values at composition seams. */
export const budgetCategoryReadModelSchema = z
  .object({
    referenceId: z.string(),
    name: z.string(),
    parentReferenceId: z.string().nullable(),
    kind: z.enum(["EXPENSE", "INCOME"]),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
  })
  .strict();

export const budgetAllocationRuleReadModelSchema = z
  .object({
    referenceId: z.string(),
    budgetReferenceId: z.string(),
    boxReferenceId: z.string(),
    amountCents: z.string(),
    effectiveFrom: z.string(),
    effectiveUntil: z.string().nullable(),
  })
  .strict();

export const budgetPageInfoSchema = z
  .object({ hasNextPage: z.boolean(), nextCursor: z.string().nullable() })
  .strict();

export const budgetReadErrorSchema = z
  .object({
    code: z.enum(BUDGET_READ_ERROR_CODES),
    message: z.string(),
    field: z
      .enum([
        "asOf",
        "from",
        "to",
        "status",
        "limit",
        "cursor",
        "budgetReferenceId",
        "categoryId",
      ])
      .optional(),
  })
  .strict();

/** Maps domain validation failures to the opaque read contract. */
export function toBudgetReadError(
  error: unknown,
  fallback: BudgetReadErrorCode = "QUERY_FAILED",
): BudgetReadError {
  if (error instanceof BudgetReadError) return error;
  if (error instanceof FinancialContextError) {
    return new BudgetReadError("FINANCIAL_CONTEXT_REQUIRED");
  }
  if (error instanceof BudgetDomainError) {
    if (
      error.code === "BUDGET_NOT_FOUND" ||
      error.code === "CATEGORY_NOT_FOUND"
    ) {
      return new BudgetReadError(error.code, error.field as BudgetReadErrorField);
    }
    if (
      error.code === "INVALID_DATE" ||
      error.code === "INVALID_DATE_RANGE" ||
      error.code === "INVALID_STATUS" ||
      error.code === "INVALID_REFERENCE" ||
      error.code === "INVALID_COMMAND"
    ) {
      return new BudgetReadError(
        "INVALID_QUERY",
        error.field as BudgetReadErrorField,
      );
    }
  }
  return new BudgetReadError(fallback);
}

export type BudgetReadDomainErrorCode = Extract<
  BudgetErrorCode,
  "BUDGET_NOT_FOUND" | "CATEGORY_NOT_FOUND"
>;

export const BUDGET_READ_MOVEMENT_KINDS = BUDGET_MOVEMENT_KINDS;
