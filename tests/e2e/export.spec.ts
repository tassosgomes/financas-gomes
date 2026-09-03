import { inflateRawSync } from "node:zlib";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const E2E_EMAIL_PATTERN = /^e2e-[a-z0-9-]+@example\.test$/u;
const EXPORT_FILE_NAME = "financas-gomes-export-s11v1.zip";
const S11_EXPORT_ROW_COUNT_HEADER = "X-S11-Row-Count";
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const COMPRESSION_DEFLATE = 8;

const S11_ACCOUNTS_COLUMNS = [
  "id",
  "name",
  "type",
  "status",
  "spendability",
  "liquidity",
  "includeInNetWorth",
  "trackingStartedOn",
  "createdAt",
  "updatedAt",
] as const;

const FORBIDDEN_EXPORT_FIELDS = [
  "householdId",
  "userId",
  "tenantId",
  "email",
  "token",
  "password",
  "session",
] as const;

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

function uniqueEmail(label: string): string {
  const suffix = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  return `e2e-export-${label}-${suffix}@example.test`;
}

async function gotoExportData(page: Page): Promise<void> {
  await page.goto("/settings/data");
  await expect(page.getByTestId("export-data-route")).toBeVisible();
  await expect(page.getByTestId("export-data-screen")).toBeVisible();
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

function readZipEntry(zip: Buffer, entryName: string): Buffer {
  let offset = 0;

  while (offset + 30 <= zip.length) {
    if (zip.readUInt32LE(offset) !== LOCAL_FILE_HEADER_SIGNATURE) {
      break;
    }

    const compression = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = zip
      .subarray(nameStart, nameStart + nameLength)
      .toString("utf8");
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);

    if (name === entryName) {
      if (compression !== COMPRESSION_DEFLATE) {
        throw new Error(`Compressão não suportada para ${entryName}`);
      }
      return inflateRawSync(compressed);
    }

    offset = dataStart + compressedSize;
  }

  throw new Error(`Entrada ZIP não encontrada: ${entryName}`);
}

function listZipEntryNames(zip: Buffer): string[] {
  const endOffset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) {
    throw new Error("Registro final do ZIP não encontrado");
  }

  const centralDirectoryOffset = zip.readUInt32LE(endOffset + 16);
  const entryCount = zip.readUInt16LE(endOffset + 10);
  const names: string[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    const nameLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 46;
    names.push(zip.subarray(nameStart, nameStart + nameLength).toString("utf8"));
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return names;
}

function assertNoForbiddenFields(serialized: string): void {
  for (const field of FORBIDDEN_EXPORT_FIELDS) {
    expect(serialized).not.toContain(field);
  }
}

function inspectExportZip(zip: Buffer): {
  manifest: Record<string, unknown>;
  accountsCsv: string;
} {
  const entryNames = listZipEntryNames(zip);
  expect(entryNames).toContain("manifest.json");
  expect(entryNames).toContain("accounts.csv");

  const manifestRaw = readZipEntry(zip, "manifest.json").toString("utf8");
  assertNoForbiddenFields(manifestRaw);
  const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
  expect(manifest.contractVersion).toBe("s11.v1");

  const accountsCsv = readZipEntry(zip, "accounts.csv").toString("utf8");
  assertNoForbiddenFields(accountsCsv);
  const [headerLine] = accountsCsv.split("\n");
  expect(headerLine).toBe(S11_ACCOUNTS_COLUMNS.join(","));

  return { manifest, accountsCsv };
}

async function triggerExport(page: Page): Promise<void> {
  const downloadButton = page.getByTestId("export-download-button");
  await expect(downloadButton).toBeEnabled();
  await downloadButton.click();
}

test.describe("T15 — E2E de portabilidade S11", () => {
  test("fluxo feliz: exporta ZIP com contrato e sem campos proibidos", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const suffix = Date.now().toString(36);
    const accountName = `Conta export E2E ${suffix}`;

    await signIn(page, uniqueEmail("happy"));
    await createAccount(page, accountName);
    await gotoExportData(page);

    let capturedRowCount: string | null = null;
    page.on("response", (response) => {
      if (
        response.url().includes("/api/export") &&
        response.request().method() === "POST" &&
        response.ok()
      ) {
        capturedRowCount =
          response.headers()[S11_EXPORT_ROW_COUNT_HEADER.toLowerCase()] ?? null;
      }
    });

    const downloadPromise = page.waitForEvent("download");
    await triggerExport(page);
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(EXPORT_FILE_NAME);

    const tempDir = await mkdtemp(join(tmpdir(), "financas-export-e2e-"));
    const downloadPath = join(tempDir, EXPORT_FILE_NAME);
    try {
      await download.saveAs(downloadPath);
      const zip = await readFile(downloadPath);
      expect(zip.byteLength).toBeGreaterThan(0);

      const { accountsCsv } = inspectExportZip(zip);
      expect(accountsCsv).toContain(accountName);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    await expect(page.getByTestId("export-completed-state")).toBeVisible();
    await expect(page.getByTestId("export-completed-empty-state")).toHaveCount(0);
    await expect(page.getByTestId("export-error-state")).toHaveCount(0);

    await expect.poll(() => capturedRowCount).not.toBeNull();
    expect(Number.parseInt(capturedRowCount ?? "0", 10)).toBeGreaterThan(0);
  });

  test("espaço vazio: conclusão distinta de erro", async ({ page }) => {
    test.setTimeout(90_000);

    await signIn(page, uniqueEmail("empty"));
    await gotoExportData(page);

    const downloadPromise = page.waitForEvent("download");
    await triggerExport(page);
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(EXPORT_FILE_NAME);

    const tempDir = await mkdtemp(join(tmpdir(), "financas-export-e2e-"));
    const downloadPath = join(tempDir, EXPORT_FILE_NAME);
    try {
      await download.saveAs(downloadPath);
      const zip = await readFile(downloadPath);
      expect(zip.byteLength).toBeGreaterThan(0);
      const { manifest, accountsCsv } = inspectExportZip(zip);
      expect(manifest.rowCountTotal).toBe(0);
      expect(accountsCsv.trimEnd()).toBe(S11_ACCOUNTS_COLUMNS.join(","));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    await expect(page.getByTestId("export-completed-empty-state")).toBeVisible();
    await expect(page.getByTestId("export-completed-state")).toHaveCount(0);
    await expect(page.getByTestId("export-error-state")).toHaveCount(0);
  });

  test("erro simulado: mensagem opaca e retry utilizável", async ({ page }) => {
    test.setTimeout(90_000);

    await signIn(page, uniqueEmail("error"));
    await gotoExportData(page);

    await page.route("**/api/export", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }

      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: {
            code: "EXPORT_FAILED",
            message: "postgres://secret dsn leak",
            correlationId: "corr-e2e-export-error",
          },
        }),
      });
    });

    await triggerExport(page);

    const errorState = page.getByTestId("export-error-state");
    await expect(errorState).toBeVisible();
    await expect(errorState).toContainText("Não foi possível gerar sua cópia");
    await expect(page.locator("body")).not.toContainText("postgres");
    await expect(page.locator("body")).not.toContainText("dsn");
    await expect(page.getByTestId("export-error-correlation-id")).toContainText(
      "corr-e2e-export-error",
    );

    await page.getByTestId("export-error-retry").click();
    await expect(page.getByTestId("export-error-state")).toHaveCount(0);
    await expect(page.getByTestId("export-download-button")).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Baixar uma cópia", exact: true }),
    ).toBeVisible();
  });

  test("disparo duplicado durante geração não inicia segunda exportação", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await signIn(page, uniqueEmail("duplicate"));
    await gotoExportData(page);

    let requestCount = 0;
    let releaseExport: (() => void) | undefined;
    const exportGate = new Promise<void>((resolve) => {
      releaseExport = resolve;
    });

    page.on("request", (request) => {
      if (
        request.url().includes("/api/export") &&
        request.method() === "POST"
      ) {
        requestCount += 1;
      }
    });

    await page.route("**/api/export", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }

      await exportGate;
      await route.continue();
    });

    const downloadButton = page.getByTestId("export-download-button");
    const exportRequestPromise = page.waitForRequest(
      (request) =>
        request.url().includes("/api/export") && request.method() === "POST",
    );
    const downloadPromise = page.waitForEvent("download");

    await downloadButton.dblclick();

    await expect(page.getByTestId("export-generating-state")).toBeVisible();
    await expect(downloadButton).toBeDisabled();
    await exportRequestPromise;
    await expect.poll(() => requestCount).toBe(1);

    releaseExport?.();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(EXPORT_FILE_NAME);
    await expect(page.getByTestId("export-completed-empty-state")).toBeVisible();
    expect(requestCount).toBe(1);
  });

  test("viewport móvel 360px mantém a tela operável", async ({ page }) => {
    test.setTimeout(90_000);

    await page.setViewportSize({ width: 360, height: 800 });
    await signIn(page, uniqueEmail("mobile"));
    await gotoExportData(page);

    await expect(page.getByTestId("export-data-screen")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Seus dados" })).toBeVisible();

    const downloadButton = page.getByTestId("export-download-button");
    await expect(downloadButton).toBeVisible();
    await expect(downloadButton).toBeEnabled();

    const downloadPromise = page.waitForEvent("download");
    await downloadButton.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(EXPORT_FILE_NAME);
    await expect(page.getByTestId("export-completed-empty-state")).toBeVisible();
  });
});
