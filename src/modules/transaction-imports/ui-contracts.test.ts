import { describe, expect, it } from "vitest";

import {
  CSV_IMPORT_ERROR_MESSAGES,
  type CsvImportPreview,
} from "./contracts";
import {
  confirmTransactionImportCommandSchema,
  parseConfirmTransactionImportCommand,
} from "./confirmation-validation";
import {
  commandForCsvImportAttempt,
  createCsvImportConfirmationCommand,
  isCsvImportPreviewExpired,
  isValidCsvImportCommandId,
  toCsvImportDuplicateBlockViewModel,
  toCsvImportPreviewViewModel,
  toCsvImportResultViewModel,
  type CsvImportConfirmationAttemptRef,
} from "./ui-contracts";

const preview: CsvImportPreview = {
  formatVersion: "s04-csv-v1",
  previewToken: "opaque-preview-token",
  expiresAt: "2026-08-30T12:00:00.000Z",
  accountId: "018f47b7-6c3a-7abc-8def-1234567890ab",
  duplicateStatus: "NEW",
  existingImportId: null,
  counts: {
    processed: 2,
    valid: 1,
    invalid: 1,
    ignoredDuplicate: 0,
    imported: 0,
  },
  rows: [
    {
      rowNumber: 2,
      occurredOn: "2026-08-29",
      description: "Café",
      signedAmountCents: "-1875",
      kind: "EXPENSE",
      externalId: null,
    },
  ],
  errors: [
    {
      rowNumber: 3,
      scope: "row",
      code: "CSV_INVALID_AMOUNT",
      field: "amountCents",
      message: `${CSV_IMPORT_ERROR_MESSAGES.CSV_INVALID_AMOUNT} raw=1.2`,
    },
  ],
};

describe("S04 UI contracts", () => {
  it("keeps valid rows and invalid row errors in one preview model", () => {
    const model = toCsvImportPreviewViewModel(preview, "2026-08-30T10:00:00.000Z");

    expect(model.canConfirm).toBe(true);
    expect(model.uiState).toBe("preview");
    expect(model.rows).toHaveLength(1);
    expect(model.errors).toEqual([
      {
        rowNumber: 3,
        scope: "row",
        code: "CSV_INVALID_AMOUNT",
        field: "amountCents",
        message: CSV_IMPORT_ERROR_MESSAGES.CSV_INVALID_AMOUNT,
      },
    ]);
    expect(model.errors[0].message).not.toContain("raw=1.2");
  });

  it("blocks zero-valid, duplicate, expired and tokenless previews", () => {
    const noValid = toCsvImportPreviewViewModel(
      {
        ...preview,
        counts: { ...preview.counts, valid: 0 },
        rows: [],
      },
      "2026-08-30T10:00:00.000Z",
    );
    expect(noValid).toMatchObject({
      canConfirm: false,
      blockReason: "NO_VALID_ROWS",
      uiState: "no-valid-rows",
    });

    const duplicate = toCsvImportPreviewViewModel(
      { ...preview, duplicateStatus: "ALREADY_IMPORTED", existingImportId: "import-1" },
      "2026-08-30T10:00:00.000Z",
    );
    expect(duplicate).toMatchObject({
      canConfirm: false,
      blockReason: "ALREADY_IMPORTED",
      uiState: "duplicate",
    });
    expect(toCsvImportDuplicateBlockViewModel(duplicate)).toEqual({
      status: "ALREADY_IMPORTED",
      blocked: true,
      existingImportId: "import-1",
    });

    const expired = toCsvImportPreviewViewModel(
      { ...preview, expiresAt: "2026-08-30T09:00:00.000Z" },
      "2026-08-30T10:00:00.000Z",
    );
    expect(expired).toMatchObject({
      canConfirm: false,
      blockReason: "PREVIEW_EXPIRED",
      uiState: "expired",
    });

    const tokenless = toCsvImportPreviewViewModel(
      { ...preview, previewToken: "" },
      "2026-08-30T10:00:00.000Z",
    );
    expect(tokenless).toMatchObject({
      canConfirm: false,
      blockReason: "PREVIEW_TOKEN_MISSING",
    });
  });

  it("keeps token and command ID opaque and reuses one command on retry", () => {
    expect(isValidCsvImportCommandId("command-1")).toBe(true);
    expect(isValidCsvImportCommandId(" command-1 ")).toBe(true);
    expect(isValidCsvImportCommandId("command\n1")).toBe(false);
    expect(isValidCsvImportCommandId("x".repeat(129))).toBe(false);

    const command = createCsvImportConfirmationCommand("token-1", " command-1 ");
    expect(command).toEqual({ commandId: "command-1", previewToken: "token-1" });
    expect(Object.keys(command)).toEqual(["commandId", "previewToken"]);

    const attempt: CsvImportConfirmationAttemptRef = { current: null };
    const first = commandForCsvImportAttempt("token-1", attempt);
    const retry = commandForCsvImportAttempt("token-1", attempt);
    expect(retry).toEqual(first);

    const next = commandForCsvImportAttempt("token-2", attempt);
    expect(next.previewToken).toBe("token-2");
    expect(next.commandId).not.toBe(first.commandId);
  });

  it("validates only the two confirmation fields and rejects client authority", () => {
    expect(
      confirmTransactionImportCommandSchema.parse({
        commandId: " command-1 ",
        previewToken: " opaque-token ",
      }),
    ).toEqual({ commandId: "command-1", previewToken: " opaque-token " });
    expect(
      parseConfirmTransactionImportCommand({
        commandId: "command-1",
        previewToken: "token-1",
        accountId: "forged-account",
      }),
    ).toBeNull();
    expect(
      parseConfirmTransactionImportCommand({ commandId: "", previewToken: "token-1" }),
    ).toBeNull();
  });

  it("maps committed and duplicate results to explicit report states", () => {
    const imported = toCsvImportResultViewModel({
      status: "IMPORTED",
      importId: "import-1",
      accountId: preview.accountId,
      counts: preview.counts,
      errors: preview.errors,
    });
    expect(imported).toMatchObject({
      uiState: "imported",
      isDuplicate: false,
      title: "Importação concluída",
    });

    const duplicate = toCsvImportResultViewModel({
      status: "DUPLICATE_DATASET",
      existingImportId: "import-1",
      accountId: preview.accountId,
      counts: { ...preview.counts, ignoredDuplicate: 1, imported: 0 },
      errors: preview.errors,
    });
    expect(duplicate).toMatchObject({
      uiState: "duplicate",
      isDuplicate: true,
      title: "Este conjunto já foi importado",
    });
  });

  it("uses the server expiration boundary without treating invalid dates as expired", () => {
    expect(
      isCsvImportPreviewExpired(preview, "2026-08-30T12:00:00.000Z"),
    ).toBe(true);
    expect(
      isCsvImportPreviewExpired(preview, "2026-08-30T11:59:59.999Z"),
    ).toBe(false);
    expect(
      isCsvImportPreviewExpired(
        { expiresAt: "not-a-date" },
        "2026-08-30T12:00:00.000Z",
      ),
    ).toBe(false);
  });
});
