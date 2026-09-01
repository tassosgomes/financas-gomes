import { expect, test, type Page } from "@playwright/test";

interface TransactionFixture {
  accountName: string;
  expenseCategoryName: string;
  incomeCategoryName: string;
}

interface TransactionScenario {
  amountCents: string;
  categoryName: string;
  description: string;
  editedDescription: string;
  kind: "EXPENSE" | "INCOME";
  signedAmount: string;
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

async function createFixture(page: Page, suffix: string): Promise<TransactionFixture> {
  const fixture = {
    accountName: `Conta transação ${suffix}`,
    expenseCategoryName: `Categoria despesa ${suffix}`,
    incomeCategoryName: `Categoria receita ${suffix}`,
  };

  await page.goto("/accounts");
  await expect(page).toHaveURL(/\/accounts\/?$/);
  await expect(page.getByTestId("accounts-screen")).toBeVisible();
  // A fresh navigation ensures the account form client island is hydrated
  // after the previous test's development-server HMR updates.
  await page.reload();
  await expect(page.getByTestId("accounts-screen")).toBeVisible();

  const createAccountButton = page.getByTestId("accounts-create-button");
  await expect(createAccountButton).toBeEnabled();
  await createAccountButton.click();
  await expect(page.getByTestId("account-form-create")).toBeVisible();
  await page.getByTestId("account-name-input").fill(fixture.accountName);
  await page
    .getByTestId("account-form")
    .getByRole("button", { name: "Criar conta", exact: true })
    .click();
  await expect(page.getByTestId("accounts-success")).toContainText(
    "Conta criada.",
  );
  await expect(
    page.getByTestId("accounts-table").getByText(fixture.accountName, {
      exact: true,
    }),
  ).toBeVisible();

  await page.goto("/settings/categories");
  await expect(page).toHaveURL(/\/settings\/categories\/?$/);
  await expect(page.getByTestId("categories-screen")).toBeVisible();
  await page.waitForTimeout(500);

  await page.getByTestId("categories-create-button").click();
  await expect(page.getByTestId("category-form-create")).toBeVisible();
  await page.getByTestId("category-name-input").fill(fixture.expenseCategoryName);
  await page.getByTestId("category-kind-input").selectOption("EXPENSE");
  await page
    .getByTestId("category-form")
    .getByRole("button", { name: "Criar categoria", exact: true })
    .click();
  await expect(page.getByTestId("categories-success")).toContainText(
    "Categoria criada.",
  );
  await expect(
    page.getByTestId("categories-table").getByText(fixture.expenseCategoryName, {
      exact: true,
    }),
  ).toBeVisible();

  await page.getByTestId("categories-create-button").click();
  await expect(page.getByTestId("category-form-create")).toBeVisible();
  await page.getByTestId("category-name-input").fill(fixture.incomeCategoryName);
  await page.getByTestId("category-kind-input").selectOption("INCOME");
  await page
    .getByTestId("category-form")
    .getByRole("button", { name: "Criar categoria", exact: true })
    .click();
  await expect(page.getByTestId("categories-success")).toContainText(
    "Categoria criada.",
  );
  await expect(
    page.getByTestId("categories-table").getByText(fixture.incomeCategoryName, {
      exact: true,
    }),
  ).toBeVisible();

  return fixture;
}

async function assertEmptyAccountFilter(
  page: Page,
  accountName: string,
): Promise<void> {
  await page.goto("/transactions");
  await expect(page).toHaveURL(/\/transactions\/?$/);
  await expect(page.getByTestId("transactions-route")).toBeVisible();
  await expect(page.getByTestId("transactions-filters")).toBeVisible();

  await page.getByLabel("Conta", { exact: true }).selectOption({
    label: accountName,
  });
  await page.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
  await expect(page).toHaveURL(/accountId=/);
  await expect(page.getByTestId("transactions-empty-filter-state")).toBeVisible();
  await expect(page.getByTestId("transactions-empty-filter-state")).toContainText(
    "Nenhum lançamento encontrado",
  );
}

async function createTransaction(
  page: Page,
  fixture: TransactionFixture,
  scenario: TransactionScenario,
): Promise<string> {
  await page.goto(`/transactions/new?kind=${scenario.kind}`);
  await expect(page).toHaveURL(
    new RegExp(`/transactions/new\\?kind=${scenario.kind}`),
  );
  await expect(page.getByTestId("transaction-create-route")).toBeVisible();
  await expect(page.getByTestId("transaction-create-form")).toBeVisible();

  const form = page.getByTestId("transaction-create-form");
  await expect(form.getByTestId("transaction-create-form-kind-input")).toBeVisible();
  await form.getByTestId("transaction-create-form-amount-input").fill(
    scenario.amountCents,
  );
  const occurredOn = await form
    .getByTestId("transaction-create-form-date-input")
    .inputValue();
  expect(occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await form
    .getByTestId("transaction-create-form-description-input")
    .fill(scenario.description);
  await form
    .getByTestId("transaction-create-form-account-input")
    .selectOption({ label: fixture.accountName });
  await form
    .getByTestId("transaction-create-form-category-input")
    .selectOption({ label: scenario.categoryName });
  await form.getByTestId("transaction-create-form-submit").click();

  const success = page.getByTestId("transaction-create-success");
  await expect(success).toBeVisible();
  await expect(success).toContainText(
    `${scenario.kind === "EXPENSE" ? "Despesa" : "Receita"} registrada com sucesso.`,
  );
  await expect(success).toContainText(scenario.description);
  await expect(success).toContainText(occurredOn);

  await success.getByRole("link", { name: "Ver lançamentos", exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/?$/);
  await expect(page.getByTestId("transactions-route")).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: `Abrir lançamento ${scenario.description}`,
      exact: true,
    }).first(),
  ).toBeVisible();

  return occurredOn;
}

async function openTransactionDetail(
  page: Page,
  description: string,
): Promise<string> {
  await page
    .getByRole("link", {
      name: `Abrir lançamento ${description}`,
      exact: true,
    })
    .first()
    .click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+/);
  await expect(page.getByTestId("transaction-detail-screen")).toBeVisible();
  return page.url();
}

async function assertPostedDetail(
  page: Page,
  fixture: TransactionFixture,
  scenario: TransactionScenario,
  occurredOn: string,
): Promise<void> {
  await expect(
    page.getByTestId(`review-detail-kind-${scenario.kind.toLowerCase()}`),
  ).toContainText(scenario.kind === "EXPENSE" ? "Despesa" : "Receita");
  await expect(page.getByTestId("review-detail-status-posted")).toContainText(
    "Publicado",
  );
  await expect(page.getByTestId("review-detail-event-amount")).toContainText(
    scenario.kind === "EXPENSE" ? "R$ 123,45" : "R$ 987,65",
  );
  await expect(page.getByTestId("review-detail-occurred-on")).toHaveAttribute(
    "data-testid",
    "review-detail-occurred-on",
  );
  await expect(
    page.getByTestId("review-detail-occurred-on").locator("time"),
  ).toHaveAttribute("dateTime", occurredOn);
  await expect(page.getByTestId("review-detail-account")).toContainText(
    fixture.accountName,
  );
  await expect(page.getByTestId("review-history-category")).toContainText(
    scenario.categoryName,
  );
  await expect(page.getByTestId("review-history-origin")).toContainText("Manual");
  await expect(page.getByTestId("review-history")).toBeVisible();
  await expect(page.getByTestId("review-readonly-guidance")).toContainText(
    "não podem ser editados nesta tela.",
  );
  await expect(page.getByTestId("review-detail-entry-amount")).toContainText(
    scenario.signedAmount,
  );
  await expect(page.getByTestId("review-detail-balance-amount")).toContainText(
    scenario.signedAmount,
  );
}

async function editAndCancelTransaction(
  page: Page,
  scenario: TransactionScenario,
  occurredOn: string,
): Promise<void> {
  const editForm = page.getByTestId("transaction-detail-edit-form");
  await expect(editForm).toBeVisible();
  await expect(editForm.getByTestId("transaction-detail-edit-form-amount-input")).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(editForm.getByTestId("transaction-detail-edit-form-date-input")).toHaveAttribute(
    "readonly",
    "",
  );

  await editForm
    .getByTestId("transaction-detail-edit-form-description-input")
    .fill(scenario.editedDescription);
  await editForm.getByTestId("transaction-detail-edit-form-submit").click();
  await expect(page.getByTestId("review-detail-success")).toContainText(
    "Lançamento atualizado.",
  );
  await expect(
    page.getByRole("heading", { name: scenario.editedDescription, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("review-detail-occurred-on").locator("time"),
  ).toHaveAttribute("dateTime", occurredOn);

  await page.getByTestId("transaction-cancel-open").click();
  await expect(page.getByTestId("transaction-cancel-confirmation")).toBeVisible();
  await page.getByTestId("transaction-cancel-confirm").click();
  await expect(page.getByTestId("review-detail-success")).toContainText(
    "Lançamento cancelado.",
  );
  await expect(page.getByTestId("review-detail-status-cancelled")).toContainText(
    "Cancelado",
  );
  await expect(page.getByTestId("review-history")).toContainText(
    "Este lançamento possui um reversal preservado no histórico.",
  );
  await expect(page.getByTestId("review-detail-balance-amount")).toContainText(
    "R$ 0,00",
  );
  await expect(page.getByTestId("review-not-editable-guidance")).toContainText(
    "não pode ser revisado.",
  );
  await expect(page.getByTestId("transaction-cancel-open")).toHaveCount(0);
}

async function assertCancelledAfterReload(
  page: Page,
  scenario: TransactionScenario,
): Promise<void> {
  await page.reload();
  await expect(page.getByTestId("transaction-detail-screen")).toBeVisible();
  await expect(page.getByRole("heading", { name: scenario.editedDescription, exact: true })).toBeVisible();
  await expect(page.getByTestId("review-detail-status-cancelled")).toContainText(
    "Cancelado",
  );
  await expect(page.getByTestId("review-history")).toContainText(
    "Este lançamento possui um reversal preservado no histórico.",
  );
  await expect(page.getByTestId("review-detail-balance-amount")).toContainText(
    "R$ 0,00",
  );
  await expect(page.getByTestId("transaction-cancel-open")).toHaveCount(0);
}

async function runScenario(
  page: Page,
  fixture: TransactionFixture,
  scenario: TransactionScenario,
): Promise<void> {
  await assertEmptyAccountFilter(page, fixture.accountName);
  const occurredOn = await createTransaction(page, fixture, scenario);
  const detailUrl = await openTransactionDetail(page, scenario.description);
  await assertPostedDetail(page, fixture, scenario, occurredOn);
  await editAndCancelTransaction(page, scenario, occurredOn);
  await assertCancelledAfterReload(page, scenario);

  await page.getByTestId("review-detail-back").click();
  await expect(page).toHaveURL(/\/transactions\/?$/);
  await expect(page.getByTestId("transactions-route")).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: `Abrir lançamento ${scenario.editedDescription}`,
      exact: true,
    }).first(),
  ).toBeVisible();
  const cancelledRow = page
    .getByTestId("transactions-table")
    .getByRole("row")
    .filter({ hasText: scenario.editedDescription });
  await expect(cancelledRow).toContainText("Cancelado");
  await expect(page).not.toHaveURL(detailUrl);
}

test.describe("S03 transações manuais", () => {
  test("despesa: cria, lista, edita, cancela e preserva o histórico", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const fixture = await createFixture(page, `despesa-${Date.now().toString(36)}`);

    await runScenario(page, fixture, {
      amountCents: "12345",
      categoryName: fixture.expenseCategoryName,
      description: `Despesa mercado ${Date.now().toString(36)}`,
      editedDescription: `Despesa mercado editada ${Date.now().toString(36)}`,
      kind: "EXPENSE",
      signedAmount: "-R$ 123,45",
    });
  });

  test("receita: cria, lista, edita, cancela e preserva o histórico", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const fixture = await createFixture(page, `receita-${Date.now().toString(36)}`);

    await runScenario(page, fixture, {
      amountCents: "98765",
      categoryName: fixture.incomeCategoryName,
      description: `Receita salário ${Date.now().toString(36)}`,
      editedDescription: `Receita salário editada ${Date.now().toString(36)}`,
      kind: "INCOME",
      signedAmount: "+R$ 987,65",
    });
  });

  test("exibe erro de formulário e rejeita conta arquivada na confirmação", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const fixture = await createFixture(page, `erros-${Date.now().toString(36)}`);

    await page.goto("/transactions/new?kind=EXPENSE");
    await expect(page.getByTestId("transaction-create-form")).toBeVisible();
    const form = page.getByTestId("transaction-create-form");
    await form.getByTestId("transaction-create-form-submit").click();
    await expect(form.locator("#transaction-create-form-amount-error")).toContainText(
      "valor em centavos inválido",
    );
    await expect(
      form.locator("#transaction-create-form-description-error"),
    ).toContainText("descrição inválida");
    await expect(form.locator("#transaction-create-form-account-error")).toContainText(
      "Selecione uma conta válida",
    );

    await form.getByTestId("transaction-create-form-amount-input").fill("100");
    await form
      .getByTestId("transaction-create-form-description-input")
      .fill(`Despesa referência ${Date.now().toString(36)}`);
    await form
      .getByTestId("transaction-create-form-account-input")
      .selectOption({ label: fixture.accountName });
    await form
      .getByTestId("transaction-create-form-category-input")
      .selectOption({ label: fixture.expenseCategoryName });

    const accountPage = await page.context().newPage();
    accountPage.setDefaultNavigationTimeout(120_000);
    await accountPage.goto("/accounts");
    await expect(accountPage.getByTestId("accounts-screen")).toBeVisible();
    await accountPage
      .getByRole("button", {
        name: `Arquivar a conta ${fixture.accountName}`,
        exact: true,
      })
      .click();
    await accountPage
      .getByRole("group", { name: "Confirmar arquivamento" })
      .getByRole("button", { name: "Confirmar", exact: true })
      .click();
    await expect(accountPage.getByTestId("accounts-success")).toContainText(
      "Conta arquivada.",
    );
    await accountPage.close();

    await form.getByTestId("transaction-create-form-submit").click();
    await expect(form.getByTestId("transaction-create-form-general-error")).toContainText(
      "A conta ou categoria está arquivada",
    );
    await expect(form.locator("#transaction-create-form-account-error")).toContainText(
      "A conta ou categoria está arquivada",
    );
    await expect(page.getByTestId("transaction-create-success")).toHaveCount(0);
  });
});
