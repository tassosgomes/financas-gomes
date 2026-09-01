import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/observability/server", () => ({
  addBreadcrumbSafely: vi.fn(),
  captureServerException: vi.fn(),
}));

import {
  addBreadcrumbSafely,
  captureServerException,
} from "@/modules/observability/server";
import { FinancialContextError } from "@/modules/households/contracts";

import {
  S06_CREDIT_CARD_OPERATIONS,
  classifyS06Error,
  createS06CreditCardOperation,
  isExpectedS06Error,
  logS06CreditCardOperation,
  measureS06Query,
  reportS06UnexpectedError,
  sanitizeS06CreditCardLog,
  toS06ErrorEnvelope,
  toS06ObservabilityContext,
  withS06CreditCardObservability,
} from "./s06";

const requestId = "request-opaque";
const householdId = "household-opaque";
const cardId = "card-opaque";
const purchaseId = "purchase-opaque";
const eventId = "event-opaque";

describe("S06 credit-card observability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(addBreadcrumbSafely).mockClear();
    vi.mocked(captureServerException).mockClear();
  });

  it("keeps the operation contract technical and drops financial fields", () => {
    const operation = createS06CreditCardOperation(
      "credit_card.purchase.create",
      {
        requestId,
        householdId,
        cardId,
        purchaseId,
        eventId,
        installmentCount: 3,
        amountCents: "999999" as never,
        description: "private purchase description",
        cardName: "Cartão privado",
        accountName: "Conta privada",
        merchant: "Comerciante privado",
        limitCents: "1000000",
        occurredOn: "2026-08-30",
        token: "private-token",
        payload: { amountCents: "999999" },
      } as never,
    );

    expect(operation).toMatchObject({
      operation: "credit_card.purchase.create",
      stage: "purchase",
      requestId,
      householdId,
      cardId,
      purchaseId,
      eventId,
      installmentCount: 3,
    });

    const serialized = JSON.stringify(operation);
    for (const forbidden of [
      "999999",
      "private purchase description",
      "Cartão privado",
      "Conta privada",
      "Comerciante privado",
      "1000000",
      "2026-08-30",
      "private-token",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(operation).not.toHaveProperty("amountCents");
    expect(operation).not.toHaveProperty("description");
    expect(operation).not.toHaveProperty("cardName");
    expect(operation).not.toHaveProperty("payload");
  });

  it("derives event/use-case/stage and allow-lists IDs, counts and timing", () => {
    const safe = sanitizeS06CreditCardLog({
      operation: "credit_card.statement.read",
      stage: "statement",
      outcome: "success",
      requestId,
      householdId,
      cardId,
      installmentCount: 4,
      statementItemCount: 4,
      durationMs: 18.6,
      statusCode: 200,
      event: "caller-injected-event",
      useCase: "caller-injected-use-case",
      amountCents: "123456",
      description: "private description",
      cardName: "private card name",
      accountName: "private account name",
      merchant: "private merchant",
      limitCents: "999999",
      occurredOn: "2026-08-30",
      token: "private token",
      payload: { amountCents: "123456" },
    });

    expect(safe).toEqual({
      event: "s06_credit_card_statement_read_success",
      useCase: "credit_card.statement.read",
      operation: "credit_card.statement.read",
      stage: "statement",
      outcome: "success",
      requestId,
      householdId,
      cardId,
      installmentCount: 4,
      statementItemCount: 4,
      durationMs: 19,
      statusCode: 200,
    });

    const serialized = JSON.stringify(safe);
    for (const forbidden of [
      "caller-injected",
      "123456",
      "private description",
      "private card name",
      "private account name",
      "private merchant",
      "999999",
      "2026-08-30",
      "private token",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("classifies archived/validation/context failures as expected without Sentry", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = createS06CreditCardOperation("credit_card.create", {
      requestId,
      householdId,
    });
    const errors = [
      { code: "CREDIT_CARD_ARCHIVED", message: "card=private" },
      { code: "BILLING_RULE_OVERLAP", message: "limit=private" },
      { code: "COMMAND_ID_REUSED", message: "payload amount=999999" },
      new FinancialContextError("HOUSEHOLD_MEMBERSHIP_REQUIRED"),
    ];

    for (const error of errors) {
      expect(isExpectedS06Error(error)).toBe(true);
      expect(classifyS06Error(error).outcome).toBe("expected_error");
      reportS06UnexpectedError(error, operation, { durationMs: 4 });
    }

    expect(captureServerException).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(errors.length);
    const serialized = info.mock.calls.map(([value]) => String(value)).join("\n");
    expect(serialized).toContain('"outcome":"expected_error"');
    expect(serialized).toContain('"errorCode":"CREDIT_CARD_ARCHIVED"');
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("999999");
    expect(toS06ErrorEnvelope({ code: "CREDIT_CARD_ARCHIVED" })).toEqual({
      ok: false,
      error: { code: "CREDIT_CARD_ARCHIVED" },
    });
  });

  it("captures unexpected failures with only the permitted technical context", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error(
      "database failure amount=999999 description=private card name=private",
    );
    const operation = createS06CreditCardOperation(
      "credit_card.purchase.cancel",
      {
        requestId,
        householdId,
        cardId,
        purchaseId,
        eventId,
      },
    );

    const classification = reportS06UnexpectedError(error, operation, {
      durationMs: 27,
      technicalErrorCode: "CANCEL_PERSISTENCE_FAILED",
    });

    expect(classification).toEqual({
      outcome: "unexpected_error",
      errorCode: "CANCEL_PERSISTENCE_FAILED",
    });
    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        event: "s06_credit_card_purchase_cancel_unexpected_error",
        useCase: "credit_card.purchase.cancel",
        operation: "credit_card.purchase.cancel",
        entityType: "credit_card",
        entityId: purchaseId,
        eventId,
        requestId,
        householdId,
        stage: "purchase",
        errorCode: "CANCEL_PERSISTENCE_FAILED",
        durationMs: 27,
      }),
    );
    expect(errorLog).toHaveBeenCalledOnce();
    const serialized = String(errorLog.mock.calls[0]?.[0]);
    expect(serialized).toContain('"outcome":"unexpected_error"');
    expect(serialized).toContain('"errorCode":"CANCEL_PERSISTENCE_FAILED"');
    expect(serialized).not.toContain("999999");
    expect(serialized).not.toContain("private");

    const context = toS06ObservabilityContext(operation, "unexpected_error", {
      durationMs: 27,
      technicalErrorCode: "CANCEL_PERSISTENCE_FAILED",
    });
    expect(JSON.stringify(context)).not.toContain("amount");
    expect(JSON.stringify(context)).not.toContain("description");
  });

  it("exposes the closed operation vocabulary and rejects unknown stages", () => {
    expect(S06_CREDIT_CARD_OPERATIONS).toContain("credit_card.payment.create");
    expect(
      sanitizeS06CreditCardLog({
        operation: "credit_card.payment.create",
        stage: "purchase",
        outcome: "success",
        description: "private",
      }),
    ).toBeUndefined();
    expect(
      sanitizeS06CreditCardLog({
        operation: "credit_card.delete" as never,
        outcome: "success",
      }),
    ).toBeUndefined();
  });

  it("sends breadcrumbs through the same technical allow-list", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = createS06CreditCardOperation("credit_card.payment.create", {
      requestId,
      householdId,
      cardId,
      eventId,
      installmentCount: 1,
    });

    logS06CreditCardOperation(operation, "success", { durationMs: 12 });

    expect(addBreadcrumbSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "credit_card.payment.create",
        data: expect.objectContaining({
          stage: "payment",
          operation: "credit_card.payment.create",
          outcome: "success",
          request_id: requestId,
          account_id: cardId,
          event_id: eventId,
          installment_count: 1,
        }),
      }),
    );
    expect(info).toHaveBeenCalledOnce();
  });

  it("treats every domain validation/conflict code as an expected result", () => {
    for (const code of [
      "INVALID_NAME",
      "BILLING_RULE_NOT_APPLICABLE",
      "INVALID_BILLING_DUE_OVERRIDE",
      "SCHEDULE_INVARIANT_VIOLATION",
      "INSTALLMENT_MUTATION_FORBIDDEN",
      "PAYMENT_INSTALLMENT_FORBIDDEN",
    ]) {
      expect(classifyS06Error({ code, message: "SQL/private payload" })).toEqual({
        outcome: "expected_error",
        errorCode: code,
      });
    }
  });

  it("wraps Result failures without duplicating client instrumentation", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = createS06CreditCardOperation("credit_card.create", {
      requestId,
      householdId,
    });
    const value = await withS06CreditCardObservability(
      operation,
      async () => ({
        ok: false as const,
        error: { code: "CARD_ARCHIVED", message: "private details" },
      }),
      {
        now: vi
          .fn<() => number>()
          .mockReturnValueOnce(100)
          .mockReturnValueOnce(112),
      },
    );

    expect(value).toEqual({
      ok: false,
      error: { code: "CARD_ARCHIVED", message: "private details" },
    });
    expect(captureServerException).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    expect(String(info.mock.calls[0]?.[0])).not.toContain("private details");
  });

  it("captures thrown technical failures with generated correlation and safe IDs", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const operation = createS06CreditCardOperation("credit_card.payment.create", {
      householdId,
      cardId,
      paymentId: "payment-opaque",
    });

    await expect(
      withS06CreditCardObservability(
        operation,
        () => {
          throw new Error("query amount=999999 description=private");
        },
        {
          technicalErrorCode: "PAYMENT_PERSISTENCE_FAILED",
          now: vi
            .fn<() => number>()
            .mockReturnValueOnce(100)
            .mockReturnValueOnce(125),
        },
      ),
    ).rejects.toThrow("query amount=999999");

    expect(captureServerException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        operation: "credit_card.payment.create",
        errorCode: "PAYMENT_PERSISTENCE_FAILED",
        householdId,
        cardId,
        paymentId: "payment-opaque",
        requestId: expect.any(String),
        durationMs: 25,
      }),
    );
    expect(errorLog).toHaveBeenCalledOnce();
    expect(String(errorLog.mock.calls[0]?.[0])).not.toContain("999999");
    expect(String(errorLog.mock.calls[0]?.[0])).not.toContain("private");
  });

  it("emits only aggregate metadata for slow reads and never accepts SQL", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const records: unknown[] = [];
    const operation = createS06CreditCardOperation("credit_card.statement.read", {
      requestId,
      householdId,
      cardId,
    });

    await measureS06Query(
      operation,
      () => ({ rows: [{ amountCents: "999999", description: "private" }] }),
      {
        thresholdMs: 250,
        statementItemCount: 1,
        query: "SELECT amount_cents FROM private_statement" as never,
        onRecord: (record: unknown) => records.push(record),
        now: vi
          .fn<() => number>()
          .mockReturnValueOnce(100)
          .mockReturnValueOnce(400),
      } as never,
    );

    expect(warn).toHaveBeenCalledOnce();
    expect(records).toHaveLength(1);
    const serialized = JSON.stringify(records[0]);
    expect(serialized).toContain('"slowQuery":true');
    expect(serialized).toContain('"statementItemCount":1');
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("999999");
    expect(serialized).not.toContain("private");
  });
});
