export const TRANSACTION_REVIEW_QUERY_KEYS = [
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
] as const;

export type TransactionReviewQueryKey =
  (typeof TRANSACTION_REVIEW_QUERY_KEYS)[number];

export type ReviewQuerySearchParams = Record<
  string,
  string | string[] | undefined
>;
export type ReviewQueryInput = URLSearchParams | ReviewQuerySearchParams;

export type ReviewQueryKind = "INCOME" | "EXPENSE";
export type ReviewQueryStatus = "POSTED" | "CANCELLED";
export type ReviewQueryOrigin = "MANUAL" | "IMPORT";
export type ReviewQueryReview =
  | "NEEDS_REVIEW"
  | "ORGANIZED"
  | "ALL";

export interface ReviewQuery {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string | null;
  kind?: ReviewQueryKind;
  status?: ReviewQueryStatus;
  origin?: ReviewQueryOrigin;
  review?: ReviewQueryReview;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface ParsedReviewQuery {
  query: ReviewQuery;
  hadInvalidFilters: boolean;
}

export const REVIEW_SEARCH_MAX_CODE_POINTS = 120;
export const MAX_REVIEW_CURSOR_BYTES = 512;

const INVALID_VALUE = Symbol("invalid review query value");
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const KNOWN_QUERY_KEYS = new Set<string>(TRANSACTION_REVIEW_QUERY_KEYS);

type InvalidValue = typeof INVALID_VALUE;
type RawQueryValues = Record<string, unknown>;

function isPlainRecord(value: unknown): value is RawQueryValues {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readRawValues(input: unknown): {
  values: RawQueryValues;
  hadInvalidFilters: boolean;
} {
  if (input === undefined) {
    return { values: {}, hadInvalidFilters: false };
  }

  if (input instanceof URLSearchParams) {
    const values: RawQueryValues = {};
    let hadInvalidFilters = false;
    for (const key of new Set(input.keys())) {
      const allValues = input.getAll(key);
      values[key] = allValues.length === 1 ? allValues[0] : allValues;
      if (allValues.length !== 1) {
        hadInvalidFilters = true;
      }
    }
    return { values, hadInvalidFilters };
  }

  if (!isPlainRecord(input)) {
    return { values: {}, hadInvalidFilters: true };
  }
  return { values: input, hadInvalidFilters: false };
}

function readScalarValue(
  values: RawQueryValues,
  key: TransactionReviewQueryKey,
): unknown | InvalidValue {
  const value = values[key];
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return INVALID_VALUE;
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (key === "categoryId" && value === null) {
    return null;
  }
  if (key === "limit" && typeof value === "number") {
    return value;
  }
  return INVALID_VALUE;
}

function isValidCivilDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseDate(value: unknown): string | InvalidValue {
  return typeof value === "string" && isValidCivilDate(value)
    ? value
    : INVALID_VALUE;
}

function parseUuid(value: unknown): string | InvalidValue {
  return typeof value === "string" && UUID_V7_PATTERN.test(value)
    ? value
    : INVALID_VALUE;
}

function parseCategoryId(value: unknown): string | null | InvalidValue {
  if (value === null || value === "__none") {
    return value === null ? null : null;
  }
  if (typeof value !== "string" || value === "null") {
    return INVALID_VALUE;
  }
  return parseUuid(value);
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | InvalidValue {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : INVALID_VALUE;
}

function parseSearch(value: unknown): string | InvalidValue {
  if (typeof value !== "string") {
    return INVALID_VALUE;
  }
  const normalized = value.normalize("NFKC").trim();
  if (
    normalized.length === 0 ||
    CONTROL_OR_FORMAT_CHARACTER.test(normalized) ||
    Array.from(normalized).length > REVIEW_SEARCH_MAX_CODE_POINTS
  ) {
    return INVALID_VALUE;
  }
  return normalized;
}

function parseLimit(value: unknown): number | InvalidValue {
  const candidate =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/u.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(candidate) && candidate >= 1 && candidate <= 100
    ? candidate
    : INVALID_VALUE;
}

function parseCursor(value: unknown): string | InvalidValue {
  if (typeof value !== "string" || value.length === 0) {
    return INVALID_VALUE;
  }
  if (
    CONTROL_OR_FORMAT_CHARACTER.test(value) ||
    new TextEncoder().encode(value).byteLength > MAX_REVIEW_CURSOR_BYTES
  ) {
    return INVALID_VALUE;
  }
  return value;
}

function parseField(
  key: TransactionReviewQueryKey,
  value: unknown,
): unknown | InvalidValue {
  switch (key) {
    case "from":
    case "to":
      return parseDate(value);
    case "accountId":
      return parseUuid(value);
    case "categoryId":
      return parseCategoryId(value);
    case "kind":
      return parseEnum(value, ["INCOME", "EXPENSE"] as const);
    case "status":
      return value === "ALL"
        ? undefined
        : parseEnum(value, ["POSTED", "CANCELLED"] as const);
    case "origin":
      return value === "ALL"
        ? undefined
        : parseEnum(value, ["MANUAL", "IMPORT"] as const);
    case "review":
      return parseEnum(value, ["NEEDS_REVIEW", "ORGANIZED", "ALL"] as const);
    case "search":
      return parseSearch(value);
    case "limit":
      return parseLimit(value);
    case "cursor":
      return parseCursor(value);
  }
}

function normalizeReviewQuery(input: unknown): {
  query: ReviewQuery;
  hadInvalidFilters: boolean;
} {
  const raw = readRawValues(input);
  let hadInvalidFilters = raw.hadInvalidFilters;
  for (const key of Object.keys(raw.values)) {
    if (!KNOWN_QUERY_KEYS.has(key)) {
      hadInvalidFilters = true;
    }
  }

  const query: ReviewQuery = {};
  for (const key of TRANSACTION_REVIEW_QUERY_KEYS) {
    const value = readScalarValue(raw.values, key);
    if (value === undefined) {
      continue;
    }
    if (value === INVALID_VALUE) {
      hadInvalidFilters = true;
      continue;
    }
    const parsed = parseField(key, value);
    if (parsed === INVALID_VALUE) {
      hadInvalidFilters = true;
      continue;
    }
    if (parsed !== undefined) {
      (query as Record<string, unknown>)[key] = parsed;
    }
  }

  if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
    delete query.from;
    delete query.to;
    hadInvalidFilters = true;
  }
  return { query, hadInvalidFilters };
}

function encodeCanonicalQuery(query: ReviewQuery, omitReviewAll = false): string {
  const params = new URLSearchParams();
  if (query.from !== undefined) params.set("from", query.from);
  if (query.to !== undefined) params.set("to", query.to);
  if (query.accountId !== undefined) params.set("accountId", query.accountId);
  if (query.categoryId === null) {
    params.set("categoryId", "__none");
  } else if (query.categoryId !== undefined) {
    params.set("categoryId", query.categoryId);
  }
  if (query.kind !== undefined) params.set("kind", query.kind);
  if (query.status !== undefined) params.set("status", query.status);
  if (query.origin !== undefined) params.set("origin", query.origin);
  if (query.review !== undefined && !(omitReviewAll && query.review === "ALL")) {
    params.set("review", query.review);
  }
  if (query.search !== undefined) params.set("search", query.search);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  return params.toString();
}

/** Reads only review filters and drops arrays, unknown keys, and invalid values. */
export function parseReviewQuery(input: ReviewQueryInput = {}): ReviewQuery {
  return normalizeReviewQuery(input).query;
}

/** URL-facing variant used by Server Components to show a safe warning. */
export function parseReviewQueryWithDiagnostics(
  input: ReviewQueryInput = {},
): ParsedReviewQuery {
  return normalizeReviewQuery(input);
}

export type ReviewQueryLike = ReviewQuery | ReviewQueryInput;

/** Serializes valid review filters in a fixed canonical order. */
export function encodeReviewQuery(query: ReviewQueryLike = {}): string {
  return encodeCanonicalQuery(normalizeReviewQuery(query).query);
}

export type ReviewQueryHrefExtraValue =
  | string
  | string[]
  | number
  | boolean
  | null
  | undefined;
export type ReviewQueryHrefExtra =
  | URLSearchParams
  | string
  | Record<string, ReviewQueryHrefExtraValue>;

function appendHrefExtras(
  params: URLSearchParams,
  extra: ReviewQueryHrefExtra | undefined,
): void {
  if (extra === undefined) return;
  const values: Record<string, unknown> = {};

  if (extra instanceof URLSearchParams) {
    for (const key of new Set(extra.keys())) {
      const allValues = extra.getAll(key);
      if (allValues.length === 1) values[key] = allValues[0];
    }
  } else if (typeof extra === "string") {
    const extraParams = new URLSearchParams(extra.startsWith("?") ? extra.slice(1) : extra);
    for (const key of new Set(extraParams.keys())) {
      const allValues = extraParams.getAll(key);
      if (allValues.length === 1) values[key] = allValues[0];
    }
  } else if (isPlainRecord(extra)) {
    Object.assign(values, extra);
  }

  for (const key of Object.keys(values).sort()) {
    if (key === "householdId" || KNOWN_QUERY_KEYS.has(key)) continue;
    const value = values[key];
    if (Array.isArray(value) || value === null || value === undefined) continue;
    if (typeof value === "string") params.set(key, value);
    if (typeof value === "number" && Number.isFinite(value)) {
      params.set(key, String(value));
    }
    if (typeof value === "boolean") params.set(key, String(value));
  }
}

/** Builds a link with canonical review filters and safe route extras. */
export function reviewQueryHref(
  path: string,
  query: ReviewQueryLike = {},
  extra?: ReviewQueryHrefExtra,
): string {
  const hashIndex = path.indexOf("#");
  const hash = hashIndex === -1 ? "" : path.slice(hashIndex);
  const withoutHash = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const pathOnly = withoutHash.split("?", 1)[0];
  const params = new URLSearchParams(encodeReviewQuery(query));
  appendHrefExtras(params, extra);
  const queryString = params.toString();
  return `${pathOnly}${queryString ? `?${queryString}` : ""}${hash}`;
}

// Compatibility exports for existing S05 consumers.
export type TransactionReviewQuery = Omit<ReviewQuery, "status" | "origin"> & {
  status?: ReviewQueryStatus | "ALL";
  origin?: ReviewQueryOrigin | "ALL";
};
export type TransactionReviewSearchParams = Record<string, unknown>;

export interface ParsedTransactionReviewQuery {
  query: TransactionReviewQuery;
  hadInvalidFilters: boolean;
}

function legacyQuery(query: ReviewQuery): TransactionReviewQuery {
  if (query.review !== "ALL") return query;
  const withoutReview = { ...query };
  delete withoutReview.review;
  return withoutReview;
}

export function parseTransactionReviewQuery(
  input: URLSearchParams | TransactionReviewSearchParams = {},
): ParsedTransactionReviewQuery {
  const parsed = normalizeReviewQuery(input);
  return {
    query: legacyQuery(parsed.query),
    hadInvalidFilters: parsed.hadInvalidFilters,
  };
}

type TransactionReviewQueryInputWithResult =
  | URLSearchParams
  | TransactionReviewSearchParams
  | TransactionReviewQuery
  | ParsedTransactionReviewQuery;

function queryFromLegacyInput(
  input: TransactionReviewQueryInputWithResult | undefined,
): unknown {
  if (isPlainRecord(input) && "query" in input && "hadInvalidFilters" in input) {
    return input.query;
  }
  return input;
}

export function encodeTransactionReviewQuery(
  input: TransactionReviewQueryInputWithResult = {},
): string {
  const parsed = normalizeReviewQuery(queryFromLegacyInput(input));
  return encodeCanonicalQuery(parsed.query, true);
}

export function withTransactionReviewQuery(
  href: string,
  input: TransactionReviewQueryInputWithResult = {},
): string {
  const hashIndex = href.indexOf("#");
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex);
  const withoutHash = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const path = withoutHash.split("?", 1)[0];
  const queryString = encodeTransactionReviewQuery(input);
  return `${path}${queryString ? `?${queryString}` : ""}${hash}`;
}

export const parseTransactionReviewSearchParams = parseTransactionReviewQuery;
export const transactionReviewQueryString = encodeTransactionReviewQuery;
export const reemitTransactionReviewQuery = withTransactionReviewQuery;
export const transactionReviewHref = withTransactionReviewQuery;
