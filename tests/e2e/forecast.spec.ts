import { expect, test, type Locator, type Page } from "@playwright/test";

async function signIn(page: Page): Promise<void> {
  page.setDefaultNavigationTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Continuar com Google" }).click();
  await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Seu espaço financeiro" }),
  ).toBeVisible();
}

function inputInside(testId: string, page: Page): Locator {
  return page.getByTestId(testId).locator("input");
}

async function fillMoney(page: Page, testId: string, cents: string): Promise<void> {
  const input = inputInside(testId, page);
  await input.fill(cents);
  await expect(input).toHaveValue(/,\d{2}$/u);
}

function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

function monthEnd(value: string): string {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  const end = new Date(Date.UTC(year, month, 0));
  return end.toISOString().slice(0, 10);
}

function addMonths(value: string, months: number): string {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return shifted.toISOString().slice(0, 10);
}

async function createAccount(page: Page, name: string): Promise<void> {
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
}

async function createCategory(
  page: Page,
  name: string,
  kind: "EXPENSE" | "INCOME",
): Promise<void> {
  await page.goto("/settings/categories");
  await expect(page.getByTestId("categories-screen")).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByTestId("categories-create-button").click();
  await expect(page.getByTestId("category-form-create")).toBeVisible();
  await page.getByTestId("category-name-input").fill(name);
  await page.getByTestId("category-kind-input").selectOption(kind);
  await page
    .getByTestId("category-form")
    .getByRole("button", { name: "Criar categoria", exact: true })
    .click();
  await expect(page.getByTestId("categories-success")).toContainText(
    "Categoria criada.",
  );
  await expect(
    page.getByTestId("categories-table").getByText(name, { exact: true }),
  ).toBeVisible();
}

async function createPostedExpense(
  page: Page,
  accountName: string,
  categoryName: string,
  description: string,
): Promise<string> {
  await page.goto("/transactions/new?kind=EXPENSE");
  await expect(page.getByTestId("transaction-create-route")).toBeVisible();
  const form = page.getByTestId("transaction-create-form");
  await expect(form).toBeVisible();
  await form.getByTestId("transaction-create-form-amount-input").fill("10000");
  const occurredOn = await form
    .getByTestId("transaction-create-form-date-input")
    .inputValue();
  await form
    .getByTestId("transaction-create-form-description-input")
    .fill(description);
  await form
    .getByTestId("transaction-create-form-account-input")
    .selectOption({ label: accountName });
  await form
    .getByTestId("transaction-create-form-category-input")
    .selectOption({ label: categoryName });
  await form.getByTestId("transaction-create-form-submit").click();

  const success = page.getByTestId("transaction-create-success");
  await expect(success).toBeVisible();
  await expect(success).toContainText("Despesa registrada com sucesso.");
  await expect(success).toContainText(description);
  await expect(success).toContainText(occurredOn);
  await success.getByRole("link", { name: "Ver lançamentos", exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/?$/u);
  await expect(page.getByTestId("transactions-route")).toBeVisible();
  await page
    .getByRole("link", {
      name: `Abrir lançamento ${description}`,
      exact: true,
    })
    .first()
    .click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+/iu);
  const match = page.url().match(/\/transactions\/([0-9a-f-]{36})(?:$|\?)/iu);
  if (!match) throw new Error("O lançamento POSTED não possui uma referência UUIDv7.");
  return match[1];
}

async function createPlannedEvent(
  page: Page,
  date: string,
  description: string,
): Promise<void> {
  await page.goto("/forecast/origin/new");
  const route = page.getByTestId("forecast-origin-new-route");
  await expect(route).toBeVisible();
  await route.getByRole("combobox", { name: "Fonte", exact: true }).selectOption("PLANNED_EVENT");
  await route.getByRole("combobox", { name: "Tipo", exact: true }).selectOption("EXPENSE");
  await route.getByRole("textbox", { name: "Valor", exact: true }).fill("4567");
  await route.getByRole("textbox", { name: "Data esperada", exact: true }).fill(date);
  await route.getByRole("textbox", { name: "Descrição", exact: true }).fill(description);
  await route
    .getByRole("button", { name: "Adicionar compromisso", exact: true })
    .click();
  await expect(page).toHaveURL(/\/forecast\/?$/u);
}

async function createRecurringRule(
  page: Page,
  date: string,
  description: string,
): Promise<void> {
  await page.goto("/forecast/origin/new");
  const route = page.getByTestId("forecast-origin-new-route");
  await expect(route).toBeVisible();
  await route.getByRole("combobox", { name: "Fonte", exact: true }).selectOption("RECURRING");
  await route.getByRole("combobox", { name: "Tipo", exact: true }).selectOption("EXPENSE");
  await route.getByRole("textbox", { name: "Valor", exact: true }).fill("10000");
  await route
    .getByRole("textbox", { name: "Início da vigência", exact: true })
    .fill(date);
  await route.getByRole("textbox", { name: "Descrição", exact: true }).fill(description);
  await route.getByRole("combobox", { name: "Frequência", exact: true }).selectOption("MONTHLY");
  await route.getByRole("combobox", { name: "Regra de dia", exact: true }).selectOption("FIXED_DAY");
  await route.getByRole("spinbutton", { name: "Dia do mês", exact: true }).fill("1");
  await route
    .getByRole("button", { name: "Adicionar compromisso", exact: true })
    .click();
  await expect(page).toHaveURL(/\/forecast\/?$/u);
}

async function createCard(
  page: Page,
  cardName: string,
  accountName: string,
): Promise<string> {
  await page.goto("/credit-cards/new");
  await expect(page.getByTestId("credit-card-create-route")).toBeVisible();
  await expect(page.getByTestId("credit-card-create-form")).toBeVisible();
  await page.getByTestId("credit-card-name-input").fill(cardName);
  await fillMoney(page, "credit-card-limit-field", "100000");
  await inputInside("credit-card-closing-day-field", page).fill("10");
  await inputInside("credit-card-due-day-field", page).fill("20");
  await page
    .getByTestId("credit-card-payment-account-field")
    .locator("select")
    .selectOption({ label: accountName });
  await page
    .getByTestId("credit-card-create-form")
    .getByRole("button", { name: "Cadastrar cartão", exact: true })
    .click();

  const success = page.getByTestId("credit-card-create-success");
  await expect(success).toBeVisible();
  await expect(success).toContainText("Cartão cadastrado com sucesso.");
  const href = await success
    .getByRole("link", { name: "Consultar cartão", exact: true })
    .getAttribute("href");
  expect(href).toMatch(/^\/credit-cards\/[0-9a-f-]+$/iu);
  return href as string;
}

async function createPurchase(
  page: Page,
  cardHref: string,
  description: string,
  installmentCount: number,
  occurredOnOverride?: string,
): Promise<{ purchaseHref: string; occurredOn: string }> {
  await page.goto(`${cardHref}/purchases/new`);
  await expect(page.getByTestId("credit-card-card-purchase-route")).toBeVisible();
  const form = page.getByTestId("credit-card-purchase-form");
  await expect(form).toBeVisible();
  const dateInput = inputInside("credit-card-purchase-date-field", page);
  const occurredOn = occurredOnOverride ?? (await dateInput.inputValue());
  expect(occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  await dateInput.fill(occurredOn);
  await fillMoney(page, "credit-card-purchase-amount-field", "10000");
  await page.locator("#credit-card-purchase-description").fill(description);
  await page.locator("#credit-card-purchase-installments").fill(String(installmentCount));
  await form.getByRole("button", { name: "Confirmar compra", exact: true }).click();

  const success = page.getByTestId("credit-card-purchase-success");
  await expect(success).toBeVisible();
  await expect(success).toContainText("Compra registrada.");
  await expect(
    success.getByTestId("credit-card-purchase-schedule-table").locator("tbody tr"),
  ).toHaveCount(installmentCount);
  const purchaseHref = await success
    .getByRole("link", { name: "Ver compra", exact: true })
    .getAttribute("href");
  expect(purchaseHref).toMatch(
    /^\/credit-cards\/[0-9a-f-]+\/purchases\/[0-9a-f-]+$/iu,
  );
  return { purchaseHref: purchaseHref as string, occurredOn };
}

test.describe("T12 — E2E do fluxo futuro", () => {
  test("consulta a projeção, navega dezembro→janeiro e preserva realizado versus previsto", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signIn(page);

    await page.goto(
      "/forecast?from=2026-12-01&to=2026-12-31&scenario=EXPECTED",
    );
    await expect(page.getByTestId("forecast-route")).toBeVisible();
    await expect(page.getByTestId("forecast-period-selector")).toBeVisible();
    await expect(page.locator("#forecast-period-selector-from")).toHaveValue(
      "2026-12-01",
    );
    await expect(page.locator("#forecast-period-selector-to")).toHaveValue(
      "2026-12-31",
    );
    await expect(page.locator("#forecast-period-selector-scenario")).toHaveValue(
      "EXPECTED",
    );
    await expect(page.getByTestId("forecast-view-summary")).toContainText(
      "Entradas realizadas",
    );
    await expect(page.getByTestId("forecast-view-summary")).toContainText(
      "Entradas previstas",
    );
    await expect(page.getByTestId("forecast-view-summary")).toContainText(
      "Pagamentos de cartão são transferências",
    );
    await expect(page.getByTestId("forecast-period-breakdown-2026-12")).toBeVisible();

    const next = page.getByTestId("forecast-period-selector-next");
    await expect(next).toHaveAttribute(
      "href",
      "/forecast?from=2027-01-01&to=2027-01-31&scenario=EXPECTED",
    );
    await next.click();
    await expect(page).toHaveURL(
      /\/forecast\?from=2027-01-01&to=2027-01-31&scenario=EXPECTED$/u,
    );
    await expect(page.getByTestId("forecast-route")).toBeVisible();
    await expect(page.getByTestId("forecast-period-breakdown-2027-01")).toBeVisible();

    await page.getByTestId("forecast-period-selector-previous").click();
    await expect(page).toHaveURL(
      /\/forecast\?from=2026-12-01&to=2026-12-31&scenario=EXPECTED$/u,
    );
    await expect(page.getByTestId("forecast-route")).toBeVisible();
  });

  test("expõe mês vazio, saldos preservados e erro de URL sem detalhes internos", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signIn(page);

    await page.goto(
      "/forecast?from=2099-02-01&to=2099-02-28&scenario=CONSERVATIVE",
    );
    await expect(page.getByTestId("forecast-route")).toBeVisible();
    await expect(page.getByTestId("forecast-view-timeline")).toContainText(
      "Nenhum compromisso no período",
    );
    await expect(page.getByTestId("forecast-period-breakdown-2099-02")).toContainText(
      "R$ 0,00",
    );
    await expect(page.getByTestId("forecast-view-summary")).toContainText(
      "Saldo final projetado",
    );

    await page.goto(
      "/forecast?from=not-a-date&to=2099-02-28&scenario=CONSERVATIVE",
    );
    await expect(page.getByTestId("forecast-route-error")).toBeVisible();
    await expect(page.getByTestId("forecast-view-summary-error")).toContainText(
      "Informe datas válidas",
    );
    await expect(
      page
        .getByTestId("forecast-route-error")
        .getByRole("link", { name: "Período atual", exact: true }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("stack");
    await expect(page.locator("body")).not.toContainText("SELECT");
  });

  test("renderiza cada parcela futura uma vez e o cancelamento do agregado remove o impacto", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const suffix = Date.now().toString(36);
    const accountName = `Conta forecast E2E ${suffix}`;
    const cardName = `Cartão forecast E2E ${suffix}`;
    const description = `Compra forecast 3x E2E ${suffix}`;

    await signIn(page);
    await createAccount(page, accountName);
    const cardHref = await createCard(page, cardName, accountName);
    // The card action stamps the initial rule with the server's UTC civil
    // date, while the browser's Temporal clock can still be on the previous
    // Fortaleza day around midnight. Reuse the rendered server rule date so
    // the purchase fixture is valid at both boundaries.
    await page.goto(cardHref);
    const cardMaintenance = page.getByTestId("credit-card-maintenance");
    await expect(cardMaintenance).toBeVisible();
    const cardText = await cardMaintenance.textContent();
    const ruleDate = cardText?.match(/Vigente desde\s*(\d{4}-\d{2}-\d{2})/u)?.[1];
    if (!ruleDate) {
      throw new Error("A regra inicial do cartão não foi renderizada.");
    }
    const purchase = await createPurchase(
      page,
      cardHref,
      description,
      3,
      ruleDate,
    );
    const from = monthStart(purchase.occurredOn);
    const to = monthEnd(addMonths(from, 4));
    const forecastHref = `/forecast?from=${from}&to=${to}&scenario=EXPECTED`;

    await page.goto(forecastHref);
    await expect(page.getByTestId("forecast-route")).toBeVisible();
    await expect(page.getByTestId("forecast-view-timeline")).toContainText(
      "Parcela de cartão",
    );
    await expect(page.getByText(description, { exact: true })).toHaveCount(3);
    const installmentItems = page
      .getByTestId("forecast-view-timeline")
      .locator('li[data-testid*="-item-"]')
      .filter({ hasText: description });
    await expect(installmentItems).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expect(installmentItems.nth(index)).toContainText(
        "Origem: Parcela de cartão",
      );
    }
    await expect(installmentItems.getByText("-R$ 33,34", { exact: true })).toHaveCount(1);
    await expect(installmentItems.getByText("-R$ 33,33", { exact: true })).toHaveCount(2);

    await page.goto(purchase.purchaseHref);
    const detail = page.getByTestId("credit-card-purchase-detail-screen");
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("button", { name: /pagar parcela|pagar prestação/i })).toHaveCount(0);
    await detail
      .getByTestId("credit-card-purchase-detail-screen-cancel-section")
      .getByRole("button", { name: "Cancelar compra inteira", exact: true })
      .click();
    const confirmation = detail.getByTestId(
      "credit-card-purchase-detail-screen-cancel-confirmation",
    );
    await expect(confirmation).toBeVisible();
    await confirmation
      .getByRole("button", { name: "Cancelar compra inteira", exact: true })
      .click();
    await expect(detail.getByTestId("credit-card-purchase-detail-screen-feedback")).toContainText(
      "Compra cancelada.",
    );
    await expect(detail.getByLabel("Status da compra: Cancelada")).toBeVisible();

    await page.goto(forecastHref);
    await expect(page.getByTestId("forecast-route")).toBeVisible();
    await expect(page.getByText(description, { exact: true })).toHaveCount(0);
  });

  test("rejeita householdId e referência opacos na URL sem renderizar o valor fornecido", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await signIn(page);
    const foreignHouseholdId = "0192a000-0000-7000-8000-000000000000";
    const foreignReferenceId = "0192a000-0000-7000-8000-000000000001";
    await page.goto(
      `/forecast?from=2099-02-01&to=2099-02-28&scenario=EXPECTED&householdId=${foreignHouseholdId}&referenceId=${foreignReferenceId}`,
    );
    await expect(page.getByTestId("forecast-route-error")).toBeVisible();
    await expect(page.getByTestId("forecast-view-summary-error")).toContainText(
      "Não foi possível carregar a projeção",
    );
    await expect(page.locator("body")).not.toContainText(foreignHouseholdId);
    await expect(page.locator("body")).not.toContainText(foreignReferenceId);
    await expect(page.locator("body")).not.toContainText("householdId");
    await expect(page.locator("body")).not.toContainText("referenceId");
  });

  test("mantém um estado de carregamento acessível antes da projeção", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signIn(page);
    await page.goto(
      "/forecast?from=2099-03-01&to=2099-03-31&scenario=CONSERVATIVE",
      { waitUntil: "commit" },
    );
    await expect(page.getByTestId("forecast-route-loading")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("forecast-load-state")).toHaveAttribute(
      "role",
      "status",
    );
    await expect(page.getByTestId("forecast-route")).toBeVisible();
  });

});

test.describe("T12 — jornadas dependentes de T10", () => {
  test("abre, altera e cancela um evento planejado com retorno seguro", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const suffix = Date.now().toString(36);
    const date = "2099-04-15";
    const description = `Evento futuro E2E ${suffix}`;
    const updatedDescription = `${description} atualizado`;
    const forecastHref =
      "/forecast?from=2099-04-01&to=2099-04-30&scenario=EXPECTED";

    await signIn(page);
    await createPlannedEvent(page, date, description);
    await page.goto(forecastHref);
    await expect(page.getByTestId("forecast-route")).toBeVisible();

    const item = page
      .getByTestId("forecast-view-timeline")
      .locator('li[data-testid*="-item-"]')
      .filter({ hasText: description });
    await expect(item).toHaveCount(1);
    const originLink = item.getByRole("link", {
      name: "Ver origem do compromisso",
      exact: true,
    });
    await expect(originLink).toHaveAttribute(
      "href",
      /\/forecast\/origin\?kind=PLANNED_EVENT&referenceId=[0-9a-f-]{36}/iu,
    );
    const originHref = await originLink.getAttribute("href");
    expect(originHref).toContain("returnTo=");
    await originLink.click();

    await expect(page.getByTestId("forecast-origin-route")).toBeVisible();
    const detail = page.getByTestId("forecast-origin-detail");
    await expect(detail).toContainText(description);
    await expect(detail.getByTestId("forecast-planned-origin-details")).toBeVisible();
    await expect(detail).toContainText("Estado: Planejado");
    await expect(page.getByTestId("forecast-planned-event-maintenance")).toBeVisible();

    await page.getByTestId("forecast-origin-back").click();
    await expect(page).toHaveURL(forecastHref);

    await page.goto(originHref as string);
    const maintenance = page.getByTestId("forecast-planned-event-maintenance");
    await expect(maintenance).toBeVisible();
    await maintenance
      .getByRole("textbox", { name: "Valor", exact: true })
      .fill("5678");
    await maintenance
      .getByRole("textbox", { name: "Data esperada", exact: true })
      .fill(date);
    await maintenance
      .getByRole("textbox", { name: "Descrição", exact: true })
      .fill(updatedDescription);
    await maintenance
      .getByRole("button", { name: "Salvar evento", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: updatedDescription, exact: true }),
    ).toBeVisible();
    await expect(detail.getByTestId("forecast-planned-origin-details")).toContainText(
      "R$ 56,78",
    );

    await maintenance
      .getByRole("button", { name: "Cancelar evento", exact: true })
      .click();
    await expect(detail).toContainText("Estado: Cancelado");
    await expect(page.getByTestId("forecast-planned-event-maintenance")).toHaveCount(0);
    await expect(page.getByTestId("forecast-origin-blocked-actions")).toContainText(
      "já foi cancelado",
    );

    await page.goto(forecastHref);
    await expect(page.getByTestId("forecast-route")).toBeVisible();
    await expect(page.getByText(updatedDescription, { exact: true })).toHaveCount(0);
    await expect(page.getByText(description, { exact: true })).toHaveCount(0);

    const foreignReferenceId = "0192a000-0000-7000-8000-000000000010";
    await page.goto(
      `/forecast/origin?kind=PLANNED_EVENT&referenceId=${foreignReferenceId}`,
    );
    await expect(page.getByTestId("forecast-origin-route-error")).toBeVisible();
    await expect(page.getByTestId("forecast-origin-not-found")).toContainText(
      "Origem não encontrada",
    );
    await expect(page.locator("body")).not.toContainText(foreignReferenceId);
    await expect(page.locator("body")).not.toContainText("householdId");
    await expect(page.locator("body")).not.toContainText("referenceId");
  });

  test("mantém recorrência, sobrescreve/cancela ocorrência e registra realização", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const suffix = Date.now().toString(36);
    const accountName = `Conta origem forecast ${suffix}`;
    const categoryName = `Categoria origem forecast ${suffix}`;
    const postedDescription = `Realização forecast E2E ${suffix}`;
    const description = `Recorrência forecast E2E ${suffix}`;
    const forecastHref =
      "/forecast?from=2099-05-01&to=2099-07-31&scenario=EXPECTED";

    await signIn(page);
    await createAccount(page, accountName);
    await createCategory(page, categoryName, "EXPENSE");
    const financialEventId = await createPostedExpense(
      page,
      accountName,
      categoryName,
      postedDescription,
    );
    await createRecurringRule(page, "2099-05-01", description);

    await page.goto(forecastHref);
    await expect(page.getByTestId("forecast-route")).toBeVisible();
    let items = page
      .getByTestId("forecast-view-timeline")
      .locator('li[data-testid*="-item-"]')
      .filter({ hasText: description });
    await expect(items).toHaveCount(3);
    const firstLink = items
      .nth(0)
      .getByRole("link", { name: "Ver origem do compromisso", exact: true });
    await expect(firstLink).toHaveAttribute(
      "href",
      /\/forecast\/origin\?kind=RECURRING&referenceId=[0-9a-f-]{36}/iu,
    );
    const firstHref = await firstLink.getAttribute("href");
    expect(firstHref).toContain("occurrenceKey=2099-05");
    await firstLink.click();

    await expect(page.getByTestId("forecast-origin-route")).toBeVisible();
    const detail = page.getByTestId("forecast-origin-detail");
    await expect(detail.getByTestId("forecast-recurring-origin-details")).toContainText(
      "Mensal",
    );
    await expect(detail).toContainText("Estado: Planejado");
    const occurrenceMaintenance = page.getByTestId(
      "forecast-occurrence-maintenance",
    );
    await expect(occurrenceMaintenance).toBeVisible();
    await occurrenceMaintenance
      .getByRole("textbox", {
        name: "Valor substituto",
        exact: true,
      })
      .fill("11111");
    await occurrenceMaintenance
      .getByRole("textbox", { name: "Data substituta", exact: true })
      .fill("2099-05-02");
    await occurrenceMaintenance
      .getByRole("button", { name: "Salvar override", exact: true })
      .click();
    await expect(detail.getByTestId("forecast-recurring-origin-details")).toContainText(
      "R$ 111,11",
    );

    await page.getByTestId("forecast-origin-back").click();
    await expect(page).toHaveURL(forecastHref);
    items = page
      .getByTestId("forecast-view-timeline")
      .locator('li[data-testid*="-item-"]')
      .filter({ hasText: description });
    await expect(items).toHaveCount(3);
    await expect(items.first()).toContainText("-R$ 111,11");

    await items
      .nth(1)
      .getByRole("link", { name: "Ver origem do compromisso", exact: true })
      .click();
    await expect(page.getByTestId("forecast-occurrence-maintenance")).toBeVisible();
    await page
      .getByTestId("forecast-occurrence-maintenance")
      .getByRole("button", { name: "Cancelar esta ocorrência", exact: true })
      .click();
    await expect(page.getByTestId("forecast-origin-detail")).toContainText(
      "Estado: Cancelado",
    );
    await expect(page.getByTestId("forecast-occurrence-maintenance")).toHaveCount(0);
    await page.getByTestId("forecast-origin-back").click();
    await expect(page).toHaveURL(forecastHref);
    items = page
      .getByTestId("forecast-view-timeline")
      .locator('li[data-testid*="-item-"]')
      .filter({ hasText: description });
    await expect(items).toHaveCount(2);

    await items
      .first()
      .getByRole("link", { name: "Ver origem do compromisso", exact: true })
      .click();
    const realizeMaintenance = page.getByTestId("forecast-occurrence-maintenance");
    await expect(realizeMaintenance).toBeVisible();
    await realizeMaintenance
      .getByRole("textbox", {
        name: "ID do lançamento POSTED para vincular",
        exact: true,
      })
      .fill(financialEventId);
    await realizeMaintenance
      .getByRole("button", { name: "Vincular realização", exact: true })
      .click();
    await expect(page.getByTestId("forecast-origin-detail")).toContainText(
      "Estado: Realizado",
    );
    await expect(page.getByTestId("forecast-occurrence-maintenance")).toHaveCount(0);
    await page.getByTestId("forecast-origin-back").click();
    await expect(page).toHaveURL(forecastHref);
    items = page
      .getByTestId("forecast-view-timeline")
      .locator('li[data-testid*="-item-"]')
      .filter({ hasText: description });
    await expect(items).toHaveCount(1);

    const foreignReferenceId = "0192a000-0000-7000-8000-000000000020";
    const foreignRuleId = "0192a000-0000-7000-8000-000000000021";
    await page.goto(
      `/forecast/origin?kind=RECURRING&referenceId=${foreignReferenceId}&recurringRuleId=${foreignRuleId}&occurrenceKey=2099-05`,
    );
    await expect(page.getByTestId("forecast-origin-route-error")).toBeVisible();
    await expect(page.getByTestId("forecast-origin-not-found")).toContainText(
      "Origem não encontrada",
    );
    await expect(page.locator("body")).not.toContainText(foreignReferenceId);
    await expect(page.locator("body")).not.toContainText(foreignRuleId);
    await expect(page.locator("body")).not.toContainText("householdId");
    await expect(page.locator("body")).not.toContainText("referenceId");
  });
});
