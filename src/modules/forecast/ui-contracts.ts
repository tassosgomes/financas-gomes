import {
  forecastErrorSchema,
  forecastItemSchema,
  getForecastQuerySchema,
  type ForecastCertainty,
  type ForecastDirection,
  type ForecastErrorCode,
  type ForecastItem,
  type ForecastItemStatus,
  type ForecastScenario,
  type ForecastSource,
  type ForecastSourceKind,
  type ForecastTimeline,
  type GetForecastQuery,
  parseForecastTimeline,
} from "./contracts";

/**
 * Browser-safe presentation helpers for S07.  They accept already serialized
 * read-model values and never query data, infer a scenario, or recalculate a
 * forecast.  Financial arithmetic stays on the server/engine.
 */

export const FORECAST_SCENARIO_LABELS: Record<ForecastScenario, string> = {
  CONSERVATIVE: "Conservador",
  EXPECTED: "Esperado",
};

export const FORECAST_CERTAINTY_LABELS: Record<ForecastCertainty, string> = {
  REALIZED: "Realizado",
  COMMITTED: "Comprometido",
  EXPECTED: "Esperado",
};

export const FORECAST_DIRECTION_LABELS: Record<ForecastDirection, string> = {
  INFLOW: "Entrada",
  OUTFLOW: "Saída",
};

export const FORECAST_ITEM_STATUS_LABELS: Record<ForecastItemStatus, string> =
  {
    PLANNED: "Planejado",
    EXPECTED: "Esperado",
    POSTED: "Realizado",
  };

export const FORECAST_SOURCE_KIND_LABELS: Record<ForecastSourceKind, string> =
  {
    RECURRING: "Recorrência",
    PLANNED_EVENT: "Evento planejado",
    INSTALLMENT: "Parcela de cartão",
    REALIZED_EVENT: "Lançamento realizado",
  };

export type ForecastReadModelState =
  | "loading"
  | "empty"
  | "ready"
  | "error"
  | "success";

export interface ForecastItemViewModel extends ForecastItem {
  dateLabel: string;
  amountLabel: string;
  directionLabel: string;
  certaintyLabel: string;
  statusLabel: string;
  sourceKindLabel: string;
}

export interface ForecastTimelineViewModel {
  timeline: ForecastTimeline;
  scenarioLabel: string;
  fromLabel: string;
  toLabel: string;
}

export interface ForecastSummaryMetricViewModel {
  key:
    | "openingBalance"
    | "openingAdjustments"
    | "openingProjectedBalance"
    | "inflow"
    | "outflow"
    | "realizedInflow"
    | "realizedOutflow"
    | "projectedInflow"
    | "projectedOutflow"
    | "minimumProjectedBalance"
    | "closingProjectedBalance";
  label: string;
  description: string;
  amountCents: string;
  amountLabel: string;
}

export interface ForecastSummaryViewModel {
  scenarioLabel: string;
  fromLabel: string;
  toLabel: string;
  metrics: readonly ForecastSummaryMetricViewModel[];
}

export interface ForecastErrorViewModel {
  code: ForecastErrorCode;
  field: string | null;
  message: string;
  retryable: boolean;
}

export interface ForecastQueryViewModel {
  from: string | null;
  to: string | null;
  scenario: ForecastScenario;
}

export interface ForecastOriginLinkViewModel {
  /** Server-authorized route; the UI never constructs it from an ID. */
  href: string;
  label: string;
  returnHref?: string;
}

const MONTH_LABELS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

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
export function formatForecastMoney(value: string): string {
  const cents = parseSafeBigInt(value);
  if (cents === null) return "Valor indisponível";

  const absolute = cents < BigInt(0) ? -cents : cents;
  const whole = absolute / BigInt(100);
  const fraction = (absolute % BigInt(100)).toString(10).padStart(2, "0");
  const sign = cents < BigInt(0) ? "-" : "";
  return `${sign}R$ ${groupIntegerDigits(whole.toString(10))},${fraction}`;
}

export const formatForecastCents = formatForecastMoney;
export const formatForecastAmount = formatForecastMoney;

/**
 * Applies the semantic direction to a positive item amount.  This is a
 * display operation only; it deliberately does not mutate the read model.
 */
export function formatForecastImpact(
  amountCents: string,
  direction: ForecastDirection,
): string {
  const amount = parseSafeBigInt(amountCents);
  if (amount === null || amount <= BigInt(0)) return "Valor indisponível";
  return formatForecastMoney(
    direction === "OUTFLOW" ? `-${amount.toString(10)}` : amount.toString(10),
  );
}

export function formatForecastDate(value: string): string {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return "Data indisponível";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export const formatPlainDate = formatForecastDate;

export function formatForecastPeriod(value: string): string {
  const match = ISO_MONTH_PATTERN.exec(value);
  if (!match) return "Período indisponível";
  const month = Number(match[2]);
  const monthLabel = MONTH_LABELS[month - 1];
  return monthLabel ? `${monthLabel} de ${match[1]}` : "Período indisponível";
}

export function formatForecastRange(from: string, to: string): string {
  return `${formatForecastDate(from)} a ${formatForecastDate(to)}`;
}

export function forecastScenarioLabel(scenario: ForecastScenario): string {
  return FORECAST_SCENARIO_LABELS[scenario];
}

export function forecastCertaintyLabel(certainty: ForecastCertainty): string {
  return FORECAST_CERTAINTY_LABELS[certainty];
}

export function forecastDirectionLabel(direction: ForecastDirection): string {
  return FORECAST_DIRECTION_LABELS[direction];
}

export function forecastItemStatusLabel(status: ForecastItemStatus): string {
  return FORECAST_ITEM_STATUS_LABELS[status];
}

export function forecastSourceKindLabel(kind: ForecastSourceKind): string {
  return FORECAST_SOURCE_KIND_LABELS[kind];
}

function unwrapTimeline(value: ForecastTimeline | ForecastTimelineViewModel): ForecastTimeline {
  return "timeline" in value ? value.timeline : value;
}

/** Adds labels only; all numeric/date values remain those returned by T06. */
export function toForecastItemViewModel(value: ForecastItem): ForecastItemViewModel {
  const item = forecastItemSchema.parse(value) as ForecastItem;
  return {
    ...item,
    dateLabel: formatForecastDate(item.date),
    amountLabel: formatForecastImpact(item.amountCents, item.direction),
    directionLabel: forecastDirectionLabel(item.direction),
    certaintyLabel: forecastCertaintyLabel(item.certainty),
    statusLabel: forecastItemStatusLabel(item.status),
    sourceKindLabel: forecastSourceKindLabel(item.source.kind),
  };
}

export function toForecastTimelineViewModel(
  value: ForecastTimeline,
): ForecastTimelineViewModel {
  const timeline = parseForecastTimeline(value);
  return {
    timeline,
    scenarioLabel: forecastScenarioLabel(timeline.scenario),
    fromLabel: formatForecastDate(timeline.from),
    toLabel: formatForecastDate(timeline.to),
  };
}

function metric(
  key: ForecastSummaryMetricViewModel["key"],
  label: string,
  description: string,
  amountCents: string,
): ForecastSummaryMetricViewModel {
  return {
    key,
    label,
    description,
    amountCents,
    amountLabel: formatForecastMoney(amountCents),
  };
}

/** Builds a presentational metric list without adding or recalculating values. */
export function toForecastSummaryViewModel(
  value: ForecastTimeline | ForecastTimelineViewModel,
): ForecastSummaryViewModel {
  const timeline = parseForecastTimeline(unwrapTimeline(value));
  const totals = timeline.totals;
  return {
    scenarioLabel: forecastScenarioLabel(timeline.scenario),
    fromLabel: formatForecastDate(timeline.from),
    toLabel: formatForecastDate(timeline.to),
    metrics: [
      metric(
        "openingBalance",
        "Saldo inicial realizado",
        "Posição publicada antes do intervalo consultado.",
        timeline.openingBalanceCents,
      ),
      metric(
        "openingAdjustments",
        "Ajustes de abertura",
        "Compromissos ativos anteriores ao intervalo.",
        timeline.openingAdjustmentsCents,
      ),
      metric(
        "openingProjectedBalance",
        "Saldo de abertura projetado",
        "Saldo realizado somado aos ajustes de abertura.",
        timeline.openingProjectedBalanceCents,
      ),
      metric(
        "inflow",
        "Entradas no período",
        "Entradas realizadas ou previstas do intervalo.",
        totals.inflowCents,
      ),
      metric(
        "outflow",
        "Saídas no período",
        "Saídas realizadas ou comprometidas do intervalo.",
        totals.outflowCents,
      ),
      metric(
        "realizedInflow",
        "Entradas realizadas",
        "Valores com efeito publicado no ledger.",
        totals.realizedInflowCents,
      ),
      metric(
        "realizedOutflow",
        "Saídas realizadas",
        "Valores com efeito publicado no ledger.",
        totals.realizedOutflowCents,
      ),
      metric(
        "projectedInflow",
        "Entradas previstas",
        "Compromissos de entrada ainda não publicados.",
        totals.projectedInflowCents,
      ),
      metric(
        "projectedOutflow",
        "Saídas previstas",
        "Compromissos de saída ainda não publicados.",
        totals.projectedOutflowCents,
      ),
      metric(
        "minimumProjectedBalance",
        "Menor saldo projetado",
        "Menor posição calculada pelo servidor no intervalo.",
        timeline.minimumProjectedBalanceCents,
      ),
      metric(
        "closingProjectedBalance",
        "Saldo final projetado",
        "Posição projetada ao final do intervalo.",
        timeline.closingProjectedBalanceCents,
      ),
    ],
  };
}

const FORECAST_ERROR_MESSAGES: Record<ForecastErrorCode, string> = {
  INVALID_DATE: "Informe datas válidas para consultar o período.",
  INVALID_DATE_RANGE: "A data inicial precisa ser anterior ou igual à final.",
  INVALID_SCENARIO: "O cenário selecionado não está disponível.",
  FORECAST_RANGE_TOO_LARGE:
    "O período solicitado é muito grande. Escolha um intervalo menor.",
  FINANCIAL_CONTEXT_REQUIRED:
    "É necessário entrar para consultar o fluxo futuro.",
  FORECAST_NOT_FOUND: "A projeção solicitada não foi encontrada.",
  FORECAST_INCONSISTENT:
    "Não foi possível montar uma projeção consistente neste momento.",
  FORECAST_QUERY_FAILED:
    "Não foi possível carregar a projeção. Tente novamente.",
};

const RETRYABLE_FORECAST_ERRORS: ReadonlySet<ForecastErrorCode> = new Set([
  "FORECAST_RANGE_TOO_LARGE",
  "FORECAST_QUERY_FAILED",
]);

function errorCodeFrom(value: unknown): ForecastErrorCode | null {
  const parsed = forecastErrorSchema.safeParse(value);
  return parsed.success ? parsed.data.code : null;
}

/** Maps server errors to allow-listed UI copy; raw exception text is ignored. */
export function toForecastErrorViewModel(
  value: unknown,
  fallback: ForecastErrorCode = "FORECAST_QUERY_FAILED",
): ForecastErrorViewModel {
  const code = errorCodeFrom(value) ?? fallback;
  const parsed = forecastErrorSchema.safeParse(value);
  const field = parsed.success ? parsed.data.field : null;
  return {
    code,
    field,
    message: FORECAST_ERROR_MESSAGES[code],
    retryable: RETRYABLE_FORECAST_ERRORS.has(code),
  };
}

export const forecastErrorMessage = (value: unknown): string =>
  toForecastErrorViewModel(value).message;

/**
 * Serializes only the public query fields.  Invalid input returns an empty
 * query rather than leaking arbitrary values into a navigation URL.
 */
export function serializeForecastQuery(value: GetForecastQuery): string {
  const parsed = getForecastQuerySchema.safeParse(value);
  if (!parsed.success) return "";

  const params = new URLSearchParams();
  if (parsed.data.from) params.set("from", parsed.data.from);
  if (parsed.data.to) params.set("to", parsed.data.to);
  if (parsed.data.scenario) params.set("scenario", parsed.data.scenario);
  return params.toString();
}

export function forecastHref(
  query: GetForecastQuery = {},
  basePath = "/forecast",
): string {
  const serialized = serializeForecastQuery(query);
  return serialized ? `${basePath}?${serialized}` : basePath;
}

export const getForecastHref = forecastHref;
export const forecastPeriodHref = forecastHref;

/**
 * A source route is supplied by a server-authorized adapter.  This helper
 * preserves the return projection without accepting a household/reference ID.
 */
export function forecastOriginLink(
  href: string,
  label: string,
  returnQuery?: GetForecastQuery,
): ForecastOriginLinkViewModel {
  const returnHref = returnQuery ? forecastHref(returnQuery) : undefined;
  return returnHref ? { href, label, returnHref } : { href, label };
}

export const createForecastOriginLink = forecastOriginLink;

/** Exposes labels for adapters that need to build server-side view models. */
export function forecastSourceDisplay(source: ForecastSource): string {
  return `${FORECAST_SOURCE_KIND_LABELS[source.kind]}: ${source.label}`;
}
