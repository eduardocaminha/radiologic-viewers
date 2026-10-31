import { execFileSync } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser } from "@playwright/test";

const approvedId = "11111111-1111-4111-8111-111111111111";
const approvedScreenshotId = "22222222-2222-4222-8222-222222222221";
const rejectedId = "33333333-3333-4333-8333-333333333333";
const rejectedScreenshotId = "44444444-4444-4444-8444-444444444441";
const adminId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function localEnv() {
  const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" })) as Record<string, unknown>;
  const url = status.API_URL;
  const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  if (typeof url !== "string" || typeof publishableKey !== "string" || typeof secretKey !== "string") throw new Error("Supabase local status is missing API credentials");
  return { url, publishableKey, secretKey };
}

async function signInContext(browser: Browser, email: string, password: string) {
  const { url, publishableKey } = localEnv();
  const auth = createClient(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  expect(data.session).not.toBeNull();

  const cookies: Array<{ name: string; value: string }> = [];
  const serverClient = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookies,
      setAll: (nextCookies) => {
        cookies.splice(0, cookies.length, ...nextCookies.map(({ name, value }) => ({ name, value })));
      },
    },
  });
  await serverClient.auth.setSession({ access_token: data.session!.access_token, refresh_token: data.session!.refresh_token });
  const context = await browser.newContext();
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: "http://localhost:4310" })));
  return context;
}

test.beforeAll(async () => {
  const { url, secretKey } = localEnv();
  const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  for (const id of [approvedId, rejectedId]) await admin.from("submissions").delete().eq("id", id);

  const submissions = [
    { id: approvedId, slug: "viewer-da-fila", status: "pending", source: "github", github_issue_number: 42, owner_id: adminId, name: "Viewer da fila", tagline: "Uma fila para revisar", description: "Descrição completa do viewer.", differential: "Revisão interna.", lang: "pt", platforms: ["web"], requires_install: false, repo_url: "https://example.test/repo", license: "MIT", base_tech: "scratch", data_source: "Dados sintéticos", data_license: "CC0", external_api: false, demo_url: "https://example.test/demo", workflow_parts: ["viewer"], rules_version: "1", rules_accepted_at: new Date().toISOString() },
    { id: rejectedId, slug: "viewer-para-rejeitar", status: "pending", source: "form", owner_id: adminId, name: "Viewer para rejeitar", tagline: "Outro viewer", description: "Descrição para rejeição.", differential: "Motivo para teste.", lang: "pt", platforms: ["web"], requires_install: false, repo_url: "https://example.test/repo-2", license: "MIT", base_tech: "scratch", data_source: "Dados sintéticos", data_license: "CC0", external_api: false, demo_url: "https://example.test/demo-2", rules_version: "1", rules_accepted_at: new Date().toISOString() },
  ];
  const { error: submissionError } = await admin.from("submissions").insert(submissions);
  if (submissionError) throw submissionError;

  for (const [submissionId, screenshotId] of [[approvedId, approvedScreenshotId], [rejectedId, rejectedScreenshotId]]) {
    const path = `${adminId}/${submissionId}/${screenshotId}.png`;
    const uploaded = await admin.storage.from("screenshots").upload(path, image, { contentType: "image/png", upsert: true });
    if (uploaded.error) throw uploaded.error;
    const { error } = await admin.from("screenshots").insert({ id: screenshotId, submission_id: submissionId, path, status: "pending", position: 1 });
    if (error) throw error;
  }
});

test("restringe a fila a admins e permite moderar a ficha e cada imagem", async ({ browser }) => {
  const visitor = await signInContext(browser, "e2e@example.test", "local-password");
  const visitorPage = await visitor.newPage();
  const denied = await visitorPage.goto("/admin");
  expect(denied?.status()).toBe(404);
  await visitor.close();

  const admin = await signInContext(browser, "admin-e2e@example.test", "local-admin-password");
  const page = await admin.newPage();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Fila de moderação" })).toBeVisible();
  await expect(page.locator("h2").filter({ hasText: /^Viewer da fila$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "https://github.com/eduardocaminha/radiologic-challenge-submissions/issues/42" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Captura 1" }).first()).toBeVisible();

  const pending = page.getByRole("region", { name: "Pendências" }).getByRole("article").filter({ has: page.getByRole("heading", { name: "Viewer da fila" }) });
  await pending.getByRole("button", { name: "Aprovar imagem", exact: true }).click();
  await expect(pending.getByText("Imagem 1, aprovada")).toBeVisible();
  await pending.getByRole("button", { name: "Aprovar", exact: true }).click();
  const approved = page.getByRole("region", { name: "Publicados e removidos" }).getByRole("article").filter({ has: page.getByRole("heading", { name: "Viewer da fila" }) });
  await expect(approved.getByText("Viewer publicado")).toBeVisible();
  await approved.getByRole("button", { name: "Remover da galeria" }).click();
  await expect(approved.getByText("Viewer removido")).toBeVisible();
  await approved.getByRole("button", { name: "Restaurar na galeria" }).click();
  await expect(approved.getByText("Viewer publicado")).toBeVisible();

  await approved.getByRole("button", { name: "Marcar como projeto do organizador" }).click();
  await expect(approved.getByRole("button", { name: "Tirar marca do organizador" })).toBeVisible();
  await page.goto("/pt/v/viewer-da-fila");
  await expect(page.getByText(/projeto do organizador/i).first()).toBeVisible();
  await page.goto("/admin");
  await approved.getByRole("button", { name: "Tirar marca do organizador" }).click();
  await expect(approved.getByRole("button", { name: "Marcar como projeto do organizador" })).toBeVisible();

  await approved.getByRole("button", { name: "Retirar imagem" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Retirar", exact: true }).click();
  await expect(approved.getByText("Imagem 1, rejeitada")).toBeVisible();
  await expect(approved.getByText("Imagem indisponível")).toBeVisible();
  await expect(approved.getByText("Viewer publicado")).toBeVisible();
  const { url, secretKey } = localEnv();
  const storage = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } }).storage.from("screenshots");
  const removed = await storage.download(`${adminId}/${approvedId}/${approvedScreenshotId}.png`);
  expect(removed.error).not.toBeNull();

  const rejected = page.getByRole("region", { name: "Pendências" }).getByRole("article").filter({ has: page.getByRole("heading", { name: "Viewer para rejeitar" }) });
  await rejected.getByLabel("Motivo da rejeição").fill("A ficha precisa de uma demonstração mais clara.");
  await rejected.getByRole("button", { name: "Rejeitar", exact: true }).click();
  await expect(rejected).toHaveCount(0);
  const pendingImages = page.getByRole("region", { name: "Imagens pendentes" });
  const rejectedPending = pendingImages.getByRole("article").filter({ has: page.getByRole("heading", { name: "Viewer para rejeitar" }) });
  await expect(rejectedPending).toContainText("Descrição para rejeição.");
  await expect(rejectedPending.getByRole("link", { name: "https://example.test/demo-2" })).toBeVisible();
  await expect(rejectedPending).toContainText("MIT");
  await rejectedPending.getByText(/Histórico de eventos/).click();
  await expect(rejectedPending).toContainText("state_transition");
  await expect(rejectedPending.getByRole("button", { name: "Rejeitar imagem", exact: true })).toBeVisible();
  await admin.close();
});
