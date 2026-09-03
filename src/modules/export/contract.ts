export const S11_CONTRACT_VERSION = "s11.v1" as const;

export type S11ContractVersion = typeof S11_CONTRACT_VERSION;

export type S11DatasetId =
  | "accounts"
  | "categories"
  | "financial_events"
  | "account_entries"
  | "credit_cards"
  | "credit_card_billing_rules"
  | "credit_card_purchases"
  | "installment_plans"
  | "installments"
  | "recurring_rules"
  | "recurring_occurrences"
  | "planned_events"
  | "holidays"
  | "spendable_settings"
  | "budgets"
  | "budget_movements"
  | "budget_allocation_rules";

export const S11_DATASET_IDS = [
  "accounts",
  "categories",
  "financial_events",
  "account_entries",
  "credit_cards",
  "credit_card_billing_rules",
  "credit_card_purchases",
  "installment_plans",
  "installments",
  "recurring_rules",
  "recurring_occurrences",
  "planned_events",
  "holidays",
  "spendable_settings",
  "budgets",
  "budget_movements",
  "budget_allocation_rules",
] as const satisfies readonly S11DatasetId[];

export const S11_DATASET_FILE_NAMES: Record<S11DatasetId, string> = {
  accounts: "accounts.csv",
  categories: "categories.csv",
  financial_events: "financial_events.csv",
  account_entries: "account_entries.csv",
  credit_cards: "credit_cards.csv",
  credit_card_billing_rules: "credit_card_billing_rules.csv",
  credit_card_purchases: "credit_card_purchases.csv",
  installment_plans: "installment_plans.csv",
  installments: "installments.csv",
  recurring_rules: "recurring_rules.csv",
  recurring_occurrences: "recurring_occurrences.csv",
  planned_events: "planned_events.csv",
  holidays: "holidays.csv",
  spendable_settings: "spendable_settings.csv",
  budgets: "budgets.csv",
  budget_movements: "budget_movements.csv",
  budget_allocation_rules: "budget_allocation_rules.csv",
};

export const S11_ACCOUNTS_COLUMNS = [
  "id",
  "name",
  "type",
  "status",
  "spendability",
  "liquidity",
  "includeInNetWorth",
  "trackingStartedOn",
  "createdAt",
  "updatedAt",
] as const;

export const S11_CATEGORIES_COLUMNS = [
  "id",
  "name",
  "parentId",
  "kind",
  "status",
  "createdAt",
  "updatedAt",
] as const;

export const S11_FINANCIAL_EVENTS_COLUMNS = [
  "id",
  "kind",
  "status",
  "origin",
  "amountCents",
  "occurredOn",
  "description",
  "categoryId",
  "reversalOfEventId",
  "createdAt",
  "updatedAt",
] as const;

export const S11_ACCOUNT_ENTRIES_COLUMNS = [
  "id",
  "financialEventId",
  "installmentId",
  "accountId",
  "amountCents",
  "status",
  "expectedOn",
  "postedOn",
  "createdAt",
] as const;

export const S11_CREDIT_CARDS_COLUMNS = [
  "id",
  "accountId",
  "creditLimitCents",
  "defaultPaymentAccountId",
  "createdAt",
  "updatedAt",
] as const;

export const S11_CREDIT_CARD_BILLING_RULES_COLUMNS = [
  "id",
  "cardId",
  "closingDay",
  "dueDay",
  "effectiveFrom",
  "effectiveUntil",
  "createdAt",
] as const;

export const S11_CREDIT_CARD_PURCHASES_COLUMNS = [
  "id",
  "cardId",
  "financialEventId",
  "installmentPlanId",
  "createdAt",
  "updatedAt",
] as const;

export const S11_INSTALLMENT_PLANS_COLUMNS = [
  "id",
  "purchaseId",
  "totalAmountCents",
  "installmentCount",
  "createdAt",
] as const;

export const S11_INSTALLMENTS_COLUMNS = [
  "id",
  "planId",
  "purchaseId",
  "sequence",
  "amountCents",
  "status",
  "billingRuleId",
  "billingCycle",
  "billingClosingDay",
  "billingDueDay",
  "billingClosingOn",
  "billingDueOn",
  "billingDueOnOverride",
  "createdAt",
] as const;

export const S11_RECURRING_RULES_COLUMNS = [
  "id",
  "accountId",
  "categoryId",
  "kind",
  "amountCents",
  "description",
  "frequency",
  "dayRule",
  "dayOfMonth",
  "startOn",
  "endOn",
  "includeInConservativeForecast",
  "createdAt",
  "updatedAt",
] as const;

export const S11_RECURRING_OCCURRENCES_COLUMNS = [
  "id",
  "recurringRuleId",
  "occurrenceKey",
  "status",
  "amountCents",
  "expectedOn",
  "financialEventId",
  "isPartial",
  "createdAt",
  "updatedAt",
] as const;

export const S11_PLANNED_EVENTS_COLUMNS = [
  "id",
  "accountId",
  "categoryId",
  "kind",
  "status",
  "amountCents",
  "expectedOn",
  "description",
  "includeInConservativeForecast",
  "financialEventId",
  "isPartial",
  "createdAt",
  "updatedAt",
] as const;

export const S11_HOLIDAYS_COLUMNS = [
  "id",
  "date",
  "name",
  "createdAt",
  "updatedAt",
] as const;

export const S11_SPENDABLE_SETTINGS_COLUMNS = [
  "id",
  "effectiveFrom",
  "operationalBufferCents",
  "createdAt",
] as const;

export const S11_BUDGETS_COLUMNS = [
  "id",
  "referenceId",
  "categoryId",
  "name",
  "status",
  "activeFrom",
  "closedOn",
  "targetAmountCents",
  "targetDate",
  "createdAt",
  "updatedAt",
] as const;

export const S11_BUDGET_MOVEMENTS_COLUMNS = [
  "id",
  "budgetId",
  "referenceId",
  "kind",
  "amountCents",
  "effectiveOn",
  "sourceKind",
  "sourceReferenceId",
  "financialEventId",
  "accountEntryId",
  "correctsMovementId",
  "transferReferenceId",
  "createdAt",
] as const;

export const S11_BUDGET_ALLOCATION_RULES_COLUMNS = [
  "id",
  "budgetId",
  "amountCents",
  "effectiveFrom",
  "effectiveUntil",
  "createdAt",
] as const;

export const S11_DATASET_COLUMNS: Record<
  S11DatasetId,
  readonly string[]
> = {
  accounts: S11_ACCOUNTS_COLUMNS,
  categories: S11_CATEGORIES_COLUMNS,
  financial_events: S11_FINANCIAL_EVENTS_COLUMNS,
  account_entries: S11_ACCOUNT_ENTRIES_COLUMNS,
  credit_cards: S11_CREDIT_CARDS_COLUMNS,
  credit_card_billing_rules: S11_CREDIT_CARD_BILLING_RULES_COLUMNS,
  credit_card_purchases: S11_CREDIT_CARD_PURCHASES_COLUMNS,
  installment_plans: S11_INSTALLMENT_PLANS_COLUMNS,
  installments: S11_INSTALLMENTS_COLUMNS,
  recurring_rules: S11_RECURRING_RULES_COLUMNS,
  recurring_occurrences: S11_RECURRING_OCCURRENCES_COLUMNS,
  planned_events: S11_PLANNED_EVENTS_COLUMNS,
  holidays: S11_HOLIDAYS_COLUMNS,
  spendable_settings: S11_SPENDABLE_SETTINGS_COLUMNS,
  budgets: S11_BUDGETS_COLUMNS,
  budget_movements: S11_BUDGET_MOVEMENTS_COLUMNS,
  budget_allocation_rules: S11_BUDGET_ALLOCATION_RULES_COLUMNS,
};

/** Row object keyed by column name; T06 supplies raw domain values without CSV formatting. */
export type S11Row<Columns extends readonly string[]> = {
  [Column in Columns[number]]: unknown;
};

/** Dataset definition pairing a stable id with its ordered column list. */
export interface S11DatasetDefinition<Columns extends readonly string[]> {
  readonly id: S11DatasetId;
  readonly columns: Columns;
}

/** Extracts one export row per persisted record without applying CSV formatting. */
export interface S11ColumnExtractor<
  Columns extends readonly string[],
  Source = unknown,
> {
  readonly columns: Columns;
  extract(source: Source): S11Row<Columns>;
}

export function defineS11Dataset<const Columns extends readonly string[]>(
  id: S11DatasetId,
  columns: Columns,
): S11DatasetDefinition<Columns> {
  return { id, columns };
}
