import { describe, expect, it, vi } from "vitest";

import {
  createCsvImportConfirmationActionHandlers,
} from "./adapters";
import { CsvImportDomainError } from "./use-cases";

const context = {
  userId: "00000000-0000-7000-8000-000000071201",
  householdId: "00000000-0000-7000-8000-000000071202",
} as const;

const result = {
  status: "IMPORTED" as const,
  importId: "00000000-0000-7000-8000-000000071203",
  accountId: "00000000-0000-7000-8000-000000071204",
  counts: {
    processed: 2,
    valid: 1,
    invalid: 1,
    ignoredDuplicate: 0,
    imported: 1,
  },
  errors: [
    {
      rowNumber: 3,
      code: "CSV_INVALID_AMOUNT" as const,
      scope: "row" as const,
      message: "valor inválido que não deve ser confiado",
      field: "amountCents" as const,
    },
  ],
};

describe("T07 confirmation action adapter", () => {
  it("resolves context and forwards only commandId/previewToken", async () => {
    const resolveContext = vi.fn().mockResolvedValue(context);
    const confirm = vi.fn().mockResolvedValue(result);
    const revalidateTransactions = vi.fn();
    const handlers = createCsvImportConfirmationActionHandlers({
      resolveContext,
      port: { confirm },
      revalidateTransactions,
    });

    await expect(
      handlers.confirm({
        commandId: " command-1 ",
        previewToken: "opaque-token",
      }),
    ).resolves.toEqual(result);
    expect(resolveContext).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(context, {
      commandId: "command-1",
      previewToken: "opaque-token",
    });
    expect(revalidateTransactions).toHaveBeenCalledOnce();
  });

  it("rejects account, household, rows and fingerprint authority before auth", async () => {
    const resolveContext = vi.fn();
    const confirm = vi.fn();
    const handlers = createCsvImportConfirmationActionHandlers({
      resolveContext,
      port: { confirm },
    });

    await expect(
      handlers.confirm({
        commandId: "command-1",
        previewToken: "opaque-token",
        accountId: "forged-account",
        householdId: context.householdId,
        rows: [],
        datasetFingerprint: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "INVALID_COMMAND" });
    expect(resolveContext).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("returns a sanitized expected error through the result envelope", async () => {
    const handlers = createCsvImportConfirmationActionHandlers({
      resolveContext: vi.fn().mockResolvedValue(context),
      port: {
        confirm: vi.fn().mockRejectedValue(
          new CsvImportDomainError(
            "PREVIEW_EXPIRED",
            "previewToken",
            "confirmation",
          ),
        ),
      },
    });

    await expect(
      handlers.confirmResult({
        commandId: "command-2",
        previewToken: "opaque-token",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "PREVIEW_EXPIRED",
        scope: "confirmation",
        message: "A prévia expirou; envie o arquivo novamente.",
        field: "previewToken",
      },
    });
  });

  it("maps an unauthenticated resolver failure without leaking internals", async () => {
    const handlers = createCsvImportConfirmationActionHandlers({
      resolveContext: vi.fn().mockRejectedValue({ code: "UNAUTHENTICATED" }),
      port: { confirm: vi.fn() },
    });

    await expect(
      handlers.confirmResult({
        commandId: "command-3",
        previewToken: "opaque-token",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        scope: "confirmation",
      },
    });
  });
});

