import { describe, expect, it } from "vitest";

import {
  MAX_INSTALLMENT_AMOUNT_CENTS,
  MAX_INSTALLMENT_COUNT,
  allocateInstallments,
  assertInstallmentAggregateInvariants,
  cancelInstallmentPlan,
  generateInstallmentSchedule,
  isInstallmentPlanValid,
  postInstallment,
  remainingInstallmentBalance,
  sumInstallments,
  type InstallmentPlan,
} from "./installments";
import { resolveBillingCycle, type BillingRule } from "./billing-cycle";

const baseRule: BillingRule = {
  id: "t15-rule-v1",
  closingDay: 10,
  dueDay: 20,
  effectiveFrom: "2026-01-01",
};

function expectDomainCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("T15 incremental S06 domain matrix", () => {
  it.each([
    ["2026-08-09", "2026-08", "2026-08-10", "2026-08-20"],
    ["2026-08-10", "2026-09", "2026-09-10", "2026-09-20"],
    ["2026-08-11", "2026-09", "2026-09-10", "2026-09-20"],
    ["2026-12-10", "2027-01", "2027-01-10", "2027-01-20"],
  ] as const)(
    "classifies before/on/after closing and December rollover (%s)",
    (occurredOn, billingCycle, closingOn, dueOn) => {
      expect(
        resolveBillingCycle({ occurredOn, rule: baseRule }),
      ).toMatchObject({ billingCycle, closingOn, dueOn });
    },
  );

  it.each([
    ["2026-02-27", "2026-02", "2026-02-28", "2026-03-20"],
    ["2026-02-28", "2026-03", "2026-03-31", "2026-04-20"],
    ["2028-02-28", "2028-02", "2028-02-29", "2028-03-20"],
    ["2028-02-29", "2028-03", "2028-03-31", "2028-04-20"],
  ] as const)(
    "clamps configured day 31 at non-leap/leap month end (%s)",
    (occurredOn, billingCycle, closingOn, dueOn) => {
      expect(
        resolveBillingCycle({
          occurredOn,
          rule: { ...baseRule, closingDay: 31 },
        }),
      ).toMatchObject({ billingCycle, closingOn, dueOn });
    },
  );

  it.each([
    [5, "2026-02-05"],
    [10, "2026-02-10"],
    [20, "2026-01-20"],
    [31, "2026-01-31"],
  ] as const)(
    "chooses the first normalized due date strictly after closing (due day %s)",
    (dueDay, expectedDueOn) => {
      expect(
        resolveBillingCycle({
          occurredOn: "2026-01-09",
          rule: { ...baseRule, dueDay },
        }).dueOn,
      ).toBe(expectedDueOn);
    },
  );

  it("keeps a materialized schedule stable after source-rule changes", () => {
    const sourceRule: BillingRule = { ...baseRule };
    const plan = generateInstallmentSchedule({
      planId: "t15-plan-snapshot",
      purchaseId: "t15-purchase-snapshot",
      amountCents: "300",
      installmentCount: 3,
      occurredOn: "2026-08-09",
      billingRule: sourceRule,
    });
    const before = plan.installments.map((installment) => ({
      billingCycle: installment.billingCycle,
      closingOn: installment.billingClosingOn,
      dueOn: installment.billingDueOn,
      billingRuleId: installment.billingRuleId,
    }));

    sourceRule.closingDay = 31;
    sourceRule.dueDay = 5;
    sourceRule.effectiveFrom = "2027-01-01";

    expect(
      plan.installments.map((installment) => ({
        billingCycle: installment.billingCycle,
        closingOn: installment.billingClosingOn,
        dueOn: installment.billingDueOn,
        billingRuleId: installment.billingRuleId,
      })),
    ).toEqual(before);
    expect(assertInstallmentAggregateInvariants(plan)).toBe(true);
  });

  it.each([
    ["10000", 1, ["10000"]],
    ["10000", 2, ["5000", "5000"]],
    ["10000", 3, ["3334", "3333", "3333"]],
    ["17", 5, ["4", "4", "3", "3", "3"]],
  ] as const)(
    "allocates exact cents with deterministic remainder (%s / %s)",
    (amount, count, expected) => {
      expect(allocateInstallments(amount, count)).toEqual(
        expected.map((value) => BigInt(value)),
      );
    },
  );

  it("keeps the BIGINT upper bound exact at the maximum allowed count", () => {
    const amounts = allocateInstallments(
      MAX_INSTALLMENT_AMOUNT_CENTS,
      MAX_INSTALLMENT_COUNT,
    );

    expect(amounts).toHaveLength(MAX_INSTALLMENT_COUNT);
    expect(amounts.reduce((sum, amount) => sum + amount, BigInt(0))).toBe(
      MAX_INSTALLMENT_AMOUNT_CENTS,
    );
    expect(amounts.every((amount) => amount > BigInt(0))).toBe(true);
  });

  it.each([
    [0, "INVALID_INSTALLMENT_COUNT"],
    [-1, "INVALID_INSTALLMENT_COUNT"],
    [1.5, "INVALID_INSTALLMENT_COUNT"],
    [MAX_INSTALLMENT_COUNT + 1, "INSTALLMENT_COUNT_OUT_OF_RANGE"],
  ] as const)("rejects an invalid installment count (%s)", (count, code) => {
    expectDomainCode(() => allocateInstallments("100", count), code);
  });

  it("verifies aggregate links, balances, publication and whole-plan cancellation", () => {
    const plan = generateInstallmentSchedule({
      planId: "t15-plan-state",
      purchaseId: "t15-purchase-state",
      amountCents: "10000",
      installmentCount: 3,
      occurredOn: "2026-08-09",
      billingRule: baseRule,
    });
    const posted = postInstallment(plan, 1);
    const cancelled = cancelInstallmentPlan(posted);

    expect(sumInstallments(plan)).toBe(BigInt("10000"));
    expect(remainingInstallmentBalance(posted)).toBe(BigInt("6666"));
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.installments.every((row) => row.status === "CANCELLED")).toBe(
      true,
    );
    expect(remainingInstallmentBalance(cancelled)).toBe(BigInt(0));
    expect(isInstallmentPlanValid(cancelled)).toBe(true);
  });

  it("fails closed for malformed sequence, state, snapshot and total", () => {
    const plan = generateInstallmentSchedule({
      planId: "t15-plan-invalid",
      purchaseId: "t15-purchase-invalid",
      amountCents: "300",
      installmentCount: 3,
      occurredOn: "2026-08-09",
      billingRule: baseRule,
    });
    const malformedPlans: readonly InstallmentPlan[] = [
      {
        ...plan,
        installments: [
          plan.installments[0],
          { ...plan.installments[1], sequence: 1 },
          plan.installments[2],
        ],
      },
      {
        ...plan,
        installments: [
          { ...plan.installments[0], status: "CANCELLED" },
          plan.installments[1],
          plan.installments[2],
        ],
      },
      {
        ...plan,
        installments: [
          {
            ...plan.installments[0],
            billingSnapshot: {
              ...plan.installments[0].billingSnapshot,
              closingOn: "2026-08-11",
            },
          },
          plan.installments[1],
          plan.installments[2],
        ],
      },
      { ...plan, totalAmountCents: BigInt(301) },
    ];

    for (const malformed of malformedPlans) {
      expect(isInstallmentPlanValid(malformed)).toBe(false);
      expectDomainCode(
        () => assertInstallmentAggregateInvariants(malformed),
        "SCHEDULE_INVARIANT_VIOLATION",
      );
    }
  });
});
