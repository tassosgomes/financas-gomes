import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CsvImportConfirmationResult } from "@/modules/transaction-imports/contracts";

import { CsvImportScreen } from "./csv-import-screen";

const accounts = [
  { id: "account-active", name: "Conta principal", status: "ACTIVE" as const },
  { id: "account-archived", name: "Conta arquivada", status: "ARCHIVED" as const },
];

const confirmationAction = async (): Promise<CsvImportConfirmationResult> => ({
  status: "IMPORTED",
  importId: "import-1",
  accountId: "account-active",
  counts: {
    processed: 1,
    valid: 1,
    invalid: 0,
    ignoredDuplicate: 0,
    imported: 1,
  },
  errors: [],
});

describe("CsvImportScreen", () => {
  it("renders the documented upload boundary and keeps confirmation out of the initial state", () => {
    const html = renderToStaticMarkup(
      <CsvImportScreen
        accounts={accounts}
        confirmationAction={confirmationAction}
        previewAction={async () => ({
          ok: false,
          error: {
            code: "CSV_FILE_REQUIRED",
            scope: "file",
            message: "não deve substituir a mensagem estável",
          },
        })}
      />,
    );

    expect(html).toContain("Importar extrato CSV");
    expect(html).toContain("Documentação do formato");
    expect(html).toContain("Ver exemplo CSV");
    expect(html).toContain("5 MiB");
    expect(html).toContain("10.000");
    expect(html).toContain("16 KiB");
    expect(html).toContain("csv-import-preview-submit");
    expect(html).not.toContain("csv-import-preview-title");
    expect(html).not.toContain("não deve substituir a mensagem estável");
  });

  it("does not expose archived accounts as selectable destinations", () => {
    const html = renderToStaticMarkup(
      <CsvImportScreen
        accounts={accounts}
        confirmationAction={confirmationAction}
        previewAction={async () => ({
          ok: false,
          error: {
            code: "ACCOUNT_NOT_FOUND",
            scope: "preview",
            message: "mensagem não renderizada",
          },
        })}
      />,
    );

    expect(html).toContain("Conta principal");
    expect(html).not.toContain("Conta arquivada");
  });
});
