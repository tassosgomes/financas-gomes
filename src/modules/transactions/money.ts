import { TransactionDomainError } from "./contracts";

const DECIMAL_INTEGER_PATTERN = /^\d+$/u;
const ZERO_CENTS = BigInt(0);
const ONE_HUNDRED_CENTS = BigInt(100);

function invalidAmount(): never {
  throw new TransactionDomainError("INVALID_AMOUNT", "amountCents");
}

function assertBigInt(value: unknown): asserts value is bigint {
  if (typeof value !== "bigint") {
    invalidAmount();
  }
}

/**
 * Parses the serialized amount contract without passing through Number.
 * Leading zeroes are accepted at the boundary and removed from the canonical
 * representation. A manual financial amount must be strictly positive.
 */
export function parseAmountCents(value: unknown): bigint {
  if (typeof value !== "string" || !DECIMAL_INTEGER_PATTERN.test(value)) {
    return invalidAmount();
  }

  try {
    const cents = BigInt(value);
    if (cents <= ZERO_CENTS) {
      return invalidAmount();
    }
    return cents;
  } catch {
    return invalidAmount();
  }
}

/** Canonical decimal representation used in commands and read models. */
export function canonicalAmountCents(value: unknown): string {
  return parseAmountCents(value).toString(10);
}

export const parseCents = parseAmountCents;
export const parsePositiveCents = parseAmountCents;
export const toCanonicalCents = canonicalAmountCents;
export const parseMoneyCents = parseAmountCents;

/**
 * Money is an integer-cent value object. Its constructor is public for domain
 * code that already owns a bigint; external command boundaries should use
 * `Money.fromCents` so zero and negative manual amounts are rejected.
 */
export class Money {
  readonly cents: bigint;

  constructor(cents: bigint) {
    assertBigInt(cents);
    this.cents = cents;
    Object.freeze(this);
  }

  /** Creates a strictly positive amount from a bigint or serialized string. */
  static fromCents(value: bigint | string): Money {
    const cents =
      typeof value === "string" ? parseAmountCents(value) : value;

    if (typeof cents !== "bigint" || cents <= ZERO_CENTS) {
      return invalidAmount();
    }

    return new Money(cents);
  }

  static fromCentsString(value: string): Money {
    return Money.fromCents(value);
  }

  static from(value: bigint | string): Money {
    return Money.fromCents(value);
  }

  static parse(value: string): Money {
    return Money.fromCents(value);
  }

  /** Creates a non-zero signed amount for ledger effects. */
  static fromSignedCents(value: bigint | string): Money {
    let cents: bigint;
    if (typeof value === "string") {
      if (!/^-?\d+$/u.test(value)) {
        return invalidAmount();
      }
      try {
        cents = BigInt(value);
      } catch {
        return invalidAmount();
      }
    } else {
      cents = value;
    }

    if (typeof cents !== "bigint" || cents === ZERO_CENTS) {
      return invalidAmount();
    }

    return new Money(cents);
  }

  /** Internal-friendly zero value for balance arithmetic. */
  static zero(): Money {
    return new Money(ZERO_CENTS);
  }

  add(other: Money): Money {
    return new Money(this.cents + other.cents);
  }

  subtract(other: Money): Money {
    return new Money(this.cents - other.cents);
  }

  negate(): Money {
    return new Money(-this.cents);
  }

  abs(): Money {
    return this.cents < ZERO_CENTS ? this.negate() : this;
  }

  isZero(): boolean {
    return this.cents === ZERO_CENTS;
  }

  isPositive(): boolean {
    return this.cents > ZERO_CENTS;
  }

  isNegative(): boolean {
    return this.cents < ZERO_CENTS;
  }

  compare(other: Money): -1 | 0 | 1 {
    if (this.cents < other.cents) return -1;
    if (this.cents > other.cents) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  /** The only representation appropriate for crossing a JSON boundary. */
  toCentsString(): string {
    return this.cents.toString(10);
  }

  toString(): string {
    return this.toCentsString();
  }

  toJSON(): string {
    return this.toCentsString();
  }
}

function groupIntegerDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
}

/**
 * Formats an integer-cent amount for the Brazilian UI. This function never
 * converts to Number, so values larger than JavaScript's safe integer range
 * retain every cent. It is intentionally a boundary helper, not a domain
 * representation.
 */
export function formatMoneyBRL(value: Money | bigint | string): string {
  let cents: bigint;
  if (value instanceof Money) {
    cents = value.cents;
  } else if (typeof value === "bigint") {
    cents = value;
  } else if (/^-?\d+$/u.test(value)) {
    try {
      cents = BigInt(value);
    } catch {
      return invalidAmount();
    }
  } else {
    return invalidAmount();
  }
  assertBigInt(cents);

  const sign = cents < ZERO_CENTS ? "-" : "";
  const absolute = cents < ZERO_CENTS ? -cents : cents;
  const integerPart = absolute / ONE_HUNDRED_CENTS;
  const centsPart = (absolute % ONE_HUNDRED_CENTS).toString(10).padStart(2, "0");

  return `${sign}R$ ${groupIntegerDigits(integerPart.toString(10))},${centsPart}`;
}

export const formatBRL = formatMoneyBRL;

/**
 * Parses a Brazilian display value at the UI boundary and returns canonical
 * positive cents. More than two fractional digits are rejected; no rounding
 * is performed for manual input.
 */
export function parseMoneyBRL(value: unknown): string {
  if (typeof value !== "string") {
    return invalidAmount();
  }

  const normalized = value.normalize("NFKC").trim();
  const withoutCurrency = normalized.replace(/^R\$\s*/iu, "");

  if (
    withoutCurrency.length === 0 ||
    withoutCurrency.startsWith("-") ||
    /\s/u.test(withoutCurrency)
  ) {
    return invalidAmount();
  }

  const match = /^(\d[\d.]*)?(?:,(\d{1,2}))?$/u.exec(withoutCurrency);
  if (!match || !match[1]) {
    return invalidAmount();
  }

  const integerPart = match[1];
  const integerDigits = integerPart.replace(/\./gu, "");
  if (
    !DECIMAL_INTEGER_PATTERN.test(integerDigits) ||
    (integerPart.includes(".") &&
      !/^\d{1,3}(?:\.\d{3})+$/u.test(integerPart))
  ) {
    return invalidAmount();
  }

  const fractionalPart = (match[2] ?? "").padEnd(2, "0");
  const centsString = `${integerDigits}${fractionalPart}`;
  return canonicalAmountCents(centsString);
}

export const parseBrazilianMoney = parseMoneyBRL;
export const parseBRL = parseMoneyBRL;
