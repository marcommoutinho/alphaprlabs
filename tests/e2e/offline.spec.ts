// N1's offline state (the app is online-only: nothing is stored or queued).
// Offline, the offline bar says so and the save controls are disabled up
// front with the reason; a tab tapped offline opens once the connection is
// back; opening the app with no network shows the offline page from the
// service worker, which stores that one page and nothing else.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { OFFLINE_REASON } from "../../src/components/alpha/online";
import { OFFLINE_BAR_TEXT } from "../../src/components/alpha/shell/offline-bar";
import { hydrated, signInAs } from "../support/local-supabase";
import { shot } from "../support/shots";
import { seedToday } from "../support/today";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const tab = (page: Page, label: string) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: new RegExp(`^${label}( \\d+)?$`) });

async function signIn(page: Page, label: string) {
  const seeded = await seedToday(label);
  await signInAs(page, APP_ORIGIN, seeded.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect(heading(page)).toHaveText("Today");
  return seeded;
}

/** The service worker controls the page (it registers for everyone signed in). */
async function controlled(page: Page) {
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null), { timeout: 15_000 }).toBe(`${APP_ORIGIN}/sw.js`);
}

test("offline, the bar says so and Taken waits with the reason; back online, the bar goes and Taken works", async ({ context, page }) => {
  const { A } = await signIn(page, "offline-bar");
  const hero = page.getByTestId("today-hero");
  const taken = hero.getByRole("button", { name: "Taken", exact: true });
  const bar = page.getByTestId("offline-bar");
  await hydrated(taken);
  await expect(bar).toHaveCount(0);

  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: OFFLINE_BAR_TEXT })).toBeVisible();
  await expect(bar).toHaveText(OFFLINE_BAR_TEXT);
  await expect(taken).toBeDisabled();
  await expect(taken).toHaveAttribute("title", OFFLINE_REASON);
  await expect(taken).toHaveAttribute("aria-description", OFFLINE_REASON);
  await expect(taken.getByTestId("offline-glyph")).toBeVisible();
  // Docked on the tab bar.
  const barBox = (await bar.boundingBox())!;
  const tabsBox = (await page.getByRole("navigation", { name: "Main" }).boundingBox())!;
  expect(Math.round(barBox.y + barBox.height)).toBe(Math.round(tabsBox.y));
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await shot(page, `n1-offline-bar-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });

  await context.setOffline(false);
  await expect(bar).toHaveCount(0);
  await expect(taken).toBeEnabled();
  await expect(taken).not.toHaveAttribute("title");
  await taken.tap();
  await expect(page.getByRole("status").filter({ hasText: `${A} · 400 mcg logged at ` })).toBeVisible();
});

test("offline, the calculator's Save mixture and a saved mixture's Delete wait with the reason, and send nothing", async ({ context, page }) => {
  const { A } = await signIn(page, "offline-calc");
  await page.goto(`${APP_ORIGIN}/app/calculator`);
  await expect(heading(page)).toHaveText("Calculator");
  await (await hydrated(page.getByRole("combobox", { name: "Peptide", exact: true }))).selectOption({ label: A });
  await page.getByLabel("Vial strength (mg per vial)").fill("8");
  await page.getByLabel("Liquid added (mL)").fill("2");
  await page.getByLabel("Intended dose (mg) · entered by you").fill("0.25");
  await expect(page.getByTestId("calc-units")).toHaveText("6.25");
  const save = page.getByRole("button", { name: "Save mixture" });
  const remove = page.getByTestId("saved-mixture").filter({ hasText: A }).getByRole("button", { name: "Delete" });
  await expect(save).toBeEnabled();
  await expect(remove).toBeEnabled();
  const actions: string[] = [];
  page.on("request", (request) => {
    if (request.headers()["next-action"]) actions.push(new URL(request.url()).pathname);
  });

  await context.setOffline(true);
  await expect(page.getByTestId("offline-bar")).toBeVisible();
  for (const control of [save, remove]) {
    await expect(control).toBeDisabled();
    await expect(control).toHaveAttribute("aria-description", OFFLINE_REASON);
    await control.click({ force: true });
  }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  expect(actions).toEqual([]);

  await context.setOffline(false);
  await expect(page.getByTestId("offline-bar")).toHaveCount(0);
  await expect(save).toBeEnabled();
  await expect(remove).toBeEnabled();
});

test("a tab tapped offline doesn't leave the page; it opens once the connection is back", async ({ context, page }) => {
  await signIn(page, "offline-tab");
  await hydrated(tab(page, "Cycles"));
  const documents: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) documents.push(frame.url());
  });

  await context.setOffline(true);
  await tab(page, "Cycles").tap();
  await expect(page.getByTestId("offline-bar")).toBeVisible();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect(page.getByTestId("today-hero")).toBeVisible();
  await expect(page.getByTestId("offline-page")).toHaveCount(0);

  await context.setOffline(false);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles`);
  await expect(heading(page)).toHaveText("Cycles");
  await expect(page.getByTestId("offline-bar")).toHaveCount(0);
  // A client-side navigation: the document was never replaced.
  expect(documents.every((url) => !url.endsWith("/offline.html"))).toBe(true);
});

test("a tab tapped offline is dropped by Back: back online, the page stays where the person went", async ({ context, page }) => {
  await signIn(page, "offline-tab-back");
  await (await hydrated(tab(page, "Cycles"))).tap();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles`);
  await expect(heading(page)).toHaveText("Cycles");
  await hydrated(tab(page, "Library"));

  await context.setOffline(true);
  await tab(page, "Library").tap();
  await expect(page.getByTestId("offline-bar")).toBeVisible();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles`);
  await page.goBack();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect(heading(page)).toHaveText("Today");
  const later: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) later.push(frame.url());
  });

  await context.setOffline(false);
  await expect(page.getByTestId("offline-bar")).toHaveCount(0);
  await page.waitForTimeout(1_500); // time enough for a replayed tap to go out
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect(heading(page)).toHaveText("Today");
  expect(later).toEqual([]);
});

test("opening the app with no network shows the offline page; back online, Try again opens Today", async ({ context, page }) => {
  await signIn(page, "offline-launch");
  await controlled(page);

  await context.setOffline(true);
  await page.reload();
  const offline = page.getByTestId("offline-page");
  await expect(offline).toBeVisible();
  await expect(offline.getByRole("heading", { level: 1 })).toHaveText("You're offline");
  await expect(offline).toContainText("Alpha PR Labs needs a connection. Reconnect and try again.");
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect.poll(() => page.evaluate(() => (document.querySelector("main img") as HTMLImageElement | null)?.naturalWidth ?? 0)).toBeGreaterThan(0);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await shot(page, `n1-offline-page-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });

  await context.setOffline(false);
  await offline.getByRole("button", { name: "Try again" }).tap();
  await expect(heading(page)).toHaveText("Today");
  await expect(page.getByTestId("today-hero")).toBeVisible();
});

test("the service worker stores only the offline page, whatever the app opened", async ({ page }) => {
  await signIn(page, "offline-cache");
  await controlled(page);
  for (const label of ["Cycles", "Library", "Today"]) {
    await (await hydrated(tab(page, label))).tap();
    // The URL too: the tapped tab's skeleton already shows its heading.
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/${label.toLowerCase()}`);
    await expect(heading(page)).toHaveText(label);
  }
  await page.reload();
  await expect(heading(page)).toHaveText("Today");
  const stored = await page.evaluate(async () => {
    const all: Record<string, string[]> = {};
    for (const name of await caches.keys()) all[name] = (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname);
    return all;
  });
  expect(stored).toEqual({ "alpha-offline-v1": ["/offline.html"] });
});
