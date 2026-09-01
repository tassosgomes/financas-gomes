import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  applicationCommands,
  creditCardBillingRules,
  creditCardPurchases,
  creditCards,
  financialEvents,
  households,
  installmentPlans,
  installments,
} from "@/db/schema";
import { createCreditCardPurchaseUseCases } from "./purchase-use-cases";

const integration =
  process.env.T06_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  householdA: "00000000-0000-7000-8000-000000060601",
  householdB: "00000000-0000-7000-8000-000000060602",
  accountA: "00000000-0000-7000-8000-000000060611",
  accountB: "00000000-0000-7000-8000-000000060612",
  cardA: "00000000-0000-7000-8000-000000060621",
  cardB: "00000000-0000-7000-8000-000000060622",
  ruleA: "00000000-0000-7000-8000-000000060631",
  ruleB: "00000000-0000-7000-8000-000000060632",
} as const;

const HOUSEHOLDS = [FIXTURES.householdA, FIXTURES.householdB] as const;

function dbOrThrow(database: Database | undefined): Database {
  if (!database) throw new Error("Banco T06 não inicializado.");
  return database;
}

async function cleanup(database: Database): Promise<void> {
  await database.transaction(async (transaction) => {
    // Purchase and plan have a deliberately deferred reverse FK. Delete both
    // sides in one transaction so cleanup observes the same aggregate rule as
    // the writer.
    await transaction.execute(sql`set constraints "credit_card_purchases_installment_plan_household_fkey" deferred`);
    await transaction.delete(applicationCommands).where(inArray(applicationCommands.householdId, HOUSEHOLDS));
    await transaction.delete(accountEntries).where(inArray(accountEntries.householdId, HOUSEHOLDS));
    await transaction.delete(installments).where(inArray(installments.householdId, HOUSEHOLDS));
    // The two aggregate parents have opposite RESTRICT FKs. A data-modifying
    // CTE removes the purchase first (the reverse edge is deferred) and then
    // the plan in one statement, satisfying the immediate plan->purchase FK.
    await transaction.execute(sql`with deleted_purchases as (
      delete from credit_card_purchases
       where household_id in (${sql.join(HOUSEHOLDS.map((id) => sql`${id}::uuid`), sql`, `)})
       returning installment_plan_id
    ) delete from installment_plans
       where household_id in (${sql.join(HOUSEHOLDS.map((id) => sql`${id}::uuid`), sql`, `)})`);
    await transaction.delete(creditCardBillingRules).where(inArray(creditCardBillingRules.householdId, HOUSEHOLDS));
    await transaction.delete(creditCards).where(inArray(creditCards.householdId, HOUSEHOLDS));
    await transaction.delete(financialEvents).where(inArray(financialEvents.householdId, HOUSEHOLDS));
    await transaction.delete(accounts).where(inArray(accounts.householdId, HOUSEHOLDS));
    await transaction.delete(households).where(inArray(households.id, HOUSEHOLDS));
  });
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.householdA, name: "T06 purchase A" },
    { id: FIXTURES.householdB, name: "T06 purchase B" },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accountA,
      householdId: FIXTURES.householdA,
      name: "T06 card account A",
      type: "CREDIT_CARD",
    },
    {
      id: FIXTURES.accountB,
      householdId: FIXTURES.householdB,
      name: "T06 card account B",
      type: "CREDIT_CARD",
    },
  ]);
  await database.insert(creditCards).values([
    {
      id: FIXTURES.cardA,
      householdId: FIXTURES.householdA,
      accountId: FIXTURES.accountA,
      creditLimitCents: BigInt(100000),
    },
    {
      id: FIXTURES.cardB,
      householdId: FIXTURES.householdB,
      accountId: FIXTURES.accountB,
      creditLimitCents: BigInt(100000),
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

integration("T06 purchase use case", () => {
  let database: Database | undefined;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL é obrigatório.");
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

  it("creates one PURCHASE event and exactly N snapshot installments/entries", async () => {
    const db = dbOrThrow(database);
    const useCases = createCreditCardPurchaseUseCases({ database: db, today: "2026-08-31" });
    const result = await useCases.create(
      { userId: "t06-user-a", householdId: FIXTURES.householdA },
      {
        commandId: "t06-purchase-1",
        cardId: FIXTURES.cardA,
        amountCents: "10000",
        occurredOn: "2026-08-09",
        description: "T06 synthetic purchase",
        installmentCount: 3,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.installments).toHaveLength(3);
    expect(result.value.installments.map((row) => row.sequence)).toEqual([1, 2, 3]);
    expect(result.value.installments.map((row) => row.amountCents)).toEqual(["3334", "3333", "3333"]);
    expect(result.value.installments.map((row) => row.billingCycle)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(result.value.installments.every((row) => row.billingRuleId === FIXTURES.ruleA)).toBe(true);

    const [eventRows, purchaseRows, planRows, installmentRows, entryRows, commands] = await Promise.all([
      db.select({ id: financialEvents.id, kind: financialEvents.kind, amount: financialEvents.amountCents }).from(financialEvents).where(and(eq(financialEvents.householdId, FIXTURES.householdA), eq(financialEvents.id, result.value.financialEventId))),
      db.select({ id: creditCardPurchases.id }).from(creditCardPurchases).where(eq(creditCardPurchases.id, result.value.id)),
      db.select({ id: installmentPlans.id }).from(installmentPlans).where(eq(installmentPlans.id, result.value.installmentPlanId)),
      db.select({ id: installments.id }).from(installments).where(eq(installments.purchaseId, result.value.id)),
      db.select({ amount: accountEntries.amountCents, installmentId: accountEntries.installmentId }).from(accountEntries).where(eq(accountEntries.financialEventId, result.value.financialEventId)),
      db.select({ commandId: applicationCommands.commandId, result: applicationCommands.result }).from(applicationCommands).where(and(eq(applicationCommands.householdId, FIXTURES.householdA), eq(applicationCommands.commandId, "t06-purchase-1"))),
    ]);
    expect(eventRows).toEqual([{ id: result.value.financialEventId, kind: "PURCHASE", amount: BigInt(10000) }]);
    expect(purchaseRows).toHaveLength(1);
    expect(planRows).toHaveLength(1);
    expect(installmentRows).toHaveLength(3);
    expect(entryRows).toHaveLength(3);
    expect(entryRows.reduce((total, row) => total + row.amount, BigInt(0))).toBe(BigInt(-10000));
    expect(commands).toHaveLength(1);
    expect(commands[0]?.result).toMatchObject({ id: result.value.id, amountCents: "10000" });
  });

  it("returns the original result on retry and rejects incompatible payloads", async () => {
    const db = dbOrThrow(database);
    const useCases = createCreditCardPurchaseUseCases({ database: db, today: "2026-08-31" });
    const context = { userId: "t06-user-a", householdId: FIXTURES.householdA };
    const command = {
      commandId: "t06-purchase-retry",
      cardId: FIXTURES.cardA,
      amountCents: "10001",
      occurredOn: "2026-08-09",
      description: "T06 retry",
      installmentCount: 1,
    };
    const first = await useCases.create(context, command);
    const retry = await useCases.create(context, { ...command });
    const mismatch = await useCases.create(context, { ...command, amountCents: "10002" });
    expect(first).toEqual(retry);
    expect(mismatch).toMatchObject({ ok: false, error: { code: "COMMAND_ID_REUSED" } });
    const events = await db.select({ id: financialEvents.id }).from(financialEvents).where(eq(financialEvents.householdId, FIXTURES.householdA));
    expect(events).toHaveLength(1);
  });

  it("hides a card from another household", async () => {
    const useCases = createCreditCardPurchaseUseCases({ database: dbOrThrow(database), today: "2026-08-31" });
    const result = await useCases.create(
      { userId: "t06-user-b", householdId: FIXTURES.householdB },
      {
        commandId: "t06-cross-tenant",
        cardId: FIXTURES.cardA,
        amountCents: "10000",
        occurredOn: "2026-08-09",
        description: "cross tenant",
        installmentCount: 1,
      },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "CARD_NOT_FOUND" } });
  });

  it("rolls back every effect, including the command, after an entry failure", async () => {
    const db = dbOrThrow(database);
    await db.execute(sql`create or replace function t06_fail_entry() returns trigger
      language plpgsql as $$ begin
        if NEW.account_id = '00000000-0000-7000-8000-000000060611'::uuid then
          raise exception 'T06 injected entry failure';
        end if;
        return NEW;
      end $$`);
    await db.execute(sql`create trigger t06_fail_entry_trigger before insert on account_entries
      for each row execute function t06_fail_entry()`);
    try {
      const useCases = createCreditCardPurchaseUseCases({ database: db, today: "2026-08-31" });
      await expect(
        useCases.create(
          { userId: "t06-user-a", householdId: FIXTURES.householdA },
          {
            commandId: "t06-rollback",
            cardId: FIXTURES.cardA,
            amountCents: "10000",
            occurredOn: "2026-08-09",
            description: "T06 rollback",
            installmentCount: 2,
          },
        ),
      ).rejects.toThrow();
      const [commands, events, purchases, plans, schedule, entries] = await Promise.all([
        db.select({ id: applicationCommands.commandId }).from(applicationCommands).where(eq(applicationCommands.commandId, "t06-rollback")),
        db.select({ id: financialEvents.id }).from(financialEvents).where(eq(financialEvents.householdId, FIXTURES.householdA)),
        db.select({ id: creditCardPurchases.id }).from(creditCardPurchases).where(eq(creditCardPurchases.householdId, FIXTURES.householdA)),
        db.select({ id: installmentPlans.id }).from(installmentPlans).where(eq(installmentPlans.householdId, FIXTURES.householdA)),
        db.select({ id: installments.id }).from(installments).where(eq(installments.householdId, FIXTURES.householdA)),
        db.select({ id: accountEntries.id }).from(accountEntries).where(eq(accountEntries.householdId, FIXTURES.householdA)),
      ]);
      expect(commands).toEqual([]);
      expect(events).toEqual([]);
      expect(purchases).toEqual([]);
      expect(plans).toEqual([]);
      expect(schedule).toEqual([]);
      expect(entries).toEqual([]);
    } finally {
      await db.execute(sql`drop trigger if exists t06_fail_entry_trigger on account_entries`);
      await db.execute(sql`drop function if exists t06_fail_entry()`);
    }
  });
});
