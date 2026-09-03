import { describe, expect, it } from "vitest";

import {
  formatOverviewPercent,
  OVERVIEW_CAIXINHAS_TITLE,
  OVERVIEW_CATEGORIES_TITLE,
  OVERVIEW_COMMITMENTS_TITLE,
  OVERVIEW_INCOME_UPCOMING_TITLE,
  OVERVIEW_OTHER_LABEL,
  OVERVIEW_PAGE_TITLE,
  OVERVIEW_PERIOD_SUMMARY_TITLE,
  OVERVIEW_SPENDABLE_TITLE,
  OVERVIEW_TEST_IDS,
  OVERVIEW_UNCATEGORIZED_LABEL,
  OVERVIEW_VIEW_ALL_LABEL,
  toOverviewAlertViewModel,
  toOverviewCategoryGroupViewModel,
  toOverviewCommitmentItemViewModel,
  toOverviewErrorViewModel,
  toOverviewPeriodSummaryViewModel,
  toOverviewPeriodViewModel,
} from "./ui-contracts";

describe("overview ui-contracts", () => {
  it("defines stable test ids for T14", () => {
    expect(OVERVIEW_TEST_IDS.page).toBe("overview-page");
    expect(OVERVIEW_TEST_IDS.spendable).toBe("overview-spendable");
    expect(OVERVIEW_TEST_IDS.category("food")).toBe("overview-category-food");
    expect(OVERVIEW_TEST_IDS.alert("COMMITMENT_SOON")).toBe(
      "overview-alert-COMMITMENT_SOON",
    );
    expect(OVERVIEW_TEST_IDS.blockLoading).toBe("overview-block-loading");
  });

  it("uses exact Portuguese product labels", () => {
    expect(OVERVIEW_PAGE_TITLE).toBe("Visão geral");
    expect(OVERVIEW_SPENDABLE_TITLE).toBe("Pode gastar com segurança");
    expect(OVERVIEW_PERIOD_SUMMARY_TITLE).toBe("Resumo do mês");
    expect(OVERVIEW_CATEGORIES_TITLE).toBe("Onde está indo o dinheiro");
    expect(OVERVIEW_COMMITMENTS_TITLE).toBe("Próximos compromissos");
    expect(OVERVIEW_CAIXINHAS_TITLE).toBe("Caixinhas");
    expect(OVERVIEW_INCOME_UPCOMING_TITLE).toBe("Próximas receitas");
    expect(OVERVIEW_VIEW_ALL_LABEL).toBe("Ver todos");
    expect(OVERVIEW_UNCATEGORIZED_LABEL).toBe("Sem categoria");
    expect(OVERVIEW_OTHER_LABEL).toBe("Outros");
  });

  it("formats percents as integers without recalculation", () => {
    expect(formatOverviewPercent(12)).toBe("12%");
    expect(formatOverviewPercent(0)).toBe("0%");
    expect(formatOverviewPercent(100)).toBe("100%");
    expect(formatOverviewPercent(12.5)).toBe("—");
  });

  it("maps period and summary view models from string cents", () => {
    const period = toOverviewPeriodViewModel({
      key: "2026-09",
      from: "2026-09-01",
      to: "2026-09-30",
      asOf: "2026-09-15",
    });
    expect(period.keyLabel).toBe("setembro de 2026");
    expect(period.rangeLabel).toBe("01/09/2026 a 30/09/2026");

    const summary = toOverviewPeriodSummaryViewModel({
      incomeCents: "150000",
      expenseCents: "80000",
      netCents: "70000",
      expenseEventCount: 3,
      purchaseEventCount: 1,
      reconciliation: {
        from: "2026-09-01",
        to: "2026-09-30",
        expenseFilter: "kind=EXPENSE",
        incomeFilter: "kind=INCOME",
      },
    });
    expect(summary.incomeLabel).toBe("R$ 1.500,00");
    expect(summary.expenseLabel).toBe("R$ 800,00");
    expect(summary.netLabel).toBe("R$ 700,00");
  });

  it("maps category and commitment items without numeric money input", () => {
    const category = toOverviewCategoryGroupViewModel({
      key: "uncategorized",
      label: OVERVIEW_UNCATEGORIZED_LABEL,
      amountCents: "50000",
      percent: 42,
      expenseEventCount: 2,
      purchaseEventCount: 0,
    });
    expect(category.amountLabel).toBe("R$ 500,00");
    expect(category.percentLabel).toBe("42%");

    const commitment = toOverviewCommitmentItemViewModel({
      referenceId: "ref-1",
      date: "2026-09-20",
      amountCents: "30000",
      direction: "OUTFLOW",
      label: "Aluguel",
      originKind: "PLANNED_EVENT",
    });
    expect(commitment.amountLabel).toBe("-R$ 300,00");
    expect(commitment.dateLabel).toBe("20/09/2026");
  });

  it("maps alert severity to badge variants", () => {
    const attention = toOverviewAlertViewModel({
      ruleId: "COMMITMENT_SOON",
      severity: "attention",
      message: "Compromisso próximo.",
    });
    expect(attention.badgeVariant).toBe("attention");
    expect(attention.severityLabel).toBe("Atenção");

    const critical = toOverviewAlertViewModel({
      ruleId: "FORECAST_MONTH_NEGATIVE",
      severity: "critical",
      message: "Mês projetado negativo.",
    });
    expect(critical.badgeVariant).toBe("critical");
    expect(critical.severityLabel).toBe("Crítico");
  });

  it("maps opaque error codes to safe messages", () => {
    const vm = toOverviewErrorViewModel({ code: "OVERVIEW_QUERY_FAILED" });
    expect(vm.message).toContain("Tente novamente");
    expect(vm.retryable).toBe(true);
  });
});
