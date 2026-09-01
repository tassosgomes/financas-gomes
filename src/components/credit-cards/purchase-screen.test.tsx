import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CreditCardPurchaseReadModel } from "@/modules/credit-cards/contracts";

import { CreditCardPurchaseScreen } from "./purchase-screen";
import { purchaseScheduleViewModel } from "./purchase-schedule-view-model";

const cardId = "0194a6d4-7b2e-7d1a-8c2f-123456789abc";
const purchaseId = "0194a6d4-7b2e-7d1a-8c2f-123456789abd";

const purchase = {
  id: purchaseId,
  householdId: "0194a6d4-7b2e-7d1a-8c2f-abcdefabcdef",
  cardId,
  financialEventId: "0194a6d4-7b2e-7d1a-8c2f-abcdef123456",
  installmentPlanId: "0194a6d4-7b2e-7d1a-8c2f-abcdef123457",
  amountCents: "10000",
  occurredOn: "2026-08-20",
  description: "Compra de teste",
  categoryId: null,
  installmentCount: 3,
  installments: [],
  schedule: {
    id: "0194a6d4-7b2e-7d1a-8c2f-abcdef123457",
    planId: "0194a6d4-7b2e-7d1a-8c2f-abcdef123457",
    purchaseId,
    totalAmountCents: "10000",
    installmentCount: 3,
    status: "ACTIVE" as const,
    installments: [
      {
        id: "0194a6d4-7b2e-7d1a-8c2f-abcdef123458",
        planId: "0194a6d4-7b2e-7d1a-8c2f-abcdef123457",
        purchaseId,
        sequence: 1,
        amountCents: "3334",
        status: "PLANNED" as const,
        billingRuleId: "0194a6d4-7b2e-7d1a-8c2f-abcdef123459",
        billingCycle: "2026-08",
        cycle: "2026-08",
        competence: "2026-08",
        billingClosingDay: 10,
        billingDueDay: 17,
        billingClosingOn: "2026-08-10",
        billingDueOn: "2026-08-17",
        billingDueOnOverride: null,
        billingSnapshot: {
          billingRuleId: "0194a6d4-7b2e-7d1a-8c2f-abcdef123459",
          billingCycle: "2026-08",
          cycle: "2026-08",
          competence: "2026-08",
          closingOn: "2026-08-10",
          dueOn: "2026-08-17",
          closingDay: 10,
          dueDay: 17,
          billingDueOnOverride: null,
          dueDateSource: "RULE" as const,
        },
        entryId: "0194a6d4-7b2e-7d1a-8c2f-abcdef123460",
        entryStatus: "EXPECTED" as const,
      },
      {
        id: "0194a6d4-7b2e-7d1a-8c2f-abcdef123461",
        planId: "0194a6d4-7b2e-7d1a-8c2f-abcdef123457",
        purchaseId,
        sequence: 2,
        amountCents: "3333",
        status: "PLANNED" as const,
        billingRuleId: "0194a6d4-7b2e-7d1a-8c2f-abcdef123459",
        billingCycle: "2026-09",
        cycle: "2026-09",
        competence: "2026-09",
        billingClosingDay: 10,
        billingDueDay: 17,
        billingClosingOn: "2026-09-10",
        billingDueOn: "2026-09-17",
        billingDueOnOverride: null,
        billingSnapshot: {
          billingRuleId: "0194a6d4-7b2e-7d1a-8c2f-abcdef123459",
          billingCycle: "2026-09",
          cycle: "2026-09",
          competence: "2026-09",
          closingOn: "2026-09-10",
          dueOn: "2026-09-17",
          closingDay: 10,
          dueDay: 17,
          billingDueOnOverride: null,
          dueDateSource: "RULE" as const,
        },
        entryId: "0194a6d4-7b2e-7d1a-8c2f-abcdef123462",
        entryStatus: "EXPECTED" as const,
      },
    ],
  },
} as unknown as CreditCardPurchaseReadModel;

describe("CreditCardPurchaseScreen", () => {
  it("copies server schedule values without recalculating the total", () => {
    const thirdInstallment = {
      ...purchase.schedule.installments[1],
      id: "0194a6d4-7b2e-7d1a-8c2f-abcdef123464",
      sequence: 3,
      amountCents: "3333",
      billingCycle: "2026-10",
      cycle: "2026-10",
      competence: "2026-10",
      billingClosingOn: "2026-10-10",
      billingDueOn: "2026-10-17",
    };
    const schedule = purchaseScheduleViewModel({
      ...purchase,
      schedule: {
        ...purchase.schedule,
        installments: [...purchase.schedule.installments, thirdInstallment],
      },
    });

    expect(schedule.totalAmountCents).toBe("10000");
    expect(schedule.installmentCount).toBe(3);
    expect(schedule.items).toHaveLength(3);
    expect(schedule.items[0]?.amountCents).toBe("3334");
    expect(schedule.items[1]?.billingCycle).toBe("2026-09");
    expect(schedule.items[2]?.amountCents).toBe("3333");
    expect(schedule.items.reduce((total, item) => total + BigInt(item.amountCents), BigInt(0))).toBe(BigInt(schedule.totalAmountCents));
    expect(JSON.stringify(schedule)).not.toContain("householdId");
  });

  it("renders total/parcel wording, active-card selection and no isolated installment action", () => {
    const html = renderToStaticMarkup(
      <CreditCardPurchaseScreen
        cards={[{ id: cardId, name: "Cartão ativo", status: "ACTIVE" }]}
        categories={[
          { id: "0194a6d4-7b2e-7d1a-8c2f-abcdef123463", name: "Casa", status: "ACTIVE", kind: "EXPENSE" },
        ]}
      />,
    );

    expect(html).toContain("Valor total da compra");
    expect(html).toContain("1 para uma compra à vista");
    expect(html).toContain("A quantidade de parcelas");
    expect(html).toContain("Somente cartões ativos aceitam novas compras");
    expect(html).not.toContain("Pagar parcela");
    expect(html).not.toContain("Editar parcela");
  });
});
