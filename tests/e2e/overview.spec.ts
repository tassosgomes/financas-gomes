import { expect, test, type Page } from "@playwright/test";

const E2E_EMAIL_PATTERN = /^e2e-[a-z0-9-]+@example\.test$/u;

function uniqueEmail(label: string): string {
  const suffix = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  return `e2e-overview-${label}-${suffix}@example.test`;
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

async function createTransaction(
  page: Page,
  values: {
    kind: "EXPENSE" | "INCOME";
    amountCents: string;
    description: string;
    accountName: string;
    categoryName: string;
  },
): Promise<void> {
  await page.goto(`/transactions/new?kind=${values.kind}`);
  await expect(page.getByTestId("transaction-create-form")).toBeVisible();
  const form = page.getByTestId("transaction-create-form");
  await form
    .getByTestId("transaction-create-form-amount-input")
    .fill(values.amountCents);
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
  await expect(page.getByTestId("transaction-create-success")).toBeVisible();
}

/**
 * Partial-origin failure is not injected in the browser: there is no public
 * hook to fail one S10 origin while keeping the rest ready. Isolation is
 * covered by `overview-home.test.tsx`, `composition.test.ts` and
 * `service.test.ts` (spendable remains usable when forecast/commitments fail).
 */
test.describe("S10 visão geral", () => {
  test("espaço financeiro novo mostra estados vazios sem número inventado de erro", async ({
    page,
  }) => {
    await signIn(page, uniqueEmail("empty"));

    await expect(page.getByTestId("overview-page")).toBeVisible();
    await expect(page.getByTestId("overview-spendable")).toBeVisible();
    await expect(page.getByTestId("home-spendable")).toBeVisible();
    await expect(page.getByTestId("quick-transaction-actions")).toBeVisible();
    await expect(page.getByTestId("add-expense")).toBeVisible();
    await expect(page.getByTestId("add-income")).toBeVisible();

    await expect(page.getByTestId("overview-period-summary-empty")).toBeVisible();
    await expect(page.getByTestId("overview-categories-empty")).toBeVisible();
    await expect(page.getByTestId("overview-commitments-empty")).toBeVisible();
    await expect(page.getByTestId("overview-caixinhas-empty")).toBeVisible();

    await expect(page.getByTestId("overview-period-summary-error")).toHaveCount(0);
    await expect(page.getByTestId("overview-categories-error")).toHaveCount(0);
    await expect(page.getByTestId("overview-alerts")).toHaveCount(0);
    await expect(page.getByTestId("overview-period-summary-empty")).not.toContainText(
      "R$ 0,00",
    );
  });

  test("resumo do mês reconcilia com o drill-down de despesas", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const accountName = `Conta visão ${suffix}`;
    const expenseCategory = `Alimentação ${suffix}`;
    const incomeCategory = `Salário ${suffix}`;

    await signIn(page, uniqueEmail("ready"));
    await createAccount(page, accountName);
    await createCategory(page, expenseCategory, "EXPENSE");
    await createCategory(page, incomeCategory, "INCOME");
    await createTransaction(page, {
      kind: "INCOME",
      amountCents: "150000",
      description: `Receita visão ${suffix}`,
      accountName,
      categoryName: incomeCategory,
    });
    await createTransaction(page, {
      kind: "EXPENSE",
      amountCents: "45000",
      description: `Despesa visão ${suffix}`,
      accountName,
      categoryName: expenseCategory,
    });

    await page.goto("/app");
    await expect(page.getByTestId("overview-page")).toBeVisible();
    await expect(page.getByTestId("overview-period-summary")).toBeVisible();
    await expect(page.getByTestId("overview-period-income")).toContainText(
      "R$ 1.500,00",
    );
    await expect(page.getByTestId("overview-period-expense")).toContainText(
      "R$ 450,00",
    );
    await expect(page.getByTestId("overview-categories")).toContainText(
      expenseCategory,
    );
    await expect(page.getByTestId("overview-categories")).toContainText("R$ 450,00");

    const spendablePrimary = page.getByTestId("spendable-card-primary-value");
    await expect(spendablePrimary).toBeVisible();
    const homeSpendable = (await spendablePrimary.textContent()) ?? "";

    await page.getByTestId("overview-period-expense-drilldown").click();
    await expect(page).toHaveURL(/\/transactions\?/);
    await expect(page).toHaveURL(/kind=EXPENSE/);
    await expect(page).toHaveURL(/status=POSTED/);
    await expect(page.getByTestId("transactions-route")).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: `Abrir lançamento Despesa visão ${suffix}`,
        exact: true,
      }),
    ).toBeVisible();

    await page.goto("/app");
    await page.getByRole("link", { name: "Ver composição do disponível para gastar" }).click();
    await expect(page).toHaveURL(/\/spendable\/breakdown/);
    await expect(page.getByTestId("spendable-card-primary-value")).toHaveText(
      homeSpendable,
    );
  });

  test("consulta mobile em 360px não gera scroll horizontal na home", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await signIn(page, uniqueEmail("mobile"));
    await expect(page.getByTestId("overview-page")).toBeVisible();

    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
      };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
});
