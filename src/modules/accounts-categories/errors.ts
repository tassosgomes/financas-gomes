/** Stable, database-independent S02 expected errors. */
export {
  AccountsCategoriesDomainError,
  DomainValidationError,
  S02DomainError,
  S02_ERROR_CODES,
  S02_ERROR_MESSAGES,
  failure,
  errorResult,
  ok,
  success,
} from "./contracts";
export type {
  S02Error,
  S02ErrorCode,
  S02ErrorField,
  S02Result,
} from "./contracts";
export { toS02DomainError, toS02Error } from "./validation";
