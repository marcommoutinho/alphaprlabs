// Every private screen on a phone (390×844) and a laptop (1280×820), light
// and dark (Close, 2026-09-29): it renders in the v3 root with nothing of the
// old app styles left (no legacy marker, no `app-*` class but the shell's own
// hooks), nothing runs off the side of the page, and no box cuts its content
// short. The researcher screens are swept with a full account (a cycle due
// now, a saved mixture, a tracked vial and a supplement) and an empty one;
// the admin screens with a stock item holding a purchase and an outside
// buyer's sale; the sign-in screens signed out. Set SHOTS_DIR to keep a
// screenshot of each.
import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { APP_ORIGIN } from "../../playwright.config";
import { saveTemplateAs } from "../support/admin-writers";
import { ensureAccount, seedInvitation, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";
import { recordPreviewedSale } from "../support/sales";
import { shot, STATIC_TAB_BAR } from "../support/shots";
import { seedEmpty, seedToday } from "../support/today";

const DEVICES = [
  { device: "phone", viewport: { width: 390, height: 844 } },
  { device: "laptop", viewport: { width: 1280, height: 820 } },
] as const;
const SCHEMES = ["light", "dark"] as const;

/** The v3 shell's own class hooks (the tab bar and the shell frame); any other `app-*` class is the old app's. */
const V3_HOOKS = new Set(["app-tabbar", "app-shell"]);

type Seed = {
  researcher: { email: string; id: string; cycleId: string; peptideId: string; templateId: string };
  empty: { email: string };
  admin: { email: string; itemId: string; peptideId: string; templateId: string; researcherId: string };
  invitation: string;
};
let seed: Seed;

test.beforeAll(async () => {
  const t = randomBytes(3).toString("hex");
  const today = await seedToday(`sweep-${t}`, { vial: { mg: "10", ml: "2" }, supplements: [{ name: `Magnesium ${t}`, time: "21:00" }] });
  const empty = await seedEmpty(`sweep-${t}`);
  const adminEmail = uniqueEmail("e2e-sweep-admin");
  const adminId = await ensureAccount({ email: adminEmail, name: `Sweep Admin ${t}`, role: "admin" });
  const adminDb = await signedInClient(adminEmail);

  const { data: peptide, error: peptideError } = await serviceClient()
    .from("peptides")
    .select("id")
    .eq("name", today.A)
    .single();
  if (peptideError) throw peptideError;
  const template = await saveTemplateAs(adminDb, {
    p_name: `Sweep template ${t}`,
    p_guidance: `Guidance for the sweep template ${t}`,
    p_plans: [
      {
        peptide_id: peptide.id,
        phases: [
          { kind: "active", offset_days: 0, length_days: 28, dose_mg: "0.4", local_time: "20:00", schedule_type: "interval", every_days: 2 },
          { kind: "break", offset_days: 28, length_days: 7 },
        ],
      },
    ],
  });
  if (template.error) throw new Error(`Could not save the template: ${template.error.message}`);

  const bought = await adminDb
    .rpc("record_business_purchase", {
      p_idempotency_key: randomUUID(),
      p_peptide_id: peptide.id,
      p_strength_mg: "5",
      p_received_on: "2026-09-01",
      p_quantity: 10,
      p_unit_cost: "20",
    })
    .single();
  if (bought.error) throw bought.error;
  const sold = await recordPreviewedSale(adminDb, {
    p_idempotency_key: randomUUID(),
    p_stock_item_id: bought.data.stock_item_id,
    p_sold_on: "2026-09-05",
    p_quantity: 2,
    p_unit_price: "45",
    p_buyer_name: `A very long outside buyer name that has to wrap somewhere ${t}`,
    p_seller_id: adminId,
  });
  if (sold.error) throw sold.error;

  seed = {
    researcher: { email: today.email, id: today.researcherId, cycleId: today.cycleId, peptideId: peptide.id, templateId: template.data! },
    empty: { email: empty.email },
    admin: { email: adminEmail, itemId: bought.data.stock_item_id, peptideId: peptide.id, templateId: template.data!, researcherId: today.researcherId },
    invitation: await seedInvitation({ email: uniqueEmail("e2e-sweep-invite"), name: `Sweep Invitee ${t}` }),
  };
});

const researcherRoutes = (s: Seed) => [
  "/app/today",
  "/app/cycles",
  "/app/cycles/new",
  "/app/cycles/templates",
  `/app/cycles/${s.researcher.cycleId}`,
  `/app/cycles/${s.researcher.cycleId}/edit`,
  `/app/cycles/${s.researcher.cycleId}/history`,
  "/app/calculator",
  "/app/library",
  `/app/library/peptides/${s.researcher.peptideId}`,
  `/app/library/templates/${s.researcher.templateId}`,
  "/app/progress",
  "/app/supplements",
  "/app/supplies",
  "/app/me",
  "/app/me/disclaimer",
  "/app/notifications",
];
const EMPTY_ROUTES = ["/app/today", "/app/cycles", "/app/calculator", "/app/progress", "/app/supplements", "/app/supplies", "/app/me"];
const adminRoutes = (s: Seed) => [
  "/admin/business",
  "/admin/inventory",
  `/admin/inventory/${s.admin.itemId}`,
  "/admin/ledger",
  "/admin/ledger/outside",
  `/admin/ledger/outside?${new URLSearchParams({ q: "outside buyer" })}`,
  "/admin/library",
  "/admin/library/peptides/new",
  `/admin/library/peptides/${s.admin.peptideId}`,
  `/admin/library/peptides/${s.admin.peptideId}/preview`,
  "/admin/library/templates",
  "/admin/library/templates/new",
  `/admin/library/templates/${s.admin.templateId}`,
  "/admin/people",
  `/admin/people/${s.admin.researcherId}`,
  "/admin/design",
];
const signedOutRoutes = (s: Seed) => ["/auth", "/auth/recover", `/auth/invite/${s.invitation}`, "/auth/invite/not-a-real-token", "/auth/confirm"];

/** What is wrong with the page as rendered: legacy styling, a page wider than the screen, or a box cutting its content off. */
async function problems(page: Page): Promise<string[]> {
  return page.evaluate((hooks) => {
    const found: string[] = [];
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.getAttribute("data-testid") ? `[data-testid=${el.getAttribute("data-testid")}]` : ""} “${(el.textContent ?? "").trim().slice(0, 40)}”`;

    if (!document.querySelector("body > .alpha")) found.push("not rendered in the v3 root (body > .alpha)");
    for (const el of document.querySelectorAll("[data-legacy-page], [data-legacy-host], .app-root")) found.push(`legacy marker: ${describe(el)}`);
    for (const el of document.querySelectorAll("[class]")) {
      const legacy = [...el.classList].filter((name) => name.startsWith("app-") && !hooks.includes(name));
      if (legacy.length) found.push(`old app class ${legacy.join(" ")}: ${describe(el)}`);
    }

    // The v3 body clips sideways overflow (the fixed bars need it), which
    // would hide a page that is too wide: measure with the clip lifted.
    const body = document.body;
    const clip = body.style.overflowX;
    body.style.overflowX = "visible";
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      found.push(`page is ${root.scrollWidth}px wide on a ${root.clientWidth}px screen`);
      for (const el of body.querySelectorAll("*")) {
        const box = el.getBoundingClientRect();
        if (box.width > 0 && box.right > root.clientWidth + 0.5 && getComputedStyle(el).position !== "fixed") {
          const parent = el.parentElement?.getBoundingClientRect();
          if (!parent || parent.right <= root.clientWidth + 0.5) found.push(`  runs off the side (right ${Math.round(box.right)}px): ${describe(el)}`);
        }
      }
    }
    body.style.overflowX = clip;

    // A box that hides overflow and has more content than room, other than
    // an intended one-line ellipsis, a scroller, or a visually hidden label.
    for (const el of body.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      const sideways = style.overflowX === "hidden" || style.overflowX === "clip";
      const downwards = style.overflowY === "hidden" || style.overflowY === "clip";
      if (sideways && style.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 1)
        found.push(`cut off sideways (${el.scrollWidth} in ${el.clientWidth}px): ${describe(el)}`);
      if (downwards && !style.webkitLineClamp.match(/^\d/) && el.scrollHeight > el.clientHeight + 1)
        found.push(`cut off below (${el.scrollHeight} in ${el.clientHeight}px): ${describe(el)}`);
    }
    return found;
  }, [...V3_HOOKS]);
}

/** Opens each route and collects every problem found, so one run lists them all. */
async function sweep(page: Page, routes: string[], name: string) {
  const report: string[] = [];
  for (const route of routes) {
    const response = await page.goto(`${APP_ORIGIN}${route}`);
    expect(response?.status(), route).toBeLessThan(400);
    await expect(page.locator("h1:visible").first(), route).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // A route's loading state streams first: when it is still up, check it too.
    // (The component gallery shows the skeletons themselves, busy for good.)
    const busy = page.locator(route === "/admin/design" ? "main:not(main)" : '[aria-busy="true"]');
    if (await busy.count()) for (const problem of await problems(page)) report.push(`${route} (loading): ${problem}`);
    await expect(busy, `${route} finishes loading`).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator("h1:visible").first(), route).toBeVisible();
    // A route that failed to load would show its error block instead (the gallery shows it on purpose).
    if (route !== "/admin/design") await expect(page.getByRole("alert").filter({ hasText: /Couldn.t load/ }), route).toHaveCount(0);
    for (const problem of await problems(page)) report.push(`${route}: ${problem}`);
    if (process.env.SHOTS_DIR) {
      // The whole page, the tab bar in the flow so it hides nothing.
      const bar = await page.addStyleTag({ content: STATIC_TAB_BAR });
      await shot(page, `sweep/${name}${route.replace(/[/?=&]+/g, "_")}`, { fullPage: true });
      await bar.evaluate((node) => (node as Element).remove());
    }
  }
  expect(report, `problems on ${name}`).toEqual([]);
}

// Each test opens up to 17 screens.
test.describe.configure({ timeout: 120_000 });

for (const { device, viewport } of DEVICES) {
  for (const scheme of SCHEMES) {
    test.describe(`${device}, ${scheme}`, () => {
      test.use({ viewport, colorScheme: scheme });

      test("researcher screens, with a cycle, a mixture, a vial and a supplement", async ({ page }) => {
        await signInAs(page, APP_ORIGIN, seed.researcher.email);
        await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
        await sweep(page, researcherRoutes(seed), `${device}-${scheme}-researcher`);
      });

      test("researcher screens with nothing yet", async ({ page }) => {
        await signInAs(page, APP_ORIGIN, seed.empty.email);
        await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
        await sweep(page, EMPTY_ROUTES, `${device}-${scheme}-empty`);
      });

      test("admin screens", async ({ page }) => {
        await signInAs(page, APP_ORIGIN, seed.admin.email);
        await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
        await sweep(page, adminRoutes(seed), `${device}-${scheme}-admin`);
      });

      test("sign-in screens, signed out", async ({ page }) => {
        await sweep(page, signedOutRoutes(seed), `${device}-${scheme}-signed-out`);
      });
    });
  }
}
