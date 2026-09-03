"use server";

import {
  getAccountsCategoriesActionHandlers,
} from "@/modules/accounts-categories/adapters";
import type {
  AccountReadModel,
  ListAccountsReadModel,
  AccountsCategoriesResult,
} from "@/modules/accounts-categories/contracts";

/**
 * Server-only adapters for account commands and reads. The action receives
 * only the command/query boundary; the tenant is resolved in the adapter.
 */
export async function createAccountAction(
  input: unknown,
): Promise<AccountsCategoriesResult<AccountReadModel>> {
  return getAccountsCategoriesActionHandlers().createAccount(input);
}

export async function listAccountsAction(
  input?: unknown,
): Promise<AccountsCategoriesResult<ListAccountsReadModel>> {
  return getAccountsCategoriesActionHandlers().listAccounts(input);
}

export async function updateAccountAction(
  input: unknown,
): Promise<AccountsCategoriesResult<AccountReadModel>> {
  return getAccountsCategoriesActionHandlers().updateAccount(input);
}

export async function archiveAccountAction(
  input: unknown,
): Promise<AccountsCategoriesResult<AccountReadModel>> {
  return getAccountsCategoriesActionHandlers().archiveAccount(input);
}

/** Short aliases keep call sites readable without changing the action API. */
export async function createAccount(
  input: unknown,
): Promise<AccountsCategoriesResult<AccountReadModel>> {
  return createAccountAction(input);
}

export async function listAccounts(
  input?: unknown,
): Promise<AccountsCategoriesResult<ListAccountsReadModel>> {
  return listAccountsAction(input);
}

export async function updateAccount(
  input: unknown,
): Promise<AccountsCategoriesResult<AccountReadModel>> {
  return updateAccountAction(input);
}

export async function archiveAccount(
  input: unknown,
): Promise<AccountsCategoriesResult<AccountReadModel>> {
  return archiveAccountAction(input);
}
