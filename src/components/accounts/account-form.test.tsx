/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountForm } from "./account-form";

afterEach(() => {
  cleanup();
});

describe("AccountForm field layout", () => {
  it("renders Tipo and Disponibilidade controls before helper descriptions", () => {
    render(
      <AccountForm
        onCancel={vi.fn()}
        onSubmit={vi.fn(async () => ({ ok: true, value: {} as never }))}
      />,
    );

    const type = screen.getByTestId("account-type-input");
    const spendability = screen.getByTestId("account-spendability-input");
    const spendabilityDescription = document.getElementById("spendability-description");

    expect(spendabilityDescription).not.toBeNull();
    expect(
      type.compareDocumentPosition(spendability) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      spendability.compareDocumentPosition(spendabilityDescription!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const typeTop = type.getBoundingClientRect().top;
    const spendabilityTop = spendability.getBoundingClientRect().top;
    expect(Math.abs(typeTop - spendabilityTop)).toBeLessThan(2);
  });
});
