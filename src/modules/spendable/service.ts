/**
 * Server-side S08 availability read service.
 *
 * The browser supplies only `asOf`, scenario and horizon. The financial
 * context is resolved here, the realized opening position is read from
 * GENERAL accounts, S07 remains the only forecast source, and T03 performs
 * the final pure calculation. No spendable snapshot is persisted.
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
  getForecast as readForecast,
  type ForecastServiceDependencies,
} from "@/modules/forecast/service";
import {
  parseForecastTimeline,
  type ForecastResult,
  type ForecastTimeline,
  type GetForecastQuery,
} from "@/modules/forecast/contracts";
import {
  createSpendableOperation,
  measureSpendableQuery,
  toSpendableErrorEnvelope,
  withSpendableObservability,
  type SpendableCompletionOptions,
  type SpendableOperationContext,
  type SpendableOperationOptions,
  type SpendableQueryOptions as SpendableObservabilityQueryOptions,
  type SpendableSafeErrorEnvelope,
} from "@/modules/observability/spendable";

import {
  normalizeSpendableTimeline,
} from "./timeline";
import {
  SpendableEngine,
  MAX_SPENDABLE_HORIZON_DAYS as ENGINE_MAX_SPENDABLE_HORIZON_DAYS,
  type SpendableEngineInput,
} from "./engine";
import {
  parseSpendableBreakdown,
  spendableCents,
  spendableDate,
  spendableNonNegativeCents,
  spendableReference,
  SPENDABLE_SCENARIOS,
  type GetSpendableInput,
  type NormalizedGetSpendableInput,
  type OperationalBufferSnapshot,
  type SpendableBreakdown,
  type SpendableBufferSource,
  type SpendableScenario,
} from "./contracts";
import {
  readReserveSnapshot,
  ZeroReserveAdapter,
  type ReserveSnapshotDomain,
  type SpendableReserveAdapter,
} from "./reserve-adapter";
import {
  readSpendableBufferForContext,
  readSpendableOpeningBalanceForContext,
  type SpendableBufferReadModel,
  type SpendableOpeningBalanceReadModel,
  type SpendableQueryError,
  type SpendableQueryOptions,
  type SpendableReadExecutor,
  SpendableResourceNotFoundError,
} from "./query";

export const DEFAULT_SPENDABLE_HORIZON_DAYS = 90;
export const MAX_SPENDABLE_SERVICE_HORIZON_DAYS = ENGINE_MAX_SPENDABLE_HORIZON_DAYS;

const SPENDABLE_MAX_HORIZON_ENV_NAMES = [
  "SPENDABLE_MAX_HORIZON_DAYS",
  "S08_SPENDABLE_MAX_HORIZON_DAYS",
  "S08_MAX_HORIZON_DAYS",
] as const;

type SpendableErrorField = "asOf" | "horizon" | "scenario" | "buffer" | null;

/** Stable service-level error used before the public safe envelope. */
export class SpendableServiceError extends Error {
  readonly code: string;
  readonly field: SpendableErrorField;

  constructor(code: string, field: SpendableErrorField = null) {
    super(code);
    this.name = "SpendableServiceError";
    this.code = code;
    this.field = field;
  }
}

export interface SpendableServiceLimits {
  readonly maxHorizonDays: number;
}

export interface SpendableOpeningBalanceReaderOptions extends SpendableQueryOptions {
  readonly requestId?: string;
}

export type SpendableOpeningBalanceReader = (
  context: FinancialContext,
  asOf: string,
  options?: SpendableOpeningBalanceReaderOptions,
) =>
  | SpendableOpeningBalanceReadModel
  | string
  | bigint
  | Promise<SpendableOpeningBalanceReadModel | string | bigint>;

export type SpendableBufferReader = (
  context: FinancialContext,
  asOf: string,
  options?: SpendableOpeningBalanceReaderOptions,
) =>
  | SpendableBufferReadModel
  | OperationalBufferSnapshot
  | null
  | undefined
  | Promise<SpendableBufferReadModel | OperationalBufferSnapshot | null | undefined>;

/** S07 is injected only as a read boundary; its source rows stay internal. */
export type SpendableForecastReader = (
  input: GetForecastQuery,
  dependencies?: ForecastServiceDependencies,
) =>
  | ForecastResult<ForecastTimeline>
  | ForecastTimeline
  | Promise<ForecastResult<ForecastTimeline> | ForecastTimeline>;

export interface SpendableServiceDependencies {
  /** Server-only resolver. There is deliberately no context/household input. */
  readonly resolveContext?: (
    requestHeaders?: HeadersInit,
  ) => Promise<FinancialContext> | FinancialContext;
  readonly requestHeaders?: HeadersInit;
  readonly database?: SpendableReadExecutor;
  /** Server-owned fixture/composition overrides; never request fields. */
  readonly openingBalance?: SpendableOpeningBalanceReadModel | string | bigint;
  readonly operationalBuffer?: SpendableBufferReadModel | OperationalBufferSnapshot | null;
  readonly buffer?: SpendableBufferReadModel | OperationalBufferSnapshot | null;
  readonly readOpeningBalance?: SpendableOpeningBalanceReader;
  readonly readBuffer?: SpendableBufferReader;
  /** Compatibility aliases for composition roots while S08 settles. */
  readonly readOperationalBuffer?: SpendableBufferReader;
  readonly readForecast?: SpendableForecastReader;
  readonly forecastReader?: SpendableForecastReader;
  readonly getForecast?: SpendableForecastReader;
  readonly reserveAdapter?: SpendableReserveAdapter;
  /** Optional server-side composition hook; context is resolved first. */
  readonly reserveAdapterFactory?: (
    context: FinancialContext,
  ) => SpendableReserveAdapter;
  readonly clock?: () => string | Temporal.PlainDate;
  readonly today?: string | Temporal.PlainDate;
  readonly maxHorizonDays?: number;
  readonly observability?: SpendableCompletionOptions &
    SpendableObservabilityQueryOptions &
    Partial<SpendableOperationOptions>;
}

export type SpendableResult<T> =
  | { readonly ok: true; readonly value: T }
  | SpendableSafeErrorEnvelope;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: string, field: SpendableErrorField = null): never {
  throw new SpendableServiceError(code, field);
}

function configuredInteger(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  let candidate = value;
  if (typeof candidate === "string" && /^\d+$/u.test(candidate.trim())) {
    candidate = Number(candidate.trim());
  }
  if (
    typeof candidate !== "number" ||
    !Number.isSafeInteger(candidate) ||
    candidate < 1
  ) {
    return fallback;
  }
  return Math.min(candidate, maximum);
}

export function getSpendableLimits(
  dependencies: Pick<SpendableServiceDependencies, "maxHorizonDays"> = {},
): SpendableServiceLimits {
  let configured: unknown = dependencies.maxHorizonDays;
  if (configured === undefined && typeof process !== "undefined") {
    for (const name of SPENDABLE_MAX_HORIZON_ENV_NAMES) {
      if (process.env[name] !== undefined) {
        configured = process.env[name];
        break;
      }
    }
  }
  return {
    maxHorizonDays: configuredInteger(
      configured,
      ENGINE_MAX_SPENDABLE_HORIZON_DAYS,
      ENGINE_MAX_SPENDABLE_HORIZON_DAYS,
    ),
  };
}

function serverDate(dependencies: SpendableServiceDependencies): string {
  const value = dependencies.clock?.() ?? dependencies.today ?? currentFinancialDate();
  try {
    return spendableDate(value, "asOf").toString();
  } catch {
    return fail("SPENDABLE_READ_FAILED");
  }
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const permitted = new Set(allowed);
  return Object.keys(value).every((key) => permitted.has(key));
}

/** Strict server-side parser for the only fields accepted from a browser. */
export function normalizeGetSpendableInput(
  input: unknown = {},
  dependencies: SpendableServiceDependencies = {},
): NormalizedGetSpendableInput {
  const limits = getSpendableLimits(dependencies);
  const candidate = input === undefined ? {} : input;
  if (!isRecord(candidate) || !exactKeys(candidate, ["asOf", "scenario", "horizon"])) {
    return fail("INVALID_SPENDABLE_INPUT");
  }

  let asOf: string;
  if (candidate.asOf === undefined) {
    asOf = serverDate(dependencies);
  } else if (typeof candidate.asOf !== "string") {
    return fail("INVALID_DATE", "asOf");
  } else {
    try {
      asOf = spendableDate(candidate.asOf, "asOf").toString();
    } catch {
      return fail("INVALID_DATE", "asOf");
    }
  }

  const scenario = candidate.scenario === undefined
    ? "CONSERVATIVE"
    : candidate.scenario;
  if (!SPENDABLE_SCENARIOS.includes(scenario as SpendableScenario)) {
    return fail("INVALID_SCENARIO", "scenario");
  }

  let horizonDays = DEFAULT_SPENDABLE_HORIZON_DAYS;
  if (candidate.horizon !== undefined) {
    if (!isRecord(candidate.horizon) || !exactKeys(candidate.horizon, ["days"])) {
      return fail("INVALID_HORIZON", "horizon");
    }
    const days = candidate.horizon.days;
    if (typeof days !== "number" || !Number.isSafeInteger(days) || days < 1) {
      return fail("INVALID_HORIZON", "horizon");
    }
    horizonDays = days;
  }
  if (
    horizonDays > limits.maxHorizonDays ||
    horizonDays > ENGINE_MAX_SPENDABLE_HORIZON_DAYS
  ) {
    return fail("HORIZON_OUT_OF_RANGE", "horizon");
  }

  let forecastFrom: string;
  let forecastTo: string;
  try {
    const date = Temporal.PlainDate.from(asOf, { overflow: "reject" });
    forecastFrom = date.add({ days: 1 }).toString();
    forecastTo = date.add({ days: horizonDays }).toString();
  } catch {
    return fail("INVALID_DATE", "asOf");
  }

  return {
    asOf,
    scenario: scenario as SpendableScenario,
    horizon: { days: horizonDays },
    forecastFrom,
    forecastTo,
  };
}

function safeObservation(
  dependencies: SpendableServiceDependencies,
  query: NormalizedGetSpendableInput,
  context?: FinancialContext,
): SpendableCompletionOptions & SpendableObservabilityQueryOptions {
  const supplied = { ...(dependencies.observability ?? {}) };
  // Context authority is always resolved by this module. A caller-supplied
  // observability object cannot smuggle another tenant into telemetry.
  delete supplied.householdId;
  delete supplied.userId;
  return {
    ...supplied,
    scenario: query.scenario,
    horizonDays: query.horizon.days,
    ...(context
      ? { userId: context.userId, householdId: context.householdId }
      : {}),
  };
}

function operation(
  stage: "read" | "forecast" | "engine" | "serialization",
  options: SpendableCompletionOptions & SpendableObservabilityQueryOptions,
): SpendableOperationContext {
  return createSpendableOperation(stage, { ...options });
}

async function observed<T>(
  stageOperation: SpendableOperationContext,
  work: () => Promise<T> | T,
  options: SpendableCompletionOptions & SpendableObservabilityQueryOptions,
  technicalErrorCode: string,
): Promise<T> {
  return withSpendableObservability(
    stageOperation,
    () =>
      measureSpendableQuery(stageOperation, work, {
        ...options,
        technicalErrorCode,
      }),
    options,
  );
}

function errorCode(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.code === "string") return value.code;
  if (isRecord(value.error) && typeof value.error.code === "string") {
    return value.error.code;
  }
  return undefined;
}

function mapError(
  value: unknown,
  fallback = "UNEXPECTED_ERROR",
): SpendableServiceError {
  if (value instanceof SpendableServiceError) return value;
  if (value instanceof FinancialContextError) {
    return new SpendableServiceError("FINANCIAL_CONTEXT_REQUIRED");
  }
  if (value instanceof SpendableResourceNotFoundError) {
    return new SpendableServiceError("SPENDABLE_NOT_FOUND");
  }

  const code = errorCode(value);
  if (code === "SPENDABLE_NOT_FOUND") {
    return new SpendableServiceError("SPENDABLE_NOT_FOUND");
  }
  if (
    code === "INVALID_DATE" ||
    code === "INVALID_DATE_RANGE" ||
    code === "INVALID_SCENARIO" ||
    code === "INVALID_HORIZON" ||
    code === "HORIZON_OUT_OF_RANGE" ||
    code === "INVALID_SPENDABLE_INPUT" ||
    code === "DUPLICATE_REFERENCE" ||
    code === "INVALID_REFERENCE" ||
    code === "INVALID_AMOUNT" ||
    code === "INVALID_ITEM"
  ) {
    const field = isRecord(value) && typeof value.field === "string"
      ? value.field
      : null;
    const publicField: SpendableErrorField =
      field === "asOf" || field === "from" || field === "to"
        ? "asOf"
        : field === "horizon" || field === "horizon.days"
          ? "horizon"
          : field === "scenario"
            ? "scenario"
            : field === "buffer"
              ? "buffer"
              : null;
    return new SpendableServiceError(code, publicField);
  }
  if (code === "SPENDABLE_INCONSISTENT") {
    return new SpendableServiceError("SPENDABLE_INCONSISTENT");
  }
  if (code === "SPENDABLE_READ_FAILED" || code === "SPENDABLE_QUERY_FAILED") {
    return new SpendableServiceError("SPENDABLE_READ_FAILED");
  }
  if (code === "FORECAST_NOT_FOUND") {
    return new SpendableServiceError("SPENDABLE_NOT_FOUND");
  }
  if (code === "FORECAST_INCONSISTENT") {
    return new SpendableServiceError("SPENDABLE_INCONSISTENT");
  }
  if (
    code === "FORECAST_QUERY_FAILED" ||
    code === "FORECAST_SOURCE_QUERY_FAILED" ||
    code === "FORECAST_ENGINE_FAILED"
  ) {
    return new SpendableServiceError("SPENDABLE_FORECAST_FAILED");
  }
  if (code === "FINANCIAL_CONTEXT_REQUIRED") {
    return new SpendableServiceError("FINANCIAL_CONTEXT_REQUIRED");
  }
  return new SpendableServiceError(fallback);
}

function publicFailure<T>(
  value: unknown,
  fallback = "UNEXPECTED_ERROR",
): SpendableResult<T> {
  return toSpendableErrorEnvelope(mapError(value, fallback));
}

function queryOptions(
  dependencies: SpendableServiceDependencies,
): SpendableOpeningBalanceReaderOptions {
  return dependencies.database ? { database: dependencies.database } : {};
}

function amountString(value: unknown, field: string): string {
  try {
    return spendableCents(value, field).toString(10);
  } catch {
    throw new SpendableServiceError("SPENDABLE_READ_FAILED");
  }
}

function finiteCount(value: unknown, fallback = 0): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new SpendableServiceError("SPENDABLE_READ_FAILED");
}

function normalizeOpeningBalance(
  value: unknown,
  context: FinancialContext,
  asOf: string,
): SpendableOpeningBalanceReadModel {
  if (typeof value === "string" || typeof value === "bigint") {
    return {
      householdId: context.householdId,
      asOf,
      openingBalanceCents: amountString(value, "openingBalanceCents"),
      generalAccountCount: 0,
    };
  }
  if (!isRecord(value)) return fail("SPENDABLE_READ_FAILED");
  const householdId = value.householdId ?? value.household_id;
  if (householdId !== undefined && householdId !== context.householdId) {
    return fail("SPENDABLE_NOT_FOUND");
  }
  if (value.asOf !== undefined) {
    try {
      if (spendableDate(value.asOf, "asOf").toString() !== asOf) {
        return fail("SPENDABLE_INCONSISTENT");
      }
    } catch {
      return fail("SPENDABLE_READ_FAILED");
    }
  }
  const amount = value.openingBalanceCents ?? value.balanceCents ?? value.amountCents;
  if (amount === undefined) return fail("SPENDABLE_READ_FAILED");
  return {
    householdId: context.householdId,
    asOf,
    openingBalanceCents: amountString(amount, "openingBalanceCents"),
    generalAccountCount: finiteCount(
      value.generalAccountCount ?? value.generalAccounts,
    ),
  };
}

function emptyBuffer(): OperationalBufferSnapshot {
  return {
    amountCents: "0",
    source: "ABSENT_DEFAULT_ZERO",
    effectiveFrom: null,
    revision: null,
  };
}

function normalizeBuffer(
  value: unknown,
  asOf: string,
  context: FinancialContext,
): OperationalBufferSnapshot {
  if (value === null || value === undefined) return emptyBuffer();
  if (!isRecord(value)) return fail("SPENDABLE_READ_FAILED");
  const householdId = value.householdId ?? value.household_id;
  if (householdId !== undefined && householdId !== context.householdId) {
    return fail("SPENDABLE_NOT_FOUND");
  }
  const sourceValue = value.source;
  const source: SpendableBufferSource = sourceValue === undefined
    ? "CONFIGURED"
    : sourceValue === "CONFIGURED" || sourceValue === "ABSENT_DEFAULT_ZERO"
      ? sourceValue
      : (fail("SPENDABLE_INCONSISTENT", "buffer"), "CONFIGURED");
  const amountValue = value.amountCents ?? value.operationalBufferCents ?? value.bufferCents;
  if (amountValue === undefined && source === "CONFIGURED") {
    return fail("SPENDABLE_READ_FAILED");
  }
  const amount = spendableNonNegativeCents(amountValue ?? "0", "buffer").toString(10);
  const effectiveValue = value.effectiveFrom ?? value.effective_from ?? null;
  const effectiveFrom = effectiveValue === null
    ? null
    : (() => {
        try {
          const date = spendableDate(effectiveValue, "buffer").toString();
          if (date > asOf) return fail("SPENDABLE_INCONSISTENT", "buffer");
          return date;
        } catch {
          return fail("SPENDABLE_INCONSISTENT", "buffer");
        }
      })();
  const revisionValue = value.revision ?? value.id ?? null;
  const revision = revisionValue === null
    ? null
    : spendableReference(revisionValue, "buffer");
  if (source === "ABSENT_DEFAULT_ZERO") {
    if (amount !== "0" || effectiveFrom !== null || revision !== null) {
      return fail("SPENDABLE_INCONSISTENT", "buffer");
    }
    return emptyBuffer();
  }
  return {
    amountCents: amount,
    source,
    effectiveFrom,
    revision,
  };
}

function forecastFromResult(value: unknown): ForecastTimeline {
  if (isRecord(value) && value.ok === false) {
    throw mapError(value, "SPENDABLE_FORECAST_FAILED");
  }
  const candidate = isRecord(value) && value.ok === true ? value.value : value;
  try {
    return parseForecastTimeline(candidate);
  } catch {
    throw new SpendableServiceError("SPENDABLE_FORECAST_FAILED");
  }
}

function validateForecastWindow(
  forecast: ForecastTimeline,
  query: NormalizedGetSpendableInput,
): ForecastTimeline {
  if (
    forecast.contractVersion !== "s07.v1" ||
    forecast.scenario !== query.scenario ||
    forecast.from !== query.forecastFrom ||
    forecast.to !== query.forecastTo
  ) {
    return fail("SPENDABLE_INCONSISTENT");
  }
  return forecast;
}

function reflectedReferences(forecast: ForecastTimeline): readonly string[] {
  const references = new Set<string>(forecast.minimumBalanceReferences);
  for (const day of forecast.days) {
    for (const item of day.items) {
      references.add(item.referenceId);
      references.add(item.source.referenceId);
      const replaces = item.reconciliation?.replacesReferenceId;
      if (replaces !== null && replaces !== undefined) references.add(replaces);
    }
  }
  return [...references].sort();
}

function resultState(value: SpendableBreakdown): "AVAILABLE" | "ZERO" | "DEFICIT" {
  const raw = BigInt(value.rawSpendableCents);
  if (raw < BigInt(0)) return "DEFICIT";
  if (raw === BigInt(0)) return "ZERO";
  return "AVAILABLE";
}

function stageOptions(
  base: SpendableCompletionOptions & SpendableObservabilityQueryOptions,
  counts: Record<string, unknown> = {},
): SpendableCompletionOptions & SpendableObservabilityQueryOptions {
  return { ...base, ...counts };
}

async function resolveContext(
  dependencies: SpendableServiceDependencies,
): Promise<FinancialContext> {
  const resolver = dependencies.resolveContext ?? ((headers?: HeadersInit) =>
    requireFinancialContext(
      headers === undefined ? {} : { requestHeaders: headers },
    ));
  const context = dependencies.resolveContext === undefined &&
    dependencies.requestHeaders === undefined
    ? await resolver()
    : await resolver(dependencies.requestHeaders);
  assertFinancialContext(context);
  return context;
}

interface ReadInputs {
  readonly opening: SpendableOpeningBalanceReadModel;
  readonly buffer: OperationalBufferSnapshot;
}

async function runSpendable(
  query: NormalizedGetSpendableInput,
  context: FinancialContext,
  dependencies: SpendableServiceDependencies,
  baseOptions: SpendableCompletionOptions & SpendableObservabilityQueryOptions,
): Promise<SpendableBreakdown> {
  const readOperation = operation("read", baseOptions);
  const openingReader = dependencies.readOpeningBalance ??
    (dependencies.openingBalance !== undefined
      ? () => dependencies.openingBalance as SpendableOpeningBalanceReadModel | string | bigint
      : readSpendableOpeningBalanceForContext);
  const injectedReadModel = dependencies.readOpeningBalance !== undefined ||
    dependencies.readBuffer !== undefined ||
    dependencies.readOperationalBuffer !== undefined ||
    dependencies.readForecast !== undefined ||
    dependencies.forecastReader !== undefined ||
    dependencies.getForecast !== undefined;
  const bufferReader = dependencies.readBuffer ??
    dependencies.readOperationalBuffer ??
    (dependencies.operationalBuffer !== undefined || dependencies.buffer !== undefined
      ? () => dependencies.operationalBuffer ?? dependencies.buffer
      : !dependencies.database && injectedReadModel
        ? () => null
        : readSpendableBufferForContext);
  const reads = await observed(
    readOperation,
    async (): Promise<ReadInputs> => {
      const options = queryOptions(dependencies);
      const [openingValue, bufferValue] = await Promise.all([
        openingReader(context, query.asOf, options),
        bufferReader(context, query.asOf, options),
      ]);
      return {
        opening: normalizeOpeningBalance(openingValue, context, query.asOf),
        buffer: normalizeBuffer(bufferValue, query.asOf, context),
      };
    },
    baseOptions,
    "SPENDABLE_READ_FAILED",
  );

  const forecastOperation = operation(
    "forecast",
    stageOptions(baseOptions, {
      generalAccountCount: reads.opening.generalAccountCount,
    }),
  );
  const forecastReader = dependencies.readForecast ??
    dependencies.forecastReader ??
    dependencies.getForecast ??
    readForecast;
  const forecast = await observed(
    forecastOperation,
    async () => {
      const forecastQuery: GetForecastQuery = {
        from: query.forecastFrom,
        to: query.forecastTo,
        scenario: query.scenario,
      };
      const result = await forecastReader(forecastQuery, {
        resolveContext: () => context,
        ...(dependencies.database ? { database: dependencies.database } : {}),
        ...(dependencies.requestHeaders
          ? { requestHeaders: dependencies.requestHeaders }
          : {}),
      });
      return validateForecastWindow(forecastFromResult(result), query);
    },
    stageOptions(baseOptions, {
      generalAccountCount: reads.opening.generalAccountCount,
    }),
    "SPENDABLE_FORECAST_FAILED",
  );

  const normalizedTimeline = normalizeSpendableTimeline(forecast, {
    // S07's opening is household-wide; S08's opening is the GENERAL-only
    // aggregate just read above. All forecast item rows remain S07-owned.
    openingBalanceCents: reads.opening.openingBalanceCents,
    scenario: query.scenario,
    from: query.forecastFrom,
    to: query.forecastTo,
  });

  const reserveOperation = operation(
    "read",
    stageOptions(baseOptions, {
      generalAccountCount: reads.opening.generalAccountCount,
      forecastItemCount: normalizedTimeline.items.length,
      dayCount: normalizedTimeline.days.length,
    }),
  );
  const reserveAdapter = dependencies.reserveAdapter ??
    dependencies.reserveAdapterFactory?.(context) ??
    new ZeroReserveAdapter();
  const reserve = await observed(
    reserveOperation,
    () =>
      readReserveSnapshot(reserveAdapter, {
        asOf: query.asOf,
        scenario: query.scenario,
        horizon: query.horizon,
        reflectedReferenceIds: reflectedReferences(forecast),
      }),
    stageOptions(baseOptions, {
      generalAccountCount: reads.opening.generalAccountCount,
      forecastItemCount: normalizedTimeline.items.length,
      dayCount: normalizedTimeline.days.length,
    }),
    "SPENDABLE_READ_FAILED",
  );

  const engineOperation = operation(
    "engine",
    stageOptions(baseOptions, {
      generalAccountCount: reads.opening.generalAccountCount,
      forecastItemCount: normalizedTimeline.items.length,
      dayCount: normalizedTimeline.days.length,
      reserveComponentCount: reserve.components.length,
    }),
  );
  const engineInput: SpendableEngineInput = {
    normalizedTimeline,
    operationalBuffer: reads.buffer,
    reserve,
  };
  const calculated = await observed(
    engineOperation,
    () => SpendableEngine(engineInput),
    stageOptions(baseOptions, {
      generalAccountCount: reads.opening.generalAccountCount,
      forecastItemCount: normalizedTimeline.items.length,
      dayCount: normalizedTimeline.days.length,
      reserveComponentCount: reserve.components.length,
    }),
    "SPENDABLE_ENGINE_FAILED",
  );

  const serializationOperation = operation(
    "serialization",
    stageOptions(baseOptions, {
      generalAccountCount: reads.opening.generalAccountCount,
      forecastItemCount: normalizedTimeline.items.length,
      dayCount: normalizedTimeline.days.length,
      reserveComponentCount: reserve.components.length,
      result: resultState(calculated),
    }),
  );
  return observed(
    serializationOperation,
    () => {
      try {
        return parseSpendableBreakdown(
          JSON.parse(JSON.stringify(calculated)) as unknown,
        );
      } catch {
        return fail("SPENDABLE_SERIALIZATION_FAILED");
      }
    },
    stageOptions(baseOptions, {
      generalAccountCount: reads.opening.generalAccountCount,
      forecastItemCount: normalizedTimeline.items.length,
      dayCount: normalizedTimeline.days.length,
      reserveComponentCount: reserve.components.length,
      result: resultState(calculated),
    }),
    "SPENDABLE_SERIALIZATION_FAILED",
  );
}

/** Reads the current availability without persisting a derived snapshot. */
export async function getSpendable(
  input?: GetSpendableInput | unknown,
  dependencies: SpendableServiceDependencies = {},
): Promise<SpendableResult<SpendableBreakdown>> {
  let query: NormalizedGetSpendableInput;
  try {
    query = normalizeGetSpendableInput(input, dependencies);
  } catch (error) {
    return publicFailure(error);
  }

  let context: FinancialContext;
  try {
    context = await resolveContext(dependencies);
  } catch (error) {
    return publicFailure(error);
  }

  const baseOptions = safeObservation(dependencies, query, context);
  try {
    const value = await runSpendable(query, context, dependencies, baseOptions);
    return { ok: true, value };
  } catch (error) {
    return publicFailure(error);
  }
}

export function createSpendableService(
  defaults: SpendableServiceDependencies = {},
): { getSpendable: (input?: GetSpendableInput | unknown) => Promise<SpendableResult<SpendableBreakdown>> } {
  return {
    getSpendable: (input) => getSpendable(input, defaults),
  };
}

export const spendableService = createSpendableService();
export const getSpendableBreakdown = getSpendable;
export const getAvailableToSpend = getSpendable;
export const getAvailableToSpendBreakdown = getSpendable;
export const readSpendable = getSpendable;
export const getSpendableQuery = getSpendable;

// Keep these type imports visible to adapters that consume this module while
// avoiding a persistence object or a reserve household id in the public API.
export type {
  ReserveSnapshotDomain,
  SpendableReserveAdapter,
  SpendableReadExecutor,
  SpendableQueryError,
};
