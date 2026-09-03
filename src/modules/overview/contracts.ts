import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

import { Money } from "@/modules/transactions/money";

/** Public, serializable version of the S10 read model. */
export const OVERVIEW_CONTRACT_VERSION = "s10.v1" as const;

export const OVERVIEW_BLOCK_STATES = ["ready", "empty", "error"] as const;
export type OverviewBlockState = (typeof OVERVIEW_BLOCK_STATES)[number];

export const OVERVIEW_SCENARIOS = ["CONSERVATIVE", "EXPECTED"] as const;
export type OverviewScenario = (typeof OVERVIEW_SCENARIOS)[number];

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const SIGNED_CENTS_PATTERN = /^-?\d+$/u;
const PERIOD_KEY_PATTERN = /^\d{4}-\d{2}$/u;

export const OVERVIEW_UNCATEGORIZED_KEY = "uncategorized" as const;
export const OVERVIEW_OTHER_KEY = "other" as const;
export const OVERVIEW_UNCATEGORIZED_LABEL = "Sem categoria" as const;
export const OVERVIEW_OTHER_LABEL = "Outros" as const;
export const OVERVIEW_MAX_NAMED_CATEGORY_GROUPS = 8;

export interface OverviewPeriod {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly asOf: string;
}

export interface OverviewBlockEnvelope<T> {
  readonly state: OverviewBlockState;
  readonly data?: T;
  readonly error?: { readonly code: string; readonly field?: string | null };
}

export interface OverviewPeriodSummary {
  readonly incomeCents: string;
  readonly expenseCents: string;
  readonly netCents: string;
  readonly expenseEventCount: number;
  readonly purchaseEventCount: number;
  readonly referenceBalanceCents?: string;
  readonly planned?: {
    readonly inflowCents: string;
    readonly outflowCents: string;
    readonly realizedInflowCents: string;
    readonly realizedOutflowCents: string;
    readonly projectedInflowCents: string;
    readonly projectedOutflowCents: string;
  };
  readonly reconciliation: {
    readonly from: string;
    readonly to: string;
    readonly expenseFilter: string;
    readonly incomeFilter: string;
  };
}

export interface OverviewCategoryGroup {
  readonly key: string;
  readonly label: string;
  readonly categoryId?: string;
  readonly amountCents: string;
  readonly percent: number;
  readonly expenseEventCount: number;
  readonly purchaseEventCount: number;
}

export interface OverviewCommitmentItem {
  readonly referenceId: string;
  readonly date: string;
  readonly amountCents: string;
  readonly direction: "INFLOW" | "OUTFLOW";
  readonly label: string;
  readonly originKind: string;
}

export interface OverviewCaixinhaItem {
  readonly referenceId: string;
  readonly name: string;
  readonly balanceCents: string;
  readonly protectedCents?: string;
  readonly status: "ACTIVE" | "CLOSED";
  readonly periodContributionCents?: string;
  readonly periodWithdrawalCents?: string;
  readonly progress?: {
    readonly progressCents: string;
    readonly remainingCents: string;
    readonly progressBps: string;
    readonly status: string;
    readonly paceStatus: string;
  };
}

export interface OverviewCardInvoiceItem {
  readonly cardId: string;
  readonly cardName: string;
  readonly period: string;
  readonly dueOn: string;
  readonly amountCents: string;
  readonly state: string;
}

export type OverviewAlertSeverity = "attention" | "critical";

export type OverviewAlertRuleId =
  | "SPENDABLE_NOT_POSITIVE"
  | "FORECAST_MONTH_NEGATIVE"
  | "COMMITMENT_SOON"
  | "EXPECTED_INCOME_UNREALIZED"
  | "BOX_INSUFFICIENT";

export interface OverviewAlert {
  readonly ruleId: OverviewAlertRuleId;
  readonly severity: OverviewAlertSeverity;
  readonly message: string;
  readonly date?: string;
  readonly referenceId?: string;
}

export interface OverviewReadModel {
  readonly contractVersion: typeof OVERVIEW_CONTRACT_VERSION;
  readonly period: OverviewPeriod;
  readonly scenario: OverviewScenario;
  readonly horizonDays: number;
  readonly spendable: OverviewBlockEnvelope<{
    readonly breakdown: import("@/modules/spendable/contracts").SpendableBreakdown;
  }>;
  readonly periodSummary: OverviewBlockEnvelope<OverviewPeriodSummary>;
  readonly expensesByCategory: OverviewBlockEnvelope<{
    readonly totalExpenseCents: string;
    readonly groups: readonly OverviewCategoryGroup[];
  }>;
  readonly upcomingCommitments: OverviewBlockEnvelope<{
    readonly items: readonly OverviewCommitmentItem[];
    readonly totalMatching: number;
    readonly viewAllHref: string;
  }>;
  readonly upcomingIncome: OverviewBlockEnvelope<{
    readonly items: readonly OverviewCommitmentItem[];
    readonly totalMatching: number;
    readonly viewAllHref: string;
  }>;
  readonly caixinhasSummary: OverviewBlockEnvelope<{
    readonly status: "AVAILABLE" | "UNAVAILABLE";
    readonly items: readonly OverviewCaixinhaItem[];
    readonly totalCount: number;
    readonly viewAllHref: string;
  }>;
  readonly cardInvoices: OverviewBlockEnvelope<{
    readonly items: readonly OverviewCardInvoiceItem[];
    readonly viewAllHref: string;
  }>;
  readonly alerts: OverviewBlockEnvelope<{
    readonly items: readonly OverviewAlert[];
  }>;
}

export interface GetOverviewInput {
  readonly asOf?: string;
  readonly scenario?: OverviewScenario;
  readonly horizon?: { readonly days: number };
}

export const OVERVIEW_ERROR_CODES = [
  "INVALID_DATE",
  "INVALID_DATE_RANGE",
  "INVALID_SCENARIO",
  "INVALID_HORIZON",
  "OVERVIEW_QUERY_FAILED",
] as const;

export type OverviewErrorCode = (typeof OVERVIEW_ERROR_CODES)[number];

export class OverviewDomainError extends Error {
  readonly code: OverviewErrorCode;
  readonly field?: string;

  constructor(code: OverviewErrorCode, message: string, field?: string) {
    super(message);
    this.name = "OverviewDomainError";
    this.code = code;
    this.field = field;
  }
}

function fail(
  code: OverviewErrorCode,
  message: string,
  field?: string,
): never {
  throw new OverviewDomainError(code, message, field);
}

/** Parses signed integer cents without passing through Number. */
export function overviewCents(value: unknown, field = "amountCents"): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "cents" in value &&
    typeof (value as { cents: unknown }).cents === "bigint"
  ) {
    return (value as { cents: bigint }).cents;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toCentsString" in value &&
    typeof (value as { toCentsString: () => string }).toCentsString ===
      "function"
  ) {
    return overviewCents(
      (value as { toCentsString: () => string }).toCentsString(),
      field,
    );
  }

  if (typeof value !== "string" || !SIGNED_CENTS_PATTERN.test(value)) {
    return fail("OVERVIEW_QUERY_FAILED", "Centavos inválidos.", field);
  }

  try {
    return BigInt(value);
  } catch {
    return fail("OVERVIEW_QUERY_FAILED", "Centavos inválidos.", field);
  }
}

export function overviewMoney(value: unknown, field = "amountCents"): Money {
  return new Money(overviewCents(value, field));
}

export function overviewDate(value: unknown, field = "date"): Temporal.PlainDate {
  if (value instanceof Temporal.PlainDate) {
    return value;
  }

  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return fail("INVALID_DATE", "A data deve usar YYYY-MM-DD.", field);
  }

  try {
    return Temporal.PlainDate.from(value, { overflow: "reject" });
  } catch {
    return fail("INVALID_DATE", "A data deve ser válida no calendário ISO.", field);
  }
}

export function serializeOverviewCents(value: bigint): string {
  return value.toString(10);
}

export function isOverviewPeriod(value: unknown): value is OverviewPeriod {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<OverviewPeriod>;
  if (
    typeof candidate.key !== "string" ||
    !PERIOD_KEY_PATTERN.test(candidate.key) ||
    typeof candidate.from !== "string" ||
    typeof candidate.to !== "string" ||
    typeof candidate.asOf !== "string"
  ) {
    return false;
  }

  try {
    overviewDate(candidate.from, "from");
    overviewDate(candidate.to, "to");
    overviewDate(candidate.asOf, "asOf");
    return true;
  } catch {
    return false;
  }
}

const overviewSignedCentsSchema = z.string().refine(
  (value) => {
    if (!SIGNED_CENTS_PATTERN.test(value)) return false;
    try {
      BigInt(value);
      return true;
    } catch {
      return false;
    }
  },
  "centavos inválidos",
);

const overviewPeriodSchema = z.object({
  key: z.string().regex(PERIOD_KEY_PATTERN),
  from: z.string().regex(ISO_DATE_PATTERN),
  to: z.string().regex(ISO_DATE_PATTERN),
  asOf: z.string().regex(ISO_DATE_PATTERN),
});

const overviewCategoryGroupSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  categoryId: z.string().optional(),
  amountCents: overviewSignedCentsSchema,
  percent: z.number().int().min(0).max(100),
  expenseEventCount: z.number().int().nonnegative(),
  purchaseEventCount: z.number().int().nonnegative(),
});

export function parseOverviewCategoryGroup(
  value: unknown,
): OverviewCategoryGroup {
  return overviewCategoryGroupSchema.parse(value) as OverviewCategoryGroup;
}

export function isOverviewCategoryGroup(
  value: unknown,
): value is OverviewCategoryGroup {
  return overviewCategoryGroupSchema.safeParse(value).success;
}

export function parseOverviewPeriod(value: unknown): OverviewPeriod {
  return overviewPeriodSchema.parse(value) as OverviewPeriod;
}
