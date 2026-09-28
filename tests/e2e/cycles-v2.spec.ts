// V2 Cycles (design v3) on a phone and a laptop, light and dark, against the
// real local Supabase: the R10 list; R3 / D2 detail with a taken, a skipped
// and a missed dose, the missed one logged late through its link to Today
// (R2b); building a cycle from scratch (R4a–c and the review) and from a
// template; and editing the future plan. Cycles use a fixed-offset zone where
// it is about 12:00 now (tests/support/noon.ts). Set SHOTS_DIR to save a
// screenshot of each screen there (v2-<screen>-<device>.png).
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { APP_ORIGIN } from "../../playwright.config";
import { createCycle, interval, pause, plan, tag } from "../support/cycles";
import { ensureAccount, hydrated, ok, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";
import { d, NOON, noonZoneInstant } from "../support/noon";

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 820 };
const LIGHT_PAPER = "rgb(242, 242, 238)";
const ADMIN = { email: uniqueEmail("v2-cycles-admin"), name: "Cycles Admin" };

test.beforeAll(async () => {
  await ensureAccount({ ...ADMIN, role: "admin" });
});

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const paper = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

async function shot(page: Page, name: string, device: string, fullPage = true) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(dir, `v2-${name}-${device}.png`), fullPage, animations: "disabled" });
}

async function seedPeptide(name: string, cyclingOff = "") {
  const { data, error } = await serviceClient()
    .from("peptides")
    .insert({ name, information: `[Supplied information for ${name}]`, cycling_off_guidance: cyclingOff, available: true })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not seed ${name}: ${error?.message ?? "no row"}`);
  return data.id;
}

/**
 * A researcher with three cycles in the noon zone. "Recovery": A daily at
 * 08:00 from three days ago (250 mcg; a break, then 500 mcg), with a saved
 * 10 mg / 2 mL mix; B every 2 days at 20:00 (2.5 mg). Taken: A and B three
 * days ago; skipped: A two days ago; missed: A and B yesterday; due: A today.
 * Plus an upcoming and an ended cycle.
 */
async function seedCycles(label: string) {
  const t = tag();
  const email = uniqueEmail(`v2-cycles-${label}`);
  await ensureAccount({ email, name: `Riley ${label}`, role: "researcher" });
  const [A, B] = [`BPC ${t}`, `TB ${t}`];
  const [aId, bId] = [await seedPeptide(A, "Four weeks off after eight weeks on."), await seedPeptide(B)];
  const db = await signedInClient(email);
  const name = `Recovery ${t}`;
  const cycleId = await createCycle(db, {
    name,
    goal: "Tendon recovery",
    baseline: "Pain 6/10",
    timeZone: NOON,
    plans: [
      plan(aId, [interval(d(-3), d(24), "0.25", 1, "08:00"), pause(d(25), d(31)), interval(d(32), d(52), "0.5", 1, "08:00")]),
      plan(bId, [interval(d(-3), d(38), "2.5", 2, "20:00")]),
    ],
  });
  await createCycle(db, { name: `Upcoming ${t}`, timeZone: NOON, plans: [plan(bId, [interval(d(6), d(40), "2.5", 3, "20:00")])] });
  await createCycle(db, { name: `Ended ${t}`, timeZone: NOON, plans: [plan(aId, [interval(d(-60), d(-40), "0.25", 3, "08:00")])] });

  const phases = await ok(
    serviceClient().from("cycle_revision_phases").select("plan_id, phase_id, start_date, cycle_revision_plans!inner(peptide_id, cycle_id)").eq("cycle_revision_plans.cycle_id", cycleId),
    "phases",
  );
  const first = (peptideId: string) => phases.find((p) => p.cycle_revision_plans.peptide_id === peptideId && p.start_date === d(-3))!;
  const [pa, pb] = [first(aId), first(bId)];
  const key = (p: { plan_id: string; phase_id: string }, index: number) => `${p.plan_id}:${p.phase_id}:${index}`;
  const taken = (p: typeof pa, index: number, date: string, time: string, mg: string) =>
    ok(
      db.rpc("confirm_dose", {
        p_request_key: randomUUID(),
        p_occurrence_key: key(p, index),
        p_seen_scheduled_at: noonZoneInstant(date, time),
        p_seen_dose_mg: mg,
        p_seen_mixture_version_id: null as unknown as string,
        p_amount_mg: mg,
        p_actual_at: noonZoneInstant(date, time),
        p_site: "Abdomen L",
      }),
      "confirm_dose",
    );
  await taken(pa, 0, d(-3), "08:00", "0.25");
  await taken(pb, 0, d(-3), "20:00", "2.5");
  await ok(
    db.rpc("skip_dose", { p_request_key: randomUUID(), p_occurrence_key: key(pa, 1), p_seen_scheduled_at: noonZoneInstant(d(-2), "08:00"), p_seen_dose_mg: "0.25" }),
    "skip_dose",
  );
  // A's mix, saved after those doses (so they were logged without one).
  await ok(
    db.rpc("save_mixture", { p_peptide_id: aId, p_vial_mg: "10", p_liquid_ml: "2", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [pa.plan_id] }),
    "save_mixture",
  );
  return { email, t, A, B, aId, bId, name, cycleId, db };
}

async function signIn(page: Page, email: string) {
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
}

async function seedTemplate(t: string, peptides: string[]) {
  const adminDb = await signedInClient(ADMIN.email);
  const name = `Recovery stack ${t}`;
  const id = await ok(
    adminDb.rpc("save_cycle_template", {
      p_name: name,
      p_guidance: "",
      p_plans: [
        {
          peptide_id: peptides[0],
          phases: [
            { kind: "active", offset_days: 0, length_days: 28, dose_mg: "0.25", local_time: "08:00", schedule_type: "interval", every_days: 1 },
            { kind: "break", offset_days: 28, length_days: 7 },
          ],
        },
        { peptide_id: peptides[1], phases: [{ kind: "active", offset_days: 0, length_days: 35, dose_mg: "2.5", local_time: "20:00", schedule_type: "weekdays", weekdays: [1, 4] }] },
      ],
    }),
    "template",
  );
  return { id: id!, name };
}

const DEVICES = [
  { device: "phone-light", viewport: PHONE, colorScheme: "light" as const, phone: true },
  { device: "phone-dark", viewport: PHONE, colorScheme: "dark" as const, phone: true },
  { device: "laptop", viewport: LAPTOP, colorScheme: "light" as const, phone: false },
  { device: "laptop-dark", viewport: LAPTOP, colorScheme: "dark" as const, phone: false },
];

for (const { device, viewport, colorScheme, phone } of DEVICES) {
  test.describe(device, () => {
    test.use({ viewport, colorScheme });

    test("the list, and a cycle with a taken, a skipped and a missed dose; the missed one is logged late", async ({ page }) => {
      const seed = await seedCycles(`list-${device}`);
      await signIn(page, seed.email);
      if (colorScheme === "dark") expect(await paper(page)).not.toBe(LIGHT_PAPER);
      else expect(await paper(page)).toBe(LIGHT_PAPER);

      // R10: Active, Upcoming, Ended.
      await page.goto(`${APP_ORIGIN}/app/cycles`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cycles");
      await expect(page.getByTestId("cycle-group").locator("h2")).toHaveText(["Active", "Upcoming", "Ended"]);
      const card = page.getByTestId("cycle-card").filter({ hasText: seed.name });
      await expect(card.locator("[data-slot=day]")).toHaveText("Day 4 of 56");
      await expect(card.locator("[data-slot=peptides]")).toHaveText(`${seed.A} · ${seed.B}`);
      // 2 taken of 5 settled (2 taken, 1 skipped, 2 missed); A's 08:00 is due now.
      await expect(card.locator("[data-slot=adherence]")).toHaveText("40%");
      await expect(card.locator("[data-slot=next]")).toContainText(`${seed.A} · 250 mcg due now`);
      await expect(card.locator("[data-slot=next]")).toContainText("2 missed");
      await expect(page.getByTestId("cycle-card").filter({ hasText: `Upcoming ${seed.t}` }).locator("[data-slot=day]")).toHaveText(/^Starts /);
      await expect(page.getByTestId("cycle-card").filter({ hasText: `Ended ${seed.t}` }).locator("[data-slot=adherence]")).toHaveText("0%");
      await expect(page.getByRole("link", { name: "Browse templates" })).toHaveAttribute("href", "/app/cycles/templates");
      expect(await noSideScroll(page)).toBe(true);
      await shot(page, "list", device);

      // R3 / D2.
      await (await hydrated(card)).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles/${seed.cycleId}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(seed.name);
      await expect(page.getByTestId("cycle-now").locator("[data-slot=reading]")).toHaveText("4");
      await expect(page.getByTestId("cycle-now")).toContainText("of 56");
      const plans = page.getByTestId("cycle-plan-card");
      await expect(plans).toHaveCount(2);
      await expect(plans.nth(0).getByTestId("phase-row")).toHaveCount(3);
      await expect(plans.nth(0).getByTestId("phase-row").nth(0)).toHaveAttribute("data-when", "now");
      await expect(plans.nth(0).locator("[data-slot=count]")).toHaveText("1 of 3");
      // 250 mcg of 10 mg in 2 mL: 5 units on the 100-unit syringe.
      await expect(plans.nth(0).locator("[data-slot=saved-mixture]")).toContainText("10 mg + 2 mL · 5 mg/mL");
      await expect(plans.nth(0).locator("[data-slot=saved-mixture]")).toContainText("5 units · 100-unit");
      await expect(plans.nth(0).locator("[data-slot=guidance]")).toContainText("Four weeks off after eight weeks on.");
      await expect(plans.nth(1).locator("[data-slot=saved-mixture]")).toContainText("Set one up");
      expect(await noSideScroll(page)).toBe(true);

      let logLate;
      if (phone) {
        await expect(page.getByTestId("cycle-timeline")).toBeHidden();
        await expect(page.getByTestId("tile-adherence").locator("[data-slot=value]")).toHaveText("40");
        await expect(page.getByTestId("tile-adherence").locator("[data-slot=context]")).toHaveText("2 of 5 doses");
        await expect(page.getByTestId("tile-missed").locator("[data-slot=value]")).toHaveText("2");
        await expect(page.getByTestId("tile-skipped").locator("[data-slot=value]")).toHaveText("1");
        const rows = page.getByTestId("history-row");
        expect(await rows.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-state")))).toEqual(["due", "missed", "missed", "skipped"]);
        await expect(rows.nth(1)).toContainText(`${seed.B} · 2.5 mg · Not logged`);
        await expect(rows.nth(3)).toContainText(`${seed.A} · 250 mcg · Skipped`);
        await expect(page.getByTestId("history-all").getByText("See all 6")).toBeVisible();
        logLate = rows.nth(1).getByRole("link", { name: "Log late dose" });
      } else {
        await expect(page.getByTestId("cycle-timeline").getByTestId("timeline-row")).toHaveCount(2);
        await expect(page.getByTestId("tile-adherence-laptop").locator("[data-slot=value]")).toHaveText("40%");
        await expect(page.getByTestId("tile-missed-laptop").locator("[data-slot=value]")).toHaveText("2 · 1");
        const rows = page.getByTestId("history-table-row");
        expect(await rows.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-state")))).toEqual(["due", "missed", "missed", "skipped", "taken", "taken"]);
        await expect(rows.nth(4).getByRole("cell").nth(4)).toHaveText("Abdomen L");
        logLate = rows.nth(1).getByRole("link", { name: "Log late dose" });
      }
      await shot(page, "detail", device);

      // The missed B dose (yesterday 20:00): its log-late sheet on Today.
      await (await hydrated(logLate)).click();
      await expect(page).toHaveURL(/\/app\/today\?dose=/);
      const sheet = page.getByRole("dialog", { name: seed.B });
      await expect(sheet).toContainText("Not logged");
      await expect(sheet.getByLabel("Date")).toHaveValue(d(-1));
      await sheet.getByLabel("Time", { exact: true }).fill("21:00");
      await sheet.getByRole("button", { name: "Log at 9:00 PM" }).click();
      await expect(page.getByRole("status").filter({ hasText: `${seed.B} · 2.5 mg logged at 9:00 PM` })).toBeVisible();

      await page.goto(`${APP_ORIGIN}/app/cycles/${seed.cycleId}`);
      if (phone) {
        await expect(page.getByTestId("tile-adherence").locator("[data-slot=value]")).toHaveText("60");
        await expect(page.getByTestId("tile-missed").locator("[data-slot=value]")).toHaveText("1");
        await expect(page.getByTestId("history-row").nth(1)).toHaveAttribute("data-state", "taken");
      } else {
        await expect(page.getByTestId("tile-adherence-laptop").locator("[data-slot=value]")).toHaveText("60%");
        await expect(page.getByTestId("history-table-row").nth(1)).toHaveAttribute("data-state", "taken");
      }

      // The full history.
      await page.goto(`${APP_ORIGIN}/app/cycles/${seed.cycleId}/history`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("History");
      expect(await noSideScroll(page)).toBe(true);
    });

    test("build a cycle from scratch, step by step", async ({ page }) => {
      const t = tag();
      const email = uniqueEmail(`v2-build-${device}`);
      await ensureAccount({ email, name: "Builder", role: "researcher" });
      const [A, B] = [`BPC ${t}`, `TB ${t}`];
      await seedPeptide(A);
      await seedPeptide(B);
      await signIn(page, email);

      // No cycles yet: the empty state leads to the builder.
      await page.goto(`${APP_ORIGIN}/app/cycles`);
      await expect(page.getByTestId("cycles-empty")).toBeVisible();
      await (await hydrated(page.getByRole("link", { name: "Build a cycle" }))).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles/new`);
      const builder = page.getByTestId("cycle-builder");
      await expect(builder).toHaveAttribute("data-step", "peptides");
      await (await hydrated(page.getByLabel("Search peptides"))).fill(t);
      await page.getByRole("checkbox").filter({ hasText: A }).click();
      await page.getByRole("checkbox").filter({ hasText: B }).click();
      await page.getByLabel("Search peptides").fill("");
      expect(await noSideScroll(page)).toBe(true);
      // The shared local library holds every run's peptides: the first screen only.
      await shot(page, "builder-1-peptides", device, false);
      await page.getByRole("button", { name: "Continue with 2 peptides" }).click();

      await expect(builder).toHaveAttribute("data-step", "dose");
      await page.getByRole("group", { name: "Dose unit" }).getByRole("button", { name: "mcg" }).click();
      await page.getByLabel("Dose", { exact: true }).fill("250");
      await page.getByLabel("Vial", { exact: true }).fill("10");
      await page.getByLabel("BAC water").fill("2");
      await page.getByRole("radiogroup", { name: "Syringe (units)" }).getByRole("radio", { name: "30" }).click();
      await expect(page.getByTestId("dose-units")).toHaveText("5");
      expect(await noSideScroll(page)).toBe(true);
      await shot(page, "builder-2-dose", device);
      await page.getByRole("button", { name: "Continue", exact: true }).click();

      await expect(builder).toHaveAttribute("data-step", "schedule");
      const editor = page.getByTestId("phase-editor");
      await editor.getByLabel("Time").fill("08:00");
      await page.getByRole("button", { name: "+ Break" }).click();
      await page.getByRole("button", { name: "+ Phase" }).click();
      await editor.getByLabel("Dose", { exact: true }).fill("500");
      await expect(page.getByTestId("builder-phase")).toHaveCount(3);
      await expect(page.getByTestId("cycle-length")).toHaveText("63 days");
      await page.getByTestId("builder-phase").nth(1).getByRole("button").first().click();
      expect(await noSideScroll(page)).toBe(true);
      await shot(page, "builder-3-schedule", device);
      await page.getByRole("button", { name: `Next: ${B}` }).click();

      await page.getByLabel("Dose", { exact: true }).fill("2.5");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await editor.getByRole("group", { name: "Frequency" }).getByRole("button", { name: "Weekdays" }).click();
      await editor.getByRole("group", { name: "Weekdays" }).getByRole("button", { name: "Wed" }).click();
      await page.getByRole("button", { name: "Review cycle" }).click();

      await expect(builder).toHaveAttribute("data-step", "review");
      await page.getByLabel("Cycle name").fill(`Scratch ${t}`);
      await page.getByLabel("Goal").fill("Recovery");
      await expect(page.getByTestId("review-plan")).toHaveCount(2);
      await expect(page.getByTestId("review-plan").nth(0)).toContainText("5 units · 30-unit");
      expect(await noSideScroll(page)).toBe(true);
      await shot(page, "builder-4-review", device);
      await page.getByRole("button", { name: "Start cycle" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Cycle saved." })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Scratch ${t}`);
      await expect(page.getByTestId("cycle-status")).toHaveAttribute("data-status", "Upcoming");
      await expect(page.getByTestId("cycle-plan-card").nth(0).locator("[data-slot=saved-mixture]")).toContainText("5 units · 30-unit");
      await expect(page.getByTestId("cycle-plan-card").nth(1).locator("[data-slot=schedule]")).toHaveText("2.5 mg · Mon and Fri · 8:00 AM");
    });

    test("start from a template, then edit the future plan", async ({ page }) => {
      const t = tag();
      const email = uniqueEmail(`v2-template-${device}`);
      await ensureAccount({ email, name: "Copier", role: "researcher" });
      const [A, B] = [`BPC ${t}`, `TB ${t}`];
      const [aId, bId] = [await seedPeptide(A), await seedPeptide(B)];
      const template = await seedTemplate(t, [aId, bId]);
      await signIn(page, email);

      await page.goto(`${APP_ORIGIN}/app/cycles/templates`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Templates");
      await (await hydrated(page.getByTestId("cycle-template").filter({ hasText: template.name }))).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles/new?template=${template.id}`);
      await expect(page.getByTestId("template-note")).toContainText(template.name);
      await expect(page.getByTestId("selected-peptides").getByRole("checkbox")).toHaveText([A, B]);
      await (await hydrated(page.getByRole("button", { name: "Continue with 2 peptides" }))).click();
      await expect(page.getByLabel("Dose", { exact: true })).toHaveValue("250");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByTestId("builder-phase")).toHaveCount(2);
      await page.getByRole("button", { name: `Next: ${B}` }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByTestId("phase-editor").getByRole("group", { name: "Weekdays" }).locator("[aria-pressed=true]")).toHaveText(["Mon", "Thu"]);
      await page.getByRole("button", { name: "Review cycle" }).click();
      await expect(page.getByLabel("Cycle name")).toHaveValue(template.name);
      await page.getByLabel("Goal").fill("Recovery");
      await page.getByRole("button", { name: "Start cycle" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Cycle saved." })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(template.name);
      const cycleId = page.url().split("/").pop()!;

      // Edit future plan: the same flow, prefilled; A's dose from 250 to 300 mcg.
      await (await hydrated(page.getByRole("link", { name: "Edit future plan" }))).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles/${cycleId}/edit`);
      await expect(page.getByTestId("builder-title")).toHaveText("Edit future plan");
      await (await hydrated(page.getByRole("button", { name: "Continue with 2 peptides" }))).click();
      await page.getByLabel("Dose", { exact: true }).fill("300");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: `Next: ${B}` }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Review cycle" }).click();
      await page.getByRole("button", { name: "Save future changes" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Future plan updated. Recorded history is unchanged." })).toBeVisible();
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles/${cycleId}`);
      await expect(page.getByTestId("cycle-plan-card").nth(0).locator("[data-slot=schedule]")).toHaveText("300 mcg · daily · 8:00 AM");
      const { data: cycle } = await serviceClient().from("cycles").select("current_revision").eq("id", cycleId).single();
      expect(cycle?.current_revision).toBe(2);
    });
  });
}
