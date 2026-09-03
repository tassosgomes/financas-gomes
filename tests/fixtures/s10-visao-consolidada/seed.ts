import { inArray } from "drizzle-orm";

import type { Database } from "@/db";
import {
  accounts,
  budgets,
  categories,
  creditCardBillingRules,
  creditCardPurchases,
  creditCards,
  financialEvents,
  households,
  installmentPlans,
  installments,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";

/** UUIDv7-shaped identifiers (version nibble `7`) for deterministic T09 volume. */
function uuidV7Shaped(suffix: number): string {
  return `00000000-0000-7000-8000-${suffix.toString(16).padStart(12, "0")}`;
}

export const S10_VOLUME_FIXTURE_VERSION = "s10-visao-consolidada-t09-v1" as const;

export const S10_VOLUME_MONTHS = ["2026-07", "2026-08", "2026-09"] as const;

export const S10_VOLUME_AS_OF = "2026-09-15" as const;

export const S10_VOLUME_EXPECTED_INDEXES = [
  "financial_events_household_occurred_on_idx",
  "financial_events_household_category_occurred_on_idx",
] as const;

export const S10_VOLUME_IDS = {
  households: {
    a: uuidV7Shaped(0x109_001),
    b: uuidV7Shaped(0x109_002),
  },
  users: {
    a: uuidV7Shaped(0x109_011),
    b: uuidV7Shaped(0x109_012),
  },
  categories: {
    aFood: uuidV7Shaped(0x109_101),
    aTransport: uuidV7Shaped(0x109_102),
    aHousing: uuidV7Shaped(0x109_103),
    aHealth: uuidV7Shaped(0x109_104),
    aEducation: uuidV7Shaped(0x109_105),
    aLeisure: uuidV7Shaped(0x109_106),
    aCard: uuidV7Shaped(0x109_107),
    aServices: uuidV7Shaped(0x109_108),
    aClothing: uuidV7Shaped(0x109_109),
    aPets: uuidV7Shaped(0x109_10a),
    aSalary: uuidV7Shaped(0x109_111),
    bFood: uuidV7Shaped(0x109_201),
    bTransport: uuidV7Shaped(0x109_202),
    bHousing: uuidV7Shaped(0x109_203),
    bLeisure: uuidV7Shaped(0x109_204),
    bOther: uuidV7Shaped(0x109_205),
    bSalary: uuidV7Shaped(0x109_211),
  },
  accounts: {
    cardA: uuidV7Shaped(0x109_301),
    checkingA: uuidV7Shaped(0x109_302),
    cardB: uuidV7Shaped(0x109_303),
  },
  cards: {
    a: uuidV7Shaped(0x109_401),
    b: uuidV7Shaped(0x109_402),
  },
  billingRules: {
    a: uuidV7Shaped(0x109_411),
    b: uuidV7Shaped(0x109_412),
  },
  purchases: {
    aInstallment: uuidV7Shaped(0x109_421),
    bSingle: uuidV7Shaped(0x109_422),
  },
  plans: {
    aInstallment: uuidV7Shaped(0x109_431),
    bSingle: uuidV7Shaped(0x109_432),
  },
  installments: {
    a1: uuidV7Shaped(0x109_441),
    a2: uuidV7Shaped(0x109_442),
    a3: uuidV7Shaped(0x109_443),
  },
  budgets: {
    aReserve: uuidV7Shaped(0x109_501),
    bReserve: uuidV7Shaped(0x109_502),
  },
  events: {
    transferA: uuidV7Shaped(0x109_601),
    purchaseA: uuidV7Shaped(0x109_602),
    reversalTarget: uuidV7Shaped(0x109_603),
    reversalA: uuidV7Shaped(0x109_604),
    purchaseB: uuidV7Shaped(0x109_605),
  },
} as const;

export const S10_VOLUME_HOUSEHOLD_IDS = [
  S10_VOLUME_IDS.households.a,
  S10_VOLUME_IDS.households.b,
] as const;

const EXPENSE_CATEGORY_KEYS = [
  "aFood",
  "aTransport",
  "aHousing",
  "aHealth",
  "aEducation",
  "aLeisure",
  "aCard",
  "aServices",
  "aClothing",
  "aPets",
] as const;

type ExpenseCategoryKey = (typeof EXPENSE_CATEGORY_KEYS)[number];

function expenseCategoryId(key: ExpenseCategoryKey): string {
  return S10_VOLUME_IDS.categories[key];
}

function deterministicAmountCents(
  householdIndex: number,
  monthIndex: number,
  categoryIndex: number,
  occurrence: number,
): bigint {
  const base = BigInt(
    1_100 +
      householdIndex * 137 +
      monthIndex * 89 +
      categoryIndex * 53 +
      occurrence * 17,
  );
  return base * BigInt(100);
}

function eventIdForSlot(slot: number): string {
  return uuidV7Shaped(0x109_700 + slot);
}

export interface S10VolumeContexts {
  readonly a: FinancialContext;
  readonly b: FinancialContext;
}

export function createS10VolumeContexts(): S10VolumeContexts {
  return {
    a: {
      userId: S10_VOLUME_IDS.users.a,
      householdId: S10_VOLUME_IDS.households.a,
    },
    b: {
      userId: S10_VOLUME_IDS.users.b,
      householdId: S10_VOLUME_IDS.households.b,
    },
  };
}

export interface S10VolumeSeedStats {
  readonly fixtureVersion: typeof S10_VOLUME_FIXTURE_VERSION;
  readonly financialEventCount: number;
  readonly categoryCount: number;
  readonly months: readonly string[];
}

export function describeS10VolumeSeed(): S10VolumeSeedStats {
  const perMonth =
    2 + EXPENSE_CATEGORY_KEYS.length * 2 + 5;
  const generatedEvents = S10_VOLUME_MONTHS.length * perMonth + 5;
  return {
    fixtureVersion: S10_VOLUME_FIXTURE_VERSION,
    financialEventCount: generatedEvents,
    categoryCount: Object.keys(S10_VOLUME_IDS.categories).length,
    months: S10_VOLUME_MONTHS,
  };
}

function monthDay(month: string, day: number): string {
  return `${month}-${day.toString(10).padStart(2, "0")}`;
}

function buildRecurringFinancialEvents(): Array<typeof financialEvents.$inferInsert> {
  const rows: Array<typeof financialEvents.$inferInsert> = [];
  let slot = 0;

  for (const [monthIndex, month] of S10_VOLUME_MONTHS.entries()) {
    rows.push({
      id: eventIdForSlot(slot++),
      householdId: S10_VOLUME_IDS.households.a,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: deterministicAmountCents(0, monthIndex, 0, 0) * BigInt(50),
      occurredOn: monthDay(month, 5),
      description: `T09 salary A ${month}`,
      categoryId: S10_VOLUME_IDS.categories.aSalary,
    });
    rows.push({
      id: eventIdForSlot(slot++),
      householdId: S10_VOLUME_IDS.households.b,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: deterministicAmountCents(1, monthIndex, 0, 0) * BigInt(40),
      occurredOn: monthDay(month, 5),
      description: `T09 salary B ${month}`,
      categoryId: S10_VOLUME_IDS.categories.bSalary,
    });

    for (const [categoryIndex, categoryKey] of EXPENSE_CATEGORY_KEYS.entries()) {
      for (const occurrence of [0, 1] as const) {
        const day = 7 + categoryIndex + occurrence * 3;
        rows.push({
          id: eventIdForSlot(slot++),
          householdId: S10_VOLUME_IDS.households.a,
          kind: "EXPENSE",
          status: "POSTED",
          origin: "MANUAL",
          amountCents: deterministicAmountCents(
            0,
            monthIndex,
            categoryIndex,
            occurrence,
          ),
          occurredOn: monthDay(month, Math.min(day, 28)),
          description: `T09 ${categoryKey} A ${month}#${occurrence}`,
          categoryId: expenseCategoryId(categoryKey),
        });
      }
    }

    const bCategories = [
      S10_VOLUME_IDS.categories.bFood,
      S10_VOLUME_IDS.categories.bTransport,
      S10_VOLUME_IDS.categories.bHousing,
      S10_VOLUME_IDS.categories.bLeisure,
      S10_VOLUME_IDS.categories.bOther,
    ] as const;
    for (const [categoryIndex, categoryId] of bCategories.entries()) {
      rows.push({
        id: eventIdForSlot(slot++),
        householdId: S10_VOLUME_IDS.households.b,
        kind: "EXPENSE",
        status: "POSTED",
        origin: "MANUAL",
        amountCents: deterministicAmountCents(1, monthIndex, categoryIndex, 0),
        occurredOn: monthDay(month, 10 + categoryIndex),
        description: `T09 expense B ${month}#${categoryIndex}`,
        categoryId,
      });
    }
  }

  rows.push({
    id: S10_VOLUME_IDS.events.reversalTarget,
    householdId: S10_VOLUME_IDS.households.a,
    kind: "EXPENSE",
    status: "POSTED",
    origin: "MANUAL",
    amountCents: BigInt(12_345),
    occurredOn: "2026-07-14",
    description: "T09 reversal target expense",
    categoryId: S10_VOLUME_IDS.categories.aFood,
  });

  rows.push({
    id: S10_VOLUME_IDS.events.reversalA,
    householdId: S10_VOLUME_IDS.households.a,
    kind: "REVERSAL",
    status: "POSTED",
    origin: "SYSTEM",
    amountCents: BigInt(12_345),
    occurredOn: "2026-09-12",
    description: "T09 reversal of July food expense",
    categoryId: null,
    reversalOfEventId: S10_VOLUME_IDS.events.reversalTarget,
  });

  rows.push({
    id: S10_VOLUME_IDS.events.purchaseA,
    householdId: S10_VOLUME_IDS.households.a,
    kind: "PURCHASE",
    status: "POSTED",
    origin: "MANUAL",
    amountCents: BigInt(48_000),
    occurredOn: "2026-09-04",
    description: "T09 installment purchase A",
    categoryId: S10_VOLUME_IDS.categories.aCard,
  });

  rows.push({
    id: S10_VOLUME_IDS.events.transferA,
    householdId: S10_VOLUME_IDS.households.a,
    kind: "TRANSFER",
    status: "POSTED",
    origin: "MANUAL",
    amountCents: BigInt(16_000),
    occurredOn: "2026-09-18",
    description: "T09 card payment transfer (must not aggregate)",
    categoryId: null,
  });

  rows.push({
    id: S10_VOLUME_IDS.events.purchaseB,
    householdId: S10_VOLUME_IDS.households.b,
    kind: "PURCHASE",
    status: "POSTED",
    origin: "MANUAL",
    amountCents: BigInt(7_500),
    occurredOn: "2026-09-06",
    description: "T09 single purchase B",
    categoryId: S10_VOLUME_IDS.categories.bOther,
  });

  return rows;
}

export async function cleanupS10VolumeFixtures(database: Database): Promise<void> {
  await database
    .delete(budgets)
    .where(inArray(budgets.householdId, S10_VOLUME_HOUSEHOLD_IDS));
  await database
    .delete(installments)
    .where(inArray(installments.householdId, S10_VOLUME_HOUSEHOLD_IDS));
  await database
    .delete(installmentPlans)
    .where(inArray(installmentPlans.householdId, S10_VOLUME_HOUSEHOLD_IDS));
  await database
    .delete(creditCardPurchases)
    .where(inArray(creditCardPurchases.householdId, S10_VOLUME_HOUSEHOLD_IDS));
  await database
    .delete(creditCardBillingRules)
    .where(inArray(creditCardBillingRules.householdId, S10_VOLUME_HOUSEHOLD_IDS));
  await database
    .delete(creditCards)
    .where(inArray(creditCards.householdId, S10_VOLUME_HOUSEHOLD_IDS));
  await database
    .delete(financialEvents)
    .where(inArray(financialEvents.householdId, S10_VOLUME_HOUSEHOLD_IDS));
  await database
    .delete(categories)
    .where(inArray(categories.householdId, S10_VOLUME_HOUSEHOLD_IDS));
  await database
    .delete(accounts)
    .where(inArray(accounts.householdId, S10_VOLUME_HOUSEHOLD_IDS));
  await database
    .delete(households)
    .where(inArray(households.id, S10_VOLUME_HOUSEHOLD_IDS));
}

export async function seedS10VolumeFixtures(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: S10_VOLUME_IDS.households.a, name: "T09 Volume Household A" },
    { id: S10_VOLUME_IDS.households.b, name: "T09 Volume Household B" },
  ]);

  await database.insert(categories).values([
    {
      id: S10_VOLUME_IDS.categories.aFood,
      householdId: S10_VOLUME_IDS.households.a,
      name: "Alimentação",
      kind: "EXPENSE",
    },
    {
      id: S10_VOLUME_IDS.categories.aTransport,
      householdId: S10_VOLUME_IDS.households.a,
      name: "Transporte",
      kind: "EXPENSE",
    },
    {
      id: S10_VOLUME_IDS.categories.aHousing,
      householdId: S10_VOLUME_IDS.households.a,
      name: "Moradia",
      kind: "EXPENSE",
    },
    {
      id: S10_VOLUME_IDS.categories.aHealth,
      householdId: S10_VOLUME_IDS.households.a,
      name: "Saúde",
      kind: "EXPENSE",
    },
    {
      id: S10_VOLUME_IDS.categories.aEducation,
      householdId: S10_VOLUME_IDS.households.a,
      name: "Educação",
      kind: "EXPENSE",
    },
    {
      id: S10_VOLUME_IDS.categories.aLeisure,
      householdId: S10_VOLUME_IDS.households.a,
      name: "Lazer",
      kind: "EXPENSE",
    },
    {
      id: S10_VOLUME_IDS.categories.aCard,
      householdId: S10_VOLUME_IDS.households.a,
      name: "Cartão",
      kind: "EXPENSE",
    },
    {
      id: S10_VOLUME_IDS.categories.aServices,
      householdId: S10_VOLUME_IDS.households.a,
      name: "Serviços",
      kind: "EXPENSE",
    },
    {
      id: S10_VOLUME_IDS.categories.aClothing,
      householdId: S10_VOLUME_IDS.households.a,
      name: "Vestuário",
      kind: "EXPENSE",
    },
    {
      id: S10_VOLUME_IDS.categories.aPets,
      householdId: S10_VOLUME_IDS.households.a,
      name: "Pets",
      kind: "EXPENSE",
    },
    {
      id: S10_VOLUME_IDS.categories.aSalary,
      householdId: S10_VOLUME_IDS.households.a,
      name: "Salário",
      kind: "INCOME",
    },
    {
      id: S10_VOLUME_IDS.categories.bFood,
      householdId: S10_VOLUME_IDS.households.b,
      name: "Alimentação B",
      kind: "EXPENSE",
    },
    {
      id: S10_VOLUME_IDS.categories.bTransport,
      householdId: S10_VOLUME_IDS.households.b,
      name: "Transporte B",
      kind: "EXPENSE",
    },
    {
      id: S10_VOLUME_IDS.categories.bHousing,
      householdId: S10_VOLUME_IDS.households.b,
      name: "Moradia B",
      kind: "EXPENSE",
    },
    {
      id: S10_VOLUME_IDS.categories.bLeisure,
      householdId: S10_VOLUME_IDS.households.b,
      name: "Lazer B",
      kind: "EXPENSE",
    },
    {
      id: S10_VOLUME_IDS.categories.bOther,
      householdId: S10_VOLUME_IDS.households.b,
      name: "Outros B",
      kind: "EXPENSE",
    },
    {
      id: S10_VOLUME_IDS.categories.bSalary,
      householdId: S10_VOLUME_IDS.households.b,
      name: "Salário B",
      kind: "INCOME",
    },
  ]);

  await database.insert(accounts).values([
    {
      id: S10_VOLUME_IDS.accounts.cardA,
      householdId: S10_VOLUME_IDS.households.a,
      name: "T09 Card A",
      type: "CREDIT_CARD",
    },
    {
      id: S10_VOLUME_IDS.accounts.checkingA,
      householdId: S10_VOLUME_IDS.households.a,
      name: "T09 Checking A",
      type: "CHECKING",
    },
    {
      id: S10_VOLUME_IDS.accounts.cardB,
      householdId: S10_VOLUME_IDS.households.b,
      name: "T09 Card B",
      type: "CREDIT_CARD",
    },
  ]);

  await database.insert(creditCards).values([
    {
      id: S10_VOLUME_IDS.cards.a,
      householdId: S10_VOLUME_IDS.households.a,
      accountId: S10_VOLUME_IDS.accounts.cardA,
      creditLimitCents: BigInt(500_000),
      defaultPaymentAccountId: S10_VOLUME_IDS.accounts.checkingA,
    },
    {
      id: S10_VOLUME_IDS.cards.b,
      householdId: S10_VOLUME_IDS.households.b,
      accountId: S10_VOLUME_IDS.accounts.cardB,
      creditLimitCents: BigInt(200_000),
    },
  ]);

  await database.insert(creditCardBillingRules).values([
    {
      id: S10_VOLUME_IDS.billingRules.a,
      householdId: S10_VOLUME_IDS.households.a,
      cardId: S10_VOLUME_IDS.cards.a,
      closingDay: 10,
      dueDay: 20,
      effectiveFrom: "2026-07-01",
    },
    {
      id: S10_VOLUME_IDS.billingRules.b,
      householdId: S10_VOLUME_IDS.households.b,
      cardId: S10_VOLUME_IDS.cards.b,
      closingDay: 5,
      dueDay: 15,
      effectiveFrom: "2026-07-01",
    },
  ]);

  await database.insert(financialEvents).values(buildRecurringFinancialEvents());

  await database.insert(creditCardPurchases).values([
    {
      id: S10_VOLUME_IDS.purchases.aInstallment,
      householdId: S10_VOLUME_IDS.households.a,
      cardId: S10_VOLUME_IDS.cards.a,
      financialEventId: S10_VOLUME_IDS.events.purchaseA,
      installmentPlanId: S10_VOLUME_IDS.plans.aInstallment,
    },
    {
      id: S10_VOLUME_IDS.purchases.bSingle,
      householdId: S10_VOLUME_IDS.households.b,
      cardId: S10_VOLUME_IDS.cards.b,
      financialEventId: S10_VOLUME_IDS.events.purchaseB,
      installmentPlanId: S10_VOLUME_IDS.plans.bSingle,
    },
  ]);

  await database.insert(installmentPlans).values([
    {
      id: S10_VOLUME_IDS.plans.aInstallment,
      householdId: S10_VOLUME_IDS.households.a,
      purchaseId: S10_VOLUME_IDS.purchases.aInstallment,
      totalAmountCents: BigInt(48_000),
      installmentCount: 3,
    },
    {
      id: S10_VOLUME_IDS.plans.bSingle,
      householdId: S10_VOLUME_IDS.households.b,
      purchaseId: S10_VOLUME_IDS.purchases.bSingle,
      totalAmountCents: BigInt(7_500),
      installmentCount: 1,
    },
  ]);

  await database.insert(installments).values([
    {
      id: S10_VOLUME_IDS.installments.a1,
      householdId: S10_VOLUME_IDS.households.a,
      planId: S10_VOLUME_IDS.plans.aInstallment,
      purchaseId: S10_VOLUME_IDS.purchases.aInstallment,
      sequence: 1,
      amountCents: BigInt(16_000),
      status: "PLANNED",
      billingRuleId: S10_VOLUME_IDS.billingRules.a,
      billingCycle: "2026-09-01",
      billingClosingDay: 10,
      billingDueDay: 20,
      billingClosingOn: "2026-09-10",
      billingDueOn: "2026-09-20",
    },
    {
      id: S10_VOLUME_IDS.installments.a2,
      householdId: S10_VOLUME_IDS.households.a,
      planId: S10_VOLUME_IDS.plans.aInstallment,
      purchaseId: S10_VOLUME_IDS.purchases.aInstallment,
      sequence: 2,
      amountCents: BigInt(16_000),
      status: "PLANNED",
      billingRuleId: S10_VOLUME_IDS.billingRules.a,
      billingCycle: "2026-10-01",
      billingClosingDay: 10,
      billingDueDay: 20,
      billingClosingOn: "2026-10-10",
      billingDueOn: "2026-10-20",
    },
    {
      id: S10_VOLUME_IDS.installments.a3,
      householdId: S10_VOLUME_IDS.households.a,
      planId: S10_VOLUME_IDS.plans.aInstallment,
      purchaseId: S10_VOLUME_IDS.purchases.aInstallment,
      sequence: 3,
      amountCents: BigInt(16_000),
      status: "PLANNED",
      billingRuleId: S10_VOLUME_IDS.billingRules.a,
      billingCycle: "2026-11-01",
      billingClosingDay: 10,
      billingDueDay: 20,
      billingClosingOn: "2026-11-10",
      billingDueOn: "2026-11-20",
    },
  ]);

  await database.insert(budgets).values([
    {
      id: S10_VOLUME_IDS.budgets.aReserve,
      householdId: S10_VOLUME_IDS.households.a,
      referenceId: "t09-reserve-a",
      categoryId: S10_VOLUME_IDS.categories.aHousing,
      name: "T09 Reserva A",
      activeFrom: "2026-07-01",
      targetAmountCents: BigInt(100_000),
    },
    {
      id: S10_VOLUME_IDS.budgets.bReserve,
      householdId: S10_VOLUME_IDS.households.b,
      referenceId: "t09-reserve-b",
      categoryId: S10_VOLUME_IDS.categories.bHousing,
      name: "T09 Reserva B",
      activeFrom: "2026-07-01",
      targetAmountCents: BigInt(50_000),
    },
  ]);
}
