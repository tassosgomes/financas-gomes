// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

const actions = vi.hoisted(() => ({
  cancel: vi.fn(),
  update: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

vi.mock("@/app/actions/credit-card-purchases", () => ({
  cancelCreditCardPurchaseAction: actions.cancel,
  updateCreditCardPurchaseAction: actions.update,
}));

import type { CreditCardPurchaseReadModel } from "@/modules/credit-cards/contracts";

import {
  CreditCardPurchaseDetailScreen,
} from "./purchase-detail-screen";
import type { CreditCardPurchaseDetailViewModel } from "./ui-contracts";

afterEach(() => {
  cleanup();
  actions.cancel.mockReset();
  actions.update.mockReset();
  navigation.refresh.mockReset();
});

const cardId = "0194a6d4-7b2e-7d1a-8c2f-123456789abc";
const purchaseId = "0194a6d4-7b2e-7d1a-8c2f-123456789abd";
const categoryId = "0194a6d4-7b2e-7d1a-8c2f-123456789abe";
const installmentId = "0194a6d4-7b2e-7d1a-8c2f-123456789abf";

const scheduleItem = {
  id: installmentId,
  purchaseId,
  installmentNumber: 1,
  installmentCount: 2,
  amountCents: "5000",
  billingCycle: "2026-08",
  dueOn: "2026-08-20",
  status: "PLANNED" as const,
  state: "PROJECTED" as const,
};

const purchase: CreditCardPurchaseDetailViewModel = {
  id: purchaseId,
  cardId,
  amountCents: "10000",
  occurredOn: "2026-08-10",
  description: "Compra sintética",
  categoryId,
  installmentCount: 2,
  status: "ACTIVE",
  schedule: {
    purchaseId,
    totalAmountCents: "10000",
    installmentCount: 2,
    items: [scheduleItem],
  },
};

const categories = [
  {
    id: categoryId,
    name: "Casa",
    status: "ACTIVE" as const,
    kind: "EXPENSE" as const,
  },
  {
    id: "0194a6d4-7b2e-7d1a-8c2f-123456789ab0",
    name: "Receita não permitida",
    status: "ACTIVE" as const,
    kind: "INCOME" as const,
  },
];

function readModel(
  overrides: Partial<CreditCardPurchaseDetailViewModel> = {},
): CreditCardPurchaseReadModel {
  const detail = { ...purchase, ...overrides };
  return {
    id: detail.id,
    householdId: "0194a6d4-7b2e-7d1a-8c2f-123456789ac0",
    cardId: detail.cardId,
    financialEventId: "0194a6d4-7b2e-7d1a-8c2f-123456789ac1",
    installmentPlanId: "0194a6d4-7b2e-7d1a-8c2f-123456789ac2",
    amountCents: detail.amountCents,
    occurredOn: detail.occurredOn,
    description: detail.description,
    categoryId: detail.categoryId,
    installmentCount: detail.installmentCount,
    status: detail.status,
    installments: [],
    schedule: {
      id: "0194a6d4-7b2e-7d1a-8c2f-123456789ac2",
      planId: "0194a6d4-7b2e-7d1a-8c2f-123456789ac2",
      purchaseId: detail.id,
      totalAmountCents: detail.schedule.totalAmountCents,
      installmentCount: detail.schedule.installmentCount,
      status: detail.status,
      installments: detail.schedule.items.map((item) => ({
        id: item.id,
        planId: "0194a6d4-7b2e-7d1a-8c2f-123456789ac2",
        purchaseId: item.purchaseId,
        sequence: item.installmentNumber,
        amountCents: item.amountCents,
        status: item.status,
        billingRuleId: "0194a6d4-7b2e-7d1a-8c2f-123456789ac3",
        billingCycle: item.billingCycle,
        cycle: item.billingCycle,
        competence: item.billingCycle,
        billingClosingDay: 10,
        billingDueDay: 20,
        billingClosingOn: "2026-08-10",
        billingDueOn: item.dueOn,
        billingDueOnOverride: null,
        billingSnapshot: {
          billingRuleId: "0194a6d4-7b2e-7d1a-8c2f-123456789ac3",
          billingCycle: item.billingCycle,
          cycle: item.billingCycle,
          competence: item.billingCycle,
          closingOn: "2026-08-10",
          dueOn: item.dueOn,
          closingDay: 10,
          dueDay: 20,
          billingDueOnOverride: null,
          dueDateSource: "RULE" as const,
        },
        entryId: "0194a6d4-7b2e-7d1a-8c2f-123456789ac4",
        entryStatus: item.state === "CONFIRMED" ? ("POSTED" as const) : ("EXPECTED" as const),
      })),
    },
  };
}

function renderDetail(
  overrides: Partial<CreditCardPurchaseDetailViewModel> = {},
  props: Partial<React.ComponentProps<typeof CreditCardPurchaseDetailScreen>> = {},
) {
  return render(
    <CreditCardPurchaseDetailScreen
      backHref={`/credit-cards/${cardId}`}
      cardName="Cartão sintético"
      categories={categories}
      purchase={{ ...purchase, ...overrides }}
      testId="purchase-detail"
      {...props}
    />,
  );
}

describe("CreditCardPurchaseDetailScreen", () => {
  it("renders immutable financial facts, editable metadata and aggregate-only actions", () => {
    const html = renderToStaticMarkup(
      <CreditCardPurchaseDetailScreen
        backHref={`/credit-cards/${cardId}`}
        cardName="Cartão sintético"
        categories={categories}
        purchase={purchase}
        testId="purchase-detail-static"
      />,
    );

    expect(html).toContain("Resumo da compra");
    expect(html).toContain("R$ 100,00");
    expect(html).toContain("Data da compra");
    expect(html).toContain("Editar metadata");
    expect(html).toContain("Salvar metadata");
    expect(html).toContain("Cancelar compra inteira");
    expect(html).toContain("Resumo do parcelamento");
    expect(html).toContain("aria-labelledby=\"purchase-detail-static-title\"");
    expect(html).not.toContain("Pagar parcela");
    expect(html).not.toContain("Cancelar parcela");
    expect(html).not.toContain("statementId");
    expect(html).not.toContain("householdId");
  });

  it("submits only description/category metadata and refreshes after success", async () => {
    actions.update.mockResolvedValue({ ok: true, value: readModel({ description: "Descrição editada" }) });

    renderDetail();
    fireEvent.change(screen.getByLabelText("Descrição"), {
      target: { value: "Descrição editada" },
    });
    fireEvent.submit(screen.getByTestId("purchase-detail-metadata").querySelector("form")!);

    await waitFor(() => expect(actions.update).toHaveBeenCalledOnce());
    const command = actions.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(command).toMatchObject({
      purchaseId,
      description: "Descrição editada",
      categoryId,
    });
    expect(command).not.toHaveProperty("amountCents");
    expect(command).not.toHaveProperty("occurredOn");
    expect(command).not.toHaveProperty("installmentId");
    expect(command).not.toHaveProperty("householdId");
    expect(command.commandId).toEqual(expect.any(String));
    await waitFor(() => {
      expect(screen.getByTestId("purchase-detail-feedback").textContent).toContain(
        "Dados da compra atualizados",
      );
    });
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("requires strong confirmation before cancelling the whole purchase", async () => {
    actions.cancel.mockResolvedValue({ ok: true, value: readModel({ status: "CANCELLED" }) });

    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar compra inteira" }));

    const confirmation = screen.getByTestId("purchase-detail-cancel-confirmation");
    expect(confirmation.getAttribute("role")).toBe("alertdialog");
    expect(confirmation.textContent).toContain("Todas as parcelas futuras");
    expect(confirmation.textContent).toContain("hard delete");

    fireEvent.click(
      screen.getByTestId("purchase-detail-cancel-confirmation").querySelector(
        "button:last-child",
      )!,
    );
    await waitFor(() => expect(actions.cancel).toHaveBeenCalledOnce());
    const command = actions.cancel.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(command).toMatchObject({ purchaseId });
    expect(command).not.toHaveProperty("installmentId");
    expect(command).not.toHaveProperty("statementId");
    await waitFor(() => expect(screen.getByText("Cancelada")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Cancelar compra inteira" })).toBeNull();
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("covers cancellation/loading/empty/error states without exposing raw failures", () => {
    const cancelled = renderToStaticMarkup(
      <CreditCardPurchaseDetailScreen
        backHref={`/credit-cards/${cardId}`}
        cardName="Cartão sintético"
        categories={categories}
        purchase={{ ...purchase, status: "CANCELLED" }}
        testId="purchase-detail-cancelled"
      />,
    );
    expect(cancelled).toContain("Esta compra já está cancelada");
    expect(cancelled).not.toContain("Salvar metadata");
    expect(cancelled).not.toMatch(/<button[^>]*>Cancelar compra inteira<\/button>/u);

    const loading = renderToStaticMarkup(
      <CreditCardPurchaseDetailScreen
        backHref={`/credit-cards/${cardId}`}
        cardName="Cartão sintético"
        categories={[]}
        categoriesState="loading"
        purchase={purchase}
        testId="purchase-detail-loading"
      />,
    );
    expect(loading).toContain("Carregando categorias");
    expect(loading).toContain('role="status"');

    const empty = renderToStaticMarkup(
      <CreditCardPurchaseDetailScreen
        backHref={`/credit-cards/${cardId}`}
        cardName="Cartão sintético"
        categories={[]}
        categoriesState="empty"
        purchase={{ ...purchase, categoryId: null }}
        testId="purchase-detail-empty"
      />,
    );
    expect(empty).toContain("Nenhuma categoria de despesa ativa");

    const error = renderToStaticMarkup(
      <CreditCardPurchaseDetailScreen
        backHref={`/credit-cards/${cardId}`}
        cardName="Cartão sintético"
        categories={[]}
        categoriesError={{ code: "CONFLICT", message: "SELECT secret; stack" }}
        categoriesState="error"
        purchase={purchase}
        testId="purchase-detail-error"
      />,
    );
    expect(error).toContain("Os dados mudaram");
    expect(error).not.toContain("SELECT secret");
    expect(error).not.toContain("stack");
  });
});
