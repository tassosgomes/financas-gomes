import Link from "next/link";

import { DataTable } from "@/components/ui/data-table";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SuccessFeedback,
} from "@/components/ui/async-state";
import { formatMoneyBRL } from "@/modules/transactions/money";

import {
  creditCardPurchaseHref,
  toCreditCardErrorViewModel,
  type CreditCardPaymentStatusViewModel,
  type CreditCardProjectionSummaryViewModel,
  type CreditCardStatementItemViewModel,
  type CreditCardStatementViewModel,
} from "./ui-contracts";

/** States shared by server-rendered S06 read-model islands. */
export type CreditCardReadModelState =
  | "loading"
  | "empty"
  | "ready"
  | "error"
  | "success";

export interface CreditCardStatementSummaryProps {
  /** Statement and its total are projections calculated by the server. */
  statement?: CreditCardStatementViewModel | null;
  state?: CreditCardReadModelState;
  /** Only the stable error code/field is used; raw text is never rendered. */
  error?: unknown;
  retryHref?: string;
  /** An opaque card ID used only to build origin links. */
  cardId?: string;
  successMessage?: string;
  testId?: string;
  className?: string;
}

const STATEMENT_KIND_LABELS: Record<
  CreditCardStatementViewModel["kind"],
  string
> = {
  CURRENT: "Fatura atual",
  FUTURE: "Fatura futura",
};

const STATEMENT_STATE_LABELS: Record<
  CreditCardStatementItemViewModel["state"],
  string
> = {
  PROJECTED: "Projetada",
  CONFIRMED: "Confirmada",
};

function formatCents(value: string): string {
  try {
    return formatMoneyBRL(value);
  } catch {
    // A malformed server response is not exposed as a raw value.
    return "Valor indisponível";
  }
}

function statementItemLabel(item: CreditCardStatementItemViewModel): string {
  if (item.installmentNumber === null || item.installmentCount === null) {
    return "À vista";
  }

  return `${item.installmentNumber}/${item.installmentCount}`;
}

function statementItemOrigin(
  item: CreditCardStatementItemViewModel,
  cardId: string | undefined,
): React.ReactNode {
  if (!cardId) {
    return item.description;
  }

  return (
    <Link
      className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      href={creditCardPurchaseHref(cardId, item.purchaseId)}
    >
      {item.description}
    </Link>
  );
}

/**
 * Renders one current/future statement projection. It never sums rows or
 * derives due dates in the browser: all displayed totals and dates come from
 * the server read model.
 */
export function CreditCardStatementSummary({
  cardId,
  className,
  error,
  retryHref,
  statement,
  state = statement ? "ready" : "empty",
  successMessage,
  testId = "credit-card-statement-summary",
}: CreditCardStatementSummaryProps) {
  if (state === "loading") {
    return (
      <LoadingState
        label="Carregando fatura…"
        testId={`${testId}-loading`}
      />
    );
  }

  if (state === "error") {
    const safeError = toCreditCardErrorViewModel(error, "RETRYABLE_ERROR");
    return (
      <ErrorState
        message={safeError.message}
        retryHref={retryHref}
        testId={`${testId}-error`}
      />
    );
  }

  if (state === "empty" || !statement) {
    return (
      <EmptyState
        description="Os itens aparecerão quando houver compras nesta competência."
        testId={`${testId}-empty`}
        title="Nenhuma fatura para exibir"
      />
    );
  }

  const kindLabel = STATEMENT_KIND_LABELS[statement.kind];
  const columns = [
    {
      key: "origin",
      header: "Compra",
      render: (item: CreditCardStatementItemViewModel) =>
        statementItemOrigin(item, cardId),
    },
    {
      key: "amount",
      header: "Valor da cobrança",
      render: (item: CreditCardStatementItemViewModel) => (
        <span
          aria-label={`Valor da cobrança ${formatCents(item.amountCents)}`}
          className="whitespace-nowrap font-semibold tabular-nums"
        >
          {formatCents(item.amountCents)}
        </span>
      ),
    },
    {
      key: "installment",
      header: "Parcela",
      render: (item: CreditCardStatementItemViewModel) => (
        <span
          aria-label={
            item.installmentNumber === null
              ? "Compra à vista"
              : `Parcela ${item.installmentNumber} de ${item.installmentCount}`
          }
          className="whitespace-nowrap"
        >
          {statementItemLabel(item)}
        </span>
      ),
    },
    {
      key: "cycle",
      header: "Competência",
      render: (item: CreditCardStatementItemViewModel) => item.billingCycle,
    },
    {
      key: "dueOn",
      header: "Vencimento",
      render: (item: CreditCardStatementItemViewModel) => item.dueOn,
    },
    {
      key: "state",
      header: "Estado da cobrança",
      render: (item: CreditCardStatementItemViewModel) =>
        STATEMENT_STATE_LABELS[item.state],
    },
  ] as const;

  return (
    <section
      aria-labelledby={`${testId}-title`}
      className={`space-y-5 rounded-2xl border bg-card p-5 shadow-sm sm:p-6${className ? ` ${className}` : ""}`}
      data-testid={testId}
    >
      {state === "success" && successMessage ? (
        <SuccessFeedback
          message={successMessage}
          testId={`${testId}-success`}
        />
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {kindLabel}
          </p>
          <h2 className="mt-1 text-xl font-semibold" id={`${testId}-title`}>
            {kindLabel} — {statement.period}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Itens calculados pelo servidor para esta competência.
          </p>
        </div>
        <dl className="rounded-lg border bg-background px-4 py-3 text-right">
          <dt className="text-xs text-muted-foreground">Total da fatura</dt>
          <dd
            aria-label={`Total da fatura ${formatCents(statement.totalAmountCents)}`}
            className="mt-1 text-lg font-semibold tabular-nums"
          >
            {formatCents(statement.totalAmountCents)}
          </dd>
          <dt className="mt-2 text-xs text-muted-foreground">Vencimento</dt>
          <dd className="mt-1 text-sm font-medium">
            {statement.dueOn ?? "Não informado"}
          </dd>
        </dl>
      </div>

      <DataTable
        caption={`${kindLabel} da competência ${statement.period}`}
        columns={columns}
        getRowKey={(item) => item.referenceId}
        rows={statement.items}
        testId={`${testId}-table`}
      />
    </section>
  );
}

export interface CreditCardStatementsOverviewProps {
  current?: CreditCardStatementViewModel | null;
  future?: readonly CreditCardStatementViewModel[];
  state?: CreditCardReadModelState;
  error?: unknown;
  retryHref?: string;
  cardId?: string;
  testId?: string;
}

/**
 * Optional collection wrapper for a detail page. Current and future periods
 * remain separate projections, making the distinction explicit to assistive
 * technology and to downstream screens.
 */
export function CreditCardStatementsOverview({
  cardId,
  current,
  error,
  future = [],
  retryHref,
  state = "ready",
  testId = "credit-card-statements-overview",
}: CreditCardStatementsOverviewProps) {
  if (state === "loading" || state === "error") {
    return (
      <CreditCardStatementSummary
        cardId={cardId}
        error={error}
        retryHref={retryHref}
        state={state}
        testId={`${testId}-current`}
      />
    );
  }

  const statements = [
    ...(current ? [{ statement: current, testId: `${testId}-current` }] : []),
    ...future.map((statement, index) => ({
      statement,
      testId: `${testId}-future-${index}`,
    })),
  ];

  if (statements.length === 0) {
    return (
      <CreditCardStatementSummary
        cardId={cardId}
        state="empty"
        testId={`${testId}-empty`}
      />
    );
  }

  return (
    <div className="space-y-5" data-testid={testId}>
      {statements.map(({ statement, testId: statementTestId }) => (
        <CreditCardStatementSummary
          cardId={cardId}
          key={`${statement.kind}-${statement.period}`}
          statement={statement}
          testId={statementTestId}
        />
      ))}
    </div>
  );
}

const PROJECTION_CARDS: readonly {
  key: keyof CreditCardProjectionSummaryViewModel;
  label: string;
  description: string;
}[] = [
  {
    key: "currentStatementAmountCents",
    label: "Fatura atual",
    description: "Total da competência em acompanhamento.",
  },
  {
    key: "projectedStatementAmountCents",
    label: "Faturas futuras projetadas",
    description: "Cobranças de competências futuras já materializadas.",
  },
  {
    key: "outstandingCardObligationCents",
    label: "Obrigação contratual",
    description: "Compromisso ativo total das compras do cartão.",
  },
  {
    key: "committedCreditLimitCents",
    label: "Limite comprometido",
    description: "Parte do limite contratual comprometida.",
  },
  {
    key: "availableCreditLimitCents",
    label: "Limite disponível",
    description: "Projeção disponível do limite contratual.",
  },
  {
    key: "cardCreditBalanceCents",
    label: "Saldo credor",
    description: "Crédito de pagamentos acima da obrigação.",
  },
];

export interface CreditCardProjectionSummaryProps {
  summary?: CreditCardProjectionSummaryViewModel | null;
  state?: CreditCardReadModelState;
  error?: unknown;
  retryHref?: string;
  testId?: string;
  className?: string;
}

/**
 * Displays the six explicitly different S06 projections. No value is derived
 * from another card in this component; each amount is server-provided.
 */
export function CreditCardProjectionSummary({
  className,
  error,
  retryHref,
  state = "ready",
  summary,
  testId = "credit-card-projection-summary",
}: CreditCardProjectionSummaryProps) {
  if (state === "loading") {
    return (
      <LoadingState
        label="Carregando projeções do cartão…"
        testId={`${testId}-loading`}
      />
    );
  }

  if (state === "error") {
    const safeError = toCreditCardErrorViewModel(error, "RETRYABLE_ERROR");
    return (
      <ErrorState
        message={safeError.message}
        retryHref={retryHref}
        testId={`${testId}-error`}
      />
    );
  }

  if (state === "empty" || !summary) {
    return (
      <EmptyState
        description="As projeções aparecerão depois que o cartão tiver movimentações."
        testId={`${testId}-empty`}
        title="Nenhuma projeção para exibir"
      />
    );
  }

  return (
    <section
      aria-labelledby={`${testId}-title`}
      className={`space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6${className ? ` ${className}` : ""}`}
      data-testid={testId}
    >
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Projeções do cartão
        </p>
        <h2 className="mt-1 text-xl font-semibold" id={`${testId}-title`}>
          Fatura, obrigação e crédito
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Valores separados conforme a posição calculada em {summary.asOf}.
        </p>
      </div>
      <dl
        aria-label="Projeções financeiras distintas do cartão"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        data-testid={`${testId}-cards`}
      >
        {PROJECTION_CARDS.map(({ description, key, label }) => (
          <div className="rounded-lg border bg-background px-4 py-3" key={key}>
            <dt className="text-sm font-medium">{label}</dt>
            <dd
              aria-label={`${label}: ${formatCents(summary[key])}`}
              className="mt-1 text-lg font-semibold tabular-nums"
            >
              {formatCents(summary[key])}
            </dd>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          </div>
        ))}
      </dl>
    </section>
  );
}

const PAYMENT_STATE_LABELS: Record<
  CreditCardPaymentStatusViewModel["state"],
  string
> = {
  UNPAID: "Não paga",
  PARTIALLY_PAID: "Parcialmente paga",
  PAID: "Paga",
  CREDIT: "Saldo credor",
};

export interface CreditCardPaymentStatusProps {
  status?: CreditCardPaymentStatusViewModel | null;
  state?: CreditCardReadModelState;
  error?: unknown;
  retryHref?: string;
  testId?: string;
}

/**
 * Payment status is global to the card. The explanatory copy intentionally
 * makes clear that no individual installment is payable from this boundary.
 */
export function CreditCardPaymentStatus({
  error,
  retryHref,
  state = "ready",
  status,
  testId = "credit-card-payment-status",
}: CreditCardPaymentStatusProps) {
  if (state === "loading") {
    return (
      <LoadingState
        label="Carregando estado de pagamento…"
        testId={`${testId}-loading`}
      />
    );
  }

  if (state === "error") {
    const safeError = toCreditCardErrorViewModel(error, "RETRYABLE_ERROR");
    return (
      <ErrorState
        message={safeError.message}
        retryHref={retryHref}
        testId={`${testId}-error`}
      />
    );
  }

  if (state === "empty" || !status) {
    return (
      <EmptyState
        description="O estado será calculado quando houver uma fatura para acompanhar."
        testId={`${testId}-empty`}
        title="Nenhum pagamento para exibir"
      />
    );
  }

  const stateLabel = PAYMENT_STATE_LABELS[status.state];
  return (
    <section
      aria-labelledby={`${testId}-title`}
      className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
      data-testid={testId}
    >
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Pagamento global
        </p>
        <h2 className="mt-1 text-xl font-semibold" id={`${testId}-title`}>
          Estado da fatura: {stateLabel}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          O pagamento é registrado no cartão como um todo; nenhuma parcela é
          paga isoladamente.
        </p>
      </div>
      <dl
        aria-label="Valores do pagamento global da fatura"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="rounded-lg border bg-background px-4 py-3">
          <dt className="text-sm font-medium">Total da fatura</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {formatCents(status.statementAmountCents)}
          </dd>
        </div>
        <div className="rounded-lg border bg-background px-4 py-3">
          <dt className="text-sm font-medium">Total pago</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {formatCents(status.paidAmountCents)}
          </dd>
        </div>
        <div className="rounded-lg border bg-background px-4 py-3">
          <dt className="text-sm font-medium">Restante da fatura</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {formatCents(status.remainingAmountCents)}
          </dd>
        </div>
        <div className="rounded-lg border bg-background px-4 py-3">
          <dt className="text-sm font-medium">Crédito disponível</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {formatCents(status.creditAmountCents)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** Naming aliases keep the shared boundary discoverable by T12–T14. */
export const CreditCardStatement = CreditCardStatementSummary;
export const StatementSummary = CreditCardStatementSummary;
export const CreditCardInvoice = CreditCardStatementSummary;
export const CreditCardStatements = CreditCardStatementsOverview;
export const CreditCardProjectionCards = CreditCardProjectionSummary;
export const ProjectionSummary = CreditCardProjectionSummary;
export const PaymentStatus = CreditCardPaymentStatus;
