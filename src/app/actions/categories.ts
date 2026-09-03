"use server";

import {
  getAccountsCategoriesActionHandlers,
} from "@/modules/accounts-categories/adapters";
import type {
  CategoryReadModel,
  ListCategoriesReadModel,
  AccountsCategoriesResult,
} from "@/modules/accounts-categories/contracts";

/**
 * Server-only adapters for category commands and reads. No household ID is
 * accepted here; `requireFinancialContext()` remains the sole authority.
 */
export async function createCategoryAction(
  input: unknown,
): Promise<AccountsCategoriesResult<CategoryReadModel>> {
  return getAccountsCategoriesActionHandlers().createCategory(input);
}

export async function listCategoriesAction(
  input?: unknown,
): Promise<AccountsCategoriesResult<ListCategoriesReadModel>> {
  return getAccountsCategoriesActionHandlers().listCategories(input);
}

export async function updateCategoryAction(
  input: unknown,
): Promise<AccountsCategoriesResult<CategoryReadModel>> {
  return getAccountsCategoriesActionHandlers().updateCategory(input);
}

export async function archiveCategoryAction(
  input: unknown,
): Promise<AccountsCategoriesResult<CategoryReadModel>> {
  return getAccountsCategoriesActionHandlers().archiveCategory(input);
}

export async function createCategory(
  input: unknown,
): Promise<AccountsCategoriesResult<CategoryReadModel>> {
  return createCategoryAction(input);
}

export async function listCategories(
  input?: unknown,
): Promise<AccountsCategoriesResult<ListCategoriesReadModel>> {
  return listCategoriesAction(input);
}

export async function updateCategory(
  input: unknown,
): Promise<AccountsCategoriesResult<CategoryReadModel>> {
  return updateCategoryAction(input);
}

export async function archiveCategory(
  input: unknown,
): Promise<AccountsCategoriesResult<CategoryReadModel>> {
  return archiveCategoryAction(input);
}
