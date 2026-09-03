import { describe, expect, it } from "vitest";

import {
  TransactionDomainError,
  TRANSACTION_ERROR_MESSAGES,
} from "./contracts";
import {
  createExpenseCommandSchema,
  parseCancelManualTransactionCommand,
  parseCreateExpenseCommand,
  parseUpdateManualTransactionCommand,
  safeParseCreateIncomeCommand,
  toTransactionError,
  updateManualTransactionCommandSchema,
} from "./validation";

const accountId = "018f47b7-6c3a-7abc-8def-1234567890ac";
const categoryId = "018f47b7-6c3a-7abc-8def-1234567890ad";
const eventId = "018f47b7-6c3a-7abc-8def-1234567890ae";

const validCreate = {
  commandId: " create-expense-1 ",
  amountCents: "00123456",
  occurredOn: "2026-08-29",
  description: "  Café\u00a0\u00a0da\u2003Manhã ",
  accountId,
  categoryId,
};

describe("serializable command schemas", () => {
  it("canonicalizes amount/date/description while preserving string boundaries", () => {
    const parsed = parseCreateExpenseCommand(validCreate, {
      today: "2026-08-29",
    });

    expect(parsed).toEqual({
      commandId: "create-expense-1",
      amountCents: "123456",
      occurredOn: "2026-08-29",
      description: "Café da Manhã",
      accountId,
      categoryId,
    });
    expect(createExpenseCommandSchema.safeParse(validCreate).success).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("bigint");
  });

  it("rejects values that would make the browser a source of server authority", () => {
    const result = createExpenseCommandSchema.safeParse({
      ...validCreate,
      householdId: "forged",
      status: "POSTED",
      origin: "MANUAL",
    });
    expect(result.success).toBe(false);
    expect(toTransactionError(result.success ? undefined : result.error).code).toBe(
      "NON_EDITABLE_FIELD",
    );
  });

  it("maps future dates and malformed values to stable, displayable errors", () => {
    expect(
      safeParseCreateIncomeCommand(
        { ...validCreate, amountCents: "0" },
        { today: "2026-08-29" },
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_AMOUNT", field: "amountCents" } });
    expect(
      safeParseCreateIncomeCommand(
        { ...validCreate, occurredOn: "2026-08-30" },
        { today: "2026-08-29" },
      ),
    ).toMatchObject({ ok: false, error: { code: "DATE_IN_FUTURE", field: "occurredOn" } });
  });

  it("allows only description/category metadata updates and supports null category", () => {
    expect(
      parseUpdateManualTransactionCommand({
        commandId: "update-1",
        financialEventId: eventId,
        categoryId: null,
      }),
    ).toEqual({
      commandId: "update-1",
      financialEventId: eventId,
      categoryId: null,
    });
    expect(
      updateManualTransactionCommandSchema.safeParse({
        commandId: "update-1",
        financialEventId: eventId,
        amountCents: "12",
      }).success,
    ).toBe(false);
    expect(() =>
      parseUpdateManualTransactionCommand({
        commandId: "update-1",
        financialEventId: eventId,
      }),
    ).toThrowError(TransactionDomainError);
  });

  it("parses cancellation with no financial fields and exposes safe messages", () => {
    expect(
      parseCancelManualTransactionCommand({
        commandId: "cancel-1",
        financialEventId: eventId,
      }),
    ).toEqual({ commandId: "cancel-1", financialEventId: eventId });
    expect(TRANSACTION_ERROR_MESSAGES.INVALID_AMOUNT).not.toContain("SQL");
    expect(TRANSACTION_ERROR_MESSAGES.INVALID_AMOUNT).not.toContain("amountCents");
  });
});
