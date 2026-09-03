import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  budgetAllocationRules,
  budgetMovements,
  budgets,
  categories,
  creditCardBillingRules,
  creditCardPurchases,
  creditCards,
  financialEvents,
  holidays,
  households,
  installmentPlans,
  installments,
  plannedEvents,
  recurringOccurrences,
  recurringRules,
  spendableSettings,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";
import {
  exportHouseholdData,
  maskManifestGeneratedAt,
  resetExportRateLimitStateForTests,
} from "@/modules/export/use-cases";
import { listZipEntryNames } from "@/modules/export/zip";
import { S11_DATASET_FILE_NAMES, S11_DATASET_IDS } from "@/modules/export/contract";

const integration =
  process.env.S11_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  households: {
    a: "00000000-0000-7000-8000-000000506101",
    b: "00000000-0000-7000-8000-000000506102",
    empty: "00000000-0000-7000-8000-000000506103",
  },
  categories: {
    a: "00000000-0000-7000-8000-000000506201",
    b: "00000000-0000-7000-8000-000000506202",
  },
  accounts: {
    checkingA: "00000000-0000-7000-8000-000000506301",
    cardAccountA: "00000000-0000-7000-8000-000000506302",
    checkingB: "00000000-0000-7000-8000-000000506303",
    cardAccountB: "00000000-0000-7000-8000-000000506304",
  },
  events: {
    a: "00000000-0000-7000-8000-000000506401",
    b: "00000000-0000-7000-8000-000000506402",
    purchaseA: "00000000-0000-7000-8000-000000506403",
    purchaseB: "00000000-0000-7000-8000-000000506404",
  },
  entries: {
    a: "00000000-0000-7000-8000-000000506501",
    b: "00000000-0000-7000-8000-000000506502",
  },
  cards: {
    a: "00000000-0000-7000-8000-000000506601",
    b: "00000000-0000-7000-8000-000000506602",
  },
  billingRules: {
    a: "00000000-0000-7000-8000-000000506701",
    b: "00000000-0000-7000-8000-000000506702",
  },
  purchases: {
    a: "00000000-0000-7000-8000-000000506801",
    b: "00000000-0000-7000-8000-000000506802",
  },
  plans: {
    a: "00000000-0000-7000-8000-000000506901",
    b: "00000000-0000-7000-8000-000000506902",
  },
  installments: {
    a: "00000000-0000-7000-8000-000000507001",
    b: "00000000-0000-7000-8000-000000507002",
  },
  recurringRules: {
    a: "00000000-0000-7000-8000-000000507101",
    b: "00000000-0000-7000-8000-000000507102",
  },
  recurringOccurrences: {
    a: "00000000-0000-7000-8000-000000507201",
    b: "00000000-0000-7000-8000-000000507202",
  },
  plannedEvents: {
    a: "00000000-0000-7000-8000-000000507301",
    b: "00000000-0000-7000-8000-000000507302",
  },
  holidays: {
    a: "00000000-0000-7000-8000-000000507401",
    b: "00000000-0000-7000-8000-000000507402",
  },
  spendable: {
    a: "00000000-0000-7000-8000-000000507501",
    b: "00000000-0000-7000-8000-000000507502",
  },
  budgets: {
    a: "00000000-0000-7000-8000-000000507601",
    b: "00000000-0000-7000-8000-000000507602",
  },
  budgetMovements: {
    a: "00000000-0000-7000-8000-000000507701",
    b: "00000000-0000-7000-8000-000000507702",
  },
  allocationRules: {
    a: "00000000-0000-7000-8000-000000507801",
    b: "00000000-0000-7000-8000-000000507802",
  },
} as const;

const householdIds = Object.values(FIXTURES.households);

const contextA: FinancialContext = {
  userId: "00000000-0000-7000-8000-000000508001",
  householdId: FIXTURES.households.a,
};

const contextEmpty: FinancialContext = {
  userId: "00000000-0000-7000-8000-000000508002",
  householdId: FIXTURES.households.empty,
};

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco PostgreSQL de integração S11 T07 não foi inicializado.");
  }
  return database;
}

function foreignIdsForHouseholdB(): Set<string> {
  return new Set([
    FIXTURES.categories.b,
    FIXTURES.accounts.checkingB,
    FIXTURES.accounts.cardAccountB,
    FIXTURES.events.b,
    FIXTURES.events.purchaseB,
    FIXTURES.entries.b,
    FIXTURES.cards.b,
    FIXTURES.billingRules.b,
    FIXTURES.purchases.b,
    FIXTURES.plans.b,
    FIXTURES.installments.b,
    FIXTURES.recurringRules.b,
    FIXTURES.recurringOccurrences.b,
    FIXTURES.plannedEvents.b,
    FIXTURES.holidays.b,
    FIXTURES.spendable.b,
    FIXTURES.budgets.b,
    FIXTURES.budgetMovements.b,
    FIXTURES.allocationRules.b,
  ]);
}

async function cleanup(database: Database): Promise<void> {
  await database.execute(
    sql.raw(
      "truncate table budget_movements, budget_allocation_rules, budgets, spendable_settings, holidays, planned_events, recurring_occurrences, recurring_rules, installments, installment_plans, credit_card_purchases, credit_card_billing_rules, credit_cards, account_entries, financial_events, categories, accounts restart identity cascade",
    ),
  );
  await database
    .delete(households)
    .where(inArray(households.id, [...householdIds]));
}

async function seedHousehold(
  database: Database,
  householdId: string,
  suffix: "a" | "b",
): Promise<void> {
  const categoryId = FIXTURES.categories[suffix];
  const checkingId = FIXTURES.accounts[suffix === "a" ? "checkingA" : "checkingB"];
  const cardAccountId = FIXTURES.accounts[suffix === "a" ? "cardAccountA" : "cardAccountB"];
  const eventId = FIXTURES.events[suffix];
  const purchaseEventId = FIXTURES.events[suffix === "a" ? "purchaseA" : "purchaseB"];
  const entryId = FIXTURES.entries[suffix];
  const cardId = FIXTURES.cards[suffix];
  const billingRuleId = FIXTURES.billingRules[suffix];
  const purchaseId = FIXTURES.purchases[suffix];
  const planId = FIXTURES.plans[suffix];
  const installmentId = FIXTURES.installments[suffix];
  const recurringRuleId = FIXTURES.recurringRules[suffix];
  const recurringOccurrenceId = FIXTURES.recurringOccurrences[suffix];
  const plannedEventId = FIXTURES.plannedEvents[suffix];
  const holidayId = FIXTURES.holidays[suffix];
  const spendableId = FIXTURES.spendable[suffix];
  const budgetId = FIXTURES.budgets[suffix];
  const movementId = FIXTURES.budgetMovements[suffix];
  const allocationRuleId = FIXTURES.allocationRules[suffix];

  await database.insert(categories).values({
    id: categoryId,
    householdId,
    name: `S11 Category ${suffix.toUpperCase()}`,
    kind: "EXPENSE",
  });

  await database.insert(accounts).values([
    {
      id: checkingId,
      householdId,
      name: `S11 Checking ${suffix.toUpperCase()}`,
      type: "CHECKING",
      trackingStartedOn: "2026-01-01",
    },
    {
      id: cardAccountId,
      householdId,
      name: `S11 Card Account ${suffix.toUpperCase()}`,
      type: "CREDIT_CARD",
      trackingStartedOn: "2026-01-01",
    },
  ]);

  await database.insert(financialEvents).values([
    {
      id: eventId,
      householdId,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt("1500"),
      occurredOn: "2026-02-01",
      description: `S11 Event ${suffix.toUpperCase()}`,
      categoryId,
    },
    {
      id: purchaseEventId,
      householdId,
      kind: "PURCHASE",
      status: "POSTED",
      origin: "SYSTEM",
      amountCents: BigInt("3000"),
      occurredOn: "2026-02-15",
      description: `S11 Purchase ${suffix.toUpperCase()}`,
      categoryId,
    },
  ]);

  await database.insert(accountEntries).values({
    id: entryId,
    householdId,
    financialEventId: eventId,
    accountId: checkingId,
    amountCents: BigInt("-1500"),
    status: "POSTED",
    postedOn: "2026-02-01",
  });

  await database.insert(creditCards).values({
    id: cardId,
    householdId,
    accountId: cardAccountId,
    creditLimitCents: BigInt("100000"),
    defaultPaymentAccountId: checkingId,
  });

  await database.insert(creditCardBillingRules).values({
    id: billingRuleId,
    householdId,
    cardId,
    closingDay: 10,
    dueDay: 17,
    effectiveFrom: "2026-01-01",
  });

  await database.insert(creditCardPurchases).values({
    id: purchaseId,
    householdId,
    cardId,
    financialEventId: purchaseEventId,
    installmentPlanId: planId,
  });

  await database.insert(installmentPlans).values({
    id: planId,
    householdId,
    purchaseId,
    totalAmountCents: BigInt("3000"),
    installmentCount: 1,
  });

  await database.insert(installments).values({
    id: installmentId,
    householdId,
    planId,
    purchaseId,
    sequence: 1,
    amountCents: BigInt("3000"),
    status: "POSTED",
    billingRuleId,
    billingCycle: "2026-02-01",
    billingClosingDay: 10,
    billingDueDay: 17,
    billingClosingOn: "2026-02-10",
    billingDueOn: "2026-02-17",
  });

  await database.insert(recurringRules).values({
    id: recurringRuleId,
    householdId,
    accountId: checkingId,
    categoryId,
    kind: "EXPENSE",
    amountCents: BigInt("500"),
    description: `S11 Recurring ${suffix.toUpperCase()}`,
    frequency: "MONTHLY",
    dayRule: "FIXED_DAY",
    dayOfMonth: 5,
    startOn: "2026-01-01",
  });

  await database.insert(recurringOccurrences).values({
    id: recurringOccurrenceId,
    householdId,
    recurringRuleId,
    occurrenceKey: "2026-02",
    status: "PLANNED",
  });

  await database.insert(plannedEvents).values({
    id: plannedEventId,
    householdId,
    accountId: checkingId,
    categoryId,
    kind: "EXPENSE",
    status: "PLANNED",
    amountCents: BigInt("700"),
    expectedOn: "2026-03-01",
    description: `S11 Planned ${suffix.toUpperCase()}`,
  });

  await database.insert(holidays).values({
    id: holidayId,
    householdId,
    date: "2026-04-21",
    name: `S11 Holiday ${suffix.toUpperCase()}`,
  });

  await database.insert(spendableSettings).values({
    id: spendableId,
    householdId,
    effectiveFrom: "2026-01-01",
    operationalBufferCents: BigInt("2000"),
  });

  await database.insert(budgets).values({
    id: budgetId,
    householdId,
    referenceId: `s11-box-${suffix}`,
    categoryId,
    name: `S11 Budget ${suffix.toUpperCase()}`,
    status: "ACTIVE",
    activeFrom: "2026-01-01",
  });

  await database.insert(budgetMovements).values({
    id: movementId,
    householdId,
    budgetId,
    referenceId: `s11-movement-${suffix}`,
    kind: "CONTRIBUTION",
    amountCents: BigInt("1000"),
    effectiveOn: "2026-02-01",
  });

  await database.insert(budgetAllocationRules).values({
    id: allocationRuleId,
    householdId,
    budgetId,
    amountCents: BigInt("1000"),
    effectiveFrom: "2026-01-01",
  });
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "S11 Household A" },
    { id: FIXTURES.households.b, name: "S11 Household B" },
    { id: FIXTURES.households.empty, name: "S11 Household Empty" },
  ]);
  await seedHousehold(database, FIXTURES.households.a, "a");
  await seedHousehold(database, FIXTURES.households.b, "b");
}

integration("S11 export use-case integration", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar S11_INTEGRATION=1.",
      );
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    resetExportRateLimitStateForTests();
    const db = databaseOrThrow(database);
    await cleanup(db);
    await seed(db);
  });

  afterAll(async () => {
    if (database) {
      await cleanup(database);
    }
    await closeDb();
  });

  it("never leaks household B rows into household A export CSVs", async () => {
    const foreignIds = foreignIdsForHouseholdB();
    const result = await exportHouseholdData(contextA, {}, {
      correlationId: "integration-isolation",
      generatedAt: () => "2026-09-03T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const zipText = result.zip.toString("utf8");
    for (const foreignId of foreignIds) {
      expect(zipText).not.toContain(foreignId);
    }
    expect(result.manifest.rowCountTotal).toBeGreaterThan(0);
  });

  it("produces a valid ZIP for an empty household", async () => {
    const result = await exportHouseholdData(contextEmpty, {}, {
      correlationId: "integration-empty",
      generatedAt: () => "2026-09-03T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest.rowCountTotal).toBe(0);
    expect(listZipEntryNames(result.zip)).toEqual([
      "manifest.json",
      ...S11_DATASET_IDS.map((id) => S11_DATASET_FILE_NAMES[id]),
    ]);

    const fixtureDir = join(
      process.cwd(),
      "tests/fixtures/s11-operacao-confiavel",
    );
    writeFileSync(
      join(fixtureDir, "empty-export-manifest.json"),
      `${JSON.stringify(maskManifestGeneratedAt(result.manifest), null, 2)}\n`,
      "utf8",
    );
  });
});
