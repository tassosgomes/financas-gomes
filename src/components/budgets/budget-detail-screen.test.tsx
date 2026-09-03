/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BudgetDetailReadModel } from "@/modules/budgets/read-contracts";
import type {
  SpendableBreakdown,
  SpendableResult,
} from "@/modules/spendable";

const mocks = vi.hoisted(() => ({
  getBudgetAction: vi.fn(),
  registerContributionAction: vi.fn(),
  registerWithdrawalAction: vi.fn(),
  transferBetweenBudgetsAction: vi.fn(),
  getSpendableAction: vi.fn(),
}));

vi.mock("@/app/actions/budgets", () => mocks);
vi.mock("@/app/actions/spendable", () => ({
  getSpendableAction: mocks.getSpendableAction,
}));

import { BudgetDetailScreen } from "./budget-detail-screen";

const TEST_TODAY = new Date("2026-09-02T12:00:00.000Z");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const movement = {
  referenceId: "movement-1",
  boxReferenceId: "budget-1",
  kind: "CONTRIBUTION" as const,
  amountCents: "1000",
  effectiveOn: "2026-09-02",
  correctsReferenceId: null,
  transferReferenceId: null,
  sourceReferenceId: null,
};

function detail(overrides: Partial<BudgetDetailReadModel> = {}): BudgetDetailReadModel {
  return {
    referenceId: "budget-1",
    name: "Reserva mensal",
    categoryId: "category-1",
    status: "ACTIVE",
    activeFrom: "2026-09-01",
    closedOn: null,
    goal: { targetAmountCents: "100000", targetDate: "2026-12-31" },
    category: {
      referenceId: "category-1",
      name: "Lazer",
      parentReferenceId: null,
      kind: "EXPENSE",
      status: "ACTIVE",
    },
    balance: {
      boxReferenceId: "budget-1",
      asOf: "2026-09-02",
      balanceCents: "65000",
      protectedAmountCents: "65000",
      contributionCents: "10000",
      withdrawalCents: "0",
      activeAtCutoff: true,
      movementReferenceIds: ["movement-1"],
      contributionReferenceIds: ["movement-1"],
      withdrawalReferenceIds: [],
    },
    period: {
      from: "2026-09-01",
      to: "2026-09-02",
      rolloverCents: "5000",
      openingBalanceCents: "5000",
      closingBalanceCents: "65000",
      contributionCents: "60000",
      withdrawalCents: "0",
      netChangeCents: "60000",
      contributionReferenceIds: ["movement-1"],
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
    movements: [movement],
    movementPageInfo: { hasNextPage: false, nextCursor: null },
    allocationRules: [],
    ...overrides,
  };
}

function spendableResult(
  protectedCents: string,
  appliedOpeningAdjustmentCents: string,
): SpendableResult<SpendableBreakdown> {
  return {
    ok: true,
    value: {
      contractVersion: "s08.v1",
      ruleVersion: "spendable.v1",
      period: {
        asOf: "2026-09-02",
        from: "2026-09-03",
        to: "2026-12-01",
        horizonDays: 90,
        scenario: "CONSERVATIVE",
        forecastContractVersion: "s07.v1",
      },
      openingBalanceCents: "80000",
      openingAdjustmentsCents: "-1000",
      openingProjectedBalanceCents: "79000",
      closingProjectedBalanceCents: "70000",
      minimumProjectedBalanceCents: "70000",
      minimum: { projectedBalanceCents: "70000", points: [] },
      operationalBuffer: {
        amountCents: "0",
        source: "ABSENT_DEFAULT_ZERO",
        effectiveFrom: null,
        revision: null,
      },
      reserve: {
        contractVersion: "s09.v1",
        status: "AVAILABLE",
        protectedCents,
        appliedOpeningAdjustmentCents,
        components: [],
      },
      rawSpendableCents: "70000",
      displaySpendableCents: "70000",
      deficitToPreserveReserveCents: "0",
    },
  };
}

beforeEach(() => {
  // Movement forms derive the civil date from the clock. Keep command payload
  // assertions stable when the suite runs on a later day or in another zone.
  vi.useFakeTimers({ now: TEST_TODAY, toFake: ["Date"] });
  mocks.getBudgetAction.mockReset();
  mocks.registerContributionAction.mockReset();
  mocks.registerWithdrawalAction.mockReset();
  mocks.transferBetweenBudgetsAction.mockReset();
  mocks.getSpendableAction.mockReset();
  mocks.getBudgetAction.mockResolvedValue({ ok: true, value: detail() });
  mocks.getSpendableAction.mockResolvedValue({
    ok: false,
    error: { code: "SPENDABLE_QUERY_FAILED", field: null },
  });
});

describe("BudgetDetailScreen", () => {
  it("renders server balance, period, progress and movement lineage labels", () => {
    render(
      <BudgetDetailScreen
        destinations={[{ referenceId: "budget-2", name: "Emergência" }]}
        initialDetail={detail({
          movements: [{ ...movement, transferReferenceId: "transfer-1" }],
        })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Caixinha: Reserva mensal" })).toBeTruthy();
    expect(screen.getAllByText("R$ 650,00").length).toBeGreaterThan(0);
    expect(screen.getByText("Resumo do período")).toBeTruthy();
    expect(screen.getByText("Rollover")).toBeTruthy();
    expect(screen.getByText("Aporte (transferência)")).toBeTruthy();
    expect(screen.getByText("65,00% do alvo")).toBeTruthy();
    expect(screen.getByTestId("budget-spendable-impact")).toBeTruthy();
    expect(screen.getByText("O provedor está indisponível; o impacto disponível não pode ser exibido.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Consultar disponibilidade autorizada" }).getAttribute("href")).toBe("/spendable/breakdown");
    expect(screen.queryByText(/householdId|tenantId|userId/iu)).toBeNull();
  });

  it("renders the authorized impact and refreshes it after a movement", async () => {
    mocks.getSpendableAction.mockResolvedValue(spendableResult("2500", "-2500"));
    mocks.registerContributionAction.mockResolvedValue({ ok: true, value: movement });
    render(
      <BudgetDetailScreen
        initialDetail={detail()}
        initialSpendable={spendableResult("1000", "-1000")}
        spendableHref="/spendable/breakdown?returnTo=%2Fbudgets%2Fbudget-1"
      />,
    );

    expect(screen.getByText("Protegido: R$ 10,00")).toBeTruthy();
    expect(screen.getByText("Ajuste aplicado na abertura: -R$ 10,00")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Consultar disponibilidade autorizada" }).getAttribute("href")).toBe(
      "/spendable/breakdown?returnTo=%2Fbudgets%2Fbudget-1",
    );

    fireEvent.click(screen.getByTestId("budget-movement-contribution-button"));
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar aporte" }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Confirmar aporte" }));

    await waitFor(() => {
      expect(mocks.getSpendableAction).toHaveBeenCalledWith({ asOf: "2026-09-02" });
      expect(screen.getByText("Protegido: R$ 25,00")).toBeTruthy();
    });
  });

  it("registers a contribution through T07 and re-reads the detail", async () => {
    mocks.registerContributionAction.mockResolvedValue({ ok: true, value: movement });
    render(<BudgetDetailScreen initialDetail={detail()} />);

    fireEvent.click(screen.getByTestId("budget-movement-contribution-button"));
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar aporte" }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Confirmar aporte" }));

    await waitFor(() => {
      expect(mocks.registerContributionAction).toHaveBeenCalledWith(
        expect.objectContaining({
          budgetReferenceId: "budget-1",
          amountCents: "2000",
          effectiveOn: "2026-09-02",
        }),
      );
    });
    expect(mocks.registerContributionAction.mock.calls[0]?.[0]).not.toHaveProperty("householdId");
    await waitFor(() => expect(mocks.getBudgetAction).toHaveBeenCalled());
    expect(screen.getByTestId("budget-detail-success").textContent).toContain("Aporte registrado");
  });

  it("registers a withdrawal without turning it into a bank expense", async () => {
    mocks.registerWithdrawalAction.mockResolvedValue({ ok: true, value: { ...movement, kind: "WITHDRAWAL" } });
    render(<BudgetDetailScreen initialDetail={detail()} />);

    fireEvent.click(screen.getByTestId("budget-movement-withdrawal-button"));
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "1500" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar retirada" }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Confirmar retirada" }));

    await waitFor(() => {
      expect(mocks.registerWithdrawalAction).toHaveBeenCalledWith(
        expect.objectContaining({
          budgetReferenceId: "budget-1",
          amountCents: "1500",
          effectiveOn: "2026-09-02",
        }),
      );
    });
    expect(mocks.registerWithdrawalAction.mock.calls[0]?.[0]).not.toHaveProperty("financialEventId");
  });

  it("sends transfer origin/destination and lineage refs as one atomic action", async () => {
    mocks.transferBetweenBudgetsAction.mockResolvedValue({
      ok: true,
      value: { transferReferenceId: "transfer-1", source: movement, destination: { ...movement, boxReferenceId: "budget-2" }, movements: [movement, { ...movement, boxReferenceId: "budget-2" }] },
    });
    render(
      <BudgetDetailScreen
        destinations={[{ referenceId: "budget-2", name: "Emergência" }]}
        initialDetail={detail()}
      />,
    );

    fireEvent.click(screen.getByTestId("budget-movement-transfer-button"));
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "3000" } });
    fireEvent.change(screen.getByLabelText("Caixinha de destino"), { target: { value: "budget-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar transferência" }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Confirmar transferência" }));

    await waitFor(() => {
      expect(mocks.transferBetweenBudgetsAction).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceBudgetReferenceId: "budget-1",
          destinationBudgetReferenceId: "budget-2",
          amountCents: "3000",
          effectiveOn: "2026-09-02",
          withdrawalReferenceId: expect.any(String),
          contributionReferenceId: expect.any(String),
          transferReferenceId: expect.any(String),
        }),
      );
    });
    expect(mocks.transferBetweenBudgetsAction.mock.calls[0]?.[0]).not.toHaveProperty("balanceCents");
  });

  it("loads the next movement page and explains negative and closed states", async () => {
    mocks.getBudgetAction.mockResolvedValueOnce({
      ok: true,
      value: detail({
        balance: { ...detail().balance, balanceCents: "-1", protectedAmountCents: "0" },
        status: "CLOSED",
        closedOn: "2026-09-02",
        movementPageInfo: { hasNextPage: true, nextCursor: "cursor-2" },
        movements: [{ ...movement, referenceId: "movement-2" }],
      }),
    });
    const { rerender } = render(
      <BudgetDetailScreen
        initialDetail={detail({
          status: "CLOSED",
          closedOn: "2026-09-02",
          movementPageInfo: { hasNextPage: true, nextCursor: "cursor-2" },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais movimentos" }));
    await waitFor(() => {
      expect(mocks.getBudgetAction).toHaveBeenCalledWith(
        "budget-1",
        expect.objectContaining({ cursor: "cursor-2", limit: 50 }),
      );
    });

    rerender(
      <BudgetDetailScreen
        key="closed-negative"
        initialDetail={detail({
          status: "CLOSED",
          closedOn: "2026-09-02",
          balance: { ...detail().balance, balanceCents: "-1", protectedAmountCents: "0" },
          movements: [],
        })}
      />,
    );
    expect(screen.getByTestId("budget-closed-message")).toBeTruthy();
    expect(screen.getByTestId("budget-negative-message")).toBeTruthy();
    expect(screen.queryByTestId("budget-movement-contribution-button")).toBeNull();
    expect(screen.getByText("Nenhuma movimentação registrada para este período.")).toBeTruthy();
  });
});
