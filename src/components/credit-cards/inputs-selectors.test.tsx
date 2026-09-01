import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BillingDayInput, InstallmentCountInput } from "./billing-inputs";
import {
  CreditCardAccountSelector,
  CreditCardSelector,
} from "./selectors";

const activeId = "018f47b7-6c3a-7abc-8def-1234567890ab";
const archivedId = "018f47b7-6c3a-7abc-8def-1234567890ac";

describe("S06 reusable input and selector islands", () => {
  it("associates billing fields with labels/errors and requests focus on error", () => {
    const html = renderToStaticMarkup(
      <>
        <BillingDayInput
          error="Informe um dia entre 1 e 31."
          id="closing-day"
          label="Fechamento"
        />
        <InstallmentCountInput
          description="Escolha a quantidade total."
          id="installment-count"
          label="Parcelas"
        />
      </>,
    );

    expect(html).toContain('for="closing-day"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(
      'aria-describedby="closing-day-description closing-day-error"',
    );
    expect(html).toContain('id="closing-day-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("autofocus");
    expect(html).toContain('for="installment-count"');
    expect(html).toContain('aria-describedby="installment-count-description"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="120"');
  });

  it("offers only active cards and active non-card payment accounts", () => {
    const html = renderToStaticMarkup(
      <>
        <CreditCardSelector
          cards={[
            { id: activeId, name: "Cartão ativo", status: "ACTIVE" },
            { id: archivedId, name: "Cartão arquivado", status: "ARCHIVED" },
          ]}
          error="Selecione um cartão válido."
        />
        <CreditCardAccountSelector
          accounts={[
            { id: activeId, name: "Conta corrente", status: "ACTIVE", type: "CHECKING" },
            { id: archivedId, name: "Conta arquivada", status: "ARCHIVED", type: "CHECKING" },
            { id: "018f47b7-6c3a-7abc-8def-1234567890ad", name: "Outro cartão", status: "ACTIVE", type: "CREDIT_CARD" },
          ]}
        />
      </>,
    );

    expect(html).toContain("Cartão ativo");
    expect(html).not.toContain("Cartão arquivado");
    expect(html).toContain("Conta corrente");
    expect(html).not.toContain("Conta arquivada");
    expect(html).not.toContain("Outro cartão");
    expect(html).toContain("credit-card-selector-error");
    expect(html).toContain('aria-describedby="credit-card-selector-description credit-card-selector-error"');
  });

  it("renders an actionable empty state when there are no selectable resources", () => {
    const html = renderToStaticMarkup(
      <CreditCardSelector cards={[]} testId="empty-card-selector" />,
    );

    expect(html).toContain("Cadastre um cartão ativo antes de continuar.");
    expect(html).toContain('data-testid="empty-card-selector-empty"');
    expect(html).toContain("disabled");
    expect(html).toContain('aria-describedby="empty-card-selector-description"');
  });
});
