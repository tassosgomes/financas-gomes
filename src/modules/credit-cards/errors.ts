/** Stable, database-independent errors for S06 card boundaries. */
export {
  CardDomainError,
  CreditCardDomainError,
  CreditCardError,
  CreditCardValidationError,
  DomainValidationError,
  CREDIT_CARD_ERROR_CODES,
  CREDIT_CARD_ERROR_MESSAGES,
  errorResult,
  failure,
  ok,
  success,
} from "./contracts";

export type {
  CardErrorCode,
  CreditCardErrorCode,
  CreditCardErrorField,
  CreditCardResult,
} from "./contracts";

export {
  toCardDomainError,
  toCardError,
  toCreditCardDomainError,
  toCreditCardError,
} from "./validation";
