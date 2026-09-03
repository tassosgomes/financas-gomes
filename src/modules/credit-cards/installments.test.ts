import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";

import { Money } from "@/modules/transactions/money";

import {
  MAX_INSTALLMENT_AMOUNT_CENTS,
  MAX_INSTALLMENT_COUNT,
  activeInstallmentBalance,
  allocateInstallmentMoney,
  allocateInstallments,
  assertInstallmentAggregateInvariants,
  cancelInstallment,
  cancelInstallmentPlan,
  editInstallment,
  futureInstallmentBalance,
  generateInstallmentSchedule,
  isInstallmentPlanValid,
  markInstallmentPaid,
  payInstallment,
  postInstallment,
  remainingInstallments,
  serializeInstallmentPlan,
  sumInstallmentAmounts,
  sumInstallments,
  transitionInstallmentStatus,
  type InstallmentPlan,
} from "./installments";

const billingRule = {
  id: "billing-rule-1",
  closingDay: 10,
  dueDay: 20,
  effectiveFrom: "2026-01-01",
} as const;

function makePlan(
  overrides: Partial<Parameters<typeof generateInstallmentSchedule>[0]> = {},
) {
  return generateInstallmentSchedule({
    planId: "plan-1",
    purchaseId: "purchase-1",
    amountCents: "10000",
    installmentCount: 3,
    occurredOn: "2026-08-09",
    billingRule,
    ...overrides,
  });
}

function expectDomainCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("installment allocation", () => {
  it("divides exact and non-exact totals with bigint precision", () => {
    expect(allocateInstallments("10000", 3)).toEqual([
      BigInt("3334"),
      BigInt("3333"),
      BigInt("3333"),
    ]);
    expect(allocateInstallments(MAX_INSTALLMENT_AMOUNT_CENTS, 3)).toEqual([
      BigInt("3074457345618258603"),
      BigInt("3074457345618258602"),
      BigInt("3074457345618258602"),
    ]);
    expect(
      allocateInstallments(MAX_INSTALLMENT_AMOUNT_CENTS, 3).reduce(
        (sum, cents) => sum + cents,
        BigInt(0),
      ),
    ).toBe(MAX_INSTALLMENT_AMOUNT_CENTS);
  });

  it("accepts the shared Money value object without converting cents to number", () => {
    expect(allocateInstallments(Money.fromCents("10001"), 2)).toEqual([
      BigInt("5001"),
      BigInt("5000"),
    ]);
    expect(allocateInstallmentMoney("10001", 2).map((money) => money.cents)).toEqual([
      BigInt("5001"),
      BigInt("5000"),
    ]);
  });

  it("keeps the remainder order stable and validates operational limits", () => {
    const first = allocateInstallments("17", 5);
    const second = allocateInstallments("17", 5);
    expect(first).toEqual([BigInt(4), BigInt(4), BigInt(3), BigInt(3), BigInt(3)]);
    expect(second).toEqual(first);
    expect(allocateInstallments("120", MAX_INSTALLMENT_COUNT)).toHaveLength(
      MAX_INSTALLMENT_COUNT,
    );
    expectDomainCode(
      () => allocateInstallments("100", MAX_INSTALLMENT_COUNT + 1),
      "INSTALLMENT_COUNT_OUT_OF_RANGE",
    );
    expectDomainCode(() => allocateInstallments("100", 0), "INVALID_INSTALLMENT_COUNT");
    expectDomainCode(
      () => allocateInstallments(MAX_INSTALLMENT_AMOUNT_CENTS + BigInt(1), 2),
      "AMOUNT_OUT_OF_RANGE",
    );
    expectDomainCode(
      () => allocateInstallments("1", 2),
      "SCHEDULE_INVARIANT_VIOLATION",
    );
  });
});

describe("installment schedule aggregate", () => {
  it("materializes one immutable plan with exactly N linked rows", () => {
    const plan = makePlan();

    expect(plan.status).toBe("ACTIVE");
    expect(plan.installmentCount).toBe(3);
    expect(plan.installments).toHaveLength(3);
    expect(plan.installments.map((row) => row.sequence)).toEqual([1, 2, 3]);
    expect(plan.installments.every((row) => row.planId === "plan-1")).toBe(true);
    expect(plan.installments.every((row) => row.installmentPlanId === "plan-1")).toBe(true);
    expect(plan.installments.every((row) => row.purchaseId === "purchase-1")).toBe(true);
    expect(plan.installments.every((row) => row.status === "PLANNED")).toBe(true);
    expect(sumInstallments(plan)).toBe(BigInt("10000"));
    expect(isInstallmentPlanValid(plan)).toBe(true);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.installments)).toBe(true);
    expect(Object.isFrozen(plan.installments[0])).toBe(true);
    expect(Object.isFrozen(plan.installments[0]?.billingSnapshot)).toBe(true);
  });

  it("uses the T03 cycle resolver and advances month/year at month ends", () => {
    const plan = generateInstallmentSchedule({
      planId: "plan-year-end",
      purchaseId: "purchase-year-end",
      amountCents: "300",
      installmentCount: 3,
      occurredOn: "2026-12-30",
      billingRule: {
        id: "rule-31",
        closingDay: 31,
        dueDay: 5,
        effectiveFrom: "2026-01-01",
      },
    });

    expect(plan.installments.map((row) => row.billingCycle)).toEqual([
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
    expect(plan.installments.map((row) => row.billingClosingOn)).toEqual([
      "2026-12-31",
      "2027-01-31",
      "2027-02-28",
    ]);
    expect(plan.installments.map((row) => row.billingDueOn)).toEqual([
      "2027-01-05",
      "2027-02-05",
      "2027-03-05",
    ]);
    expect(plan.installments.every((row) => row.billingDueOn > row.billingClosingOn)).toBe(true);
  });

  it("freezes a due-date override on only the authorized first row", () => {
    const plan = makePlan({ billingDueOnOverride: "2026-08-25" });

    expect(plan.installments[0]).toMatchObject({
      billingDueOn: "2026-08-25",
      billingDueOnOverride: "2026-08-25",
      billingSnapshot: {
        dueDateSource: "OVERRIDE",
        billingDueOnOverride: "2026-08-25",
      },
    });
    expect(plan.installments.slice(1).every((row) => row.billingDueOnOverride === null)).toBe(
      true,
    );
    expect(plan.installments.slice(1).every((row) => row.billingSnapshot.dueDateSource === "RULE")).toBe(
      true,
    );
  });

  it("supports N=1 as the same aggregate invariant", () => {
    const plan = makePlan({ amountCents: "1", installmentCount: 1 });
    expect(plan.installments).toHaveLength(1);
    expect(plan.installments[0]?.amountCents).toBe(BigInt(1));
    expect(plan.installments[0]?.sequence).toBe(1);
    expect(assertInstallmentAggregateInvariants(plan)).toBe(true);
  });

  it("supports the highest permitted count while preserving exact total", () => {
    const plan = makePlan({
      amountCents: MAX_INSTALLMENT_AMOUNT_CENTS,
      installmentCount: MAX_INSTALLMENT_COUNT,
    });

    expect(plan.installments).toHaveLength(MAX_INSTALLMENT_COUNT);
    expect(plan.installments[0]?.sequence).toBe(1);
    expect(plan.installments.at(-1)?.sequence).toBe(MAX_INSTALLMENT_COUNT);
    expect(sumInstallments(plan)).toBe(MAX_INSTALLMENT_AMOUNT_CENTS);
    expect(isInstallmentPlanValid(plan)).toBe(true);
  });

  it("selects a versioned rule by purchase date and freezes that version", () => {
    const oldRule = {
      ...billingRule,
      id: "billing-rule-old",
      effectiveUntil: "2026-09-01",
    };
    const newRule = {
      ...billingRule,
      id: "billing-rule-new",
      closingDay: 5,
      dueDay: 15,
      effectiveFrom: "2026-09-01",
    };
    const plan = generateInstallmentSchedule({
      planId: "plan-versioned",
      purchaseId: "purchase-versioned",
      amountCents: "200",
      installmentCount: 2,
      occurredOn: "2026-08-31",
      rules: [newRule, oldRule],
    });

    expect(plan.billingRuleSnapshot.id).toBe("billing-rule-old");
    expect(plan.installments.map((row) => row.billingRuleId)).toEqual([
      "billing-rule-old",
      "billing-rule-old",
    ]);
    expect(plan.installments.map((row) => row.billingCycle)).toEqual([
      "2026-09",
      "2026-10",
    ]);
  });

  it("treats equivalent Money and Temporal aliases as one input", () => {
    const plan = generateInstallmentSchedule({
      planId: "plan-aliases",
      purchaseId: "purchase-aliases",
      amountCents: Money.fromCents("101"),
      totalAmountCents: "101",
      installmentCount: 2,
      occurredOn: Temporal.PlainDate.from("2026-08-09"),
      purchaseDate: "2026-08-09",
      billingRule,
    });

    expect(plan.installments.map((row) => row.amountCents)).toEqual([
      BigInt(51),
      BigInt(50),
    ]);
    expect(sumInstallmentAmounts(plan)).toBe(BigInt(101));
  });
});

describe("aggregate state and future balance", () => {
  it("posts through the aggregate and cancels the whole plan atomically", () => {
    const plan = makePlan();
    const posted = postInstallment(plan, 1);
    const cancelled = cancelInstallmentPlan(posted);

    expect(posted.installments.map((row) => row.status)).toEqual([
      "POSTED",
      "PLANNED",
      "PLANNED",
    ]);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.installments.map((row) => row.status)).toEqual([
      "CANCELLED",
      "CANCELLED",
      "CANCELLED",
    ]);
    expect(remainingInstallments(cancelled)).toHaveLength(0);
    expect(futureInstallmentBalance(cancelled)).toBe(BigInt(0));
    expect(activeInstallmentBalance(cancelled)).toBe(BigInt(0));
    expect(sumInstallments(cancelled)).toBe(BigInt("10000"));

    // The source aggregate and its historical rows are immutable.
    expect(plan.status).toBe("ACTIVE");
    expect(plan.installments.every((row) => row.status === "PLANNED")).toBe(true);
    expect(cancelInstallmentPlan(cancelled)).toBe(cancelled);
  });

  it("rejects PAID and individual pay/edit/cancel semantics", () => {
    const plan = makePlan();
    const row = plan.installments[0] as NonNullable<typeof plan.installments[0]>;

    expectDomainCode(() => transitionInstallmentStatus(row, "PAID"), "INVALID_STATE");
    expectDomainCode(() => payInstallment(row), "PAYMENT_INSTALLMENT_FORBIDDEN");
    expectDomainCode(() => markInstallmentPaid(row), "PAYMENT_INSTALLMENT_FORBIDDEN");
    expectDomainCode(
      () => editInstallment(row, { amountCents: BigInt(1) }),
      "INSTALLMENT_MUTATION_FORBIDDEN",
    );
    expectDomainCode(() => cancelInstallment(row), "INSTALLMENT_MUTATION_FORBIDDEN");
  });

  it("fails closed for a broken aggregate instead of hiding sequence/total errors", () => {
    const plan = makePlan();
    const broken = {
      ...plan,
      installments: [
        plan.installments[0],
        { ...plan.installments[1], sequence: 1 },
        plan.installments[2],
      ],
    } as unknown as InstallmentPlan;

    expect(isInstallmentPlanValid(broken)).toBe(false);
    expectDomainCode(
      () => assertInstallmentAggregateInvariants(broken),
      "SCHEDULE_INVARIANT_VIOLATION",
    );

    const brokenSnapshot = {
      ...plan,
      installments: [
        {
          ...plan.installments[0],
          billingSnapshot: {
            ...plan.installments[0].billingSnapshot,
            closingOn: "2026-08-11",
          },
        },
        ...plan.installments.slice(1),
      ],
    } as unknown as InstallmentPlan;
    expect(isInstallmentPlanValid(brokenSnapshot)).toBe(false);
  });

  it("serializes bigint amounts explicitly at the boundary", () => {
    const plan = makePlan();
    const serialized = serializeInstallmentPlan(plan) as {
      totalAmountCents: string;
      installments: readonly { amountCents: string }[];
    };

    expect(serialized.totalAmountCents).toBe("10000");
    expect(serialized.installments.map((row) => row.amountCents)).toEqual([
      "3334",
      "3333",
      "3333",
    ]);
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });
});
