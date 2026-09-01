"use client";

import * as React from "react";

import { getTodayIsoDate, ISO_DATE_PATTERN } from "@/modules/transactions/form-contract";

export interface DateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "max" | "min"> {
  /** Upper boundary in the serializable YYYY-MM-DD representation. */
  maxDate?: string;
  /** Optional lower boundary, e.g. an account tracking start date. */
  minDate?: string;
}

/**
 * Native date input with an explicit ISO boundary. Browser locale affects only
 * presentation; the value sent through React Hook Form remains YYYY-MM-DD.
 */
export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  function DateInput(
    { className, maxDate, minDate, ...props },
    ref,
  ) {
    const safeMaxDate = maxDate && ISO_DATE_PATTERN.test(maxDate)
      ? maxDate
      : getTodayIsoDate();
    const safeMinDate = minDate && ISO_DATE_PATTERN.test(minDate)
      ? minDate
      : undefined;

    return (
      <input
        {...props}
        className={className}
        data-date-boundary="YYYY-MM-DD"
        max={safeMaxDate}
        min={safeMinDate}
        ref={ref}
        type="date"
      />
    );
  },
);

DateInput.displayName = "DateInput";

export const TransactionDateInput = DateInput;

