import type {
  SpendableBreakdown as SpendableBreakdownValue,
} from "@/modules/spendable/contracts";
import {
  toSpendableBreakdownViewModel,
  toSpendableErrorViewModel,
  type SpendableBreakdownViewModel,
  type SpendableCausalItemViewModel,
  type SpendableReadModelState,
} from "@/modules/spendable/ui-contracts";
import { cn } from "@/lib/utils";

import { SpendableOriginLink } from "./spendable-badges";
import {
  SpendableEmptyState,
  SpendableErrorState,
  SpendableLoadingState,
} from "./spendable-states";

export interface SpendableBreakdownProps {
  breakdown?: SpendableBreakdownValue | SpendableBreakdownViewModel | null;
  state?: SpendableReadModelState;
  error?: unknown;
  retryHref?: string;
  /** Server-authorized resolver; no route is built from a reference ID. */
  getOriginHref?: (
    item: SpendableCausalItemViewModel["item"],
  ) => string | null | undefined;
  /** Serializable alternative for server components. */
  sourceHrefs?: Readonly<Record<string, string>>;
  returnHref?: string;
  testId?: string;
  className?: string;
}

function toViewModel(
  value: SpendableBreakdownProps["breakdown"],
): SpendableBreakdownViewModel | null {
  if (!value) return null;
  return "breakdown" in value ? value : toSpendableBreakdownViewModel(value);
}

function FormulaMetric({
  description,
  label,
  testId,
  value,
}: {
  description: string;
  label: string;
  testId: string;
  value: string;
}) {
  return (
    <div
      className="rounded-xl border bg-background px-4 py-3"
      data-testid={testId}
    >
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd
        aria-label={`${label}: ${value}`}
        className="mt-1 text-lg font-semibold tabular-nums"
      >
        {value}
      </dd>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

function CausalItem({
  item,
  getOriginHref,
  returnHref,
  sourceHrefs,
  testId,
}: {
  item: SpendableCausalItemViewModel;
  getOriginHref?: SpendableBreakdownProps["getOriginHref"];
  returnHref?: string;
  sourceHrefs?: Readonly<Record<string, string>>;
  testId: string;
}) {
  const originHref = getOriginHref?.(item.item) ?? sourceHrefs?.[item.item.referenceId];

  return (
    <li className="rounded-xl border bg-background p-4" data-testid={testId}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
              Origem: {item.sourceKindLabel}
            </span>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
              Tipo: {item.directionLabel}
            </span>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
              Certeza: {item.certaintyLabel}
            </span>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
              Estado: {item.statusLabel}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Data do compromisso: {item.dateLabel}
          </p>
          {originHref ? (
            <SpendableOriginLink
              href={originHref}
              returnHref={returnHref}
              testId={`${testId}-origin`}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Origem removida, cancelada ou indisponível para detalhamento
              autorizado.
            </p>
          )}
        </div>
        <strong
          aria-label={`${item.directionLabel}: ${item.amountLabel}`}
          className="whitespace-nowrap text-lg font-semibold tabular-nums"
        >
          {item.amountLabel}
        </strong>
      </div>
    </li>
  );
}

function CausalPoint({
  point,
  getOriginHref,
  returnHref,
  sourceHrefs,
  testId,
}: {
  point: SpendableBreakdownViewModel["minimumPoints"][number];
  getOriginHref?: SpendableBreakdownProps["getOriginHref"];
  returnHref?: string;
  sourceHrefs?: Readonly<Record<string, string>>;
  testId: string;
}) {
  const pointId = `${testId}-point`;
  return (
    <li className="space-y-3" data-testid={testId}>
      <article
        aria-labelledby={`${pointId}-title`}
        className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
      >
        <header className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {point.kindLabel}
            </p>
            <h3 className="mt-1 text-lg font-semibold" id={`${pointId}-title`}>
              {point.dateLabel}
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Saldo projetado: {point.projectedBalanceLabel}
          </p>
        </header>

        <div className="space-y-4 pt-4">
          <p className="text-sm text-muted-foreground">
            {point.referenceCountLabel}. A lista representa o(s) ponto(s) que
            empatam no menor saldo projetado.
          </p>
          {point.items.length > 0 ? (
            <ul
              aria-label={`Itens causais de ${point.dateLabel}`}
              className="space-y-2"
            >
              {point.items.map((item, itemIndex) => (
                <CausalItem
                  getOriginHref={getOriginHref}
                  item={item}
                  key={`${item.item.referenceId}-${itemIndex}`}
                  returnHref={returnHref}
                  sourceHrefs={sourceHrefs}
                  testId={`${testId}-item-${itemIndex}`}
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
              Nenhum item causal foi associado a este ponto. Quando o ponto é a
              abertura sem ajuste, isso significa que a própria posição de
              abertura é o mínimo.
            </p>
          )}
        </div>
      </article>
    </li>
  );
}

/**
 * Accessible explanation of the server breakdown.  It presents each field
 * verbatim and delegates origin navigation to a server-authorized href.
 */
export function SpendableBreakdownView({
  breakdown,
  className,
  error,
  getOriginHref,
  retryHref,
  returnHref,
  sourceHrefs,
  state,
  testId = "spendable-breakdown",
}: SpendableBreakdownProps) {
  const model = toViewModel(breakdown);
  const resolvedState: SpendableReadModelState =
    state ?? (model ? "ready" : "empty");

  if (resolvedState === "loading") {
    return <SpendableLoadingState testId={`${testId}-loading`} />;
  }

  if (resolvedState === "error") {
    const safeError = toSpendableErrorViewModel(error);
    return (
      <SpendableErrorState
        error={safeError}
        retryHref={retryHref}
        testId={`${testId}-error`}
      />
    );
  }

  if (resolvedState === "empty" || !model) {
    return (
      <SpendableEmptyState
        description="A composição aparecerá quando a disponibilidade for calculada para um período válido."
        testId={`${testId}-empty`}
        title="Nenhuma composição para exibir"
      />
    );
  }

  const { breakdown: readModel } = model;
  return (
    <section
      aria-describedby={`${testId}-description`}
      aria-labelledby={`${testId}-title`}
      className={cn("space-y-5", className)}
      data-state={model.availabilityStatus}
      data-testid={testId}
    >
      <header>
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Composição · cenário {model.scenarioLabel}
        </p>
        <h2 className="mt-1 text-xl font-semibold" id={`${testId}-title`}>
          Como a disponibilidade foi encontrada
        </h2>
        <p
          className="mt-1 text-sm leading-6 text-muted-foreground"
          id={`${testId}-description`}
        >
          {model.periodLabel} · referência em {model.asOfLabel} · horizonte de {model.horizonLabel}.
          Os valores abaixo são fornecidos pelo servidor em centavos e apenas
          formatados para leitura.
        </p>
      </header>

      <dl
        aria-label="Componentes do cálculo de disponibilidade"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <FormulaMetric
          description="Entries POSTED de contas GENERAL até a data de referência."
          label="Saldo de referência"
          testId={`${testId}-metric-opening-balance`}
          value={model.openingBalanceLabel}
        />
        <FormulaMetric
          description="Compromissos ativos anteriores ao primeiro dia projetado, incluindo o ajuste de reserva aplicado."
          label="Ajustes de abertura"
          testId={`${testId}-metric-opening-adjustments`}
          value={model.openingAdjustmentsLabel}
        />
        <FormulaMetric
          description="Saldo inicial somado aos ajustes recebidos do engine."
          label="Saldo de abertura projetado"
          testId={`${testId}-metric-opening-projected`}
          value={model.openingProjectedBalanceLabel}
        />
        <FormulaMetric
          description="Menor saldo entre a abertura e os fechamentos diários."
          label="Menor saldo projetado"
          testId={`${testId}-metric-minimum`}
          value={model.minimumProjectedBalanceLabel}
        />
        <FormulaMetric
          description={`Buffer absoluto: ${model.bufferSourceLabel}; vigente desde ${model.bufferEffectiveFromLabel}.`}
          label="Buffer operacional"
          testId={`${testId}-metric-buffer`}
          value={model.bufferAmountLabel}
        />
        <FormulaMetric
          description="Valor antes do limite de zero usado no indicador principal."
          label="Disponível bruto"
          testId={`${testId}-metric-raw`}
          value={model.rawSpendableLabel}
        />
        <FormulaMetric
          description="Valor exibido no card, preservando zero quando há déficit."
          label="Disponível exibido"
          testId={`${testId}-metric-display`}
          value={model.displaySpendableLabel}
        />
        <FormulaMetric
          description="Quantia necessária para recompor o buffer quando o bruto é negativo."
          label="Déficit para preservar a reserva"
          testId={`${testId}-metric-deficit`}
          value={model.deficitToPreserveReserveLabel}
        />
        <FormulaMetric
          description="Saldo projetado ao final do horizonte recebido."
          label="Saldo final projetado"
          testId={`${testId}-metric-closing`}
          value={model.closingProjectedBalanceLabel}
        />
      </dl>

      <section
        aria-labelledby={`${testId}-reconciliation-title`}
        className="rounded-xl border bg-background p-4"
        data-testid={`${testId}-reconciliation`}
      >
        <h3 className="font-semibold" id={`${testId}-reconciliation-title`}>
          Reconciliação com o card
        </h3>
        <div className="mt-3 space-y-2 text-sm leading-6">
          <p>
            Menor saldo projetado ({model.minimumProjectedBalanceLabel}) menos
            buffer operacional ({model.bufferAmountLabel}) = disponível bruto
            ({model.rawSpendableLabel}).
          </p>
          <p>
            Aplicação do limite de zero: disponível exibido no card = máximo de
            zero e disponível bruto = {model.displaySpendableLabel}.
            {model.availabilityStatus === "deficit"
              ? ` O déficit para preservar a reserva é ${model.deficitToPreserveReserveLabel}.`
              : " Não há déficit para preservar a reserva."}
          </p>
        </div>
      </section>

      <section
        aria-labelledby={`${testId}-reserve-title`}
        className="rounded-xl border bg-background p-4"
        data-testid={`${testId}-reserve`}
      >
        <h3 className="font-semibold" id={`${testId}-reserve-title`}>
          Reserva
        </h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted-foreground">Estado</dt>
            <dd className="mt-1 text-sm font-medium">{model.reserveStatusLabel}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Protegido</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums">
              {model.reserveProtectedLabel}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Ajuste aplicado na abertura</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums">
              {model.reserveAppliedOpeningAdjustmentLabel}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby={`${testId}-minimum-title`}>
        <header>
          <h3 className="text-lg font-semibold" id={`${testId}-minimum-title`}>
            Pontos que explicam o menor saldo
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Todos os pontos empatados são apresentados em ordem recebida do
            servidor; nenhuma origem é buscada ou inferida no navegador.
          </p>
        </header>
        {model.causalPageInfo ? (
          <p
            aria-live="polite"
            className="mt-3 rounded-lg border bg-background px-3 py-3 text-sm text-muted-foreground"
            data-testid={`${testId}-causal-page-info`}
          >
            {model.causalPageInfo.truncated
              ? `Exibindo ${model.causalPageInfo.returnedCount} de ${model.causalPageInfo.totalCount} itens causais. A lista está truncada por segurança; o cálculo continua baseado no conjunto completo.`
              : `Exibindo todos os ${model.causalPageInfo.totalCount} itens causais retornados pelo servidor.`}
            {model.causalPageInfo.nextCursor ? (
              <span className="ml-1">
                Há mais itens causais disponíveis em uma consulta autorizada.
              </span>
            ) : null}
          </p>
        ) : null}
        {model.minimumPoints.length > 0 ? (
          <ol className="mt-4 space-y-4" data-testid={`${testId}-points`}>
            {model.minimumPoints.map((point, index) => (
              <CausalPoint
                getOriginHref={getOriginHref}
                key={`${point.point.kind}-${point.point.date}-${index}`}
                point={point}
                returnHref={returnHref}
                sourceHrefs={sourceHrefs}
                testId={`${testId}-point-${index}`}
              />
            ))}
          </ol>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            O servidor não retornou pontos causais para este resultado.
          </p>
        )}
      </section>

      <p className="text-xs leading-5 text-muted-foreground">
        Contratos {readModel.contractVersion} e {readModel.ruleVersion}. Uma
        origem pode deixar de estar disponível; nesse caso o valor e o ponto
        continuam legíveis, mas o detalhamento não é criado pelo client.
      </p>
    </section>
  );
}

export const SpendableBreakdown = SpendableBreakdownView;
export const AvailableToSpendBreakdown = SpendableBreakdownView;
