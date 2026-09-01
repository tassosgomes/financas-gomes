import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Copy, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CSV_IMPORT_ERROR_MESSAGES,
} from "@/modules/transaction-imports/contracts";
import type {
  CsvImportConfirmationResult,
  CsvImportErrorCode,
  CsvImportPreviewRow,
} from "@/modules/transaction-imports/contracts";
import type {
  CsvImportResultViewModel,
} from "@/modules/transaction-imports/ui-contracts";
import { TRANSACTION_IMPORT_ROUTE, TRANSACTIONS_ROUTE } from "@/modules/transactions/routes";

import { CsvImportSummary } from "./csv-import-summary";

/** Query key used to reopen a durable, tenant-scoped import report. */
export const CSV_IMPORT_RESULT_QUERY_PARAM = "importId" as const;

export interface CsvImportResultNavigationOptions {
  /** Server-provided account context; never taken from a browser override. */
  accountId: string;
  /** Valid preview rows are used only to derive the visible date range. */
  rows?: readonly Pick<CsvImportPreviewRow, "occurredOn">[];
}

export interface CsvImportResultProps {
  result: CsvImportResultViewModel;
  navigation?: CsvImportResultNavigationOptions;
  onNewImport?: () => void;
  /** Allows the parent flow to preserve an existing automation hook. */
  newImportTestId?: string;
  testId?: string;
  className?: string;
}

export interface CsvImportRetryNoticeProps {
  errorCode?: CsvImportErrorCode;
  onRetry?: () => void;
  retryLabel?: string;
  testId?: string;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function dateRange(
  rows: readonly Pick<CsvImportPreviewRow, "occurredOn">[],
): { from?: string; to?: string } {
  const dates = rows
    .map((row) => row.occurredOn)
    .filter(isIsoDate)
    .sort();

  if (dates.length === 0) {
    return {};
  }

  return { from: dates[0], to: dates[dates.length - 1] };
}

/**
 * Builds the least-privileged link to the existing S03 transaction list.
 * Account and period are the filters currently supported by that route. The
 * list is intentionally manual-only today, so an unsupported `origin=IMPORT`
 * parameter is not fabricated here; when S03 exposes it, this helper can add
 * it without changing the result contract.
 */
export function csvImportTransactionsHref({
  accountId,
  rows = [],
}: CsvImportResultNavigationOptions): string {
  const params = new URLSearchParams();
  const normalizedAccountId = accountId.trim();
  if (normalizedAccountId.length > 0) {
    params.set("accountId", normalizedAccountId);
  }

  const range = dateRange(rows);
  if (range.from) {
    params.set("from", range.from);
  }
  if (range.to) {
    params.set("to", range.to);
  }

  const query = params.toString();
  return query ? `${TRANSACTIONS_ROUTE}?${query}` : TRANSACTIONS_ROUTE;
}

export function csvImportResultHref(importId: string): string {
  const params = new URLSearchParams();
  const normalizedImportId = importId.trim();
  if (normalizedImportId.length > 0) {
    params.set(CSV_IMPORT_RESULT_QUERY_PARAM, normalizedImportId);
  }
  const query = params.toString();
  return query ? `${TRANSACTION_IMPORT_ROUTE}?${query}` : TRANSACTION_IMPORT_ROUTE;
}

function resultAccountId(result: CsvImportConfirmationResult): string {
  return result.accountId;
}

/**
 * Final report used after confirmation and when a durable T08 report is
 * rehydrated. It keeps the distinction between a new import and an idempotent
 * duplicate visible, and delegates all counts/messages to T05's safe summary.
 */
export function CsvImportResult({
  result,
  navigation,
  onNewImport,
  newImportTestId,
  testId = "csv-import-result",
  className,
}: CsvImportResultProps) {
  const importedResult = result.result.status === "IMPORTED";
  const accountId = navigation?.accountId ?? resultAccountId(result.result);
  const transactionsHref = csvImportTransactionsHref({
    accountId,
    rows: navigation?.rows,
  });
  const reportId = result.result.status === "IMPORTED"
    ? result.result.importId
    : result.result.existingImportId;

  return (
    <section
      aria-labelledby={`${testId}-title`}
      className={`space-y-5${className ? ` ${className}` : ""}`}
      data-state={result.uiState}
      data-testid={testId}
    >
      <header
        aria-live="polite"
        className={`rounded-2xl border px-5 py-5 shadow-sm sm:px-6 ${
          importedResult
            ? "border-emerald-200 bg-emerald-50 text-emerald-950"
            : "border-amber-200 bg-amber-50 text-amber-950"
        }`}
        data-testid={`${testId}-status`}
        role="status"
      >
        <div className="flex items-start gap-3">
          {importedResult ? (
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          ) : (
            <Copy aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          )}
          <div>
            <h2 className="font-semibold" id={`${testId}-title`}>
              {result.title}
            </h2>
            <p className="mt-1 text-sm leading-6 opacity-90">{result.description}</p>
            <p className="mt-2 text-sm font-medium" data-testid={`${testId}-created-copy`}>
              {importedResult
                ? `Criadas ${result.result.counts.imported} transações; ${result.result.counts.invalid} linha(s) permaneceram com erro.`
                : `Nenhuma nova transação foi criada; ${result.result.counts.ignoredDuplicate} linha(s) foram ignoradas por duplicidade.`}
            </p>
          </div>
        </div>
      </header>

      <CsvImportSummary
        blockReason={importedResult ? null : "ALREADY_IMPORTED"}
        counts={result.result.counts}
        duplicateStatus={importedResult ? "NEW" : "ALREADY_IMPORTED"}
        errors={result.result.errors}
        existingImportId={
          result.result.status === "IMPORTED"
            ? null
            : result.result.existingImportId
        }
        state={importedResult ? "ready" : "duplicate"}
        testId={`${testId}-summary`}
        title="Contagens do processamento"
      />

      <section
        aria-labelledby={`${testId}-next-step-title`}
        className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
        data-testid={`${testId}-next-step`}
      >
        <h3 className="font-semibold" id={`${testId}-next-step-title`}>
          Próximo passo
        </h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {importedResult
            ? "Consulte os lançamentos da conta e do período da prévia para conferir o que foi criado."
            : "Consulte os lançamentos existentes para conferir o conjunto que já estava nesta conta."}
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={`${testId}-transactions`}
            href={transactionsHref}
          >
            Ver lançamentos {importedResult ? "importados" : "existentes"}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={`${testId}-report-link`}
            href={csvImportResultHref(reportId)}
          >
            Abrir este resultado novamente
          </Link>
          {onNewImport ? (
            <Button
              data-testid={newImportTestId ?? `${testId}-new-import`}
              onClick={onNewImport}
              type="button"
              variant="outline"
            >
              <RotateCcw aria-hidden="true" className="mr-2 size-4" />
              Importar outro arquivo
            </Button>
          ) : (
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`${testId}-new-import-link`}
              href={TRANSACTION_IMPORT_ROUTE}
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Importar outro arquivo
            </Link>
          )}
        </div>
      </section>
    </section>
  );
}

/**
 * Error state shown beside T05's confirmation control. It is deliberately
 * generic: retrying the same command is safe, while sending a second file or
 * exposing a token/fingerprint in a toast or URL is not.
 */
export function CsvImportRetryNotice({
  errorCode,
  onRetry,
  retryLabel = "Tentar novamente",
  testId = "csv-import-retry-notice",
}: CsvImportRetryNoticeProps) {
  const effectiveErrorCode = errorCode ?? "INVALID_COMMAND";
  const message = CSV_IMPORT_ERROR_MESSAGES[effectiveErrorCode];
  const needsNewPreview =
    effectiveErrorCode === "PREVIEW_EXPIRED" ||
    effectiveErrorCode === "PREVIEW_NOT_FOUND" ||
    effectiveErrorCode === "PREVIEW_ALREADY_CONSUMED";

  return (
    <aside
      aria-live="polite"
      className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      data-state="retryable-error"
      data-testid={testId}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium">A confirmação não foi concluída</p>
          <p className="mt-1">{message}</p>
          <p className="mt-1">
            {needsNewPreview
              ? "Gere uma nova prévia antes de confirmar novamente."
              : "Tente novamente com a mesma prévia. O identificador da operação será reutilizado para evitar duplicidade; não é necessário enviar outro arquivo."}
          </p>
          {onRetry ? (
            <Button
              className="mt-3"
              data-testid={`${testId}-retry`}
              onClick={onRetry}
              type="button"
              variant="outline"
            >
              {retryLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

export const CsvImportResultScreen = CsvImportResult;
export const ImportResult = CsvImportResult;
