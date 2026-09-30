// The phone tab bar stays docked at the bottom of the screen (Marco,
// 2026-09-30: "the bottom bar is showing up in the middle when I scroll
// down", first on the Ledger with production's 18 sales, then "sometimes the
// bottom bar gets stuck" on another page). Two ways a phone detaches it:
//  - a page wider than the screen: the phone widens its layout viewport and
//    the fixed bar is placed against that, below the screen or across it;
//  - a text field under 16 px: iOS zooms in when it takes focus and stays
//    zoomed after the keyboard closes, the same split between what the page
//    lays out and what is on screen.
// With production-shaped data (the Sep 14 add-back lots, 18 sales over Sep
// 16–24, long buyer and item names, a low item), at 375 and 390 wide, the
// pages listed below (the tab-bar pages of both roles, plus the full-screen
// editors and builder, which have no tab bar) are exactly one screen wide;
// once scrolled to the top, middle and end, and with a text field focused,
// the tab bar's bottom edge is the screen's; and no focusable text field on
// the page, or in the sheets opened from it (Range, Record sale, Record
// purchase, the stock level, Invite someone, Link to account, the Today log,
// the check-in, Add vial, Add routine, the template's peptide picker and
// phase row, each cycle-builder step), is under 16 px. Runs as a phone
// (mobile viewport and touch) in Chromium, which widens the layout viewport
// as a phone does, and in WebKit (the webkit-phone project). Neither zooms on
// focus, so the 16 px rule is checked on the computed size; Safari's toolbar
// collapsing during a scroll can't be driven here.
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { APP_ORIGIN } from "../../playwright.config";
import { saveTemplateAs } from "../support/admin-writers";
import { smallFields } from "../support/fields";
import { hydrated, serviceClient, signedInClient, signInAs } from "../support/local-supabase";
import { seedProductionLedger, type ProductionLedger } from "../support/production-ledger";
import { seedToday } from "../support/today";

const PHONES = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
] as const;

type Seed = {
  ledger: ProductionLedger;
  researcher: { email: string; cycleId: string; peptideId: string; peptide: string; templateId: string };
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
  seed = { ledger, researcher: { email: today.email, cycleId: today.cycleId, peptideId: peptide.id, peptide: today.A, templateId: template.data! } };
});

const query = (params: Record<string, string>) => `?${new URLSearchParams(params)}`;

/** A sheet (or builder step) opened from the page, whose fields are checked too; it leaves it open. */
type Opener = { name: string; open: (page: Page) => Promise<void> };
/** A page; `bar: false` for the full-screen editors and builder, which cover the tab bar. */
type Visit = { route: string; bar?: boolean; sheets?: Opener[] };

const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });
async function opened(page: Page, name: string) {
  await expect(dialog(page, name)).toBeVisible({ timeout: 15_000 });
  await expect(dialog(page, name).locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
}

const researcherVisits = (s: Seed): Visit[] => [
  {
    route: "/app/today",
    sheets: [
      {
        name: "the log sheet",
        open: async (page) => {
          await (await hydrated(page.getByTestId("today-overdue").filter({ hasText: s.researcher.peptide }).getByRole("button", { name: "Log" }))).click();
          await opened(page, s.researcher.peptide);
        },
      },
    ],
  },
  { route: "/app/cycles" },
  { route: "/app/cycles/templates" },
  { route: `/app/cycles/${s.researcher.cycleId}` },
  { route: `/app/cycles/${s.researcher.cycleId}/history` },
  {
    route: "/app/cycles/new",
    bar: false,
    sheets: [
      {
        name: "each builder step",
        open: async (page) => {
          const builder = page.getByTestId("cycle-builder");
          await (await hydrated(page.getByLabel("Search peptides"))).fill(s.researcher.peptide);
          await page.getByRole("checkbox").filter({ hasText: s.researcher.peptide }).click();
          await page.getByRole("button", { name: "Continue with 1 peptide" }).click();
          await expect(builder).toHaveAttribute("data-step", "dose");
          expect(await smallFields(page), "dose step").toEqual([]);
          await page.getByRole("group", { name: "Dose unit" }).getByRole("button", { name: "mcg" }).click();
          await page.getByLabel("Dose", { exact: true }).fill("250");
          await page.getByLabel("Vial", { exact: true }).fill("10");
          await page.getByLabel("BAC water").fill("2");
          await page.getByRole("radiogroup", { name: "Syringe (units)" }).getByRole("radio", { name: "30" }).click();
          await page.getByRole("button", { name: "Continue", exact: true }).click();
          await expect(builder).toHaveAttribute("data-step", "schedule");
          expect(await smallFields(page), "schedule step").toEqual([]);
          await page.getByTestId("phase-editor").getByLabel("Time").fill("08:00");
          await page.getByRole("button", { name: "Review cycle" }).click();
          await expect(builder).toHaveAttribute("data-step", "review");
        },
      },
    ],
  },
  { route: `/app/cycles/${s.researcher.cycleId}/edit`, bar: false },
  { route: "/app/calculator" },
  { route: "/app/library" },
  { route: `/app/library/peptides/${s.researcher.peptideId}` },
  { route: `/app/library/templates/${s.researcher.templateId}` },
  {
    route: "/app/progress",
    sheets: [
      {
        name: "the check-in sheet",
        open: async (page) => {
          await (await hydrated(page.getByTestId("progress-check-in"))).click();
          await expect(page.getByRole("dialog")).toBeVisible();
        },
      },
    ],
  },
  {
    route: "/app/supplements",
    sheets: [
      {
        name: "Add routine",
        open: async (page) => {
          await (await hydrated(page.getByTestId("supplies-add"))).click();
          await opened(page, "Add routine");
        },
      },
    ],
  },
  {
    route: "/app/supplies",
    sheets: [
      {
        name: "Add vial",
        open: async (page) => {
          await (await hydrated(page.getByTestId("supplies-add"))).click();
          await opened(page, "Add vial");
        },
      },
    ],
  },
  { route: "/app/me" },
  { route: "/app/notifications" },
  { route: "/app/install" },
];

const adminVisits = ({ ledger, researcher }: Seed): Visit[] => {
  const sep = { from: "2026-09-16", to: "2026-09-24" };
  const item = ledger.items[0];
  return [
    { route: "/admin/business" },
    {
      route: "/admin/ledger",
      sheets: [
        {
          name: "Range",
          open: async (page) => {
            await (await hydrated(page.getByTestId("range-chip"))).click();
            await opened(page, "Range");
          },
        },
      ],
    },
    { route: `/admin/ledger${query({ ...sep, seller: ledger.admin.id })}` },
    { route: `/admin/ledger${query({ ...sep, seller: ledger.second.id })}` },
    { route: `/admin/ledger${query({ item })}` },
    { route: `/admin/ledger${query({ tab: "purchases", from: "2026-09-14", to: "2026-09-14" })}` },
    { route: `/admin/ledger${query({ group: "month", seller: ledger.admin.id })}` },
    { route: "/admin/ledger?group=month&tab=purchases" },
    { route: "/admin/ledger/outside" },
    {
      route: `/admin/ledger/outside${query({ name: "Melanie (Sandra's friend)" })}`,
      sheets: [
        {
          name: "Link to account",
          open: async (page) => {
            await (await hydrated(page.getByRole("button", { name: /^Link to account/ }).first())).click();
            await expect(page.getByRole("dialog")).toBeVisible();
          },
        },
      ],
    },
    {
      route: "/admin/inventory",
      sheets: [
        {
          name: "the stock level",
          open: async (page) => {
            await (await hydrated(page.getByTestId("stock-row").first())).click();
            await expect(page.getByRole("dialog")).toBeVisible();
          },
        },
        {
          name: "Record sale",
          open: async (page) => {
            await page.goto(`${APP_ORIGIN}/admin/inventory${query({ record: "sale", recordItem: item })}`);
            await opened(page, "Record sale");
            await expect(page.getByTestId("sale-date")).toBeAttached();
          },
        },
        {
          name: "Record purchase",
          open: async (page) => {
            await page.goto(`${APP_ORIGIN}/admin/inventory${query({ record: "purchase", recordItem: item })}`);
            await opened(page, "Record purchase");
            await expect(page.getByTestId("purchase-date")).toBeAttached();
          },
        },
      ],
    },
    { route: `/admin/inventory/${item}` },
    { route: "/admin/library" },
    { route: "/admin/library/templates" },
    {
      route: "/admin/library/templates/new",
      bar: false,
      sheets: [
        {
          name: "the peptide picker and a phase row",
          open: async (page) => {
            await (await hydrated(page.getByTestId("add-peptide-phone"))).click();
            const picker = page.getByTestId("peptide-picker");
            await expect(picker).toBeVisible();
            expect(await smallFields(page), "peptide picker").toEqual([]);
            await picker.getByRole("button", { name: researcher.peptide, exact: true }).click();
            await expect(page.getByTestId("phase-row")).toHaveCount(1);
            await page.getByTestId("phase-schedule").selectOption("every");
            await expect(page.getByTestId("phase-every")).toBeVisible();
          },
        },
      ],
    },
    { route: `/admin/library/templates/${researcher.templateId}`, bar: false },
    { route: "/admin/library/peptides/new", bar: false },
    { route: `/admin/library/peptides/${researcher.peptideId}`, bar: false },
    {
      route: "/admin/people",
      sheets: [
        {
          name: "Invite someone",
          open: async (page) => {
            await (await hydrated(page.getByLabel("Email to invite"))).fill(`tabbar-${randomUUID().slice(0, 6)}@example.test`);
            await page.getByTestId("quick-invite").click();
            await opened(page, "Invite someone");
          },
        },
      ],
    },
  ];
};

/** Why the page isn't one screen wide with the tab bar on the screen's bottom edge, at the top, the middle and the end. */
async function undocked(page: Page, bar: boolean): Promise<string[]> {
  return page.evaluate(async (bar) => {
    const found: string[] = [];
    const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const root = document.documentElement;
    const screen = window.visualViewport!;
    if (root.scrollWidth > root.clientWidth) found.push(`page is ${root.scrollWidth}px wide on a ${root.clientWidth}px screen`);
    if (window.innerWidth !== Math.round(screen.width)) found.push(`layout viewport ${window.innerWidth}px wide, screen ${screen.width}px`);
    if (!bar) return found;
    const tabBar = document.querySelector(".app-tabbar");
    if (!tabBar) return [...found, "no tab bar"];
    const end = root.scrollHeight - window.innerHeight;
    for (const [where, y] of [["top", 0], ["middle", end / 2], ["end", end]] as const) {
      window.scrollTo(0, y);
      await frame();
      const bottom = tabBar.getBoundingClientRect().bottom;
      const screenBottom = screen.offsetTop + screen.height;
      if (Math.abs(bottom - screenBottom) > 0.5) found.push(`scrolled to the ${where} (${Math.round(window.scrollY)}px): tab bar ends at ${bottom}px, the screen at ${screenBottom}px`);
    }
    window.scrollTo(0, 0);
    return found;
  }, bar);
}

/** Focuses the page's first text field (none in a sheet): the tab bar must still end on the screen's bottom edge. */
async function focusedDocked(page: Page): Promise<string[]> {
  const field = page
    .locator('input:not([type=checkbox], [type=radio], [type=range], [type=button], [type=submit], [type=hidden], [type=file]), select, textarea')
    .filter({ visible: true })
    .first();
  if (!(await field.count())) return [];
  await field.focus();
  const found = await page.evaluate(async () => {
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const screen = window.visualViewport!;
    const bottom = document.querySelector(".app-tabbar")!.getBoundingClientRect().bottom;
    const screenBottom = screen.offsetTop + screen.height;
    const name = document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.getAttribute("placeholder") ?? document.activeElement?.tagName;
    return Math.abs(bottom - screenBottom) > 0.5 ? [`with “${name}” focused (zoom ${screen.scale}): tab bar ends at ${bottom}px, the screen at ${screenBottom}px`] : [];
  });
  await field.blur();
  return found;
}

async function check(page: Page, visits: Visit[]) {
  const report: string[] = [];
  const load = async (route: string) => {
    const response = await page.goto(`${APP_ORIGIN}${route}`);
    expect(response?.status(), route).toBeLessThan(400);
    await expect(page.locator("h1:visible").first(), route).toBeVisible();
    await expect(page.locator('[aria-busy="true"]'), `${route} finishes loading`).toHaveCount(0, { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
  };
  for (const { route, bar = true, sheets = [] } of visits) {
    await load(route);
    for (const problem of await undocked(page, bar)) report.push(`${route}: ${problem}`);
    for (const field of await smallFields(page)) report.push(`${route}: field under 16px: ${field}`);
    if (bar) for (const problem of await focusedDocked(page)) report.push(`${route}: ${problem}`);
    for (const sheet of sheets) {
      await load(route);
      await sheet.open(page);
      for (const field of await smallFields(page)) report.push(`${route}, ${sheet.name}: field under 16px: ${field}`);
    }
  }
  expect(report).toEqual([]);
}

// One worker per browser, so the ledger is seeded once per browser, not once per worker.
test.describe.configure({ mode: "serial", timeout: 180_000 });

for (const viewport of PHONES) {
  test.describe(`${viewport.width} wide`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });

    test("admin pages with production's ledger, and their sheets", async ({ page }) => {
      await signInAs(page, APP_ORIGIN, seed.ledger.admin.email);
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
      await check(page, adminVisits(seed));
    });

    test("researcher pages, and their sheets", async ({ page }) => {
      await signInAs(page, APP_ORIGIN, seed.researcher.email);
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
      await check(page, researcherVisits(seed));
    });
  });
}
