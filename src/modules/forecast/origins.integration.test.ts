import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  applicationCommands,
  households,
  plannedEvents,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";

import { createPlannedEventUseCases } from "./planned-events";
import { resolveForecastOriginForContext } from "./origins";

const integration =
  process.env.T10_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  householdA: "00000000-0000-7000-8000-0000000a1011",
  householdB: "00000000-0000-7000-8000-0000000a1012",
} as const;

const HOUSEHOLDS = [FIXTURES.householdA, FIXTURES.householdB] as const;
const contextA: FinancialContext = {
  userId: "00000000-0000-7000-8000-0000000a1021",
  householdId: FIXTURES.householdA,
};
const contextB: FinancialContext = {
  userId: "00000000-0000-7000-8000-0000000a1022",
  householdId: FIXTURES.householdB,
};

function dbOrThrow(database: Database | undefined): Database {
  if (!database) throw new Error("Banco de integração T10 não inicializado.");
  return database;
}

async function cleanup(database: Database): Promise<void> {
  await database
    .delete(applicationCommands)
    .where(inArray(applicationCommands.householdId, HOUSEHOLDS));
  await database
    .delete(plannedEvents)
    .where(inArray(plannedEvents.householdId, HOUSEHOLDS));
  await database.delete(households).where(inArray(households.id, HOUSEHOLDS));
}

integration("S07 T10 origin boundary", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("Defina DATABASE_URL para executar T10_INTEGRATION=1.");
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = dbOrThrow(database);
    await cleanup(db);
    await db.insert(households).values([
      { id: FIXTURES.householdA, name: "T10 Origin A" },
      { id: FIXTURES.householdB, name: "T10 Origin B" },
    ]);
  });

  afterAll(async () => {
    if (database) {
      await cleanup(database);
      await closeDb();
    }
  });

  it("resolves a UI-created planned event with a valid UUIDv7", async () => {
    const db = dbOrThrow(database);
    const created = await createPlannedEventUseCases({ database: db }).create(
      contextA,
      {
        commandId: "t10-origin-create-001",
        kind: "EXPENSE",
        amountCents: "4567",
        expectedOn: "2099-04-15",
        description: "Evento criado pela UI",
      },
    );
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;

    const detail = await resolveForecastOriginForContext(
      contextA,
      {
        kind: "PLANNED_EVENT",
        referenceId: created.value.id,
      },
      { database: db },
    );

    expect(detail).toMatchObject({
      ok: true,
      value: {
        kind: "PLANNED_EVENT",
        referenceId: created.value.id,
        label: "Evento criado pela UI",
        plannedEvent: {
          plannedEventId: created.value.id,
          amountCents: "4567",
          expectedOn: "2099-04-15",
        },
      },
    });
  });

  it("keeps a valid planned-event reference opaque across households", async () => {
    const db = dbOrThrow(database);
    const created = await createPlannedEventUseCases({ database: db }).create(
      contextB,
      {
        commandId: "t10-origin-create-002",
        kind: "EXPENSE",
        amountCents: "1234",
        expectedOn: "2099-04-16",
        description: "Evento de outro espaço",
      },
    );
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;

    const hidden = await resolveForecastOriginForContext(
      contextA,
      { kind: "PLANNED_EVENT", referenceId: created.value.id },
      { database: db },
    );

    expect(hidden).toEqual({
      ok: false,
      error: { code: "FORECAST_NOT_FOUND", field: null },
    });
    expect(JSON.stringify(hidden)).not.toContain("outro espaço");
  });
});
