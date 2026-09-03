import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";

const e2eEmail = process.env.E2E_TEST_AUTH_EMAIL ?? "e2e-auth@example.test";
const e2eDatabaseURL =
  process.env.E2E_DATABASE_URL?.trim() ||
  "postgresql://postgres:postgres@localhost:5433/financas_gomes_test";

const mixedFixture =
  "tests/fixtures/s04-importacao-csv/rows/mixed-valid-invalid.csv";

interface ReviewFixture {
  accountId: string;
  accountName: string;
  expenseCategoryName: string;
  incomeCategoryName: string;
}

interface ManualReviewScenario {
  amountCents: string;
  description: string;
  kind: "EXPENSE" | "INCOME";
  occurredOn: string;
}

interface EventEvidence {
  categoryId: string | null;
  entryCount: number;
  eventId: string;
  eventCount: number;
  origin: string;
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
          const result = await client.query<{ id: string }>(
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

async function readEventEvidence(
  accountId: string,
  description: string,
): Promise<EventEvidence[]> {
  return withClient(async (client) => {
    const result = await client.query<EventEvidence>(
      `
        SELECT
          e.id::text AS "eventId",
          e.origin::text AS origin,
          e.category_id::text AS "categoryId",
          COUNT(DISTINCT e.id)::int AS "eventCount",
          COUNT(ae.id)::int AS "entryCount"
        FROM financial_events AS e
        INNER JOIN account_entries AS ae
          ON ae.financial_event_id = e.id
        WHERE ae.account_id = $1::uuid AND e.description = $2
        GROUP BY e.id, e.origin, e.category_id
        ORDER BY e.id
      `,
      [accountId, description],
    );
    return result.rows;
  });
}

function shiftIsoDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function currentBusinessDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Fortaleza",
    year: "numeric",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function signIn(page: Page): Promise<void> {
  page.setDefaultNavigationTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Continuar com Google" }).click();
  await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Seu espaço financeiro" }),
  ).toBeVisible();
}

async function createAccount(page: Page, accountName: string): Promise<string> {
  await page.goto("/accounts");
  await expect(page).toHaveURL(/\/accounts\/?$/u);
  await expect(page.getByTestId("accounts-screen")).toBeVisible();
  const createButton = page.getByTestId("accounts-create-button");
  const createForm = page.getByTestId("account-form-create");

  await expect(createButton).toBeVisible();
  await expect(createButton).toBeEnabled();

  // The accounts screen is server-rendered before its client boundary is
  // interactive. A first click can therefore land before hydration and leave
  // the form closed. Give hydration a turn and retry once from a fresh
  // document so account creation remains an explicit application flow.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.waitForTimeout(500);
    await createButton.click();

    try {
      await expect(createForm).toBeVisible({ timeout: 5_000 });
      return submitAccountForm(page, accountName);
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/accounts\/?$/u);
      await expect(page.getByTestId("accounts-screen")).toBeVisible();
      await expect(createButton).toBeVisible();
      await expect(createButton).toBeEnabled();
    }
  }
  throw new Error("O formulário de criação da conta não foi hidratado.");
}

async function submitAccountForm(
  page: Page,
  accountName: string,
): Promise<string> {
  await page.getByTestId("account-name-input").fill(accountName);
  await page
    .getByTestId("account-form")
    .getByRole("button", { name: "Criar conta", exact: true })
    .click();
  await expect(page.getByTestId("accounts-success")).toContainText(
    "Conta criada.",
  );
  await expect(
    page.getByTestId("accounts-table").getByText(accountName, { exact: true }),
  ).toBeVisible();
  return findAccountId(accountName);
}

async function createCategory(
  page: Page,
  categoryName: string,
  kind: "EXPENSE" | "INCOME",
): Promise<void> {
  await page.goto("/settings/categories");
  await expect(page.getByTestId("categories-screen")).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByTestId("categories-create-button").click();
  await expect(page.getByTestId("category-form-create")).toBeVisible();
  await page.getByTestId("category-name-input").fill(categoryName);
  await page.getByTestId("category-kind-input").selectOption(kind);
  await page
    .getByTestId("category-form")
    .getByRole("button", { name: "Criar categoria", exact: true })
    .click();
  await expect(page.getByTestId("categories-success")).toContainText(
    "Categoria criada.",
  );
  await expect(
    page.getByTestId("categories-table").getByText(categoryName, { exact: true }),
  ).toBeVisible();
}

async function importFixture(page: Page, fixture: ReviewFixture): Promise<void> {
  await page.goto("/transactions/import");
  await expect(page.getByTestId("csv-import-screen")).toBeVisible();
  await page
    .getByTestId("csv-import-account-selector-input")
    .selectOption(fixture.accountId);
  await page.getByTestId("csv-file-picker-input").setInputFiles(mixedFixture);
  await page.getByTestId("csv-import-preview-submit").click();
  await expect(page.getByTestId("csv-import-preview")).toBeVisible();
  await expect(
    page.getByTestId("csv-import-preview-summary-counts"),
  ).toContainText("3");
  await expect(page.getByTestId("csv-import-preview-summary-counts")).toContainText(
    "2",
  );
  await page.getByTestId("csv-import-acknowledged").check();
  await page.getByTestId("csv-import-confirmation-submit").click();
  await expect(page.getByTestId("csv-import-result")).toBeVisible();
  await expect(page.getByTestId("csv-import-result-status")).toContainText(
    "Importação concluída",
  );
  await expect(page.getByTestId("csv-import-result-created-copy")).toContainText(
    "Criadas 2 transações",
  );
}

async function createUncategorizedManualTransaction(
  page: Page,
  accountName: string,
  scenario: ManualReviewScenario,
): Promise<void> {
  await page.goto(`/transactions/new?kind=${scenario.kind}`);
  await expect(page.getByTestId("transaction-create-route")).toBeVisible();
  const form = page.getByTestId("transaction-create-form");
  await expect(form).toBeVisible();
  await form.getByTestId("transaction-create-form-amount-input").fill(
    scenario.amountCents,
  );
  const dateInput = form.getByTestId("transaction-create-form-date-input");
  await dateInput.fill(scenario.occurredOn);
  await expect(dateInput).toHaveValue(scenario.occurredOn);
  await form
    .getByTestId("transaction-create-form-description-input")
    .fill(scenario.description);
  await form
    .getByTestId("transaction-create-form-account-input")
    .selectOption({ label: accountName });
  await form
    .getByTestId("transaction-create-form-category-input")
    .selectOption({ label: "Sem categoria" });
  await form.getByTestId("transaction-create-form-submit").click();

  const success = page.getByTestId("transaction-create-success");
  await expect(success).toBeVisible();
  await expect(success).toContainText(scenario.description);
  await expect(
    success.getByRole("link", { name: "Ver lançamentos", exact: true }),
  ).toBeVisible();
}

function desktopReviewTable(page: Page) {
  return page.getByTestId("transactions-review-table");
}

function desktopReviewRow(page: Page, description: string) {
  return desktopReviewTable(page)
    .getByRole("row")
    .filter({ hasText: description });
}

function waitForTransactionAction(page: Page): Promise<unknown> {
  return page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "POST" &&
      new URL(response.url()).pathname.startsWith("/transactions")
    );
  });
}

async function openReviewList(
  page: Page,
  fixture: ReviewFixture,
  search = "Linha",
): Promise<void> {
  await page.goto(
    `/transactions?accountId=${fixture.accountId}&origin=IMPORT&review=NEEDS_REVIEW&search=${encodeURIComponent(search)}`,
  );
  await expect(page).toHaveURL(
    new RegExp(
      `/transactions\\?accountId=${fixture.accountId}.*origin=IMPORT.*review=NEEDS_REVIEW`,
      "u",
    ),
  );
  await expect(page.getByTestId("transactions-route")).toBeVisible();
  await expect(page.getByTestId("transactions-filters")).toBeVisible();
  await expect(page.locator("#transactions-review-origin")).toHaveValue("IMPORT");
  await expect(page.locator("#transactions-review-review")).toHaveValue(
    "NEEDS_REVIEW",
  );
}

test.describe("revisão de transações", () => {
  test("importa, revisa, preserva linhagem, mantém filtros e funciona no mobile", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const suffix = Date.now().toString(36);
    const fixture: ReviewFixture = {
      accountId: "",
      accountName: `Conta revisão E2E ${suffix}`,
      expenseCategoryName: `Categoria revisão despesa ${suffix}`,
      incomeCategoryName: `Categoria revisão receita ${suffix}`,
    };

    await signIn(page);
    fixture.accountId = await createAccount(page, fixture.accountName);
    await createCategory(page, fixture.expenseCategoryName, "EXPENSE");
    await createCategory(page, fixture.incomeCategoryName, "INCOME");
    await importFixture(page, fixture);

    await openReviewList(page, fixture);
    const summaryCount = page.getByTestId("transaction-review-summary-count");
    await expect(summaryCount).toContainText("2");
    await expect(page.getByTestId("transactions-review-count")).toContainText(
      "2 lançamentos nesta página",
    );

    const firstDescription = "Linha válida A";
    const secondDescription = "Linha válida B";
    const firstRow = desktopReviewRow(page, firstDescription);
    const secondRow = desktopReviewRow(page, secondDescription);
    await expect(firstRow).toBeVisible();
    await expect(secondRow).toBeVisible();
    await expect(firstRow.locator('[data-testid$="-origin"]')).toContainText(
      "Importado",
    );
    await expect(firstRow.locator('[data-testid$="-uncategorized"]')).toContainText(
      "Sem categoria",
    );
    await expect(secondRow.locator('[data-testid$="-origin"]')).toContainText(
      "Importado",
    );

    // A positive imported amount is an INCOME; selecting its compatible
    // category removes it from the NEEDS_REVIEW queue without recreating it.
    const firstEditor = firstRow.locator(
      '[data-testid^="review-category-edit-"]',
    );
    await firstEditor.getByRole("combobox").selectOption({
      label: fixture.incomeCategoryName,
    });
    const firstCategoryUpdate = waitForTransactionAction(page);
    await firstEditor
      .getByRole("button", { name: "Salvar categoria", exact: true })
      .click();
    // The successful action immediately calls router.refresh(); that refresh
    // removes this NEEDS_REVIEW row and unmounts its transient feedback. Wait
    // for the action response, then assert the durable queue projection.
    await firstCategoryUpdate;
    await expect(desktopReviewRow(page, firstDescription)).toHaveCount(0);
    await expect(summaryCount).toContainText("1");

    // The remaining imported item exposes the read-only origin contract and
    // its S04 import-lineage projection in the detail screen.
    const secondRowAfterUpdate = desktopReviewRow(page, secondDescription);
    await secondRowAfterUpdate
      .locator('[data-testid^="review-detail-"]')
      .click();
    await expect(page).toHaveURL(
      new RegExp(
        `/transactions/[0-9a-f-]+\\?.*accountId=${fixture.accountId}.*origin=IMPORT.*review=NEEDS_REVIEW`,
        "u",
      ),
    );
    await expect(page.getByTestId("transaction-detail-screen")).toBeVisible();
    await expect(page.getByTestId("review-detail-badges-origin")).toContainText(
      "Importado",
    );
    await expect(page.getByTestId("review-detail-badges-uncategorized")).toContainText(
      "Sem categoria",
    );
    await expect(page.getByTestId("review-history-review-state")).toContainText(
      "Precisa de revisão",
    );
    await expect(page.getByTestId("transaction-source-details-origin")).toContainText(
      "Importado",
    );
    await expect(page.getByTestId("transaction-source-details-row-number")).toHaveText(
      "4",
    );
    await expect(page.getByTestId("transaction-source-details-external-id")).toHaveText(
      "Não informado",
    );
    await expect(page.getByTestId("review-readonly-guidance")).toContainText(
      "Valor, data, conta, tipo, status, origem, lote, linha, identificador externo e entry não podem ser editados",
    );
    await expect(
      page.getByTestId("transaction-detail-edit-form-amount-input"),
    ).toHaveAttribute("readonly", "");
    await expect(
      page.getByTestId("transaction-detail-edit-form-date-input"),
    ).toHaveAttribute("readonly", "");

    const editedDescription = `Linha válida B revisada ${suffix}`;
    const editForm = page.getByTestId("transaction-detail-edit-form");
    await editForm
      .getByTestId("transaction-detail-edit-form-description-input")
      .fill(editedDescription);
    await editForm
      .getByTestId("transaction-detail-edit-form-submit")
      .click();
    await expect(page.getByTestId("review-detail-success")).toContainText(
      "Origem e efeito financeiro preservados.",
    );
    await expect(page.getByRole("heading", { name: editedDescription, exact: true })).toBeVisible();
    await expect(page.getByTestId("transaction-source-details-row-number")).toHaveText(
      "4",
    );
    await expect(page.getByTestId("review-detail-badges-uncategorized")).toContainText(
      "Sem categoria",
    );

    // The detail back link is generated from the canonical query, so the
    // reviewer returns to the same account/origin/review/search context.
    await page.getByTestId("review-detail-back").click();
    await expect(page).toHaveURL(
      new RegExp(
        `/transactions\\?.*accountId=${fixture.accountId}.*origin=IMPORT.*review=NEEDS_REVIEW.*search=Linha`,
        "u",
      ),
    );
    await expect(page.getByTestId("transaction-review-summary-count")).toContainText(
      "1",
    );
    await expect(desktopReviewRow(page, editedDescription)).toBeVisible();

    // Use the expense category on the negative imported row; then remove it
    // again from the ORGANIZED detail to prove the explicit null state returns
    // to the review queue.
    const editedRow = desktopReviewRow(page, editedDescription);
    const editedEditor = editedRow.locator(
      '[data-testid^="review-category-edit-"]',
    );
    await editedEditor.getByRole("combobox").selectOption({
      label: fixture.expenseCategoryName,
    });
    const secondCategoryUpdate = waitForTransactionAction(page);
    await editedEditor
      .getByRole("button", { name: "Salvar categoria", exact: true })
      .click();
    await secondCategoryUpdate;
    await expect(desktopReviewRow(page, editedDescription)).toHaveCount(0);
    await expect(page.getByTestId("transaction-review-summary-count")).toContainText(
      "0",
    );

    await page.goto(
      `/transactions?accountId=${fixture.accountId}&origin=IMPORT&review=ORGANIZED&search=${encodeURIComponent(editedDescription)}`,
    );
    await expect(page.getByTestId("transactions-route")).toBeVisible();
    const organizedRow = desktopReviewRow(page, editedDescription);
    await expect(organizedRow).toBeVisible();
    await organizedRow.locator('[data-testid^="review-detail-"]').click();
    await expect(page.getByTestId("review-detail-badges-status")).toContainText(
      "Organizado",
    );
    const detailQuickEdit = page.getByTestId("review-detail-category-quick-edit");
    await detailQuickEdit.getByRole("combobox").selectOption({ label: "Sem categoria" });
    const detailCategoryUpdate = waitForTransactionAction(page);
    await detailQuickEdit
      .getByRole("button", { name: "Salvar categoria", exact: true })
      .click();
    // The detail quick editor also refreshes immediately after the action, so
    // its success copy is transient. Synchronize on the action response before
    // reloading and assert the category persisted in a fresh server read.
    await detailCategoryUpdate;
    // The quick editor refreshes the route but keeps the detail island alive;
    // a fresh request proves the persisted null state rather than local UI
    // state.
    await page.reload();
    await expect(page.getByTestId("transaction-detail-screen")).toBeVisible();
    await expect(page.getByTestId("review-detail-badges-uncategorized")).toContainText(
      "Sem categoria",
    );
    await expect(page.getByTestId("review-detail-badges-status")).toContainText(
      "Revisar",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await openReviewList(page, fixture, editedDescription);
    await expect(page.getByTestId("transactions-mobile-list")).toBeVisible();
    await expect(page.getByTestId("transactions-table")).toBeHidden();
    await expect(page.getByTestId("transaction-review-summary-count")).toContainText(
      "1",
    );
    const mobileCard = page
      .getByTestId("transactions-review-mobile-list")
      .getByTestId(/review-card-/u);
    await expect(mobileCard).toContainText(editedDescription);
    await mobileCard
      .locator('[data-testid^="review-detail-"]')
      .click();
    await expect(page.getByTestId("transaction-detail-screen")).toBeVisible();
    await expect(page.getByTestId("transaction-source-details")).toBeVisible();
  });

  test("apresenta falha segura, preserva a seleção e permite retry sem duplicar", async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const suffix = Date.now().toString(36);
    const fixture: ReviewFixture = {
      accountId: "",
      accountName: `Conta retry E2E ${suffix}`,
      expenseCategoryName: `Categoria retry despesa ${suffix}`,
      incomeCategoryName: `Categoria retry receita ${suffix}`,
    };
    await signIn(page);
    fixture.accountId = await createAccount(page, fixture.accountName);
    await createCategory(page, fixture.expenseCategoryName, "EXPENSE");
    await createCategory(page, fixture.incomeCategoryName, "INCOME");
    await importFixture(page, fixture);
    await openReviewList(page, fixture, "Linha válida A");

    const row = desktopReviewRow(page, "Linha válida A");
    await expect(row).toBeVisible();
    const editor = row.locator('[data-testid^="review-category-edit-"]');
    const categorySelect = editor.getByRole("combobox");
    await categorySelect.selectOption({ label: fixture.incomeCategoryName });
    const selectedCategoryId = await categorySelect.inputValue();
    const before = await readEventEvidence(fixture.accountId, "Linha válida A");
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      categoryId: null,
      entryCount: 1,
      eventCount: 1,
      origin: "IMPORT",
    });

    let updateAttempts = 0;
    const postBodies: string[] = [];
    await page.route("**/transactions*", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (
        request.method() !== "POST" ||
        !pathname.startsWith("/transactions")
      ) {
        await route.continue();
        return;
      }

      updateAttempts += 1;
      postBodies.push(request.postData() ?? "");
      if (updateAttempts === 1) {
        await route.abort("connectionreset");
        return;
      }
      await route.continue();
    });

    try {
      await editor
        .getByRole("button", { name: "Salvar categoria", exact: true })
        .click();
      const feedback = editor.locator('[data-testid$="-feedback"]');
      await expect(feedback).toContainText(
        "Não foi possível atualizar a categoria. Tente novamente.",
      );
      await expect(feedback).not.toContainText(
        /SQL|postgres|token|commandId|Linha válida/iu,
      );
      await expect(categorySelect).toHaveValue(selectedCategoryId);
      await expect(
        editor.getByRole("button", { name: "Tentar novamente", exact: true }),
      ).toBeVisible();

      const afterFailure = await readEventEvidence(
        fixture.accountId,
        "Linha válida A",
      );
      expect(afterFailure).toEqual(before);

      const retryResponse = waitForTransactionAction(page);
      await editor
        .getByRole("button", { name: "Tentar novamente", exact: true })
        .click();
      await retryResponse;
      await expect(desktopReviewRow(page, "Linha válida A")).toHaveCount(0);

      const afterRetry = await readEventEvidence(
        fixture.accountId,
        "Linha válida A",
      );
      expect(afterRetry).toHaveLength(1);
      expect(afterRetry[0]).toMatchObject({
        categoryId: selectedCategoryId,
        entryCount: 1,
        eventCount: 1,
        origin: "IMPORT",
      });
      expect(updateAttempts).toBe(2);
      expect(postBodies[0]).toBe(postBodies[1]);
    } finally {
      await page.unroute("**/transactions*");
    }
  });

  test("filtra período e tipo e percorre páginas por cursor sem omitir lançamentos", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    const suffix = Date.now().toString(36);
    const accountName = `Conta filtros E2E ${suffix}`;
    const today = currentBusinessDate();
    const scenarios: ManualReviewScenario[] = [
      {
        amountCents: "101",
        description: `Filtro antigo despesa ${suffix}`,
        kind: "EXPENSE",
        occurredOn: shiftIsoDate(today, -2),
      },
      {
        amountCents: "202",
        description: `Filtro meio despesa ${suffix}`,
        kind: "EXPENSE",
        occurredOn: shiftIsoDate(today, -1),
      },
      {
        amountCents: "303",
        description: `Filtro hoje receita ${suffix}`,
        kind: "INCOME",
        occurredOn: today,
      },
    ];

    await signIn(page);
    const accountId = await createAccount(page, accountName);
    for (const scenario of scenarios) {
      await createUncategorizedManualTransaction(page, accountName, scenario);
    }

    const reviewBase =
      `/transactions?accountId=${accountId}&origin=MANUAL&review=NEEDS_REVIEW`;
    const oldScenario = scenarios[0];
    await page.goto(
      `${reviewBase}&from=${oldScenario.occurredOn}&to=${oldScenario.occurredOn}`,
    );
    await expect(page.getByTestId("transactions-route")).toBeVisible();
    await expect(page.locator("#transactions-from")).toHaveValue(
      oldScenario.occurredOn,
    );
    await expect(page.locator("#transactions-to")).toHaveValue(
      oldScenario.occurredOn,
    );
    await expect(page.getByTestId("transactions-review-count")).toHaveText(
      "1 lançamento nesta página",
    );
    await expect(desktopReviewRow(page, oldScenario.description)).toBeVisible();
    await expect(
      desktopReviewRow(page, scenarios[1].description),
    ).toHaveCount(0);
    await expect(desktopReviewRow(page, scenarios[2].description)).toHaveCount(0);

    await page.goto(reviewBase);
    await expect(page.getByTestId("transactions-route")).toBeVisible();
    await page.locator("#transactions-kind").selectOption("INCOME");
    await page.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
    await expect(page).toHaveURL(/kind=INCOME/u);
    await expect(page.getByTestId("transactions-review-count")).toHaveText(
      "1 lançamento nesta página",
    );
    await expect(desktopReviewRow(page, scenarios[2].description)).toBeVisible();
    await expect(desktopReviewRow(page, scenarios[0].description)).toHaveCount(0);
    await expect(desktopReviewRow(page, scenarios[1].description)).toHaveCount(0);

    await page.goto(`${reviewBase}&limit=1`);
    await expect(page.getByTestId("transactions-route")).toBeVisible();
    await expect(page.getByTestId("transactions-review-count")).toHaveText(
      "1 lançamento nesta página",
    );
    await expect(desktopReviewRow(page, scenarios[2].description)).toBeVisible();
    const nextPage = page.getByTestId("transactions-review-next-page");
    await expect(nextPage).toBeVisible();
    const nextHref = await nextPage.getAttribute("href");
    expect(nextHref).toContain(`accountId=${accountId}`);
    expect(nextHref).toContain("origin=MANUAL");
    expect(nextHref).toContain("review=NEEDS_REVIEW");
    expect(nextHref).toContain("limit=1");
    expect(nextHref).toContain("cursor=");

    await nextPage.click();
    await expect(page).toHaveURL(/cursor=/u);
    await expect(page.getByTestId("transactions-review-count")).toHaveText(
      "1 lançamento nesta página",
    );
    await expect(desktopReviewRow(page, scenarios[1].description)).toBeVisible();
    await expect(desktopReviewRow(page, scenarios[2].description)).toHaveCount(0);
    await expect(page.getByTestId("transactions-review-next-page")).toBeVisible();

    await page.getByTestId("transactions-review-next-page").click();
    await expect(page).toHaveURL(/cursor=/u);
    await expect(page.getByTestId("transactions-review-count")).toHaveText(
      "1 lançamento nesta página",
    );
    await expect(desktopReviewRow(page, scenarios[0].description)).toBeVisible();
    await expect(desktopReviewRow(page, scenarios[1].description)).toHaveCount(0);
    await expect(desktopReviewRow(page, scenarios[2].description)).toHaveCount(0);
    await expect(page.getByTestId("transactions-review-next-page")).toHaveCount(0);
  });
});
