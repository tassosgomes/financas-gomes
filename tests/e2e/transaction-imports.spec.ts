import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";

const e2eEmail = process.env.E2E_TEST_AUTH_EMAIL ?? "e2e-auth@example.test";
const e2eDatabaseURL =
  process.env.E2E_DATABASE_URL?.trim() ||
  "postgresql://postgres:postgres@localhost:5433/financas_gomes_test";

const mixedFixture =
  "tests/fixtures/s04-importacao-csv/rows/mixed-valid-invalid.csv";
const invalidHeaderFixture =
  "tests/fixtures/s04-importacao-csv/structural/invalid-header.csv";

interface ImportEvidence {
  imports: number;
  importedRows: number;
  items: number;
  events: number;
  entries: number;
}

interface AccountRow {
  id: string;
}

async function withClient<T>(operation: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: e2eDatabaseURL });
  await client.connect();

  try {
    return await operation(client);
  } finally {
    await client.end();
  }
}

async function findAccountId(name: string): Promise<string> {
  let accountId: string | undefined;
  await expect
    .poll(
      async () => {
        accountId = await withClient(async (client) => {
          const result = await client.query<AccountRow>(
            `
              SELECT a.id::text AS id
              FROM accounts AS a
              INNER JOIN household_members AS hm
                ON hm.household_id = a.household_id
              INNER JOIN "user" AS u ON u.id = hm.user_id
              WHERE a.name = $1 AND u.email = $2
              LIMIT 1
            `,
            [name, e2eEmail],
          );
          return result.rows[0]?.id;
        });
        return accountId;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();

  if (!accountId) {
    throw new Error("A conta E2E não foi persistida.");
  }
  return accountId;
}

async function readImportEvidence(accountId: string): Promise<ImportEvidence> {
  return withClient(async (client) => {
    const result = await client.query<ImportEvidence>(
      `
        SELECT
          (
            SELECT COUNT(*)::int
            FROM transaction_imports
            WHERE account_id = $1::uuid
          ) AS imports,
          (
            SELECT COALESCE(SUM(imported_rows), 0)::int
            FROM transaction_imports
            WHERE account_id = $1::uuid
          ) AS "importedRows",
          (
            SELECT COUNT(*)::int
            FROM transaction_import_items AS ti
            INNER JOIN transaction_imports AS i ON i.id = ti.import_id
            WHERE i.account_id = $1::uuid
          ) AS items,
          (
            SELECT COUNT(*)::int
            FROM financial_events AS e
            INNER JOIN transaction_import_items AS ti
              ON ti.financial_event_id = e.id
             AND ti.household_id = e.household_id
            INNER JOIN transaction_imports AS i
              ON i.id = ti.import_id
             AND i.household_id = ti.household_id
            WHERE i.account_id = $1::uuid AND e.origin = 'IMPORT'
          ) AS events,
          (
            SELECT COUNT(*)::int
            FROM account_entries AS ae
            INNER JOIN transaction_import_items AS ti
              ON ti.financial_event_id = ae.financial_event_id
             AND ti.household_id = ae.household_id
            INNER JOIN transaction_imports AS i
              ON i.id = ti.import_id
             AND i.household_id = ti.household_id
            WHERE i.account_id = $1::uuid AND ae.account_id = $1::uuid
          ) AS entries
      `,
      [accountId],
    );

    const row = result.rows[0];
    return {
      imports: Number(row?.imports ?? 0),
      importedRows: Number(row?.importedRows ?? 0),
      items: Number(row?.items ?? 0),
      events: Number(row?.events ?? 0),
      entries: Number(row?.entries ?? 0),
    };
  });
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Continuar com Google" }).click();
  await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Seu espaço financeiro" }),
  ).toBeVisible();
}

async function createAccount(page: Page, name: string): Promise<string> {
  await page.goto("/accounts");
  await expect(page.getByTestId("accounts-screen")).toBeVisible();
  await page.waitForTimeout(500);

  await page.getByTestId("accounts-create-button").click();
  await expect(page.getByTestId("account-form-create")).toBeVisible();
  await page.getByTestId("account-name-input").fill(name);
  await page
    .getByTestId("account-form")
    .getByRole("button", { name: "Criar conta", exact: true })
    .click();

  await expect(page.getByTestId("accounts-success")).toContainText(
    "Conta criada.",
  );
  await expect(
    page.getByTestId("accounts-table").getByText(name, { exact: true }),
  ).toBeVisible();

  return findAccountId(name);
}

async function uploadAndPreview(
  page: Page,
  accountId: string,
  fixture: string,
): Promise<void> {
  await page.goto("/transactions/import");
  await expect(page.getByTestId("csv-import-screen")).toBeVisible();
  const accountSelector = page.getByTestId("csv-import-account-selector-input");
  await accountSelector.selectOption(accountId);
  await expect(accountSelector).toHaveValue(accountId);
  await page
    .getByTestId("csv-file-picker-input")
    .setInputFiles(fixture);
  await page.getByTestId("csv-import-preview-submit").click();
  await expect(page.getByTestId("csv-import-preview")).toBeVisible();
}

test.describe("S04 importação CSV", () => {
  test("executa conta → upload → preview → confirmação → resultado → transações e reenvio idempotente", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const suffix = Date.now().toString(36);
    const accountName = `Conta importação E2E ${suffix}`;
    await signIn(page);
    const accountId = await createAccount(page, accountName);

    const before = await readImportEvidence(accountId);
    expect(before).toEqual({
      imports: 0,
      importedRows: 0,
      items: 0,
      events: 0,
      entries: 0,
    });

    await uploadAndPreview(page, accountId, mixedFixture);
    const preview = page.getByTestId("csv-import-preview");
    await expect(preview.getByTestId("csv-import-preview-summary-counts")).toContainText(
      "3",
    );
    await expect(preview.getByTestId("csv-import-preview-summary-counts")).toContainText(
      "2",
    );
    await expect(preview.getByTestId("csv-import-preview-summary-errors")).toContainText(
      "Linha 3",
    );
    await expect(page.getByTestId("csv-import-confirmation-submit")).toBeDisabled();
    await page.getByTestId("csv-import-acknowledged").check();
    await expect(page.getByTestId("csv-import-confirmation-submit")).toBeEnabled();
    await page.getByTestId("csv-import-confirmation-submit").click();

    const result = page.getByTestId("csv-import-result");
    await expect(result).toBeVisible();
    await expect(result.getByTestId("csv-import-result-status")).toContainText(
      "Importação concluída",
    );
    await expect(result.getByTestId("csv-import-result-created-copy")).toContainText(
      "Criadas 2 transações",
    );
    await expect(result.getByTestId("csv-import-result-created-copy")).toContainText(
      "1 linha(s) permaneceram com erro",
    );
    await expect(result.getByTestId("csv-import-result-summary-errors")).toContainText(
      "Linha 3",
    );

    const reportHref = await result
      .getByTestId("csv-import-result-report-link")
      .getAttribute("href");
    expect(reportHref).toMatch(/^\/transactions\/import\?importId=[0-9a-f-]+$/u);

    const afterImport = await readImportEvidence(accountId);
    expect(afterImport).toEqual({
      imports: 1,
      importedRows: 2,
      items: 2,
      events: 2,
      entries: 2,
    });

    await page.getByTestId("csv-import-result-report-link").click();
    await expect(page).toHaveURL(/\/transactions\/import\?importId=/);
    await expect(page.getByTestId("csv-import-result")).toBeVisible();
    await expect(page.getByTestId("csv-import-result-created-copy")).toContainText(
      "Criadas 2 transações",
    );

    const transactionsLink = page.getByTestId("csv-import-result-transactions");
    const transactionsHref = await transactionsLink.getAttribute("href");
    expect(transactionsHref).toContain(`accountId=${accountId}`);
    expect(transactionsHref).toContain("from=2026-08-29");
    expect(transactionsHref).toContain("to=2026-08-30");
    await transactionsLink.click();
    await expect(page).toHaveURL(
      new RegExp(
        `/transactions\\?accountId=${accountId}&from=2026-08-29&to=2026-08-30$`,
        "u",
      ),
    );
    await expect(page.getByTestId("transactions-route")).toBeVisible();
    await expect(page.locator("#transactions-account")).toHaveValue(accountId);
    await expect(page.locator("#transactions-from")).toHaveValue("2026-08-29");
    await expect(page.locator("#transactions-to")).toHaveValue("2026-08-30");

    // T11 intentionally links to S03's currently manual-only listing. The
    // account/date context is asserted here; imported rows remain proven by
    // the tenant-scoped aggregate below until S03 exposes origin=IMPORT.
    await page.goto("/transactions/import");
    await expect(page.getByTestId("csv-import-screen")).toBeVisible();

    await uploadAndPreview(page, accountId, mixedFixture);
    const duplicatePreview = page.getByTestId("csv-import-preview");
    await expect(
      duplicatePreview.getByTestId("csv-import-preview-summary-block-message"),
    ).toContainText("Este conjunto já foi importado");
    await expect(page.getByTestId("csv-import-acknowledged")).toBeDisabled();
    await expect(page.getByTestId("csv-import-confirmation-submit")).toBeDisabled();
    await expect(duplicatePreview).toContainText("Nenhum novo lançamento será criado");

    const afterDuplicatePreview = await readImportEvidence(accountId);
    expect(afterDuplicatePreview).toEqual(afterImport);
  });

  test("rejeita arquivo estruturalmente inválido sem prévia, staging ou lançamento", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const suffix = Date.now().toString(36);
    const accountName = `Conta arquivo inválido E2E ${suffix}`;
    await signIn(page);
    const accountId = await createAccount(page, accountName);

    await page.goto("/transactions/import");
    await expect(page.getByTestId("csv-import-screen")).toBeVisible();
    await page
      .getByTestId("csv-file-picker-input")
      .setInputFiles(invalidHeaderFixture);
    await page.getByTestId("csv-import-preview-submit").click();

    const error = page.getByTestId("csv-file-picker-state");
    await expect(error).toBeVisible();
    await expect(error).toContainText("O cabeçalho contém uma coluna desconhecida");
    await expect(page.getByTestId("csv-import-preview")).toHaveCount(0);
    await expect(page.getByTestId("csv-import-result")).toHaveCount(0);

    await expect
      .poll(() => readImportEvidence(accountId), { timeout: 15_000 })
      .toEqual({
        imports: 0,
        importedRows: 0,
        items: 0,
        events: 0,
        entries: 0,
      });
  });
});
