"use client";

import * as React from "react";

import { parseMoneyBRL } from "@/modules/transactions/money";

const DECIMAL_DIGITS = /^\d+$/u;

function canonicalizeDigits(value: string): string {
  const normalized = value.replace(/^0+(?=\d)/u, "");
  return normalized || "0";
}

/** Formats cents without a currency symbol for compact form input text. */
export function formatMoneyInputCents(
  value: string | bigint | null | undefined,
): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const raw = typeof value === "bigint" ? value.toString(10) : value;
  if (!DECIMAL_DIGITS.test(raw)) {
    return "";
  }

  const cents = canonicalizeDigits(raw);
  const integerPart = cents.length > 2 ? cents.slice(0, -2) : "0";
  const fractionalPart = cents.slice(-2).padStart(2, "0");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");

  return `${groupedInteger},${fractionalPart}`;
}

/**
 * A currency-mask parser: typed digits represent cents (`123456` becomes
 * `1.234,56`). Pasted Brazilian display values are parsed without Number or
 * floating-point rounding and invalid values become an empty form value.
 */
function digitsAsCents(value: string): string {
  const digits = value.replace(/\D/gu, "");
  return digits ? canonicalizeDigits(digits) : "";
}

export function parseMoneyInputCents(value: string): string {
  if (/[+-]/u.test(value)) {
    return "";
  }

  const trimmed = value.trim();
  if (
    trimmed.includes(",") ||
    /^R\$/iu.test(trimmed) ||
    /^\d{1,3}(?:\.\d{3})+$/u.test(trimmed)
  ) {
    try {
      return parseMoneyBRL(trimmed);
    } catch {
      // Intermediate typed values such as "0,012" are not valid BRL display
      // (more than two decimals), but they are normal while the digit-as-cents
      // mask reformats after each keystroke. Fall back instead of clearing.
      return digitsAsCents(value);
    }
  }

  return digitsAsCents(value);
}

export interface MoneyInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "defaultValue" | "onChange"
  > {
  /** Canonical integer cents, never the formatted display string. */
  value?: string | null;
  /** Initial canonical cents for uncontrolled usage. */
  defaultValue?: string | null;
  /** Called with a serializable decimal cents string. */
  onCentsChange?: (value: string) => void;
  /** Alias for consumers that call the boundary value a value. */
  onValueChange?: (value: string) => void;
  /** Optional native callback, receiving the original input event. */
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}

/**
 * Brazilian money input. The DOM value is always text; the form value is an
 * integer-cent string, which keeps precision through the React/Next boundary.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  function MoneyInput(
    {
      "aria-describedby": ariaDescribedBy,
      "aria-label": ariaLabel,
      className,
      defaultValue,
      onBlur,
      onCentsChange,
      onChange,
      onValueChange,
      value,
      ...props
    },
    ref,
  ) {
    const isControlled = value !== undefined;
    const [displayValue, setDisplayValue] = React.useState(() =>
      formatMoneyInputCents(value ?? defaultValue),
    );

    React.useEffect(() => {
      if (isControlled) {
        setDisplayValue(formatMoneyInputCents(value));
      }
    }, [isControlled, value]);

    function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
      const nextCents = parseMoneyInputCents(event.target.value);
      const nextDisplay = formatMoneyInputCents(nextCents);
      setDisplayValue(nextDisplay);
      onCentsChange?.(nextCents);
      onValueChange?.(nextCents);
      onChange?.(event);
    }

    return (
      <input
        {...props}
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel}
        className={className}
        data-money-boundary="amountCents"
        inputMode="decimal"
        onBlur={onBlur}
        onChange={handleChange}
        ref={ref}
        type="text"
        value={displayValue}
      />
    );
  },
);

MoneyInput.displayName = "MoneyInput";

export const TransactionMoneyInput = MoneyInput;
