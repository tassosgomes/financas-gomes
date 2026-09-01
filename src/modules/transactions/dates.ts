import { Temporal } from "@js-temporal/polyfill";

import { S03DomainError } from "./contracts";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export type FinancialDate = Temporal.PlainDate;

function invalidDate(): never {
  throw new S03DomainError("INVALID_DATE", "occurredOn");
}

function ensurePlainDate(value: unknown): Temporal.PlainDate {
  if (!(value instanceof Temporal.PlainDate)) {
    return invalidDate();
  }

  return value;
}

/** Returns true only for the exact serializable YYYY-MM-DD boundary shape. */
export function isFinancialDateString(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_PATTERN.test(value);
}

/**
 * Converts a strict boundary date into the domain's civil-date type. No
 * JavaScript Date is involved, so timezone shifts cannot change the value.
 */
export function parseFinancialDate(value: unknown): Temporal.PlainDate {
  if (!isFinancialDateString(value)) {
    return invalidDate();
  }

  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    return invalidDate();
  }

  try {
    return Temporal.PlainDate.from(
      {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        calendar: "iso8601",
      },
      { overflow: "reject" },
    );
  } catch {
    return invalidDate();
  }
}

/** Serializes a domain date to PostgreSQL DATE/HTTP YYYY-MM-DD. */
export function formatFinancialDate(value: Temporal.PlainDate): string {
  const date = ensurePlainDate(value);

  // The command contract is four-digit ISO years. Reject extended years
  // instead of silently emitting a string the boundary cannot accept.
  if (date.year < 0 || date.year > 9999) {
    return invalidDate();
  }

  return [
    date.year.toString(10).padStart(4, "0"),
    date.month.toString(10).padStart(2, "0"),
    date.day.toString(10).padStart(2, "0"),
  ].join("-");
}

export const serializeFinancialDate = formatFinancialDate;
export const toDateString = formatFinancialDate;
export const toPlainDate = parseFinancialDate;

/** Current business date supplied by Temporal, optionally in an app timezone. */
export function currentFinancialDate(
  timeZone?: Temporal.TimeZoneLike,
): Temporal.PlainDate {
  return Temporal.Now.plainDateISO(timeZone);
}

export const todayFinancialDate = currentFinancialDate;

export function compareFinancialDates(
  left: Temporal.PlainDate,
  right: Temporal.PlainDate,
): -1 | 0 | 1 {
  const comparison = Temporal.PlainDate.compare(
    ensurePlainDate(left),
    ensurePlainDate(right),
  );
  return comparison < 0 ? -1 : comparison > 0 ? 1 : 0;
}

export function isFinancialDateInFuture(
  value: Temporal.PlainDate | string,
  today: Temporal.PlainDate | string = currentFinancialDate(),
): boolean {
  const date = typeof value === "string" ? parseFinancialDate(value) : ensurePlainDate(value);
  const reference =
    typeof today === "string" ? parseFinancialDate(today) : ensurePlainDate(today);

  return compareFinancialDates(date, reference) > 0;
}

/** Throws DATE_IN_FUTURE for a POSTED financial date after the server date. */
export function assertDateNotFuture(
  value: Temporal.PlainDate | string,
  today: Temporal.PlainDate | string = currentFinancialDate(),
): Temporal.PlainDate {
  const date = typeof value === "string" ? parseFinancialDate(value) : ensurePlainDate(value);

  if (isFinancialDateInFuture(date, today)) {
    throw new S03DomainError("DATE_IN_FUTURE", "occurredOn");
  }

  return date;
}

export const assertFinancialDateNotFuture = assertDateNotFuture;
export const validateDateNotFuture = assertDateNotFuture;

/** Checks both the exact boundary shape and the calendar date itself. */
export function isValidFinancialDate(value: unknown): value is string {
  if (!isFinancialDateString(value)) {
    return false;
  }

  try {
    parseFinancialDate(value);
    return true;
  } catch {
    return false;
  }
}

export const isValidDate = isValidFinancialDate;
export const dateIsValid = isValidFinancialDate;

/** Enforces the account's optional tracking start date lower bound. */
export function assertDateOnOrAfter(
  value: Temporal.PlainDate | string,
  trackingStartedOn: Temporal.PlainDate | string | null | undefined,
): Temporal.PlainDate {
  const date = typeof value === "string" ? parseFinancialDate(value) : ensurePlainDate(value);
  if (trackingStartedOn === null || trackingStartedOn === undefined) {
    return date;
  }

  const start =
    typeof trackingStartedOn === "string"
      ? parseFinancialDate(trackingStartedOn)
      : ensurePlainDate(trackingStartedOn);

  if (compareFinancialDates(date, start) < 0) {
    throw new S03DomainError("TRACKING_START_DATE_VIOLATION", "occurredOn");
  }

  return date;
}

export const assertOnOrAfterTrackingStart = assertDateOnOrAfter;
