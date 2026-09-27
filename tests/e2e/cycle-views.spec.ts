// S10 R2 Cycles, R4 Cycle detail and R6 Library, against the real local
// Supabase. The server's clock is the real one, so the cycles use a
// fixed-offset zone where it is about 12:00 now (a 20:00 dose today is still
// ahead, 07:15 doses are morning ones) and dates relative to today there:
// every status and dose state is the same whenever the suite runs.
// Library rows are shared by every run, so names are unique per run.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { formatDate, formatDay, formatMonthDay } from "../../src/lib/format";
import { createCycle, day, interval, pause, plan, saveCycle, tag, weekdays } from "../support/cycles";
import { ensureAccount, hydrated, ok, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";

const RESEARCHER = { email: uniqueEmail("s10-views"), name: "Views Researcher" };
const OTHER = { email: uniqueEmail("s10-views-other"), name: "Other Researcher" };
const ADMIN = { email: uniqueEmail("s10-views-admin"), name: "Views Admin" };

/** An IANA fixed-offset zone where the local time now is 12:xx (Etc/GMT signs are inverted). */
const NOON = (() => {
  const offset = 12 - new Date().getUTCHours();
  return offset === 0 ? "Etc/GMT" : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
})();
const d = (days: number) => day(days, NOON);
/** `Fri Sep 11 · 20:00`, as R2 and R4 show a dose. */
const when = (days: number, time: string) => `${formatDay(d(days))} · ${time}`;

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

test("R2 lists only the researcher's own cycles, grouped by status", async ({ page }) => {
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
  await expect(groups.locator("h2")).toHaveText(["Current", "Upcoming", "Past"]);
  const card = (name: string) => page.getByTestId("cycle-card").filter({ hasText: name });
  await expect(groups.nth(0).getByTestId("cycle-card").locator(".app-cv-card-name")).toHaveText([`Resting ${t}`, `Active ${t}`]);
  await expect(groups.nth(1).getByTestId("cycle-card").locator(".app-cv-card-name")).toHaveText([`Upcoming ${t}`]);
  await expect(groups.nth(2).getByTestId("cycle-card").locator(".app-cv-card-name")).toHaveText([`Ended ${t}`]);
  await expect(page.getByText(`Not mine ${t}`)).toHaveCount(0);

  await expect(card(`Active ${t}`).locator(".app-cv-status")).toHaveText("Active");
  await expect(card(`Resting ${t}`).locator(".app-cv-status")).toHaveText("In break");
  await expect(card(`Upcoming ${t}`).locator(".app-cv-status")).toHaveText("Upcoming");
  await expect(card(`Ended ${t}`).locator(".app-cv-status")).toHaveText("Ended");
  // Next doses from the engine; with nothing confirmed yet (S12), past doses are unconfirmed.
  await expect(card(`Active ${t}`).locator(".app-cv-card-meta")).toHaveText(new RegExp(` · ${A} \\+ ${B}$`));
  await expect(card(`Active ${t}`).locator(".app-cv-card-next")).toHaveText(`Next: ${A} · ${when(0, "20:00")}`);
  // A: d-4, d-2; B: every day d-4 … d-1 (today's 07:15 is due, not unconfirmed).
  await expect(card(`Active ${t}`).locator(".app-cv-card-open")).toHaveText("6 unconfirmed");
  await expect(card(`Upcoming ${t}`).locator(".app-cv-card-next")).toHaveText(`Next: ${A} · ${when(3, "20:00")}`);
  await expect(card(`Upcoming ${t}`).locator(".app-cv-card-open")).toHaveCount(0);
  await expect(card(`Ended ${t}`).locator(".app-cv-card-next")).toHaveText("Ended · 0 of 4 doses recorded");
  await expect(card(`Ended ${t}`).locator(".app-cv-card-open")).toHaveText("4 unconfirmed");

  await card(`Active ${t}`).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Active ${t}`);
  await expect(page.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]')).toHaveText("Cycles");
});

test("R4 shows doses from every revision: a mid-cycle time change keeps the rhythm", async ({ page }) => {
  const t = tag();
  const A = `Timeline A ${t}`;
  const aId = await seedPeptide(A, true, `Cycle-off guidance for ${A}`);
  const mine = await signedInClient(RESEARCHER.email);
  const name = `Timeline ${t}`;
  // Every 2 days at 20:00 from four days ago; then, from tomorrow, at 07:15.
  const cycleId = await createCycle(mine, {
    name,
    goal: "Sleep quality",
    timeZone: NOON,
    plans: [plan(aId, [interval(d(-4), d(20), "0.4", 2, "20:00")])],
  });
  const ids = await firstIds(cycleId);
  const edited = { ...interval(d(-4), d(20), "0.4", 2, "20:00", ids.phase_id), time_changes: [{ from: d(1), local_time: "07:15" }] };
  await ok(saveCycle(mine, { cycleId, version: 1, name, goal: "Sleep quality", timeZone: NOON, plans: [plan(aId, [edited], ids.plan_id, d(1))] }), "revision 2");

  await signIn(page, RESEARCHER.email);
  await page.goto(`${APP_ORIGIN}/app/cycles/${cycleId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page.locator(".app-cv-status-line")).toHaveText("Active · day 5 of 25");
  await expect(page.getByTestId("cycle-meta")).toHaveText(
    `${formatDate(d(-4))} – ${formatDate(d(20))} · ${NOON} · Goal: Sleep quality · Baseline: not set`,
  );

  const lane = page.getByTestId("cycle-lane");
  await expect(lane.locator(".app-cv-lane-name")).toHaveText(`${A} every 2 days · 20:00`);
  // The phase's bar is cut where the time changes, each piece titled with the time in force; one dose caption.
  const bars = lane.locator(".app-cv-bar");
  await expect(bars).toHaveCount(2);
  expect(await bars.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("title")))).toEqual([
    "0.4 mg · every 2 days · 20:00",
    "0.4 mg · every 2 days · 07:15",
  ]);
  await expect(lane.locator(".app-cv-cap")).toHaveText(["0.4 mg"]);
  const dots = lane.getByRole("img");
  // Earlier doses stay at 20:00; from tomorrow the time is 07:15 on the same every-2-days days.
  await expect(dots).toHaveCount(13);
  const labels = await dots.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  expect(labels.slice(0, 6)).toEqual([
    `${A} · ${when(-4, "20:00")} · Unconfirmed`,
    `${A} · ${when(-2, "20:00")} · Unconfirmed`,
    `${A} · ${when(0, "20:00")} · Due`,
    `${A} · ${when(2, "07:15")} · Planned`,
    `${A} · ${when(4, "07:15")} · Planned`,
    `${A} · ${when(6, "07:15")} · Planned`,
  ]);
  await expect(page.locator(".app-cv-today-label")).toHaveText("Today");
  await expect(page.locator(".app-cv-legend")).toHaveText("ActualDue todayPlannedUnconfirmed");

  const card = page.getByTestId("cycle-plan-card");
  await expect(card.locator("h2")).toHaveText(A);
  await expect(card.locator(".app-cv-phase-word")).toHaveText(["Now"]);
  await expect(card.locator(".app-cv-phase-text")).toHaveText(
    `0.4 mg · every 2 days · 20:00${formatMonthDay(d(-4))} – ${formatDate(d(20))} · from ${formatMonthDay(d(1))}: 07:15`,
  );
  await expect(card.locator("[data-slot=saved-mixture]")).toHaveText("No saved mixture — units can't be shown for this peptide. Set one up");
  await expect(card.locator(".app-cv-guidance")).toHaveText(`SUPPLIED GUIDANCE · ADMIN${`Cycle-off guidance for ${A}`}`);

  const rows = page.getByTestId("history-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText(`Planned${when(0, "20:00")}`);
  // S12: an unconfirmed or due dose links to its sheet on Today.
  await expect(rows.nth(0).locator(".app-cv-history-state")).toHaveText("DueConfirm");
  await expect(rows.nth(2).locator(".app-cv-history-state")).toHaveText("UnconfirmedConfirm");
  const confirmLink = rows.nth(2).getByRole("link", { name: "Confirm" });
  await expect(confirmLink).toHaveAttribute("href", /^\/app\/today\?dose=[0-9a-f-]{36}%3A[0-9a-f-]{36}%3A\d+$/);

  await page.getByRole("link", { name: "Edit future plan" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles/${cycleId}/edit`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Edit future plan");

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
    adminDb.rpc("save_cycle_template", {
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
  const search = await hydrated(page.getByLabel("Search library"));
  await search.fill(t);
  const peptides = page.getByTestId("library-peptide");
  await expect(peptides.locator(".app-rl-peptide-name")).toHaveText([A]);
  await expect(peptides.locator(".app-rl-peptide-sub")).toHaveText(["Information · cycling-off guidance"]);
  await search.fill(W);
  await expect(peptides).toHaveCount(0);
  await expect(page.getByText(`No peptides match “${W}”.`)).toBeVisible();
  // The template still matches by the withdrawn peptide's name, and says so.
  const card = page.getByTestId("library-template");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(`${templateName}40 days${A} · 1 phase + ${W} · 1 phase`);
  await expect(card.locator(".app-rl-template-warning")).toHaveText("Includes a peptide no longer offered for new cycles.");

  // The withdrawn entry's own page isn't browsable; the available one is.
  await page.goto(`${APP_ORIGIN}/app/library/peptides/${wId}`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await page.goto(`${APP_ORIGIN}/app/library/peptides/${aId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(A);
  await expect(page.locator(".app-rl-section p").nth(1)).toHaveText("Four weeks off.");
  await expect(page.locator(".app-rl-used")).toHaveText("Not used in any of your cycles.");
  await expect(page.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]')).toHaveText("Library");

  await page.goto(`${APP_ORIGIN}/app/library/templates/${templateId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(templateName);
  await expect(page.locator(".app-rl-kicker")).toHaveText("Template · 40 days");
  const plans = page.getByTestId("template-plan");
  await expect(plans.locator(".app-rl-plan-name")).toHaveText([A, W]);
  await expect(plans.nth(1).locator(".app-rl-withdrawn")).toHaveText("No longer offered for new cycles.");
  await expect(plans.nth(0).locator(".app-rl-withdrawn")).toHaveCount(0);
  await expect(plans.nth(0).locator(".app-rl-phase")).toHaveText(["Day 1–290.4 mg · every 5 days · 20:00", "Day 30–36Break"]);
  await expect(plans.nth(1).locator(".app-rl-phase")).toHaveText(["Day 1–400.3 mg · Mon/Wed/Fri · 07:30"]);
  await expect(page.locator(".app-rl-guidance p")).toHaveText(`Guidance for ${templateName}`);

  await (await hydrated(page.getByRole("link", { name: "Use as starting point" }))).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles/new?template=${templateId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New cycle");
  const withdrawn = page.getByTestId("cycle-plan").filter({ hasText: W });
  await expect(withdrawn.locator(".app-cyc-withdrawn")).toHaveText("No longer offered for new cycles.");
  await expect(page.getByTestId("cycle-plan").filter({ hasText: A })).toBeVisible();
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
  // The timeline keeps its 720px lanes and scrolls sideways inside its own box.
  const timeline = page.getByTestId("cycle-timeline");
  expect(await timeline.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  const rows = page.getByTestId("history-row");
  await expect(rows.first()).toBeVisible();
  // Two columns per history row on phone: the state sits below "Planned".
  const [planned, state] = [await rows.first().locator("span").first().boundingBox(), await rows.first().locator(".app-cv-history-state").boundingBox()];
  expect(state!.y).toBeGreaterThan(planned!.y);

  await page.goto(`${APP_ORIGIN}/app/library`);
  await expect(page.getByLabel("Search library")).toBeVisible();
  expect(await noSideScroll()).toBe(true);
});
