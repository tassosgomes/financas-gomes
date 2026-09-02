import {
  DEFAULT_SPENDABLE_CAUSAL_ITEM_LIMIT,
  MAX_SPENDABLE_CAUSAL_CURSOR_LENGTH,
  MAX_SPENDABLE_CAUSAL_ITEM_LIMIT,
  SpendableContractError,
  type SpendableCausalItem,
  type SpendableCausalPageInfo,
  type SpendableCausalPageInput,
  type SpendableCausalPoint,
} from "./contracts";

const CURSOR_VERSION = 1 as const;
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

interface CausalCursorPayload {
  readonly v: typeof CURSOR_VERSION;
  readonly offset: number;
  readonly limit: number;
}

export interface NormalizedSpendableCausalPageInput {
  readonly limit: number;
  readonly cursor: string | undefined;
}

export interface SpendableCausalPage<T> {
  readonly items: readonly T[];
  readonly pageInfo: SpendableCausalPageInfo;
}

function fail(message: string, field = "minimum.causalItems"): never {
  throw new SpendableContractError("SPENDABLE_INCONSISTENT", message, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLimit(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_SPENDABLE_CAUSAL_ITEM_LIMIT
  ) {
    return fail(
      `O limite causal deve ser um inteiro entre 1 e ${MAX_SPENDABLE_CAUSAL_ITEM_LIMIT}.`,
      field,
    );
  }
  return value;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = index + 1 < bytes.length ? bytes[index + 1] : undefined;
    const third = index + 2 < bytes.length ? bytes[index + 2] : undefined;
    output += BASE64URL_ALPHABET[first >>> 2];
    output += BASE64URL_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >>> 4)];
    if (second !== undefined) {
      output += BASE64URL_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >>> 6)];
    }
    if (third !== undefined) output += BASE64URL_ALPHABET[third & 0x3f];
  }
  return output;
}

function decodeBase64Url(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length > MAX_SPENDABLE_CAUSAL_CURSOR_LENGTH ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    return fail("O cursor causal é inválido.", "minimum.causalItems.nextCursor");
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
    return fail("O cursor causal é inválido.", "minimum.causalItems.nextCursor");
  }
  return new Uint8Array(output);
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("O cursor causal é inválido.", "minimum.causalItems.nextCursor");
  }
}

function validateCursorPayload(value: unknown): CausalCursorPayload {
  if (!isRecord(value)) {
    return fail("O cursor causal é inválido.", "minimum.causalItems.nextCursor");
  }
  const expectedKeys = ["v", "offset", "limit"];
  const keys = Object.keys(value);
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key, index) => keys[index] !== key)
  ) {
    return fail("O cursor causal é inválido.", "minimum.causalItems.nextCursor");
  }
  if (value.v !== CURSOR_VERSION) {
    return fail("O cursor causal é inválido.", "minimum.causalItems.nextCursor");
  }
  if (
    typeof value.offset !== "number" ||
    !Number.isSafeInteger(value.offset) ||
    value.offset < 0
  ) {
    return fail("O cursor causal é inválido.", "minimum.causalItems.nextCursor");
  }
  return {
    v: CURSOR_VERSION,
    offset: value.offset,
    limit: readLimit(value.limit, "minimum.causalItems.nextCursor"),
  };
}

/** Encodes only pagination position and page size; no financial reference is copied. */
export function encodeSpendableCausalCursor(
  input: Pick<CausalCursorPayload, "offset" | "limit">,
): string {
  if (!Number.isSafeInteger(input.offset) || input.offset < 0) {
    return fail("O cursor causal é inválido.", "minimum.causalItems.nextCursor");
  }
  const limit = readLimit(input.limit, "minimum.causalItems.nextCursor");
  const payload: CausalCursorPayload = {
    v: CURSOR_VERSION,
    offset: input.offset,
    limit,
  };
  const encoded = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  if (encoded.length > MAX_SPENDABLE_CAUSAL_CURSOR_LENGTH) {
    return fail("O cursor causal é inválido.", "minimum.causalItems.nextCursor");
  }
  return encoded;
}

/** Decodes and validates an opaque continuation token at the pure boundary. */
export function decodeSpendableCausalCursor(value: unknown): CausalCursorPayload {
  if (typeof value !== "string") {
    return fail("O cursor causal é inválido.", "minimum.causalItems.nextCursor");
  }
  try {
    return validateCursorPayload(
      JSON.parse(decodeUtf8(decodeBase64Url(value))) as unknown,
    );
  } catch (error) {
    if (error instanceof SpendableContractError) throw error;
    return fail("O cursor causal é inválido.", "minimum.causalItems.nextCursor");
  }
}

/** Applies strict defaults/limits without accepting stringly-typed numbers. */
export function normalizeSpendableCausalPageInput(
  value: SpendableCausalPageInput | undefined,
): NormalizedSpendableCausalPageInput {
  if (value === undefined) {
    return { limit: DEFAULT_SPENDABLE_CAUSAL_ITEM_LIMIT, cursor: undefined };
  }
  if (!isRecord(value)) return fail("A paginação causal é inválida.");
  const allowed = new Set(["limit", "cursor"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return fail("A paginação causal é inválida.");
  }
  const limit = value.limit === undefined
    ? DEFAULT_SPENDABLE_CAUSAL_ITEM_LIMIT
    : readLimit(value.limit, "minimum.causalItems.limit");
  const cursor = value.cursor === null || value.cursor === undefined
    ? undefined
    : value.cursor;
  if (
    cursor !== undefined &&
    (typeof cursor !== "string" ||
      cursor.length === 0 ||
      cursor.length > MAX_SPENDABLE_CAUSAL_CURSOR_LENGTH)
  ) {
    return fail("O cursor causal é inválido.", "minimum.causalItems.nextCursor");
  }
  return { limit, cursor };
}

/** Paginates a canonical item sequence while retaining its aggregate count. */
export function paginateSpendableCausalItems<T>(
  items: readonly T[],
  input?: SpendableCausalPageInput,
): SpendableCausalPage<T> {
  const normalized = normalizeSpendableCausalPageInput(input);
  let offset = 0;
  let limit = normalized.limit;
  if (normalized.cursor !== undefined) {
    const cursor = decodeSpendableCausalCursor(normalized.cursor);
    if (input?.limit !== undefined && cursor.limit !== normalized.limit) {
      return fail(
        "O cursor causal não coincide com o limite solicitado.",
        "minimum.causalItems.limit",
      );
    }
    offset = cursor.offset;
    limit = cursor.limit;
  }
  if (offset > items.length) {
    return fail("O cursor causal está além do total de itens.", "minimum.causalItems.nextCursor");
  }

  const pageItems = items.slice(offset, offset + limit);
  const returnedCount = pageItems.length;
  const totalCount = items.length;
  const truncated = returnedCount < totalCount;
  const hasNextPage = offset + returnedCount < totalCount;
  const nextCursor = hasNextPage
    ? encodeSpendableCausalCursor({ offset: offset + returnedCount, limit })
    : null;
  return {
    items: pageItems,
    pageInfo: {
      totalCount,
      returnedCount,
      limit,
      truncated,
      nextCursor,
    },
  };
}

function referencesFor(items: readonly SpendableCausalItem[]): readonly string[] {
  return [...new Set(items.map(({ referenceId }) => referenceId))].sort();
}

/** Paginates causal items across tied minimum points without losing the points. */
export function paginateSpendableCausalPoints(
  points: readonly SpendableCausalPoint[],
  input?: SpendableCausalPageInput,
): { readonly points: readonly SpendableCausalPoint[]; readonly pageInfo: SpendableCausalPageInfo } {
  const normalized = normalizeSpendableCausalPageInput(input);
  const pageOffset = normalized.cursor === undefined
    ? 0
    : decodeSpendableCausalCursor(normalized.cursor).offset;
  const allItems = points.flatMap(({ items }) => items);
  const page = paginateSpendableCausalItems(allItems, input);
  let offset = 0;
  const pageItems = page.items;
  const pagedPoints = points.map((point) => {
    const start = offset;
    offset += point.items.length;
    const end = start + point.items.length;
    const items = pageItems.filter((_, index) => {
      const absolute = pageOffset + index;
      return absolute >= start && absolute < end;
    });
    return {
      ...point,
      references: referencesFor(items),
      items: items.map((item) => ({ ...item })),
    };
  });
  return { points: pagedPoints, pageInfo: page.pageInfo };
}

export const parseSpendableCausalPageInput = normalizeSpendableCausalPageInput;
export const createSpendableCausalCursor = encodeSpendableCausalCursor;
export const parseSpendableCausalCursor = decodeSpendableCausalCursor;
