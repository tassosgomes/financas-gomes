import { afterEach, describe, expect, it, vi } from "vitest";

import {
  logObservability,
  sanitizeCrudObservabilityLog,
} from "./logger";

describe("safe structured CRUD logs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allow-lists operation metadata and drops financial fields", () => {
    const safe = sanitizeCrudObservabilityLog({
      event: "s02_account_create_success",
      useCase: "accounts.create",
      operation: "create",
      entityType: "account",
      entityId: "Conta principal",
      outcome: "success",
      requestId: "request-1",
      userId: "user-1",
      householdId: "household-1",
      durationMs: 42.4,
      amount: 1234,
      accountName: "Conta principal",
      notes: "dados privados",
      payload: { name: "Conta principal" },
    });

    expect(safe).toEqual({
      event: "s02_account_create_success",
      useCase: "accounts.create",
      operation: "create",
      entityType: "account",
      outcome: "success",
      requestId: "request-1",
      userId: "user-1",
      householdId: "household-1",
      durationMs: 42,
    });
    expect(JSON.stringify(safe)).not.toContain("Conta principal");
    expect(JSON.stringify(safe)).not.toContain("1234");
  });

  it("emits JSON with the CRUD verb and never serializes an arbitrary error", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logObservability("info", {
      event: "s02_category_list_success",
      useCase: "categories.list",
      operation: "list",
      entityType: "category",
      outcome: "success",
      durationMs: 7,
      error: new Error("description=private"),
    });

    expect(info).toHaveBeenCalledOnce();
    const serialized = String(info.mock.calls[0]?.[0]);
    expect(serialized).toContain('"operation":"list"');
    expect(serialized).toContain('"entityType":"category"');
    expect(serialized).not.toContain("description");
    expect(serialized).not.toContain("private");
  });
});
