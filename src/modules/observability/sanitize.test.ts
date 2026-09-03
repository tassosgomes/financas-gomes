import { describe, expect, it } from "vitest";

import {
  parseSentryConfig,
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryTransaction,
  toSafeObservabilityContext,
} from "@/modules/observability";

describe("Sentry configuration", () => {
  it("fails closed for an empty or invalid DSN", () => {
    expect(parseSentryConfig({ dsn: "" }).dsn).toBeUndefined();
    expect(parseSentryConfig({ dsn: "javascript:alert(1)" }).dsn).toBeUndefined();
    expect(
      parseSentryConfig({
        dsn: "https://public@example.ingest.sentry.io/123",
        environment: " preview ",
        release: " release-123 ",
      }),
    ).toEqual({
      dsn: "https://public@example.ingest.sentry.io/123",
      environment: "preview",
      release: "release-123",
    });
  });
});

describe("Sentry event sanitization", () => {
  it("allow-lists operational data and removes request and financial input", () => {
    const sanitized = sanitizeSentryEvent({
      event_id: "opaque-event-id",
      message: "saldo 1234 e token=invite-secret",
      exception: {
        values: [
          {
            type: "UnexpectedError",
            value: "amount=1234 token=invite-secret",
            stacktrace: {
              frames: [
                {
                  filename: "src/modules/example.ts",
                  function: "createFinancialEvent",
                  vars: { payload: "account-name" },
                  context_line: "const amount = 1234",
                },
              ],
            },
          },
        ],
      },
      request: {
        url: "https://example.test/api/events?token=invite-secret",
        method: "POST",
        headers: {
          authorization: "Bearer invite-secret",
          cookie: "session=secret",
        },
        cookies: { session: "secret" },
        query_string: { amount: "1234" },
        data: { description: "account-name", amount: 1234 },
      },
      breadcrumbs: [
        {
          category: "http",
          message: "account-name",
          data: {
            method: "POST",
            url: "https://example.test/events?amount=1234",
            status_code: 500,
            request_body_size: 42,
          },
        },
      ],
      contexts: {
        observability: {
          event: "financial_event_failed",
          amount: 1234,
          amountCents: 1234,
          limitCents: 9000,
          duration_ms: 42,
          status_code: 500,
          token: "invite-secret",
        },
        device: { name: "user-device" },
      },
      tags: {
        event: "financial_event_failed",
        amount: "1234",
        request_id: "opaque-request-id",
      },
      extra: { payload: "financial-payload" },
      user: { id: "opaque-user-id", username: "user@example.test" },
    });

    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain("invite-secret");
    expect(serialized).not.toContain("account-name");
    expect(serialized).not.toContain("1234");
    expect(serialized).not.toContain("amountCents");
    expect(serialized).not.toContain("limitCents");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("cookie");
    expect(serialized).not.toContain("payload");
    expect(sanitized.request).toEqual({ url: "/api/events", method: "POST" });
    expect(sanitized.user).toBeUndefined();
    expect(sanitized.extra).toBeUndefined();
    expect(sanitized.exception?.values?.[0]?.value).toBe(
      "Unexpected application error",
    );
    expect(sanitized.exception?.values?.[0]?.stacktrace?.frames?.[0]?.vars).toBeUndefined();
    expect(sanitized.tags).toEqual({
      event: "financial_event_failed",
      request_id: "opaque-request-id",
    });
    expect(sanitized.contexts?.observability).toEqual({
      event: "financial_event_failed",
      duration_ms: 42,
      status_code: 500,
    });
  });

  it("keeps trace timing while removing span payloads and identifiers from routes", () => {
    const sanitized = sanitizeSentryTransaction({
      type: "transaction",
      event_id: "opaque-event-id",
      transaction: "GET /transactions/123?token=invite-secret",
      request: {
        url: "https://example.test/transactions/123?amount=1234",
        method: "GET",
        headers: { authorization: "Bearer invite-secret" },
        data: { description: "private description" },
      },
      spans: [
        {
          trace_id: "trace-id",
          span_id: "span-id",
          parent_span_id: "parent-span-id",
          start_timestamp: 1,
          timestamp: 2,
          op: "http.client",
          description:
            "GET https://example.test/api/accounts/123?amount=1234",
          data: {
            amount: 1234,
            "http.url": "https://example.test/api/accounts/123?token=invite-secret",
          },
        },
      ],
      measurements: {
        lcp: { value: 123, unit: "millisecond" },
        amount: { value: 1234, unit: "none" },
      },
    });

    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain("invite-secret");
    expect(serialized).not.toContain("private description");
    expect(serialized).not.toContain("1234");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain('"amount"');
    expect(sanitized?.transaction).toBe("GET /transactions/:id");
    expect(sanitized?.request).toEqual({
      url: "/transactions/:id",
      method: "GET",
    });
    expect(sanitized?.spans?.[0]).toMatchObject({
      op: "http.client",
      description: "GET /api/accounts/:id",
      data: {},
    });
    expect(sanitized?.measurements).toEqual({
      lcp: { value: 123, unit: "millisecond" },
    });
  });

  it("maps only the explicit operational context", () => {
    expect(
      toSafeObservabilityContext({
        event: "invite_created",
        useCase: "createInvite",
        durationMs: 42.4,
        requestId: "request-id",
        userId: "user-id",
        householdId: "household-id",
        route: "/api/invites?token=raw-token",
        statusCode: 201,
      }),
    ).toEqual({
      tags: {
        event: "invite_created",
        use_case: "createInvite",
        request_id: "request-id",
        user_id: "user-id",
        household_id: "household-id",
        route: "/api/invites",
        duration_ms: 42,
        status_code: 201,
      },
      context: {
        event: "invite_created",
        use_case: "createInvite",
        request_id: "request-id",
        user_id: "user-id",
        household_id: "household-id",
        route: "/api/invites",
        duration_ms: 42,
        status_code: 201,
      },
    });
  });

  it("keeps transaction correlation and kind while dropping financial context", () => {
    const safe = toSafeObservabilityContext({
      event: "transaction_create_expense_unexpected_error",
      useCase: "transactions.create.expense",
      operation: "create",
      entityType: "transaction",
      eventId: "018f4f26-7c1b-7abc-8a7f-56d2b1a89f0e",
      transactionKind: "EXPENSE",
      amount: "123456",
      description: "private description",
      accountName: "Main account",
      categoryName: "Private category",
      payload: { amountCents: "123456" },
    } as never);

    expect(safe.tags).toEqual({
      event: "transaction_create_expense_unexpected_error",
      use_case: "transactions.create.expense",
      operation: "create",
      entity_type: "transaction",
      event_id: "018f4f26-7c1b-7abc-8a7f-56d2b1a89f0e",
      transaction_kind: "EXPENSE",
    });
    expect(safe.context).toEqual(safe.tags);
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("Main account");
    expect(serialized).not.toContain("payload");
  });

  it("keeps only technical transaction breadcrumb data", () => {
    const breadcrumb = sanitizeSentryBreadcrumb({
      type: "info",
      category: "transactions.cancel.manual",
      message: "description=private account=checking",
      data: {
        operation: "cancel",
        transaction_kind: "MANUAL",
        event_id: "018f4f26-7c1b-7abc-8a7f-56d2b1a89f0e",
        outcome: "unexpected_error",
        duration_ms: 13.5,
        error_code: "EVENT_NOT_POSTED",
        amount: "123456",
        description: "private description",
        account: "checking",
        category: "private category",
        payload: { amountCents: "123456" },
      },
    });

    expect(breadcrumb).toEqual({
      type: "info",
      category: "transactions.cancel.manual",
      data: {
        operation: "cancel",
        transaction_kind: "MANUAL",
        event_id: "018f4f26-7c1b-7abc-8a7f-56d2b1a89f0e",
        outcome: "unexpected_error",
        duration_ms: 14,
        error_code: "EVENT_NOT_POSTED",
      },
    });
    expect(JSON.stringify(breadcrumb)).not.toContain("private");
    expect(JSON.stringify(breadcrumb)).not.toContain("123456");
  });
});
