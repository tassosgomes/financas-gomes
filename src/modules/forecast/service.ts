/**
 * Server-side read service for the S07 household forecast.
 *
 * This module is the only composition boundary between the authenticated
 * financial context, the persistence readers and the pure timeline builder.
 * The public query deliberately contains no household/user/resource
 * authority.  Persistence records stay inside this module and only the
 * serializable `ForecastTimeline` is returned.
 */
import { Temporal } from "@js-temporal/polyfill";

import { currentFinancialDate } from "@/modules/transactions/dates";
import {
  requireFinancialContext,
} from "@/modules/households/context";
import {
  FinancialContextError,
  type FinancialContext,
} from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import {
  createS07ForecastOperation,
  measureS07Query,
  toS07ErrorEnvelope,
  withS07ForecastObservability,
  type S07ForecastCompletionOptions,
  type S07ForecastOperationContext,
  type S07ForecastOperationOptions,
  type S07ForecastQueryOptions,
} from "@/modules/observability/s07";

import {
  buildForecastTimelineFromSources,
  ForecastBuilderError,
  type ForecastTimelineBuilderInput,
} from "./builder";
import {
  FORECAST_CONTRACT_VERSION,
  getForecastQuerySchema,
  isoDateSchema,
  parseForecastTimeline,
  type ForecastErrorCode,
  type ForecastResult,
  type ForecastScenario,
  type ForecastTimeline,
  type GetForecastQuery,
} from "./contracts";
import {
  ForecastEngineError,
} from "./engine";
import {
  readForecastSourcesForContext,
  ForecastSourceError,
  type ForecastReadExecutor,
  type ForecastSourceBundle,
  type ForecastSourceDateRange,
  type ForecastSourceReadOptions,
} from "./sources";

/** Maximum default horizon. It is intentionally greater than twelve months. */
export const DEFAULT_FORECAST_MAX_RANGE_MONTHS = 120;
export const DEFAULT_FORECAST_MAX_RANGE_DAYS = 3_660;
export const DEFAULT_FORECAST_MAX_SOURCE_ROWS = 250_000;
export const DEFAULT_FORECAST_MAX_ITEMS = 250_000;

/** Hard caps keep an accidental environment value from disabling the guard. */
export const MAX_FORECAST_RANGE_MONTHS = 1_200;
export const MAX_FORECAST_RANGE_DAYS = 36_600;
export const MAX_FORECAST_SOURCE_ROWS = 1_000_000;
export const MAX_FORECAST_ITEMS = 1_000_000;

const FORECAST_MAX_RANGE_MONTHS_ENV = "S07_FORECAST_MAX_RANGE_MONTHS";
const FORECAST_MAX_RANGE_DAYS_ENV = "S07_FORECAST_MAX_RANGE_DAYS";
const FORECAST_MAX_SOURCE_ROWS_ENV = "S07_FORECAST_MAX_SOURCE_ROWS";
const FORECAST_MAX_ITEMS_ENV = "S07_FORECAST_MAX_ITEMS";

/** A source reader is injectable for deterministic unit tests and fixtures. */
export type ForecastSourceReader = (
  context: FinancialContext,
  range: ForecastSourceDateRange,
  options?: ForecastSourceReadOptions,
) => Promise<ForecastSourceBundle> | ForecastSourceBundle;

/** The builder remains a pure function at this boundary. */
export type ForecastTimelineBuilder = (
  input: ForecastTimelineBuilderInput,
) => ForecastTimeline;

export type ForecastClockValue = string | Temporal.PlainDate;

/**
 * Dependency hooks are server composition concerns, not query fields. In
 * particular, there is deliberately no `context` or `householdId` option:
 * callers must either use the authenticated resolver or inject a resolver in
 * a trusted test/composition root.
 */
export interface ForecastServiceDependencies {
  resolveContext?: (
    requestHeaders?: HeadersInit,
  ) => Promise<FinancialContext> | FinancialContext;
  readSources?: ForecastSourceReader;
  buildTimeline?: ForecastTimelineBuilder;
  database?: ForecastReadExecutor;
  /** Server clock hook used by tests; the browser cannot provide this value. */
  clock?: () => ForecastClockValue;
  /** Explicit server-side business date hook, useful for deterministic tests. */
  today?: ForecastClockValue;
  requestHeaders?: HeadersInit;
  maxRangeMonths?: number;
  maxRangeDays?: number;
  maxSourceRows?: number;
  maxItems?: number;
  observability?: S07ForecastCompletionOptions & S07ForecastOperationOptions;
}

export interface ForecastServiceLimits {
  maxRangeMonths: number;
  maxRangeDays: number;
  maxSourceRows: number;
  maxItems: number;
}

interface NormalizedForecastQuery {
  from: string;
  to: string;
  scenario: ForecastScenario;
  range: ForecastSourceDateRange;
  periodBucket: "SINGLE_PERIOD" | "SHORT" | "MEDIUM" | "LONG";
  dayCount: number;
  monthCount: number;
}

/** Stable technical error used before the public result boundary. */
export class ForecastServiceError extends Error {
  readonly code: ForecastErrorCode;
  readonly field: "from" | "to" | "scenario" | null;

  constructor(
    code: ForecastErrorCode,
    field: "from" | "to" | "scenario" | null = null,
  ) {
    super(code);
    this.name = "ForecastServiceError";
    this.code = code;
    this.field = field;
  }
}

function fail(
  code: ForecastErrorCode,
  field: "from" | "to" | "scenario" | null = null,
): never {
  throw new ForecastServiceError(code, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function integerLimit(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  let candidate = value;
  if (candidate === undefined) {
    return fallback;
  }

  if (typeof candidate === "string" && /^\d+$/u.test(candidate.trim())) {
    candidate = Number(candidate.trim());
  }

  if (
    typeof candidate !== "number" ||
    !Number.isFinite(candidate) ||
    !Number.isInteger(candidate) ||
    candidate < 1
  ) {
    return fallback;
  }

  return Math.min(candidate, maximum);
}

function configuredLimit(
  explicit: unknown,
  environmentName: string,
  fallback: number,
  maximum: number,
): number {
  const environmentValue =
    typeof process !== "undefined" ? process.env[environmentName] : undefined;
  return integerLimit(explicit ?? environmentValue, fallback, maximum);
}

export function getForecastLimits(
  dependencies: Pick<
    ForecastServiceDependencies,
    "maxRangeMonths" | "maxRangeDays" | "maxSourceRows" | "maxItems"
  > = {},
): ForecastServiceLimits {
  return {
    maxRangeMonths: configuredLimit(
      dependencies.maxRangeMonths,
      FORECAST_MAX_RANGE_MONTHS_ENV,
      DEFAULT_FORECAST_MAX_RANGE_MONTHS,
      MAX_FORECAST_RANGE_MONTHS,
    ),
    maxRangeDays: configuredLimit(
      dependencies.maxRangeDays,
      FORECAST_MAX_RANGE_DAYS_ENV,
      DEFAULT_FORECAST_MAX_RANGE_DAYS,
      MAX_FORECAST_RANGE_DAYS,
    ),
    maxSourceRows: configuredLimit(
      dependencies.maxSourceRows,
      FORECAST_MAX_SOURCE_ROWS_ENV,
      DEFAULT_FORECAST_MAX_SOURCE_ROWS,
      MAX_FORECAST_SOURCE_ROWS,
    ),
    maxItems: configuredLimit(
      dependencies.maxItems,
      FORECAST_MAX_ITEMS_ENV,
      DEFAULT_FORECAST_MAX_ITEMS,
      MAX_FORECAST_ITEMS,
    ),
  };
}

function parseDate(value: unknown, field: "from" | "to"): string {
  const parsed = isoDateSchema.safeParse(value);
  if (!parsed.success) {
    return fail("INVALID_DATE", field);
  }
  return parsed.data;
}

function parseClockDate(value: unknown): string {
  const parsed = isoDateSchema.safeParse(
    value instanceof Temporal.PlainDate ? value.toString() : value,
  );
  if (!parsed.success) {
    return fail("FORECAST_QUERY_FAILED");
  }
  return parsed.data;
}

function monthStart(value: string): string {
  try {
    return Temporal.PlainDate.from(value).with({ day: 1 }).toString();
  } catch {
    return fail("FORECAST_QUERY_FAILED");
  }
}

function monthEnd(value: string): string {
  try {
    const date = Temporal.PlainDate.from(value);
    return date.with({ day: date.daysInMonth }).toString();
  } catch {
    return fail("FORECAST_QUERY_FAILED");
  }
}

function periodBucket(
  monthCount: number,
): NormalizedForecastQuery["periodBucket"] {
  if (monthCount <= 1) return "SINGLE_PERIOD";
  if (monthCount <= 3) return "SHORT";
  if (monthCount <= 12) return "MEDIUM";
  return "LONG";
}

function queryValidationError(
  value: unknown,
): ForecastServiceError {
  if (!isRecord(value)) {
    return new ForecastServiceError("FORECAST_QUERY_FAILED");
  }

  const parsed = getForecastQuerySchema.safeParse(value);
  if (parsed.success) {
    return new ForecastServiceError("FORECAST_QUERY_FAILED");
  }

  const issue = parsed.error.issues[0];
  const field = issue?.path[0];
  if (field === "from" || field === "to") {
    return new ForecastServiceError("INVALID_DATE", field);
  }
  if (field === "scenario") {
    return new ForecastServiceError("INVALID_SCENARIO", "scenario");
  }

  // The public contract has no arbitrary-field error. Return an opaque
  // generic query failure for strict-schema violations such as householdId.
  return new ForecastServiceError("FORECAST_QUERY_FAILED");
}

function serverToday(
  dependencies: ForecastServiceDependencies,
): string {
  try {
    const value = dependencies.clock?.() ?? dependencies.today;
    return parseClockDate(value ?? currentFinancialDate());
  } catch (error) {
    if (error instanceof ForecastServiceError) throw error;
    return fail("FORECAST_QUERY_FAILED");
  }
}

function normalizedQuery(
  input: unknown,
  dependencies: ForecastServiceDependencies,
): NormalizedForecastQuery {
  const candidate = input === undefined ? {} : input;
  const parsed = getForecastQuerySchema.safeParse(candidate);
  if (!parsed.success) {
    throw queryValidationError(candidate);
  }

  const query = parsed.data as GetForecastQuery;
  let from: string;
  let to: string;
  if (query.from === undefined && query.to === undefined) {
    const today = serverToday(dependencies);
    from = monthStart(today);
    to = monthEnd(today);
  } else if (query.from !== undefined && query.to === undefined) {
    from = parseDate(query.from, "from");
    to = monthEnd(from);
  } else if (query.from === undefined && query.to !== undefined) {
    to = parseDate(query.to, "to");
    from = monthStart(to);
  } else {
    from = parseDate(query.from, "from");
    to = parseDate(query.to, "to");
  }

  if (from > to) {
    return fail("INVALID_DATE_RANGE", "from");
  }

  let dayCount: number;
  let monthCount: number;
  try {
    const first = Temporal.PlainDate.from(from);
    const last = Temporal.PlainDate.from(to);
    dayCount = first.until(last, { largestUnit: "days" }).days + 1;
    monthCount = (last.year - first.year) * 12 + last.month - first.month + 1;
  } catch {
    return fail("FORECAST_QUERY_FAILED");
  }

  return {
    from,
    to,
    scenario: query.scenario ?? "CONSERVATIVE",
    range: { from, to },
    periodBucket: periodBucket(monthCount),
    dayCount,
    monthCount,
  };
}

function enforceRangeLimits(
  query: NormalizedForecastQuery,
  limits: ForecastServiceLimits,
): void {
  if (
    query.monthCount > limits.maxRangeMonths ||
    query.dayCount > limits.maxRangeDays
  ) {
    return fail("FORECAST_RANGE_TOO_LARGE");
  }
}

function sourceCount(bundle: ForecastSourceBundle): number {
  const collections: unknown[] = [
    bundle.realizedEvents,
    bundle.recurringRules,
    bundle.recurringOccurrences,
    bundle.plannedEvents,
    bundle.installments,
  ];
  if (!collections.every(Array.isArray)) {
    return fail("FORECAST_QUERY_FAILED");
  }
  return collections.reduce(
    (total, collection) => total + (collection as readonly unknown[]).length,
    0,
  );
}

function assertBundleShape(
  bundle: unknown,
  context: FinancialContext,
): asserts bundle is ForecastSourceBundle {
  if (!isRecord(bundle) || !isRecord(bundle.openingBalance)) {
    return fail("FORECAST_QUERY_FAILED");
  }
  const candidate = bundle as unknown as ForecastSourceBundle;
  if (
    typeof candidate.householdId !== "string" ||
    candidate.householdId !== context.householdId ||
    (typeof candidate.openingBalance.householdId === "string" &&
      candidate.openingBalance.householdId !== context.householdId)
  ) {
    // A reader that returns another tenant is treated exactly like an absent
    // resource; neither the foreign id nor the existence of the row is
    // disclosed at this boundary.
    return fail("FORECAST_NOT_FOUND");
  }
  sourceCount(candidate);
}

function timelineItemCount(timeline: ForecastTimeline): number {
  return timeline.days.reduce((total, day) => total + day.items.length, 0);
}

function sourceAggregateCounts(bundle: ForecastSourceBundle): {
  sourceCount: number;
  recurringCount: number;
  plannedEventCount: number;
  installmentCount: number;
  realizedEventCount: number;
  cancelledCount: number;
} {
  const recurringCount =
    bundle.recurringRules.length + bundle.recurringOccurrences.length;
  const plannedEventCount = bundle.plannedEvents.length;
  const installmentCount = bundle.installments.length;
  const realizedEventCount = bundle.realizedEvents.length;
  const cancelledCount = [
    ...bundle.recurringOccurrences,
    ...bundle.plannedEvents,
    ...bundle.installments,
  ].filter((row) => {
    if (!isRecord(row)) return false;
    const occurrence = isRecord(row.occurrence) ? row.occurrence : undefined;
    const planned = isRecord(row.plannedEvent) ? row.plannedEvent : undefined;
    const installment = isRecord(row.installment) ? row.installment : undefined;
    const status = occurrence?.status ?? planned?.status ?? installment?.status;
    return status === "CANCELLED";
  }).length;

  return {
    sourceCount: sourceCount(bundle),
    recurringCount,
    plannedEventCount,
    installmentCount,
    realizedEventCount,
    cancelledCount,
  };
}

function safeObservation(
  dependencies: ForecastServiceDependencies,
  query: NormalizedForecastQuery,
  context?: FinancialContext,
): S07ForecastCompletionOptions & S07ForecastOperationOptions {
  const supplied = dependencies.observability ?? {};
  // Tenant/user identifiers are server-derived. A caller-provided telemetry
  // object must not become a substitute for the resolved financial context.
  const safeSupplied = { ...supplied };
  delete safeSupplied.householdId;
  delete safeSupplied.userId;
  return {
    ...safeSupplied,
    scenario: query.scenario,
    periodBucket: query.periodBucket,
    ...(context
      ? {
          userId: context.userId,
          householdId: context.householdId,
        }
      : {}),
  };
}

function sourceReadOptions(
  dependencies: ForecastServiceDependencies,
  observation: S07ForecastCompletionOptions & S07ForecastOperationOptions,
  operation: S07ForecastOperationContext,
  context: FinancialContext,
): ForecastSourceReadOptions {
  const options: ForecastSourceReadOptions = {
    ...(dependencies.database ? { database: dependencies.database } : {}),
    observability: {
      requestId: operation.requestId,
      userId: context.userId,
      scenario: observation.scenario,
      correlationId: observation.correlationId,
    },
  };
  return options;
}

function queryOptions(
  observation: S07ForecastCompletionOptions & S07ForecastOperationOptions,
  technicalErrorCode: string,
): S07ForecastQueryOptions {
  return {
    ...observation,
    technicalErrorCode,
  } as S07ForecastQueryOptions;
}

function mapError(
  error: unknown,
  fallback: ForecastErrorCode = "FORECAST_QUERY_FAILED",
): ForecastServiceError {
  if (error instanceof ForecastServiceError) return error;
  if (error instanceof FinancialContextError) {
    return new ForecastServiceError("FINANCIAL_CONTEXT_REQUIRED");
  }
  if (error instanceof ForecastSourceError) {
    if (error.code === "INVALID_DATE") {
      return new ForecastServiceError(
        "INVALID_DATE",
        error.field === "to" ? "to" : "from",
      );
    }
    if (error.code === "INVALID_DATE_RANGE") {
      return new ForecastServiceError("INVALID_DATE_RANGE", "from");
    }
    return new ForecastServiceError("FORECAST_QUERY_FAILED");
  }
  if (error instanceof ForecastBuilderError) {
    if (error.code === "INVALID_DATE") {
      return new ForecastServiceError(
        "INVALID_DATE",
        error.field === "to" ? "to" : "from",
      );
    }
    if (error.code === "INVALID_DATE_RANGE") {
      return new ForecastServiceError("INVALID_DATE_RANGE", "from");
    }
    if (error.code === "TENANT_RESOURCE_NOT_FOUND") {
      return new ForecastServiceError("FORECAST_NOT_FOUND");
    }
    if (error.code === "FORECAST_INCONSISTENT") {
      return new ForecastServiceError("FORECAST_INCONSISTENT");
    }
    return new ForecastServiceError("FORECAST_QUERY_FAILED");
  }
  if (error instanceof ForecastEngineError) {
    if (error.code === "INVALID_DATE") {
      return new ForecastServiceError(
        "INVALID_DATE",
        error.field === "to" ? "to" : "from",
      );
    }
    if (error.code === "INVALID_DATE_RANGE") {
      return new ForecastServiceError("INVALID_DATE_RANGE", "from");
    }
    if (error.code === "INVALID_SCENARIO") {
      return new ForecastServiceError("INVALID_SCENARIO", "scenario");
    }
    if (error.code === "FORECAST_INCONSISTENT") {
      return new ForecastServiceError("FORECAST_INCONSISTENT");
    }
    return new ForecastServiceError("FORECAST_QUERY_FAILED");
  }
  return new ForecastServiceError(fallback);
}

function publicFailure<T>(error: unknown): ForecastResult<T> {
  const mapped = mapError(error);
  const envelope = toS07ErrorEnvelope(mapped);
  return envelope as ForecastResult<T>;
}

function validatedPublicTimeline(
  timeline: unknown,
  query: NormalizedForecastQuery,
): ForecastTimeline {
  let parsed: ForecastTimeline;
  try {
    // A JSON round-trip keeps Drizzle records, Date, bigint and custom class
    // instances from crossing the public boundary even if a test adapter is
    // accidentally supplied instead of the production builder.
    parsed = parseForecastTimeline(JSON.parse(JSON.stringify(timeline)) as unknown);
  } catch {
    return fail("FORECAST_QUERY_FAILED");
  }

  if (
    parsed.contractVersion !== FORECAST_CONTRACT_VERSION ||
    parsed.from !== query.from ||
    parsed.to !== query.to ||
    parsed.scenario !== query.scenario
  ) {
    return fail("FORECAST_INCONSISTENT");
  }
  return parsed;
}

async function runForecast(
  query: NormalizedForecastQuery,
  dependencies: ForecastServiceDependencies,
  limits: ForecastServiceLimits,
  rootOperation: S07ForecastOperationContext,
): Promise<ForecastTimeline> {
  const resolveContext =
    dependencies.resolveContext ??
    ((requestHeaders?: HeadersInit) =>
      requireFinancialContext(
        requestHeaders === undefined ? {} : { requestHeaders },
      ));
  const context =
    dependencies.resolveContext === undefined &&
    dependencies.requestHeaders === undefined
      ? await resolveContext()
      : await resolveContext(dependencies.requestHeaders);
  assertFinancialContext(context);

  const observation = safeObservation(dependencies, query, context);
  const operationOptions = {
    ...observation,
    requestId: rootOperation.requestId,
    userId: context.userId,
    householdId: context.householdId,
  };
  const sourceOperation = createS07ForecastOperation("source", operationOptions);
  const reader = dependencies.readSources ?? readForecastSourcesForContext;
  const bundle = await measureS07Query(
    sourceOperation,
    async () => {
      try {
        return await reader(
          context,
          query.range,
          sourceReadOptions(dependencies, observation, sourceOperation, context),
        );
      } catch (error) {
        throw mapError(error, "FORECAST_QUERY_FAILED");
      }
    },
    queryOptions(observation, "FORECAST_SOURCE_QUERY_FAILED"),
  );
  assertBundleShape(bundle, context);

  const counts = sourceAggregateCounts(bundle);
  if (counts.sourceCount > limits.maxSourceRows) {
    return fail("FORECAST_RANGE_TOO_LARGE");
  }

  const builderInput = {
    ...bundle,
    // The context is server-owned and allows T04 to reject malformed or
    // cross-tenant relationship rows before they become forecast items.
    context,
    from: query.from,
    to: query.to,
    scenario: query.scenario,
    observability: {
      ...observation,
      requestId: rootOperation.requestId,
      ...counts,
    },
  } as ForecastTimelineBuilderInput;
  const builderOperation = createS07ForecastOperation("builder", {
    ...operationOptions,
    ...counts,
  });
  const engineOperation = createS07ForecastOperation("engine", {
    ...operationOptions,
    ...counts,
  });
  const builder = dependencies.buildTimeline ?? buildForecastTimelineFromSources;
  const timeline = await measureS07Query(
    builderOperation,
    async () => {
      try {
        // T04 composes the pure engine internally. Keep an engine measurement
        // around that composition so slow-stage telemetry remains attributable
        // without moving persistence into T05.
        return await measureS07Query(
          engineOperation,
          () => builder(builderInput),
          queryOptions(observation, "FORECAST_ENGINE_FAILED"),
        );
      } catch (error) {
        throw mapError(error, "FORECAST_INCONSISTENT");
      }
    },
    queryOptions(observation, "FORECAST_BUILDER_FAILED"),
  );

  const publicTimeline = validatedPublicTimeline(timeline, query);
  if (timelineItemCount(publicTimeline) > limits.maxItems) {
    return fail("FORECAST_RANGE_TOO_LARGE");
  }
  return publicTimeline;
}

/**
 * Reads a household forecast. The returned envelope is safe to cross a
 * Server Action/route boundary: it contains either the public timeline or
 * only an allow-listed error code and field.
 */
export async function getForecast(
  input?: unknown,
  dependencies: ForecastServiceDependencies = {},
): Promise<ForecastResult<ForecastTimeline>> {
  let query: NormalizedForecastQuery;
  try {
    query = normalizedQuery(input, dependencies);
  } catch (error) {
    return publicFailure(error);
  }

  const limits = getForecastLimits(dependencies);
  try {
    enforceRangeLimits(query, limits);
  } catch (error) {
    return publicFailure(error);
  }

  const rootOperation = createS07ForecastOperation("query", {
    ...safeObservation(dependencies, query),
  });

  try {
    const value = await withS07ForecastObservability(
      rootOperation,
      () => runForecast(query, dependencies, limits, rootOperation),
      safeObservation(dependencies, query),
    );
    return { ok: true, value: validatedPublicTimeline(value, query) };
  } catch (error) {
    return publicFailure(error);
  }
}

/** Factory form used by server composition/tests without global mutable state. */
export function createForecastService(
  defaults: ForecastServiceDependencies = {},
): {
  getForecast: (
    input?: unknown,
  ) => Promise<ForecastResult<ForecastTimeline>>;
} {
  return {
    getForecast: (input?: unknown) => getForecast(input, defaults),
  };
}

/** Naming aliases used by S08/T09 adapters while the route is composed. */
export const getForecastTimeline = getForecast;
export const getForecastQuery = getForecast;
export const forecastService = createForecastService();
