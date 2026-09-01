"use client";

import * as React from "react";

import type { AccountReadModel } from "@/modules/accounts-categories/contracts";

export type CsvImportAccountOption = Pick<
  AccountReadModel,
  "id" | "name" | "status"
>;

export interface CsvImportAccountSelectorProps
  extends Omit<
    React.SelectHTMLAttributes<HTMLSelectElement>,
    "children" | "value" | "defaultValue" | "onChange"
  > {
  /** Accounts are display options only; the server revalidates the choice. */
  accounts: readonly CsvImportAccountOption[];
  value?: string;
  defaultValue?: string;
  onAccountChange?: (accountId: string) => void;
  /** Alias for callers that use the native field vocabulary. */
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  label?: string;
  description?: string;
  error?: string;
  testId?: string;
}

const SELECT_CLASS_NAME =
  "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Accessible account picker shared by import screens. Archived accounts are
 * intentionally omitted, while the authenticated server still treats the
 * selected ID as untrusted input and checks membership/activity again.
 */
export function CsvImportAccountSelector({
  accounts,
  value,
  defaultValue,
  onAccountChange,
  onChange,
  label = "Conta de destino",
  description = "Escolha uma conta ativa para receber os lançamentos importados.",
  error,
  id = "csv-import-account",
  name = "accountId",
  testId = "csv-import-account-selector",
  disabled,
  ...selectProps
}: CsvImportAccountSelectorProps) {
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const activeAccounts = accounts.filter((account) => account.status === "ACTIVE");
  const describedBy = [description ? descriptionId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    onAccountChange?.(event.target.value);
    onChange?.(event);
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      {description ? (
        <p className="text-xs text-muted-foreground" id={descriptionId}>
          {description}
        </p>
      ) : null}
      <select
        {...selectProps}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        className={`${SELECT_CLASS_NAME}${selectProps.className ? ` ${selectProps.className}` : ""}`}
        data-testid={`${testId}-input`}
        defaultValue={defaultValue}
        disabled={disabled || activeAccounts.length === 0}
        id={id}
        name={name}
        onChange={handleChange}
        value={value}
      >
        <option value="">Selecione uma conta</option>
        {activeAccounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>
      {activeAccounts.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid={`${testId}-empty`}>
          Cadastre uma conta ativa antes de importar.
        </p>
      ) : null}
      {error ? (
        <p
          aria-live="polite"
          className="text-sm text-destructive"
          data-testid={`${testId}-error`}
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const AccountSelector = CsvImportAccountSelector;
export const ImportAccountSelector = CsvImportAccountSelector;

