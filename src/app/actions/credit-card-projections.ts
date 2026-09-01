"use server";

import { requireFinancialContext } from "@/modules/households/context";
import { FinancialContextError } from "@/modules/households/contracts";
import { createCreditCardProjectionUseCases } from "@/modules/credit-cards/projections";
import {
  failure,
  type CreditCardProjectionReadModel,
  type CreditCardResult,
  type CreditCardStatementReadModel,
} from "@/modules/credit-cards/contracts";

const projectionUseCases = createCreditCardProjectionUseCases();

async function withContext<T>(
  operation: (
    context: Awaited<ReturnType<typeof requireFinancialContext>>,
  ) => Promise<CreditCardResult<T>>,
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

export async function getCreditCardProjectionAction(
  input: unknown,
): Promise<CreditCardResult<CreditCardProjectionReadModel>> {
  return withContext((context) => projectionUseCases.get(context, input));
}

export async function getCreditCardStatementAction(
  input: unknown,
): Promise<CreditCardResult<CreditCardStatementReadModel>> {
  return withContext((context) => projectionUseCases.statement(context, input));
}

export async function getCurrentStatementAmountAction(
  input: unknown,
): Promise<CreditCardResult<string>> {
  return withContext((context) => projectionUseCases.currentStatementAmount(context, input));
}

export async function getProjectedStatementAmountAction(
  input: unknown,
): Promise<CreditCardResult<string>> {
  return withContext((context) => projectionUseCases.projectedStatementAmount(context, input));
}

export async function getOutstandingCardObligationAction(
  input: unknown,
): Promise<CreditCardResult<string>> {
  return withContext((context) => projectionUseCases.outstandingCardObligation(context, input));
}

export async function getAvailableCreditLimitAction(
  input: unknown,
): Promise<CreditCardResult<string>> {
  return withContext((context) => projectionUseCases.availableCreditLimit(context, input));
}

export async function getCardCreditBalanceAction(
  input: unknown,
): Promise<CreditCardResult<string>> {
  return withContext((context) => projectionUseCases.cardCreditBalance(context, input));
}

export async function getCreditCardProjection(input: unknown) {
  return getCreditCardProjectionAction(input);
}

export async function getCreditCardStatement(input: unknown) {
  return getCreditCardStatementAction(input);
}

export async function getCurrentStatementAmount(input: unknown) {
  return getCurrentStatementAmountAction(input);
}

export async function getProjectedStatementAmount(input: unknown) {
  return getProjectedStatementAmountAction(input);
}

export async function getOutstandingCardObligation(input: unknown) {
  return getOutstandingCardObligationAction(input);
}

export async function getAvailableCreditLimit(input: unknown) {
  return getAvailableCreditLimitAction(input);
}

export async function getCardCreditBalance(input: unknown) {
  return getCardCreditBalanceAction(input);
}
