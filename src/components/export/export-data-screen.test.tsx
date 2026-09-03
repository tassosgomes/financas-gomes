/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EXPORT_COMPLETED_EMPTY_TITLE,
  EXPORT_COMPLETED_TITLE,
  EXPORT_ERROR_MESSAGES,
  EXPORT_GENERATING_ACTION_LABEL,
  EXPORT_PRIMARY_ACTION_LABEL,
  EXPORT_SCREEN_TITLE,
  EXPORT_UNAVAILABLE_REASON_LABELS,
  S11_EXPORT_ROW_COUNT_HEADER,
} from "@/components/export/contracts";

const mocks = vi.hoisted(() => ({
  requestHouseholdExportAction: vi.fn(),
}));

vi.mock("@/app/actions/export", () => ({
  requestHouseholdExportAction: mocks.requestHouseholdExportAction,
}));

import { ExportDataScreen, type ExportFetch } from "./export-data-screen";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const requestExportAction = mocks.requestHouseholdExportAction;
const fetchExport = vi.fn();
const createObjectURL = vi.fn(() => "blob:export");
const revokeObjectURL = vi.fn();
const anchorClick = vi.fn();

let originalCreateElement: typeof document.createElement;

beforeEach(() => {
  requestExportAction.mockReset();
  fetchExport.mockReset();
  createObjectURL.mockReset();
  createObjectURL.mockReturnValue("blob:export");
  revokeObjectURL.mockReset();
  anchorClick.mockReset();

  originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
    if (tagName.toLowerCase() === "a") {
      return {
        click: anchorClick,
        remove: vi.fn(),
        style: {},
        href: "",
        download: "",
        rel: "",
      } as unknown as HTMLAnchorElement;
    }

    return originalCreateElement(tagName, options);
  });

  const originalAppendChild = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, "appendChild").mockImplementation((node) => {
    if (
      typeof node === "object" &&
      node !== null &&
      "click" in node &&
      typeof (node as { click?: unknown }).click === "function" &&
      !("nodeType" in node)
    ) {
      return node as HTMLElement;
    }

    return originalAppendChild(node);
  });

  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL,
    revokeObjectURL,
  });

  requestExportAction.mockResolvedValue({
    ok: true,
    downloadUrl: "/api/export",
    filters: null,
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function zipResponse(rowCount: number): Awaited<ReturnType<ExportFetch>> {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name === S11_EXPORT_ROW_COUNT_HEADER ? String(rowCount) : null,
    },
    blob: vi.fn().mockResolvedValue({ size: 3 }),
    json: vi.fn(),
  };
}

function errorResponse(status: number, body: unknown): Awaited<ReturnType<ExportFetch>> {
  return {
    ok: false,
    status,
    headers: {
      get: () => null,
    },
    blob: vi.fn(),
    json: vi.fn().mockResolvedValue(body),
  };
}

describe("ExportDataScreen", () => {
  it("renders the idle screen with copy, datasets and the primary action", () => {
    render(
      <ExportDataScreen
        fetchExport={fetchExport}
        requestExportAction={requestExportAction}
      />,
    );

    expect(screen.getByRole("heading", { name: EXPORT_SCREEN_TITLE })).toBeTruthy();
    expect(screen.getByText("O que está incluído")).toBeTruthy();
    expect(screen.getByText("O que não está incluído")).toBeTruthy();
    expect(screen.getByText("Conjuntos de dados")).toBeTruthy();
    expect(screen.getByTestId("export-dataset-accounts")).toBeTruthy();
    expect(screen.getByTestId("export-dataset-budget_allocation_rules")).toBeTruthy();
    expect(screen.getAllByTestId("export-dataset-available")).toHaveLength(17);
    expect(
      screen.getByRole("button", { name: EXPORT_PRIMARY_ACTION_LABEL }),
    ).toBeTruthy();
  });

  it("marks unavailable datasets when provided", () => {
    render(
      <ExportDataScreen
        fetchExport={fetchExport}
        requestExportAction={requestExportAction}
        unavailableDatasetIds={["budgets"]}
      />,
    );

    expect(screen.getAllByTestId("export-dataset-available")).toHaveLength(16);
    expect(screen.getByTestId("export-dataset-unavailable")).toBeTruthy();
    expect(
      screen.getByText(EXPORT_UNAVAILABLE_REASON_LABELS.SLICE_NOT_PUBLISHED),
    ).toBeTruthy();
  });

  it("enters generating state and blocks duplicate clicks", async () => {
    const pending = deferred<Awaited<ReturnType<ExportFetch>>>();
    fetchExport.mockReturnValue(pending.promise);

    render(
      <ExportDataScreen
        fetchExport={fetchExport}
        requestExportAction={requestExportAction}
      />,
    );

    const button = screen.getByRole("button", {
      name: EXPORT_PRIMARY_ACTION_LABEL,
    });

    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: EXPORT_GENERATING_ACTION_LABEL }),
      ).toBeTruthy();
    });

    expect(requestExportAction).toHaveBeenCalledTimes(1);
    expect(fetchExport).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("export-generating-state")).toBeTruthy();
    expect(screen.getByTestId("export-live-message").textContent).toBe(
      EXPORT_GENERATING_ACTION_LABEL,
    );

    pending.resolve(zipResponse(12));
    await waitFor(() => {
      expect(screen.getByTestId("export-completed-state")).toBeTruthy();
    });
  });

  it("downloads the zip without sending tenancy in the request body", async () => {
    fetchExport.mockResolvedValue(zipResponse(4));

    render(
      <ExportDataScreen
        fetchExport={fetchExport}
        requestExportAction={requestExportAction}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: EXPORT_PRIMARY_ACTION_LABEL }),
    );

    await waitFor(() => {
      expect(fetchExport).toHaveBeenCalledWith(
        "/api/export",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
      );
    });

    expect(createObjectURL).toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
    expect(screen.getByTestId("export-completed-state")).toBeTruthy();
  });

  it("shows completed_empty when the row count header is zero", async () => {
    fetchExport.mockResolvedValue(zipResponse(0));

    render(
      <ExportDataScreen
        fetchExport={fetchExport}
        requestExportAction={requestExportAction}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: EXPORT_PRIMARY_ACTION_LABEL }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("export-completed-empty-state")).toBeTruthy();
    });

    expect(screen.queryByTestId("export-error-state")).toBeNull();
  });

  it("shows opaque export errors with correlation id and allows retry", async () => {
    fetchExport.mockResolvedValue(
      errorResponse(504, {
        ok: false,
        error: {
          code: "EXPORT_TIMEOUT",
          message: "driver timeout at postgres://secret",
          correlationId: "corr-timeout-1",
        },
      }),
    );

    render(
      <ExportDataScreen
        fetchExport={fetchExport}
        requestExportAction={requestExportAction}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: EXPORT_PRIMARY_ACTION_LABEL }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("export-error-state")).toBeTruthy();
    });

    expect(screen.getByText(EXPORT_ERROR_MESSAGES.EXPORT_TIMEOUT)).toBeTruthy();
    expect(screen.queryByText(/postgres|driver|sql/iu)).toBeNull();
    expect(screen.getByTestId("export-error-correlation-id").textContent).toContain(
      "corr-timeout-1",
    );

    fireEvent.click(screen.getByTestId("export-error-retry"));

    expect(
      screen.getByRole("button", { name: EXPORT_PRIMARY_ACTION_LABEL }),
    ).toBeTruthy();
    expect(screen.queryByTestId("export-error-state")).toBeNull();
  });

  it("maps rate limit and too-large failures to the contracted copy", async () => {
    fetchExport.mockResolvedValueOnce(
      errorResponse(429, {
        ok: false,
        error: { code: "EXPORT_RATE_LIMITED" },
      }),
    );

    const { unmount } = render(
      <ExportDataScreen
        fetchExport={fetchExport}
        requestExportAction={requestExportAction}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: EXPORT_PRIMARY_ACTION_LABEL }),
    );

    await waitFor(() => {
      expect(screen.getByText(EXPORT_ERROR_MESSAGES.EXPORT_RATE_LIMITED)).toBeTruthy();
    });

    unmount();

    fetchExport.mockResolvedValueOnce(
      errorResponse(413, {
        ok: false,
        error: { code: "EXPORT_TOO_LARGE" },
      }),
    );

    render(
      <ExportDataScreen
        fetchExport={fetchExport}
        requestExportAction={requestExportAction}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: EXPORT_PRIMARY_ACTION_LABEL }),
    );

    await waitFor(() => {
      expect(screen.getByText(EXPORT_ERROR_MESSAGES.EXPORT_TOO_LARGE)).toBeTruthy();
    });
  });

  it("surfaces session validation failures before calling the download route", async () => {
    requestExportAction.mockResolvedValue({
      ok: false,
      error: { code: "EXPORT_UNAVAILABLE" },
      correlationId: "corr-session-1",
    });

    render(
      <ExportDataScreen
        fetchExport={fetchExport}
        requestExportAction={requestExportAction}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: EXPORT_PRIMARY_ACTION_LABEL }),
    );

    await waitFor(() => {
      expect(screen.getByText(EXPORT_ERROR_MESSAGES.EXPORT_UNAVAILABLE)).toBeTruthy();
    });

    expect(fetchExport).not.toHaveBeenCalled();
    expect(screen.getByTestId("export-error-correlation-id").textContent).toContain(
      "corr-session-1",
    );
  });
});
