import { Temporal } from "@js-temporal/polyfill";

import type {
  ForecastItem,
  ForecastTimeline,
} from "@/modules/forecast/contracts";

import {
  FORECAST_CONTRACT_VERSION,
  SPENDABLE_CONTRACT_VERSION,
  SPENDABLE_RULE_VERSION,
  SpendableContractError,
  compareSpendableDates,
  parseSpendableDate,
  parseSpendableBreakdown,
  spendableCents,
  spendableNonNegativeCents,
  spendableReference,
  type NormalizedSpendableForecastItem,
  type NormalizedSpendableTimeline,
  type OpaqueReference,
  type OperationalBufferSnapshot,
  type SpendableBufferSource,
  type SpendableCausalItem,
  type SpendableCausalPageInput,
  type SpendableCausalPoint,
  type SpendableDate,
  type SpendableDirection,
  type SpendableReserveComponent,
  type SpendableReserveSnapshot,
  type SpendableScenario,
  type SpendableBreakdown,
  type SpendableCentsInput,
} from "./contracts";
import {
  normalizeSpendableForecastItem,
  normalizeSpendableTimeline,
} from "./timeline";
import {
  normalizeSpendableCausalPageInput,
  paginateSpendableCausalPoints,
} from "./causality";

/** The largest horizon accepted by the S07/S08 contract. */
export const MAX_SPENDABLE_HORIZON_DAYS = 3_660;

const ZERO = BigInt(0);

export type SpendableEngineDateInput = SpendableDate | string;

export interface SpendableEngineDateRange {
  readonly from: SpendableEngineDateInput;
  readonly to: SpendableEngineDateInput;
}

export type SpendableEngineRangeInput =
  | SpendableEngineDateRange
  | readonly [SpendableEngineDateInput, SpendableEngineDateInput];

/**
 * Buffer input accepted by the pure engine.  The public DTO uses strings,
 * while the domain adapter may still hold a bigint or Money value.
 */
export interface SpendableEngineBufferInput {
  readonly amountCents: SpendableCentsInput;
  readonly source: SpendableBufferSource;
  readonly effectiveFrom: SpendableEngineDateInput | null;
  readonly revision: OpaqueReference | null;
}

export type SpendableBufferInput =
  | OperationalBufferSnapshot
  | SpendableEngineBufferInput;

/**
 * A public reserve component has `amountCents`; the S09 domain snapshot uses
 * `amount` and can additionally expose the effective signed amount through
 * `appliedAmount`.
 */
export interface SpendableEngineReserveComponentInput {
  readonly referenceId: OpaqueReference;
  readonly amountCents?: SpendableCentsInput;
  readonly amount?: SpendableCentsInput;
  readonly appliedAmountCents?: SpendableCentsInput;
  readonly appliedAmount?: SpendableCentsInput;
  readonly effectiveOn: SpendableEngineDateInput;
}

export interface SpendableEngineReserveInput {
  readonly contractVersion: "s09.v1";
  readonly status: "UNAVAILABLE" | "AVAILABLE";
  readonly protectedCents?: SpendableCentsInput;
  readonly protectedAmount?: SpendableCentsInput;
  readonly appliedOpeningAdjustmentCents?: SpendableCentsInput;
  readonly appliedOpeningAdjustment?: SpendableCentsInput;
  readonly components: readonly SpendableEngineReserveComponentInput[];
}

export type SpendableReserveInput =
  | SpendableReserveSnapshot
  | SpendableEngineReserveInput;

export type SpendableEngineItem =
  | ForecastItem
  | NormalizedSpendableForecastItem;

/**
 * Object form for service adapters.  A buffer and reserve are deliberately
 * optional at the type edge so malformed/missing calls fail explicitly at
 * runtime rather than receiving hidden zero defaults.
 */
export interface SpendableEngineInput {
  readonly timeline?: NormalizedSpendableTimeline | ForecastTimeline;
  readonly normalizedTimeline?: NormalizedSpendableTimeline;
  readonly forecast?: ForecastTimeline;
  readonly items?: readonly SpendableEngineItem[];
  readonly openingBalanceCents?: SpendableCentsInput;
  readonly openingBalance?: SpendableCentsInput;
  readonly openingAdjustmentsCents?: SpendableCentsInput;
  readonly range?: SpendableEngineRangeInput;
  readonly from?: SpendableEngineDateInput;
  readonly to?: SpendableEngineDateInput;
  readonly asOf?: SpendableEngineDateInput;
  readonly horizon?: { readonly days: number };
  readonly scenario?: SpendableScenario;
  readonly operationalBuffer?: SpendableBufferInput;
  readonly buffer?: SpendableBufferInput;
  readonly reserve?: SpendableReserveInput;
  /** Optional bounded explanation page; calculation always uses all items. */
  readonly causalItems?: SpendableCausalPageInput;
  /** Compatibility alias for callers that name the explanation a page. */
  readonly causalPage?: SpendableCausalPageInput;
}

interface NormalizedBuffer {
  readonly amountCents: string;
  readonly source: SpendableBufferSource;
  readonly effectiveFrom: string | null;
  readonly revision: OpaqueReference | null;
}

interface NormalizedReserveComponent {
  readonly referenceId: OpaqueReference;
  readonly amountCents: bigint;
  readonly appliedAmountCents: bigint | null;
  readonly effectiveOn: SpendableDate;
}

interface NormalizedReserve {
  readonly contractVersion: "s09.v1";
  readonly status: "UNAVAILABLE" | "AVAILABLE";
  readonly protectedCents: bigint;
  readonly appliedOpeningAdjustmentCents: bigint;
  readonly components: readonly NormalizedReserveComponent[];
}

interface ResolvedRange {
  readonly from: SpendableDate;
  readonly to: SpendableDate;
  readonly asOf: SpendableDate;
  readonly horizonDays: number;
}

interface ResolvedTimeline {
  readonly timeline: NormalizedSpendableTimeline;
  readonly range: ResolvedRange;
}

function fail(
  message: string,
  field = "input",
): never {
  throw new SpendableContractError("SPENDABLE_INCONSISTENT", message, field);
}

function compareStrings(left: string, right: string): -1 | 0 | 1 {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDate(value: unknown, field: string): SpendableDate {
  return parseSpendableDate(value, field);
}

function readSigned(value: unknown, field: string): bigint {
  return spendableCents(value, field);
}

function readNonNegative(value: unknown, field: string): bigint {
  return spendableNonNegativeCents(value, field);
}

function readPositiveInteger(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    return fail("O horizonte deve ser um inteiro positivo.", field);
  }
  return value;
}

function readRangeValue(
  value: SpendableEngineRangeInput | undefined,
  from: SpendableEngineDateInput | undefined,
  to: SpendableEngineDateInput | undefined,
): { readonly from: SpendableDate; readonly to: SpendableDate } | null {
  let candidateFrom: unknown;
  let candidateTo: unknown;

  if (value !== undefined) {
    if (Array.isArray(value)) {
      candidateFrom = value[0];
      candidateTo = value[1];
    } else {
      const objectRange = value as SpendableEngineDateRange;
      candidateFrom = objectRange.from;
      candidateTo = objectRange.to;
    }
  }

  if (from !== undefined) {
    if (candidateFrom !== undefined && String(candidateFrom) !== String(from)) {
      return fail("Intervalos de cálculo conflitantes.", "from");
    }
    candidateFrom = from;
  }
  if (to !== undefined) {
    if (candidateTo !== undefined && String(candidateTo) !== String(to)) {
      return fail("Intervalos de cálculo conflitantes.", "to");
    }
    candidateTo = to;
  }

  if (candidateFrom === undefined || candidateTo === undefined) return null;
  const parsedFrom = readDate(candidateFrom, "from");
  const parsedTo = readDate(candidateTo, "to");
  if (compareSpendableDates(parsedFrom, parsedTo) > 0) {
    return fail("from deve ser igual ou anterior a to.", "from");
  }
  return { from: parsedFrom, to: parsedTo };
}

function daysInRange(from: SpendableDate, to: SpendableDate): number {
  const days = from.until(to, { largestUnit: "days" }).days + 1;
  if (!Number.isSafeInteger(days) || days < 1) {
    return fail("O horizonte calculado é inválido.", "horizon.days");
  }
  if (days > MAX_SPENDABLE_HORIZON_DAYS) {
    return fail("O horizonte solicitado excede o limite do contrato.", "horizon.days");
  }
  return days;
}

function sameDate(left: SpendableDate, right: SpendableDate): boolean {
  return compareSpendableDates(left, right) === 0;
}

function resolveRange(
  input: SpendableEngineInput,
  sourceTimeline?: NormalizedSpendableTimeline | ForecastTimeline,
): ResolvedRange {
  const sourceFrom = sourceTimeline?.from;
  const sourceTo = sourceTimeline?.to;
  const explicitRange = readRangeValue(input.range, input.from, input.to);
  let range = explicitRange;

  if (range === null && sourceFrom !== undefined && sourceTo !== undefined) {
    range = {
      from: readDate(sourceFrom, "timeline.from"),
      to: readDate(sourceTo, "timeline.to"),
    };
  }

  const requestedHorizon = input.horizon?.days;
  const horizonDays = requestedHorizon === undefined
    ? undefined
    : readPositiveInteger(requestedHorizon, "horizon.days");

  if (range === null && input.asOf !== undefined && horizonDays !== undefined) {
    const asOf = readDate(input.asOf, "asOf");
    range = {
      from: asOf.add({ days: 1 }),
      to: asOf.add({ days: horizonDays }),
    };
  }

  if (range === null) {
    return fail("O engine exige from/to ou asOf/horizon.", "range");
  }

  const calculatedHorizon = daysInRange(range.from, range.to);
  if (horizonDays !== undefined && horizonDays !== calculatedHorizon) {
    return fail("O horizonte não coincide com o intervalo informado.", "horizon.days");
  }

  const asOf = range.from.subtract({ days: 1 });
  if (input.asOf !== undefined && !sameDate(readDate(input.asOf, "asOf"), asOf)) {
    return fail("asOf deve ser o dia civil anterior a from.", "asOf");
  }

  if (sourceTimeline) {
    const sourceTimelineFrom = readDate(sourceTimeline.from, "timeline.from");
    const sourceTimelineTo = readDate(sourceTimeline.to, "timeline.to");
    if (!sameDate(sourceTimelineFrom, range.from) || !sameDate(sourceTimelineTo, range.to)) {
      return fail("A janela do engine não coincide com a timeline.", "range");
    }
  }

  return {
    from: range.from,
    to: range.to,
    asOf,
    horizonDays: calculatedHorizon,
  };
}

function normalizedTimeline(value: unknown): value is NormalizedSpendableTimeline {
  if (!isRecord(value)) return false;
  return value.contractVersion === SPENDABLE_CONTRACT_VERSION &&
    value.from instanceof Temporal.PlainDate &&
    value.to instanceof Temporal.PlainDate &&
    typeof value.openingBalanceCents === "bigint" &&
    typeof value.openingAdjustmentsCents === "bigint" &&
    Array.isArray(value.items) &&
    isRecord(value.openingPoint);
}

function serializedForecastItem(item: NormalizedSpendableForecastItem): ForecastItem {
  return {
    date: item.date.toString(),
    amountCents: item.amountCents.toString(10),
    direction: item.direction,
    status: item.status,
    certainty: item.certainty,
    source: { ...item.source },
    referenceId: item.referenceId,
    reconciliation: item.reconciliation ? { ...item.reconciliation } : null,
  };
}

function minimalForecast(
  from: string,
  to: string,
  scenario: SpendableScenario,
  openingBalanceCents: string,
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

function itemIsNormalized(item: SpendableEngineItem): item is NormalizedSpendableForecastItem {
  return item.date instanceof Temporal.PlainDate && typeof item.amountCents === "bigint";
}

function normalizeRawItems(
  items: readonly SpendableEngineItem[],
): readonly ForecastItem[] {
  return items.map((item) => itemIsNormalized(item) ? serializedForecastItem(item) : item);
}

function resolveScenario(
  input: SpendableEngineInput,
  sourceTimeline?: NormalizedSpendableTimeline | ForecastTimeline,
): SpendableScenario {
  const sourceScenario = sourceTimeline?.scenario;
  if (input.scenario !== undefined && sourceScenario !== undefined && input.scenario !== sourceScenario) {
    return fail("O cenário do engine não coincide com a timeline.", "scenario");
  }
  const scenario = input.scenario ?? sourceScenario;
  if (scenario !== "CONSERVATIVE" && scenario !== "EXPECTED") {
    return fail("O cenário do engine é obrigatório e inválido.", "scenario");
  }
  return scenario;
}

function resolveOpeningBalance(
  input: SpendableEngineInput,
): SpendableCentsInput | undefined {
  if (input.openingBalanceCents !== undefined && input.openingBalance !== undefined) {
    const cents = readSigned(input.openingBalanceCents, "openingBalanceCents");
    const alias = readSigned(input.openingBalance, "openingBalance");
    if (cents !== alias) return fail("Saldos de abertura conflitantes.", "openingBalance");
  }
  return input.openingBalanceCents ?? input.openingBalance;
}

function resolveTimeline(
  input: SpendableEngineInput,
): ResolvedTimeline {
  const source = input.normalizedTimeline ?? input.timeline ?? input.forecast;
  const sourceForRange = source;
  const range = resolveRange(input, sourceForRange);
  const scenario = resolveScenario(input, source);

  if (normalizedTimeline(source)) {
    const balanceOverride = resolveOpeningBalance(input);
    if (balanceOverride !== undefined &&
      readSigned(balanceOverride, "openingBalanceCents") !== source.openingBalanceCents) {
      return fail("O saldo de abertura não coincide com a timeline.", "openingBalanceCents");
    }
    if (input.openingAdjustmentsCents !== undefined &&
      readSigned(input.openingAdjustmentsCents, "openingAdjustmentsCents") !== source.openingAdjustmentsCents) {
      return fail("Os ajustes de abertura não coincidem com a timeline.", "openingAdjustmentsCents");
    }
    return { timeline: source, range };
  }

  if (source !== undefined) {
    if (!isRecord(source) || source.contractVersion !== FORECAST_CONTRACT_VERSION) {
      return fail("A timeline de entrada é inválida.", "timeline");
    }
    const openingBalance = resolveOpeningBalance(input) ?? source.openingBalanceCents;
    const normalized = normalizeSpendableTimeline(source as ForecastTimeline, {
      openingBalanceCents: openingBalance,
      ...(input.openingAdjustmentsCents !== undefined
        ? { openingAdjustmentsCents: input.openingAdjustmentsCents }
        : {}),
      scenario,
      from: range.from,
      to: range.to,
    });
    return { timeline: normalized, range };
  }

  if (input.items === undefined) {
    return fail("O engine exige uma timeline ou itens.", "items");
  }
  const openingBalance = resolveOpeningBalance(input);
  if (openingBalance === undefined) {
    return fail("O engine exige saldo de abertura.", "openingBalanceCents");
  }
  const openingBalanceString = readSigned(openingBalance, "openingBalanceCents").toString(10);
  const forecast = minimalForecast(
    range.from.toString(),
    range.to.toString(),
    scenario,
    openingBalanceString,
  );
  const normalized = normalizeSpendableTimeline({
    forecast,
    items: normalizeRawItems(input.items),
    openingBalanceCents: openingBalance,
    ...(input.openingAdjustmentsCents !== undefined
      ? { openingAdjustmentsCents: input.openingAdjustmentsCents }
      : {}),
    scenario,
    from: range.from,
    to: range.to,
  });
  return { timeline: normalized, range };
}

function normalizeBuffer(value: SpendableBufferInput | undefined): NormalizedBuffer {
  if (!isRecord(value)) {
    return fail("O buffer operacional explícito é obrigatório.", "operationalBuffer");
  }
  const amount = readNonNegative(value.amountCents, "operationalBuffer.amountCents");
  const source = value.source;
  if (source !== "CONFIGURED" && source !== "ABSENT_DEFAULT_ZERO") {
    return fail("A origem do buffer operacional é inválida.", "operationalBuffer.source");
  }

  const effectiveFromValue = value.effectiveFrom;
  const effectiveFrom = effectiveFromValue === null || effectiveFromValue === undefined
    ? null
    : readDate(effectiveFromValue, "operationalBuffer.effectiveFrom").toString();
  const revisionValue = value.revision;
  const revision = revisionValue === null || revisionValue === undefined
    ? null
    : spendableReference(revisionValue, "operationalBuffer.revision");

  if (source === "ABSENT_DEFAULT_ZERO" &&
    (amount !== ZERO || effectiveFrom !== null || revision !== null)) {
    return fail(
      "Um buffer ausente deve ser explicitamente zero e sem vigência.",
      "operationalBuffer",
    );
  }

  return {
    amountCents: amount.toString(10),
    source,
    effectiveFrom,
    revision,
  };
}

function resolveCausalPage(
  input: SpendableEngineInput,
): SpendableCausalPageInput | undefined {
  if (input.causalItems !== undefined && input.causalPage !== undefined) {
    const first = normalizeSpendableCausalPageInput(input.causalItems);
    const second = normalizeSpendableCausalPageInput(input.causalPage);
    if (first.limit !== second.limit || first.cursor !== second.cursor) {
      return fail("As opções de paginação causal são conflitantes.", "minimum.causalItems");
    }
    return input.causalItems;
  }
  return input.causalItems ?? input.causalPage;
}

function reserveAmount(
  value: Record<string, unknown>,
  fields: readonly string[],
  field: string,
): bigint {
  const candidates = fields
    .map((name) => [name, value[name]] as const)
    .filter(([, candidate]) => candidate !== undefined);
  if (candidates.length === 0) return fail("O snapshot de reserva está incompleto.", field);
  const first = readSigned(candidates[0]![1], `${field}.${candidates[0]![0]}`);
  for (const [name, candidate] of candidates.slice(1)) {
    if (readSigned(candidate, `${field}.${name}`) !== first) {
      return fail("Campos equivalentes da reserva divergem.", field);
    }
  }
  return first;
}

function normalizeReserve(value: SpendableReserveInput | undefined): NormalizedReserve {
  if (!isRecord(value) || value.contractVersion !== "s09.v1") {
    return fail("O snapshot de reserva explícito é obrigatório.", "reserve");
  }
  const status = value.status;
  if (status !== "UNAVAILABLE" && status !== "AVAILABLE") {
    return fail("O status do snapshot de reserva é inválido.", "reserve.status");
  }
  const protectedCents = reserveAmount(
    value,
    ["protectedCents", "protectedAmount"],
    "reserve.protectedCents",
  );
  const appliedOpeningAdjustmentCents = reserveAmount(
    value,
    ["appliedOpeningAdjustmentCents", "appliedOpeningAdjustment"],
    "reserve.appliedOpeningAdjustmentCents",
  );
  if (protectedCents < ZERO) {
    return fail("A proteção da reserva não pode ser negativa.", "reserve.protectedCents");
  }

  if (!Array.isArray(value.components)) {
    return fail("O snapshot de reserva exige componentes.", "reserve.components");
  }
  const references = new Set<string>();
  const components: NormalizedReserveComponent[] = [];
  for (const [index, candidate] of value.components.entries()) {
    if (!isRecord(candidate)) {
      return fail("Componente de reserva inválido.", `reserve.components[${index}]`);
    }
    const referenceId = spendableReference(
      candidate.referenceId,
      `reserve.components[${index}].referenceId`,
    );
    if (references.has(referenceId)) {
      return fail(
        "Uma referência de reserva não pode aparecer duas vezes.",
        `reserve.components[${index}].referenceId`,
      );
    }
    references.add(referenceId);
    const amountCandidates = ["amountCents", "amount"]
      .map((name) => [name, candidate[name]] as const)
      .filter(([, item]) => item !== undefined);
    if (amountCandidates.length === 0) {
      return fail("Componente de reserva sem valor.", `reserve.components[${index}].amountCents`);
    }
    const amountCents = readNonNegative(
      amountCandidates[0]![1],
      `reserve.components[${index}].amountCents`,
    );
    for (const [name, item] of amountCandidates.slice(1)) {
      if (readNonNegative(item, `reserve.components[${index}].${name}`) !== amountCents) {
        return fail("Campos equivalentes do componente divergem.", `reserve.components[${index}]`);
      }
    }

    const appliedCandidates = ["appliedAmountCents", "appliedAmount"]
      .map((name) => [name, candidate[name]] as const)
      .filter(([, item]) => item !== undefined);
    let appliedAmountCents: bigint | null = null;
    if (appliedCandidates.length > 0) {
      appliedAmountCents = readSigned(
        appliedCandidates[0]![1],
        `reserve.components[${index}].appliedAmount`,
      );
      for (const [name, item] of appliedCandidates.slice(1)) {
        if (readSigned(item, `reserve.components[${index}].${name}`) !== appliedAmountCents) {
          return fail("Campos equivalentes do componente divergem.", `reserve.components[${index}]`);
        }
      }
    }
    components.push({
      referenceId,
      amountCents,
      appliedAmountCents,
      effectiveOn: readDate(candidate.effectiveOn, `reserve.components[${index}].effectiveOn`),
    });
  }

  components.sort((left, right) => {
  let comparison = compareSpendableDates(left.effectiveOn, right.effectiveOn);
    if (comparison !== 0) return comparison;
    comparison = compareStrings(left.referenceId, right.referenceId);
    if (comparison !== 0) return comparison;
    if (left.amountCents < right.amountCents) return -1;
    if (left.amountCents > right.amountCents) return 1;
    return 0;
  });

  if (status === "UNAVAILABLE" &&
    (protectedCents !== ZERO || appliedOpeningAdjustmentCents !== ZERO || components.length > 0)) {
    return fail("Uma reserva indisponível deve ser o snapshot zero.", "reserve");
  }

  const explicitApplied = components.some(({ appliedAmountCents }) => appliedAmountCents !== null);
  if (explicitApplied) {
    const componentApplied = components.reduce(
      (sum, component) => sum + (component.appliedAmountCents ?? ZERO),
      ZERO,
    );
    if (componentApplied !== appliedOpeningAdjustmentCents) {
      return fail(
        "Os ajustes dos componentes não reconciliam a abertura da reserva.",
        "reserve.appliedOpeningAdjustmentCents",
      );
    }
  }

  return {
    contractVersion: "s09.v1",
    status,
    protectedCents,
    appliedOpeningAdjustmentCents,
    components,
  };
}

function serializeReserveComponent(
  component: NormalizedReserveComponent,
): SpendableReserveComponent {
  return {
    referenceId: component.referenceId,
    amountCents: component.amountCents.toString(10),
    effectiveOn: component.effectiveOn.toString(),
  };
}

function reserveCausalItems(
  reserve: NormalizedReserve,
): readonly SpendableCausalItem[] {
  const adjustment = reserve.appliedOpeningAdjustmentCents;
  if (adjustment === ZERO) return [];

  const sign: SpendableDirection = adjustment < ZERO ? "OUTFLOW" : "INFLOW";
  const target = adjustment < ZERO ? -adjustment : adjustment;
  let remaining = target;
  const result: SpendableCausalItem[] = [];

  for (const component of reserve.components) {
    if (remaining === ZERO) break;
    const explicit = component.appliedAmountCents;
    const available = explicit === null
      ? component.amountCents
      : (explicit < ZERO ? -explicit : explicit);
    if (available <= ZERO) continue;
    const effective = available < remaining ? available : remaining;
    result.push({
      referenceId: component.referenceId,
      sourceKind: "RESERVE",
      date: component.effectiveOn.toString(),
      amountCents: effective.toString(10),
      direction: sign,
      status: null,
      certainty: null,
    });
    remaining -= effective;
  }

  if (remaining !== ZERO) {
    return fail(
      "Os componentes da reserva não explicam o ajuste de abertura.",
      "reserve.components",
    );
  }
  return result;
}

function causalFromForecastItem(
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

function causalItemCompare(
  left: SpendableCausalItem,
  right: SpendableCausalItem,
): -1 | 0 | 1 {
  let comparison = compareStrings(left.date, right.date);
  if (comparison !== 0) return comparison;
  comparison = compareStrings(left.sourceKind, right.sourceKind);
  if (comparison !== 0) return comparison;
  comparison = compareStrings(left.referenceId, right.referenceId);
  if (comparison !== 0) return comparison;
  comparison = compareStrings(left.direction, right.direction);
  if (comparison !== 0) return comparison;
  comparison = compareStrings(left.status ?? "", right.status ?? "");
  if (comparison !== 0) return comparison;
  comparison = compareStrings(left.certainty ?? "", right.certainty ?? "");
  if (comparison !== 0) return comparison;
  const leftAmount = BigInt(left.amountCents);
  const rightAmount = BigInt(right.amountCents);
  if (leftAmount < rightAmount) return -1;
  if (leftAmount > rightAmount) return 1;
  return 0;
}

function causalItemsForPoint(
  items: readonly NormalizedSpendableForecastItem[],
  reserveItems: readonly SpendableCausalItem[] = [],
): readonly SpendableCausalItem[] {
  return [
    ...items.map(causalFromForecastItem),
    ...reserveItems.map((item) => ({ ...item })),
  ].sort(causalItemCompare);
}

function uniqueSortedReferences(
  items: readonly SpendableCausalItem[],
): readonly OpaqueReference[] {
  return [...new Set(items.map(({ referenceId }) => referenceId))].sort(compareStrings);
}

function causalPoint(
  kind: "OPENING" | "DAY_CLOSE",
  date: SpendableDate,
  projectedBalanceCents: bigint,
  items: readonly SpendableCausalItem[],
): SpendableCausalPoint {
  return {
    kind,
    date: date.toString(),
    projectedBalanceCents: projectedBalanceCents.toString(10),
    references: uniqueSortedReferences(items),
    items: items.map((item) => ({ ...item })),
  };
}

function pointCompare(
  left: SpendableCausalPoint,
  right: SpendableCausalPoint,
): -1 | 0 | 1 {
  const comparison = compareStrings(left.date, right.date);
  if (comparison !== 0) return comparison;
  const leftReferences = left.references.join("\u001f");
  const rightReferences = right.references.join("\u001f");
  return compareStrings(leftReferences, rightReferences);
}

function normalizedItemsFromTimeline(
  timeline: NormalizedSpendableTimeline,
  from: SpendableDate,
  to: SpendableDate,
): {
  readonly opening: readonly NormalizedSpendableForecastItem[];
  readonly inRange: readonly NormalizedSpendableForecastItem[];
} {
  if (
    !isRecord(timeline.openingPoint) ||
    !Array.isArray(timeline.openingPoint.items) ||
    !Array.isArray(timeline.openingPoint.references) ||
    !Array.isArray(timeline.items) ||
    !Array.isArray(timeline.days) ||
    !Array.isArray(timeline.points)
  ) {
    return fail("A timeline normalizada está incompleta.", "timeline");
  }
  if (
    !(timeline.openingPoint.date instanceof Temporal.PlainDate) ||
    !sameDate(timeline.openingPoint.date, from.subtract({ days: 1 }))
  ) {
    return fail("A data de abertura não coincide com asOf.", "timeline.openingPoint.date");
  }

  const seen = new Set<string>();
  const openingSignatures = new Map<string, string>();
  const opening: NormalizedSpendableForecastItem[] = [];
  for (const item of timeline.openingPoint.items) {
    if (!isNormalizedForecastItem(item)) {
      return fail("Item causal de abertura inválido.", "timeline.openingPoint.items");
    }
    if (compareSpendableDates(item.date, from.subtract({ days: 1 })) > 0) {
      return fail("Item de abertura fora da janela causal.", "timeline.openingPoint.items");
    }
    if (seen.has(item.referenceId)) {
      return fail("Uma referência não pode aparecer duas vezes na timeline.", "timeline.items");
    }
    seen.add(item.referenceId);
    openingSignatures.set(item.referenceId, JSON.stringify(serializedForecastItem(item)));
    opening.push(item);
  }

  const inRange: NormalizedSpendableForecastItem[] = [];
  const timelineSignatures = new Map<string, string>();
  for (const item of timeline.items) {
    if (!isNormalizedForecastItem(item)) {
      return fail("Item de timeline inválido.", "timeline.items");
    }
    if (seen.has(item.referenceId)) {
      return fail("Uma referência não pode aparecer duas vezes na timeline.", "timeline.items");
    }
    seen.add(item.referenceId);
    const date = item.date;
    if (!(date instanceof Temporal.PlainDate)) {
      return fail("A timeline exige PlainDate no domínio.", "timeline.items.date");
    }
    if (compareSpendableDates(date, from) < 0 || compareSpendableDates(date, to) > 0) {
      return fail("Item fora da janela normalizada.", "timeline.items.date");
    }
    timelineSignatures.set(item.referenceId, JSON.stringify(serializedForecastItem(item)));
    inRange.push(item);
  }

  const expectedOpeningProjected = timeline.openingBalanceCents +
    timeline.openingAdjustmentsCents;
  if (
    timeline.openingPoint.projectedBalanceCents !== expectedOpeningProjected ||
    timeline.openingProjectedBalanceCents !== expectedOpeningProjected
  ) {
    return fail("A abertura projetada não reconcilia os componentes.", "timeline.openingProjectedBalanceCents");
  }
  if (
    !referencesEqual(
      timeline.openingPoint.references,
      opening.map(({ referenceId }) => referenceId),
    )
  ) {
    return fail("As referências da abertura não reconciliam seus itens.", "timeline.openingPoint.references");
  }

  const dayReferences = new Set<string>();
  let projectedBalanceCents = expectedOpeningProjected;
  let previousDate: SpendableDate | null = null;
  for (const [dayIndex, day] of timeline.days.entries()) {
    if (
      !isRecord(day) ||
      !(day.date instanceof Temporal.PlainDate) ||
      !Array.isArray(day.items) ||
      typeof day.inflowCents !== "bigint" ||
      typeof day.outflowCents !== "bigint" ||
      typeof day.netCents !== "bigint" ||
      typeof day.openingProjectedBalanceCents !== "bigint" ||
      typeof day.closingProjectedBalanceCents !== "bigint"
    ) {
      return fail("Ponto diário normalizado inválido.", `timeline.days[${dayIndex}]`);
    }
    if (
      compareSpendableDates(day.date, from) < 0 ||
      compareSpendableDates(day.date, to) > 0 ||
      previousDate !== null && compareSpendableDates(day.date, previousDate) <= 0
    ) {
      return fail("A data do ponto diário está fora de ordem/janela.", `timeline.days[${dayIndex}].date`);
    }
    previousDate = day.date;
    if (day.openingProjectedBalanceCents !== projectedBalanceCents) {
      return fail("A abertura diária não reconcilia o fechamento anterior.", `timeline.days[${dayIndex}].openingProjectedBalanceCents`);
    }

    let inflowCents = ZERO;
    let outflowCents = ZERO;
    const references: string[] = [];
    for (const [itemIndex, item] of day.items.entries()) {
      if (!isNormalizedForecastItem(item)) {
        return fail("Item diário normalizado inválido.", `timeline.days[${dayIndex}].items[${itemIndex}]`);
      }
      if (!sameDate(item.date, day.date)) {
        return fail("A data do item deve coincidir com o ponto diário.", `timeline.days[${dayIndex}].items[${itemIndex}].date`);
      }
      if (dayReferences.has(item.referenceId)) {
        return fail("Uma referência não pode aparecer duas vezes na timeline.", `timeline.days[${dayIndex}].items`);
      }
      dayReferences.add(item.referenceId);
      references.push(item.referenceId);
      if (item.direction === "INFLOW") inflowCents += item.amountCents;
      else outflowCents += item.amountCents;

      const expectedSignature = timelineSignatures.get(item.referenceId);
      if (expectedSignature === undefined || expectedSignature !== JSON.stringify(serializedForecastItem(item))) {
        return fail("Os itens diários não coincidem com a coleção da timeline.", `timeline.days[${dayIndex}].items`);
      }
    }
    const netCents = inflowCents - outflowCents;
    if (
      day.inflowCents !== inflowCents ||
      day.outflowCents !== outflowCents ||
      day.netCents !== netCents ||
      day.closingProjectedBalanceCents !== projectedBalanceCents + netCents
    ) {
      return fail("A soma diária não reconcilia o saldo projetado.", `timeline.days[${dayIndex}]`);
    }
    projectedBalanceCents = day.closingProjectedBalanceCents;

    const point = timeline.points[dayIndex + 1];
    if (
      !point ||
      point.kind !== "DAY_CLOSE" ||
      !(point.date instanceof Temporal.PlainDate) ||
      !sameDate(point.date, day.date) ||
      point.projectedBalanceCents !== day.closingProjectedBalanceCents ||
      !Array.isArray(point.items) ||
      point.items.length !== day.items.length ||
      !Array.isArray(point.references) ||
      !referencesEqual(point.references, references)
    ) {
      return fail("O ponto causal diário não reconcilia a soma diária.", `timeline.points[${dayIndex + 1}]`);
    }
    const pointReferences: string[] = [];
    for (const item of point.items) {
      if (!isNormalizedForecastItem(item) ||
          !dayReferences.has(item.referenceId) ||
          pointReferences.includes(item.referenceId) ||
          timelineSignatures.get(item.referenceId) !== JSON.stringify(serializedForecastItem(item))) {
        return fail("O ponto causal diário contém item divergente.", `timeline.points[${dayIndex + 1}].items`);
      }
      pointReferences.push(item.referenceId);
    }
    if (!referencesEqual(point.references, pointReferences)) {
      return fail("As referências do ponto diário não reconciliam seus itens.", `timeline.points[${dayIndex + 1}].references`);
    }
  }

  if (timeline.points.length !== timeline.days.length + 1) {
    return fail("A quantidade de pontos não coincide com os dias.", "timeline.points");
  }
  const firstPoint = timeline.points[0];
  if (
    !firstPoint ||
    firstPoint.kind !== "OPENING" ||
    !(firstPoint.date instanceof Temporal.PlainDate) ||
    !sameDate(firstPoint.date, from.subtract({ days: 1 })) ||
    firstPoint.projectedBalanceCents !== expectedOpeningProjected ||
    !Array.isArray(firstPoint.items) ||
    firstPoint.items.length !== opening.length ||
    !referencesEqual(firstPoint.references, timeline.openingPoint.references)
  ) {
    return fail("O ponto causal de abertura está inconsistente.", "timeline.points[0]");
  }
  for (const item of firstPoint.items) {
    if (!isNormalizedForecastItem(item) ||
        openingSignatures.get(item.referenceId) !== JSON.stringify(serializedForecastItem(item))) {
      return fail("O ponto causal de abertura contém item divergente.", "timeline.points[0].items");
    }
  }
  if (!referencesEqual(
    firstPoint.references,
    firstPoint.items.map((item: NormalizedSpendableForecastItem) => item.referenceId),
  )) {
    return fail("As referências da abertura não reconciliam seus itens.", "timeline.points[0].references");
  }
  const allTimelineReferences = new Set(timelineSignatures.keys());
  if (allTimelineReferences.size !== dayReferences.size ||
      [...allTimelineReferences].some((reference) => !dayReferences.has(reference))) {
    return fail("A coleção de itens não reconcilia os dias.", "timeline.items");
  }

  if (timeline.closingProjectedBalanceCents !== projectedBalanceCents) {
    return fail("O fechamento da timeline está inconsistente.", "timeline.closingProjectedBalanceCents");
  }
  const allPoints = timeline.points;
  const minimum = allPoints.reduce(
    (value, point) => point.projectedBalanceCents < value
      ? point.projectedBalanceCents
      : value,
    expectedOpeningProjected,
  );
  if (timeline.minimumProjectedBalanceCents !== minimum) {
    return fail("O mínimo da timeline está inconsistente.", "timeline.minimumProjectedBalanceCents");
  }
  const minimumPoints = allPoints.filter(({ projectedBalanceCents }) => projectedBalanceCents === minimum);
  const minimumDay = minimumPoints.find((point) => point.kind === "DAY_CLOSE");
  const minimumOn = timeline.minimumProjectedOn;
  if (minimumDay === undefined) {
    if (minimumOn !== null) {
      return fail("A data do mínimo está inconsistente.", "timeline.minimumProjectedOn");
    }
  } else if (
    !(minimumOn instanceof Temporal.PlainDate) ||
    !sameDate(minimumDay.date, minimumOn)
  ) {
    return fail("A data do mínimo está inconsistente.", "timeline.minimumProjectedOn");
  }
  if (!Array.isArray(timeline.minimumBalanceReferences)) {
    return fail("As referências do mínimo estão ausentes.", "timeline.minimumBalanceReferences");
  }
  const minimumReferences = [...new Set(
    minimumPoints.flatMap(({ references }) => references),
  )].sort(compareStrings);
  if (!referencesEqual(timeline.minimumBalanceReferences, minimumReferences)) {
    return fail("As referências do mínimo estão inconsistentes.", "timeline.minimumBalanceReferences");
  }

  return {
    opening: opening.sort((left, right) => compareStrings(left.referenceId, right.referenceId)),
    inRange: inRange.sort((left, right) => {
      let comparison = compareSpendableDates(left.date, right.date);
      if (comparison !== 0) return comparison;
      comparison = compareStrings(left.referenceId, right.referenceId);
      if (comparison !== 0) return comparison;
      return compareStrings(left.direction, right.direction);
    }),
  };
}

function referencesEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (!left.every((reference) => typeof reference === "string") ||
      !right.every((reference) => typeof reference === "string")) {
    return false;
  }
  const leftSorted = [...left].sort(compareStrings);
  const rightSorted = [...right].sort(compareStrings);
  return leftSorted.length === new Set(leftSorted).size &&
    rightSorted.length === new Set(rightSorted).size &&
    leftSorted.length === rightSorted.length &&
    leftSorted.every((reference, index) => reference === rightSorted[index]);
}

function isNormalizedForecastItem(
  value: unknown,
): value is NormalizedSpendableForecastItem {
  if (!isRecord(value) || !(value.date instanceof Temporal.PlainDate)) return false;
  if (typeof value.amountCents !== "bigint" || value.amountCents <= ZERO) return false;
  if (typeof value.referenceId !== "string" || typeof value.direction !== "string") return false;
  if (typeof value.status !== "string" || typeof value.certainty !== "string") return false;
  if (!isRecord(value.source) || typeof value.source.referenceId !== "string") return false;
  if (value.source.referenceId !== value.referenceId) return false;
  try {
    normalizeSpendableForecastItem(
      serializedForecastItem(value as unknown as NormalizedSpendableForecastItem),
    );
    return true;
  } catch {
    return false;
  }
}

function calculateFromTimeline(
  timeline: NormalizedSpendableTimeline,
  range: ResolvedRange,
  buffer: NormalizedBuffer,
  reserve: NormalizedReserve,
  causalPage?: SpendableCausalPageInput,
): SpendableBreakdown {
  const sourceItems = normalizedItemsFromTimeline(timeline, range.from, range.to);
  const reserveItems = reserveCausalItems(reserve);
  const openingItems = causalItemsForPoint(sourceItems.opening, reserveItems);
  const openingBalanceCents = timeline.openingBalanceCents;
  const openingAdjustmentsCents =
    timeline.openingAdjustmentsCents + reserve.appliedOpeningAdjustmentCents;
  const openingProjectedBalanceCents = openingBalanceCents + openingAdjustmentsCents;

  const openingPoint = causalPoint(
    "OPENING",
    range.asOf,
    openingProjectedBalanceCents,
    openingItems,
  );

  const grouped = new Map<string, NormalizedSpendableForecastItem[]>();
  for (const item of sourceItems.inRange) {
    const key = item.date.toString();
    const existing = grouped.get(key);
    if (existing) existing.push(item);
    else grouped.set(key, [item]);
  }

  let projectedBalanceCents = openingProjectedBalanceCents;
  const dayPoints: SpendableCausalPoint[] = [];
  for (const [dateString, items] of [...grouped.entries()].sort(([left], [right]) =>
    compareStrings(left, right),
  )) {
    const date = parseSpendableDate(dateString, "timeline.days.date");
    let inflowCents = ZERO;
    let outflowCents = ZERO;
    for (const item of items) {
      if (item.direction === "INFLOW") inflowCents += item.amountCents;
      else outflowCents += item.amountCents;
    }
    const netCents = inflowCents - outflowCents;
    const closingProjectedBalanceCents = projectedBalanceCents + netCents;
    projectedBalanceCents = closingProjectedBalanceCents;
    const pointItems = causalItemsForPoint(items);
    dayPoints.push(causalPoint("DAY_CLOSE", date, closingProjectedBalanceCents, pointItems));
  }

  const allPoints = [openingPoint, ...dayPoints].sort(pointCompare);
  const minimumProjectedBalanceCents = allPoints.reduce(
    (minimum, point) => {
      const balance = BigInt(point.projectedBalanceCents);
      return balance < minimum ? balance : minimum;
    },
    openingProjectedBalanceCents,
  );
  const minimumPoints = allPoints.filter(
    ({ projectedBalanceCents: balance }) => BigInt(balance) === minimumProjectedBalanceCents,
  );
  const pagedMinimum = paginateSpendableCausalPoints(minimumPoints, causalPage);

  const operationalBufferCents = BigInt(buffer.amountCents);
  const rawSpendableCents = minimumProjectedBalanceCents - operationalBufferCents;
  const displaySpendableCents = rawSpendableCents > ZERO ? rawSpendableCents : ZERO;
  const deficitToPreserveReserveCents = rawSpendableCents < ZERO
    ? -rawSpendableCents
    : ZERO;

  const result: SpendableBreakdown = {
    contractVersion: SPENDABLE_CONTRACT_VERSION,
    ruleVersion: SPENDABLE_RULE_VERSION,
    period: {
      asOf: range.asOf.toString(),
      from: range.from.toString(),
      to: range.to.toString(),
      horizonDays: range.horizonDays,
      scenario: timeline.scenario,
      forecastContractVersion: FORECAST_CONTRACT_VERSION,
    },
    openingBalanceCents: openingBalanceCents.toString(10),
    openingAdjustmentsCents: openingAdjustmentsCents.toString(10),
    openingProjectedBalanceCents: openingProjectedBalanceCents.toString(10),
    closingProjectedBalanceCents: projectedBalanceCents.toString(10),
    minimumProjectedBalanceCents: minimumProjectedBalanceCents.toString(10),
    minimum: {
      projectedBalanceCents: minimumProjectedBalanceCents.toString(10),
      points: pagedMinimum.points.map((point) => ({
        kind: point.kind,
        date: point.date,
        projectedBalanceCents: point.projectedBalanceCents,
        references: [...point.references],
        items: point.items.map((item) => ({ ...item })),
      })),
      causalItems: pagedMinimum.pageInfo,
    },
    operationalBuffer: buffer,
    reserve: {
      contractVersion: reserve.contractVersion,
      status: reserve.status,
      protectedCents: reserve.protectedCents.toString(10),
      appliedOpeningAdjustmentCents: reserve.appliedOpeningAdjustmentCents.toString(10),
      components: reserve.components.map(serializeReserveComponent),
    },
    rawSpendableCents: rawSpendableCents.toString(10),
    displaySpendableCents: displaySpendableCents.toString(10),
    deficitToPreserveReserveCents: deficitToPreserveReserveCents.toString(10),
  };

  return parseSpendableBreakdown(result);
}

/**
 * Calculates S08 spendable from a normalized timeline.  The replay is
 * deterministic: all rows of a civil day are netted before the projected
 * balance changes, and ties retain every causal point.
 */
export function SpendableEngine(input: SpendableEngineInput): SpendableBreakdown;
export function SpendableEngine(
  timeline: NormalizedSpendableTimeline,
  operationalBuffer: SpendableBufferInput,
  reserve: SpendableReserveInput,
): SpendableBreakdown;
export function SpendableEngine(
  items: readonly SpendableEngineItem[],
  openingBalanceCents: SpendableCentsInput,
  range: SpendableEngineRangeInput,
  scenario: SpendableScenario,
  operationalBuffer: SpendableBufferInput,
  reserve: SpendableReserveInput,
): SpendableBreakdown;
export function SpendableEngine(
  first: SpendableEngineInput | NormalizedSpendableTimeline | readonly SpendableEngineItem[],
  second?: SpendableBufferInput | SpendableCentsInput,
  third?: SpendableReserveInput | SpendableEngineRangeInput,
  fourth?: SpendableScenario,
  fifth?: SpendableBufferInput,
  sixth?: SpendableReserveInput,
): SpendableBreakdown {
  let input: SpendableEngineInput;
  if (Array.isArray(first)) {
    input = {
      items: first,
      openingBalanceCents: second as SpendableCentsInput,
      range: third as SpendableEngineRangeInput,
      scenario: fourth,
      operationalBuffer: fifth,
      reserve: sixth,
    };
  } else if (normalizedTimeline(first) && second !== undefined && third !== undefined) {
    input = {
      normalizedTimeline: first,
      operationalBuffer: second as SpendableBufferInput,
      reserve: third as SpendableReserveInput,
    };
  } else {
    if (!isRecord(first)) return fail("Entrada do engine inválida.", "input");
    input = first as SpendableEngineInput;
  }

  const source = input.normalizedTimeline ?? input.timeline ?? input.forecast;
  const resolved = resolveTimeline(input);
  const buffer = normalizeBuffer(input.operationalBuffer ?? input.buffer);
  const reserve = normalizeReserve(input.reserve);
  const causalPage = resolveCausalPage(input);
  // `resolveTimeline` validates the source range and scenario; source is kept
  // above only to make that invariant explicit at this boundary.
  void source;
  return calculateFromTimeline(
    resolved.timeline,
    resolved.range,
    buffer,
    reserve,
    causalPage,
  );
}

export const spendableEngine = SpendableEngine;
export const calculateSpendable = SpendableEngine;
export const calculateSpendableBreakdown = SpendableEngine;
export const buildSpendableBreakdown = SpendableEngine;
export const runSpendableEngine = SpendableEngine;
