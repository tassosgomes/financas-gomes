import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

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
} from "@/db/schema";

import { createCreditCardUseCases } from "./use-cases";

const integration =
  process.env.T05_INTEGRATION === "1" || process.env.T08_INTEGRATION === "1"
    ? describe
    : describe.skip;

const FIXTURES = {
  householdA: "00000000-0000-7000-8000-000000070101",
  householdB: "00000000-0000-7000-8000-000000070102",
  cardAccountA: "00000000-0000-7000-8000-000000070111",
  cardAccountB: "00000000-0000-7000-8000-000000070112",
  paymentAccountA: "00000000-0000-7000-8000-000000070113",
  paymentAccountB: "00000000-0000-7000-8000-000000070114",
  cardA: "00000000-0000-7000-8000-000000070121",
  cardB: "00000000-0000-7000-8000-000000070122",
  ruleA: "00000000-0000-7000-8000-000000070131",
  ruleB: "00000000-0000-7000-8000-000000070132",
} as const;

const HOUSEHOLDS = [FIXTURES.householdA, FIXTURES.householdB] as const;

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) throw new Error("Banco de integração S06 não inicializado.");
  return database;
}

async function cleanup(database: Database): Promise<void> {
  await database.delete(applicationCommands).where(inArray(applicationCommands.householdId, HOUSEHOLDS));
  await database.delete(accountEntries).where(inArray(accountEntries.householdId, HOUSEHOLDS));
  await database.delete(financialEvents).where(inArray(financialEvents.householdId, HOUSEHOLDS));
  await database.delete(creditCardBillingRules).where(inArray(creditCardBillingRules.householdId, HOUSEHOLDS));
  await database.delete(creditCards).where(inArray(creditCards.householdId, HOUSEHOLDS));
  await database.delete(accounts).where(inArray(accounts.householdId, HOUSEHOLDS));
  await database.delete(households).where(inArray(households.id, HOUSEHOLDS));
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.householdA, name: "S06 T05/T08 Household A" },
    { id: FIXTURES.householdB, name: "S06 T05/T08 Household B" },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.cardAccountA,
      householdId: FIXTURES.householdA,
      name: "S06 card A",
      type: "CREDIT_CARD",
    },
    {
      id: FIXTURES.cardAccountB,
      householdId: FIXTURES.householdB,
      name: "S06 card B",
      type: "CREDIT_CARD",
    },
    {
      id: FIXTURES.paymentAccountA,
      householdId: FIXTURES.householdA,
      name: "S06 checking A",
      type: "CHECKING",
    },
    {
      id: FIXTURES.paymentAccountB,
      householdId: FIXTURES.householdB,
      name: "S06 checking B",
      type: "CHECKING",
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

integration("S06 T05/T08 card use cases", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL aponta para PostgreSQL descartável.");
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

  it.skipIf(process.env.T05_INTEGRATION !== "1")(
    "creates, retries, updates, versions billing and archives atomically",
    async () => {
      const db = databaseOrThrow(database);
      const useCases = createCreditCardUseCases({ database: db });
      const context = { userId: "s06-t05-user-a", householdId: FIXTURES.householdA };
      const created = await useCases.create(context, {
        commandId: "s06-t05-create",
        name: "Novo cartão T05",
        creditLimitCents: "250000",
        closingDay: 12,
        dueDay: 19,
        defaultPaymentAccountId: FIXTURES.paymentAccountA,
      });
      expect(created).toMatchObject({
        ok: true,
        value: {
          name: "Novo cartão T05",
          creditLimitCents: "250000",
          status: "ACTIVE",
          defaultPaymentAccountId: FIXTURES.paymentAccountA,
        },
      });
      if (!created.ok) return;

      const retry = await useCases.create(context, {
        commandId: "s06-t05-create",
        name: "Novo cartão T05",
        creditLimitCents: "250000",
        closingDay: 12,
        dueDay: 19,
        defaultPaymentAccountId: FIXTURES.paymentAccountA,
      });
      expect(retry).toEqual(created);

      const updated = await useCases.update(context, {
        commandId: "s06-t05-update",
        cardId: created.value.id,
        name: "Novo cartão T05 atualizado",
        creditLimitCents: "300000",
      });
      expect(updated).toMatchObject({
        ok: true,
        value: { name: "Novo cartão T05 atualizado", creditLimitCents: "300000" },
      });

      const billing = await useCases.createBillingRule(context, {
        commandId: "s06-t05-billing",
        cardId: created.value.id,
        closingDay: 15,
        dueDay: 22,
        effectiveFrom: "9999-01-01",
      });
      expect(billing).toMatchObject({ ok: true });
      if (!billing.ok) return;
      expect(billing.value.billingRules).toHaveLength(2);
      expect(billing.value.billingRules[0]?.effectiveUntil).toBe("9999-01-01");
      expect(billing.value.billingRules[1]).toMatchObject({ closingDay: 15, dueDay: 22 });

      const archived = await useCases.archive(context, {
        commandId: "s06-t05-archive",
        cardId: created.value.id,
      });
      expect(archived).toMatchObject({ ok: true, value: { status: "ARCHIVED" } });

      const activeCards = await useCases.list(context, { status: "ACTIVE" });
      const archivedCards = await useCases.list(context, { status: "ARCHIVED" });
      expect(activeCards).toMatchObject({ ok: true, value: { items: [{ id: FIXTURES.cardA, status: "ACTIVE" }] } });
      if (activeCards.ok) {
        expect(activeCards.value.items).toHaveLength(1);
        expect(activeCards.value.items.some((item) => item.id === created.value.id)).toBe(false);
      }
      expect(archivedCards).toMatchObject({ ok: true, value: { items: [{ id: created.value.id, status: "ARCHIVED" }] } });
      const commands = await db
        .select({ commandId: applicationCommands.commandId })
        .from(applicationCommands)
        .where(eq(applicationCommands.householdId, FIXTURES.householdA));
      expect(commands.map((row) => row.commandId).sort()).toEqual([
        "s06-t05-archive",
        "s06-t05-billing",
        "s06-t05-create",
        "s06-t05-update",
      ]);
    },
  );

  it.skipIf(process.env.T05_INTEGRATION !== "1")(
    "keeps invalid payment references closed and isolated",
    async () => {
      const db = databaseOrThrow(database);
      const useCases = createCreditCardUseCases({ database: db });
      const result = await useCases.create(
        { userId: "s06-t05-user-a", householdId: FIXTURES.householdA },
        {
          commandId: "s06-t05-invalid-payment",
          name: "Cartão inválido T05",
          creditLimitCents: "10000",
          closingDay: 10,
          dueDay: 20,
          defaultPaymentAccountId: FIXTURES.cardAccountA,
        },
      );
      expect(result).toMatchObject({ ok: false, error: { code: "PAYMENT_ACCOUNT_INVALID" } });
      const [cards, commands] = await Promise.all([
        db.select({ id: creditCards.id }).from(creditCards).where(eq(creditCards.householdId, FIXTURES.householdA)),
        db.select({ id: applicationCommands.commandId }).from(applicationCommands).where(eq(applicationCommands.commandId, "s06-t05-invalid-payment")),
      ]);
      expect(cards).toHaveLength(1);
      expect(commands).toHaveLength(0);

      const crossTenant = await useCases.get(
        { userId: "s06-t05-user-b", householdId: FIXTURES.householdB },
        { cardId: FIXTURES.cardA },
      );
      expect(crossTenant).toMatchObject({ ok: false, error: { code: "CARD_NOT_FOUND" } });
    },
  );

  it.skipIf(process.env.T08_INTEGRATION !== "1")(
    "writes exactly two payment entries, retries idempotently and isolates households",
    async () => {
      const db = databaseOrThrow(database);
      const useCases = createCreditCardUseCases({ database: db, today: "2026-08-31" });
      const context = { userId: "s06-t08-user-a", householdId: FIXTURES.householdA };
      const command = {
        commandId: "s06-t08-payment",
        cardId: FIXTURES.cardA,
        sourceAccountId: FIXTURES.paymentAccountA,
        amountCents: "5000",
        occurredOn: "2026-08-31",
        description: "S06 synthetic payment",
      };
      const payment = await useCases.createPayment(context, command);
      expect(payment).toMatchObject({ ok: true, value: { amountCents: "5000", entries: [{ installmentId: null }, { installmentId: null }] } });
      if (!payment.ok) return;
      expect(payment.value.entries).toHaveLength(2);
      expect(payment.value.entries.reduce((total, entry) => total + BigInt(entry.amountCents), BigInt(0))).toBe(BigInt(0));

      const retry = await useCases.createPayment(context, { ...command });
      expect(retry).toEqual(payment);
      const mismatch = await useCases.createPayment(context, { ...command, amountCents: "5001" });
      expect(mismatch).toMatchObject({ ok: false, error: { code: "COMMAND_ID_REUSED" } });

      const [events, entries, commands] = await Promise.all([
        db.select({ id: financialEvents.id, kind: financialEvents.kind, amount: financialEvents.amountCents }).from(financialEvents).where(and(eq(financialEvents.householdId, FIXTURES.householdA), eq(financialEvents.id, payment.value.financialEventId))),
        db.select({ amount: accountEntries.amountCents, installmentId: accountEntries.installmentId }).from(accountEntries).where(eq(accountEntries.financialEventId, payment.value.financialEventId)),
        db.select({ commandId: applicationCommands.commandId }).from(applicationCommands).where(eq(applicationCommands.commandId, command.commandId)),
      ]);
      expect(events).toEqual([{ id: payment.value.financialEventId, kind: "TRANSFER", amount: BigInt(5000) }]);
      expect(entries).toHaveLength(2);
      expect(entries.every((entry) => entry.installmentId === null)).toBe(true);
      expect(commands).toHaveLength(1);

      const crossTenant = await useCases.createPayment(
        { userId: "s06-t08-user-b", householdId: FIXTURES.householdB },
        {
          ...command,
          commandId: "s06-t08-cross-tenant",
          sourceAccountId: FIXTURES.paymentAccountB,
        },
      );
      expect(crossTenant).toMatchObject({ ok: false, error: { code: "CARD_NOT_FOUND" } });
    },
  );
});
