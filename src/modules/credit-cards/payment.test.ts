import { describe, expect, it } from "vitest";

import {
  assertCreditCardPaymentSourceAccount,
  parseRegisterCreditCardPaymentCommand,
  registerCreditCardPaymentCommandSchema,
} from "./validation";
import {
  CreditCardDomainError,
} from "./contracts";
import {
  buildCreditCardPaymentTransfer,
  sumCreditCardPaymentEntries,
} from "./payments";
import { Money } from "@/modules/transactions/domain";

const CARD_ID = "018f47b7-6c3a-7abc-8def-1234567890ab";
const CARD_ACCOUNT_ID = "018f47b7-6c3a-7abc-8def-1234567890ac";
const SOURCE_ACCOUNT_ID = "018f47b7-6c3a-7abc-8def-1234567890ad";
const HOUSEHOLD_ID = "018f47b7-6c3a-7abc-8def-1234567890af";
const OTHER_HOUSEHOLD_ID = "018f47b7-6c3a-7abc-8def-1234567890b0";

const command = {
  commandId: " payment-1 ",
  cardId: ` ${CARD_ID} `,
  sourceAccountId: ` ${SOURCE_ACCOUNT_ID} `,
  amountCents: "00010000",
  occurredOn: "2026-08-31",
  description: "  Fatura   agosto ",
};

describe("T08 global card payment contract", () => {
  it("normalizes only serializable payment facts and defaults no ledger authority", () => {
    expect(parseRegisterCreditCardPaymentCommand(command)).toEqual({
      commandId: "payment-1",
      cardId: CARD_ID,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      amountCents: "10000",
      occurredOn: "2026-08-31",
      description: "Fatura agosto",
    });
    const parsed = registerCreditCardPaymentCommandSchema.parse({
      ...command,
      description: undefined,
    });
    expect(parsed).not.toHaveProperty("statementId");
    expect(parsed).not.toHaveProperty("installmentId");
  });

  it("rejects statement/installment targeting, tenant authority, signs and zero", () => {
    for (const extra of [
      { statementId: CARD_ID },
      { installmentId: CARD_ID },
      { householdId: HOUSEHOLD_ID },
      { status: "POSTED" },
    ]) {
      expect(registerCreditCardPaymentCommandSchema.safeParse({ ...command, ...extra }).success).toBe(false);
    }
    expect(registerCreditCardPaymentCommandSchema.safeParse({ ...command, amountCents: "-1" }).success).toBe(false);
    expect(registerCreditCardPaymentCommandSchema.safeParse({ ...command, amountCents: "0" }).success).toBe(false);
  });

  it("uses an opaque not-found error for cross-tenant source accounts", () => {
    expect(() =>
      assertCreditCardPaymentSourceAccount({
        householdId: HOUSEHOLD_ID,
        cardAccountId: CARD_ACCOUNT_ID,
        sourceAccountId: SOURCE_ACCOUNT_ID,
        account: {
          id: SOURCE_ACCOUNT_ID,
          householdId: OTHER_HOUSEHOLD_ID,
          status: "ACTIVE",
          type: "CHECKING",
        },
      }),
    ).toThrowError(CreditCardDomainError);
    try {
      assertCreditCardPaymentSourceAccount({
        householdId: HOUSEHOLD_ID,
        cardAccountId: CARD_ACCOUNT_ID,
        sourceAccountId: SOURCE_ACCOUNT_ID,
        account: {
          id: SOURCE_ACCOUNT_ID,
          householdId: OTHER_HOUSEHOLD_ID,
          status: "ACTIVE",
          type: "CHECKING",
        },
      });
    } catch (error) {
      expect(error).toMatchObject({ code: "PAYMENT_ACCOUNT_NOT_FOUND", field: "sourceAccountId" });
    }
  });

  it("builds exactly two posted entries with no installment lineage and sum zero", () => {
    const transfer = buildCreditCardPaymentTransfer({
      sourceAccountId: SOURCE_ACCOUNT_ID,
      cardAccountId: CARD_ACCOUNT_ID,
      amount: Money.fromCents("10000"),
      postedOn: "2026-08-31",
    });
    expect(transfer.kind).toBe("TRANSFER");
    expect(transfer.entries).toHaveLength(2);
    expect(transfer.entries.map((entry) => entry.amountCents)).toEqual([
      BigInt(-10000),
      BigInt(10000),
    ]);
    expect(transfer.entries.every((entry) => entry.installmentId === null)).toBe(true);
    expect(sumCreditCardPaymentEntries(transfer.entries)).toBe(BigInt(0));
  });

  it("does not allow the card account to fund itself", () => {
    expect(() =>
      buildCreditCardPaymentTransfer({
        sourceAccountId: CARD_ACCOUNT_ID,
        cardAccountId: CARD_ACCOUNT_ID,
        amount: Money.fromCents("1"),
        postedOn: "2026-08-31",
      }),
    ).toThrowError(CreditCardDomainError);
  });
});
