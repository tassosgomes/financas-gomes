import { Client } from "pg";
import { expect, test } from "@playwright/test";

const e2eEmail = process.env.E2E_TEST_AUTH_EMAIL ?? "e2e-auth@example.test";
const e2eDatabaseURL =
  process.env.E2E_DATABASE_URL?.trim() ||
  "postgresql://postgres:postgres@localhost:5433/financas_gomes_test";

async function readPersistedAuthCounts(): Promise<{
  households: number;
  memberships: number;
  users: number;
}> {
  const client = new Client({ connectionString: e2eDatabaseURL });
  await client.connect();

  try {
    const result = await client.query<{
      households: number;
      memberships: number;
      users: number;
    }>(
      `
        SELECT
          (SELECT COUNT(*)::int FROM "user" WHERE email = $1) AS users,
          (
            SELECT COUNT(*)::int
            FROM households AS h
            INNER JOIN household_members AS hm ON hm.household_id = h.id
            INNER JOIN "user" AS u ON u.id = hm.user_id
            WHERE u.email = $1
          ) AS households,
          (
            SELECT COUNT(*)::int
            FROM household_members AS hm
            INNER JOIN "user" AS u ON u.id = hm.user_id
            WHERE u.email = $1
          ) AS memberships
      `,
      [e2eEmail],
    );

    const row = result.rows[0];
    return {
      users: Number(row?.users ?? 0),
      households: Number(row?.households ?? 0),
      memberships: Number(row?.memberships ?? 0),
    };
  } finally {
    await client.end();
  }
}

test.describe("autenticação", () => {
  test("login, primeiro acesso, logout e bloqueio da rota privada", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/");

    const googleButton = page.getByRole("button", {
      name: "Continuar com Google",
    });
    await expect(googleButton).toBeVisible();

    await googleButton.click();

    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "Seu espaço financeiro" }),
    ).toBeVisible();
    await expect(
      page.getByText("Espaço financeiro", { exact: true }).first(),
    ).toBeVisible();

    // The private layout reads this context from PostgreSQL. Query only
    // aggregate counts for the fixed fake identity; no token/cookie is logged.
    await expect
      .poll(readPersistedAuthCounts, { timeout: 15_000 })
      .toEqual({ users: 1, households: 1, memberships: 1 });

    const signOutButton = page.getByRole("button", { name: "Sair da conta" });
    await expect(signOutButton).toBeEnabled();
    // Revisit the server-owned route once before the mutation. This gives the
    // client island a fresh hydration boundary even when the dev server emits
    // HMR updates while the authenticated shell is loading. We intentionally
    // wait on the control itself, not global network-idle (HMR never idles).
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Seu espaço financeiro" }),
    ).toBeVisible();
    await expect(signOutButton).toBeEnabled();
    await signOutButton.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(googleButton).toBeVisible();

    // A fresh request must still be rejected server-side after the client
    // navigates away, not merely hidden by the public UI.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("button", { name: "Continuar com Google" }),
    ).toBeVisible();
  });
});
