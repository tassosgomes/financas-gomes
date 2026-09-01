import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inArray, sql, type SQL } from "drizzle-orm";

import { closeDb, getDb, type Database } from "@/db";
import { applyMigrations } from "@/db/migrate";
import {
  accountEntries,
  accounts,
  categories,
  financialEvents,
  households,
  transactionImportItems,
  transactionImports,
} from "@/db/schema";
import type { FinancialContext } from "@/modules/households/contracts";

import {
  getTransactionReviewSummaryForContext,
  listReviewableTransactionsForContext,
} from "./review-reads";

/** T11's volume test is opt-in and uses only the disposable PostgreSQL target. */
const integration =
  process.env.T11_INTEGRATION === "1" ? describe : describe.skip;

const FIXTURES = {
  households: {
    a: "00000000-0000-7000-8000-00000011a101",
    b: "00000000-0000-7000-8000-00000011a102",
  },
  accounts: {
    a: "00000000-0000-7000-8000-00000011b101",
    b: "00000000-0000-7000-8000-00000011b102",
  },
  categories: {
    a: "00000000-0000-7000-8000-00000011c101",
    b: "00000000-0000-7000-8000-00000011c102",
  },
  imports: {
    a: "00000000-0000-7000-8000-00000011d101",
    b: "00000000-0000-7000-8000-00000011d102",
  },
} as const;

const HOUSEHOLD_IDS = [FIXTURES.households.a, FIXTURES.households.b] as const;
const IMPORTED_ROWS = 10_000;
const MANUAL_ROWS = 100;
const OTHER_TENANT_ROWS = 100;
const INSERT_CHUNK = 500;

const contextA: FinancialContext = {
  userId: "00000000-0000-7000-8000-00000011e101",
  householdId: FIXTURES.households.a,
};

function databaseOrThrow(database: Database | undefined): Database {
  if (!database) {
    throw new Error("O banco de integração T11 não foi inicializado.");
  }
  return database;
}

function eventId(household: "a" | "b", index: number): string {
  const prefix = household === "a" ? "110101" : "110102";
  return `00000000-0000-7000-8000-${prefix}${index.toString(16).padStart(6, "0")}`;
}

function entryId(household: "a" | "b", index: number): string {
  const prefix = household === "a" ? "110201" : "110202";
  return `00000000-0000-7000-8000-${prefix}${index.toString(16).padStart(6, "0")}`;
}

function itemId(household: "a" | "b", index: number): string {
  const prefix = household === "a" ? "110301" : "110302";
  return `00000000-0000-7000-8000-${prefix}${index.toString(16).padStart(6, "0")}`;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    result.push(values.slice(start, start + size));
  }
  return result;
}

async function insertChunks<T>(
  values: readonly T[],
  insert: (values: T[]) => Promise<unknown>,
): Promise<void> {
  for (const valuesChunk of chunk(values, INSERT_CHUNK)) {
    await insert(valuesChunk);
  }
}

async function cleanup(database: Database): Promise<void> {
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
  await database.delete(households).where(inArray(households.id, HOUSEHOLD_IDS));
}

function importRowCount(household: "a" | "b"): number {
  return household === "a" ? IMPORTED_ROWS : OTHER_TENANT_ROWS;
}

async function seed(database: Database): Promise<void> {
  await database.insert(households).values([
    { id: FIXTURES.households.a, name: "T11 synthetic household A" },
    { id: FIXTURES.households.b, name: "T11 synthetic household B" },
  ]);
  await database.insert(accounts).values([
    {
      id: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      name: "T11 synthetic account A",
      type: "CHECKING",
    },
    {
      id: FIXTURES.accounts.b,
      householdId: FIXTURES.households.b,
      name: "T11 synthetic account B",
      type: "CHECKING",
    },
  ]);
  await database.insert(categories).values([
    {
      id: FIXTURES.categories.a,
      householdId: FIXTURES.households.a,
      name: "T11 synthetic category A",
      kind: "EXPENSE",
    },
    {
      id: FIXTURES.categories.b,
      householdId: FIXTURES.households.b,
      name: "T11 synthetic category B",
      kind: "EXPENSE",
    },
  ]);

  const createdAt = new Date("2026-08-30T10:00:00.000Z");
  await database.insert(transactionImports).values([
    {
      id: FIXTURES.imports.a,
      householdId: FIXTURES.households.a,
      accountId: FIXTURES.accounts.a,
      formatVersion: "s04-csv-v1",
      datasetFingerprint: "1".repeat(64),
      sourceFileSizeBytes: 1_000_000,
      sourceHasBom: false,
      sourceColumns: "WITH_EXTERNAL_ID",
      processedRows: IMPORTED_ROWS,
      validRows: IMPORTED_ROWS,
      invalidRows: 0,
      ignoredDuplicateRows: 0,
      importedRows: IMPORTED_ROWS,
      errors: [],
      status: "CONFIRMED",
      createdAt,
      confirmedAt: new Date("2026-08-30T10:01:00.000Z"),
    },
    {
      id: FIXTURES.imports.b,
      householdId: FIXTURES.households.b,
      accountId: FIXTURES.accounts.b,
      formatVersion: "s04-csv-v1",
      datasetFingerprint: "2".repeat(64),
      sourceFileSizeBytes: 10_000,
      sourceHasBom: false,
      sourceColumns: "BASE",
      processedRows: OTHER_TENANT_ROWS,
      validRows: OTHER_TENANT_ROWS,
      invalidRows: 0,
      ignoredDuplicateRows: 0,
      importedRows: OTHER_TENANT_ROWS,
      errors: [],
      status: "CONFIRMED",
      createdAt,
      confirmedAt: new Date("2026-08-30T10:01:00.000Z"),
    },
  ]);

  const events: Array<typeof financialEvents.$inferInsert> = [];
  const entries: Array<typeof accountEntries.$inferInsert> = [];
  const items: Array<typeof transactionImportItems.$inferInsert> = [];

  for (const household of ["a", "b"] as const) {
    const householdId = FIXTURES.households[household];
    const accountId = FIXTURES.accounts[household];
    const categoryId = FIXTURES.categories[household];
    const importId = FIXTURES.imports[household];
    const rows = importRowCount(household);

    for (let index = 0; index < rows; index += 1) {
      const id = eventId(household, index);
      const pending = index % 3 === 0;
      const occurredOn = `2026-${String((index % 12) + 1).padStart(2, "0")}-${String(
        (index % 27) + 1,
      ).padStart(2, "0")}`;
      events.push({
        id,
        householdId,
        kind: "EXPENSE",
        status: "POSTED",
        origin: "IMPORT",
        amountCents: BigInt(100 + (index % 900)),
        occurredOn,
        description:
          index === 7
            ? "T11 synthetic search marker"
            : `T11 imported synthetic ${index}`,
        categoryId: pending ? null : categoryId,
      });
      entries.push({
        id: entryId(household, index),
        financialEventId: id,
        accountId,
        householdId,
        amountCents: BigInt(-(100 + (index % 900))),
        status: "POSTED",
        postedOn: occurredOn,
      });
      items.push({
        id: itemId(household, index),
        householdId,
        importId,
        rowNumber: index + 2,
        externalId: `t11-ext-${household}-${index}`,
        financialEventId: id,
      });
    }
  }

  for (let index = 0; index < MANUAL_ROWS; index += 1) {
    const id = `00000000-0000-7000-8000-110401${index
      .toString(16)
      .padStart(6, "0")}`;
    const occurredOn = `2026-08-${String((index % 27) + 1).padStart(2, "0")}`;
    events.push({
      id,
      householdId: FIXTURES.households.a,
      kind: "EXPENSE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(2_000 + index),
      occurredOn,
      description: `T11 manual synthetic ${index}`,
      categoryId: index % 2 === 0 ? null : FIXTURES.categories.a,
    });
    entries.push({
      id: `00000000-0000-7000-8000-110402${index
        .toString(16)
        .padStart(6, "0")}`,
      financialEventId: id,
      accountId: FIXTURES.accounts.a,
      householdId: FIXTURES.households.a,
      amountCents: BigInt(-(2_000 + index)),
      status: "POSTED",
      postedOn: occurredOn,
    });
  }

  await insertChunks(events, async (values) => {
    await database.insert(financialEvents).values(values);
  });
  await insertChunks(entries, async (values) => {
    await database.insert(accountEntries).values(values);
  });
  await insertChunks(items, async (values) => {
    await database.insert(transactionImportItems).values(values);
  });
  await database.execute(sql`analyze financial_events`);
  await database.execute(sql`analyze account_entries`);
  await database.execute(sql`analyze transaction_import_items`);
  await database.execute(sql`analyze transaction_imports`);
}

type ExplainRoot = {
  Plan?: ExplainPlan;
  "Planning Time"?: unknown;
  "Execution Time"?: unknown;
};

type ExplainPlan = {
  "Node Type"?: unknown;
  Plans?: ExplainPlan[];
};

function explainRoot(rows: Array<Record<string, unknown>>): ExplainRoot {
  const value = rows[0]?.["QUERY PLAN"];
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed[0] || typeof parsed[0] !== "object") {
      throw new Error("O PostgreSQL retornou um EXPLAIN JSON inválido.");
    }
    return parsed[0] as ExplainRoot;
  }
  if (Array.isArray(value) && value[0] && typeof value[0] === "object") {
    return value[0] as ExplainRoot;
  }
  if (value && typeof value === "object") {
    return value as ExplainRoot;
  }
  throw new Error("O PostgreSQL não retornou um EXPLAIN JSON.");
}

function planNodeTypes(plan: ExplainPlan | undefined): string[] {
  if (!plan) {
    return [];
  }
  return [
    typeof plan["Node Type"] === "string" ? plan["Node Type"] : "unknown",
    ...(plan.Plans ?? []).flatMap((child) => planNodeTypes(child)),
  ];
}

function explainSelect(
  database: Database,
  predicates: SQL<unknown>,
): Promise<Array<Record<string, unknown>>> {
  return database
    .execute(sql`
      explain (analyze, buffers, format json)
      select fe.id, fe.occurred_on, ae.account_id, ti.import_id
        from financial_events as fe
        inner join account_entries as ae
          on ae.financial_event_id = fe.id
         and ae.household_id = fe.household_id
        inner join accounts as account
          on account.id = ae.account_id
         and account.household_id = ae.household_id
        left join categories as category
          on category.id = fe.category_id
         and category.household_id = fe.household_id
        left join transaction_import_items as ti
          on ti.financial_event_id = fe.id
         and ti.household_id = fe.household_id
        left join transaction_imports as batch
          on batch.id = ti.import_id
         and batch.household_id = ti.household_id
       where ${predicates}
       order by fe.occurred_on desc, fe.id desc
       limit 51
    `)
    .then((result) => result.rows as Array<Record<string, unknown>>);
}

integration("T11 review volume and plan regression PostgreSQL", () => {
  let database: Database | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Defina DATABASE_URL apontando para PostgreSQL descartável antes de executar T11_INTEGRATION=1.",
      );
    }
    await applyMigrations();
    database = getDb();
  }, 120_000);

  beforeEach(async () => {
    const db = databaseOrThrow(database);
    await cleanup(db);
    await seed(db);
  }, 120_000);

  afterAll(async () => {
    if (database) {
      await cleanup(database);
    }
    await closeDb();
  }, 120_000);

  it(
    "keeps the real review reads tenant-scoped and keyset-paginated at volume",
    async () => {
      const db = databaseOrThrow(database);
      const firstStarted = performance.now();
      const first = await listReviewableTransactionsForContext(db, contextA, {
        limit: 50,
      });
      const firstDurationMs = performance.now() - firstStarted;
      expect(first.items).toHaveLength(50);
      expect(first.pageInfo.hasNextPage).toBe(true);
      expect(first.items.every((item) => item.householdId === contextA.householdId)).toBe(
        true,
      );
      expect(first.items.every((item) => item.source.origin === "IMPORT" || item.source.origin === "MANUAL")).toBe(
        true,
      );

      const nextStarted = performance.now();
      const next = await listReviewableTransactionsForContext(db, contextA, {
        limit: 50,
        cursor: first.pageInfo.nextCursor ?? undefined,
      });
      const nextDurationMs = performance.now() - nextStarted;
      expect(next.items).toHaveLength(50);
      expect(
        new Set([...first.items, ...next.items].map((item) => item.id)).size,
      ).toBe(100);
      expect(next.items.every((item) => item.householdId === contextA.householdId)).toBe(
        true,
      );

      const pendingStarted = performance.now();
      const pending = await listReviewableTransactionsForContext(db, contextA, {
        review: "NEEDS_REVIEW",
        limit: 50,
      });
      const pendingDurationMs = performance.now() - pendingStarted;
      expect(pending.items).toHaveLength(50);
      expect(pending.items.every((item) => item.needsReview)).toBe(true);

      const summaryStarted = performance.now();
      const summary = await getTransactionReviewSummaryForContext(db, contextA);
      const summaryDurationMs = performance.now() - summaryStarted;
      expect(summary.needsReviewCount).toBe(
        Math.ceil(IMPORTED_ROWS / 3) + Math.ceil(MANUAL_ROWS / 2),
      );

      const report = {
        dataset: {
          householdAImported: IMPORTED_ROWS,
          householdAManual: MANUAL_ROWS,
          householdBImported: OTHER_TENANT_ROWS,
        },
        rows: {
          firstPage: first.items.length,
          nextPage: next.items.length,
          pendingPage: pending.items.length,
          pendingSummary: summary.needsReviewCount,
        },
        durationsMs: {
          firstPage: Number(firstDurationMs.toFixed(2)),
          nextPage: Number(nextDurationMs.toFixed(2)),
          pendingPage: Number(pendingDurationMs.toFixed(2)),
          summary: Number(summaryDurationMs.toFixed(2)),
        },
      };
      if (process.env.T11_PRINT_PERF === "1") {
        console.info(`[T11 performance] ${JSON.stringify(report)}`);
      }
    },
    120_000,
  );

  it(
    "captures JSON plans for first page, pending, account/date, keyset and search",
    async () => {
      const db = databaseOrThrow(database);
      const syntheticTenant = FIXTURES.households.a;
      const basePredicates = sql`
        fe.household_id = ${syntheticTenant}
        and fe.kind in ('EXPENSE', 'INCOME')
        and fe.origin in ('MANUAL', 'IMPORT')
      `;

      const firstPage = await explainSelect(db, basePredicates);
      const pending = await explainSelect(
        db,
        sql`${basePredicates}
          and fe.status = 'POSTED'
          and fe.category_id is null`,
      );
      const accountAndDate = await explainSelect(
        db,
        sql`${basePredicates}
          and ae.account_id = ${FIXTURES.accounts.a}
          and fe.occurred_on between '2026-01-01' and '2026-12-31'`,
      );
      const keyset = await explainSelect(
        db,
        sql`${basePredicates}
          and (
            fe.occurred_on < '2026-07-01'
            or (
              fe.occurred_on = '2026-07-01'
              and fe.id < ${eventId("a", 7_000)}
            )
          )`,
      );
      const search = await explainSelect(
        db,
        sql`${basePredicates}
          and fe.description ilike '%synthetic search marker%'`,
      );

      const plans = {
        firstPage: explainRoot(firstPage),
        pending: explainRoot(pending),
        accountAndDate: explainRoot(accountAndDate),
        keyset: explainRoot(keyset),
        search: explainRoot(search),
      };
      for (const root of Object.values(plans)) {
        expect(root.Plan).toBeDefined();
        expect(root["Planning Time"]).toEqual(expect.any(Number));
        expect(root["Execution Time"]).toEqual(expect.any(Number));
        expect(planNodeTypes(root.Plan)).toContain("Limit");
      }
      expect(planNodeTypes(plans.keyset.Plan)).not.toContain("Offset");
      expect(planNodeTypes(plans.search.Plan)).toContain("Limit");

      if (process.env.T11_PRINT_PERF === "1") {
        console.info(
          `[T11 plans] ${JSON.stringify(
            Object.fromEntries(
              Object.entries(plans).map(([name, root]) => {
                return [name, {
                  planningMs: root["Planning Time"],
                  executionMs: root["Execution Time"],
                  nodes: planNodeTypes(root.Plan),
                }];
              }),
            ),
          )}`,
        );
      }
    },
    120_000,
  );
});
