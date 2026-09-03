import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

import {
  cleanupS09E2EHouseholds,
  createS09E2EBudgetFixture,
  createS09E2ERunId,
  readS09E2EFinancialCounts,
  S09_E2E_EMAIL_PATTERN,
  type S09E2EBudgetFixture,
} from "../fixtures/s09-caixinhas/e2e-fixtures";

function e2eBaseURL(): string {
  return `http://127.0.0.1:${process.env.E2E_PORT ?? "3100"}`;
}

async function signIn(page: Page, email: string): Promise<void> {
  if (!S09_E2E_EMAIL_PATTERN.test(email)) {
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

function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function createCategory(page: Page, name: string): Promise<void> {
  await page.goto("/settings/categories");
  await expect(page.getByTestId("categories-screen")).toBeVisible();
  await page.getByTestId("categories-create-button").click();
  const form = page.getByTestId("category-form-create");
  await expect(form).toBeVisible();
  await page.getByTestId("category-name-input").fill(name);
  await page.getByTestId("category-kind-input").selectOption("EXPENSE");
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

async function createBudget(
  page: Page,
  values: {
    name: string;
    categoryName: string;
    withGoal?: boolean;
    goalAmountCents?: string;
  },
): Promise<string> {
  await page.goto("/budgets");
  await expect(page.getByTestId("budgets-screen")).toBeVisible();
  await page.getByTestId("budgets-create-button").click();
  const form = page.getByTestId("budget-form");
  await expect(form).toBeVisible();
  await form.getByLabel("Nome", { exact: true }).fill(values.name);
  await form
    .getByLabel("Categoria de despesa", { exact: true })
    .selectOption({ label: values.categoryName });
  const activeFromInput = form.getByLabel("Início da vigência", { exact: true });
  await activeFromInput.fill(todayIso());

  if (values.withGoal) {
    const activeFrom = await activeFromInput.inputValue();
    await form.locator('input[type="checkbox"]').check();
    await form
      .getByLabel("Valor da meta", { exact: true })
      .fill(values.goalAmountCents ?? "100000");
    await form
      .getByLabel("Data da meta", { exact: true })
      .fill(addDays(activeFrom, 90));
  }

  await form.getByRole("button", { name: "Criar Caixinha", exact: true }).click();
  await expect(page.getByTestId("budgets-success")).toContainText(
    "Caixinha criada.",
  );
  const link = page
    .getByTestId("budgets-table")
    .getByRole("link", { name: values.name, exact: true });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/budgets\/[0-9a-f-]+$/iu);
  return href as string;
}

function balanceCard(page: Page): Locator {
  return page.getByRole("heading", { name: "Balanço", exact: true }).locator("..");
}

function movementList(page: Page): Locator {
  return page.locator('section[aria-label="Movimentos do orçamento"]');
}

async function submitMovement(
  page: Page,
  mode: "CONTRIBUTION" | "WITHDRAWAL" | "TRANSFER",
  amountCents: string,
  destinationName?: string,
): Promise<void> {
  const labels = {
    CONTRIBUTION: ["Aportar", "Revisar aporte", "Confirmar aporte"],
    WITHDRAWAL: ["Retirar", "Revisar retirada", "Confirmar retirada"],
    TRANSFER: ["Transferir", "Revisar transferência", "Confirmar transferência"],
  } as const;
  await page.getByRole("button", { name: labels[mode][0], exact: true }).click();
  const form = page.getByTestId("budget-movement-form");
  await expect(form).toBeVisible();
  await form.getByLabel("Valor", { exact: true }).fill(amountCents);
  if (mode === "TRANSFER") {
    if (!destinationName) throw new Error("Destino ausente para transferência E2E");
    await form
      .getByLabel("Caixinha de destino", { exact: true })
      .selectOption({ label: destinationName });
  }
  await form.getByRole("button", { name: labels[mode][1], exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: labels[mode][2], exact: true })
    .click();
  await expect(page.getByTestId("budget-detail-success")).toBeVisible();
}

async function readProtectedAmount(page: Page): Promise<string> {
  await page.goto("/spendable/breakdown");
  await expect(page.getByTestId("spendable-breakdown-route")).toBeVisible();
  const breakdown = page.getByTestId("spendable-breakdown");
  await expect(breakdown).toBeVisible();
  const reserve = breakdown.getByTestId("spendable-breakdown-reserve");
  await expect(reserve).toBeVisible();
  return (await reserve.locator("dd").nth(1).innerText()).trim();
}

async function closeBudget(page: Page, name: string): Promise<void> {
  await page.goto("/budgets");
  await page.getByRole("button", { name: `Encerrar ${name}`, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByTestId("budgets-success")).toContainText(
    "histórico permanece acessível",
  );
}

async function createBudgetForIsolation(
  page: Page,
  fixture: S09E2EBudgetFixture,
  budgetName: string,
): Promise<string> {
  await createCategory(page, fixture.foreignCategoryName);
  return createBudget(page, {
    categoryName: fixture.foreignCategoryName,
    name: budgetName,
  });
}

async function openSecondContext(browser: Browser): Promise<{ context: Awaited<ReturnType<Browser["newContext"]>>; page: Page }> {
  const context = await browser.newContext({ baseURL: e2eBaseURL() });
  return { context, page: await context.newPage() };
}

test.describe("T14 — fluxo crítico de Caixinhas no browser", () => {
  test("cria, aporta, retira, transfere, consulta Spendable e encerra preservando histórico", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const fixture = createS09E2EBudgetFixture(createS09E2ERunId());

    try {
      await signIn(page, fixture.primaryEmail);
      await page.goto("/budgets");
      await expect(page.getByTestId("budgets-empty")).toBeVisible();

      await createCategory(page, fixture.primaryCategoryName);
      await createCategory(page, fixture.destinationCategoryName);
      const sourceHref = await createBudget(page, {
        categoryName: fixture.primaryCategoryName,
        goalAmountCents: fixture.goalAmountCents,
        name: fixture.primaryBudgetName,
        withGoal: true,
      });
      const destinationHref = await createBudget(page, {
        categoryName: fixture.destinationCategoryName,
        name: fixture.destinationBudgetName,
      });

      await page.goto(sourceHref);
      await expect(
        page.getByRole("heading", { name: `Caixinha: ${fixture.primaryBudgetName}` }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "Progresso do orçamento" })).toBeVisible();
      await expect(page.getByText("Sugerido por mês", { exact: true })).toBeVisible();
      await expect(page.getByText("Nenhum movimento de orçamento.", { exact: true })).toBeVisible();

      await submitMovement(page, "CONTRIBUTION", fixture.firstContributionCents);
      await expect(balanceCard(page).locator("dd").first()).toHaveText("R$ 100,00");
      await submitMovement(page, "CONTRIBUTION", fixture.secondContributionCents);
      await expect(balanceCard(page).locator("dd").first()).toHaveText("R$ 150,00");
      await expect(
        page.getByRole("progressbar", { name: "Progresso da meta" }),
      ).toHaveAttribute("aria-valuenow", /[1-9]\d*/u);

      const protectedAfterContributions = await readProtectedAmount(page);
      expect(protectedAfterContributions).toBe("R$ 150,00");

      await page.goto(sourceHref);
      await page.getByRole("button", { name: "Aportar", exact: true }).click();
      const invalidForm = page.getByTestId("budget-movement-form");
      await invalidForm
        .getByRole("button", { name: "Revisar aporte", exact: true })
        .click();
      await expect(page.getByText("centavos positivos inválidos", { exact: true })).toBeVisible();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await page.goto(sourceHref);
      await expect(balanceCard(page).locator("dd").first()).toHaveText("R$ 150,00");

      await expect(
        page.getByText(/não são receita, despesa bancária ou pagamento de cartão/i),
      ).toBeVisible();
      await submitMovement(page, "WITHDRAWAL", fixture.withdrawalCents);
      await expect(balanceCard(page).locator("dd").first()).toHaveText("R$ 120,00");
      await expect(movementList(page).locator("li")).toHaveCount(3);

      await submitMovement(
        page,
        "TRANSFER",
        fixture.transferCents,
        fixture.destinationBudgetName,
      );
      await expect(balanceCard(page).locator("dd").first()).toHaveText("R$ 95,00");
      await expect(movementList(page).locator("li")).toHaveCount(4);
      await expect(movementList(page)).toContainText("transferência");

      await page.goto(destinationHref);
      await expect(balanceCard(page).locator("dd").first()).toHaveText("R$ 25,00");
      await expect(movementList(page).locator("li")).toHaveCount(1);
      await expect(movementList(page)).toContainText("transferência");

      const financialCounts = await readS09E2EFinancialCounts(fixture.primaryEmail);
      expect(financialCounts).toEqual({ financialEvents: 0, accountEntries: 0 });

      const protectedAfterTransfer = await readProtectedAmount(page);
      expect(protectedAfterTransfer).toBe("R$ 120,00");
      await page.goto("/app");
      const spendableCard = page.getByTestId("spendable-card");
      await expect(spendableCard).toBeVisible();
      await expect(spendableCard).toHaveAttribute("data-state", /positive|zero|deficit/u);
      await expect(
        spendableCard.getByTestId("spendable-card-primary-value"),
      ).toHaveAttribute("aria-label", /Pode gastar: R\$ /u);
      await spendableCard
        .getByRole("link", { name: "Ver composição do disponível para gastar", exact: true })
        .click();
      await expect(page).toHaveURL(/\/spendable\/breakdown\/?$/u);
      await expect(page.getByTestId("spendable-breakdown-reserve")).toContainText("R$ 120,00");

      await closeBudget(page, fixture.primaryBudgetName);
      await page.getByTestId("budgets-closed-toggle").click();
      await expect(page.getByTestId("budgets-view-description")).toContainText("encerradas");
      await expect(
        page.getByTestId("budgets-table").getByRole("link", {
          name: fixture.primaryBudgetName,
          exact: true,
        }),
      ).toBeVisible();
      await page.goto(sourceHref);
      await expect(page.getByTestId("budget-closed-message")).toBeVisible();
      await expect(page.getByTestId("budget-movement-contribution-button")).toHaveCount(0);
      await expect(movementList(page).locator("li")).toHaveCount(4);
      await expect(page.getByText("R$ 95,00", { exact: true }).first()).toBeVisible();

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/budgets");
      await page.getByTestId("budgets-closed-toggle").click();
      await expect(page.getByTestId("budgets-list")).toBeVisible();
      await expect(
        page.getByTestId("budgets-list").getByRole("link", {
          name: fixture.primaryBudgetName,
          exact: true,
        }),
      ).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 900 });
    } finally {
      await cleanupS09E2EHouseholds([fixture.primaryEmail]);
    }
  });

  test("mostra estado vazio, saldo negativo permitido e encerramento somente leitura", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const fixture = createS09E2EBudgetFixture(createS09E2ERunId());

    try {
      await signIn(page, fixture.primaryEmail);
      await page.goto("/budgets");
      await expect(page.getByTestId("budgets-empty")).toBeVisible();
      await page.getByTestId("budgets-create-button").focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("budget-form")).toBeVisible();

      await createCategory(page, fixture.primaryCategoryName);
      const budgetHref = await createBudget(page, {
        categoryName: fixture.primaryCategoryName,
        name: fixture.primaryBudgetName,
      });
      await page.goto(budgetHref);
      await submitMovement(page, "WITHDRAWAL", "10000");
      await expect(page.getByTestId("budget-negative-message")).toBeVisible();
      await expect(balanceCard(page).locator("dd").first()).toHaveText("-R$ 100,00");
      await expect(movementList(page).locator("li")).toHaveCount(1);
      const protectedAmount = await readProtectedAmount(page);
      expect(protectedAmount).toBe("R$ 0,00");

      await closeBudget(page, fixture.primaryBudgetName);
      await page.goto(budgetHref);
      await expect(page.getByTestId("budget-closed-message")).toBeVisible();
      await expect(page.getByTestId("budget-movement-withdrawal-button")).toHaveCount(0);
      await expect(movementList(page).locator("li")).toHaveCount(1);
      await expect(page.getByText("-R$ 100,00", { exact: true }).first()).toBeVisible();
    } finally {
      await cleanupS09E2EHouseholds([fixture.primaryEmail]);
    }
  });

  test("isola households e rejeita referência de Caixinha forjada", async ({
    browser,
    page,
  }) => {
    test.setTimeout(240_000);
    const fixtureA = createS09E2EBudgetFixture(`a-${createS09E2ERunId()}`);
    const fixtureB = createS09E2EBudgetFixture(`b-${createS09E2ERunId()}`);
    let contextB: Awaited<ReturnType<Browser["newContext"]>> | undefined;

    try {
      await signIn(page, fixtureA.primaryEmail);
      const budgetAHref = await createBudgetForIsolation(
        page,
        fixtureA,
        fixtureA.primaryBudgetName,
      );
      await expect(
        page.getByTestId("budgets-table").getByRole("link", {
          name: fixtureA.primaryBudgetName,
          exact: true,
        }),
      ).toBeVisible();

      const second = await openSecondContext(browser);
      contextB = second.context;
      await signIn(second.page, fixtureB.primaryEmail);
      const budgetBHref = await createBudgetForIsolation(
        second.page,
        fixtureB,
        fixtureB.primaryBudgetName,
      );
      await expect(
        second.page.getByTestId("budgets-table").getByRole("link", {
          name: fixtureB.primaryBudgetName,
          exact: true,
        }),
      ).toBeVisible();

      await page.goto("/budgets");
      await expect(page.locator("body")).toContainText(fixtureA.primaryBudgetName);
      await expect(page.locator("body")).not.toContainText(fixtureB.primaryBudgetName);
      await page.goto(`${budgetAHref}?householdId=${encodeURIComponent(fixtureB.runId)}`);
      await expect(page.getByTestId("budget-detail-screen")).toBeVisible();
      await expect(page.locator("body")).not.toContainText(fixtureB.primaryBudgetName);
      await page.goto(budgetBHref);
      await expect(page.getByTestId("budget-detail-route-error")).toBeVisible();
      await expect(page.getByTestId("budget-detail-route-error")).toContainText(
        "Caixinha não foi encontrada",
      );
      await expect(page.locator("body")).not.toContainText(fixtureB.primaryBudgetName);
      const budgetBReference = budgetBHref.split("/").at(-1);
      if (!budgetBReference) throw new Error("Referência B ausente");
      await expect(page.locator("body")).not.toContainText(budgetBReference);
    } finally {
      await contextB?.close();
      await cleanupS09E2EHouseholds([
        fixtureA.primaryEmail,
        fixtureB.primaryEmail,
      ]);
    }
  });
});
