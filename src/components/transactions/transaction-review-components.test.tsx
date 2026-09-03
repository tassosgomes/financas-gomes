import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import type {
  AccountReadModel,
  CategoryReadModel,
} from "@/modules/accounts-categories/contracts";
import type {
  TransactionListItemReadModel,
  TransactionReviewSummaryReadModel,
} from "@/modules/transactions/review-contracts";

import {
  CategoryQuickEdit,
  filterCategoryQuickEditOptions,
} from "./category-quick-edit";
import {
  ReviewSummary,
  SourceDetails,
  TransactionReviewBadges,
} from "./transaction-review-badges";
import {
  reviewCountAfterCategoryEdit,
  TransactionReviewListScreen,
} from "./transaction-review-list-screen";

const householdId = "00000000-0000-7000-8000-000000071001";
const accountId = "00000000-0000-7000-8000-000000071101";
const expenseCategoryId = "00000000-0000-7000-8000-000000071201";
const archivedCategoryId = "00000000-0000-7000-8000-000000071202";
const incomeCategoryId = "00000000-0000-7000-8000-000000071203";
const manualId = "00000000-0000-7000-8000-000000071301";
const importedId = "00000000-0000-7000-8000-000000071302";
const manualEntryId = "00000000-0000-7000-8000-000000071401";
const importedEntryId = "00000000-0000-7000-8000-000000071402";
const importId = "00000000-0000-7000-8000-000000071501";
const cursor = "eyJ2IjoxLCJvY2N1cnJlZE9uIjoiMjAyNi0wOC0wMSJ9";

const account: AccountReadModel = {
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
};

const expenseCategory: CategoryReadModel = {
  id: expenseCategoryId,
  householdId,
  name: "Mercado",
  parentId: null,
  kind: "EXPENSE",
  status: "ACTIVE",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const archivedCategory: CategoryReadModel = {
  ...expenseCategory,
  id: archivedCategoryId,
  name: "Categoria antiga",
  status: "ARCHIVED",
};

const incomeCategory: CategoryReadModel = {
  ...expenseCategory,
  id: incomeCategoryId,
  name: "Salário",
  kind: "INCOME",
};

function reviewItem(
  input: Partial<TransactionListItemReadModel> &
    Pick<TransactionListItemReadModel, "id" | "origin" | "categoryId" | "kind">,
): TransactionListItemReadModel {
  const isImported = input.origin === "IMPORT";
  const id = input.id;
  return {
    id,
    householdId,
    kind: input.kind,
    status: input.status ?? "POSTED",
    origin: input.origin,
    amountCents: input.amountCents ?? "1250",
    occurredOn: input.occurredOn ?? "2026-08-15",
    description: input.description ?? (isImported ? "Compra importada" : "Compra manual"),
    accountId,
    categoryId: input.categoryId,
    account,
    category:
      input.categoryId === expenseCategoryId
        ? expenseCategory
        : input.categoryId === archivedCategoryId
          ? archivedCategory
          : input.categoryId === incomeCategoryId
            ? incomeCategory
            : null,
    entry: {
      id: isImported ? importedEntryId : manualEntryId,
      amountCents: input.kind === "EXPENSE" ? "-1250" : "1250",
      status: "POSTED",
      postedOn: input.occurredOn ?? "2026-08-15",
    },
    source:
      input.source ??
      (isImported
        ? {
            origin: "IMPORT",
            import: { importId, rowNumber: 4, externalId: "bank-4" },
          }
        : { origin: "MANUAL", import: null }),
    reviewState:
      input.reviewState ?? (input.categoryId === null ? "NEEDS_REVIEW" : "ORGANIZED"),
    reviewReason:
      input.reviewReason ?? (input.categoryId === null ? "UNCATEGORIZED" : null),
    needsReview: input.needsReview ?? input.categoryId === null,
    createdAt: input.createdAt ?? "2026-08-15T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-08-15T00:00:00.000Z",
  };
}

describe("review UI contracts", () => {
  it("renders source, review and missing-category labels from the read model", () => {
    const html = renderToStaticMarkup(
      <>
        <TransactionReviewBadges
          categoryId={null}
          origin="IMPORT"
          reviewState="NEEDS_REVIEW"
          testId="review-badges"
        />
        <SourceDetails
          source={{
            origin: "IMPORT",
            import: { importId, rowNumber: 4, externalId: "bank-4" },
          }}
          testId="source"
        />
        <SourceDetails
          source={{ origin: "MANUAL", import: null }}
          testId="manual-source"
        />
      </>,
    );

    expect(html).toContain("Importado");
    expect(html).toContain("Revisar");
    expect(html).toContain("Sem categoria");
    expect(html).toContain(importId);
    expect(html).toContain("Linha importada");
    expect(html).toContain("bank-4");
    expect(html).toContain("Este lançamento foi criado manualmente.");
    expect(html).not.toMatch(/fingerprint|token|CSV bruto|payload de staging/iu);
  });

  it("reports the server summary and keeps every canonical filter in row and next-page links", () => {
    const manual = reviewItem({
      id: manualId,
      origin: "MANUAL",
      kind: "EXPENSE",
      categoryId: null,
    });
    const imported = reviewItem({
      id: importedId,
      origin: "IMPORT",
      kind: "INCOME",
      categoryId: incomeCategoryId,
      description: "Salário importado",
    });
    const summary: TransactionReviewSummaryReadModel = { needsReviewCount: 3 };
    const query = {
      from: "2026-08-01",
      to: "2026-08-31",
      accountId,
      categoryId: null,
      kind: "EXPENSE" as const,
      status: "POSTED" as const,
      origin: "IMPORT" as const,
      review: "NEEDS_REVIEW" as const,
      search: "café",
      limit: 25,
      cursor,
    };

    const html = renderToStaticMarkup(
      <TransactionReviewListScreen
        accounts={[account]}
        categories={[expenseCategory, incomeCategory]}
        initialTransactions={[manual, imported]}
        pageInfo={{ hasNextPage: true, nextCursor: cursor }}
        query={query}
        summary={summary}
      />,
    );

    expect(html).toContain(">3</strong>lançamentos para revisar");
    expect(html).toContain("Importado");
    expect(html).toContain("Manual");
    expect(html).toContain("Sem categoria");
    expect(html).toContain("search=caf%C3%A9");
    expect(html).toContain("cursor=");
    expect(html).toContain("transactions-review-next-page");
    expect(html).toContain("categoryId=__none");
    expect(html).toContain("review=NEEDS_REVIEW");
  });

  it("keeps no-account and no-category guidance visible for the review route", () => {
    const html = renderToStaticMarkup(
      <TransactionReviewListScreen
        accounts={[]}
        categories={[]}
        initialTransactions={[]}
        query={{}}
      />,
    );

    expect(html).toContain("transactions-review-no-accounts");
    expect(html).toContain("transactions-review-no-categories");
    expect(html).toContain("Nenhuma categoria cadastrada");
    expect(html).toContain("Ainda não há lançamentos");
  });

  it("offers only compatible active categories and preserves an archived current value as history", () => {
    const options = filterCategoryQuickEditOptions(
      [expenseCategory, archivedCategory, incomeCategory],
      "EXPENSE",
      archivedCategoryId,
      archivedCategory,
    );
    expect(options.map((option) => option.id)).toEqual([
      expenseCategoryId,
      archivedCategoryId,
    ]);

    const html = renderToStaticMarkup(
      <CategoryQuickEdit
        action={vi.fn()}
        categories={options}
        categoryId={archivedCategoryId}
        currentCategory={archivedCategory}
        financialEventId={manualId}
        kind="EXPENSE"
        testId="quick-edit"
      />,
    );

    expect(html).toContain('aria-describedby="quick-edit-description quick-edit-history"');
    expect(html).toContain("Categoria antiga (arquivada)");
    expect(html).toContain("disabled");
    expect(html).toContain("Sem categoria");
    expect(html).toContain("Escolha uma categoria compatível");
  });

  it("uses an accessible live region for the server-provided summary count", () => {
    const html = renderToStaticMarkup(
      <ReviewSummary needsReviewCount={0} testId="summary" />,
    );

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-testid="summary-count"');
    expect(html).toContain("0");
    expect(html).toContain("lançamentos para revisar");
  });

  it("changes the pending count only after a real category transition", () => {
    const pending = {
      categoryId: null,
      needsReview: true,
      status: "POSTED" as const,
    };
    const organized = {
      categoryId: expenseCategoryId,
      needsReview: false,
      status: "POSTED" as const,
    };

    expect(reviewCountAfterCategoryEdit(3, pending, expenseCategoryId)).toBe(2);
    expect(reviewCountAfterCategoryEdit(3, organized, null)).toBe(4);
    expect(reviewCountAfterCategoryEdit(3, pending, null)).toBe(3);
    expect(reviewCountAfterCategoryEdit(0, pending, expenseCategoryId)).toBe(0);
    expect(reviewCountAfterCategoryEdit(3, pending, undefined)).toBe(3);
  });
});
