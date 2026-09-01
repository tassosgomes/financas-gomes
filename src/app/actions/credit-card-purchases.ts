"use server";

import { requireFinancialContext } from "@/modules/households/context";
import { FinancialContextError } from "@/modules/households/contracts";
import {
  createCreditCardPurchaseUseCases,
} from "@/modules/credit-cards/purchase-use-cases";
import {
  failure,
  type CreditCardPurchaseReadModel,
  type CreditCardResult,
} from "@/modules/credit-cards/contracts";

/** Read-only aggregate detail boundary; authentication/tenant stay server-owned. */
export async function getCreditCardPurchaseAction(
  input: unknown,
): Promise<CreditCardResult<CreditCardPurchaseReadModel>> {
  try {
    const context = await requireFinancialContext();
    return createCreditCardPurchaseUseCases().get(context, input);
  } catch (error) {
    if (error instanceof FinancialContextError) {
      return failure("UNAUTHENTICATED");
    }
    throw error;
  }
}

/** Thin server boundary: authentication/tenant are resolved only here. */
export async function createCreditCardPurchaseAction(
  input: unknown,
): Promise<CreditCardResult<CreditCardPurchaseReadModel>> {
  try {
    const context = await requireFinancialContext();
    return createCreditCardPurchaseUseCases().create(context, input);
  } catch (error) {
    if (error instanceof FinancialContextError) {
      return failure("UNAUTHENTICATED");
    }
    throw error;
  }
}

/** Metadata-only purchase maintenance; the tenant comes from the session. */
export async function updateCreditCardPurchaseAction(
  input: unknown,
): Promise<CreditCardResult<CreditCardPurchaseReadModel>> {
  try {
    const context = await requireFinancialContext();
    return createCreditCardPurchaseUseCases().update(context, input);
  } catch (error) {
    if (error instanceof FinancialContextError) {
      return failure("UNAUTHENTICATED");
    }
    throw error;
  }
}

/** Aggregate cancellation; individual installment cancellation is forbidden. */
export async function cancelCreditCardPurchaseAction(
  input: unknown,
): Promise<CreditCardResult<CreditCardPurchaseReadModel>> {
  try {
    const context = await requireFinancialContext();
    return createCreditCardPurchaseUseCases().cancel(context, input);
  } catch (error) {
    if (error instanceof FinancialContextError) {
      return failure("UNAUTHENTICATED");
    }
    throw error;
  }
}

export async function createPurchaseAction(input: unknown) {
  return createCreditCardPurchaseAction(input);
}

export async function getPurchaseAction(input: unknown) {
  return getCreditCardPurchaseAction(input);
}

export async function getCreditCardPurchase(input: unknown) {
  return getCreditCardPurchaseAction(input);
}

export async function getPurchase(input: unknown) {
  return getCreditCardPurchaseAction(input);
}

export async function createCreditCardPurchase(input: unknown) {
  return createCreditCardPurchaseAction(input);
}

export async function createPurchase(input: unknown) {
  return createCreditCardPurchaseAction(input);
}

export async function updatePurchaseAction(input: unknown) {
  return updateCreditCardPurchaseAction(input);
}

export async function cancelPurchaseAction(input: unknown) {
  return cancelCreditCardPurchaseAction(input);
}

export async function updateCreditCardPurchase(input: unknown) {
  return updateCreditCardPurchaseAction(input);
}

export async function cancelCreditCardPurchase(input: unknown) {
  return cancelCreditCardPurchaseAction(input);
}

export async function updatePurchase(input: unknown) {
  return updateCreditCardPurchaseAction(input);
}

export async function cancelPurchase(input: unknown) {
  return cancelCreditCardPurchaseAction(input);
}
