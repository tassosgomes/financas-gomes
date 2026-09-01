"use server";

import { requireFinancialContext } from "@/modules/households/context";
import { FinancialContextError } from "@/modules/households/contracts";
import {
  creditCardUseCases,
} from "@/modules/credit-cards/use-cases";
import {
  failure,
  type CreditCardPaymentReadModel,
  type CreditCardReadModel,
  type CreditCardResult,
  type ListCreditCardsReadModel,
} from "@/modules/credit-cards/contracts";
import {
  createCreditCardPurchaseAction as createCreditCardPurchaseBoundary,
} from "./credit-card-purchases";
import {
  getAvailableCreditLimitAction as getAvailableCreditLimitBoundary,
  getCardCreditBalanceAction as getCardCreditBalanceBoundary,
  getCreditCardProjectionAction as getCreditCardProjectionBoundary,
  getCreditCardStatementAction as getCreditCardStatementBoundary,
  getCurrentStatementAmountAction as getCurrentStatementAmountBoundary,
  getOutstandingCardObligationAction as getOutstandingCardObligationBoundary,
  getProjectedStatementAmountAction as getProjectedStatementAmountBoundary,
} from "./credit-card-projections";

async function withContext<T>(
  operation: (context: Awaited<ReturnType<typeof requireFinancialContext>>) => Promise<CreditCardResult<T>>,
): Promise<CreditCardResult<T>> {
  try {
    return await operation(await requireFinancialContext());
  } catch (error) {
    if (error instanceof FinancialContextError) {
      return failure<T>("UNAUTHENTICATED");
    }
    throw error;
  }
}

export async function createCreditCardAction(input: unknown): Promise<CreditCardResult<CreditCardReadModel>> {
  return withContext((context) => creditCardUseCases.create(context, input));
}

export async function listCreditCardsAction(input?: unknown): Promise<CreditCardResult<ListCreditCardsReadModel>> {
  return withContext((context) => creditCardUseCases.list(context, input));
}

export async function getCreditCardAction(input: unknown): Promise<CreditCardResult<CreditCardReadModel>> {
  return withContext((context) => creditCardUseCases.get(context, input));
}

export async function updateCreditCardAction(input: unknown): Promise<CreditCardResult<CreditCardReadModel>> {
  return withContext((context) => creditCardUseCases.update(context, input));
}

export async function archiveCreditCardAction(input: unknown): Promise<CreditCardResult<CreditCardReadModel>> {
  return withContext((context) => creditCardUseCases.archive(context, input));
}

export async function createCreditCardBillingRuleAction(input: unknown): Promise<CreditCardResult<CreditCardReadModel>> {
  return withContext((context) => creditCardUseCases.createBillingRule(context, input));
}

export async function updateCreditCardBillingRuleAction(input: unknown): Promise<CreditCardResult<CreditCardReadModel>> {
  return withContext((context) => creditCardUseCases.updateBillingRule(context, input));
}

/** Global card payment boundary; installment/statement targeting is rejected by the use case schema. */
export async function registerCreditCardPaymentAction(
  input: unknown,
): Promise<CreditCardResult<CreditCardPaymentReadModel>> {
  return withContext((context) => creditCardUseCases.createPayment(context, input));
}

export async function createCreditCardPaymentAction(
  input: unknown,
): Promise<CreditCardResult<CreditCardPaymentReadModel>> {
  return registerCreditCardPaymentAction(input);
}

export async function createCreditCard(input: unknown) {
  return createCreditCardAction(input);
}

export async function listCreditCards(input?: unknown) {
  return listCreditCardsAction(input);
}

export async function getCreditCard(input: unknown) {
  return getCreditCardAction(input);
}

export async function updateCreditCard(input: unknown) {
  return updateCreditCardAction(input);
}

export async function archiveCreditCard(input: unknown) {
  return archiveCreditCardAction(input);
}

export async function createCreditCardBillingRule(input: unknown) {
  return createCreditCardBillingRuleAction(input);
}

export async function updateCreditCardBillingRule(input: unknown) {
  return updateCreditCardBillingRuleAction(input);
}

export async function registerCreditCardPayment(input: unknown) {
  return registerCreditCardPaymentAction(input);
}

export async function createCreditCardPayment(input: unknown) {
  return createCreditCardPaymentAction(input);
}

/** Compatibility purchase aliases kept as async Server Action boundaries. */
export async function createCreditCardPurchaseAction(input: unknown) {
  return createCreditCardPurchaseBoundary(input);
}

export async function createPurchaseAction(input: unknown) {
  return createCreditCardPurchaseBoundary(input);
}

export async function createCreditCardPurchase(input: unknown) {
  return createCreditCardPurchaseBoundary(input);
}

export async function createPurchase(input: unknown) {
  return createCreditCardPurchaseBoundary(input);
}

/** Async wrappers keep this `use server` module valid for Next's action compiler. */
export async function getCreditCardProjectionAction(input: unknown) {
  return getCreditCardProjectionBoundary(input);
}

export async function getCreditCardStatementAction(input: unknown) {
  return getCreditCardStatementBoundary(input);
}

export async function getCurrentStatementAmountAction(input: unknown) {
  return getCurrentStatementAmountBoundary(input);
}

export async function getProjectedStatementAmountAction(input: unknown) {
  return getProjectedStatementAmountBoundary(input);
}

export async function getOutstandingCardObligationAction(input: unknown) {
  return getOutstandingCardObligationBoundary(input);
}

export async function getAvailableCreditLimitAction(input: unknown) {
  return getAvailableCreditLimitBoundary(input);
}

export async function getCardCreditBalanceAction(input: unknown) {
  return getCardCreditBalanceBoundary(input);
}
