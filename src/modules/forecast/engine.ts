import { Temporal } from "@js-temporal/polyfill";

import {
  FORECAST_CONTRACT_VERSION,
  parseForecastItem,
  parseForecastTimeline,
  type ForecastErrorCode,
  type ForecastItem,
  type ForecastItemStatus,
  type ForecastDay,
  type ForecastPeriodTotals,
  type ForecastScenario,
  type ForecastSource,
  type ForecastTimeline,
} from "./contracts";

/**
 * The engine accepts serialized cents at the boundary and bigint/value
 * objects inside a server-side domain pipeline.  Numbers are intentionally
 * not accepted: a JavaScript number would make precision an implicit rule.
 */
export type ForecastCentsInput =
  | string
  | bigint
  | { readonly cents: bigint }
  | { readonly toCentsString: () => string };

export type ForecastDateInput = string | Temporal.PlainDate;

export interface ForecastDateRange {
  readonly from: ForecastDateInput;
  readonly to: ForecastDateInput;
}

export type ForecastRangeInput =
  | ForecastDateRange
  | readonly [ForecastDateInput, ForecastDateInput];

/**
 * T04 can keep source-only scenario metadata on an item while it is handed
 * to the pure engine.  The metadata is not part of the JSON read model.
 */
export type ForecastEngineSource = ForecastSource & {
  readonly includeInConservativeForecast?: boolean;
  readonly include_in_conservative_forecast?: boolean;
  readonly reliable?: boolean;
  readonly isReliable?: boolean;
  readonly [key: string]: unknown;
};

export type ForecastEngineItem = Omit<ForecastItem, "amountCents" | "source"> & {
  readonly amountCents: ForecastCentsInput;
  readonly source: ForecastEngineSource;
  readonly includeInConservativeForecast?: boolean;
  readonly include_in_conservative_forecast?: boolean;
  readonly reliable?: boolean;
  readonly isReliable?: boolean;
  readonly [key: string]: unknown;
};

/**
 * Object form is useful for service adapters; the positional form mirrors
 * the T05 contract (`ForecastEngine(items, opening, range, scenario)`).
 * Aliases are accepted only at this pure boundary and never emitted.
 */
export interface ForecastEngineInput {
  readonly items?: readonly ForecastEngineItem[];
  readonly forecastItems?: readonly ForecastEngineItem[];
  readonly openingBalance?: ForecastCentsInput;
  readonly openingBalanceCents?: ForecastCentsInput;
  readonly opening?: ForecastCentsInput;
  readonly range?: ForecastRangeInput;
  readonly from?: ForecastDateInput;
  readonly to?: ForecastDateInput;
  readonly start?: ForecastDateInput;
  readonly end?: ForecastDateInput;
  readonly scenario?: ForecastScenario;
}

export type ForecastEngineErrorCode =
  | Extract<
      ForecastErrorCode,
      "INVALID_DATE" | "INVALID_DATE_RANGE" | "INVALID_SCENARIO" | "FORECAST_INCONSISTENT"
    >
  | "INVALID_AMOUNT"
  | "INVALID_ITEM";

/** Stable, persistence-independent failures raised by the pure engine. */
export class ForecastEngineError extends Error {
  readonly code: ForecastEngineErrorCode;
  readonly field?: string;

  constructor(code: ForecastEngineErrorCode, message: string, field?: string) {
    super(message);
    this.name = "ForecastEngineError";
    this.code = code;
    this.field = field;
  }
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const INTEGER_PATTERN = /^-?\d+$/u;
const ZERO = BigInt(0);

const STATUS_PRECEDENCE: Record<ForecastItemStatus, number> = {
  POSTED: 0,
  PLANNED: 1,
  EXPECTED: 2,
};

function fail(
  code: ForecastEngineErrorCode,
  message: string,
  field?: string,
): never {
  throw new ForecastEngineError(code, message, field);
}

function compareStrings(left: string, right: string): -1 | 0 | 1 {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareNumbers(left: number, right: number): -1 | 0 | 1 {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareCanonicalCents(left: string, right: string): -1 | 0 | 1 {
  if (left.length < right.length) return -1;
  if (left.length > right.length) return 1;
  return compareStrings(left, right);
}

function readBigInt(value: unknown, field: string, positiveOnly = false): bigint {
  let candidate: string | bigint | undefined;

  if (typeof value === "bigint") {
    candidate = value;
  } else if (typeof value === "string") {
    candidate = value;
  } else if (value !== null && typeof value === "object") {
    const cents = (value as { readonly cents?: unknown }).cents;
    if (typeof cents === "bigint") {
      candidate = cents;
    } else {
      const toCentsString = (value as { readonly toCentsString?: unknown }).toCentsString;
      if (typeof toCentsString === "function") {
        try {
          const serialized = toCentsString.call(value);
          if (typeof serialized === "string") candidate = serialized;
        } catch {
          candidate = undefined;
        }
      }
    }
  }

  if (typeof candidate === "bigint") {
    if (positiveOnly && candidate <= ZERO) {
      return fail("INVALID_AMOUNT", "Centavos devem ser positivos.", field);
    }
    return candidate;
  }

  if (typeof candidate !== "string" || !INTEGER_PATTERN.test(candidate)) {
    return fail("INVALID_AMOUNT", "Centavos devem ser um inteiro decimal.", field);
  }

  try {
    const parsed = BigInt(candidate);
    if (positiveOnly && parsed <= ZERO) {
      return fail("INVALID_AMOUNT", "Centavos devem ser positivos.", field);
    }
    return parsed;
  } catch {
    return fail("INVALID_AMOUNT", "Centavos devem ser um inteiro decimal.", field);
  }
}

function readPositiveCents(value: unknown, field: string): string {
  const parsed = readBigInt(value, field, true);
  return parsed.toString(10);
}

function readSignedCents(value: unknown, field: string): string {
  return readBigInt(value, field).toString(10);
}

function isPlainDate(value: unknown): value is Temporal.PlainDate {
  return value instanceof Temporal.PlainDate;
}

function parseDate(value: unknown, field: string): Temporal.PlainDate {
  if (isPlainDate(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return fail("INVALID_DATE", "A data deve usar YYYY-MM-DD.", field);
  }

  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return fail("INVALID_DATE", "A data deve usar YYYY-MM-DD.", field);
  }

  try {
    return Temporal.PlainDate.from(
      {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        calendar: "iso8601",
      },
      { overflow: "reject" },
    );
  } catch {
    return fail("INVALID_DATE", "A data deve ser válida no calendário ISO.", field);
  }
}

function formatDate(date: Temporal.PlainDate, field = "date"): string {
  if (date.year < 0 || date.year > 9999) {
    return fail("INVALID_DATE", "A data deve usar um ano ISO de quatro dígitos.", field);
  }

  return [
    date.year.toString(10).padStart(4, "0"),
    date.month.toString(10).padStart(2, "0"),
    date.day.toString(10).padStart(2, "0"),
  ].join("-");
}

function dateRange(
  range: ForecastRangeInput | undefined,
  from: ForecastDateInput | undefined,
  to: ForecastDateInput | undefined,
): { from: Temporal.PlainDate; to: Temporal.PlainDate; fromString: string; toString: string } {
  let rangeFrom: ForecastDateInput | undefined;
  let rangeTo: ForecastDateInput | undefined;

  if (range !== undefined) {
    if (Array.isArray(range)) {
      rangeFrom = range[0];
      rangeTo = range[1];
    } else {
      const objectRange = range as ForecastDateRange;
      rangeFrom = objectRange.from;
      rangeTo = objectRange.to;
    }
  }

  rangeFrom = rangeFrom ?? from;
  rangeTo = rangeTo ?? to;

  if (rangeFrom === undefined || rangeTo === undefined) {
    return fail("INVALID_DATE_RANGE", "O intervalo exige from e to.", "range");
  }

  const parsedFrom = parseDate(rangeFrom, "from");
  const parsedTo = parseDate(rangeTo, "to");
  if (Temporal.PlainDate.compare(parsedFrom, parsedTo) > 0) {
    return fail("INVALID_DATE_RANGE", "from deve ser igual ou anterior a to.", "from");
  }

  return {
    from: parsedFrom,
    to: parsedTo,
    fromString: formatDate(parsedFrom, "from"),
    toString: formatDate(parsedTo, "to"),
  };
}

function readOptionalBoolean(
  values: readonly [unknown, string][],
  field: string,
): boolean | undefined {
  let selected: boolean | undefined;

  for (const [value, valueField] of values) {
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      return fail("FORECAST_INCONSISTENT", `${field} deve ser booleano.`, valueField);
    }
    if (selected !== undefined && selected !== value) {
      return fail("FORECAST_INCONSISTENT", `${field} possui valores conflitantes.`, field);
    }
    selected = value;
  }

  return selected;
}

function conservativeFlag(item: ForecastEngineItem): boolean {
  const source = item.source;
  return (
    readOptionalBoolean(
      [
        [item.includeInConservativeForecast, "includeInConservativeForecast"],
        [item.include_in_conservative_forecast, "include_in_conservative_forecast"],
        [item.reliable, "reliable"],
        [item.isReliable, "isReliable"],
        [source.includeInConservativeForecast, "source.includeInConservativeForecast"],
        [source.include_in_conservative_forecast, "source.include_in_conservative_forecast"],
        [source.reliable, "source.reliable"],
        [source.isReliable, "source.isReliable"],
      ],
      "includeInConservativeForecast",
    ) ?? false
  );
}

function normalizeReconciliation(
  value: unknown,
  field: string,
): ForecastItem["reconciliation"] {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") {
    return fail("FORECAST_INCONSISTENT", "Reconciliação inválida.", field);
  }

  const candidate = value as Record<string, unknown>;
  const key = candidate.key;
  const replacesReferenceId = candidate.replacesReferenceId;
  if (typeof key !== "string") {
    return fail("FORECAST_INCONSISTENT", "Reconciliação exige uma chave.", `${field}.key`);
  }
  if (replacesReferenceId !== null && typeof replacesReferenceId !== "string") {
    return fail(
      "FORECAST_INCONSISTENT",
      "Referência de reconciliação inválida.",
      `${field}.replacesReferenceId`,
    );
  }

  const plannedAmountCents =
    candidate.plannedAmountCents === null || candidate.plannedAmountCents === undefined
      ? null
      : readSignedCents(candidate.plannedAmountCents, `${field}.plannedAmountCents`);
  const realizedAmountCents =
    candidate.realizedAmountCents === null || candidate.realizedAmountCents === undefined
      ? null
      : readSignedCents(candidate.realizedAmountCents, `${field}.realizedAmountCents`);
  const remainingAmountCents =
    candidate.remainingAmountCents === null || candidate.remainingAmountCents === undefined
      ? null
      : readSignedCents(candidate.remainingAmountCents, `${field}.remainingAmountCents`);
  const varianceAmountCents =
    candidate.varianceAmountCents === null || candidate.varianceAmountCents === undefined
      ? null
      : readSignedCents(candidate.varianceAmountCents, `${field}.varianceAmountCents`);

  return {
    key,
    replacesReferenceId: replacesReferenceId as string | null,
    plannedAmountCents,
    realizedAmountCents,
    remainingAmountCents,
    varianceAmountCents,
  };
}

function normalizeSource(source: unknown, field: string): Record<string, unknown> {
  if (source === null || typeof source !== "object") {
    return fail("FORECAST_INCONSISTENT", "Origem de forecast inválida.", field);
  }

  const candidate = source as Record<string, unknown>;
  const kind = candidate.kind;
  const referenceId = candidate.referenceId;
  const label = candidate.label;
  if (typeof kind !== "string" || typeof referenceId !== "string" || typeof label !== "string") {
    return fail("FORECAST_INCONSISTENT", "Origem exige kind, referenceId e label.", field);
  }

  const normalized: Record<string, unknown> = { kind, referenceId, label };
  for (const property of [
    "recurringRuleId",
    "occurrenceKey",
    "billingCycle",
    "installmentSequence",
  ] as const) {
    if (candidate[property] !== undefined) normalized[property] = candidate[property];
  }

  return normalized;
}

interface NormalizedItem {
  readonly item: ForecastItem;
  readonly includeInConservativeForecast: boolean;
}

function normalizeItem(input: ForecastEngineItem, index: number): NormalizedItem {
  if (input === null || typeof input !== "object") {
    return fail("INVALID_ITEM", "Item de forecast inválido.", `items[${index}]`);
  }

  const source = normalizeSource(input.source, `items[${index}].source`);
  const date = formatDate(
    parseDate(input.date, `items[${index}].date`),
    `items[${index}].date`,
  );
  const amountCents = readPositiveCents(input.amountCents, `items[${index}].amountCents`);
  const reconciliation = normalizeReconciliation(
    input.reconciliation,
    `items[${index}].reconciliation`,
  );

  const candidate = {
    date,
    amountCents,
    direction: input.direction,
    status: input.status,
    certainty: input.certainty,
    source,
    referenceId: input.referenceId,
    reconciliation,
  };
  try {
    const parsed = parseForecastItem(candidate);
    return {
      item: parsed,
      includeInConservativeForecast: conservativeFlag(input),
    };
  } catch {
    return fail("FORECAST_INCONSISTENT", "Item de forecast inválido.", `items[${index}]`);
  }
}

function compareItems(left: NormalizedItem, right: NormalizedItem): -1 | 0 | 1 {
  const leftItem = left.item;
  const rightItem = right.item;

  let comparison = compareStrings(leftItem.date, rightItem.date);
  if (comparison !== 0) return comparison;

  comparison = compareNumbers(
    STATUS_PRECEDENCE[leftItem.status],
    STATUS_PRECEDENCE[rightItem.status],
  );
  if (comparison !== 0) return comparison;

  comparison = compareStrings(leftItem.source.kind, rightItem.source.kind);
  if (comparison !== 0) return comparison;
  comparison = compareStrings(leftItem.source.referenceId, rightItem.source.referenceId);
  if (comparison !== 0) return comparison;
  comparison = compareStrings(
    leftItem.source.recurringRuleId ?? "",
    rightItem.source.recurringRuleId ?? "",
  );
  if (comparison !== 0) return comparison;
  comparison = compareStrings(
    leftItem.source.occurrenceKey ?? "",
    rightItem.source.occurrenceKey ?? "",
  );
  if (comparison !== 0) return comparison;
  comparison = compareStrings(
    leftItem.source.billingCycle ?? "",
    rightItem.source.billingCycle ?? "",
  );
  if (comparison !== 0) return comparison;

  const leftSequence = leftItem.source.installmentSequence ?? 0;
  const rightSequence = rightItem.source.installmentSequence ?? 0;
  comparison = compareNumbers(leftSequence, rightSequence);
  if (comparison !== 0) return comparison;

  comparison = compareStrings(leftItem.referenceId, rightItem.referenceId);
  if (comparison !== 0) return comparison;
  comparison = compareStrings(leftItem.direction, rightItem.direction);
  if (comparison !== 0) return comparison;
  comparison = compareStrings(leftItem.certainty, rightItem.certainty);
  if (comparison !== 0) return comparison;
  comparison = compareCanonicalCents(leftItem.amountCents, rightItem.amountCents);
  if (comparison !== 0) return comparison;

  const leftReconciliation = leftItem.reconciliation;
  const rightReconciliation = rightItem.reconciliation;
  comparison = compareStrings(
    leftReconciliation?.key ?? "",
    rightReconciliation?.key ?? "",
  );
  if (comparison !== 0) return comparison;
  comparison = compareStrings(
    leftReconciliation?.replacesReferenceId ?? "",
    rightReconciliation?.replacesReferenceId ?? "",
  );
  if (comparison !== 0) return comparison;

  for (const property of [
    "plannedAmountCents",
    "realizedAmountCents",
    "remainingAmountCents",
    "varianceAmountCents",
  ] as const) {
    comparison = compareStrings(
      leftReconciliation?.[property] ?? "",
      rightReconciliation?.[property] ?? "",
    );
    if (comparison !== 0) return comparison;
  }

  // Labels are deliberately excluded: presentation text cannot change
  // financial ordering. Equal keys are equivalent items for the read model.
  return 0;
}

function itemIncluded(
  normalized: NormalizedItem,
  scenario: ForecastScenario,
): boolean {
  if (scenario === "EXPECTED") return true;

  const item = normalized.item;
  if (item.direction === "OUTFLOW") return true;
  return (
    item.status === "POSTED" ||
    item.certainty === "REALIZED" ||
    item.certainty === "COMMITTED" ||
    normalized.includeInConservativeForecast
  );
}

interface MutablePeriodTotals {
  inflowCents: bigint;
  outflowCents: bigint;
  realizedInflowCents: bigint;
  realizedOutflowCents: bigint;
  projectedInflowCents: bigint;
  projectedOutflowCents: bigint;
}

function emptyPeriodTotals(): MutablePeriodTotals {
  return {
    inflowCents: ZERO,
    outflowCents: ZERO,
    realizedInflowCents: ZERO,
    realizedOutflowCents: ZERO,
    projectedInflowCents: ZERO,
    projectedOutflowCents: ZERO,
  };
}

function periodForDate(date: string): string {
  return date.slice(0, 7);
}

function periodRange(
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
): readonly string[] {
  const result: string[] = [];
  let cursor = Temporal.PlainDate.from({
    year: from.year,
    month: from.month,
    day: 1,
    calendar: "iso8601",
  });
  const end = Temporal.PlainDate.from({
    year: to.year,
    month: to.month,
    day: 1,
    calendar: "iso8601",
  });

  while (Temporal.PlainDate.compare(cursor, end) <= 0) {
    result.push(formatDate(cursor).slice(0, 7));
    cursor = cursor.add({ months: 1 });
  }

  return result;
}

function toPeriodTotals(
  period: string,
  value: MutablePeriodTotals,
): ForecastPeriodTotals {
  return {
    period,
    inflowCents: value.inflowCents.toString(10),
    outflowCents: value.outflowCents.toString(10),
    netCents: (value.inflowCents - value.outflowCents).toString(10),
    realizedInflowCents: value.realizedInflowCents.toString(10),
    realizedOutflowCents: value.realizedOutflowCents.toString(10),
    projectedInflowCents: value.projectedInflowCents.toString(10),
    projectedOutflowCents: value.projectedOutflowCents.toString(10),
  };
}

function openingValue(input: ForecastEngineInput): ForecastCentsInput {
  const values: readonly [ForecastCentsInput | undefined, string][] = [
    [input.openingBalanceCents, "openingBalanceCents"],
    [input.openingBalance, "openingBalance"],
    [input.opening, "opening"],
  ];
  const defined = values.filter(
    (entry): entry is [ForecastCentsInput, string] => entry[0] !== undefined,
  );
  if (defined.length === 0) {
    return fail("INVALID_AMOUNT", "O engine exige saldo de abertura.", "openingBalanceCents");
  }

  const first = readSignedCents(defined[0][0], defined[0][1]);
  for (const [value, field] of defined.slice(1)) {
    if (readSignedCents(value, field) !== first) {
      return fail("FORECAST_INCONSISTENT", "Saldos de abertura conflitantes.", field);
    }
  }
  return first;
}

function inputFromConfig(input: ForecastEngineInput): {
  readonly items: readonly ForecastEngineItem[];
  readonly openingBalanceCents: ForecastCentsInput;
  readonly range: ForecastRangeInput;
  readonly scenario: ForecastScenario;
} {
  const items = input.items ?? input.forecastItems;
  if (items === undefined) {
    return fail("INVALID_ITEM", "O engine exige itens normalizados.", "items");
  }

  const range = input.range;
  const rangeFrom = input.from ?? input.start;
  const rangeTo = input.to ?? input.end;
  if (
    (range === undefined && (rangeFrom === undefined || rangeTo === undefined)) ||
    (range !== undefined &&
      (Array.isArray(range)
        ? range[0] === undefined || range[1] === undefined
        : (range as ForecastDateRange).from === undefined ||
          (range as ForecastDateRange).to === undefined))
  ) {
    return fail("INVALID_DATE_RANGE", "O engine exige from e to.", "range");
  }

  const normalizedRange: ForecastRangeInput =
    range ?? ({ from: rangeFrom as ForecastDateInput, to: rangeTo as ForecastDateInput });

  return {
    items,
    openingBalanceCents: openingValue(input),
    range: normalizedRange,
    scenario: input.scenario ?? "CONSERVATIVE",
  };
}

function runCalculation(
  items: readonly ForecastEngineItem[],
  openingBalanceInput: ForecastCentsInput,
  rangeInput: ForecastRangeInput,
  scenario: ForecastScenario = "CONSERVATIVE",
): ForecastTimeline {
  if (scenario !== "CONSERVATIVE" && scenario !== "EXPECTED") {
    return fail("INVALID_SCENARIO", "Cenário de forecast inválido.", "scenario");
  }

  const openingBalance = readSignedCents(openingBalanceInput, "openingBalanceCents");
  const range = dateRange(rangeInput, undefined, undefined);
  const normalized = items.map(normalizeItem).filter((item) => itemIncluded(item, scenario));
  const ordered = [...normalized].sort(compareItems);

  let openingAdjustments = ZERO;
  const openingAdjustmentReferences: string[] = [];
  const grouped = new Map<string, NormalizedItem[]>();
  const periods = new Map<string, MutablePeriodTotals>();

  for (const period of periodRange(range.from, range.to)) {
    periods.set(period, emptyPeriodTotals());
  }

  for (const normalizedItem of ordered) {
    const item = normalizedItem.item;
    if (item.status !== "POSTED" && item.date < range.fromString) {
      const amount = BigInt(item.amountCents);
      openingAdjustments += item.direction === "INFLOW" ? amount : -amount;
      openingAdjustmentReferences.push(item.referenceId);
      continue;
    }

    if (item.date < range.fromString || item.date > range.toString || item.status === "POSTED" && item.date < range.fromString) {
      continue;
    }

    const dateItems = grouped.get(item.date);
    if (dateItems) dateItems.push(normalizedItem);
    else grouped.set(item.date, [normalizedItem]);

    const period = periods.get(periodForDate(item.date));
    if (!period) {
      return fail("FORECAST_INCONSISTENT", "Item fora dos períodos do intervalo.", "items");
    }
    const amount = BigInt(item.amountCents);
    if (item.direction === "INFLOW") period.inflowCents += amount;
    else period.outflowCents += amount;

    if (item.status === "POSTED") {
      if (item.direction === "INFLOW") period.realizedInflowCents += amount;
      else period.realizedOutflowCents += amount;
    } else if (item.direction === "INFLOW") {
      period.projectedInflowCents += amount;
    } else {
      period.projectedOutflowCents += amount;
    }
  }

  const openingProjectedBalance = BigInt(openingBalance) + openingAdjustments;
  let projectedBalance = openingProjectedBalance;
  let minimumProjectedBalance = projectedBalance;
  let minimumProjectedOn: string | null = null;
  let minimumBalanceReferences = [...new Set(openingAdjustmentReferences)];

  const days: ForecastDay[] = [];
  for (const [date, dateItems] of [...grouped.entries()].sort(([left], [right]) =>
    compareStrings(left, right),
  )) {
    let inflow = ZERO;
    let outflow = ZERO;
    const references: string[] = [];
    for (const normalizedItem of dateItems) {
      const amount = BigInt(normalizedItem.item.amountCents);
      if (normalizedItem.item.direction === "INFLOW") inflow += amount;
      else outflow += amount;
      references.push(normalizedItem.item.referenceId);
    }

    const openingProjectedBalanceForDay = projectedBalance;
    const net = inflow - outflow;
    const closingProjectedBalance = openingProjectedBalanceForDay + net;
    projectedBalance = closingProjectedBalance;
    const uniqueReferences = [...new Set(references)];

    days.push({
      date,
      items: dateItems.map(({ item }) => item),
      inflowCents: inflow.toString(10),
      outflowCents: outflow.toString(10),
      netCents: net.toString(10),
      openingProjectedBalanceCents: openingProjectedBalanceForDay.toString(10),
      closingProjectedBalanceCents: closingProjectedBalance.toString(10),
    });

    if (closingProjectedBalance < minimumProjectedBalance) {
      minimumProjectedBalance = closingProjectedBalance;
      minimumProjectedOn = date;
      minimumBalanceReferences = uniqueReferences;
    }
  }

  const periodValues = [...periods.entries()].map(([period, value]) =>
    toPeriodTotals(period, value),
  );
  const totals = periodValues.reduce(
    (sum, period) => ({
      inflowCents: sum.inflowCents + BigInt(period.inflowCents),
      outflowCents: sum.outflowCents + BigInt(period.outflowCents),
      realizedInflowCents: sum.realizedInflowCents + BigInt(period.realizedInflowCents),
      realizedOutflowCents: sum.realizedOutflowCents + BigInt(period.realizedOutflowCents),
      projectedInflowCents: sum.projectedInflowCents + BigInt(period.projectedInflowCents),
      projectedOutflowCents: sum.projectedOutflowCents + BigInt(period.projectedOutflowCents),
    }),
    {
      inflowCents: ZERO,
      outflowCents: ZERO,
      realizedInflowCents: ZERO,
      realizedOutflowCents: ZERO,
      projectedInflowCents: ZERO,
      projectedOutflowCents: ZERO,
    },
  );

  const timeline: ForecastTimeline = {
    contractVersion: FORECAST_CONTRACT_VERSION,
    scenario,
    from: range.fromString,
    to: range.toString,
    openingBalanceCents: openingBalance,
    openingAdjustmentsCents: openingAdjustments.toString(10),
    openingProjectedBalanceCents: openingProjectedBalance.toString(10),
    closingProjectedBalanceCents: projectedBalance.toString(10),
    minimumProjectedBalanceCents: minimumProjectedBalance.toString(10),
    minimumProjectedOn,
    totals: {
      inflowCents: totals.inflowCents.toString(10),
      outflowCents: totals.outflowCents.toString(10),
      netCents: (totals.inflowCents - totals.outflowCents).toString(10),
      realizedInflowCents: totals.realizedInflowCents.toString(10),
      realizedOutflowCents: totals.realizedOutflowCents.toString(10),
      projectedInflowCents: totals.projectedInflowCents.toString(10),
      projectedOutflowCents: totals.projectedOutflowCents.toString(10),
    },
    periods: periodValues,
    days,
    minimumBalanceReferences,
  };

  return parseForecastTimeline(timeline);
}

/**
 * Calculates a deterministic household forecast from normalized items.
 * No clock, timezone, persistence adapter, or mutable input is consulted.
 */
export function ForecastEngine(
  items: readonly ForecastEngineItem[],
  openingBalance: ForecastCentsInput,
  range: ForecastRangeInput,
  scenario?: ForecastScenario,
): ForecastTimeline;
export function ForecastEngine(input: ForecastEngineInput): ForecastTimeline;
export function ForecastEngine(
  itemsOrInput: readonly ForecastEngineItem[] | ForecastEngineInput,
  openingBalance?: ForecastCentsInput,
  range?: ForecastRangeInput,
  scenario?: ForecastScenario,
): ForecastTimeline {
  if (Array.isArray(itemsOrInput)) {
    if (openingBalance === undefined) {
      return fail("INVALID_AMOUNT", "O engine exige saldo de abertura.", "openingBalanceCents");
    }
    if (range === undefined) {
      return fail("INVALID_DATE_RANGE", "O engine exige from e to.", "range");
    }
    return runCalculation(itemsOrInput, openingBalance, range, scenario ?? "CONSERVATIVE");
  }

  if (itemsOrInput === null || typeof itemsOrInput !== "object") {
    return fail("INVALID_ITEM", "Entrada do engine inválida.", "input");
  }

  const config = inputFromConfig(itemsOrInput as ForecastEngineInput);
  return runCalculation(
    config.items,
    config.openingBalanceCents,
    config.range,
    config.scenario,
  );
}

export const forecastEngine = ForecastEngine;
export const calculateForecast = ForecastEngine;
export const calculateForecastTimeline = ForecastEngine;
export const buildForecastTimeline = ForecastEngine;
export const runForecastEngine = ForecastEngine;

/** Exposed for T06/T11 adapters that need to explain scenario inclusion. */
export function isForecastItemIncluded(
  item: ForecastEngineItem,
  scenario: ForecastScenario,
): boolean {
  if (scenario !== "CONSERVATIVE" && scenario !== "EXPECTED") {
    return fail("INVALID_SCENARIO", "Cenário de forecast inválido.", "scenario");
  }
  const normalized = normalizeItem(item, 0);
  return itemIncluded(normalized, scenario);
}
