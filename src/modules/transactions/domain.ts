import {
  S03DomainError,
  type FinancialEventOrigin,
  type FinancialEventStatus,
  type ManualTransactionKind,
  type TransactionAccountReference,
  type TransactionCategoryReference,
} from "./contracts";
import {
  assertDateNotFuture,
  assertDateOnOrAfter,
  formatFinancialDate,
  parseFinancialDate,
  type FinancialDate,
} from "./dates";

export {
  Money,
  canonicalAmountCents,
  formatBRL,
  formatMoneyBRL,
  parseAmountCents,
  parseCents,
  parseBRL,
  parseBrazilianMoney,
  parseMoneyBRL,
  parseMoneyCents,
  parsePositiveCents,
  toCanonicalCents,
} from "./money";
export {
  assertDateNotFuture,
  assertFinancialDateNotFuture,
  assertDateOnOrAfter,
  assertOnOrAfterTrackingStart,
  compareFinancialDates,
  currentFinancialDate,
  formatFinancialDate,
  isFinancialDateInFuture,
  isFinancialDateString,
  isValidDate,
  isValidFinancialDate,
  parseFinancialDate,
  serializeFinancialDate,
  todayFinancialDate,
  toDateString,
  toPlainDate,
} from "./dates";
export type { FinancialDate } from "./dates";
export {
  generateCommandId,
  generateTransactionCommandId,
  generateTransactionId,
  generateUuidV7,
  getUuidV7Timestamp,
  isUuidV7,
  uuidV7Timestamp,
} from "./ids";
export type { UuidV7 } from "./ids";

export interface AccountReferenceValidationInput {
  householdId: string;
  accountId?: string;
  account?: TransactionAccountReference | null;
  occurredOn: FinancialDate | string;
}

export interface CategoryReferenceValidationInput {
  householdId: string;
  categoryId?: string | null;
  category?: TransactionCategoryReference | null;
  kind: ManualTransactionKind;
}

/**
 * Validates a tenant-scoped account already loaded by the server. A missing
 * row and a row from another household intentionally produce the same error.
 */
export function assertAccountReference(
  input: AccountReferenceValidationInput,
): TransactionAccountReference {
  const account = input.account;
  if (
    !account ||
    (input.accountId !== undefined && account.id !== input.accountId) ||
    account.householdId !== input.householdId
  ) {
    throw new S03DomainError("ACCOUNT_NOT_FOUND", "accountId");
  }

  if (account.status === "ARCHIVED") {
    throw new S03DomainError("RESOURCE_ARCHIVED", "accountId");
  }

  const occurredOn =
    typeof input.occurredOn === "string"
      ? parseFinancialDate(input.occurredOn)
      : input.occurredOn;
  assertDateOnOrAfter(occurredOn, account.trackingStartedOn);

  return account;
}

export const assertManualAccountReference = assertAccountReference;
export const assertAccountCanReceiveTransaction = assertAccountReference;

/** Validates an optional category against tenant, status and event kind. */
export function assertCategoryReference(
  input: CategoryReferenceValidationInput,
): TransactionCategoryReference | null {
  if (input.categoryId === undefined || input.categoryId === null) {
    return null;
  }

  const category = input.category;
  if (
    !category ||
    category.id !== input.categoryId ||
    category.householdId !== input.householdId
  ) {
    throw new S03DomainError("CATEGORY_NOT_FOUND", "categoryId");
  }

  if (category.status === "ARCHIVED") {
    throw new S03DomainError("RESOURCE_ARCHIVED", "categoryId");
  }

  if (category.kind !== input.kind) {
    throw new S03DomainError("CATEGORY_KIND_MISMATCH", "categoryId");
  }

  return category;
}

export const assertManualCategoryReference = assertCategoryReference;
export const assertCategoryCanReceiveTransaction = assertCategoryReference;

export interface ManualTransactionReferenceValidationInput
  extends AccountReferenceValidationInput {
  kind: ManualTransactionKind;
  categoryId?: string | null;
  category?: TransactionCategoryReference | null;
}

/** Applies the date and reference invariants required before a create write. */
export function assertManualTransactionReferences(
  input: ManualTransactionReferenceValidationInput,
): {
  occurredOn: FinancialDate;
  account: TransactionAccountReference;
  category: TransactionCategoryReference | null;
} {
  const occurredOn =
    typeof input.occurredOn === "string"
      ? parseFinancialDate(input.occurredOn)
      : input.occurredOn;

  assertDateNotFuture(occurredOn);
  const account = assertAccountReference({ ...input, occurredOn });
  const category = assertCategoryReference({
    householdId: input.householdId,
    categoryId: input.categoryId,
    category: input.category,
    kind: input.kind,
  });

  return { occurredOn, account, category };
}

export interface ManualEventReference {
  id: string;
  householdId: string;
  origin: FinancialEventOrigin;
  // Persistence also carries lifecycle states used by S06. Maintenance
  // policy below maps every non-POSTED state to the stable domain error.
  status: FinancialEventStatus | "PLANNED" | "EXPECTED" | "PENDING";
  kind: string;
}

export interface EventReferenceValidationInput {
  householdId: string;
  financialEventId: string;
  event?: ManualEventReference | null;
}

function assertEventInHousehold(
  input: EventReferenceValidationInput,
): ManualEventReference {
  const event = input.event;
  if (
    !event ||
    event.id !== input.financialEventId ||
    event.householdId !== input.householdId
  ) {
    throw new S03DomainError("EVENT_NOT_FOUND", "financialEventId");
  }
  return event;
}

/** T07 may use this invariant for metadata updates. */
export function assertManualEventCanUpdate(
  input: EventReferenceValidationInput,
): ManualEventReference {
  const event = assertEventInHousehold(input);
  if (event.origin !== "MANUAL") {
    throw new S03DomainError("EVENT_NOT_MANUAL", "financialEventId");
  }
  if (event.status === "CANCELLED") {
    throw new S03DomainError("EVENT_ALREADY_CANCELLED", "financialEventId");
  }
  if (event.status !== "POSTED") {
    throw new S03DomainError("EVENT_NOT_POSTED", "financialEventId");
  }
  return event;
}

/** T07 may use this invariant before creating a compensating reversal. */
export function assertManualEventCanCancel(
  input: EventReferenceValidationInput & { hasReversal?: boolean },
): ManualEventReference {
  const event = assertEventInHousehold(input);
  if (event.origin !== "MANUAL") {
    throw new S03DomainError("EVENT_NOT_MANUAL", "financialEventId");
  }
  if (event.status === "CANCELLED") {
    throw new S03DomainError("EVENT_ALREADY_CANCELLED", "financialEventId");
  }
  if (event.status !== "POSTED") {
    throw new S03DomainError("EVENT_NOT_POSTED", "financialEventId");
  }
  if (input.hasReversal) {
    throw new S03DomainError("REVERSAL_ALREADY_EXISTS", "financialEventId");
  }
  return event;
}

/** Serializes a date after all domain checks have passed. */
export function toFinancialDateBoundary(value: FinancialDate): string {
  return formatFinancialDate(value);
}
