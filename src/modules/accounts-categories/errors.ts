/** Stable, database-independent expected errors for accounts and categories. */
export {
  AccountsCategoriesDomainError,
  DomainValidationError,
  ACCOUNTS_CATEGORIES_ERROR_CODES,
  ACCOUNTS_CATEGORIES_ERROR_MESSAGES,
  failure,
  errorResult,
  ok,
  success,
} from "./contracts";
export type {
  AccountsCategoriesError,
  AccountsCategoriesErrorCode,
  AccountsCategoriesErrorField,
  AccountsCategoriesResult,
} from "./contracts";
export { toAccountsCategoriesDomainError, toAccountsCategoriesError } from "./validation";
