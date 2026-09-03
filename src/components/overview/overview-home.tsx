import { InviteShareCard } from "@/components/households/invite-share-card";
import { SpendableCard } from "@/components/spendable";
import { ErrorState } from "@/components/ui/async-state";
import { TransactionCreateEntryPoints } from "@/components/transactions/transaction-create-entry-points";
import type { OverviewCommitmentItem } from "@/modules/overview/contracts";
import { AUTHENTICATED_ROUTE } from "@/modules/auth/routes";
import { buildOverviewLinks } from "@/modules/overview/links";
import type { OverviewReadModel } from "@/modules/overview/contracts";
import {
  OVERVIEW_ALERTS_TITLE,
  OVERVIEW_CAIXINHAS_TITLE,
  OVERVIEW_CATEGORIES_TITLE,
  OVERVIEW_COMMITMENTS_TITLE,
  OVERVIEW_INCOME_UPCOMING_TITLE,
  OVERVIEW_INVOICES_TITLE,
  OVERVIEW_PAGE_TITLE,
  OVERVIEW_PERIOD_SUMMARY_TITLE,
  OVERVIEW_TEST_IDS,
  OVERVIEW_VIEW_ALL_LABEL,
  toOverviewAlertViewModel,
  toOverviewCaixinhaItemViewModel,
  toOverviewCardInvoiceItemViewModel,
  toOverviewCategoryGroupViewModel,
  toOverviewCommitmentItemViewModel,
  toOverviewPeriodSummaryViewModel,
  toOverviewPeriodViewModel,
  toOverviewErrorViewModel,
} from "@/modules/overview/ui-contracts";

import { OverviewCategoryBar } from "./overview-category-bar";
import { OverviewDrilldownLink } from "./overview-drilldown-link";
import { OverviewSectionCard } from "./overview-section-card";
import { OverviewStateBadge } from "./overview-state-badge";
import { OverviewValueItem } from "./overview-value-item";

const PERIOD_EMPTY_DESCRIPTION =
  "Registre uma receita ou despesa para ver o resumo do mês.";
const CATEGORIES_EMPTY_DESCRIPTION =
  "As despesas por categoria aparecem depois dos primeiros lançamentos.";
const COMMITMENTS_EMPTY_DESCRIPTION =
  "Nenhum compromisso próximo. A projeção mostrará vencimentos futuros.";
const INCOME_UPCOMING_EMPTY_DESCRIPTION =
  "Nenhuma receita prevista no horizonte. Compromissos futuros aparecerão aqui.";
const CAIXINHAS_EMPTY_DESCRIPTION =
  "Crie uma Caixinha para reservar dinheiro com finalidade.";
const INVOICES_EMPTY_DESCRIPTION = "Nenhuma fatura projetada para agora.";

export interface OverviewHomeProps {
  model: OverviewReadModel;
}

function OverviewCommitmentList({
  items,
  resolveHref,
  testIdPrefix,
}: {
  items: readonly OverviewCommitmentItem[];
  resolveHref: (item: OverviewCommitmentItem) => string;
  testIdPrefix: string;
}) {
  return (
    <ul className="min-w-0 space-y-2">
      {items.map((item) => {
        const viewModel = toOverviewCommitmentItemViewModel(item);
        const href = resolveHref(item);

        return (
          <li key={item.referenceId}>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <OverviewValueItem
                dateLabel={viewModel.dateLabel}
                label={viewModel.label}
                state="ready"
                testId={`${testIdPrefix}-${item.referenceId}`}
                valueLabel={viewModel.amountLabel}
              />
              {href ? (
                <OverviewDrilldownLink
                  ariaLabel={`Ver origem de ${viewModel.label}`}
                  className="self-start sm:self-center"
                  href={href}
                  label="Ver origem"
                  testId={`${testIdPrefix}-${item.referenceId}-drilldown`}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function OverviewHome({ model }: OverviewHomeProps) {
  const links = buildOverviewLinks(model);
  const period = toOverviewPeriodViewModel(model.period);
  const spendableBlock = model.spendable;

  return (
    <section
      aria-labelledby="home-title"
      className="min-w-0 space-y-6"
      data-testid={OVERVIEW_TEST_IDS.page}
    >
      <header className="min-w-0 space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {OVERVIEW_PAGE_TITLE}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight" id="home-title">
          Seu espaço financeiro
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Acompanhe quanto pode gastar com segurança e registre as movimentações
          do seu espaço financeiro.
        </p>
      </header>

      <div data-testid={OVERVIEW_TEST_IDS.spendable}>
        <div data-testid="home-spendable">
          <SpendableCard
            breakdown={
              spendableBlock.state === "ready" && spendableBlock.data
                ? spendableBlock.data.breakdown
                : undefined
            }
            detailsHref={links.spendableHref}
            error={spendableBlock.state === "error" ? spendableBlock.error : undefined}
            retryHref={AUTHENTICATED_ROUTE}
            state={spendableBlock.state}
          />
        </div>
      </div>

      <OverviewSectionCard
        description={period.rangeLabel}
        emptyDescription={PERIOD_EMPTY_DESCRIPTION}
        emptyTitle="Sem movimentações no período"
        error={model.periodSummary.state === "error" ? model.periodSummary.error : undefined}
        retryHref={AUTHENTICATED_ROUTE}
        state={model.periodSummary.state}
        testId={OVERVIEW_TEST_IDS.periodSummary}
        title={OVERVIEW_PERIOD_SUMMARY_TITLE}
      >
        {model.periodSummary.state === "ready" && model.periodSummary.data ? (
          <div className="min-w-0 space-y-4">
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <OverviewValueItem
                  label="Receitas"
                  state="ready"
                  testId={OVERVIEW_TEST_IDS.periodIncome}
                  valueLabel={
                    toOverviewPeriodSummaryViewModel(model.periodSummary.data).incomeLabel
                  }
                />
                <OverviewDrilldownLink
                  ariaLabel="Ver receitas do período"
                  href={links.periodIncomeHref}
                  label="Ver receitas"
                  testId={`${OVERVIEW_TEST_IDS.periodIncome}-drilldown`}
                />
              </div>
              <div className="min-w-0 space-y-2">
                <OverviewValueItem
                  label="Despesas"
                  state="ready"
                  testId={OVERVIEW_TEST_IDS.periodExpense}
                  valueLabel={
                    toOverviewPeriodSummaryViewModel(model.periodSummary.data).expenseLabel
                  }
                />
                <OverviewDrilldownLink
                  ariaLabel="Ver despesas do período"
                  href={links.periodExpenseHref}
                  label="Ver despesas"
                  testId={`${OVERVIEW_TEST_IDS.periodExpense}-drilldown`}
                />
              </div>
            </div>
            <OverviewValueItem
              label="Saldo do período"
              state="ready"
              testId={`${OVERVIEW_TEST_IDS.periodSummary}-net`}
              valueLabel={
                toOverviewPeriodSummaryViewModel(model.periodSummary.data).netLabel
              }
            />
            {toOverviewPeriodSummaryViewModel(model.periodSummary.data)
              .referenceBalanceLabel ? (
              <OverviewValueItem
                label="Saldo de referência"
                state="ready"
                testId={`${OVERVIEW_TEST_IDS.periodSummary}-reference-balance`}
                valueLabel={
                  toOverviewPeriodSummaryViewModel(model.periodSummary.data)
                    .referenceBalanceLabel ?? ""
                }
              />
            ) : null}
            {model.periodSummary.data.planned ? (
              <dl className="grid min-w-0 gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted-foreground">Entradas planejadas</dt>
                  <dd className="text-sm font-semibold tabular-nums">
                    {
                      toOverviewPeriodSummaryViewModel(model.periodSummary.data)
                        .plannedInflowLabel
                    }
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Saídas planejadas</dt>
                  <dd className="text-sm font-semibold tabular-nums">
                    {
                      toOverviewPeriodSummaryViewModel(model.periodSummary.data)
                        .plannedOutflowLabel
                    }
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Entradas realizadas</dt>
                  <dd className="text-sm font-semibold tabular-nums">
                    {
                      toOverviewPeriodSummaryViewModel(model.periodSummary.data)
                        .realizedInflowLabel
                    }
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Saídas realizadas</dt>
                  <dd className="text-sm font-semibold tabular-nums">
                    {
                      toOverviewPeriodSummaryViewModel(model.periodSummary.data)
                        .realizedOutflowLabel
                    }
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>
        ) : null}
      </OverviewSectionCard>

      <OverviewSectionCard
        emptyDescription={CATEGORIES_EMPTY_DESCRIPTION}
        emptyTitle="Sem despesas por categoria"
        error={
          model.expensesByCategory.state === "error"
            ? model.expensesByCategory.error
            : undefined
        }
        retryHref={AUTHENTICATED_ROUTE}
        state={model.expensesByCategory.state}
        testId={OVERVIEW_TEST_IDS.categories}
        title={OVERVIEW_CATEGORIES_TITLE}
      >
        {model.expensesByCategory.state === "ready" && model.expensesByCategory.data ? (
          <ul className="min-w-0 space-y-4">
            {model.expensesByCategory.data.groups.map((group) => {
              const viewModel = toOverviewCategoryGroupViewModel(group);
              const categoryHref = links.categoryHref(group);
              const purchaseHref =
                group.purchaseEventCount > 0 ? links.purchaseHref(group) : null;

              return (
                <li className="min-w-0 space-y-2" key={group.key}>
                  <OverviewCategoryBar
                    amountLabel={viewModel.amountLabel}
                    label={viewModel.label}
                    percent={viewModel.percent}
                    percentLabel={viewModel.percentLabel}
                    testId={OVERVIEW_TEST_IDS.category(group.key)}
                  />
                  <div className="flex min-w-0 flex-wrap gap-2">
                    <OverviewDrilldownLink
                      ariaLabel={`Ver despesas de ${viewModel.label}`}
                      href={categoryHref}
                      label="Ver lançamentos"
                      testId={`${OVERVIEW_TEST_IDS.category(group.key)}-drilldown`}
                    />
                    {purchaseHref ? (
                      <OverviewDrilldownLink
                        ariaLabel={`Ver compras no cartão de ${viewModel.label}`}
                        href={purchaseHref}
                        label="Ver no cartão"
                        testId={`${OVERVIEW_TEST_IDS.category(group.key)}-purchase-drilldown`}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </OverviewSectionCard>

      <section
        aria-labelledby="quick-transaction-actions-title"
        className="min-w-0 space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
        data-testid="quick-transaction-actions"
      >
        <div className="space-y-1">
          <h2 className="text-lg font-semibold" id="quick-transaction-actions-title">
            Registrar movimentação
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Adicione uma receita ou despesa realizada para acompanhar seu espaço
            financeiro.
          </p>
        </div>
        <TransactionCreateEntryPoints />
      </section>

      <OverviewSectionCard
        drillDownAriaLabel="Ver todos os compromissos"
        drillDownHref={
          model.upcomingCommitments.state === "ready"
            ? model.upcomingCommitments.data?.viewAllHref
            : links.forecastHref
        }
        drillDownLabel={OVERVIEW_VIEW_ALL_LABEL}
        emptyDescription={COMMITMENTS_EMPTY_DESCRIPTION}
        emptyTitle="Sem compromissos próximos"
        error={
          model.upcomingCommitments.state === "error"
            ? model.upcomingCommitments.error
            : undefined
        }
        retryHref={AUTHENTICATED_ROUTE}
        state={model.upcomingCommitments.state}
        testId={OVERVIEW_TEST_IDS.commitments}
        title={OVERVIEW_COMMITMENTS_TITLE}
      >
        {model.upcomingCommitments.state === "ready" &&
        model.upcomingCommitments.data ? (
          <OverviewCommitmentList
            items={model.upcomingCommitments.data.items}
            resolveHref={links.commitmentItemHref}
            testIdPrefix={OVERVIEW_TEST_IDS.commitments}
          />
        ) : null}
      </OverviewSectionCard>

      <OverviewSectionCard
        drillDownAriaLabel="Ver todas as receitas previstas"
        drillDownHref={
          model.upcomingIncome.state === "ready"
            ? model.upcomingIncome.data?.viewAllHref
            : links.forecastHref
        }
        drillDownLabel={OVERVIEW_VIEW_ALL_LABEL}
        emptyDescription={INCOME_UPCOMING_EMPTY_DESCRIPTION}
        emptyTitle="Sem receitas previstas"
        error={
          model.upcomingIncome.state === "error" ? model.upcomingIncome.error : undefined
        }
        retryHref={AUTHENTICATED_ROUTE}
        state={model.upcomingIncome.state}
        testId={OVERVIEW_TEST_IDS.incomeUpcoming}
        title={OVERVIEW_INCOME_UPCOMING_TITLE}
      >
        {model.upcomingIncome.state === "ready" && model.upcomingIncome.data ? (
          <OverviewCommitmentList
            items={model.upcomingIncome.data.items}
            resolveHref={links.commitmentItemHref}
            testIdPrefix={OVERVIEW_TEST_IDS.incomeUpcoming}
          />
        ) : null}
      </OverviewSectionCard>

      <OverviewSectionCard
        drillDownAriaLabel="Ver todas as Caixinhas"
        drillDownHref={links.budgetsHref}
        drillDownLabel={OVERVIEW_VIEW_ALL_LABEL}
        emptyDescription={CAIXINHAS_EMPTY_DESCRIPTION}
        emptyTitle="Sem Caixinhas"
        error={
          model.caixinhasSummary.state === "error"
            ? model.caixinhasSummary.error
            : undefined
        }
        retryHref={AUTHENTICATED_ROUTE}
        state={model.caixinhasSummary.state}
        testId={OVERVIEW_TEST_IDS.caixinhas}
        title={OVERVIEW_CAIXINHAS_TITLE}
      >
        {model.caixinhasSummary.state === "ready" && model.caixinhasSummary.data ? (
          <ul className="min-w-0 space-y-3">
            {model.caixinhasSummary.data.items.map((item) => {
              const viewModel = toOverviewCaixinhaItemViewModel(item);
              const href = links.caixinhaHref(item);

              return (
                <li
                  className="min-w-0 rounded-lg border bg-background px-3 py-3"
                  data-testid={`${OVERVIEW_TEST_IDS.caixinhas}-${item.referenceId}`}
                  key={item.referenceId}
                >
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words">{viewModel.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {viewModel.statusLabel}
                      </p>
                      {viewModel.progressLabel ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {viewModel.progressLabel}
                        </p>
                      ) : null}
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">
                      {viewModel.balanceLabel}
                    </p>
                  </div>
                  {href ? (
                    <OverviewDrilldownLink
                      ariaLabel={`Abrir Caixinha ${viewModel.name}`}
                      className="mt-2"
                      href={href}
                      label="Abrir Caixinha"
                      testId={`${OVERVIEW_TEST_IDS.caixinhas}-${item.referenceId}-drilldown`}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </OverviewSectionCard>

      <OverviewSectionCard
        drillDownAriaLabel="Ver todos os cartões"
        drillDownHref={
          model.cardInvoices.state === "ready"
            ? model.cardInvoices.data?.viewAllHref
            : links.creditCardsHref
        }
        drillDownLabel={OVERVIEW_VIEW_ALL_LABEL}
        emptyDescription={INVOICES_EMPTY_DESCRIPTION}
        emptyTitle="Sem faturas projetadas"
        error={
          model.cardInvoices.state === "error" ? model.cardInvoices.error : undefined
        }
        retryHref={AUTHENTICATED_ROUTE}
        state={model.cardInvoices.state}
        testId={OVERVIEW_TEST_IDS.invoices}
        title={OVERVIEW_INVOICES_TITLE}
      >
        {model.cardInvoices.state === "ready" && model.cardInvoices.data ? (
          <ul className="min-w-0 space-y-3">
            {model.cardInvoices.data.items.map((item) => {
              const viewModel = toOverviewCardInvoiceItemViewModel(item);
              const href = links.cardHref(item);

              return (
                <li
                  className="min-w-0 rounded-lg border bg-background px-3 py-3"
                  data-testid={`${OVERVIEW_TEST_IDS.invoices}-${item.cardId}`}
                  key={`${item.cardId}-${item.period}`}
                >
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words">
                        {viewModel.cardName}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {viewModel.periodLabel} · vence em {viewModel.dueOnLabel}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">
                      {viewModel.amountLabel}
                    </p>
                  </div>
                  {href ? (
                    <OverviewDrilldownLink
                      ariaLabel={`Abrir fatura de ${viewModel.cardName}`}
                      className="mt-2"
                      href={href}
                      label="Ver cartão"
                      testId={`${OVERVIEW_TEST_IDS.invoices}-${item.cardId}-drilldown`}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </OverviewSectionCard>

      {model.alerts.state === "error" ? (
        <OverviewSectionCard
          error={model.alerts.error}
          retryHref={AUTHENTICATED_ROUTE}
          state="error"
          testId={OVERVIEW_TEST_IDS.alerts}
          title={OVERVIEW_ALERTS_TITLE}
        />
      ) : model.alerts.state === "ready" &&
        model.alerts.data &&
        model.alerts.data.items.length > 0 ? (
        <OverviewSectionCard
          state="ready"
          testId={OVERVIEW_TEST_IDS.alerts}
          title={OVERVIEW_ALERTS_TITLE}
        >
          <ul className="min-w-0 space-y-3">
            {model.alerts.data.items.map((alert) => {
              const viewModel = toOverviewAlertViewModel(alert);
              const href = links.alertHref(alert);

              return (
                <li
                  className="min-w-0 rounded-lg border bg-background px-3 py-3"
                  data-testid={OVERVIEW_TEST_IDS.alert(alert.ruleId)}
                  key={alert.ruleId}
                >
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <OverviewStateBadge
                        testId={`${OVERVIEW_TEST_IDS.alert(alert.ruleId)}-badge`}
                        variant={viewModel.badgeVariant}
                      />
                      <p className="text-sm leading-6 break-words">{viewModel.message}</p>
                      {viewModel.dateLabel ? (
                        <p className="text-xs text-muted-foreground">{viewModel.dateLabel}</p>
                      ) : null}
                    </div>
                    {href ? (
                      <OverviewDrilldownLink
                        ariaLabel={`Ver detalhes do alerta ${viewModel.severityLabel}`}
                        className="shrink-0 self-start"
                        href={href}
                        label="Ver detalhes"
                        testId={`${OVERVIEW_TEST_IDS.alert(alert.ruleId)}-drilldown`}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </OverviewSectionCard>
      ) : null}

      <InviteShareCard />
    </section>
  );
}

export function OverviewPageError({ error }: { error: unknown }) {
  const safeError = toOverviewErrorViewModel(error);

  return (
    <section
      aria-labelledby="home-title"
      className="min-w-0 space-y-6"
      data-testid={OVERVIEW_TEST_IDS.page}
    >
      <header className="min-w-0 space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {OVERVIEW_PAGE_TITLE}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight" id="home-title">
          Seu espaço financeiro
        </h1>
      </header>
      <ErrorState
        message={safeError.message}
        retryHref={safeError.retryable ? AUTHENTICATED_ROUTE : undefined}
        testId="overview-page-error"
        title="Não foi possível carregar a visão geral"
      />
    </section>
  );
}
