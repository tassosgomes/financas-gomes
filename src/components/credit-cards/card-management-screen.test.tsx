import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CreditCardCollectionScreen } from "./card-management-screen";

const card = {
  id: "0194a6d4-7b2e-7d1a-8c2f-123456789abc",
  householdId: "0194a6d4-7b2e-7d1a-8c2f-abcdefabcdef",
  accountId: "0194a6d4-7b2e-7d1a-8c2f-abcdef123456",
  name: "Cartão principal",
  type: "CREDIT_CARD" as const,
  status: "ACTIVE" as const,
  creditLimitCents: "150000",
  defaultPaymentAccountId: null,
  activeBillingRule: {
    id: "0194a6d4-7b2e-7d1a-8c2f-111111111111",
    cardId: "0194a6d4-7b2e-7d1a-8c2f-123456789abc",
    closingDay: 10,
    dueDay: 17,
    effectiveFrom: "2025-01-01",
    effectiveUntil: null,
  },
  billingRules: [],
};

describe("CreditCardCollectionScreen", () => {
  it("renders a contractual limit and an accessible detail link", () => {
    const html = renderToStaticMarkup(<CreditCardCollectionScreen initialCards={[card]} />);

    expect(html).toContain("Cartão principal");
    expect(html).toContain("Limite contratual");
    expect(html).toContain("R$ 1.500,00");
    expect(html).toContain("/credit-cards/0194a6d4-7b2e-7d1a-8c2f-123456789abc");
    expect(html).toContain("Ver arquivados");
  });

  it("renders the empty state without inventing a card or a tenant id", () => {
    const html = renderToStaticMarkup(<CreditCardCollectionScreen initialCards={[]} />);

    expect(html).toContain("Nenhum cartão cadastrado");
    expect(html).toContain("Cadastrar primeiro cartão");
    expect(html).not.toContain("householdId");
  });
});
