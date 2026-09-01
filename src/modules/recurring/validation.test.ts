import { describe, expect, it } from "vitest";

import {
  parseCreateRecurringRuleCommand,
  parseOverrideRecurringOccurrenceCommand,
  parseUpdateRecurringRuleFutureCommand,
} from "./validation";

const ruleId = "018f2b4d-7a2b-7abc-8abc-1234567890ab";

function expectCommandError(
  run: () => unknown,
  code: string,
  field?: string,
): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toMatchObject({
      code,
      ...(field ? { field } : {}),
    });
  }
}

describe("S07 recurring command boundary", () => {
  it("normalizes a create command before it reaches persistence", () => {
    expect(
      parseCreateRecurringRuleCommand({
        commandId: "  t03-create  ",
        kind: "EXPENSE",
        amountCents: "0001200",
        description: "  Mensal   reajustado ",
        frequency: "MONTHLY",
        dayRule: "FIXED_DAY",
        dayOfMonth: 31,
        startOn: "2026-01-31",
      }),
    ).toMatchObject({
      commandId: "t03-create",
      amountCents: "1200",
      description: "Mensal reajustado",
      includeInConservativeForecast: true,
    });
  });

  it("fails closed for malformed resources and unknown fields", () => {
    expectCommandError(() =>
      parseCreateRecurringRuleCommand({
        commandId: "t03-invalid",
        kind: "EXPENSE",
        amountCents: "0",
        description: "Inválido",
        frequency: "MONTHLY",
        dayRule: "FIXED_DAY",
        dayOfMonth: 1,
        startOn: "2026-01-01",
        householdId: ruleId,
      }),
      "INVALID_COMMAND",
      "amountCents",
    );

    expectCommandError(() =>
      parseUpdateRecurringRuleFutureCommand({
        commandId: "t03-update-invalid",
        recurringRuleId: "not-a-uuidv7",
        effectiveFrom: "2026-09-01",
        amountCents: "100",
      }),
      "INVALID_COMMAND",
      "recurringRuleId",
    );
  });

  it("requires an explicit override and canonicalizes dates", () => {
    expectCommandError(() =>
      parseOverrideRecurringOccurrenceCommand({
        commandId: "t03-override-invalid",
        recurringRuleId: ruleId,
        occurrenceKey: "2026-09",
      }),
      "INVALID_COMMAND",
    );

    expect(
      parseOverrideRecurringOccurrenceCommand({
        commandId: "t03-override",
        recurringRuleId: ruleId,
        occurrenceKey: "2026-09",
        expectedOn: "2026-09-01",
      }),
    ).toMatchObject({
      recurringRuleId: ruleId,
      expectedOn: "2026-09-01",
    });
  });
});
