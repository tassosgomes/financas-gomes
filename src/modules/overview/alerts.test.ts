import { describe, expect, it } from "vitest";

import type { ForecastItem, ForecastTimeline } from "@/modules/forecast/contracts";
import type { SpendableBreakdown } from "@/modules/spendable/contracts";

import { OVERVIEW_CONTRACT_VERSION, type OverviewReadModel } from "./contracts";
import { deriveOverviewAlerts } from "./alerts";

const AS_OF = "2026-09-15";
const PERIOD_KEY = "2026-09";

function forecastItem(
  overrides: Partial<ForecastItem> & Pick<ForecastItem, "referenceId" | "date" | "direction">,
): ForecastItem {
  const source = overrides.source ?? {
    kind: "PLANNED_EVENT",
    referenceId: overrides.referenceId,
    label: "Item",
  };

  return {
    amountCents: "10000",
    status: "PLANNED",
    certainty: "COMMITTED",
    reconciliation: null,
    ...overrides,
    source,
  };
}

function spendableBreakdown(
  overrides: Partial<SpendableBreakdown> = {},
): SpendableBreakdown {
  return {
    contractVersion: "s08.v1",
    ruleVersion: "spendable.v1",
    period: {
      asOf: AS_OF,
      from: "2026-09-16",
      to: "2026-12-14",
      horizonDays: 90,
      scenario: "CONSERVATIVE",
      forecastContractVersion: "s07.v1",
    },
    openingBalanceCents: "500000",
    openingAdjustmentsCents: "0",
    openingProjectedBalanceCents: "500000",
    closingProjectedBalanceCents: "450000",
    minimumProjectedBalanceCents: "420000",
    minimum: {
      projectedBalanceCents: "420000",
      points: [],
    },
    operationalBuffer: {
      amountCents: "0",
      source: "ABSENT_DEFAULT_ZERO",
      effectiveFrom: null,
      revision: null,
    },
    reserve: {
      contractVersion: "s09.v1",
      status: "UNAVAILABLE",
      protectedCents: "0",
      appliedOpeningAdjustmentCents: "0",
      components: [],
    },
    rawSpendableCents: "420000",
    displaySpendableCents: "420000",
    deficitToPreserveReserveCents: "0",
    ...overrides,
  } as SpendableBreakdown;
}

function emptyModel(overrides: Partial<OverviewReadModel> = {}): OverviewReadModel {
  return {
    contractVersion: OVERVIEW_CONTRACT_VERSION,
    period: {
      key: PERIOD_KEY,
      from: "2026-09-01",
      to: "2026-09-30",
      asOf: AS_OF,
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
    ...overrides,
  };
}

function readySpendable(
  breakdown: SpendableBreakdown,
): OverviewReadModel["spendable"] {
  return { state: "ready", data: { breakdown } };
}

describe("deriveOverviewAlerts", () => {
  describe("SPENDABLE_NOT_POSITIVE", () => {
    it("fires attention when display spendable is exactly zero", () => {
      const model = emptyModel({
        spendable: readySpendable(
          spendableBreakdown({
            rawSpendableCents: "0",
            displaySpendableCents: "0",
          }),
        ),
        periodSummary: {
          state: "ready",
          data: {
            incomeCents: "100",
            expenseCents: "0",
            netCents: "100",
            expenseEventCount: 0,
            purchaseEventCount: 0,
            reconciliation: {
              from: "2026-09-01",
              to: "2026-09-30",
              expenseFilter: "/transactions",
              incomeFilter: "/transactions",
            },
          },
        },
      });

      const alerts = deriveOverviewAlerts(model);
      expect(alerts).toEqual([
        expect.objectContaining({
          ruleId: "SPENDABLE_NOT_POSITIVE",
          severity: "attention",
        }),
      ]);
    });

    it("fires critical when raw spendable is negative", () => {
      const model = emptyModel({
        spendable: readySpendable(
          spendableBreakdown({
            rawSpendableCents: "-1",
            displaySpendableCents: "0",
          }),
        ),
        periodSummary: {
          state: "ready",
          data: {
            incomeCents: "100",
            expenseCents: "0",
            netCents: "100",
            expenseEventCount: 0,
            purchaseEventCount: 0,
            reconciliation: {
              from: "2026-09-01",
              to: "2026-09-30",
              expenseFilter: "/transactions",
              incomeFilter: "/transactions",
            },
          },
        },
      });

      const alerts = deriveOverviewAlerts(model);
      expect(alerts[0]).toMatchObject({
        ruleId: "SPENDABLE_NOT_POSITIVE",
        severity: "critical",
      });
    });

    it("does not fire when raw spendable is positive and display is positive", () => {
      const model = emptyModel({
        spendable: readySpendable(
          spendableBreakdown({
            rawSpendableCents: "1",
            displaySpendableCents: "1",
          }),
        ),
      });

      expect(
        deriveOverviewAlerts(model).some(
          (alert) => alert.ruleId === "SPENDABLE_NOT_POSITIVE",
        ),
      ).toBe(false);
    });

    it("does not fire when display is one cent above zero", () => {
      const model = emptyModel({
        spendable: readySpendable(
          spendableBreakdown({
            rawSpendableCents: "1",
            displaySpendableCents: "1",
          }),
        ),
      });

      expect(
        deriveOverviewAlerts(model).some(
          (alert) => alert.ruleId === "SPENDABLE_NOT_POSITIVE",
        ),
      ).toBe(false);
    });

    it("skips when spendable origin is in error", () => {
      const model = emptyModel({
        spendable: { state: "error", error: { code: "SPENDABLE_QUERY_FAILED" } },
      });

      expect(deriveOverviewAlerts(model)).toEqual([]);
    });
  });

  describe("FORECAST_MONTH_NEGATIVE", () => {
    it("fires critical for a future month with negative net in forecast", () => {
      const forecast = {
        contractVersion: "s07.v1",
        scenario: "CONSERVATIVE",
        from: "2026-09-16",
        to: "2026-12-14",
        openingBalanceCents: "0",
        openingAdjustmentsCents: "0",
        openingProjectedBalanceCents: "0",
        closingProjectedBalanceCents: "0",
        minimumProjectedBalanceCents: "0",
        minimumProjectedOn: null,
        totals: {
          inflowCents: "0",
          outflowCents: "0",
          netCents: "0",
          realizedInflowCents: "0",
          realizedOutflowCents: "0",
          projectedInflowCents: "0",
          projectedOutflowCents: "0",
        },
        periods: [
          {
            period: "2026-09",
            inflowCents: "0",
            outflowCents: "0",
            netCents: "0",
            realizedInflowCents: "0",
            realizedOutflowCents: "0",
            projectedInflowCents: "0",
            projectedOutflowCents: "0",
          },
          {
            period: "2026-10",
            inflowCents: "0",
            outflowCents: "100",
            netCents: "-100",
            realizedInflowCents: "0",
            realizedOutflowCents: "0",
            projectedInflowCents: "0",
            projectedOutflowCents: "100",
          },
        ],
        days: [],
        minimumBalanceReferences: [],
      } as ForecastTimeline;

      const model = emptyModel({
        spendable: readySpendable(spendableBreakdown()),
        periodSummary: {
          state: "ready",
          data: {
            incomeCents: "1",
            expenseCents: "0",
            netCents: "1",
            expenseEventCount: 0,
            purchaseEventCount: 0,
            reconciliation: {
              from: "2026-09-01",
              to: "2026-09-30",
              expenseFilter: "/transactions",
              incomeFilter: "/transactions",
            },
          },
        },
      });

      const alerts = deriveOverviewAlerts(model, { forecast });
      expect(alerts).toEqual([
        expect.objectContaining({
          ruleId: "FORECAST_MONTH_NEGATIVE",
          severity: "critical",
        }),
      ]);
    });

    it("does not fire for future month net exactly zero", () => {
      const forecast = {
        contractVersion: "s07.v1",
        scenario: "CONSERVATIVE",
        from: "2026-09-16",
        to: "2026-12-14",
        openingBalanceCents: "0",
        openingAdjustmentsCents: "0",
        openingProjectedBalanceCents: "0",
        closingProjectedBalanceCents: "0",
        minimumProjectedBalanceCents: "0",
        minimumProjectedOn: null,
        totals: {
          inflowCents: "0",
          outflowCents: "0",
          netCents: "0",
          realizedInflowCents: "0",
          realizedOutflowCents: "0",
          projectedInflowCents: "0",
          projectedOutflowCents: "0",
        },
        periods: [
          {
            period: "2026-10",
            inflowCents: "0",
            outflowCents: "0",
            netCents: "0",
            realizedInflowCents: "0",
            realizedOutflowCents: "0",
            projectedInflowCents: "0",
            projectedOutflowCents: "0",
          },
        ],
        days: [],
        minimumBalanceReferences: [],
      } as ForecastTimeline;

      const model = emptyModel({
        spendable: readySpendable(spendableBreakdown()),
      });

      expect(
        deriveOverviewAlerts(model, { forecast }).some(
          (alert) => alert.ruleId === "FORECAST_MONTH_NEGATIVE",
        ),
      ).toBe(false);
    });

    it("uses spendable closing balance proxy when forecast is missing", () => {
      const model = emptyModel({
        spendable: readySpendable(
          spendableBreakdown({ closingProjectedBalanceCents: "-1" }),
        ),
        periodSummary: {
          state: "ready",
          data: {
            incomeCents: "1",
            expenseCents: "0",
            netCents: "1",
            expenseEventCount: 0,
            purchaseEventCount: 0,
            reconciliation: {
              from: "2026-09-01",
              to: "2026-09-30",
              expenseFilter: "/transactions",
              incomeFilter: "/transactions",
            },
          },
        },
      });

      const alerts = deriveOverviewAlerts(model);
      expect(alerts[0]?.ruleId).toBe("FORECAST_MONTH_NEGATIVE");
    });
  });

  describe("COMMITMENT_SOON", () => {
    it("fires for commitments between asOf+1 and asOf+7 inclusive", () => {
      const model = emptyModel({
        upcomingCommitments: {
          state: "ready",
          data: {
            items: [
              {
                referenceId: "commit-1",
                date: "2026-09-20",
                amountCents: "10000",
                direction: "OUTFLOW",
                label: "Parcela",
                originKind: "INSTALLMENT",
              },
            ],
            totalMatching: 1,
            viewAllHref: "/forecast",
          },
        },
      });

      const alerts = deriveOverviewAlerts(model);
      expect(alerts).toEqual([
        expect.objectContaining({
          ruleId: "COMMITMENT_SOON",
          severity: "attention",
          date: "2026-09-20",
          referenceId: "commit-1",
        }),
      ]);
    });

    it("does not fire on asOf itself", () => {
      const model = emptyModel({
        upcomingCommitments: {
          state: "ready",
          data: {
            items: [
              {
                referenceId: "today",
                date: AS_OF,
                amountCents: "10000",
                direction: "OUTFLOW",
                label: "Hoje",
                originKind: "PLANNED_EVENT",
              },
            ],
            totalMatching: 1,
            viewAllHref: "/forecast",
          },
        },
      });

      expect(
        deriveOverviewAlerts(model).some(
          (alert) => alert.ruleId === "COMMITMENT_SOON",
        ),
      ).toBe(false);
    });

    it("does not fire beyond the seventh day after asOf", () => {
      const model = emptyModel({
        upcomingCommitments: {
          state: "ready",
          data: {
            items: [
              {
                referenceId: "late",
                date: "2026-09-23",
                amountCents: "10000",
                direction: "OUTFLOW",
                label: "Tarde",
                originKind: "PLANNED_EVENT",
              },
            ],
            totalMatching: 1,
            viewAllHref: "/forecast",
          },
        },
      });

      expect(
        deriveOverviewAlerts(model).some(
          (alert) => alert.ruleId === "COMMITMENT_SOON",
        ),
      ).toBe(false);
    });
  });

  describe("EXPECTED_INCOME_UNREALIZED", () => {
    it("fires when expected inflow exists and income is zero", () => {
      const forecast = {
        contractVersion: "s07.v1",
        scenario: "CONSERVATIVE",
        from: "2026-09-16",
        to: "2026-12-14",
        openingBalanceCents: "0",
        openingAdjustmentsCents: "0",
        openingProjectedBalanceCents: "0",
        closingProjectedBalanceCents: "0",
        minimumProjectedBalanceCents: "0",
        minimumProjectedOn: null,
        totals: {
          inflowCents: "0",
          outflowCents: "0",
          netCents: "0",
          realizedInflowCents: "0",
          realizedOutflowCents: "0",
          projectedInflowCents: "0",
          projectedOutflowCents: "0",
        },
        periods: [],
        days: [
          {
            date: "2026-09-25",
            items: [
              forecastItem({
                referenceId: "salary",
                date: "2026-09-25",
                direction: "INFLOW",
                certainty: "EXPECTED",
              }),
            ],
            inflowCents: "50000",
            outflowCents: "0",
            netCents: "50000",
            openingProjectedBalanceCents: "0",
            closingProjectedBalanceCents: "50000",
          },
        ],
        minimumBalanceReferences: [],
      } as ForecastTimeline;

      const model = emptyModel({
        periodSummary: {
          state: "ready",
          data: {
            incomeCents: "0",
            expenseCents: "0",
            netCents: "0",
            expenseEventCount: 0,
            purchaseEventCount: 0,
            planned: {
              inflowCents: "50000",
              outflowCents: "0",
              realizedInflowCents: "0",
              realizedOutflowCents: "0",
              projectedInflowCents: "50000",
              projectedOutflowCents: "0",
            },
            reconciliation: {
              from: "2026-09-01",
              to: "2026-09-30",
              expenseFilter: "/transactions",
              incomeFilter: "/transactions",
            },
          },
        },
      });

      const alerts = deriveOverviewAlerts(model, { forecast });
      expect(alerts).toEqual([
        expect.objectContaining({
          ruleId: "EXPECTED_INCOME_UNREALIZED",
          severity: "attention",
        }),
      ]);
    });

    it("skips when forecast is missing", () => {
      const model = emptyModel({
        periodSummary: {
          state: "ready",
          data: {
            incomeCents: "0",
            expenseCents: "0",
            netCents: "0",
            expenseEventCount: 0,
            purchaseEventCount: 0,
            reconciliation: {
              from: "2026-09-01",
              to: "2026-09-30",
              expenseFilter: "/transactions",
              incomeFilter: "/transactions",
            },
          },
        },
      });

      expect(
        deriveOverviewAlerts(model).some(
          (alert) => alert.ruleId === "EXPECTED_INCOME_UNREALIZED",
        ),
      ).toBe(false);
    });
  });

  describe("BOX_INSUFFICIENT", () => {
    it("fires when a caixinha balance is negative", () => {
      const model = emptyModel({
        caixinhasSummary: {
          state: "ready",
          data: {
            status: "AVAILABLE",
            items: [
              {
                referenceId: "box-1",
                name: "Reserva",
                balanceCents: "-100",
                status: "ACTIVE",
              },
            ],
            totalCount: 1,
            viewAllHref: "/budgets",
          },
        },
      });

      const alerts = deriveOverviewAlerts(model);
      expect(alerts).toEqual([
        expect.objectContaining({
          ruleId: "BOX_INSUFFICIENT",
          severity: "attention",
          referenceId: "box-1",
        }),
      ]);
    });

    it("does not fire at exactly zero balance", () => {
      const model = emptyModel({
        caixinhasSummary: {
          state: "ready",
          data: {
            status: "AVAILABLE",
            items: [
              {
                referenceId: "box-1",
                name: "Reserva",
                balanceCents: "0",
                status: "ACTIVE",
              },
            ],
            totalCount: 1,
            viewAllHref: "/budgets",
          },
        },
      });

      expect(
        deriveOverviewAlerts(model).some(
          (alert) => alert.ruleId === "BOX_INSUFFICIENT",
        ),
      ).toBe(false);
    });

    it("skips when caixinhas origin is in error", () => {
      const model = emptyModel({
        caixinhasSummary: {
          state: "error",
          error: { code: "QUERY_FAILED" },
        },
      });

      expect(deriveOverviewAlerts(model)).toEqual([]);
    });
  });

  describe("cross-cutting rules", () => {
    it("skips forecast-derived alerts when forecast origin failed", () => {
      const model = emptyModel({
        spendable: readySpendable(
          spendableBreakdown({ closingProjectedBalanceCents: "-100" }),
        ),
        upcomingCommitments: {
          state: "error",
          error: { code: "FORECAST_QUERY_FAILED" },
        },
        upcomingIncome: {
          state: "error",
          error: { code: "FORECAST_QUERY_FAILED" },
        },
      });

      const alerts = deriveOverviewAlerts(model, { forecastOriginFailed: true });
      expect(alerts.some((alert) => alert.ruleId === "FORECAST_MONTH_NEGATIVE")).toBe(
        false,
      );
      expect(alerts.some((alert) => alert.ruleId === "COMMITMENT_SOON")).toBe(false);
    });

    it("returns no critical alerts for an empty household", () => {
      const forecast = {
        contractVersion: "s07.v1",
        scenario: "CONSERVATIVE",
        from: "2026-09-16",
        to: "2026-12-14",
        openingBalanceCents: "0",
        openingAdjustmentsCents: "0",
        openingProjectedBalanceCents: "0",
        closingProjectedBalanceCents: "0",
        minimumProjectedBalanceCents: "0",
        minimumProjectedOn: null,
        totals: {
          inflowCents: "0",
          outflowCents: "0",
          netCents: "0",
          realizedInflowCents: "0",
          realizedOutflowCents: "0",
          projectedInflowCents: "0",
          projectedOutflowCents: "0",
        },
        periods: [
          {
            period: "2026-10",
            inflowCents: "0",
            outflowCents: "100",
            netCents: "-100",
            realizedInflowCents: "0",
            realizedOutflowCents: "0",
            projectedInflowCents: "0",
            projectedOutflowCents: "100",
          },
        ],
        days: [],
        minimumBalanceReferences: [],
      } as ForecastTimeline;

      const model = emptyModel({
        spendable: readySpendable(
          spendableBreakdown({
            rawSpendableCents: "-100",
            displaySpendableCents: "0",
            closingProjectedBalanceCents: "-100",
          }),
        ),
      });

      const alerts = deriveOverviewAlerts(model, { forecast });
      expect(alerts.some((alert) => alert.severity === "critical")).toBe(false);
    });

    it("is deterministic for the same input", () => {
      const model = emptyModel({
        spendable: readySpendable(
          spendableBreakdown({ displaySpendableCents: "0", rawSpendableCents: "0" }),
        ),
        upcomingCommitments: {
          state: "ready",
          data: {
            items: [
              {
                referenceId: "commit-1",
                date: "2026-09-17",
                amountCents: "10000",
                direction: "OUTFLOW",
                label: "Parcela",
                originKind: "INSTALLMENT",
              },
            ],
            totalMatching: 1,
            viewAllHref: "/forecast",
          },
        },
        caixinhasSummary: {
          state: "ready",
          data: {
            status: "AVAILABLE",
            items: [
              {
                referenceId: "box-1",
                name: "Reserva",
                balanceCents: "-100",
                status: "ACTIVE",
              },
            ],
            totalCount: 1,
            viewAllHref: "/budgets",
          },
        },
      });

      expect(deriveOverviewAlerts(model)).toEqual(deriveOverviewAlerts(model));
    });

    it("caps alerts at five", () => {
      const model = emptyModel({
        spendable: readySpendable(
          spendableBreakdown({ displaySpendableCents: "0", rawSpendableCents: "0" }),
        ),
        upcomingCommitments: {
          state: "ready",
          data: {
            items: Array.from({ length: 3 }, (_, index) => ({
              referenceId: `commit-${index}`,
              date: `2026-09-${String(16 + index).padStart(2, "0")}`,
              amountCents: "10000",
              direction: "OUTFLOW" as const,
              label: "Parcela",
              originKind: "INSTALLMENT",
            })),
            totalMatching: 3,
            viewAllHref: "/forecast",
          },
        },
        caixinhasSummary: {
          state: "ready",
          data: {
            status: "AVAILABLE",
            items: Array.from({ length: 4 }, (_, index) => ({
              referenceId: `box-${index}`,
              name: `Caixinha ${index}`,
              balanceCents: "-100",
              status: "ACTIVE" as const,
            })),
            totalCount: 4,
            viewAllHref: "/budgets",
          },
        },
      });

      expect(deriveOverviewAlerts(model)).toHaveLength(5);
    });

    it("orders critical before attention, then date, then ruleId", () => {
      const forecast = {
        contractVersion: "s07.v1",
        scenario: "CONSERVATIVE",
        from: "2026-09-16",
        to: "2026-12-14",
        openingBalanceCents: "0",
        openingAdjustmentsCents: "0",
        openingProjectedBalanceCents: "0",
        closingProjectedBalanceCents: "0",
        minimumProjectedBalanceCents: "0",
        minimumProjectedOn: null,
        totals: {
          inflowCents: "0",
          outflowCents: "0",
          netCents: "0",
          realizedInflowCents: "0",
          realizedOutflowCents: "0",
          projectedInflowCents: "0",
          projectedOutflowCents: "0",
        },
        periods: [
          {
            period: "2026-10",
            inflowCents: "0",
            outflowCents: "100",
            netCents: "-100",
            realizedInflowCents: "0",
            realizedOutflowCents: "0",
            projectedInflowCents: "0",
            projectedOutflowCents: "100",
          },
        ],
        days: [
          {
            date: "2026-09-25",
            items: [
              forecastItem({
                referenceId: "salary",
                date: "2026-09-25",
                direction: "INFLOW",
                certainty: "EXPECTED",
              }),
            ],
            inflowCents: "50000",
            outflowCents: "0",
            netCents: "50000",
            openingProjectedBalanceCents: "0",
            closingProjectedBalanceCents: "50000",
          },
        ],
        minimumBalanceReferences: [],
      } as ForecastTimeline;

      const model = emptyModel({
        spendable: readySpendable(
          spendableBreakdown({ displaySpendableCents: "0", rawSpendableCents: "0" }),
        ),
        periodSummary: {
          state: "ready",
          data: {
            incomeCents: "0",
            expenseCents: "0",
            netCents: "0",
            expenseEventCount: 0,
            purchaseEventCount: 0,
            planned: {
              inflowCents: "50000",
              outflowCents: "0",
              realizedInflowCents: "0",
              realizedOutflowCents: "0",
              projectedInflowCents: "50000",
              projectedOutflowCents: "0",
            },
            reconciliation: {
              from: "2026-09-01",
              to: "2026-09-30",
              expenseFilter: "/transactions",
              incomeFilter: "/transactions",
            },
          },
        },
        upcomingCommitments: {
          state: "ready",
          data: {
            items: [
              {
                referenceId: "commit-1",
                date: "2026-09-20",
                amountCents: "10000",
                direction: "OUTFLOW",
                label: "Parcela",
                originKind: "INSTALLMENT",
              },
            ],
            totalMatching: 1,
            viewAllHref: "/forecast",
          },
        },
        caixinhasSummary: {
          state: "ready",
          data: {
            status: "AVAILABLE",
            items: [
              {
                referenceId: "box-1",
                name: "Reserva",
                balanceCents: "-100",
                status: "ACTIVE",
              },
            ],
            totalCount: 1,
            viewAllHref: "/budgets",
          },
        },
      });

      const alerts = deriveOverviewAlerts(model, { forecast });
      expect(alerts.map((alert) => alert.ruleId)).toEqual([
        "FORECAST_MONTH_NEGATIVE",
        "COMMITMENT_SOON",
        "BOX_INSUFFICIENT",
        "EXPECTED_INCOME_UNREALIZED",
        "SPENDABLE_NOT_POSITIVE",
      ]);
    });
  });
});
