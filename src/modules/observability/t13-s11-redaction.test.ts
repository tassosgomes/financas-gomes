import { describe, expect, it } from "vitest";

import {
  S11_CONTRACT_VERSION,
  classifyS11Error,
  createS11Operation,
  sanitizeS11Log,
  toS11ErrorEnvelope,
  toS11ObservabilityContext,
} from "./s11";

describe("T13 S11 observability boundary", () => {
  it("retains only versioned aggregate metadata when forbidden fields are supplied", () => {
    const safe = sanitizeS11Log({
      operation: "export.dataset",
      stage: "dataset",
      outcome: "success",
      requestId: "t13-request",
      executionId: "018f1a2b-0000-7000-8000-000000000001",
      result: "SUCCESS",
      datasetId: "accounts",
      rowCount: 500,
      byteCount: 8192,
      amountCents: "123456",
      balanceCents: "123456",
      money: "123456",
      amount: "1234.56",
      balance: "1234.56",
      name: "Nome financeiro privado",
      description: "Descrição financeira privada",
      category: "Categoria privada",
      email: "membro@example.com",
      householdId: "household-private",
      userId: "user-private",
      fileName: "conta-corrente-privada.csv",
      storageKey: "r2://bucket/private/export.zip",
      databaseUrl: "postgresql://user:pass@host/db",
      dsn: "postgresql://user:pass@host/db",
      sql: "select amount_cents from financial_events",
      payload: { amountCents: "123456", description: "private" },
      cookie: "session=private",
      authorization: "Bearer private-token",
      token: "secret-token",
    });

    expect(safe).toMatchObject({
      operation: "export.dataset",
      stage: "dataset",
      contractVersion: S11_CONTRACT_VERSION,
      datasetId: "accounts",
      rowCount: 500,
      byteCount: 8192,
    });
    expect(safe).not.toHaveProperty("amountCents");
    expect(safe).not.toHaveProperty("balanceCents");
    expect(safe).not.toHaveProperty("money");
    expect(safe).not.toHaveProperty("amount");
    expect(safe).not.toHaveProperty("balance");
    expect(safe).not.toHaveProperty("name");
    expect(safe).not.toHaveProperty("description");
    expect(safe).not.toHaveProperty("category");
    expect(safe).not.toHaveProperty("email");
    expect(safe).not.toHaveProperty("householdId");
    expect(safe).not.toHaveProperty("userId");
    expect(safe).not.toHaveProperty("fileName");
    expect(safe).not.toHaveProperty("storageKey");
    expect(safe).not.toHaveProperty("databaseUrl");
    expect(safe).not.toHaveProperty("dsn");
    expect(safe).not.toHaveProperty("sql");
    expect(safe).not.toHaveProperty("payload");
    expect(safe).not.toHaveProperty("cookie");
    expect(safe).not.toHaveProperty("authorization");
    expect(safe).not.toHaveProperty("token");
    expect(JSON.stringify(safe)).not.toMatch(
      /123456|1234\.56|Nome financeiro privado|Descrição financeira privada|Categoria privada|membro@example.com|household-private|user-private|conta-corrente-privada|postgresql|r2:\/\/|amount_cents|private-token|session=private|secret-token/u,
    );
  });

  it("serializes the safe context and error envelope without raw exception data", () => {
    const operation = createS11Operation("export.request", {
      correlationId: "t13-correlation",
      datasetCount: 17,
      amountCents: "999999",
      payload: { description: "private" },
    });
    const context = toS11ObservabilityContext(operation, "unexpected_error", {
      technicalErrorCode: "EXPORT_DELIVERY_FAILED",
      durationMs: 12,
      byteCount: 1_048_576,
    });
    expect(context).toMatchObject({
      operation: "export.request",
      stage: "request",
      requestId: "t13-correlation",
      datasetCount: 17,
      byteCount: 1_048_576,
    });
    expect(JSON.stringify(context)).not.toMatch(/999999|private|description/u);

    const classification = classifyS11Error({
      code: "EXPORT_RATE_LIMITED",
      message: "export blocked with balance 999999",
    });
    expect(classification).toEqual({
      outcome: "expected_error",
      errorCode: "EXPORT_RATE_LIMITED",
    });
    expect(toS11ErrorEnvelope(new Error("SQL balance_cents=999999"))).toEqual({
      ok: false,
      error: { code: "UNEXPECTED_ERROR" },
    });
  });

  it("rejects user filenames masquerading as dataset identifiers", () => {
    expect(
      sanitizeS11Log({
        operation: "export.dataset",
        outcome: "success",
        datasetId: "conta-corrente-privada.csv" as "accounts",
        rowCount: 1,
      }),
    ).toBeUndefined();
  });
});
