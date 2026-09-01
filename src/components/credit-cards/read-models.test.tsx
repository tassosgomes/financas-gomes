import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CreditCardPaymentStatus,
  CreditCardProjectionSummary,
  CreditCardStatementSummary,
  CreditCardStatementsOverview,
} from "./read-models";
import {
  parseCreditCardPaymentStatus,
  parseCreditCardProjectionSummary,
  parseCreditCardStatement,
  type CreditCardPaymentStatusViewModel,
  type CreditCardProjectionSummaryViewModel,
  type CreditCardStatementViewModel,
} from "./ui-contracts";

const cardId = "018f47b7-6c3a-7abc-8def-1234567890ab";
const purchaseId = "018f47b7-6c3a-7abc-8def-1234567890ac";
const installmentId = "018f47b7-6c3a-7abc-8def-1234567890ad";

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

const projection: CreditCardProjectionSummaryViewModel = {
  currentStatementAmountCents: "3334",
  projectedStatementAmountCents: "6666",
  outstandingCardObligationCents: "10000",
  committedCreditLimitCents: "10000",
  availableCreditLimitCents: "90000",
  cardCreditBalanceCents: "0",
  asOf: "2026-08-31",
};

const payment: CreditCardPaymentStatusViewModel = {
  state: "PARTIALLY_PAID",
  statementAmountCents: "10000",
  paidAmountCents: "3334",
  remainingAmountCents: "6666",
  creditAmountCents: "0",
};

describe("S06 read-model contracts and components", () => {
  it("parses strict server projections without converting dates or cents", () => {
    expect(parseCreditCardStatement(currentStatement)).toEqual(currentStatement);
    expect(parseCreditCardProjectionSummary(projection)).toEqual(projection);
    expect(parseCreditCardPaymentStatus(payment)).toEqual(payment);
    expect(() =>
      parseCreditCardStatement({ ...currentStatement, amountCents: 3334 }),
    ).toThrow();
  });

  it("keeps current and future invoice labels explicit and links only opaque IDs", () => {
    const html = renderToStaticMarkup(
      <CreditCardStatementsOverview
        cardId={cardId}
        current={currentStatement}
        future={[futureStatement]}
      />,
    );

    expect(html).toContain("Fatura atual — 2026-08");
    expect(html).toContain("Fatura futura — 2026-09");
    expect(html).toContain("Total da fatura");
    expect(html).toContain("Valor da cobrança");
    expect(html).toContain("1/3");
    expect(html).toContain(
      `/credit-cards/${cardId}/purchases/${purchaseId}`,
    );
    expect(html).not.toContain("saldo do cartão");
  });

  it("renders the six distinct projection concepts from server values", () => {
    const html = renderToStaticMarkup(
      <CreditCardProjectionSummary summary={projection} />,
    );

    for (const label of [
      "Fatura atual",
      "Faturas futuras projetadas",
      "Obrigação contratual",
      "Limite comprometido",
      "Limite disponível",
      "Saldo credor",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("R$ 33,34");
    expect(html).toContain("2026-08-31");
    expect(html).toContain('aria-label="Projeções financeiras distintas do cartão"');
    expect(html).not.toContain("saldo do cartão");
  });

  it("states that payment is global and exposes accessible loading/error/empty states", () => {
    const html = renderToStaticMarkup(
      <CreditCardPaymentStatus status={payment} />,
    );
    expect(html).toContain("Pagamento global");
    expect(html).toContain("nenhuma parcela é paga isoladamente");
    expect(html).toContain("Parcialmente paga");

    const loading = renderToStaticMarkup(
      <CreditCardStatementSummary state="loading" />,
    );
    const empty = renderToStaticMarkup(
      <CreditCardProjectionSummary state="empty" />,
    );
    const error = renderToStaticMarkup(
      <CreditCardPaymentStatus
        error={{ code: "CONFLICT", message: "SELECT * FROM secret; stack" }}
        state="error"
      />,
    );

    expect(loading).toContain('role="status"');
    expect(empty).toContain("Nenhuma projeção para exibir");
    expect(error).toContain('role="alert"');
    expect(error).toContain("Os dados mudaram");
    expect(error).not.toContain("SELECT * FROM secret");
    expect(error).not.toContain("stack");
  });
});
