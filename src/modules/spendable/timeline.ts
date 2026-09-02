import { Temporal } from "@js-temporal/polyfill";

import {
  parseForecastItem,
  parseForecastTimeline,
  type ForecastItem,
  type ForecastSource,
  type ForecastTimeline,
} from "@/modules/forecast/contracts";

import {
  FORECAST_CONTRACT_VERSION,
  SPENDABLE_CONTRACT_VERSION,
  SpendableContractError,
  type NormalizedSpendableDailyPoint,
  type NormalizedSpendableForecastItem,
  type NormalizedSpendableTimeline,
  type OpaqueReference,
  type SpendableBalanceComponent,
  type SpendableBalancePoint,
  type SpendableCentsInput,
  type SpendableCausalItem,
  type SpendableCausalPoint,
  type SpendableDirection,
  type SpendableItemStatus,
  type SpendableScenario,
  type SpendableSource,
  type SpendableTimelineInput,
  compareSpendableDates,
  parseSpendableDate,
  spendableCents,
  spendableDate,
  spendableMoney,
  spendablePositiveCents,
  spendableReference,
} from "./contracts";

const ZERO = BigInt(0);
const STATUS_ORDER: Readonly<Record<SpendableItemStatus, string>> = {
  POSTED: "0",
  PLANNED: "1",
  EXPECTED: "2",
};

export interface NormalizeSpendableTimelineOptions {
  readonly openingBalanceCents?: SpendableCentsInput;
  readonly openingAdjustmentsCents?: SpendableCentsInput;
  readonly scenario?: SpendableScenario;
  readonly from?: string | Temporal.PlainDate;
  readonly to?: string | Temporal.PlainDate;
  /** Optional complete S07 item list, useful for pure adapter tests. */
  readonly items?: readonly ForecastItem[];
}

export type SpendableTimelineOptions = NormalizeSpendableTimelineOptions;

export interface SpendableDateRangeInput {
  readonly from: string | Temporal.PlainDate;
  readonly to: string | Temporal.PlainDate;
}

function fail(
  code: ConstructorParameters<typeof SpendableContractError>[0],
  message: string,
  field?: string,
): never {
  throw new SpendableContractError(code, message, field);
}

function compareStrings(left: string, right: string): -1 | 0 | 1 {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareCanonicalUnsignedCents(left: bigint, right: bigint): -1 | 0 | 1 {
  const leftString = left.toString(10);
  const rightString = right.toString(10);
  if (leftString.length < rightString.length) return -1;
  if (leftString.length > rightString.length) return 1;
  return compareStrings(leftString, rightString);
}

function compareOptionalStrings(left: string | undefined, right: string | undefined): -1 | 0 | 1 {
  return compareStrings(left ?? "", right ?? "");
}

function compareOptionalSequences(
  left: number | undefined,
  right: number | undefined,
): -1 | 0 | 1 {
  const leftString = left === undefined ? "" : String(left);
  const rightString = right === undefined ? "" : String(right);
  if (leftString.length !== rightString.length) {
    return leftString.length < rightString.length ? -1 : 1;
  }
  return compareStrings(leftString, rightString);
}

function itemEffect(item: Pick<NormalizedSpendableForecastItem, "amountCents" | "direction">): bigint {
  return item.direction === "INFLOW" ? item.amountCents : -item.amountCents;
}

function sourceForDomain(source: ForecastSource, field: string): SpendableSource {
  const referenceId = spendableReference(source.referenceId, `${field}.referenceId`);
  const normalized: SpendableSource = {
    kind: source.kind,
    referenceId,
    label: source.label,
  };

  if (source.recurringRuleId !== undefined) {
    normalized.recurringRuleId = spendableReference(
      source.recurringRuleId,
      `${field}.recurringRuleId`,
    );
  }
  if (source.occurrenceKey !== undefined) normalized.occurrenceKey = source.occurrenceKey;
  if (source.billingCycle !== undefined) normalized.billingCycle = source.billingCycle;
  if (source.installmentSequence !== undefined) {
    if (!Number.isInteger(source.installmentSequence) || source.installmentSequence <= 0) {
      return fail("INVALID_ITEM", "A sequência da parcela é inválida.", `${field}.installmentSequence`);
    }
    normalized.installmentSequence = source.installmentSequence;
  }

  return normalized;
}

/** Converts the public S07 item to a persistence-free domain value. */
export function normalizeSpendableForecastItem(
  value: ForecastItem,
  index = 0,
): NormalizedSpendableForecastItem {
  let item: ForecastItem;
  try {
    item = parseForecastItem(value);
  } catch {
    return fail("INVALID_ITEM", "Item de forecast inválido.", `items[${index}]`);
  }

  const referenceId = spendableReference(item.referenceId, `items[${index}].referenceId`);
  const source = sourceForDomain(item.source, `items[${index}].source`);
  if (source.referenceId !== referenceId) {
    return fail(
      "SPENDABLE_INCONSISTENT",
      "A referência do item deve coincidir com a origem.",
      `items[${index}].referenceId`,
    );
  }

  let amountCents: bigint;
  try {
    amountCents = spendablePositiveCents(item.amountCents, `items[${index}].amountCents`);
  } catch (error) {
    if (error instanceof SpendableContractError) throw error;
    return fail("INVALID_AMOUNT", "Centavos do item são inválidos.", `items[${index}].amountCents`);
  }

  const reconciliation = item.reconciliation
    ? {
        key: spendableReference(item.reconciliation.key, `items[${index}].reconciliation.key`),
        replacesReferenceId:
          item.reconciliation.replacesReferenceId === null
            ? null
            : spendableReference(
                item.reconciliation.replacesReferenceId,
                `items[${index}].reconciliation.replacesReferenceId`,
              ),
        plannedAmountCents: item.reconciliation.plannedAmountCents,
        realizedAmountCents: item.reconciliation.realizedAmountCents,
        remainingAmountCents: item.reconciliation.remainingAmountCents,
        varianceAmountCents: item.reconciliation.varianceAmountCents,
      }
    : null;

  return {
    date: spendableDate(item.date, `items[${index}].date`),
    amountCents,
    direction: item.direction,
    status: item.status,
    certainty: item.certainty,
    source,
    referenceId,
    reconciliation,
  };
}

/** Normalizes and canonically orders a collection before it is grouped by day. */
export function normalizeSpendableForecastItems(
  values: readonly ForecastItem[],
): readonly NormalizedSpendableForecastItem[] {
  const uniqueByReference = new Map<string, NormalizedSpendableForecastItem>();
  for (const [index, value] of values.entries()) {
    const normalized = normalizeSpendableForecastItem(value, index);
    const previous = uniqueByReference.get(normalized.referenceId);
    if (previous) {
      if (itemFingerprint(previous) === itemFingerprint(normalized)) continue;
      return fail(
        "DUPLICATE_REFERENCE",
        "A referência de forecast aparece com valores conflitantes.",
        `items[${index}].referenceId`,
      );
    }
    uniqueByReference.set(normalized.referenceId, normalized);
  }
  return [...uniqueByReference.values()].sort(compareSpendableForecastItems);
}

export const normalizeForecastItems = normalizeSpendableForecastItems;
export const normalizeSpendableItems = normalizeSpendableForecastItems;

function itemFingerprint(item: NormalizedSpendableForecastItem): string {
  const reconciliation = item.reconciliation;
  return [
    item.date.toString(),
    item.amountCents.toString(10),
    item.direction,
    item.status,
    item.certainty,
    item.referenceId,
    item.source.kind,
    item.source.referenceId,
    item.source.recurringRuleId ?? "",
    item.source.occurrenceKey ?? "",
    item.source.billingCycle ?? "",
    item.source.installmentSequence === undefined ? "" : String(item.source.installmentSequence),
    reconciliation?.key ?? "",
    reconciliation?.replacesReferenceId ?? "",
    reconciliation?.plannedAmountCents ?? "",
    reconciliation?.realizedAmountCents ?? "",
    reconciliation?.remainingAmountCents ?? "",
    reconciliation?.varianceAmountCents ?? "",
  ].join("\u001f");
}

/** Canonical ordering excludes labels because labels are presentation-only. */
export function compareSpendableForecastItems(
  left: NormalizedSpendableForecastItem,
  right: NormalizedSpendableForecastItem,
): -1 | 0 | 1 {
  let comparison = compareSpendableDates(left.date, right.date);
  if (comparison !== 0) return comparison;

  comparison = compareStrings(STATUS_ORDER[left.status], STATUS_ORDER[right.status]);
  if (comparison !== 0) return comparison;
  comparison = compareStrings(left.source.kind, right.source.kind);
  if (comparison !== 0) return comparison;
  comparison = compareStrings(left.source.referenceId, right.source.referenceId);
  if (comparison !== 0) return comparison;
  comparison = compareOptionalStrings(left.source.recurringRuleId, right.source.recurringRuleId);
  if (comparison !== 0) return comparison;
  comparison = compareOptionalStrings(left.source.occurrenceKey, right.source.occurrenceKey);
  if (comparison !== 0) return comparison;
  comparison = compareOptionalStrings(left.source.billingCycle, right.source.billingCycle);
  if (comparison !== 0) return comparison;
  comparison = compareOptionalSequences(
    left.source.installmentSequence,
    right.source.installmentSequence,
  );
  if (comparison !== 0) return comparison;
  comparison = compareStrings(left.referenceId, right.referenceId);
  if (comparison !== 0) return comparison;
  comparison = compareStrings(left.direction, right.direction);
  if (comparison !== 0) return comparison;
  comparison = compareStrings(left.certainty, right.certainty);
  if (comparison !== 0) return comparison;
  comparison = compareCanonicalUnsignedCents(left.amountCents, right.amountCents);
  if (comparison !== 0) return comparison;

  const leftReconciliation = left.reconciliation;
  const rightReconciliation = right.reconciliation;
  comparison = compareOptionalStrings(leftReconciliation?.key, rightReconciliation?.key);
  if (comparison !== 0) return comparison;
  comparison = compareOptionalStrings(
    leftReconciliation?.replacesReferenceId ?? undefined,
    rightReconciliation?.replacesReferenceId ?? undefined,
  );
  if (comparison !== 0) return comparison;
  for (const property of [
    "plannedAmountCents",
    "realizedAmountCents",
    "remainingAmountCents",
    "varianceAmountCents",
  ] as const) {
    comparison = compareOptionalStrings(
      leftReconciliation?.[property] ?? undefined,
      rightReconciliation?.[property] ?? undefined,
    );
    if (comparison !== 0) return comparison;
  }

  return 0;
}

function normalizedItemFromDay(
  item: ForecastItem,
  dayDate: string,
  index: number,
): NormalizedSpendableForecastItem {
  const normalized = normalizeSpendableForecastItem(item, index);
  if (normalized.date.toString() !== dayDate) {
    return fail(
      "SPENDABLE_INCONSISTENT",
      "A data do item deve coincidir com a data do dia.",
      `days[${index}].items`,
    );
  }
  return normalized;
}

function resolveInput(
  value: ForecastTimeline | SpendableTimelineInput,
  overrides?: NormalizeSpendableTimelineOptions,
): {
  readonly forecast: ForecastTimeline;
  readonly options: NormalizeSpendableTimelineOptions;
} {
  if ("contractVersion" in (value as object)) {
    return {
      forecast: parseForecastTimeline(value),
      options: overrides ?? {},
    };
  }

  const input = value as SpendableTimelineInput;
  const source = input.forecast ?? input.timeline;
  if (!source) return fail("SPENDABLE_INCONSISTENT", "A timeline S07 é obrigatória.", "forecast");

  return {
    forecast: parseForecastTimeline(source),
    options: {
      ...input,
      ...(overrides ?? {}),
    },
  };
}

function emptyForecastTimeline(
  from: string,
  to: string,
  openingBalanceCents: string,
  scenario: SpendableScenario,
): ForecastTimeline {
  return {
    contractVersion: FORECAST_CONTRACT_VERSION,
    scenario,
    from,
    to,
    openingBalanceCents,
    openingAdjustmentsCents: "0",
    openingProjectedBalanceCents: openingBalanceCents,
    closingProjectedBalanceCents: openingBalanceCents,
    minimumProjectedBalanceCents: openingBalanceCents,
    minimumProjectedOn: null,
    totals: {
      inflowCents: "0",
      outflowCents: "0",
      netCents: "0",
      realizedInflowCents: "0",
      realizedOutflowCents: "0",
      projectedInflowCents: "0",
      projectedOutflowCents: "0",
    },
    periods: [],
    days: [],
    minimumBalanceReferences: [],
  };
}

function resolveRange(
  forecast: ForecastTimeline,
  options: NormalizeSpendableTimelineOptions,
): { readonly from: Temporal.PlainDate; readonly to: Temporal.PlainDate } {
  const fromValue = options.from ?? forecast.from;
  const toValue = options.to ?? forecast.to;
  const from = parseSpendableDate(fromValue, "from");
  const to = parseSpendableDate(toValue, "to");
  if (compareSpendableDates(from, to) > 0) {
    return fail("INVALID_DATE_RANGE", "from deve ser igual ou anterior a to.", "from");
  }
  return { from, to };
}

function openingDate(from: Temporal.PlainDate): Temporal.PlainDate {
  return from.subtract({ days: 1 });
}

function createComponent(
  kind: SpendableBalanceComponent["kind"],
  date: Temporal.PlainDate,
  amountCents: bigint,
  referenceId: OpaqueReference | null,
  direction: SpendableDirection | null,
  sourceKind: SpendableBalanceComponent["sourceKind"],
): SpendableBalanceComponent {
  return {
    kind,
    date,
    amount: spendableMoney(amountCents),
    amountCents,
    referenceId,
    direction,
    sourceKind,
  };
}

function createOpeningPoint(
  date: Temporal.PlainDate,
  openingBalanceCents: bigint,
  openingAdjustmentsCents: bigint,
  openingItems: readonly NormalizedSpendableForecastItem[],
): SpendableBalancePoint {
  const projectedBalanceCents = openingBalanceCents + openingAdjustmentsCents;
  const components: SpendableBalanceComponent[] = [
    createComponent("OPENING", date, openingBalanceCents, null, null, null),
  ];
  if (openingAdjustmentsCents !== ZERO) {
    components.push(
      createComponent("OPENING_ADJUSTMENT", date, openingAdjustmentsCents, null, null, null),
    );
  }
  return {
    kind: "OPENING",
    date,
    projectedBalanceCents,
    references: [...new Set(openingItems.map(({ referenceId }) => referenceId))].sort(),
    items: openingItems,
    components,
  };
}

function createDailyPoint(
  date: Temporal.PlainDate,
  items: readonly NormalizedSpendableForecastItem[],
  openingProjectedBalanceCents: bigint,
): NormalizedSpendableDailyPoint {
  let inflowCents = ZERO;
  let outflowCents = ZERO;
  const components: SpendableBalanceComponent[] = [];

  for (const item of items) {
    if (item.direction === "INFLOW") inflowCents += item.amountCents;
    else outflowCents += item.amountCents;
    components.push(
      createComponent(
        "DAY_ITEM",
        date,
        itemEffect(item),
        item.referenceId,
        item.direction,
        item.source.kind,
      ),
    );
  }

  const netCents = inflowCents - outflowCents;
  const closingProjectedBalanceCents = openingProjectedBalanceCents + netCents;
  components.push(createComponent("DAY_NET", date, netCents, null, null, null));

  return {
    date,
    items,
    inflowCents,
    outflowCents,
    netCents,
    openingProjectedBalanceCents,
    closingProjectedBalanceCents,
    components,
  };
}

function pointFromDaily(day: NormalizedSpendableDailyPoint): SpendableBalancePoint {
  return {
    kind: "DAY_CLOSE",
    date: day.date,
    projectedBalanceCents: day.closingProjectedBalanceCents,
    references: [...new Set(day.items.map(({ referenceId }) => referenceId))].sort(),
    items: day.items,
    components: day.components,
  };
}

function minimumPoints(points: readonly SpendableBalancePoint[]): readonly SpendableBalancePoint[] {
  let minimum = points[0]?.projectedBalanceCents ?? ZERO;
  for (const point of points.slice(1)) {
    if (point.projectedBalanceCents < minimum) minimum = point.projectedBalanceCents;
  }
  return points.filter(({ projectedBalanceCents }) => projectedBalanceCents === minimum);
}

function uniqueSortedReferences(points: readonly SpendableBalancePoint[]): readonly string[] {
  return [...new Set(points.flatMap(({ references }) => references))].sort(compareStrings);
}

function normalizeItems(
  forecast: ForecastTimeline,
  options: NormalizeSpendableTimelineOptions,
  range: { readonly from: Temporal.PlainDate; readonly to: Temporal.PlainDate },
): {
  readonly inRange: readonly NormalizedSpendableForecastItem[];
  readonly beforeRange: readonly NormalizedSpendableForecastItem[];
} {
  const rawItems: Array<{ readonly item: ForecastItem; readonly dayDate?: string }> = [];
  if (options.items) {
    for (const item of options.items) rawItems.push({ item });
  } else {
    for (const day of forecast.days) {
      for (const item of day.items) rawItems.push({ item, dayDate: day.date });
    }
  }

  const uniqueByReference = new Map<string, NormalizedSpendableForecastItem>();
  for (const [index, entry] of rawItems.entries()) {
    const normalized = entry.dayDate
      ? normalizedItemFromDay(entry.item, entry.dayDate, index)
      : normalizeSpendableForecastItem(entry.item, index);
    const previous = uniqueByReference.get(normalized.referenceId);
    if (previous) {
      if (itemFingerprint(previous) === itemFingerprint(normalized)) continue;
      return fail(
        "DUPLICATE_REFERENCE",
        "A referência de forecast aparece com valores conflitantes.",
        `items[${index}].referenceId`,
      );
    }
    uniqueByReference.set(normalized.referenceId, normalized);
  }

  const all = [...uniqueByReference.values()].sort(compareSpendableForecastItems);
  const inRange: NormalizedSpendableForecastItem[] = [];
  const beforeRange: NormalizedSpendableForecastItem[] = [];
  for (const item of all) {
    if (compareSpendableDates(item.date, range.from) < 0) beforeRange.push(item);
    else if (compareSpendableDates(item.date, range.to) <= 0) inRange.push(item);
  }
  return { inRange, beforeRange };
}

function openingAdjustmentFromItems(items: readonly NormalizedSpendableForecastItem[]): bigint {
  return items.reduce((sum, item) => sum + itemEffect(item), ZERO);
}

/**
 * Normalizes an S07 timeline for S08.  It copies no persistence object,
 * recalculates each daily aggregate from item rows, and performs all balance
 * arithmetic with bigint.
 */
export function normalizeSpendableTimeline(
  timeline: ForecastTimeline,
  options?: NormalizeSpendableTimelineOptions,
): NormalizedSpendableTimeline;
export function normalizeSpendableTimeline(
  input: SpendableTimelineInput,
): NormalizedSpendableTimeline;
export function normalizeSpendableTimeline(
  items: readonly ForecastItem[],
  openingBalanceCents: SpendableCentsInput,
  range: SpendableDateRangeInput,
  scenario?: SpendableScenario,
): NormalizedSpendableTimeline;
export function normalizeSpendableTimeline(
  value: ForecastTimeline | SpendableTimelineInput | readonly ForecastItem[],
  overrides?: NormalizeSpendableTimelineOptions | SpendableCentsInput,
  rangeInput?: SpendableDateRangeInput,
  scenarioInput?: SpendableScenario,
): NormalizedSpendableTimeline {
  if (Array.isArray(value)) {
    if (overrides === undefined || rangeInput === undefined) {
      return fail(
        "SPENDABLE_INCONSISTENT",
        "Itens exigem saldo de abertura e intervalo.",
        "range",
      );
    }
    const from = parseSpendableDate(rangeInput.from, "from").toString();
    const to = parseSpendableDate(rangeInput.to, "to").toString();
    const openingBalanceCents = spendableCents(overrides, "openingBalanceCents").toString(10);
    const scenario = scenarioInput ?? "CONSERVATIVE";
    return normalizeSpendableTimeline({
      forecast: emptyForecastTimeline(from, to, openingBalanceCents, scenario),
      items: value,
      openingBalanceCents,
      openingAdjustmentsCents: "0",
      scenario,
      from,
      to,
    });
  }

  if (overrides !== undefined && typeof overrides !== "object") {
    return fail("SPENDABLE_INCONSISTENT", "Opções de timeline inválidas.", "options");
  }
  const { forecast, options } = resolveInput(
    value as ForecastTimeline | SpendableTimelineInput,
    overrides as NormalizeSpendableTimelineOptions | undefined,
  );
  const range = resolveRange(forecast, options);
  const scenario = options.scenario ?? forecast.scenario;
  if (scenario !== forecast.scenario && !options.items) {
    return fail(
      "INVALID_SCENARIO",
      "O cenário da timeline S07 não coincide com o solicitado.",
      "scenario",
    );
  }

  const normalizedItems = normalizeItems(forecast, options, range);
  const openingBalanceCents = spendableCents(
    options.openingBalanceCents ?? forecast.openingBalanceCents,
    "openingBalanceCents",
  );
  const hasExplicitOpeningAdjustments = options.openingAdjustmentsCents !== undefined;
  const openingAdjustmentsCents = hasExplicitOpeningAdjustments
    ? spendableCents(options.openingAdjustmentsCents, "openingAdjustmentsCents")
    : options.items && normalizedItems.beforeRange.length > 0
      ? openingAdjustmentFromItems(normalizedItems.beforeRange)
      : spendableCents(forecast.openingAdjustmentsCents, "openingAdjustmentsCents");
  const openingItems = hasExplicitOpeningAdjustments ? [] : normalizedItems.beforeRange;

  const grouped = new Map<string, NormalizedSpendableForecastItem[]>();
  for (const item of normalizedItems.inRange) {
    const key = item.date.toString();
    const existing = grouped.get(key);
    if (existing) existing.push(item);
    else grouped.set(key, [item]);
  }

  const openingProjectedBalanceCents = openingBalanceCents + openingAdjustmentsCents;
  let projectedBalanceCents = openingProjectedBalanceCents;
  const days: NormalizedSpendableDailyPoint[] = [];
  for (const [dateString, dayItems] of [...grouped.entries()].sort(([left], [right]) =>
    compareStrings(left, right),
  )) {
    const date = parseSpendableDate(dateString, "days.date");
    const day = createDailyPoint(date, dayItems, projectedBalanceCents);
    days.push(day);
    projectedBalanceCents = day.closingProjectedBalanceCents;
  }

  const openingPoint = createOpeningPoint(
    openingDate(range.from),
    openingBalanceCents,
    openingAdjustmentsCents,
    openingItems,
  );
  const points = [openingPoint, ...days.map(pointFromDaily)];
  const minima = minimumPoints(points);
  const minimumProjectedBalanceCents = minima[0]?.projectedBalanceCents ?? openingProjectedBalanceCents;
  const firstMinimumDay = minima.find((point) => point.kind === "DAY_CLOSE");

  return {
    contractVersion: SPENDABLE_CONTRACT_VERSION,
    scenario,
    from: range.from,
    to: range.to,
    openingBalanceCents,
    openingBalance: spendableMoney(openingBalanceCents),
    openingAdjustmentsCents,
    openingAdjustments: spendableMoney(openingAdjustmentsCents),
    openingProjectedBalanceCents,
    closingProjectedBalanceCents: projectedBalanceCents,
    minimumProjectedBalanceCents,
    minimumProjectedOn: firstMinimumDay?.date ?? null,
    openingPoint,
    points,
    days,
    items: normalizedItems.inRange,
    minimumBalanceReferences: uniqueSortedReferences(minima),
  };
}

export const normalizeForecastTimeline = normalizeSpendableTimeline;
export const normalizeSpendableForecastTimeline = normalizeSpendableTimeline;
export const buildSpendableTimeline = normalizeSpendableTimeline;
export const buildNormalizedSpendableTimeline = normalizeSpendableTimeline;
export const aggregateSpendableTimeline = normalizeSpendableTimeline;
export const normalizeTimeline = normalizeSpendableTimeline;

function serializeItem(item: NormalizedSpendableForecastItem): ForecastItem {
  return {
    date: item.date.toString(),
    amountCents: item.amountCents.toString(10),
    direction: item.direction,
    status: item.status,
    certainty: item.certainty,
    source: { ...item.source },
    referenceId: item.referenceId,
    reconciliation: item.reconciliation
      ? { ...item.reconciliation }
      : null,
  };
}

function serializeComponent(component: SpendableBalanceComponent): {
  readonly kind: SpendableBalanceComponent["kind"];
  readonly date: string;
  readonly amountCents: string;
  readonly referenceId: string | null;
  readonly direction: SpendableDirection | null;
  readonly sourceKind: SpendableBalanceComponent["sourceKind"];
} {
  return {
    kind: component.kind,
    date: component.date.toString(),
    amountCents: component.amountCents.toString(10),
    referenceId: component.referenceId,
    direction: component.direction,
    sourceKind: component.sourceKind,
  };
}

function serializePoint(point: SpendableBalancePoint): {
  readonly kind: SpendableBalancePoint["kind"];
  readonly date: string;
  readonly projectedBalanceCents: string;
  readonly references: readonly string[];
  readonly items: readonly ForecastItem[];
  readonly components: readonly ReturnType<typeof serializeComponent>[];
} {
  return {
    kind: point.kind,
    date: point.date.toString(),
    projectedBalanceCents: point.projectedBalanceCents.toString(10),
    references: [...point.references],
    items: point.items.map(serializeItem),
    components: point.components.map(serializeComponent),
  };
}

export interface SerializedNormalizedSpendableDailyPoint {
  readonly date: string;
  readonly items: readonly ForecastItem[];
  readonly inflowCents: string;
  readonly outflowCents: string;
  readonly netCents: string;
  readonly openingProjectedBalanceCents: string;
  readonly closingProjectedBalanceCents: string;
  readonly components: readonly ReturnType<typeof serializeComponent>[];
}

export interface SerializedNormalizedSpendableTimeline {
  readonly contractVersion: typeof SPENDABLE_CONTRACT_VERSION;
  readonly scenario: SpendableScenario;
  readonly from: string;
  readonly to: string;
  readonly openingBalanceCents: string;
  readonly openingAdjustmentsCents: string;
  readonly openingProjectedBalanceCents: string;
  readonly closingProjectedBalanceCents: string;
  readonly minimumProjectedBalanceCents: string;
  readonly minimumProjectedOn: string | null;
  readonly openingPoint: ReturnType<typeof serializePoint>;
  readonly points: readonly ReturnType<typeof serializePoint>[];
  readonly days: readonly SerializedNormalizedSpendableDailyPoint[];
  readonly items: readonly ForecastItem[];
  readonly minimumBalanceReferences: readonly string[];
  readonly forecastContractVersion: typeof FORECAST_CONTRACT_VERSION;
}

export function serializeSpendableTimeline(
  timeline: NormalizedSpendableTimeline,
): SerializedNormalizedSpendableTimeline {
  return {
    contractVersion: timeline.contractVersion,
    scenario: timeline.scenario,
    from: timeline.from.toString(),
    to: timeline.to.toString(),
    openingBalanceCents: timeline.openingBalanceCents.toString(10),
    openingAdjustmentsCents: timeline.openingAdjustmentsCents.toString(10),
    openingProjectedBalanceCents: timeline.openingProjectedBalanceCents.toString(10),
    closingProjectedBalanceCents: timeline.closingProjectedBalanceCents.toString(10),
    minimumProjectedBalanceCents: timeline.minimumProjectedBalanceCents.toString(10),
    minimumProjectedOn: timeline.minimumProjectedOn?.toString() ?? null,
    openingPoint: serializePoint(timeline.openingPoint),
    points: timeline.points.map(serializePoint),
    days: timeline.days.map((day) => ({
      date: day.date.toString(),
      items: day.items.map(serializeItem),
      inflowCents: day.inflowCents.toString(10),
      outflowCents: day.outflowCents.toString(10),
      netCents: day.netCents.toString(10),
      openingProjectedBalanceCents: day.openingProjectedBalanceCents.toString(10),
      closingProjectedBalanceCents: day.closingProjectedBalanceCents.toString(10),
      components: day.components.map(serializeComponent),
    })),
    items: timeline.items.map(serializeItem),
    minimumBalanceReferences: [...timeline.minimumBalanceReferences],
    forecastContractVersion: FORECAST_CONTRACT_VERSION,
  };
}

export const toSerializableSpendableTimeline = serializeSpendableTimeline;

/** Maps a normalized item to the causal S08 item without exposing domain values. */
export function toSpendableCausalItem(
  item: NormalizedSpendableForecastItem,
): SpendableCausalItem {
  return {
    referenceId: item.referenceId,
    sourceKind: item.source.kind,
    date: item.date.toString(),
    amountCents: item.amountCents.toString(10),
    direction: item.direction,
    status: item.status,
    certainty: item.certainty,
    ...(item.source.recurringRuleId === undefined
      ? {}
      : { recurringRuleId: item.source.recurringRuleId }),
    ...(item.source.occurrenceKey === undefined
      ? {}
      : { occurrenceKey: item.source.occurrenceKey }),
    ...(item.source.billingCycle === undefined
      ? {}
      : { billingCycle: item.source.billingCycle }),
    ...(item.source.installmentSequence === undefined
      ? {}
      : { installmentSequence: item.source.installmentSequence }),
  };
}

export function toSpendableCausalPoint(
  point: SpendableBalancePoint,
): SpendableCausalPoint {
  return {
    kind: point.kind,
    date: point.date.toString(),
    projectedBalanceCents: point.projectedBalanceCents.toString(10),
    references: [...point.references],
    items: point.items.map(toSpendableCausalItem),
  };
}
