import { describe, expect, it } from "vitest";

import type {
  CategoryRecord,
} from "@/db/accounts-categories-schema";
import type {
  FinancialEventRecord,
} from "@/db/financial-events-schema";
import type {
  BudgetAllocationRuleRecord,
  BudgetMovementRecord,
  BudgetRecord,
} from "@/db/budgets-schema";
import type { FinancialContext } from "@/modules/households/contracts";
import type { S09BudgetLog } from "@/modules/observability/s09";

import {
  createBudgetListCursor,
  createBudgetMovementCursor,
  decodeBudgetListCursor,
  decodeBudgetMovementCursor,
  normalizeListBudgetMovementsQuery,
  normalizeListBudgetsQuery,
  BudgetReadError,
} from "./read-contracts";
import {
  createBudgetReadAccess,
  createBudgetReadUseCases,
  getBudgetForContext,
  listBudgetsForContext,
} from "./service";
import type {
  BudgetFinancialSourceRow,
  BudgetQueryPage,
  BudgetQueryRow,
  BudgetReadQueries,
  BudgetMovementQueryPage,
} from "./query";

const IDS = {
  householdA: "00000000-0000-7000-8000-000000051101",
  householdB: "00000000-0000-7000-8000-000000051102",
  budgetA: "00000000-0000-7000-8000-000000052101",
  budgetB: "00000000-0000-7000-8000-000000052102",
  budgetC: "00000000-0000-7000-8000-000000052103",
  categoryA: "00000000-0000-7000-8000-000000053101",
  categoryB: "00000000-0000-7000-8000-000000053102",
  movementA1: "00000000-0000-7000-8000-000000054101",
  movementA2: "00000000-0000-7000-8000-000000054102",
  movementA3: "00000000-0000-7000-8000-000000054103",
  movementB1: "00000000-0000-7000-8000-000000054104",
  movementC1: "00000000-0000-7000-8000-000000054105",
  purchase: "00000000-0000-7000-8000-000000055101",
} as const;

const contextA: FinancialContext = {
  userId: "00000000-0000-7000-8000-000000050101",
  householdId: IDS.householdA,
};

function budgetRecord(
  id: string,
  householdId: string,
  referenceId: string,
  categoryId: string,
  values: Partial<BudgetRecord> = {},
): BudgetRecord {
  return {
    id,
    householdId,
    referenceId,
    categoryId,
    name: `Caixinha ${referenceId}`,
    status: "ACTIVE",
    activeFrom: "2026-08-01",
    closedOn: null,
    targetAmountCents: null,
    targetDate: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...values,
  };
}

function categoryRecord(
  id: string,
  householdId: string,
  values: Partial<CategoryRecord> = {},
): CategoryRecord {
  return {
    id,
    householdId,
    name: `Categoria ${id}`,
    parentId: null,
    kind: "EXPENSE",
    status: "ACTIVE",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...values,
  };
}

function movementRecord(
  id: string,
  householdId: string,
  budgetId: string,
  referenceId: string,
  values: Partial<BudgetMovementRecord> = {},
): BudgetMovementRecord {
  return {
    id,
    householdId,
    budgetId,
    referenceId,
    kind: "CONTRIBUTION",
    amountCents: BigInt(1000),
    effectiveOn: "2026-08-01",
    sourceKind: "MANUAL",
    sourceReferenceId: null,
    financialEventId: null,
    accountEntryId: null,
    correctsMovementId: null,
    transferReferenceId: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...values,
  };
}

function sourceRow(
  category: CategoryRecord,
  values: Partial<FinancialEventRecord> = {},
): BudgetFinancialSourceRow {
  const event: FinancialEventRecord = {
    id: IDS.purchase,
    householdId: category.householdId,
    kind: "PURCHASE",
    status: "POSTED",
    origin: "MANUAL",
    amountCents: BigInt(600000),
    occurredOn: "2026-08-29",
    description: "Compra econômica",
    categoryId: category.id,
    reversalOfEventId: null,
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
    updatedAt: new Date("2026-08-29T00:00:00.000Z"),
    ...values,
  };
  return { event, category };
}

function pageInfo(
  hasNextPage: boolean,
  nextCursor: string | null = null,
): BudgetQueryPage["pageInfo"] {
  return { hasNextPage, nextCursor };
}

function inMemoryQueries(
  rows: readonly BudgetQueryRow[],
  movements: readonly BudgetMovementRecord[],
  categories: readonly CategoryRecord[],
  sources: readonly BudgetFinancialSourceRow[] = [],
  rules: readonly BudgetAllocationRuleRecord[] = [],
): BudgetReadQueries {
  const find = (context: FinancialContext, referenceId: unknown) =>
    rows.find(
      (row) =>
        row.budget.householdId === context.householdId &&
        row.budget.referenceId === referenceId,
    );

  return {
    async list(context, query) {
      const candidates = rows
        .filter(
          (row) =>
            row.budget.householdId === context.householdId &&
            (query.status === "ALL" || row.budget.status === query.status),
        )
        .sort((left, right) =>
          `${right.budget.activeFrom}:${right.budget.id}`.localeCompare(
            `${left.budget.activeFrom}:${left.budget.id}`,
          ),
        );
      const cursor = query.cursor
        ? decodeBudgetListCursor(query.cursor, query)
        : null;
      const after = cursor
        ? candidates.filter(
            (row) =>
              row.budget.activeFrom < cursor.activeFrom ||
              (row.budget.activeFrom === cursor.activeFrom &&
                row.budget.id < cursor.id),
          )
        : candidates;
      const visible = after.slice(0, query.limit);
      const hasNextPage = after.length > query.limit;
      const last = visible.at(-1);
      return {
        rows: visible,
        pageInfo: pageInfo(
          hasNextPage,
          hasNextPage && last
            ? createBudgetListCursor(
                { activeFrom: last.budget.activeFrom, id: last.budget.id },
                query,
              )
            : null,
        ),
      };
    },
    async find(context, referenceId) {
      return find(context, referenceId);
    },
    async get(context, referenceId) {
      const row = find(context, referenceId);
      if (!row) throw new BudgetReadError("BUDGET_NOT_FOUND", "budgetReferenceId");
      return row;
    },
    async movements(context, referenceId, query): Promise<BudgetMovementQueryPage> {
      const budget = find(context, referenceId);
      if (!budget) throw new BudgetReadError("BUDGET_NOT_FOUND", "budgetReferenceId");
      const candidates = movements
        .filter(
          (movement) =>
            movement.householdId === context.householdId &&
            movement.budgetId === budget.budget.id &&
            movement.effectiveOn <= query.asOf &&
            (query.from === undefined || movement.effectiveOn >= query.from) &&
            (query.to === undefined || movement.effectiveOn <= query.to),
        )
        .sort((left, right) =>
          `${right.effectiveOn}:${right.id}`.localeCompare(
            `${left.effectiveOn}:${left.id}`,
          ),
        );
      const cursor = query.cursor
        ? decodeBudgetMovementCursor(query.cursor, query)
        : undefined;
      const after = cursor
        ? candidates.filter(
            (movement) =>
              movement.effectiveOn < cursor.effectiveOn ||
              (movement.effectiveOn === cursor.effectiveOn &&
                movement.id < cursor.id),
          )
        : candidates;
      const visible = after.slice(0, query.limit);
      const hasNextPage = after.length > query.limit;
      const last = visible.at(-1);
      return {
        budget,
        rows: visible,
        pageInfo: pageInfo(
          hasNextPage,
          hasNextPage && last
            ? createBudgetMovementCursor(
                { effectiveOn: last.effectiveOn, id: last.id },
                query,
              )
            : null,
        ),
      };
    },
    async allMovements(context, budgetId, asOf) {
      return movements.filter(
        (movement) =>
          movement.householdId === context.householdId &&
          movement.budgetId === budgetId &&
          movement.effectiveOn <= asOf,
      );
    },
    async allMovementsForBudgets(context, budgetIds, asOf) {
      return movements.filter(
        (movement) =>
          movement.householdId === context.householdId &&
          budgetIds.includes(movement.budgetId) &&
          movement.effectiveOn <= asOf,
      );
    },
    async allocationRules(context, budgetId, asOf) {
      return rules.filter(
        (rule) =>
          rule.householdId === context.householdId &&
          rule.budgetId === budgetId &&
          rule.effectiveFrom <= asOf,
      );
    },
    async categories(context) {
      return categories.filter(
        (category) => category.householdId === context.householdId,
      );
    },
    async financialSources(context, asOf) {
      return sources.filter(
        (source) =>
          source.event.householdId === context.householdId &&
          source.event.occurredOn <= asOf,
      );
    },
  };
}

const categoryA = categoryRecord(IDS.categoryA, IDS.householdA);
const categoryB = categoryRecord(IDS.categoryB, IDS.householdB);

const budgetA = budgetRecord(
  IDS.budgetA,
  IDS.householdA,
  "box-a",
  IDS.categoryA,
  {
    name: "Reserva viagem",
    targetAmountCents: BigInt(10000),
    targetDate: "2026-10-31",
  },
);
const budgetB = budgetRecord(IDS.budgetB, IDS.householdB, "box-b", IDS.categoryB);
const budgetC = budgetRecord(
  IDS.budgetC,
  IDS.householdA,
  "box-c",
  IDS.categoryA,
  { name: "Déficit histórico" },
);
const closedBudget = budgetRecord(
  "00000000-0000-7000-8000-000000052104",
  IDS.householdA,
  "box-closed",
  IDS.categoryA,
  { status: "CLOSED", closedOn: "2026-09-10" },
);

const movements = [
  movementRecord(
    IDS.movementA1,
    IDS.householdA,
    IDS.budgetA,
    "contribution-a",
    { amountCents: BigInt(10000), effectiveOn: "2026-08-01" },
  ),
  movementRecord(
    IDS.movementA2,
    IDS.householdA,
    IDS.budgetA,
    "withdrawal-a",
    {
      kind: "WITHDRAWAL",
      amountCents: BigInt(2000),
      effectiveOn: "2026-08-10",
    },
  ),
  movementRecord(
    IDS.movementA3,
    IDS.householdA,
    IDS.budgetA,
    "contribution-a-later",
    { amountCents: BigInt(5000), effectiveOn: "2026-09-01" },
  ),
  movementRecord(
    IDS.movementB1,
    IDS.householdB,
    IDS.budgetB,
    "foreign-contribution",
    { amountCents: BigInt(999999), effectiveOn: "2026-08-01" },
  ),
  movementRecord(
    IDS.movementC1,
    IDS.householdA,
    IDS.budgetC,
    "negative-withdrawal",
    {
      kind: "WITHDRAWAL",
      amountCents: BigInt(2000),
      effectiveOn: "2026-08-20",
    },
  ),
  movementRecord(
    "00000000-0000-7000-8000-000000054106",
    IDS.householdA,
    "00000000-0000-7000-8000-000000052104",
    "closed-before",
    { amountCents: BigInt(5000), effectiveOn: "2026-09-09" },
  ),
  movementRecord(
    "00000000-0000-7000-8000-000000054107",
    IDS.householdA,
    "00000000-0000-7000-8000-000000052104",
    "closed-on-date",
    { amountCents: BigInt(1000), effectiveOn: "2026-09-10" },
  ),
] as const;

function repository(
  sources: readonly BudgetFinancialSourceRow[] = [],
  rules: readonly BudgetAllocationRuleRecord[] = [],
): BudgetReadQueries {
  return inMemoryQueries(
    [
      { budget: budgetA, category: categoryA },
      { budget: budgetB, category: categoryB },
      { budget: budgetC, category: categoryA },
      { budget: closedBudget, category: categoryA },
    ],
    movements,
    [categoryA, categoryB],
    sources,
    rules,
  );
}

describe("S09 T05 read contracts", () => {
  it("rejects browser tenant authority and binds cursors to filters", () => {
    expect(() =>
      normalizeListBudgetsQuery({ householdId: IDS.householdA }, { today: "2026-09-30" }),
    ).toThrowError(BudgetReadError);
    expect(() =>
      normalizeListBudgetMovementsQuery(
        { from: "2026-09-10", to: "2026-09-01" },
        { today: "2026-09-30" },
      ),
    ).toThrowError(BudgetReadError);

    const query = normalizeListBudgetMovementsQuery(
      { asOf: "2026-09-30", limit: 1 },
      { today: "2026-09-30" },
    );
    const cursor = createBudgetMovementCursor(
      { effectiveOn: "2026-08-10", id: IDS.movementA2 },
      query,
    );
    expect(decodeBudgetMovementCursor(cursor, query)).toMatchObject({
      effectiveOn: "2026-08-10",
      id: IDS.movementA2,
      limit: 1,
    });
    expect(() =>
      decodeBudgetMovementCursor(
        cursor,
        normalizeListBudgetMovementsQuery(
          { asOf: "2026-09-30", limit: 2 },
          { today: "2026-09-30" },
        ),
      ),
    ).toThrowError(BudgetReadError);
  });

  it("lists only the current tenant and serializes derived cents without householdId", async () => {
    const value = await listBudgetsForContext(
      contextA,
      { status: "ALL", asOf: "2026-09-30" },
      { queries: repository(), today: "2026-09-30" },
    );
    expect(value.items.map((item) => item.referenceId)).toEqual([
      "box-closed",
      "box-c",
      "box-a",
    ]);
    expect(value.items.find((item) => item.referenceId === "box-a"))
      .toMatchObject({
        balance: {
          balanceCents: "13000",
          protectedAmountCents: "13000",
        },
        progress: {
          targetAmountCents: "10000",
          progressCents: "10000",
          remainingCents: "0",
          status: "ACHIEVED",
        },
        period: {
          from: "2026-09-01",
          to: "2026-09-30",
        },
      });
    expect(value.items.every((item) => !("householdId" in item))).toBe(true);
    expect(JSON.stringify(value)).not.toContain(IDS.householdA);
    expect(JSON.stringify(value)).not.toContain(IDS.householdB);
  });

  it("keeps negative balances, applies closedOn as an exclusive protection cutoff, and includes the closing date in history", async () => {
    const value = await getBudgetForContext(
      contextA,
      "box-closed",
      {
        asOf: "2026-09-10",
        from: "2026-09-01",
        to: "2026-09-10",
      },
      { queries: repository(), today: "2026-09-10" },
    );
    expect(value.balance).toMatchObject({
      balanceCents: "6000",
      protectedAmountCents: "0",
      activeAtCutoff: false,
      movementReferenceIds: ["closed-before", "closed-on-date"],
    });
    expect(value.period).toMatchObject({
      rolloverCents: "0",
      contributionCents: "6000",
      closingBalanceCents: "6000",
    });

    const negative = await getBudgetForContext(
      contextA,
      "box-c",
      { asOf: "2026-09-30" },
      { queries: repository(), today: "2026-09-30" },
    );
    expect(negative.balance).toMatchObject({
      balanceCents: "-2000",
      protectedAmountCents: "0",
    });
  });

  it("does not truncate the derived totals when the history page is limited", async () => {
    const value = await getBudgetForContext(
      contextA,
      "box-a",
      { asOf: "2026-09-30", limit: 1 },
      { queries: repository(), today: "2026-09-30" },
    );
    expect(value.balance.balanceCents).toBe("13000");
    expect(value.movements).toHaveLength(1);
    expect(value.movementPageInfo).toMatchObject({ hasNextPage: true });
    expect(value.movementPageInfo.nextCursor).toEqual(expect.any(String));
  });

  it("uses T04's economic source resolver once for a purchase and never exposes a foreign detail", async () => {
    const purchase = sourceRow(categoryA);
    const value = await getBudgetForContext(
      contextA,
      "box-a",
      { asOf: "2026-08-31" },
      { queries: repository([purchase]), today: "2026-08-31" },
    );
    expect(value.balance.balanceCents).toBe("-592000");
    expect(value.movements).toHaveLength(3);
    expect(value.movements.filter((item) => item.referenceId === IDS.purchase)).toHaveLength(1);

    const foreign = await createBudgetReadUseCases({
      queries: repository(),
      today: "2026-08-31",
    }).detail(contextA, "box-b");
    expect(foreign).toMatchObject({
      ok: false,
      error: { code: "BUDGET_NOT_FOUND", message: "A Caixinha não foi encontrada." },
    });
  });

  it("serializes effective allocation rules and instruments the public read boundary", async () => {
    const records: S09BudgetLog[] = [];
    const rule: BudgetAllocationRuleRecord = {
      id: "00000000-0000-7000-8000-000000056101",
      householdId: IDS.householdA,
      budgetId: IDS.budgetA,
      amountCents: BigInt(2750),
      effectiveFrom: "2026-08-01",
      effectiveUntil: null,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    const detail = await getBudgetForContext(
      contextA,
      "box-a",
      { asOf: "2026-08-31" },
      {
        queries: repository([], [rule]),
        today: "2026-08-31",
      },
    );
    expect(detail.allocationRules).toEqual([
      {
        referenceId: rule.id,
        budgetReferenceId: "box-a",
        boxReferenceId: "box-a",
        amountCents: "2750",
        effectiveFrom: "2026-08-01",
        effectiveUntil: null,
      },
    ]);

    const observed = createBudgetReadAccess({
      queries: repository(),
      resolveContext: () => contextA,
      today: "2026-09-30",
      observability: {
        requestId: "t05-read-correlation",
        budgetCount: 3,
        amountCents: "999999",
        payload: { name: "private" },
        onRecord: (record) => records.push(record),
        now: () => 0,
      },
    });
    const result = await observed.list({ status: "ACTIVE", asOf: "2026-09-30" });
    expect(result.ok).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      operation: "budget.read",
      stage: "read",
      requestId: "t05-read-correlation",
      budgetCount: 3,
      outcome: "success",
    });
    expect(JSON.stringify(records[0])).not.toMatch(/999999|private/u);
  });

  it("maps technical failures to an opaque public result and resolves context server-side", async () => {
    const failing: BudgetReadQueries = {
      ...repository(),
      list: async () => {
        throw new Error(`SQL segredo ${IDS.householdA} saldo 999`);
      },
    };
    const result = await createBudgetReadAccess({
      queries: failing,
      resolveContext: () => contextA,
      today: "2026-09-30",
    }).list({ asOf: "2026-09-30" });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "QUERY_FAILED",
        message: "Não foi possível consultar a Caixinha.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("SQL segredo");
    expect(JSON.stringify(result)).not.toContain(IDS.householdA);
  });
});
