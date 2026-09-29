// R10 Cycles, R3 / D2 Cycle detail (design v3) and R6 Library, against the
// real local Supabase. The server's clock is the real one, so the cycles use
// a fixed-offset zone where it is about 12:00 now (a 20:00 dose today is
// still ahead, 07:15 doses are morning ones) and dates relative to today
// there: every status and dose state is the same whenever the suite runs.
// Library rows are shared by every run, so names are unique per run.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { dateRange } from "../../src/lib/cycles/geometry";
import { createCycle, interval, pause, plan, saveCycle, tag, weekdays } from "../support/cycles";
import { ensureAccount, hydrated, ok, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";
import { d, NOON } from "../support/noon";
import { saveTemplateAs } from "../support/admin-writers";

const RESEARCHER = { email: uniqueEmail("s10-views"), name: "Views Researcher" };
const OTHER = { email: uniqueEmail("s10-views-other"), name: "Other Researcher" };
const ADMIN = { email: uniqueEmail("s10-views-admin"), name: "Views Admin" };

/** "Wed" for a local date. */
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

test.beforeAll(async () => {
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
  await ensureAccount({ ...OTHER, role: "researcher" });
  await ensureAccount({ ...ADMIN, role: "admin" });
});

async function seedPeptide(name: string, available = true, cyclingOff = "") {
  const { data, error } = await serviceClient()
    .from("peptides")
    .insert({ name, information: `[Supplied information for ${name}]`, cycling_off_guidance: cyclingOff, available })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not seed ${name}: ${error?.message ?? "no row"}`);
  return data.id;
}

async function signIn(page: Page, email: string) {
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
}

/** Revision 1's plan and phase ids for a one-plan, one-phase cycle (secret key). */
async function firstIds(cycleId: string) {
  const db = serviceClient();
  const revisions = await ok(db.from("cycle_revisions").select("id").eq("cycle_id", cycleId).eq("number", 1), "revision 1");
  if (revisions.length !== 1) throw new Error(`Expected revision 1, found ${revisions.length}`);
  const phases = await ok(db.from("cycle_revision_phases").select("plan_id, phase_id").eq("revision_id", revisions[0].id), "phases");
  if (phases.length !== 1) throw new Error(`Expected one phase, found ${phases.length}`);
  return phases[0];
}

test("R10 lists only the researcher's own cycles, grouped by status", async ({ page }) => {
  const t = tag();
  const A = `Views A ${t}`;
  const B = `Views B ${t}`;
  const [aId, bId] = [await seedPeptide(A), await seedPeptide(B)];
  const mine = await signedInClient(RESEARCHER.email);
  // Upcoming: starts in three days. Active: under way. In break: A rests today. Ended: over ten days ago.
  await createCycle(mine, { name: `Upcoming ${t}`, timeZone: NOON, plans: [plan(aId, [interval(d(3), d(10), "0.4", 2, "20:00")])] });
  await createCycle(mine, {
    name: `Active ${t}`,
    timeZone: NOON,
    plans: [plan(aId, [interval(d(-4), d(20), "0.4", 2, "20:00")]), plan(bId, [weekdays(d(-4), d(20), [0, 1, 2, 3, 4, 5, 6], "1", "07:15")])],
  });
  await createCycle(mine, {
    name: `Resting ${t}`,
    timeZone: NOON,
    plans: [plan(aId, [interval(d(-6), d(-2), "0.4", 2, "20:00"), pause(d(-1), d(3)), interval(d(4), d(9), "0.4", 2, "20:00")])],
  });
  await createCycle(mine, { name: `Ended ${t}`, timeZone: NOON, plans: [plan(aId, [interval(d(-20), d(-11), "0.4", 3, "08:00")])] });
  const theirs = await signedInClient(OTHER.email);
  await createCycle(theirs, { name: `Not mine ${t}`, timeZone: NOON, plans: [plan(aId, [interval(d(-4), d(20))])] });

  await signIn(page, RESEARCHER.email);
  await page.goto(`${APP_ORIGIN}/app/cycles`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cycles");
  const groups = page.getByTestId("cycle-group");
  await expect(groups.locator("h2")).toHaveText(["Active", "Upcoming", "Ended"]);
  const card = (name: string) => page.getByTestId("cycle-card").filter({ hasText: name });
  const names = (group: number) => groups.nth(group).getByTestId("cycle-card").locator("[data-slot=name]").filter({ hasText: t });
  await expect(names(0)).toHaveCount(2);
  expect((await names(0).allTextContents()).sort()).toEqual([`Active ${t}`, `Resting ${t}`]);
  await expect(names(1)).toHaveText([`Upcoming ${t}`]);
  await expect(names(2)).toHaveText([`Ended ${t}`]);
  await expect(page.getByText(`Not mine ${t}`)).toHaveCount(0);

  await expect(card(`Active ${t}`)).toHaveAttribute("data-status", "Active");
  await expect(card(`Resting ${t}`)).toHaveAttribute("data-status", "In break");
  await expect(card(`Upcoming ${t}`)).toHaveAttribute("data-status", "Upcoming");
  await expect(card(`Ended ${t}`)).toHaveAttribute("data-status", "Ended");

  // The day of the cycle, its peptides, the next dose and adherence from the engine.
  const active = card(`Active ${t}`);
  await expect(active.locator("[data-slot=day]")).toHaveText("Day 5 of 25");
  await expect(active.locator("[data-slot=peptides]")).toHaveText(`${A} · ${B}`);
  await expect(active.getByRole("img")).toHaveAttribute("aria-label", "Day 5 of 25");
  // Today's 07:15 B dose is due now; A: d-4, d-2 and B: every day d-4 … d-1 are missed.
  await expect(active.locator("[data-slot=next]")).toContainText(`${B} · 1 mg due now`);
  await expect(active.locator("[data-slot=next]")).toContainText("6 missed");
  await expect(active.locator("[data-slot=adherence]")).toHaveText("0%");
  await expect(card(`Resting ${t}`).locator("[data-slot=peptides]")).toHaveText(`${A} · In break`);
  await expect(card(`Resting ${t}`).locator("[data-slot=next]")).toContainText(`${A} · 400 mcg next ${weekday(d(4))} 8:00 PM`);
  await expect(card(`Upcoming ${t}`).locator("[data-slot=day]")).toHaveText(`Starts ${dateRange(d(3), d(3))}`);
  await expect(card(`Upcoming ${t}`).locator("[data-slot=peptides]")).toHaveText(`${A} · 8 days`);
  await expect(card(`Upcoming ${t}`).locator("[data-slot=next]")).toHaveText(`First: ${A} · 400 mcg, ${weekday(d(3))} 8:00 PM`);
  await expect(card(`Ended ${t}`)).toContainText("4 missed");
  await expect(card(`Ended ${t}`).locator("[data-slot=adherence]")).toHaveText("0%");

  await active.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Active ${t}`);
  await expect(page.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]')).toHaveText("Cycles");
});

test("R3 / D2 show doses from every revision: a time change keeps the rhythm", async ({ page }) => {
  const t = tag();
  const A = `Timeline A ${t}`;
  const aId = await seedPeptide(A, true, `Cycle-off guidance for ${A}`);
  const mine = await signedInClient(RESEARCHER.email);
  const name = `Timeline ${t}`;
  // Every 2 days at 20:00 from five days ago (none today); then, from today, at 07:15.
  const cycleId = await createCycle(mine, {
    name,
    goal: "Sleep quality",
    timeZone: NOON,
    plans: [plan(aId, [interval(d(-5), d(20), "0.4", 2, "20:00")])],
  });
  const ids = await firstIds(cycleId);
  const edited = { ...interval(d(-5), d(20), "0.4", 2, "20:00", ids.phase_id), time_changes: [{ from: d(0), local_time: "07:15" }] };
  await ok(saveCycle(mine, { cycleId, version: 1, name, goal: "Sleep quality", timeZone: NOON, plans: [plan(aId, [edited], ids.plan_id, d(0))] }), "revision 2");

  await signIn(page, RESEARCHER.email);
  // R10: the next dose keeps the every-2-days rhythm (tomorrow), at the new time.
  await page.goto(`${APP_ORIGIN}/app/cycles`);
  const listed = page.getByTestId("cycle-card").filter({ hasText: name });
  await expect(listed.locator("[data-slot=next]")).toContainText(`${A} · 400 mcg next tomorrow 7:15 AM`);
  await expect(listed.locator("[data-slot=next]")).toContainText("3 missed");

  await page.goto(`${APP_ORIGIN}/app/cycles/${cycleId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page.getByTestId("cycle-status")).toHaveText(`Active · ${dateRange(d(-5), d(20))}`);
  await expect(page.getByTestId("cycle-now").locator("[data-slot=reading]")).toHaveText("6");
  await expect(page.getByTestId("cycle-now")).toContainText("of 26");
  await expect(page.getByTestId("cycle-now")).toContainText("20 days left");
  // Laptop tiles: nothing taken of the three settled doses, all missed.
  await expect(page.getByTestId("tile-adherence-laptop").locator("[data-slot=value]")).toHaveText("0%");
  await expect(page.getByTestId("tile-adherence-laptop")).toContainText("0 of 3");
  await expect(page.getByTestId("tile-missed-laptop").locator("[data-slot=value]")).toHaveText("3 · 0");

  // D2's timeline: one row per peptide.
  const timeline = page.getByTestId("cycle-timeline");
  await expect(timeline.getByTestId("timeline-row")).toHaveCount(1);
  await expect(timeline.getByTestId("timeline-row")).toContainText(A);

  const card = page.getByTestId("cycle-plan-card");
  await expect(card.locator("h3")).toHaveText(A);
  // The time in force from today is the new one; the rhythm is unchanged.
  await expect(card.locator("[data-slot=schedule]")).toHaveText("400 mcg · every 2 days · 7:15 AM");
  await expect(card.locator("[data-slot=count]")).toHaveText("0 of 3");
  await expect(card.getByTestId("phase-row")).toHaveText([`Days 1–26 · ${dateRange(d(-5), d(20))}400 mcgNow`]);
  const mix = card.locator("[data-slot=saved-mixture]");
  await expect(mix).toHaveText("No saved mix — units can't be shown.Set one up");
  await expect(mix).toHaveAttribute("href", `/app/calculator?plan=${ids.plan_id}`);
  await expect(card.locator("[data-slot=guidance]")).toHaveText(`Cycling off · supplied guidance. Cycle-off guidance for ${A}`);

  // History: the doses before the change stay at 20:00, newest first; each missed one links to its log-late sheet on Today.
  const rows = page.getByTestId("history-table-row");
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-state")))).toEqual(["missed", "missed", "missed"]);
  for (let i = 0; i < 3; i++) {
    await expect(rows.nth(i)).toContainText("8:00 PM");
    await expect(rows.nth(i).getByRole("link", { name: "Log late dose" })).toHaveAttribute("href", /^\/app\/today\?dose=[0-9a-f-]{36}%3A[0-9a-f-]{36}%3A\d+$/);
  }
  await expect(page.getByTestId("history-all").getByText("All 3", { exact: true })).toBeVisible();

  await (await hydrated(page.getByRole("link", { name: "Edit future plan" }))).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles/${cycleId}/edit`);
  await expect(page.getByTestId("builder-title")).toHaveText("Edit future plan");

  // Another researcher: not found, for the detail as for the builder.
  await page.context().clearCookies();
  await signIn(page, OTHER.email);
  await page.goto(`${APP_ORIGIN}/app/cycles/${cycleId}`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await page.goto(`${APP_ORIGIN}/app/cycles/${cycleId.replace(/.$/, (c) => (c === "0" ? "1" : "0"))}`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});

test("R6 hides withdrawn peptides; a template names one and is still a starting point", async ({ page }) => {
  const t = tag();
  const [A, W] = [`Library A ${t}`, `Library W ${t}`];
  const aId = await seedPeptide(A, true, "Four weeks off.");
  const wId = await seedPeptide(W);
  const templateName = `Recomp starter ${t}`;
  const adminDb = await signedInClient(ADMIN.email);
  const templateId = await ok(
    saveTemplateAs(adminDb, {
      p_name: templateName,
      p_guidance: `Guidance for ${templateName}`,
      p_plans: [
        {
          peptide_id: aId,
          phases: [
            { kind: "active", offset_days: 0, length_days: 29, dose_mg: "0.4", local_time: "20:00", schedule_type: "interval", every_days: 5 },
            { kind: "break", offset_days: 29, length_days: 7 },
          ],
        },
        { peptide_id: wId, phases: [{ kind: "active", offset_days: 0, length_days: 40, dose_mg: "0.3", local_time: "07:30", schedule_type: "weekdays", weekdays: [1, 3, 5] }] },
      ],
    }),
    "template",
  );
  const { error } = await serviceClient().from("peptides").update({ available: false }).eq("id", wId);
  if (error) throw new Error(`Could not withdraw ${W}: ${error.message}`);

  await signIn(page, RESEARCHER.email);
  await page.goto(`${APP_ORIGIN}/app/library`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Library");
  // R11 (V4): peptides only; the withdrawn one is never listed.
  const search = await hydrated(page.getByLabel("Search peptides"));
  await search.fill(t);
  const peptides = page.getByTestId("library-peptide");
  await expect(peptides).toHaveCount(1);
  await expect(peptides).toContainText(A);
  await expect(peptides).toContainText(`[Supplied information for ${A}]`);
  await search.fill(W);
  await expect(peptides).toHaveCount(0);
  await expect(page.getByText(`No peptides match “${W}”.`)).toBeVisible();
  // Templates are browsed from Cycles › Templates: the template names the withdrawn peptide, and says so.
  await page.goto(`${APP_ORIGIN}/app/cycles/templates`);
  const card = page.getByTestId("cycle-template").filter({ hasText: templateName });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(`${A} · ${W}`);
  await expect(card).toContainText("Includes a peptide no longer offered for new cycles.");

  // The withdrawn entry's own page isn't browsable; the available one is.
  await page.goto(`${APP_ORIGIN}/app/library/peptides/${wId}`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await page.goto(`${APP_ORIGIN}/app/library/peptides/${aId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(A);
  await expect(page.getByTestId("peptide-cycling-off")).toContainText("Four weeks off.");
  // Not in any of the researcher's cycles: no "Your mix".
  await expect(page.getByTestId("your-mix")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]')).toHaveText("Library");

  await page.goto(`${APP_ORIGIN}/app/library/templates/${templateId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(templateName);
  await expect(page.getByText("Template · 40 days")).toBeVisible();
  // A page-level notice at the top (Marco, 2026-09-26), besides the per-peptide tag; the template stays usable.
  const notice = page.getByTestId("template-withdrawn-notice");
  await expect(notice).toHaveText(`Your copy will include ${W}, which is no longer offered.`);
  await expect(notice).toHaveAttribute("role", "note");
  const plans = page.getByTestId("template-plan");
  expect((await notice.boundingBox())!.y).toBeLessThan((await plans.first().boundingBox())!.y);
  if (process.env.V4_SHOTS) await page.screenshot({ path: `${process.env.V4_SHOTS}/v4-template-withdrawn-notice.png`, fullPage: true });
  await expect(plans.getByRole("heading", { level: 2 })).toHaveText([A, `${W}No longer offered for new cycles.`]);
  await expect(plans.nth(0)).not.toContainText("No longer offered for new cycles.");
  await expect(plans.nth(0).locator("[data-slot=group] > div")).toHaveText([
    "Day 1–290.4 mg · every 5 days · 20:00",
    "Day 30–36Break",
  ]);
  await expect(plans.nth(1).locator("[data-slot=group] > div")).toHaveText(["Day 1–400.3 mg · Mon/Wed/Fri · 07:30"]);
  await expect(page.getByText(`Guidance for ${templateName}`)).toBeVisible();

  await (await hydrated(page.getByRole("link", { name: "Use as starting point" }))).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles/new?template=${templateId}`);
  await expect(page.getByTestId("builder-title")).toHaveText("New cycle");
  await expect(page.getByTestId("template-note")).toContainText(templateName);
  const selected = page.getByTestId("selected-peptides").getByRole("checkbox");
  await expect(selected).toHaveCount(2);
  await expect(selected.filter({ hasText: W })).toContainText("Not offered");
  await expect(selected.filter({ hasText: A })).not.toContainText("Not offered");
});

test("an admin's own Cycles show only their own cycles while a researcher shares", async ({ page }) => {
  const t = tag();
  const aId = await seedPeptide(`Granted A ${t}`);
  const grantor = { email: uniqueEmail("s10-views-grantor"), name: "Granting Researcher" };
  await ensureAccount({ ...grantor, role: "researcher" });
  const grantorDb = await signedInClient(grantor.email);
  const theirs = await createCycle(grantorDb, { name: `Grantor's ${t}`, timeZone: NOON, plans: [plan(aId, [interval(d(-2), d(10))])] });
  await ok(grantorDb.rpc("share_with_team"), "share");
  const adminDb = await signedInClient(ADMIN.email);
  // The share is real: the admin's session can read the researcher's cycle.
  expect(await ok(adminDb.from("cycles").select("id").eq("id", theirs), "shared read")).toHaveLength(1);
  await createCycle(adminDb, { name: `Admin's own ${t}`, timeZone: NOON, plans: [plan(aId, [interval(d(-2), d(10))])] });

  await signIn(page, ADMIN.email);
  await page.goto(`${APP_ORIGIN}/app/cycles`);
  await expect(page.getByTestId("cycle-card").filter({ hasText: `Admin's own ${t}` })).toBeVisible();
  await expect(page.getByText(`Grantor's ${t}`)).toHaveCount(0);
  // Their detail is not on the research side either (the support view is A8).
  await page.goto(`${APP_ORIGIN}/app/cycles/${theirs}`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});

test("the cycle and library views work at phone width", async ({ page }) => {
  const t = tag();
  const A = `Phone A ${t}`;
  const aId = await seedPeptide(A);
  const mine = await signedInClient(RESEARCHER.email);
  const cycleId = await createCycle(mine, { name: `Phone ${t}`, timeZone: NOON, plans: [plan(aId, [interval(d(-10), d(60), "0.4", 3, "20:00")])] });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, RESEARCHER.email);
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  await page.goto(`${APP_ORIGIN}/app/cycles`);
  await expect(page.getByTestId("cycle-card").filter({ hasText: `Phone ${t}` })).toBeVisible();
  expect(await noSideScroll()).toBe(true);

  await page.goto(`${APP_ORIGIN}/app/cycles/${cycleId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Phone ${t}`);
  expect(await noSideScroll()).toBe(true);
  // The phone has no timeline: each peptide card draws its own lane; three tiles sit in one row.
  await expect(page.getByTestId("cycle-timeline")).toBeHidden();
  await expect(page.getByTestId("cycle-plan-card").locator("[data-slot=lane]")).toBeVisible();
  const tiles = await Promise.all(["tile-adherence", "tile-missed", "tile-skipped"].map((id) => page.getByTestId(id).boundingBox()));
  expect(new Set(tiles.map((box) => Math.round(box!.y))).size).toBe(1);
  // History: the latest four, then See all.
  const rows = page.getByTestId("history-row");
  await expect(rows).toHaveCount(4);
  await expect(page.getByTestId("history-all").getByText("See all 4")).toBeVisible();
  await expect(rows.first().getByRole("link", { name: "Log late dose" })).toBeVisible();

  await page.goto(`${APP_ORIGIN}/app/library`);
  await expect(page.getByLabel("Search peptides")).toBeVisible();
  expect(await noSideScroll()).toBe(true);
});
