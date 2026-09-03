import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BudgetDetailReadModel } from "@/modules/budgets/read-contracts";

const mocks = vi.hoisted(() => ({
  getBudgetAction: vi.fn(),
  listBudgetsAction: vi.fn(),
  getSpendableAction: vi.fn(),
}));

vi.mock("@/app/actions/budgets", () => mocks);
vi.mock("@/app/actions/spendable", () => ({
  getSpendableAction: mocks.getSpendableAction,
}));

import BudgetDetailPage from "./page";

function detail(): BudgetDetailReadModel {
  return {
    referenceId: "budget-reference",
    name: "Lazer",
    categoryId: "category-reference",
    status: "ACTIVE",
    activeFrom: "2026-09-01",
    closedOn: null,
    goal: null,
    category: {
      referenceId: "category-reference",
      name: "Lazer",
      parentReferenceId: null,
      kind: "EXPENSE",
      status: "ACTIVE",
    },
    balance: {
      boxReferenceId: "budget-reference",
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
    period: null,
    progress: {
      targetAmountCents: null,
      targetDate: null,
      progressCents: "0",
      remainingCents: "0",
      progressBps: "0",
      remainingMonths: null,
      suggestedMonthlyCents: null,
      status: "NOT_APPLICABLE",
      paceStatus: "NOT_APPLICABLE",
    },
    movements: [],
    movementPageInfo: { hasNextPage: false, nextCursor: null },
    allocationRules: [],
  };
}

describe("/budgets/[referenceId] server route", () => {
  beforeEach(() => {
    mocks.getBudgetAction.mockReset();
    mocks.listBudgetsAction.mockReset();
    mocks.getSpendableAction.mockReset();
    mocks.getBudgetAction.mockResolvedValue({ ok: true, value: detail() });
    mocks.listBudgetsAction.mockResolvedValue({
      ok: true,
      value: {
        items: [
          {
            ...detail(),
            period: null,
          },
          { ...detail(), referenceId: "budget-destination", name: "Emergência" },
        ],
        pageInfo: { hasNextPage: false, nextCursor: null },
      },
    });
    mocks.getSpendableAction.mockResolvedValue({
      ok: false,
      error: { code: "SPENDABLE_QUERY_FAILED", field: null },
    });
  });

  it("reads an opaque reference and reduces transfer destinations", async () => {
    const html = renderToStaticMarkup(
      await BudgetDetailPage({ params: Promise.resolve({ referenceId: "budget-reference" }) }),
    );
    const readQuery = mocks.getBudgetAction.mock.calls[0]?.[1] as Record<string, unknown>;

    expect(mocks.getBudgetAction).toHaveBeenCalledWith("budget-reference", expect.objectContaining({ limit: 50 }));
    expect(typeof readQuery.asOf).toBe("string");
    expect(readQuery.from).toBe(`${String(readQuery.asOf).slice(0, 7)}-01`);
    expect(readQuery.to).toBe(readQuery.asOf);
    expect(mocks.listBudgetsAction).toHaveBeenCalledWith({
      status: "ACTIVE",
      asOf: readQuery.asOf,
    });
    expect(mocks.getSpendableAction).toHaveBeenCalledWith({ asOf: readQuery.asOf });
    expect(html).toContain("Caixinha: Lazer");
    expect(html).toContain('data-testid="budget-spendable-impact"');
    expect(html).toContain("returnTo=%2Fbudgets%2Fbudget-reference");
    expect(html).not.toMatch(/householdId|tenantId|userId/iu);
  });

  it("keeps read failures opaque and does not render a client detail", async () => {
    mocks.getBudgetAction.mockResolvedValue({
      ok: false,
      error: { code: "BUDGET_NOT_FOUND", message: "A Caixinha não foi encontrada." },
    });

    const html = renderToStaticMarkup(
      await BudgetDetailPage({ params: Promise.resolve({ referenceId: "foreign-reference" }) }),
    );

    expect(html).toContain('data-testid="budget-detail-route-error"');
    expect(html).toContain("A Caixinha não foi encontrada.");
    expect(html).not.toContain("foreign-reference");
    expect(mocks.listBudgetsAction).not.toHaveBeenCalled();
    expect(mocks.getSpendableAction).not.toHaveBeenCalled();
  });
});
