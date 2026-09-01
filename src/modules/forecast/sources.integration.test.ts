import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  applicationCommands,
  creditCardBillingRules,
  creditCards,
  financialEvents,
  households,
  installments,
  plannedEvents,
  recurringOccurrences,
  recurringRules,
} from "@/db/schema";
import { createCreditCardPurchaseUseCases } from "@/modules/credit-cards/purchase-use-cases";
import type { FinancialContext } from "@/modules/households/contracts";

import {
  readForecastInstallmentsForContext,
  readForecastOpeningBalanceForContext,
  readForecastSourcesForContext,
} from "./sources";
import { buildForecastTimelineFromSources } from "./builder";

const integration =
  process.env.T11_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  householdA: "00000000-0000-7000-8000-000000071101",
  householdB: "00000000-0000-7000-8000-000000071102",
  cardAccountA: "00000000-0000-7000-8000-000000071111",
  cardAccountB: "00000000-0000-7000-8000-000000071112",
  cardA: "00000000-0000-7000-8000-000000071121",
  cardB: "00000000-0000-7000-8000-000000071122",
  ruleA: "00000000-0000-7000-8000-000000071131",
  ruleB: "00000000-0000-7000-8000-000000071132",
  recurringRuleA: "00000000-0000-7000-8000-000000071141",
  recurringOccurrenceA: "00000000-0000-7000-8000-000000071151",
  recurringEventA: "00000000-0000-7000-8000-000000071161",
  recurringEntryA: "00000000-0000-7000-8000-000000071171",
} as const;

const HOUSEHOLDS = [FIXTURES.householdA, FIXTURES.householdB] as const;
const contextA: FinancialContext = {
  userId: "t11-user-a",
  householdId: FIXTURES.householdA,
};
const contextB: FinancialContext = {
  userId: "t11-user-b",
  householdId: FIXTURES.householdB,
};

function dbOrThrow(database: Database | undefined): Database {
  if (!database) throw new Error("Banco de integração T11 não inicializado.");
  return database;
}

async function cleanup(database: Database): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`set constraints "credit_card_purchases_installment_plan_household_fkey" deferred`,
    );
    await transaction
      .delete(applicationCommands)
      .where(inArray(applicationCommands.householdId, HOUSEHOLDS));
    await transaction
      .delete(plannedEvents)
      .where(inArray(plannedEvents.householdId, HOUSEHOLDS));
    await transaction
      .delete(recurringOccurrences)
      .where(inArray(recurringOccurrences.householdId, HOUSEHOLDS));
    await transaction
      .delete(recurringRules)
      .where(inArray(recurringRules.householdId, HOUSEHOLDS));
    await transaction
      .delete(accountEntries)
      .where(inArray(accountEntries.householdId, HOUSEHOLDS));
    await transaction
      .delete(installments)
      .where(inArray(installments.householdId, HOUSEHOLDS));
    await transaction.execute(sql`with deleted_purchases as (
      delete from credit_card_purchases
       where household_id in (${sql.join(
         HOUSEHOLDS.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
       returning installment_plan_id
    ) delete from installment_plans
       where household_id in (${sql.join(
         HOUSEHOLDS.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})`);
    await transaction
      .delete(creditCardBillingRules)
      .where(inArray(creditCardBillingRules.householdId, HOUSEHOLDS));
    await transaction
      .delete(creditCards)
      .where(inArray(creditCards.householdId, HOUSEHOLDS));
    await transaction
      .delete(financialEvents)
      .where(inArray(financialEvents.householdId, HOUSEHOLDS));
    await transaction
      .delete(accounts)
      .where(inArray(accounts.householdId, HOUSEHOLDS));
    await transaction
      .delete(households)
      .where(inArray(households.id, HOUSEHOLDS));
  });
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.householdA, name: "T11 forecast A" },
    { id: FIXTURES.householdB, name: "T11 forecast B" },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.cardAccountA,
      householdId: FIXTURES.householdA,
      name: "T11 card A",
      type: "CREDIT_CARD",
    },
    {
      id: FIXTURES.cardAccountB,
      householdId: FIXTURES.householdB,
      name: "T11 card B",
      type: "CREDIT_CARD",
    },
  ]);
  await database.insert(creditCards).values([
    {
      id: FIXTURES.cardA,
      householdId: FIXTURES.householdA,
      accountId: FIXTURES.cardAccountA,
      creditLimitCents: BigInt(100_000),
    },
    {
      id: FIXTURES.cardB,
      householdId: FIXTURES.householdB,
      accountId: FIXTURES.cardAccountB,
      creditLimitCents: BigInt(100_000),
    },
  ]);
  await database.insert(creditCardBillingRules).values([
    {
      id: FIXTURES.ruleA,
      householdId: FIXTURES.householdA,
      cardId: FIXTURES.cardA,
      closingDay: 10,
      dueDay: 20,
      effectiveFrom: "2026-01-01",
      effectiveUntil: null,
    },
    {
      id: FIXTURES.ruleB,
      householdId: FIXTURES.householdB,
      cardId: FIXTURES.cardB,
      closingDay: 10,
      dueDay: 20,
      effectiveFrom: "2026-01-01",
      effectiveUntil: null,
    },
  ]);
}

integration("S07 T11 forecast source PostgreSQL boundaries", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("Defina DATABASE_URL para executar T11_INTEGRATION=1.");
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = dbOrThrow(database);
    await cleanup(db);
    await seed(db);
  });

  afterAll(async () => {
    if (database) await cleanup(database);
    await closeDb();
  });

  it("returns each materialized installment once, sums only posted opening entries, and hides another household", async () => {
    const db = dbOrThrow(database);
    const created = await createCreditCardPurchaseUseCases({
      database: db,
      today: "2026-08-31",
    }).create(contextA, {
      commandId: "t11-purchase-1",
      cardId: FIXTURES.cardA,
      amountCents: "10000",
      occurredOn: "2026-08-09",
      description: "T11 synthetic purchase",
      installmentCount: 3,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const range = { from: "2026-08-01", to: "2026-10-31" } as const;
    const rows = await readForecastInstallmentsForContext(db, contextA, range);

    expect(rows).toHaveLength(3);
    expect(rows.map(({ installment }) => installment.sequence)).toEqual([1, 2, 3]);
    expect(rows.map(({ installment }) => installment.billingCycle)).toEqual([
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
    ]);
    expect(new Set(rows.map(({ installment }) => installment.id)).size).toBe(3);
    expect(rows.every(({ installment }) => installment.householdId === contextA.householdId)).toBe(
      true,
    );
    expect(rows.every(({ entries }) => entries.length === 1)).toBe(true);
    expect(rows.reduce((total, { installment }) => total + installment.amountCents, BigInt(0))).toBe(
      BigInt(10000),
    );

    const opening = await readForecastOpeningBalanceForContext(
      db,
      contextA,
      "2026-09-01",
    );
    expect(opening).toMatchObject({
      householdId: contextA.householdId,
      asOf: "2026-08-31",
      // Only the August due entry is POSTED as of this date. September and
      // October entries remain EXPECTED and cannot affect opening balance.
      openingBalanceCents: "-3334",
    });

    const hidden = await readForecastInstallmentsForContext(db, contextB, range);
    expect(hidden).toEqual([]);

    const persisted = await db
      .select({ id: installments.id })
      .from(installments)
      .where(
        and(
          eq(installments.householdId, contextA.householdId),
          eq(installments.purchaseId, created.value.id),
        ),
      );
    expect(persisted).toHaveLength(3);

    // The complete T04 handoff remains persistence-independent after the
    // reader: the purchase total and transfer are absent, while each
    // materialized installment is represented exactly once.
    const bundle = await readForecastSourcesForContext(db, contextA, range);
    const timeline = buildForecastTimelineFromSources(bundle);
    expect(timeline.totals.outflowCents).toBe("10000");
    expect(timeline.days.flatMap(({ items }) => items)).toHaveLength(3);
    expect(
      timeline.days.flatMap(({ items }) => items).map(({ source }) => source.kind),
    ).toEqual(["INSTALLMENT", "INSTALLMENT", "INSTALLMENT"]);
  });

  it("reconciles one posted recurring fact once when readers expose both source views", async () => {
    const db = dbOrThrow(database);
    await db.insert(recurringRules).values({
      id: FIXTURES.recurringRuleA,
      householdId: contextA.householdId,
      kind: "INCOME",
      amountCents: BigInt(1000),
      description: "T11 recurring income",
      frequency: "MONTHLY",
      dayRule: "FIXED_DAY",
      dayOfMonth: 1,
      startOn: "2026-01-01",
      endOn: null,
      includeInConservativeForecast: true,
    });
    await db.insert(financialEvents).values({
      id: FIXTURES.recurringEventA,
      householdId: contextA.householdId,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(1200),
      occurredOn: "2026-09-12",
      description: "T11 recurring realization",
    });
    await db.insert(accountEntries).values({
      id: FIXTURES.recurringEntryA,
      financialEventId: FIXTURES.recurringEventA,
      accountId: FIXTURES.cardAccountA,
      householdId: contextA.householdId,
      amountCents: BigInt(1200),
      status: "POSTED",
      expectedOn: null,
      postedOn: "2026-09-12",
    });
    await db.insert(recurringOccurrences).values({
      id: FIXTURES.recurringOccurrenceA,
      householdId: contextA.householdId,
      recurringRuleId: FIXTURES.recurringRuleA,
      occurrenceKey: "2026-09",
      status: "POSTED",
      amountCents: BigInt(1000),
      expectedOn: null,
      financialEventId: FIXTURES.recurringEventA,
      isPartial: false,
    });

    const range = { from: "2026-09-01", to: "2026-09-30" } as const;
    const bundle = await readForecastSourcesForContext(db, contextA, range);
    expect(bundle.recurringOccurrences).toHaveLength(1);
    expect(bundle.realizedEvents).toHaveLength(1);

    const timeline = buildForecastTimelineFromSources(bundle);
    const items = timeline.days.flatMap(({ items: dayItems }) => dayItems);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      date: "2026-09-12",
      amountCents: "1200",
      direction: "INFLOW",
      status: "POSTED",
      referenceId: FIXTURES.recurringOccurrenceA,
      source: {
        kind: "RECURRING",
        referenceId: FIXTURES.recurringOccurrenceA,
        occurrenceKey: "2026-09",
      },
    });
    expect(timeline.totals).toMatchObject({
      inflowCents: "1200",
      outflowCents: "0",
      realizedInflowCents: "1200",
      projectedInflowCents: "0",
    });
  });
});
