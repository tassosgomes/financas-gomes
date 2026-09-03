import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BudgetListItemReadModel } from "@/modules/budgets/read-contracts";

const mocks = vi.hoisted(() => ({
  listBudgetsAction: vi.fn(),
  listCategoriesAction: vi.fn(),
}));

vi.mock("@/app/actions/budgets", () => ({
  listBudgetsAction: mocks.listBudgetsAction,
}));
vi.mock("@/app/actions/categories", () => ({
  listCategoriesAction: mocks.listCategoriesAction,
}));

import BudgetsPage from "./page";

function listItem(): BudgetListItemReadModel {
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
  };
}

beforeEach(() => {
  mocks.listBudgetsAction.mockReset();
  mocks.listCategoriesAction.mockReset();
  mocks.listBudgetsAction.mockResolvedValue({
    ok: true,
    value: {
      items: [listItem()],
      pageInfo: { hasNextPage: false, nextCursor: null },
    },
  });
  mocks.listCategoriesAction.mockResolvedValue({
    ok: true,
    value: {
      items: [
        {
          id: "category-reference",
          householdId: "secret-household",
          name: "Lazer",
          parentId: null,
          kind: "EXPENSE",
          status: "ACTIVE",
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    },
  });
});

describe("/budgets server route", () => {
  it("reads active budgets and reduces category options before rendering the client island", async () => {
    const html = renderToStaticMarkup(await BudgetsPage());

    expect(mocks.listBudgetsAction).toHaveBeenCalledWith({ status: "ACTIVE" });
    expect(mocks.listCategoriesAction).toHaveBeenCalledWith({ status: "ACTIVE" });
    expect(html).toContain('data-testid="budgets-route"');
    expect(html).toContain("Caixinhas");
    expect(html).toContain("Lazer");
    expect(html).not.toContain("secret-household");
    expect(html).not.toMatch(/householdId|tenantId|userId/iu);
  });

  it("keeps a safe error state when the server read fails", async () => {
    mocks.listBudgetsAction.mockResolvedValue({
      ok: false,
      error: {
        code: "QUERY_FAILED",
        message: "Não foi possível consultar a Caixinha.",
      },
    });

    const html = renderToStaticMarkup(await BudgetsPage());

    expect(html).toContain('data-testid="budgets-route-error"');
    expect(html).toContain("Não foi possível consultar a Caixinha.");
    expect(html).not.toContain("stack");
  });
});
