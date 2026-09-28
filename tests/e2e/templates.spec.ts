// S8 A3 Cycle templates: the admin creates a template with two peptides and a
// break, hitting the designed validation messages in order with "(+N more)",
// saves, edits ("updated" moves only on a real change), and keeps editing it
// after one of its peptides is no longer offered (Marco, 2026-09-26), which
// then can't be added back; the phone layout; a researcher is sent away. Against the real local Supabase; templates and the library are shared
// by every run, so rows are found by their unique names.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { APP_ORIGIN } from "../../playwright.config";
import { formatMonthDay } from "../../src/lib/format";
import { ensureAccount, hydrated, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";

const ADMIN = { email: uniqueEmail("s8-templates-admin"), name: "Templates Admin" };
const RESEARCHER = { email: uniqueEmail("s8-templates-researcher"), name: "Templates Researcher" };

test.beforeAll(async () => {
  await ensureAccount({ ...ADMIN, role: "admin" });
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
});

const IDLE = "Select a template to inspect or update it.";
const row = (page: Page, name: string) => page.getByTestId("template-row").filter({ hasText: name });
const editor = (page: Page) => page.locator("section.app-lib-editor");
// The inline form error (Next.js adds its own empty route-announcer alert).
const alert = (page: Page) => page.locator('.app-inline-error[role="alert"]');
const plan = (page: Page, peptide: string) => editor(page).getByTestId("template-plan").filter({ hasText: peptide });
const phase = (block: Locator, index: number) => block.getByTestId("template-phase").nth(index);
const save = (page: Page) => page.getByRole("button", { name: "Save template" }).click();

async function seedPeptide(name: string, available = true) {
  const { data, error } = await serviceClient()
    .from("peptides")
    .insert({ name, information: `[Supplied information for ${name}]`, available })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not seed ${name}: ${error?.message ?? "no row"}`);
  return data.id;
}

async function storedTemplate(name: string) {
  const { data, error } = await serviceClient()
    .from("cycle_templates")
    .select("id, updated_at, cycle_template_plans(position, peptide_id, cycle_template_phases(kind, offset_days, length_days, dose_mg::text, schedule_type, every_days, weekdays))")
    .eq("name", name)
    .single();
  if (error || !data) throw new Error(`No template ${name}: ${error?.message ?? "no row"}`);
  return data;
}

async function openTemplates(page: Page) {
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/admin/templates`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cycle templates");
}

test("an admin creates and edits a template, which keeps a peptide withdrawn since, as designed", async ({ page }) => {
  const t = randomBytes(3).toString("hex");
  const [A, B, C] = [`Compound A ${t}`, `Compound B ${t}`, `Compound C ${t}`];
  const aId = await seedPeptide(A);
  const bId = await seedPeptide(B);
  await seedPeptide(C, false);
  const name = `Recomp starter ${t}`;

  await page.setViewportSize({ width: 1280, height: 900 });
  await openTemplates(page);
  await expect(
    page.getByText("Starting points researchers copy. Editing a template changes future copies only — existing researcher cycles are untouched."),
  ).toBeVisible();
  await expect(page.getByText(IDLE)).toBeVisible();
  // Templates is a section of Library in the shell (design v3; V7 merges the pages).
  await expect(page.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]')).toHaveText("Library");
  await expect(page.getByRole("navigation", { name: "Library" }).locator('[aria-current="page"]')).toHaveText("Templates");

  // New: the designed first-failure messages.
  await (await hydrated(page.getByRole("button", { name: "New template" }))).click();
  await expect(editor(page).getByRole("heading", { level: 2 })).toHaveText("New template");
  await expect(editor(page).getByText("Days count from the researcher's start date (day 1). They can adjust everything after copying.")).toBeVisible();
  await expect(editor(page).getByText("Researchers will see this as a starting point.")).toBeVisible();
  await save(page);
  await expect(alert(page)).toHaveText("Name is required.");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await save(page);
  await expect(alert(page)).toHaveText("Add at least one peptide — an empty template can't be saved.");

  // Only available peptides can be added, each once.
  const picker = page.getByLabel("Peptide to add");
  await expect(picker.locator("option", { hasText: C })).toHaveCount(0);
  await picker.selectOption({ label: A });
  await page.getByRole("button", { name: "+ Add peptide" }).click();
  await picker.selectOption({ label: B });
  await page.getByRole("button", { name: "+ Add peptide" }).click();
  await expect(picker.locator("option", { hasText: A })).toHaveCount(0);

  const a = plan(page, A);
  const b = plan(page, B);
  await expect(phase(a, 0).locator(".app-tpl-phase-title")).toHaveText("Active phase · day 1–28");
  await expect(phase(a, 0).getByLabel("Local time")).toHaveValue("08:00");
  await expect(phase(a, 0).getByLabel("Every (days)")).toHaveValue("5");

  // Every message, in order, the first shown with "(+N more)".
  await phase(a, 0).getByLabel("Starts on day").fill("0");
  await phase(a, 0).getByLabel("Length (days)").fill("");
  await phase(a, 0).getByLabel("Every (days)").fill("0");
  await save(page);
  await expect(alert(page)).toHaveText(`${A}, phase 1: start day must be 1 or later. (+4 more)`);
  await phase(a, 0).getByLabel("Starts on day").fill("1");
  await save(page);
  await expect(alert(page)).toHaveText(`${A}, phase 1: length must be at least 1 day. (+3 more)`);
  await phase(a, 0).getByLabel("Length (days)").fill("28");
  await save(page);
  await expect(alert(page)).toHaveText(`${A}, phase 1: enter a dose above 0 mg. (+2 more)`);
  await phase(a, 0).getByLabel("Dose (mg)").fill("0,4");
  await save(page);
  await expect(alert(page)).toHaveText(`${A}, phase 1: interval must be at least 1 day. (+1 more)`);
  await phase(a, 0).getByLabel("Every (days)").fill("5");
  await save(page);
  await expect(alert(page)).toHaveText(`${B}, phase 1: enter a dose above 0 mg.`);

  // A break, then another active phase, each the day after the last one ends.
  await a.getByRole("button", { name: "+ Break" }).click();
  await a.getByRole("button", { name: "+ Phase" }).click();
  await expect(phase(a, 1).locator(".app-tpl-phase-title")).toHaveText("Break · day 29–35");
  await expect(phase(a, 1).getByLabel("Dose (mg)")).toHaveCount(0);
  await expect(phase(a, 2).locator(".app-tpl-phase-title")).toHaveText("Active phase · day 36–63");
  await phase(a, 2).getByLabel("Dose (mg)").fill("0.6");
  await phase(a, 1).getByLabel("Starts on day").fill("20");
  await expect(phase(a, 1).locator(".app-tpl-phase-title")).toHaveText("Break · day 20–26");
  await b.getByTestId("template-phase").getByRole("button", { name: "Remove" }).click();
  await save(page);
  await expect(alert(page)).toHaveText(`${A}: phases overlap at day 20. (+1 more)`);
  await phase(a, 1).getByLabel("Starts on day").fill("29");
  await save(page);
  await expect(alert(page)).toHaveText(`${B}: add at least one active phase.`);

  // Fixed weekdays: Mon, Wed, Fri preselected; none selected is refused.
  await b.getByRole("button", { name: "+ Phase" }).click();
  await phase(b, 0).getByLabel("Dose (mg)").fill("0.3");
  await phase(b, 0).getByLabel("Schedule").selectOption({ label: "Fixed weekdays" });
  await expect(phase(b, 0).getByLabel("Every (days)")).toHaveCount(0);
  const days = phase(b, 0).getByRole("group", { name: "Weekdays" });
  await expect(days.getByRole("button")).toHaveText(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  for (const day of ["Mon", "Wed", "Fri"]) {
    await expect(days.getByRole("button", { name: day })).toHaveAttribute("aria-pressed", "true");
    await days.getByRole("button", { name: day }).click();
  }
  await save(page);
  await expect(alert(page)).toHaveText(`${B}, phase 1: pick at least one weekday.`);
  await days.getByRole("button", { name: "Tue" }).click();
  await days.getByRole("button", { name: "Thu" }).click();
  await phase(b, 0).getByLabel("Local time").fill("07:30");

  await save(page);
  await expect(page.locator(".app-toast")).toHaveText("Template created.");
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByText(IDLE)).toBeVisible();

  const created = await storedTemplate(name);
  const plans = [...created.cycle_template_plans].sort((x, y) => x.position - y.position);
  expect(plans.map((p) => p.peptide_id)).toEqual([aId, bId]);
  expect([...plans[0].cycle_template_phases].sort((x, y) => x.offset_days - y.offset_days)).toEqual([
    { kind: "active", offset_days: 0, length_days: 28, dose_mg: "0.4", schedule_type: "interval", every_days: 5, weekdays: null },
    { kind: "break", offset_days: 28, length_days: 7, dose_mg: null, schedule_type: null, every_days: null, weekdays: null },
    { kind: "active", offset_days: 35, length_days: 28, dose_mg: "0.6", schedule_type: "interval", every_days: 5, weekdays: null },
  ]);
  expect(plans[1].cycle_template_phases).toEqual([
    { kind: "active", offset_days: 0, length_days: 28, dose_mg: "0.3", schedule_type: "weekdays", every_days: null, weekdays: [2, 4] },
  ]);
  const updated = formatMonthDay(created.updated_at, { timeZone: "America/Toronto" });
  await expect(row(page, name)).toContainText(`63 days · updated ${updated}`);
  await expect(row(page, name)).toContainText(`${A} · 2 phase(s) + ${B} · 1 phase(s)`);
  await expect(row(page, name)).toContainText("0 researcher cycle(s) were started from it — they won't change.");
  await expect(row(page, name).locator(".app-tpl-row-warn")).toHaveCount(0);

  // Edit: saving unchanged content keeps "updated"; a real change moves it.
  await row(page, name).click();
  await expect(row(page, name)).toHaveAttribute("aria-current", "true");
  await expect(editor(page).getByRole("heading", { level: 2 })).toHaveText(`Edit ${name}`);
  await expect(editor(page).getByText("Saving updates future copies only. Cycles already created from this template are not changed.")).toBeVisible();
  await expect(phase(a, 1).locator(".app-tpl-phase-title")).toHaveText("Break · day 29–35");
  await expect(phase(b, 0).getByRole("button", { name: "Tue" })).toHaveAttribute("aria-pressed", "true");
  await expect(phase(b, 0).getByRole("button", { name: "Mon" })).toHaveAttribute("aria-pressed", "false");
  await save(page);
  await expect(page.locator(".app-toast")).toHaveText("Template updated for future copies. Existing cycles unchanged.");
  expect((await storedTemplate(name)).updated_at).toBe(created.updated_at);
  await row(page, name).click();
  await phase(a, 0).getByLabel("Dose (mg)").fill("0.5");
  await save(page);
  await expect(page.locator(".app-toast")).toHaveText("Template updated for future copies. Existing cycles unchanged.");
  await expect(editor(page)).toHaveCount(0);
  const edited = await storedTemplate(name);
  expect(new Date(edited.updated_at).getTime()).toBeGreaterThan(new Date(created.updated_at).getTime());

  // A peptide withdrawn later: the template keeps it, with a warning, and can
  // still be edited and saved with it (Marco, 2026-09-26); it just can't be
  // added again once removed.
  const { error } = await serviceClient().from("peptides").update({ available: false }).eq("id", aId);
  expect(error).toBeNull();
  await page.reload();
  await expect(row(page, name).locator(".app-tpl-row-warn")).toHaveText(
    "Includes a peptide that is no longer offered — researchers who start from it still get it. It can't be added to other templates.",
  );
  await (await hydrated(row(page, name))).click();
  await expect(plan(page, A)).toHaveCount(1);
  await expect(picker.locator("option", { hasText: A })).toHaveCount(0);
  await phase(a, 0).getByLabel("Dose (mg)").fill("0.6");
  await save(page);
  await expect(page.locator(".app-toast")).toHaveText("Template updated for future copies. Existing cycles unchanged.");
  expect((await storedTemplate(name)).cycle_template_plans.map((p) => p.peptide_id)).toContain(aId);
  await expect(row(page, name).locator(".app-tpl-row-warn")).toHaveCount(1);
  await row(page, name).click();
  await plan(page, A).getByRole("button", { name: "Remove peptide" }).click();
  await save(page);
  await expect(page.locator(".app-toast")).toHaveText("Template updated for future copies. Existing cycles unchanged.");
  await expect(row(page, name)).toContainText(`28 days · updated`);
  await expect(row(page, name)).toContainText(`${B} · 1 phase(s)`);
  await expect(row(page, name).locator(".app-tpl-row-warn")).toHaveCount(0);

  // A2 counts the template among B's references.
  await page.goto(`${APP_ORIGIN}/admin/library`);
  await expect(page.getByTestId("library-row").filter({ hasText: B })).toContainText("referenced by 1");
});

test("on a phone the editor stacks below the list and fits the screen", async ({ page }) => {
  const t = randomBytes(3).toString("hex");
  const peptideId = await seedPeptide(`Phone peptide ${t}`);
  const name = `Phone template ${t}`;
  const db = await signedInClient(ADMIN.email);
  const { error } = await db.rpc("save_cycle_template", {
    p_name: name,
    p_guidance: "",
    p_plans: [
      {
        peptide_id: peptideId,
        phases: [
          { kind: "active", offset_days: 0, length_days: 28, dose_mg: "0.25", local_time: "21:30", schedule_type: "weekdays", weekdays: [1, 3, 5] },
          { kind: "break", offset_days: 28, length_days: 7 },
        ],
      },
    ],
  });
  expect(error).toBeNull();

  await page.setViewportSize({ width: 390, height: 844 });
  await openTemplates(page);
  await (await hydrated(row(page, name))).click();
  await expect(editor(page).getByRole("heading", { level: 2 })).toHaveText(`Edit ${name}`);
  await expect(editor(page)).toBeInViewport();
  const boxes = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    return {
      listBottom: box(".app-lib-list").bottom,
      editorTop: box(".app-lib-editor").top,
      editorWidth: box(".app-lib-editor").width,
      scrollWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    };
  });
  expect(boxes.editorTop).toBeGreaterThanOrEqual(boxes.listBottom);
  expect(boxes.editorWidth).toBeGreaterThan(300);
  expect(boxes.scrollWidth).toBeLessThanOrEqual(boxes.viewport);
  // Weekday toggles and the small buttons are at least 44px hit targets.
  for (const target of [
    editor(page).getByRole("button", { name: "Mon" }),
    editor(page).getByRole("button", { name: "+ Phase" }),
    editor(page).getByRole("button", { name: "Remove peptide" }),
  ]) {
    const box = (await target.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test("a researcher cannot open the templates editor", async ({ page }) => {
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/admin/templates`);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
});
