import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

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
} from "@/db/schema";

import { createCreditCardUseCases } from "./use-cases";
import { createCreditCardPurchaseUseCases } from "./purchase-use-cases";
import { createCreditCardProjectionQueries } from "./projections";

const integration = process.env.T07_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  householdA: "00000000-0000-7000-8000-000000070601",
  householdB: "00000000-0000-7000-8000-000000070602",
  cardAccountA: "00000000-0000-7000-8000-000000070611",
  sourceAccountA: "00000000-0000-7000-8000-000000070612",
  cardAccountB: "00000000-0000-7000-8000-000000070613",
  cardA: "00000000-0000-7000-8000-000000070621",
  cardB: "00000000-0000-7000-8000-000000070622",
  ruleA: "00000000-0000-7000-8000-000000070631",
  ruleB: "00000000-0000-7000-8000-000000070632",
} as const;

const HOUSEHOLDS = [FIXTURES.householdA, FIXTURES.householdB] as const;

function dbOrThrow(database: Database | undefined): Database {
  if (!database) throw new Error("Banco T07 não inicializado.");
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
    { id: FIXTURES.householdA, name: "T07 projection A" },
    { id: FIXTURES.householdB, name: "T07 projection B" },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.cardAccountA,
      householdId: FIXTURES.householdA,
      name: "T07 card account A",
      type: "CREDIT_CARD",
    },
    {
      id: FIXTURES.sourceAccountA,
      householdId: FIXTURES.householdA,
      name: "T07 source account A",
      type: "CHECKING",
    },
    {
      id: FIXTURES.cardAccountB,
      householdId: FIXTURES.householdB,
      name: "T07 card account B",
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

integration("T07 credit-card projections", () => {
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

  async function createPurchase(): Promise<void> {
    const result = await createCreditCardPurchaseUseCases({
      database: dbOrThrow(database),
      today: "2026-08-31",
    }).create(
      { userId: "t07-user-a", householdId: FIXTURES.householdA },
      {
        commandId: "t07-purchase",
        cardId: FIXTURES.cardA,
        amountCents: "10000",
        occurredOn: "2026-08-09",
        description: "T07 synthetic purchase",
        installmentCount: 3,
      },
    );
    expect(result.ok).toBe(true);
  }

  it("projects one row per installment and keeps event total out of invoice sums", async () => {
    await createPurchase();
    const projection = await createCreditCardProjectionQueries({
      database: dbOrThrow(database),
      today: "2026-08-31",
    }).get(
      { userId: "t07-user-a", householdId: FIXTURES.householdA },
      { cardId: FIXTURES.cardA, asOf: "2026-08-31" },
    );

    expect(projection.current.period).toBe("2026-08");
    expect(projection.current.items).toHaveLength(1);
    expect(projection.current.items[0]).toMatchObject({
      referenceId: expect.any(String),
      amountCents: "3334",
      state: "CONFIRMED",
      origin: "PURCHASE",
    });
    expect(projection.next?.period).toBe("2026-09");
    expect(projection.summary).toMatchObject({
      currentStatementAmountCents: "3334",
      projectedStatementAmountCents: "6666",
      contractualObligationCents: "10000",
      remainingFutureInstallmentsCents: "6666",
      outstandingCardObligationCents: "10000",
      committedCreditLimitCents: "10000",
      availableCreditLimitCents: "90000",
      currentPostedCardPositionCents: "-3334",
      cardNetPositionCents: "-10000",
      cardCreditBalanceCents: "0",
    });
    expect(projection.statements.flatMap((statement) => statement.items)).toHaveLength(3);
    expect(projection.statements.reduce((sum, statement) => sum + BigInt(statement.totalAmountCents), BigInt(0))).toBe(BigInt(10000));
  });

  it("derives global partial payment state without changing installment status", async () => {
    await createPurchase();
    const payment = await createCreditCardUseCases({
      database: dbOrThrow(database),
      today: "2026-08-31",
    }).createPayment(
      { userId: "t07-user-a", householdId: FIXTURES.householdA },
      {
        commandId: "t07-payment-partial",
        cardId: FIXTURES.cardA,
        sourceAccountId: FIXTURES.sourceAccountA,
        amountCents: "3334",
        occurredOn: "2026-08-31",
      },
    );
    expect(payment.ok).toBe(true);
    const projection = await createCreditCardProjectionQueries({
      database: dbOrThrow(database),
      today: "2026-08-31",
    }).get(
      { userId: "t07-user-a", householdId: FIXTURES.householdA },
      { cardId: FIXTURES.cardA, asOf: "2026-08-31" },
    );
    expect(projection.current.payment).toMatchObject({
      state: "PAID",
      statementAmountCents: "3334",
      paidAmountCents: "3334",
      remainingAmountCents: "0",
    });
    expect(projection.summary).toMatchObject({
      paymentState: "PARTIALLY_PAID",
      outstandingCardObligationCents: "6666",
      cardCreditBalanceCents: "0",
      availableCreditLimitCents: "93334",
    });
    const planned = await dbOrThrow(database)
      .select({ status: installments.status })
      .from(installments)
      .where(eq(installments.householdId, FIXTURES.householdA));
    expect(planned.every((row) => row.status === "PLANNED")).toBe(true);
  });

  it("allows overpayment as separate credit and keeps contractual limit bounded", async () => {
    await createPurchase();
    const payment = await createCreditCardUseCases({
      database: dbOrThrow(database),
      today: "2026-08-31",
    }).createPayment(
      { userId: "t07-user-a", householdId: FIXTURES.householdA },
      {
        commandId: "t07-payment-over",
        cardId: FIXTURES.cardA,
        sourceAccountId: FIXTURES.sourceAccountA,
        amountCents: "12000",
        occurredOn: "2026-08-31",
      },
    );
    expect(payment.ok).toBe(true);
    const projection = await createCreditCardProjectionQueries({
      database: dbOrThrow(database),
      today: "2026-08-31",
    }).get(
      { userId: "t07-user-a", householdId: FIXTURES.householdA },
      { cardId: FIXTURES.cardA, asOf: "2026-08-31" },
    );
    expect(projection.summary).toMatchObject({
      paymentState: "CREDIT",
      outstandingCardObligationCents: "0",
      committedCreditLimitCents: "0",
      availableCreditLimitCents: "100000",
      cardCreditBalanceCents: "2000",
    });
  });

  it("returns no data for a cross-household card and supports an empty year-turn period", async () => {
    await createPurchase();
    const queries = createCreditCardProjectionQueries({
      database: dbOrThrow(database),
      today: "2026-08-31",
    });
    await expect(
      queries.get(
        { userId: "t07-user-b", householdId: FIXTURES.householdB },
        { cardId: FIXTURES.cardA, asOf: "2026-08-31" },
      ),
    ).rejects.toMatchObject({ code: "CARD_NOT_FOUND" });
    const empty = await queries.statement(
      { userId: "t07-user-a", householdId: FIXTURES.householdA },
      { cardId: FIXTURES.cardA, period: "2027-01", asOf: "2026-08-31" },
    );
    expect(empty).toMatchObject({
      period: "2027-01",
      totalAmountCents: "0",
      items: [],
    });
  });
});
