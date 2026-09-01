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
  toCreditCardErrorViewModel,
  type CreditCardScheduleItemViewModel,
  type CreditCardScheduleViewModel,
} from "./ui-contracts";

export type CreditCardScheduleSummaryState =
  | "loading"
  | "empty"
  | "ready"
  | "error"
  | "success";

export interface CreditCardScheduleSummaryProps {
  /** Schedule and totals are projections calculated by the server. */
  schedule?: CreditCardScheduleViewModel | null;
  state?: CreditCardScheduleSummaryState;
  /** Only the stable error code/field is used; raw text is never rendered. */
  error?: unknown;
  successMessage?: string;
  retryHref?: string;
  purchaseHref?: string;
  testId?: string;
  className?: string;
}

const STATUS_LABELS: Record<
  CreditCardScheduleItemViewModel["status"],
  string
> = {
  PLANNED: "Planejada",
  POSTED: "Confirmada",
  CANCELLED: "Cancelada",
};

const PROJECTION_LABELS: Record<
  CreditCardScheduleItemViewModel["state"],
  string
> = {
  PROJECTED: "Projetada",
  CONFIRMED: "Confirmada",
};

function formatCents(value: string): string {
  try {
    return formatMoneyBRL(value);
  } catch {
    // A malformed server response is not turned into a raw value in the UI.
    return "Valor indisponível";
  }
}

function ScheduleItemLabel({
  item,
}: {
  item: CreditCardScheduleItemViewModel;
}) {
  return (
    <span
      aria-label={`Parcela ${item.installmentNumber} de ${item.installmentCount}`}
      className="whitespace-nowrap"
    >
      {item.installmentNumber}/{item.installmentCount}
    </span>
  );
}

/**
 * Server-first schedule projection shared by the purchase and card details.
 * The component deliberately renders the supplied total and rows verbatim;
 * it never derives a total, cycle, due date, limit or invoice in the browser.
 */
export function CreditCardScheduleSummary({
  className,
  error,
  purchaseHref,
  retryHref,
  schedule,
  state = schedule ? "ready" : "empty",
  successMessage,
  testId = "credit-card-schedule-summary",
}: CreditCardScheduleSummaryProps) {
  if (state === "loading") {
    return (
      <LoadingState
        label="Carregando parcelamento…"
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

  if (state === "empty" || !schedule) {
    return (
      <EmptyState
        description="O schedule aparecerá depois que a compra for confirmada."
        testId={`${testId}-empty`}
        title="Nenhum parcelamento para exibir"
      />
    );
  }

  const columns = [
    {
      key: "installment",
      header: "Parcela",
      render: (item: CreditCardScheduleItemViewModel) => (
        <ScheduleItemLabel item={item} />
      ),
    },
    {
      key: "amount",
      header: "Valor",
      render: (item: CreditCardScheduleItemViewModel) => (
        <span
          aria-label={`Valor ${formatCents(item.amountCents)}`}
          className="whitespace-nowrap font-semibold tabular-nums"
        >
          {formatCents(item.amountCents)}
        </span>
      ),
    },
    {
      key: "cycle",
      header: "Competência",
      render: (item: CreditCardScheduleItemViewModel) => item.billingCycle,
    },
    {
      key: "dueOn",
      header: "Vencimento",
      render: (item: CreditCardScheduleItemViewModel) => item.dueOn,
    },
    {
      key: "state",
      header: "Estado",
      render: (item: CreditCardScheduleItemViewModel) => (
        <span className="inline-flex flex-wrap gap-1">
          <span>{PROJECTION_LABELS[item.state]}</span>
          <span className="text-muted-foreground">
            ({STATUS_LABELS[item.status]})
          </span>
        </span>
      ),
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
            Schedule
          </p>
          <h2 className="mt-1 text-xl font-semibold" id={`${testId}-title`}>
            Resumo do parcelamento
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Datas, competências e estados foram calculados pelo servidor.
          </p>
        </div>
        {purchaseHref ? (
          <Link
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={purchaseHref}
          >
            Ver compra
          </Link>
        ) : null}
      </div>

      <dl
        aria-label="Totais do parcelamento"
        className="grid gap-3 sm:grid-cols-2"
        data-testid={`${testId}-totals`}
      >
        <div className="rounded-lg border bg-background px-4 py-3">
          <dt className="text-xs text-muted-foreground">Total da compra</dt>
          <dd
            aria-label={`Total da compra ${formatCents(schedule.totalAmountCents)}`}
            className="mt-1 text-lg font-semibold tabular-nums"
          >
            {formatCents(schedule.totalAmountCents)}
          </dd>
        </div>
        <div className="rounded-lg border bg-background px-4 py-3">
          <dt className="text-xs text-muted-foreground">Quantidade de parcelas</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {schedule.installmentCount}
          </dd>
        </div>
      </dl>

      <DataTable
        caption="Schedule calculado do parcelamento"
        columns={columns}
        getRowKey={(item) => item.id}
        rows={schedule.items}
        testId={`${testId}-table`}
      />
    </section>
  );
}

export const ScheduleSummary = CreditCardScheduleSummary;
export const CreditCardSchedule = CreditCardScheduleSummary;
