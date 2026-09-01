import { describe, expect, it } from "vitest";

import {
  parseCreateCreditCardPurchaseCommand,
  validateCreateCreditCardPurchaseCommand,
} from "./validation";

const cardId = "018f47b7-6c3a-7abc-8def-1234567890ab";

const command = {
  commandId: "purchase-validation-1",
  cardId,
  amountCents: "00010000",
  occurredOn: "2026-08-09",
  description: "  Compra   sintética ",
  installmentCount: 3,
};

describe("T06 purchase command boundary", () => {
  it("normalizes serializable purchase facts", () => {
    expect(parseCreateCreditCardPurchaseCommand(command)).toEqual({
      ...command,
      amountCents: "10000",
      description: "Compra sintética",
    });
  });

  it("rejects tenant/ledger authority and invalid schedule inputs", () => {
    expect(
      validateCreateCreditCardPurchaseCommand({ ...command, householdId: cardId }),
    ).toMatchObject({ ok: false, error: { code: "NON_EDITABLE_FIELD" } });
    expect(
      validateCreateCreditCardPurchaseCommand({ ...command, installmentCount: 0 }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INSTALLMENT_COUNT" } });
    expect(
      validateCreateCreditCardPurchaseCommand({ ...command, amountCents: "-1" }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_AMOUNT" } });
  });
});
