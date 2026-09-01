import { LoadingState } from "@/components/ui/async-state";
import {
  formatCsvImportSignedAmount,
} from "@/modules/transaction-imports/ui-contracts";
import type { CsvImportPreviewRow } from "@/modules/transaction-imports/contracts";

export interface CsvImportPreviewTableProps {
  /** Rows already validated and normalized by the server parser. */
  rows: readonly CsvImportPreviewRow[];
  state?: "ready" | "loading";
  caption?: string;
  emptyMessage?: string;
  testId?: string;
  className?: string;
}

function kindLabel(kind: CsvImportPreviewRow["kind"]): string {
  return kind === "INCOME" ? "Receita" : "Despesa";
}

/**
 * Reusable valid-row preview. It only renders values from the server view
 * model; it does not infer kind, recalculate signs, compute totals, or parse
 * the raw upload.
 */
export function CsvImportPreviewTable({
  rows,
  state = "ready",
  caption = "Linhas válidas da prévia de importação",
  emptyMessage = "Nenhuma linha válida para importar.",
  testId = "csv-import-preview-table",
  className,
}: CsvImportPreviewTableProps) {
  if (state === "loading") {
    return (
      <LoadingState
        label="Carregando prévia…"
        testId={`${testId}-loading`}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <section
        aria-live="polite"
        className="rounded-2xl border border-dashed bg-card px-6 py-8 text-center text-sm text-muted-foreground"
        data-testid={`${testId}-empty`}
        role="status"
      >
        {emptyMessage}
      </section>
    );
  }

  return (
    <div
      className={`overflow-x-auto rounded-2xl border bg-card shadow-sm${className ? ` ${className}` : ""}`}
      data-testid={testId}
    >
      <table className="w-full min-w-[48rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium" scope="col">
              Linha
            </th>
            <th className="px-4 py-3 font-medium" scope="col">
              Data
            </th>
            <th className="px-4 py-3 font-medium" scope="col">
              Descrição
            </th>
            <th className="px-4 py-3 font-medium" scope="col">
              Valor
            </th>
            <th className="px-4 py-3 font-medium" scope="col">
              Tipo
            </th>
            <th className="px-4 py-3 font-medium" scope="col">
              ID externo
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr
              className="align-middle"
              data-testid={`${testId}-row-${row.rowNumber}`}
              key={row.rowNumber}
            >
              <td className="px-4 py-3 tabular-nums">{row.rowNumber}</td>
              <td className="whitespace-nowrap px-4 py-3">{row.occurredOn}</td>
              <td className="max-w-[20rem] px-4 py-3">{row.description}</td>
              <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums">
                <span aria-label={`Valor ${formatCsvImportSignedAmount(row.signedAmountCents)}`}>
                  {formatCsvImportSignedAmount(row.signedAmountCents)}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-3">{kindLabel(row.kind)}</td>
              <td className="max-w-[14rem] break-all px-4 py-3 text-muted-foreground">
                {row.externalId ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const PreviewTable = CsvImportPreviewTable;
export const CsvImportPreviewRowsTable = CsvImportPreviewTable;
export const ImportPreviewTable = CsvImportPreviewTable;
