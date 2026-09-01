"use client";

import Link from "next/link";
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import type {
  CsvImportConfirmationResult,
  CsvImportErrorCode,
  CsvImportPreview,
  CsvImportPreviewResult,
} from "@/modules/transaction-imports/contracts";
import {
  isCsvImportPreviewExpired,
  toCsvImportErrorViewModel,
  toCsvImportPreviewViewModel,
  toCsvImportResultViewModel,
  type CsvImportConfirmationAction,
  type CsvImportErrorViewModel,
  type CsvImportPreviewViewModel,
  type CsvImportResultViewModel,
} from "@/modules/transaction-imports/ui-contracts";

import {
  CsvImportAccountSelector,
  type CsvImportAccountOption,
} from "./account-selector";
import { CsvImportConfirmation } from "./csv-import-confirmation";
import { CsvFilePicker, type CsvFileSelectionError } from "./csv-file-picker";
import { CsvImportPreviewTable } from "./csv-import-preview-table";
import { CsvImportResult, CsvImportRetryNotice } from "./csv-import-result";
import { CsvImportSummary } from "./csv-import-summary";

/** Server Action shape used by the upload boundary. */
export type CsvImportPreviewAction = (
  input: unknown,
) => Promise<CsvImportPreviewResult>;

export interface CsvImportScreenProps {
  /** Account options are display context; the server validates the selection. */
  accounts: readonly CsvImportAccountOption[];
  previewAction: CsvImportPreviewAction;
  confirmationAction: CsvImportConfirmationAction;
  /** Optional durable report loaded by the server for a refreshable result URL. */
  initialResult?: CsvImportResultViewModel;
}

type ScreenState = "idle" | "loading" | "ready";

const PREVIEW_PAGE_SIZE = 25;
const PREVIEW_REFRESH_INTERVAL_MS = 15_000;

const FILE_SELECTION_ERROR_MESSAGES: Readonly<
  Record<CsvImportFileSelectionErrorCode, string>
> = {
  CSV_FILE_REQUIRED: "Selecione um arquivo CSV.",
  CSV_FILE_TOO_LARGE: "O arquivo CSV excede o limite de 5 MiB.",
  CSV_EMPTY_FILE: "O arquivo CSV está vazio.",
};

type CsvImportFileSelectionErrorCode = CsvFileSelectionError["code"];

function previewBlockMessage(preview: CsvImportPreviewViewModel): string | null {
  switch (preview.blockReason) {
    case "NO_VALID_ROWS":
      return "Nenhuma linha válida está disponível para confirmação.";
    case "ALREADY_IMPORTED":
      return "Este conjunto já foi importado para esta conta.";
    case "PREVIEW_EXPIRED":
      return "A prévia expirou. Envie o arquivo novamente.";
    case "PREVIEW_TOKEN_MISSING":
      return "Esta prévia não pode ser confirmada. Envie o arquivo novamente.";
    default:
      return null;
  }
}

function genericPreviewError(): CsvImportErrorViewModel {
  return toCsvImportErrorViewModel({
    code: "INVALID_COMMAND",
    scope: "preview",
    message: "",
  });
}

function fileSelectionError(
  error: CsvFileSelectionError,
): CsvImportErrorViewModel {
  return {
    code: error.code,
    scope: "file",
    message: FILE_SELECTION_ERROR_MESSAGES[error.code],
  };
}

function getInitialAccountId(accounts: readonly CsvImportAccountOption[]): string {
  return accounts.find((account) => account.status === "ACTIVE")?.id ?? "";
}

function confirmationNeedsNewPreview(
  errorCode: CsvImportErrorCode | undefined,
): boolean {
  return (
    errorCode === "PREVIEW_EXPIRED" ||
    errorCode === "PREVIEW_NOT_FOUND" ||
    errorCode === "PREVIEW_ALREADY_CONSUMED"
  );
}

/**
 * Complete S04 client flow: select account/file, request a server-owned
 * preview, inspect validated rows, and explicitly confirm the staging token.
 * The browser never parses CSV bytes or sends financial rows to confirmation.
 */
export function CsvImportScreen({
  accounts,
  previewAction,
  confirmationAction,
  initialResult,
}: CsvImportScreenProps) {
  const [accountId, setAccountId] = React.useState(() => getInitialAccountId(accounts));
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [screenState, setScreenState] = React.useState<ScreenState>("idle");
  const [serverPreview, setServerPreview] = React.useState<CsvImportPreview | null>(null);
  const [previewError, setPreviewError] = React.useState<CsvImportErrorViewModel | null>(null);
  const [accountError, setAccountError] = React.useState<string | undefined>(undefined);
  const [confirmationErrorCode, setConfirmationErrorCode] = React.useState<
    CsvImportErrorCode | undefined
  >(undefined);
  const [confirmationResult, setConfirmationResult] = React.useState<
    CsvImportResultViewModel | null
  >(initialResult ?? null);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [clock, setClock] = React.useState(() => new Date());
  const [filePickerVersion, setFilePickerVersion] = React.useState(0);
  const requestVersion = React.useRef(0);

  const preview = React.useMemo(
    () =>
      serverPreview
        ? toCsvImportPreviewViewModel(serverPreview, clock)
        : null,
    [clock, serverPreview],
  );

  React.useEffect(() => {
    if (!serverPreview) {
      return;
    }

    const timer = window.setInterval(() => setClock(new Date()), PREVIEW_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [serverPreview]);

  React.useEffect(() => {
    setPage(1);
  }, [serverPreview]);

  const previewRows = preview?.rows ?? [];
  const pageCount = Math.max(1, Math.ceil(previewRows.length / PREVIEW_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = previewRows.slice(
    (currentPage - 1) * PREVIEW_PAGE_SIZE,
    currentPage * PREVIEW_PAGE_SIZE,
  );
  const activeAccounts = accounts.filter((account) => account.status === "ACTIVE");

  function clearFlow({ keepAccount = true }: { keepAccount?: boolean } = {}) {
    requestVersion.current += 1;
    setScreenState("idle");
    setServerPreview(null);
    setPreviewError(null);
    setConfirmationResult(null);
    setConfirmationErrorCode(undefined);
    setAcknowledged(false);
    setPage(1);
    setSelectedFile(null);
    setFilePickerVersion((current) => current + 1);
    if (!keepAccount) {
      setAccountId("");
    }
  }

  function handleAccountChange(nextAccountId: string) {
    setAccountId(nextAccountId);
    setAccountError(undefined);
    // A preview is bound to the account chosen on the server. Selecting a
    // different account therefore invalidates the local confirmation flow.
    if (serverPreview && serverPreview.accountId !== nextAccountId) {
      clearFlow();
    }
  }

  function handleFileSelected(file: File | null) {
    setSelectedFile(file);
    if (file) {
      setPreviewError(null);
    }
    setConfirmationResult(null);
    setConfirmationErrorCode(undefined);
    setAcknowledged(false);
    if (serverPreview) {
      setServerPreview(null);
      setPage(1);
    }
  }

  function handleInvalidFile(error: CsvFileSelectionError) {
    setPreviewError(fileSelectionError(error));
    setScreenState("idle");
  }

  async function handlePreviewSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!accountId || !activeAccounts.some((account) => account.id === accountId)) {
      setAccountError("Selecione uma conta ativa para continuar.");
      return;
    }

    if (!selectedFile) {
      setPreviewError(fileSelectionError({ code: "CSV_FILE_REQUIRED", message: "" }));
      return;
    }

    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setScreenState("loading");
    setPreviewError(null);
    setConfirmationResult(null);
    setConfirmationErrorCode(undefined);
    setAcknowledged(false);

    const formData = new FormData();
    formData.set("accountId", accountId);
    formData.set("file", selectedFile);

    try {
      const result = await previewAction(formData);
      if (requestVersion.current !== version) {
        return;
      }

      if (result.ok) {
        setServerPreview(result.value);
        setClock(new Date());
        setScreenState("ready");
      } else {
        setServerPreview(null);
        setPreviewError(toCsvImportErrorViewModel(result.error));
        setScreenState("idle");
      }
    } catch {
      if (requestVersion.current === version) {
        setServerPreview(null);
        setPreviewError(genericPreviewError());
        setScreenState("idle");
      }
    }
  }

  function handleCancelPreview() {
    clearFlow();
  }

  function handleConfirmationCompleted(result: CsvImportConfirmationResult) {
    setConfirmationResult(toCsvImportResultViewModel(result));
    setConfirmationErrorCode(undefined);
  }

  function handleConfirmationFailed(error: { code?: CsvImportErrorCode }) {
    // Unexpected failures still receive a stable, non-sensitive code so the
    // screen can give the user a safe retry instruction without echoing the
    // server exception.
    setConfirmationErrorCode(error.code ?? "INVALID_COMMAND");
  }

  const isLoading = screenState === "loading";
  const hasValidPreview = preview !== null;
  const confirmationBlocked = preview
    ? previewBlockMessage(preview) ??
      (!acknowledged ? "Marque a confirmação explícita para continuar." : null)
    : null;
  const docsLink = "#csv-import-format";
  const exampleLink = "#csv-import-example";

  return (
    <section className="space-y-6" data-testid="csv-import-screen">
      <PageHeader
        action={
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="csv-import-back"
            href="/transactions"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Lançamentos
          </Link>
        }
        description="Envie um CSV normalizado, revise as linhas válidas e confirme os lançamentos da conta escolhida."
        eyebrow="Movimentações"
        title="Importar extrato CSV"
      />

      <section
        aria-labelledby="csv-import-format-title"
        className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
        data-testid="csv-import-format"
        id="csv-import-format"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <FileText aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold" id="csv-import-format-title">
              Formato aceito
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Use o formato canônico <code>s04-csv-v1</code>, com UTF-8 e vírgula como
              delimitador. O servidor valida o conteúdo antes de criar qualquer lançamento.
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              <a
                className="font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="csv-import-documentation-link"
                href={docsLink}
              >
                Documentação do formato
              </a>
              <a
                className="font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="csv-import-example-link"
                href={exampleLink}
              >
                Ver exemplo CSV
              </a>
            </div>
          </div>
        </div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3" data-testid="csv-import-limits">
          <div className="rounded-lg border bg-background px-3 py-3">
            <dt className="text-xs text-muted-foreground">Tamanho máximo</dt>
            <dd className="mt-1 font-semibold">5 MiB</dd>
          </div>
          <div className="rounded-lg border bg-background px-3 py-3">
            <dt className="text-xs text-muted-foreground">Registros de dados</dt>
            <dd className="mt-1 font-semibold">10.000</dd>
          </div>
          <div className="rounded-lg border bg-background px-3 py-3">
            <dt className="text-xs text-muted-foreground">Campo individual</dt>
            <dd className="mt-1 font-semibold">16 KiB</dd>
          </div>
        </dl>
        <pre
          className="mt-5 overflow-x-auto rounded-lg bg-secondary/70 p-4 text-xs leading-6"
          data-testid="csv-import-example"
          id="csv-import-example"
        >
          {"occurred_on,description,amount_cents,external_id\n2026-08-29,\"Salário, mês 08\",125000,sal-2026-08\n2026-08-30,Café,-1875,"}
        </pre>
      </section>

      <section
        aria-labelledby="csv-import-upload-title"
        className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
        data-testid="csv-import-upload"
      >
        <div>
          <h2 className="font-semibold" id="csv-import-upload-title">
            1. Escolha a conta e o arquivo
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Selecionar ou enviar um arquivo apenas prepara a prévia; nada é criado antes da confirmação.
          </p>
        </div>

        <form className="mt-5 space-y-5" onSubmit={handlePreviewSubmit}>
          <CsvImportAccountSelector
            accounts={accounts}
            error={accountError}
            onAccountChange={handleAccountChange}
            value={accountId}
          />
          <CsvFilePicker
            error={previewError?.scope === "file" ? previewError.message : undefined}
            key={filePickerVersion}
            onFileChange={handleFileSelected}
            onInvalidFile={handleInvalidFile}
            state={isLoading ? "loading" : previewError?.scope === "file" ? "invalid" : "idle"}
          />
          <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center">
            <Button
              data-testid="csv-import-preview-submit"
              disabled={isLoading || activeAccounts.length === 0}
              type="submit"
            >
              {isLoading ? "Gerando prévia…" : "Gerar prévia"}
            </Button>
            {isLoading ? (
              <Button
                data-testid="csv-import-preview-cancel"
                onClick={handleCancelPreview}
                type="button"
                variant="outline"
              >
                Cancelar
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">
              O arquivo será validado no servidor antes de qualquer confirmação.
            </p>
          </div>
        </form>

        {previewError && previewError.scope !== "file" ? (
          <div
            aria-live="polite"
            className="mt-5 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            data-testid="csv-import-preview-error"
            role="alert"
          >
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">
                Não foi possível gerar a prévia
              </p>
              <p className="mt-1">{previewError.message}</p>
              {previewError.rowNumber ? (
                <p className="mt-1">Linha {previewError.rowNumber}.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      {hasValidPreview && preview && !confirmationResult ? (
        <section
          aria-labelledby="csv-import-preview-title"
          className="space-y-5"
          data-testid="csv-import-preview"
        >
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
              2. Revise antes de confirmar
            </p>
            <h2 className="mt-2 text-2xl font-semibold" id="csv-import-preview-title">
              Prévia da importação
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Os dados abaixo foram normalizados e validados pelo servidor. Linhas com erro não
              serão criadas.
            </p>
          </div>

          <CsvImportSummary
            blockReason={preview.blockReason}
            counts={preview.counts}
            duplicateStatus={preview.duplicateStatus}
            errors={preview.errors}
            existingImportId={preview.existingImportId}
            testId="csv-import-preview-summary"
          />

          <div
            aria-live="polite"
            className={`rounded-2xl border px-5 py-4 text-sm ${
              preview.canConfirm
                ? "border-primary/20 bg-primary/5 text-foreground"
                : "border-amber-200 bg-amber-50 text-amber-950"
            }`}
            data-testid="csv-import-create-count"
          >
            {preview.canConfirm ? (
              <>
                <p className="font-semibold">
                  Serão criadas {preview.counts.valid} transações nesta conta.
                </p>
                <p className="mt-1 text-sm opacity-80">
                  A confirmação usa somente as linhas válidas da prévia.
                </p>
              </>
            ) : (
              <p className="font-semibold">
                {previewBlockMessage(preview) ?? "Esta prévia está bloqueada para confirmação."}
              </p>
            )}
          </div>

          <div
            className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
            data-testid="csv-import-partial-strategy"
          >
            <h3 className="font-semibold">Estratégia parcial explícita</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {preview.counts.invalid > 0
                ? "As linhas válidas serão criadas em uma única operação; as linhas com erro serão ignoradas e permanecerão no relatório."
                : "Todas as linhas válidas serão criadas em uma única operação após sua confirmação."}
            </p>
          </div>

          <CsvImportPreviewTable rows={pageRows} testId="csv-import-preview-table" />

          {previewRows.length > PREVIEW_PAGE_SIZE ? (
            <nav
              aria-label="Paginação das linhas válidas"
              className="flex items-center justify-between rounded-lg border bg-card px-3 py-2"
              data-testid="csv-import-preview-pagination"
            >
              <Button
                aria-label="Página anterior"
                data-testid="csv-import-preview-previous"
                disabled={currentPage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                size="sm"
                type="button"
                variant="outline"
              >
                <ChevronLeft aria-hidden="true" className="mr-1 size-4" />
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                Página {currentPage} de {pageCount}
              </span>
              <Button
                aria-label="Próxima página"
                data-testid="csv-import-preview-next"
                disabled={currentPage >= pageCount}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                size="sm"
                type="button"
                variant="outline"
              >
                Próxima
                <ChevronRight aria-hidden="true" className="ml-1 size-4" />
              </Button>
            </nav>
          ) : null}

          {preview.expiresAt ? (
            <p className="text-xs text-muted-foreground" data-testid="csv-import-preview-expiration">
              Esta prévia expira em {new Date(preview.expiresAt).toLocaleString("pt-BR")}.
              {isCsvImportPreviewExpired(preview, clock) ? " Gere uma nova prévia para continuar." : ""}
            </p>
          ) : null}

          <section
            aria-labelledby="csv-import-confirm-title"
            className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
            data-testid="csv-import-confirm"
          >
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
                3. Confirme a operação
              </p>
              <h3 className="mt-2 text-xl font-semibold" id="csv-import-confirm-title">
                Criar os lançamentos válidos?
              </h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Essa ação cria os lançamentos da prévia na conta escolhida. O envio do arquivo,
                por si só, nunca cria transações.
              </p>
            </div>

            <label className="mt-5 flex items-start gap-3 text-sm" htmlFor="csv-import-acknowledged">
              <input
                checked={acknowledged}
                className="mt-0.5 size-4 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="csv-import-acknowledged"
                disabled={!preview.canConfirm}
                id="csv-import-acknowledged"
                onChange={(event) => setAcknowledged(event.target.checked)}
                type="checkbox"
              />
              <span>
                Confirmo que revisei a prévia e autorizo a criação das linhas válidas.
              </span>
            </label>

            <div className="mt-5">
              <CsvImportConfirmation
                blockReason={confirmationBlocked}
                disabled={
                  !preview.canConfirm ||
                  !acknowledged ||
                  confirmationNeedsNewPreview(confirmationErrorCode)
                }
                errorCode={confirmationErrorCode}
                onConfirm={confirmationAction}
                onCompleted={handleConfirmationCompleted}
                onFailed={handleConfirmationFailed}
                previewToken={preview.previewToken}
                testId="csv-import-confirmation"
              />
              {confirmationErrorCode ? (
                <CsvImportRetryNotice
                  errorCode={confirmationErrorCode}
                  onRetry={
                    confirmationNeedsNewPreview(confirmationErrorCode)
                      ? () => clearFlow()
                      : undefined
                  }
                  retryLabel="Enviar arquivo novamente"
                  testId="csv-import-confirmation-retry-notice"
                />
              ) : null}
            </div>
          </section>
        </section>
      ) : null}

      {confirmationResult ? (
        <CsvImportResult
          navigation={
            serverPreview
              ? {
                  accountId: serverPreview.accountId,
                  rows: serverPreview.rows,
                }
              : undefined
          }
          onNewImport={() => clearFlow()}
          newImportTestId="csv-import-new"
          result={confirmationResult}
          testId="csv-import-result"
        />
      ) : null}
    </section>
  );
}

export const TransactionImportScreen = CsvImportScreen;
export const CsvImportPage = CsvImportScreen;
