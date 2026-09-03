/**
 * Presentation contracts for S11 data portability (ADR-014, T05).
 *
 * The server supplies datasets, counts and opaque errors; this module adds only
 * stable view-model shapes and Portuguese copy. No household, user, SQL or stack
 * crosses this boundary.
 *
 * ## Information hierarchy (T10 screen layout)
 *
 * 1. **PageHeader** — eyebrow `EXPORT_SCREEN_EYEBROW`, title `EXPORT_SCREEN_TITLE`,
 *    description `EXPORT_SCREEN_DESCRIPTION`.
 * 2. **Included summary** — `EXPORT_INCLUDED_HEADING` + bullet list from
 *    `EXPORT_INCLUDED_ITEMS`.
 * 3. **Excluded summary** — `EXPORT_EXCLUDED_HEADING` + bullet list from
 *    `EXPORT_EXCLUDED_ITEMS` (passwords, member e-mails, sessions).
 * 4. **Dataset inventory** — `EXPORT_DATASETS_HEADING`; each `ExportDatasetViewModel`
 *    shows title, description and availability badge.
 * 5. **Primary action** — `EXPORT_PRIMARY_ACTION_LABEL` (idle) /
 *    `EXPORT_GENERATING_ACTION_LABEL` (generating, T11 disables duplicate submit).
 * 6. **Outcome panel** — labels from completed / completed_empty / error states (T11).
 *
 * Settings route: `/settings/data`, nav label `EXPORT_SETTINGS_NAV_LABEL` (T10).
 */

import { EXPORT_SETTINGS_NAV_LABEL } from "@/modules/export/routes";

export { EXPORT_SETTINGS_NAV_LABEL };

export const S11_CONTRACT_VERSION = "s11.v1" as const;

/** Response header carrying total exported row count (integer only, no PII). */
export const S11_EXPORT_ROW_COUNT_HEADER = "X-S11-Row-Count" as const;

/** Closed set of export request states for the Settings screen. */
export const EXPORT_REQUEST_STATES = [
  "idle",
  "generating",
  "completed",
  "completed_empty",
  "error",
] as const;

export type ExportRequestState = (typeof EXPORT_REQUEST_STATES)[number];

export type DatasetAvailability = "AVAILABLE" | "UNAVAILABLE_EXTERNAL_GATE";

export type ExportUnavailableReason = "SLICE_NOT_PUBLISHED" | "READING_NOT_READY";

export type ExportDatasetId =
  | "accounts"
  | "categories"
  | "financial_events"
  | "account_entries"
  | "credit_cards"
  | "credit_card_billing_rules"
  | "credit_card_purchases"
  | "installment_plans"
  | "installments"
  | "recurring_rules"
  | "recurring_occurrences"
  | "planned_events"
  | "holidays"
  | "spendable_settings"
  | "budgets"
  | "budget_movements"
  | "budget_allocation_rules";

export interface ExportDatasetViewModel {
  readonly id: ExportDatasetId;
  /** Portuguese title; no accounting jargon. */
  readonly title: string;
  readonly description: string;
  readonly availability: DatasetAvailability;
  readonly unavailableReason?: ExportUnavailableReason;
  readonly rowCount?: number;
  readonly byteCount?: number;
}

export type ExportErrorCode =
  | "UNAUTHENTICATED"
  | "EXPORT_IN_PROGRESS"
  | "EXPORT_RATE_LIMITED"
  | "EXPORT_TIMEOUT"
  | "EXPORT_TOO_LARGE"
  | "EXPORT_UNAVAILABLE"
  | "EXPORT_FAILED";

export interface ExportOpaqueErrorViewModel {
  readonly code: ExportErrorCode;
  /** Opaque Portuguese message; never SQL, stack or provider detail. */
  readonly message: string;
  readonly correlationId?: string;
}

export interface ExportScreenViewModel {
  readonly contractVersion: typeof S11_CONTRACT_VERSION;
  readonly datasets: readonly ExportDatasetViewModel[];
  readonly state: ExportRequestState;
  readonly fileLabel?: string;
  readonly byteCountLabel?: string;
  readonly rowCountLabel?: string;
  readonly generatedAtLabel?: string;
  readonly error?: ExportOpaqueErrorViewModel;
}

/**
 * State → component responsibility (T10 / T11)
 *
 * | state            | T10 (screen shell)                         | T11 (feedback)                    |
 * | ---------------- | ------------------------------------------ | --------------------------------- |
 * | idle             | Page layout, copy, dataset list, CTA       | —                                 |
 * | generating       | Disable CTA, keep layout                   | LoadingState + generating label   |
 * | completed        | Keep layout                                | SuccessFeedback + download link   |
 * | completed_empty  | Keep layout                                | EmptyState (distinct from error)  |
 * | error            | Keep layout                                | ErrorState + opaque message       |
 */

export const EXPORT_SCREEN_EYEBROW = "Configurações" as const;
export const EXPORT_SCREEN_TITLE = "Seus dados" as const;
export const EXPORT_SCREEN_DESCRIPTION =
  "Baixar uma cópia dos dados do seu espaço financeiro em planilhas CSV, para guardar ou levar para outro lugar." as const;

export const EXPORT_INCLUDED_HEADING = "O que está incluído" as const;
export const EXPORT_INCLUDED_ITEMS = [
  "Contas, categorias e lançamentos do seu espaço financeiro.",
  "Cartões, parcelas, recorrências, compromissos e feriados configurados.",
  "Caixinhas e as configurações que você definiu.",
  "Um arquivo ZIP com planilhas CSV e um manifesto de resumo.",
] as const;

export const EXPORT_EXCLUDED_HEADING = "O que não está incluído" as const;
export const EXPORT_EXCLUDED_ITEMS = [
  "Senhas, tokens e dados de login.",
  "E-mails e nomes de outras pessoas do espaço.",
  "Sessões ativas e registros técnicos do sistema.",
  "Saldos calculados, projeções e visões consolidadas geradas na hora.",
] as const;

export const EXPORT_DATASETS_HEADING = "Conjuntos de dados" as const;

export const EXPORT_PRIMARY_ACTION_LABEL = "Baixar uma cópia" as const;
export const EXPORT_GENERATING_ACTION_LABEL = "Gerando cópia…" as const;

export const EXPORT_COMPLETED_TITLE = "Cópia pronta" as const;
export const EXPORT_COMPLETED_DESCRIPTION =
  "Seu arquivo está pronto para download. Guarde-o em um local seguro." as const;

export const EXPORT_COMPLETED_EMPTY_TITLE = "Nenhum dado para exportar" as const;
export const EXPORT_COMPLETED_EMPTY_DESCRIPTION =
  "Seu espaço financeiro ainda não tem registros. Os arquivos virão só com cabeçalhos até você começar a usar o app." as const;

export const EXPORT_DEFAULT_FILE_LABEL = "financas-gomes-export-s11v1.zip" as const;

export const EXPORT_UNAVAILABLE_DATASET_LABEL = "Indisponível nesta versão" as const;

export const EXPORT_UNAVAILABLE_REASON_LABELS: Record<
  ExportUnavailableReason,
  string
> = {
  SLICE_NOT_PUBLISHED:
    "Este conjunto ainda não está disponível nesta versão do app.",
  READING_NOT_READY:
    "Este conjunto não pôde ser lido agora. Tente exportar novamente mais tarde.",
};

export const EXPORT_DATASET_COPY: Record<
  ExportDatasetId,
  Pick<ExportDatasetViewModel, "title" | "description">
> = {
  accounts: {
    title: "Contas",
    description: "Contas que você cadastrou no espaço financeiro.",
  },
  categories: {
    title: "Categorias",
    description: "Categorias de receitas e despesas.",
  },
  financial_events: {
    title: "Lançamentos",
    description: "Registros de entradas, saídas e transferências.",
  },
  account_entries: {
    title: "Movimentações por conta",
    description: "Linhas que compõem cada lançamento nas contas.",
  },
  credit_cards: {
    title: "Cartões",
    description: "Cartões de crédito e limites configurados.",
  },
  credit_card_billing_rules: {
    title: "Regras de fatura",
    description: "Dias de fechamento e vencimento dos cartões.",
  },
  credit_card_purchases: {
    title: "Compras no cartão",
    description: "Compras parceladas vinculadas aos lançamentos.",
  },
  installment_plans: {
    title: "Planos de parcelamento",
    description: "Planos criados para compras parceladas.",
  },
  installments: {
    title: "Parcelas",
    description: "Parcelas geradas para cada plano.",
  },
  recurring_rules: {
    title: "Recorrências",
    description: "Compromissos que se repetem no tempo.",
  },
  recurring_occurrences: {
    title: "Ocorrências de recorrência",
    description: "Exceções e realizações das recorrências.",
  },
  planned_events: {
    title: "Compromissos avulsos",
    description: "Lembretes e eventos planejados fora da recorrência.",
  },
  holidays: {
    title: "Feriados",
    description: "Feriados personalizados do calendário.",
  },
  spendable_settings: {
    title: "Reserva operacional",
    description: "Valor de reserva que você configurou (não o cálculo do dia).",
  },
  budgets: {
    title: "Caixinhas",
    description: "Metas e envelopes que você criou.",
  },
  budget_movements: {
    title: "Movimentos de Caixinha",
    description: "Entradas e saídas registradas nas Caixinhas.",
  },
  budget_allocation_rules: {
    title: "Regras de alocação",
    description: "Pesos de distribuição entre Caixinhas.",
  },
};

export const EXPORT_ERROR_MESSAGES: Record<ExportErrorCode, string> = {
  UNAUTHENTICATED: "Faça login para baixar seus dados.",
  EXPORT_IN_PROGRESS:
    "Já existe uma exportação em andamento. Aguarde a conclusão.",
  EXPORT_RATE_LIMITED:
    "Aguarde um minuto antes de solicitar outra exportação.",
  EXPORT_TIMEOUT:
    "A exportação demorou mais do que o esperado. Tente novamente em instantes.",
  EXPORT_TOO_LARGE:
    "Seus dados ultrapassam o limite de tamanho para uma única exportação. Reduza o volume ou fale com o suporte.",
  EXPORT_UNAVAILABLE:
    "A exportação não está disponível no momento. Tente novamente mais tarde.",
  EXPORT_FAILED:
    "Não foi possível gerar sua cópia. Tente novamente.",
};

export const EXPORT_ERROR_CODES = [
  "UNAUTHENTICATED",
  "EXPORT_IN_PROGRESS",
  "EXPORT_RATE_LIMITED",
  "EXPORT_TIMEOUT",
  "EXPORT_TOO_LARGE",
  "EXPORT_UNAVAILABLE",
  "EXPORT_FAILED",
] as const satisfies readonly ExportErrorCode[];

/** Builds an opaque error view model from a closed code (T11). */
export function createExportOpaqueError(
  code: ExportErrorCode,
  correlationId?: string,
): ExportOpaqueErrorViewModel {
  return {
    code,
    message: EXPORT_ERROR_MESSAGES[code],
    ...(correlationId !== undefined ? { correlationId } : {}),
  };
}
