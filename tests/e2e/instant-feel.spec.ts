// N1 "Instant feel" on a phone: a tab tap answers on the next frame (the tab
// active and its route's skeleton, before the server has sent the page), the
// installed app opens straight on Today (no redirect hop), and a one-tap
// Taken on Today shows at once, while its save is still on the way, and is
// taken back if the save fails. staleTimes.dynamic (next.config.ts) keeps a
// visited tab for 30 s: a save still refreshes it.
import { expect, test, type Page, type Request } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { SAVE_FAILED_MESSAGE } from "../../src/lib/app/save";
import { hydrated, signInAs } from "../support/local-supabase";
import { shot } from "../support/shots";
import { holdAction } from "../support/stall-refresh";
import { seedToday } from "../support/today";

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

test("a tab kept for a moment still shows a save made since", async ({ page }) => {
  const { email, A } = await seedToday("instant-stale");
  await signIn(page, email);
  const lane = page.getByTestId("progress-now").getByRole("img", { name: `${A}: 1 dose taken in this range` });

  // Progress, visited a moment ago (kept by staleTimes.dynamic), before the dose is taken…
  await (await hydrated(tab(page, "Progress"))).tap();
  await expect(heading(page)).toHaveText("Progress");
  await expect(page.getByTestId("progress-now").getByRole("img", { name: `${A}: 0 doses taken in this range` })).toBeVisible();
  await (await hydrated(tab(page, "Today"))).tap();
  await expect(page.getByTestId("today-hero")).toBeVisible();
  await (await hydrated(page.getByTestId("today-hero").getByRole("button", { name: "Taken", exact: true }))).tap();
  await expect(page.getByRole("status").filter({ hasText: `${A} · 400 mcg logged at ` })).toBeVisible();

  // …shows it when opened again: the save refreshed every kept page.
  await (await hydrated(tab(page, "Progress"))).tap();
  await expect(heading(page)).toHaveText("Progress");
  await expect(lane).toBeVisible();
});
