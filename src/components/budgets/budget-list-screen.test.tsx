/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BudgetBoundary, BudgetResult } from "@/modules/budgets/contracts";
import type { BudgetListItemReadModel } from "@/modules/budgets/read-contracts";

const mocks = vi.hoisted(() => ({
  closeBudgetAction: vi.fn(),
  createBudgetAction: vi.fn(),
  listBudgetsAction: vi.fn(),
  updateBudgetAction: vi.fn(),
}));

vi.mock("@/app/actions/budgets", () => mocks);

import { BudgetCollectionScreen } from "./budget-list-screen";

afterEach(cleanup);

const category = {
  referenceId: "category-leisure",
  name: "Lazer",
  parentReferenceId: null,
  kind: "EXPENSE" as const,
  status: "ACTIVE" as const,
};

function item(
  overrides: Partial<BudgetListItemReadModel> = {},
): BudgetListItemReadModel {
  return {
    referenceId: "budget-active",
    name: "Lazer",
    categoryId: category.referenceId,
    status: "ACTIVE",
    activeFrom: "2026-09-01",
    closedOn: null,
    goal: { targetAmountCents: "100000", targetDate: "2026-12-31" },
    category,
    balance: {
      boxReferenceId: "budget-active",
      asOf: "2026-09-02",
      balanceCents: "65000",
      protectedAmountCents: "65000",
      contributionCents: "100000",
      withdrawalCents: "35000",
      activeAtCutoff: true,
      movementReferenceIds: [],
      contributionReferenceIds: [],
      withdrawalReferenceIds: [],
    },
    period: {
      from: "2026-09-01",
      to: "2026-09-02",
      rolloverCents: "0",
      openingBalanceCents: "0",
      closingBalanceCents: "65000",
      contributionCents: "100000",
      withdrawalCents: "35000",
      netChangeCents: "65000",
      contributionReferenceIds: [],
      withdrawalReferenceIds: [],
    },
    progress: {
      targetAmountCents: "100000",
      targetDate: "2026-12-31",
      progressCents: "65000",
      remainingCents: "35000",
      progressBps: "6500",
      remainingMonths: 4,
      suggestedMonthlyCents: "8750",
      status: "IN_PROGRESS",
      paceStatus: "ON_TRACK",
    },
    ...overrides,
  };
}

function successful(value: BudgetBoundary): BudgetResult<BudgetBoundary> {
  return { ok: true, value };
}

const categories = [{ id: category.referenceId, name: category.name }];

beforeEach(() => {
  mocks.closeBudgetAction.mockReset();
  mocks.createBudgetAction.mockReset();
  mocks.listBudgetsAction.mockReset();
  mocks.updateBudgetAction.mockReset();
  mocks.listBudgetsAction.mockResolvedValue({
    ok: true,
    value: { items: [], pageInfo: { hasNextPage: false, nextCursor: null } },
  });
});

describe("BudgetCollectionScreen", () => {
  it("renders server-provided balance, period figures and progress without tenancy data", () => {
    const { container } = render(
      <BudgetCollectionScreen
        categories={categories}
        initialItems={[item()]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Caixinhas" })).toBeTruthy();
    expect(screen.getAllByText("Lazer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("R$ 650,00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("R$ 1.000,00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("65,00% do alvo").length).toBeGreaterThan(0);
    expect(screen.getByText("Aportes no mês")).toBeTruthy();
    expect(screen.getByText("Gastos/retiradas no mês")).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/householdId|tenantId|userId/iu);
  });

  it("loads the closed collection through the server read action and preserves an empty state", async () => {
    mocks.listBudgetsAction.mockResolvedValueOnce({
      ok: true,
      value: { items: [], pageInfo: { hasNextPage: false, nextCursor: null } },
    });
    render(
      <BudgetCollectionScreen
        categories={categories}
        initialItems={[item()]}
      />,
    );

    fireEvent.click(screen.getByTestId("budgets-closed-toggle"));

    await waitFor(() => {
      expect(mocks.listBudgetsAction).toHaveBeenCalledWith({ status: "CLOSED" });
      expect(screen.getByTestId("budgets-empty")).toBeTruthy();
    });
    expect(screen.getByText("Nenhuma Caixinha encerrada")).toBeTruthy();
  });

  it("runs create and edit through the CRUD Server Actions", async () => {
    const created: BudgetBoundary = {
      referenceId: "budget-created",
      name: "Casa",
      categoryId: category.referenceId,
      status: "ACTIVE",
      activeFrom: "2026-09-02",
      closedOn: null,
      goal: null,
    };
    mocks.createBudgetAction.mockResolvedValue(successful(created));
    mocks.updateBudgetAction.mockResolvedValue(
      successful({ ...created, referenceId: "budget-active", name: "Lazer novo" }),
    );
    mocks.listBudgetsAction.mockResolvedValue({
      ok: true,
      value: { items: [item()], pageInfo: { hasNextPage: false, nextCursor: null } },
    });

    render(
      <BudgetCollectionScreen
        categories={categories}
        initialItems={[]}
      />,
    );
    fireEvent.click(screen.getByTestId("budgets-create-button"));
    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Casa" },
    });
    fireEvent.change(screen.getByLabelText("Categoria de despesa"), {
      target: { value: category.referenceId },
    });
    fireEvent.change(screen.getByLabelText("Início da vigência"), {
      target: { value: "2026-09-02" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar Caixinha" }));

    await waitFor(() => {
      expect(mocks.createBudgetAction).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Casa",
          categoryId: category.referenceId,
          activeFrom: "2026-09-02",
        }),
      );
    });

    const editButtons = screen.getAllByTestId("budget-edit-budget-active");
    fireEvent.click(editButtons[0]!);
    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Lazer novo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => {
      expect(mocks.updateBudgetAction).toHaveBeenCalledWith(
        expect.objectContaining({
          budgetReferenceId: "budget-active",
          name: "Lazer novo",
        }),
      );
    });
  });

  it("exposes loading and negative-balance states explicitly", async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    mocks.listBudgetsAction.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    render(
      <BudgetCollectionScreen
        categories={categories}
        initialItems={[item()]}
      />,
    );
    fireEvent.click(screen.getByTestId("budgets-closed-toggle"));
    expect(screen.getByTestId("budgets-loading")).toBeTruthy();
    resolveRequest?.({
      ok: true,
      value: { items: [], pageInfo: { hasNextPage: false, nextCursor: null } },
    });
    await waitFor(() => expect(screen.getByTestId("budgets-empty")).toBeTruthy());

    const negative = item({
      balance: {
        ...item().balance,
        balanceCents: "-1",
        protectedAmountCents: "0",
      },
    });
    render(
      <BudgetCollectionScreen
        categories={categories}
        initialItems={[negative]}
      />,
    );
    expect(screen.getAllByText("Saldo negativo: a proteção fica zerada neste corte.").length).toBeGreaterThan(0);
  });

  it("confirms closing with a focused effective date and returns focus to the trigger", async () => {
    const closed: BudgetBoundary = {
      referenceId: "budget-active",
      name: "Lazer",
      categoryId: category.referenceId,
      status: "CLOSED",
      activeFrom: "2026-09-01",
      closedOn: "2026-09-02",
      goal: { targetAmountCents: "100000", targetDate: "2026-12-31" },
    };
    mocks.closeBudgetAction.mockResolvedValue(successful(closed));
    mocks.listBudgetsAction.mockResolvedValue({
      ok: true,
      value: { items: [], pageInfo: { hasNextPage: false, nextCursor: null } },
    });

    render(
      <BudgetCollectionScreen
        categories={categories}
        initialItems={[item()]}
      />,
    );

    const triggers = screen.getAllByTestId("budget-close-budget-active");
    const trigger = triggers[0];
    expect(trigger).toBeTruthy();
    (trigger as HTMLButtonElement).focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("alertdialog");
    expect(document.activeElement).toBe(dialog);
    expect(screen.getByLabelText("Data efetiva do encerramento")).toBeTruthy();
    expect(screen.getByText(/deixa de valer a partir da data efetiva/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Data efetiva do encerramento"), {
      target: { value: "2026-09-02" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => {
      expect(mocks.closeBudgetAction).toHaveBeenCalledWith(
        expect.objectContaining({
          budgetReferenceId: "budget-active",
          closedOn: "2026-09-02",
        }),
      );
      expect(screen.getByTestId("budgets-success")).toBeTruthy();
    });
    expect(screen.getByTestId("budgets-success").textContent).toContain(
      "proteção deixa de valer",
    );
  });

  it("shows opaque loading errors and category availability errors", () => {
    render(
      <BudgetCollectionScreen
        categories={[]}
        categoryError="Categorias indisponíveis"
        initialItems={[]}
      />,
    );
    fireEvent.click(screen.getByTestId("budgets-create-button"));
    expect(screen.getByTestId("budget-form")).toBeTruthy();
    expect(screen.getByText("Categorias indisponíveis")).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(true);
  });
});
