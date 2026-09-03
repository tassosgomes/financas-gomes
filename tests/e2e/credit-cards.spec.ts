import { expect, test, type Locator, type Page } from "@playwright/test";

const E2E_HOUSEHOLD_B_EMAIL = "e2e-household-b@example.test";

/**
 * The E2E provider is deliberately the only authentication fixture used by
 * this suite.  Financial mutations are always performed by the rendered UI;
 * no card, purchase, statement or payment is inserted through PostgreSQL.
 */
async function signIn(
  page: Page,
  options: { email?: string } = {},
): Promise<void> {
  const routePattern = "**/api/auth/sign-in/social";
  if (options.email) {
    await page.route(routePattern, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }

      const body = route.request().postDataJSON() as Record<string, unknown>;
      await route.continue({
        postData: JSON.stringify({ ...body, loginHint: options.email }),
      });
    });
  }

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Continuar com Google" }).click();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "Seu espaço financeiro" }),
    ).toBeVisible();
  } finally {
    if (options.email) {
      await page.unroute(routePattern);
    }
  }
}

function inputInside(testId: string, page: Page): Locator {
  return page.getByTestId(testId).locator("input");
}

/** MoneyInput receives integer cents as typed digits, not a floating value. */
async function fillMoney(page: Page, testId: string, cents: string): Promise<void> {
  const input = inputInside(testId, page);
  await input.fill(cents);
  await expect(input).toHaveValue(/,\d{2}$/);
}

async function createPaymentAccount(page: Page, name: string): Promise<void> {
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

async function createCard(
  page: Page,
  cardName: string,
  paymentAccountName: string,
): Promise<{ cardHref: string; cardId: string }> {
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
    .selectOption({ label: paymentAccountName });
  await page
    .getByTestId("credit-card-create-form")
    .getByRole("button", { name: "Cadastrar cartão", exact: true })
    .click();

  const success = page.getByTestId("credit-card-create-success");
  await expect(success).toBeVisible();
  await expect(success).toContainText("Cartão cadastrado com sucesso.");
  const cardHref = await success
    .getByRole("link", { name: "Consultar cartão", exact: true })
    .getAttribute("href");
  expect(cardHref).toMatch(/^\/credit-cards\/[0-9a-f-]+$/iu);
  const resolvedCardHref = cardHref as string;
  return {
    cardHref: resolvedCardHref,
    cardId: resolvedCardHref.split("/").at(-1) as string,
  };
}

interface PurchaseResult {
  purchaseHref: string;
  occurredOn: string;
}

async function createPurchase(
  page: Page,
  cardHref: string,
  description: string,
  amountCents: string,
  installmentCount: number,
): Promise<PurchaseResult> {
  await page.goto(`${cardHref}/purchases/new`);
  await expect(page.getByTestId("credit-card-card-purchase-route")).toBeVisible();
  await expect(page.getByTestId("credit-card-purchase-form")).toBeVisible();

  const dateInput = inputInside("credit-card-purchase-date-field", page);
  const occurredOn = await dateInput.inputValue();
  expect(occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await fillMoney(page, "credit-card-purchase-amount-field", amountCents);
  await dateInput.fill(occurredOn);
  await page
    .locator("#credit-card-purchase-description")
    .fill(description);
  await page
    .locator("#credit-card-purchase-installments")
    .fill(String(installmentCount));

  await page
    .getByTestId("credit-card-purchase-form")
    .getByRole("button", { name: "Confirmar compra", exact: true })
    .click();

  const success = page.getByTestId("credit-card-purchase-success");
  await expect(success).toBeVisible();
  await expect(success).toContainText("Compra registrada.");
  const scheduleTable = success.getByTestId("credit-card-purchase-schedule-table");
  await expect(scheduleTable).toBeVisible();
  await expect(scheduleTable.locator("tbody tr")).toHaveCount(installmentCount);
  await expect(
    success.getByTestId("credit-card-purchase-schedule-totals"),
  ).toContainText(String(installmentCount));

  const purchaseHref = await success
    .getByRole("link", { name: "Ver compra", exact: true })
    .getAttribute("href");
  expect(purchaseHref).toMatch(/^\/credit-cards\/[0-9a-f-]+\/purchases\/[0-9a-f-]+$/iu);
  return { purchaseHref: purchaseHref as string, occurredOn };
}

async function registerGlobalPayment(
  page: Page,
  sourceAccountName: string,
  amountCents: string,
  expectedStatus: RegExp,
): Promise<void> {
  const payment = page.getByTestId("credit-card-billing-screen-payment-form");
  await expect(payment).toBeVisible();
  await payment
    .getByTestId("credit-card-billing-screen-payment-form-source-account-field")
    .locator("select")
    .selectOption({ label: sourceAccountName });
  await fillMoney(
    page,
    "credit-card-billing-screen-payment-form-amount-field",
    amountCents,
  );
  const dateInput = inputInside(
    "credit-card-billing-screen-payment-form-date-field",
    page,
  );
  await dateInput.fill(await dateInput.inputValue());
  await payment
    .getByRole("button", { name: "Confirmar pagamento global", exact: true })
    .click();
  await expect(payment.getByTestId("credit-card-billing-screen-payment-form-feedback"))
    .toContainText("Pagamento global registrado.");
  await expect(page.getByTestId("credit-card-billing-screen-payment-status"))
    .toContainText(expectedStatus);
}

test.describe("T16 — fluxo crítico de cartões, faturas e parcelas", () => {
  test("cadastra, compra à vista/parcelada, paga globalmente e cancela o aggregate", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const suffix = Date.now().toString(36);
    const accountName = `Conta cartão E2E ${suffix}`;
    const cardName = `Cartão crítico E2E ${suffix}`;
    const cashDescription = `Compra à vista E2E ${suffix}`;
    const installmentDescription = `Compra 3x E2E ${suffix}`;
    const editedDescription = `Compra 3x editada E2E ${suffix}`;

    await signIn(page);
    await createPaymentAccount(page, accountName);
    const { cardHref, cardId } = await createCard(page, cardName, accountName);

    // Use a second browser context and a strict synthetic provider identity to
    // create a real B-owned card through the UI. A's request must receive the
    // same not-found boundary as any other cross-household resource.
    const householdBContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
    });
    try {
      const householdBPage = await householdBContext.newPage();
      const householdBAccountName = `Conta household B E2E ${suffix}`;
      const householdBCardName = `Cartão household B E2E ${suffix}`;
      await signIn(householdBPage, { email: E2E_HOUSEHOLD_B_EMAIL });
      await createPaymentAccount(householdBPage, householdBAccountName);
      const { cardHref: householdBCardHref } = await createCard(
        householdBPage,
        householdBCardName,
        householdBAccountName,
      );
      await householdBPage.goto(householdBCardHref);
      await expect(
        householdBPage.getByRole("heading", {
          name: householdBCardName,
          exact: true,
        }),
      ).toBeVisible();

      await page.goto(householdBCardHref);
      await expect(page.locator("body")).toContainText("404");
      await expect(page.getByTestId("credit-card-detail-route")).toHaveCount(0);
    } finally {
      await householdBContext.close();
    }

    await page.goto(cardHref);
    await expect(page.getByTestId("credit-card-detail-route")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: cardName, exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("credit-card-billing-screen-projection")).toBeVisible();
    await expect(page.getByTestId("credit-card-billing-screen-payment-form")).toBeVisible();

    // A new versioned billing rule is a UI mutation; existing purchase
    // snapshots below remain tied to the rule returned at their creation.
    await inputInside("credit-card-edit-closing-day-field", page).fill("12");
    await inputInside("credit-card-edit-due-day-field", page).fill("22");
    await inputInside("credit-card-effective-from-field", page).fill(
      // Keep this civil date independent from the browser/server timezone.
      // The initial rule is stamped by the server's UTC date; deriving a
      // relative date in the test process can equal it around local midnight.
      "2099-01-01",
    );
    await page
      .getByTestId("credit-card-maintenance")
      .getByRole("button", { name: "Criar nova regra", exact: true })
      .click();
    await expect(page.getByTestId("credit-card-maintenance")).toContainText(
      "Nova regra de cobrança criada.",
    );

    const cashPurchase = await createPurchase(
      page,
      cardHref,
      cashDescription,
      "12345",
      1,
    );
    await expect(page.getByTestId("credit-card-purchase-schedule-table").locator("tbody tr"))
      .toHaveCount(1);
    await page.getByRole("link", { name: "Ver cartão", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${cardHref}/?$`));
    await expect(page.getByTestId("credit-card-billing-screen-statements")).toContainText(
      cashDescription,
    );
    await expect(
      page.getByTestId("credit-card-billing-screen-statements").getByRole("link", {
        name: cashDescription,
        exact: true,
      }),
    ).toHaveAttribute("href", cashPurchase.purchaseHref);

    const installmentPurchase = await createPurchase(
      page,
      cardHref,
      installmentDescription,
      "10000",
      3,
    );
    const installmentTable = page.getByTestId("credit-card-purchase-schedule-table");
    await expect(installmentTable.locator("tbody tr")).toHaveCount(3);
    await expect(installmentTable.getByLabel("Parcela 1 de 3")).toBeVisible();
    await expect(installmentTable.getByLabel("Parcela 2 de 3")).toBeVisible();
    await expect(installmentTable.getByLabel("Parcela 3 de 3")).toBeVisible();
    await expect(installmentTable.getByLabel("Valor R$ 33,34")).toBeVisible();
    await expect(installmentTable.getByLabel("Valor R$ 33,33")).toHaveCount(2);

    await page.getByRole("link", { name: "Ver cartão", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${cardHref}/?$`));
    const statements = page.getByTestId("credit-card-billing-screen-statements");
    await expect(statements).toContainText(installmentDescription);
    const installmentOriginLinks = statements.getByRole("link", {
      name: installmentDescription,
      exact: true,
    });
    await expect(installmentOriginLinks).toHaveCount(3);
    await expect(installmentOriginLinks.first()).toHaveAttribute(
      "href",
      installmentPurchase.purchaseHref,
    );
    await expect(
      statements.getByTestId("credit-card-billing-screen-statements-future-0"),
    ).toBeVisible();
    await expect(
      statements.getByTestId("credit-card-billing-screen-statements-future-1"),
    ).toBeVisible();

    // The payment form is global and has no installment/statement target.
    await expect(
      page.getByTestId("credit-card-billing-screen-payment-form")
        .getByRole("button", { name: /parcela/i }),
    ).toHaveCount(0);
    await registerGlobalPayment(page, accountName, "10000", /Parcialmente paga/);
    await registerGlobalPayment(page, accountName, "12345", /Paga/);
    await registerGlobalPayment(page, accountName, "100", /Saldo credor/);
    await expect(page.getByTestId("credit-card-billing-screen-projection")).toContainText(
      "Saldo credor",
    );

    // Open the future statement through its period link and preserve the
    // server-provided origin URL; this exercises current/future projection
    // navigation without deriving a cycle in the browser.
    const periodLink = statements.getByRole("link", { name: /Consultar competência/i }).first();
    if (await periodLink.count()) {
      await periodLink.click();
      await expect(page).toHaveURL(/period=/);
      await expect(page.getByTestId("credit-card-billing-screen-statements")).toContainText(
        installmentDescription,
      );
    }

    await page.goto(installmentPurchase.purchaseHref);
    const detail = page.getByTestId("credit-card-purchase-detail-screen");
    await expect(detail).toBeVisible();
    await expect(detail.getByLabel("Status da compra: Ativa")).toBeVisible();
    await expect(detail.getByTestId("credit-card-purchase-detail-screen-schedule-table").locator("tbody tr"))
      .toHaveCount(3);
    await expect(detail.getByRole("button", { name: /pagar parcela|pagar prestação/i })).toHaveCount(0);

    await detail.getByLabel("Descrição").fill(editedDescription);
    await detail.getByRole("button", { name: "Salvar metadata", exact: true }).click();
    await expect(detail.getByTestId("credit-card-purchase-detail-screen-feedback"))
      .toContainText("Dados da compra atualizados.");
    await expect(page.getByRole("heading", { name: editedDescription })).toBeVisible();

    await detail
      .getByTestId("credit-card-purchase-detail-screen-cancel-section")
      .getByRole("button", { name: "Cancelar compra inteira", exact: true })
      .click();
    const confirmation = detail.getByTestId("credit-card-purchase-detail-screen-cancel-confirmation");
    await expect(confirmation).toBeVisible();
    await confirmation
      .getByRole("button", { name: "Cancelar compra inteira", exact: true })
      .click();
    await expect(detail.getByTestId("credit-card-purchase-detail-screen-feedback"))
      .toContainText("Compra cancelada.");
    await expect(detail.getByLabel("Status da compra: Cancelada")).toBeVisible();
    await expect(detail).toContainText("histórico foi preservado");
    await expect(detail.getByRole("button", { name: /pagar parcela|pagar prestação/i })).toHaveCount(0);

    await page.goto(cardHref);
    await expect(page.getByTestId("credit-card-billing-screen-projection")).toBeVisible();
    await expect(page.getByTestId("credit-card-billing-screen-statements")).not.toContainText(
      editedDescription,
    );
    await expect(page.getByTestId("credit-card-billing-screen-payment-status")).toContainText(
      "Saldo credor",
    );
    expect(cardId).toMatch(/^[0-9a-f-]+$/iu);
  });

  test("exige sessão e rejeita IDs opacos fora do contexto autenticado", async ({
    page,
    browser,
  }) => {
    test.setTimeout(60_000);
    const anonymousContext = await browser.newContext();
    try {
      const anonymous = await anonymousContext.newPage();
      await anonymous.goto("/credit-cards");
      await expect(anonymous).toHaveURL(/\/?$/);
      await expect(
        anonymous.getByRole("button", { name: "Continuar com Google" }),
      ).toBeVisible();
      await anonymous.close();
    } finally {
      await anonymousContext.close();
    }

    await signIn(page);
    const foreignCardId = "0192a000-0000-7000-8000-000000000000";
    await page.goto(`/credit-cards/${foreignCardId}`);
    // Next's development server can return a successful document transport
    // status for notFound() while rendering its 404 boundary. Assert the
    // boundary itself so this remains valid in both dev and production.
    await expect(page.locator("body")).toContainText("404");
    await expect(page.getByTestId("credit-card-detail-route")).toHaveCount(0);
  });
});
