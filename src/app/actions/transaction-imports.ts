"use server";

import {
  getCsvImportConfirmationActionHandlers,
  getCsvImportPreviewActionHandlers,
} from "@/modules/transaction-imports/adapters";
import {
  csvImportReportAccess,
  type CsvImportReport,
} from "@/modules/transaction-imports/reports";
import type {
  CsvImportConfirmationResult,
  CsvImportPreviewResult,
} from "@/modules/transaction-imports/contracts";

/**
 * Receives only the selected account and upload. The adapter resolves the
 * authenticated household and stores the preview payload server-side.
 */
export async function previewCsvImportAction(
  input: unknown,
): Promise<CsvImportPreviewResult> {
  return getCsvImportPreviewActionHandlers().preview(input);
}

export async function previewTransactionImportAction(
  input: unknown,
): Promise<CsvImportPreviewResult> {
  return previewCsvImportAction(input);
}

export async function previewCsvImport(
  input: unknown,
): Promise<CsvImportPreviewResult> {
  return previewCsvImportAction(input);
}

export async function previewTransactionImport(
  input: unknown,
): Promise<CsvImportPreviewResult> {
  return previewCsvImportAction(input);
}

export async function previewImportAction(
  input: unknown,
): Promise<CsvImportPreviewResult> {
  return previewCsvImportAction(input);
}

export async function createCsvImportPreviewAction(
  input: unknown,
): Promise<CsvImportPreviewResult> {
  return previewCsvImportAction(input);
}

export async function createTransactionImportPreviewAction(
  input: unknown,
): Promise<CsvImportPreviewResult> {
  return previewCsvImportAction(input);
}

/** Receives only `{ commandId, previewToken }`; all import data is server-side. */
export async function confirmCsvImportAction(
  input: unknown,
): Promise<CsvImportConfirmationResult> {
  return getCsvImportConfirmationActionHandlers().confirm(input);
}

export async function confirmTransactionImportAction(
  input: unknown,
): Promise<CsvImportConfirmationResult> {
  return confirmCsvImportAction(input);
}

export async function confirmCsvImport(
  input: unknown,
): Promise<CsvImportConfirmationResult> {
  return confirmCsvImportAction(input);
}

export async function confirmTransactionImport(
  input: unknown,
): Promise<CsvImportConfirmationResult> {
  return confirmCsvImportAction(input);
}

export async function confirmImportAction(
  input: unknown,
): Promise<CsvImportConfirmationResult> {
  return confirmCsvImportAction(input);
}

export async function confirmImport(
  input: unknown,
): Promise<CsvImportConfirmationResult> {
  return confirmCsvImportAction(input);
}

export async function confirmCsvImportServerAction(
  input: unknown,
): Promise<CsvImportConfirmationResult> {
  return confirmCsvImportAction(input);
}

export async function confirmTransactionImportServerAction(
  input: unknown,
): Promise<CsvImportConfirmationResult> {
  return confirmCsvImportAction(input);
}

/**
 * Reads only a confirmed report in the authenticated household. The report
 * access facade owns session resolution and keeps an ID from another
 * household indistinguishable from a missing report.
 */
export async function findCsvImportReportAction(
  importId: unknown,
): Promise<CsvImportReport | undefined> {
  return csvImportReportAccess.find(importId);
}

export async function getCsvImportReportAction(
  importId: unknown,
): Promise<CsvImportReport | undefined> {
  return findCsvImportReportAction(importId);
}

export const findTransactionImportReportAction = findCsvImportReportAction;
export const getTransactionImportReportAction = getCsvImportReportAction;
