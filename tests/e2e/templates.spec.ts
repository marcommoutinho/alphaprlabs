// V7 A10 / D7 Templates, against the real local Supabase: an admin creates a
// template with two peptides and a break (Save template waits until it is
// valid), edits it ("updated for future copies"), and keeps saving it after
// one of its peptides stops being offered (Marco, 2026-09-26); once removed,
// that peptide can't be added back. Phone and laptop, light and dark; a
// researcher reaches none of it. Templates and the library are shared by
// every run, so rows are found by their unique names. Exact rules and the
// SQL checks: tests/integration/templates.test.ts and admin-content.test.ts.
import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { APP_ORIGIN } from "../../playwright.config";
import { ensureAccount, hydrated, ok, serviceClient, signInAs, uniqueEmail } from "../support/local-supabase";

const ADMIN = { email: uniqueEmail("v7-tpl-admin"), name: "Templates Admin" };
const RESEARCHER = { email: uniqueEmail("v7-tpl-researcher"), name: "Templates Researcher" };
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 820 };
// Screenshots only when asked for (V7_SHOTS=<directory>).
const SHOTS = process.env.V7_SHOTS;

test.beforeAll(async () => {
  await ensureAccount({ ...ADMIN, role: "admin" });
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v7-${name}.png`, style: ".app-tabbar { position: static !important; }" });
};
const unique = (label: string) => `${label} ${randomBytes(3).toString("hex")}`;
const card = (page: Page, name: string) => page.getByTestId("template-card").filter({ hasText: name });
const peptideCard = (page: Page, name: string) => page.getByTestId("template-peptide").filter({ has: page.getByText(name, { exact: true }) });
const toast = (page: Page) => page.locator('[data-slot="toast"]');

async function seedPeptide(name: string) {
  const [row] = await ok(serviceClient().from("peptides").insert({ name, information: `[Supplied information for ${name}]`, available: true }).select("id"), name);
  return row.id as string;
}

async function storedTemplate(name: string) {
  const [row] = await ok(
    serviceClient()
      .from("cycle_templates")
      .select("id, version, guidance, cycle_template_plans(position, peptide_id, cycle_template_phases(kind, offset_days, length_days, dose_mg::text, schedule_type, every_days, weekdays))")
      .eq("name", name),
    name,
  );
  return row;
}

async function openTemplates(page: Page) {
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/admin/library/templates`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Library");
  await expect(page.getByRole("navigation", { name: "Library" }).locator('[aria-current="page"]')).toHaveText(/^Templates · \d+$/);
}

async function addPeptide(page: Page, name: string) {
  await page.getByTestId("add-peptide").click();
  await page.getByTestId("peptide-picker").getByRole("button", { name, exact: true }).click();
  await expect(page.getByTestId("peptide-picker")).toHaveCount(0);
}

test("laptop: create and edit a template, then keep saving it with a peptide no longer offered", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(LAPTOP);
  const [A, W] = [unique("V7 Tpl A"), unique("V7 Tpl W")];
  await seedPeptide(A);
  const w = await seedPeptide(W);
  const name = unique("V7 Recovery template");
  await openTemplates(page);

  await page.getByTestId("library-add-laptop").click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/library/templates/new`);
  await expect(page.getByTestId("template-meta")).toHaveText("New · researchers see it once it's saved");
  await expect(page.getByTestId("template-footer-note")).toHaveText("Researchers will see it as a starting point once it's saved.");
  await (await hydrated(page.getByTestId("template-name"))).fill(name);
  await addPeptide(page, A);
  await addPeptide(page, W);
  await expect(page.getByTestId("template-timeline")).toBeVisible();

  // The new 28-day phases have no dose yet: the editor says why and Save template waits.
  await expect(page.getByTestId("builder-issues")).toBeVisible();
  await expect(page.getByTestId("save-template")).toBeDisabled();
  const a = peptideCard(page, A);
  await a.getByTestId("phase-dose").fill("250");
  await a.getByTestId("add-break").click();
  await expect(a.getByTestId("phase-row")).toHaveCount(2);
  await expect(a.getByTestId("phase-row").nth(1)).toHaveAttribute("data-kind", "break");
  const wCard = peptideCard(page, W);
  await wCard.getByTestId("phase-dose").fill("1");
  await wCard.getByTestId("phase-unit").selectOption("mg");
  await wCard.getByTestId("phase-schedule").selectOption("weekdays");
  // Mon, Wed and Fri are on by default.
  await expect(wCard.getByRole("button", { name: "Mon" })).toHaveAttribute("aria-pressed", "true");
  await wCard.getByRole("button", { name: "Tue" }).click();
  await wCard.getByRole("button", { name: "Thu" }).click();
  await expect(page.getByTestId("builder-issues")).toHaveCount(0);
  await expect(page.getByTestId("save-template")).toBeEnabled();
  await page.getByTestId("save-template").click();
  await expect(toast(page)).toContainText("Template created.");
  await expect(page).toHaveURL(/\/admin\/library\/templates\/[0-9a-f-]{36}$/);

  const created = await storedTemplate(name);
  expect(created.version).toBe(1);
  const plans = [...created.cycle_template_plans].sort((x, y) => x.position - y.position);
  expect(plans.map((plan) => plan.cycle_template_phases.map((phase) => [phase.kind, phase.offset_days, phase.length_days, phase.dose_mg === null ? null : Number(phase.dose_mg)]))).toEqual([
    [
      ["active", 0, 28, 0.25],
      ["break", 28, 14, null],
    ],
    [["active", 0, 28, 1]],
  ]);
  expect(plans[0].cycle_template_phases[0]).toMatchObject({ schedule_type: "interval", every_days: 1 });
  expect(plans[1].cycle_template_phases[0]).toMatchObject({ schedule_type: "weekdays" });
  expect([...(plans[1].cycle_template_phases[0].weekdays ?? [])].sort()).toEqual([1, 2, 3, 4, 5]);

  // An edit: "updated for future copies", one version per save.
  await (await hydrated(page.getByTestId("template-guidance"))).fill("Take in the morning.");
  await page.getByTestId("save-template").click();
  await expect(toast(page)).toContainText("Template updated for future copies. Existing cycles unchanged.");
  await expect.poll(async () => (await storedTemplate(name)).version).toBe(2);
  expect((await storedTemplate(name)).guidance).toBe("Take in the morning.");

  // W stops being offered: the list and the editor say so, and the template still saves with it.
  await ok(serviceClient().from("peptides").update({ available: false }).eq("id", w), "withdraw W");
  await page.goto(`${APP_ORIGIN}/admin/library/templates`);
  await expect(card(page, name)).toHaveAttribute("data-withdrawn", "");
  await expect(card(page, name).getByTestId("template-withdrawn")).toHaveText(`Includes ${W}, no longer offered`);
  await card(page, name).click();
  await expect(page.getByTestId("template-withdrawn-notice")).toHaveText(
    `${W} is no longer offered. The template keeps it and researchers who start from it still get it; once removed, it can't be added back.`,
  );
  await (await hydrated(page.getByTestId("template-guidance"))).fill("Take in the morning, with water.");
  await page.getByTestId("save-template").click();
  await expect(toast(page)).toContainText("Template updated for future copies. Existing cycles unchanged.");
  await expect.poll(async () => (await storedTemplate(name)).version).toBe(3);
  expect((await storedTemplate(name)).cycle_template_plans).toHaveLength(2);

  // Removed, W can't be added back: the picker offers only peptides still offered.
  await peptideCard(page, W).getByTestId("remove-peptide").click();
  await expect(page.getByTestId("template-withdrawn-notice")).toHaveCount(0);
  await page.getByTestId("add-peptide").click();
  const picker = page.getByTestId("peptide-picker");
  await expect(picker.getByRole("button", { name: A, exact: true })).toHaveCount(0);
  await expect(picker.getByRole("button", { name: W, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await page.getByTestId("save-template").click();
  await expect(toast(page)).toContainText("Template updated for future copies. Existing cycles unchanged.");
  await expect.poll(async () => (await storedTemplate(name)).cycle_template_plans.length).toBe(1);
  await page.goto(`${APP_ORIGIN}/admin/library/templates`);
  await expect(card(page, name)).not.toHaveAttribute("data-withdrawn", "");
});

for (const scheme of ["light", "dark"] as const) {
  test(`templates on a phone and a laptop (${scheme})`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(PHONE);
    const A = unique("V7 Tpl Phone");
    await seedPeptide(A);
    const name = unique(`V7 Phone template ${scheme}`);
    await openTemplates(page);
    await expect(page.getByTestId("templates")).toBeVisible();
    await shot(page, `templates-list-phone-${scheme}`);

    // The phone's round + opens the full-screen editor.
    await page.getByTestId("library-add").click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/admin/library/templates/new`);
    await (await hydrated(page.getByTestId("template-name"))).fill(name);
    await page.getByTestId("add-peptide-phone").click();
    await page.getByTestId("peptide-picker").getByRole("button", { name: A, exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await peptideCard(page, A).getByTestId("phase-dose").fill("500");
    await peptideCard(page, A).getByTestId("phase-unit").selectOption("mcg");
    await shot(page, `templates-editor-phone-${scheme}`);
    await page.getByTestId("save-template").click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/admin/library/templates`);
    await expect(toast(page)).toContainText("Template created.");
    await expect(card(page, name)).toContainText("28 days");

    await page.setViewportSize(LAPTOP);
    await page.reload();
    await expect(card(page, name)).toBeVisible();
    await shot(page, `templates-list-laptop-${scheme}`);
    await card(page, name).click();
    await expect(page.getByTestId("template-editor")).toBeVisible();
    await expect(page.getByTestId("template-footer-note")).toHaveText("Saving changes future copies only. No cycle has been started from this template yet.");
    await shot(page, `templates-editor-laptop-${scheme}`);
  });
}

test("a researcher reaches none of the templates admin", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  const [any] = await ok(serviceClient().from("cycle_templates").select("id").limit(1), "a template");
  for (const path of ["/admin/templates", "/admin/library/templates", "/admin/library/templates/new", ...(any ? [`/admin/library/templates/${any.id}`] : [])]) {
    await page.goto(`${APP_ORIGIN}${path}`);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  }
});
