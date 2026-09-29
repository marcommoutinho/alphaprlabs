// Pages put back without the server: a document the browser restores from
// its back/forward cache (bfcache) must not show what it showed before the
// server is asked again. A12 Researcher history (the share may have stopped)
// and a peptide (the researcher's own cycle, mix, dose and draw): leaving the
// document hides them at once (pagehide), and a document put back shows the
// placeholders until the fresh check or refresh. Playwright's Chromium never
// restores a document from its bfcache (not even a cacheable one, with
// --disable-back-forward-cache left out), so Back across documents loads the
// page again here; a kept document is played by dispatching pagehide and
// pageshow (persisted) as the browser would.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { createCycle, createPeptide, day, interval, plan, tag } from "../support/cycles";
import { ensureAccount, hydrated, signedInClient, signInAs, uniqueEmail, ok } from "../support/local-supabase";
import { seedToday } from "../support/today";
import { watchVisible } from "../support/watch-visible";

test.use({ viewport: { width: 390, height: 844 } });

const HISTORY = '[data-testid="researcher-history"], [data-testid="history-banner"], [data-testid="history-sub"], [data-testid="recent-row"]';

/** An admin, and a researcher sharing their history, with a cycle (its name only ever shown in the history). */
async function sharedHistory(label: string) {
  const admin = { email: uniqueEmail(`bfcache-admin-${label}`), name: "Marco Moutinho" };
  await ensureAccount({ ...admin, role: "admin" });
  const researcher = { email: uniqueEmail(`bfcache-${label}`), name: `Jordan Cache ${tag()}` };
  const researcherId = await ensureAccount({ ...researcher, role: "researcher" });
  const researcherDb = await signedInClient(researcher.email);
  const peptide = await createPeptide(await signedInClient(admin.email), `Bfcache peptide ${tag()}`);
  const cycleName = `Cached protocol ${tag()}`;
  await createCycle(researcherDb, { name: cycleName, plans: [plan(peptide, [interval(day(-3), day(24), "0.25", 1)])] });
  await ok(researcherDb.rpc("share_with_team"), "share");
  return { admin, cycleName, url: `${APP_ORIGIN}/admin/people/${researcherId}`, check: `/admin/people/${researcherId}/access`, stop: () => ok(researcherDb.rpc("stop_sharing_with_team"), "stop") };
}

const pageHide = (page: Page) => page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
const pageShow = (page: Page) => page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));

test("Back across documents to a history after the share stops never shows it, and it's denied", async ({ page }) => {
  const history = await sharedHistory("back");
  const watch = await watchVisible(page, HISTORY, { acrossDocuments: true });
  await signInAs(page, APP_ORIGIN, history.admin.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);

  // The history, loaded as a document: never stored (no-store, as every private page).
  const loaded = await page.goto(history.url);
  expect(loaded?.headers()["cache-control"]).toContain("no-store");
  await expect(page.getByTestId("history-banner")).toBeVisible();
  await expect(page.getByText(history.cycleName).first()).toBeVisible();

  // Another document, then the share stops and the admin goes Back.
  await page.goto(`${APP_ORIGIN}/admin/people`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("People");
  await history.stop();
  await watch.arm();
  await page.goBack();
  await expect(page).toHaveURL(history.url);
  await expect(page.getByTestId("history-denied")).toBeVisible();
  await expect(page.getByText(history.cycleName)).toHaveCount(0);
  expect(await watch.seen()).toBeNull();
});

test("leaving a history hides it at once; put back by the browser, it shows only after a fresh check", async ({ page }) => {
  const history = await sharedHistory("hide");
  await signInAs(page, APP_ORIGIN, history.admin.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(history.url);
  const banner = page.getByTestId("history-banner");
  await expect(banner).toBeVisible();

  // Leaving the document: hidden there and then, on the element itself (the browser may keep this document as it is).
  await pageHide(page);
  const gate = page.locator('[data-gate="open"]');
  await expect(gate).toHaveAttribute("inert", "");
  await expect(gate).toHaveAttribute("aria-hidden", "true");
  await expect(banner).toBeHidden();

  // The share stops; the document comes back: nothing of the history shows, the check says no, the denied state.
  await history.stop();
  const watch = await watchVisible(page, HISTORY);
  await watch.arm();
  const checked = page.waitForResponse((response) => new URL(response.url()).pathname === history.check);
  await pageShow(page);
  expect(await (await checked).json()).toEqual({ shared: false });
  await expect(page.getByTestId("history-denied")).toBeVisible();
  await expect(page.getByText(history.cycleName)).toHaveCount(0);
  expect(await watch.seen()).toBeNull();
});

test("leaving a peptide page hides the researcher's mix at once; put back, the placeholders show until the server answers", async ({ page }) => {
  const { email, A } = await seedToday("bfcache-peptide");
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/app/library`);
  await (await hydrated(page.getByTestId("library-peptide").filter({ hasText: A }))).click();
  await expect(page).toHaveURL(/\/app\/library\/peptides\//);
  const mix = page.getByTestId("your-mix");
  await expect(mix).toBeVisible();
  const path = new URL(page.url()).pathname;

  await pageHide(page);
  await expect(mix).toBeHidden();

  // Put back: the page asks the server again (held here); meanwhile only the placeholders.
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const asked = page.waitForRequest((request) => new URL(request.url()).pathname === path && Boolean(request.headers()["rsc"]));
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      if (route.request().method() === "GET" && (await route.request().allHeaders())["rsc"]) await released;
      await route.fallback();
    },
  );
  const watch = await watchVisible(page, '[data-testid="your-mix"], [data-testid="add-to-cycle"]');
  await watch.arm();
  await pageShow(page);
  await asked;
  await expect(page.locator("main [data-slot=skeleton]").first()).toBeVisible();
  await expect(mix).toHaveCount(0);
  expect(await watch.seen()).toBeNull();
  release();
  await expect(mix).toBeVisible();
  await expect(page.locator("main [data-slot=skeleton]")).toHaveCount(0);
});
