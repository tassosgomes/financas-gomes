import { Temporal } from "@js-temporal/polyfill";

import type { ForecastTimeline } from "@/modules/forecast/contracts";

import {
  overviewCents,
  overviewDate,
  type OverviewAlert,
  type OverviewAlertRuleId,
  type OverviewAlertSeverity,
  type OverviewReadModel,
} from "./contracts";

const MAX_ALERTS = 5;

const ALERT_MESSAGES: Record<OverviewAlertRuleId, string> = {
  SPENDABLE_NOT_POSITIVE:
    "A disponibilidade para gastar está zerada. Revise compromissos e reservas.",
  FORECAST_MONTH_NEGATIVE: "Há um mês futuro com saldo projetado negativo.",
  COMMITMENT_SOON: "Há um compromisso nos próximos 7 dias.",
  EXPECTED_INCOME_UNREALIZED:
    "Uma receita prevista deste mês ainda não foi realizada.",
  BOX_INSUFFICIENT: "Uma Caixinha está com saldo negativo.",
};

const CRITICAL_SPENDABLE_MESSAGE =
  "O disponível bruto está negativo. Preserve a reserva antes de novos gastos.";

const SEVERITY_RANK: Record<OverviewAlertSeverity, number> = {
  critical: 0,
  attention: 1,
};

export interface DeriveOverviewAlertsExtras {
  readonly forecast?: ForecastTimeline | null;
  readonly forecastOriginFailed?: boolean;
}

function createAlert(
  ruleId: OverviewAlertRuleId,
  severity: OverviewAlertSeverity,
  message: string,
  fields?: { readonly date?: string; readonly referenceId?: string },
): OverviewAlert {
  return {
    ruleId,
    severity,
    message,
    ...(fields?.date ? { date: fields.date } : {}),
    ...(fields?.referenceId ? { referenceId: fields.referenceId } : {}),
  };
}

function compareAlerts(left: OverviewAlert, right: OverviewAlert): number {
  const severityCompare =
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  if (severityCompare !== 0) {
    return severityCompare;
  }

  if (left.date === undefined && right.date !== undefined) {
    return 1;
  }
  if (left.date !== undefined && right.date === undefined) {
    return -1;
  }
  if (left.date !== undefined && right.date !== undefined) {
    const dateCompare = Temporal.PlainDate.compare(
      overviewDate(left.date),
      overviewDate(right.date),
    );
    if (dateCompare !== 0) {
      return dateCompare;
    }
  }

  return left.ruleId.localeCompare(right.ruleId);
}

function isEmptyHousehold(model: OverviewReadModel): boolean {
  const periodSummaryInactive =
    model.periodSummary.state === "empty" ||
    (model.periodSummary.state === "ready" &&
      model.periodSummary.data !== undefined &&
      model.periodSummary.data.incomeCents === "0" &&
      model.periodSummary.data.expenseCents === "0" &&
      model.periodSummary.data.expenseEventCount === 0 &&
      model.periodSummary.data.purchaseEventCount === 0);

  return (
    periodSummaryInactive &&
    model.expensesByCategory.state === "empty" &&
    model.upcomingCommitments.state === "empty" &&
    model.upcomingIncome.state === "empty" &&
    model.caixinhasSummary.state === "empty"
  );
}

function isDateWithinCommitmentWindow(
  date: string,
  asOf: string,
): boolean {
  const itemDate = overviewDate(date);
  const start = overviewDate(asOf).add({ days: 1 });
  const end = overviewDate(asOf).add({ days: 7 });
  return (
    Temporal.PlainDate.compare(itemDate, start) >= 0 &&
    Temporal.PlainDate.compare(itemDate, end) <= 0
  );
}

function deriveSpendableAlert(model: OverviewReadModel): OverviewAlert | null {
  if (model.spendable.state !== "ready" || !model.spendable.data) {
    return null;
  }

  const { breakdown } = model.spendable.data;
  const rawSpendable = overviewCents(breakdown.rawSpendableCents);

  if (rawSpendable < BigInt(0)) {
    return createAlert(
      "SPENDABLE_NOT_POSITIVE",
      "critical",
      CRITICAL_SPENDABLE_MESSAGE,
    );
  }

  if (breakdown.displaySpendableCents === "0") {
    return createAlert(
      "SPENDABLE_NOT_POSITIVE",
      "attention",
      ALERT_MESSAGES.SPENDABLE_NOT_POSITIVE,
    );
  }

  return null;
}

function deriveForecastMonthNegativeAlert(
  model: OverviewReadModel,
  forecast: ForecastTimeline | null | undefined,
  forecastOriginFailed: boolean,
): OverviewAlert | null {
  if (forecast) {
    for (const bucket of forecast.periods) {
      if (
        bucket.period > model.period.key &&
        overviewCents(bucket.netCents) < BigInt(0)
      ) {
        return createAlert(
          "FORECAST_MONTH_NEGATIVE",
          "critical",
          ALERT_MESSAGES.FORECAST_MONTH_NEGATIVE,
          { date: `${bucket.period}-01` },
        );
      }
    }

    const asOf = model.period.asOf;
    for (const day of forecast.days) {
      if (
        Temporal.PlainDate.compare(
          overviewDate(day.date),
          overviewDate(asOf),
        ) > 0 &&
        overviewCents(day.closingProjectedBalanceCents) < BigInt(0)
      ) {
        return createAlert(
          "FORECAST_MONTH_NEGATIVE",
          "critical",
          ALERT_MESSAGES.FORECAST_MONTH_NEGATIVE,
          { date: day.date },
        );
      }
    }

    return null;
  }

  if (forecastOriginFailed) {
    return null;
  }

  if (model.spendable.state !== "ready" || !model.spendable.data) {
    return null;
  }

  if (
    overviewCents(model.spendable.data.breakdown.closingProjectedBalanceCents) <
    BigInt(0)
  ) {
    return createAlert(
      "FORECAST_MONTH_NEGATIVE",
      "critical",
      ALERT_MESSAGES.FORECAST_MONTH_NEGATIVE,
    );
  }

  return null;
}

function deriveCommitmentSoonAlert(
  model: OverviewReadModel,
  forecast: ForecastTimeline | null | undefined,
): OverviewAlert | null {
  const candidates: Array<{ date: string; referenceId: string }> = [];

  if (
    model.upcomingCommitments.state === "ready" &&
    model.upcomingCommitments.data
  ) {
    for (const item of model.upcomingCommitments.data.items) {
      if (
        item.direction === "OUTFLOW" &&
        isDateWithinCommitmentWindow(item.date, model.period.asOf)
      ) {
        candidates.push({
          date: item.date,
          referenceId: item.referenceId,
        });
      }
    }
  }

  if (forecast) {
    for (const day of forecast.days) {
      if (!isDateWithinCommitmentWindow(day.date, model.period.asOf)) {
        continue;
      }

      for (const item of day.items) {
        if (item.direction === "OUTFLOW") {
          candidates.push({
            date: item.date,
            referenceId: item.referenceId,
          });
        }
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const dateCompare = Temporal.PlainDate.compare(
      overviewDate(left.date),
      overviewDate(right.date),
    );
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return left.referenceId.localeCompare(right.referenceId);
  });

  const soonest = candidates[0];
  return createAlert(
    "COMMITMENT_SOON",
    "attention",
    ALERT_MESSAGES.COMMITMENT_SOON,
    { date: soonest.date, referenceId: soonest.referenceId },
  );
}

function deriveExpectedIncomeUnrealizedAlert(
  model: OverviewReadModel,
  forecast: ForecastTimeline | null | undefined,
): OverviewAlert | null {
  if (!forecast) {
    return null;
  }

  const hasExpectedInflowInCurrentMonth = forecast.days.some((day) => {
    if (!day.date.startsWith(model.period.key)) {
      return false;
    }

    return day.items.some(
      (item) => item.direction === "INFLOW" && item.certainty === "EXPECTED",
    );
  });

  if (!hasExpectedInflowInCurrentMonth) {
    return null;
  }

  const incomeCents =
    model.periodSummary.state === "ready" && model.periodSummary.data
      ? model.periodSummary.data.incomeCents
      : "0";
  const realizedInflowCents =
    model.periodSummary.state === "ready" && model.periodSummary.data?.planned
      ? model.periodSummary.data.planned.realizedInflowCents
      : "0";

  if (incomeCents !== "0" && overviewCents(realizedInflowCents) !== BigInt(0)) {
    return null;
  }

  return createAlert(
    "EXPECTED_INCOME_UNREALIZED",
    "attention",
    ALERT_MESSAGES.EXPECTED_INCOME_UNREALIZED,
  );
}

function deriveBoxInsufficientAlerts(model: OverviewReadModel): OverviewAlert[] {
  if (model.caixinhasSummary.state !== "ready" || !model.caixinhasSummary.data) {
    return [];
  }

  const alerts: OverviewAlert[] = [];

  for (const item of model.caixinhasSummary.data.items) {
    if (overviewCents(item.balanceCents) < BigInt(0)) {
      alerts.push(
        createAlert(
          "BOX_INSUFFICIENT",
          "attention",
          ALERT_MESSAGES.BOX_INSUFFICIENT,
          { referenceId: item.referenceId },
        ),
      );
    }
  }

  return alerts;
}

/**
 * Pure deterministic alert derivation from the consolidated overview read model.
 */
export function deriveOverviewAlerts(
  model: OverviewReadModel,
  extras?: DeriveOverviewAlertsExtras,
): readonly OverviewAlert[] {
  const forecast = extras?.forecast ?? null;
  const forecastOriginFailed = extras?.forecastOriginFailed === true;
  const candidates: OverviewAlert[] = [];

  const spendableAlert = deriveSpendableAlert(model);
  if (spendableAlert) {
    candidates.push(spendableAlert);
  }

  if (forecast !== null || (!forecastOriginFailed && model.spendable.state === "ready")) {
    const forecastAlert = deriveForecastMonthNegativeAlert(
      model,
      forecast,
      forecastOriginFailed,
    );
    if (forecastAlert) {
      candidates.push(forecastAlert);
    }
  }

  if (!forecastOriginFailed && (forecast !== null || model.upcomingCommitments.state === "ready")) {
    const commitmentAlert = deriveCommitmentSoonAlert(model, forecast);
    if (commitmentAlert) {
      candidates.push(commitmentAlert);
    }
  }

  if (forecast) {
    const expectedIncomeAlert = deriveExpectedIncomeUnrealizedAlert(
      model,
      forecast,
    );
    if (expectedIncomeAlert) {
      candidates.push(expectedIncomeAlert);
    }
  }

  candidates.push(...deriveBoxInsufficientAlerts(model));

  const filtered = isEmptyHousehold(model)
    ? candidates.filter((alert) => alert.severity !== "critical")
    : candidates;

  return filtered.sort(compareAlerts).slice(0, MAX_ALERTS);
}
