import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  OVERVIEW_ALERTS_TITLE,
  OVERVIEW_CAIXINHAS_TITLE,
  OVERVIEW_CATEGORIES_TITLE,
  OVERVIEW_COMMITMENTS_TITLE,
  OVERVIEW_INCOME_UPCOMING_TITLE,
  OVERVIEW_INVOICES_TITLE,
  OVERVIEW_PERIOD_SUMMARY_TITLE,
  OVERVIEW_SPENDABLE_TITLE,
  OVERVIEW_TEST_IDS,
  OVERVIEW_VIEW_ALL_LABEL,
} from "@/modules/overview/ui-contracts";

import {
  OverviewCategoryBar,
  OverviewDrilldownLink,
  OverviewEmptyState,
  OverviewErrorState,
  OverviewLoadingState,
  OverviewSectionCard,
  OverviewStateBadge,
  OverviewValueItem,
} from "./index";

describe("overview shared components", () => {
  it("renders section card in ready, loading, empty and error states", () => {
    const ready = renderToStaticMarkup(
      <OverviewSectionCard
        state="ready"
        testId={OVERVIEW_TEST_IDS.periodSummary}
        title={OVERVIEW_PERIOD_SUMMARY_TITLE}
      >
        <p>Conteúdo pronto</p>
      </OverviewSectionCard>,
    );
    expect(ready).toContain(OVERVIEW_PERIOD_SUMMARY_TITLE);
    expect(ready).toContain("Conteúdo pronto");
    expect(ready).toContain(OVERVIEW_TEST_IDS.periodSummary);

    const loading = renderToStaticMarkup(
      <OverviewSectionCard
        state="loading"
        testId={OVERVIEW_TEST_IDS.categories}
        title={OVERVIEW_CATEGORIES_TITLE}
      />,
    );
    expect(loading).toContain(`${OVERVIEW_TEST_IDS.categories}-loading`);
    expect(loading).not.toContain("R$ 0,00");

    const empty = renderToStaticMarkup(
      <OverviewSectionCard
        state="empty"
        testId={OVERVIEW_TEST_IDS.commitments}
        title={OVERVIEW_COMMITMENTS_TITLE}
      />,
    );
    expect(empty).toContain(`${OVERVIEW_TEST_IDS.commitments}-empty`);
    expect(empty).not.toContain("R$ 0,00");

    const error = renderToStaticMarkup(
      <OverviewSectionCard
        error={{ code: "OVERVIEW_QUERY_FAILED" }}
        state="error"
        testId={OVERVIEW_TEST_IDS.caixinhas}
        title={OVERVIEW_CAIXINHAS_TITLE}
      />,
    );
    expect(error).toContain(`${OVERVIEW_TEST_IDS.caixinhas}-error`);
    expect(error).not.toContain("R$ 0,00");
  });

  it("renders value item states without fake monetary values on error", () => {
    const ready = renderToStaticMarkup(
      <OverviewValueItem
        label="Receitas"
        state="ready"
        testId={OVERVIEW_TEST_IDS.periodIncome}
        valueLabel="R$ 1.500,00"
      />,
    );
    expect(ready).toContain("R$ 1.500,00");
    expect(ready).toContain(OVERVIEW_TEST_IDS.periodIncome);

    const errorHtml = renderToStaticMarkup(
      <OverviewValueItem
        label="Despesas"
        state="error"
        testId={OVERVIEW_TEST_IDS.periodExpense}
        valueLabel=""
      />,
    );
    expect(errorHtml).toContain(`${OVERVIEW_TEST_IDS.periodExpense}-error`);
    expect(errorHtml).not.toContain("R$ 0,00");
  });

  it("renders category bar from percent width without money math", () => {
    const html = renderToStaticMarkup(
      <OverviewCategoryBar
        amountLabel="R$ 500,00"
        label="Alimentação"
        percent={35}
        percentLabel="35%"
        testId={OVERVIEW_TEST_IDS.category("food")}
      />,
    );
    expect(html).toContain("35%");
    expect(html).toContain("width:35%");
    expect(html).toContain(OVERVIEW_TEST_IDS.category("food"));
  });

  it("renders state badge with text and severity tone", () => {
    const html = renderToStaticMarkup(
      <OverviewStateBadge testId="overview-badge" variant="critical" />,
    );
    expect(html).toContain("Crítico");
    expect(html).toContain('aria-label="Estado: Crítico"');
  });

  it("renders drill-down link with accessible label and touch target", () => {
    const html = renderToStaticMarkup(
      <OverviewDrilldownLink
        ariaLabel="Ver todos os compromissos"
        href="/forecast"
        label={OVERVIEW_VIEW_ALL_LABEL}
        testId="overview-commitments-drilldown"
      />,
    );
    expect(html).toContain("Ver todos os compromissos");
    expect(html).toContain('href="/forecast"');
    expect(html).toContain("min-h-11");
  });

  it("uses stable block state test ids from contracts", () => {
    const loading = renderToStaticMarkup(<OverviewLoadingState />);
    expect(loading).toContain(OVERVIEW_TEST_IDS.blockLoading);

    const empty = renderToStaticMarkup(<OverviewEmptyState />);
    expect(empty).toContain(OVERVIEW_TEST_IDS.blockEmpty);

    const error = renderToStaticMarkup(
      <OverviewErrorState error={{ code: "OVERVIEW_QUERY_FAILED" }} />,
    );
    expect(error).toContain(OVERVIEW_TEST_IDS.blockError);
    expect(error).not.toContain("R$ 0,00");
  });

  it("covers block titles used by upcoming sections", () => {
    const titles = [
      OVERVIEW_SPENDABLE_TITLE,
      OVERVIEW_INCOME_UPCOMING_TITLE,
      OVERVIEW_INVOICES_TITLE,
      OVERVIEW_ALERTS_TITLE,
    ];
    for (const title of titles) {
      const html = renderToStaticMarkup(
        <OverviewSectionCard state="ready" testId="overview-block" title={title}>
          <span>ok</span>
        </OverviewSectionCard>,
      );
      expect(html).toContain(title);
    }
  });
});
