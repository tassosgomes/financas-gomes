import Link from "next/link";

import { ForecastSourceBadge } from "./forecast-badges";
import { ForecastOriginMaintenance } from "./forecast-origin-maintenance";
import {
  formatForecastDate,
  formatForecastMoney,
} from "@/modules/forecast/ui-contracts";
import type { ForecastOriginDetail } from "@/modules/forecast/origin-contracts";

const ACTION_STATUS = {
  enabled: "Disponível",
  disabled: "Indisponível",
} as const;

function statusLabel(status: ForecastOriginDetail["status"]): string {
  return {
    PLANNED: "Planejado",
    EXPECTED: "Esperado",
    POSTED: "Realizado",
    CANCELLED: "Cancelado",
  }[status];
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}

function RecurringDetails({ detail }: { detail: ForecastOriginDetail }) {
  const recurring = detail.recurring;
  if (!recurring) return null;
  return (
    <dl className="grid gap-4 sm:grid-cols-2" data-testid="forecast-recurring-origin-details">
      <DetailRow label="Tipo" value={recurring.kind === "INCOME" ? "Receita" : "Despesa"} />
      <DetailRow label="Frequência" value={recurring.frequency === "MONTHLY" ? "Mensal" : "Anual"} />
      <DetailRow label="Valor" value={formatForecastMoney(recurring.amountCents)} />
      <DetailRow label="Vigência" value={`${formatForecastDate(recurring.startOn)}${recurring.endOn ? ` a ${formatForecastDate(recurring.endOn)}` : " em diante"}`} />
      <DetailRow label="Ocorrência" value={recurring.occurrenceKey ?? "Regra sem ocorrência específica"} />
      <DetailRow label="Data esperada" value={recurring.expectedOn ? formatForecastDate(recurring.expectedOn) : "Calculada pela regra"} />
      {recurring.financialEventId ? (
        <DetailRow
          label="Realização"
          value={
            <Link className="underline-offset-4 hover:underline" href={`/transactions/${encodeURIComponent(recurring.financialEventId)}`}>
              Abrir lançamento POSTED
            </Link>
          }
        />
      ) : null}
    </dl>
  );
}

function PlannedEventDetails({ detail }: { detail: ForecastOriginDetail }) {
  const planned = detail.plannedEvent;
  if (!planned) return null;
  return (
    <dl className="grid gap-4 sm:grid-cols-2" data-testid="forecast-planned-origin-details">
      <DetailRow label="Tipo" value={planned.kind === "INCOME" ? "Receita" : "Despesa"} />
      <DetailRow label="Valor" value={formatForecastMoney(planned.amountCents)} />
      <DetailRow label="Data esperada" value={formatForecastDate(planned.expectedOn)} />
      <DetailRow label="Identificador" value="Evento planejado preservado no servidor" />
      {planned.financialEventId ? (
        <DetailRow
          label="Realização"
          value={
            <Link className="underline-offset-4 hover:underline" href={`/transactions/${encodeURIComponent(planned.financialEventId)}`}>
              Abrir lançamento POSTED
            </Link>
          }
        />
      ) : null}
    </dl>
  );
}

function InstallmentDetails({ detail }: { detail: ForecastOriginDetail }) {
  const installment = detail.installment;
  if (!installment) return null;
  return (
    <div className="space-y-4" data-testid="forecast-installment-origin-details">
      <dl className="grid gap-4 sm:grid-cols-2">
        <DetailRow label="Valor da parcela" value={formatForecastMoney(installment.amountCents)} />
        <DetailRow label="Parcela" value={`${installment.sequence} de ${installment.installmentCount}`} />
        <DetailRow label="Competência" value={installment.billingCycle} />
        <DetailRow label="Vencimento" value={formatForecastDate(installment.dueOn)} />
      </dl>
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        Esta linha pertence à compra agregada. Pagamento e edição de parcela isolada não são permitidos.
      </div>
      <Link
        className="inline-flex min-h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="forecast-installment-purchase-link"
        href={installment.purchaseHref}
      >
        Abrir compra/fatura
      </Link>
    </div>
  );
}

function RealizedEventDetails({ detail }: { detail: ForecastOriginDetail }) {
  const event = detail.realizedEvent;
  if (!event) return null;
  return (
    <dl className="grid gap-4 sm:grid-cols-2" data-testid="forecast-realized-origin-details">
      <DetailRow label="Tipo" value={event.kind === "INCOME" ? "Receita" : "Despesa"} />
      <DetailRow label="Valor" value={formatForecastMoney(event.amountCents)} />
      <DetailRow label="Data econômica" value={formatForecastDate(event.occurredOn)} />
      <DetailRow
        label="Lançamento"
        value={
          <Link className="underline-offset-4 hover:underline" href={event.transactionHref}>
            Abrir lançamento
          </Link>
        }
      />
    </dl>
  );
}

export function ForecastOriginDetailView({
  backHref,
  detail,
}: {
  backHref: string;
  detail: ForecastOriginDetail;
}) {
  return (
    <section className="space-y-6" data-testid="forecast-origin-detail">
      <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <ForecastSourceBadge source={detail.kind} />
              <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
                Estado: {statusLabel(detail.status)}
              </span>
            </div>
            <h2 className="text-2xl font-semibold">{detail.label}</h2>
            <p className="text-sm text-muted-foreground">
              A origem foi resolvida no seu espaço financeiro; a referência permanece opaca para o navegador.
            </p>
          </div>
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="forecast-origin-back"
            href={backHref}
          >
            Voltar à projeção
          </Link>
        </div>
        <div className="space-y-5 pt-5">
          <RecurringDetails detail={detail} />
          <PlannedEventDetails detail={detail} />
          <InstallmentDetails detail={detail} />
          <RealizedEventDetails detail={detail} />
          {detail.kind !== "INSTALLMENT" && detail.kind !== "REALIZED_EVENT" ? (
            <div className="border-t pt-5">
              <p className="text-sm font-medium">Ações da origem</p>
              <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2" data-testid="forecast-origin-action-list">
                {detail.actions.map((candidate) => (
                  <li className="rounded-lg border px-3 py-2" key={candidate.operation}>
                    <span className="font-medium">{candidate.label}</span>
                    <span className="mt-1 block text-muted-foreground">
                      {candidate.enabled ? ACTION_STATUS.enabled : candidate.reason ?? ACTION_STATUS.disabled}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
      <ForecastOriginMaintenance detail={detail} />
    </section>
  );
}
