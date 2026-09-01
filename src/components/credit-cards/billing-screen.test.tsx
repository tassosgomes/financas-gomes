import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import {
  CreditCardBillingScreen,
  CreditCardGlobalPaymentForm,
} from "./billing-screen";
import type {
  AccountOptionViewModel,
  CreditCardPaymentStatusViewModel,
  CreditCardProjectionSummaryViewModel,
  CreditCardStatementViewModel,
} from "./ui-contracts";

const cardId = "0194a6d4-7b2e-7d1a-8c2f-123456789abc";
const purchaseId = "0194a6d4-7b2e-7d1a-8c2f-123456789abd";
const installmentId = "0194a6d4-7b2e-7d1a-8c2f-123456789abe";
const sourceAccountId = "0194a6d4-7b2e-7d1a-8c2f-123456789abf";

const currentStatement: CreditCardStatementViewModel = {
  period: "2026-08",
  kind: "CURRENT",
  dueOn: "2026-08-20",
  totalAmountCents: "3334",
  items: [
    {
      referenceId: installmentId,
      purchaseId,
      installmentId,
      description: "Compra sintética",
      amountCents: "3334",
      occurredOn: "2026-08-09",
      billingCycle: "2026-08",
      dueOn: "2026-08-20",
      installmentNumber: 1,
      installmentCount: 3,
      state: "CONFIRMED",
    },
  ],
};

const futureStatement: CreditCardStatementViewModel = {
  ...currentStatement,
  period: "2026-09",
  kind: "FUTURE",
  dueOn: "2026-09-20",
};

const summary: CreditCardProjectionSummaryViewModel = {
  currentStatementAmountCents: "3334",
  projectedStatementAmountCents: "6666",
  outstandingCardObligationCents: "10000",
  committedCreditLimitCents: "10000",
  availableCreditLimitCents: "90000",
  cardCreditBalanceCents: "0",
  asOf: "2026-08-31",
};

const paymentStatus: CreditCardPaymentStatusViewModel = {
  state: "PARTIALLY_PAID",
  statementAmountCents: "10000",
  paidAmountCents: "3334",
  remainingAmountCents: "6666",
  creditAmountCents: "0",
};

const accounts: AccountOptionViewModel[] = [
  { id: sourceAccountId, name: "Conta corrente", status: "ACTIVE", type: "CHECKING" },
  { id: "0194a6d4-7b2e-7d1a-8c2f-123456789ab0", name: "Cartão conta", status: "ACTIVE", type: "CREDIT_CARD" },
  { id: "0194a6d4-7b2e-7d1a-8c2f-123456789ab1", name: "Conta arquivada", status: "ARCHIVED", type: "CHECKING" },
];

describe("CreditCardBillingScreen", () => {
  it("composes server projections, future period links and the global payment form", () => {
    const html = renderToStaticMarkup(
      <CreditCardBillingScreen
        accounts={accounts}
        cardId={cardId}
        cardName="Cartão principal"
        cardStatus="ACTIVE"
        currentStatement={currentStatement}
        defaultSourceAccountId={sourceAccountId}
        futureStatements={[futureStatement]}
        paymentStatus={paymentStatus}
        projectionSummary={summary}
      />,
    );

    expect(html).toContain("Fatura atual e competências futuras");
    expect(html).toContain("Obrigação contratual");
    expect(html).toContain("Limite disponível");
    expect(html).toContain("Saldo credor");
    expect(html).toContain("Consultar 2026-09");
    expect(html).toContain(`/credit-cards/${cardId}?cycle=2026-09`);
    expect(html).toContain("Conta de origem");
    expect(html).toContain("Confirmar pagamento global");
    expect(html).toContain("Pagamento global");
    expect(html).not.toContain("Pagar parcela");
    expect(html).not.toContain("statementId");
    expect(html).not.toContain("installmentId");
    expect(html).not.toContain("householdId");
  });

  it("keeps payment source choices tenant-safe and exposes archived/loading/empty states", () => {
    const form = renderToStaticMarkup(
      <CreditCardGlobalPaymentForm
        accounts={accounts}
        cardId={cardId}
        cardName="Cartão principal"
        cardStatus="ACTIVE"
        defaultSourceAccountId={sourceAccountId}
      />,
    );
    expect(form).toContain("Conta corrente");
    expect(form).not.toContain("Cartão conta");
    expect(form).not.toContain("Conta arquivada");
    expect(form).toContain('value="0194a6d4-7b2e-7d1a-8c2f-123456789abf"');

    const loading = renderToStaticMarkup(
      <CreditCardGlobalPaymentForm
        accounts={accounts}
        accountsState="loading"
        cardId={cardId}
        cardName="Cartão principal"
        cardStatus="ACTIVE"
      />,
    );
    expect(loading).toContain("Carregando contas de origem");
    expect(loading).toContain('role="status"');

    const empty = renderToStaticMarkup(
      <CreditCardGlobalPaymentForm
        accounts={[]}
        cardId={cardId}
        cardName="Cartão principal"
        cardStatus="ACTIVE"
      />,
    );
    expect(empty).toContain("Nenhuma conta de origem disponível");
    expect(empty).toContain("Cadastrar conta");

    const archived = renderToStaticMarkup(
      <CreditCardGlobalPaymentForm
        accounts={accounts}
        cardId={cardId}
        cardName="Cartão arquivado"
        cardStatus="ARCHIVED"
      />,
    );
    expect(archived).toContain("Cartão arquivado");
    expect(archived).not.toContain("Confirmar pagamento global");
  });

  it("maps unexpected read failures to an actionable safe state", () => {
    const html = renderToStaticMarkup(
      <CreditCardBillingScreen
        accounts={accounts}
        cardId={cardId}
        cardName="Cartão principal"
        cardStatus="ACTIVE"
        projectionError={{ code: "CONFLICT", message: "SELECT secret; stack" }}
        projectionState="error"
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Os dados mudaram");
    expect(html).not.toContain("SELECT secret");
    expect(html).not.toContain("stack");
  });
});
