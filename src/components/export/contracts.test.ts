import { describe, expect, it } from "vitest";

import {
  EXPORT_ERROR_CODES,
  EXPORT_REQUEST_STATES,
  type ExportScreenViewModel,
} from "./contracts";

const exportScreenFixture: ExportScreenViewModel = {
  contractVersion: "s11.v1",
  state: "completed",
  fileLabel: "financas-gomes-export-s11v1.zip",
  byteCountLabel: "1,5 MB",
  rowCountLabel: "12.345 linhas",
  generatedAtLabel: "03/09/2026 14:30",
  datasets: [
    {
      id: "accounts",
      title: "Contas",
      description: "Contas que você cadastrou no espaço financeiro.",
      availability: "AVAILABLE",
      rowCount: 3,
      byteCount: 512,
    },
    {
      id: "budgets",
      title: "Caixinhas",
      description: "Metas e envelopes que você criou.",
      availability: "UNAVAILABLE_EXTERNAL_GATE",
      unavailableReason: "SLICE_NOT_PUBLISHED",
    },
  ],
};

describe("export UI contracts", () => {
  it("declares every export request state", () => {
    expect(EXPORT_REQUEST_STATES).toEqual([
      "idle",
      "generating",
      "completed",
      "completed_empty",
      "error",
    ]);
  });

  it("declares every opaque export error code from ADR-014", () => {
    expect(EXPORT_ERROR_CODES).toEqual([
      "UNAUTHENTICATED",
      "EXPORT_IN_PROGRESS",
      "EXPORT_RATE_LIMITED",
      "EXPORT_TIMEOUT",
      "EXPORT_TOO_LARGE",
      "EXPORT_UNAVAILABLE",
      "EXPORT_FAILED",
    ]);
  });

  it("keeps view models free of tenancy and technical error detail", () => {
    const serialized = JSON.stringify(exportScreenFixture);

    expect(() => JSON.stringify(exportScreenFixture)).not.toThrow();
    expect(serialized).toContain('"contractVersion":"s11.v1"');
    expect(serialized).not.toMatch(
      /householdId|userId|tenantId|household_id|user_id|sql|stack|dsn|password|session/iu,
    );
  });
});
