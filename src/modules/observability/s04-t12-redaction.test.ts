import { describe, expect, it } from "vitest";

import {
  createS04ImportOperation,
  sanitizeS04ImportLog,
  toS04ObservabilityContext,
} from "./s04";

describe("T12 S04 observability boundary", () => {
  it("allows only opaque IDs and aggregate counters across the redaction boundary", () => {
    const operation = createS04ImportOperation("confirmation", {
      requestId: "request-t12",
      previewId: "preview-t12",
      importId: "import-t12",
      accountId: "account-t12",
      householdId: "household-t12",
      counts: {
        processed: 3,
        valid: 2,
        invalid: 1,
        ignoredDuplicate: 0,
        imported: 2,
      },
      amountCents: "125000",
      description: "descrição financeira privada",
      filename: "extrato-real.csv",
      previewToken: "bearer-token-raw",
      requestBody: {
        occurred_on: "2026-08-29",
        description: "descrição financeira privada",
      },
    });

    const log = sanitizeS04ImportLog({
      ...operation,
      outcome: "success",
      amountCents: "125000",
      description: "descrição financeira privada",
      filename: "extrato-real.csv",
      previewToken: "bearer-token-raw",
      requestBody: { amount_cents: "125000" },
    });
    const context = toS04ObservabilityContext(
      operation,
      "success",
      operation.counts,
    );
    const serialized = JSON.stringify({ log, context });

    expect(log).toMatchObject({
      stage: "confirmation",
      operation: "confirm",
      outcome: "success",
      requestId: "request-t12",
      previewId: "preview-t12",
      importId: "import-t12",
      processedRows: 3,
      validRows: 2,
      invalidRows: 1,
      importedRows: 2,
    });
    expect(context).toMatchObject({
      entityType: "transaction_import",
      stage: "confirmation",
      operation: "confirm",
      processedRows: 3,
      validRows: 2,
      invalidRows: 1,
      importedRows: 2,
    });
    expect(serialized).not.toContain("125000");
    expect(serialized).not.toContain("descrição financeira privada");
    expect(serialized).not.toContain("extrato-real.csv");
    expect(serialized).not.toContain("bearer-token-raw");
    expect(serialized).not.toContain("occurred_on");
  });
});
