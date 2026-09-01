import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations, getMigrationStatus } from "@/db/migrate";
import {
  accounts,
  accountEntries,
  categories,
  financialEvents,
  households,
  transactionImportItems,
  transactionImports,
} from "@/db/schema";

/** T03 uses the disposable PostgreSQL target only when explicitly enabled. */
const integration =
  process.env.T03_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  households: {
    a: "00000000-0000-7000-8000-000000031101",
    b: "00000000-0000-7000-8000-000000031102",
  },
  accounts: {
    a: "00000000-0000-7000-8000-000000032101",
    b: "00000000-0000-7000-8000-000000032102",
  },
  categories: {
    a: "00000000-0000-7000-8000-000000032201",
    b: "00000000-0000-7000-8000-000000032202",
  },
  imports: {
    a: "00000000-0000-7000-8000-000000033101",
    b: "00000000-0000-7000-8000-000000033102",
  },
  events: {
    importedA: "00000000-0000-7000-8000-000000034101",
    manualA: "00000000-0000-7000-8000-000000034102",
    importedB: "00000000-0000-7000-8000-000000034103",
  },
  entries: {
    importedA: "00000000-0000-7000-8000-000000035101",
  },
  items: {
    importedA: "00000000-0000-7000-8000-000000036101",
    duplicate: "00000000-0000-7000-8000-000000036102",
    crossImport: "00000000-0000-7000-8000-000000036103",
    crossEvent: "00000000-0000-7000-8000-000000036104",
  },
} as const;

const HOUSEHOLD_IDS = [FIXTURES.households.a, FIXTURES.households.b] as const;
const PERF_EVENT_START = 0x600000;
// Keep enough rows for PostgreSQL's cost model to exercise the same index path
// as the review queue. With 1,200 rows per household, the pending predicate
// matches 25% of the tiny table and a Seq Scan is the objectively cheaper plan
// despite the tenant/category/date index being present.
const PERF_EVENT_COUNT_PER_HOUSEHOLD = 10_000;
const PERF_INSERT_CHUNK = 500;

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T03 não foi inicializado.");
  }
  return database;
}

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as {
    code?: unknown;
    cause?: { code?: unknown };
  };
  if (typeof candidate.code === "string") {
    return candidate.code;
  }
  return typeof candidate.cause?.code === "string"
    ? candidate.cause.code
    : undefined;
}

async function cleanupT03(database: Database): Promise<void> {
  await database
    .delete(transactionImportItems)
    .where(inArray(transactionImportItems.householdId, HOUSEHOLD_IDS));
  await database
    .delete(transactionImports)
    .where(inArray(transactionImports.householdId, HOUSEHOLD_IDS));
  await database
    .delete(accountEntries)
    .where(inArray(accountEntries.householdId, HOUSEHOLD_IDS));
  await database
    .delete(financialEvents)
    .where(inArray(financialEvents.householdId, HOUSEHOLD_IDS));
  await database
    .delete(categories)
    .where(inArray(categories.householdId, HOUSEHOLD_IDS));
  await database
    .delete(accounts)
    .where(inArray(accounts.householdId, HOUSEHOLD_IDS));
  await database
    .delete(households)
    .where(inArray(households.id, HOUSEHOLD_IDS));
}

async function seedT03(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T03 lineage household A" },
    { id: FIXTURES.households.b, name: "T03 lineage household B" },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      name: "T03 lineage account A",
      type: "CHECKING",
    },
    {
      id: FIXTURES.accounts.b,
      householdId: FIXTURES.households.b,
      name: "T03 lineage account B",
      type: "CHECKING",
    },
  ]);
  await database.insert(categories).values([
    {
      id: FIXTURES.categories.a,
      householdId: FIXTURES.households.a,
      name: "T03 lineage category A",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.b,
      householdId: FIXTURES.households.b,
      name: "T03 lineage category B",
      kind: "EXPENSE",
    },
  ]);
}

function importValues(
  id: string,
  householdId: string,
  accountId: string,
  fingerprint: string,
) {
  const createdAt = new Date("2026-08-30T10:00:00.000Z");
  return {
    id,
    householdId,
    accountId,
    formatVersion: "s04-csv-v1" as const,
    datasetFingerprint: fingerprint,
    sourceFileSizeBytes: 128,
    sourceHasBom: false,
    sourceColumns: "BASE" as const,
    processedRows: 1,
    validRows: 1,
    invalidRows: 0,
    ignoredDuplicateRows: 0,
    importedRows: 1,
    errors: [],
    status: "CONFIRMED" as const,
    createdAt,
    confirmedAt: new Date("2026-08-30T10:01:00.000Z"),
  };
}

function perfEventId(index: number): string {
  return `00000000-0000-7000-8000-${(PERF_EVENT_START + index)
    .toString(16)
    .padStart(12, "0")}`;
}

function parseExplain(rows: Array<Record<string, unknown>>): string {
  const plan = rows[0]?.["QUERY PLAN"];
  if (typeof plan === "string") {
    return plan;
  }
  if (!plan) {
    throw new Error("O PostgreSQL não retornou um plano JSON.");
  }
  return JSON.stringify(plan);
}

integration("T03 lineage, constraints and indexes PostgreSQL", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar T03_INTEGRATION=1.",
      );
    }
    await applyMigrations();
    database = getDb();
  });

  beforeEach(async () => {
    const db = databaseOrThrow(database);
    await cleanupT03(db);
    await seedT03(db);
  });

  afterAll(async () => {
    if (database) {
      await cleanupT03(database);
    }
    await closeDb();
  });

  it("applies the migration and exposes the T03 integrity surface", async () => {
    const db = databaseOrThrow(database);
    const status = await getMigrationStatus();
    expect(status).toMatchObject({ pending: 0, drifted: 0 });

    const forbidden = await db.execute<{ table_name: string; column_name: string | null }>(
      sql`
        select 'transactions' as table_name, null as column_name
          from information_schema.tables
         where table_schema = 'public' and table_name = 'transactions'
        union all
        select table_name, column_name
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'accounts'
           and column_name = 'balance'
      `,
    );
    expect(forbidden.rows).toEqual([]);

    const indexes = await db.execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef
        from pg_catalog.pg_indexes
       where schemaname = 'public'
         and indexname in (
           'financial_events_household_origin_occurred_on_id_idx',
           'financial_events_household_category_occurred_on_id_idx',
           'account_entries_household_event_idx',
           'transaction_import_items_household_import_row_idx',
           'transaction_import_items_household_event_idx',
           'transaction_import_items_household_event_uq'
         )
       order by indexname
    `);
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
      "account_entries_household_event_idx",
      "financial_events_household_category_occurred_on_id_idx",
      "financial_events_household_origin_occurred_on_id_idx",
      "transaction_import_items_household_event_idx",
      "transaction_import_items_household_event_uq",
      "transaction_import_items_household_import_row_idx",
    ]);
    expect(
      indexes.rows.find(
        ({ indexname }) => indexname === "transaction_import_items_household_event_uq",
      )?.indexdef,
    ).toContain("CREATE UNIQUE INDEX");

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
         and c.conname in (
           'financial_events_category_household_fkey',
           'account_entries_financial_event_household_fkey',
           'account_entries_account_household_fkey',
           'transaction_imports_account_household_fkey',
           'transaction_import_items_import_household_fkey',
           'transaction_import_items_event_household_fkey'
         )
       order by c.conname
    `);
    expect(foreignKeys.rows).toEqual([
      {
        conname: "account_entries_account_household_fkey",
        confdeltype: "r",
        columnCount: 2,
      },
      {
        conname: "account_entries_financial_event_household_fkey",
        confdeltype: "r",
        columnCount: 2,
      },
      {
        conname: "financial_events_category_household_fkey",
        confdeltype: "r",
        columnCount: 2,
      },
      {
        conname: "transaction_import_items_event_household_fkey",
        confdeltype: "r",
        columnCount: 2,
      },
      {
        conname: "transaction_import_items_import_household_fkey",
        confdeltype: "r",
        columnCount: 2,
      },
      {
        conname: "transaction_imports_account_household_fkey",
        confdeltype: "r",
        columnCount: 2,
      },
    ]);
  });

  it("preserves import origin and lineage when event metadata changes", async () => {
    const db = databaseOrThrow(database);
    await db.insert(transactionImports).values([
      importValues(
        FIXTURES.imports.a,
        FIXTURES.households.a,
        FIXTURES.accounts.a,
        "a".repeat(64),
      ),
      importValues(
        FIXTURES.imports.b,
        FIXTURES.households.b,
        FIXTURES.accounts.b,
        "b".repeat(64),
      ),
    ]);
    await db.insert(financialEvents).values([
      {
        id: FIXTURES.events.importedA,
        householdId: FIXTURES.households.a,
        kind: "EXPENSE",
        status: "POSTED",
        origin: "IMPORT",
        amountCents: BigInt(500),
        occurredOn: "2026-08-29",
        description: "imported before review",
      },
      {
        id: FIXTURES.events.manualA,
        householdId: FIXTURES.households.a,
        kind: "EXPENSE",
        status: "POSTED",
        origin: "MANUAL",
        amountCents: BigInt(750),
        occurredOn: "2026-08-30",
        description: "manual without lineage",
      },
      {
        id: FIXTURES.events.importedB,
        householdId: FIXTURES.households.b,
        kind: "EXPENSE",
        status: "POSTED",
        origin: "IMPORT",
        amountCents: BigInt(900),
        occurredOn: "2026-08-30",
        description: "imported other household",
      },
    ]);
    await db.insert(accountEntries).values({
      id: FIXTURES.entries.importedA,
      financialEventId: FIXTURES.events.importedA,
      accountId: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      amountCents: BigInt(-500),
      status: "POSTED",
      postedOn: "2026-08-29",
    });
    await db.insert(transactionImportItems).values({
      id: FIXTURES.items.importedA,
      householdId: FIXTURES.households.a,
      importId: FIXTURES.imports.a,
      rowNumber: 2,
      externalId: "row-2",
      financialEventId: FIXTURES.events.importedA,
    });

    await db
      .update(financialEvents)
      .set({
        description: "imported after review",
        categoryId: FIXTURES.categories.a,
      })
      .where(eq(financialEvents.id, FIXTURES.events.importedA));

    const imported = await db
      .select({
        origin: financialEvents.origin,
        description: financialEvents.description,
        categoryId: financialEvents.categoryId,
        importId: transactionImportItems.importId,
        rowNumber: transactionImportItems.rowNumber,
        externalId: transactionImportItems.externalId,
      })
      .from(financialEvents)
      .innerJoin(
        transactionImportItems,
        and(
          eq(transactionImportItems.financialEventId, financialEvents.id),
          eq(transactionImportItems.householdId, financialEvents.householdId),
        ),
      )
      .where(
        and(
          eq(financialEvents.id, FIXTURES.events.importedA),
          eq(financialEvents.householdId, FIXTURES.households.a),
        ),
      );
    expect(imported).toEqual([
      {
        origin: "IMPORT",
        description: "imported after review",
        categoryId: FIXTURES.categories.a,
        importId: FIXTURES.imports.a,
        rowNumber: 2,
        externalId: "row-2",
      },
    ]);

    const importedWithoutLineage = await db
      .select({ id: transactionImportItems.id })
      .from(transactionImportItems)
      .where(
        and(
          eq(transactionImportItems.householdId, FIXTURES.households.b),
          eq(transactionImportItems.financialEventId, FIXTURES.events.importedB),
        ),
      );
    expect(importedWithoutLineage).toEqual([]);

    const manualLineage = await db
      .select({ id: transactionImportItems.id })
      .from(transactionImportItems)
      .innerJoin(
        financialEvents,
        and(
          eq(transactionImportItems.financialEventId, financialEvents.id),
          eq(transactionImportItems.householdId, financialEvents.householdId),
        ),
      )
      .where(
        and(
          eq(financialEvents.id, FIXTURES.events.manualA),
          eq(financialEvents.origin, "MANUAL"),
        ),
      );
    expect(manualLineage).toEqual([]);
  });

  it("proves the ledger and lineage joins have no orphan rows", async () => {
    const db = databaseOrThrow(database);
    await db.insert(transactionImports).values(
      importValues(
        FIXTURES.imports.a,
        FIXTURES.households.a,
        FIXTURES.accounts.a,
        "f".repeat(64),
      ),
    );
    await db.insert(financialEvents).values({
      id: FIXTURES.events.importedA,
      householdId: FIXTURES.households.a,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "IMPORT",
      amountCents: BigInt(500),
      occurredOn: "2026-08-29",
      description: "complete import graph",
    });
    await db.insert(accountEntries).values({
      id: FIXTURES.entries.importedA,
      financialEventId: FIXTURES.events.importedA,
      accountId: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      amountCents: BigInt(-500),
      status: "POSTED",
      postedOn: "2026-08-29",
    });
    await db.insert(transactionImportItems).values({
      id: FIXTURES.items.importedA,
      householdId: FIXTURES.households.a,
      importId: FIXTURES.imports.a,
      rowNumber: 2,
      financialEventId: FIXTURES.events.importedA,
    });

    const orphanEvents = await db.execute<{ count: string }>(sql`
      select count(*)::text as count
        from financial_events event
        left join account_entries entry
          on entry.financial_event_id = event.id
         and entry.household_id = event.household_id
       where event.household_id = ${FIXTURES.households.a}
         and entry.id is null
    `);
    const orphanEntries = await db.execute<{ count: string }>(sql`
      select count(*)::text as count
        from account_entries entry
        left join financial_events event
          on event.id = entry.financial_event_id
         and event.household_id = entry.household_id
       where entry.household_id = ${FIXTURES.households.a}
         and event.id is null
    `);
    const orphanLineage = await db.execute<{ count: string }>(sql`
      select count(*)::text as count
        from transaction_import_items item
        left join transaction_imports batch
          on batch.id = item.import_id
         and batch.household_id = item.household_id
        left join financial_events event
          on event.id = item.financial_event_id
         and event.household_id = item.household_id
       where item.household_id = ${FIXTURES.households.a}
         and (batch.id is null or event.id is null)
    `);

    expect(orphanEvents.rows).toEqual([{ count: "0" }]);
    expect(orphanEntries.rows).toEqual([{ count: "0" }]);
    expect(orphanLineage.rows).toEqual([{ count: "0" }]);
  });

  it("rejects cross-tenant lineage and duplicate event lineage", async () => {
    const db = databaseOrThrow(database);
    await db.insert(transactionImports).values([
      importValues(
        FIXTURES.imports.a,
        FIXTURES.households.a,
        FIXTURES.accounts.a,
        "c".repeat(64),
      ),
      importValues(
        FIXTURES.imports.b,
        FIXTURES.households.b,
        FIXTURES.accounts.b,
        "d".repeat(64),
      ),
    ]);
    await db.insert(financialEvents).values([
      {
        id: FIXTURES.events.importedA,
        householdId: FIXTURES.households.a,
        kind: "EXPENSE",
        status: "POSTED",
        origin: "IMPORT",
        amountCents: BigInt(500),
        occurredOn: "2026-08-29",
        description: "import A",
      },
      {
        id: FIXTURES.events.importedB,
        householdId: FIXTURES.households.b,
        kind: "EXPENSE",
        status: "POSTED",
        origin: "IMPORT",
        amountCents: BigInt(600),
        occurredOn: "2026-08-29",
        description: "import B",
      },
      {
        id: FIXTURES.events.manualA,
        householdId: FIXTURES.households.a,
        kind: "EXPENSE",
        status: "POSTED",
        origin: "MANUAL",
        amountCents: BigInt(700),
        occurredOn: "2026-08-29",
        description: "manual A without lineage",
      },
    ]);
    await db.insert(transactionImportItems).values({
      id: FIXTURES.items.importedA,
      householdId: FIXTURES.households.a,
      importId: FIXTURES.imports.a,
      rowNumber: 2,
      financialEventId: FIXTURES.events.importedA,
    });

    await expect(
      db.insert(transactionImportItems).values({
        id: FIXTURES.items.duplicate,
        householdId: FIXTURES.households.a,
        importId: FIXTURES.imports.a,
        rowNumber: 3,
        financialEventId: FIXTURES.events.importedA,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23505",
    );

    await expect(
      db.insert(transactionImportItems).values({
        id: FIXTURES.items.crossImport,
        householdId: FIXTURES.households.a,
        importId: FIXTURES.imports.b,
        rowNumber: 3,
        financialEventId: FIXTURES.events.manualA,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );

    await expect(
      db.insert(transactionImportItems).values({
        id: FIXTURES.items.crossEvent,
        householdId: FIXTURES.households.a,
        importId: FIXTURES.imports.a,
        rowNumber: 4,
        financialEventId: FIXTURES.events.importedB,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );

    const orphans = await db.execute<{ count: string }>(sql`
      select count(*)::text as count
        from transaction_import_items item
        left join transaction_imports batch
          on batch.id = item.import_id
         and batch.household_id = item.household_id
        left join financial_events event
          on event.id = item.financial_event_id
         and event.household_id = item.household_id
       where batch.id is null or event.id is null
    `);
    expect(orphans.rows).toEqual([{ count: "0" }]);
  });

  it("keeps lineage parents protected by ON DELETE RESTRICT", async () => {
    const db = databaseOrThrow(database);
    await db.insert(transactionImports).values(
      importValues(
        FIXTURES.imports.a,
        FIXTURES.households.a,
        FIXTURES.accounts.a,
        "e".repeat(64),
      ),
    );
    await db.insert(financialEvents).values({
      id: FIXTURES.events.importedA,
      householdId: FIXTURES.households.a,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "IMPORT",
      amountCents: BigInt(500),
      occurredOn: "2026-08-29",
      description: "protected import",
    });
    await db.insert(transactionImportItems).values({
      id: FIXTURES.items.importedA,
      householdId: FIXTURES.households.a,
      importId: FIXTURES.imports.a,
      rowNumber: 2,
      financialEventId: FIXTURES.events.importedA,
    });

    await expect(
      db.delete(transactionImports).where(eq(transactionImports.id, FIXTURES.imports.a)),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );
    await expect(
      db.delete(financialEvents).where(eq(financialEvents.id, FIXTURES.events.importedA)),
    ).rejects.toSatisfy(
      (error: unknown) => postgresErrorCode(error) === "23503",
    );
  });

  it("uses the tenant/date lineage indexes for representative review predicates", async () => {
    const db = databaseOrThrow(database);
    const events = Array.from(
      { length: PERF_EVENT_COUNT_PER_HOUSEHOLD * 2 },
      (_, index) => ({
        id: perfEventId(index),
        householdId:
          index < PERF_EVENT_COUNT_PER_HOUSEHOLD
            ? FIXTURES.households.a
            : FIXTURES.households.b,
        kind: "EXPENSE" as const,
        status: "POSTED" as const,
        origin: "IMPORT" as const,
        amountCents: BigInt(100 + (index % 20)),
        occurredOn: "2026-08-01",
        categoryId:
          index % 2 === 0
            ? null
            : index < PERF_EVENT_COUNT_PER_HOUSEHOLD
              ? FIXTURES.categories.a
              : FIXTURES.categories.b,
        description: `synthetic review event ${index}`,
      }),
    );
    for (let start = 0; start < events.length; start += PERF_INSERT_CHUNK) {
      await db
        .insert(financialEvents)
        .values(events.slice(start, start + PERF_INSERT_CHUNK));
    }
    await db.execute(sql`analyze financial_events`);

    const originPlan = await db.execute<Record<string, unknown>>(sql`
      explain (analyze, buffers, format json)
      select id
        from financial_events
       where household_id = ${FIXTURES.households.a}
         and origin = 'IMPORT'
         and occurred_on between '2026-01-01' and '2026-12-31'
       order by occurred_on desc, id desc
       limit 50
    `);
    const categoryPlan = await db.execute<Record<string, unknown>>(sql`
      explain (analyze, buffers, format json)
      select id
        from financial_events
       where household_id = ${FIXTURES.households.a}
         and category_id = ${FIXTURES.categories.a}
         and occurred_on between '2026-01-01' and '2026-12-31'
       order by occurred_on desc, id desc
       limit 50
    `);
    const pendingPlan = await db.execute<Record<string, unknown>>(sql`
      explain (analyze, buffers, format json)
      select id
        from financial_events
       where household_id = ${FIXTURES.households.a}
         and category_id is null
         and occurred_on between '2026-01-01' and '2026-12-31'
       order by occurred_on desc, id desc
       limit 50
    `);

    expect(parseExplain(originPlan.rows)).toContain(
      "financial_events_household_origin_occurred_on_id_idx",
    );
    expect(parseExplain(categoryPlan.rows)).toContain(
      "financial_events_household_category_occurred_on_id_idx",
    );
    const pendingExplain = parseExplain(pendingPlan.rows);
    // Index Only Scan is an index-backed plan too and is preferable when the
    // projection is covered; accept both forms while rejecting a full scan.
    expect(pendingExplain).toMatch(/"Node Type":"Index(?: Only)? Scan"/);
    // For a broad `IS NULL` range PostgreSQL may choose the shorter
    // household/date index (and filter category) instead of the covering
    // category index. The equality predicate above already gates the latter;
    // here the invariant is an index-backed tenant/date path, never a full
    // scan.
    expect(pendingExplain).toMatch(
      /"Index Name":"financial_events_household_(?:occurred_on|category_occurred_on_id|origin_occurred_on_id)_idx"/,
    );
    expect(parseExplain(pendingPlan.rows)).toContain("household_id =");
    expect(parseExplain(pendingPlan.rows)).toContain("occurred_on >=");
    expect(pendingExplain).not.toContain('"Node Type":"Seq Scan"');
  });
});
