import { Temporal } from "@js-temporal/polyfill";

import { currentFinancialDate } from "@/modules/transactions/dates";
import type { ListBudgetsReadModel } from "@/modules/budgets/read-contracts";
import type { ForecastTimeline } from "@/modules/forecast/contracts";
import type { SpendableBreakdown } from "@/modules/spendable/contracts";

import {
  mapOriginErrorCode,
  type OriginResult,
  type OverviewCardInvoiceDraft,
  type OverviewOriginPorts,
} from "./ports";

export const DEFAULT_OVERVIEW_HORIZON_DAYS = 90;
export const DEFAULT_OVERVIEW_SCENARIO = "CONSERVATIVE" as const;
export const DEFAULT_OVERVIEW_TIMEOUT_MS = 2_500;

export type OverviewScenario = "CONSERVATIVE" | "EXPECTED";

export interface ComposeOverviewInput {
  readonly asOf?: string;
  readonly scenario?: OverviewScenario;
  readonly horizon?: { readonly days: number };
}

export interface OverviewCompositionPeriod {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly asOf: string;
}

export interface ComposeOverviewOriginsResult {
  readonly period: OverviewCompositionPeriod;
  readonly scenario: OverviewScenario;
  readonly horizonDays: number;
  readonly spendable: OriginResult<SpendableBreakdown>;
  readonly forecast: OriginResult<ForecastTimeline>;
  readonly budgets: OriginResult<ListBudgetsReadModel>;
  readonly cardInvoices: OriginResult<readonly OverviewCardInvoiceDraft[]>;
}

export interface ComposeOverviewOptions {
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly today?: () => Temporal.PlainDate;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePlainDate(value: string): Temporal.PlainDate {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new Error("INVALID_DATE");
  }
  return Temporal.PlainDate.from(value);
}

/** Civil month window for the overview period (T02-compatible helper). */
export function civilMonthPeriod(asOf: Temporal.PlainDate): OverviewCompositionPeriod {
  const from = asOf.with({ day: 1 });
  const to = asOf.with({ day: asOf.daysInMonth });
  const key = `${String(asOf.year).padStart(4, "0")}-${String(asOf.month).padStart(2, "0")}`;

  return {
    key,
    from: from.toString(),
    to: to.toString(),
    asOf: asOf.toString(),
  };
}

function resolveAsOf(
  input: ComposeOverviewInput,
  today: () => Temporal.PlainDate,
): Temporal.PlainDate {
  if (input.asOf === undefined) {
    return today();
  }
  return parsePlainDate(input.asOf);
}

function resolveScenario(input: ComposeOverviewInput): OverviewScenario {
  return input.scenario ?? DEFAULT_OVERVIEW_SCENARIO;
}

function resolveHorizonDays(input: ComposeOverviewInput): number {
  const days = input.horizon?.days;
  if (days === undefined) {
    return DEFAULT_OVERVIEW_HORIZON_DAYS;
  }
  if (!Number.isSafeInteger(days) || days < 1) {
    throw new Error("INVALID_HORIZON");
  }
  return days;
}

function sanitizeOriginResult<T>(result: OriginResult<T>): OriginResult<T> {
  if (result.ok) {
    return result;
  }
  return {
    ok: false,
    error: {
      code: mapOriginErrorCode(result.error.code),
      field: result.error.field,
    },
  };
}

async function readOriginWithTimeout<T>(
  work: () => Promise<OriginResult<T>>,
  timeoutMs: number,
): Promise<OriginResult<T>> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work().then(sanitizeOriginResult),
      new Promise<OriginResult<T>>((resolve) => {
        timeoutHandle = setTimeout(() => {
          resolve({
            ok: false,
            error: { code: "OVERVIEW_ORIGIN_UNAVAILABLE", field: null },
          });
        }, timeoutMs);
      }),
    ]);
  } catch {
    return {
      ok: false,
      error: { code: "OVERVIEW_ORIGIN_UNAVAILABLE", field: null },
    };
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Composes the four overview origin reads concurrently without assembling the
 * public `s10.v1` read model. Each origin is invoked at most once.
 */
export async function composeOverviewOrigins(
  input: ComposeOverviewInput = {},
  ports: OverviewOriginPorts,
  options: ComposeOverviewOptions = {},
): Promise<ComposeOverviewOriginsResult> {
  if (!isRecord(input)) {
    throw new Error("INVALID_OVERVIEW_INPUT");
  }

  const today = options.today ?? currentFinancialDate;
  const asOfDate = resolveAsOf(input, today);
  const scenario = resolveScenario(input);
  const horizonDays = resolveHorizonDays(input);
  const period = civilMonthPeriod(asOfDate);
  const asOf = period.asOf;
  const forecastFrom = asOfDate.add({ days: 1 }).toString();
  const forecastTo = asOfDate.add({ days: horizonDays }).toString();
  const timeoutMs = options.timeoutMs ?? DEFAULT_OVERVIEW_TIMEOUT_MS;

  const [spendable, forecast, budgets, cardInvoices] = await Promise.all([
    readOriginWithTimeout(
      () =>
        ports.readSpendable({
          asOf,
          scenario,
          horizonDays,
        }),
      timeoutMs,
    ),
    readOriginWithTimeout(
      () =>
        ports.readForecast({
          from: forecastFrom,
          to: forecastTo,
          scenario,
        }),
      timeoutMs,
    ),
    readOriginWithTimeout(() => ports.readBudgets({ asOf }), timeoutMs),
    readOriginWithTimeout(() => ports.readCardInvoices({ asOf }), timeoutMs),
  ]);

  return {
    period,
    scenario,
    horizonDays,
    spendable,
    forecast,
    budgets,
    cardInvoices,
  };
}
