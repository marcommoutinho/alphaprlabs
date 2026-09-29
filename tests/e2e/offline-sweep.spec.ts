// Offline, nothing a person can press sends a save (N1): every control that
// runs a Server Action is disabled up front (Button needsConnection, or
// useOnline) or its handler does nothing offline (isOnline). This sweep opens
// each screen, goes offline, then presses every enabled control on it and in
// every sheet, dialog or menu that opens, and fails on any Server Action or
// other mutating request that leaves the page. The one-screen checks, with
// the reason shown: tests/e2e/offline.spec.ts.
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { ensureAccount, hydrated, serviceClient, signInAs } from "../support/local-supabase";
import { seedToday } from "../support/today";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

type Ids = { cycleId: string; peptideId: string; otherId: string; stockItemId: string | null; templateId: string | null; outsideBuyer: string | null };

const APP_SHELL = '[data-slot="app-shell"]';

/**
 * Each screen; `scope` is where its controls are (the private shell unless
 * said), `signedOut` opens it signed out, `linksOnly` has nothing to press
 * but links on a phone (swept all the same).
 */
const SCREENS: { path: (ids: Ids) => string | null; scope?: string; signedOut?: boolean; linksOnly?: boolean }[] = [
  { path: () => "/app/today" },
  { path: () => "/app/cycles", linksOnly: true },
  { path: ({ cycleId }) => `/app/cycles/${cycleId}`, linksOnly: true },
  { path: ({ cycleId }) => `/app/cycles/${cycleId}/edit` },
  { path: () => "/app/cycles/new" },
  { path: () => "/app/cycles/templates", linksOnly: true },
  { path: () => "/app/calculator" },
  { path: () => "/app/progress" },
  { path: () => "/app/library" },
  { path: ({ peptideId }) => `/app/library/peptides/${peptideId}`, linksOnly: true },
  { path: () => "/app/supplies" },
  { path: () => "/app/supplements" },
  { path: () => "/app/me" },
  { path: () => "/app/notifications", linksOnly: true },
  { path: () => "/admin" },
  { path: () => "/admin/business" },
  { path: () => "/admin/inventory" },
  { path: ({ stockItemId }) => (stockItemId ? `/admin/inventory/${stockItemId}` : null) },
  { path: () => "/admin/inventory/purchase" },
  { path: () => "/admin/inventory/sale" },
  { path: () => "/admin/ledger" },
  { path: () => "/admin/sales" },
  // An outside buyer's sales: Link to account… and its Link sale.
  { path: ({ outsideBuyer }) => (outsideBuyer ? `/admin/ledger/outside?${new URLSearchParams({ name: outsideBuyer })}` : null) },
  { path: () => "/admin/library", linksOnly: true },
  { path: ({ peptideId }) => `/admin/library/peptides/${peptideId}` },
  { path: () => "/admin/library/peptides/new" },
  { path: () => "/admin/library/templates", linksOnly: true },
  { path: () => "/admin/library/templates/new" },
  { path: ({ templateId }) => (templateId ? `/admin/library/templates/${templateId}` : null) },
  { path: () => "/admin/people" },
  { path: ({ otherId }) => `/admin/people/${otherId}`, linksOnly: true },
  { path: () => "/admin/invitations" },
  { path: () => "/admin/support" },
  { path: ({ otherId }) => `/admin/support/${otherId}`, linksOnly: true },
  // Outside the private shell (no offline bar): the controls wait all the same.
  { path: () => "/auth/reminders", scope: "body" },
  { path: () => "/auth", scope: "body", signedOut: true },
  { path: () => "/auth/recover", scope: "body", signedOut: true },
];

/** Controls a person can press; links are left out (a link tapped offline waits, offline.spec.ts). */
const ANY_CONTROL = ':is(button, [role="switch"], [role="radio"], [role="checkbox"], [role="menuitem"], [role="option"], input[type="submit"]):visible';
const CONTROLS = `${ANY_CONTROL}:enabled`;
const SHEETS = '[role="dialog"]:visible, [role="menu"]:visible';
const SHEET_CONTROLS = `:is([role="dialog"], [role="menu"]) ${CONTROLS}`;
const CLOSING = /^(close|cancel|back|done|not now|keep|dismiss)\b/i;
const MAX_PER_SCOPE = 60;

async function seed(label: string): Promise<Ids & { email: string }> {
  const seeded = await seedToday(label, { vial: { mg: "10", ml: "2" }, supplements: [{ name: `Sweep D3 ${label}`, time: "08:00" }] });
  // Admins are researchers too: one person sees every screen; another researcher is theirs to look at.
  await ensureAccount({ email: seeded.email, name: `Jordan ${label} Reyes`, role: "admin" });
  const other = await seedToday(`${label}-other`);
  const db = serviceClient();
  const peptide = await db.from("peptides").select("id").eq("name", seeded.A).single();
  const stockItem = await db.from("business_stock_items").select("id").limit(1).maybeSingle();
  const template = await db.from("cycle_templates").select("id").limit(1).maybeSingle();
  const outside = await db.from("business_sales").select("buyer_name").is("buyer_profile_id", null).not("buyer_name", "is", null).limit(1).maybeSingle();
  return {
    email: seeded.email,
    cycleId: seeded.cycleId,
    otherId: other.researcherId,
    peptideId: peptide.data!.id,
    stockItemId: stockItem.data?.id ?? null,
    templateId: template.data?.id ?? null,
    outsideBuyer: outside.data?.buyer_name ?? null,
  };
}

const describe = async (control: Locator) =>
  (await control.getAttribute("aria-label").catch(() => null)) ??
  ((await control.innerText({ timeout: 500 }).catch(() => "")) || "(no name)").trim().replace(/\s+/g, " ");

async function openScreen(page: Page, url: string, scope: string) {
  await page.goto(url);
  await expect(page.locator(scope).first()).toBeVisible();
  await expect(page.getByText("This page could not be found.")).toHaveCount(0);
  // The whole page, not its loading skeleton.
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
  const first = page.locator(`${scope} ${CONTROLS}`).first();
  if (await first.count()) await hydrated(first);
}

async function goOffline(page: Page, scope: string) {
  await page.context().setOffline(true);
  if (scope === APP_SHELL) await expect(page.getByTestId("offline-bar")).toBeVisible();
  else await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
}

/** Presses every enabled control in the open sheet(s) or menu, closing ones left out, then closes what is still open. */
async function pressSheet(page: Page, pressed: (name: string) => void) {
  for (let i = 0; i < MAX_PER_SCOPE; i++) {
    const controls = page.locator(SHEET_CONTROLS);
    const count = await controls.count();
    if (i >= count) break;
    const control = controls.nth(i);
    const name = await describe(control);
    if (CLOSING.test(name)) continue;
    pressed(`sheet: ${name}`);
    await control.click({ timeout: 1_000 }).catch(() => undefined);
    await page.waitForTimeout(100);
  }
  for (let k = 0; k < 4 && (await page.locator(SHEETS).count()); k++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
}

for (const [index, screen] of SCREENS.entries()) {
  const name = screen.path({ cycleId: "[id]", peptideId: "[id]", otherId: "[id]", stockItemId: "[id]", templateId: "[id]", outsideBuyer: "[name]" })!;
  test(`offline, nothing on ${name} sends a save`, async ({ page }) => {
    test.setTimeout(300_000);
    const scope = screen.scope ?? APP_SHELL;
    const ids = await seed(`sweep-${index}`);
    const path = screen.path(ids);
    test.skip(!path, "No such record in the local database");
    const url = `${APP_ORIGIN}${path}`;
    if (!screen.signedOut) {
      await signInAs(page, APP_ORIGIN, ids.email);
      await expect(page).toHaveURL(/\/app\/today$/);
    }
    await openScreen(page, url, scope);
    // The screen has controls at all (some or all of them wait offline).
    if (!screen.linksOnly) expect(await page.locator(`${scope} ${ANY_CONTROL}`).count()).toBeGreaterThan(0);

    let last = "(before pressing anything)";
    const sent: string[] = [];
    const watch = (request: Request) => {
      const action = request.headers()["next-action"];
      if (action || !["GET", "HEAD", "OPTIONS"].includes(request.method()))
        sent.push(`${request.method()} ${new URL(request.url()).pathname}${action ? " (Server Action)" : ""} after "${last}"`);
    };
    page.on("request", watch);
    const pressed = (control: string) => {
      last = control;
    };

    await goOffline(page, scope);
    const left: string[] = [];
    let total = 0;
    for (let i = 0; i < MAX_PER_SCOPE; i++) {
      const controls = page.locator(`${scope} ${CONTROLS}`);
      if (i >= (await controls.count())) break;
      const control = controls.nth(i);
      pressed(await describe(control));
      total++;
      await control.click({ timeout: 1_000 }).catch(() => undefined);
      await page.waitForTimeout(150);
      if (await page.locator(SHEETS).count()) await pressSheet(page, pressed);
      // A control that moved to another page: note it, and start again from the screen.
      if (page.url() !== url || (await page.getByTestId("offline-page").count())) {
        left.push(last);
        await page.context().setOffline(false);
        await openScreen(page, url, scope);
        await goOffline(page, scope);
      }
    }
    page.off("request", watch);
    test.info().annotations.push({ type: "pressed", description: `${total} controls` });
    if (left.length) test.info().annotations.push({ type: "left the page", description: left.join(", ") });
    expect(sent).toEqual([]);
  });
}
