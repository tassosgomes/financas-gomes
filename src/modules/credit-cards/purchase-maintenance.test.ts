import { describe, expect, it } from "vitest";

import {
  parseCancelCreditCardPurchaseCommand,
  parseUpdateCreditCardPurchaseCommand,
  validateCancelCreditCardPurchaseCommand,
  validateUpdateCreditCardPurchaseCommand,
} from "./validation";

const PURCHASE_ID = "018f47b7-6c3a-7abc-8def-1234567890ab";
const CATEGORY_ID = "018f47b7-6c3a-7abc-8def-1234567890ac";

describe("T09 purchase maintenance contracts", () => {
  it("normalizes metadata and keeps category null as an explicit edit", () => {
    expect(
      parseUpdateCreditCardPurchaseCommand({
        commandId: " t09-update-1 ",
        purchaseId: ` ${PURCHASE_ID} `,
        description: "  Compra   corrigida ",
        categoryId: null,
      }),
    ).toEqual({
      commandId: "t09-update-1",
      purchaseId: PURCHASE_ID,
      description: "Compra corrigida",
      categoryId: null,
    });
  });

  it("requires at least one editable metadata field", () => {
    expect(
      validateUpdateCreditCardPurchaseCommand({
        commandId: "t09-update-empty",
        purchaseId: PURCHASE_ID,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
  });

  it("rejects every financial, schedule and entry field at the boundary", () => {
    const immutableFields = [
      "amountCents",
      "cardId",
      "occurredOn",
      "installmentCount",
      "billingCycle",
      "entries",
    ] as const;

    for (const field of immutableFields) {
      expect(
        validateUpdateCreditCardPurchaseCommand({
          commandId: `t09-immutable-${field}`,
          purchaseId: PURCHASE_ID,
          description: "metadata only",
          [field]: field === "entries" ? [] : "immutable",
        }),
      ).toMatchObject({ ok: false, error: { code: "NON_EDITABLE_FIELD" } });
    }
  });

  it("does not accept installment or event authority in an update", () => {
    expect(
      validateUpdateCreditCardPurchaseCommand({
        commandId: "t09-installment-update",
        purchaseId: PURCHASE_ID,
        installmentId: PURCHASE_ID,
        description: "metadata only",
      }),
    ).toMatchObject({ ok: false, error: { code: "NON_EDITABLE_FIELD" } });
    expect(
      validateUpdateCreditCardPurchaseCommand({
        commandId: "t09-status-update",
        purchaseId: PURCHASE_ID,
        status: "CANCELLED",
        description: "metadata only",
      }),
    ).toMatchObject({ ok: false, error: { code: "NON_EDITABLE_FIELD" } });
  });

  it("parses cancellation as one aggregate command", () => {
    expect(
      parseCancelCreditCardPurchaseCommand({
        commandId: " t09-cancel-1 ",
        purchaseId: ` ${PURCHASE_ID} `,
      }),
    ).toEqual({ commandId: "t09-cancel-1", purchaseId: PURCHASE_ID });
  });

  it("forbids installment-scoped cancellation and client status", () => {
    expect(
      validateCancelCreditCardPurchaseCommand({
        commandId: "t09-cancel-installment",
        purchaseId: PURCHASE_ID,
        installmentId: PURCHASE_ID,
      }),
    ).toMatchObject({ ok: false, error: { code: "NON_EDITABLE_FIELD" } });
    expect(
      validateCancelCreditCardPurchaseCommand({
        commandId: "t09-cancel-status",
        purchaseId: PURCHASE_ID,
        status: "CANCELLED",
      }),
    ).toMatchObject({ ok: false, error: { code: "NON_EDITABLE_FIELD" } });
  });

  it("maps malformed purchase IDs to a safe field-specific error", () => {
    expect(
      validateCancelCreditCardPurchaseCommand({
        commandId: "t09-invalid-id",
        purchaseId: "not-a-uuid",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_PURCHASE_ID", field: "purchaseId" },
    });
    expect(
      validateUpdateCreditCardPurchaseCommand({
        commandId: "t09-invalid-category",
        purchaseId: PURCHASE_ID,
        categoryId: CATEGORY_ID,
        description: "metadata only",
      }),
    ).toMatchObject({ ok: true });
  });
});
