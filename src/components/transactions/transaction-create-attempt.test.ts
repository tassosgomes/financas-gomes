import { describe, expect, it } from "vitest";

import {
  commandForTransactionAttempt,
  transactionCommandFingerprint,
} from "./transaction-create-attempt";

const values = {
  accountId: "018f47b7-6c3a-7abc-8def-1234567890ac",
  amountCents: "123456",
  categoryId: null,
  description: "Café da manhã",
  kind: "EXPENSE" as const,
  occurredOn: "2020-01-02",
};

describe("transaction create attempt command IDs", () => {
  it("keeps the command ID for an exact retry", () => {
    const attempt = { current: null };
    const first = commandForTransactionAttempt(values, attempt);
    const retry = commandForTransactionAttempt(values, attempt);

    expect(retry.commandId).toBe(first.commandId);
    expect(retry).toEqual(first);
    expect(transactionCommandFingerprint(first)).toBe(
      transactionCommandFingerprint(retry),
    );
  });

  it("starts a new ID when a corrected payload changes", () => {
    const attempt = { current: null };
    const first = commandForTransactionAttempt(values, attempt);
    const corrected = commandForTransactionAttempt(
      { ...values, description: "Café da tarde" },
      attempt,
    );

    expect(corrected.commandId).not.toBe(first.commandId);
    expect(corrected.description).toBe("Café da tarde");
  });
});
