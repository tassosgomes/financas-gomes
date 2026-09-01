import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Continuar com Google" }).click();
  await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Seu espaço financeiro" }),
  ).toBeVisible();
}

test.describe("S02 contas e categorias", () => {
  test("cria conta e gerencia uma categoria pelo fluxo autenticado", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const suffix = Date.now().toString(36);
    const accountName = `Conta E2E ${suffix}`;
    const categoryName = `Categoria E2E ${suffix}`;
    const editedCategoryName = `Categoria E2E editada ${suffix}`;

    await signIn(page);

    await page.locator('a[href="/accounts"]:visible').click();
    await expect(page).toHaveURL(/\/accounts\/?$/);
    await expect(page.getByTestId("accounts-screen")).toBeVisible();
    // The dev server keeps an HMR connection open, so network-idle is not a
    // stable readiness signal. Give the client boundary a moment to hydrate.
    await page.waitForTimeout(500);

    await page.getByTestId("accounts-create-button").click();
    await expect(page.getByTestId("account-form-create")).toBeVisible();
    await page.getByTestId("account-name-input").fill(accountName);
    await page
      .getByTestId("account-form")
      .getByRole("button", { name: "Criar conta", exact: true })
      .click();
    await expect(page.getByTestId("accounts-success")).toContainText(
      "Conta criada.",
    );
    await expect(
      page.getByTestId("accounts-table").getByText(accountName, {
        exact: true,
      }),
    ).toBeVisible();

    // A fresh request verifies the account was persisted before crossing to
    // the settings route and avoids coupling the next navigation to the
    // server-action refresh transition.
    await page.reload();
    await expect(page.getByTestId("accounts-screen")).toBeVisible();
    await page.waitForTimeout(500);

    await Promise.all([
      page.waitForURL(/\/settings\/categories\/?$/, { waitUntil: "commit" }),
      page.getByRole("link", { name: "Categorias", exact: true }).last().click(),
    ]);
    await expect(page.getByTestId("categories-screen")).toBeVisible();
    await page.waitForTimeout(500);

    await page.getByTestId("categories-create-button").click();
    await expect(page.getByTestId("category-form-create")).toBeVisible();
    await page.getByTestId("category-name-input").fill(categoryName);
    await page.getByTestId("category-kind-input").selectOption("EXPENSE");
    await page
      .getByTestId("category-form")
      .getByRole("button", { name: "Criar categoria", exact: true })
      .click();
    await expect(page.getByTestId("categories-success")).toContainText(
      "Categoria criada.",
    );
    await expect(
      page.getByTestId("categories-table").getByText(categoryName, {
        exact: true,
      }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: `Editar ${categoryName}`, exact: true })
      .click();
    await expect(page.getByTestId("category-form-edit")).toBeVisible();
    await page.getByTestId("category-name-input").fill(editedCategoryName);
    await page
      .getByTestId("category-form")
      .getByRole("button", { name: "Salvar alterações", exact: true })
      .click();
    await expect(page.getByTestId("categories-success")).toContainText(
      "Categoria atualizada.",
    );
    await expect(
      page.getByTestId("categories-table").getByText(editedCategoryName, {
        exact: true,
      }),
    ).toBeVisible();

    await page
      .getByRole("button", {
        name: `Arquivar a categoria ${editedCategoryName}`,
        exact: true,
      })
      .click();
    await page
      .getByRole("group", { name: "Confirmar arquivamento" })
      .getByRole("button", { name: "Confirmar", exact: true })
      .click();
    await expect(page.getByTestId("categories-success")).toContainText(
      "Categoria arquivada.",
    );
    await expect(
      page.getByTestId("categories-table").getByText(editedCategoryName, {
        exact: true,
      }),
    ).toHaveCount(0);

    await page.getByTestId("categories-archived-toggle").click();
    await expect(
      page.getByTestId("categories-table").getByText(editedCategoryName, {
        exact: true,
      }),
    ).toBeVisible();
  });
});
