import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations, getMigrationStatus } from "@/db/migrate";
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

/** T02 uses the disposable PostgreSQL target only when explicitly enabled. */
const integration =
  process.env.T02_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  households: {
    a: "00000000-0000-7000-8000-000000061101",
    b: "00000000-0000-7000-8000-000000061102",
  },
  accounts: {
    cardA: "00000000-0000-7000-8000-000000062101",
    cardB: "00000000-0000-7000-8000-000000062102",
    checkingA: "00000000-0000-7000-8000-000000062103",
    checkingB: "00000000-0000-7000-8000-000000062104",
  },
  cards: {
    a: "00000000-0000-7000-8000-000000063101",
    b: "00000000-0000-7000-8000-000000063102",
    invalidType: "00000000-0000-7000-8000-000000063103",
    duplicateAccount: "00000000-0000-7000-8000-000000063104",
  },
  rules: {
    aJan: "00000000-0000-7000-8000-000000064101",
    aApr: "00000000-0000-7000-8000-000000064102",
    aJul: "00000000-0000-7000-8000-000000064103",
    aOverlap: "00000000-0000-7000-8000-000000064104",
    bJan: "00000000-0000-7000-8000-000000064105",
    crossTenant: "00000000-0000-7000-8000-000000064106",
    invalid: "00000000-0000-7000-8000-000000064107",
  },
  events: {
    a: "00000000-0000-7000-8000-000000065101",
    b: "00000000-0000-7000-8000-000000065102",
    rollback: "00000000-0000-7000-8000-000000065103",
    invalid: "00000000-0000-7000-8000-000000065104",
  },
  entries: {
    a: "00000000-0000-7000-8000-000000066101",
    crossTenant: "00000000-0000-7000-8000-000000066102",
    rollback: "00000000-0000-7000-8000-000000066103",
    invalid: "00000000-0000-7000-8000-000000066104",
  },
  plans: {
    a: "00000000-0000-7000-8000-000000067101",
    invalid: "00000000-0000-7000-8000-000000067199",
    b: "00000000-0000-7000-8000-000000067102",
  },
  purchases: {
    a: "00000000-0000-7000-8000-000000069101",
    b: "00000000-0000-7000-8000-000000069102",
    invalidPlan: "00000000-0000-7000-8000-000000069103",
  },
  installments: {
    a1: "00000000-0000-7000-8000-000000068101",
    a2: "00000000-0000-7000-8000-000000068102",
    invalid: "00000000-0000-7000-8000-000000068199",
  },
} as const;

const HOUSEHOLD_IDS = [
  FIXTURES.households.a,
  FIXTURES.households.b,
] as const;

const COMPOSITE_FK_NAMES = [
  "credit_cards_account_household_fkey",
  "credit_cards_default_payment_account_household_fkey",
  "credit_card_billing_rules_card_household_fkey",
  "credit_card_purchases_card_household_fkey",
  "credit_card_purchases_event_household_fkey",
  "credit_card_purchases_installment_plan_household_fkey",
  "installment_plans_purchase_household_fkey",
  "installments_plan_household_fkey",
  "installments_plan_purchase_household_fkey",
  "installments_purchase_household_fkey",
  "installments_billing_rule_household_fkey",
  "account_entries_financial_event_household_fkey",
  "account_entries_account_household_fkey",
  "account_entries_installment_household_fkey",
] as const;

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T02 não foi inicializado.");
  }
  return database;
}

function postgresErrorCode(error: unknown): string | undefined {
  let candidate: unknown = error;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "code" in candidate &&
      typeof (candidate as { code?: unknown }).code === "string"
    ) {
      return (candidate as { code: string }).code;
    }

    if (
      !candidate ||
      typeof candidate !== "object" ||
      !("cause" in candidate)
    ) {
      return undefined;
    }

    candidate = (candidate as { cause?: unknown }).cause;
  }

  return undefined;
}

function ruleValues(
  id: string,
  householdId: string,
  cardId: string,
  effectiveFrom: string,
  effectiveUntil: string | null,
) {
  return {
    id,
    householdId,
    cardId,
    closingDay: 10,
    dueDay: 20,
    effectiveFrom,
    effectiveUntil,
  };
}

async function cleanup(database: Database): Promise<void> {
  await database
    .delete(applicationCommands)
    .where(inArray(applicationCommands.householdId, HOUSEHOLD_IDS));
  await database
    .delete(accountEntries)
    .where(inArray(accountEntries.householdId, HOUSEHOLD_IDS));
  await database
    .delete(installments)
    .where(inArray(installments.householdId, HOUSEHOLD_IDS));
  await database
    .delete(installmentPlans)
    .where(inArray(installmentPlans.householdId, HOUSEHOLD_IDS));
  await database
    .delete(creditCardPurchases)
    .where(inArray(creditCardPurchases.householdId, HOUSEHOLD_IDS));
  await database
    .delete(creditCardBillingRules)
    .where(inArray(creditCardBillingRules.householdId, HOUSEHOLD_IDS));
  await database
    .delete(creditCards)
    .where(inArray(creditCards.householdId, HOUSEHOLD_IDS));
  await database
    .delete(financialEvents)
    .where(inArray(financialEvents.householdId, HOUSEHOLD_IDS));
  await database
    .delete(accounts)
    .where(inArray(accounts.householdId, HOUSEHOLD_IDS));
  await database.delete(households).where(inArray(households.id, HOUSEHOLD_IDS));
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T02-F Household A" },
    { id: FIXTURES.households.b, name: "T02-F Household B" },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accounts.cardA,
      householdId: FIXTURES.households.a,
      name: "T02-F Card Account A",
      type: "CREDIT_CARD",
    },
    {
      id: FIXTURES.accounts.checkingA,
      householdId: FIXTURES.households.a,
      name: "T02-F Checking A",
      type: "CHECKING",
    },
    {
      id: FIXTURES.accounts.cardB,
      householdId: FIXTURES.households.b,
      name: "T02-F Card Account B",
      type: "CREDIT_CARD",
    },
    {
      id: FIXTURES.accounts.checkingB,
      householdId: FIXTURES.households.b,
      name: "T02-F Checking B",
      type: "CHECKING",
    },
  ]);
  await database.insert(creditCards).values([
    {
      id: FIXTURES.cards.a,
      householdId: FIXTURES.households.a,
      accountId: FIXTURES.accounts.cardA,
      creditLimitCents: BigInt(100_000),
    },
    {
      id: FIXTURES.cards.b,
      householdId: FIXTURES.households.b,
      accountId: FIXTURES.accounts.cardB,
      creditLimitCents: BigInt(100_000),
    },
  ]);
}

integration("T02-F PostgreSQL billing and integrity boundaries", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar T02_INTEGRATION=1.",
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
    if (database) {
      await cleanup(database);
    }
    await closeDb();
  });

  it("applies migration and rejects overlapping rules only for the same card", async () => {
    const db = databaseOrThrow(database);
    const status = await getMigrationStatus();
    expect(status).toMatchObject({ pending: 0, drifted: 0 });

    const extension = await db.execute<{ extname: string }>(sql`
      select extname
        from pg_catalog.pg_extension
       where extname = 'btree_gist'
    `);
    expect(extension.rows).toEqual([{ extname: "btree_gist" }]);

    const exclusion = await db.execute<{
      conname: string;
      contype: string;
      definition: string;
    }>(sql`
      select conname,
             contype,
             pg_get_constraintdef(oid) as definition
        from pg_catalog.pg_constraint
       where conrelid = 'public.credit_card_billing_rules'::regclass
         and conname = 'credit_card_billing_rules_no_overlap_excl'
    `);
    expect(exclusion.rows).toHaveLength(1);
    expect(exclusion.rows[0]).toMatchObject({
      conname: "credit_card_billing_rules_no_overlap_excl",
      contype: "x",
    });
    expect(exclusion.rows[0]?.definition).toContain("daterange");
    expect(exclusion.rows[0]?.definition).toContain("&&");

    await db.insert(creditCardBillingRules).values([
      ruleValues(
        FIXTURES.rules.aJan,
        FIXTURES.households.a,
        FIXTURES.cards.a,
        "2026-01-01",
        "2026-04-01",
      ),
      ruleValues(
        FIXTURES.rules.aApr,
        FIXTURES.households.a,
        FIXTURES.cards.a,
        "2026-04-01",
        "2026-07-01",
      ),
      ruleValues(
        FIXTURES.rules.aJul,
        FIXTURES.households.a,
        FIXTURES.cards.a,
        "2026-07-01",
        null,
      ),
      // A different card may use an overlapping calendar interval.
      ruleValues(
        FIXTURES.rules.bJan,
        FIXTURES.households.b,
        FIXTURES.cards.b,
        "2026-01-01",
        "2026-04-01",
      ),
    ]);

    await expect(
      db.insert(creditCardBillingRules).values(
        ruleValues(
          FIXTURES.rules.aOverlap,
          FIXTURES.households.a,
          FIXTURES.cards.a,
          "2026-06-01",
          "2026-08-01",
        ),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23P01",
    );

    const persisted = await db
      .select({ id: creditCardBillingRules.id })
      .from(creditCardBillingRules)
      // Keep this assertion tenant-scoped so rows left by another fixture or
      // a previous disposable-db run cannot affect T02-F's four-row invariant.
      .where(inArray(creditCardBillingRules.householdId, HOUSEHOLD_IDS))
      .orderBy(creditCardBillingRules.id);
    expect(persisted.map(({ id }) => id)).toEqual([
      FIXTURES.rules.aJan,
      FIXTURES.rules.aApr,
      FIXTURES.rules.aJul,
      FIXTURES.rules.bJan,
    ].sort());
  });

  it("materializes a tenant-safe purchase/plan/schedule graph and keeps it restrictive", async () => {
    const db = databaseOrThrow(database);
    const rollback = new Error("T02-F aggregate probe rollback");

    await expect(
      db.transaction(async (transaction) => {
        await transaction.insert(creditCardBillingRules).values(
          ruleValues(
            FIXTURES.rules.aJan,
            FIXTURES.households.a,
            FIXTURES.cards.a,
            "2026-01-01",
            null,
          ),
        );
        await transaction.insert(financialEvents).values({
          id: FIXTURES.events.a,
          householdId: FIXTURES.households.a,
          kind: "PURCHASE",
          status: "POSTED",
          origin: "MANUAL",
          amountCents: BigInt(10_000),
          occurredOn: "2026-08-09",
          description: "T02-F valid aggregate",
        });

        // The reverse FK is deferred, so purchase then plan is a valid
        // aggregate write while both sides remain mandatory at commit.
        await transaction.insert(creditCardPurchases).values({
          id: FIXTURES.purchases.a,
          householdId: FIXTURES.households.a,
          cardId: FIXTURES.cards.a,
          financialEventId: FIXTURES.events.a,
          installmentPlanId: FIXTURES.plans.a,
        });
        await transaction.insert(installmentPlans).values({
          id: FIXTURES.plans.a,
          householdId: FIXTURES.households.a,
          purchaseId: FIXTURES.purchases.a,
          totalAmountCents: BigInt(10_000),
          installmentCount: 2,
        });
        await transaction.insert(installments).values([
          {
            id: FIXTURES.installments.a1,
            householdId: FIXTURES.households.a,
            planId: FIXTURES.plans.a,
            purchaseId: FIXTURES.purchases.a,
            sequence: 1,
            amountCents: BigInt(5_001),
            status: "PLANNED",
            billingRuleId: FIXTURES.rules.aJan,
            billingCycle: "2026-08-01",
            billingClosingDay: 10,
            billingDueDay: 20,
            billingClosingOn: "2026-08-10",
            billingDueOn: "2026-08-20",
          },
          {
            id: FIXTURES.installments.a2,
            householdId: FIXTURES.households.a,
            planId: FIXTURES.plans.a,
            purchaseId: FIXTURES.purchases.a,
            sequence: 2,
            amountCents: BigInt(4_999),
            status: "PLANNED",
            billingRuleId: FIXTURES.rules.aJan,
            billingCycle: "2026-09-01",
            billingClosingDay: 10,
            billingDueDay: 20,
            billingClosingOn: "2026-09-10",
            billingDueOn: "2026-09-20",
          },
        ]);
        await transaction.insert(accountEntries).values({
          id: FIXTURES.entries.a,
          financialEventId: FIXTURES.events.a,
          installmentId: FIXTURES.installments.a1,
          accountId: FIXTURES.accounts.cardA,
          householdId: FIXTURES.households.a,
          amountCents: BigInt(-5_001),
          status: "EXPECTED",
          expectedOn: "2026-08-10",
        });

        await expect(
          transaction.transaction(async (nested) => {
            await nested.insert(installments).values({
              id: FIXTURES.installments.invalid,
              householdId: FIXTURES.households.a,
              planId: FIXTURES.plans.a,
              purchaseId: FIXTURES.purchases.a,
              sequence: 1,
              amountCents: BigInt(5_000),
              status: "PLANNED",
              billingRuleId: FIXTURES.rules.aJan,
              billingCycle: "2026-10-01",
              billingClosingDay: 10,
              billingDueDay: 20,
              billingClosingOn: "2026-10-10",
              billingDueOn: "2026-10-20",
            });
          }),
        ).rejects.toSatisfy(
          (error: unknown) => postgresErrorCode(error) === "23505",
        );

        await expect(
          transaction.transaction(async (nested) => {
            await nested.insert(installments).values({
              id: "00000000-0000-7000-8000-000000068198",
              householdId: FIXTURES.households.a,
              planId: FIXTURES.plans.a,
              purchaseId: FIXTURES.purchases.a,
              sequence: 3,
              amountCents: BigInt(1),
              status: "PLANNED",
              billingRuleId: FIXTURES.rules.aJan,
              billingCycle: "2026-10-01",
              billingClosingDay: 10,
              billingDueDay: 20,
              billingClosingOn: "2026-10-10",
              billingDueOn: "2026-10-09",
              billingDueOnOverride: "2026-10-20",
            });
          }),
        ).rejects.toSatisfy(
          (error: unknown) => postgresErrorCode(error) === "23514",
        );

        await expect(
          transaction.transaction(async (nested) => {
            await nested.insert(installmentPlans).values({
              id: FIXTURES.plans.b,
              householdId: FIXTURES.households.a,
              purchaseId: FIXTURES.purchases.a,
              totalAmountCents: BigInt(9_999),
              installmentCount: 2,
            });
          }),
        ).rejects.toSatisfy(
          (error: unknown) => postgresErrorCode(error) === "23514",
        );

        await expect(
          transaction.transaction(async (nested) => {
            await nested.delete(installmentPlans).where(eq(installmentPlans.id, FIXTURES.plans.a));
          }),
        ).rejects.toSatisfy(
          (error: unknown) => postgresErrorCode(error) === "23503",
        );

        await expect(
          transaction.transaction(async (nested) => {
            await nested.delete(creditCardPurchases).where(eq(creditCardPurchases.id, FIXTURES.purchases.a));
          }),
        ).rejects.toSatisfy(
          (error: unknown) => postgresErrorCode(error) === "23503",
        );

        const aggregate = await transaction
          .select({
            eventAmount: financialEvents.amountCents,
            planAmount: installmentPlans.totalAmountCents,
            installmentAmount: sql<string>`sum(${installments.amountCents})::text`,
            installmentCount: sql<string>`count(*)::text`,
          })
          .from(creditCardPurchases)
          .innerJoin(
            financialEvents,
            and(
              eq(financialEvents.id, creditCardPurchases.financialEventId),
              eq(financialEvents.householdId, creditCardPurchases.householdId),
            ),
          )
          .innerJoin(
            installmentPlans,
            and(
              eq(installmentPlans.id, creditCardPurchases.installmentPlanId),
              eq(installmentPlans.householdId, creditCardPurchases.householdId),
            ),
          )
          .innerJoin(
            installments,
            and(
              eq(installments.planId, installmentPlans.id),
              eq(installments.householdId, installmentPlans.householdId),
            ),
          )
          .where(eq(creditCardPurchases.id, FIXTURES.purchases.a))
          .groupBy(financialEvents.amountCents, installmentPlans.totalAmountCents);
        expect(aggregate).toEqual([
          {
            eventAmount: BigInt(10_000),
            planAmount: BigInt(10_000),
            installmentAmount: "10000",
            installmentCount: "2",
          },
        ]);

        throw rollback;
      }),
    ).rejects.toBe(rollback);

    // A deferred reverse FK is checked at the boundary of its own writer
    // transaction; a missing plan therefore fails the top-level insert.
    await expect(
      db.transaction(async (transaction) => {
        await transaction.insert(financialEvents).values({
          id: FIXTURES.events.a,
          householdId: FIXTURES.households.a,
          kind: "PURCHASE",
          status: "POSTED",
          origin: "MANUAL",
          amountCents: BigInt(10_000),
          occurredOn: "2026-08-09",
          description: "T02-F invalid reverse FK event",
        });
        await transaction.insert(creditCardPurchases).values({
          id: FIXTURES.purchases.invalidPlan,
          householdId: FIXTURES.households.a,
          cardId: FIXTURES.cards.a,
          financialEventId: FIXTURES.events.a,
          installmentPlanId: FIXTURES.plans.b,
        });
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );
  });

  it("proves cross-tenant FKs, account specialization and restrictive history", async () => {
    const db = databaseOrThrow(database);
    await db.insert(creditCardBillingRules).values(
      ruleValues(
        FIXTURES.rules.aJan,
        FIXTURES.households.a,
        FIXTURES.cards.a,
        "2026-01-01",
        null,
      ),
    );

    const foreignKeys = await db.execute<{
      conname: string;
      confdeltype: string;
      columnCount: number;
    }>(sql`
      select c.conname,
             c.confdeltype,
             cardinality(c.conkey)::integer as "columnCount"
        from pg_catalog.pg_constraint c
       where c.contype = 'f'
         and c.conname in (${sql.join(
           COMPOSITE_FK_NAMES.map((name) => sql`${name}`),
           sql`, `,
         )})
       order by c.conname
    `);
    expect(foreignKeys.rows).toHaveLength(COMPOSITE_FK_NAMES.length);
    expect(
      foreignKeys.rows.every(
        ({ confdeltype, columnCount }) =>
          confdeltype === "r" && (columnCount === 2 || columnCount === 3),
      ),
    ).toBe(true);

    await expect(
      db.insert(creditCardBillingRules).values(
        ruleValues(
          FIXTURES.rules.crossTenant,
          FIXTURES.households.a,
          FIXTURES.cards.b,
          "2027-01-01",
          null,
        ),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );

    await expect(
      db.insert(creditCards).values({
        id: FIXTURES.cards.invalidType,
        householdId: FIXTURES.households.a,
        accountId: FIXTURES.accounts.checkingA,
        creditLimitCents: BigInt(100_000),
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );

    await expect(
      db
        .update(accounts)
        .set({ type: "CHECKING" })
        .where(eq(accounts.id, FIXTURES.accounts.cardA)),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );

    await expect(
      db.insert(creditCards).values({
        id: FIXTURES.cards.duplicateAccount,
        householdId: FIXTURES.households.a,
        accountId: FIXTURES.accounts.cardA,
        creditLimitCents: BigInt(100_000),
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23505",
    );

    await expect(
      db
        .update(creditCards)
        .set({ defaultPaymentAccountId: FIXTURES.accounts.cardA })
        .where(eq(creditCards.id, FIXTURES.cards.a)),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );

    await db.insert(financialEvents).values([
      {
        id: FIXTURES.events.a,
        householdId: FIXTURES.households.a,
        kind: "PURCHASE",
        status: "POSTED",
        origin: "MANUAL",
        amountCents: BigInt(1_000),
        occurredOn: "2026-08-30",
        description: "T02-F cross tenant event A",
      },
      {
        id: FIXTURES.events.b,
        householdId: FIXTURES.households.b,
        kind: "PURCHASE",
        status: "POSTED",
        origin: "MANUAL",
        amountCents: BigInt(1_000),
        occurredOn: "2026-08-30",
        description: "T02-F cross tenant event B",
      },
      {
        id: FIXTURES.events.invalid,
        householdId: FIXTURES.households.a,
        kind: "EXPENSE",
        status: "POSTED",
        origin: "MANUAL",
        amountCents: BigInt(1_000),
        occurredOn: "2026-08-30",
        description: "T02-F non-purchase event",
      },
    ]);

    await expect(
      db.insert(creditCardPurchases).values({
        id: FIXTURES.purchases.invalidPlan,
        householdId: FIXTURES.households.a,
        cardId: FIXTURES.cards.a,
        financialEventId: FIXTURES.events.invalid,
        installmentPlanId: FIXTURES.plans.b,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );

    await expect(
      db.insert(accountEntries).values({
        id: FIXTURES.entries.crossTenant,
        financialEventId: FIXTURES.events.a,
        accountId: FIXTURES.accounts.checkingB,
        householdId: FIXTURES.households.a,
        amountCents: BigInt(-1_000),
        status: "POSTED",
        postedOn: "2026-08-30",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );

    await expect(
      db.insert(accountEntries).values({
        id: FIXTURES.entries.invalid,
        financialEventId: FIXTURES.events.b,
        accountId: FIXTURES.accounts.checkingA,
        householdId: FIXTURES.households.a,
        amountCents: BigInt(-1_000),
        status: "POSTED",
        postedOn: "2026-08-30",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );

    await expect(
      db.delete(creditCards).where(eq(creditCards.id, FIXTURES.cards.a)),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );
  });

  it("enforces amount/date/status invariants and excludes EXPECTED entries from posted sums", async () => {
    const db = databaseOrThrow(database);

    await expect(
      db.insert(creditCardBillingRules).values(
        ruleValues(
          FIXTURES.rules.invalid,
          FIXTURES.households.a,
          FIXTURES.cards.a,
          "2026-01-01",
          "2026-01-01",
        ),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );

    await expect(
      db.insert(creditCards).values({
        id: FIXTURES.cards.invalidType,
        householdId: FIXTURES.households.a,
        accountId: FIXTURES.accounts.cardA,
        creditLimitCents: BigInt(0),
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );

    await expect(
      db.insert(financialEvents).values({
        id: FIXTURES.events.invalid,
        householdId: FIXTURES.households.a,
        kind: "PURCHASE",
        status: "POSTED",
        origin: "MANUAL",
        amountCents: BigInt(0),
        occurredOn: "2026-08-30",
        description: "T02-F invalid zero amount",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );

    await db.insert(financialEvents).values({
      id: FIXTURES.events.a,
      householdId: FIXTURES.households.a,
      kind: "PURCHASE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(12_345),
      occurredOn: "2026-08-30",
      description: "T02-F expected purchase",
    });

    await db.insert(accountEntries).values({
      id: FIXTURES.entries.a,
      financialEventId: FIXTURES.events.a,
      accountId: FIXTURES.accounts.cardA,
      householdId: FIXTURES.households.a,
      amountCents: BigInt(-12_345),
      status: "EXPECTED",
      expectedOn: "2026-09-10",
    });

    await expect(
      db.insert(accountEntries).values({
        id: FIXTURES.entries.invalid,
        financialEventId: FIXTURES.events.a,
        accountId: FIXTURES.accounts.cardA,
        householdId: FIXTURES.households.a,
        amountCents: BigInt(-12_345),
        status: "EXPECTED",
        expectedOn: "2026-09-10",
        postedOn: "2026-09-10",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );

    const postedExpectedTotal = await db.execute<{ total: string }>(sql`
      select coalesce(sum(amount_cents), 0)::text as total
        from public.account_entries
       where household_id = ${FIXTURES.households.a}
         and status::text = 'POSTED'
    `);
    expect(postedExpectedTotal.rows).toEqual([{ total: "0" }]);

    await expect(
      db.insert(installmentPlans).values({
        id: FIXTURES.plans.invalid,
        householdId: FIXTURES.households.a,
        purchaseId: "00000000-0000-7000-8000-000000067199",
        totalAmountCents: BigInt(0),
        installmentCount: 0,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );

    await expect(
      db.insert(installmentPlans).values({
        id: FIXTURES.plans.invalid,
        householdId: FIXTURES.households.a,
        purchaseId: "00000000-0000-7000-8000-000000067199",
        totalAmountCents: BigInt(100),
        installmentCount: 1,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      // The plan amount trigger may reject before PostgreSQL reaches the
      // missing-parent FK when both fields are invalid; either code is a
      // correct integrity failure and neither row is persisted.
      return ["23503", "23514"].includes(postgresErrorCode(error) ?? "");
    });

    await expect(
      db.insert(installments).values({
        id: FIXTURES.installments.invalid,
        householdId: FIXTURES.households.a,
        planId: "00000000-0000-7000-8000-000000068199",
        purchaseId: "00000000-0000-7000-8000-000000068198",
        sequence: 0,
        amountCents: BigInt(0),
        status: "PLANNED",
        billingRuleId: FIXTURES.rules.aJan,
        billingCycle: "2026-09-01",
        billingClosingDay: 10,
        billingDueDay: 20,
        billingClosingOn: "2026-09-10",
        billingDueOn: "2026-09-20",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23514",
    );
  });

  it("rolls back an event, entry and command together and keeps monetary storage integral", async () => {
    const db = databaseOrThrow(database);

    await expect(
      db.transaction(async (transaction) => {
        await transaction.insert(financialEvents).values({
          id: FIXTURES.events.rollback,
          householdId: FIXTURES.households.a,
          kind: "PURCHASE",
          status: "POSTED",
          origin: "MANUAL",
          amountCents: BigInt(900),
          occurredOn: "2026-08-30",
          description: "T02-F injected rollback",
        });
        await transaction.insert(accountEntries).values({
          id: FIXTURES.entries.rollback,
          financialEventId: FIXTURES.events.rollback,
          accountId: FIXTURES.accounts.cardA,
          householdId: FIXTURES.households.a,
          amountCents: BigInt(-900),
          status: "POSTED",
          postedOn: "2026-08-30",
        });
        await transaction.insert(applicationCommands).values({
          householdId: FIXTURES.households.a,
          commandId: "t02-f-injected-rollback",
          operation: "credit_card.purchase.create",
          payloadHash: "t02-f-payload-hash",
          resourceId: FIXTURES.events.rollback,
        });
        throw new Error("T02-F injected failure");
      }),
    ).rejects.toThrow("T02-F injected failure");

    const rollbackRows = await db.execute<{ total: string }>(sql`
      select (
        select count(*) from public.financial_events
         where id = ${FIXTURES.events.rollback}
      ) + (
        select count(*) from public.account_entries
         where id = ${FIXTURES.entries.rollback}
      ) + (
        select count(*) from public.application_commands
         where household_id = ${FIXTURES.households.a}
           and command_id = 't02-f-injected-rollback'
      ) as total
    `);
    expect(rollbackRows.rows).toEqual([{ total: "0" }]);

    const forbiddenObjects = await db.execute<{
      table_name: string;
      column_name: string | null;
    }>(sql`
      select 'transactions' as table_name, null as column_name
        from information_schema.tables
       where table_schema = 'public' and table_name = 'transactions'
      union all
      select 'credit_card_statements' as table_name, null as column_name
        from information_schema.tables
       where table_schema = 'public' and table_name = 'credit_card_statements'
      union all
      select table_name, column_name
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'accounts'
         and column_name = 'balance'
    `);
    expect(forbiddenObjects.rows).toEqual([]);

    const nonIntegralMoney = await db.execute<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(sql`
      select table_name, column_name, data_type
        from information_schema.columns
       where table_schema = 'public'
         and column_name like '%_cents'
         and data_type <> 'bigint'
    `);
    expect(nonIntegralMoney.rows).toEqual([]);
  });
});
