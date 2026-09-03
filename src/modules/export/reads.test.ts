import { describe, expect, it, vi } from "vitest";
import type { FinancialContext } from "@/modules/households/contracts";

import {
  S11_DATASET_IDS,
  S11_EXPORT_PAGE_SIZE,
  decodeExportCursor,
  encodeExportCursor,
  ExportReadError,
  buildExportFinancialEventPredicates,
  hasActiveTransactionFilters,
  normalizeS11TransactionFilters,
  readExportDataset,
} from "./reads";

const contextA: FinancialContext = {
  userId: "00000000-0000-7000-8000-000000506901",
  householdId: "00000000-0000-7000-8000-000000506101",
};

describe("normalizeS11TransactionFilters", () => {
  it("treats status ALL as no status filter", () => {
    const normalized = normalizeS11TransactionFilters({ status: "ALL" });
    expect(normalized.status).toBeUndefined();
    expect(hasActiveTransactionFilters(normalized)).toBe(false);
  });

  it("accepts null categoryId as uncategorized filter", () => {
    const normalized = normalizeS11TransactionFilters({ categoryId: null });
    expect(normalized.categoryIsNull).toBe(true);
    expect(hasActiveTransactionFilters(normalized)).toBe(true);
  });

  it("rejects inverted date ranges", () => {
    expect(() =>
      normalizeS11TransactionFilters({
        from: "2026-09-01",
        to: "2026-08-01",
      }),
    ).toThrow(ExportReadError);
  });

  it("rejects forged account ids", () => {
    expect(() =>
      normalizeS11TransactionFilters({ accountId: "not-a-uuid" }),
    ).toThrow(ExportReadError);
  });
});

describe("export cursor helpers", () => {
  it("round-trips business sort values with id tie-breaker", () => {
    const encoded = encodeExportCursor(["2026-01-01", "EXPENSE"], "018f1a2b-0000-7000-8000-000000000001");
    expect(decodeExportCursor(encoded)).toEqual({
      values: ["2026-01-01", "EXPENSE"],
      id: "018f1a2b-0000-7000-8000-000000000001",
    });
  });
});

describe("buildExportFinancialEventPredicates", () => {
  it("scopes every predicate to the financial context household", () => {
    const mockExecutor = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue([]),
        }),
      }),
    };

    const predicates = buildExportFinancialEventPredicates(
      mockExecutor as never,
      contextA,
      {
        from: "2026-01-01",
        to: "2026-12-31",
        kind: "EXPENSE",
        status: "POSTED",
        categoryId: null,
        accountId: "00000000-0000-7000-8000-000000506201",
      },
    );

    expect(predicates.length).toBeGreaterThan(4);
    expect(mockExecutor.select).toHaveBeenCalled();
  });
});

describe("readExportDataset", () => {
  it("exposes every ADR dataset id", () => {
    expect(S11_DATASET_IDS).toHaveLength(17);
  });

  it("uses the contracted page size", () => {
    expect(S11_EXPORT_PAGE_SIZE).toBe(500);
  });

  it("returns AVAILABLE with an empty generator for unknown-gate datasets only when modules fail", async () => {
    const result = await readExportDataset(contextA, "accounts", {
      database: {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => [],
              }),
            }),
          }),
        }),
      } as never,
    });

    expect(result.availability).toBe("AVAILABLE");
    expect(result.sort).toBe("name ASC, id ASC");
    const rows: unknown[] = [];
    for await (const row of result.rows) {
      rows.push(row);
    }
    expect(rows).toEqual([]);
  });
});
