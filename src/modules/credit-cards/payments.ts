import { Money } from "@/modules/transactions/domain";

import { CreditCardDomainError } from "./contracts";

/** Server-owned draft for one realized transfer entry. */
export interface CreditCardPaymentEntryDraft {
  accountId: string;
  amountCents: bigint;
  status: "POSTED";
  installmentId: null;
  expectedOn: null;
  postedOn: string;
}

export interface CreditCardPaymentTransferDraft {
  kind: "TRANSFER";
  amountCents: bigint;
  entries: readonly [CreditCardPaymentEntryDraft, CreditCardPaymentEntryDraft];
}

/**
 * Builds the only ledger shape allowed for a global card payment. The caller
 * supplies a positive Money value; signs and the absence of installment
 * lineage are derived here so an adapter cannot create a one-sided payment.
 */
export function buildCreditCardPaymentTransfer(input: {
  sourceAccountId: string;
  cardAccountId: string;
  amount: Money;
  postedOn: string;
}): CreditCardPaymentTransferDraft {
  if (input.sourceAccountId === input.cardAccountId) {
    throw new CreditCardDomainError("PAYMENT_ACCOUNT_INVALID", "sourceAccountId");
  }
  if (!(input.amount instanceof Money) || !input.amount.isPositive()) {
    throw new CreditCardDomainError("INVALID_AMOUNT", "amountCents");
  }

  const source: CreditCardPaymentEntryDraft = {
    accountId: input.sourceAccountId,
    amountCents: input.amount.negate().cents,
    status: "POSTED",
    installmentId: null,
    expectedOn: null,
    postedOn: input.postedOn,
  };
  const card: CreditCardPaymentEntryDraft = {
    accountId: input.cardAccountId,
    amountCents: input.amount.cents,
    status: "POSTED",
    installmentId: null,
    expectedOn: null,
    postedOn: input.postedOn,
  };

  const entries = Object.freeze([source, card]) as readonly [
    CreditCardPaymentEntryDraft,
    CreditCardPaymentEntryDraft,
  ];
  if (entries.length !== 2 || sumCreditCardPaymentEntries(entries) !== BigInt(0)) {
    throw new CreditCardDomainError("CREDIT_CARD_INVALID");
  }

  return Object.freeze({
    kind: "TRANSFER" as const,
    amountCents: input.amount.cents,
    entries,
  });
}

export function sumCreditCardPaymentEntries(
  entries: readonly CreditCardPaymentEntryDraft[],
): bigint {
  return entries.reduce((total, entry) => total + entry.amountCents, BigInt(0));
}

export const buildPaymentTransfer = buildCreditCardPaymentTransfer;
export const createCreditCardPaymentTransfer = buildCreditCardPaymentTransfer;
