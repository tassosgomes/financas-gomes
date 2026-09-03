import { describe, expect, it, vi } from "vitest";

import type {
  BudgetMovementRecord,
  BudgetRecord,
} from "@/db/budgets-schema";
import { FinancialContextError } from "@/modules/households/contracts";
import type { FinancialContext } from "@/modules/households/contracts";
import {
  readReserveSnapshot,
  type SpendableReserveAdapter,
} from "@/modules/spendable/reserve-adapter";

import { BudgetReadError } from "./read-contracts";
import type { BudgetQueryPage, BudgetQueryRow } from "./query";
import {
  type BudgetReserveQueries,
  createBudgetReserveAdapter,
  listBudgetReserveBoxesForContext,
  mapBudgetRowToReserveBox,
} from "./reserve-source";

const contextA: FinancialContext = {
  userId: "user-a",
  householdId: "household-a",
};

const reserveContext = {
  asOf: "2026-09-30",
  scenario: "CONSERVATIVE" as const,
  horizon: { days: 90 },
};

function budget(
  id: string,
  referenceId: string,
  values: Partial<BudgetRecord> = {},
): BudgetRecord {
  return {
    id,
    householdId: contextA.householdId,
    referenceId,
    categoryId: "category-a",
    name: "Não deve atravessar a porta",
    status: "ACTIVE",
    activeFrom: "2026-09-01",
    closedOn: null,
    targetAmountCents: null,
    targetDate: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...values,
  };
}

function movement(
  id: string,
  budgetId: string,
  referenceId: string,
  values: Partial<BudgetMovementRecord> = {},
): BudgetMovementRecord {
  return {
    id,
    householdId: contextA.householdId,
    budgetId,
    referenceId,
    kind: "CONTRIBUTION",
    amountCents: BigInt(1000),
    effectiveOn: "2026-09-01",
    sourceKind: "MANUAL",
    sourceReferenceId: null,
    financialEventId: null,
    accountEntryId: null,
    correctsMovementId: null,
    transferReferenceId: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...values,
  };
}

function row(record: BudgetRecord): BudgetQueryRow {
  return { budget: record, category: null };
}

function page(
  rows: readonly BudgetQueryRow[],
  hasNextPage = false,
  nextCursor: string | null = null,
): BudgetQueryPage {
  return { rows, pageInfo: { hasNextPage, nextCursor } };
}

function reserveQueries(
  rows: readonly BudgetQueryRow[],
  movements: readonly BudgetMovementRecord[],
): BudgetReserveQueries {
  return {
    list: vi.fn(async (_context, query) => {
      expect(query.status).toBe("ALL");
      return page(rows);
    }),
    allMovementsForBudgets: vi.fn(async (_context, budgetIds, asOf) => {
      expect(asOf).toBe("2026-09-30");
      return movements.filter((item) => budgetIds.includes(item.budgetId));
    }),
  };
}

describe("T08 S09 provider preparation", () => {
  it("maps T05/T06 rows to opaque s09.v1 inputs without metadata or balance", () => {
    const budgetRecord = budget("budget-id", "box-a");
    const mapped = mapBudgetRowToReserveBox(
      row(budgetRecord),
      [
        movement("movement-2", budgetRecord.id, "movement-b", {
          amountCents: BigInt(200),
          effectiveOn: "2026-09-02",
          kind: "WITHDRAWAL",
        }),
        movement("movement-1", budgetRecord.id, "movement-a", {
          amountCents: BigInt(500),
        }),
      ],
      contextA,
    );

    expect(mapped).toEqual({
      rule: "BOX_BALANCE_PROTECTED",
      boxReferenceId: "box-a",
      status: "ACTIVE",
      activeFrom: "2026-09-01",
      closedOn: null,
      movements: [
        {
          referenceId: "movement-a",
          boxReferenceId: "box-a",
          kind: "CONTRIBUTION",
          amountCents: BigInt(500),
          effectiveOn: "2026-09-01",
        },
        {
          referenceId: "movement-b",
          boxReferenceId: "box-a",
          kind: "WITHDRAWAL",
          amountCents: BigInt(200),
          effectiveOn: "2026-09-02",
        },
      ],
    });
    expect(mapped).not.toHaveProperty("name");
    expect(mapped).not.toHaveProperty("categoryId");
    expect(mapped).not.toHaveProperty("householdId");
    expect(mapped).not.toHaveProperty("balance");
  });

  it("maps event, ledger, transfer and correction lineage as opaque reconciliation keys", () => {
    const budgetRecord = budget("budget-id", "box-a");
    const original = movement("movement-original", budgetRecord.id, "movement-a", {
      sourceReferenceId: "purchase-economic",
      financialEventId: "posted-event",
      accountEntryId: "posted-entry",
    });
    const correction = movement("movement-correction", budgetRecord.id, "movement-b", {
      kind: "WITHDRAWAL",
      correctsMovementId: original.id,
      transferReferenceId: "transfer-key",
    });
    const mapped = mapBudgetRowToReserveBox(
      row(budgetRecord),
      [original, correction],
      contextA,
    );

    expect(mapped.movements[0]).toMatchObject({
      referenceId: "movement-a",
      reconciliationReferenceIds: [
        "posted-entry",
        "posted-event",
        "purchase-economic",
      ],
    });
    expect(mapped.movements[1]).toMatchObject({
      referenceId: "movement-b",
      reconciliationReferenceIds: [
        "movement-a",
        "posted-entry",
        "posted-event",
        "purchase-economic",
        "transfer-key",
      ],
    });
    expect(mapped.movements[0]).not.toHaveProperty("sourceKind");
    expect(mapped.movements[1]).not.toHaveProperty("correctsMovementId");
  });

  it("captures tenant context before the port and derives current movement balance", async () => {
    const budgetRecord = budget("budget-id", "box-a");
    const queries = reserveQueries(
      [row(budgetRecord)],
      [movement("movement-1", budgetRecord.id, "movement-a")],
    );
    const adapter = createBudgetReserveAdapter(contextA, { queries });
    const snapshot = await readReserveSnapshot(adapter, reserveContext);

    expect(snapshot.contractVersion).toBe("s09.v1");
    expect(snapshot.status).toBe("AVAILABLE");
    expect(snapshot.protectedAmount.toCentsString()).toBe("1000");
    expect(snapshot.components[0]?.movementReferenceIds).toEqual([
      "movement-a",
    ]);
    expect(queries.list).toHaveBeenCalledWith(
      contextA,
      expect.objectContaining({ status: "ALL", asOf: "2026-09-30" }),
    );
    expect(queries.allMovementsForBudgets).toHaveBeenCalledWith(
      contextA,
      [budgetRecord.id],
      "2026-09-30",
    );
  });

  it("walks every tenant-safe budget page before loading movements", async () => {
    const first = row(budget("budget-a-id", "box-a"));
    const second = row(budget("budget-b-id", "box-b"));
    const list = vi
      .fn()
      .mockResolvedValueOnce(page([first], true, "next-page"))
      .mockResolvedValueOnce(page([second]));
    const queries: BudgetReserveQueries = {
      list,
      allMovementsForBudgets: vi.fn().mockResolvedValue([]),
    };

    const boxes = await listBudgetReserveBoxesForContext(
      contextA,
      reserveContext,
      { queries },
    );

    expect(boxes.map(({ boxReferenceId }) => boxReferenceId)).toEqual([
      "box-a",
      "box-b",
    ]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ cursor: "next-page" }),
    );
    expect(queries.allMovementsForBudgets).toHaveBeenCalledWith(
      contextA,
      ["budget-a-id", "budget-b-id"],
      "2026-09-30",
    );
  });

  it("returns a zero available source when T05 has no boxes", async () => {
    const queries = reserveQueries([], []);
    const boxes = await listBudgetReserveBoxesForContext(
      contextA,
      reserveContext,
      { queries },
    );
    const snapshot = await readReserveSnapshot(
      createBudgetReserveAdapter(contextA, { queries }),
      reserveContext,
    );

    expect(boxes).toEqual([]);
    expect(snapshot.status).toBe("AVAILABLE");
    expect(snapshot.protectedAmount.toCentsString()).toBe("0");
    expect(snapshot.components).toEqual([]);
    expect(queries.allMovementsForBudgets).not.toHaveBeenCalled();
  });

  it("rejects a provider that returns an unversioned reserve contract", async () => {
    const incompatible = {
      contractVersion: "s09.v0",
    } as unknown as Awaited<ReturnType<SpendableReserveAdapter["getReserve"]>>;
    const adapter = {
      contractVersion: "s09.v1" as const,
      getReserve: vi.fn().mockResolvedValue(incompatible),
    } satisfies SpendableReserveAdapter;

    await expect(readReserveSnapshot(adapter, reserveContext)).rejects.toMatchObject({
      code: "SPENDABLE_INCONSISTENT",
    });
  });

  it("does not accept a foreign row from a malformed query port", async () => {
    const foreign = row(
      budget("foreign-id", "foreign-box", { householdId: "household-b" }),
    );
    const queries = reserveQueries([foreign], []);

    await expect(
      listBudgetReserveBoxesForContext(contextA, reserveContext, { queries }),
    ).rejects.toMatchObject({
      code: "QUERY_FAILED",
      expected: true,
    } satisfies Partial<BudgetReadError>);
  });

  it("rejects an invalid financial context before querying", async () => {
    const queries = reserveQueries([], []);

    await expect(
      listBudgetReserveBoxesForContext(
        { userId: "", householdId: "household-a" },
        reserveContext,
        { queries },
      ),
    ).rejects.toBeInstanceOf(FinancialContextError);
    expect(queries.list).not.toHaveBeenCalled();
  });
});
