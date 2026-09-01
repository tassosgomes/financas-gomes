import { describe, expect, it } from "vitest";

import {
  createManualTransactionFormSchema,
  isValidIsoDate,
  toCreateManualTransactionCommand,
} from "@/modules/transactions/form-contract";
import { createExpenseCommandSchema } from "@/modules/transactions/validation";

const accountId = "018f47b7-6c3a-7abc-8def-1234567890ab";
const categoryId = "018f47b7-6c3a-7abc-8def-1234567890ac";

const validForm = {
  accountId,
  amountCents: "123456",
  categoryId,
  description: "  Café  da   manhã ",
  kind: "EXPENSE" as const,
  occurredOn: "2026-08-29",
};

describe("manual transaction form contract", () => {
  it("normalizes a serializable browser payload and keeps category optional", () => {
    const schema = createManualTransactionFormSchema({ today: "2026-08-29" });

    expect(schema.parse(validForm)).toEqual({
      ...validForm,
      categoryId,
      description: "Café da manhã",
    });
    expect(schema.parse({ ...validForm, categoryId: "" }).categoryId).toBeNull();
    expect(schema.parse({ ...validForm, categoryId: undefined }).categoryId).toBeNull();
  });

  it("maps the browser value to the server command shape for a second validation", () => {
    const formValue = createManualTransactionFormSchema({ today: "2026-08-29" }).parse(
      validForm,
    );
    const command = toCreateManualTransactionCommand(formValue, "attempt-1");

    expect(command).not.toHaveProperty("kind");
    expect(createExpenseCommandSchema.safeParse(command).success).toBe(true);
  });

  it("rejects zero, malformed dates, future dates and protected payload keys", () => {
    const schema = createManualTransactionFormSchema({ today: "2026-08-29" });

    expect(schema.safeParse({ ...validForm, amountCents: "0" }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, occurredOn: "2026-02-30" }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, occurredOn: "2026-08-30" }).success).toBe(false);
    expect(schema.safeParse({ ...validForm, householdId: "forged" }).success).toBe(false);
  });

  it("counts code points and validates civil dates without timezone conversion", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2023-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(
      createManualTransactionFormSchema({ today: "2026-08-29" }).safeParse({
        ...validForm,
        description: "😀".repeat(241),
      }).success,
    ).toBe(false);
  });
});
