import { AlertTriangle, CheckCircle2, Copy, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/async-state";
import {
  CSV_IMPORT_ERROR_MESSAGES,
  type CsvImportCounts,
  type CsvImportDuplicateStatus,
  type CsvImportErrorCode,
  type CsvImportRowError,
} from "@/modules/transaction-imports/contracts";
import {
  toCsvImportRowErrorViewModels,
  type CsvImportPreviewBlockReason,
} from "@/modules/transaction-imports/ui-contracts";

export type CsvImportSummaryState =
  | "ready"
  | "loading"
  | "no-valid-rows"
  | "duplicate"
  | "retryable-error";

export interface CsvImportSummaryProps {
  /** Counts originate at the parser/use case and are never derived here. */
  counts: CsvImportCounts;
  errors?: readonly CsvImportRowError[];
  duplicateStatus?: CsvImportDuplicateStatus;
  existingImportId?: string | null;
  blockReason?: CsvImportPreviewBlockReason | null;
  state?: CsvImportSummaryState;
  /** Stable public code selected by the adapter; raw technical messages are not accepted. */
  errorCode?: CsvImportErrorCode;
  onRetry?: () => void;
  retryLabel?: string;
  title?: string;
  testId?: string;
  className?: string;
}

const COUNT_ITEMS: ReadonlyArray<{
  key: keyof CsvImportCounts;
  label: string;
}> = [
  { key: "processed", label: "Processadas" },
  { key: "valid", label: "Válidas" },
  { key: "invalid", label: "Com erro" },
  { key: "ignoredDuplicate", label: "Ignoradas por duplicidade" },
  { key: "imported", label: "Importadas" },
];

const FIELD_LABELS: Readonly<
  Partial<Record<NonNullable<CsvImportRowError["field"]>, string>>
> = {
  occurredOn: "data",
  description: "descrição",
  amountCents: "valor em centavos",
  externalId: "identificador externo",
};

function blockCopy(
  blockReason: CsvImportPreviewBlockReason | null | undefined,
): string | null {
  switch (blockReason) {
    case "NO_VALID_ROWS":
      return "Nenhuma linha válida está disponível para confirmação.";
    case "ALREADY_IMPORTED":
      return "Este conjunto já foi importado para esta conta. Nenhum novo lançamento será criado.";
    case "PREVIEW_EXPIRED":
      return "A prévia expirou. Envie o arquivo novamente para gerar uma nova prévia.";
    case "PREVIEW_TOKEN_MISSING":
      return "Esta prévia não pode ser confirmada. Envie o arquivo novamente.";
    default:
      return null;
  }
}

function errorCopy(errorCode: CsvImportErrorCode | undefined): string | null {
  return errorCode ? CSV_IMPORT_ERROR_MESSAGES[errorCode] : null;
}

/**
 * Accessible counts/report card shared by preview and result screens. It
 * renders server-provided counters verbatim and sanitizes row messages through
 * ADR-005's stable vocabulary before rendering them.
 */
export function CsvImportSummary({
  counts,
  errors = [],
  duplicateStatus = "NEW",
  existingImportId = null,
  blockReason = null,
  state = "ready",
  errorCode,
  onRetry,
  retryLabel = "Tentar novamente",
  title = "Resumo da importação",
  testId = "csv-import-summary",
  className,
}: CsvImportSummaryProps) {
  if (state === "loading") {
    return (
      <LoadingState label="Calculando resumo…" testId={`${testId}-loading`} />
    );
  }

  const blockMessage = blockCopy(blockReason);
  const technicalError = errorCopy(errorCode);
  const rowErrors = toCsvImportRowErrorViewModels(errors);
  const hasDuplicate = duplicateStatus === "ALREADY_IMPORTED";
  const effectiveBlockMessage = blockMessage ?? (hasDuplicate ? blockCopy("ALREADY_IMPORTED") : null);

  return (
    <section
      aria-labelledby={`${testId}-title`}
      className={`rounded-2xl border bg-card p-5 shadow-sm sm:p-6${className ? ` ${className}` : ""}`}
      data-testid={testId}
    >
      <div className="flex items-start gap-3">
        {state === "retryable-error" ? (
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />
        ) : hasDuplicate ? (
          <Copy aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-700" />
        ) : (
          <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        )}
        <div>
          <h2 className="font-semibold" id={`${testId}-title`}>
            {title}
          </h2>
          {technicalError ? (
            <p
              aria-live="polite"
              className="mt-2 text-sm text-destructive"
              data-testid={`${testId}-error`}
              role="alert"
            >
              {technicalError}
            </p>
          ) : null}
          {effectiveBlockMessage ? (
            <p
              aria-live="polite"
              className={`mt-2 text-sm ${hasDuplicate ? "text-amber-800" : "text-muted-foreground"}`}
              data-testid={`${testId}-block-message`}
              role={hasDuplicate || blockReason === "NO_VALID_ROWS" ? "alert" : "status"}
            >
              {effectiveBlockMessage}
            </p>
          ) : null}
          {hasDuplicate && existingImportId ? (
            <p className="mt-1 text-xs text-muted-foreground" data-testid={`${testId}-existing-id`}>
              Importação existente: <span className="font-mono">{existingImportId}</span>
            </p>
          ) : null}
        </div>
      </div>

      <dl
        aria-label="Contagens da importação"
        className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5"
        data-testid={`${testId}-counts`}
      >
        {COUNT_ITEMS.map(({ key, label }) => (
          <div className="rounded-lg border bg-background px-3 py-3" key={key}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{counts[key]}</dd>
          </div>
        ))}
      </dl>

      {rowErrors.length > 0 ? (
        <div className="mt-5" data-testid={`${testId}-errors`}>
          <h3 className="text-sm font-semibold">Linhas que precisam de correção</h3>
          <ul className="mt-2 space-y-2" aria-label="Erros por linha">
            {rowErrors.map((rowError, index) => (
              <li
                className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm"
                data-testid={`${testId}-row-error-${rowError.rowNumber}-${index}`}
                key={`${rowError.rowNumber}-${rowError.code}-${rowError.field ?? "row"}-${index}`}
              >
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>
                  <span className="font-medium">Linha {rowError.rowNumber}:</span>{" "}
                  {rowError.message}
                  {rowError.field ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Campo: {FIELD_LABELS[rowError.field] ?? rowError.field}. Corrija essa coluna
                      no arquivo e gere uma nova prévia.
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {state === "retryable-error" && onRetry ? (
        <Button
          className="mt-5"
          data-testid={`${testId}-retry`}
          onClick={onRetry}
          type="button"
          variant="outline"
        >
          <CheckCircle2 aria-hidden="true" className="mr-2 size-4" />
          {retryLabel}
        </Button>
      ) : null}
    </section>
  );
}

export const ImportSummary = CsvImportSummary;
export const CsvImportCountsSummary = CsvImportSummary;
export const CsvImportErrorSummary = CsvImportSummary;
