"use client";

import * as React from "react";

import type {
  AccountOptionViewModel,
  CreditCardOptionViewModel,
} from "./ui-contracts";

const SELECT_CLASS_NAME =
  "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

interface SelectFieldProps
  extends Omit<
    React.SelectHTMLAttributes<HTMLSelectElement>,
    | "children"
    | "value"
    | "defaultValue"
    | "onChange"
    | "aria-describedby"
    | "aria-invalid"
    | "autoFocus"
  > {
  label: string;
  description?: string;
  error?: string;
  emptyMessage: string;
  testId: string;
  children: React.ReactNode;
  value?: string;
  defaultValue?: string;
  onSelectChange?: React.ChangeEventHandler<HTMLSelectElement>;
  autoFocusOnError?: boolean;
}

function SelectField({
  autoFocusOnError = true,
  children,
  className,
  defaultValue,
  description,
  emptyMessage,
  error,
  id,
  label,
  name,
  onSelectChange,
  testId,
  value,
  ...props
}: SelectFieldProps) {
  const resolvedId = id ?? testId;
  const descriptionId = `${resolvedId}-description`;
  const errorId = `${resolvedId}-error`;
  const describedBy = [description ? descriptionId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-2" data-testid={testId}>
      <label className="text-sm font-medium" htmlFor={resolvedId}>
        {label}
      </label>
      {description ? (
        <p className="text-xs text-muted-foreground" id={descriptionId}>
          {description}
        </p>
      ) : null}
      <select
        {...props}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        autoFocus={autoFocusOnError && Boolean(error)}
        className={`${SELECT_CLASS_NAME}${className ? ` ${className}` : ""}`}
        defaultValue={defaultValue}
        disabled={props.disabled || React.Children.count(children) === 1}
        id={resolvedId}
        name={name}
        onChange={onSelectChange}
        value={value}
      >
        {children}
      </select>
      {React.Children.count(children) === 1 ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid={`${testId}-empty`}
        >
          {emptyMessage}
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

export interface CreditCardSelectorProps
  extends Omit<SelectFieldProps, "children" | "emptyMessage" | "label" | "testId"> {
  cards: readonly (Pick<CreditCardOptionViewModel, "id" | "name"> &
    Partial<Pick<CreditCardOptionViewModel, "status">>)[];
  label?: string;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  onCardChange?: (cardId: string) => void;
  testId?: string;
}

/** Active-card selector; archived cards stay visible only in read models. */
export function CreditCardSelector({
  cards,
  description = "Somente cartões ativos aceitam novas compras ou pagamentos.",
  error,
  label = "Cartão",
  onCardChange,
  onChange,
  testId = "credit-card-selector",
  ...props
}: CreditCardSelectorProps) {
  const activeCards = cards.filter((card) => card.status !== "ARCHIVED");
  return (
    <SelectField
      {...props}
      description={description}
      emptyMessage="Cadastre um cartão ativo antes de continuar."
      error={error}
      label={label}
      onSelectChange={(event) => {
        onCardChange?.(event.currentTarget.value);
        onChange?.(event);
      }}
      testId={testId}
    >
      <option value="">Selecione um cartão</option>
      {activeCards.map((card) => (
        <option key={card.id} value={card.id}>
          {card.name}
        </option>
      ))}
    </SelectField>
  );
}

export interface AccountSelectorProps
  extends Omit<SelectFieldProps, "children" | "emptyMessage" | "label" | "testId"> {
  accounts: readonly (Pick<AccountOptionViewModel, "id" | "name" | "status"> &
    Partial<Pick<AccountOptionViewModel, "type">>)[];
  label?: string;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  /** Payment sources exclude credit-card accounts unless explicitly allowed. */
  allowCreditCard?: boolean;
  onAccountChange?: (accountId: string) => void;
  testId?: string;
}

/** Active account selector shared by billing/payment forms. */
export function CreditCardAccountSelector({
  accounts,
  allowCreditCard = false,
  description = "Escolha uma conta ativa.",
  error,
  label = "Conta",
  onAccountChange,
  onChange,
  testId = "credit-card-account-selector",
  ...props
}: AccountSelectorProps) {
  const activeAccounts = accounts.filter(
    (account) =>
      account.status !== "ARCHIVED" &&
      (allowCreditCard || account.type !== "CREDIT_CARD"),
  );
  return (
    <SelectField
      {...props}
      description={description}
      emptyMessage="Cadastre uma conta ativa antes de continuar."
      error={error}
      label={label}
      onSelectChange={(event) => {
        onAccountChange?.(event.currentTarget.value);
        onChange?.(event);
      }}
      testId={testId}
    >
      <option value="">Selecione uma conta</option>
      {activeAccounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
        </option>
      ))}
    </SelectField>
  );
}

export const CardSelector = CreditCardSelector;
export const AccountSelector = CreditCardAccountSelector;
export const AccountCardSelector = CreditCardAccountSelector;
