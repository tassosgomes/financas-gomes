import { Temporal } from "@js-temporal/polyfill";

import {
  overviewDate,
  type OverviewPeriod,
} from "./contracts";

function formatPeriodKey(date: Temporal.PlainDate): string {
  return `${date.year.toString(10).padStart(4, "0")}-${date.month
    .toString(10)
    .padStart(2, "0")}`;
}

/**
 * Resolves the civil month of `asOf` as the canonical S10 aggregation window.
 * `from` is inclusive on day 1; `to` is inclusive on the last civil day.
 */
export function civilMonthPeriod(asOf: string): OverviewPeriod {
  const anchor = overviewDate(asOf, "asOf");
  const fromDate = anchor.with({ day: 1 });
  const toDate = fromDate
    .add({ months: 1 })
    .subtract({ days: 1 });

  return {
    key: formatPeriodKey(fromDate),
    from: fromDate.toString(),
    to: toDate.toString(),
    asOf: anchor.toString(),
  };
}

export function isDateWithinOverviewPeriod(
  value: string,
  period: OverviewPeriod,
): boolean {
  const date = overviewDate(value, "occurredOn");
  const from = overviewDate(period.from, "from");
  const to = overviewDate(period.to, "to");
  return (
    Temporal.PlainDate.compare(date, from) >= 0 &&
    Temporal.PlainDate.compare(date, to) <= 0
  );
}
