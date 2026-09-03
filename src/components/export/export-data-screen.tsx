"use client";

import { Download } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { requestHouseholdExportAction } from "@/app/actions/export";
import {
  createExportOpaqueError,
  EXPORT_COMPLETED_DESCRIPTION,
  EXPORT_COMPLETED_EMPTY_DESCRIPTION,
  EXPORT_COMPLETED_EMPTY_TITLE,
  EXPORT_COMPLETED_TITLE,
  EXPORT_DATASET_COPY,
  EXPORT_DATASETS_HEADING,
  EXPORT_DEFAULT_FILE_LABEL,
  EXPORT_EXCLUDED_HEADING,
  EXPORT_EXCLUDED_ITEMS,
  EXPORT_GENERATING_ACTION_LABEL,
  EXPORT_INCLUDED_HEADING,
  EXPORT_INCLUDED_ITEMS,
  EXPORT_PRIMARY_ACTION_LABEL,
  EXPORT_SCREEN_DESCRIPTION,
  EXPORT_SCREEN_EYEBROW,
  EXPORT_SCREEN_TITLE,
  EXPORT_UNAVAILABLE_DATASET_LABEL,
  EXPORT_UNAVAILABLE_REASON_LABELS,
  type ExportDatasetId,
  type ExportDatasetViewModel,
  type ExportErrorCode,
  type ExportOpaqueErrorViewModel,
  type ExportRequestState,
  type ExportUnavailableReason,
  S11_EXPORT_ROW_COUNT_HEADER,
} from "@/components/export/contracts";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SuccessFeedback,
} from "@/components/ui/async-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

const EXPORT_API_PATH = "/api/export" as const;

export interface ExportFetchResponse {
  ok: boolean;
  status: number;
  headers: Pick<Headers, "get">;
  blob: () => Promise<Blob>;
  json: () => Promise<unknown>;
}

export type ExportFetch = (
  input: string,
  init?: RequestInit,
) => Promise<ExportFetchResponse>;

export interface ExportDataScreenProps {
  /** Marks datasets unavailable for tests or future gate overrides. */
  unavailableDatasetIds?: readonly ExportDatasetId[];
  /** Injected for tests; defaults to the server action. */
  requestExportAction?: typeof requestHouseholdExportAction;
  /** Injected for tests; defaults to `fetch`. */
  fetchExport?: ExportFetch;
}

function buildDatasetCatalog(
  unavailableDatasetIds: readonly ExportDatasetId[],
): ExportDatasetViewModel[] {
  const unavailable = new Set(unavailableDatasetIds);

  return (Object.keys(EXPORT_DATASET_COPY) as ExportDatasetId[]).map((id) => {
    const copy = EXPORT_DATASET_COPY[id];
    const isUnavailable = unavailable.has(id);

    return {
      id,
      title: copy.title,
      description: copy.description,
      availability: isUnavailable ? "UNAVAILABLE_EXTERNAL_GATE" : "AVAILABLE",
      ...(isUnavailable
        ? { unavailableReason: "SLICE_NOT_PUBLISHED" as ExportUnavailableReason }
        : {}),
    };
  });
}

function parseExportErrorCode(value: unknown): ExportErrorCode {
  const codes: ExportErrorCode[] = [
    "UNAUTHENTICATED",
    "EXPORT_IN_PROGRESS",
    "EXPORT_RATE_LIMITED",
    "EXPORT_TIMEOUT",
    "EXPORT_TOO_LARGE",
    "EXPORT_UNAVAILABLE",
    "EXPORT_FAILED",
  ];

  if (typeof value === "string" && codes.includes(value as ExportErrorCode)) {
    return value as ExportErrorCode;
  }

  return "EXPORT_FAILED";
}

function parseRowCountHeader(response: { headers: Pick<Headers, "get"> }): number {
  const raw = response.headers.get(S11_EXPORT_ROW_COUNT_HEADER);
  if (raw === null || raw.trim() === "") return 0;

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function stateAnnouncement(state: ExportRequestState): string | null {
  switch (state) {
    case "generating":
      return EXPORT_GENERATING_ACTION_LABEL;
    case "completed":
      return EXPORT_COMPLETED_TITLE;
    case "completed_empty":
      return EXPORT_COMPLETED_EMPTY_TITLE;
    case "error":
      return "A exportação falhou.";
    default:
      return null;
  }
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function DatasetAvailabilityBadge({
  availability,
  unavailableReason,
}: {
  availability: ExportDatasetViewModel["availability"];
  unavailableReason?: ExportUnavailableReason;
}) {
  if (availability === "AVAILABLE") {
    return (
      <span
        className="inline-flex shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800"
        data-testid="export-dataset-available"
      >
        Disponível
      </span>
    );
  }

  const reasonLabel =
    unavailableReason !== undefined
      ? EXPORT_UNAVAILABLE_REASON_LABELS[unavailableReason]
      : EXPORT_UNAVAILABLE_DATASET_LABEL;

  return (
    <span
      className="inline-flex shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground"
      data-testid="export-dataset-unavailable"
      title={reasonLabel}
    >
      {EXPORT_UNAVAILABLE_DATASET_LABEL}
    </span>
  );
}

export function ExportDataScreen({
  unavailableDatasetIds = [],
  requestExportAction = requestHouseholdExportAction,
  fetchExport = fetch as ExportFetch,
}: ExportDataScreenProps) {
  const [state, setState] = useState<ExportRequestState>("idle");
  const [error, setError] = useState<ExportOpaqueErrorViewModel | null>(null);
  const inFlightRef = useRef(false);

  const datasets = useMemo(
    () => buildDatasetCatalog(unavailableDatasetIds),
    [unavailableDatasetIds],
  );

  const liveMessage = stateAnnouncement(state);

  const handleRetry = useCallback(() => {
    setState("idle");
    setError(null);
  }, []);

  const handleExport = useCallback(async () => {
    if (inFlightRef.current || state === "generating") {
      return;
    }

    inFlightRef.current = true;
    setState("generating");
    setError(null);

    try {
      const sessionResult = await requestExportAction({});

      if (!sessionResult.ok) {
        setError(
          createExportOpaqueError(
            sessionResult.error.code,
            sessionResult.correlationId,
          ),
        );
        setState("error");
        return;
      }

      const requestBody =
        sessionResult.filters !== null
          ? JSON.stringify({ filters: sessionResult.filters })
          : "{}";

      const response = await fetchExport(EXPORT_API_PATH, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: requestBody,
      });

      if (!response.ok) {
        let code: ExportErrorCode = "EXPORT_FAILED";
        let correlationId: string | undefined;

        try {
          const payload = (await response.json()) as {
            error?: { code?: unknown; correlationId?: string };
          };
          code = parseExportErrorCode(payload.error?.code);
          correlationId = payload.error?.correlationId;
        } catch {
          // Keep the opaque fallback when the body is not JSON.
        }

        setError(createExportOpaqueError(code, correlationId));
        setState("error");
        return;
      }

      const rowCount = parseRowCountHeader(response);
      const blob = await response.blob();
      triggerBlobDownload(blob, EXPORT_DEFAULT_FILE_LABEL);

      setState(rowCount === 0 ? "completed_empty" : "completed");
    } catch {
      setError(createExportOpaqueError("EXPORT_FAILED"));
      setState("error");
    } finally {
      inFlightRef.current = false;
    }
  }, [fetchExport, requestExportAction, state]);

  const isGenerating = state === "generating";

  return (
    <section className="space-y-6" data-testid="export-data-screen">
      <PageHeader
        description={EXPORT_SCREEN_DESCRIPTION}
        eyebrow={EXPORT_SCREEN_EYEBROW}
        title={EXPORT_SCREEN_TITLE}
      />

      {liveMessage ? (
        <p aria-live="polite" className="sr-only" data-testid="export-live-message">
          {liveMessage}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="export-included-heading"
          className="min-w-0 rounded-2xl border bg-card p-5"
        >
          <h2 className="text-base font-semibold" id="export-included-heading">
            {EXPORT_INCLUDED_HEADING}
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            {EXPORT_INCLUDED_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="export-excluded-heading"
          className="min-w-0 rounded-2xl border bg-card p-5"
        >
          <h2 className="text-base font-semibold" id="export-excluded-heading">
            {EXPORT_EXCLUDED_HEADING}
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            {EXPORT_EXCLUDED_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <section
        aria-labelledby="export-datasets-heading"
        className="min-w-0 rounded-2xl border bg-card p-5"
      >
        <h2 className="text-base font-semibold" id="export-datasets-heading">
          {EXPORT_DATASETS_HEADING}
        </h2>
        <ul className="mt-4 divide-y">
          {datasets.map((dataset) => (
            <li
              className="flex min-w-0 flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
              data-testid={`export-dataset-${dataset.id}`}
              key={dataset.id}
            >
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{dataset.title}</p>
                <p className="text-sm leading-6 text-muted-foreground">
                  {dataset.description}
                </p>
                {dataset.availability === "UNAVAILABLE_EXTERNAL_GATE" &&
                dataset.unavailableReason !== undefined ? (
                  <p className="text-sm leading-6 text-muted-foreground">
                    {EXPORT_UNAVAILABLE_REASON_LABELS[dataset.unavailableReason]}
                  </p>
                ) : null}
              </div>
              <DatasetAvailabilityBadge
                availability={dataset.availability}
                unavailableReason={dataset.unavailableReason}
              />
            </li>
          ))}
        </ul>
      </section>

      <div className="space-y-4">
        <Button
          aria-busy={isGenerating}
          className="w-full sm:w-auto"
          data-testid="export-download-button"
          disabled={isGenerating}
          onClick={() => {
            void handleExport();
          }}
          type="button"
        >
          <Download aria-hidden="true" className="mr-2 size-4" />
          {isGenerating ? EXPORT_GENERATING_ACTION_LABEL : EXPORT_PRIMARY_ACTION_LABEL}
        </Button>

        {isGenerating ? (
          <LoadingState
            label={EXPORT_GENERATING_ACTION_LABEL}
            testId="export-generating-state"
          />
        ) : null}

        {state === "completed" ? (
          <SuccessFeedback
            description={EXPORT_COMPLETED_DESCRIPTION}
            message={EXPORT_COMPLETED_TITLE}
            testId="export-completed-state"
          />
        ) : null}

        {state === "completed_empty" ? (
          <EmptyState
            description={EXPORT_COMPLETED_EMPTY_DESCRIPTION}
            testId="export-completed-empty-state"
            title={EXPORT_COMPLETED_EMPTY_TITLE}
          />
        ) : null}

        {state === "error" && error !== null ? (
          <ErrorState
            message={error.message}
            testId="export-error-state"
            title="Não foi possível gerar sua cópia"
          >
            {error.correlationId ? (
              <p
                className="text-xs text-muted-foreground"
                data-testid="export-error-correlation-id"
              >
                Referência: {error.correlationId}
              </p>
            ) : null}
            <button
              className="mt-3 inline-flex rounded-md border border-destructive/30 px-3 py-2 text-sm font-medium hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="export-error-retry"
              onClick={handleRetry}
              type="button"
            >
              Tentar novamente
            </button>
          </ErrorState>
        ) : null}
      </div>
    </section>
  );
}
