import type {
  AllocationBudgetReferenceInput,
  AllocationCategoryInput,
  AllocationRuleInput,
  BudgetFinancialSourceInput,
} from "./allocation-rules";

export const ALLOCATION_FIXTURE_CATEGORIES: readonly AllocationCategoryInput[] = Object.freeze([
  Object.freeze({ id: "category-expenses", kind: "EXPENSE", status: "ACTIVE" }),
  Object.freeze({
    id: "category-food",
    parentId: "category-expenses",
    kind: "EXPENSE",
    status: "ACTIVE",
  }),
  Object.freeze({
    id: "category-archived",
    kind: "EXPENSE",
    status: "ARCHIVED",
    archivedOn: "2026-09-01",
  }),
]);

export const ALLOCATION_FIXTURE_BUDGETS: readonly AllocationBudgetReferenceInput[] = Object.freeze([
  Object.freeze({
    boxReferenceId: "box-general",
    categoryId: "category-expenses",
    activeFrom: "2026-01-01",
  }),
  Object.freeze({
    boxReferenceId: "box-food",
    categoryId: "category-food",
    activeFrom: "2026-08-01",
    closedOn: "2026-09-10",
    status: "CLOSED",
  }),
  Object.freeze({
    boxReferenceId: "box-archived-category",
    categoryId: "category-archived",
    activeFrom: "2026-01-01",
    categoryStatus: "ARCHIVED",
    categoryArchivedOn: "2026-09-01",
  }),
]);

export const ALLOCATION_FIXTURE_RULES: readonly AllocationRuleInput[] = Object.freeze([
  Object.freeze({
    ruleReferenceId: "rule-general-old",
    boxReferenceId: "box-general",
    amountCents: "50",
    effectiveFrom: "2026-01-01",
    effectiveUntil: "2026-07-01",
  }),
  Object.freeze({
    ruleReferenceId: "rule-general-current",
    boxReferenceId: "box-general",
    amountCents: "60",
    effectiveFrom: "2026-07-01",
  }),
  Object.freeze({
    ruleReferenceId: "rule-food",
    boxReferenceId: "box-food",
    amountCents: "20",
    effectiveFrom: "2026-01-01",
  }),
  Object.freeze({
    ruleReferenceId: "rule-zero",
    boxReferenceId: "box-zero",
    amountCents: "0",
    effectiveFrom: "2026-01-01",
  }),
]);

export const ALLOCATION_FIXTURE_INCOME = Object.freeze({
  referenceId: "income-overtime-2026-08-31",
  kind: "INCOME",
  status: "POSTED",
  amountCents: "1150000",
  occurredOn: "2026-08-31",
});

export const ALLOCATION_FIXTURE_FINANCIAL_SOURCES: readonly BudgetFinancialSourceInput[] = Object.freeze([
  Object.freeze({
    kind: "PURCHASE",
    referenceId: "purchase-600000",
    purchaseId: "purchase-600000",
    categoryId: "category-food",
    amountCents: "600000",
    occurredOn: "2026-08-29",
    status: "POSTED",
  }),
  Object.freeze({
    kind: "INSTALLMENT",
    referenceId: "installment-1",
    categoryId: "category-food",
    amountCents: "60000",
    occurredOn: "2026-09-01",
    status: "EXPECTED",
  }),
  Object.freeze({
    kind: "INSTALLMENT",
    referenceId: "installment-2",
    categoryId: "category-food",
    amountCents: "60000",
    occurredOn: "2026-10-01",
    status: "EXPECTED",
  }),
  Object.freeze({
    kind: "CARD_PAYMENT",
    referenceId: "card-payment-600000",
    amountCents: "600000",
    occurredOn: "2026-09-05",
    status: "POSTED",
  }),
  Object.freeze({
    kind: "REFUND",
    referenceId: "refund-100000",
    originalReferenceId: "purchase-600000",
    amountCents: "100000",
    effectiveOn: "2026-09-05",
    status: "POSTED",
  }),
]);

export const ALLOCATION_FIXTURE_EXPECTED_DISTRIBUTION = Object.freeze({
  incomeCents: BigInt("1150000"),
  amounts: Object.freeze([
    BigInt("862500"),
    BigInt("287500"),
  ]),
});

export const ALLOCATION_FIXTURE_GOAL = Object.freeze({
  targetAmountCents: "10000",
  targetDate: "2026-10-31",
});
