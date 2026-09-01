import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildForecastItems,
  buildForecastTimelineFromSources,
  ForecastBuilderError,
  type ForecastBuilderInput,
  type ForecastEntryInput,
  type ForecastEventInput,
  type ForecastInstallmentInput,
  type ForecastPlannedEventInput,
} from "./builder";

const range = { from: "2026-09-01", to: "2026-09-30" } as const;

const context = {
  userId: "user-a",
  householdId: "household-a",
} as const;

const logSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

afterEach(() => {
  logSpy.mockClear();
});

function event(
  id: string,
  values: Partial<ForecastEventInput> = {},
): ForecastEventInput {
  return {
    id,
    householdId: context.householdId,
    kind: "EXPENSE",
    status: "POSTED",
    amountCents: "100",
    occurredOn: "2026-09-01",
    description: `event-${id}`,
    ...values,
  };
}

function entry(
  id: string,
  values: Partial<ForecastEntryInput> = {},
): ForecastEntryInput {
  return {
    id,
    householdId: context.householdId,
    financialEventId: values.financialEventId ?? `event-${id}`,
    amountCents: "-100",
    status: "POSTED",
    postedOn: "2026-09-01",
    expectedOn: null,
    installmentId: null,
    ...values,
  };
}

function input(values: Partial<ForecastBuilderInput> = {}): ForecastBuilderInput {
  return {
    ...range,
    context,
    ...values,
  };
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ForecastBuilderError);
    expect(error).toMatchObject({ code });
  }
}

describe("S07 T04 ForecastTimelineBuilder", () => {
  it("normalizes an ordinary recurring source with a stable date and metadata", () => {
    const items = buildForecastItems(input({
      recurringRules: [
        {
          id: "rule-rent",
          householdId: context.householdId,
          frequency: "MONTHLY",
          dayRule: "FIXED_DAY",
          dayOfMonth: 10,
          amountCents: "12500",
          kind: "EXPENSE",
          startOn: "2026-09-01",
          description: "  Rent\tSeptember  ",
        },
      ],
    }));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      date: "2026-09-10",
      amountCents: "12500",
      direction: "OUTFLOW",
      status: "PLANNED",
      certainty: "COMMITTED",
      referenceId: "rule-rent",
      source: {
        kind: "RECURRING",
        referenceId: "rule-rent",
        recurringRuleId: "rule-rent",
        occurrenceKey: "2026-09",
      },
    });
    expect(items[0]?.source.label).toBe("Rent September");
  });

  it("reconciles a partial planned event into realized plus residual without the original duplicate", () => {
    const plannedEvent: ForecastPlannedEventInput = {
      id: "planned-salary",
      householdId: context.householdId,
      kind: "INCOME",
      status: "POSTED",
      amountCents: "2000",
      expectedOn: "2026-09-05",
      description: "Salary",
      financialEventId: "salary-fact",
      isPartial: true,
      event: event("salary-fact", {
        kind: "INCOME",
        amountCents: "1200",
        description: "Salary posted",
      }),
      entries: [
        entry("salary-entry", {
          financialEventId: "salary-fact",
          amountCents: "1200",
          postedOn: "2026-09-06",
        }),
      ],
    };

    const items = buildForecastItems(input({
      plannedEvents: [plannedEvent],
      realizedEvents: [
        {
          ...plannedEvent.event!,
          entries: plannedEvent.entries,
        } as ForecastEventInput,
      ],
    }));

    expect(items).toHaveLength(2);
    expect(items.map(({ amountCents, status }) => [amountCents, status])).toEqual([
      ["800", "PLANNED"],
      ["1200", "POSTED"],
    ]);
    expect(items.every((item) => item.reconciliation?.key === "planned-salary")).toBe(true);
    expect(items[0]?.reconciliation).toMatchObject({
      plannedAmountCents: "2000",
      realizedAmountCents: "1200",
      remainingAmountCents: "800",
      varianceAmountCents: "-800",
      replacesReferenceId: "salary-fact",
    });
  });

  it("uses S06 effective dates and emits a single installment, never the purchase total", () => {
    const installment: ForecastInstallmentInput = {
      id: "installment-2",
      householdId: context.householdId,
      amountCents: "3333",
      status: "PLANNED",
      billingCycle: "2026-09-01",
      billingDueOn: "2026-09-20",
      sequence: 2,
      event: event("purchase-fact", {
        kind: "PURCHASE",
        amountCents: "10000",
        description: "Purchase total (not a forecast line)",
      }),
      entries: [
        entry("installment-entry", {
          financialEventId: "purchase-fact",
          installmentId: "installment-2",
          amountCents: "-3333",
          status: "EXPECTED",
          expectedOn: "2026-09-20",
          postedOn: null,
        }),
      ],
    };

    const items = buildForecastItems(input({ installments: [installment] }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      date: "2026-09-20",
      amountCents: "3333",
      direction: "OUTFLOW",
      status: "EXPECTED",
      certainty: "COMMITTED",
      referenceId: "installment-2",
      source: {
        kind: "INSTALLMENT",
        billingCycle: "2026-09",
        installmentSequence: 2,
      },
    });
  });

  it("reconciles recurring realization by rule/competence and excludes cancelled obligations", () => {
    const items = buildForecastItems(input({
      recurringRules: [
        {
          id: "rule-recurring",
          householdId: context.householdId,
          frequency: "MONTHLY",
          dayRule: "FIXED_DAY",
          dayOfMonth: 10,
          amountCents: "1000",
          kind: "EXPENSE",
          startOn: "2026-09-01",
          description: "Recurring bill",
        },
      ],
      recurringOccurrences: [
        {
          id: "occurrence-posted",
          householdId: context.householdId,
          recurringRuleId: "rule-recurring",
          occurrenceKey: "2026-09",
          status: "POSTED",
          financialEventId: "recurring-fact",
          event: event("recurring-fact", {
            amountCents: "1200",
            description: "Recurring bill posted",
          }),
          entries: [
            entry("recurring-entry", {
              financialEventId: "recurring-fact",
              amountCents: "-1200",
              postedOn: "2026-09-12",
            }),
          ],
        },
        {
          id: "occurrence-cancelled",
          householdId: context.householdId,
          recurringRuleId: "rule-recurring",
          occurrenceKey: "2026-10",
          status: "CANCELLED",
        },
      ],
      realizedEvents: [
        {
          ...event("recurring-fact", { amountCents: "1200" }),
          entries: [
            entry("recurring-entry", {
              financialEventId: "recurring-fact",
              amountCents: "-1200",
              postedOn: "2026-09-12",
            }),
          ],
        } as ForecastEventInput,
      ],
    }));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      date: "2026-09-12",
      amountCents: "1200",
      status: "POSTED",
      referenceId: "occurrence-posted",
      reconciliation: {
        key: "rule-recurring:2026-09",
        realizedAmountCents: "1200",
      },
    });
  });

  it("uses the posted ledger date for a posted installment and drops cancelled installments", () => {
    const items = buildForecastItems(input({
      installments: [
        {
          id: "posted-installment",
          householdId: context.householdId,
          amountCents: "2500",
          status: "PLANNED",
          billingCycle: "2026-09-01",
          billingDueOn: "2026-09-20",
          sequence: 1,
          event: event("purchase-posted", { kind: "PURCHASE", amountCents: "2500" }),
          entries: [
            entry("posted-installment-entry", {
              financialEventId: "purchase-posted",
              installmentId: "posted-installment",
              amountCents: "-2500",
              status: "POSTED",
              postedOn: "2026-09-14",
              expectedOn: null,
            }),
          ],
        },
        {
          id: "cancelled-installment",
          householdId: context.householdId,
          amountCents: "2500",
          status: "CANCELLED",
          billingCycle: "2026-09-01",
          billingDueOn: "2026-09-20",
          sequence: 2,
        },
      ],
    }));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      date: "2026-09-14",
      status: "POSTED",
      certainty: "REALIZED",
      referenceId: "posted-installment",
    });
  });

  it("accepts the flattened S06 statement shape for expected installments", () => {
    const items = buildForecastItems(input({
      installments: [
        {
          referenceId: "statement-installment",
          installmentId: "statement-installment",
          householdId: context.householdId,
          financialEventId: "statement-purchase",
          description: "Statement line",
          amountCents: "1000",
          installmentStatus: "PLANNED",
          entryStatus: "EXPECTED",
          billingCycle: "2026-09-01",
          dueOn: "2026-09-22",
          installmentNumber: 1,
        },
      ],
    }));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      date: "2026-09-22",
      referenceId: "statement-installment",
      source: { kind: "INSTALLMENT", billingCycle: "2026-09" },
    });
  });

  it("drops cancellations, keeps overdue commitments for opening adjustments, and does not infer realization", () => {
    const items = buildForecastItems(input({
      plannedEvents: [
        {
          id: "cancelled",
          householdId: context.householdId,
          kind: "EXPENSE",
          status: "CANCELLED",
          amountCents: "100",
          expectedOn: "2026-09-02",
          description: "cancelled",
        },
        {
          id: "overdue",
          householdId: context.householdId,
          kind: "EXPENSE",
          status: "PLANNED",
          amountCents: "300",
          expectedOn: "2026-08-20",
          description: "still due",
        },
      ],
    }));
    expect(items.map(({ referenceId }) => referenceId)).toEqual(["overdue"]);
    expect(items[0]?.status).toBe("PLANNED");

    const timeline = buildForecastTimelineFromSources(input({
      openingBalanceCents: "1000",
      plannedEvents: [
        {
          id: "overdue",
          householdId: context.householdId,
          kind: "EXPENSE",
          status: "PLANNED",
          amountCents: "300",
          expectedOn: "2026-08-20",
          description: "still due",
        },
      ],
    }));
    expect(timeline.openingBalanceCents).toBe("1000");
    expect(timeline.openingAdjustmentsCents).toBe("-300");
    expect(timeline.openingProjectedBalanceCents).toBe("700");
    expect(timeline.days).toEqual([]);
  });

  it("applies closed certainty policy and produces deterministic ordering independent of source row order", () => {
    const rows: ForecastPlannedEventInput[] = [
      {
        id: "expected-income",
        householdId: context.householdId,
        kind: "INCOME",
        status: "EXPECTED",
        amountCents: "500",
        expectedOn: "2026-09-01",
        description: "uncertain",
        includeInConservativeForecast: false,
      },
      {
        id: "known-expense",
        householdId: context.householdId,
        kind: "EXPENSE",
        status: "PLANNED",
        amountCents: "200",
        expectedOn: "2026-09-01",
        description: "known",
      },
    ];
    const first = buildForecastTimelineFromSources(input({
      openingBalanceCents: "1000",
      plannedEvents: rows,
      scenario: "CONSERVATIVE",
    }));
    const second = buildForecastTimelineFromSources(input({
      openingBalanceCents: "1000",
      plannedEvents: [...rows].reverse(),
      scenario: "EXPECTED",
    }));

    expect(first.totals).toMatchObject({ inflowCents: "0", outflowCents: "200" });
    expect(second.totals).toMatchObject({ inflowCents: "500", outflowCents: "200" });
    expect(second.days[0]?.items.map(({ referenceId }) => referenceId)).toEqual([
      "known-expense",
      "expected-income",
    ]);
  });

  it("fails closed for cross-tenant rows and malformed duplicate sources", () => {
    expectCode(
      () => buildForecastItems(input({
        plannedEvents: [
          {
            id: "foreign",
            householdId: "household-b",
            kind: "EXPENSE",
            status: "PLANNED",
            amountCents: "1",
            expectedOn: "2026-09-01",
          },
        ],
      })),
      "TENANT_RESOURCE_NOT_FOUND",
    );

    expectCode(
      () => buildForecastItems(input({
        plannedEvents: [
          {
            id: "same",
            householdId: context.householdId,
            kind: "EXPENSE",
            status: "PLANNED",
            amountCents: "1",
            expectedOn: "2026-09-01",
          },
          {
            id: "same",
            householdId: context.householdId,
            kind: "EXPENSE",
            status: "PLANNED",
            amountCents: "1",
            expectedOn: "2026-09-01",
          },
        ],
      })),
      "FORECAST_INCONSISTENT",
    );
  });

  it("emits only allow-listed aggregate metadata through the T07 builder hook", () => {
    const records: Record<string, unknown>[] = [];
    buildForecastItems(input({
      observability: {
        requestId: "request-t04",
        onRecord: (record) => records.push(record as unknown as Record<string, unknown>),
      },
      plannedEvents: [
        {
          id: "observability-event",
          householdId: context.householdId,
          kind: "EXPENSE",
          status: "PLANNED",
          amountCents: "987654",
          expectedOn: "2026-09-03",
          description: "private description",
        },
      ],
    }));

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      stage: "builder",
      operation: "forecast.timeline.build",
      sourceKind: "ALL",
      itemCount: 1,
      requestId: "request-t04",
    });
    expect(JSON.stringify(records[0])).not.toContain("987654");
    expect(JSON.stringify(records[0])).not.toContain("private description");
  });
});
