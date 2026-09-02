import { expect, test, type Locator, type Page } from "@playwright/test";

const E2E_EMAIL_PATTERN = /^e2e-[a-z0-9-]+@example\.test$/u;

function inputInside(testId: string, page: Page): Locator {
  return page.getByTestId(testId).locator("input");
}

async function signIn(page: Page, email: string): Promise<void> {
  if (!E2E_EMAIL_PATTERN.test(email)) {
    throw new Error(`Identidade E2E inválida: ${email}`);
  }

  const routePattern = "**/api/auth/sign-in/social";
  await page.route(routePattern, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    const body = route.request().postDataJSON() as Record<string, unknown>;
    await route.continue({
      postData: JSON.stringify({ ...body, loginHint: email }),
    });
  });

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Continuar com Google" }).click();
    await expect(page).toHaveURL(/\/app\/?$/u, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "Seu espaço financeiro" }),
    ).toBeVisible();
  } finally {
    await page.unroute(routePattern);
  }
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function uniqueEmail(label: string): string {
  const suffix = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  return `e2e-s08-${label}-${suffix}@example.test`;
}

async function fillMoney(page: Page, testId: string, cents: string): Promise<void> {
  const input = inputInside(testId, page);
  await input.fill(cents);
  await expect(input).toHaveValue(/,\d{2}$/u);
}

async function createAccount(page: Page, name: string): Promise<void> {
  await page.goto("/accounts");
  await expect(page.getByTestId("accounts-screen")).toBeVisible();
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

async function createPostedTransaction(
  page: Page,
  values: {
    accountName: string;
    amountCents: string;
    categoryName: string;
    description: string;
    kind: "EXPENSE" | "INCOME";
  },
): Promise<string> {
  await page.goto(`/transactions/new?kind=${values.kind}`);
  await expect(page.getByTestId("transaction-create-route")).toBeVisible();
  const form = page.getByTestId("transaction-create-form");
  await expect(form).toBeVisible();

  const dateInput = form.getByTestId("transaction-create-form-date-input");
  const occurredOn = await dateInput.inputValue();
  const amountInput = form.getByTestId("transaction-create-form-amount-input");
  await amountInput.fill(values.amountCents);
  await expect(amountInput).toHaveValue(/,\d{2}$/u);
  await form
    .getByTestId("transaction-create-form-description-input")
    .fill(values.description);
  await form
    .getByTestId("transaction-create-form-account-input")
    .selectOption({ label: values.accountName });
  await form
    .getByTestId("transaction-create-form-category-input")
    .selectOption({ label: values.categoryName });
  await form.getByTestId("transaction-create-form-submit").click();

  const success = page.getByTestId("transaction-create-success");
  await expect(success).toBeVisible();
  await expect(success).toContainText(values.description);
  await expect(success).toContainText(occurredOn);
  return occurredOn;
}

async function createPlannedEvent(
  page: Page,
  values: {
    amountCents: string;
    date: string;
    description: string;
    includeInConservativeForecast?: boolean;
    kind?: "EXPENSE" | "INCOME";
  },
): Promise<void> {
  await page.goto("/forecast/origin/new");
  const route = page.getByTestId("forecast-origin-new-route");
  await expect(route).toBeVisible();
  await route
    .getByRole("combobox", { name: "Fonte", exact: true })
    .selectOption("PLANNED_EVENT");
  await route
    .getByRole("combobox", { name: "Tipo", exact: true })
    .selectOption(values.kind ?? "EXPENSE");
  await route
    .getByRole("textbox", { name: "Valor (centavos)", exact: true })
    .fill(values.amountCents);
  await route
    .getByRole("textbox", { name: "Data esperada", exact: true })
    .fill(values.date);
  await route
    .getByRole("textbox", { name: "Descrição", exact: true })
    .fill(values.description);

  const conservative = route.getByRole("checkbox", {
    name: "Incluir no cenário conservador",
    exact: true,
  });
  if (values.includeInConservativeForecast === false) {
    await conservative.uncheck();
  } else {
    await expect(conservative).toBeChecked();
  }

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
  occurredOn: string,
): Promise<void> {
  await page.goto(`${cardHref}/purchases/new`);
  await expect(page.getByTestId("credit-card-card-purchase-route")).toBeVisible();
  const form = page.getByTestId("credit-card-purchase-form");
  await fillMoney(page, "credit-card-purchase-amount-field", "10000");
  await inputInside("credit-card-purchase-date-field", page).fill(occurredOn);
  await page.locator("#credit-card-purchase-description").fill(description);
  await page.locator("#credit-card-purchase-installments").fill("2");
  await form
    .getByRole("button", { name: "Confirmar compra", exact: true })
    .click();

  const success = page.getByTestId("credit-card-purchase-success");
  await expect(success).toBeVisible();
  await expect(success).toContainText("Compra registrada.");
  await expect(
    success.getByTestId("credit-card-purchase-schedule-table").locator("tbody tr"),
  ).toHaveCount(2);
}

function spendableCard(page: Page, testId: string): Locator {
  return page.getByTestId(testId);
}

test.describe("T12 — E2E da disponibilidade para gastar", () => {
  test("mostra positivo, período, entrada futura por cenário e origem por teclado", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const suffix = Date.now().toString(36);
    const accountName = `Conta spendable positivo ${suffix}`;
    const incomeCategory = `Receita spendable ${suffix}`;
    const expenseCategory = `Despesa spendable ${suffix}`;
    const incomeDescription = `Saldo inicial spendable ${suffix}`;
    const futureIncomeDescription = `Entrada futura spendable ${suffix}`;
    const futureExpenseDescription = `Compromisso spendable ${suffix}`;

    await signIn(page, uniqueEmail("positive"));
    await createAccount(page, accountName);
    await createCategory(page, incomeCategory, "INCOME");
    await createCategory(page, expenseCategory, "EXPENSE");
    const asOf = await createPostedTransaction(page, {
      accountName,
      amountCents: "200000",
      categoryName: incomeCategory,
      description: incomeDescription,
      kind: "INCOME",
    });
    await createPlannedEvent(page, {
      amountCents: "50000",
      date: addDays(asOf, 3),
      description: futureIncomeDescription,
      includeInConservativeForecast: false,
      kind: "INCOME",
    });
    await createPlannedEvent(page, {
      amountCents: "75000",
      date: addDays(asOf, 7),
      description: futureExpenseDescription,
      kind: "EXPENSE",
    });

    await page.goto(
      `/forecast?from=${addDays(asOf, 1)}&to=${addDays(asOf, 30)}&scenario=EXPECTED`,
    );
    await expect(page.getByTestId("forecast-route")).toBeVisible();
    await expect(page.getByTestId("forecast-view-timeline")).toContainText(
      futureIncomeDescription,
    );
    await expect(page.getByTestId("forecast-view-timeline")).toContainText(
      futureExpenseDescription,
    );

    await page.goto("/app");
    const card = spendableCard(page, "spendable-card");
    await expect(card).toHaveAttribute("data-state", "positive");
    await expect(card.getByTestId("spendable-card-primary-value")).toHaveAttribute(
      "aria-label",
      "Pode gastar: R$ 1.750,00",
    );
    await expect(card).toContainText("Cenário Conservador");
    await expect(card).toContainText("horizonte de 90 dias");
    await expect(card).toContainText("Não configurado (padrão R$ 0)");

    await card
      .getByRole("link", {
        name: "Ver composição do disponível para gastar",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/spendable\/breakdown\/?$/u);
    const breakdown = page.getByTestId("spendable-breakdown");
    await expect(breakdown).toBeVisible();
    await expect(
      breakdown.getByTestId("spendable-breakdown-metric-raw"),
    ).toContainText("R$ 1.750,00");
    await expect(breakdown).toContainText(
      "Menor saldo projetado (R$ 1.750,00) menos buffer operacional (R$ 0,00)",
    );
    await expect(breakdown.getByText("Origem: Evento planejado").first()).toBeVisible();
    await expect(breakdown.getByText("-R$ 750,00", { exact: true })).toBeVisible();

    const originLink = breakdown
      .getByRole("link", {
        name: "Ver origem do item que influencia o saldo mínimo",
        exact: true,
      })
      .first();
    await expect(originLink).toBeVisible();
    await originLink.focus();
    await expect(originLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("forecast-origin-route")).toBeVisible();
    await expect(page.getByTestId("forecast-origin-detail")).toContainText(
      futureExpenseDescription,
    );

    await page.goto(
      `/spendable/breakdown?asOf=${asOf}&scenario=EXPECTED&horizon=90`,
    );
    const expectedCard = page.getByTestId("spendable-breakdown-card");
    await expect(expectedCard).toHaveAttribute("data-state", "positive");
    await expect(
      expectedCard.getByTestId("spendable-breakdown-card-primary-value"),
    ).toHaveAttribute("aria-label", "Pode gastar: R$ 1.750,00");
    await expect(page.getByTestId("spendable-breakdown")).toContainText(
      "horizonte de 90 dias",
    );
  });

  test("mostra zero com compromisso futuro e reconciliação sem déficit", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const suffix = Date.now().toString(36);
    const accountName = `Conta spendable zero ${suffix}`;
    const incomeCategory = `Receita zero ${suffix}`;
    const expenseCategory = `Despesa zero ${suffix}`;
    const expenseDescription = `Compromisso zero spendable ${suffix}`;

    await signIn(page, uniqueEmail("zero"));
    await createAccount(page, accountName);
    await createCategory(page, incomeCategory, "INCOME");
    await createCategory(page, expenseCategory, "EXPENSE");
    const asOf = await createPostedTransaction(page, {
      accountName,
      amountCents: "100000",
      categoryName: incomeCategory,
      description: `Saldo zero spendable ${suffix}`,
      kind: "INCOME",
    });
    await createPlannedEvent(page, {
      amountCents: "100000",
      date: addDays(asOf, 7),
      description: expenseDescription,
    });

    await page.goto("/app");
    const card = spendableCard(page, "spendable-card");
    await expect(card).toHaveAttribute("data-state", "zero");
    await expect(card.getByTestId("spendable-card-primary-value")).toHaveAttribute(
      "aria-label",
      "Pode gastar: R$ 0,00",
    );
    await expect(card.getByTestId("spendable-card-zero")).toBeVisible();
    await expect(card.getByTestId("spendable-card-deficit")).toHaveCount(0);

    await card
      .getByRole("link", {
        name: "Ver composição do disponível para gastar",
        exact: true,
      })
      .click();
    const breakdown = page.getByTestId("spendable-breakdown");
    await expect(
      breakdown.getByTestId("spendable-breakdown-metric-raw"),
    ).toContainText("R$ 0,00");
    await expect(
      breakdown.getByTestId("spendable-breakdown-metric-deficit"),
    ).toContainText("R$ 0,00");
    await expect(breakdown).toContainText("Não há déficit para preservar a reserva.");
    await expect(breakdown.getByText(expenseDescription)).toHaveCount(0);
    await expect(breakdown.getByText("-R$ 1.000,00", { exact: true })).toBeVisible();
  });

  test("mostra R$ 0 gastável e o déficit bruto correto", async ({ page }) => {
    test.setTimeout(150_000);
    const suffix = Date.now().toString(36);
    const accountName = `Conta spendable déficit ${suffix}`;
    const incomeCategory = `Receita déficit ${suffix}`;
    const expenseCategory = `Despesa déficit ${suffix}`;

    await signIn(page, uniqueEmail("deficit"));
    await createAccount(page, accountName);
    await createCategory(page, incomeCategory, "INCOME");
    await createCategory(page, expenseCategory, "EXPENSE");
    const asOf = await createPostedTransaction(page, {
      accountName,
      amountCents: "100000",
      categoryName: incomeCategory,
      description: `Saldo déficit spendable ${suffix}`,
      kind: "INCOME",
    });
    await createPlannedEvent(page, {
      amountCents: "150000",
      date: addDays(asOf, 7),
      description: `Compromisso déficit spendable ${suffix}`,
    });

    await page.goto("/app");
    const card = spendableCard(page, "spendable-card");
    await expect(card).toHaveAttribute("data-state", "deficit");
    const primary = card.getByTestId("spendable-card-primary-value");
    await expect(primary).toHaveAttribute("aria-label", "Pode gastar: R$ 0,00");
    await expect(primary).not.toContainText("-R$");
    await expect(card.getByTestId("spendable-card-deficit")).toContainText(
      "R$ 500,00",
    );

    await card
      .getByRole("link", {
        name: "Ver composição do disponível para gastar",
        exact: true,
      })
      .click();
    const breakdown = page.getByTestId("spendable-breakdown");
    await expect(
      breakdown.getByTestId("spendable-breakdown-metric-raw"),
    ).toContainText("-R$ 500,00");
    await expect(
      breakdown.getByTestId("spendable-breakdown-metric-display"),
    ).toContainText("R$ 0,00");
    await expect(
      breakdown.getByTestId("spendable-breakdown-metric-deficit"),
    ).toContainText("R$ 500,00");
    await expect(breakdown).toContainText(
      "O déficit para preservar a reserva é R$ 500,00.",
    );
  });

  test("mostra parcelas futuras uma vez na projeção e na composição causal", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const suffix = Date.now().toString(36);
    const accountName = `Conta spendable parcelas ${suffix}`;
    const incomeCategory = `Receita parcelas ${suffix}`;
    const cardName = `Cartão spendable parcelas ${suffix}`;
    const purchaseDescription = `Compra parcelada spendable ${suffix}`;

    await signIn(page, uniqueEmail("installments"));
    await createAccount(page, accountName);
    await createCategory(page, incomeCategory, "INCOME");
    await createCategory(page, `Despesa parcelas ${suffix}`, "EXPENSE");
    await createPostedTransaction(page, {
      accountName,
      amountCents: "100000",
      categoryName: incomeCategory,
      description: `Saldo parcelas spendable ${suffix}`,
      kind: "INCOME",
    });

    const cardHref = await createCard(page, cardName, accountName);
    await page.goto(cardHref);
    const cardMaintenance = page.getByTestId("credit-card-maintenance");
    await expect(cardMaintenance).toBeVisible();
    const cardText = await cardMaintenance.textContent();
    const purchaseDate = cardText?.match(/Vigente desde\s*(\d{4}-\d{2}-\d{2})/u)?.[1];
    if (!purchaseDate) {
      throw new Error("A data da regra do cartão não foi renderizada.");
    }
    await createPurchase(page, cardHref, purchaseDescription, purchaseDate);

    await page.goto(
      `/forecast?from=${addDays(purchaseDate, 1)}&to=${addDays(
        purchaseDate,
        90,
      )}&scenario=EXPECTED`,
    );
    await expect(page.getByTestId("forecast-route")).toBeVisible();
    await expect(page.getByText(purchaseDescription, { exact: true })).toHaveCount(2);
    await expect(
      page
        .getByTestId("forecast-view-timeline")
        .getByText("Origem: Parcela de cartão", { exact: true }),
    ).toHaveCount(2);

    await page.goto(
      `/spendable/breakdown?asOf=${purchaseDate}&scenario=CONSERVATIVE&horizon=90`,
    );
    const breakdown = page.getByTestId("spendable-breakdown");
    await expect(breakdown).toBeVisible();
    await expect(breakdown.getByText("Origem: Parcela de cartão").first()).toBeVisible();
    await expect(breakdown).not.toContainText("Origem: Pagamento de cartão");
    await expect(breakdown).not.toContainText("Compra total");
  });

  test("expõe fallback de configuração ausente e erro opaco", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, uniqueEmail("fallback"));

    await page.goto("/spendable/breakdown");
    const breakdown = page.getByTestId("spendable-breakdown");
    await expect(breakdown).toBeVisible();
    await expect(breakdown).toContainText("Não configurado (padrão R$ 0)");
    await expect(breakdown).toContainText("Nenhuma configuração aplicável");
    await expect(breakdown.getByTestId("spendable-breakdown-metric-buffer")).toContainText(
      "R$ 0,00",
    );

    await page.goto("/spendable/breakdown?asOf=not-a-date");
    const error = page.getByTestId("spendable-breakdown-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("Não foi possível carregar a disponibilidade");
    await expect(page.locator("body")).not.toContainText("not-a-date");
    await expect(page.locator("body")).not.toContainText("stack");
    await expect(page.locator("body")).not.toContainText("SELECT");
  });

  test("mantém valores, origens e referências isolados entre dois households", async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const suffix = Date.now().toString(36);
    const accountA = `Conta spendable A ${suffix}`;
    const incomeCategoryA = `Receita spendable A ${suffix}`;
    const expenseCategoryA = `Despesa spendable A ${suffix}`;
    const accountB = `Conta spendable B ${suffix}`;
    const incomeCategoryB = `Receita spendable B ${suffix}`;
    const expenseCategoryB = `Despesa spendable B ${suffix}`;
    const eventA = `Evento spendable A ${suffix}`;
    const eventB = `Evento spendable B ${suffix}`;

    await signIn(page, uniqueEmail("household-a"));
    await createAccount(page, accountA);
    await createCategory(page, incomeCategoryA, "INCOME");
    await createCategory(page, expenseCategoryA, "EXPENSE");
    const asOfA = await createPostedTransaction(page, {
      accountName: accountA,
      amountCents: "120000",
      categoryName: incomeCategoryA,
      description: `Saldo spendable A ${suffix}`,
      kind: "INCOME",
    });
    await createPlannedEvent(page, {
      amountCents: "20000",
      date: addDays(asOfA, 7),
      description: eventA,
    });

    const householdBContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
    });
    const householdBPage = await householdBContext.newPage();
    let bOriginHref: string | null = null;
    try {
      await signIn(householdBPage, uniqueEmail("household-b"));
      await createAccount(householdBPage, accountB);
      await createCategory(householdBPage, incomeCategoryB, "INCOME");
      await createCategory(householdBPage, expenseCategoryB, "EXPENSE");
      const asOfB = await createPostedTransaction(householdBPage, {
        accountName: accountB,
        amountCents: "900000",
        categoryName: incomeCategoryB,
        description: `Saldo spendable B ${suffix}`,
        kind: "INCOME",
      });
      await createPlannedEvent(householdBPage, {
        amountCents: "10000",
        date: addDays(asOfB, 7),
        description: eventB,
      });
      await householdBPage.goto(
        `/spendable/breakdown?asOf=${asOfB}&scenario=CONSERVATIVE&horizon=90`,
      );
      const bBreakdown = householdBPage.getByTestId("spendable-breakdown");
      const bCard = householdBPage.getByTestId("spendable-breakdown-card");
      await expect(bCard).toHaveAttribute(
        "data-state",
        "positive",
      );
      await expect(
        bCard
          .getByTestId("spendable-breakdown-card-primary-value")
          .getAttribute("aria-label"),
      ).resolves.toBe("Pode gastar: R$ 8.900,00");
      bOriginHref = await bBreakdown
        .getByRole("link", {
          name: "Ver origem do item que influencia o saldo mínimo",
          exact: true,
        })
        .first()
        .getAttribute("href");
      expect(bOriginHref).toMatch(
        /^\/forecast\/origin\?kind=PLANNED_EVENT&referenceId=[0-9a-f-]{36}/iu,
      );
    } finally {
      await householdBContext.close();
    }

    if (!bOriginHref) {
      throw new Error("A origem do household B não foi renderizada.");
    }

    const foreignMarker = "0192a000-0000-7000-8000-000000000099";
    await page.goto(
      `/spendable/breakdown?asOf=${asOfA}&scenario=CONSERVATIVE&horizon=90&householdId=${foreignMarker}`,
    );
    const aCard = page.getByTestId("spendable-breakdown-card");
    await expect(aCard).toHaveAttribute(
      "data-state",
      "positive",
    );
    await expect(
      aCard
        .getByTestId("spendable-breakdown-card-primary-value")
        .getAttribute("aria-label"),
    ).resolves.toBe("Pode gastar: R$ 1.000,00");
    await expect(page.locator("body")).not.toContainText("R$ 8.900,00");
    await expect(page.locator("body")).not.toContainText(eventB);
    await expect(page.locator("body")).not.toContainText(foreignMarker);
    await expect(page.locator("body")).not.toContainText("householdId");

    await page.goto(bOriginHref);
    await expect(page.getByTestId("forecast-origin-route-error")).toBeVisible();
    await expect(page.getByTestId("forecast-origin-not-found")).toContainText(
      "Origem não encontrada",
    );
    await expect(page.locator("body")).not.toContainText(eventB);
  });
});
