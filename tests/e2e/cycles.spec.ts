// R4a–c Cycle builder (design v3): a researcher builds a custom
// multi-peptide cycle through the three steps and the review, meeting the
// validation as the first issue plus "(+N more)", in the device's time zone
// (an untouched start follows the chosen zone); copies a template, which the
// admin then edits without touching the copy (the handoff scenario); edits
// the copy's future plan as a new revision; a template naming a peptide no
// longer offered is copied with it; and another researcher can't open the
// cycle. Against the real local Supabase; library rows are shared by every
// run, so names are unique per run.
import { expect, test, type Page } from "@playwright/test";
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

const step = (page: Page) => page.getByTestId("builder-step");
const issue = (page: Page) => page.getByTestId("builder-issue");
const peptideRow = (page: Page, name: string) => page.getByRole("checkbox").filter({ hasText: name });
const editor = (page: Page) => page.getByTestId("phase-editor");
const phaseItem = (page: Page, index: number) => page.getByTestId("builder-phase").nth(index);
const start = (page: Page) => page.getByLabel("Cycle starts");

/** The whole issue list, opened from "(+N more)". */
async function allIssues(page: Page, more: string) {
  await page.getByRole("button", { name: more }).click();
  return page.getByRole("list", { name: "Everything to fix" }).locator("li");
}

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
    .select("number, time_zone, cycle_revision_plans(position, plan_id, peptide_id, effective_from, cycle_revision_phases(kind, start_date, end_date, dose_mg::text, local_time, schedule_type, every_days, weekdays, dose_change_mg::text))")
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

/** From the review step back to the last peptide's schedule, and forward again. */
async function startAfterZone(page: Page, zone: string) {
  await page.getByLabel("Time zone").selectOption(zone);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(step(page)).toHaveText("3 of 3");
  const value = await start(page).inputValue();
  await page.getByRole("button", { name: "Review cycle" }).click();
  await expect(step(page)).toHaveText("Review");
  return value;
}

test("a researcher builds a multi-peptide custom cycle, with the designed validation", async ({ page }) => {
  const t = randomBytes(3).toString("hex");
  const [A, B, C] = [`Builder A ${t}`, `Builder B ${t}`, `Builder C ${t}`];
  const aId = await seedPeptide(A);
  await seedPeptide(B);
  await seedPeptide(C, false);
  const name = `Custom ${t}`;

  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/app/cycles`);
  await (await hydrated(page.getByRole("link", { name: "New cycle" }))).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles/new`);
  await expect(page.getByTestId("builder-title")).toHaveText("New cycle");
  await expect(step(page)).toHaveText("1 of 3");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose peptides");
  await expect(page.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]')).toHaveText("Cycles");

  // R4a: nothing chosen yet.
  await (await hydrated(page.getByRole("button", { name: "Choose a peptide" }))).click();
  await expect(issue(page)).toHaveText("Add at least one peptide.");
  // A peptide no longer offered isn't listed.
  const search = page.getByLabel("Search peptides");
  await search.fill(C);
  await expect(page.getByText(`No peptides match “${C}”.`)).toBeVisible();
  await search.fill(t);
  await expect(page.getByTestId("all-peptides").getByRole("checkbox")).toHaveCount(2);
  await peptideRow(page, A).click();
  await peptideRow(page, B).click();
  await expect(page.getByTestId("selected-peptides").getByRole("checkbox")).toHaveText([A, B]);
  await expect(issue(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Continue with 2 peptides" }).click();

  // R4b for A: the dose (typed with a comma, then shown in mcg) and a half-filled mix.
  await expect(step(page)).toHaveText("2 of 3");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(A);
  const dose = page.getByLabel("Dose", { exact: true });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(issue(page)).toHaveText(`${A}: enter a dose above 0.`);
  await dose.fill("0,4");
  await page.getByRole("group", { name: "Dose unit" }).getByRole("button", { name: "mcg" }).click();
  await expect(dose).toHaveValue("400");
  await page.getByLabel("Vial", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(issue(page)).toHaveText(`${A}: enter the BAC water in mL, or leave the mix empty.`);
  await page.getByLabel("BAC water").fill("2");
  // 400 mcg of 10 mg in 2 mL is 0.08 mL: 8 units on the 100-unit syringe.
  await expect(page.getByTestId("dose-units")).toHaveText("8");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // R4c for A: day 1 is tomorrow in the device's zone; the first phase is open.
  await expect(step(page)).toHaveText("3 of 3");
  await expect(start(page)).toHaveValue(localDay(1, ZONE));
  await expect(page.getByTestId("cycle-length")).toHaveText("28 days");
  await expect(editor(page)).toHaveCount(1);
  await editor(page).getByRole("group", { name: "Frequency" }).getByRole("button", { name: "Every N days" }).click();
  await editor(page).getByLabel("Every").fill("0");
  await editor(page).getByLabel("Time").fill("20:00");
  await page.getByRole("button", { name: "+ Break" }).click();
  await expect(editor(page).getByLabel("Starts on day")).toHaveValue("29");
  await editor(page).getByLabel("Starts on day").fill("20");
  await page.getByRole("button", { name: `Next: ${B}` }).click();
  // Every issue, in order: per phase as listed, then overlaps.
  await expect(issue(page)).toHaveText(`${A} · Phase 1: repeat every 1 day or more.`);
  await expect(await allIssues(page, "(+1 more)")).toHaveText([`${A} · Phase 1: repeat every 1 day or more.`, `${A}: Phase 1 and break overlap.`]);
  await editor(page).getByLabel("Starts on day").fill("29");
  await expect(editor(page).locator("[data-slot=span]")).toHaveText(new RegExp(`^Days 29–35 · `));
  await phaseItem(page, 0).getByRole("button").click();
  await editor(page).getByLabel("Every").fill("5");
  await expect(page.getByTestId("cycle-length")).toHaveText("35 days");
  await page.getByRole("button", { name: `Next: ${B}` }).click();

  // B: mg, no mix; weekdays, none chosen at first.
  await expect(step(page)).toHaveText("2 of 3");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(B);
  await expect(page.getByRole("group", { name: "Peptides" }).getByRole("button")).toHaveText([A, `${B}`]);
  await dose.fill("0.3");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(step(page)).toHaveText("3 of 3");
  await editor(page).getByRole("group", { name: "Frequency" }).getByRole("button", { name: "Weekdays" }).click();
  const days = editor(page).getByRole("group", { name: "Weekdays" });
  await expect(days.getByRole("button")).toHaveText(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  for (const day of ["Mon", "Wed", "Fri"]) await days.getByRole("button", { name: day }).click();
  await editor(page).getByLabel("Starts on day").fill("3");
  await editor(page).getByLabel("Length (days)").fill("38");
  await page.getByRole("button", { name: "Review cycle" }).click();
  await expect(issue(page)).toHaveText(`${B} · Phase 1: choose at least one weekday.`);
  await days.getByRole("button", { name: "Tue" }).click();
  await days.getByRole("button", { name: "Thu" }).click();
  await expect(page.getByTestId("cycle-length")).toHaveText("40 days");
  await page.getByRole("button", { name: "Review cycle" }).click();

  // Review: the time zone is suggested from the device; an untouched start
  // follows the zone chosen (UTC+14 and UTC-11 are always on different dates).
  await expect(step(page)).toHaveText("Review");
  await expect(page.getByLabel("Time zone")).toHaveValue(ZONE);
  await expect(page.getByTestId("review-plan")).toHaveCount(2);
  await expect(page.getByTestId("review-plan").nth(0)).toContainText("8 units · 100-unit");
  await expect(page.getByTestId("review-plan").nth(1)).toContainText("No mix");
  expect(await startAfterZone(page, "Pacific/Kiritimati")).toBe(localDay(1, "Pacific/Kiritimati"));
  expect(await startAfterZone(page, "Pacific/Pago_Pago")).toBe(localDay(1, "Pacific/Pago_Pago"));
  expect(await startAfterZone(page, ZONE)).toBe(localDay(1, ZONE));
  // A start the researcher chose stays.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await start(page).fill(localDay(2, ZONE));
  await page.getByRole("button", { name: "Review cycle" }).click();
  expect(await startAfterZone(page, "Pacific/Kiritimati")).toBe(localDay(2, ZONE));
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await start(page).fill(localDay(1, ZONE));
  await page.getByRole("button", { name: "Review cycle" }).click();
  expect(await startAfterZone(page, ZONE)).toBe(localDay(1, ZONE));

  const save = page.getByRole("button", { name: "Start cycle" });
  await save.click();
  await expect(issue(page)).toHaveText("Give the cycle a name.");
  await expect(await allIssues(page, "(+1 more)")).toHaveText(["Give the cycle a name.", "Add a goal — results are reviewed against it."]);
  await page.getByLabel("Cycle name").fill(name);
  await page.getByLabel("Goal").fill("Recomposition");
  await page.getByLabel("Starting baseline").fill("82.4 kg");
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Cycle saved." })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`^${APP_ORIGIN}/app/cycles/[0-9a-f-]{36}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  const stored = await storedCycle(name);
  expect(stored).toMatchObject({ current_revision: 1, template_name: "" });
  expect(stored.revisions).toHaveLength(1);
  expect(stored.revisions[0].time_zone).toBe(ZONE);
  const [pa, pb] = stored.revisions[0].plans;
  expect(pa.phases.map((p) => [p.kind, p.start_date, p.end_date, p.dose_mg, p.local_time, p.every_days])).toEqual([
    ["active", localDay(1, ZONE), localDay(28, ZONE), "0.4", "20:00", 5],
    ["break", localDay(29, ZONE), localDay(35, ZONE), null, null, null],
  ]);
  expect(pb.phases).toMatchObject([
    { kind: "active", schedule_type: "weekdays", weekdays: [2, 4], dose_mg: "0.3", start_date: localDay(3, ZONE), end_date: localDay(40, ZONE) },
  ]);
  // A's mix is saved with the cycle and linked to its plan; B has none.
  const links = await serviceClient().from("cycle_plan_mixtures").select("plan_id, peptide_id, mixture_id, unlinked_at").in("plan_id", [pa.plan_id, pb.plan_id]);
  expect(links.data).toEqual([expect.objectContaining({ plan_id: pa.plan_id, peptide_id: aId, unlinked_at: null })]);
  const versions = await serviceClient().from("mixture_versions").select("vial_mg, liquid_ml, syringe_units").eq("mixture_id", links.data![0].mixture_id);
  expect(versions.data).toEqual([{ vial_mg: 10, liquid_ml: 2, syringe_units: 100 }]);
});

test("a template copy stays the researcher's own when the admin edits the template, and its future plan can change", async ({ page }) => {
  const t = randomBytes(3).toString("hex");
  const [A, B] = [`Copy A ${t}`, `Copy B ${t}`];
  const aId = await seedPeptide(A);
  const bId = await seedPeptide(B);
  const withdrawnName = `Copy withdrawn ${t}`;
  const withdrawn = await seedPeptide(withdrawnName);
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
  const withdrawnTemplate = `With withdrawn ${t}`;
  const { data: withdrawnTemplateId, error: withdrawnError } = await adminDb.rpc("save_cycle_template", {
    p_name: withdrawnTemplate,
    p_guidance: "",
    p_plans: [{ peptide_id: withdrawn, phases: phases("1") }],
  });
  if (withdrawnError || !withdrawnTemplateId) throw new Error(`Could not create the template: ${withdrawnError?.message ?? "no id"}`);
  const { error: withdrawError } = await serviceClient().from("peptides").update({ available: false }).eq("id", withdrawn);
  if (withdrawError) throw new Error(`Could not withdraw: ${withdrawError.message}`);

  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);

  // A template naming a peptide no longer offered can still be copied, and the
  // copy keeps it (Marco, 2026-09-26); the library list still doesn't offer it.
  await page.goto(`${APP_ORIGIN}/app/cycles/new?template=${withdrawnTemplateId}`);
  const kept = page.getByTestId("selected-peptides").getByRole("checkbox").filter({ hasText: withdrawnName });
  await expect(kept).toBeVisible();
  await expect(kept).toContainText("Not offered");
  await (await hydrated(page.getByLabel("Search peptides"))).fill(withdrawnName);
  await expect(page.getByTestId("all-peptides")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue with 1 peptide" }).click();
  await expect(page.getByLabel("Dose", { exact: true })).toHaveValue("1");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Review cycle" }).click();
  await page.getByLabel("Goal").fill("Keep it");
  await page.getByRole("button", { name: "Start cycle" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cycle saved." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(withdrawnTemplate);
  const keptCopy = await storedCycle(withdrawnTemplate);
  expect(keptCopy.revisions[0].plans.map((p) => p.peptide_id)).toEqual([withdrawn]);

  await page.goto(`${APP_ORIGIN}/app/cycles/new?template=${templateId}`);
  await expect(page.getByTestId("template-note")).toHaveText(
    `Started from the supplied template “${templateName}”. This copy is yours — later template changes won't touch it.`,
  );
  await expect(page.getByTestId("selected-peptides").getByRole("checkbox")).toHaveText([A, B]);
  await (await hydrated(page.getByRole("button", { name: "Continue with 2 peptides" }))).click();
  await expect(page.getByLabel("Dose", { exact: true })).toHaveValue("400");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // Day 1 is tomorrow in the cycle's zone (the device's, suggested).
  const tomorrow = localDay(1, ZONE);
  await expect(start(page)).toHaveValue(tomorrow);
  await expect(page.getByTestId("builder-phase")).toHaveCount(2);
  await expect(phaseItem(page, 1)).toHaveAttribute("data-kind", "break");
  await expect(phaseItem(page, 1)).toContainText("Break");
  await page.getByRole("button", { name: `Next: ${B}` }).click();
  await expect(page.getByLabel("Dose", { exact: true })).toHaveValue("300");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Review cycle" }).click();
  await expect(page.getByLabel("Cycle name")).toHaveValue(templateName);
  await page.getByLabel("Goal").fill("Recomp");
  await page.getByRole("button", { name: "Start cycle" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cycle saved." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(templateName);
  const copied = await storedCycle(templateName);
  expect(copied.template_name).toBe(templateName);

  // The admin edits the template: the copy is unchanged.
  const edited = [{ peptide_id: aId, phases: phases("0.9") }];
  const { error: editError } = await adminDb.rpc("save_cycle_template", { p_id: templateId, p_name: `${templateName} v2`, p_guidance: "New", p_plans: edited });
  if (editError) throw new Error(`Could not edit the template: ${editError.message}`);
  expect(await storedCycle(templateName)).toEqual(copied);

  // Edit future plan: the builder shows the copy, and a dose change is saved as revision 2.
  await page.goto(`${APP_ORIGIN}/app/cycles/${copied.id}/edit`);
  await expect(page.getByTestId("builder-title")).toHaveText("Edit future plan");
  await expect(page.getByTestId("selected-peptides").getByRole("checkbox")).toHaveText([A, B]);
  await (await hydrated(page.getByRole("button", { name: "Continue with 2 peptides" }))).click();
  const dose = page.getByLabel("Dose", { exact: true });
  await expect(dose).toHaveValue("400");
  await dose.fill("500");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(start(page)).toHaveValue(tomorrow);
  await expect(editor(page).getByLabel("Dose", { exact: true })).toHaveValue("500");
  await page.getByRole("button", { name: `Next: ${B}` }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Review cycle" }).click();
  await expect(page.getByLabel("Time zone")).toHaveValue(ZONE);
  await page.getByRole("button", { name: "Save future changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Future plan updated. Recorded history is unchanged." })).toBeVisible();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles/${copied.id}`);
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

test("the builder works at phone width, over the tab bar", async ({ page }) => {
  const t = randomBytes(3).toString("hex");
  const A = `Phone builder ${t}`;
  await seedPeptide(A);
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/app/cycles/new`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose peptides");
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  // Full screen: the footer's button sits where the tab bar would be, and is the one hit there.
  const footer = page.getByRole("button", { name: "Choose a peptide" });
  const box = (await footer.boundingBox())!;
  expect(box.y + box.height).toBeGreaterThan(844 - 120);
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent, [box.x + box.width / 2, box.y + box.height / 2])).toBe(
    "Choose a peptide",
  );
  expect(await noSideScroll()).toBe(true);

  await (await hydrated(page.getByLabel("Search peptides"))).fill(A);
  await peptideRow(page, A).click();
  await page.getByRole("button", { name: "Continue with 1 peptide" }).click();
  await page.getByLabel("Dose", { exact: true }).fill("250");
  expect(await noSideScroll()).toBe(true);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("lane-preview")).toBeVisible();
  expect(await noSideScroll()).toBe(true);
  await page.getByRole("button", { name: "Review cycle" }).click();
  // One column: the time zone sits below the name.
  const [nameBox, zoneBox] = [await page.getByLabel("Cycle name").boundingBox(), await page.getByLabel("Time zone").boundingBox()];
  expect(zoneBox!.y).toBeGreaterThan(nameBox!.y + nameBox!.height);
  expect(await noSideScroll()).toBe(true);
});
