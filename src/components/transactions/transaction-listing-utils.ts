import type {
  ListManualTransactionsQuery,
  ManualTransactionKind,
} from "@/modules/transactions/contracts";
import { parseListManualTransactionsQuery } from "@/modules/transactions/reads";
import { TRANSACTION_DETAIL_ROUTE, TRANSACTIONS_ROUTE } from "@/modules/transactions/routes";

export {
  formatSignedCents,
  formatTransactionDate,
} from "./transaction-listing-formatters";

/** Sentinel used by the GET form for a deliberate “sem categoria” filter. */
export const UNCATEGORIZED_FILTER_VALUE = "__none" as const;

export type TransactionsSearchParams = Record<
  string,
  string | string[] | undefined
>;

export interface ParsedTransactionsSearchParams {
  query: ListManualTransactionsQuery;
  hadInvalidFilters: boolean;
}

function encodeFilterQuery(query: ListManualTransactionsQuery): string {
  const params = new URLSearchParams();
  const from =
    query.from ??
    query.occurredOnFrom ??
    query.dateFrom ??
    query.startDate ??
    query.effectiveDateFrom ??
    query.periodStart;
  const to =
    query.to ??
    query.occurredOnTo ??
    query.dateTo ??
    query.endDate ??
    query.effectiveDateTo ??
    query.periodEnd;
  const kind = query.kind ?? query.type;

  if (from) {
    params.set("from", from);
  }
  if (to) {
    params.set("to", to);
  }
  if (query.accountId) {
    params.set("accountId", query.accountId);
  }
  if (query.categoryId === null) {
    params.set("categoryId", UNCATEGORIZED_FILTER_VALUE);
  } else if (query.categoryId) {
    params.set("categoryId", query.categoryId);
  }
  if (kind) {
    params.set("kind", kind);
  }
  if (query.status) {
    params.set("status", query.status);
  }

  return params.toString();
}

function scalarValue(
  input: TransactionsSearchParams,
  keys: readonly string[],
  onInvalid: () => void,
): string | undefined {
  let value: string | undefined;

  for (const key of keys) {
    const raw = input[key];
    if (raw === undefined) {
      continue;
    }
    if (Array.isArray(raw)) {
      onInvalid();
      continue;
    }

    const normalized = raw.trim();
    if (normalized.length === 0) {
      continue;
    }

    if (value !== undefined && value !== normalized) {
      onInvalid();
      continue;
    }
    value = normalized;
  }

  return value;
}

function withSingleFilter(
  key: string,
  value: string | null | undefined,
): ListManualTransactionsQuery | null {
  if (value === undefined) {
    return {};
  }

  try {
    return parseListManualTransactionsQuery({ [key]: value });
  } catch {
    return null;
  }
}

function mergeCanonicalFilter(
  target: ListManualTransactionsQuery,
  parsed: ListManualTransactionsQuery,
): void {
  if (parsed.from !== undefined) {
    target.from = parsed.from;
  }
  if (parsed.to !== undefined) {
    target.to = parsed.to;
  }
  if (parsed.accountId !== undefined) {
    target.accountId = parsed.accountId;
  }
  if (parsed.categoryId !== undefined) {
    target.categoryId = parsed.categoryId;
  }
  if (parsed.kind !== undefined) {
    target.kind = parsed.kind;
  }
  if (parsed.status !== undefined) {
    target.status = parsed.status;
  }
}

/**
 * Converts untrusted URL values into the canonical T06 query. Invalid values
 * are ignored and reported to the UI, so a copied/broken URL still renders
 * the current household's list and never becomes tenant authority.
 */
export function parseTransactionsSearchParams(
  input: TransactionsSearchParams | undefined,
): ParsedTransactionsSearchParams {
  const values = input ?? {};
  let hadInvalidFilters = false;
  const markInvalid = () => {
    hadInvalidFilters = true;
  };

  const from = scalarValue(
    values,
    [
      "from",
      "occurredOnFrom",
      "dateFrom",
      "startDate",
      "effectiveDateFrom",
      "periodStart",
    ],
    markInvalid,
  );
  const to = scalarValue(
    values,
    [
      "to",
      "occurredOnTo",
      "dateTo",
      "endDate",
      "effectiveDateTo",
      "periodEnd",
    ],
    markInvalid,
  );
  const accountId = scalarValue(values, ["accountId"], markInvalid);
  const categoryId = scalarValue(values, ["categoryId"], markInvalid);
  const kind = scalarValue(values, ["kind", "type"], markInvalid);
  const status = scalarValue(values, ["status"], markInvalid);
  const origin = scalarValue(values, ["origin"], markInvalid);

  if (origin !== undefined && origin !== "MANUAL") {
    hadInvalidFilters = true;
  }

  const candidate: ListManualTransactionsQuery = {};
  if (from !== undefined) {
    candidate.from = from;
  }
  if (to !== undefined) {
    candidate.to = to;
  }
  if (accountId !== undefined) {
    candidate.accountId = accountId;
  }
  if (categoryId !== undefined) {
    candidate.categoryId =
      categoryId === UNCATEGORIZED_FILTER_VALUE ? null : categoryId;
  }
  if (kind !== undefined) {
    candidate.kind = kind as ManualTransactionKind;
  }
  if (status !== undefined) {
    candidate.status = status as ListManualTransactionsQuery["status"];
  }

  try {
    return {
      query: parseListManualTransactionsQuery(candidate),
      hadInvalidFilters,
    };
  } catch {
    // A malformed field should not discard every valid filter. Re-parse each
    // field independently, then specifically drop an inverted date range.
    hadInvalidFilters = true;
    const query: ListManualTransactionsQuery = {};
    const scalarFilters: Array<[
      string,
      string | null | undefined,
    ]> = [
      ["accountId", accountId],
      [
        "categoryId",
        categoryId === UNCATEGORIZED_FILTER_VALUE ? null : categoryId,
      ],
      ["kind", kind],
      ["status", status],
    ];

    for (const [key, value] of scalarFilters) {
      const parsed = withSingleFilter(key, value);
      if (!parsed) {
        continue;
      }
      mergeCanonicalFilter(query, parsed);
    }

    const dateRange = withSingleFilter("from", from);
    const dateTo = withSingleFilter("to", to);
    if (dateRange && dateTo) {
      try {
        const combined = parseListManualTransactionsQuery({
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        });
        mergeCanonicalFilter(query, combined);
      } catch {
        // Both dates are individually valid, but their range is inverted.
        // Dropping the range keeps the rest of the URL useful and safe.
      }
    } else {
      if (dateRange) {
        mergeCanonicalFilter(query, dateRange);
      }
      if (dateTo) {
        mergeCanonicalFilter(query, dateTo);
      }
    }

    return {
      query: {
        ...query,
        origin: "MANUAL",
      },
      hadInvalidFilters,
    };
  }
}

export function transactionsQueryString(
  query: ListManualTransactionsQuery,
): string {
  return encodeFilterQuery(query);
}

export function transactionsHref(
  query: ListManualTransactionsQuery = {},
): string {
  const queryString = encodeFilterQuery(query);
  return queryString ? `${TRANSACTIONS_ROUTE}?${queryString}` : TRANSACTIONS_ROUTE;
}

/** Keeps the active list filters on a future detail route. */
export function transactionDetailHref(
  financialEventId: string,
  query: ListManualTransactionsQuery = {},
): string {
  const queryString = encodeFilterQuery(query);
  const detailRoute = TRANSACTION_DETAIL_ROUTE(financialEventId);
  return queryString ? `${detailRoute}?${queryString}` : detailRoute;
}

export function hasActiveTransactionFilters(
  query: ListManualTransactionsQuery,
): boolean {
  return Boolean(
    query.from ||
      query.to ||
      query.accountId ||
      query.categoryId !== undefined ||
      query.kind ||
      (query.status && query.status !== "ALL"),
  );
}
