import { Client } from "pg";

export const S09_E2E_EMAIL_PATTERN = /^e2e-[a-z0-9-]+@example\.test$/u;

const e2eDatabaseURL =
  process.env.E2E_DATABASE_URL?.trim() ||
  "postgresql://postgres:postgres@localhost:5433/financas_gomes_test";

export interface S09E2EBudgetFixture {
  readonly runId: string;
  readonly primaryEmail: string;
  readonly secondaryEmail: string;
  readonly foreignCategoryName: string;
  readonly primaryCategoryName: string;
  readonly destinationCategoryName: string;
  readonly primaryBudgetName: string;
  readonly destinationBudgetName: string;
  readonly goalAmountCents: string;
  readonly firstContributionCents: string;
  readonly secondContributionCents: string;
  readonly withdrawalCents: string;
  readonly transferCents: string;
  readonly expectedSourceBalanceCents: string;
  readonly expectedDestinationBalanceCents: string;
}

function normalizedRunId(runId: string): string {
  const value = runId.toLowerCase().replace(/[^a-z0-9-]/gu, "-");
  return value.replace(/-+/gu, "-").replace(/^-|-$/gu, "") || "run";
}

export function createS09E2EBudgetFixture(runId: string): S09E2EBudgetFixture {
  const suffix = normalizedRunId(runId);
  return {
    runId: suffix,
    primaryEmail: `e2e-s09-a-${suffix}@example.test`,
    secondaryEmail: `e2e-s09-b-${suffix}@example.test`,
    foreignCategoryName: `T14 A-only ${suffix}`,
    primaryCategoryName: `T14 Reserva ${suffix}`,
    destinationCategoryName: `T14 Emergência ${suffix}`,
    primaryBudgetName: `T14 Caixinha ${suffix}`,
    destinationBudgetName: `T14 Destino ${suffix}`,
    goalAmountCents: "100000",
    firstContributionCents: "10000",
    secondContributionCents: "5000",
    withdrawalCents: "3000",
    transferCents: "2500",
    expectedSourceBalanceCents: "9500",
    expectedDestinationBalanceCents: "2500",
  };
}

export function createS09E2ERunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface S09E2EFinancialCounts {
  readonly financialEvents: number;
  readonly accountEntries: number;
}

/** Read-only assertion helper for the no-bank-double-counting contract. */
export async function readS09E2EFinancialCounts(
  email: string,
): Promise<S09E2EFinancialCounts> {
  const client = new Client({ connectionString: e2eDatabaseURL });
  await client.connect();

  try {
    const result = await client.query<{
      financialEvents: number;
      accountEntries: number;
    }>(
      `
        SELECT
          COUNT(DISTINCT fe.id)::int AS "financialEvents",
          COUNT(DISTINCT ae.id)::int AS "accountEntries"
        FROM household_members AS hm
        INNER JOIN "user" AS u ON u.id = hm.user_id
        LEFT JOIN financial_events AS fe ON fe.household_id = hm.household_id
        LEFT JOIN account_entries AS ae ON ae.household_id = hm.household_id
        WHERE u.email = $1
      `,
      [email],
    );
    const row = result.rows[0];
    return {
      financialEvents: Number(row?.financialEvents ?? 0),
      accountEntries: Number(row?.accountEntries ?? 0),
    };
  } finally {
    await client.end();
  }
}

/**
 * Deletes only households provisioned by this fixture's synthetic identities.
 * The browser journey itself never seeds rows or uses an administrative
 * context; this cleanup is the sole direct database operation in T14.
 */
export async function cleanupS09E2EHouseholds(
  emails: readonly string[],
): Promise<void> {
  if (emails.length === 0) return;

  const client = new Client({ connectionString: e2eDatabaseURL });
  await client.connect();

  try {
    const households = await client.query<{ id: string }>(
      `
        SELECT DISTINCT hm.household_id AS id
        FROM household_members AS hm
        INNER JOIN "user" AS u ON u.id = hm.user_id
        WHERE u.email = ANY($1::text[])
      `,
      [emails],
    );
    const householdIds = households.rows.map((row) => row.id);
    if (householdIds.length === 0) return;

    await client.query("BEGIN");
    // T06 deliberately guards this table as append-only in production. The
    // test database cleanup is the one scoped maintenance operation allowed
    // to remove rows, and the trigger is disabled only inside this transaction
    // before being enabled again below.
    await client.query(
      "ALTER TABLE budget_movements DISABLE TRIGGER budget_movements_append_only_guard",
    );
    await client.query(
      "DELETE FROM budget_movements WHERE household_id = ANY($1::uuid[])",
      [householdIds],
    );
    await client.query(
      "DELETE FROM budget_allocation_rules WHERE household_id = ANY($1::uuid[])",
      [householdIds],
    );
    await client.query(
      "DELETE FROM budgets WHERE household_id = ANY($1::uuid[])",
      [householdIds],
    );
    await client.query(
      "UPDATE categories SET parent_id = NULL WHERE household_id = ANY($1::uuid[])",
      [householdIds],
    );
    await client.query(
      "DELETE FROM categories WHERE household_id = ANY($1::uuid[])",
      [householdIds],
    );
    await client.query(
      "DELETE FROM application_commands WHERE household_id = ANY($1::uuid[])",
      [householdIds],
    );
    await client.query(
      "DELETE FROM protected_resources WHERE household_id = ANY($1::uuid[])",
      [householdIds],
    );
    await client.query(
      "DELETE FROM spendable_settings WHERE household_id = ANY($1::uuid[])",
      [householdIds],
    );
    await client.query(
      "DELETE FROM household_invites WHERE household_id = ANY($1::uuid[])",
      [householdIds],
    );
    await client.query(
      `
        DELETE FROM session
        WHERE user_id IN (SELECT id FROM "user" WHERE email = ANY($1::text[]))
      `,
      [emails],
    );
    await client.query(
      `
        DELETE FROM "account"
        WHERE user_id IN (SELECT id FROM "user" WHERE email = ANY($1::text[]))
      `,
      [emails],
    );
    await client.query(
      `DELETE FROM verification WHERE identifier = ANY($1::text[])`,
      [emails],
    );
    await client.query(
      "DELETE FROM household_members WHERE household_id = ANY($1::uuid[])",
      [householdIds],
    );
    await client.query(
      "DELETE FROM households WHERE id = ANY($1::uuid[])",
      [householdIds],
    );
    await client.query(
      'DELETE FROM "user" WHERE email = ANY($1::text[])',
      [emails],
    );
    await client.query(
      "ALTER TABLE budget_movements ENABLE TRIGGER budget_movements_append_only_guard",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
