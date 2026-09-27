// S12 R1 Today and the R5 confirmation sheet, against the real local
// Supabase. The server's clock is the real one, so cycles use a fixed-offset
// zone where it is about 12:00 now (08:00 and 09:00 doses today are due) and
// dates relative to today there. navigator.setAppBadge is stubbed to record
// the counts the app sets. Each test has its own researcher.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { DOSE_CHANGED, STALE_LINK, TIME_FUTURE } from "../../src/lib/doses/rules";
import { createCycle, interval, plan, tag, weekdays } from "../support/cycles";
import { d, NOON, noonZoneInstant } from "../support/noon";
import { ensureAccount, hydrated, ok, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";

declare global {
  interface Window {
    __badges?: number[];
  }
}

async function seedPeptide(name: string) {
  const { data, error } = await serviceClient()
    .from("peptides")
    .insert({ name, information: `[Supplied information for ${name}]`, available: true })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not seed ${name}: ${error?.message ?? "no row"}`);
  return data.id;
}

/**
 * A researcher with one cycle: A every 2 days at 08:00 from two days ago
 * (0.4 mg, a saved 10 mg / 2 mL mixture: 8 units) and B every day at 09:00
 * from yesterday (1 mg, no mixture). Due now: A and B today; unconfirmed: A
 * two days ago, B yesterday.
 */
async function seed(label: string) {
  const t = tag();
  const email = uniqueEmail(`s12-today-${label}`);
  await ensureAccount({ email, name: `Today ${label}`, role: "researcher" });
  const [A, B] = [`Today A ${t}`, `Today B ${t}`];
  const [aId, bId] = [await seedPeptide(A), await seedPeptide(B)];
  const db = await signedInClient(email);
  const cycleId = await createCycle(db, {
    name: `Today cycle ${t}`,
    timeZone: NOON,
    plans: [plan(aId, [interval(d(-2), d(20), "0.4", 2, "08:00")]), plan(bId, [weekdays(d(-1), d(20), [0, 1, 2, 3, 4, 5, 6], "1", "09:00")])],
  });
  const plans = await ok(db.from("cycle_plans").select("id, peptide_id").eq("cycle_id", cycleId), "plans");
  const planA = plans.find((p) => p.peptide_id === aId)!.id;
  const setup = { p_peptide_id: aId, p_vial_mg: "10", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [planA] };
  const mixtureId = (await ok(db.rpc("save_mixture", { ...setup, p_liquid_ml: "2" }), "mixture"))!;
  /** Another session changes A's mixture to 10 mg / `liquidMl` mL. */
  const changeMixture = async (liquidMl: string) => {
    const elsewhere = await signedInClient(email);
    const [{ version }] = await ok(elsewhere.from("mixtures").select("version").eq("id", mixtureId), "mixture version");
    await ok(elsewhere.rpc("save_mixture", { ...setup, p_liquid_ml: liquidMl, p_mixture_id: mixtureId, p_version: version }), "mixture change");
  };
  return { email, A, B, cycleId, changeMixture };
}

/** Records every badge the app sets (0 for a cleared badge). */
async function stubBadge(page: Page) {
  await page.addInitScript(() => {
    window.__badges = [];
    const nav = Navigator.prototype as unknown as Record<string, unknown>;
    nav.setAppBadge = (count?: number) => {
      window.__badges!.push(count ?? 0);
      return Promise.resolve();
    };
    nav.clearAppBadge = () => {
      window.__badges!.push(0);
      return Promise.resolve();
    };
  });
}
const lastBadge = (page: Page) => page.evaluate(() => window.__badges?.at(-1) ?? null);

async function signIn(page: Page, email: string) {
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
}

const doses = (cycleId: string) =>
  ok(
    serviceClient().from("dose_records").select("occurrence_key, amount_mg::text, actual_at, recorded_at, site, notes, request_key").eq("cycle_id", cycleId),
    "dose records",
  );

test("Today confirms the due dose in one tap and the badge follows", async ({ page }) => {
  const { email, A, B, cycleId } = await seed("tap");
  await stubBadge(page);
  await signIn(page, email);

  const hero = page.getByTestId("today-hero");
  await expect(hero).toContainText(`Due · 08:00`);
  await expect(hero.locator(".app-today-hero-name")).toHaveText(A);
  await expect(hero.getByTestId("hero-units")).toHaveText("8");
  await expect(hero).toContainText("0.4 mg · 0.08 mL · from your 10 mg / 2 mL mixture · 1 mL syringe");
  const rows = page.getByTestId("today-row");
  // Today's other dose, unconfirmed doses newest first, then each plan's next dose.
  await expect(rows.locator(".app-today-row-title")).toHaveText([B, `Unconfirmed · ${B}`, `Unconfirmed · ${A}`, B, A]);
  // Two due today, two unconfirmed.
  await expect.poll(() => lastBadge(page)).toBe(4);

  await (await hydrated(hero.getByRole("button", { name: "Taken", exact: true }))).click();
  await expect(page.getByRole("status").filter({ hasText: `Taken · ${A} · ` })).toBeVisible();
  await expect.poll(() => lastBadge(page)).toBe(3);
  // B's 09:00 dose leads now, in mg (no saved mixture); A's shows as taken today.
  await expect(hero.locator(".app-today-hero-name")).toHaveText(B);
  await expect(hero.getByTestId("hero-mg")).toHaveText("1 mg");
  // The amount taken (here the planned one), not a bare time.
  await expect(rows.filter({ hasText: A }).first().locator(".app-today-row-status")).toHaveText(/^Taken \d\d:\d\d · 0\.4 mg$/);

  const recorded = await doses(cycleId);
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({ amount_mg: "0.4", site: "", notes: "" });
  expect(Math.abs(Date.parse(recorded[0].actual_at) - Date.parse(recorded[0].recorded_at))).toBeLessThan(1000);

  // One more tap confirms B's dose today: nothing left due today.
  await (await hydrated(hero.getByRole("button", { name: "Taken", exact: true }))).click();
  await expect(page.getByTestId("today-quiet")).toContainText("All done for today");
  await expect.poll(() => lastBadge(page)).toBe(2);
  expect(await doses(cycleId)).toHaveLength(2);
});

test("the sheet records an earlier time, the amount, a site and notes", async ({ page }) => {
  const { email, A, cycleId } = await seed("sheet");
  await stubBadge(page);
  await signIn(page, email);
  await expect.poll(() => lastBadge(page)).toBe(4);

  const row = page.getByTestId("today-row").filter({ hasText: `Unconfirmed · ${A}` });
  await (await hydrated(row.getByRole("button", { name: "Confirm" }))).click();
  const sheet = page.getByRole("dialog", { name: "Confirm administration" });
  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText(A);
  await expect(sheet.getByTestId("sheet-units")).toHaveText("= 8 units");

  const amount = sheet.getByLabel(/^Amount taken \(mg\)/);
  await amount.fill("0.35");
  await expect(sheet.getByTestId("sheet-units")).toHaveText("= 7 units · not on a line");
  await amount.fill("0.3");
  await expect(sheet.getByTestId("sheet-units")).toHaveText("= 6 units");
  const time = sheet.getByLabel("When you actually took it");
  // A future time is refused before anything is sent.
  await time.fill(`${d(1)}T08:00`);
  await sheet.getByRole("button", { name: "Mark Taken" }).click();
  await expect(sheet.getByRole("alert")).toHaveText(TIME_FUTURE);
  expect(await doses(cycleId)).toEqual([]);

  await time.fill(`${d(-2)}T07:40`);
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  // The mixture was saved today: two days ago there was none, so no units for that time.
  await expect(sheet.getByTestId("sheet-units")).toHaveText("no saved mixture");
  await expect(sheet).toContainText("You're recording this 2 days after it happened.");
  // A's next dose (today 08:00) is already due, so this entry doesn't move it.
  await expect(sheet).toContainText(`Later ${A} doses that are already due keep their times`);
  await sheet.getByRole("button", { name: /Site and notes/ }).click();
  await sheet.getByRole("button", { name: "Thigh L" }).click();
  await expect(sheet.getByRole("button", { name: "Thigh L" })).toHaveAttribute("aria-pressed", "true");
  await sheet.getByLabel("Observations · optional").fill("Mild redness");
  await sheet.getByRole("button", { name: "Mark Taken" }).click();

  await expect(sheet).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: `Taken · ${A} · ` })).toContainText("07:40");
  await expect.poll(() => lastBadge(page)).toBe(3);
  await expect(page.getByTestId("today-row").filter({ hasText: `Unconfirmed · ${A}` })).toHaveCount(0);

  const recorded = await doses(cycleId);
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({ amount_mg: "0.3", site: "Thigh L", notes: "Mild redness" });
  expect(Date.parse(recorded[0].actual_at)).toBe(Date.parse(noonZoneInstant(d(-2), "07:40")));
  expect(Date.parse(recorded[0].recorded_at)).toBeGreaterThan(Date.parse(recorded[0].actual_at));

  // R4 history shows what was recorded: the amount taken, the plan quietly, the site and notes.
  await page.goto(`${APP_ORIGIN}/app/cycles/${cycleId}`);
  const taken = page.getByTestId("history-row").filter({ hasText: "Thigh L" });
  await expect(taken).toContainText(`${A} · 0.3 mg (planned 0.4 mg)`);
  await expect(taken.getByTestId("history-details")).toHaveText("Thigh L · Mild redness");
  await expect(taken.locator(".app-cv-history-state")).toHaveText("Taken");
});

test("a Taken from a screen whose mixture changed elsewhere is refused and shows the current units", async ({ page }) => {
  const { email, A, cycleId, changeMixture } = await seed("stale");
  await signIn(page, email);
  const hero = page.getByTestId("today-hero");
  await expect(hero.getByTestId("hero-units")).toHaveText("8");

  // Another session changes the setup to 10 mg / 4 mL: 0.4 mg is now 16 units.
  await changeMixture("4");
  await (await hydrated(hero.getByRole("button", { name: "Taken", exact: true }))).click();
  const sheet = page.getByRole("dialog", { name: "Confirm administration" });
  await expect(sheet).toContainText(DOSE_CHANGED);
  await expect(sheet.getByTestId("sheet-units")).toHaveText("= 16 units");
  await expect(hero.getByTestId("hero-units")).toHaveText("16");
  expect(await doses(cycleId)).toEqual([]);

  await sheet.getByRole("button", { name: "Mark Taken" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: `Taken · ${A} · ` })).toBeVisible();
  expect(await doses(cycleId)).toHaveLength(1);
});

test("a reminder link opens its dose on a phone; an out-of-date one says so", async ({ page }) => {
  const { email, B, cycleId } = await seed("link");
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, email);
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noSideScroll()).toBe(true);
  // The one-tap Taken is a comfortable target on a phone.
  const taken = await page.getByTestId("today-hero").getByRole("button", { name: "Taken", exact: true }).boundingBox();
  expect(taken!.height).toBeGreaterThanOrEqual(44);

  // The notification URL contract (sw.js): /app/today?dose=<occurrence key>.
  const planB = (await ok(serviceClient().from("cycle_plans").select("id").eq("cycle_id", cycleId), "plans")).map((p) => p.id);
  const phaseB = await ok(serviceClient().from("cycle_revision_phases").select("plan_id, phase_id").in("plan_id", planB).eq("schedule_type", "weekdays"), "phase");
  const key = `${phaseB[0].plan_id}:${phaseB[0].phase_id}:${d(-1)}`;
  await page.goto(`${APP_ORIGIN}/app/today?dose=${encodeURIComponent(key)}`);
  const sheet = page.getByRole("dialog", { name: "Confirm administration" });
  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText(B);
  await expect(sheet).toContainText("Unconfirmed");
  expect(await noSideScroll()).toBe(true);
  const sheetBox = await sheet.boundingBox();
  expect(sheetBox!.width).toBeLessThanOrEqual(390);
  await (await hydrated(sheet.getByRole("button", { name: "Cancel" }))).click();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);

  // A key that isn't in the plan (an edit replaced it): a notice, no sheet.
  await page.goto(`${APP_ORIGIN}/app/today?dose=${encodeURIComponent(`${phaseB[0].plan_id}:${phaseB[0].phase_id}:${d(-5)}`)}`);
  await expect(page.getByRole("status").filter({ hasText: STALE_LINK })).toBeVisible();
  await expect(sheet).toBeHidden();
});
