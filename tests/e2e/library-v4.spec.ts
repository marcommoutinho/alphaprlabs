// V4 R11 Library and R12 Peptide detail (design v3) against the real local
// Supabase: the count and last update, search and the In my cycles filter,
// the "In your cycle" tag, "Your mix" only for a peptide in one of the
// researcher's own current cycles (the saved mix and today's dose through
// the calculator), the company content, and Add to a cycle into the builder
// with the peptide checked. Phone and laptop, light and dark.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { createCycle, interval, plan, tag } from "../support/cycles";
import { ensureAccount, hydrated, ok, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";
import { shot as saveShot } from "../support/shots";
import { d, NOON } from "../support/noon";

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 820 };
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = async (page: Page, name: string) => {
  await saveShot(page, `v4-${name}`, { fullPage: true });
};

async function peptide(name: string, fields: { information: string; cycling_off_guidance?: string; supplement_guidance?: string; available?: boolean }) {
  const { data, error } = await serviceClient()
    .from("peptides")
    .insert({ name, available: true, ...fields })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not seed ${name}: ${error?.message ?? "no row"}`);
  return data.id;
}

/**
 * A researcher whose running cycle uses A (250 mcg daily at 08:00, a saved
 * 10 mg + 2 mL mix read on a 30-unit syringe); B is offered and in no cycle
 * of theirs; W is no longer offered.
 */
async function seed(label: string) {
  const t = tag();
  const email = uniqueEmail(`v4-library-${label}`);
  await ensureAccount({ email, name: "Library Researcher", role: "researcher" });
  const names = { A: `Lib A ${t}`, B: `Lib B ${t}`, W: `Lib W ${t}` };
  const aId = await peptide(names.A, { information: `Pentadecapeptide ${t} · tissue repair research. Studied in animal models.`, cycling_off_guidance: "Four weeks off." });
  const bId = await peptide(names.B, {
    information: `Growth hormone secretagogue ${t}.`,
    cycling_off_guidance: "",
    supplement_guidance: "Vitamin D3 with food.",
  });
  await peptide(names.W, { information: `Withdrawn ${t}.`, available: false });
  const db = await signedInClient(email);
  const cycleName = `Library cycle ${t}`;
  const cycleId = await createCycle(db, { name: cycleName, timeZone: NOON, plans: [plan(aId, [interval(d(-2), d(20), "0.25", 1, "08:00")])] });
  const [{ id: planId }] = await ok(db.from("cycle_plans").select("id").eq("cycle_id", cycleId), "plan");
  await ok(db.rpc("save_mixture", { p_peptide_id: aId, p_vial_mg: "10", p_liquid_ml: "2", p_syringe_units: 30, p_line_spacing: "0.5", p_plan_ids: [planId] }), "mixture");
  return { email, t, names, aId, bId, cycleId, cycleName };
}

for (const [device, viewport] of [
  ["phone", PHONE],
  ["laptop", LAPTOP],
] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`Library and peptide detail on a ${device} in ${scheme}`, async ({ browser }) => {
      const s = await seed(`${device}-${scheme}`);
      const context = await browser.newContext({ viewport, colorScheme: scheme });
      const page = await context.newPage();
      await signInAs(page, APP_ORIGIN, s.email);
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);

      await page.goto(`${APP_ORIGIN}/app/library`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Library");
      await expect(page.getByTestId("library-meta")).toHaveText(/^\d+ peptides · updated \w{3} \d+$/);
      const search = await hydrated(page.getByLabel("Search peptides"));
      await search.fill(s.t);
      const rows = page.getByTestId("library-peptide");
      await expect(rows).toHaveCount(2);
      const a = rows.filter({ hasText: s.names.A });
      await expect(a.getByTestId("in-your-cycle")).toHaveText("In your cycle");
      await expect(a).toContainText(`Pentadecapeptide ${s.t} · tissue repair research.`);
      await expect(a).not.toContainText("Studied in animal models.");
      await expect(rows.filter({ hasText: s.names.B }).getByTestId("in-your-cycle")).toHaveCount(0);
      // Not offered: never listed.
      await expect(page.getByText(s.names.W)).toHaveCount(0);
      // In my cycles: A only.
      await page.getByTestId("library-filter-mine").click();
      await expect(page.getByTestId("library-filter-mine")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("library-filter-mine")).toHaveText(/^In my cycles · \d+$/);
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText(s.names.A);
      await page.getByTestId("library-filter-all").click();
      await search.fill(`${s.t} nothing`);
      await expect(page.getByText(`No peptides match “${s.t} nothing”.`)).toBeVisible();
      await search.fill(s.t);
      expect(await noSideScroll(page)).toBe(true);
      await shot(page, `library-${device}-${scheme}`);

      // A: in the running cycle, so "Your mix" from its saved mix and today's dose.
      await a.click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/library/peptides/${s.aId}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(s.names.A);
      await expect(page.getByText(/^Updated \w{3} \d+, \d{4}$/)).toBeVisible();
      const mix = page.getByTestId("your-mix");
      await expect(mix).toContainText("Your mix · 10 mg + 2 mL");
      await expect(mix).toContainText("30-unit syringe");
      await expect(mix.locator("dd")).toHaveText(["5 mg/mL", "250 mcg", "5 units"]);
      await expect(page.getByRole("link", { name: s.cycleName })).toHaveAttribute("href", `/app/cycles/${s.cycleId}`);
      await expect(page.getByTestId("peptide-summary")).toContainText("Studied in animal models.");
      await expect(page.getByTestId("peptide-cycling-off")).toContainText("Four weeks off.");
      await expect(page.getByTestId("peptide-supplements")).toContainText("No supplement guidance supplied for this peptide.");
      expect(await noSideScroll(page)).toBe(true);
      await shot(page, `peptide-${device}-${scheme}`);

      // B: in no cycle of theirs, so no "Your mix"; Add to a cycle opens the builder with it checked.
      await page.goto(`${APP_ORIGIN}/app/library/peptides/${s.bId}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(s.names.B);
      await expect(page.getByTestId("your-mix")).toHaveCount(0);
      await expect(page.getByTestId("peptide-cycling-off")).toContainText("No cycling-off guidance supplied for this peptide.");
      await expect(page.getByTestId("peptide-supplements")).toContainText("Vitamin D3 with food.");
      await expect(page.getByRole("link", { name: "Create a supplement routine" })).toHaveAttribute("href", "/app/supplements");
      await (await hydrated(page.getByTestId("add-to-cycle"))).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles/new?peptide=${s.bId}`);
      await expect(page.getByTestId("builder-title")).toHaveText("New cycle");
      const picked = page.getByTestId("selected-peptides").getByRole("checkbox");
      await expect(picked).toHaveCount(1);
      await expect(picked).toContainText(s.names.B);
      await expect(page.getByRole("button", { name: /^Continue with 1 peptide/ })).toBeEnabled();
      await context.close();
    });
  }
}

test("a peptide withdrawn after it went into a cycle stays openable from that cycle for its owner", async ({ page }) => {
  const s = await seed("owner-withdrawn");
  // Withdrawn after the cycle started using it.
  await ok(serviceClient().from("peptides").update({ available: false }).eq("id", s.aId).select("id"), "withdraw");
  await page.setViewportSize(PHONE);
  await signInAs(page, APP_ORIGIN, s.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);

  // Hidden from browsing.
  await page.goto(`${APP_ORIGIN}/app/library`);
  await (await hydrated(page.getByLabel("Search peptides"))).fill(s.t);
  await expect(page.getByTestId("library-peptide")).toHaveCount(1);
  await expect(page.getByTestId("library-peptide")).toContainText(s.names.B);

  // Opened from the cycle: the plan's peptide name links to R12.
  await page.goto(`${APP_ORIGIN}/app/cycles/${s.cycleId}`);
  const link = page.getByTestId("cycle-plan-card").getByTestId("plan-peptide-link");
  await expect(link).toHaveText(s.names.A);
  await expect(page.getByTestId("cycle-plan-card")).toContainText("Not offered");
  await link.click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/library/peptides/${s.aId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(s.names.A);
  await expect(page.getByTestId("peptide-withdrawn")).toContainText("Not offered");
  // Its company content and Your mix, as before it was withdrawn.
  await expect(page.getByTestId("peptide-summary")).toContainText("Studied in animal models.");
  await expect(page.getByTestId("peptide-cycling-off")).toContainText("Four weeks off.");
  await expect(page.getByTestId("your-mix").locator("dd")).toHaveText(["5 mg/mL", "250 mcg", "5 units"]);
  // It can't start a new cycle.
  await expect(page.getByTestId("add-to-cycle")).toHaveCount(0);
  await page.goto(`${APP_ORIGIN}/app/cycles/new?peptide=${s.aId}`);
  await expect(page.getByTestId("builder-title")).toHaveText("New cycle");
  await expect(page.getByTestId("selected-peptides").getByRole("checkbox")).toHaveCount(0);

  // Another researcher, whose cycles don't use it: not found.
  const otherEmail = uniqueEmail("v4-library-not-owner");
  await ensureAccount({ email: otherEmail, name: "Other Researcher", role: "researcher" });
  const other = await page.context().browser()!.newContext({ viewport: PHONE });
  const otherPage = await other.newPage();
  await signInAs(otherPage, APP_ORIGIN, otherEmail);
  await expect(otherPage).toHaveURL(`${APP_ORIGIN}/app/today`);
  await otherPage.goto(`${APP_ORIGIN}/app/library/peptides/${s.aId}`);
  await expect(otherPage.getByText("This page could not be found.")).toBeVisible();
  await other.close();
});

test("a withdrawn peptide's page isn't browsable, and another researcher's cycle never marks a peptide", async ({ page }) => {
  const s = await seed("others");
  const otherEmail = uniqueEmail("v4-library-other");
  await ensureAccount({ email: otherEmail, name: "Other Researcher", role: "researcher" });
  const { data } = await serviceClient().from("peptides").select("id").eq("name", s.names.W).single();
  await signInAs(page, APP_ORIGIN, otherEmail);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/app/library/peptides/${data!.id}`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await page.goto(`${APP_ORIGIN}/app/library`);
  await (await hydrated(page.getByLabel("Search peptides"))).fill(s.t);
  await expect(page.getByTestId("library-peptide")).toHaveCount(2);
  await expect(page.getByTestId("in-your-cycle")).toHaveCount(0);
  await page.goto(`${APP_ORIGIN}/app/library/peptides/${s.aId}`);
  await expect(page.getByTestId("your-mix")).toHaveCount(0);
  await expect(page.getByText(s.cycleName)).toHaveCount(0);
});
