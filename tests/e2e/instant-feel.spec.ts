// N1 "Instant feel" on a phone: a tab tap answers on the next frame (the tab
// active and its route's skeleton, before the server has sent the page), the
// installed app opens straight on Today (no redirect hop), and a one-tap
// Taken on Today shows at once, while its save is still on the way, and is
// taken back if the save fails; a replayed save shows what the server
// recorded, and several refusals in a row each keep their message (a refused
// dose no longer on Today says so in the toast). A tab visited a moment ago
// is asked for again (no client cache of private pages), and so is a page
// Back returns to.
import { expect, test, type Page, type Request } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { clock12 } from "../../src/lib/alpha/format";
import { SAVE_FAILED_MESSAGE } from "../../src/lib/app/save";
import { DOSE_ALREADY_TAKEN, DOSE_CHANGED, wallOf } from "../../src/lib/doses/rules";
import { hydrated, ok, serviceClient, signedInClient, signInAs } from "../support/local-supabase";
import { NOON } from "../support/noon";
import { shot } from "../support/shots";
import { holdAction, loseAnswer, stallRefresh } from "../support/stall-refresh";
import { seedPeptide, seedToday } from "../support/today";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const tab = (page: Page, label: string) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: new RegExp(`^${label}( \\d+)?$`) });

async function signIn(page: Page, email: string) {
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect(heading(page)).toHaveText("Today");
}

/** Every page request (RSC) to `pathname` waits for release(): a server slow to answer a navigation. */
async function holdPage(page: Page, pathname: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let held = 0;
  await page.route(
    (url) => url.pathname === pathname,
    async (route) => {
      const headers = await route.request().allHeaders();
      if (!headers["rsc"] || route.request().method() !== "GET") return route.fallback();
      held += 1;
      await released;
      await route.fallback();
    },
  );
  return { release, held: () => held };
}

function hops(request: Request | null | undefined) {
  let count = 0;
  for (let from = request?.redirectedFrom(); from; from = from.redirectedFrom()) count += 1;
  return count;
}

test("a tab tap shows the tab active and its skeleton before the server answers", async ({ page }) => {
  const { email } = await seedToday("instant-tab");
  await signIn(page, email);
  const cycles = await holdPage(page, "/app/cycles");

  await (await hydrated(tab(page, "Cycles"))).tap();
  // Straight away, with the page still on its way: Cycles is the active tab, and its skeleton replaces Today.
  await expect(tab(page, "Cycles")).toHaveAttribute("aria-current", "page");
  await expect(tab(page, "Today")).not.toHaveAttribute("aria-current", "page");
  await expect(page.locator("main [data-slot=skeleton]").first()).toBeVisible();
  await expect(page.getByTestId("today-hero")).toBeHidden();
  expect(cycles.held()).toBe(1);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await shot(page, "n1-tab-skeleton");

  cycles.release();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles`);
  await expect(heading(page)).toHaveText("Cycles");
  await expect(page.locator("main [data-slot=skeleton]")).toHaveCount(0);
  await expect(tab(page, "Cycles")).toHaveAttribute("aria-current", "page");

  // Back on Today: the tab, then Today itself.
  await (await hydrated(tab(page, "Today"))).tap();
  await expect(tab(page, "Today")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("today-hero")).toBeVisible();
});

test("the installed app opens on Today with no redirect, or at sign-in when signed out", async ({ page }) => {
  // Signed out: the manifest's start_url asks for sign-in, then comes back to Today.
  const out = await page.goto(`${APP_ORIGIN}/app/today`);
  expect(hops(out?.request())).toBe(1);
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth?next=%2Fapp%2Ftoday`);

  const { email } = await seedToday("instant-launch");
  await signIn(page, email);
  const launch = await page.goto(`${APP_ORIGIN}/app/today`);
  expect(launch?.status()).toBe(200);
  expect(hops(launch?.request())).toBe(0);
  await expect(heading(page)).toHaveText("Today");
  await expect(page.getByTestId("today-hero")).toBeVisible();
  // An older home-screen icon (start_url "/") lands on Today in one hop, as does /app.
  for (const from of ["/", "/app"]) {
    const old = await page.goto(`${APP_ORIGIN}${from}`);
    expect(hops(old?.request()), from).toBe(1);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await expect(heading(page)).toHaveText("Today");
  }
});

test("a one-tap Taken shows at once, and is taken back when the save fails", async ({ page }) => {
  const { email, A } = await seedToday("instant-taken");
  await signIn(page, email);
  const hero = page.getByTestId("today-hero");
  const rowA = page.locator('[data-testid="today-row"][data-kind="today"]').filter({ hasText: A }).getByTestId("today-row-status");
  await expect(hero.getByTestId("hero-name")).toHaveText(A);

  // The save reaches the server, its answer is held: the tick shows before it.
  const held = await holdAction(page, "/app/today");
  await (await hydrated(hero.getByRole("button", { name: "Taken", exact: true }))).tap();
  await expect(hero.getByTestId("hero-taken")).toHaveText("Taken");
  await expect(rowA).toHaveText(/^Taken \d{1,2}:\d\d [AP]M · Abdomen L$/);
  await expect(page.getByRole("status").filter({ hasText: `${A} · 400 mcg logged at ` })).toHaveCount(0);
  await expect.poll(() => held.counts.actions).toBe(1);
  held.release();
  // The server confirms: the Undo toast, and the Now block moves on to B.
  await expect(page.getByRole("status").filter({ hasText: `${A} · 400 mcg logged at ` })).toBeVisible();
  await expect(hero.getByTestId("hero-name")).not.toHaveText(A);
  await expect(rowA).toHaveText(/^Taken \d{1,2}:\d\d [AP]M · Abdomen L$/);
  await page.unrouteAll({ behavior: "wait" });

  // A save that fails (the connection drops): the tick shows, then goes, with the usual message.
  const B = await hero.getByTestId("hero-name").textContent();
  const rowB = page.locator('[data-testid="today-row"][data-kind="today"]').filter({ hasText: B! }).getByTestId("today-row-status");
  const before = await rowB.textContent();
  let release!: () => void;
  const failing = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === "/app/today",
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await failing;
      await route.abort("connectionreset");
    },
  );
  await (await hydrated(hero.getByRole("button", { name: "Taken", exact: true }))).tap();
  await expect(hero.getByTestId("hero-taken")).toBeVisible();
  await expect(rowB).toHaveText(/^Taken /);
  release();
  await expect(page.getByRole("alert").filter({ hasText: SAVE_FAILED_MESSAGE })).toBeVisible();
  await expect(hero.getByTestId("hero-taken")).toHaveCount(0);
  await expect(hero.getByRole("button", { name: "Taken", exact: true })).toBeEnabled();
  await expect(rowB).toHaveText(before!);
});

test("a tab visited a moment ago is asked for again: a peptide no longer offered is gone from the Library", async ({ page }) => {
  const { email } = await seedToday("instant-revisit");
  const name = `Revisit peptide ${Date.now().toString(36)}`;
  const id = await seedPeptide(name);
  await signIn(page, email);
  const peptide = page.getByTestId("library-peptide").filter({ hasText: name });

  await (await hydrated(tab(page, "Library"))).tap();
  await expect(heading(page)).toHaveText("Library");
  await expect(peptide).toBeVisible();
  await (await hydrated(tab(page, "Today"))).tap();
  await expect(page.getByTestId("today-hero")).toBeVisible();

  // An admin stops offering it; seconds later the Library tab again (a client-side navigation) asks the server and leaves it out.
  await ok(serviceClient().from("peptides").update({ available: false }).eq("id", id), "not offered");
  // 3 s on (within the 30 s asked about): Next.js drops a visited page by the wall clock, which on this
  // machine steps back about 2 s now and then, and would then keep it for that long.
  await page.waitForTimeout(3_000);
  const library = page.waitForRequest((request) => new URL(request.url()).pathname === "/app/library" && Boolean(request.headers()["rsc"]));
  await (await hydrated(tab(page, "Library"))).tap();
  await library;
  await expect(heading(page)).toHaveText("Library");
  await expect(page.getByTestId("library-peptide").first()).toBeVisible();
  await expect(peptide).toHaveCount(0);
});

test("Back to the Library asks the server again: a peptide withdrawn meanwhile is gone", async ({ page }) => {
  const { email } = await seedToday("instant-back");
  const name = `Back peptide ${Date.now().toString(36)}`;
  const id = await seedPeptide(name);
  await signIn(page, email);
  const peptide = page.getByTestId("library-peptide").filter({ hasText: name });

  await (await hydrated(tab(page, "Library"))).tap();
  await expect(heading(page)).toHaveText("Library");
  await expect(peptide).toBeVisible();
  await (await hydrated(tab(page, "Today"))).tap();
  await expect(page.getByTestId("today-hero")).toBeVisible();

  // An admin stops offering it; Back puts the Library up from memory, then asks the server again and leaves it out.
  await ok(serviceClient().from("peptides").update({ available: false }).eq("id", id), "not offered");
  const asked = page.waitForRequest((request) => new URL(request.url()).pathname === "/app/library" && Boolean(request.headers()["rsc"]));
  await page.goBack();
  await asked;
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/library`);
  await expect(heading(page)).toHaveText("Library");
  await expect(peptide).toHaveCount(0);
  await expect(page.getByTestId("library-peptide").first()).toBeVisible();
});

// Mark skipped on an overdue row is a laptop control (a phone logs or skips from the sheet).
test.describe("laptop", () => {
  test.use({ viewport: { width: 1280, height: 820 }, isMobile: false, hasTouch: false });

  test("two refusals in a row each keep their message, and neither dose shows as taken", async ({ context, page }) => {
    test.setTimeout(90_000);
    const { email, A, B } = await seedToday("instant-refused");
    await signIn(page, email);
    const hero = page.getByTestId("today-hero");
    const overdueB = page.getByTestId("today-overdue").filter({ hasText: B });
    const rowA = page.locator('[data-testid="today-row"][data-kind="today"]').filter({ hasText: A }).getByTestId("today-row-status");
    await expect(hero.getByTestId("hero-name")).toHaveText(A);
    await expect(overdueB).toBeVisible();
    const rowABefore = await rowA.textContent();

    // Another tab settles both first: A's dose today and B's from yesterday.
    const other = await context.newPage();
    await other.goto(`${APP_ORIGIN}/app/today`);
    await (await hydrated(other.getByTestId("today-hero").getByRole("button", { name: "Taken", exact: true }))).click();
    await expect(other.getByRole("status").filter({ hasText: `${A} · 400 mcg logged at ` })).toBeVisible();
    await (await hydrated(other.getByTestId("today-overdue").filter({ hasText: B }).getByRole("button", { name: "Log" }))).click();
    const sheet = other.getByRole("dialog", { name: B });
    await sheet.getByRole("button", { name: /^Log at / }).click();
    await expect(sheet).toBeHidden();
    await other.close();

    // This page still shows both open. Taken on A, then Mark skipped on B at once: both refused, and no refreshed page arrives.
    const stall = await stallRefresh(page, "/app/today");
    await (await hydrated(hero.getByRole("button", { name: "Taken", exact: true }))).click();
    await overdueB.getByRole("button", { name: "Mark skipped" }).click();
    await expect.poll(() => stall.actions).toBe(2);

    // Each wait gives up in turn; the toast names both doses and what the server said about each.
    const toast = page.locator('[data-slot="toast"]');
    await expect(toast).toContainText(`${A}: ${DOSE_ALREADY_TAKEN} ${B}: ${DOSE_ALREADY_TAKEN} Couldn't load the latest version.`, { timeout: 45_000 });
    await expect(toast.getByRole("button", { name: "Reload" })).toBeVisible();
    // Neither shows as taken or skipped here: the page is the one from before, as the toast says.
    await expect(hero.getByTestId("hero-taken")).toHaveCount(0);
    await expect(hero.getByRole("button", { name: "Taken", exact: true })).toBeEnabled();
    await expect(rowA).toHaveText(rowABefore!);
    await expect(overdueB).toBeVisible();
    await expect(overdueB.getByRole("button", { name: "Mark skipped" })).toBeEnabled();
  });

  test("a refused dose that left Today says so in the toast, and the next refused dose's sheet still opens", async ({ context, page }) => {
    test.setTimeout(60_000);
    const { email, A, B, db } = await seedToday("instant-dropped");
    await signIn(page, email);
    const hero = page.getByTestId("today-hero");
    const overdueB = page.getByTestId("today-overdue").filter({ hasText: B });
    await expect(hero.getByTestId("hero-name")).toHaveText(A);
    await expect(hero.getByTestId("hero-units")).toHaveText("8");
    await expect(overdueB).toBeVisible();

    // Elsewhere: B's dose from yesterday is logged (it leaves Today), and A's mixture becomes 10 mg / 4 mL (0.4 mg is 16 units).
    const other = await context.newPage();
    await other.goto(`${APP_ORIGIN}/app/today`);
    await (await hydrated(other.getByTestId("today-overdue").filter({ hasText: B }).getByRole("button", { name: "Log" }))).click();
    const otherSheet = other.getByRole("dialog", { name: B });
    await otherSheet.getByRole("button", { name: /^Log at / }).click();
    await expect(otherSheet).toBeHidden();
    await other.close();
    const [{ id: mixtureId, peptide_id: peptideId, version }] = await ok(db.from("mixtures").select("id, peptide_id, version"), "mixture");
    const [{ id: planA }] = await ok(db.from("cycle_plans").select("id").eq("peptide_id", peptideId), "plan A");
    const elsewhere = await signedInClient(email);
    await ok(
      elsewhere.rpc("save_mixture", {
        p_peptide_id: peptideId,
        p_vial_mg: "10",
        p_liquid_ml: "4",
        p_syringe_units: 100,
        p_line_spacing: "2",
        p_plan_ids: [planA],
        p_mixture_id: mixtureId,
        p_version: version,
      }),
      "mixture change",
    );

    // Mark skipped on B, then Taken on A: both refused. Their refreshed page comes once both answers are in.
    const stall = await stallRefresh(page, "/app/today");
    await (await hydrated(overdueB.getByRole("button", { name: "Mark skipped" }))).click();
    await (await hydrated(hero.getByRole("button", { name: "Taken", exact: true }))).click();
    await expect.poll(() => stall.actions).toBe(2);
    stall.release();

    // B is no longer on Today: no sheet for it, the toast says what the server said. A's sheet opens, current.
    await expect(page.locator('[data-slot="toast"]')).toContainText(`${B}: ${DOSE_ALREADY_TAKEN}`);
    const sheet = page.getByRole("dialog", { name: A });
    await expect(sheet).toContainText(DOSE_CHANGED);
    await expect(sheet.getByTestId("sheet-units")).toHaveText("= 16 units");
    await expect(overdueB).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: B })).toHaveCount(0);

    // Nothing stranded: A logs from its sheet, and no other sheet is left waiting.
    await sheet.getByRole("button", { name: "Taken · 400 mcg" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: `${A} · 400 mcg logged at ` })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('[data-slot="toast"]').filter({ hasText: "Couldn't load the latest version." })).toHaveCount(0);
  });
});

test("a Taken whose answer was lost, sent again, shows what the server recorded the first time", async ({ page }) => {
  test.setTimeout(60_000);
  const { email, A, cycleId } = await seedToday("instant-replay");
  await page.clock.install();
  await signIn(page, email);
  const hero = page.getByTestId("today-hero");
  const rowA = page.locator('[data-testid="today-row"][data-kind="today"]').filter({ hasText: A }).getByTestId("today-row-status");

  // The first Taken, from the sheet (300 mcg, Thigh L), is recorded, but its answer never reaches the page.
  await (await hydrated(hero.getByRole("button", { name: "Details" }))).tap();
  const sheet = page.getByRole("dialog", { name: A });
  await sheet.getByRole("button", { name: "Change the amount taken" }).tap();
  await sheet.getByLabel(/^Amount taken \(mcg\)/).fill("300");
  await sheet.getByRole("group", { name: "Injection site" }).getByRole("button", { name: "Thigh L" }).tap();
  await expect(sheet.getByRole("button", { name: "Thigh L" })).toHaveAttribute("aria-pressed", "true");
  const lost = await loseAnswer(page, "/app/today");
  await sheet.getByRole("button", { name: "Taken · 300 mcg" }).tap();
  await expect(page.getByRole("alert").filter({ hasText: SAVE_FAILED_MESSAGE })).toBeVisible();
  expect(lost.actions).toBe(1);
  const records = await ok(serviceClient().from("dose_records").select("actual_at, amount_mg::text, site").eq("cycle_id", cycleId), "records");
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ amount_mg: "0.3", site: "Thigh L" });
  const recorded = clock12(wallOf(records[0].actual_at, NOON).slice(11, 16));
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Five minutes on, a one-tap Taken (the same request, with 400 mcg at Abdomen L): the server replays the first
  // record; its refreshed page never comes.
  await page.clock.fastForward("05:00");
  const stall = await stallRefresh(page, "/app/today");
  await (await hydrated(hero.getByRole("button", { name: "Taken", exact: true }))).tap();
  await expect(page.getByRole("status").filter({ hasText: `${A} · 300 mcg logged at ${recorded}` })).toBeVisible();
  await expect.poll(() => stall.actions).toBe(1);
  // The tick shows what was recorded (time, amount, site), not the retry's.
  await expect(rowA).toHaveText(`Taken ${recorded} · 300 mcg of 400 mcg · Thigh L`);
  expect(await ok(serviceClient().from("dose_records").select("id").eq("cycle_id", cycleId), "records")).toHaveLength(1);
});
