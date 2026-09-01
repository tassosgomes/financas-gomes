import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CreditCardScheduleViewModel } from "./ui-contracts";
import { CreditCardScheduleSummary } from "./schedule-summary";

const schedule: CreditCardScheduleViewModel = {
  purchaseId: "018f47b7-6c3a-7abc-8def-1234567890ab",
  totalAmountCents: "10000",
  installmentCount: 3,
  items: [
    {
      id: "018f47b7-6c3a-7abc-8def-1234567890ac",
      purchaseId: "018f47b7-6c3a-7abc-8def-1234567890ab",
      installmentNumber: 1,
      installmentCount: 3,
      amountCents: "3334",
      billingCycle: "2026-08",
      dueOn: "2026-08-20",
      status: "PLANNED",
      state: "PROJECTED",
    },
    {
      id: "018f47b7-6c3a-7abc-8def-1234567890ad",
      purchaseId: "018f47b7-6c3a-7abc-8def-1234567890ab",
      installmentNumber: 2,
      installmentCount: 3,
      amountCents: "3333",
      billingCycle: "2026-09",
      dueOn: "2026-09-20",
      status: "PLANNED",
      state: "PROJECTED",
    },
  ],
};

describe("CreditCardScheduleSummary", () => {
  it("renders server schedule values with an accessible table and text labels", () => {
    const html = renderToStaticMarkup(
      <CreditCardScheduleSummary
        purchaseHref="/credit-cards/018f47b7-6c3a-7abc-8def-1234567890ab/purchases/018f47b7-6c3a-7abc-8def-1234567890ab"
        schedule={schedule}
        state="success"
        successMessage="Compra confirmada"
      />,
    );

    expect(html).toContain("Resumo do parcelamento");
    expect(html).toContain("Total da compra");
    expect(html).toContain("R$ 100,00");
    expect(html).toContain("R$ 33,34");
    expect(html).toContain("2026-08");
    expect(html).toContain("Parcela 1 de 3");
    expect(html).toContain('aria-label="Totais do parcelamento"');
    expect(html).toContain("Schedule calculado do parcelamento");
    expect(html).toContain("Compra confirmada");
    expect(html).toContain("Ver compra");
    expect(html).not.toContain("saldo do cartão");
  });

  it("uses explicit loading, empty and sanitized error feedback states", () => {
    const loading = renderToStaticMarkup(
      <CreditCardScheduleSummary state="loading" />,
    );
    const empty = renderToStaticMarkup(
      <CreditCardScheduleSummary state="empty" />,
    );
    const error = renderToStaticMarkup(
      <CreditCardScheduleSummary
        error={{
          code: "CONFLICT",
          field: "amountCents",
          message: "SELECT * FROM secret; stack trace",
        }}
        retryHref="/credit-cards"
        state="error"
      />,
    );

    expect(loading).toContain('role="status"');
    expect(loading).toContain("Carregando parcelamento");
    expect(empty).toContain("Nenhum parcelamento para exibir");
    expect(error).toContain('role="alert"');
    expect(error).toContain("Os dados mudaram");
    expect(error).not.toContain("SELECT * FROM secret");
    expect(error).not.toContain("stack trace");
  });

  it("keeps the read model JSON-serializable without recalculating it", () => {
    expect(() => JSON.stringify(schedule)).not.toThrow();
    expect(schedule.items).toHaveLength(2);
    expect(schedule.totalAmountCents).toBe("10000");
    expect(schedule.items[0]?.amountCents).toBe("3334");
  });
});
