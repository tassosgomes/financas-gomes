import type { BudgetMovementKind } from "@/modules/budgets/contracts";

const INVALID_VALUE_LABEL = "Valor indisponível";
const UNSIGNED_CENTS_PATTERN = /^\d+$/u;
const SIGNED_CENTS_PATTERN = /^-?\d+$/u;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

const DIVISIBLE_BY_FOUR_SUFFIXES = new Set([
  "00",
  "04",
  "08",
  "12",
  "16",
  "20",
  "24",
  "28",
  "32",
  "36",
  "40",
  "44",
  "48",
  "52",
  "56",
  "60",
  "64",
  "68",
  "72",
  "76",
  "80",
  "84",
  "88",
  "92",
  "96",
]);

const DAYS_BY_MONTH: Readonly<Record<string, string>> = {
  "01": "31",
  "02": "28",
  "03": "31",
  "04": "30",
  "05": "31",
  "06": "30",
  "07": "31",
  "08": "31",
  "09": "30",
  "10": "31",
  "11": "30",
  "12": "31",
};

interface CentsParts {
  readonly negative: boolean;
  readonly whole: string;
  readonly fraction: string;
}

interface IsoDateParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
}

function canonicalDigits(value: string): string {
  return value.replace(/^0+(?=\d)/u, "");
}

function groupIntegerDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
}

function centsParts(value: string, signed: boolean): CentsParts | null {
  const pattern = signed ? SIGNED_CENTS_PATTERN : UNSIGNED_CENTS_PATTERN;
  if (!pattern.test(value)) return null;

  const negative = signed && value.startsWith("-");
  const digits = canonicalDigits(negative ? value.slice(1) : value);
  const whole = digits.length > 2 ? digits.slice(0, -2) : "0";
  const fraction = digits.length > 2 ? digits.slice(-2) : digits.padStart(2, "0");

  return {
    negative: negative && digits !== "0",
    whole: groupIntegerDigits(whole),
    fraction,
  };
}

/** Formats non-negative decimal cents without a numeric conversion. */
export function formatBudgetCents(value: string): string {
  const parts = centsParts(value, false);
  if (parts === null) return INVALID_VALUE_LABEL;
  return `R$ ${parts.whole},${parts.fraction}`;
}

/** Formats signed decimal cents without a numeric conversion. */
export function formatBudgetSignedCents(value: string): string {
  const parts = centsParts(value, true);
  if (parts === null) return INVALID_VALUE_LABEL;
  const sign = parts.negative ? "-" : "";
  return `${sign}R$ ${parts.whole},${parts.fraction}`;
}

/** Displays a positive movement amount with its server-provided direction. */
export function formatBudgetMovementImpact(
  amountCents: string,
  kind: BudgetMovementKind,
): string {
  if (!UNSIGNED_CENTS_PATTERN.test(amountCents)) return INVALID_VALUE_LABEL;
  return formatBudgetSignedCents(
    kind === "WITHDRAWAL" ? `-${amountCents}` : amountCents,
  );
}

function isLeapYear(year: string): boolean {
  const suffix = year.endsWith("00") ? year.slice(0, 2) : year.slice(2);
  return DIVISIBLE_BY_FOUR_SUFFIXES.has(suffix);
}

function parseIsoDate(value: string): IsoDateParts | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) return null;

  const year = match[1];
  const month = match[2];
  const day = match[3];
  const standardDays = DAYS_BY_MONTH[month];
  if (standardDays === undefined) return null;

  const maximumDay =
    month === "02" && isLeapYear(year) ? "29" : standardDays;
  if (day < "01" || day > maximumDay) return null;

  return { year, month, day };
}

/** Formats a valid civil date and preserves malformed/invalid input verbatim. */
export function formatBudgetDate(value: string): string {
  const parts = parseIsoDate(value);
  return parts === null ? value : `${parts.day}/${parts.month}/${parts.year}`;
}
