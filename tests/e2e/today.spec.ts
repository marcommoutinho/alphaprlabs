// S12 R1 Today and the log sheet (R5, design v3's R2 / R2b), against the real local
// Supabase. The server's clock is the real one, so cycles use a fixed-offset
// zone where it is about 12:00 now (08:00 and 09:00 doses today are due) and
// dates relative to today there. navigator.setAppBadge is stubbed to record
// the counts the app sets. Each test has its own researcher.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { DOSE_CHANGED, STALE_LINK, TIME_FUTURE } from "../../src/lib/doses/rules";
import { shortDate as formatShortDate } from "../../src/lib/alpha/format";
import { d, noonZoneInstant } from "../support/noon";
import { hydrated, ok, serviceClient, signedInClient, signInAs } from "../support/local-supabase";
import { seedToday } from "../support/today";

declare global {
  interface Window {
    __badges?: number[];
  }
}

/**
 * A researcher with one cycle: A every 2 days at 08:00 from two days ago
 * (0.4 mg, a saved 10 mg / 2 mL mixture: 8 units) and B every day at 09:00
 * from yesterday (1 mg, no mixture). Due now: A and B today; unconfirmed: A
 * two days ago, B yesterday.
 */
async function seed(label: string) {
  const seeded = await seedToday(`s12-${label}`);
  const { email } = seeded;
  const [{ id: mixtureId, peptide_id: peptideId }] = await ok(seeded.db.from("mixtures").select("id, peptide_id"), "mixture");
  const [{ id: planA }] = await ok(seeded.db.from("cycle_plans").select("id").eq("cycle_id", seeded.cycleId).eq("peptide_id", peptideId), "plan A");
  const setup = { p_peptide_id: peptideId, p_vial_mg: "10", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [planA] };
  /** Another session changes A's mixture to 10 mg / `liquidMl` mL. */
  const changeMixture = async (liquidMl: string) => {
    const elsewhere = await signedInClient(email);
    const [{ version }] = await ok(elsewhere.from("mixtures").select("version").eq("id", mixtureId), "mixture version");
    await ok(elsewhere.rpc("save_mixture", { ...setup, p_liquid_ml: liquidMl, p_mixture_id: mixtureId, p_version: version }), "mixture change");
  };
  return { ...seeded, changeMixture };
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
  await expect(hero).toContainText("Due now");
  await expect(hero).toContainText("8:00 AM");
  await expect(hero.getByTestId("hero-name")).toHaveText(A);
  await expect(hero.getByTestId("hero-units")).toHaveText("8");
  await expect(hero).toContainText("0.08 mL");
  await expect(hero).toContainText("100-unit syringe");
  // Today's doses on the day rail, unconfirmed doses newest first, then each plan's next dose.
  const today = page.locator('[data-testid="today-row"][data-kind="today"]');
  await expect(today.getByTestId("today-row-title")).toHaveText([new RegExp(`^${A} `), new RegExp(`^${B} `)]);
  await expect(page.getByTestId("today-overdue")).toContainText([`${B} · 1 mgNot logged`, `${A} · 400 mcgNot logged`]);
  await expect(page.locator('[data-testid="today-row"][data-kind="next"]').getByTestId("today-row-title")).toHaveText([
    new RegExp(`^${B} `),
    new RegExp(`^${A} `),
  ]);
  await expect(page.getByTestId("today-overdue-count")).toHaveText("2 overdue");
  // Two due today, two unconfirmed.
  await expect.poll(() => lastBadge(page)).toBe(4);

  await (await hydrated(hero.getByRole("button", { name: "Taken", exact: true }))).click();
  await expect(page.getByRole("status").filter({ hasText: `${A} · 400 mcg logged at ` })).toBeVisible();
  await expect.poll(() => lastBadge(page)).toBe(3);
  // B's 09:00 dose leads now, in mg (no saved mixture); A's shows as taken today, at the suggested site.
  await expect(hero.getByTestId("hero-name")).toHaveText(B);
  await expect(hero.getByTestId("hero-mg")).toHaveText("1 mg");
  await expect(today.filter({ hasText: A }).getByTestId("today-row-status")).toHaveText(/^Taken \d{1,2}:\d\d [AP]M · Abdomen L$/);

  const recorded = await doses(cycleId);
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({ amount_mg: "0.4", site: "Abdomen L", notes: "" });
  expect(Math.abs(Date.parse(recorded[0].actual_at) - Date.parse(recorded[0].recorded_at))).toBeLessThan(1000);

  // One more tap confirms B's dose today, at the next site in the rotation: nothing left due today.
  await (await hydrated(hero.getByRole("button", { name: "Taken", exact: true }))).click();
  await expect(page.getByTestId("today-quiet")).toContainText("All done for today");
  await expect.poll(() => lastBadge(page)).toBe(2);
  const both = await doses(cycleId);
  expect(both).toHaveLength(2);
  expect(both.map((dose) => dose.site).sort()).toEqual(["Abdomen L", "Abdomen R"]);

  // Opening the app on another screen reads the count too (BadgeSync), with a
  // plain GET: no Server Action, which would hold up a navigation made meanwhile.
  const actions: string[] = [];
  page.on("request", (request) => {
    if (request.headers()["next-action"]) actions.push(request.url());
  });
  await page.goto(`${APP_ORIGIN}/app/cycles`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cycles");
  await expect.poll(() => lastBadge(page)).toBe(2);
  expect(actions).toEqual([]);
});

test("the sheet records an earlier time, the amount, a site and notes", async ({ page }) => {
  const { email, A, cycleId } = await seed("sheet");
  await stubBadge(page);
  await signIn(page, email);
  await expect.poll(() => lastBadge(page)).toBe(4);

  const row = page.getByTestId("today-overdue").filter({ hasText: A });
  await (await hydrated(row.getByRole("button", { name: "Log" }))).click();
  const sheet = page.getByRole("dialog", { name: A });
  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText(A);
  // R2b: Earlier is chosen, at the planned date and time.
  const date = sheet.getByLabel("Date");
  const time = sheet.getByLabel("Time", { exact: true });
  await expect(date).toHaveValue(d(-2));
  await expect(time).toHaveValue("08:00");
  // The mixture was saved today: at the planned time there was none, so no units for that time.
  await expect(sheet.getByTestId("sheet-units")).toHaveText("no saved mixture");
  // Now: the current mixture's units.
  await sheet.getByRole("button", { name: /^Now · / }).click();
  await expect(sheet.getByTestId("sheet-units")).toHaveText("= 8 units");

  await sheet.getByRole("button", { name: "Change the amount taken" }).click();
  const amount = sheet.getByLabel(/^Amount taken \(mcg\)/);
  await expect(amount).toHaveValue("400");
  await amount.fill("350");
  await expect(sheet.getByTestId("sheet-units")).toHaveText("= 7 units · not on a line");
  await amount.fill("300");
  await expect(sheet.getByTestId("sheet-units")).toHaveText("= 6 units");
  await sheet.getByRole("button", { name: "Earlier…" }).click();
  await expect(date).toHaveValue(d(-2));
  // A future time is refused before anything is sent.
  await date.fill(d(1));
  await sheet.getByRole("button", { name: "Log at 8:00 AM" }).click();
  await expect(sheet.getByRole("alert")).toHaveText(TIME_FUTURE);
  expect(await doses(cycleId)).toEqual([]);

  await date.fill(d(-2));
  await time.fill("07:40");
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  // Two days ago there was no mixture: no units for that time.
  await expect(sheet.getByTestId("sheet-units")).toHaveText("no saved mixture");
  await expect(sheet).toContainText("You're recording this 2 days after it happened.");
  // A's next dose (today 08:00) is already due, so this entry doesn't move it.
  await expect(sheet).toContainText(`Later ${A} doses that are already due keep their times`);
  await sheet.getByRole("button", { name: /^Injection site/ }).click();
  await sheet.getByRole("button", { name: "Thigh L" }).click();
  await expect(sheet.getByRole("button", { name: "Thigh L" })).toHaveAttribute("aria-pressed", "true");
  await sheet.getByLabel("Note").fill("Mild redness");
  await sheet.getByRole("button", { name: "Log at 7:40 AM" }).click();

  await expect(sheet).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: `${A} · 300 mcg logged at 7:40 AM` })).toBeVisible();
  await expect.poll(() => lastBadge(page)).toBe(3);
  await expect(page.getByTestId("today-overdue").filter({ hasText: A })).toHaveCount(0);

  const recorded = await doses(cycleId);
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({ amount_mg: "0.3", site: "Thigh L", notes: "Mild redness" });
  expect(Date.parse(recorded[0].actual_at)).toBe(Date.parse(noonZoneInstant(d(-2), "07:40")));
  expect(Date.parse(recorded[0].recorded_at)).toBeGreaterThan(Date.parse(recorded[0].actual_at));

  // The cycle's history (D2's table) shows what was recorded: the amount taken, the plan quietly, the site and notes.
  await page.goto(`${APP_ORIGIN}/app/cycles/${cycleId}`);
  const taken = page.getByTestId("history-table-row").filter({ hasText: "Thigh L" });
  await expect(taken).toHaveAttribute("data-state", "taken");
  await expect(taken.getByRole("cell")).toHaveText(["Taken", `${formatShortDate(d(-2))} · 7:40 AM`, A, "300 mcg (planned 400 mcg)", "Thigh L", "Mild redness"]);
});

test("a Taken from a screen whose mixture changed elsewhere is refused and shows the current units", async ({ page }) => {
  const { email, A, cycleId, changeMixture } = await seed("stale");
  await signIn(page, email);
  const hero = page.getByTestId("today-hero");
  await expect(hero.getByTestId("hero-units")).toHaveText("8");

  // Another session changes the setup to 10 mg / 4 mL: 0.4 mg is now 16 units.
  await changeMixture("4");
  await (await hydrated(hero.getByRole("button", { name: "Taken", exact: true }))).click();
  const sheet = page.getByRole("dialog", { name: A });
  await expect(sheet).toContainText(DOSE_CHANGED);
  await expect(sheet.getByTestId("sheet-units")).toHaveText("= 16 units");
  await expect(hero.getByTestId("hero-units")).toHaveText("16");
  expect(await doses(cycleId)).toEqual([]);

  await sheet.getByRole("button", { name: "Taken · 400 mcg" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: `${A} · 400 mcg logged at ` })).toBeVisible();
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
  const sheet = page.getByRole("dialog", { name: B });
  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText(B);
  await expect(sheet).toContainText("Not logged");
  expect(await noSideScroll()).toBe(true);
  const sheetBox = await sheet.boundingBox();
  expect(sheetBox!.width).toBeLessThanOrEqual(390);
  await (await hydrated(sheet.getByRole("button", { name: "Close" }))).click();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);

  // A key that isn't in the plan (an edit replaced it): a notice, no sheet.
  await page.goto(`${APP_ORIGIN}/app/today?dose=${encodeURIComponent(`${phaseB[0].plan_id}:${phaseB[0].phase_id}:${d(-5)}`)}`);
  await expect(page.getByRole("status").filter({ hasText: STALE_LINK })).toBeVisible();
  await expect(sheet).toBeHidden();
});
