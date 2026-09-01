"use server";

import {
  getS02ActionHandlers,
} from "@/modules/accounts-categories/adapters";
import type {
  AccountReadModel,
  ListAccountsReadModel,
  S02Result,
} from "@/modules/accounts-categories/contracts";

/**
 * Server-only adapters for account commands and reads. The action receives
 * only the command/query boundary; the tenant is resolved in the adapter.
 */
export async function createAccountAction(
  input: unknown,
): Promise<S02Result<AccountReadModel>> {
  return getS02ActionHandlers().createAccount(input);
}

export async function listAccountsAction(
  input?: unknown,
): Promise<S02Result<ListAccountsReadModel>> {
  return getS02ActionHandlers().listAccounts(input);
}

export async function updateAccountAction(
  input: unknown,
): Promise<S02Result<AccountReadModel>> {
  return getS02ActionHandlers().updateAccount(input);
}

export async function archiveAccountAction(
  input: unknown,
): Promise<S02Result<AccountReadModel>> {
  return getS02ActionHandlers().archiveAccount(input);
}

/** Short aliases keep call sites readable without changing the action API. */
export async function createAccount(
  input: unknown,
): Promise<S02Result<AccountReadModel>> {
  return createAccountAction(input);
}

export async function listAccounts(
  input?: unknown,
): Promise<S02Result<ListAccountsReadModel>> {
  return listAccountsAction(input);
}

export async function updateAccount(
  input: unknown,
): Promise<S02Result<AccountReadModel>> {
  return updateAccountAction(input);
}

export async function archiveAccount(
  input: unknown,
): Promise<S02Result<AccountReadModel>> {
  return archiveAccountAction(input);
}
