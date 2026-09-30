// The phone tab bar stays docked at the bottom of the screen on every private
// page (Marco, 2026-09-30: "the bottom bar is showing up in the middle when I
// scroll down", first on the Ledger with production's 18 sales). A page wider
// than the screen makes a phone widen its layout viewport, and the fixed tab
// bar is placed against that instead of the screen: below it, or across it
// once the page pans. So at 375 and 390 wide, with production-shaped data
// (the Sep 14 add-back lots, 18 sales over Sep 16–24, long buyer and item
// names, a low item), every researcher and admin page is exactly one screen
// wide, and once scrolled to the middle and to the end the tab bar's bottom
// edge is the screen's. Runs as a phone (mobile viewport and touch) in
// Chromium, which widens the layout viewport as a phone does, and in WebKit
// (the webkit-phone project). Toolbar collapse during a scroll is Safari's
// own and can't be driven here.
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { APP_ORIGIN } from "../../playwright.config";
import { saveTemplateAs } from "../support/admin-writers";
import { serviceClient, signedInClient, signInAs } from "../support/local-supabase";
import { seedProductionLedger, type ProductionLedger } from "../support/production-ledger";
import { seedToday } from "../support/today";

const PHONES = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
] as const;

type Seed = {
  ledger: ProductionLedger;
  researcher: { email: string; cycleId: string; peptideId: string; templateId: string };
};
let seed: Seed;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const ledger = await seedProductionLedger("e2e-tabbar");
  const today = await seedToday("tabbar", { vial: { mg: "10", ml: "2" }, supplements: [{ name: "Magnesium glycinate before bed", time: "21:00" }] });
  const { data: peptide, error } = await serviceClient().from("peptides").select("id").eq("name", today.A).single();
  if (error) throw error;
  const template = await saveTemplateAs(await signedInClient(ledger.admin.email), {
    p_name: `Tab bar template ${randomUUID().slice(0, 6)}`,
    p_guidance: "Guidance for the tab bar template",
    p_plans: [
      {
        peptide_id: peptide.id,
        phases: [{ kind: "active", offset_days: 0, length_days: 28, dose_mg: "0.4", local_time: "20:00", schedule_type: "interval", every_days: 2 }],
      },
    ],
  });
  if (template.error) throw new Error(`Could not save the template: ${template.error.message}`);
  seed = { ledger, researcher: { email: today.email, cycleId: today.cycleId, peptideId: peptide.id, templateId: template.data! } };
});

const query = (params: Record<string, string>) => `?${new URLSearchParams(params)}`;

const researcherRoutes = (s: Seed) => [
  "/app/today",
  "/app/cycles",
  "/app/cycles/templates",
  `/app/cycles/${s.researcher.cycleId}`,
  `/app/cycles/${s.researcher.cycleId}/history`,
  "/app/calculator",
  "/app/library",
  `/app/library/peptides/${s.researcher.peptideId}`,
  `/app/library/templates/${s.researcher.templateId}`,
  "/app/progress",
  "/app/supplements",
  "/app/supplies",
  "/app/me",
  "/app/notifications",
];

const adminRoutes = ({ ledger }: Seed) => {
  const sep = { from: "2026-09-16", to: "2026-09-24" };
  return [
    "/admin/business",
    "/admin/ledger",
    `/admin/ledger${query({ ...sep, seller: ledger.admin.id })}`,
    `/admin/ledger${query({ ...sep, seller: ledger.second.id })}`,
    `/admin/ledger${query({ item: ledger.items[0] })}`,
    `/admin/ledger${query({ tab: "purchases", from: "2026-09-14", to: "2026-09-14" })}`,
    `/admin/ledger${query({ group: "month", seller: ledger.admin.id })}`,
    "/admin/ledger?group=month&tab=purchases",
    "/admin/ledger/outside",
    `/admin/ledger/outside${query({ q: "Melanie" })}`,
    "/admin/inventory",
    `/admin/inventory/${ledger.items[0]}`,
    "/admin/library",
    "/admin/library/templates",
    "/admin/people",
  ];
};

/** Why the page isn't one screen wide with the tab bar on the screen's bottom edge, at the top, the middle and the end. */
async function undocked(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const found: string[] = [];
    const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const root = document.documentElement;
    const screen = window.visualViewport!;
    if (root.scrollWidth > root.clientWidth) found.push(`page is ${root.scrollWidth}px wide on a ${root.clientWidth}px screen`);
    if (window.innerWidth !== Math.round(screen.width)) found.push(`layout viewport ${window.innerWidth}px wide, screen ${screen.width}px`);
    const bar = document.querySelector(".app-tabbar");
    if (!bar) return [...found, "no tab bar"];
    const end = root.scrollHeight - window.innerHeight;
    for (const [where, y] of [["top", 0], ["middle", end / 2], ["end", end]] as const) {
      window.scrollTo(0, y);
      await frame();
      const bottom = bar.getBoundingClientRect().bottom;
      const screenBottom = screen.offsetTop + screen.height;
      if (Math.abs(bottom - screenBottom) > 0.5) found.push(`scrolled to the ${where} (${Math.round(window.scrollY)}px): tab bar ends at ${bottom}px, the screen at ${screenBottom}px`);
    }
    return found;
  });
}

async function check(page: Page, routes: string[]) {
  const report: string[] = [];
  for (const route of routes) {
    const response = await page.goto(`${APP_ORIGIN}${route}`);
    expect(response?.status(), route).toBeLessThan(400);
    await expect(page.locator("h1:visible").first(), route).toBeVisible();
    await expect(page.locator('[aria-busy="true"]'), `${route} finishes loading`).toHaveCount(0, { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    for (const problem of await undocked(page)) report.push(`${route}: ${problem}`);
  }
  expect(report).toEqual([]);
}

// One worker per browser, so the ledger is seeded once per browser, not once per worker.
test.describe.configure({ mode: "serial", timeout: 120_000 });

for (const viewport of PHONES) {
  test.describe(`${viewport.width} wide`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });

    test("admin pages with production's ledger", async ({ page }) => {
      await signInAs(page, APP_ORIGIN, seed.ledger.admin.email);
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
      await check(page, adminRoutes(seed));
    });

    test("researcher pages", async ({ page }) => {
      await signInAs(page, APP_ORIGIN, seed.researcher.email);
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
      await check(page, researcherRoutes(seed));
    });
  });
}
