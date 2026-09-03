import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/observability/server", () => ({
  addBreadcrumbSafely: vi.fn(),
  captureServerException: vi.fn(),
}));

import { captureServerException } from "@/modules/observability/server";

import {
  createTransactionReviewActionHandlers,
  createTransactionReviewReadActionHandlers,
  createTransactionReviewUpdateActionHandlers,
  type TransactionReviewActionDependencies,
  type TransactionReviewActionPort,
} from "./review-adapters";
import type {
  TransactionDetailReadModel,
  TransactionListReadModel,
  TransactionReviewSummaryReadModel,
} from "./review-contracts";
import type { ReviewableTransactionUpdateReadModel } from "./review-use-cases";

const context = {
  userId: "user-1",
  householdId: "household-1",
} as const;

const eventId = "018f47b7-6c3a-7abc-8def-1234567890ad";
const categoryId = "018f47b7-6c3a-7abc-8def-1234567890ae";

const updateValue: ReviewableTransactionUpdateReadModel = {
  id: eventId,
  kind: "EXPENSE",
  status: "POSTED",
  origin: "MANUAL",
  description: "Descrição atualizada",
  categoryId,
  source: { origin: "MANUAL", import: null },
  reviewState: "ORGANIZED",
  reviewReason: null,
  needsReview: false,
  updatedAt: "2026-08-30T12:00:00.000Z",
};

const listValue = {
  items: [],
  pageInfo: { hasNextPage: false, nextCursor: null },
} satisfies TransactionListReadModel;

const detailValue = {
  id: eventId,
  householdId: context.householdId,
  kind: "EXPENSE",
  status: "POSTED",
  origin: "MANUAL",
  amountCents: "100",
  occurredOn: "2026-08-30",
  description: "Despesa",
  accountId: "018f47b7-6c3a-7abc-8def-1234567890af",
  categoryId,
  account: {} as TransactionDetailReadModel["account"],
  category: null,
  entry: {
    id: "018f47b7-6c3a-7abc-8def-1234567890b0",
    amountCents: "-100",
    status: "POSTED",
    postedOn: "2026-08-30",
  },
  source: { origin: "MANUAL", import: null },
  reviewState: "ORGANIZED",
  reviewReason: null,
  needsReview: false,
  createdAt: "2026-08-30T11:00:00.000Z",
  updatedAt: "2026-08-30T12:00:00.000Z",
  reversal: null,
} satisfies TransactionDetailReadModel;

const summaryValue = {
  needsReviewCount: 2,
} satisfies TransactionReviewSummaryReadModel;

function result<T>(value: T) {
  return { ok: true as const, value };
}

type MockedReviewPort = Omit<TransactionReviewActionPort, "list" | "detail" | "summary" | "updateReviewableTransaction"> & {
  list: ReturnType<typeof vi.fn>;
  detail: ReturnType<typeof vi.fn>;
  summary: ReturnType<typeof vi.fn>;
  updateReviewableTransaction: ReturnType<typeof vi.fn>;
};

function ports(): MockedReviewPort {
  return {
    list: vi.fn().mockResolvedValue(result(listValue)),
    detail: vi.fn().mockResolvedValue(result(detailValue)),
    summary: vi.fn().mockResolvedValue(result(summaryValue)),
    updateReviewableTransaction: vi.fn().mockResolvedValue(result(updateValue)),
  };
}

type TestDependencies = Omit<
  TransactionReviewActionDependencies,
  "resolveContext" | "port" | "revalidateReview"
> & {
  resolveContext: ReturnType<typeof vi.fn>;
  port: MockedReviewPort;
  revalidateReview: ReturnType<typeof vi.fn>;
};

function dependencies(port: MockedReviewPort = ports()): TestDependencies {
  return {
    resolveContext: vi.fn().mockResolvedValue(context),
    port,
    revalidateReview: vi.fn(),
  };
}

describe("review Server Action adapters", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(captureServerException).mockClear();
  });

  it("rejects unknown list fields before session/database work", async () => {
    const deps = dependencies();
    const handlers = createTransactionReviewReadActionHandlers(deps);

    const value = await handlers.list({ householdId: context.householdId });

    expect(value).toMatchObject({ ok: false, error: { code: "INVALID_QUERY" } });
    expect(deps.resolveContext).not.toHaveBeenCalled();
    expect(deps.port.list).not.toHaveBeenCalled();
  });

  it("canonicalizes list filters and passes only server context to the read port", async () => {
    const deps = dependencies();
    const handlers = createTransactionReviewReadActionHandlers(deps);

    await expect(
      handlers.list({
        dateFrom: "2026-08-01",
        periodEnd: "2026-08-31",
        categoryId: "__none",
        origin: "IMPORT",
        review: "NEEDS_REVIEW",
        search: "  café  ",
        limit: "7",
      }),
    ).resolves.toEqual(result(listValue));

    expect(deps.port.list).toHaveBeenCalledWith(context, {
      from: "2026-08-01",
      to: "2026-08-31",
      categoryId: null,
      origin: "IMPORT",
      review: "NEEDS_REVIEW",
      search: "café",
      limit: 7,
    });
  });

  it("maps a missing detail to the stable opaque not-found code", async () => {
    const deps = dependencies();
    deps.port.detail.mockResolvedValue(undefined);
    const handlers = createTransactionReviewReadActionHandlers(deps);

    await expect(handlers.detail(eventId)).resolves.toEqual({
      ok: false,
      error: {
        code: "EVENT_NOT_FOUND",
        message: "O lançamento não foi encontrado.",
        field: "financialEventId",
      },
    });
  });

  it("ignores pagination/review controls when parsing summary input", async () => {
    const deps = dependencies();
    const handlers = createTransactionReviewReadActionHandlers(deps);

    await handlers.summary({
      categoryId: null,
      review: "NEEDS_REVIEW",
      limit: 1,
      cursor: "not-used-by-summary",
    });

    expect(deps.port.summary).toHaveBeenCalledWith(context, {
      categoryId: null,
    });
  });

  it("maps category-null/update commands and invalidates only after success", async () => {
    const deps = dependencies();
    const handlers = createTransactionReviewUpdateActionHandlers(deps);

    await expect(
      handlers.update({
        commandId: "review-command-1",
        financialEventId: eventId,
        categoryId: null,
      }),
    ).resolves.toEqual(result(updateValue));

    expect(deps.port.updateReviewableTransaction).toHaveBeenCalledWith(context, {
      commandId: "review-command-1",
      financialEventId: eventId,
      categoryId: null,
    });
    expect(deps.revalidateReview).toHaveBeenCalledWith(updateValue);

    deps.revalidateReview.mockClear();
    deps.port.updateReviewableTransaction.mockResolvedValue({
      ok: false,
      error: {
        code: "CATEGORY_NOT_FOUND",
        message: "database detail must not cross the boundary",
      },
    });

    await expect(
      handlers.update({
        commandId: "review-command-2",
        financialEventId: eventId,
        categoryId: null,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "CATEGORY_NOT_FOUND" } });
    expect(deps.revalidateReview).not.toHaveBeenCalled();
  });

  it("maps unauthenticated context without invoking a port", async () => {
    const deps = dependencies();
    deps.resolveContext.mockRejectedValue(new AuthErrorForTest());
    const handlers = createTransactionReviewUpdateActionHandlers(deps);

    await expect(
      handlers.update({
        commandId: "review-command-auth",
        financialEventId: eventId,
        categoryId: null,
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "É necessário entrar para acessar este recurso.",
      },
    });
    expect(deps.port.updateReviewableTransaction).not.toHaveBeenCalled();
  });

  it("preserves command-id reuse as an expected error without revalidation", async () => {
    const deps = dependencies();
    deps.port.updateReviewableTransaction.mockResolvedValue({
      ok: false,
      error: {
        code: "COMMAND_ID_REUSED",
        message: "O identificador da operação já foi utilizado.",
      },
    });
    const handlers = createTransactionReviewUpdateActionHandlers(deps);

    await expect(
      handlers.update({
        commandId: "review-command-reused",
        financialEventId: eventId,
        description: "Descrição da tentativa conflitante",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "COMMAND_ID_REUSED",
        message: "O identificador da operação já foi utilizado.",
      },
    });
    expect(deps.revalidateReview).not.toHaveBeenCalled();
  });

  it("captures technical failures with only opaque operation metadata", async () => {
    const deps = dependencies();
    const error = new Error("SQL amount=999 description=private account=checking");
    deps.port.updateReviewableTransaction.mockRejectedValue(error);
    const handlers = createTransactionReviewActionHandlers(deps);

    await expect(
      handlers.update({
        commandId: "review-command-technical",
        financialEventId: eventId,
        description: "private description",
      }),
    ).rejects.toBe(error);

    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        event: "transaction_review_update_unexpected_error",
        useCase: "transactions.review.update",
        eventId,
        errorCode: "UPDATE_FAILED",
      }),
    );
    const sentryContext = vi.mocked(captureServerException).mock.calls[0]?.[1];
    expect(JSON.stringify(sentryContext)).not.toContain("private");
    expect(JSON.stringify(sentryContext)).not.toContain("999");
    expect(JSON.stringify(sentryContext)).not.toContain("review-command");
    expect(deps.revalidateReview).not.toHaveBeenCalled();
  });

  it("rejects Date/BigInt records returned by a malformed port", async () => {
    const deps = dependencies();
    deps.port.list.mockResolvedValue({
      items: [{ createdAt: new Date(), amountCents: BigInt("1") }],
      pageInfo: { hasNextPage: false, nextCursor: null },
    });
    const handlers = createTransactionReviewReadActionHandlers(deps);

    await expect(handlers.list()).rejects.toThrow("não serializáveis");
    expect(captureServerException).toHaveBeenCalledOnce();
  });
});

/** Keeps the context mapping test independent from auth implementation details. */
class AuthErrorForTest extends Error {
  readonly code = "UNAUTHENTICATED" as const;
}
