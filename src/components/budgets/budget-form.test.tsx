/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BudgetBoundary,
  BudgetResult,
} from "@/modules/budgets/contracts";

import {
  BudgetForm,
  toBudgetFormPayload,
  type BudgetFormPayload,
  type BudgetFormValues,
} from "./budget-form";

afterEach(() => {
  document.body.innerHTML = "";
});

const categories = [
  { id: "category-leisure", name: "Lazer" },
  { id: "category-home", name: "Casa" },
] as const;

const boundary: BudgetBoundary = {
  referenceId: "budget-reference",
  name: "Lazer",
  categoryId: "category-leisure",
  status: "ACTIVE",
  activeFrom: "2026-09-02",
  closedOn: null,
  goal: { targetAmountCents: "100000", targetDate: "2026-12-31" },
};

function successfulResult(): BudgetResult<BudgetBoundary> {
  return { ok: true, value: boundary };
}

function createValues(overrides: Partial<BudgetFormValues> = {}): BudgetFormValues {
  return {
    name: "Lazer",
    categoryId: "category-leisure",
    activeFrom: "2026-09-02",
    goalEnabled: true,
    targetAmountCents: "100000",
    targetDate: "2026-12-31",
    ...overrides,
  };
}

describe("BudgetForm", () => {
  it("maps the RHF values to a narrow create payload without tenancy fields", () => {
    expect(toBudgetFormPayload(createValues(), "create")).toEqual({
      name: "Lazer",
      categoryId: "category-leisure",
      activeFrom: "2026-09-02",
      goal: { targetAmountCents: "100000", targetDate: "2026-12-31" },
    });

    const payload = toBudgetFormPayload(
      createValues({ goalEnabled: false, targetAmountCents: "", targetDate: "" }),
      "edit",
    );
    expect(payload).toEqual({ name: "Lazer", goal: null });
    expect(JSON.stringify(payload)).not.toMatch(/household|balance|movement|tenant/i);
  });

  it("submits create fields with a money text input and accessible labels", async () => {
    const onSubmit = vi.fn(
      async (payload: BudgetFormPayload): Promise<BudgetResult<BudgetBoundary>> => {
        expect(payload).toMatchObject({
          name: "Lazer",
          categoryId: "category-leisure",
          activeFrom: "2026-09-02",
          goal: { targetAmountCents: "100000", targetDate: "2026-12-31" },
        });
        return successfulResult();
      },
    );

    const { container } = render(
      <BudgetForm categories={categories} onSubmit={onSubmit} testId="create-budget" />,
    );

    expect(screen.getByRole("heading", { name: "Nova Caixinha" })).toBeTruthy();
    expect(screen.getByLabelText("Nome")).toBeTruthy();
    expect(screen.getByLabelText("Categoria de despesa")).toBeTruthy();
    expect(screen.getByLabelText("Início da vigência")).toBeTruthy();
    expect(container.querySelector('input[type="number"]')).toBeNull();

    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Lazer" },
    });
    fireEvent.change(screen.getByLabelText("Categoria de despesa"), {
      target: { value: "category-leisure" },
    });
    fireEvent.change(screen.getByLabelText("Início da vigência"), {
      target: { value: "2026-09-02" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /definir valor/i }));
    fireEvent.change(screen.getByLabelText("Valor da meta"), {
      target: { value: "100000" },
    });
    fireEvent.change(screen.getByLabelText("Data da meta"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar Caixinha" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("validates a configured goal before invoking the action", async () => {
    const onSubmit = vi.fn(async (): Promise<BudgetResult<BudgetBoundary>> => successfulResult());
    render(
      <BudgetForm
        categories={categories}
        onSubmit={onSubmit}
        testId="create-budget"
      />,
    );

    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Lazer" },
    });
    fireEvent.change(screen.getByLabelText("Categoria de despesa"), {
      target: { value: "category-leisure" },
    });
    fireEvent.change(screen.getByLabelText("Início da vigência"), {
      target: { value: "2026-09-02" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /definir valor/i }));
    fireEvent.click(screen.getByRole("button", { name: "Criar Caixinha" }));

    await waitFor(() => {
      expect(screen.getByText("Informe uma meta positiva.")).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a goal date before the start of the budget", async () => {
    const onSubmit = vi.fn(async (): Promise<BudgetResult<BudgetBoundary>> => successfulResult());
    render(
      <BudgetForm
        categories={categories}
        onSubmit={onSubmit}
        testId="create-budget"
      />,
    );
    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Lazer" },
    });
    fireEvent.change(screen.getByLabelText("Categoria de despesa"), {
      target: { value: "category-leisure" },
    });
    fireEvent.change(screen.getByLabelText("Início da vigência"), {
      target: { value: "2026-09-10" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /definir valor/i }));
    fireEvent.change(screen.getByLabelText("Valor da meta"), {
      target: { value: "100000" },
    });
    fireEvent.change(screen.getByLabelText("Data da meta"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar Caixinha" }));

    await waitFor(() => {
      expect(screen.getByText("A data da meta deve ser igual ou posterior ao início.")).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps edit association read-only and surfaces expected server errors", async () => {
    const onSubmit = vi.fn(
      async (): Promise<BudgetResult<BudgetBoundary>> => ({
        ok: false,
        error: {
          code: "CATEGORY_ACTIVE_BUDGET_CONFLICT",
          field: "name",
          message: "Já existe uma Caixinha vigente para esta categoria.",
        },
      }),
    );
    render(
      <BudgetForm
        budget={{
          ...boundary,
          category: {
            referenceId: boundary.categoryId,
            name: "Lazer",
            parentReferenceId: null,
            kind: "EXPENSE",
            status: "ACTIVE",
          },
          balance: {
            boxReferenceId: boundary.referenceId,
            asOf: "2026-09-02",
            balanceCents: "0",
            protectedAmountCents: "0",
            contributionCents: "0",
            withdrawalCents: "0",
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
            closingBalanceCents: "0",
            contributionCents: "0",
            withdrawalCents: "0",
            netChangeCents: "0",
            contributionReferenceIds: [],
            withdrawalReferenceIds: [],
          },
          progress: {
            targetAmountCents: "100000",
            targetDate: "2026-12-31",
            progressCents: "0",
            remainingCents: "100000",
            progressBps: "0",
            remainingMonths: 4,
            suggestedMonthlyCents: "25000",
            status: "IN_PROGRESS",
            paceStatus: "ON_TRACK",
          },
        }}
        categories={categories}
        mode="edit"
        onSubmit={onSubmit}
        testId="edit-budget"
      />,
    );

    expect(screen.getByText("A associação da categoria não muda em uma edição para preservar o histórico.")).toBeTruthy();
    expect(screen.queryByLabelText("Categoria de despesa")).toBeNull();
    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Lazer atualizado" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => {
      expect(screen.getAllByRole("alert")[0]?.textContent).toContain(
        "Já existe uma Caixinha vigente",
      );
    });
  });
});
