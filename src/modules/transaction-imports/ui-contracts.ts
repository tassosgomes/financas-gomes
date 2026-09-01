import { generateUuidV7 } from "@/lib/uuidv7";

import {
  CSV_IMPORT_ERROR_MESSAGES,
  CSV_IMPORT_FORMAT_VERSION,
  CSV_IMPORT_MAX_FILE_BYTES,
  type ConfirmTransactionImportCommand,
  type CsvImportConfirmationResult,
  type CsvImportDuplicateStatus,
  type CsvImportError,
  type CsvImportErrorCode,
  type CsvImportPreview,
  type CsvImportRowError,
} from "./contracts";

/** UI-only state; it does not represent a server-side import status. */
export const CSV_IMPORT_UI_STATES = [
  "idle",
  "loading",
  "invalid-file",
  "preview",
  "no-valid-rows",
  "duplicate",
  "expired",
  "confirming",
  "retryable-error",
  "imported",
] as const;

export type CsvImportUiState = (typeof CSV_IMPORT_UI_STATES)[number];

export type CsvImportPreviewBlockReason =
  | "NO_VALID_ROWS"
  | "ALREADY_IMPORTED"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_TOKEN_MISSING";

/**
 * A preview model for components. The server response remains the source of
 * all counts and rows; the two extra fields only describe presentation and
 * button state. No candidate, fingerprint, household, or account authority
 * is created in this model.
 */
export interface CsvImportPreviewViewModel extends CsvImportPreview {
  canConfirm: boolean;
  blockReason: CsvImportPreviewBlockReason | null;
  uiState: Extract<
    CsvImportUiState,
    "preview" | "no-valid-rows" | "duplicate" | "expired"
  >;
}

/** Report model used by the result screen and retry-safe confirmation UI. */
export interface CsvImportResultViewModel {
  result: CsvImportConfirmationResult;
  uiState: Extract<CsvImportUiState, "imported" | "duplicate">;
  isDuplicate: boolean;
  title: string;
  description: string;
}

export interface CsvImportDuplicateBlockViewModel {
  status: CsvImportDuplicateStatus;
  blocked: boolean;
  existingImportId: string | null;
}

export type CsvImportCountsViewModel = CsvImportPreview["counts"];
export type CsvImportPreviewModel = CsvImportPreviewViewModel;
export type CsvImportFinalReportViewModel = CsvImportResultViewModel;

/** Safe error model: message is selected from the stable ADR vocabulary. */
export interface CsvImportErrorViewModel {
  code: CsvImportErrorCode;
  scope: CsvImportError["scope"];
  message: string;
  rowNumber?: number;
  field?: CsvImportError["field"];
}

export interface CsvImportRowErrorViewModel
  extends Omit<CsvImportErrorViewModel, "scope" | "rowNumber" | "field"> {
  scope: "row";
  rowNumber: number;
  field?: CsvImportRowError["field"];
}

/**
 * Confirmation state is intentionally independent from the result status.
 * An expected conflict or infrastructure failure can be retried with the
 * same command through the action adapter.
 */
export type CsvImportConfirmationUiState =
  | "idle"
  | "confirming"
  | "retryable-error"
  | "completed"
  | "duplicate";

export interface CsvImportConfirmationAttempt {
  commandId: string;
  previewToken: string;
}

export interface CsvImportConfirmationAttemptRef {
  current: CsvImportConfirmationAttempt | null;
}

/** A server action adapter accepts exactly the serializable command fields. */
export type CsvImportConfirmationAction = (
  command: ConfirmTransactionImportCommand,
) => Promise<CsvImportConfirmationResult>;

export const CSV_IMPORT_MAX_FILE_SIZE_LABEL = "5 MiB";

/**
 * Command IDs follow the S03 boundary: opaque, trimmed, non-empty, without
 * control/format characters, and no longer than 128 characters. UUIDv7 is
 * generated for normal browser attempts, while the predicate also permits a
 * server-compatible opaque ID supplied by an adapter.
 */
export function isValidCsvImportCommandId(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim();
  return (
    normalized.length > 0 &&
    normalized.length <= 128 &&
    !/[\p{Cc}\p{Cf}]/u.test(normalized)
  );
}

/** Preview tokens are opaque and must never be normalized by the client. */
export function isUsableCsvImportPreviewToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Creates the minimum confirmation payload. The function deliberately has no
 * account/household/candidate/fingerprint parameters, making accidental
 * client authority difficult to express at the call site.
 */
export function createCsvImportConfirmationCommand(
  previewToken: string,
  commandId: string = generateUuidV7(),
): ConfirmTransactionImportCommand {
  if (!isUsableCsvImportPreviewToken(previewToken)) {
    throw new Error("A preview token is required to confirm an import");
  }
  if (!isValidCsvImportCommandId(commandId)) {
    throw new Error("A valid command ID is required to confirm an import");
  }

  return { commandId: commandId.trim(), previewToken };
}

/**
 * Reuses one command ID while retrying the same preview. A new preview token
 * starts a new attempt, preventing command reuse across different payloads.
 */
export function commandForCsvImportAttempt(
  previewToken: string,
  attempt: CsvImportConfirmationAttemptRef,
): ConfirmTransactionImportCommand {
  if (!isUsableCsvImportPreviewToken(previewToken)) {
    throw new Error("A preview token is required to confirm an import");
  }

  if (
    !attempt.current ||
    attempt.current.previewToken !== previewToken ||
    !isValidCsvImportCommandId(attempt.current.commandId)
  ) {
    attempt.current = {
      commandId: generateUuidV7(),
      previewToken,
    };
  }

  return createCsvImportConfirmationCommand(
    attempt.current.previewToken,
    attempt.current.commandId,
  );
}

export const commandForTransactionImportAttempt = commandForCsvImportAttempt;
export const createConfirmTransactionImportCommand =
  createCsvImportConfirmationCommand;

/** Returns true only after the server-provided expiration instant. */
export function isCsvImportPreviewExpired(
  preview: Pick<CsvImportPreview, "expiresAt">,
  now: Date | string = new Date(),
): boolean {
  const expiresAt = Date.parse(preview.expiresAt);
  const nowTime = typeof now === "string" ? Date.parse(now) : now.getTime();
  return (
    Number.isFinite(expiresAt) &&
    Number.isFinite(nowTime) &&
    nowTime >= expiresAt
  );
}

function previewBlockReason(
  preview: CsvImportPreview,
  now: Date | string,
): CsvImportPreviewBlockReason | null {
  if (preview.counts.valid <= 0) {
    return "NO_VALID_ROWS";
  }
  if (preview.duplicateStatus === "ALREADY_IMPORTED") {
    return "ALREADY_IMPORTED";
  }
  if (isCsvImportPreviewExpired(preview, now)) {
    return "PREVIEW_EXPIRED";
  }
  if (!isUsableCsvImportPreviewToken(preview.previewToken)) {
    return "PREVIEW_TOKEN_MISSING";
  }
  return null;
}

export function toCsvImportDuplicateBlockViewModel(
  preview: Pick<
    CsvImportPreview,
    "duplicateStatus" | "existingImportId"
  >,
): CsvImportDuplicateBlockViewModel {
  return {
    status: preview.duplicateStatus,
    blocked: preview.duplicateStatus === "ALREADY_IMPORTED",
    existingImportId:
      preview.duplicateStatus === "ALREADY_IMPORTED"
        ? preview.existingImportId
        : null,
  };
}

/**
 * Maps the server preview to a presentation model without changing the
 * server-provided financial rows or counts. The server remains authoritative
 * when a stale browser clock disagrees about expiration.
 */
export function toCsvImportPreviewViewModel(
  preview: CsvImportPreview,
  now: Date | string = new Date(),
): CsvImportPreviewViewModel {
  const blockReason = previewBlockReason(preview, now);
  const uiState: CsvImportPreviewViewModel["uiState"] =
    blockReason === "NO_VALID_ROWS"
      ? "no-valid-rows"
      : blockReason === "ALREADY_IMPORTED"
        ? "duplicate"
        : blockReason === "PREVIEW_EXPIRED"
          ? "expired"
          : "preview";

  return {
    ...preview,
    rows: preview.rows.slice(),
    errors: preview.errors.map(toCsvImportRowErrorViewModel),
    canConfirm: blockReason === null,
    blockReason,
    uiState,
  };
}

/** Stable message mapping prevents parser/DB text from reaching the browser. */
export function toCsvImportErrorViewModel(
  error: CsvImportError,
): CsvImportErrorViewModel {
  return {
    code: error.code,
    scope: error.scope,
    message: CSV_IMPORT_ERROR_MESSAGES[error.code],
    ...(error.rowNumber === undefined ? {} : { rowNumber: error.rowNumber }),
    ...(error.field === undefined ? {} : { field: error.field }),
  };
}

export function toCsvImportRowErrorViewModel(
  error: CsvImportRowError,
): CsvImportRowErrorViewModel {
  return {
    code: error.code,
    scope: "row",
    rowNumber: error.rowNumber,
    message: CSV_IMPORT_ERROR_MESSAGES[error.code],
    ...(error.field === undefined ? {} : { field: error.field }),
  };
}

export function toCsvImportRowErrorViewModels(
  errors: readonly CsvImportRowError[],
): CsvImportRowErrorViewModel[] {
  return errors.map(toCsvImportRowErrorViewModel);
}

export function toCsvImportResultViewModel(
  result: CsvImportConfirmationResult,
): CsvImportResultViewModel {
  const isDuplicate = result.status === "DUPLICATE_DATASET";
  return {
    result: {
      ...result,
      errors: toCsvImportRowErrorViewModels(result.errors),
    },
    uiState: isDuplicate ? "duplicate" : "imported",
    isDuplicate,
    title: isDuplicate
      ? "Este conjunto já foi importado"
      : "Importação concluída",
    description: isDuplicate
      ? "Nenhum novo lançamento foi criado para esta conta."
      : "As linhas válidas foram adicionadas aos lançamentos da conta.",
  };
}

/** Server-owned format metadata displayed by upload guidance. */
export const CSV_IMPORT_UI_FORMAT = {
  version: CSV_IMPORT_FORMAT_VERSION,
  maxFileBytes: CSV_IMPORT_MAX_FILE_BYTES,
  maxFileSizeLabel: CSV_IMPORT_MAX_FILE_SIZE_LABEL,
} as const;

/**
 * Formats a server-provided signed-cent string without going through Number.
 * This is presentation only: the row's signed amount and kind remain exactly
 * as supplied by the parser/use case.
 */
export function formatCsvImportSignedAmount(value: string): string {
  if (!/^-?\d+$/u.test(value)) {
    return value;
  }

  try {
    const cents = BigInt(value);
    const sign = cents < BigInt(0) ? "-" : cents > BigInt(0) ? "+" : "";
    const absolute = cents < BigInt(0) ? -cents : cents;
    const whole = absolute / BigInt(100);
    const fraction = (absolute % BigInt(100)).toString(10).padStart(2, "0");
    const groupedWhole = new Intl.NumberFormat("pt-BR").format(whole);
    return `${sign}R$ ${groupedWhole},${fraction}`;
  } catch {
    return value;
  }
}

export function duplicateStatusLabel(
  status: CsvImportDuplicateStatus,
): string {
  return status === "ALREADY_IMPORTED"
    ? "Conjunto já importado"
    : "Novo conjunto";
}
