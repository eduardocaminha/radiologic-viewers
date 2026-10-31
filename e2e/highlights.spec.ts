import { execFileSync } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser } from "@playwright/test";

const activeId = "77777777-7777-4777-8777-777777777771";
const removedId = "77777777-7777-4777-8777-777777777772";
const deletedId = "77777777-7777-4777-8777-777777777773";

function localEnv() {
  const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" })) as Record<string, unknown>;
  const url = status.API_URL;
  const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  if (typeof url !== "string" || typeof publishableKey !== "string" || typeof secretKey !== "string") throw new Error("Supabase local status is missing API credentials");
  return { url, publishableKey, secretKey };
}

function month(offset: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "numeric" }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const current = Number(parts.find((part) => part.type === "month")?.value);
  const index = year * 12 + current - 1 + offset;
  const resultYear = Math.floor(index / 12);
  const resultMonth = (index % 12) + 1;
  return `${resultYear}-${String(resultMonth).padStart(2, "0")}-01`;
}

async function signInAdmin(browser: Browser) {
  const { url, publishableKey } = localEnv();
  const auth = createClient(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email: "admin-e2e@example.test", password: "local-admin-password" });
  expect(error).toBeNull();
  expect(data.session).not.toBeNull();

  const cookies: Array<{ name: string; value: string }> = [];
  const serverClient = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookies,
      setAll: (nextCookies) => { cookies.splice(0, cookies.length, ...nextCookies.map(({ name, value }) => ({ name, value }))); },
    },
  });
  await serverClient.auth.setSession({ access_token: data.session!.access_token, refresh_token: data.session!.refresh_token });
  const context = await browser.newContext();
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: "http://localhost:4310" })));
  return context;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { url, secretKey } = localEnv();
  const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const previous = month(-1);
  const older = month(-2);
  await admin.from("monthly_highlights").delete().in("month", [previous, older, month(0)]);
  await admin.from("submissions").delete().in("id", [activeId, removedId, deletedId]);

  const { error: submissionsError } = await admin.from("submissions").insert([
    { id: activeId, slug: "viewer-em-destaque", status: "approved", source: "form", name: "Viewer em destaque", tagline: "Viewer publicado", platforms: ["web"], requires_install: false, demo_url: "https://example.test/active-demo", approved_at: `${previous}T12:00:00Z` },
    { id: removedId, slug: "viewer-removido", status: "removed", source: "form", name: "Viewer removido", tagline: "Viewer removido depois", platforms: ["web"], requires_install: false, demo_url: "https://example.test/removed-demo", approved_at: `${previous}T12:00:00Z` },
    { id: deletedId, slug: "viewer-excluido", status: "approved", source: "form", name: "Viewer excluído", tagline: "Registro histórico", platforms: ["web"], requires_install: false, demo_url: "https://example.test/deleted-demo", approved_at: `${previous}T12:00:00Z` },
  ]);
  if (submissionsError) throw submissionsError;

  const { error: highlightsError } = await admin.from("monthly_highlights").insert([
    { month: previous, rank: 1, submission_id: activeId, name: "Viewer em destaque", slug: "viewer-em-destaque", votes: 12 },
    { month: previous, rank: 2, submission_id: removedId, name: "Viewer removido", slug: "viewer-removido", votes: 8 },
    { month: previous, rank: 3, submission_id: null, name: "Viewer excluído", slug: "viewer-excluido", votes: 4 },
    { month: older, rank: 1, submission_id: activeId, name: "Viewer em destaque", slug: "viewer-em-destaque", votes: 3 },
    { month: month(0), rank: 1, submission_id: activeId, name: "Mês corrente", slug: "viewer-em-destaque", votes: 99 },
  ]);
  if (highlightsError) throw highlightsError;
});

test.afterAll(async () => {
  const { url, secretKey } = localEnv();
  const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await admin.from("monthly_highlights").delete().in("month", [month(-1), month(-2), month(0)]);
  await admin.from("submissions").delete().in("id", [activeId, removedId, deletedId]);
});

test("lista snapshots fechados, oculta o mês corrente e preserva registros sem link", async ({ page }) => {
  await page.goto("/pt/highlights");
  await expect(page.getByRole("heading", { name: "Destaques mensais", level: 1 })).toBeVisible();
  await expect(page.getByText("Viewer em destaque").first()).toBeVisible();
  await expect(page.getByText("Viewer removido")).toBeVisible();
  await expect(page.getByText("Viewer excluído")).toBeVisible();
  await expect(page.getByText("Mês corrente")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Viewer em destaque" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Viewer removido" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Viewer excluído" })).toHaveCount(0);
});

test("mostra o último snapshot na página inicial", async ({ page }) => {
  await page.goto("/pt");
  await expect(page.getByRole("heading", { name: /^Destaques de / })).toBeVisible();
  await expect(page.getByRole("link", { name: "Viewer em destaque" }).first()).toBeVisible();
});

test("recalcula o snapshot apenas com confirmação e registra o evento", async ({ browser }) => {
  const context = await signInAdmin(browser);
  const page = await context.newPage();
  const previous = month(-1).slice(0, 7);
  const { url, secretKey } = localEnv();
  const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: voteError } = await admin.from("votes").insert({ user_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", submission_id: activeId, created_at: `${previous}-15T12:00:00Z` });
  expect(voteError).toBeNull();
  await page.goto("/admin");
  await page.getByRole("heading", { name: "Recalcular destaques mensais" }).scrollIntoViewIfNeeded();
  await page.locator('input[name="month"]').fill(previous);
  await page.getByRole("checkbox", { name: "Confirmo que quero substituir o snapshot deste mês." }).check();
  await page.getByRole("button", { name: "Recalcular snapshot" }).click();
  await expect(page.getByRole("status")).toContainText(`Destaques de ${previous} recalculados.`);

  const { data: rows, error: rowsError } = await admin.from("monthly_highlights").select("rank").eq("month", `${previous}-01`);
  expect(rowsError).toBeNull();
  expect(rows).toHaveLength(1);
  const { data: events, error: eventsError } = await admin.from("submission_events").select("id").eq("kind", "snapshot_recomputed").eq("detail->>month", `${previous}-01`);
  expect(eventsError).toBeNull();
  expect(events).toHaveLength(1);
  await context.close();
});
