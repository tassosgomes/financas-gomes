import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

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
  installments,
} from "@/db/schema";

import type { CreditCardPurchaseReadModel } from "./contracts";
import { createCreditCardProjectionQueries } from "./projections";
import { createCreditCardUseCases } from "./use-cases";
import { createCreditCardPurchaseUseCases } from "./purchase-use-cases";

const integration = process.env.T09_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  householdA: "00000000-0000-7000-8000-000000090601",
  householdB: "00000000-0000-7000-8000-000000090602",
  cardAccountA: "00000000-0000-7000-8000-000000090611",
  sourceAccountA: "00000000-0000-7000-8000-000000090612",
  cardAccountB: "00000000-0000-7000-8000-000000090613",
  cardA: "00000000-0000-7000-8000-000000090621",
  cardB: "00000000-0000-7000-8000-000000090622",
  ruleA: "00000000-0000-7000-8000-000000090631",
  ruleB: "00000000-0000-7000-8000-000000090632",
} as const;

const HOUSEHOLDS = [FIXTURES.householdA, FIXTURES.householdB] as const;

function dbOrThrow(database: Database | undefined): Database {
  if (!database) throw new Error("Banco T09 não inicializado.");
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
      .delete(accountEntries)
      .where(inArray(accountEntries.householdId, HOUSEHOLDS));
    await transaction
      .delete(installments)
      .where(inArray(installments.householdId, HOUSEHOLDS));
    await transaction.execute(sql`with deleted_purchases as (
      delete from credit_card_purchases
       where household_id in (${sql.join(HOUSEHOLDS.map((id) => sql`${id}::uuid`), sql`, `)})
       returning installment_plan_id
    ) delete from installment_plans
       where household_id in (${sql.join(HOUSEHOLDS.map((id) => sql`${id}::uuid`), sql`, `)})`);
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
    { id: FIXTURES.householdA, name: "T09 maintenance A" },
    { id: FIXTURES.householdB, name: "T09 maintenance B" },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.cardAccountA,
      householdId: FIXTURES.householdA,
      name: "T09 card account A",
      type: "CREDIT_CARD",
    },
    {
      id: FIXTURES.sourceAccountA,
      householdId: FIXTURES.householdA,
      name: "T09 source account A",
      type: "CHECKING",
    },
    {
      id: FIXTURES.cardAccountB,
      householdId: FIXTURES.householdB,
      name: "T09 card account B",
      type: "CREDIT_CARD",
    },
  ]);
  await database.insert(creditCards).values([
    {
      id: FIXTURES.cardA,
      householdId: FIXTURES.householdA,
      accountId: FIXTURES.cardAccountA,
      creditLimitCents: BigInt(100000),
    },
    {
      id: FIXTURES.cardB,
      householdId: FIXTURES.householdB,
      accountId: FIXTURES.cardAccountB,
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

async function createPurchase(
  database: Database,
  commandId: string,
  installmentCount = 3,
): Promise<CreditCardPurchaseReadModel> {
  const result = await createCreditCardPurchaseUseCases({
    database,
    today: "2026-08-31",
  }).create(
    { userId: "t09-user-a", householdId: FIXTURES.householdA },
    {
      commandId,
      cardId: FIXTURES.cardA,
      amountCents: "10000",
      occurredOn: "2026-08-09",
      description: "T09 synthetic purchase",
      installmentCount,
    },
  );
  if (!result.ok) {
    throw new Error(`T09 fixture purchase failed: ${result.error.code}`);
  }
  return result.value;
}

const contextA = {
  userId: "t09-user-a",
  householdId: FIXTURES.householdA,
} as const;

const contextB = {
  userId: "t09-user-b",
  householdId: FIXTURES.householdB,
} as const;

integration("T09 purchase maintenance PostgreSQL", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL é obrigatório para T09_INTEGRATION.");
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

  it("updates only metadata and preserves amount, entries, dates and schedule", async () => {
    const db = dbOrThrow(database);
    const purchase = await createPurchase(db, "t09-update-create");
    const before = await Promise.all([
      db
        .select({
          amountCents: financialEvents.amountCents,
          occurredOn: financialEvents.occurredOn,
          status: financialEvents.status,
          description: financialEvents.description,
        })
        .from(financialEvents)
        .where(eq(financialEvents.id, purchase.financialEventId)),
      db
        .select({
          sequence: installments.sequence,
          amountCents: installments.amountCents,
          billingCycle: installments.billingCycle,
          billingDueOn: installments.billingDueOn,
          status: installments.status,
        })
        .from(installments)
        .where(eq(installments.purchaseId, purchase.id))
        .orderBy(asc(installments.sequence)),
      db
        .select({
          amountCents: accountEntries.amountCents,
          status: accountEntries.status,
          installmentId: accountEntries.installmentId,
          expectedOn: accountEntries.expectedOn,
          postedOn: accountEntries.postedOn,
        })
        .from(accountEntries)
        .where(eq(accountEntries.financialEventId, purchase.financialEventId))
        .orderBy(asc(accountEntries.id)),
    ]);

    const updated = await createCreditCardPurchaseUseCases({
      database: db,
      today: "2026-08-31",
    }).update(contextA, {
      commandId: "t09-update-metadata",
      purchaseId: purchase.id,
      description: "T09 corrected metadata",
    });
    expect(updated).toMatchObject({
      ok: true,
      value: {
        id: purchase.id,
        amountCents: "10000",
        occurredOn: "2026-08-09",
        description: "T09 corrected metadata",
        installmentCount: 3,
        status: "ACTIVE",
      },
    });

    const after = await Promise.all([
      db
        .select({
          amountCents: financialEvents.amountCents,
          occurredOn: financialEvents.occurredOn,
          status: financialEvents.status,
          description: financialEvents.description,
        })
        .from(financialEvents)
        .where(eq(financialEvents.id, purchase.financialEventId)),
      db
        .select({
          sequence: installments.sequence,
          amountCents: installments.amountCents,
          billingCycle: installments.billingCycle,
          billingDueOn: installments.billingDueOn,
          status: installments.status,
        })
        .from(installments)
        .where(eq(installments.purchaseId, purchase.id))
        .orderBy(asc(installments.sequence)),
      db
        .select({
          amountCents: accountEntries.amountCents,
          status: accountEntries.status,
          installmentId: accountEntries.installmentId,
          expectedOn: accountEntries.expectedOn,
          postedOn: accountEntries.postedOn,
        })
        .from(accountEntries)
        .where(eq(accountEntries.financialEventId, purchase.financialEventId))
        .orderBy(asc(accountEntries.id)),
    ]);

    expect(after[0]).toEqual([
      {
        amountCents: BigInt(10000),
        occurredOn: "2026-08-09",
        status: "POSTED",
        description: "T09 corrected metadata",
      },
    ]);
    expect(after[1]).toEqual(
      before[1].map(({ sequence, amountCents, billingCycle, billingDueOn, status }) => ({
        sequence,
        amountCents,
        billingCycle,
        billingDueOn,
        status,
      })),
    );
    expect(after[2]).toEqual(before[2]);
  });

  it("cancels the aggregate once, reverses only the posted entry and removes it from T07", async () => {
    const db = dbOrThrow(database);
    const purchase = await createPurchase(db, "t09-cancel-create");
    const useCases = createCreditCardPurchaseUseCases({
      database: db,
      today: "2026-08-31",
    });
    const cancelled = await useCases.cancel(contextA, {
      commandId: "t09-cancel",
      purchaseId: purchase.id,
    });
    expect(cancelled).toMatchObject({
      ok: true,
      value: {
        id: purchase.id,
        status: "CANCELLED",
        schedule: { status: "CANCELLED", installmentCount: 3 },
      },
    });
    if (!cancelled.ok) return;
    expect(cancelled.value.installments).toHaveLength(3);
    expect(cancelled.value.installments.every((row) => row.status === "CANCELLED")).toBe(true);
    expect(
      cancelled.value.installments.every(
        (row) =>
          row.purchaseId === purchase.id &&
          row.planId === purchase.installmentPlanId &&
          row.entryId.length > 0,
      ),
    ).toBe(true);

    const [events, originalEntries, reversalEntries, schedules, purchases] = await Promise.all([
      db
        .select({
          id: financialEvents.id,
          kind: financialEvents.kind,
          status: financialEvents.status,
          amountCents: financialEvents.amountCents,
          reversalOfEventId: financialEvents.reversalOfEventId,
        })
        .from(financialEvents)
        .where(eq(financialEvents.householdId, FIXTURES.householdA))
        .orderBy(asc(financialEvents.id)),
      db
        .select({
          id: accountEntries.id,
          amountCents: accountEntries.amountCents,
          status: accountEntries.status,
          installmentId: accountEntries.installmentId,
          financialEventId: accountEntries.financialEventId,
        })
        .from(accountEntries)
        .where(
          and(
            eq(accountEntries.householdId, FIXTURES.householdA),
            eq(accountEntries.financialEventId, purchase.financialEventId),
          ),
        )
        .orderBy(asc(accountEntries.id)),
      db
        .select({
          id: accountEntries.id,
          amountCents: accountEntries.amountCents,
          status: accountEntries.status,
          installmentId: accountEntries.installmentId,
          financialEventId: accountEntries.financialEventId,
        })
        .from(accountEntries)
        .innerJoin(
          financialEvents,
          and(
            eq(financialEvents.id, accountEntries.financialEventId),
            eq(financialEvents.householdId, FIXTURES.householdA),
            eq(financialEvents.reversalOfEventId, purchase.financialEventId),
          ),
        )
        .where(eq(accountEntries.householdId, FIXTURES.householdA))
        .orderBy(asc(accountEntries.id)),
      db
        .select({ status: installments.status })
        .from(installments)
        .where(eq(installments.purchaseId, purchase.id)),
      db
        .select({ id: creditCardPurchases.id })
        .from(creditCardPurchases)
        .where(eq(creditCardPurchases.id, purchase.id)),
    ]);

    expect(events).toHaveLength(2);
    expect(events.filter((event) => event.id === purchase.financialEventId)).toEqual([
      {
        id: purchase.financialEventId,
        kind: "PURCHASE",
        status: "CANCELLED",
        amountCents: BigInt(10000),
        reversalOfEventId: null,
      },
    ]);
    const reversals = events.filter((event) => event.reversalOfEventId === purchase.financialEventId);
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({
      kind: "REVERSAL",
      status: "POSTED",
      amountCents: BigInt(3334),
      reversalOfEventId: purchase.financialEventId,
    });
    const postedOriginalEntries = originalEntries.filter((entry) => entry.status === "POSTED");
    expect(postedOriginalEntries).toHaveLength(1);
    expect(reversalEntries).toHaveLength(postedOriginalEntries.length);
    expect(reversalEntries.every((entry) => entry.installmentId === null)).toBe(true);
    expect(reversalEntries.map((entry) => entry.amountCents)).toEqual(
      postedOriginalEntries.map((entry) => -entry.amountCents),
    );
    expect(schedules).toHaveLength(3);
    expect(schedules.every((row) => row.status === "CANCELLED")).toBe(true);
    expect(purchases).toEqual([{ id: purchase.id }]);

    const projection = await createCreditCardProjectionQueries({
      database: db,
      today: "2026-08-31",
    }).get(contextA, { cardId: FIXTURES.cardA, asOf: "2026-08-31" });
    expect(projection.current.items).toHaveLength(0);
    expect(projection.statements.every((statement) => statement.items.length === 0)).toBe(true);
    expect(projection.summary).toMatchObject({
      contractualObligationCents: "0",
      outstandingCardObligationCents: "0",
      committedCreditLimitCents: "0",
      availableCreditLimitCents: "100000",
      currentPostedCardPositionCents: "0",
      cardNetPositionCents: "0",
      cardCreditBalanceCents: "0",
    });
  });

  it("keeps cancellation idempotent, rejects a conflicting command and isolates another household", async () => {
    const db = dbOrThrow(database);
    const useCases = createCreditCardPurchaseUseCases({ database: db, today: "2026-08-31" });
    const purchase = await createPurchase(db, "t09-retry-create");
    const command = {
      commandId: "t09-cancel-retry",
      purchaseId: purchase.id,
    };
    const first = await useCases.cancel(contextA, command);
    const retry = await useCases.cancel(contextA, command);
    expect(first).toEqual(retry);
    const conflict = await useCases.cancel(contextA, {
      commandId: "t09-cancel-conflict",
      purchaseId: purchase.id,
    });
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "PURCHASE_ALREADY_CANCELLED" },
    });

    const crossTenantUpdate = await useCases.update(contextB, {
      commandId: "t09-cross-tenant-update",
      purchaseId: purchase.id,
      description: "must not cross tenant",
    });
    const crossTenantCancel = await useCases.cancel(contextB, {
      commandId: "t09-cross-tenant-cancel",
      purchaseId: purchase.id,
    });
    expect(crossTenantUpdate).toMatchObject({
      ok: false,
      error: { code: "PURCHASE_NOT_FOUND" },
    });
    expect(crossTenantCancel).toMatchObject({
      ok: false,
      error: { code: "PURCHASE_NOT_FOUND" },
    });

    const reversalRows = await db
      .select({ id: financialEvents.id })
      .from(financialEvents)
      .where(
        and(
          eq(financialEvents.householdId, FIXTURES.householdA),
          eq(financialEvents.reversalOfEventId, purchase.financialEventId),
        ),
      );
    expect(reversalRows).toHaveLength(1);
    const commands = await db
      .select({ commandId: applicationCommands.commandId })
      .from(applicationCommands)
      .where(eq(applicationCommands.householdId, FIXTURES.householdB));
    expect(commands).toEqual([]);
  });

  it("serializes concurrent cancellations and creates only one reversal", async () => {
    const db = dbOrThrow(database);
    const useCases = createCreditCardPurchaseUseCases({ database: db, today: "2026-08-31" });
    const purchase = await createPurchase(db, "t09-race-create");
    const [left, right] = await Promise.all([
      useCases.cancel(contextA, {
        commandId: "t09-race-left",
        purchaseId: purchase.id,
      }),
      useCases.cancel(contextA, {
        commandId: "t09-race-right",
        purchaseId: purchase.id,
      }),
    ]);
    const outcomes = [left, right];
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toHaveLength(1);
    expect(outcomes.find((outcome) => !outcome.ok)).toMatchObject({
      ok: false,
      error: { code: "PURCHASE_ALREADY_CANCELLED" },
    });
    const reversals = await db
      .select({ id: financialEvents.id })
      .from(financialEvents)
      .where(
        and(
          eq(financialEvents.householdId, FIXTURES.householdA),
          eq(financialEvents.reversalOfEventId, purchase.financialEventId),
        ),
      );
    expect(reversals).toHaveLength(1);
  });

  it("rolls back command, reversal and statuses when reversal entry insertion fails", async () => {
    const db = dbOrThrow(database);
    const purchase = await createPurchase(db, "t09-rollback-create");
    await db.execute(sql`drop trigger if exists t09_fail_reversal_entry_trigger on account_entries`);
    await db.execute(sql`create or replace function t09_fail_reversal_entry() returns trigger
      language plpgsql as $$ begin
        if NEW.amount_cents > 0 and NEW.installment_id is null then
          raise exception 'T09 injected reversal entry failure';
        end if;
        return NEW;
      end $$`);
    await db.execute(sql`create trigger t09_fail_reversal_entry_trigger before insert on account_entries
      for each row execute function t09_fail_reversal_entry()`);
    try {
      const useCases = createCreditCardPurchaseUseCases({ database: db, today: "2026-08-31" });
      await expect(
        useCases.cancel(contextA, {
          commandId: "t09-rollback-cancel",
          purchaseId: purchase.id,
        }),
      ).rejects.toThrow();

      const [commands, events, schedule, entries] = await Promise.all([
        db
          .select({ commandId: applicationCommands.commandId })
          .from(applicationCommands)
          .where(eq(applicationCommands.commandId, "t09-rollback-cancel")),
        db
          .select({ id: financialEvents.id, kind: financialEvents.kind, status: financialEvents.status })
          .from(financialEvents)
          .where(eq(financialEvents.householdId, FIXTURES.householdA)),
        db
          .select({ status: installments.status })
          .from(installments)
          .where(eq(installments.purchaseId, purchase.id)),
        db
          .select({ id: accountEntries.id, financialEventId: accountEntries.financialEventId })
          .from(accountEntries)
          .where(eq(accountEntries.householdId, FIXTURES.householdA)),
      ]);
      expect(commands).toEqual([]);
      expect(events).toEqual([
        { id: purchase.financialEventId, kind: "PURCHASE", status: "POSTED" },
      ]);
      expect(schedule).toHaveLength(3);
      expect(schedule.every((row) => row.status === "PLANNED")).toBe(true);
      expect(entries).toHaveLength(3);
      expect(entries.every((entry) => entry.financialEventId === purchase.financialEventId)).toBe(true);
    } finally {
      await db.execute(sql`drop trigger if exists t09_fail_reversal_entry_trigger on account_entries`);
      await db.execute(sql`drop function if exists t09_fail_reversal_entry()`);
    }
  });

  it("preserves a prior global payment while cancellation leaves only card credit in T07", async () => {
    const db = dbOrThrow(database);
    const purchase = await createPurchase(db, "t09-payment-purchase");
    const cards = createCreditCardUseCases({ database: db, today: "2026-08-31" });
    const payment = await cards.createPayment(contextA, {
      commandId: "t09-prior-payment",
      cardId: FIXTURES.cardA,
      sourceAccountId: FIXTURES.sourceAccountA,
      amountCents: "2000",
      occurredOn: "2026-08-31",
      description: "T09 synthetic prior payment",
    });
    expect(payment).toMatchObject({ ok: true, value: { amountCents: "2000" } });

    const cancelled = await createCreditCardPurchaseUseCases({
      database: db,
      today: "2026-08-31",
    }).cancel(contextA, {
      commandId: "t09-payment-cancel",
      purchaseId: purchase.id,
    });
    expect(cancelled).toMatchObject({ ok: true, value: { status: "CANCELLED" } });

    const paymentEvents = await db
      .select({ kind: financialEvents.kind, status: financialEvents.status, amountCents: financialEvents.amountCents })
      .from(financialEvents)
      .where(
        and(
          eq(financialEvents.householdId, FIXTURES.householdA),
          eq(financialEvents.kind, "TRANSFER"),
        ),
      );
    expect(paymentEvents).toEqual([
      { kind: "TRANSFER", status: "POSTED", amountCents: BigInt(2000) },
    ]);
    const paymentEntries = await db
      .select({ installmentId: accountEntries.installmentId, amountCents: accountEntries.amountCents })
      .from(accountEntries)
      .innerJoin(
        financialEvents,
        and(
          eq(financialEvents.id, accountEntries.financialEventId),
          eq(financialEvents.kind, "TRANSFER"),
          eq(financialEvents.householdId, FIXTURES.householdA),
        ),
      )
      .where(eq(accountEntries.householdId, FIXTURES.householdA));
    expect(paymentEntries).toHaveLength(2);
    expect(paymentEntries.every((entry) => entry.installmentId === null)).toBe(true);
    expect(paymentEntries.reduce((sum, entry) => sum + entry.amountCents, BigInt(0))).toBe(BigInt(0));

    const projection = await createCreditCardProjectionQueries({
      database: db,
      today: "2026-08-31",
    }).get(contextA, { cardId: FIXTURES.cardA, asOf: "2026-08-31" });
    expect(projection.summary).toMatchObject({
      contractualObligationCents: "0",
      outstandingCardObligationCents: "0",
      cardCreditBalanceCents: "2000",
      currentPostedCardPositionCents: "2000",
      cardNetPositionCents: "2000",
      paymentState: "CREDIT",
    });
  });
});
