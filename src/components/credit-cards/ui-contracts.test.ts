import { describe, expect, it } from "vitest";

import {
  createCardCommandSchema,
  createCardFormSchema,
  createPaymentCommandSchema,
  createPaymentFormSchema,
  createPurchaseCommandSchema,
  createPurchaseFormSchema,
  toArchiveCardCommand,
  toCreateCardCommand,
  toCreatePaymentCommand,
  toCreatePurchaseCommand,
  toCancelPurchaseCommand,
  toUpdateBillingRuleCommand,
  toUpdateCardCommand,
  toUpdatePurchaseCommand,
  encodeCreditCardPeriodFilter,
  parseCreditCardPeriodFilter,
} from "./ui-contracts";

const cardId = "018f47b7-6c3a-7abc-8def-1234567890ab";
const accountId = "018f47b7-6c3a-7abc-8def-1234567890ac";
const categoryId = "018f47b7-6c3a-7abc-8def-1234567890ad";

const cardForm = {
  name: "  Cartão principal ",
  creditLimitCents: "100000",
  closingDay: 10,
  dueDay: 17,
  defaultPaymentAccountId: accountId,
};

const purchaseForm = {
  cardId,
  amountCents: "600000",
  occurredOn: "2026-08-29",
  description: "Notebook",
  categoryId,
  installmentCount: 10,
};

const paymentForm = {
  cardId,
  sourceAccountId: accountId,
  amountCents: "60000",
  occurredOn: "2026-08-30",
  description: "Pagamento da fatura",
};

describe("credit-card UI boundary contracts", () => {
  it("normalizes forms and emits only serializable command fields", () => {
    const parsedCard = createCardFormSchema.parse(cardForm);
    const parsedPurchase = createPurchaseFormSchema.parse(purchaseForm);
    const cardCommand = toCreateCardCommand(parsedCard, " card-attempt-1 ");
    const purchaseCommand = toCreatePurchaseCommand(
      parsedPurchase,
      "purchase-attempt-1",
    );
    const parsedPayment = createPaymentFormSchema.parse(paymentForm);
    const paymentCommand = toCreatePaymentCommand(parsedPayment, "payment-1");

    expect(cardCommand).toMatchObject({
      commandId: "card-attempt-1",
      name: "Cartão principal",
      creditLimitCents: "100000",
    });
    expect(purchaseCommand).toMatchObject({
      commandId: "purchase-attempt-1",
      amountCents: "600000",
      installmentCount: 10,
    });
    expect(paymentCommand).toMatchObject({
      commandId: "payment-1",
      sourceAccountId: accountId,
    });

    for (const command of [cardCommand, purchaseCommand, paymentCommand]) {
      expect(command).not.toHaveProperty("householdId");
      expect(command).not.toHaveProperty("status");
      expect(command).not.toHaveProperty("origin");
      expect(command).not.toHaveProperty("signedAmountCents");
      expect(command).not.toHaveProperty("statementId");
      expect(command).not.toHaveProperty("installmentId");
    }
  });

  it("rejects zero, negative and floating-point money, malformed dates, days and IDs", () => {
    expect(
      createCardCommandSchema.safeParse({
        commandId: "card-1",
        ...cardForm,
        creditLimitCents: "0",
      }).success,
    ).toBe(false);
    expect(
      createCardCommandSchema.safeParse({
        commandId: "card-1",
        ...cardForm,
        creditLimitCents: "1.5",
      }).success,
    ).toBe(false);
    expect(
      createPurchaseCommandSchema.safeParse({
        commandId: "purchase-1",
        ...purchaseForm,
        amountCents: "-1",
      }).success,
    ).toBe(false);
    expect(
      createPurchaseCommandSchema.safeParse({
        commandId: "purchase-1",
        ...purchaseForm,
        occurredOn: "2026-02-30",
      }).success,
    ).toBe(false);
    expect(
      createCardCommandSchema.safeParse({
        commandId: "card-1",
        ...cardForm,
        closingDay: 32,
      }).success,
    ).toBe(false);
    expect(
      createPurchaseCommandSchema.safeParse({
        commandId: "purchase-1",
        ...purchaseForm,
        installmentCount: 0,
      }).success,
    ).toBe(false);
    expect(
      createPurchaseCommandSchema.safeParse({
        commandId: "purchase-1",
        ...purchaseForm,
        installmentCount: 1.5,
      }).success,
    ).toBe(false);
    expect(
      createPaymentCommandSchema.safeParse({
        ...paymentForm,
        commandId: "payment-1",
        cardId: "not-an-id",
      }).success,
    ).toBe(false);
  });

  it("rejects client authority and installment payment targeting", () => {
    expect(
      createPurchaseCommandSchema.safeParse({
        commandId: "purchase-1",
        ...purchaseForm,
        householdId: cardId,
      }).success,
    ).toBe(false);
    expect(
      createPaymentCommandSchema.safeParse({
        ...paymentForm,
        commandId: "payment-1",
        installmentId: cardId,
      }).success,
    ).toBe(false);
    expect(
      createPaymentCommandSchema.safeParse({
        ...paymentForm,
        commandId: "payment-1",
        statementId: cardId,
      }).success,
    ).toBe(false);
  });

  it("keeps every maintenance command tenant-safe and aggregate-scoped", () => {
    const updateCard = toUpdateCardCommand(
      { name: "Cartão atualizado" },
      cardId,
      "update-card-1",
    );
    const billingRule = toUpdateBillingRuleCommand(
      { closingDay: 10, dueDay: 20, effectiveFrom: "2026-09-01" },
      cardId,
      "update-billing-1",
    );
    const updatePurchase = toUpdatePurchaseCommand(
      { description: "Descrição atualizada" },
      cardId,
      "update-purchase-1",
    );
    const archiveCard = toArchiveCardCommand(cardId, "archive-card-1");
    const cancelPurchase = toCancelPurchaseCommand(cardId, "cancel-purchase-1");

    expect(updateCard).toEqual({
      commandId: "update-card-1",
      cardId,
      name: "Cartão atualizado",
    });
    expect(billingRule).toMatchObject({
      commandId: "update-billing-1",
      cardId,
      closingDay: 10,
      dueDay: 20,
      effectiveFrom: "2026-09-01",
    });
    expect(updatePurchase).toEqual({
      commandId: "update-purchase-1",
      purchaseId: cardId,
      description: "Descrição atualizada",
    });
    expect(archiveCard).toEqual({ commandId: "archive-card-1", cardId });
    expect(cancelPurchase).toEqual({
      commandId: "cancel-purchase-1",
      purchaseId: cardId,
    });

    for (const command of [
      updateCard,
      billingRule,
      updatePurchase,
      archiveCard,
      cancelPurchase,
    ]) {
      const serialized = JSON.stringify(command);
      for (const forbidden of [
        "householdId",
        "status",
        "origin",
        "signedAmountCents",
        "statementId",
        "installmentId",
        "authorization",
        "calculated",
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    }
  });

  it("keeps URL filters limited to safe dates/cycles and never financial payload", () => {
    const filter = parseCreditCardPeriodFilter(
      new URLSearchParams(
        "from=2026-08-01&to=2026-08-31&cycle=2026-08&amount=999999&description=private&token=secret",
      ),
    );
    expect(filter).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
      cycle: "2026-08",
    });
    const encoded = encodeCreditCardPeriodFilter(filter);
    expect(encoded).toContain("from=2026-08-01");
    expect(encoded).toContain("to=2026-08-31");
    expect(encoded).toContain("cycle=2026-08");
    expect(encoded).not.toMatch(/amount|description|token|payload/iu);
  });
});
