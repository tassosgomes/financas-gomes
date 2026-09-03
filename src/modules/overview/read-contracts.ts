import type {
  GetOverviewInput,
  OverviewReadModel,
} from "./contracts";

export const OVERVIEW_READ_ERROR_CODES = [
  "FINANCIAL_CONTEXT_REQUIRED",
  "INVALID_DATE",
  "INVALID_DATE_RANGE",
  "INVALID_SCENARIO",
  "INVALID_HORIZON",
  "OVERVIEW_QUERY_FAILED",
  "OVERVIEW_PARTIAL_FAILURE",
] as const;

export type OverviewReadErrorCode = (typeof OVERVIEW_READ_ERROR_CODES)[number];

export interface OverviewReadError {
  readonly code: OverviewReadErrorCode | string;
  readonly field?: string | null;
}

export type OverviewResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: OverviewReadError };

export function overviewReadOk<T>(value: T): OverviewResult<T> {
  return { ok: true, value };
}

export function overviewReadFailure<T = never>(
  code: OverviewReadErrorCode | string,
  field?: string | null,
): OverviewResult<T> {
  return { ok: false, error: { code, field: field ?? null } };
}

export type { GetOverviewInput, OverviewReadModel };
