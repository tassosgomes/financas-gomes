import { describe, expect, it } from "vitest";

import {
  archiveCreditCardCommandSchema,
  assertBillingRuleVersion,
  assertCreditCardCanArchive,
  assertCreditCardIsActive,
  assertDefaultPaymentAccount,
  createCreditCardCommandSchema,
  listCreditCardsQuerySchema,
  parseArchiveCreditCardCommand,
  parseCreateCreditCardCommand,
  parseListCreditCardsQuery,
  parseUpdateCreditCardCommand,
  safeParseCreditCardCommand,
  toCreditCardDomainError,
  updateCreditCardBillingRuleCommandSchema,
  validateCreateCreditCardCommand,
} from "./validation";
import {
  CREDIT_CARD_ACCOUNT_TYPE,
  CreditCardDomainError,
  type AccountReference,
  type CreditCardReference,
} from "./contracts";

const CARD_ID = "018f47b7-6c3a-7abc-8def-1234567890ab";
const CARD_ACCOUNT_ID = "018f47b7-6c3a-7abc-8def-1234567890ac";
const PAYMENT_ACCOUNT_ID = "018f47b7-6c3a-7abc-8def-1234567890ad";
const OTHER_ACCOUNT_ID = "018f47b7-6c3a-7abc-8def-1234567890ae";
const HOUSEHOLD_ID = "018f47b7-6c3a-7abc-8def-1234567890af";
const OTHER_HOUSEHOLD_ID = "018f47b7-6c3a-7abc-8def-1234567890b0";

const createCommand = {
  commandId: " create-card-1 ",
  name: "  Cartão   principal ",
  creditLimitCents: "000100000",
  closingDay: 10,
  dueDay: 20,
  defaultPaymentAccountId: PAYMENT_ACCOUNT_ID,
  effectiveFrom: "2026-08-30",
};

const card: CreditCardReference = {
  id: CARD_ID,
  householdId: HOUSEHOLD_ID,
  accountId: CARD_ACCOUNT_ID,
  status: "ACTIVE",
  type: CREDIT_CARD_ACCOUNT_TYPE,
};

const paymentAccount: AccountReference = {
  id: PAYMENT_ACCOUNT_ID,
  householdId: HOUSEHOLD_ID,
  status: "ACTIVE",
  type: "CHECKING",
};

function expectCode(run: () => unknown, code: string): void {
  expect(run).toThrowError(CreditCardDomainError);
  try {
    run();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("S06 credit-card CRUD contracts", () => {
  it("normalizes a serializable create command without trusting server fields", () => {
    const parsed = parseCreateCreditCardCommand(createCommand);

    expect(parsed).toEqual({
      commandId: "create-card-1",
      name: "Cartão principal",
      creditLimitCents: "100000",
      closingDay: 10,
      dueDay: 20,
      defaultPaymentAccountId: PAYMENT_ACCOUNT_ID,
      effectiveFrom: "2026-08-30",
    });
    expect(JSON.stringify(parsed)).not.toContain("household");
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("type");
    expect(parsed).not.toHaveProperty("accountId");
  });

  it("rejects zero, signs, floats, malformed dates, invalid days and invalid IDs", () => {
    const cases: [unknown, string][] = [
      [{ ...createCommand, creditLimitCents: "0" }, "INVALID_AMOUNT"],
      [{ ...createCommand, creditLimitCents: "-1" }, "INVALID_AMOUNT"],
      [{ ...createCommand, creditLimitCents: "10.5" }, "INVALID_AMOUNT"],
      [{ ...createCommand, effectiveFrom: "2026-02-30" }, "INVALID_DATE"],
      [{ ...createCommand, closingDay: 0 }, "INVALID_BILLING_DAY"],
      [{ ...createCommand, dueDay: 32 }, "INVALID_BILLING_DAY"],
      [{ ...createCommand, defaultPaymentAccountId: "not-an-id" }, "INVALID_ACCOUNT_ID"],
    ];

    for (const [input, code] of cases) {
      expectCode(() => parseCreateCreditCardCommand(input), code);
    }
  });

  it("rejects client authority and immutable card fields at the strict boundary", () => {
    expect(
      createCreditCardCommandSchema.safeParse({
        ...createCommand,
        householdId: HOUSEHOLD_ID,
      }).success,
    ).toBe(false);
    expectCode(
      () =>
        parseUpdateCreditCardCommand({
          commandId: "update-card-1",
          cardId: CARD_ID,
          status: "ARCHIVED",
        }),
      "NON_EDITABLE_FIELD",
    );
    expectCode(
      () =>
        parseUpdateCreditCardCommand({
          commandId: "update-card-2",
          cardId: CARD_ID,
        }),
      "INVALID_COMMAND",
    );
  });

  it("keeps update, archive and billing commands serializable and distinct", () => {
    expect(parseUpdateCreditCardCommand({
      commandId: "update-card-1",
      cardId: ` ${CARD_ID} `,
      name: "Novo nome",
      defaultPaymentAccountId: null,
    })).toEqual({
      commandId: "update-card-1",
      cardId: CARD_ID,
      name: "Novo nome",
      defaultPaymentAccountId: null,
    });

    expect(parseArchiveCreditCardCommand({
      commandId: "archive-card-1",
      cardId: CARD_ID,
    })).toEqual({ commandId: "archive-card-1", cardId: CARD_ID });

    expect(updateCreditCardBillingRuleCommandSchema.parse({
      commandId: "billing-rule-1",
      cardId: CARD_ID,
      closingDay: 31,
      dueDay: 5,
      effectiveFrom: "2027-01-01",
    })).toMatchObject({ effectiveFrom: "2027-01-01" });
    expect(archiveCreditCardCommandSchema.shape).toBeDefined();
  });

  it("maps malformed schemas to safe Result/error envelopes", () => {
    const result = validateCreateCreditCardCommand({ ...createCommand, creditLimitCents: "-1" });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "INVALID_AMOUNT", field: "creditLimitCents" }),
    });

    const generic = safeParseCreditCardCommand(createCreditCardCommandSchema, {
      ...createCommand,
      dueDay: "20",
    });
    expect(generic.ok).toBe(false);
    if (!generic.ok) {
      expect(generic.error.code).toBe("INVALID_BILLING_DAY");
      expect(generic.error.message).not.toContain("Zod");
    }

    expect(toCreditCardDomainError(new Error("database secret"))).toMatchObject({
      code: "INVALID_COMMAND",
      expected: true,
    });
  });

  it("defaults card list queries to active and rejects tenant/status authority", () => {
    expect(listCreditCardsQuerySchema.parse({})).toEqual({ status: "ACTIVE" });
    expect(listCreditCardsQuerySchema.parse({ status: "ALL" })).toEqual({ status: "ALL" });
    expectCode(
      () => parseListCreditCardsQuery({ status: "POSTED" }),
      "INVALID_STATUS_FILTER",
    );
    expectCode(
      () => parseListCreditCardsQuery({ householdId: HOUSEHOLD_ID }),
      "NON_EDITABLE_FIELD",
    );
  });
});

describe("S06 credit-card pure guards", () => {
  it("hides cross-household cards as not found and blocks archived writes", () => {
    expectCode(
      () => assertCreditCardIsActive({ card, householdId: OTHER_HOUSEHOLD_ID }),
      "CARD_NOT_FOUND",
    );
    expectCode(
      () => assertCreditCardIsActive({ card: { ...card, status: "ARCHIVED" }, householdId: HOUSEHOLD_ID }),
      "CARD_ARCHIVED",
    );
    expect(assertCreditCardIsActive({ card, householdId: HOUSEHOLD_ID })).toEqual(card);
  });

  it("requires the specialized CREDIT_CARD account for a card reference", () => {
    expectCode(
      () =>
        assertCreditCardIsActive({
          card,
          householdId: HOUSEHOLD_ID,
          account: {
            id: CARD_ACCOUNT_ID,
            householdId: HOUSEHOLD_ID,
            status: "ACTIVE",
            type: "CHECKING",
          },
        }),
      "ACCOUNT_NOT_CREDIT_CARD",
    );
    expectCode(
      () =>
        assertCreditCardIsActive({
          card,
          householdId: HOUSEHOLD_ID,
          account: {
            id: CARD_ACCOUNT_ID,
            householdId: HOUSEHOLD_ID,
            status: "ARCHIVED",
            type: CREDIT_CARD_ACCOUNT_TYPE,
          },
        }),
      "CARD_ARCHIVED",
    );
  });

  it("validates optional payment account ownership, status, specialization and self-reference", () => {
    expect(() =>
      assertDefaultPaymentAccount({
        householdId: HOUSEHOLD_ID,
        defaultPaymentAccountId: PAYMENT_ACCOUNT_ID,
        cardAccountId: CARD_ACCOUNT_ID,
        account: paymentAccount,
      }),
    ).not.toThrow();
    expect(() =>
      assertDefaultPaymentAccount({
        householdId: HOUSEHOLD_ID,
        defaultPaymentAccountId: null,
      }),
    ).not.toThrow();
    expectCode(
      () =>
        assertDefaultPaymentAccount({
          householdId: HOUSEHOLD_ID,
          defaultPaymentAccountId: OTHER_ACCOUNT_ID,
          account: { ...paymentAccount, id: OTHER_ACCOUNT_ID, householdId: OTHER_HOUSEHOLD_ID },
        }),
      "PAYMENT_ACCOUNT_NOT_FOUND",
    );
    expectCode(
      () =>
        assertDefaultPaymentAccount({
          householdId: HOUSEHOLD_ID,
          cardAccountId: CARD_ACCOUNT_ID,
          defaultPaymentAccountId: CARD_ACCOUNT_ID,
          account: { ...paymentAccount, id: CARD_ACCOUNT_ID, type: CREDIT_CARD_ACCOUNT_TYPE },
        }),
      "PAYMENT_ACCOUNT_INVALID",
    );
    expectCode(
      () =>
        assertDefaultPaymentAccount({
          householdId: HOUSEHOLD_ID,
          defaultPaymentAccountId: PAYMENT_ACCOUNT_ID,
          account: { ...paymentAccount, status: "ARCHIVED" },
        }),
      "PAYMENT_ACCOUNT_ARCHIVED",
    );
    expectCode(
      () =>
        assertDefaultPaymentAccount({
          householdId: HOUSEHOLD_ID,
          defaultPaymentAccountId: PAYMENT_ACCOUNT_ID,
          account: { ...paymentAccount, type: CREDIT_CARD_ACCOUNT_TYPE },
        }),
      "PAYMENT_ACCOUNT_INVALID",
    );
  });

  it("checks versioned billing ranges without mutating existing snapshots", () => {
    const existing = {
      id: "018f47b7-6c3a-7abc-8def-1234567890b1",
      cardId: CARD_ID,
      closingDay: 10,
      dueDay: 20,
      effectiveFrom: "2026-01-01",
      effectiveUntil: "2027-01-01",
    } as const;
    expect(() =>
      assertBillingRuleVersion({
        cardId: CARD_ID,
        closingDay: 5,
        dueDay: 15,
        effectiveFrom: "2027-01-01",
        existingRules: [existing],
      }),
    ).not.toThrow();
    expect(existing.effectiveUntil).toBe("2027-01-01");
    expectCode(
      () =>
        assertBillingRuleVersion({
          cardId: CARD_ID,
          closingDay: 5,
          dueDay: 15,
          effectiveFrom: "2026-12-01",
          existingRules: [existing],
        }),
      "BILLING_RULE_OVERLAP",
    );
    expectCode(
      () =>
        assertBillingRuleVersion({
          cardId: CARD_ID,
          closingDay: 0,
          dueDay: 15,
          effectiveFrom: "2027-01-01",
        }),
      "INVALID_BILLING_DAY",
    );
  });

  it("allows archiving only an active, tenant-owned card", () => {
    expect(assertCreditCardCanArchive({ card, householdId: HOUSEHOLD_ID })).toEqual(card);
    expectCode(
      () => assertCreditCardCanArchive({ card: { ...card, status: "ARCHIVED" }, householdId: HOUSEHOLD_ID }),
      "CARD_ARCHIVED",
    );
  });
});
