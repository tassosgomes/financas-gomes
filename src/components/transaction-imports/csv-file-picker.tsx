"use client";

import * as React from "react";
import { FileUp } from "lucide-react";

import {
  CSV_IMPORT_ERROR_MESSAGES,
  CSV_IMPORT_MAX_FILE_BYTES,
} from "@/modules/transaction-imports/contracts";

export type CsvFilePickerState = "idle" | "loading" | "invalid";

export type CsvFileSelectionErrorCode =
  | "CSV_FILE_REQUIRED"
  | "CSV_FILE_TOO_LARGE"
  | "CSV_EMPTY_FILE";

export interface CsvFileSelectionError {
  code: CsvFileSelectionErrorCode;
  message: string;
}

export interface CsvFilePickerProps {
  /** File bytes are forwarded to the preview adapter; this component never parses them. */
  onFileSelected?: (file: File | null) => void;
  /** Alias for integrations that use the native input vocabulary. */
  onFileChange?: (file: File | null) => void;
  onInvalidFile?: (error: CsvFileSelectionError) => void;
  state?: CsvFilePickerState;
  /** Controlled error copy should be a stable, server-approved message. */
  error?: string;
  selectedFileName?: string | null;
  selectedFileSizeBytes?: number | null;
  disabled?: boolean;
  id?: string;
  label?: string;
  description?: string;
  testId?: string;
  className?: string;
}

const DROPZONE_CLASS_NAME =
  "relative flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-card px-6 py-8 text-center outline-none transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-ring hover:border-primary/70 data-[dragging=true]:border-primary data-[dragging=true]:bg-primary/5 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-60";

/**
 * Performs only cheap, non-authoritative browser checks. Encoding, CSV
 * quoting, headers, rows and all financial validation remain server-owned.
 */
export function validateCsvFileSelection(
  file: Pick<File, "size"> | null | undefined,
): CsvFileSelectionError | null {
  if (!file) {
    return {
      code: "CSV_FILE_REQUIRED",
      message: CSV_IMPORT_ERROR_MESSAGES.CSV_FILE_REQUIRED,
    };
  }
  if (file.size === 0) {
    return {
      code: "CSV_EMPTY_FILE",
      message: CSV_IMPORT_ERROR_MESSAGES.CSV_EMPTY_FILE,
    };
  }
  if (file.size > CSV_IMPORT_MAX_FILE_BYTES) {
    return {
      code: "CSV_FILE_TOO_LARGE",
      message: CSV_IMPORT_ERROR_MESSAGES.CSV_FILE_TOO_LARGE,
    };
  }
  return null;
}

function formatFileSize(sizeBytes: number | null | undefined): string | null {
  if (sizeBytes === null || sizeBytes === undefined || !Number.isFinite(sizeBytes)) {
    return null;
  }
  if (sizeBytes < 1024) {
    return `${Math.max(0, Math.round(sizeBytes))} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KiB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * Accessible picker/dropzone for canonical CSV uploads. MIME and filename are
 * hints only; the server parser remains responsible for accepting/rejecting
 * the actual byte stream.
 */
export function CsvFilePicker({
  onFileSelected,
  onFileChange,
  onInvalidFile,
  state = "idle",
  error,
  selectedFileName,
  selectedFileSizeBytes,
  disabled = false,
  id = "csv-import-file",
  label = "Arquivo CSV",
  description = "Selecione ou arraste um CSV no formato s04-csv-v1. O limite é 5 MiB.",
  testId = "csv-file-picker",
  className,
}: CsvFilePickerProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [localFileName, setLocalFileName] = React.useState<string | null>(null);
  const [localFileSize, setLocalFileSize] = React.useState<number | null>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const isDisabled = disabled || state === "loading";
  const effectiveError = error ?? localError;
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  const selectedName = selectedFileName === undefined ? localFileName : selectedFileName;
  const selectedSize =
    selectedFileSizeBytes === undefined ? localFileSize : selectedFileSizeBytes;
  const selectedSizeLabel = formatFileSize(selectedSize);
  const handleFileSelected = onFileSelected ?? onFileChange;
  const describedBy = [description ? descriptionId : null, effectiveError ? errorId : null]
    .filter(Boolean)
    .join(" ");

  function emitFile(file: File | null) {
    const validationError = validateCsvFileSelection(file);
    if (validationError) {
      setLocalFileName(null);
      setLocalFileSize(null);
      setLocalError(validationError.message);
      onInvalidFile?.(validationError);
      handleFileSelected?.(null);
      return;
    }

    setLocalError(null);
    setLocalFileName(file?.name ?? null);
    setLocalFileSize(file?.size ?? null);
    handleFileSelected?.(file);
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    emitFile(event.target.files?.[0] ?? null);
    // Selecting the same file again must trigger a change and safe retry.
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (isDisabled) {
      return;
    }
    emitFile(event.dataTransfer.files?.[0] ?? null);
  }

  function handleDragOver(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (!isDisabled) {
      event.dataTransfer.dropEffect = "copy";
      setIsDragging(true);
    }
  }

  function handleDragLeave(event: React.DragEvent<HTMLLabelElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  }

  const stateMessage =
    state === "loading"
      ? "Enviando arquivo para validação…"
      : state === "invalid"
        ? effectiveError ?? "O arquivo não pôde ser usado."
        : null;

  return (
    <div className={className} data-testid={testId}>
      <p className="mb-2 text-sm font-medium" id={`${id}-label`}>
        {label}
      </p>
      {description ? (
        <p className="mb-3 text-xs text-muted-foreground" id={descriptionId}>
          {description}
        </p>
      ) : null}
      <label
        aria-describedby={describedBy || undefined}
        aria-disabled={isDisabled || undefined}
        className={DROPZONE_CLASS_NAME}
        data-dragging={isDragging || undefined}
        data-disabled={isDisabled || undefined}
        data-testid={`${testId}-dropzone`}
        htmlFor={id}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <FileUp aria-hidden="true" className="mb-2 size-7 text-muted-foreground" />
        <span className="text-sm font-medium">
          {isDisabled ? "Aguarde…" : "Escolher arquivo ou arrastar aqui"}
        </span>
        <span className="mt-1 text-xs text-muted-foreground">
          O formato e os dados serão validados no servidor.
        </span>
        <input
          accept=".csv,text/csv"
          aria-labelledby={`${id}-label`}
          aria-describedby={describedBy || undefined}
          className="sr-only"
          data-testid={`${testId}-input`}
          disabled={isDisabled}
          id={id}
          onChange={handleInputChange}
          ref={inputRef}
          type="file"
        />
      </label>
      {selectedName ? (
        <p
          className="mt-3 text-sm text-muted-foreground"
          data-testid={`${testId}-selected`}
        >
          Arquivo selecionado: <span className="font-medium">{selectedName}</span>
          {selectedSizeLabel ? ` (${selectedSizeLabel})` : ""}
        </p>
      ) : null}
      {stateMessage ? (
        <p
          aria-live="polite"
          className={state === "loading" ? "mt-3 text-sm text-muted-foreground" : "mt-3 text-sm text-destructive"}
          data-testid={`${testId}-state`}
          id={state === "invalid" ? errorId : undefined}
          role={state === "loading" ? "status" : "alert"}
        >
          {stateMessage}
        </p>
      ) : null}
      {effectiveError && state !== "invalid" ? (
        <p
          aria-live="polite"
          className="mt-3 text-sm text-destructive"
          data-testid={`${testId}-error`}
          id={errorId}
          role="alert"
        >
          {effectiveError}
        </p>
      ) : null}
      <span className="sr-only">Limite máximo: 5 MiB.</span>
    </div>
  );
}

export const CsvDropzone = CsvFilePicker;
export const FilePicker = CsvFilePicker;
export const ImportCsvFilePicker = CsvFilePicker;
