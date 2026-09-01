import { describe, expect, it } from "vitest";

import {
  filterActiveAccounts,
  filterActiveCategories,
  type TransactionAccountOption,
  type TransactionCategoryOption,
} from "./transaction-form";

const accounts: TransactionAccountOption[] = [
  { id: "active", name: "Conta ativa", status: "ACTIVE" },
  { id: "archived", name: "Conta arquivada", status: "ARCHIVED" },
];

const categories: TransactionCategoryOption[] = [
  { id: "expense-active", kind: "EXPENSE", name: "Moradia", status: "ACTIVE" },
  { id: "expense-archived", kind: "EXPENSE", name: "Antiga", status: "ARCHIVED" },
  { id: "income-active", kind: "INCOME", name: "Salário", status: "ACTIVE" },
];

describe("transaction form reference options", () => {
  it("does not expose archived accounts to a new transaction", () => {
    expect(filterActiveAccounts(accounts).map((account) => account.id)).toEqual([
      "active",
    ]);
  });

  it("filters categories by kind and excludes archived records", () => {
    expect(filterActiveCategories(categories, "EXPENSE").map((category) => category.id)).toEqual([
      "expense-active",
    ]);
    expect(filterActiveCategories(categories, "INCOME").map((category) => category.id)).toEqual([
      "income-active",
    ]);
  });
});

