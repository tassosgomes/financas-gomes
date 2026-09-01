import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  AccountReadModel,
  CategoryReadModel,
} from "@/modules/accounts-categories/contracts";
import type { ManualTransactionListItemReadModel } from "@/modules/transactions/contracts";

import { TransactionsListScreen } from "./transactions-list-screen";

const account: AccountReadModel = {
  id: "00000000-0000-7000-8000-000000061101",
  householdId: "00000000-0000-7000-8000-000000061001",
  name: "Conta principal",
  type: "CHECKING",
  status: "ACTIVE",
  spendability: "GENERAL",
  liquidity: "IMMEDIATE",
  includeInNetWorth: true,
  trackingStartedOn: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const category: CategoryReadModel = {
  id: "00000000-0000-7000-8000-000000061201",
  householdId: account.householdId,
  name: "Moradia",
  parentId: null,
  kind: "EXPENSE",
  status: "ACTIVE",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const transaction: ManualTransactionListItemReadModel = {
  id: "00000000-0000-7000-8000-000000061301",
  householdId: account.householdId,
  kind: "EXPENSE",
  status: "CANCELLED",
  origin: "MANUAL",
  amountCents: "1250",
  occurredOn: "2026-08-15",
  description: "Mercado",
  accountId: account.id,
  categoryId: category.id,
  entry: {
    id: "00000000-0000-7000-8000-000000061302",
    amountCents: "-1250",
    status: "POSTED",
    postedOn: "2026-08-15",
  },
  reversal: null,
  createdAt: "2026-08-15T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:00.000Z",
  account,
  category,
};

describe("TransactionsListScreen", () => {
  it("renders the fields, signed amount, status and filter-preserving detail link", () => {
    const html = renderToStaticMarkup(
      <TransactionsListScreen
        accounts={[account]}
        categories={[category]}
        initialTransactions={[transaction]}
        query={{ kind: "EXPENSE", status: "CANCELLED" }}
      />,
    );

    expect(html).toContain("Mercado");
    expect(html).toContain("15/08/2026");
    expect(html).toContain("Conta principal");
    expect(html).toContain("Moradia");
    expect(html).toContain("-R$ 12,50");
    expect(html).toContain("Cancelado");
    expect(html).toContain(
      "/transactions/00000000-0000-7000-8000-000000061301?kind=EXPENSE&amp;status=CANCELLED",
    );
    expect(html).toContain('data-testid="transactions-import-csv"');
    expect(html).toContain('href="/transactions/import"');
  });

  it("renders a guided empty state with both first-entry CTAs", () => {
    const html = renderToStaticMarkup(
      <TransactionsListScreen
        accounts={[account]}
        categories={[]}
        initialTransactions={[]}
        query={{ origin: "MANUAL" }}
      />,
    );

    expect(html).toContain("Ainda não há lançamentos");
    expect(html).toContain("transactions-empty-income-cta");
    expect(html).toContain("transactions-empty-expense-cta");
    expect(html).toContain("Nenhuma categoria cadastrada");
  });

  it("keeps no-account guidance separate from an empty collection", () => {
    const html = renderToStaticMarkup(
      <TransactionsListScreen
        accounts={[]}
        categories={[]}
        initialTransactions={[]}
        query={{ origin: "MANUAL" }}
      />,
    );

    expect(html).toContain("transactions-no-accounts");
    expect(html).toContain("Cadastre uma conta antes do primeiro lançamento");
    expect(html).toContain("transactions-no-categories");
  });
});
