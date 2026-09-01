import { requireFinancialContext } from "@/modules/households/context";
import {
  AuthGuardError,
} from "@/modules/auth/server";
import { FinancialContextError, type FinancialContext } from "@/modules/households/contracts";

import {
  CSV_IMPORT_ERROR_MESSAGES,
  CSV_IMPORT_FORMAT_VERSION,
  type ConfirmTransactionImportCommand,
  type CsvImportConfirmationResult,
  type CsvImportError,
  type CsvImportPreview,
  type CsvImportPreviewCommand,
  type CsvImportPreviewResult,
} from "./contracts";
import {
  CsvImportDomainError,
  csvImportConfirmationUseCase,
  csvImportPreviewUseCase,
  toSafeCsvImportError,
  type CsvImportConfirmationUseCasePort,
  type CsvImportPreviewUseCasePort,
} from "./use-cases";
import { parseConfirmTransactionImportCommand } from "./confirmation-validation";

/** Dependencies keep the Server Action thin and make auth/tenant tests explicit. */
export interface CsvImportPreviewActionDependencies {
  resolveContext: () => Promise<FinancialContext>;
  port: CsvImportPreviewUseCasePort;
}

export interface CsvImportPreviewActionHandlers {
  preview(input: unknown): Promise<CsvImportPreviewResult>;
  previewCsvImport(input: unknown): Promise<CsvImportPreviewResult>;
}

function invalidCommand(field?: CsvImportError["field"]): CsvImportPreviewResult {
  return {
    ok: false,
    error: {
      code: "INVALID_COMMAND",
      scope: "preview",
      message: CSV_IMPORT_ERROR_MESSAGES.INVALID_COMMAND,
      ...(field === undefined ? {} : { field }),
    },
  };
}

function fileRequired(): CsvImportPreviewResult {
  return {
    ok: false,
    error: {
      code: "CSV_FILE_REQUIRED",
      scope: "file",
      message: CSV_IMPORT_ERROR_MESSAGES.CSV_FILE_REQUIRED,
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

function commandFromInput(
  input: unknown,
): CsvImportPreviewCommand | CsvImportPreviewResult {
  if (isFormData(input)) {
    for (const key of input.keys()) {
      if (
        key !== "accountId" &&
        key !== "file" &&
        key !== "csv" &&
        key !== "mimeType"
      ) {
        return invalidCommand();
      }
    }
    const accountValues = input.getAll("accountId");
    const fileValues = input.getAll("file");
    const csvValues = input.getAll("csv");
    if (accountValues.length !== 1 || fileValues.length + csvValues.length !== 1) {
      return invalidCommand();
    }
    const accountId = input.get("accountId");
    const file = input.get("file") ?? input.get("csv");
    if (typeof accountId !== "string" || accountId.trim().length === 0) {
      return invalidCommand("accountId");
    }
    if (file === null) {
      return fileRequired();
    }
    return { accountId, file: file as CsvImportPreviewCommand["file"] };
  }

  if (!isObject(input)) {
    return invalidCommand();
  }

  // A strict allow-list is important here: household, candidates and
  // fingerprint must never be accepted as hidden client authority.
  const keys = Object.keys(input);
  if (
    keys.some(
      (key) =>
        key !== "accountId" &&
        key !== "file" &&
        key !== "csv" &&
        key !== "mimeType",
    )
  ) {
    return invalidCommand();
  }

  const accountId = input.accountId;
  if (typeof accountId !== "string" || accountId.trim().length === 0) {
    return invalidCommand("accountId");
  }

  if (Object.prototype.hasOwnProperty.call(input, "file") &&
      Object.prototype.hasOwnProperty.call(input, "csv")) {
    return invalidCommand();
  }

  const file = input.file ?? input.csv;
  if (file === undefined || file === null) {
    return fileRequired();
  }

  return {
    accountId,
    file: file as CsvImportPreviewCommand["file"],
  };
}

function isExpectedContextError(error: unknown): boolean {
  if (error instanceof FinancialContextError || error instanceof AuthGuardError) {
    return true;
  }
  if (!isObject(error) || !("code" in error)) {
    return false;
  }
  const code = error.code;
  return (
    code === "UNAUTHENTICATED" ||
    code === "INVALID_SESSION" ||
    code === "HOUSEHOLD_MEMBERSHIP_REQUIRED" ||
    code === "HOUSEHOLD_SELECTION_REQUIRED" ||
    code === "INVALID_FINANCIAL_CONTEXT" ||
    code === "PROVISIONING_FAILED"
  );
}

function toContextError(): CsvImportError {
  return {
    code: "UNAUTHENTICATED",
    scope: "preview",
    message: CSV_IMPORT_ERROR_MESSAGES.UNAUTHENTICATED,
  };
}

function isPreview(value: unknown): value is CsvImportPreview {
  if (!isObject(value)) {
    return false;
  }
  return (
    value.formatVersion === CSV_IMPORT_FORMAT_VERSION &&
    typeof value.previewToken === "string" &&
    typeof value.expiresAt === "string" &&
    typeof value.accountId === "string" &&
    (value.duplicateStatus === "NEW" ||
      value.duplicateStatus === "ALREADY_IMPORTED") &&
    (value.existingImportId === null ||
      typeof value.existingImportId === "string") &&
    isObject(value.counts) &&
    Array.isArray(value.rows) &&
    Array.isArray(value.errors)
  );
}

async function runPreview(
  input: unknown,
  dependencies: CsvImportPreviewActionDependencies,
): Promise<CsvImportPreviewResult> {
  const parsed = commandFromInput(input);
  if (!("accountId" in parsed)) {
    return parsed;
  }

  let context: FinancialContext;
  try {
    context = await dependencies.resolveContext();
  } catch (error) {
    if (isExpectedContextError(error)) {
      return { ok: false, error: toContextError() };
    }
    throw error;
  }

  try {
    const preview = await dependencies.port.preview(context, parsed);
    if (!isPreview(preview)) {
      throw new Error("O use case de preview retornou um resultado inválido.");
    }
    return { ok: true, value: preview };
  } catch (error) {
    if (error instanceof FinancialContextError || isExpectedContextError(error)) {
      return { ok: false, error: toContextError() };
    }
    if (error instanceof Error && "expected" in error && error.expected === true) {
      return { ok: false, error: toSafeCsvImportError(error) };
    }
    throw error;
  }
}

/** Creates a preview action adapter around an explicit context and port. */
export function createCsvImportPreviewActionHandlers(
  dependencies: CsvImportPreviewActionDependencies,
): CsvImportPreviewActionHandlers {
  return {
    preview: (input) => runPreview(input, dependencies),
    previewCsvImport: (input) => runPreview(input, dependencies),
  };
}

export const createTransactionImportPreviewActionHandlers =
  createCsvImportPreviewActionHandlers;
export const createPreviewCsvImportActionHandlers =
  createCsvImportPreviewActionHandlers;

/** Production composition resolves FinancialContext exclusively server-side. */
export function getCsvImportPreviewActionHandlers(): CsvImportPreviewActionHandlers {
  return createCsvImportPreviewActionHandlers({
    resolveContext: () => requireFinancialContext(),
    port: csvImportPreviewUseCase,
  });
}

export const getTransactionImportPreviewActionHandlers =
  getCsvImportPreviewActionHandlers;
export const getPreviewCsvImportActionHandlers =
  getCsvImportPreviewActionHandlers;

/** Dependencies keep confirmation auth/context separate from persistence. */
export interface CsvImportConfirmationActionDependencies {
  resolveContext: () => Promise<FinancialContext>;
  port: CsvImportConfirmationUseCasePort;
  /** Optional cache invalidation hook owned by the transaction UI slice. */
  revalidateTransactions?: () => void | Promise<void>;
}

export type CsvImportConfirmationActionResult =
  | { ok: true; value: CsvImportConfirmationResult }
  | { ok: false; error: CsvImportError };

export interface CsvImportConfirmationActionHandlers {
  /** Direct result action; expected domain failures reject with a safe error. */
  confirm(input: unknown): Promise<CsvImportConfirmationResult>;
  confirmCsvImport(input: unknown): Promise<CsvImportConfirmationResult>;
  confirmTransactionImport(input: unknown): Promise<CsvImportConfirmationResult>;
  /** Envelope convenience for callers that do not use exception boundaries. */
  confirmResult(input: unknown): Promise<CsvImportConfirmationActionResult>;
}

function confirmationInvalidCommand(): never {
  throw new CsvImportDomainError("INVALID_COMMAND", undefined, "confirmation");
}

function confirmationCommandFromInput(
  input: unknown,
): ConfirmTransactionImportCommand {
  if (!isObject(input)) {
    return confirmationInvalidCommand();
  }

  const keys = Object.keys(input);
  if (keys.some((key) => key !== "commandId" && key !== "previewToken")) {
    return confirmationInvalidCommand();
  }

  const parsed = parseConfirmTransactionImportCommand(input);
  if (parsed) {
    return parsed;
  }

  if (
    typeof input.commandId !== "string" ||
    !input.commandId.trim() ||
    input.commandId.trim().length > 128 ||
    /[\p{Cc}\p{Cf}]/u.test(input.commandId.trim())
  ) {
    throw new CsvImportDomainError(
      "INVALID_COMMAND_ID",
      "commandId",
      "confirmation",
    );
  }

  throw new CsvImportDomainError(
    "INVALID_COMMAND",
    "previewToken",
    "confirmation",
  );
}

function isConfirmationResult(value: unknown): value is CsvImportConfirmationResult {
  if (!isObject(value) || !isObject(value.counts) || !Array.isArray(value.errors)) {
    return false;
  }
  const counts = value.counts;
  if (
    typeof counts.processed !== "number" ||
    typeof counts.valid !== "number" ||
    typeof counts.invalid !== "number" ||
    typeof counts.ignoredDuplicate !== "number" ||
    typeof counts.imported !== "number"
  ) {
    return false;
  }
  if (value.status === "IMPORTED") {
    return typeof value.importId === "string" && typeof value.accountId === "string";
  }
  return (
    value.status === "DUPLICATE_DATASET" &&
    typeof value.existingImportId === "string" &&
    typeof value.accountId === "string"
  );
}

function confirmationContextError(): CsvImportDomainError {
  return new CsvImportDomainError("UNAUTHENTICATED", undefined, "confirmation");
}

async function runConfirmation(
  input: unknown,
  dependencies: CsvImportConfirmationActionDependencies,
): Promise<CsvImportConfirmationResult> {
  const command = confirmationCommandFromInput(input);

  let context: FinancialContext;
  try {
    context = await dependencies.resolveContext();
  } catch (error) {
    if (error instanceof FinancialContextError || isExpectedContextError(error)) {
      throw confirmationContextError();
    }
    throw error;
  }

  try {
    const result = await dependencies.port.confirm(context, command);
    if (!isConfirmationResult(result)) {
      throw new Error("O use case de confirmação retornou um resultado inválido.");
    }
    await dependencies.revalidateTransactions?.();
    return result;
  } catch (error) {
    if (error instanceof CsvImportDomainError) {
      throw error;
    }
    if (error instanceof FinancialContextError || isExpectedContextError(error)) {
      throw confirmationContextError();
    }
    if (isObject(error) && "expected" in error && error.expected === true) {
      throw CsvImportDomainError.from(toSafeCsvImportError(error));
    }
    throw error;
  }
}

/** Creates the authenticated confirmation action adapter. */
export function createCsvImportConfirmationActionHandlers(
  dependencies: CsvImportConfirmationActionDependencies,
): CsvImportConfirmationActionHandlers {
  const confirm = (input: unknown) => runConfirmation(input, dependencies);
  return {
    confirm,
    confirmCsvImport: confirm,
    confirmTransactionImport: confirm,
    async confirmResult(input) {
      try {
        return { ok: true, value: await confirm(input) };
      } catch (error) {
        if (error instanceof CsvImportDomainError) {
          return { ok: false, error: error.toError() };
        }
        throw error;
      }
    },
  };
}

export const createTransactionImportConfirmationActionHandlers =
  createCsvImportConfirmationActionHandlers;
export const createConfirmTransactionImportActionHandlers =
  createCsvImportConfirmationActionHandlers;
export const createConfirmCsvImportActionHandlers =
  createCsvImportConfirmationActionHandlers;

/** Production composition resolves FinancialContext exclusively server-side. */
export function getCsvImportConfirmationActionHandlers(): CsvImportConfirmationActionHandlers {
  return createCsvImportConfirmationActionHandlers({
    resolveContext: () => requireFinancialContext(),
    port: csvImportConfirmationUseCase,
  });
}

export const getTransactionImportConfirmationActionHandlers =
  getCsvImportConfirmationActionHandlers;
export const getConfirmTransactionImportActionHandlers =
  getCsvImportConfirmationActionHandlers;
