import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SpendableBreakdown } from "@/modules/spendable/contracts";
import {
  formatSpendableImpact,
  formatSpendableMoney,
  formatSpendablePeriod,
  toSpendableBreakdownViewModel,
  toSpendableErrorViewModel,
} from "@/modules/spendable/ui-contracts";

import {
  SpendableBreakdownView,
  SpendableCard,
  SpendableReadModel,
} from "./index";

const expenseReference = "expense-opaque-reference";

function makeBreakdown(
  overrides: Partial<SpendableBreakdown> = {},
): SpendableBreakdown {
  const base: SpendableBreakdown = {
    contractVersion: "s08.v1",
    ruleVersion: "spendable.v1",
    period: {
      asOf: "2026-09-01",
      from: "2026-09-02",
      to: "2026-12-01",
      horizonDays: 90,
      scenario: "CONSERVATIVE",
      forecastContractVersion: "s07.v1",
    },
    openingBalanceCents: "600000",
    openingAdjustmentsCents: "0",
    openingProjectedBalanceCents: "600000",
    closingProjectedBalanceCents: "300000",
    minimumProjectedBalanceCents: "300000",
    minimum: {
      projectedBalanceCents: "300000",
      points: [
        {
          kind: "DAY_CLOSE",
          date: "2026-09-15",
          projectedBalanceCents: "300000",
          references: [expenseReference],
          items: [
            {
              referenceId: expenseReference,
              sourceKind: "PLANNED_EVENT",
              date: "2026-09-15",
              amountCents: "300000",
              direction: "OUTFLOW",
              status: "PLANNED",
              certainty: "COMMITTED",
            },
          ],
        },
      ],
    },
    operationalBuffer: {
      amountCents: "500000",
      source: "CONFIGURED",
      effectiveFrom: "2026-08-01",
      revision: "buffer-revision",
    },
    reserve: {
      contractVersion: "s09.v1",
      status: "UNAVAILABLE",
      protectedCents: "0",
      appliedOpeningAdjustmentCents: "0",
      components: [],
    },
    rawSpendableCents: "-200000",
    displaySpendableCents: "0",
    deficitToPreserveReserveCents: "200000",
  };

  return {
    ...base,
    ...overrides,
  };
}

describe("T04 UI contracts and shared components", () => {
  it("formats serialized cents and dates without Number or floating point", () => {
    expect(formatSpendableMoney("9223372036854775807")).toBe(
      "R$ 92.233.720.368.547.758,07",
    );
    expect(formatSpendableMoney("-200000")).toBe("-R$ 2.000,00");
    expect(formatSpendableImpact("300000", "OUTFLOW")).toBe("-R$ 3.000,00");
    expect(formatSpendableImpact("300000", "INFLOW")).toBe("R$ 3.000,00");
    expect(formatSpendablePeriod("2026-09")).toBe("setembro de 2026");
    expect(formatSpendableMoney("1.5")).toBe("Valor indisponível");
  });

  it("adds labels only and preserves the server read model verbatim", () => {
    const breakdown = makeBreakdown();
    const viewModel = toSpendableBreakdownViewModel(breakdown);

    expect(viewModel.breakdown).toBe(breakdown);
    expect(viewModel.availabilityStatus).toBe("deficit");
    expect(viewModel.displaySpendableLabel).toBe("R$ 0,00");
    expect(viewModel.deficitToPreserveReserveLabel).toBe("R$ 2.000,00");
    expect(viewModel.minimumPoints[0]?.items[0]?.sourceKindLabel).toBe(
      "Evento planejado",
    );
    expect(viewModel.minimumPoints[0]?.items[0]?.certaintyLabel).toBe(
      "Comprometido",
    );
    expect(JSON.stringify(breakdown)).not.toContain("householdId");
    expect(JSON.stringify(breakdown)).not.toContain("bigint");
  });

  it("communicates a deficit as zero spendable plus the amount to recompose", () => {
    const html = renderToStaticMarkup(
      <SpendableCard
        breakdown={makeBreakdown()}
        detailsHref="/spendable/breakdown"
        testId="deficit-card"
      />,
    );

    expect(html).toContain('data-state="deficit"');
    expect(html).toContain('aria-label="Pode gastar: R$ 0,00"');
    expect(html).toContain("Pode gastar</p>");
    expect(html).toContain("Déficit para preservar a reserva: R$ 2.000,00");
    expect(html).toContain("Resultado bruto");
    expect(html).toContain("-R$ 2.000,00");
    expect(html).toContain("Ver composição do disponível para gastar");
    expect(html).not.toContain("Pode gastar: -R$");
  });

  it("renders period, causality, origin action and reserve state accessibly", () => {
    const html = renderToStaticMarkup(
      <SpendableBreakdownView
        breakdown={makeBreakdown()}
        returnHref="/spendable"
        sourceHrefs={{ [expenseReference]: "/planned-events/detail" }}
        testId="breakdown"
      />,
    );

    expect(html).toContain('aria-labelledby="breakdown-title"');
    expect(html).toContain("02/09/2026 a 01/12/2026");
    expect(html).toContain("Menor saldo projetado");
    expect(html).toContain("Origem: Evento planejado");
    expect(html).toContain("Certeza: Comprometido");
    expect(html).toContain("Ver origem do item que influencia o saldo mínimo");
    expect(html).toContain("Reserva não disponível nesta versão");
    expect(html).toContain("returnTo=%2Fspendable");
    expect(html).not.toContain(expenseReference);
    expect(html).not.toContain("householdId");
  });

  it("keeps zero distinct from deficit and displays loading/empty/error safely", () => {
    const zero = makeBreakdown({
      minimumProjectedBalanceCents: "500000",
      minimum: {
        projectedBalanceCents: "500000",
        points: [],
      },
      rawSpendableCents: "0",
      displaySpendableCents: "0",
      deficitToPreserveReserveCents: "0",
    });
    const zeroHtml = renderToStaticMarkup(
      <SpendableCard breakdown={zero} testId="zero-card" />,
    );
    const loadingHtml = renderToStaticMarkup(
      <SpendableCard state="loading" testId="loading-card" />,
    );
    const emptyHtml = renderToStaticMarkup(
      <SpendableBreakdownView state="empty" testId="empty-breakdown" />,
    );
    const errorHtml = renderToStaticMarkup(
      <SpendableReadModel
        error={{
          code: "SPENDABLE_QUERY_FAILED",
          message: "SELECT secret; stack trace",
        }}
        retryHref="/spendable"
        state="error"
        testId="error-model"
      />,
    );

    expect(zeroHtml).toContain('data-state="zero"');
    expect(zeroHtml).toContain("zero não é um erro nem um déficit");
    expect(zeroHtml).not.toContain("Déficit para preservar a reserva");
    expect(loadingHtml).toContain('role="status"');
    expect(emptyHtml).toContain("Nenhuma composição para exibir");
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain("Tente novamente");
    expect(errorHtml).not.toContain("SELECT secret");
    expect(errorHtml).not.toContain("stack trace");
    expect(toSpendableErrorViewModel({ code: "SPENDABLE_INCONSISTENT" })).toMatchObject({
      retryable: false,
      message: expect.stringContaining("consistente"),
    });
  });
});

export {};
