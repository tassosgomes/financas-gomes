import { describe, expect, it } from "vitest";

import type {
  BudgetBalanceDTO,
  BudgetDetailDTO,
  BudgetGoalDTO,
  BudgetListDTO,
  BudgetMovementDTO,
  BudgetPeriodDTO,
  BudgetProgressDTO,
  BudgetSpendableImpactDTO,
  BudgetStatusDTO,
} from "@/modules/budgets/ui-contracts";

import {
  formatBudgetCents,
  formatBudgetDate,
  formatBudgetMovementImpact,
  formatBudgetSignedCents,
} from "./formatters";

const goal: BudgetGoalDTO = {
  targetAmountCents: "9223372036854775807",
  targetDate: "9999-12-31",
};

const budget = {
  referenceId: "budget-reference",
  name: "Reserva de viagem",
  categoryId: "category-reference",
  status: "ACTIVE" as const,
  activeFrom: "2024-02-29",
  closedOn: null,
  goal,
};

const movement: BudgetMovementDTO = {
  referenceId: "movement-reference",
  boxReferenceId: budget.referenceId,
  kind: "WITHDRAWAL",
  amountCents: "1",
  effectiveOn: "2024-02-29",
  correctsReferenceId: null,
  transferReferenceId: null,
  sourceReferenceId: null,
};

const balance: BudgetBalanceDTO = {
  boxReferenceId: budget.referenceId,
  asOf: "9999-12-31",
  balanceCents: "9223372036854775807",
  protectedAmountCents: "9223372036854775807",
  contributionCents: "9223372036854775807",
  withdrawalCents: "0",
  activeAtCutoff: true,
  movementReferenceIds: [movement.referenceId],
  contributionReferenceIds: ["contribution-reference"],
  withdrawalReferenceIds: [movement.referenceId],
};

const period: BudgetPeriodDTO = {
  from: "2024-02-01",
  to: "2024-02-29",
  rolloverCents: "0",
  openingBalanceCents: "0",
  closingBalanceCents: "9223372036854775807",
  contributionCents: "9223372036854775807",
  withdrawalCents: "0",
  netChangeCents: "9223372036854775807",
  contributionReferenceIds: ["contribution-reference"],
  withdrawalReferenceIds: [],
};

const progress: BudgetProgressDTO = {
  targetAmountCents: goal.targetAmountCents,
  targetDate: goal.targetDate,
  progressCents: goal.targetAmountCents,
  remainingCents: "0",
  progressBps: "10000",
  remainingMonths: null,
  suggestedMonthlyCents: null,
  status: "ACHIEVED",
  paceStatus: "ON_TRACK",
};

const spendableImpact: BudgetSpendableImpactDTO = {
  contractVersion: "s09.v1",
  status: "UNAVAILABLE",
  protectedCents: "0",
  appliedOpeningAdjustmentCents: "0",
  components: [],
};

const detail: BudgetDetailDTO = {
  budget,
  balance,
  period,
  movements: [movement],
  progress,
  spendableImpact,
};

const list: BudgetListDTO = {
  items: [budget],
  nextCursor: null,
};

const status: BudgetStatusDTO = { status: budget.status };

describe("budget UI formatters", () => {
  it("formats unsigned, signed, zero, negative and high-precision cents", () => {
    expect(formatBudgetCents("0")).toBe("R$ 0,00");
    expect(formatBudgetCents("1")).toBe("R$ 0,01");
    expect(formatBudgetSignedCents("-1")).toBe("-R$ 0,01");
    expect(formatBudgetSignedCents("-200000")).toBe("-R$ 2.000,00");
    expect(formatBudgetCents("9223372036854775807")).toBe(
      "R$ 92.233.720.368.547.758,07",
    );
    expect(formatBudgetCents("-1")).toBe("Valor indisponível");
    expect(formatBudgetSignedCents("1.5")).toBe("Valor indisponível");
  });

  it("uses the movement kind only as display direction", () => {
    expect(formatBudgetMovementImpact("300000", "CONTRIBUTION")).toBe(
      "R$ 3.000,00",
    );
    expect(formatBudgetMovementImpact("300000", "WITHDRAWAL")).toBe(
      "-R$ 3.000,00",
    );
  });

  it("formats date boundaries and preserves invalid dates verbatim", () => {
    expect(formatBudgetDate("0000-02-29")).toBe("29/02/0000");
    expect(formatBudgetDate("2024-02-29")).toBe("29/02/2024");
    expect(formatBudgetDate("9999-12-31")).toBe("31/12/9999");
    expect(formatBudgetDate("2023-02-29")).toBe("2023-02-29");
    expect(formatBudgetDate("2024-04-31")).toBe("2024-04-31");
    expect(formatBudgetDate("2024-2-9")).toBe("2024-2-9");
  });

  it("keeps DTOs serializable and free of tenancy authority", () => {
    const serialized = JSON.stringify({ list, detail, status, goal });

    expect(() => JSON.stringify({ list, detail, status, goal })).not.toThrow();
    expect(serialized).toContain('"balanceCents":"9223372036854775807"');
    expect(serialized).toContain('"targetDate":"9999-12-31"');
    expect(serialized).not.toMatch(
      /householdId|userId|tenantId|accountId|authorization|permission/iu,
    );
  });
});
