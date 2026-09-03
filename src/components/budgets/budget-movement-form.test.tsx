/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BudgetMovementForm } from "./budget-movement-form";

afterEach(cleanup);

describe("BudgetMovementForm", () => {
  it("validates, confirms and emits only the movement fields", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        referenceId: "movement-reference",
        boxReferenceId: "budget-reference",
        kind: "CONTRIBUTION",
        amountCents: "1000",
        effectiveOn: "2026-09-02",
      },
    });
    const { container } = render(
      <BudgetMovementForm mode="CONTRIBUTION" onSubmit={onSubmit} />,
    );

    const amount = screen.getByLabelText("Valor") as HTMLInputElement;
    expect(amount.type).toBe("text");
    fireEvent.change(amount, { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Data efetiva"), {
      target: { value: "2026-09-02" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar aporte" }));

    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole("alertdialog"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar aporte" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        amountCents: "1000",
        effectiveOn: "2026-09-02",
      });
    });
    expect(container.innerHTML).not.toMatch(/householdId|balanceCents|sourceReferenceId/iu);
  });

  it("rejects an empty amount and requires a transfer destination", async () => {
    render(
      <BudgetMovementForm
        destinations={[{ referenceId: "destination", name: "Reserva" }]}
        mode="TRANSFER"
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Revisar transferência" }));
    await waitFor(() => expect(screen.getByText(/centavos positivos inválidos/i)).toBeTruthy());
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar transferência" }));
    await waitFor(() => expect(screen.getByText("Selecione a Caixinha de destino.")).toBeTruthy());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("renders a safe server error and closes confirmation for retry", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "BUDGET_CLOSED", message: "A Caixinha está encerrada.", field: "budgetReferenceId" },
    });
    render(<BudgetMovementForm mode="WITHDRAWAL" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar retirada" }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Confirmar retirada" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent ?? "").toContain("Caixinha está encerrada");
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("cancels a confirmation with Escape without invoking the action", () => {
    const onSubmit = vi.fn();
    render(<BudgetMovementForm mode="CONTRIBUTION" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar aporte" }));
    return waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy()).then(() => {
      fireEvent.keyDown(document, { key: "Escape" });

      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });
});
