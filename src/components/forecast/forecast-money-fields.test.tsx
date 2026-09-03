/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ForecastCreateCommitmentForm } from "./forecast-create-commitment-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/app/actions/forecast-maintenance", () => ({
  createPlannedEventAction: vi.fn(),
  createRecurringRuleAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

describe("ForecastCreateCommitmentForm money mask", () => {
  it("masks the amount field as Brazilian currency instead of raw cents", () => {
    render(<ForecastCreateCommitmentForm />);

    const amount = screen.getByRole("textbox", { name: /^Valor$/ });
    expect(screen.queryByRole("textbox", { name: "Valor (centavos)" })).toBeNull();
    expect(amount.getAttribute("data-money-boundary")).toBe("amountCents");

    fireEvent.change(amount, { target: { value: "1" } });
    expect((amount as HTMLInputElement).value).toBe("0,01");
    fireEvent.change(amount, { target: { value: "0,012" } });
    expect((amount as HTMLInputElement).value).toBe("0,12");
    fireEvent.change(amount, { target: { value: "0,123" } });
    expect((amount as HTMLInputElement).value).toBe("1,23");
    fireEvent.change(amount, { target: { value: "1,234" } });
    expect((amount as HTMLInputElement).value).toBe("12,34");
    fireEvent.change(amount, { target: { value: "12,345" } });
    expect((amount as HTMLInputElement).value).toBe("123,45");
    fireEvent.change(amount, { target: { value: "123,456" } });
    expect((amount as HTMLInputElement).value).toBe("1.234,56");
  });
});
