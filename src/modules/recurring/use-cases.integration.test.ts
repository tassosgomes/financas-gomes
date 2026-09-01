import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  applicationCommands,
  financialEvents,
  households,
  recurringOccurrences,
  recurringRules,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";

import { createRecurringUseCases } from "./use-cases";

const integration =
  process.env.T03_INTEGRATION === "1" ? describe : describe.skip;

const IDS = {
  householdA: "00000000-0000-7000-8000-000000078101",
  householdB: "00000000-0000-7000-8000-000000078102",
  eventA: "00000000-0000-7000-8000-000000078201",
  eventB: "00000000-0000-7000-8000-000000078202",
} as const;

const contextA: FinancialContext = {
  userId: "00000000-0000-7000-8000-000000078301",
  householdId: IDS.householdA,
};
const contextB: FinancialContext = {
  userId: "00000000-0000-7000-8000-000000078302",
  householdId: IDS.householdB,
};
const householdIds = [IDS.householdA, IDS.householdB] as const;

function dbOrThrow(database: Database | undefined): Database {
  if (!database) throw new Error("Banco de integração T03 não inicializado.");
  return database;
}

async function cleanup(database: Database): Promise<void> {
  await database
    .delete(applicationCommands)
    .where(inArray(applicationCommands.householdId, householdIds));
  await database
    .delete(recurringOccurrences)
    .where(inArray(recurringOccurrences.householdId, householdIds));
  await database
    .delete(financialEvents)
    .where(inArray(financialEvents.householdId, householdIds));
  await database
    .delete(recurringRules)
    .where(inArray(recurringRules.householdId, householdIds));
  await database.delete(households).where(inArray(households.id, householdIds));
}

integration("S07 T03 recurring commands and realization", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("Defina DATABASE_URL para executar T03_INTEGRATION=1.");
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = dbOrThrow(database);
    await cleanup(db);
    await db.insert(households).values([
      { id: IDS.householdA, name: "T03 Household A" },
      { id: IDS.householdB, name: "T03 Household B" },
    ]);
  });

  afterAll(async () => {
    if (database) await cleanup(database);
    await closeDb();
  });

  it("persists idempotent rule versions, exceptions, realization and cancellation", async () => {
    const db = dbOrThrow(database);
    const useCases = createRecurringUseCases(db);
    const created = await useCases.createRule(contextA, {
      commandId: "t03-create-001",
      kind: "EXPENSE",
      amountCents: "10000",
      description: "Compromisso mensal",
      frequency: "MONTHLY",
      dayRule: "FIXED_DAY",
      dayOfMonth: 31,
      startOn: "2026-01-31",
    });
    expect(created).toMatchObject({
      ok: true,
      value: {
        householdId: IDS.householdA,
        amountCents: "10000",
        startOn: "2026-01-31",
        endOn: null,
      },
    });
    if (!created.ok) return;

    const retry = await useCases.createRule(contextA, {
      commandId: "t03-create-001",
      kind: "EXPENSE",
      amountCents: "10000",
      description: "Compromisso mensal",
      frequency: "MONTHLY",
      dayRule: "FIXED_DAY",
      dayOfMonth: 31,
      startOn: "2026-01-31",
    });
    expect(retry).toEqual(created);

    const commandConflict = await useCases.createRule(contextA, {
      commandId: "t03-create-001",
      kind: "EXPENSE",
      amountCents: "10001",
      description: "Outra intenção",
      frequency: "MONTHLY",
      dayRule: "FIXED_DAY",
      dayOfMonth: 31,
      startOn: "2026-01-31",
    });
    expect(commandConflict).toMatchObject({
      ok: false,
      error: { code: "COMMAND_ID_REUSED", field: "commandId" },
    });

    const updated = await useCases.updateRuleFuture(contextA, {
      commandId: "t03-update-001",
      recurringRuleId: created.value.id,
      effectiveFrom: "2026-09-01",
      amountCents: "12000",
      description: "Compromisso reajustado",
    });
    expect(updated).toMatchObject({
      ok: true,
      value: {
        householdId: IDS.householdA,
        amountCents: "12000",
        startOn: "2026-09-01",
        endOn: null,
      },
    });
    if (!updated.ok) return;

    const oldRule = await db
      .select({ startOn: recurringRules.startOn, endOn: recurringRules.endOn })
      .from(recurringRules)
      .where(
        and(
          eq(recurringRules.id, created.value.id),
          eq(recurringRules.householdId, contextA.householdId),
        ),
      );
    expect(oldRule).toEqual([{ startOn: "2026-01-31", endOn: "2026-08-31" }]);

    const ended = await useCases.endRule(contextA, {
      commandId: "t03-end-001",
      recurringRuleId: updated.value.id,
      endOn: "2026-12-31",
    });
    expect(ended).toMatchObject({ ok: true, value: { endOn: "2026-12-31" } });

    const override = await useCases.overrideOccurrence(contextA, {
      commandId: "t03-override-001",
      recurringRuleId: updated.value.id,
      occurrenceKey: "2026-10",
      amountCents: "13000",
      expectedOn: "2026-10-30",
    });
    expect(override).toMatchObject({
      ok: true,
      value: {
        householdId: IDS.householdA,
        recurringRuleId: updated.value.id,
        occurrenceKey: "2026-10",
        status: "PLANNED",
        amountCents: "13000",
        expectedOn: "2026-10-30",
        financialEventId: null,
      },
    });

    await db.insert(financialEvents).values([
      {
        id: IDS.eventA,
        householdId: IDS.householdA,
        kind: "EXPENSE",
        status: "POSTED",
        origin: "MANUAL",
        amountCents: BigInt(7000),
        occurredOn: "2026-11-12",
        description: "Realização T03",
      },
      {
        id: IDS.eventB,
        householdId: IDS.householdB,
        kind: "EXPENSE",
        status: "POSTED",
        origin: "MANUAL",
        amountCents: BigInt(7000),
        occurredOn: "2026-11-12",
        description: "Realização T03 B",
      },
    ]);

    const realized = await useCases.realizeOccurrence(contextA, {
      commandId: "t03-realize-001",
      recurringRuleId: updated.value.id,
      occurrenceKey: "2026-11",
      financialEventId: IDS.eventA,
      isPartial: true,
    });
    expect(realized).toMatchObject({
      ok: true,
      value: {
        occurrenceKey: "2026-11",
        status: "POSTED",
        financialEventId: IDS.eventA,
        isPartial: true,
      },
    });
    if (!realized.ok) return;

    const realizationRetry = await useCases.realizeOccurrence(contextA, {
      commandId: "t03-realize-001",
      recurringRuleId: updated.value.id,
      occurrenceKey: "2026-11",
      financialEventId: IDS.eventA,
      isPartial: true,
    });
    expect(realizationRetry).toEqual(realized);

    const duplicateSource = await useCases.realizeOccurrence(contextA, {
      commandId: "t03-realize-002",
      recurringRuleId: updated.value.id,
      occurrenceKey: "2026-12",
      financialEventId: IDS.eventA,
    });
    expect(duplicateSource).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });

    const cancelled = await useCases.cancelOccurrence(contextA, {
      commandId: "t03-cancel-001",
      recurringRuleId: updated.value.id,
      occurrenceKey: "2026-12",
    });
    expect(cancelled).toMatchObject({
      ok: true,
      value: { occurrenceKey: "2026-12", status: "CANCELLED" },
    });

    const crossTenant = await useCases.endRule(contextB, {
      commandId: "t03-cross-tenant-001",
      recurringRuleId: updated.value.id,
      endOn: "2026-12-01",
    });
    expect(crossTenant).toMatchObject({
      ok: false,
      error: { code: "RULE_NOT_FOUND", field: "recurringRuleId" },
    });

    const crossTenantEvent = await useCases.realizeOccurrence(contextA, {
      commandId: "t03-cross-event-001",
      recurringRuleId: updated.value.id,
      occurrenceKey: "2026-09",
      financialEventId: IDS.eventB,
    });
    expect(crossTenantEvent).toMatchObject({
      ok: false,
      error: { code: "TENANT_RESOURCE_NOT_FOUND", field: "financialEventId" },
    });

    const [occurrences, commands] = await Promise.all([
      db
        .select({
          occurrenceKey: recurringOccurrences.occurrenceKey,
          status: recurringOccurrences.status,
          financialEventId: recurringOccurrences.financialEventId,
        })
        .from(recurringOccurrences)
        .where(eq(recurringOccurrences.householdId, contextA.householdId)),
      db
        .select({ commandId: applicationCommands.commandId })
        .from(applicationCommands)
        .where(eq(applicationCommands.householdId, contextA.householdId)),
    ]);
    expect(occurrences).toContainEqual({
      occurrenceKey: "2026-10",
      status: "PLANNED",
      financialEventId: null,
    });
    expect(occurrences).toContainEqual({
      occurrenceKey: "2026-11",
      status: "POSTED",
      financialEventId: IDS.eventA,
    });
    expect(occurrences).toContainEqual({
      occurrenceKey: "2026-12",
      status: "CANCELLED",
      financialEventId: null,
    });
    expect(commands.map(({ commandId }) => commandId).sort()).toEqual([
      "t03-cancel-001",
      "t03-create-001",
      "t03-end-001",
      "t03-override-001",
      "t03-realize-001",
      "t03-update-001",
    ]);
  });
});
