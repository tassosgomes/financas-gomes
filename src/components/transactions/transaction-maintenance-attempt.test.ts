import { describe, expect, it } from "vitest";

import {
  commandForTransactionCancellation,
  commandForTransactionUpdate,
} from "./transaction-maintenance-attempt";

const eventId = "018f47b7-6c3a-7abc-8def-1234567890ad";

describe("transaction maintenance command attempts", () => {
  it("reuses an update command ID for an exact retry", () => {
    const attempt = { current: null };
    const values = { categoryId: null, description: "Mercado" };

    const first = commandForTransactionUpdate(eventId, values, attempt);
    const retry = commandForTransactionUpdate(eventId, values, attempt);

    expect(retry).toEqual(first);
    expect(retry.financialEventId).toBe(eventId);
  });

  it("starts a new update command when metadata changes", () => {
    const attempt = { current: null };
    const first = commandForTransactionUpdate(
      eventId,
      { categoryId: null, description: "Mercado" },
      attempt,
    );
    const changed = commandForTransactionUpdate(
      eventId,
      { categoryId: "018f47b7-6c3a-7abc-8def-1234567890ae", description: "Mercado" },
      attempt,
    );

    expect(changed.commandId).not.toBe(first.commandId);
    expect(changed.categoryId).toBe("018f47b7-6c3a-7abc-8def-1234567890ae");
  });

  it("reuses a cancellation command ID only for the same event", () => {
    const attempt = { current: null };
    const first = commandForTransactionCancellation(eventId, attempt);
    const retry = commandForTransactionCancellation(eventId, attempt);
    const other = commandForTransactionCancellation(
      "018f47b7-6c3a-7abc-8def-1234567890af",
      attempt,
    );

    expect(retry).toEqual(first);
    expect(other.commandId).not.toBe(first.commandId);
  });
});

