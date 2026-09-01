import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CsvImportConfirmationResult } from "@/modules/transaction-imports/contracts";
import { toCsvImportResultViewModel } from "@/modules/transaction-imports/ui-contracts";

import {
  CsvImportResult,
  CsvImportRetryNotice,
  csvImportResultHref,
  csvImportTransactionsHref,
} from "./csv-import-result";
import { CsvImportScreen } from "./csv-import-screen";

const imported: CsvImportConfirmationResult = {
  status: "IMPORTED",
  importId: "018f47b7-6c3a-7abc-8def-1234567890ab",
  accountId: "018f47b7-6c3a-7abc-8def-1234567890ac",
  counts: {
    processed: 3,
    valid: 2,
    invalid: 1,
    ignoredDuplicate: 0,
    imported: 2,
  },
  errors: [
    {
      rowNumber: 4,
      scope: "row",
      code: "CSV_INVALID_AMOUNT",
      field: "amountCents",
      message: "mensagem não confiável",
    },
  ],
};

const duplicate: CsvImportConfirmationResult = {
  status: "DUPLICATE_DATASET",
  existingImportId: "018f47b7-6c3a-7abc-8def-1234567890ad",
  accountId: "018f47b7-6c3a-7abc-8def-1234567890ac",
  counts: {
    processed: 2,
    valid: 2,
    invalid: 0,
    ignoredDuplicate: 2,
    imported: 0,
  },
  errors: [],
};

describe("CsvImportResult", () => {
  it("expõe claramente o que foi criado, erros por linha e filtros seguros", () => {
    const viewModel = toCsvImportResultViewModel(imported);
    const html = renderToStaticMarkup(
      <CsvImportResult
        navigation={{
          accountId: imported.accountId,
          rows: [
            { occurredOn: "2026-08-29" },
            { occurredOn: "2026-08-30" },
          ],
        }}
        result={viewModel}
      />,
    );

    expect(html).toContain("Importação concluída");
    expect(html).toContain("Criadas 2 transações");
    expect(html).toContain("Linha 4");
    expect(html).toContain("Informe um valor inteiro em centavos");
    expect(html).toContain("Campo: valor em centavos");
    expect(html).toContain("gere uma nova prévia");
    expect(html).toContain(
      "/transactions?accountId=018f47b7-6c3a-7abc-8def-1234567890ac&amp;from=2026-08-29&amp;to=2026-08-30",
    );
    expect(html).not.toContain("mensagem não confiável");
    expect(html).not.toContain("previewToken");
    expect(html).not.toContain("datasetFingerprint");
  });

  it("não trata conjunto repetido como sucesso e aponta para o resultado existente", () => {
    const viewModel = toCsvImportResultViewModel(duplicate);
    const html = renderToStaticMarkup(
      <CsvImportResult
        navigation={{ accountId: duplicate.accountId }}
        result={viewModel}
      />,
    );

    expect(html).toContain("Este conjunto já foi importado");
    expect(html).toContain("Nenhuma nova transação foi criada");
    expect(html).toContain("Ignoradas por duplicidade");
    expect(html).toContain("Ver lançamentos existentes");
    expect(html).toContain(csvImportResultHref(duplicate.existingImportId));
  });

  it("mantém retry acionável sem transportar conteúdo financeiro", () => {
    const html = renderToStaticMarkup(
      <CsvImportRetryNotice errorCode="PREVIEW_EXPIRED" />,
    );

    expect(html).toContain("A confirmação não foi concluída");
    expect(html).toContain("A prévia expirou");
    expect(html).toContain("Gere uma nova prévia");
    expect(html).not.toContain("token");
  });

  it("instrui a repetir a mesma operação em uma falha técnica recuperável", () => {
    const html = renderToStaticMarkup(
      <CsvImportRetryNotice
        errorCode="INVALID_COMMAND"
        onRetry={() => undefined}
      />,
    );

    expect(html).toContain("mesma prévia");
    expect(html).toContain("identificador da operação será reutilizado");
    expect(html).toContain("csv-import-retry-notice-retry");
  });

  it("deriva somente filtros suportados e codifica identificadores opacos", () => {
    expect(
      csvImportTransactionsHref({
        accountId: "account/with spaces",
        rows: [{ occurredOn: "2026-08-30" }],
      }),
    ).toBe("/transactions?accountId=account%2Fwith+spaces&from=2026-08-30&to=2026-08-30");
    expect(csvImportResultHref("import/opaque id")).toBe(
      "/transactions/import?importId=import%2Fopaque+id",
    );
  });

  it("integra o relatório reidratado à tela T10 sem exigir novo upload", () => {
    const html = renderToStaticMarkup(
      <CsvImportScreen
        accounts={[{ id: imported.accountId, name: "Conta principal", status: "ACTIVE" }]}
        confirmationAction={async () => imported}
        initialResult={toCsvImportResultViewModel(imported)}
        previewAction={async () => ({
          ok: false,
          error: {
            code: "CSV_FILE_REQUIRED",
            scope: "file",
            message: "mensagem não confiável",
          },
        })}
      />,
    );

    expect(html).toContain("csv-import-result");
    expect(html).toContain("Importação concluída");
    expect(html).toContain("csv-import-new");
    expect(html).not.toContain("mensagem não confiável");
  });
});
