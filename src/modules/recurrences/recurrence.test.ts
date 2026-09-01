import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";

import {
  RecurrenceDomainError,
  assertRecurringRuleBelongsToHousehold,
  createBusinessCalendar,
  createProspectiveRuleVersion,
  firstBusinessDayOfMonth,
  formatRecurrenceDate,
  generateRecurringOccurrences,
  isBusinessDay,
  lastBusinessDayOfMonth,
  normalizeRecurringRule,
  occurrenceKey,
  reconcileRecurringOccurrence,
  reconcileRecurringOccurrences,
  resolveOccurrenceDate,
  resolveRecurringRule,
  validateRecurringRuleVersions,
  type RecurringRuleInput,
} from "./index";

const monthlyRule: RecurringRuleInput = {
  id: "rule-salary",
  householdId: "household-a",
  frequency: "MONTHLY",
  dayRule: "FIXED_DAY",
  dayOfMonth: 31,
  amountCents: "1000000",
  direction: "INFLOW",
  startOn: "2026-01-01",
};

function expectDomainCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(RecurrenceDomainError);
    expect(error).toMatchObject({ code });
  }
}

describe("S07 recurrence/calendar domain", () => {
  it("uses strict ISO dates and Temporal.PlainDate without timezone drift", () => {
    expect(formatRecurrenceDate(Temporal.PlainDate.from("2026-08-31"))).toBe(
      "2026-08-31",
    );
    expect(() => formatRecurrenceDate(Temporal.PlainDate.from("2026-08-31"))).not.toThrow();
    expect(() => resolveOccurrenceDate(monthlyRule, "2026-02")).not.toThrow();
    expect(() => resolveOccurrenceDate(monthlyRule, "2026-02-30")).toThrowError(
      RecurrenceDomainError,
    );
  });

  it("normalizes fixed days at month end, including leap years and year rollover", () => {
    expect(resolveOccurrenceDate(monthlyRule, "2026-02").toString()).toBe(
      "2026-02-28",
    );
    expect(resolveOccurrenceDate(monthlyRule, "2028-02").toString()).toBe(
      "2028-02-29",
    );
    expect(resolveOccurrenceDate(monthlyRule, "2026-12").toString()).toBe(
      "2026-12-31",
    );
    expect(occurrenceKey("MONTHLY", "2027-01")).toBe("2027-01");
    expect(occurrenceKey("YEARLY", "2027")).toBe("2027");
  });

  it("resolves weekdays and household holidays deterministically", () => {
    const calendar = createBusinessCalendar({
      householdId: "household-a",
      holidays: [
        { householdId: "household-a", date: "2026-09-01", name: "feriado" },
        { householdId: "household-a", date: "2026-09-30" },
      ],
    });
    expect(isBusinessDay("2026-09-01", calendar)).toBe(false);
    expect(firstBusinessDayOfMonth("2026-09", calendar).toString()).toBe(
      "2026-09-02",
    );
    expect(lastBusinessDayOfMonth("2026-09", calendar).toString()).toBe(
      "2026-09-29",
    );
    expect(
      resolveOccurrenceDate(
        {
          ...monthlyRule,
          dayRule: "FIRST_BUSINESS_DAY",
          dayOfMonth: null,
        },
        "2026-09",
        calendar,
      ).toString(),
    ).toBe("2026-09-02");
    expect(
      resolveOccurrenceDate(
        {
          ...monthlyRule,
          dayRule: "LAST_BUSINESS_DAY",
          dayOfMonth: null,
        },
        "2026-09",
        calendar,
      ).toString(),
    ).toBe("2026-09-29");
  });

  it("generates only occurrences in the inclusive interval and applies rule vigency", () => {
    const occurrences = generateRecurringOccurrences(
      { ...monthlyRule, endOn: "2026-03-15" },
      "2026-01-01",
      "2026-04-30",
    );
    expect(occurrences.map((occurrence) => [occurrence.occurrenceKey, occurrence.date])).toEqual([
      ["2026-01", "2026-01-31"],
      ["2026-02", "2026-02-28"],
    ]);

    const yearly = normalizeRecurringRule({
      id: "annual",
      frequency: "YEARLY",
      monthOfYear: 2,
      dayRule: "FIXED_DAY",
      dayOfMonth: 29,
      amountCents: "1",
      direction: "OUTFLOW",
      startOn: "2024-01-01",
    });
    expect(
      generateRecurringOccurrences(yearly, "2027-01-01", "2029-12-31").map(
        (occurrence) => occurrence.date,
      ),
    ).toEqual(["2027-02-28", "2028-02-29", "2029-02-28"]);
  });

  it("keeps historical occurrences while prospective edits start a new version", () => {
    const change = createProspectiveRuleVersion(
      monthlyRule,
      {
        ...monthlyRule,
        id: "rule-salary-v2",
        amountCents: "1200000",
        startOn: "2026-10-01",
      },
      "2026-10-01",
    );
    expect(change.previous.endOn).not.toBeNull();
    expect(change.previous.endOn?.toString()).toBe("2026-09-30");
    expect(change.next.startOn.toString()).toBe("2026-10-01");
    expect(change.previous.id).toBe("rule-salary");
    expect(change.next.id).toBe("rule-salary-v2");
    expect(resolveRecurringRule([change.previous, change.next], "2026-09-30").id).toBe(
      "rule-salary",
    );
    expect(resolveRecurringRule([change.previous, change.next], "2026-10-01").id).toBe(
      "rule-salary-v2",
    );
    expect(validateRecurringRuleVersions([change.previous, change.next])).toHaveLength(2);
  });

  it("reconciles full and partial POSTED realizations without duplicate forecast", () => {
    const occurrence = generateRecurringOccurrences(
      monthlyRule,
      "2026-09-01",
      "2026-09-30",
    )[0];
    const full = reconcileRecurringOccurrence(occurrence, {
      householdId: "household-a",
      recurringRuleId: "rule-salary",
      occurrenceKey: "2026-09",
      realization: {
        financialEventId: "event-1",
        amountCents: "1150000",
        postedOn: "2026-09-02",
      },
    });
    expect(full.items).toHaveLength(1);
    expect(full.items[0]).toMatchObject({
      role: "REALIZED",
      amountCents: "1150000",
      status: "POSTED",
      date: "2026-09-02",
    });
    expect(full.reconciliation).toMatchObject({
      plannedAmountCents: "1000000",
      realizedAmountCents: "1150000",
      remainingAmountCents: null,
      varianceAmountCents: "150000",
    });

    const partial = reconcileRecurringOccurrence(occurrence, {
      occurrenceKey: "2026-09",
      realization: {
        financialEventId: "event-2",
        amountCents: "400000",
        partial: true,
      },
    });
    expect(partial.items.map((item) => [item.role, item.amountCents])).toEqual([
      ["REALIZED", "400000"],
      ["REMAINING", "600000"],
    ]);
    expect(partial.remainingAmountCents).toBe("600000");
  });

  it("skips cancelled occurrences and rejects cross-household references", () => {
    const occurrence = generateRecurringOccurrences(
      monthlyRule,
      "2026-09-01",
      "2026-09-30",
    )[0];
    const cancelled = reconcileRecurringOccurrence(occurrence, {
      occurrenceKey: "2026-09",
      cancelled: true,
    });
    expect(cancelled.active).toBe(false);
    expect(cancelled.items).toEqual([]);
    expectDomainCode(
      () =>
        reconcileRecurringOccurrence(occurrence, {
          householdId: "household-b",
          occurrenceKey: "2026-09",
        }),
      "TENANT_RESOURCE_NOT_FOUND",
    );
    expectDomainCode(
      () => assertRecurringRuleBelongsToHousehold(monthlyRule, "household-b"),
      "TENANT_RESOURCE_NOT_FOUND",
    );
    expectDomainCode(
      () =>
        createBusinessCalendar({
          householdId: "household-a",
          holidays: [{ householdId: "household-b", date: "2026-09-07" }],
        }),
      "TENANT_MISMATCH",
    );
  });

  it("rejects duplicate occurrence keys and invalid rule ranges", () => {
    const occurrence = generateRecurringOccurrences(
      monthlyRule,
      "2026-09-01",
      "2026-09-30",
    )[0];
    expectDomainCode(
      () => reconcileRecurringOccurrences([occurrence, { ...occurrence }]),
      "FORECAST_INCONSISTENT",
    );
    expectDomainCode(
      () => normalizeRecurringRule({ ...monthlyRule, endOn: "2025-12-31" }),
      "INVALID_RULE_RANGE",
    );
    expectDomainCode(
      () => resolveOccurrenceDate({ ...monthlyRule, monthOfYear: 3 }, "2026-09"),
      "INVALID_MONTH_OF_YEAR",
    );
  });
});
