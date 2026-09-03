import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AccountReadModel } from "@/modules/accounts-categories/contracts";
import type {
  CsvImportCounts,
  CsvImportPreviewRow,
  CsvImportRowError,
} from "@/modules/transaction-imports";

import { CsvImportAccountSelector } from "./account-selector";
import { CsvImportConfirmation } from "./csv-import-confirmation";
import { CsvFilePicker, validateCsvFileSelection } from "./csv-file-picker";
import { CsvImportPreviewTable } from "./csv-import-preview-table";
import { CsvImportSummary } from "./csv-import-summary";

const activeAccount: AccountReadModel = {
  id: "018f47b7-6c3a-7abc-8def-1234567890ab",
  householdId: "018f47b7-6c3a-7abc-8def-1234567890aa",
  name: "Conta principal",
  type: "CHECKING",
  status: "ACTIVE",
  spendability: "GENERAL",
  liquidity: "IMMEDIATE",
  includeInNetWorth: true,
  trackingStartedOn: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const archivedAccount: AccountReadModel = {
  ...activeAccount,
  id: "018f47b7-6c3a-7abc-8def-1234567890ac",
  name: "Conta arquivada",
  status: "ARCHIVED",
};

const rows: CsvImportPreviewRow[] = [
  {
    rowNumber: 2,
    occurredOn: "2026-08-29",
    description: "Café",
    signedAmountCents: "-1875",
    kind: "EXPENSE",
    externalId: null,
  },
];

const errors: CsvImportRowError[] = [
  {
    rowNumber: 3,
    scope: "row",
    code: "CSV_INVALID_AMOUNT",
    field: "amountCents",
    message: "valor bruto que não deve ser renderizado",
  },
];

const counts: CsvImportCounts = {
  processed: 2,
  valid: 1,
  invalid: 1,
  ignoredDuplicate: 0,
  imported: 0,
};

describe("import UI components", () => {
  it("renders only active account choices with accessible error wiring", () => {
    const html = renderToStaticMarkup(
      <CsvImportAccountSelector
        accounts={[activeAccount, archivedAccount]}
        error="Selecione uma conta válida."
      />,
    );

    expect(html).toContain("Conta principal");
    expect(html).not.toContain("Conta arquivada");
    expect(html).toContain('role="alert"');
    expect(html).toContain("csv-import-account-error");
  });

  it("keeps the picker server-validation boundary visible and exposes safe size checks", () => {
    const html = renderToStaticMarkup(<CsvFilePicker state="loading" />);

    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".csv,text/csv"');
    expect(html).toContain("Enviando arquivo para validação");
    expect(html).toContain("O formato e os dados serão validados no servidor");
    expect(validateCsvFileSelection(null)?.code).toBe("CSV_FILE_REQUIRED");
    expect(validateCsvFileSelection({ size: 0 })?.code).toBe("CSV_EMPTY_FILE");
    expect(validateCsvFileSelection({ size: 5 * 1024 * 1024 + 1 })?.code).toBe(
      "CSV_FILE_TOO_LARGE",
    );
  });

  it("renders normalized valid rows without recalculating their kind or sign", () => {
    const html = renderToStaticMarkup(<CsvImportPreviewTable rows={rows} />);

    expect(html).toContain("2026-08-29");
    expect(html).toContain("Café");
    expect(html).toContain("-R$ 18,75");
    expect(html).toContain("Despesa");
    expect(html).toContain("csv-import-preview-table-row-2");
  });

  it("renders all server counts, row errors, and duplicate blocking copy", () => {
    const html = renderToStaticMarkup(
      <CsvImportSummary
        blockReason="ALREADY_IMPORTED"
        counts={{ ...counts, ignoredDuplicate: 1 }}
        duplicateStatus="ALREADY_IMPORTED"
        errors={errors}
        existingImportId="import-1"
      />,
    );

    expect(html).toContain("Processadas");
    expect(html).toContain("Ignoradas por duplicidade");
    expect(html).toContain("Este conjunto já foi importado");
    expect(html).toContain("Linha 3");
    expect(html).not.toContain("valor bruto que não deve ser renderizado");
  });

  it("does not enable confirmation when the preview has no valid rows", () => {
    const html = renderToStaticMarkup(
      <CsvImportConfirmation
        blockReason="Nenhuma linha válida está disponível para confirmação."
        onConfirm={async () => {
          throw new Error("not called during static render");
        }}
        previewToken="opaque-token"
      />,
    );

    expect(html).toContain("Nenhuma linha válida");
    expect(html).toContain("disabled");
    expect(html).toContain("Confirmar importação");
  });
});

