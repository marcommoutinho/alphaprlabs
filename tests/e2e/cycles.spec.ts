// S9 R3 Cycle builder: a researcher builds a custom multi-peptide cycle,
// meeting the designed validation list in order, in the device's time zone;
// copies a template, which the admin then edits without touching the copy
// (the handoff scenario); edits the copy's future plan as a new revision; a
// template naming a peptide no longer offered can't be used; and another
// researcher can't open the cycle. Against the real local Supabase; library
// rows are shared by every run, so names are unique per run.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { APP_ORIGIN } from "../../playwright.config";
import { ensureAccount, hydrated, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";

const RESEARCHER = { email: uniqueEmail("s9-builder"), name: "Builder Researcher" };
const OTHER = { email: uniqueEmail("s9-builder-other"), name: "Other Researcher" };
const ADMIN = { email: uniqueEmail("s9-builder-admin"), name: "Builder Admin" };
const ZONE = "America/Vancouver";

test.use({ timezoneId: ZONE });

test.beforeAll(async () => {
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
  await ensureAccount({ ...OTHER, role: "researcher" });
  await ensureAccount({ ...ADMIN, role: "admin" });
});

const plan = (page: Page, peptide: string) => page.getByTestId("cycle-plan").filter({ hasText: peptide });
const phase = (block: Locator, index: number) => block.getByTestId("cycle-phase").nth(index);
const errors = (page: Page) => page.locator(".app-cyc-errors li");

async function seedPeptide(name: string, available = true) {
  const { data, error } = await serviceClient()
    .from("peptides")
    .insert({ name, information: `[Supplied information for ${name}]`, available })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not seed ${name}: ${error?.message ?? "no row"}`);
  return data.id;
}

/** The stored cycle by name (secret key): current revision number, zone and plans by position. */
async function storedCycle(name: string) {
  const db = serviceClient();
  const { data: cycle, error } = await db.from("cycles").select("id, current_revision, template_name").eq("name", name).single();
  if (error || !cycle) throw new Error(`No cycle ${name}: ${error?.message ?? "no row"}`);
  const { data: revisions, error: revError } = await db
    .from("cycle_revisions")
    .select("number, time_zone, cycle_revision_plans(position, peptide_id, effective_from, cycle_revision_phases(kind, start_date, end_date, dose_mg::text, local_time, schedule_type, every_days, weekdays, dose_change_mg::text))")
    .eq("cycle_id", cycle.id)
    .order("number");
  if (revError || !revisions) throw new Error(`No revisions for ${name}: ${revError?.message ?? "no rows"}`);
  return {
    ...cycle,
    revisions: revisions.map((revision) => ({
      ...revision,
      plans: [...revision.cycle_revision_plans]
        .sort((a, b) => a.position - b.position)
        .map((p) => ({ ...p, phases: [...p.cycle_revision_phases].sort((a, b) => a.start_date.localeCompare(b.start_date)) })),
    })),
  };
}

/** A local date `days` from today in `zone`. */
function localDay(days: number, zone: string) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("a researcher builds a multi-peptide custom cycle, with the designed validation", async ({ page }) => {
  const t = randomBytes(3).toString("hex");
  const [A, B, C] = [`Builder A ${t}`, `Builder B ${t}`, `Builder C ${t}`];
  await seedPeptide(A);
  await seedPeptide(B);
  await seedPeptide(C, false);
  const name = `Custom ${t}`;

  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/app/cycles`);
  await (await hydrated(page.getByRole("link", { name: "Custom cycle" }))).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles/new`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New cycle");
  await expect(page.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]')).toHaveText("Cycles");
  await expect(page.getByText("You can change future phases any time.")).toBeVisible();
  // The time zone is suggested from the device.
  await expect(page.getByLabel("Time zone")).toHaveValue(ZONE);

  const save = await hydrated(page.getByRole("button", { name: "Save cycle" }));
  await save.click();
  await expect(page.locator(".app-cyc-errors b")).toHaveText("Fix these before saving");
  await expect(errors(page)).toHaveText(["Give the cycle a name.", "Add a goal — results are reviewed against it.", "Add at least one peptide."]);

  await page.getByLabel("Cycle name").fill(name);
  await page.getByLabel("Goal").fill("Recomposition");
  await page.getByLabel("Starting baseline · optional").fill("82.4 kg");
  const picker = page.getByLabel("Peptide to add");
  await expect(picker.locator("option", { hasText: C })).toHaveCount(0);
  await picker.selectOption({ label: A });
  await page.getByRole("button", { name: "+ Add peptide from library" }).click();
  await picker.selectOption({ label: B });
  await page.getByRole("button", { name: "+ Add peptide from library" }).click();
  await expect(picker.locator("option", { hasText: A })).toHaveCount(0);

  const a = plan(page, A);
  const b = plan(page, B);
  const start = localDay(1, "America/Toronto");
  await expect(phase(a, 0).getByLabel("Start", { exact: true })).toHaveValue(start);
  await expect(phase(a, 0).locator(".app-cyc-phase-title")).toHaveText("Phase 1");

  // Every message, in order: per peptide, phases by start date.
  await phase(a, 0).getByLabel("Every (days)").fill("0");
  await a.getByRole("button", { name: "+ Break" }).click();
  await phase(a, 1).getByLabel("Start", { exact: true }).fill(localDay(20, ZONE));
  await phase(b, 0).getByLabel("Schedule").selectOption({ label: "Fixed weekdays (keeps weekday and clock time)" });
  const days = phase(b, 0).getByRole("group", { name: "Weekdays" });
  await expect(days.getByRole("button")).toHaveText(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  for (const day of ["Mon", "Wed", "Fri"]) await days.getByRole("button", { name: day }).click();
  await phase(b, 0).getByLabel("End").fill(localDay(0, ZONE));
  await save.click();
  await expect(errors(page)).toHaveText([
    `${A}: phase 1 needs a dose in mg.`,
    `${A}: phase 1 needs an interval of at least 1 day.`,
    `${A}: phases 1 and 2 overlap.`,
    `${B}: phase 1 ends before it starts.`,
    `${B}: phase 1 needs a dose in mg.`,
    `${B}: phase 1 needs at least one weekday.`,
  ]);

  await phase(a, 0).getByLabel("Dose per administration (mg)").fill("0,4");
  await phase(a, 0).getByLabel("Every (days)").fill("5");
  await phase(a, 0).getByLabel("Local time").fill("20:00");
  await phase(a, 1).getByLabel("Start", { exact: true }).fill(localDay(29, "America/Toronto"));
  await expect(phase(a, 1).getByLabel("End")).toHaveValue(localDay(35, "America/Toronto"));
  await phase(b, 0).getByLabel("End").fill(localDay(40, ZONE));
  await phase(b, 0).getByLabel("Dose per administration (mg)").fill("0.3");
  await days.getByRole("button", { name: "Tue" }).click();
  await days.getByRole("button", { name: "Thu" }).click();
  await save.click();
  await expect(page.locator(".app-toast")).toHaveText("Cycle saved.");
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles`);

  const stored = await storedCycle(name);
  expect(stored).toMatchObject({ current_revision: 1, template_name: "" });
  expect(stored.revisions).toHaveLength(1);
  expect(stored.revisions[0].time_zone).toBe(ZONE);
  const [pa, pb] = stored.revisions[0].plans;
  expect(pa.phases.map((p) => [p.kind, p.start_date, p.end_date, p.dose_mg, p.local_time, p.every_days])).toEqual([
    ["active", start, localDay(28, "America/Toronto"), "0.4", "20:00", 5],
    ["break", localDay(29, "America/Toronto"), localDay(35, "America/Toronto"), null, null, null],
  ]);
  expect(pb.phases).toMatchObject([{ kind: "active", schedule_type: "weekdays", weekdays: [2, 4], dose_mg: "0.3", end_date: localDay(40, ZONE) }]);
});

test("a template copy stays the researcher's own when the admin edits the template, and its future plan can change", async ({ page }) => {
  const t = randomBytes(3).toString("hex");
  const [A, B] = [`Copy A ${t}`, `Copy B ${t}`];
  const aId = await seedPeptide(A);
  const bId = await seedPeptide(B);
  const withdrawn = await seedPeptide(`Copy withdrawn ${t}`);
  const templateName = `Recomp starter ${t}`;
  const adminDb = await signedInClient(ADMIN.email);
  const phases = (dose: string) => [
    { kind: "active", offset_days: 0, length_days: 29, dose_mg: dose, local_time: "20:00", schedule_type: "interval", every_days: 5 },
    { kind: "break", offset_days: 29, length_days: 7 },
  ];
  const plans = [
    { peptide_id: aId, phases: phases("0.4") },
    { peptide_id: bId, phases: [{ kind: "active", offset_days: 0, length_days: 40, dose_mg: "0.3", local_time: "07:30", schedule_type: "weekdays", weekdays: [1, 3, 5] }] },
  ];
  const { data: templateId, error } = await adminDb.rpc("save_cycle_template", { p_name: templateName, p_guidance: "", p_plans: plans });
  if (error || !templateId) throw new Error(`Could not create the template: ${error?.message ?? "no id"}`);
  const { data: blockedId, error: blockedError } = await adminDb.rpc("save_cycle_template", {
    p_name: `Blocked ${t}`,
    p_guidance: "",
    p_plans: [{ peptide_id: withdrawn, phases: phases("1") }],
  });
  if (blockedError || !blockedId) throw new Error(`Could not create the template: ${blockedError?.message ?? "no id"}`);
  await serviceClient().from("peptides").update({ available: false }).eq("id", withdrawn);

  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);

  // A template naming a peptide no longer offered can't be used.
  await page.goto(`${APP_ORIGIN}/app/cycles/new?template=${blockedId}`);
  await expect(page.getByRole("alert").filter({ hasText: "no longer offered" })).toHaveText(
    "This template includes a peptide that is no longer offered, so it can't be used to start a new cycle. Existing cycles that used it keep their records.",
  );
  await expect(page.getByRole("button", { name: "Save cycle" })).toHaveCount(0);

  await page.goto(`${APP_ORIGIN}/app/cycles/new?template=${templateId}`);
  await expect(page.getByText(`Started from the supplied template “${templateName}”. This copy is yours — later template changes won't touch it.`)).toBeVisible();
  await expect(page.getByLabel("Cycle name")).toHaveValue(templateName);
  const tomorrow = localDay(1, "America/Toronto");
  await expect(phase(plan(page, A), 0).getByLabel("Start", { exact: true })).toHaveValue(tomorrow);
  await expect(phase(plan(page, A), 1).locator(".app-cyc-phase-title")).toHaveText("Break");
  await (await hydrated(page.getByLabel("Goal"))).fill("Recomp");
  await page.getByRole("button", { name: "Save cycle" }).click();
  await expect(page.locator(".app-toast")).toHaveText("Cycle saved.");
  const copied = await storedCycle(templateName);
  expect(copied.template_name).toBe(templateName);

  // The admin edits the template: the copy is unchanged.
  const edited = [{ peptide_id: aId, phases: phases("0.9") }];
  const { error: editError } = await adminDb.rpc("save_cycle_template", { p_id: templateId, p_name: `${templateName} v2`, p_guidance: "New", p_plans: edited });
  if (editError) throw new Error(`Could not edit the template: ${editError.message}`);
  expect(await storedCycle(templateName)).toEqual(copied);

  // Edit future plan: the builder shows the copy, and a dose change is saved as revision 2.
  await page.goto(`${APP_ORIGIN}/app/cycles/${copied.id}/edit`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Edit future plan");
  await expect(page.getByLabel("Time zone")).toHaveValue(ZONE);
  await expect(page.getByText("Applies to future occurrences only.")).toBeVisible();
  const dose = phase(plan(page, A), 0).getByLabel("Dose per administration (mg)");
  await expect(dose).toHaveValue("0.4");
  await expect(plan(page, B)).toBeVisible();
  await (await hydrated(dose)).fill("0.5");
  await page.getByRole("button", { name: "Save future changes" }).click();
  await expect(page.locator(".app-toast")).toHaveText("Future plan updated. Recorded history is unchanged.");
  const revised = await storedCycle(templateName);
  expect(revised.current_revision).toBe(2);
  expect(revised.revisions[0]).toEqual(copied.revisions[0]);
  expect(revised.revisions[1].plans[0].phases[0]).toMatchObject({ dose_mg: "0.5", start_date: tomorrow });

  // Nobody else can open it.
  await page.context().clearCookies();
  await signInAs(page, APP_ORIGIN, OTHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/app/cycles/${copied.id}/edit`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});

test("the builder works at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/app/cycles/new`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New cycle");
  const name = page.getByLabel("Cycle name");
  const zone = page.getByLabel("Time zone");
  // One column: the time zone sits below the name.
  const [nameBox, zoneBox] = [await name.boundingBox(), await zone.boundingBox()];
  expect(zoneBox!.y).toBeGreaterThan(nameBox!.y + nameBox!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
