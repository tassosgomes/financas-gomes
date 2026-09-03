// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

import type { CategoryQuickEditActionResult } from "./category-quick-edit";
import {
  CategoryQuickEdit,
  type CategoryQuickEditAction,
} from "./category-quick-edit";

import {
  TransactionReviewDetailScreen,
} from "./transaction-review-detail-screen";
import type {
  TransactionReviewResult,
  TransactionDetailReadModel,
} from "@/modules/transactions/review-contracts";
import type { ReviewableTransactionUpdateReadModel } from "@/modules/transactions/review-use-cases";

afterEach(() => {
  cleanup();
  navigation.push.mockReset();
  navigation.refresh.mockReset();
});

const eventId = "018f47b7-6c3a-7abc-8def-1234567890ad";
const accountId = "018f47b7-6c3a-7abc-8def-1234567890ae";
const categoryId = "018f47b7-6c3a-7abc-8def-1234567890af";
const householdId = "018f47b7-6c3a-7abc-8def-1234567890b0";
const importedImportId = "018f47b7-6c3a-7abc-8def-1234567890b1";

const categories = [
  {
    id: categoryId,
    name: "Mercado",
    kind: "EXPENSE" as const,
    status: "ACTIVE" as const,
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function updateValue(
  overrides: Partial<ReviewableTransactionUpdateReadModel> = {},
): ReviewableTransactionUpdateReadModel {
  return {
    id: eventId,
    kind: "EXPENSE",
    status: "POSTED",
    origin: "IMPORT",
    description: "Compra revisada",
    categoryId,
    source: {
      origin: "IMPORT",
      import: {
        importId: importedImportId,
        rowNumber: 4,
        externalId: "bank-4",
      },
    },
    reviewState: "ORGANIZED",
    reviewReason: null,
    needsReview: false,
    updatedAt: "2026-08-30T12:00:00.000Z",
    ...overrides,
  };
}

describe("category quick-edit interactions", () => {
  it("ignores a second submit while pending and emits one command id", async () => {
    const pending = deferred<CategoryQuickEditActionResult>();
    const action = vi.fn<CategoryQuickEditAction>().mockReturnValue(pending.promise);

    render(
      <CategoryQuickEdit
        action={action}
        categories={categories}
        categoryId={null}
        financialEventId={eventId}
        kind="EXPENSE"
        testId="interaction-edit"
        refreshOnSuccess={false}
      />,
    );

    const form = screen.getByTestId("interaction-edit");
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(action).toHaveBeenCalledOnce();
    const firstCommand = action.mock.calls[0]?.[0];
    expect(firstCommand).toMatchObject({
      categoryId: null,
      financialEventId: eventId,
    });
    expect(firstCommand?.commandId).toEqual(expect.any(String));
    expect(
      (screen.getByTestId("interaction-edit-submit") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByTestId("interaction-edit-feedback").textContent).toContain(
      "Salvando categoria",
    );

    pending.resolve({ ok: true, value: { categoryId: null } });
    await waitFor(() => {
      expect(screen.getByTestId("interaction-edit-feedback").textContent).toContain(
        "Categoria atualizada",
      );
    });
    expect(action).toHaveBeenCalledOnce();
  });

  it("reuses commandId for a retry and rotates it after the edit changes", async () => {
    const action = vi
      .fn<CategoryQuickEditAction>()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "CONFLICT", message: "Tente novamente." },
      })
      .mockResolvedValueOnce({ ok: true, value: { categoryId } })
      .mockResolvedValueOnce({ ok: true, value: { categoryId: null } });

    render(
      <CategoryQuickEdit
        action={action}
        categories={categories}
        categoryId={null}
        financialEventId={eventId}
        kind="EXPENSE"
        testId="retry-edit"
        refreshOnSuccess={false}
      />,
    );

    const form = screen.getByTestId("retry-edit");
    fireEvent.change(screen.getByTestId("retry-edit-select"), {
      target: { value: categoryId },
    });
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.getByTestId("retry-edit-feedback").textContent).toContain(
        "Tente novamente.",
      );
    });

    const firstCommandId = action.mock.calls[0]?.[0].commandId;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.getByTestId("retry-edit-feedback").textContent).toContain(
        "Categoria atualizada",
      );
    });

    expect(action.mock.calls[1]?.[0].commandId).toBe(firstCommandId);
    expect(action.mock.calls[1]?.[0].categoryId).toBe(categoryId);

    fireEvent.change(screen.getByTestId("retry-edit-select"), {
      target: { value: "" },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(3));

    expect(action.mock.calls[2]?.[0].categoryId).toBeNull();
    expect(action.mock.calls[2]?.[0].commandId).not.toBe(firstCommandId);
  });
});

const importedTransaction: TransactionDetailReadModel = {
  id: eventId,
  householdId,
  kind: "EXPENSE",
  status: "POSTED",
  origin: "IMPORT",
  amountCents: "1250",
  occurredOn: "2026-08-15",
  description: "Compra importada",
  accountId,
  categoryId: null,
  account: {
    id: accountId,
    householdId,
    name: "Conta principal",
    type: "CHECKING",
    status: "ACTIVE",
    spendability: "GENERAL",
    liquidity: "IMMEDIATE",
    includeInNetWorth: true,
    trackingStartedOn: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  category: null,
  entry: {
    id: "018f47b7-6c3a-7abc-8def-1234567890b2",
    amountCents: "-1250",
    status: "POSTED",
    postedOn: "2026-08-15",
  },
  source: {
    origin: "IMPORT",
    import: {
      importId: importedImportId,
      rowNumber: 4,
      externalId: "bank-4",
    },
  },
  reviewState: "NEEDS_REVIEW",
  reviewReason: "UNCATEGORIZED",
  needsReview: true,
  createdAt: "2026-08-15T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:00.000Z",
  reversal: null,
};

describe("review detail interactions", () => {
  it("generates one commandId and blocks duplicate detail submits while pending", async () => {
    const pending = deferred<TransactionReviewResult<ReviewableTransactionUpdateReadModel>>();
    const action = vi.fn().mockReturnValue(pending.promise);

    render(
      <TransactionReviewDetailScreen
        backHref="/transactions?review=NEEDS_REVIEW"
        categories={categories}
        initialTransaction={importedTransaction}
        updateAction={action}
      />,
    );

    const form = screen.getByTestId("transaction-detail-edit-form-fields");
    fireEvent.change(screen.getByLabelText("Descrição"), {
      target: { value: "Compra importada revisada" },
    });
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    const command = action.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(command).toMatchObject({
      financialEventId: eventId,
      description: "Compra importada revisada",
      categoryId: null,
    });
    expect(command.commandId).toEqual(expect.any(String));
    expect(command).not.toHaveProperty("householdId");
    expect(command).not.toHaveProperty("amountCents");
    expect(
      (screen.getByTestId("transaction-detail-edit-form-submit") as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    pending.resolve({ ok: true, value: updateValue({
      description: "Compra importada revisada",
    }) });
    await waitFor(() => {
      expect(screen.getByTestId("review-detail-success").textContent).toContain(
        "Origem e efeito financeiro preservados",
      );
    });
    expect(action).toHaveBeenCalledOnce();
  });

  it("keeps imported lineage and financial fields read-only while updating metadata", async () => {
    const action = vi.fn().mockResolvedValue({
      ok: true,
      value: updateValue(),
    });

    render(
      <TransactionReviewDetailScreen
        backHref="/transactions?origin=IMPORT&cursor=next"
        categories={categories}
        initialTransaction={importedTransaction}
        updateAction={action}
      />,
    );

    expect(screen.getAllByText("Importado").length).toBeGreaterThan(0);
    expect(
      screen.getByTestId("transaction-source-details-import-id").textContent,
    ).toContain(importedImportId);
    expect(screen.getByTestId("review-readonly-guidance").textContent).toContain(
      "origem, lote, linha, identificador externo e entry não podem ser editados",
    );
    expect(
      screen.getByTestId("transaction-detail-edit-form-amount-input").getAttribute(
        "readonly",
      ),
    ).not.toBeNull();
    expect(
      screen.getByTestId("transaction-detail-edit-form-date-input").getAttribute(
        "readonly",
      ),
    ).not.toBeNull();
    expect(screen.queryByTestId("transaction-cancel-open")).toBeNull();

    fireEvent.change(screen.getByLabelText("Descrição"), {
      target: { value: "Compra revisada" },
    });
    fireEvent.change(screen.getByLabelText("Categoria (opcional)"), {
      target: { value: categoryId },
    });
    fireEvent.submit(screen.getByTestId("transaction-detail-edit-form-fields"));

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        financialEventId: eventId,
        description: "Compra revisada",
        categoryId,
      }),
    );
    expect(action.mock.calls[0]?.[0]).not.toHaveProperty("householdId");
    expect(action.mock.calls[0]?.[0]).not.toHaveProperty("amountCents");

    await waitFor(() => {
      expect(screen.getByTestId("review-detail-success").textContent).toContain(
        "Origem e efeito financeiro preservados",
      );
    });
    expect(
      screen.getByTestId("transaction-source-details-import-id").textContent,
    ).toContain(importedImportId);
    expect(screen.getByTestId("review-detail-badges").textContent).toContain(
      "Organizado",
    );
  });
});
