import { Temporal } from "@js-temporal/polyfill";
import { inArray, sql } from "drizzle-orm";

import type { Database } from "@/db";
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

import volumeRecipe from "./volume.recipe.json";

export const S11_INTEGRATION_FIXTURES = {
  households: {
    a: "00000000-0000-7000-8000-000000506101",
    b: "00000000-0000-7000-8000-000000506102",
    empty: "00000000-0000-7000-8000-000000506103",
    volume: volumeRecipe.householdId,
  },
  categories: {
    a: "00000000-0000-7000-8000-000000506201",
    b: "00000000-0000-7000-8000-000000506202",
    volume: volumeRecipe.categoryId,
  },
  accounts: {
    checkingA: "00000000-0000-7000-8000-000000506301",
    cardAccountA: "00000000-0000-7000-8000-000000506302",
    checkingB: "00000000-0000-7000-8000-000000506303",
    cardAccountB: "00000000-0000-7000-8000-000000506304",
    volume: volumeRecipe.accountId,
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
  users: {
    a: "00000000-0000-7000-8000-000000508001",
    empty: "00000000-0000-7000-8000-000000508002",
    volume: volumeRecipe.userId,
  },
} as const;

export const S11_VOLUME_TARGETS = volumeRecipe.targets;
export const S11_VOLUME_MAX_EXPORT_MS = volumeRecipe.limits.maxExportDurationMs;

const householdIds = Object.values(S11_INTEGRATION_FIXTURES.households);

export const contextA: FinancialContext = {
  userId: S11_INTEGRATION_FIXTURES.users.a,
  householdId: S11_INTEGRATION_FIXTURES.households.a,
};

export const contextEmpty: FinancialContext = {
  userId: S11_INTEGRATION_FIXTURES.users.empty,
  householdId: S11_INTEGRATION_FIXTURES.households.empty,
};

export const contextVolume: FinancialContext = {
  userId: S11_INTEGRATION_FIXTURES.users.volume,
  householdId: S11_INTEGRATION_FIXTURES.households.volume,
};

function volumeEventId(index: number): string {
  return `${volumeRecipe.idPrefixes.financialEvent}${index.toString(16).padStart(12, "0")}`;
}

function volumeEntryId(index: number): string {
  return `${volumeRecipe.idPrefixes.accountEntry}${index.toString(16).padStart(12, "0")}`;
}

function volumeOccurredOn(index: number): string {
  return Temporal.PlainDate.from("2024-01-01")
    .add({ days: index % 1095 })
    .toString();
}

export function foreignIdsForHouseholdB(): string[] {
  const fixtures = S11_INTEGRATION_FIXTURES;
  return [
    fixtures.categories.b,
    fixtures.accounts.checkingB,
    fixtures.accounts.cardAccountB,
    fixtures.events.b,
    fixtures.events.purchaseB,
    fixtures.entries.b,
    fixtures.cards.b,
    fixtures.billingRules.b,
    fixtures.purchases.b,
    fixtures.plans.b,
    fixtures.installments.b,
    fixtures.recurringRules.b,
    fixtures.recurringOccurrences.b,
    fixtures.plannedEvents.b,
    fixtures.holidays.b,
    fixtures.spendable.b,
    fixtures.budgets.b,
    fixtures.budgetMovements.b,
    fixtures.allocationRules.b,
  ];
}

export async function cleanupS11IntegrationHouseholds(
  database: Database,
): Promise<void> {
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
  const fixtures = S11_INTEGRATION_FIXTURES;
  const categoryId = fixtures.categories[suffix];
  const checkingId = fixtures.accounts[suffix === "a" ? "checkingA" : "checkingB"];
  const cardAccountId = fixtures.accounts[suffix === "a" ? "cardAccountA" : "cardAccountB"];
  const eventId = fixtures.events[suffix];
  const purchaseEventId = fixtures.events[suffix === "a" ? "purchaseA" : "purchaseB"];
  const entryId = fixtures.entries[suffix];
  const cardId = fixtures.cards[suffix];
  const billingRuleId = fixtures.billingRules[suffix];
  const purchaseId = fixtures.purchases[suffix];
  const planId = fixtures.plans[suffix];
  const installmentId = fixtures.installments[suffix];
  const recurringRuleId = fixtures.recurringRules[suffix];
  const recurringOccurrenceId = fixtures.recurringOccurrences[suffix];
  const plannedEventId = fixtures.plannedEvents[suffix];
  const holidayId = fixtures.holidays[suffix];
  const spendableId = fixtures.spendable[suffix];
  const budgetId = fixtures.budgets[suffix];
  const movementId = fixtures.budgetMovements[suffix];
  const allocationRuleId = fixtures.allocationRules[suffix];

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
      origin: "MANUAL",
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

  await database.transaction(async (transaction) => {
    await transaction.insert(creditCardPurchases).values({
      id: purchaseId,
      householdId,
      cardId,
      financialEventId: purchaseEventId,
      installmentPlanId: planId,
    });
    await transaction.insert(installmentPlans).values({
      id: planId,
      householdId,
      purchaseId,
      totalAmountCents: BigInt("3000"),
      installmentCount: 1,
    });
    await transaction.insert(installments).values({
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

export async function seedS11IntegrationHouseholds(
  database: Database,
): Promise<void> {
  const fixtures = S11_INTEGRATION_FIXTURES;
  await database.insert(households).values([
    { id: fixtures.households.a, name: "S11 Household A" },
    { id: fixtures.households.b, name: "S11 Household B" },
    { id: fixtures.households.empty, name: "S11 Household Empty" },
  ]);
  await seedHousehold(database, fixtures.households.a, "a");
  await seedHousehold(database, fixtures.households.b, "b");
}

const VOLUME_BATCH_SIZE = 500;

export async function seedS11VolumeHousehold(database: Database): Promise<void> {
  const fixtures = S11_INTEGRATION_FIXTURES;
  const householdId = fixtures.households.volume;
  const categoryId = fixtures.categories.volume;
  const accountId = fixtures.accounts.volume;
  const eventCount = S11_VOLUME_TARGETS.financial_events;
  const entryCount = S11_VOLUME_TARGETS.account_entries;

  await database.insert(households).values({
    id: householdId,
    name: "S11 Volume Household",
  });

  await database.insert(categories).values({
    id: categoryId,
    householdId,
    name: "S11 Volume Category",
    kind: "EXPENSE",
  });

  await database.insert(accounts).values({
    id: accountId,
    householdId,
    name: "S11 Volume Checking",
    type: "CHECKING",
    trackingStartedOn: "2024-01-01",
  });

  for (let offset = 0; offset < eventCount; offset += VOLUME_BATCH_SIZE) {
    const batch = [];
    const limit = Math.min(VOLUME_BATCH_SIZE, eventCount - offset);
    for (let index = 0; index < limit; index += 1) {
      const sequence = offset + index;
      batch.push({
        id: volumeEventId(sequence),
        householdId,
        kind: "EXPENSE" as const,
        status: "POSTED" as const,
        origin: "MANUAL" as const,
        amountCents: BigInt((sequence % 1000 + 1) * 100),
        occurredOn: volumeOccurredOn(sequence),
        description: `S11 Volume Event ${sequence}`,
        categoryId,
      });
    }
    await database.insert(financialEvents).values(batch);
  }

  for (let offset = 0; offset < entryCount; offset += VOLUME_BATCH_SIZE) {
    const batch = [];
    const limit = Math.min(VOLUME_BATCH_SIZE, entryCount - offset);
    for (let index = 0; index < limit; index += 1) {
      const sequence = offset + index;
      const eventIndex = Math.floor(sequence / 2);
      const occurredOn = volumeOccurredOn(eventIndex);
      batch.push({
        id: volumeEntryId(sequence),
        householdId,
        financialEventId: volumeEventId(eventIndex),
        accountId,
        amountCents: BigInt(-((sequence % 1000 + 1) * 50)),
        status: "POSTED" as const,
        postedOn: occurredOn,
      });
    }
    await database.insert(accountEntries).values(batch);
  }
}
