import { describe, expect, it } from "vitest";

import {
  S09_BUDGET_CONTRACT_VERSION,
  S09_BUDGET_RESERVE_RULE,
  S09_BUDGET_RULE_VERSION,
  classifyS09Error,
  sanitizeS09BudgetLog,
  toS09ErrorEnvelope,
  toS09ObservabilityContext,
  createS09BudgetOperation,
} from "./s09";

describe("T13 S09 observability boundary", () => {
  it("retains only versioned aggregate metadata when financial fields are supplied", () => {
    const safe = sanitizeS09BudgetLog({
      operation: "budget.provider.read",
      stage: "provider",
      outcome: "success",
      requestId: "t13-request",
      result: "PROTECTED",
      providerStatus: "AVAILABLE",
      budgetCount: 2,
      componentCount: 1,
      amountCents: "123456",
      balanceCents: "123456",
      targetAmountCents: "123456",
      name: "Nome financeiro privado",
      description: "Descrição financeira privada",
      referenceId: "movement-private",
      sql: "select amount_cents from budgets",
      payload: { amountCents: "123456" },
      cookie: "session=private",
      authorization: "Bearer private-token",
    });

    expect(safe).toMatchObject({
      operation: "budget.provider.read",
      stage: "provider",
      contractVersion: S09_BUDGET_CONTRACT_VERSION,
      ruleVersion: S09_BUDGET_RULE_VERSION,
      rule: S09_BUDGET_RESERVE_RULE,
      budgetCount: 2,
      componentCount: 1,
    });
    expect(safe).not.toHaveProperty("amountCents");
    expect(safe).not.toHaveProperty("balanceCents");
    expect(safe).not.toHaveProperty("targetAmountCents");
    expect(safe).not.toHaveProperty("name");
    expect(safe).not.toHaveProperty("description");
    expect(safe).not.toHaveProperty("referenceId");
    expect(JSON.stringify(safe)).not.toMatch(
      /123456|Nome financeiro privado|Descrição financeira privada|movement-private|amount_cents|private-token|session=private/u,
    );
  });

  it("serializes the safe context and error envelope without raw exception data", () => {
    const operation = createS09BudgetOperation("budget.write", {
      correlationId: "t13-correlation",
      movementCount: 1,
      amountCents: "999999",
      payload: { description: "private" },
    });
    const context = toS09ObservabilityContext(operation, "unexpected_error", {
      technicalErrorCode: "BUDGET_PERSISTENCE_FAILED",
      durationMs: 12,
      transactionFailed: true,
    });
    expect(context).toMatchObject({
      operation: "budget.write",
      stage: "write",
      requestId: "t13-correlation",
      transactionFailed: true,
    });
    expect(JSON.stringify(context)).not.toMatch(/999999|private|description/u);

    const classification = classifyS09Error({
      code: "BUDGET_CLOSED",
      message: "closed budget with balance 999999",
    });
    expect(classification).toEqual({
      outcome: "expected_error",
      errorCode: "BUDGET_CLOSED",
    });
    expect(toS09ErrorEnvelope(new Error("SQL balance_cents=999999"))).toEqual({
      ok: false,
      error: { code: "UNEXPECTED_ERROR" },
    });
  });
});
