import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/app/actions/transactions", () => ({
  cancelManualTransactionAction: vi.fn(),
  updateManualTransactionAction: vi.fn(),
}));

import type { AccountBalanceReadModel } from "@/modules/transactions/contracts";
import type {
  AccountReadModel,
  CategoryReadModel,
} from "@/modules/accounts-categories/contracts";
import type { ManualTransactionDetailReadModel } from "@/modules/transactions/contracts";

import { TransactionDetailScreen } from "./transaction-detail-screen";

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

const transaction: ManualTransactionDetailReadModel = {
  id: "00000000-0000-7000-8000-000000061301",
  householdId: account.householdId,
  kind: "EXPENSE",
  status: "POSTED",
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

const balance: AccountBalanceReadModel = {
  accountId: account.id,
  householdId: account.householdId,
  asOf: transaction.occurredOn,
  balanceCents: "-1250",
};

const accountOptions = [
  {
    id: account.id,
    name: account.name,
    status: account.status,
    trackingStartedOn: account.trackingStartedOn,
  },
];
const categoryOptions = [
  {
    id: category.id,
    name: category.name,
    kind: category.kind,
    status: category.status,
  },
];

function renderDetail(value: ManualTransactionDetailReadModel) {
  return renderToStaticMarkup(
    <TransactionDetailScreen
      accounts={accountOptions}
      backHref="/transactions?kind=EXPENSE"
      categories={categoryOptions}
      initialBalance={balance}
      initialTransaction={value}
    />,
  );
}

describe("TransactionDetailScreen", () => {
  it("shows the economic event, signed entry, balance, edit form and explicit cancellation", () => {
    const html = renderDetail(transaction);

    expect(html).toContain("Evento econômico");
    expect(html).toContain("R$ 12,50");
    expect(html).toContain("-R$ 12,50");
    expect(html).toContain("Saldo líquido derivado");
    expect(html).toContain("transaction-detail-edit-form");
    expect(html).toContain("transaction-cancel-open");
    expect(html).toContain("Cancele este lançamento");
    expect(html).not.toContain("Excluir");
    expect(html).not.toContain("Deletar");
  });

  it("keeps cancellation history visible and removes the second-cancel action", () => {
    const cancelled: ManualTransactionDetailReadModel = {
      ...transaction,
      status: "CANCELLED",
      reversal: {
        id: "00000000-0000-7000-8000-000000061303",
        amountCents: "1250",
        origin: "SYSTEM",
        status: "POSTED",
        occurredOn: transaction.occurredOn,
      },
    };
    const html = renderDetail(cancelled);

    expect(html).toContain("Efeito compensatório (reversal)");
    expect(html).toContain("O histórico e o efeito compensatório permanecem");
    expect(html).toContain("não pode ser cancelado novamente");
    expect(html).not.toContain("transaction-cancel-open");
    expect(html).not.toContain("transaction-detail-edit-form");
  });
});
