import { describe, expect, it, vi } from "vitest";

import {
  createCsvImportPreviewActionHandlers,
} from "./adapters";
import { CsvImportDomainError } from "./use-cases";

const context = {
  userId: "00000000-0000-7000-8000-000000000001",
  householdId: "00000000-0000-7000-8000-000000000002",
} as const;

const preview = {
  formatVersion: "s04-csv-v1" as const,
  previewToken: "opaque-preview-token",
  expiresAt: "2026-08-30T12:15:00.000Z",
  accountId: "00000000-0000-7000-8000-000000000003",
  duplicateStatus: "NEW" as const,
  existingImportId: null,
  counts: {
    processed: 1,
    valid: 1,
    invalid: 0,
    ignoredDuplicate: 0,
    imported: 0,
  },
  rows: [
    {
      rowNumber: 2,
      occurredOn: "2026-08-30",
      description: "Café",
      signedAmountCents: "-500",
      kind: "EXPENSE" as const,
      externalId: null,
    },
  ],
  errors: [],
};

describe("T06 authenticated preview action adapter", () => {
  it("resolves context server-side and forwards only account/file input", async () => {
    const resolveContext = vi.fn().mockResolvedValue(context);
    const port = { preview: vi.fn().mockResolvedValue(preview) };
    const handlers = createCsvImportPreviewActionHandlers({
      resolveContext,
      port,
    });

    const result = await handlers.preview({
      accountId: preview.accountId,
      file: "occurred_on,description,amount_cents\n2026-08-30,Café,-500",
    });

    expect(result).toEqual({ ok: true, value: preview });
    expect(resolveContext).toHaveBeenCalledOnce();
    expect(port.preview).toHaveBeenCalledWith(context, {
      accountId: preview.accountId,
      file: "occurred_on,description,amount_cents\n2026-08-30,Café,-500",
    });
  });

  it("rejects household/fingerprint/candidate authority before auth or port", async () => {
    const resolveContext = vi.fn();
    const port = { preview: vi.fn() };
    const handlers = createCsvImportPreviewActionHandlers({
      resolveContext,
      port,
    });

    const result = await handlers.preview({
      accountId: preview.accountId,
      file: "csv",
      householdId: context.householdId,
      datasetFingerprint: "a".repeat(64),
      rows: [],
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_COMMAND" },
    });
    expect(resolveContext).not.toHaveBeenCalled();
    expect(port.preview).not.toHaveBeenCalled();
  });

  it("maps an unauthenticated context failure without leaking internals", async () => {
    const handlers = createCsvImportPreviewActionHandlers({
      resolveContext: vi
        .fn()
        .mockRejectedValue(new Error("session cookie and raw payload")),
      port: { preview: vi.fn() },
    });

    // A generic Error is an unexpected infrastructure failure and deliberately
    // remains outside the safe domain envelope.
    await expect(
      handlers.preview({ accountId: preview.accountId, file: "csv" }),
    ).rejects.toThrow("session cookie");
  });

  it("maps the server auth guard to the stable public code", async () => {
    const handlers = createCsvImportPreviewActionHandlers({
      resolveContext: vi.fn().mockRejectedValue({ code: "UNAUTHENTICATED" }),
      port: { preview: vi.fn() },
    });

    const result = await handlers.preview({
      accountId: preview.accountId,
      file: "csv",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        scope: "preview",
        message: "É necessário entrar para acessar este recurso.",
      },
    });
  });

  it("returns parser/domain failures with the stable sanitized error envelope", async () => {
    const handlers = createCsvImportPreviewActionHandlers({
      resolveContext: vi.fn().mockResolvedValue(context),
      port: {
        preview: vi
          .fn()
          .mockRejectedValue(new CsvImportDomainError("CSV_INVALID_HEADER", undefined, "file")),
      },
    });

    const result = await handlers.preview({
      accountId: preview.accountId,
      file: "raw=must-not-cross-boundary",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "CSV_INVALID_HEADER",
        scope: "file",
        message: "O cabeçalho não corresponde ao formato CSV aceito.",
      },
    });
  });

  it("accepts FormData while retaining file bytes as an opaque upload", async () => {
    const resolveContext = vi.fn().mockResolvedValue(context);
    const port = { preview: vi.fn().mockResolvedValue(preview) };
    const handlers = createCsvImportPreviewActionHandlers({
      resolveContext,
      port,
    });
    const formData = new FormData();
    const body = "occurred_on,description,amount_cents\n2026-08-30,Café,-500";
    formData.set("accountId", preview.accountId);
    formData.set("file", new File([body], "statement.csv", { type: "text/csv" }));

    const result = await handlers.preview(formData);

    expect(result).toEqual({ ok: true, value: preview });
    expect(port.preview).toHaveBeenCalledOnce();
    const command = port.preview.mock.calls[0]?.[1] as {
      accountId: string;
      file: { arrayBuffer?: () => Promise<ArrayBuffer> };
    };
    expect(command.accountId).toBe(preview.accountId);
    expect(command.file).toHaveProperty("arrayBuffer");
  });

  it("rejects forged authority fields in FormData", async () => {
    const resolveContext = vi.fn();
    const port = { preview: vi.fn() };
    const handlers = createCsvImportPreviewActionHandlers({
      resolveContext,
      port,
    });
    const formData = new FormData();
    formData.set("accountId", preview.accountId);
    formData.set("file", "csv");
    formData.set("householdId", context.householdId);

    const result = await handlers.preview(formData);

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(resolveContext).not.toHaveBeenCalled();
    expect(port.preview).not.toHaveBeenCalled();
  });
});
