/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BudgetBalanceViewModel,
  BudgetMovementViewModel,
  BudgetProgressViewModel,
  BudgetReadModelState,
  BudgetSpendableImpactViewModel,
  BudgetStatusViewModel,
} from "@/modules/budgets/ui-contracts";

import {
  BudgetBalanceCard,
  BudgetCloseConfirmation,
  BudgetMovementList,
  BudgetProgressCard,
  BudgetSpendableImpactMessage,
  BudgetStateView,
  BudgetStatusBadge,
} from "./budget-components";

afterEach(cleanup);

function makeBalance(
  position: BudgetBalanceViewModel["position"],
  activeAtCutoff = true,
): BudgetBalanceViewModel {
  const isNegative = position === "negative";
  const isZero = position === "zero";

  return {
    boxReferenceId: "budget-reference",
    asOf: "2026-09-02",
    balanceCents: isNegative ? "-1" : isZero ? "0" : "10000",
    protectedAmountCents: isNegative ? "0" : isZero ? "0" : "10000",
    contributionCents: isNegative ? "0" : "10000",
    withdrawalCents: isNegative ? "1" : "0",
    activeAtCutoff,
    movementReferenceIds: [],
    contributionReferenceIds: [],
    withdrawalReferenceIds: [],
    position,
    asOfLabel: "02/09/2026",
    balanceLabel: isNegative ? "Saldo fornecido: -R$ 0,01" : "Saldo fornecido",
    protectedAmountLabel: isNegative
      ? "Proteção fornecida: R$ 0,00"
      : "Proteção fornecida",
    contributionLabel: "Aportes fornecidos",
    withdrawalLabel: "Retiradas fornecidas",
  };
}

const movement: BudgetMovementViewModel = {
  referenceId: "movement-reference",
  boxReferenceId: "budget-reference",
  kind: "CONTRIBUTION",
  amountCents: "1000",
  effectiveOn: "2026-09-02",
  correctsReferenceId: null,
  transferReferenceId: null,
  sourceReferenceId: null,
  kindLabel: "Aporte fornecido",
  impactLabel: "Impacto fornecido: R$ 10,00",
  effectiveOnLabel: "Data fornecida",
};

const progressWithGoal: BudgetProgressViewModel = {
  targetAmountCents: "100000",
  targetDate: "2026-12-31",
  progressCents: "20000",
  remainingCents: "80000",
  progressBps: "2000",
  remainingMonths: 4,
  suggestedMonthlyCents: "20000",
  status: "IN_PROGRESS",
  paceStatus: "ON_TRACK",
  targetAmountLabel: "Meta fornecida: R$ 1.000,00",
  targetDateLabel: "Data fornecida: 31/12/2026",
  progressLabel: "Progresso fornecido: 20%",
  remainingLabel: "Restante fornecido: R$ 800,00",
  suggestedMonthlyLabel: "Sugestão fornecida: R$ 200,00/mês",
  statusLabel: "Status fornecido",
  paceStatusLabel: "Ritmo fornecido",
};

const progressWithoutGoal: BudgetProgressViewModel = {
  targetAmountCents: null,
  targetDate: null,
  progressCents: "0",
  remainingCents: "0",
  progressBps: "0",
  remainingMonths: null,
  suggestedMonthlyCents: null,
  status: "NOT_APPLICABLE",
  paceStatus: "NOT_APPLICABLE",
  targetAmountLabel: null,
  targetDateLabel: null,
  progressLabel: "não usar",
  remainingLabel: "não usar",
  suggestedMonthlyLabel: null,
  statusLabel: "não usar",
  paceStatusLabel: "não usar",
};

const availableSpendableImpact: BudgetSpendableImpactViewModel = {
  contractVersion: "s09.v1",
  status: "AVAILABLE",
  protectedCents: "10000",
  appliedOpeningAdjustmentCents: "-10000",
  components: [],
  availability: "available",
  protectedAmountLabel: "Proteção fornecida",
  appliedOpeningAdjustmentLabel: "Ajuste fornecido",
};

const unavailableSpendableImpact: BudgetSpendableImpactViewModel = {
  contractVersion: "s09.v1",
  status: "UNAVAILABLE",
  protectedCents: "0",
  appliedOpeningAdjustmentCents: "0",
  components: [],
  availability: "unavailable",
  protectedAmountLabel: null,
  appliedOpeningAdjustmentLabel: null,
  message: "Impacto indisponível fornecido",
};

describe("budget components", () => {
  it.each([
    ["loading", { state: "loading" as const }],
    ["empty", { state: "empty" as const }],
    [
      "error",
      {
        state: "error" as const,
        error: { code: "QUERY_FAILED" as const, message: "secret", retryable: true },
      },
    ],
    [
      "provider-unavailable",
      {
        state: "provider-unavailable" as const,
        provider: {
          state: "provider-unavailable" as const,
          code: "PROVIDER_UNAVAILABLE" as const,
          message: "secret",
        },
      },
    ],
  ])("renders the %s state", (_name, state: BudgetReadModelState<unknown>) => {
    render(
      <BudgetStateView
        state={state}
        title="Orçamento"
        renderData={() => <p>dados protegidos</p>}
        testId="state-view"
      />,
    );

    expect(screen.getByTestId("state-view")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Orçamento" })).toBeTruthy();
    expect(screen.queryByText("dados protegidos")).toBeNull();
    expect(screen.queryByText("secret")).toBeNull();
  });

  it("renders data without changing it", () => {
    const data = { value: "unchanged" };
    const renderData = vi.fn((received: typeof data) => <p>{received.value}</p>);

    render(<BudgetStateView state={{ state: "data", data }} renderData={renderData} />);

    expect(renderData).toHaveBeenCalledWith(data);
    expect(screen.getByText("unchanged")).toBeTruthy();
  });

  it.each([
    ["Ativo", "active"],
    ["Encerrado", "closed"],
  ] as const)("shows status label and state for %s", (label, state) => {
    const status: BudgetStatusViewModel = {
      label,
      state,
      status: state === "active" ? "ACTIVE" : "CLOSED",
    };

    render(<BudgetStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText(state)).toBeTruthy();
  });

  it.each([
    ["positive", true],
    ["zero", true],
    ["negative", true],
  ] as const)("renders balance %s", (position, activeAtCutoff) => {
    const balance = makeBalance(position, activeAtCutoff);
    render(<BudgetBalanceCard balance={balance} />);

    expect(screen.getByRole("heading", { name: "Balanço" })).toBeTruthy();
    expect(screen.getByText(balance.balanceLabel)).toBeTruthy();
    expect(screen.getByText(balance.protectedAmountLabel)).toBeTruthy();
    expect(screen.getByText(balance.contributionLabel)).toBeTruthy();
    expect(screen.getByText(balance.withdrawalLabel)).toBeTruthy();
    expect(screen.getByRole("heading").closest("section")?.getAttribute("data-position")).toBe(
      position,
    );

    if (position === "negative") {
      expect(screen.getByText("Déficit: a proteção está zerada neste corte.")).toBeTruthy();
      expect(screen.queryByText(/disponibilidade/i)).toBeNull();
    }
  });

  it("explains inactive cutoff protection", () => {
    render(<BudgetBalanceCard balance={makeBalance("zero", false)} />);

    expect(screen.getByText("Não há proteção ativa no corte.")).toBeTruthy();
  });

  it("renders movements and an accessible empty state", () => {
    const { rerender } = render(<BudgetMovementList movements={[movement]} />);
    expect(screen.getByText("Aporte fornecido")).toBeTruthy();
    expect(screen.getByText("Impacto fornecido: R$ 10,00")).toBeTruthy();
    expect(screen.getByText("Data fornecida")).toBeTruthy();

    rerender(<BudgetMovementList movements={[]} />);
    expect(screen.getByText("Nenhum movimento de orçamento.")).toBeTruthy();
  });

  it("renders progress with a goal and without arithmetic", () => {
    const { rerender } = render(
      <BudgetProgressCard progress={progressWithGoal} />,
    );

    const progress = screen.getByRole("progressbar");
    expect(progress.getAttribute("aria-valuenow")).toBe("2000");
    expect(progress.getAttribute("aria-valuemax")).toBe("10000");
    expect(screen.getByText("Progresso fornecido: 20%")).toBeTruthy();

    rerender(<BudgetProgressCard progress={progressWithoutGoal} />);
    expect(screen.getByText("Meta não configurada.")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("focuses and handles Escape once in the close confirmation", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <BudgetCloseConfirmation
        open
        title="Encerrar orçamento"
        description="Confirme o encerramento."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole("alertdialog");
    expect(document.activeElement).toBe(dialog);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("budget-close-title");
    expect(dialog.getAttribute("aria-describedby")).toBe("budget-close-description");

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders available and unavailable spendable impact safely", () => {
    const { rerender } = render(
      <BudgetSpendableImpactMessage
        impact={availableSpendableImpact}
      />,
    );

    expect(screen.getByText("Impacto na disponibilidade para gastar")).toBeTruthy();
    expect(screen.getByText("Protegido: Proteção fornecida")).toBeTruthy();
    expect(screen.getByText("Ajuste aplicado na abertura: Ajuste fornecido")).toBeTruthy();
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");

    rerender(<BudgetSpendableImpactMessage impact={unavailableSpendableImpact} />);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Impacto indisponível fornecido")).toBeTruthy();
    expect(screen.queryByText("Protegido: Proteção fornecida")).toBeNull();
  });

  it("does not render identity or reference fields", () => {
    const { container } = render(
      <BudgetMovementList
        movements={[{ ...movement, kindLabel: "kind", impactLabel: "impact", effectiveOnLabel: "date" }]}
      />,
    );

    expect(container.innerHTML).not.toMatch(/householdId|userId|tenantId|accountId|refs?/i);
  });
});
