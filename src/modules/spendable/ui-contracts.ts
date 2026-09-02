import type {
  SpendableBreakdown,
  SpendableCausalPageInfo,
} from "./contracts";

/**
 * Presentation contracts for S08.  The financial read model is produced and
 * validated by the server; this module adds only labels and safe formatting
 * metadata for the React boundary.
 *
 * Values that represent money remain decimal strings.  In particular, this
 * boundary never converts monetary values through `number`/float and does not
 * expose `bigint`, `Date` or any household/session field to components. The
 * contract-mandated `horizonDays` integer remains metadata only.
 */

export type SpendableReadModelState =
  | "loading"
  | "empty"
  | "ready"
  | "error"
  | "success";

type SpendableScenario = SpendableBreakdown["period"]["scenario"];
type SpendableSourceKind = SpendableBreakdown["minimum"]["points"][number]["items"][number]["sourceKind"];
type SpendableDirection = SpendableBreakdown["minimum"]["points"][number]["items"][number]["direction"];
type SpendableItemStatus = SpendableBreakdown["minimum"]["points"][number]["items"][number]["status"];
type SpendableCertainty = SpendableBreakdown["minimum"]["points"][number]["items"][number]["certainty"];
type SpendablePointKind = SpendableBreakdown["minimum"]["points"][number]["kind"];
type SpendableReserveStatus = SpendableBreakdown["reserve"]["status"];
type SpendableBufferSource = SpendableBreakdown["operationalBuffer"]["source"];

export const SPENDABLE_SCENARIO_LABELS: Record<SpendableScenario, string> = {
  CONSERVATIVE: "Conservador",
  EXPECTED: "Esperado",
};

export const SPENDABLE_SOURCE_KIND_LABELS: Record<SpendableSourceKind, string> = {
  RECURRING: "Recorrência",
  PLANNED_EVENT: "Evento planejado",
  INSTALLMENT: "Parcela de cartão",
  REALIZED_EVENT: "Lançamento realizado",
  RESERVE: "Reserva",
};

export const SPENDABLE_DIRECTION_LABELS: Record<SpendableDirection, string> = {
  INFLOW: "Entrada",
  OUTFLOW: "Saída",
};

export const SPENDABLE_ITEM_STATUS_LABELS: Record<
  Exclude<SpendableItemStatus, null>,
  string
> = {
  PLANNED: "Planejado",
  EXPECTED: "Esperado",
  POSTED: "Realizado",
};

export const SPENDABLE_CERTAINTY_LABELS: Record<
  Exclude<SpendableCertainty, null>,
  string
> = {
  REALIZED: "Realizado",
  COMMITTED: "Comprometido",
  EXPECTED: "Esperado",
};

export const SPENDABLE_POINT_KIND_LABELS: Record<SpendablePointKind, string> = {
  OPENING: "Abertura",
  DAY_CLOSE: "Fechamento do dia",
};

export const SPENDABLE_RESERVE_STATUS_LABELS: Record<SpendableReserveStatus, string> = {
  UNAVAILABLE: "Reserva não disponível nesta versão",
  AVAILABLE: "Reserva aplicada",
};

export const SPENDABLE_BUFFER_SOURCE_LABELS: Record<SpendableBufferSource, string> = {
  CONFIGURED: "Configurado",
  ABSENT_DEFAULT_ZERO: "Não configurado (padrão R$ 0)",
};

export interface SpendableCausalItemViewModel {
  readonly item: SpendableBreakdown["minimum"]["points"][number]["items"][number];
  readonly dateLabel: string;
  readonly amountLabel: string;
  readonly directionLabel: string;
  readonly sourceKindLabel: string;
  readonly statusLabel: string;
  readonly certaintyLabel: string;
}

export interface SpendableCausalPointViewModel {
  readonly point: SpendableBreakdown["minimum"]["points"][number];
  readonly kindLabel: string;
  readonly dateLabel: string;
  readonly projectedBalanceLabel: string;
  readonly referenceCountLabel: string;
  readonly items: readonly SpendableCausalItemViewModel[];
}

export type SpendableAvailabilityStatus = "positive" | "zero" | "deficit";

export interface SpendableBreakdownViewModel {
  /** The original server read model; no fields are recalculated here. */
  readonly breakdown: SpendableBreakdown;
  readonly scenarioLabel: string;
  readonly asOfLabel: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly periodLabel: string;
  readonly horizonLabel: string;
  readonly bufferAmountLabel: string;
  readonly bufferSourceLabel: string;
  readonly bufferEffectiveFromLabel: string;
  readonly reserveStatusLabel: string;
  readonly reserveProtectedLabel: string;
  readonly reserveAppliedOpeningAdjustmentLabel: string;
  readonly openingBalanceLabel: string;
  readonly openingAdjustmentsLabel: string;
  readonly openingProjectedBalanceLabel: string;
  readonly closingProjectedBalanceLabel: string;
  readonly minimumProjectedBalanceLabel: string;
  readonly rawSpendableLabel: string;
  readonly displaySpendableLabel: string;
  readonly deficitToPreserveReserveLabel: string;
  readonly availabilityStatus: SpendableAvailabilityStatus;
  readonly minimumPoints: readonly SpendableCausalPointViewModel[];
  /** Pagination metadata returned by the server, when the response has it. */
  readonly causalPageInfo: SpendableCausalPageInfo | null;
}

export interface SpendableErrorViewModel {
  readonly code: string;
  readonly field: string | null;
  readonly message: string;
  readonly retryable: boolean;
}

export interface SpendableOriginLinkViewModel {
  /** A server-authorized href; the UI never constructs it from an ID. */
  readonly href: string;
  readonly label: string;
  readonly returnHref?: string;
}

const MONTH_LABELS: Readonly<Record<string, string>> = {
  "01": "janeiro",
  "02": "fevereiro",
  "03": "março",
  "04": "abril",
  "05": "maio",
  "06": "junho",
  "07": "julho",
  "08": "agosto",
  "09": "setembro",
  "10": "outubro",
  "11": "novembro",
  "12": "dezembro",
};

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const ISO_MONTH_PATTERN = /^(\d{4})-(\d{2})$/u;
const SIGNED_CENTS_PATTERN = /^-?\d+$/u;

function parseSafeBigInt(value: string): bigint | null {
  if (!SIGNED_CENTS_PATTERN.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function groupIntegerDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
}

/** Formats signed integer cents without converting through Number/float. */
export function formatSpendableMoney(value: string): string {
  const cents = parseSafeBigInt(value);
  if (cents === null) return "Valor indisponível";

  const zero = BigInt(0);
  const hundred = BigInt(100);
  const absolute = cents < zero ? -cents : cents;
  const whole = absolute / hundred;
  const fraction = (absolute % hundred).toString(10).padStart(2, "0");
  const sign = cents < zero ? "-" : "";
  return `${sign}R$ ${groupIntegerDigits(whole.toString(10))},${fraction}`;
}

export const formatSpendableCents = formatSpendableMoney;
export const formatSpendableAmount = formatSpendableMoney;

/** Formats a positive item amount with the direction supplied by the server. */
export function formatSpendableImpact(
  amountCents: string,
  direction: SpendableDirection,
): string {
  const amount = parseSafeBigInt(amountCents);
  if (amount === null || amount <= BigInt(0)) return "Valor indisponível";
  return formatSpendableMoney(
    direction === "OUTFLOW" ? `-${amount.toString(10)}` : amount.toString(10),
  );
}

export function formatSpendableDate(value: string): string {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return "Data indisponível";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export const formatPlainDate = formatSpendableDate;

export function formatSpendablePeriod(value: string): string {
  const match = ISO_MONTH_PATTERN.exec(value);
  if (!match) return "Período indisponível";
  const monthLabel = MONTH_LABELS[match[2]];
  return monthLabel ? `${monthLabel} de ${match[1]}` : "Período indisponível";
}

export function formatSpendableRange(from: string, to: string): string {
  return `${formatSpendableDate(from)} a ${formatSpendableDate(to)}`;
}

export function formatSpendableHorizon(days: number): string {
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}

export function spendableScenarioLabel(scenario: SpendableScenario): string {
  return SPENDABLE_SCENARIO_LABELS[scenario];
}

export function spendableSourceKindLabel(kind: SpendableSourceKind): string {
  return SPENDABLE_SOURCE_KIND_LABELS[kind];
}

export function spendableDirectionLabel(direction: SpendableDirection): string {
  return SPENDABLE_DIRECTION_LABELS[direction];
}

export function spendableItemStatusLabel(status: SpendableItemStatus): string {
  return status === null ? "Sem status" : SPENDABLE_ITEM_STATUS_LABELS[status];
}

export function spendableCertaintyLabel(certainty: SpendableCertainty): string {
  return certainty === null
    ? "Sem classificação de certeza"
    : SPENDABLE_CERTAINTY_LABELS[certainty];
}

export function spendablePointKindLabel(kind: SpendablePointKind): string {
  return SPENDABLE_POINT_KIND_LABELS[kind];
}

function availabilityStatus(rawSpendableCents: string): SpendableAvailabilityStatus {
  const raw = parseSafeBigInt(rawSpendableCents);
  if (raw === null) return "zero";
  if (raw < BigInt(0)) return "deficit";
  return raw === BigInt(0) ? "zero" : "positive";
}

function toCausalItemViewModel(
  item: SpendableCausalItemViewModel["item"],
): SpendableCausalItemViewModel {
  return {
    item,
    dateLabel: formatSpendableDate(item.date),
    amountLabel: formatSpendableImpact(item.amountCents, item.direction),
    directionLabel: spendableDirectionLabel(item.direction),
    sourceKindLabel: spendableSourceKindLabel(item.sourceKind),
    statusLabel: spendableItemStatusLabel(item.status),
    certaintyLabel: spendableCertaintyLabel(item.certainty),
  };
}

function toCausalPointViewModel(
  point: SpendableCausalPointViewModel["point"],
): SpendableCausalPointViewModel {
  return {
    point,
    kindLabel: spendablePointKindLabel(point.kind),
    dateLabel: formatSpendableDate(point.date),
    projectedBalanceLabel: formatSpendableMoney(point.projectedBalanceCents),
    referenceCountLabel: `${point.references.length} ${point.references.length === 1 ? "origem" : "origens"}`,
    items: point.items.map(toCausalItemViewModel),
  };
}

/**
 * Adds presentation labels only.  All amounts, dates, points and references
 * are copied from the server read model without sorting, filtering or math.
 */
export function toSpendableBreakdownViewModel(
  breakdown: SpendableBreakdown,
): SpendableBreakdownViewModel {
  const { period, operationalBuffer, reserve, minimum } = breakdown;
  return {
    breakdown,
    scenarioLabel: spendableScenarioLabel(period.scenario),
    asOfLabel: formatSpendableDate(period.asOf),
    fromLabel: formatSpendableDate(period.from),
    toLabel: formatSpendableDate(period.to),
    periodLabel: formatSpendableRange(period.from, period.to),
    horizonLabel: formatSpendableHorizon(period.horizonDays),
    bufferAmountLabel: formatSpendableMoney(operationalBuffer.amountCents),
    bufferSourceLabel: SPENDABLE_BUFFER_SOURCE_LABELS[operationalBuffer.source],
    bufferEffectiveFromLabel: operationalBuffer.effectiveFrom
      ? formatSpendableDate(operationalBuffer.effectiveFrom)
      : "Nenhuma configuração aplicável",
    reserveStatusLabel: SPENDABLE_RESERVE_STATUS_LABELS[reserve.status],
    reserveProtectedLabel: formatSpendableMoney(reserve.protectedCents),
    reserveAppliedOpeningAdjustmentLabel: formatSpendableMoney(
      reserve.appliedOpeningAdjustmentCents,
    ),
    openingBalanceLabel: formatSpendableMoney(breakdown.openingBalanceCents),
    openingAdjustmentsLabel: formatSpendableMoney(
      breakdown.openingAdjustmentsCents,
    ),
    openingProjectedBalanceLabel: formatSpendableMoney(
      breakdown.openingProjectedBalanceCents,
    ),
    closingProjectedBalanceLabel: formatSpendableMoney(
      breakdown.closingProjectedBalanceCents,
    ),
    minimumProjectedBalanceLabel: formatSpendableMoney(
      breakdown.minimumProjectedBalanceCents,
    ),
    rawSpendableLabel: formatSpendableMoney(breakdown.rawSpendableCents),
    displaySpendableLabel: formatSpendableMoney(breakdown.displaySpendableCents),
    deficitToPreserveReserveLabel: formatSpendableMoney(
      breakdown.deficitToPreserveReserveCents,
    ),
    availabilityStatus: availabilityStatus(breakdown.rawSpendableCents),
    minimumPoints: minimum.points.map(toCausalPointViewModel),
    causalPageInfo: minimum.causalItems ?? null,
  };
}

const SPENDABLE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  INVALID_DATE: "Informe uma data de referência válida.",
  INVALID_DATE_RANGE: "O período solicitado não é válido.",
  INVALID_SCENARIO: "O cenário selecionado não está disponível.",
  INVALID_HORIZON: "O horizonte solicitado não é válido.",
  HORIZON_TOO_LARGE: "O horizonte solicitado é muito grande.",
  FINANCIAL_CONTEXT_REQUIRED: "É necessário entrar para consultar a disponibilidade.",
  SPENDABLE_NOT_FOUND: "A disponibilidade solicitada não foi encontrada.",
  SPENDABLE_INCONSISTENT:
    "Não foi possível montar uma disponibilidade consistente neste momento.",
  SPENDABLE_QUERY_FAILED:
    "Não foi possível carregar a disponibilidade. Tente novamente.",
};

const RETRYABLE_SPENDABLE_ERRORS: ReadonlySet<string> = new Set([
  "HORIZON_TOO_LARGE",
  "SPENDABLE_QUERY_FAILED",
]);

function errorRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** Maps only stable server codes to copy; raw exception text is ignored. */
export function toSpendableErrorViewModel(
  value: unknown,
  fallback = "SPENDABLE_QUERY_FAILED",
): SpendableErrorViewModel {
  const record = errorRecord(value);
  const rawCode = record?.code;
  const fallbackCode = fallback in SPENDABLE_ERROR_MESSAGES
    ? fallback
    : "SPENDABLE_QUERY_FAILED";
  const code = typeof rawCode === "string" && rawCode in SPENDABLE_ERROR_MESSAGES
    ? rawCode
    : fallbackCode;
  const rawField = record?.field;
  const field = typeof rawField === "string" && /^[A-Za-z][A-Za-z0-9_.]*$/u.test(rawField)
    ? rawField
    : null;
  return {
    code,
    field,
    message: SPENDABLE_ERROR_MESSAGES[code] ?? SPENDABLE_ERROR_MESSAGES.SPENDABLE_QUERY_FAILED,
    retryable: RETRYABLE_SPENDABLE_ERRORS.has(code),
  };
}

export const spendableErrorMessage = (value: unknown): string =>
  toSpendableErrorViewModel(value).message;

/**
 * A route is supplied by the server adapter.  The UI can preserve a safe
 * return path but cannot construct a target from a reference or household ID.
 */
export function spendableOriginLink(
  href: string,
  label: string,
  returnHref?: string,
): SpendableOriginLinkViewModel {
  return returnHref ? { href, label, returnHref } : { href, label };
}

export const createSpendableOriginLink = spendableOriginLink;
