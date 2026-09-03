import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  OVERVIEW_CONTRACT_VERSION,
  type OverviewReadModel,
} from "@/modules/overview/contracts";
import { OVERVIEW_TEST_IDS } from "@/modules/overview/ui-contracts";

import { OverviewHome } from "./overview-home";

function emptyModel(): OverviewReadModel {
  return {
    contractVersion: OVERVIEW_CONTRACT_VERSION,
    period: {
      key: "2026-09",
      from: "2026-09-01",
      to: "2026-09-30",
      asOf: "2026-09-15",
    },
    scenario: "CONSERVATIVE",
    horizonDays: 90,
    spendable: { state: "empty" },
    periodSummary: { state: "empty" },
    expensesByCategory: { state: "empty" },
    upcomingCommitments: { state: "empty" },
    upcomingIncome: { state: "empty" },
    caixinhasSummary: { state: "empty" },
    cardInvoices: { state: "empty" },
    alerts: { state: "ready", data: { items: [] } },
  };
}

describe("OverviewHome", () => {
  it("renders empty block copy without invented monetary zeros", () => {
    const html = renderToStaticMarkup(<OverviewHome model={emptyModel()} />);

    expect(html).toContain(OVERVIEW_TEST_IDS.page);
    expect(html).toContain("Registre uma receita ou despesa para ver o resumo do mês.");
    expect(html).toContain(
      "As despesas por categoria aparecem depois dos primeiros lançamentos.",
    );
    expect(html).toContain(
      "Nenhum compromisso próximo. A projeção mostrará vencimentos futuros.",
    );
    expect(html).toContain("Crie uma Caixinha para reservar dinheiro com finalidade.");
    expect(html).not.toContain("R$ 0,00");
    expect(html).not.toContain('data-testid="overview-alerts"');
  });

  it("hides alerts when ready with no items", () => {
    const html = renderToStaticMarkup(<OverviewHome model={emptyModel()} />);
    expect(html).not.toContain('data-testid="overview-alerts"');
  });

  it("shows alerts error without rendering the ready alerts list", () => {
    const html = renderToStaticMarkup(
      <OverviewHome
        model={{
          ...emptyModel(),
          alerts: {
            state: "error",
            error: { code: "OVERVIEW_QUERY_FAILED", field: null },
          },
        }}
      />,
    );

    expect(html).toContain('data-testid="overview-alerts-error"');
    expect(html).not.toContain('data-testid="overview-alert-');
  });
});
