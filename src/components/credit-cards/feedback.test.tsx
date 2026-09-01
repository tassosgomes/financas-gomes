import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CreditCardActionFeedback,
  CreditCardConfirmation,
  CreditCardFieldError,
} from "./feedback";
import { CreditCardDateField, CreditCardMoneyField } from "./form-fields";

describe("S06 shared feedback and field boundaries", () => {
  it("associates allow-listed field errors and removes raw exception text", () => {
    const html = renderToStaticMarkup(
      <>
        <CreditCardFieldError
          error={{
            code: "INVALID_AMOUNT",
            field: "amountCents",
            message: "SQL amount=999999 stack trace",
          }}
          field="amountCents"
          fieldId="purchase-amount"
        />
        <CreditCardActionFeedback
          error={{
            code: "CONFLICT",
            message: "SELECT * FROM private_finance; stack trace",
          }}
          retryHref="/credit-cards"
        />
      </>,
    );

    expect(html).toContain('id="purchase-amount-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Informe um valor positivo");
    expect(html).toContain("Os dados mudaram");
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toContain("private_finance");
    expect(html).not.toContain("stack trace");
  });

  it("reuses S03 MoneyInput/DateInput with labels and described errors", () => {
    const html = renderToStaticMarkup(
      <>
        <CreditCardMoneyField
          description="Valor total em centavos."
          error="Informe um valor positivo."
          id="purchase-amount"
          label="Valor total"
        />
        <CreditCardDateField
          description="Data civil da compra."
          error="Informe uma data válida."
          id="purchase-date"
          label="Data"
        />
      </>,
    );

    expect(html).toContain('data-money-boundary="amountCents"');
    expect(html).toContain('data-date-boundary="YYYY-MM-DD"');
    expect(html).toContain('for="purchase-amount"');
    expect(html).toContain('aria-describedby="purchase-amount-description purchase-amount-error"');
    expect(html).toContain('aria-describedby="purchase-date-description purchase-date-error"');
    expect(html).toContain('id="purchase-date-error"');
    expect(html).toContain('id="purchase-amount"');
    expect(html).toContain('autofocus');
  });

  it("exposes explicit confirmation semantics for aggregate actions", () => {
    const html = renderToStaticMarkup(
      <CreditCardConfirmation
        description="Todas as parcelas futuras serão canceladas; o histórico será preservado."
        onConfirm={() => undefined}
        onOpenChange={() => undefined}
        open
        testId="cancel-purchase-confirmation"
        title="Cancelar compra inteira?"
      />,
    );

    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="cancel-purchase-confirmation-title"');
    expect(html).toContain("Cancelar compra inteira?");
    expect(html).toContain("Todas as parcelas futuras");
    expect(html).toContain("Confirmar");
  });
});
