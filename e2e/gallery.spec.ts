import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const viewerId = "55555555-5555-4555-8555-555555555555";
const screenshotId = "66666666-6666-4666-8666-666666666666";
const screenshotPath = `eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee/${viewerId}/${screenshotId}.png`;
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function localEnv() {
  const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" })) as Record<string, unknown>;
  const url = status.API_URL;
  const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  if (typeof url !== "string" || typeof secretKey !== "string") throw new Error("Supabase local status is missing service credentials");
  return { url, secretKey };
}

test.beforeAll(async () => {
  const { url, secretKey } = localEnv();
  const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await admin.from("submissions").delete().eq("id", viewerId);
  const uploaded = await admin.storage.from("screenshots").upload(screenshotPath, image, { contentType: "image/png", upsert: true });
  if (uploaded.error) throw uploaded.error;
  const { error } = await admin.from("submissions").insert({
    id: viewerId,
    slug: "galeria-viewer",
    status: "approved",
    source: "form",
    name: "Galeria Viewer",
    tagline: "Uma ficha para testar a galeria",
    description: "Descrição completa do viewer para o teste público.",
    differential: "Um diferencial claro.",
    lang: "pt",
    platforms: ["web"],
    requires_install: false,
    repo_url: "https://example.test/galeria-repo",
    license: "MIT",
    base_tech: "scratch",
    data_source: "Dados sintéticos",
    data_license: "CC0",
    external_api: false,
    demo_url: "https://example.test/galeria-demo",
    video_url: "https://example.test/galeria-video",
    approved_at: new Date().toISOString(),
  });
  if (error) throw error;
  const screenshot = await admin.from("screenshots").insert({ id: screenshotId, submission_id: viewerId, path: screenshotPath, status: "approved", position: 1 });
  if (screenshot.error) throw screenshot.error;
});

test.afterAll(async () => {
  const { url, secretKey } = localEnv();
  const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await admin.from("submissions").delete().eq("id", viewerId);
  await admin.storage.from("screenshots").remove([screenshotPath]);
});

test("gallery mostra o estado publicado em 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/pt");
  await expect(page.getByRole("heading", { name: "Galeria de workstations" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Galeria Viewer" })).toBeVisible();
  await expect(page.getByText("Uma ficha para testar a galeria")).toBeVisible();
  await page.getByRole("link", { name: "Galeria Viewer" }).click();
  await expect(page).toHaveURL(/\/pt\/v\/galeria-viewer$/);
  await expect(page.getByRole("heading", { name: "Galeria Viewer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Uso não clínico" })).toBeVisible();
});

test("gallery guarda a ordenação na URL", async ({ page }) => {
  await page.goto("/pt?sort=recent");
  await expect(page.getByRole("button", { name: "Recentes" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Mais votados" }).click();
  await expect(page).toHaveURL(/\/pt\?sort=total$/);
  await page.getByRole("button", { name: "No mês" }).click();
  await expect(page).toHaveURL(/\/pt$/);
});

test("ficha compartilha o link com a mensagem pedindo voto", async ({ page }) => {
  await page.goto("/pt/v/galeria-viewer");
  await page.getByRole("button", { name: "Compartilhar" }).click();
  const whatsapp = await page.getByRole("link", { name: "WhatsApp" }).getAttribute("href");
  expect(decodeURIComponent(whatsapp ?? "")).toContain("Vote em Galeria Viewer no Radiologic Workstation: https://challenge.radiologic.io/pt/v/galeria-viewer");
  await page.getByRole("button", { name: "Copiar link" }).click();
  await expect(page.getByRole("button", { name: "Link copiado" })).toBeVisible();
});

test("ficha oferece a folha nativa quando o aparelho tem compartilhamento", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      value: (data: ShareData) => {
        (window as unknown as { shared: ShareData }).shared = data;
        return Promise.resolve();
      },
    });
  });
  await page.goto("/pt/v/galeria-viewer");
  await page.getByRole("button", { name: "Compartilhar" }).click();
  await page.getByRole("button", { name: "Mais opções" }).click();
  const shared = await page.evaluate(() => (window as unknown as { shared: ShareData }).shared);
  expect(shared.url).toContain("/pt/v/galeria-viewer");
  expect(shared.title).toBe("Galeria Viewer");
});

test("gallery mantém a ficha legível em 1280 px", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/en/v/galeria-viewer");
  await expect(page.getByRole("heading", { name: "Galeria Viewer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Non-clinical use" })).toBeVisible();
});
