import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  financialEvents,
  households,
  plannedEvents,
  recurringOccurrences,
  recurringRules,
} from "@/db/schema";
import {
  listRecurringRulesForContext,
} from "@/modules/recurring/reads";

const integration =
  process.env.T02_INTEGRATION === "1" ? describe : describe.skip;

const IDS = {
  householdA: "00000000-0000-7000-8000-000000071101",
  householdB: "00000000-0000-7000-8000-000000071102",
  ruleA: "00000000-0000-7000-8000-000000072101",
  ruleB: "00000000-0000-7000-8000-000000072102",
  occurrenceA: "00000000-0000-7000-8000-000000073101",
  occurrenceB: "00000000-0000-7000-8000-000000073102",
  plannedA: "00000000-0000-7000-8000-000000074101",
  plannedRollback: "00000000-0000-7000-8000-000000074102",
  eventA: "00000000-0000-7000-8000-000000075101",
} as const;

function dbOrThrow(database: Database | undefined): Database {
  if (!database) throw new Error("Banco de integração T02 não inicializado.");
  return database;
}

function ruleValues(id: string, householdId: string) {
  return {
    id,
    householdId,
    kind: "EXPENSE" as const,
    amountCents: BigInt(10_000),
    description: "Compromisso T02",
    frequency: "MONTHLY" as const,
    dayRule: "FIXED_DAY" as const,
    dayOfMonth: 1,
    startOn: "2026-01-01",
    endOn: null,
  };
}

async function cleanup(database: Database): Promise<void> {
  await database
    .delete(plannedEvents)
    .where(inArray(plannedEvents.householdId, [IDS.householdA, IDS.householdB]));
  await database
    .delete(recurringOccurrences)
    .where(
      inArray(recurringOccurrences.householdId, [IDS.householdA, IDS.householdB]),
    );
  await database
    .delete(financialEvents)
    .where(inArray(financialEvents.householdId, [IDS.householdA, IDS.householdB]));
  await database
    .delete(recurringRules)
    .where(inArray(recurringRules.householdId, [IDS.householdA, IDS.householdB]));
  await database
    .delete(households)
    .where(inArray(households.id, [IDS.householdA, IDS.householdB]));
}

integration("S07 T02 recurring PostgreSQL boundaries", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL && !process.env.MIGRATION_DATABASE_URL) {
      throw new Error("Defina DATABASE_URL para executar T02_INTEGRATION=1.");
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = dbOrThrow(database);
    await cleanup(db);
    await db.insert(households).values([
      { id: IDS.householdA, name: "T02 recurring A" },
      { id: IDS.householdB, name: "T02 recurring B" },
    ]);
  });

  afterAll(async () => {
    if (database) await cleanup(database);
    await closeDb();
  });

  it("enforces composite tenant ownership and one occurrence key", async () => {
    const db = dbOrThrow(database);
    await db.insert(recurringRules).values(ruleValues(IDS.ruleA, IDS.householdA));
    await db.insert(recurringOccurrences).values({
      id: IDS.occurrenceA,
      householdId: IDS.householdA,
      recurringRuleId: IDS.ruleA,
      occurrenceKey: "2026-09",
      expectedOn: "2026-09-01",
      amountCents: BigInt(10_000),
    });

    await expect(
      db.insert(recurringOccurrences).values({
        id: IDS.occurrenceB,
        householdId: IDS.householdA,
        recurringRuleId: IDS.ruleA,
        occurrenceKey: "2026-09",
      }),
    ).rejects.toBeDefined();

    await expect(
      db.insert(recurringOccurrences).values({
        id: IDS.occurrenceB,
        householdId: IDS.householdB,
        recurringRuleId: IDS.ruleA,
        occurrenceKey: "2026-10",
      }),
    ).rejects.toBeDefined();
  });

  it("rejects invalid values, intervals and frequency keys in PostgreSQL", async () => {
    const db = dbOrThrow(database);
    await expect(
      db.insert(recurringRules).values({
        ...ruleValues(IDS.ruleA, IDS.householdA),
        amountCents: BigInt(0),
      }),
    ).rejects.toBeDefined();
    await expect(
      db.insert(recurringRules).values({
        ...ruleValues(IDS.ruleA, IDS.householdA),
        endOn: "2025-12-31",
      }),
    ).rejects.toBeDefined();
    await expect(
      db.insert(recurringRules).values({
        ...ruleValues(IDS.ruleA, IDS.householdA),
        dayRule: "FIRST_BUSINESS_DAY",
        dayOfMonth: 1,
      }),
    ).rejects.toBeDefined();

    await db.insert(recurringRules).values(ruleValues(IDS.ruleA, IDS.householdA));
    await expect(
      db.insert(recurringOccurrences).values({
        id: IDS.occurrenceA,
        householdId: IDS.householdA,
        recurringRuleId: IDS.ruleA,
        occurrenceKey: "2026",
      }),
    ).rejects.toBeDefined();
  });

  it("requires an explicit posted fact for realization and blocks source duplication", async () => {
    const db = dbOrThrow(database);
    await db.insert(financialEvents).values({
      id: IDS.eventA,
      householdId: IDS.householdA,
      kind: "INCOME",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(12_000),
      occurredOn: "2026-09-01",
      description: "Receita T02",
    });
    await db.insert(plannedEvents).values({
      id: IDS.plannedA,
      householdId: IDS.householdA,
      kind: "INCOME",
      status: "POSTED",
      amountCents: BigInt(10_000),
      expectedOn: "2026-09-01",
      description: "Receita T02 planejada",
      financialEventId: IDS.eventA,
    });
    await db.insert(recurringRules).values({
      ...ruleValues(IDS.ruleA, IDS.householdA),
      kind: "INCOME",
    });
    await expect(
      db.insert(recurringOccurrences).values({
        id: IDS.occurrenceA,
        householdId: IDS.householdA,
        recurringRuleId: IDS.ruleA,
        occurrenceKey: "2026-09",
        status: "POSTED",
        financialEventId: IDS.eventA,
      }),
    ).rejects.toBeDefined();
  });

  it("rolls back a source write atomically and reads only the context household", async () => {
    const db = dbOrThrow(database);
    await expect(
      db.transaction(async (transaction) => {
        await transaction.insert(plannedEvents).values({
          id: IDS.plannedRollback,
          householdId: IDS.householdA,
          kind: "EXPENSE",
          status: "PLANNED",
          amountCents: BigInt(1_000),
          expectedOn: "2026-10-01",
          description: "Rollback T02",
        });
        throw new Error("T02 rollback probe");
      }),
    ).rejects.toThrow("T02 rollback probe");

    const rolledBack = await db
      .select({ id: plannedEvents.id })
      .from(plannedEvents)
      .where(eq(plannedEvents.id, IDS.plannedRollback));
    expect(rolledBack).toEqual([]);

    await db.insert(recurringRules).values([
      ruleValues(IDS.ruleA, IDS.householdA),
      ruleValues(IDS.ruleB, IDS.householdB),
    ]);
    const visible = await listRecurringRulesForContext(
      { userId: "00000000-0000-7000-8000-000000079901", householdId: IDS.householdA },
      { database: db },
    );
    expect(visible.map((rule) => rule.id)).toEqual([IDS.ruleA]);
  });
});
