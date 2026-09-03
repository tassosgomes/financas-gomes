import { describe, expect, it } from "vitest";

import { BudgetDomainError } from "./contracts";
import {
  parseCloseBudgetCommand,
  parseCreateBudgetCommand,
  parseUpdateBudgetCommand,
} from "./use-cases";

const categoryId = "00000000-0000-7000-8000-000000062101";
const budgetReferenceId = "budget-reference";

function expectDomainCode(work: () => unknown, code: string): void {
  try {
    work();
    throw new Error("expected parser to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(BudgetDomainError);
    expect((error as BudgetDomainError).code).toBe(code);
  }
}

describe("T06 CRUD command parsers", () => {
  it("normalizes command IDs and names while keeping the serializable shape", () => {
    expect(
      parseCreateBudgetCommand({
        commandId: " create-1 ",
        name: "  Reserva   mensal ",
        categoryId,
        activeFrom: "2026-09-01",
      }),
    ).toEqual({
      commandId: "create-1",
      name: "Reserva mensal",
      categoryId,
      activeFrom: "2026-09-01",
    });
  });

  it("maps malformed fields to stable domain codes instead of leaking ZodError", () => {
    expectDomainCode(
      () =>
        parseCreateBudgetCommand({
          commandId: "create-1",
          name: "Reserva",
          categoryId,
          activeFrom: "2026-02-30",
        }),
      "INVALID_DATE",
    );
    expectDomainCode(
      () =>
        parseCreateBudgetCommand({
          commandId: "create-1",
          name: "Reserva",
          categoryId,
          activeFrom: "2026-09-01",
          goal: { targetAmountCents: "0", targetDate: "2026-12-01" },
        }),
      "INVALID_TARGET_AMOUNT",
    );
    expectDomainCode(
      () =>
        parseUpdateBudgetCommand({
          commandId: "update-1",
          budgetReferenceId,
        }),
      "INVALID_COMMAND",
    );
    expectDomainCode(
      () =>
        parseCloseBudgetCommand({
          commandId: "close-1",
          budgetReferenceId,
          closedOn: "2026-02-30",
        }),
      "INVALID_DATE",
    );
  });

  it("rejects browser authority and invalid references at the command boundary", () => {
    expectDomainCode(
      () =>
        parseCreateBudgetCommand({
          commandId: "create-1",
          name: "Reserva",
          categoryId,
          activeFrom: "2026-09-01",
          householdId: "forged-household",
        }),
      "INVALID_COMMAND",
    );
    expectDomainCode(
      () =>
        parseUpdateBudgetCommand({
          commandId: "update-1",
          budgetReferenceId: "",
          name: "Reserva",
        }),
      "INVALID_REFERENCE",
    );
  });
});

