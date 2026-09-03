import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { Temporal } from "@js-temporal/polyfill";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  applicationCommands,
  budgetMovements,
  budgets,
  categories,
  financialEvents,
  households,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";
import { ForecastEngine, type ForecastEngineItem } from "@/modules/forecast/engine";
import type { ForecastTimeline } from "@/modules/forecast/contracts";

import { createBudgetMovementUseCases } from "@/modules/budgets/movements";
import { createBudgetReserveAdapter } from "@/modules/budgets/reserve-source";
import { getSpendable, type SpendableServiceDependencies } from "./service";

const integration =
  process.env.T08_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  householdA: "00000000-0000-7000-8000-000000081101",
  householdB: "00000000-0000-7000-8000-000000081102",
  accountGeneralA: "00000000-0000-7000-8000-000000081201",
  accountRestrictedA: "00000000-0000-7000-8000-000000081202",
  accountExcludedA: "00000000-0000-7000-8000-000000081203",
  accountGeneralB: "00000000-0000-7000-8000-000000081204",
  categoryMulti: "00000000-0000-7000-8000-000000081301",
  categoryWithdrawal: "00000000-0000-7000-8000-000000081302",
  categoryNegative: "00000000-0000-7000-8000-000000081303",
  categoryClosed: "00000000-0000-7000-8000-000000081304",
  categoryB: "00000000-0000-7000-8000-000000081305",
  openingEventA: "00000000-0000-7000-8000-000000081401",
  restrictedEventA: "00000000-0000-7000-8000-000000081402",
  excludedEventA: "00000000-0000-7000-8000-000000081403",
  openingEventB: "00000000-0000-7000-8000-000000081404",
  expenseEvent: "00000000-0000-7000-8000-000000081405",
  openingEntryA: "00000000-0000-7000-8000-000000081501",
  restrictedEntryA: "00000000-0000-7000-8000-000000081502",
  excludedEntryA: "00000000-0000-7000-8000-000000081503",
  openingEntryB: "00000000-0000-7000-8000-000000081504",
  expenseEntry: "00000000-0000-7000-8000-000000081505",
  budgetMulti: "00000000-0000-7000-8000-000000081601",
  budgetWithdrawal: "00000000-0000-7000-8000-000000081602",
  budgetNegative: "00000000-0000-7000-8000-000000081603",
  budgetClosed: "00000000-0000-7000-8000-000000081604",
  budgetB: "00000000-0000-7000-8000-000000081605",
  negativeContribution: "00000000-0000-7000-8000-000000081701",
  negativeWithdrawal: "00000000-0000-7000-8000-000000081702",
  closedContribution: "00000000-0000-7000-8000-000000081703",
} as const;

const CONTEXT_A: FinancialContext = {
  userId: "t08-user-a",
  householdId: FIXTURES.householdA,
};
const CONTEXT_B: FinancialContext = {
  userId: "t08-user-b",
  householdId: FIXTURES.householdB,
};

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) throw new Error("O banco de integração T08 não foi inicializado.");
  return database;
}

async function cleanup(database: Database): Promise<void> {
  // Movements are append-only; TRUNCATE is restricted to this disposable DB.
  await database.execute(
    sql.raw(
      "truncate table budget_movements, budget_allocation_rules, budgets",
    ),
  );
  await database
    .delete(applicationCommands)
    .where(inArray(applicationCommands.householdId, [FIXTURES.householdA, FIXTURES.householdB]));
  await database
    .delete(accountEntries)
    .where(inArray(accountEntries.householdId, [FIXTURES.householdA, FIXTURES.householdB]));
  await database
    .delete(financialEvents)
    .where(inArray(financialEvents.householdId, [FIXTURES.householdA, FIXTURES.householdB]));
  await database
    .delete(categories)
    .where(inArray(categories.householdId, [FIXTURES.householdA, FIXTURES.householdB]));
  await database
    .delete(accounts)
    .where(inArray(accounts.householdId, [FIXTURES.householdA, FIXTURES.householdB]));
  await database
    .delete(households)
    .where(inArray(households.id, [FIXTURES.householdA, FIXTURES.householdB]));
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.householdA, name: "T08 Household A" },
    { id: FIXTURES.householdB, name: "T08 Household B" },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accountGeneralA,
      householdId: FIXTURES.householdA,
      name: "T08 general A",
      type: "CHECKING",
      spendability: "GENERAL",
    },
    {
      id: FIXTURES.accountRestrictedA,
      householdId: FIXTURES.householdA,
      name: "T08 restricted A",
      type: "BENEFIT",
      spendability: "RESTRICTED",
    },
    {
      id: FIXTURES.accountExcludedA,
      householdId: FIXTURES.householdA,
      name: "T08 excluded A",
      type: "INVESTMENT",
      spendability: "EXCLUDED",
    },
    {
      id: FIXTURES.accountGeneralB,
      householdId: FIXTURES.householdB,
      name: "T08 general B",
      type: "CHECKING",
      spendability: "GENERAL",
    },
  ]);
  await database.insert(categories).values([
    {
      id: FIXTURES.categoryMulti,
      householdId: FIXTURES.householdA,
      name: "T08 multi",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categoryWithdrawal,
      householdId: FIXTURES.householdA,
      name: "T08 withdrawal",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categoryNegative,
      householdId: FIXTURES.householdA,
      name: "T08 negative",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categoryClosed,
      householdId: FIXTURES.householdA,
      name: "T08 closed",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categoryB,
      householdId: FIXTURES.householdB,
      name: "T08 household B",
      kind: "EXPENSE",
    },
  ]);
  await database.insert(financialEvents).values([
    {
      id: FIXTURES.openingEventA,
      householdId: FIXTURES.householdA,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(1_000),
      occurredOn: "2026-09-01",
      description: "T08 general opening A",
    },
    {
      id: FIXTURES.restrictedEventA,
      householdId: FIXTURES.householdA,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(9_000),
      occurredOn: "2026-09-01",
      description: "T08 restricted opening A",
    },
    {
      id: FIXTURES.excludedEventA,
      householdId: FIXTURES.householdA,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(5_000),
      occurredOn: "2026-09-01",
      description: "T08 excluded opening A",
    },
    {
      id: FIXTURES.openingEventB,
      householdId: FIXTURES.householdB,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(7_000),
      occurredOn: "2026-09-01",
      description: "T08 general opening B",
    },
    {
      id: FIXTURES.expenseEvent,
      householdId: FIXTURES.householdA,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(200),
      occurredOn: "2026-09-01",
      description: "T08 reflected expense",
      categoryId: FIXTURES.categoryWithdrawal,
    },
  ]);
  await database.insert(accountEntries).values([
    {
      id: FIXTURES.openingEntryA,
      financialEventId: FIXTURES.openingEventA,
      accountId: FIXTURES.accountGeneralA,
      householdId: FIXTURES.householdA,
      amountCents: BigInt(1_000),
      status: "POSTED",
      postedOn: "2026-09-01",
    },
    {
      id: FIXTURES.restrictedEntryA,
      financialEventId: FIXTURES.restrictedEventA,
      accountId: FIXTURES.accountRestrictedA,
      householdId: FIXTURES.householdA,
      amountCents: BigInt(9_000),
      status: "POSTED",
      postedOn: "2026-09-01",
    },
    {
      id: FIXTURES.excludedEntryA,
      financialEventId: FIXTURES.excludedEventA,
      accountId: FIXTURES.accountExcludedA,
      householdId: FIXTURES.householdA,
      amountCents: BigInt(5_000),
      status: "POSTED",
      postedOn: "2026-09-01",
    },
    {
      id: FIXTURES.openingEntryB,
      financialEventId: FIXTURES.openingEventB,
      accountId: FIXTURES.accountGeneralB,
      householdId: FIXTURES.householdB,
      amountCents: BigInt(7_000),
      status: "POSTED",
      postedOn: "2026-09-01",
    },
    {
      id: FIXTURES.expenseEntry,
      financialEventId: FIXTURES.expenseEvent,
      accountId: FIXTURES.accountGeneralA,
      householdId: FIXTURES.householdA,
      amountCents: BigInt(-200),
      status: "POSTED",
      postedOn: "2026-09-01",
    },
  ]);
  await database.insert(budgets).values([
    {
      id: FIXTURES.budgetMulti,
      householdId: FIXTURES.householdA,
      referenceId: "box-t08-multi",
      categoryId: FIXTURES.categoryMulti,
      name: "T08 Multi",
      activeFrom: "2026-01-01",
    },
    {
      id: FIXTURES.budgetWithdrawal,
      householdId: FIXTURES.householdA,
      referenceId: "box-t08-withdrawal",
      categoryId: FIXTURES.categoryWithdrawal,
      name: "T08 Withdrawal",
      activeFrom: "2026-01-01",
    },
    {
      id: FIXTURES.budgetNegative,
      householdId: FIXTURES.householdA,
      referenceId: "box-t08-negative",
      categoryId: FIXTURES.categoryNegative,
      name: "T08 Negative",
      activeFrom: "2026-01-01",
    },
    {
      id: FIXTURES.budgetClosed,
      householdId: FIXTURES.householdA,
      referenceId: "box-t08-closed",
      categoryId: FIXTURES.categoryClosed,
      name: "T08 Closed",
      status: "CLOSED",
      activeFrom: "2026-01-01",
      closedOn: "2026-09-10",
    },
    {
      id: FIXTURES.budgetB,
      householdId: FIXTURES.householdB,
      referenceId: "box-t08-household-b",
      categoryId: FIXTURES.categoryB,
      name: "T08 Household B",
      activeFrom: "2026-01-01",
    },
  ]);
}

function forecast(
  asOf: string,
  horizonDays: number,
  openingBalanceCents: string,
  minimumBalanceReferences: readonly string[] = [],
  items: readonly ForecastEngineItem[] = [],
): ForecastTimeline {
  const date = Temporal.PlainDate.from(asOf, { overflow: "reject" });
  const from = date.add({ days: 1 }).toString();
  const to = date.add({ days: horizonDays }).toString();
  const timeline = ForecastEngine(
    items,
    openingBalanceCents,
    { from, to },
    "CONSERVATIVE",
  );
  if (minimumBalanceReferences.length === 0) return timeline;
  return {
    ...timeline,
    minimumBalanceReferences: [
      ...new Set([
        ...timeline.minimumBalanceReferences,
        ...minimumBalanceReferences,
      ]),
    ],
  };
}

function serviceDependencies(
  database: Database,
  context: FinancialContext,
  timeline: ForecastTimeline,
): SpendableServiceDependencies {
  return {
    database,
    resolveContext: () => context,
    readForecast: () => timeline,
    readBuffer: () => null,
    reserveAdapterFactory: (resolvedContext) =>
      createBudgetReserveAdapter(resolvedContext, { database }),
  };
}

async function insertMovement(
  database: Database,
  values: {
    readonly id: string;
    readonly budgetId: string;
    readonly referenceId: string;
    readonly kind: "CONTRIBUTION" | "WITHDRAWAL";
    readonly amountCents: bigint;
    readonly effectiveOn: string;
  },
): Promise<void> {
  await database.insert(budgetMovements).values({
    id: values.id,
    householdId: FIXTURES.householdA,
    budgetId: values.budgetId,
    referenceId: values.referenceId,
    kind: values.kind,
    amountCents: values.amountCents,
    effectiveOn: values.effectiveOn,
    sourceKind: "MANUAL",
  });
}

integration("T08 PostgreSQL vertical S09 reserve provider", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de T08_INTEGRATION=1.",
      );
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = databaseOrThrow(database);
    await cleanup(db);
    await seed(db);
  });

  afterAll(async () => {
    if (database) await cleanup(database);
    await closeDb();
  });

  it("reduces the gross spendable once for several persisted contributions", async () => {
    const db = databaseOrThrow(database);
    const useCases = createBudgetMovementUseCases(db);
    await useCases.registerContribution(CONTEXT_A, {
      commandId: "t08-multi-contribution-a",
      budgetReferenceId: "box-t08-multi",
      amountCents: "300",
      effectiveOn: "2026-09-01",
      referenceId: "t08-multi-a",
    });
    await useCases.registerContribution(CONTEXT_A, {
      commandId: "t08-multi-contribution-b",
      budgetReferenceId: "box-t08-multi",
      amountCents: "200",
      effectiveOn: "2026-09-02",
      referenceId: "t08-multi-b",
    });

    const result = await getSpendable(
      { asOf: "2026-09-02", horizon: { days: 1 } },
      serviceDependencies(db, CONTEXT_A, forecast("2026-09-02", 1, "800")),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        openingBalanceCents: "800",
        openingProjectedBalanceCents: "300",
        minimumProjectedBalanceCents: "300",
        rawSpendableCents: "300",
        reserve: {
          status: "AVAILABLE",
          protectedCents: "500",
          appliedOpeningAdjustmentCents: "-500",
          components: [{ referenceId: "box-t08-multi", amountCents: "500" }],
        },
      },
    });
  });

  it("keeps a persisted transfer pair from duplicating protected reserve", async () => {
    const db = databaseOrThrow(database);
    const useCases = createBudgetMovementUseCases(db);
    await useCases.registerContribution(CONTEXT_A, {
      commandId: "t08-transfer-seed",
      budgetReferenceId: "box-t08-multi",
      amountCents: "500",
      effectiveOn: "2026-09-01",
      referenceId: "t08-transfer-seed-contribution",
    });
    await useCases.transferBetweenBudgets(CONTEXT_A, {
      commandId: "t08-transfer-pair",
      sourceBudgetReferenceId: "box-t08-multi",
      destinationBudgetReferenceId: "box-t08-withdrawal",
      amountCents: "100",
      effectiveOn: "2026-09-02",
      transferReferenceId: "t08-transfer-reference",
      withdrawalReferenceId: "t08-transfer-withdrawal",
      contributionReferenceId: "t08-transfer-contribution",
    });

    const result = await getSpendable(
      { asOf: "2026-09-02", horizon: { days: 1 } },
      serviceDependencies(db, CONTEXT_A, forecast("2026-09-02", 1, "800")),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        openingProjectedBalanceCents: "300",
        minimumProjectedBalanceCents: "300",
        rawSpendableCents: "300",
        reserve: {
          protectedCents: "500",
          appliedOpeningAdjustmentCents: "-500",
          components: [
            {
              referenceId: "box-t08-multi",
              amountCents: "400",
            },
            {
              referenceId: "box-t08-withdrawal",
              amountCents: "100",
            },
          ],
        },
      },
    });
  });

  it("releases an unreflected withdrawal once while retaining signed balance", async () => {
    const db = databaseOrThrow(database);
    const useCases = createBudgetMovementUseCases(db);
    await useCases.registerContribution(CONTEXT_A, {
      commandId: "t08-withdrawal-contribution",
      budgetReferenceId: "box-t08-withdrawal",
      amountCents: "500",
      effectiveOn: "2026-09-01",
      referenceId: "t08-withdrawal-contribution",
    });
    await useCases.registerWithdrawal(CONTEXT_A, {
      commandId: "t08-withdrawal-manual",
      budgetReferenceId: "box-t08-withdrawal",
      amountCents: "200",
      effectiveOn: "2026-09-02",
      referenceId: "t08-withdrawal-manual",
    });

    const result = await getSpendable(
      { asOf: "2026-09-02", horizon: { days: 1 } },
      serviceDependencies(db, CONTEXT_A, forecast("2026-09-02", 1, "800")),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        openingProjectedBalanceCents: "500",
        rawSpendableCents: "500",
        reserve: {
          protectedCents: "300",
          appliedOpeningAdjustmentCents: "-300",
        },
      },
    });
  });

  it("keeps negative history and releases a closed box only at closedOn", async () => {
    const db = databaseOrThrow(database);
    await insertMovement(db, {
      id: FIXTURES.negativeContribution,
      budgetId: FIXTURES.budgetNegative,
      referenceId: "t08-negative-contribution",
      kind: "CONTRIBUTION",
      amountCents: BigInt(100),
      effectiveOn: "2026-09-01",
    });
    await insertMovement(db, {
      id: FIXTURES.negativeWithdrawal,
      budgetId: FIXTURES.budgetNegative,
      referenceId: "t08-negative-withdrawal",
      kind: "WITHDRAWAL",
      amountCents: BigInt(300),
      effectiveOn: "2026-09-02",
    });
    await insertMovement(db, {
      id: FIXTURES.closedContribution,
      budgetId: FIXTURES.budgetClosed,
      referenceId: "t08-closed-contribution",
      kind: "CONTRIBUTION",
      amountCents: BigInt(400),
      effectiveOn: "2026-09-05",
    });

    const historicalContext = {
      asOf: "2026-09-09",
      scenario: "CONSERVATIVE" as const,
      horizon: { days: 1 },
    };
    const historical = await createBudgetReserveAdapter(CONTEXT_A, { database: db })
      .getReserve(historicalContext);
    expect(historical.protectedAmount.toCentsString()).toBe("400");
    const negativeBox = historical.boxes.find(
      ({ boxReferenceId }) => boxReferenceId === "box-t08-negative",
    );
    expect(negativeBox?.balance.toCentsString()).toBe("-200");

    const historicalSpendable = await getSpendable(
      { asOf: "2026-09-09", horizon: { days: 1 } },
      serviceDependencies(db, CONTEXT_A, forecast("2026-09-09", 1, "800")),
    );
    expect(historicalSpendable).toMatchObject({
      ok: true,
      value: {
        reserve: {
          protectedCents: "400",
          appliedOpeningAdjustmentCents: "-400",
        },
      },
    });

    const current = await getSpendable(
      { asOf: "2026-09-10", horizon: { days: 1 } },
      serviceDependencies(db, CONTEXT_A, forecast("2026-09-10", 1, "800")),
    );
    expect(current).toMatchObject({
      ok: true,
      value: {
        reserve: {
          protectedCents: "0",
          appliedOpeningAdjustmentCents: "0",
          components: [],
        },
      },
    });
  });

  it("uses only GENERAL opening resources and keeps restricted/excluded balances out", async () => {
    const db = databaseOrThrow(database);
    const result = await getSpendable(
      { asOf: "2026-09-02", horizon: { days: 1 } },
      serviceDependencies(db, CONTEXT_A, forecast("2026-09-02", 1, "800")),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        openingBalanceCents: "800",
        reserve: { protectedCents: "0" },
      },
    });
    expect(JSON.stringify(result)).not.toContain("9000");
    expect(JSON.stringify(result)).not.toContain("5000");
  });

  it("deduplicates reflected expense lineage, ignores noncanonical forecast sources and isolates tenants", async () => {
    const db = databaseOrThrow(database);
    const useCases = createBudgetMovementUseCases(db);
    await useCases.registerContribution(CONTEXT_A, {
      commandId: "t08-reflected-contribution",
      budgetReferenceId: "box-t08-withdrawal",
      amountCents: "500",
      effectiveOn: "2026-09-01",
      referenceId: "t08-reflected-contribution",
    });
    await useCases.registerWithdrawal(CONTEXT_A, {
      commandId: "t08-reflected-expense",
      budgetReferenceId: "box-t08-withdrawal",
      amountCents: "200",
      effectiveOn: "2026-09-01",
      referenceId: "t08-reflected-expense-movement",
      sourceKind: "EXPENSE",
      sourceReferenceId: FIXTURES.expenseEvent,
      financialEventId: FIXTURES.expenseEvent,
      accountEntryId: FIXTURES.expenseEntry,
    });

    const reflectedReferences = [
      FIXTURES.expenseEvent,
      FIXTURES.expenseEntry,
      "purchase-economic",
      "installment-reference",
      "card-payment-reference",
    ];
    const result = await getSpendable(
      { asOf: "2026-09-02", horizon: { days: 1 } },
      serviceDependencies(
        db,
        CONTEXT_A,
        forecast("2026-09-02", 1, "800", reflectedReferences),
      ),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        openingProjectedBalanceCents: "300",
        rawSpendableCents: "300",
        reserve: {
          protectedCents: "300",
          appliedOpeningAdjustmentCents: "-500",
        },
      },
    });

    const reserve = await createBudgetReserveAdapter(CONTEXT_A, { database: db })
      .getReserve({
        asOf: "2026-09-02",
        scenario: "CONSERVATIVE",
        horizon: { days: 1 },
        reflectedReferenceIds: reflectedReferences,
      });
    const component = reserve.components.find(
      ({ boxReferenceId }) => boxReferenceId === "box-t08-withdrawal",
    );
    expect(component).toMatchObject({
      amount: { cents: BigInt(300) },
      appliedAmount: { cents: BigInt(-500) },
      appliedMovementReferenceIds: ["t08-reflected-contribution"],
    });

    const householdB = await getSpendable(
      { asOf: "2026-09-02", horizon: { days: 1 } },
      serviceDependencies(db, CONTEXT_B, forecast("2026-09-02", 1, "7000")),
    );
    expect(householdB).toMatchObject({
      ok: true,
      value: {
        openingBalanceCents: "7000",
        reserve: { protectedCents: "0", components: [] },
      },
    });
    expect(JSON.stringify(householdB)).not.toContain("box-t08-withdrawal");
    expect(JSON.stringify(householdB)).not.toContain("t08-reflected");
  });
});
