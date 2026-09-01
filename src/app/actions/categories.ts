"use server";

import {
  getS02ActionHandlers,
} from "@/modules/accounts-categories/adapters";
import type {
  CategoryReadModel,
  ListCategoriesReadModel,
  S02Result,
} from "@/modules/accounts-categories/contracts";

/**
 * Server-only adapters for category commands and reads. No household ID is
 * accepted here; `requireFinancialContext()` remains the sole authority.
 */
export async function createCategoryAction(
  input: unknown,
): Promise<S02Result<CategoryReadModel>> {
  return getS02ActionHandlers().createCategory(input);
}

export async function listCategoriesAction(
  input?: unknown,
): Promise<S02Result<ListCategoriesReadModel>> {
  return getS02ActionHandlers().listCategories(input);
}

export async function updateCategoryAction(
  input: unknown,
): Promise<S02Result<CategoryReadModel>> {
  return getS02ActionHandlers().updateCategory(input);
}

export async function archiveCategoryAction(
  input: unknown,
): Promise<S02Result<CategoryReadModel>> {
  return getS02ActionHandlers().archiveCategory(input);
}

export async function createCategory(
  input: unknown,
): Promise<S02Result<CategoryReadModel>> {
  return createCategoryAction(input);
}

export async function listCategories(
  input?: unknown,
): Promise<S02Result<ListCategoriesReadModel>> {
  return listCategoriesAction(input);
}

export async function updateCategory(
  input: unknown,
): Promise<S02Result<CategoryReadModel>> {
  return updateCategoryAction(input);
}

export async function archiveCategory(
  input: unknown,
): Promise<S02Result<CategoryReadModel>> {
  return archiveCategoryAction(input);
}
