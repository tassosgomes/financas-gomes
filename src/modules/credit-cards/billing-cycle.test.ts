import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";

import {
  BillingCycleError,
  resolveBillingCycle,
  validateBillingRules,
  type BillingRule,
} from "./billing-cycle";

const rule: BillingRule = {
  id: "rule-v1",
  closingDay: 10,
  dueDay: 20,
  effectiveFrom: "2026-01-01",
};

function expectBillingError(run: () => unknown, code: string): void {
  expect(run).toThrowError(BillingCycleError);
  try {
    run();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("billing cycle domain", () => {
  it("classifies dates before, on and after closing without timezone input", () => {
    expect(
      resolveBillingCycle({ occurredOn: "2026-08-09", rule }),
    ).toMatchObject({
      billingCycle: "2026-08",
      cycle: "2026-08",
      competence: "2026-08",
      closingOn: "2026-08-10",
      dueOn: "2026-08-20",
      billingRuleId: "rule-v1",
    });

    expect(
      resolveBillingCycle({ occurredOn: "2026-08-10", rule }),
    ).toMatchObject({
      billingCycle: "2026-09",
      closingOn: "2026-09-10",
      dueOn: "2026-09-20",
    });

    expect(
      resolveBillingCycle({ occurredOn: "2026-08-11", rule }),
    ).toMatchObject({
      billingCycle: "2026-09",
      closingOn: "2026-09-10",
      dueOn: "2026-09-20",
    });
  });

  it("normalizes a closing day of 31 at February's actual end", () => {
    const monthEndRule: BillingRule = {
      ...rule,
      closingDay: 31,
      dueDay: 20,
    };

    expect(
      resolveBillingCycle({ occurredOn: "2026-02-27", rule: monthEndRule }),
    ).toMatchObject({
      billingCycle: "2026-02",
      closingOn: "2026-02-28",
      dueOn: "2026-03-20",
    });

    expect(
      resolveBillingCycle({ occurredOn: "2026-02-28", rule: monthEndRule }),
    ).toMatchObject({
      billingCycle: "2026-03",
      closingOn: "2026-03-31",
      dueOn: "2026-04-20",
    });

    expect(
      resolveBillingCycle({ occurredOn: "2028-02-28", rule: monthEndRule }),
    ).toMatchObject({
      billingCycle: "2028-02",
      closingOn: "2028-02-29",
      dueOn: "2028-03-20",
    });

    expect(
      resolveBillingCycle({ occurredOn: "2028-02-29", rule: monthEndRule }),
    ).toMatchObject({
      billingCycle: "2028-03",
      closingOn: "2028-03-31",
      dueOn: "2028-04-20",
    });
  });

  it("uses the first normalized due date strictly after closing", () => {
    expect(
      resolveBillingCycle({
        occurredOn: "2026-01-09",
        rule: { ...rule, closingDay: 10, dueDay: 5 },
      }),
    ).toMatchObject({
      billingCycle: "2026-01",
      closingOn: "2026-01-10",
      dueOn: "2026-02-05",
    });

    expect(
      resolveBillingCycle({
        occurredOn: "2026-01-09",
        rule: { ...rule, closingDay: 10, dueDay: 10 },
      }),
    ).toMatchObject({
      closingOn: "2026-01-10",
      dueOn: "2026-02-10",
    });

    // Configured dueDay 31 normalizes to Feb 28, which is not strictly after
    // a normalized closing day 31; the next candidate is March 31.
    expect(
      resolveBillingCycle({
        occurredOn: "2026-01-30",
        rule: { ...rule, closingDay: 31, dueDay: 31 },
      }),
    ).toMatchObject({
      billingCycle: "2026-01",
      closingOn: "2026-01-31",
      dueOn: "2026-02-28",
    });

    expect(
      resolveBillingCycle({
        occurredOn: "2026-01-31",
        rule: { ...rule, closingDay: 31, dueDay: 31 },
      }),
    ).toMatchObject({
      billingCycle: "2026-02",
      closingOn: "2026-02-28",
      dueOn: "2026-03-31",
    });
  });

  it("handles December-to-January rollover", () => {
    expect(
      resolveBillingCycle({ occurredOn: "2026-12-09", rule }),
    ).toMatchObject({
      billingCycle: "2026-12",
      closingOn: "2026-12-10",
      dueOn: "2026-12-20",
    });

    expect(
      resolveBillingCycle({ occurredOn: "2026-12-10", rule }),
    ).toMatchObject({
      billingCycle: "2027-01",
      closingOn: "2027-01-10",
      dueOn: "2027-01-20",
    });
  });

  it("is deterministic for the same civil date regardless of input representation", () => {
    const serialized = resolveBillingCycle({
      occurredOn: "2026-08-09",
      rule,
    });
    const temporal = resolveBillingCycle({
      occurredOn: Temporal.PlainDate.from("2026-08-09"),
      rule,
    });

    expect(temporal).toEqual(serialized);
    expect(Object.values(serialized).every((value) => typeof value !== "bigint")).toBe(
      true,
    );
  });

  it("selects a versioned rule by the half-open effective range", () => {
    const v2: BillingRule = {
      id: "rule-v2",
      closingDay: 5,
      dueDay: 15,
      effectiveFrom: "2026-09-01",
    };
    const rules = [
      v2,
      { ...rule, effectiveUntil: "2026-09-01" },
    ];

    const oldCycle = resolveBillingCycle({
      occurredOn: "2026-08-09",
      rules,
    });
    expect(oldCycle).toMatchObject({
      billingRuleId: "rule-v1",
      billingCycle: "2026-08",
      closingOn: "2026-08-10",
    });

    const newCycle = resolveBillingCycle({
      occurredOn: "2026-09-01",
      rules,
    });
    expect(newCycle).toMatchObject({
      billingRuleId: "rule-v2",
      billingCycle: "2026-09",
      closingOn: "2026-09-05",
      dueOn: "2026-09-15",
    });

    expect(() =>
      validateBillingRules([
        { ...rule, effectiveUntil: "2026-10-01" },
        { ...v2, effectiveFrom: "2026-09-01" },
      ]),
    ).toThrowError(BillingCycleError);
  });

  it("honors a per-purchase due-date override without changing the rule", () => {
    const resolved = resolveBillingCycle({
      occurredOn: "2026-08-09",
      rule,
      billingDueOnOverride: "2026-09-05",
    });

    expect(resolved).toMatchObject({
      billingCycle: "2026-08",
      closingOn: "2026-08-10",
      dueOn: "2026-09-05",
      billingDueOnOverride: "2026-09-05",
      dueDateSource: "OVERRIDE",
    });

    expect(
      resolveBillingCycle({ occurredOn: "2026-08-09", rule }),
    ).toMatchObject({ dueOn: "2026-08-20", dueDateSource: "RULE" });

    expectBillingError(
      () =>
        resolveBillingCycle({
          occurredOn: "2026-08-09",
          rule,
          billingDueOnOverride: "2026-08-10",
        }),
      "BILLING_DUE_OVERRIDE_NOT_AFTER_CLOSING",
    );
    expectBillingError(
      () =>
        resolveBillingCycle({
          occurredOn: "2026-08-09",
          rule,
          billingDueOnOverride: "2026-02-30",
        }),
      "INVALID_DATE",
    );
  });

  it("accepts equivalent civil aliases and rejects divergent aliases", () => {
    expect(
      resolveBillingCycle({
        occurredOn: "2026-08-09",
        purchaseDate: Temporal.PlainDate.from("2026-08-09"),
        rule,
      }),
    ).toMatchObject({ billingCycle: "2026-08" });

    expectBillingError(
      () =>
        resolveBillingCycle({
          occurredOn: "2026-08-09",
          purchaseDate: "2026-08-10",
          rule,
        }),
      "INVALID_DATE",
    );
  });

  it("supports the positional due-date override while preserving the rule", () => {
    expect(resolveBillingCycle("2026-08-09", rule, "2026-08-25")).toMatchObject({
      billingCycle: "2026-08",
      dueOn: "2026-08-25",
      billingDueOnOverride: "2026-08-25",
      dueDateSource: "OVERRIDE",
    });
  });
});
