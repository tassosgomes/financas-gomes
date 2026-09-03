import { Temporal } from "@js-temporal/polyfill";

import { CREDIT_CARD_ROUTES } from "@/components/credit-cards/ui-contracts";
import { BUDGETS_ROUTE } from "@/modules/budgets/routes";
import type { BudgetListItemReadModel } from "@/modules/budgets/read-contracts";
import { forecastHref } from "@/modules/forecast/ui-contracts";
import type { ForecastItem, ForecastTimeline } from "@/modules/forecast/contracts";
import type { FinancialContext } from "@/modules/households/contracts";
import { requireFinancialContext } from "@/modules/households/context";
import {
  createOverviewOperation,
  withOverviewObservability,
  type S10OverviewResultSummary,
} from "@/modules/observability/s10";
import type { SpendableBreakdown } from "@/modules/spendable/contracts";
import { currentFinancialDate } from "@/modules/transactions/dates";

import type { PeriodAggregationResult } from "./aggregate";
import {
  composeOverviewOrigins,
  type ComposeOverviewInput,
  type ComposeOverviewOptions,
  type ComposeOverviewOriginsResult,
} from "./composition";
import {
  OVERVIEW_CONTRACT_VERSION,
  OverviewDomainError,
  type GetOverviewInput,
  type OverviewAlert,
  type OverviewBlockEnvelope,
  type OverviewCaixinhaItem,
  type OverviewCardInvoiceItem,
  type OverviewCategoryGroup,
  type OverviewCommitmentItem,
  type OverviewPeriod,
  type OverviewPeriodSummary,
  type OverviewReadModel,
  type OverviewScenario,
} from "./contracts";
import {
  createDefaultOverviewPorts,
  type OriginResult,
  type OverviewCardInvoiceDraft,
  type OverviewOriginPorts,
} from "./ports";
import {
  overviewReadFailure,
  overviewReadOk,
  type OverviewResult,
} from "./read-contracts";
import { civilMonthPeriod } from "./period";
import {
  OverviewQueryError,
  readPeriodAggregationForContext,
  type OverviewQueryOptions,
} from "./query";

const UPCOMING_ITEMS_LIMIT = 5;
const CAIXINHAS_ITEMS_LIMIT = 5;

export interface OverviewServiceDependencies extends OverviewQueryOptions {
  readonly ports?: OverviewOriginPorts;
  readonly requireContext?: () => Promise<FinancialContext>;
  readonly today?: () => Temporal.PlainDate;
  readonly compositionOptions?: ComposeOverviewOptions;
  /** Test seam — bypasses the Drizzle executor when provided. */
  readonly readAggregation?: (
    context: FinancialContext,
    period: OverviewPeriod,
  ) => Promise<PeriodAggregationResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readyBlock<T>(data: T): OverviewBlockEnvelope<T> {
  return { state: "ready", data };
}

function emptyBlock<T>(): OverviewBlockEnvelope<T> {
  return { state: "empty" };
}

function errorBlock<T>(
  code: string,
  field?: string | null,
): OverviewBlockEnvelope<T> {
  return { state: "error", error: { code, field: field ?? null } };
}

function normalizeInput(
  input: GetOverviewInput | unknown,
  today: () => Temporal.PlainDate,
): ComposeOverviewInput {
  if (input !== undefined && !isRecord(input)) {
    throw new OverviewDomainError(
      "OVERVIEW_QUERY_FAILED",
      "Entrada inválida.",
    );
  }

  const candidate = (input ?? {}) as GetOverviewInput;

  if (candidate.asOf !== undefined) {
    try {
      Temporal.PlainDate.from(candidate.asOf, { overflow: "reject" });
    } catch {
      throw new OverviewDomainError("INVALID_DATE", "A data de referência é inválida.", "asOf");
    }
  }

  if (
    candidate.scenario !== undefined &&
    candidate.scenario !== "CONSERVATIVE" &&
    candidate.scenario !== "EXPECTED"
  ) {
    throw new OverviewDomainError(
      "INVALID_SCENARIO",
      "O cenário selecionado não está disponível.",
      "scenario",
    );
  }

  const horizonDays = candidate.horizon?.days;
  if (
    horizonDays !== undefined &&
    (!Number.isSafeInteger(horizonDays) || horizonDays < 1)
  ) {
    throw new OverviewDomainError(
      "INVALID_HORIZON",
      "O horizonte solicitado não é válido.",
      "horizon",
    );
  }

  const asOf = candidate.asOf ?? today().toString();
  return {
    asOf,
    scenario: candidate.scenario,
    horizon: candidate.horizon,
  };
}

function isPeriodSummaryEmpty(summary: OverviewPeriodSummary): boolean {
  return (
    summary.incomeCents === "0" &&
    summary.expenseCents === "0" &&
    summary.expenseEventCount === 0 &&
    summary.purchaseEventCount === 0
  );
}

function mapSpendableBlock(
  result: OriginResult<SpendableBreakdown>,
): OverviewBlockEnvelope<{ breakdown: SpendableBreakdown }> {
  if (result.ok) {
    return readyBlock({ breakdown: result.value });
  }

  if (result.error.code === "SPENDABLE_NOT_FOUND") {
    return emptyBlock();
  }

  return errorBlock(result.error.code, result.error.field);
}

function mapForecastCommitmentItems(
  timeline: ForecastTimeline,
  direction: "INFLOW" | "OUTFLOW",
  minDate: string,
): readonly OverviewCommitmentItem[] {
  const items: OverviewCommitmentItem[] = [];

  for (const day of timeline.days) {
    if (Temporal.PlainDate.compare(
      Temporal.PlainDate.from(day.date),
      Temporal.PlainDate.from(minDate),
    ) < 0) {
      continue;
    }

    for (const item of day.items) {
      if (item.direction === direction) {
        items.push(mapForecastItem(item));
      }
    }
  }

  return items.sort(compareCommitmentItems);
}

function mapForecastItem(item: ForecastItem): OverviewCommitmentItem {
  return {
    referenceId: item.referenceId,
    date: item.date,
    amountCents: item.amountCents,
    direction: item.direction,
    label: item.source.label,
    originKind: item.source.kind,
  };
}

function compareCommitmentItems(
  left: OverviewCommitmentItem,
  right: OverviewCommitmentItem,
): number {
  const dateCompare = Temporal.PlainDate.compare(
    Temporal.PlainDate.from(left.date),
    Temporal.PlainDate.from(right.date),
  );
  if (dateCompare !== 0) {
    return dateCompare;
  }
  return left.referenceId.localeCompare(right.referenceId);
}

function buildForecastViewAllHref(
  forecastFrom: string,
  forecastTo: string,
  scenario: OverviewScenario,
): string {
  return forecastHref({ from: forecastFrom, to: forecastTo, scenario });
}

function mapForecastListBlock(
  result: OriginResult<ForecastTimeline>,
  direction: "INFLOW" | "OUTFLOW",
  forecastFrom: string,
  forecastTo: string,
  scenario: OverviewScenario,
): OverviewBlockEnvelope<{
  items: readonly OverviewCommitmentItem[];
  totalMatching: number;
  viewAllHref: string;
}> {
  const viewAllHref = buildForecastViewAllHref(forecastFrom, forecastTo, scenario);

  if (!result.ok) {
    return errorBlock(result.error.code, result.error.field);
  }

  const matching = mapForecastCommitmentItems(result.value, direction, forecastFrom);
  if (matching.length === 0) {
    return emptyBlock();
  }

  return readyBlock({
    items: matching.slice(0, UPCOMING_ITEMS_LIMIT),
    totalMatching: matching.length,
    viewAllHref,
  });
}

function mapPeriodSummaryBlock(
  aggregation: PeriodAggregationResult | null,
  aggregationError: { code: string; field: string | null } | null,
  spendable: OriginResult<SpendableBreakdown>,
  forecast: OriginResult<ForecastTimeline>,
  periodKey: string,
): OverviewBlockEnvelope<OverviewPeriodSummary> {
  if (aggregationError || !aggregation) {
    return errorBlock(
      aggregationError?.code ?? "OVERVIEW_QUERY_FAILED",
      aggregationError?.field ?? null,
    );
  }

  const plannedBucket = forecast.ok
    ? forecast.value.periods.find((bucket) => bucket.period === periodKey)
    : undefined;

  const summary: OverviewPeriodSummary = {
    ...aggregation.summary,
    ...(spendable.ok
      ? { referenceBalanceCents: spendable.value.openingBalanceCents }
      : {}),
    ...(plannedBucket
      ? {
          planned: {
            inflowCents: plannedBucket.inflowCents,
            outflowCents: plannedBucket.outflowCents,
            realizedInflowCents: plannedBucket.realizedInflowCents,
            realizedOutflowCents: plannedBucket.realizedOutflowCents,
            projectedInflowCents: plannedBucket.projectedInflowCents,
            projectedOutflowCents: plannedBucket.projectedOutflowCents,
          },
        }
      : {}),
  };

  if (isPeriodSummaryEmpty(summary)) {
    return emptyBlock();
  }

  return readyBlock(summary);
}

function mapExpensesByCategoryBlock(
  aggregation: PeriodAggregationResult | null,
  aggregationError: { code: string; field: string | null } | null,
): OverviewBlockEnvelope<{
  totalExpenseCents: string;
  groups: readonly OverviewCategoryGroup[];
}> {
  if (aggregationError || !aggregation) {
    return errorBlock(
      aggregationError?.code ?? "OVERVIEW_QUERY_FAILED",
      aggregationError?.field ?? null,
    );
  }

  if (aggregation.groups.length === 0) {
    return emptyBlock();
  }

  return readyBlock({
    totalExpenseCents: aggregation.totalExpenseCents,
    groups: aggregation.groups,
  });
}

function mapCaixinhaItem(item: BudgetListItemReadModel): OverviewCaixinhaItem {
  return {
    referenceId: item.referenceId,
    name: item.name,
    balanceCents: item.balance.balanceCents,
    protectedCents: item.balance.protectedAmountCents,
    status: item.status,
    ...(item.period
      ? {
          periodContributionCents: item.period.contributionCents,
          periodWithdrawalCents: item.period.withdrawalCents,
        }
      : {}),
    ...(item.progress
      ? {
          progress: {
            progressCents: item.progress.progressCents,
            remainingCents: item.progress.remainingCents,
            progressBps: item.progress.progressBps,
            status: item.progress.status,
            paceStatus: item.progress.paceStatus,
          },
        }
      : {}),
  };
}

function mapCaixinhasBlock(
  result: OriginResult<import("@/modules/budgets/read-contracts").ListBudgetsReadModel>,
): OverviewBlockEnvelope<{
  status: "AVAILABLE" | "UNAVAILABLE";
  items: readonly OverviewCaixinhaItem[];
  totalCount: number;
  viewAllHref: string;
}> {
  const viewAllHref = BUDGETS_ROUTE;

  if (!result.ok) {
    return errorBlock(result.error.code, result.error.field);
  }

  const totalCount = result.value.items.length;
  if (totalCount === 0) {
    return emptyBlock();
  }

  return readyBlock({
    status: "AVAILABLE",
    items: result.value.items
      .slice(0, CAIXINHAS_ITEMS_LIMIT)
      .map(mapCaixinhaItem),
    totalCount,
    viewAllHref,
  });
}

function mapCardInvoiceItem(
  draft: OverviewCardInvoiceDraft,
): OverviewCardInvoiceItem {
  return {
    cardId: draft.cardId,
    cardName: draft.cardName,
    period: draft.period,
    dueOn: draft.dueOn,
    amountCents: draft.amountCents,
    state: draft.state,
  };
}

function mapCardInvoicesBlock(
  result: OriginResult<readonly OverviewCardInvoiceDraft[]>,
): OverviewBlockEnvelope<{
  items: readonly OverviewCardInvoiceItem[];
  viewAllHref: string;
}> {
  const viewAllHref = CREDIT_CARD_ROUTES.collection;

  if (!result.ok) {
    return errorBlock(result.error.code, result.error.field);
  }

  if (result.value.length === 0) {
    return emptyBlock();
  }

  return readyBlock({
    items: result.value.map(mapCardInvoiceItem),
    viewAllHref,
  });
}

/** Stub for T08 — returns no alerts until deterministic rules land. */
export function deriveOverviewAlerts(
  _readModel: OverviewReadModel,
): readonly OverviewAlert[] {
  return [];
}

function mapAlertsBlock(
  readModel: OverviewReadModel,
): OverviewBlockEnvelope<{ items: readonly OverviewAlert[] }> {
  return readyBlock({ items: deriveOverviewAlerts(readModel) });
}

function summarizeReadModel(value: unknown): S10OverviewResultSummary {
  const model = value as OverviewReadModel;
  const blocks = [
    model.spendable,
    model.periodSummary,
    model.expensesByCategory,
    model.upcomingCommitments,
    model.upcomingIncome,
    model.caixinhasSummary,
    model.cardInvoices,
    model.alerts,
  ];

  let readyBlockCount = 0;
  let errorBlockCount = 0;
  let emptyBlockCount = 0;

  for (const block of blocks) {
    if (block.state === "ready") readyBlockCount += 1;
    else if (block.state === "error") errorBlockCount += 1;
    else if (block.state === "empty") emptyBlockCount += 1;
  }

  return {
    readyBlockCount,
    errorBlockCount,
    emptyBlockCount,
    groupCount: model.expensesByCategory.data?.groups.length,
    itemCount:
      (model.upcomingCommitments.data?.totalMatching ?? 0) +
      (model.upcomingIncome.data?.totalMatching ?? 0),
    boxCount: model.caixinhasSummary.data?.totalCount,
    commitmentCount: model.upcomingCommitments.data?.totalMatching,
    alertCount: model.alerts.data?.items.length,
    originCount: 4,
    result: errorBlockCount > 0 ? "PARTIAL" : emptyBlockCount === blocks.length ? "EMPTY" : "AVAILABLE",
  };
}

function assembleReadModel(
  composition: ComposeOverviewOriginsResult,
  aggregation: PeriodAggregationResult | null,
  aggregationError: { code: string; field: string | null } | null,
): OverviewReadModel {
  const asOfDate = Temporal.PlainDate.from(composition.period.asOf);
  const forecastFrom = asOfDate.add({ days: 1 }).toString();
  const forecastTo = asOfDate.add({ days: composition.horizonDays }).toString();

  const partial: OverviewReadModel = {
    contractVersion: OVERVIEW_CONTRACT_VERSION,
    period: composition.period,
    scenario: composition.scenario,
    horizonDays: composition.horizonDays,
    spendable: mapSpendableBlock(composition.spendable),
    periodSummary: mapPeriodSummaryBlock(
      aggregation,
      aggregationError,
      composition.spendable,
      composition.forecast,
      composition.period.key,
    ),
    expensesByCategory: mapExpensesByCategoryBlock(aggregation, aggregationError),
    upcomingCommitments: mapForecastListBlock(
      composition.forecast,
      "OUTFLOW",
      forecastFrom,
      forecastTo,
      composition.scenario,
    ),
    upcomingIncome: mapForecastListBlock(
      composition.forecast,
      "INFLOW",
      forecastFrom,
      forecastTo,
      composition.scenario,
    ),
    caixinhasSummary: mapCaixinhasBlock(composition.budgets),
    cardInvoices: mapCardInvoicesBlock(composition.cardInvoices),
    alerts: readyBlock({ items: [] }),
  };

  return {
    ...partial,
    alerts: mapAlertsBlock(partial),
  };
}

async function readAggregationSafely(
  context: FinancialContext,
  period: OverviewPeriod,
  options: OverviewQueryOptions,
): Promise<
  | { readonly ok: true; readonly value: PeriodAggregationResult }
  | { readonly ok: false; readonly error: { readonly code: string; readonly field: string | null } }
> {
  try {
    const value = await readPeriodAggregationForContext(context, period, options);
    return { ok: true, value };
  } catch (error) {
    if (error instanceof OverviewQueryError) {
      return {
        ok: false,
        error: { code: error.code, field: error.field },
      };
    }
    return {
      ok: false,
      error: { code: "OVERVIEW_QUERY_FAILED", field: null },
    };
  }
}

export async function getOverviewForContext(
  context: FinancialContext,
  input?: GetOverviewInput,
  dependencies: OverviewServiceDependencies = {},
): Promise<OverviewResult<OverviewReadModel>> {
  const operation = createOverviewOperation("overview.read");
  const today = dependencies.today ?? currentFinancialDate;

  let normalized: ComposeOverviewInput;
  try {
    normalized = normalizeInput(input, today);
  } catch (error) {
    if (error instanceof OverviewDomainError) {
      return overviewReadFailure(error.code, error.field ?? null);
    }
    return overviewReadFailure("OVERVIEW_QUERY_FAILED");
  }

  const period = civilMonthPeriod(normalized.asOf ?? today().toString());
  const ports = dependencies.ports ?? createDefaultOverviewPorts(dependencies);

  try {
    const value = await withOverviewObservability(
      operation,
      async () => {
        const aggregationPromise = dependencies.readAggregation
          ? dependencies
              .readAggregation(context, period)
              .then((value) => ({ ok: true as const, value }))
              .catch((error) => {
                if (error instanceof OverviewQueryError) {
                  return {
                    ok: false as const,
                    error: { code: error.code, field: error.field },
                  };
                }
                return {
                  ok: false as const,
                  error: { code: "OVERVIEW_QUERY_FAILED", field: null },
                };
              })
          : readAggregationSafely(context, period, dependencies);

        const [composition, aggregationResult] = await Promise.all([
          composeOverviewOrigins(
            normalized,
            ports,
            dependencies.compositionOptions,
          ),
          aggregationPromise,
        ]);

        const aggregation = aggregationResult.ok ? aggregationResult.value : null;
        const aggregationError = aggregationResult.ok ? null : aggregationResult.error;

        return assembleReadModel(composition, aggregation, aggregationError);
      },
      { summarizeResult: summarizeReadModel },
    );

    return overviewReadOk(value);
  } catch (error) {
    if (error instanceof OverviewDomainError) {
      return overviewReadFailure(error.code, error.field ?? null);
    }
    return overviewReadFailure("OVERVIEW_QUERY_FAILED");
  }
}

export async function getOverview(
  input?: GetOverviewInput,
  dependencies: OverviewServiceDependencies = {},
): Promise<OverviewResult<OverviewReadModel>> {
  try {
    const resolveContext = dependencies.requireContext ?? requireFinancialContext;
    const context = await resolveContext();
    return getOverviewForContext(context, input, dependencies);
  } catch (error) {
    if (error instanceof OverviewDomainError) {
      return overviewReadFailure(error.code, error.field ?? null);
    }
    return overviewReadFailure("FINANCIAL_CONTEXT_REQUIRED");
  }
}

export function createOverviewReadAccess(
  defaults: OverviewServiceDependencies = {},
) {
  return {
    getOverviewForContext: (
      context: FinancialContext,
      input?: GetOverviewInput,
    ) => getOverviewForContext(context, input, defaults),
    getOverview: (input?: GetOverviewInput) => getOverview(input, defaults),
  };
}

export const overviewReadAccess = createOverviewReadAccess();
