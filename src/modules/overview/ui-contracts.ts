import type { SpendableBreakdown } from "@/modules/spendable/contracts";
import {
  formatSpendableDate,
  formatSpendableImpact,
  formatSpendableMoney,
  formatSpendablePeriod,
  toSpendableBreakdownViewModel,
  type SpendableBreakdownViewModel,
} from "@/modules/spendable/ui-contracts";
import {
  formatBudgetDate,
  formatBudgetSignedCents,
} from "@/components/budgets/formatters";

/**
 * Presentation contracts for S10 Visão Geral.  The financial read model is
 * produced and validated by the server; this module adds only labels and safe
 * formatting metadata for the React boundary.
 *
 * Values that represent money remain decimal strings.  Mapping functions never
 * compute financial formulas — they format fields already supplied by `s10.v1`.
 *
 * ## Stable `data-testid` inventory (T14 E2E)
 *
 * | ID | Uso |
 * | --- | --- |
 * | `overview-page` | Container da home autenticada |
 * | `overview-spendable` | Bloco spendable |
 * | `overview-period-summary` | Bloco resumo do período |
 * | `overview-period-income` | Receitas do período |
 * | `overview-period-expense` | Despesas do período |
 * | `overview-categories` | Bloco despesas por categoria |
 * | `overview-category-{key}` | Linha/barra de categoria |
 * | `overview-commitments` | Próximos compromissos |
 * | `overview-income-upcoming` | Próximas receitas |
 * | `overview-caixinhas` | Resumo de Caixinhas |
 * | `overview-invoices` | Faturas de cartão |
 * | `overview-alerts` | Alertas determinísticos |
 * | `overview-alert-{ruleId}` | Item de alerta |
 * | `overview-block-loading` | Estado loading de bloco |
 * | `overview-block-empty` | Estado empty de bloco |
 * | `overview-block-error` | Estado error de bloco |
 */
export const OVERVIEW_TEST_IDS = {
  page: "overview-page",
  spendable: "overview-spendable",
  periodSummary: "overview-period-summary",
  periodIncome: "overview-period-income",
  periodExpense: "overview-period-expense",
  categories: "overview-categories",
  category: (key: string) => `overview-category-${key}`,
  commitments: "overview-commitments",
  incomeUpcoming: "overview-income-upcoming",
  caixinhas: "overview-caixinhas",
  invoices: "overview-invoices",
  alerts: "overview-alerts",
  alert: (ruleId: string) => `overview-alert-${ruleId}`,
  blockLoading: "overview-block-loading",
  blockEmpty: "overview-block-empty",
  blockError: "overview-block-error",
} as const;

/** Duplicated from ADR-013 `s10.v1` until `contracts.ts` (T02) lands. */
export const OVERVIEW_CONTRACT_VERSION = "s10.v1" as const;

export type OverviewBlockState = "ready" | "empty" | "error" | "loading";

export interface OverviewPeriod {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly asOf: string;
}

export interface OverviewBlockEnvelope<T> {
  readonly state: "ready" | "empty" | "error";
  readonly data?: T;
  readonly error?: { code: string; field?: string | null };
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
  readonly scenario: "CONSERVATIVE" | "EXPECTED";
  readonly horizonDays: number;
  readonly spendable: OverviewBlockEnvelope<{
    readonly breakdown: SpendableBreakdown;
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

/** Product labels — exact Portuguese copy for V1. */
export const OVERVIEW_PAGE_TITLE = "Visão geral";
export const OVERVIEW_SPENDABLE_TITLE = "Pode gastar com segurança";
export const OVERVIEW_PERIOD_SUMMARY_TITLE = "Resumo do mês";
export const OVERVIEW_CATEGORIES_TITLE = "Onde está indo o dinheiro";
export const OVERVIEW_COMMITMENTS_TITLE = "Próximos compromissos";
export const OVERVIEW_CAIXINHAS_TITLE = "Caixinhas";
export const OVERVIEW_INCOME_UPCOMING_TITLE = "Próximas receitas";
export const OVERVIEW_INVOICES_TITLE = "Faturas";
export const OVERVIEW_ALERTS_TITLE = "Alertas";
export const OVERVIEW_VIEW_ALL_LABEL = "Ver todos";
export const OVERVIEW_UNCATEGORIZED_LABEL = "Sem categoria";
export const OVERVIEW_OTHER_LABEL = "Outros";

export const OVERVIEW_STATE_BADGE_LABELS = {
  normal: "Normal",
  attention: "Atenção",
  critical: "Crítico",
} as const;

export type OverviewStateBadgeVariant = keyof typeof OVERVIEW_STATE_BADGE_LABELS;

export interface OverviewPeriodViewModel {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly asOf: string;
  readonly keyLabel: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly asOfLabel: string;
  readonly rangeLabel: string;
}

export interface OverviewPeriodSummaryViewModel {
  readonly incomeLabel: string;
  readonly expenseLabel: string;
  readonly netLabel: string;
  readonly referenceBalanceLabel?: string;
  readonly plannedInflowLabel?: string;
  readonly plannedOutflowLabel?: string;
  readonly realizedInflowLabel?: string;
  readonly realizedOutflowLabel?: string;
  readonly projectedInflowLabel?: string;
  readonly projectedOutflowLabel?: string;
}

export interface OverviewCategoryGroupViewModel {
  readonly key: string;
  readonly label: string;
  readonly categoryId?: string;
  readonly amountLabel: string;
  readonly percent: number;
  readonly percentLabel: string;
  readonly expenseEventCount: number;
  readonly purchaseEventCount: number;
}

export interface OverviewCommitmentItemViewModel {
  readonly referenceId: string;
  readonly label: string;
  readonly dateLabel: string;
  readonly amountLabel: string;
  readonly direction: OverviewCommitmentItem["direction"];
}

export interface OverviewCaixinhaItemViewModel {
  readonly referenceId: string;
  readonly name: string;
  readonly balanceLabel: string;
  readonly protectedLabel?: string;
  readonly status: OverviewCaixinhaItem["status"];
  readonly statusLabel: string;
}

export interface OverviewCardInvoiceItemViewModel {
  readonly cardId: string;
  readonly cardName: string;
  readonly periodLabel: string;
  readonly dueOnLabel: string;
  readonly amountLabel: string;
  readonly state: string;
}

export interface OverviewAlertViewModel {
  readonly ruleId: OverviewAlertRuleId;
  readonly severity: OverviewAlertSeverity;
  readonly severityLabel: string;
  readonly badgeVariant: OverviewStateBadgeVariant;
  readonly message: string;
  readonly dateLabel?: string;
  readonly referenceId?: string;
}

export interface OverviewSpendableBlockViewModel {
  readonly spendable: SpendableBreakdownViewModel;
}

export interface OverviewErrorViewModel {
  readonly code: string;
  readonly field: string | null;
  readonly message: string;
  readonly retryable: boolean;
}

const SIGNED_CENTS_PATTERN = /^-?\d+$/u;
const UNSIGNED_CENTS_PATTERN = /^\d+$/u;

function safeSignedCents(value: string): string {
  if (!SIGNED_CENTS_PATTERN.test(value)) return "Valor indisponível";
  return formatBudgetSignedCents(value);
}

function safeUnsignedCents(value: string): string {
  if (!UNSIGNED_CENTS_PATTERN.test(value)) return "Valor indisponível";
  return formatBudgetSignedCents(value);
}

export function formatOverviewPercent(percent: number): string {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    return "—";
  }
  return `${percent}%`;
}

export function toOverviewPeriodViewModel(period: OverviewPeriod): OverviewPeriodViewModel {
  return {
    key: period.key,
    from: period.from,
    to: period.to,
    asOf: period.asOf,
    keyLabel: formatSpendablePeriod(period.key),
    fromLabel: formatSpendableDate(period.from),
    toLabel: formatSpendableDate(period.to),
    asOfLabel: formatSpendableDate(period.asOf),
    rangeLabel: `${formatSpendableDate(period.from)} a ${formatSpendableDate(period.to)}`,
  };
}

export function toOverviewPeriodSummaryViewModel(
  summary: OverviewPeriodSummary,
): OverviewPeriodSummaryViewModel {
  const planned = summary.planned;
  return {
    incomeLabel: safeSignedCents(summary.incomeCents),
    expenseLabel: safeSignedCents(summary.expenseCents),
    netLabel: safeSignedCents(summary.netCents),
    referenceBalanceLabel: summary.referenceBalanceCents
      ? safeSignedCents(summary.referenceBalanceCents)
      : undefined,
    plannedInflowLabel: planned ? safeSignedCents(planned.inflowCents) : undefined,
    plannedOutflowLabel: planned ? safeSignedCents(planned.outflowCents) : undefined,
    realizedInflowLabel: planned
      ? safeSignedCents(planned.realizedInflowCents)
      : undefined,
    realizedOutflowLabel: planned
      ? safeSignedCents(planned.realizedOutflowCents)
      : undefined,
    projectedInflowLabel: planned
      ? safeSignedCents(planned.projectedInflowCents)
      : undefined,
    projectedOutflowLabel: planned
      ? safeSignedCents(planned.projectedOutflowCents)
      : undefined,
  };
}

export function toOverviewCategoryGroupViewModel(
  group: OverviewCategoryGroup,
): OverviewCategoryGroupViewModel {
  return {
    key: group.key,
    label: group.label,
    categoryId: group.categoryId,
    amountLabel: safeUnsignedCents(group.amountCents),
    percent: group.percent,
    percentLabel: formatOverviewPercent(group.percent),
    expenseEventCount: group.expenseEventCount,
    purchaseEventCount: group.purchaseEventCount,
  };
}

export function toOverviewCommitmentItemViewModel(
  item: OverviewCommitmentItem,
): OverviewCommitmentItemViewModel {
  return {
    referenceId: item.referenceId,
    label: item.label,
    dateLabel: formatBudgetDate(item.date),
    amountLabel: formatSpendableImpact(item.amountCents, item.direction),
    direction: item.direction,
  };
}

export function toOverviewCaixinhaItemViewModel(
  item: OverviewCaixinhaItem,
): OverviewCaixinhaItemViewModel {
  return {
    referenceId: item.referenceId,
    name: item.name,
    balanceLabel: safeSignedCents(item.balanceCents),
    protectedLabel: item.protectedCents
      ? safeSignedCents(item.protectedCents)
      : undefined,
    status: item.status,
    statusLabel: item.status === "ACTIVE" ? "Ativa" : "Encerrada",
  };
}

export function toOverviewCardInvoiceItemViewModel(
  item: OverviewCardInvoiceItem,
): OverviewCardInvoiceItemViewModel {
  return {
    cardId: item.cardId,
    cardName: item.cardName,
    periodLabel: formatSpendablePeriod(item.period),
    dueOnLabel: formatBudgetDate(item.dueOn),
    amountLabel: safeUnsignedCents(item.amountCents),
    state: item.state,
  };
}

function alertBadgeVariant(severity: OverviewAlertSeverity): OverviewStateBadgeVariant {
  return severity === "critical" ? "critical" : "attention";
}

export function toOverviewAlertViewModel(alert: OverviewAlert): OverviewAlertViewModel {
  return {
    ruleId: alert.ruleId,
    severity: alert.severity,
    severityLabel: OVERVIEW_STATE_BADGE_LABELS[alertBadgeVariant(alert.severity)],
    badgeVariant: alertBadgeVariant(alert.severity),
    message: alert.message,
    dateLabel: alert.date ? formatBudgetDate(alert.date) : undefined,
    referenceId: alert.referenceId,
  };
}

export function toOverviewSpendableBlockViewModel(
  breakdown: SpendableBreakdown,
): OverviewSpendableBlockViewModel {
  return {
    spendable: toSpendableBreakdownViewModel(breakdown),
  };
}

const OVERVIEW_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  FINANCIAL_CONTEXT_REQUIRED: "É necessário entrar para consultar a visão geral.",
  INVALID_DATE: "A data de referência não é válida.",
  INVALID_DATE_RANGE: "O período solicitado não é válido.",
  INVALID_SCENARIO: "O cenário selecionado não está disponível.",
  INVALID_HORIZON: "O horizonte solicitado não é válido.",
  OVERVIEW_QUERY_FAILED:
    "Não foi possível carregar a visão geral. Tente novamente.",
  OVERVIEW_PARTIAL_FAILURE:
    "Alguns blocos não foram carregados. Tente novamente.",
};

const RETRYABLE_OVERVIEW_ERRORS: ReadonlySet<string> = new Set([
  "OVERVIEW_QUERY_FAILED",
  "OVERVIEW_PARTIAL_FAILURE",
]);

function errorRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function toOverviewErrorViewModel(
  value: unknown,
  fallback = "OVERVIEW_QUERY_FAILED",
): OverviewErrorViewModel {
  const record = errorRecord(value);
  const rawCode = record?.code;
  const fallbackCode = fallback in OVERVIEW_ERROR_MESSAGES
    ? fallback
    : "OVERVIEW_QUERY_FAILED";
  const code =
    typeof rawCode === "string" && rawCode in OVERVIEW_ERROR_MESSAGES
      ? rawCode
      : fallbackCode;
  const rawField = record?.field;
  const field =
    typeof rawField === "string" && /^[A-Za-z][A-Za-z0-9_.]*$/u.test(rawField)
      ? rawField
      : null;
  return {
    code,
    field,
    message:
      OVERVIEW_ERROR_MESSAGES[code] ??
      OVERVIEW_ERROR_MESSAGES.OVERVIEW_QUERY_FAILED,
    retryable: RETRYABLE_OVERVIEW_ERRORS.has(code),
  };
}

export const overviewErrorMessage = (value: unknown): string =>
  toOverviewErrorViewModel(value).message;

/** Re-export spendable money formatter for overview blocks that mirror S08 display. */
export const formatOverviewSpendableMoney = formatSpendableMoney;
