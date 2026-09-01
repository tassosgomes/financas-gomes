/**
 * S07 source normalisation and reconciliation.
 *
 * `ForecastTimelineBuilder` is the seam between the persistence readers and
 * the pure `ForecastEngine`.  It knows the source vocabulary (recurrence,
 * planned event, installment and ledger observation), but it deliberately
 * knows nothing about Drizzle.  The source reader can therefore be replaced
 * by deterministic fixtures in unit tests without changing the rules.
 */
import { Temporal } from "@js-temporal/polyfill";

import {
  parseForecastItem,
  type ForecastItem,
  type ForecastReconciliation,
  type ForecastScenario,
  type ForecastSource,
  type ForecastTimeline,
} from "./contracts";
import {
  ForecastEngine,
  type ForecastEngineItem,
  type ForecastDateInput,
} from "./engine";
import type { FinancialContext } from "@/modules/households/contracts";
import {
  generateRecurringOccurrences,
  normalizeRecurringRule,
  parseRecurrenceDate,
  reconcileRecurringOccurrence,
  resolveOccurrenceDate,
  validateOccurrenceKey,
  type HolidayInput,
  type NormalizedRecurringRule,
  type RecurringOccurrence,
  type RecurringOccurrenceItem,
  type RecurringOccurrenceOverride,
  type RecurringRuleInput,
} from "@/modules/recurrences";
import {
  createS07ForecastOperation,
  logS07ForecastOperation,
  reportS07UnexpectedError,
  type S07ForecastOperationOptions,
  type S07ForecastCompletionOptions,
} from "@/modules/observability/s07";
import type {
  ForecastInstallmentReadModel,
  ForecastPlannedEventReadModel,
  ForecastRealizedEventReadModel,
  ForecastRecurringSourceReadModel,
  ForecastSourceBundle,
} from "./sources";

export type ForecastBuilderCentsInput =
  | string
  | bigint
  | { readonly cents: bigint }
  | { readonly toCentsString: () => string };

export interface ForecastDateRangeInput {
  readonly from: ForecastDateInput;
  readonly to: ForecastDateInput;
}

/** Structural event/entry shapes keep the pure builder DB-independent. */
export interface ForecastEventInput {
  readonly id: string;
  readonly householdId?: string | null;
  readonly household_id?: string | null;
  readonly kind?: string;
  readonly status?: string;
  readonly amountCents: ForecastBuilderCentsInput;
  readonly occurredOn?: ForecastDateInput | null;
  readonly description?: string | null;
  readonly installmentId?: string | null;
  readonly plannedEventId?: string | null;
  readonly recurringRuleId?: string | null;
}

export interface ForecastEntryInput {
  readonly id: string;
  readonly householdId?: string | null;
  readonly household_id?: string | null;
  readonly financialEventId?: string;
  readonly installmentId?: string | null;
  readonly amountCents: ForecastBuilderCentsInput;
  readonly status?: string;
  readonly expectedOn?: ForecastDateInput | null;
  readonly postedOn?: ForecastDateInput | null;
}

export interface ForecastRecurringRuleInput extends RecurringRuleInput {
  readonly householdId?: string | null;
  readonly household_id?: string | null;
  readonly description?: string | null;
}

export interface ForecastRecurringOccurrenceInput
  extends Partial<RecurringOccurrenceOverride> {
  readonly id?: string | null;
  readonly householdId?: string | null;
  readonly household_id?: string | null;
  readonly recurringRuleId?: string | null;
  readonly recurring_rule_id?: string | null;
  readonly ruleId?: string | null;
  readonly occurrenceKey?: string;
  readonly occurrence_key?: string;
  readonly expectedOn?: ForecastDateInput | null;
  readonly expected_on?: ForecastDateInput | null;
  readonly amountCents?: ForecastBuilderCentsInput | null;
  readonly amount_cents?: ForecastBuilderCentsInput | null;
  readonly financialEventId?: string | null;
  readonly isPartial?: boolean;
  readonly is_partial?: boolean;
  readonly event?: ForecastEventInput | null;
  readonly realizationEvent?: ForecastEventInput | null;
  readonly entries?: readonly ForecastEntryInput[];
  readonly entry?: ForecastEntryInput | null;
  /** T03's pure reconciled shape is also accepted as a source fixture. */
  readonly items?: readonly RecurringOccurrenceItem[];
  readonly activeItems?: readonly RecurringOccurrenceItem[];
  readonly active?: boolean;
  readonly date?: ForecastDateInput;
  readonly direction?: "INFLOW" | "OUTFLOW";
  readonly status?: "PLANNED" | "EXPECTED" | "POSTED" | "CANCELLED";
  readonly reconciliationKey?: string;
  readonly reconciliation?: ForecastReconciliation | null;
  readonly label?: string | null;
}

export interface ForecastPlannedEventInput {
  readonly id?: string;
  readonly eventId?: string | null;
  readonly householdId?: string | null;
  readonly household_id?: string | null;
  readonly kind?: string;
  readonly direction?: "INFLOW" | "OUTFLOW";
  readonly status?: "PLANNED" | "EXPECTED" | "POSTED" | "CANCELLED" | string;
  readonly amountCents?: ForecastBuilderCentsInput;
  readonly amount_cents?: ForecastBuilderCentsInput;
  readonly expectedOn?: ForecastDateInput | null;
  readonly expected_on?: ForecastDateInput | null;
  readonly description?: string | null;
  readonly label?: string | null;
  readonly includeInConservativeForecast?: boolean;
  readonly include_in_conservative_forecast?: boolean;
  readonly financialEventId?: string | null;
  readonly isPartial?: boolean;
  readonly is_partial?: boolean;
  readonly event?: ForecastEventInput | null;
  readonly realizationEvent?: ForecastEventInput | null;
  readonly entries?: readonly ForecastEntryInput[];
  readonly entry?: ForecastEntryInput | null;
}

export interface ForecastInstallmentInput {
  readonly id?: string;
  readonly installmentId?: string;
  /** S06 statement projections use installmentId/referenceId rather than id. */
  readonly referenceId?: string;
  readonly householdId?: string | null;
  readonly household_id?: string | null;
  readonly financialEventId?: string | null;
  readonly description?: string | null;
  readonly occurredOn?: ForecastDateInput | null;
  readonly amountCents?: ForecastBuilderCentsInput;
  readonly amount_cents?: ForecastBuilderCentsInput;
  readonly status?: "PLANNED" | "POSTED" | "CANCELLED" | string;
  readonly billingCycle?: string;
  readonly billing_cycle?: string;
  readonly billingDueOn?: ForecastDateInput;
  readonly billing_due_on?: ForecastDateInput;
  readonly billingDueOnOverride?: ForecastDateInput | null;
  readonly billing_due_on_override?: ForecastDateInput | null;
  readonly dueOn?: ForecastDateInput | null;
  readonly due_on?: ForecastDateInput | null;
  readonly sequence?: number;
  readonly installmentNumber?: number;
  readonly installment_number?: number;
  readonly installmentStatus?: "PLANNED" | "POSTED" | "CANCELLED" | string;
  readonly installment_status?: "PLANNED" | "POSTED" | "CANCELLED" | string;
  readonly entryId?: string | null;
  readonly entryStatus?: "EXPECTED" | "POSTED" | string;
  readonly entry_status?: "EXPECTED" | "POSTED" | string;
  readonly postedOn?: ForecastDateInput | null;
  readonly posted_on?: ForecastDateInput | null;
  readonly event?: ForecastEventInput | null;
  readonly purchase?: {
    readonly id?: string;
    readonly householdId?: string | null;
    readonly status?: string;
  } | null;
  readonly plan?: {
    readonly id?: string;
    readonly householdId?: string | null;
    readonly installmentCount?: number;
    readonly status?: string;
  } | null;
  readonly entries?: readonly ForecastEntryInput[];
  readonly entry?: ForecastEntryInput | null;
}

export interface ForecastSourceInput {
  readonly householdId?: string;
  readonly range?: ForecastDateRangeInput | { from: string; to: string };
  readonly openingBalanceCents?: ForecastBuilderCentsInput;
  readonly openingBalance?: ForecastBuilderCentsInput | { openingBalanceCents?: ForecastBuilderCentsInput };
  readonly recurringRules?: readonly ForecastRecurringRuleInput[];
  readonly rules?: readonly ForecastRecurringRuleInput[];
  readonly recurringOccurrences?: readonly (ForecastRecurringOccurrenceInput | ForecastRecurringSourceReadModel)[];
  readonly occurrences?: readonly ForecastRecurringOccurrenceInput[];
  readonly recurring?: readonly ForecastRecurringOccurrenceInput[];
  readonly holidays?: readonly HolidayInput[];
  readonly plannedEvents?: readonly (ForecastPlannedEventInput | ForecastPlannedEventReadModel)[];
  readonly planned?: readonly ForecastPlannedEventInput[];
  readonly installments?: readonly (ForecastInstallmentInput | ForecastInstallmentReadModel)[];
  readonly realizedEvents?: readonly (ForecastEventInput | ForecastRealizedEventReadModel)[];
  readonly realized?: readonly ForecastEventInput[];
  readonly sourceBundle?: ForecastSourceInput;
}

export interface ForecastBuilderInput extends ForecastSourceInput {
  readonly context?: FinancialContext;
  readonly from?: ForecastDateInput;
  readonly to?: ForecastDateInput;
  readonly scenario?: ForecastScenario;
  readonly observability?: S07ForecastCompletionOptions &
    Partial<S07ForecastOperationOptions>;
}

export type ForecastTimelineBuilderInput = ForecastBuilderInput | ForecastSourceBundle;

export type ForecastBuilderErrorCode =
  | "INVALID_DATE"
  | "INVALID_DATE_RANGE"
  | "INVALID_AMOUNT"
  | "INVALID_ITEM"
  | "FORECAST_INCONSISTENT"
  | "TENANT_RESOURCE_NOT_FOUND";

export class ForecastBuilderError extends Error {
  readonly code: ForecastBuilderErrorCode;
  readonly field: string | null;

  constructor(code: ForecastBuilderErrorCode, message: string, field?: string) {
    super(message);
    this.name = "ForecastBuilderError";
    this.code = code;
    this.field = field ?? null;
  }
}

const ZERO = BigInt(0);
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const INTEGER_PATTERN = /^-?\d+$/u;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;

function fail(code: ForecastBuilderErrorCode, message: string, field?: string): never {
  throw new ForecastBuilderError(code, message, field);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayAt<T>(value: unknown, keys: readonly string[]): readonly T[] {
  for (const key of keys) {
    const candidate = record(value)?.[key];
    if (Array.isArray(candidate)) return candidate as readonly T[];
  }
  return [];
}

function readString(value: unknown, field: string, required = true): string | null {
  if (value === undefined || value === null) {
    if (!required) return null;
    return fail("FORECAST_INCONSISTENT", `${field} é obrigatório.`, field);
  }
  if (typeof value !== "string" || value.trim().length === 0 || CONTROL_OR_FORMAT.test(value)) {
    CONTROL_OR_FORMAT.lastIndex = 0;
    return fail("FORECAST_INCONSISTENT", `${field} é inválido.`, field);
  }
  CONTROL_OR_FORMAT.lastIndex = 0;
  return value.trim();
}

function dateString(value: unknown, field: string): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return fail("INVALID_DATE", `${field} deve usar YYYY-MM-DD.`, field);
  }
  try {
    return parseRecurrenceDate(value, field).toString();
  } catch {
    return fail("INVALID_DATE", `${field} deve ser uma data válida.`, field);
  }
}

function dateValue(value: ForecastDateInput, field: string): Temporal.PlainDate {
  if (value instanceof Temporal.PlainDate) return value;
  return parseRecurrenceDate(dateString(value, field), field);
}

function normalizeRange(input: ForecastBuilderInput | ForecastSourceBundle): {
  from: Temporal.PlainDate;
  to: Temporal.PlainDate;
  fromString: string;
  toString: string;
} {
  const source = input as ForecastBuilderInput;
  const nested = record(source.sourceBundle);
  const sourceRange = record(source.range) ?? record(nested?.range);
  const from = source.from ?? sourceRange?.from;
  const to = source.to ?? sourceRange?.to;
  if (from === undefined || to === undefined) {
    return fail("INVALID_DATE_RANGE", "O builder exige from e to.", "range");
  }
  const parsedFrom = dateValue(from as ForecastDateInput, "from");
  const parsedTo = dateValue(to as ForecastDateInput, "to");
  if (Temporal.PlainDate.compare(parsedFrom, parsedTo) > 0) {
    return fail("INVALID_DATE_RANGE", "from deve ser igual ou anterior a to.", "from");
  }
  return {
    from: parsedFrom,
    to: parsedTo,
    fromString: parsedFrom.toString(),
    toString: parsedTo.toString(),
  };
}

function positiveCents(value: unknown, field: string): string {
  let candidate: string | bigint | undefined;
  if (typeof value === "bigint") candidate = value;
  else if (typeof value === "string") candidate = value;
  else if (record(value)) {
    const cents = (value as { cents?: unknown }).cents;
    if (typeof cents === "bigint") candidate = cents;
    else {
      const toCentsString = (value as { toCentsString?: unknown }).toCentsString;
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
    if (candidate <= ZERO) return fail("INVALID_AMOUNT", "Centavos devem ser positivos.", field);
    return candidate.toString(10);
  }
  if (typeof candidate !== "string" || !/^\d+$/u.test(candidate)) {
    return fail("INVALID_AMOUNT", "Centavos devem ser um inteiro positivo.", field);
  }
  try {
    const parsed = BigInt(candidate);
    if (parsed <= ZERO) return fail("INVALID_AMOUNT", "Centavos devem ser positivos.", field);
    return parsed.toString(10);
  } catch {
    return fail("INVALID_AMOUNT", "Centavos devem ser um inteiro positivo.", field);
  }
}

function signedCents(value: unknown, field: string): bigint {
  let candidate: string | bigint | undefined;
  if (typeof value === "bigint") candidate = value;
  else if (typeof value === "string") candidate = value;
  else if (record(value) && typeof (value as { cents?: unknown }).cents === "bigint") {
    candidate = (value as { cents: bigint }).cents;
  }
  if (typeof candidate === "bigint") return candidate;
  if (typeof candidate !== "string" || !INTEGER_PATTERN.test(candidate)) {
    return fail("INVALID_AMOUNT", "Centavos devem ser um inteiro.", field);
  }
  try {
    return BigInt(candidate);
  } catch {
    return fail("INVALID_AMOUNT", "Centavos devem ser um inteiro.", field);
  }
}

function reference(value: unknown, field: string): string {
  return readString(value, field) as string;
}

function safeLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.normalize("NFKC").replace(CONTROL_OR_FORMAT, " ").replace(/\s+/gu, " ").trim();
  CONTROL_OR_FORMAT.lastIndex = 0;
  return normalized.slice(0, 240) || fallback;
}

function household(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return reference(value, field);
}

function householdValue(value: unknown): string | null {
  const input = record(value);
  return household(input?.householdId ?? input?.household_id, "householdId");
}

function assertHousehold(
  target: Set<string>,
  value: unknown,
  context: FinancialContext | undefined,
): void {
  const actual = householdValue(value);
  if (actual) target.add(actual);
  if (actual && context && actual !== context.householdId) {
    return fail("TENANT_RESOURCE_NOT_FOUND", "Recurso não encontrado.", "householdId");
  }
}

function sourceRoot(input: ForecastBuilderInput | ForecastSourceBundle): Record<string, unknown> {
  const candidate = record(input) ?? {};
  const nested = record(candidate.sourceBundle);
  return nested ? { ...nested, ...candidate } : candidate;
}

function sourceArray<T>(root: Record<string, unknown>, keys: readonly string[]): readonly T[] {
  return arrayAt<T>(root, keys);
}

function includeFlag(value: unknown, fallback = true): boolean {
  const input = record(value);
  const candidates = [
    input?.includeInConservativeForecast,
    input?.include_in_conservative_forecast,
  ];
  let selected: boolean | undefined;
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    if (typeof candidate !== "boolean") {
      return fail("FORECAST_INCONSISTENT", "Flag de cenário inválida.", "includeInConservativeForecast");
    }
    if (selected !== undefined && selected !== candidate) {
      return fail("FORECAST_INCONSISTENT", "Flags de cenário conflitantes.", "includeInConservativeForecast");
    }
    selected = candidate;
  }
  return selected ?? fallback;
}

function directionOf(value: unknown, field: string): "INFLOW" | "OUTFLOW" {
  const input = record(value);
  const explicitValues = [
    input?.direction,
    input?.flowDirection,
    input?.flow_direction,
  ].filter((candidate) => candidate !== undefined);
  let explicit: unknown;
  for (const candidate of explicitValues) {
    if (candidate !== "INFLOW" && candidate !== "OUTFLOW") {
      return fail("FORECAST_INCONSISTENT", "Direção inválida.", field);
    }
    if (explicit !== undefined && explicit !== candidate) {
      return fail("FORECAST_INCONSISTENT", "Direções conflitantes.", field);
    }
    explicit = candidate;
  }
  const kind = input?.kind;
  const fromKind = kind === "INCOME" ? "INFLOW" : kind === "EXPENSE" ? "OUTFLOW" : undefined;
  if (explicit && fromKind && explicit !== fromKind) {
    return fail("FORECAST_INCONSISTENT", "Direção e tipo divergentes.", field);
  }
  const result = explicit ?? fromKind;
  if (result !== "INFLOW" && result !== "OUTFLOW") {
    return fail("FORECAST_INCONSISTENT", "Direção obrigatória.", field);
  }
  return result;
}

function statusOf(value: unknown, field: string): "PLANNED" | "EXPECTED" | "POSTED" | "CANCELLED" {
  const status = record(value)?.status;
  if (status !== "PLANNED" && status !== "EXPECTED" && status !== "POSTED" && status !== "CANCELLED") {
    return fail("FORECAST_INCONSISTENT", "Estado de forecast inválido.", field);
  }
  return status;
}

function entriesOf(value: unknown): readonly ForecastEntryInput[] {
  const input = record(value);
  const entries = input?.entries;
  if (Array.isArray(entries)) return entries as readonly ForecastEntryInput[];
  if (input?.entry && typeof input.entry === "object") return [input.entry as ForecastEntryInput];
  return [];
}

function eventOf(value: unknown): ForecastEventInput | null {
  const input = record(value);
  const event = input?.event ?? input?.realizationEvent;
  return event && typeof event === "object" ? (event as ForecastEventInput) : null;
}

/** Checks relationship rows as well as the source root before any mapping. */
function assertSourceRelationships(
  target: Set<string>,
  value: unknown,
  context: FinancialContext | undefined,
): void {
  assertHousehold(target, value, context);
  const input = record(value);
  const event = eventOf(value);
  if (event) assertHousehold(target, event, context);
  for (const entry of entriesOf(value)) assertHousehold(target, entry, context);
  for (const key of ["rule", "purchase", "plan"] as const) {
    const related = input?.[key];
    if (related && typeof related === "object") assertHousehold(target, related, context);
  }
}

function postedEntry(
  event: ForecastEventInput,
  entries: readonly ForecastEntryInput[],
  field: string,
): { entry: ForecastEntryInput; amountCents: string; date: string } {
  if (event.status !== undefined && event.status !== "POSTED") {
    return fail("FORECAST_INCONSISTENT", "Realização não está POSTED.", `${field}.event.status`);
  }
  const posted = entries.filter((entry) => entry.status === undefined || entry.status === "POSTED");
  if (posted.length !== 1 || entries.some((entry) => entry.status !== undefined && entry.status !== "POSTED")) {
    return fail("FORECAST_INCONSISTENT", "Uma realização deve possuir exatamente um entry POSTED.", `${field}.entries`);
  }
  const entry = posted[0];
  if (
    entry.financialEventId !== undefined &&
    entry.financialEventId !== event.id
  ) {
    return fail("FORECAST_INCONSISTENT", "Entry aponta para fato divergente.", `${field}.entries.financialEventId`);
  }
  if (
    event.householdId !== undefined &&
    event.householdId !== null &&
    entry.householdId !== undefined &&
    entry.householdId !== null &&
    event.householdId !== entry.householdId
  ) {
    return fail("TENANT_RESOURCE_NOT_FOUND", "Recurso não encontrado.", `${field}.entries.householdId`);
  }
  const postedOn = entry.postedOn;
  if (postedOn === undefined || postedOn === null) {
    return fail("FORECAST_INCONSISTENT", "Entry POSTED sem postedOn.", `${field}.entries`);
  }
  const amount = positiveCents(event.amountCents, `${field}.event.amountCents`);
  const entryAmount = signedCents(entry.amountCents, `${field}.entries.amountCents`);
  if (entryAmount === ZERO || (entryAmount < ZERO ? -entryAmount : entryAmount) !== BigInt(amount)) {
    return fail("FORECAST_INCONSISTENT", "Entry e evento possuem valores divergentes.", `${field}.entries.amountCents`);
  }
  return { entry, amountCents: amount, date: dateString(postedOn, `${field}.entries.postedOn`) };
}

function projectedStatusAndCertainty(
  status: "PLANNED" | "EXPECTED",
  direction: "INFLOW" | "OUTFLOW",
): { status: "PLANNED" | "EXPECTED"; certainty: "COMMITTED" | "EXPECTED" } {
  return {
    status,
    certainty: status === "EXPECTED" && direction === "INFLOW" ? "EXPECTED" : "COMMITTED",
  };
}

function itemSource(
  kind: ForecastSource["kind"],
  referenceId: string,
  label: string,
  extra: Partial<ForecastSource> = {},
): ForecastSource {
  return { kind, referenceId, label, ...extra };
}

interface InternalForecastItem {
  item: ForecastItem;
  includeInConservativeForecast: boolean;
  logicalKey: string;
  role: "PROJECTED" | "REALIZED" | "REMAINING";
}

function makeItem(
  candidate: Omit<ForecastItem, "amountCents"> & { amountCents: string },
): ForecastItem {
  try {
    return parseForecastItem(candidate);
  } catch {
    return fail("FORECAST_INCONSISTENT", "Item de forecast inválido.", "item");
  }
}

function addItem(
  items: InternalForecastItem[],
  seen: Map<string, Set<string>>,
  value: InternalForecastItem,
): void {
  const roles = seen.get(value.logicalKey) ?? new Set<string>();
  if (roles.has(value.role)) {
    return fail("FORECAST_INCONSISTENT", "Duas fontes ativas compartilham a mesma chave.", "referenceId");
  }
  // A reconciled source is represented by REALIZED + REMAINING, never by a
  // third projected copy of the original amount.
  if (value.role === "PROJECTED" && (roles.has("REALIZED") || roles.has("REMAINING"))) {
    return fail("FORECAST_INCONSISTENT", "Previsão e realização não foram reconciliadas.", "referenceId");
  }
  if (value.role !== "PROJECTED" && roles.has("PROJECTED")) {
    return fail("FORECAST_INCONSISTENT", "Previsão e realização não foram reconciliadas.", "referenceId");
  }
  roles.add(value.role);
  seen.set(value.logicalKey, roles);
  items.push(value);
}

function compareCents(left: string, right: string): number {
  const l = BigInt(left);
  const r = BigInt(right);
  return l < r ? -1 : l > r ? 1 : 0;
}

function compareInternal(left: InternalForecastItem, right: InternalForecastItem): number {
  const a = left.item;
  const b = right.item;
  const statusOrder = { POSTED: 0, PLANNED: 1, EXPECTED: 2 } as const;
  return a.date.localeCompare(b.date) ||
    statusOrder[a.status] - statusOrder[b.status] ||
    a.source.kind.localeCompare(b.source.kind) ||
    a.source.referenceId.localeCompare(b.source.referenceId) ||
    (a.source.recurringRuleId ?? "").localeCompare(b.source.recurringRuleId ?? "") ||
    (a.source.occurrenceKey ?? "").localeCompare(b.source.occurrenceKey ?? "") ||
    (a.source.billingCycle ?? "").localeCompare(b.source.billingCycle ?? "") ||
    (a.source.installmentSequence ?? 0) - (b.source.installmentSequence ?? 0) ||
    a.direction.localeCompare(b.direction) ||
    a.certainty.localeCompare(b.certainty) ||
    compareCents(a.amountCents, b.amountCents) ||
    (a.reconciliation?.key ?? "").localeCompare(b.reconciliation?.key ?? "") ||
    (a.reconciliation?.replacesReferenceId ?? "").localeCompare(b.reconciliation?.replacesReferenceId ?? "");
}

function normalizedReconciliation(value: unknown): ForecastReconciliation | null {
  if (value === null || value === undefined) return null;
  const input = record(value);
  if (!input) return fail("FORECAST_INCONSISTENT", "Reconciliação inválida.", "reconciliation");
  const key = reference(input.key, "reconciliation.key");
  const referenceValue = input.replacesReferenceId;
  if (referenceValue !== null && referenceValue !== undefined && typeof referenceValue !== "string") {
    return fail("FORECAST_INCONSISTENT", "Referência de reconciliação inválida.", "reconciliation.replacesReferenceId");
  }
  const optionalAmount = (candidate: unknown, field: string): string | null => {
    if (candidate === null || candidate === undefined) return null;
    return signedCents(candidate, field).toString(10);
  };
  return {
    key,
    replacesReferenceId: referenceValue === undefined ? null : referenceValue as string | null,
    plannedAmountCents: optionalAmount(input.plannedAmountCents, "reconciliation.plannedAmountCents"),
    realizedAmountCents: optionalAmount(input.realizedAmountCents, "reconciliation.realizedAmountCents"),
    remainingAmountCents: optionalAmount(input.remainingAmountCents, "reconciliation.remainingAmountCents"),
    varianceAmountCents: optionalAmount(input.varianceAmountCents, "reconciliation.varianceAmountCents"),
  };
}

function occurrenceOverride(
  row: ForecastRecurringOccurrenceInput,
  rule: NormalizedRecurringRule,
  event: ForecastEventInput | null,
  entries: readonly ForecastEntryInput[],
): RecurringOccurrenceOverride {
  const input = row as Record<string, unknown>;
  const key = input.occurrenceKey ?? input.occurrence_key;
  const ruleId = rule.id ?? (input.ruleId as string | null | undefined) ?? (input.recurringRuleId as string | null | undefined);
  const householdId = input.householdId ?? input.household_id ?? rule.householdId;
  const rawDate = input.expectedOn ?? input.expected_on ?? input.overrideDate ?? input.override_date;
  const rawAmount = input.amountCents ?? input.amount_cents ?? input.overrideAmountCents ?? input.override_amount_cents;
  const status = input.status as "PLANNED" | "EXPECTED" | "POSTED" | "CANCELLED" | undefined;
  const realizationId = input.financialEventId ?? event?.id;
  let realization: RecurringOccurrenceOverride["realization"] = null;
  if (status === "POSTED" || realizationId !== undefined && realizationId !== null || event !== null) {
    if (!event) return fail("FORECAST_INCONSISTENT", "Ocorrência realizada sem evento.", "recurringOccurrences");
    const posted = postedEntry(event, entries, "recurringOccurrences");
    if (realizationId !== undefined && realizationId !== null && realizationId !== event.id) {
      return fail("FORECAST_INCONSISTENT", "Evento de realização divergente.", "financialEventId");
    }
    realization = {
      financialEventId: event.id,
      amountCents: posted.amountCents,
      postedOn: posted.date,
      status: "POSTED",
      partial: Boolean(input.isPartial ?? input.is_partial ?? false),
    };
  }
  const output: RecurringOccurrenceOverride = {
    occurrenceKey: key as string,
    recurringRuleId: ruleId,
    ruleId,
    householdId: householdId as string | null,
    overrideDate:
      rawDate === undefined || rawDate === null
        ? null
        : dateString(rawDate, "recurringOccurrences.expectedOn"),
    overrideAmountCents:
      rawAmount === undefined || rawAmount === null
        ? null
        : positiveCents(rawAmount, "recurringOccurrences.amountCents"),
    status,
    realization,
  };
  return output;
}

function recurringReference(
  rule: NormalizedRecurringRule,
  row: ForecastRecurringOccurrenceInput | null,
  key: string,
): string {
  const rowId = row ? record(row)?.id : undefined;
  return reference(rowId ?? rule.id ?? `${rule.id ?? "recurring"}:${key}`, "recurringReference");
}

function recurringSourceLabel(
  rule: NormalizedRecurringRule,
  row: ForecastRecurringOccurrenceInput | null,
): string {
  const rowInput = record(row);
  return safeLabel(rowInput?.label ?? rowInput?.description ?? rule.label, "Recorrência");
}

function recurringInputRows(root: Record<string, unknown>): readonly ForecastRecurringOccurrenceInput[] {
  const raw = sourceArray<ForecastRecurringOccurrenceInput | ForecastRecurringSourceReadModel>(
    root,
    ["recurringOccurrences", "occurrences", "recurring"],
  );
  return raw.map((value) => {
    const wrapped = record(value);
    if (wrapped && wrapped.occurrence && typeof wrapped.occurrence === "object") {
      const occurrence = wrapped.occurrence as ForecastRecurringOccurrenceInput;
      return {
        ...occurrence,
        rule: wrapped.rule,
        event: wrapped.event,
        entries: wrapped.entries,
      } as ForecastRecurringOccurrenceInput;
    }
    return value as ForecastRecurringOccurrenceInput;
  });
}

function recurringRuleInputRows(root: Record<string, unknown>): readonly ForecastRecurringRuleInput[] {
  const raw = sourceArray<ForecastRecurringRuleInput>(root, ["recurringRules", "rules"]);
  return raw.map((value) => {
    const wrapped = record(value);
    if (wrapped?.rule && typeof wrapped.rule === "object") return wrapped.rule as ForecastRecurringRuleInput;
    return value;
  });
}

function directRecurringItems(
  row: ForecastRecurringOccurrenceInput,
  items: InternalForecastItem[],
  seen: Map<string, Set<string>>,
  claimedEvents: Map<string, string>,
  context: FinancialContext | undefined,
  households: Set<string>,
): boolean {
  const input = record(row);
  const directItems = Array.isArray(input?.activeItems)
    ? input.activeItems
    : Array.isArray(input?.items)
      ? input.items
      : null;
  if (!directItems) return false;
  assertHousehold(households, row, context);
  if (input?.active === false) return true;
  for (const rawItem of directItems as readonly RecurringOccurrenceItem[]) {
    assertHousehold(households, rawItem, context);
    const item = record(rawItem);
    if (!item) return fail("FORECAST_INCONSISTENT", "Item de ocorrência inválido.", "occurrences.items");
    const key = reference(item.occurrenceKey, "occurrences.occurrenceKey");
    const ruleId = item.ruleId === null || item.ruleId === undefined ? null : reference(item.ruleId, "occurrences.ruleId");
    const sourceRef = recurringReference(
      { id: ruleId, householdId: householdValue(row), frequency: "MONTHLY", dayRule: "FIXED_DAY", dayOfMonth: 1, monthOfYear: null, amountCents: "1", direction: item.direction as "INFLOW" | "OUTFLOW", startOn: Temporal.PlainDate.from("0000-01-01"), endOn: null, includeInConservativeForecast: item.includeInConservativeForecast !== false, status: "ACTIVE", label: item.label as string | null } as NormalizedRecurringRule,
      row,
      key,
    );
    const status = item.status;
    if (status !== "PLANNED" && status !== "EXPECTED" && status !== "POSTED") {
      return fail("FORECAST_INCONSISTENT", "Estado de ocorrência inválido.", "occurrences.items.status");
    }
    const direction = directionOf(item, "occurrences.items.direction");
    const itemReconciliation = normalizedReconciliation(item.reconciliation);
    const normalized = makeItem({
      date: dateString(item.date, "occurrences.items.date"),
      amountCents: positiveCents(item.amountCents, "occurrences.items.amountCents"),
      direction,
      status,
      certainty: status === "POSTED" ? "REALIZED" : projectedStatusAndCertainty(status, direction).certainty,
      source: itemSource("RECURRING", sourceRef, safeLabel(item.label, "Recorrência"), {
        ...(ruleId ? { recurringRuleId: ruleId } : {}),
        occurrenceKey: key,
      }),
      referenceId: sourceRef,
      reconciliation: itemReconciliation,
    });
    addItem(items, seen, {
      item: normalized,
      includeInConservativeForecast: item.includeInConservativeForecast !== false,
      logicalKey: `RECURRING:${ruleId ?? ""}:${key}`,
      role: item.role === "REALIZED" ? "REALIZED" : item.role === "REMAINING" ? "REMAINING" : "PROJECTED",
    });
    if (item.role === "REALIZED" && typeof item.realizationId === "string") {
      claimRealization(
        claimedEvents,
        item.realizationId,
        `RECURRING:${ruleId ?? ""}:${key}`,
      );
    }
  }
  return true;
}

function recurringOccurrenceFromKey(
  rule: NormalizedRecurringRule,
  key: string,
  holidays: readonly HolidayInput[],
  status: "PLANNED" | "EXPECTED",
): RecurringOccurrence {
  validateOccurrenceKey(rule, key);
  const period: string = rule.frequency === "MONTHLY" ? `${key}-01` : `${key}-01-01`;
  const date = resolveOccurrenceDate(rule, period, { holidays, householdId: rule.householdId });
  return {
    ruleId: rule.id,
    householdId: rule.householdId,
    occurrenceKey: key,
    key,
    date: date.toString(),
    amountCents: rule.amountCents,
    direction: rule.direction,
    status,
    includeInConservativeForecast: rule.includeInConservativeForecast,
    label: rule.label,
    reconciliationKey: `${rule.id ?? "unidentified-rule"}:${key}`,
  };
}

function recurringRulesForBuilder(
  root: Record<string, unknown>,
  context: FinancialContext | undefined,
  households: Set<string>,
): readonly NormalizedRecurringRule[] {
  const normalized: NormalizedRecurringRule[] = [];
  for (const raw of recurringRuleInputRows(root)) {
    assertHousehold(households, raw, context);
    const candidate: RecurringRuleInput = {
      ...raw,
      // T02 stores the display text in `description`, while the pure T03
      // contract calls it `label`.
      label: raw.label ?? raw.description ?? null,
      amountCents: raw.amountCents ?? raw.amount_cents,
      startOn: raw.startOn ?? raw.start_on,
      endOn: raw.endOn ?? raw.end_on,
      dayRule: raw.dayRule ?? raw.day_rule,
      dayOfMonth: raw.dayOfMonth ?? raw.day_of_month,
      includeInConservativeForecast:
        includeFlag(raw, true),
      // The database calls the direction `kind`.
      direction:
        raw.direction ??
        (raw.kind === "INCOME" ? "INFLOW" : raw.kind === "EXPENSE" ? "OUTFLOW" : undefined),
    };
    try {
      normalized.push(normalizeRecurringRule(candidate));
    } catch (error) {
      if (error instanceof ForecastBuilderError) throw error;
      return fail("FORECAST_INCONSISTENT", "Regra de recorrência inválida.", "recurringRules");
    }
  }
  const byId = new Map<string, NormalizedRecurringRule>();
  for (const rule of normalized) {
    const key = rule.id ?? `${rule.frequency}:${rule.startOn.toString()}:${rule.direction}`;
    if (byId.has(key)) return fail("FORECAST_INCONSISTENT", "Regras recorrentes duplicadas.", "recurringRuleId");
    byId.set(key, rule);
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.startOn.toString().localeCompare(right.startOn.toString()) ||
      (left.id ?? "").localeCompare(right.id ?? ""),
  );
}

function recurringOccurrencesForBuilder(
  root: Record<string, unknown>,
  context: FinancialContext | undefined,
  households: Set<string>,
): readonly ForecastRecurringOccurrenceInput[] {
  const rows = recurringInputRows(root);
  for (const row of rows) assertHousehold(households, row, context);
  return [...rows].sort((left, right) => {
    const a = record(left);
    const b = record(right);
    return String(a?.occurrenceKey ?? a?.occurrence_key ?? "").localeCompare(
      String(b?.occurrenceKey ?? b?.occurrence_key ?? ""),
    ) || String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  });
}

function buildRecurringItems(
  root: Record<string, unknown>,
  range: { from: Temporal.PlainDate; to: Temporal.PlainDate },
  context: FinancialContext | undefined,
  households: Set<string>,
  items: InternalForecastItem[],
  seen: Map<string, Set<string>>,
  claimedEvents: Map<string, string>,
): void {
  const rules = recurringRulesForBuilder(root, context, households);
  const rows = recurringOccurrencesForBuilder(root, context, households);
  const holidays = sourceArray<HolidayInput>(root, ["holidays"]);
  const rowByKey = new Map<string, ForecastRecurringOccurrenceInput>();
  const directRows = new Set<ForecastRecurringOccurrenceInput>();
  for (const row of rows) {
    if (directRecurringItems(row, items, seen, claimedEvents, context, households)) {
      directRows.add(row);
      continue;
    }
    const input = record(row);
    const rowRuleId = input?.ruleId ?? input?.recurringRuleId ?? input?.recurring_rule_id ?? record(input?.rule)?.id;
    const key = input?.occurrenceKey ?? input?.occurrence_key;
    if (typeof key !== "string" || key.length === 0) {
      return fail("FORECAST_INCONSISTENT", "Ocorrência exige occurrenceKey.", "occurrenceKey");
    }
    if (rowRuleId !== undefined && rowRuleId !== null) {
      const ruleId = reference(rowRuleId, "recurringRuleId");
      const mapKey = `${ruleId}:${key}`;
      if (rowByKey.has(mapKey)) return fail("FORECAST_INCONSISTENT", "Ocorrências duplicadas.", "occurrenceKey");
      rowByKey.set(mapKey, row);
    } else {
      // A rule-less pure fixture is supported only when it carries T03's
      // already-normalized item shape; persisted records always have a rule.
      return fail("FORECAST_INCONSISTENT", "Ocorrência sem regra.", "recurringRuleId");
    }
  }

  const ruleById = new Map<string, NormalizedRecurringRule>();
  for (const rule of rules) {
    if (rule.id) ruleById.set(rule.id, rule);
  }

  for (const rule of rules) {
    const ruleId = rule.id ?? `${rule.frequency}:${rule.startOn.toString()}:${rule.direction}`;
    const exceptionRows = rows.filter((row) => !directRows.has(row)).filter((row) => {
      const value = record(row);
      const id = value?.ruleId ?? value?.recurringRuleId ?? value?.recurring_rule_id ?? record(value?.rule)?.id;
      return id === rule.id;
    });
    const generated = new Map<string, RecurringOccurrence>();
    if (rule.status !== "CANCELLED") {
      // Include pre-range virtual occurrences so the engine can place active
      // overdue commitments in openingAdjustments. The upper bound remains
      // the requested `to`, keeping the query boundary finite.
      const generationFrom = Temporal.PlainDate.compare(rule.startOn, range.from) < 0
        ? rule.startOn
        : range.from;
      const occurrences = generateRecurringOccurrences({
        rule,
        from: generationFrom,
        to: range.to,
        holidays,
        householdId: context?.householdId ?? rule.householdId,
      });
      for (const occurrence of occurrences) generated.set(occurrence.occurrenceKey, occurrence);
    }

    const keys = new Set<string>([
      ...generated.keys(),
      ...exceptionRows.map((row) => String(record(row)?.occurrenceKey ?? record(row)?.occurrence_key ?? "")),
    ]);
    for (const key of [...keys].filter(Boolean).sort()) {
      const row = exceptionRows.find((candidate) => {
        const value = record(candidate);
        return String(value?.occurrenceKey ?? value?.occurrence_key ?? "") === key;
      }) ?? null;
      const occurrence = generated.get(key) ?? recurringOccurrenceFromKey(
        rule,
        key,
        holidays,
        (record(row)?.status === "EXPECTED" ? "EXPECTED" : "PLANNED"),
      );
      const rowInput = record(row);
      if (rule.status === "CANCELLED" && rowInput?.status !== "POSTED") continue;
      const event = eventOf(row);
      const entries = entriesOf(row);
      const override = row
        ? occurrenceOverride(row, rule, event, entries)
        : undefined;
      const reconciled = reconcileRecurringOccurrence(occurrence, override);
      const sourceRef = recurringReference(rule, row, key);
      const label = recurringSourceLabel(rule, row);
      for (const occurrenceItem of reconciled.items) {
        const role = occurrenceItem.role === "REALIZED"
          ? "REALIZED"
          : occurrenceItem.role === "REMAINING"
            ? "REMAINING"
            : "PROJECTED";
        const status = occurrenceItem.status;
        const certainty = status === "POSTED"
          ? "REALIZED"
          : projectedStatusAndCertainty(status, occurrenceItem.direction).certainty;
        const source = itemSource("RECURRING", sourceRef, label, {
          ...(rule.id ? { recurringRuleId: rule.id } : {}),
          occurrenceKey: key,
        });
      const reconciliation = reconciled.reconciliation
          ? normalizedReconciliation(reconciled.reconciliation)
          : null;
        // Durable exceptions can be retained outside the requested read
        // window. Keep overdue active commitments for openingAdjustments,
        // but do not leak future rows past `to` into this boundary.
        if (occurrenceItem.date > range.to.toString()) continue;
        const item = makeItem({
          date: dateString(occurrenceItem.date, "recurringOccurrence.date"),
          amountCents: positiveCents(occurrenceItem.amountCents, "recurringOccurrence.amountCents"),
          direction: occurrenceItem.direction,
          status,
          certainty,
          source,
          referenceId: sourceRef,
          reconciliation,
        });
        if (
          item.status === "POSTED" &&
          (item.date < range.from.toString() || item.date > range.to.toString())
        ) continue;
        if (role === "REALIZED") {
          const eventId = occurrenceItem.realizationId;
          if (eventId) claimRealization(claimedEvents, eventId, `RECURRING:${ruleId}:${key}`);
        }
        addItem(items, seen, {
          item,
          includeInConservativeForecast: occurrenceItem.includeInConservativeForecast,
          logicalKey: `RECURRING:${ruleId}:${key}`,
          role,
        });
      }
    }
  }

  // A durable exception pointing at an unknown rule is never silently
  // ignored; this is how malformed/cross-tenant fixtures fail closed.
  for (const row of rows) {
    if (directRows.has(row)) continue;
    const value = record(row);
    const id = value?.ruleId ?? value?.recurringRuleId ?? value?.recurring_rule_id ?? record(value?.rule)?.id;
    if (id !== undefined && id !== null && !ruleById.has(String(id))) {
      return fail("FORECAST_INCONSISTENT", "Ocorrência sem regra autorizada.", "recurringRuleId");
    }
  }
}

function claimRealization(
  claimedEvents: Map<string, string>,
  eventId: string,
  owner: string,
): void {
  const previous = claimedEvents.get(eventId);
  if (previous && previous !== owner) {
    return fail("FORECAST_INCONSISTENT", "O mesmo evento realiza duas fontes.", "financialEventId");
  }
  if (previous === owner) {
    return fail("FORECAST_INCONSISTENT", "Evento de realização duplicado.", "financialEventId");
  }
  claimedEvents.set(eventId, owner);
}

function plannedRows(root: Record<string, unknown>): readonly ForecastPlannedEventInput[] {
  const raw = sourceArray<ForecastPlannedEventInput | ForecastPlannedEventReadModel>(
    root,
    ["plannedEvents", "planned"],
  );
  return raw
    .map((value) => {
      const wrapped = record(value);
      if (wrapped?.plannedEvent && typeof wrapped.plannedEvent === "object") {
        return {
          ...(wrapped.plannedEvent as ForecastPlannedEventInput),
          event: wrapped.event,
          entries: wrapped.entries,
        } as ForecastPlannedEventInput;
      }
      return value as ForecastPlannedEventInput;
    })
    .sort((left, right) => String(record(left)?.id ?? "").localeCompare(String(record(right)?.id ?? "")));
}

function plannedReference(row: ForecastPlannedEventInput): string {
  const input = record(row);
  return reference(input?.id, "plannedEvents.id");
}

function plannedAmount(row: ForecastPlannedEventInput): string {
  const input = record(row);
  return positiveCents(input?.amountCents ?? input?.amount_cents, "plannedEvents.amountCents");
}

function plannedDate(row: ForecastPlannedEventInput): string {
  const input = record(row);
  const value = input?.expectedOn ?? input?.expected_on;
  if (value === undefined || value === null) {
    return fail("FORECAST_INCONSISTENT", "Evento planejado exige expectedOn.", "plannedEvents.expectedOn");
  }
  return dateString(value, "plannedEvents.expectedOn");
}

function plannedReconciliation(
  key: string,
  plannedAmountCents: string,
  realizedAmountCents: string,
  realizedReferenceId: string,
  remainingAmountCents: string | null,
): ForecastReconciliation {
  const variance = BigInt(realizedAmountCents) - BigInt(plannedAmountCents);
  return {
    key,
    replacesReferenceId: realizedReferenceId,
    plannedAmountCents,
    realizedAmountCents,
    remainingAmountCents,
    varianceAmountCents: variance.toString(10),
  };
}

function buildPlannedItems(
  root: Record<string, unknown>,
  range: { from: Temporal.PlainDate; to: Temporal.PlainDate },
  context: FinancialContext | undefined,
  households: Set<string>,
  items: InternalForecastItem[],
  seen: Map<string, Set<string>>,
  claimedEvents: Map<string, string>,
): void {
  const rows = plannedRows(root);
  const duplicateIds = new Set<string>();
  for (const row of rows) {
    assertHousehold(households, row, context);
    const input = record(row);
    const id = plannedReference(row);
    if (duplicateIds.has(id)) return fail("FORECAST_INCONSISTENT", "Eventos planejados duplicados.", "plannedEvents.id");
    duplicateIds.add(id);
    const status = statusOf(row, "plannedEvents.status");
    const direction = directionOf(row, "plannedEvents.direction");
    const amount = plannedAmount(row);
    const includeInConservativeForecast = includeFlag(row, true);
    const label = safeLabel(input?.label ?? input?.description, "Evento planejado");
    const logicalKey = `PLANNED_EVENT:${id}`;

    if (status === "CANCELLED") continue;
    if (status === "POSTED") {
      const event = eventOf(row);
      const eventId = input?.financialEventId ?? input?.eventId ?? event?.id;
      if (!event || eventId === null || eventId === undefined) {
        return fail("FORECAST_INCONSISTENT", "Evento POSTED sem fato relacionado.", "plannedEvents.financialEventId");
      }
      if (event.id !== eventId) return fail("FORECAST_INCONSISTENT", "Fato planejado divergente.", "plannedEvents.financialEventId");
      const posted = postedEntry(event, entriesOf(row), "plannedEvents");
      const eventDirection = directionOf(event, "plannedEvents.event.kind");
      if (eventDirection !== direction) return fail("FORECAST_INCONSISTENT", "Direção do fato planejado divergente.", "plannedEvents.kind");
      claimRealization(claimedEvents, event.id, logicalKey);
      const partial = Boolean(input?.isPartial ?? input?.is_partial ?? false);
      const residualValue = partial && BigInt(amount) > BigInt(posted.amountCents)
        ? (BigInt(amount) - BigInt(posted.amountCents)).toString(10)
        : null;
      const reconciliation = plannedReconciliation(
        id,
        amount,
        posted.amountCents,
        event.id,
        residualValue,
      );
      const realizedItem = makeItem({
        date: posted.date,
        amountCents: posted.amountCents,
        direction,
        status: "POSTED",
        certainty: "REALIZED",
        source: itemSource("PLANNED_EVENT", id, label),
        referenceId: id,
        reconciliation,
      });
      if (
        realizedItem.date < range.from.toString() ||
        realizedItem.date > range.to.toString()
      ) continue;
      addItem(items, seen, {
        item: realizedItem,
        includeInConservativeForecast,
        logicalKey,
        role: "REALIZED",
      });
      if (residualValue !== null) {
        const expectedDate = plannedDate(row);
        if (expectedDate <= range.to.toString()) {
          const projected = makeItem({
            date: expectedDate,
            amountCents: residualValue,
            direction,
            status: "PLANNED",
            certainty: "COMMITTED",
            source: itemSource("PLANNED_EVENT", id, label),
            referenceId: id,
            reconciliation,
          });
          addItem(items, seen, {
            item: projected,
            includeInConservativeForecast,
            logicalKey,
            role: "REMAINING",
          });
        }
      }
      continue;
    }

    if (input?.financialEventId !== undefined && input.financialEventId !== null || eventOf(row) !== null) {
      return fail("FORECAST_INCONSISTENT", "Evento não POSTED não pode possuir fato.", "plannedEvents.financialEventId");
    }
    const date = plannedDate(row);
    if (date > range.to.toString()) continue;
    const projected = projectedStatusAndCertainty(status, direction);
    const item = makeItem({
      date,
      amountCents: amount,
      direction,
      status: projected.status,
      certainty: projected.certainty,
      source: itemSource("PLANNED_EVENT", id, label),
      referenceId: id,
      reconciliation: null,
    });
    addItem(items, seen, {
      item,
      includeInConservativeForecast,
      logicalKey,
      role: "PROJECTED",
    });
  }
}

function installmentRows(root: Record<string, unknown>): readonly ForecastInstallmentInput[] {
  const raw = sourceArray<ForecastInstallmentInput | ForecastInstallmentReadModel>(root, ["installments"]);
  return raw
    .map((value) => {
      const wrapped = record(value);
      if (wrapped?.installment && typeof wrapped.installment === "object") {
        return {
          ...(wrapped.installment as ForecastInstallmentInput),
          purchase: wrapped.purchase,
          plan: wrapped.plan,
          event: wrapped.event,
          entries: wrapped.entries,
        } as ForecastInstallmentInput;
      }
      return value as ForecastInstallmentInput;
    })
    .sort((left, right) => String(record(left)?.id ?? record(left)?.installmentId ?? "").localeCompare(String(record(right)?.id ?? record(right)?.installmentId ?? "")));
}

function installmentReference(row: ForecastInstallmentInput): string {
  const input = record(row);
  return reference(
    input?.id ?? input?.installmentId ?? input?.referenceId,
    "installments.id",
  );
}

function installmentStatusOf(
  row: ForecastInstallmentInput,
): "PLANNED" | "POSTED" | "CANCELLED" {
  const input = record(row);
  return statusOf(
    {
      status: input?.status ?? input?.installmentStatus ?? input?.installment_status,
    },
    "installments.status",
  ) as "PLANNED" | "POSTED" | "CANCELLED";
}

/**
 * S06's statement read model deliberately omits persistence joins.  When a
 * caller hands that model directly to T04, reconstruct only the relationship
 * metadata needed for validation; no date is inferred for a POSTED row.
 */
function installmentEventAndEntries(
  row: ForecastInstallmentInput,
  id: string,
  amount: string,
  status: "PLANNED" | "POSTED" | "CANCELLED",
): { event: ForecastEventInput | null; entries: readonly ForecastEntryInput[] } {
  const input = record(row);
  const existingEvent = eventOf(row);
  const eventId = input?.financialEventId;
  const event = existingEvent ?? (eventId === undefined || eventId === null
    ? null
    : {
        id: reference(eventId, "installments.financialEventId"),
        householdId: householdValue(row),
        kind: "PURCHASE",
        status: status === "POSTED" ? "POSTED" : "PLANNED",
        amountCents: amount,
        description: typeof input?.description === "string" ? input.description : null,
      });
  const existingEntries = entriesOf(row);
  if (existingEntries.length > 0 || !event) {
    return { event, entries: existingEntries };
  }

  const rawEntryStatus = input?.entryStatus ?? input?.entry_status ??
    (status === "POSTED" ? "POSTED" : "EXPECTED");
  if (rawEntryStatus !== "POSTED" && rawEntryStatus !== "EXPECTED") {
    return fail("FORECAST_INCONSISTENT", "Estado do entry da parcela inválido.", "installments.entryStatus");
  }
  const rawExpectedOn = input?.expectedOn ?? input?.expected_on ??
    input?.dueOn ?? input?.due_on ?? input?.billingDueOn ?? input?.billing_due_on;
  const expectedOn = typeof rawExpectedOn === "string" || rawExpectedOn instanceof Temporal.PlainDate
    ? rawExpectedOn
    : null;
  const rawPostedOn = input?.postedOn ?? input?.posted_on;
  const postedOn = typeof rawPostedOn === "string" || rawPostedOn instanceof Temporal.PlainDate
    ? rawPostedOn
    : null;
  const entry: ForecastEntryInput = {
    id: reference(input?.entryId ?? `${id}:entry`, "installments.entryId"),
    householdId: householdValue(row),
    financialEventId: event.id,
    installmentId: id,
    amountCents: `-${amount}`,
    status: rawEntryStatus,
    expectedOn: rawEntryStatus === "EXPECTED" ? expectedOn : null,
    postedOn: rawEntryStatus === "POSTED" ? postedOn : null,
  };
  return { event, entries: [entry] };
}

function cycleMonth(value: unknown): string {
  if (typeof value !== "string") {
    return fail("FORECAST_INCONSISTENT", "Parcela exige billingCycle.", "installments.billingCycle");
  }
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value)) {
    try {
      Temporal.PlainYearMonth.from(value, { overflow: "reject" });
      return value;
    } catch {
      return fail("FORECAST_INCONSISTENT", "billingCycle inválido.", "installments.billingCycle");
    }
  }
  let date: string;
  try {
    date = dateString(value, "installments.billingCycle");
  } catch {
    return fail("FORECAST_INCONSISTENT", "billingCycle inválido.", "installments.billingCycle");
  }
  if (!date.endsWith("-01")) {
    return fail("FORECAST_INCONSISTENT", "billingCycle deve ser o primeiro dia do mês.", "installments.billingCycle");
  }
  return date.slice(0, 7);
}

function buildInstallmentItems(
  root: Record<string, unknown>,
  range: { from: Temporal.PlainDate; to: Temporal.PlainDate },
  context: FinancialContext | undefined,
  households: Set<string>,
  items: InternalForecastItem[],
  seen: Map<string, Set<string>>,
): void {
  const rows = installmentRows(root);
  const duplicateIds = new Set<string>();
  for (const row of rows) {
    assertHousehold(households, row, context);
    const input = record(row);
    const id = installmentReference(row);
    if (duplicateIds.has(id)) return fail("FORECAST_INCONSISTENT", "Parcelas duplicadas.", "installments.id");
    duplicateIds.add(id);
    const status = installmentStatusOf(row);
    if (status === "CANCELLED") continue;
    const amount = positiveCents(input?.amountCents ?? input?.amount_cents, "installments.amountCents");
    const relation = installmentEventAndEntries(row, id, amount, status);
    const event = relation.event;
    if (!event) return fail("FORECAST_INCONSISTENT", "Parcela sem compra/fato.", "installments.event");
    if (
      input?.financialEventId !== undefined &&
      input.financialEventId !== null &&
      input.financialEventId !== event.id
    ) {
      return fail("FORECAST_INCONSISTENT", "Parcela aponta para fato divergente.", "installments.financialEventId");
    }
    if (event.kind !== undefined && event.kind !== "PURCHASE") {
      return fail("FORECAST_INCONSISTENT", "Parcela vinculada a fato não PURCHASE.", "installments.event.kind");
    }
    if (
      event.status === "CANCELLED" ||
      record(input?.purchase)?.status === "CANCELLED" ||
      record(input?.plan)?.status === "CANCELLED"
    ) continue;
    const entries = relation.entries;
    if (entries.length !== 1) return fail("FORECAST_INCONSISTENT", "Parcela deve possuir exatamente um entry.", "installments.entries");
    const entry = entries[0];
    if (
      entry.financialEventId !== undefined &&
      entry.financialEventId !== event.id
    ) {
      return fail("FORECAST_INCONSISTENT", "Entry da parcela aponta para fato divergente.", "installments.entries.financialEventId");
    }
    if (
      entry.installmentId !== undefined &&
      entry.installmentId !== null &&
      entry.installmentId !== id
    ) {
      return fail("FORECAST_INCONSISTENT", "Entry da parcela aponta para parcela divergente.", "installments.entries.installmentId");
    }
    const entryAmount = signedCents(entry.amountCents, "installments.entries.amountCents");
    if (entryAmount >= ZERO || entryAmount !== -BigInt(amount)) {
      return fail("FORECAST_INCONSISTENT", "Entry de parcela deve ser um outflow igual ao valor.", "installments.entries.amountCents");
    }
    const entryStatus = entry.status ?? (status === "POSTED" ? "POSTED" : "EXPECTED");
    if (entryStatus !== "POSTED" && entryStatus !== "EXPECTED") {
      return fail("FORECAST_INCONSISTENT", "Estado do entry da parcela inválido.", "installments.entries.status");
    }
    const cycle = cycleMonth(input?.billingCycle ?? input?.billing_cycle);
    const sequenceValue = input?.sequence ?? input?.installmentNumber ?? input?.installment_number;
    if (typeof sequenceValue !== "number" || !Number.isInteger(sequenceValue) || sequenceValue < 1) {
      return fail("FORECAST_INCONSISTENT", "Parcela exige sequência positiva.", "installments.sequence");
    }
    const label = safeLabel(event.description, "Parcela de cartão");
    const source = itemSource("INSTALLMENT", id, label, {
      billingCycle: cycle,
      installmentSequence: sequenceValue,
    });
    let date: string;
    let itemStatus: "POSTED" | "EXPECTED";
    let certainty: "REALIZED" | "COMMITTED";
    if (entryStatus === "POSTED") {
      if (entry.postedOn === undefined || entry.postedOn === null || entry.expectedOn !== undefined && entry.expectedOn !== null) {
        return fail("FORECAST_INCONSISTENT", "Entry POSTED de parcela possui datas inválidas.", "installments.entries");
      }
      date = dateString(entry.postedOn, "installments.entries.postedOn");
      itemStatus = "POSTED";
      certainty = "REALIZED";
    } else {
      if (entry.expectedOn === undefined || entry.expectedOn === null || entry.postedOn !== undefined && entry.postedOn !== null) {
        return fail("FORECAST_INCONSISTENT", "Entry EXPECTED de parcela possui datas inválidas.", "installments.entries");
      }
      const due = input?.billingDueOn ?? input?.billing_due_on ?? input?.dueOn ?? input?.due_on;
      if (due === undefined || due === null) return fail("FORECAST_INCONSISTENT", "Parcela exige billingDueOn.", "installments.billingDueOn");
      const override = input?.billingDueOnOverride ?? input?.billing_due_on_override;
      date = dateString(override ?? due, "installments.billingDueOn");
      itemStatus = "EXPECTED";
      certainty = "COMMITTED";
    }
    if (date > range.to.toString()) continue;
    const item = makeItem({
      date,
      amountCents: amount,
      direction: "OUTFLOW",
      status: itemStatus,
      certainty,
      source,
      referenceId: id,
      reconciliation: null,
    });
    if (itemStatus === "POSTED" && item.date < range.from.toString()) continue;
    addItem(items, seen, {
      item,
      includeInConservativeForecast: true,
      logicalKey: `INSTALLMENT:${id}`,
      role: itemStatus === "POSTED" ? "REALIZED" : "PROJECTED",
    });
  }
}

function realizedRows(root: Record<string, unknown>): readonly ForecastEventInput[] {
  const raw = sourceArray<ForecastEventInput | ForecastRealizedEventReadModel>(root, ["realizedEvents", "realized"]);
  return raw
    .map((value) => {
      const wrapped = record(value);
      if (wrapped?.event && typeof wrapped.event === "object") {
        return {
          ...(wrapped.event as ForecastEventInput),
          entries: wrapped.entries,
        } as ForecastEventInput;
      }
      return value as ForecastEventInput;
    })
    .sort((left, right) => String(record(left)?.id ?? "").localeCompare(String(record(right)?.id ?? "")));
}

function buildRealizedItems(
  root: Record<string, unknown>,
  range: { from: Temporal.PlainDate; to: Temporal.PlainDate },
  context: FinancialContext | undefined,
  households: Set<string>,
  items: InternalForecastItem[],
  seen: Map<string, Set<string>>,
  claimedEvents: Map<string, string>,
): void {
  const rows = realizedRows(root);
  const duplicates = new Set<string>();
  for (const event of rows) {
    assertHousehold(households, event, context);
    const input = record(event);
    const id = reference(input?.id, "realizedEvents.id");
    if (duplicates.has(id)) return fail("FORECAST_INCONSISTENT", "Eventos realizados duplicados.", "realizedEvents.id");
    duplicates.add(id);
    const status = input?.status;
    if (status !== undefined && status !== "POSTED" && status !== "CANCELLED") {
      return fail("FORECAST_INCONSISTENT", "Estado do evento realizado inválido.", "realizedEvents.status");
    }
    if (status === "CANCELLED") continue;
    const kind = input?.kind;
    // PURCHASE is represented only by its installments; TRANSFER and
    // REVERSAL do not create a household inflow/outflow in S07 V1.
    if (kind !== "EXPENSE" && kind !== "INCOME") continue;
    // Linked facts are already emitted by their owning recurring/planned
    // source. The reader intentionally returns all POSTED ledger facts, so
    // this claim check is the final anti-duplication guard at the builder.
    if (claimedEvents.has(id)) continue;
    if (input?.installmentId !== undefined && input.installmentId !== null || input?.plannedEventId !== undefined && input.plannedEventId !== null || input?.recurringRuleId !== undefined && input.recurringRuleId !== null) {
      continue;
    }
    const posted = postedEntry(event, entriesOf(event), "realizedEvents");
    if (posted.date < range.from.toString() || posted.date > range.to.toString()) continue;
    const direction = kind === "INCOME" ? "INFLOW" : "OUTFLOW";
    const signed = signedCents(posted.entry.amountCents, "realizedEvents.entries.amountCents");
    if (direction === "INFLOW" && signed <= ZERO || direction === "OUTFLOW" && signed >= ZERO) {
      return fail("FORECAST_INCONSISTENT", "Sinal do entry realizado é incompatível.", "realizedEvents.entries.amountCents");
    }
    const item = makeItem({
      date: posted.date,
      amountCents: posted.amountCents,
      direction,
      status: "POSTED",
      certainty: "REALIZED",
      source: itemSource("REALIZED_EVENT", id, safeLabel(input?.description, "Evento realizado")),
      referenceId: id,
      reconciliation: null,
    });
    addItem(items, seen, {
      item,
      includeInConservativeForecast: true,
      logicalKey: `REALIZED_EVENT:${id}`,
      role: "REALIZED",
    });
  }
}

function openingBalanceFrom(
  root: Record<string, unknown>,
  input: ForecastBuilderInput | ForecastSourceBundle,
): ForecastBuilderCentsInput {
  const candidate = input as ForecastBuilderInput;
  const nested = record(root.openingBalance);
  const value = candidate.openingBalanceCents ??
    (nested?.openingBalanceCents as ForecastBuilderCentsInput | undefined) ??
    (candidate.openingBalance as ForecastBuilderCentsInput | undefined);
  if (value !== undefined) return value;
  const opening = nested?.openingBalanceCents;
  if (opening !== undefined) return opening as ForecastBuilderCentsInput;
  return "0";
}

function sourceContext(
  input: ForecastTimelineBuilderInput,
): FinancialContext | undefined {
  const candidate = record(input);
  const context = candidate?.context;
  if (context && typeof context === "object") return context as FinancialContext;
  return undefined;
}

function checkSourceHouseholds(
  root: Record<string, unknown>,
  context: FinancialContext | undefined,
): Set<string> {
  const households = new Set<string>();
  const sourceHousehold = root.householdId;
  if (sourceHousehold !== undefined) {
    assertHousehold(households, { householdId: sourceHousehold }, context);
  }
  for (const value of recurringRuleInputRows(root)) assertSourceRelationships(households, value, context);
  for (const value of recurringInputRows(root)) assertSourceRelationships(households, value, context);
  for (const value of plannedRows(root)) assertSourceRelationships(households, value, context);
  for (const value of installmentRows(root)) assertSourceRelationships(households, value, context);
  for (const value of realizedRows(root)) assertSourceRelationships(households, value, context);
  const opening = record(root.openingBalance);
  if (opening) assertSourceRelationships(households, opening, context);
  for (const holiday of sourceArray<HolidayInput>(root, ["holidays"])) {
    assertSourceRelationships(households, holiday, context);
  }
  const nested = record(root.sourceBundle);
  if (nested && nested !== root) {
    const nestedHousehold = nested.householdId;
    if (nestedHousehold !== undefined) assertHousehold(households, { householdId: nestedHousehold }, context);
  }
  if (households.size > 1) return fail("TENANT_RESOURCE_NOT_FOUND", "Fontes de households diferentes não podem ser misturadas.", "householdId");
  return households;
}

function builderOperationOptions(
  input: ForecastTimelineBuilderInput,
  range: { from: Temporal.PlainDate; to: Temporal.PlainDate },
  counts: { sourceCount: number; itemCount?: number; projectedItemCount?: number; realizedItemCount?: number },
): S07ForecastOperationOptions & S07ForecastCompletionOptions {
  const candidate = record(input);
  const supplied = record(candidate?.observability);
  const months = (range.to.year - range.from.year) * 12 + range.to.month - range.from.month + 1;
  const periodBucket = months <= 1 ? "SINGLE_PERIOD" : months <= 3 ? "SHORT" : months <= 12 ? "MEDIUM" : "LONG";
  return {
    ...(supplied as (S07ForecastOperationOptions & S07ForecastCompletionOptions) | null ?? {}),
    sourceKind: "ALL",
    periodBucket,
    ...counts,
  };
}

function buildInternal(
  input: ForecastTimelineBuilderInput,
): { items: readonly InternalForecastItem[]; range: ReturnType<typeof normalizeRange>; context?: FinancialContext } {
  const root = sourceRoot(input as ForecastBuilderInput | ForecastSourceBundle);
  const range = normalizeRange(input as ForecastBuilderInput | ForecastSourceBundle);
  const context = sourceContext(input);
  const households = checkSourceHouseholds(root, context);
  const items: InternalForecastItem[] = [];
  const seen = new Map<string, Set<string>>();
  const claimedEvents = new Map<string, string>();
  buildRecurringItems(root, range, context, households, items, seen, claimedEvents);
  buildPlannedItems(root, range, context, households, items, seen, claimedEvents);
  buildInstallmentItems(root, range, context, households, items, seen);
  buildRealizedItems(root, range, context, households, items, seen, claimedEvents);
  items.sort(compareInternal);
  return { items, range, ...(context ? { context } : {}) };
}

function observabilitySuccess(
  input: ForecastTimelineBuilderInput,
  range: ReturnType<typeof normalizeRange>,
  internal: readonly InternalForecastItem[],
): void {
  const operation = createS07ForecastOperation("builder", builderOperationOptions(input, range, {
    sourceCount: internal.length,
    itemCount: internal.length,
    projectedItemCount: internal.filter((value) => value.item.status !== "POSTED").length,
    realizedItemCount: internal.filter((value) => value.item.status === "POSTED").length,
  }));
  logS07ForecastOperation(operation, "success", builderOperationOptions(input, range, {
    sourceCount: internal.length,
    itemCount: internal.length,
    projectedItemCount: internal.filter((value) => value.item.status !== "POSTED").length,
    realizedItemCount: internal.filter((value) => value.item.status === "POSTED").length,
  }));
}

function publicItems(
  internal: readonly InternalForecastItem[],
): ForecastItem[] {
  return internal.map((value) => value.item);
}

/** Builds normalized items; overdue projected items remain available to T05. */
export function buildForecastItems(
  input: ForecastTimelineBuilderInput,
): readonly ForecastItem[] {
  try {
    const built = buildInternal(input);
    observabilitySuccess(input, built.range, built.items);
    return publicItems(built.items);
  } catch (error) {
    if (error instanceof ForecastBuilderError) throw error;
    throw new ForecastBuilderError("FORECAST_INCONSISTENT", "Não foi possível normalizar as fontes.");
  }
}

function engineItems(
  internal: readonly InternalForecastItem[],
): readonly ForecastEngineItem[] {
  return internal.map(({ item, includeInConservativeForecast }) => ({
    ...item,
    includeInConservativeForecast,
    source: {
      ...item.source,
      includeInConservativeForecast,
    },
  }));
}

/** Composes T04 sources with the pure T05 engine. */
export function buildForecastTimelineFromSources(
  input: ForecastTimelineBuilderInput,
): ForecastTimeline {
  let built: ReturnType<typeof buildInternal>;
  try {
    built = buildInternal(input);
    observabilitySuccess(input, built.range, built.items);
    const candidate = record(input);
    const scenario = candidate?.scenario as ForecastScenario | undefined;
    return ForecastEngine(
      engineItems(built.items),
      openingBalanceFrom(sourceRoot(input as ForecastBuilderInput | ForecastSourceBundle), input as ForecastBuilderInput),
      { from: built.range.fromString, to: built.range.toString },
      scenario ?? "CONSERVATIVE",
    );
  } catch (error) {
    if (error instanceof ForecastBuilderError) {
      const candidate = record(input);
      const range = (() => {
        try { return normalizeRange(input); } catch { return null; }
      })();
      if (range) {
        const operation = createS07ForecastOperation("builder", builderOperationOptions(input, range, { sourceCount: 0 }));
        reportS07UnexpectedError(error, operation, 0, {
          technicalErrorCode: error.code === "FORECAST_INCONSISTENT" ? "FORECAST_INCONSISTENT" : undefined,
          errorCode: error.code,
          ...(record(candidate?.observability) as S07ForecastCompletionOptions | null ?? {}),
        });
      }
      throw error;
    }
    throw new ForecastBuilderError("FORECAST_INCONSISTENT", "Não foi possível montar a timeline.");
  }
}

/** Compatibility aliases used by T06/S08 adapters. */
export const normalizeForecastSources = buildForecastItems;
export const normalizeForecastItems = buildForecastItems;
export const buildForecastItemsFromSources = buildForecastItems;
export const buildForecastTimelineFromSourceBundle = buildForecastTimelineFromSources;
export const buildForecastFromSources = buildForecastTimelineFromSources;

/**
 * Stateful convenience façade. It stores no financial result; every `build`
 * call re-normalizes the supplied source snapshot, so repeated calls are
 * deterministic and cannot leak another household's rows.
 */
export class ForecastTimelineBuilder {
  private readonly defaults: Partial<ForecastBuilderInput>;

  constructor(defaults: Partial<ForecastBuilderInput> = {}) {
    this.defaults = { ...defaults };
  }

  build(input?: ForecastTimelineBuilderInput): readonly ForecastItem[] {
    return buildForecastItems({ ...this.defaults, ...(input ?? {}) } as ForecastTimelineBuilderInput);
  }

  buildTimeline(input?: ForecastTimelineBuilderInput): ForecastTimeline {
    return buildForecastTimelineFromSources({ ...this.defaults, ...(input ?? {}) } as ForecastTimelineBuilderInput);
  }

  timeline(input?: ForecastTimelineBuilderInput): ForecastTimeline {
    return this.buildTimeline(input);
  }
}

export const createForecastTimelineBuilder = (
  defaults: Partial<ForecastBuilderInput> = {},
): ForecastTimelineBuilder => new ForecastTimelineBuilder(defaults);
