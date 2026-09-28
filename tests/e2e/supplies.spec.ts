// S14 R8 Personal supplies, against the real local Supabase: turn tracking
// on, add a vial on a saved mixture, confirm the dose on Today (its answer is
// lost once, so the tap is retried with the same request), and the estimate
// drops exactly once; the low-stock note then shows on Today beside the
// plan's next dose and on the vial's card, with its history. Cycles use a
// fixed-offset zone where it is about 12:00 now (tests/support/noon).
import { expect, test } from "@playwright/test";
import { APP_ORIGIN, SERVER_ORIGIN } from "../../playwright.config";
import { SAVE_FAILED_MESSAGE } from "../../src/components/app-shell/toast";
import { NO_VIALS, TRACKING_OFF } from "../../src/lib/supplies/rules";
import { createCycle, interval, plan, tag } from "../support/cycles";
import { d, NOON } from "../support/noon";
import { ensureAccount, hydrated, ok, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";

/**
 * A researcher with one cycle: A every 2 days at 08:00 from two days ago,
 * 0.4 mg, with a saved 0.7 mg / 1 mL mixture. Today's 08:00 dose is due.
 */
async function seed() {
  const t = tag();
  const email = uniqueEmail("s14-supplies");
  await ensureAccount({ email, name: "Supplies E2E", role: "researcher" });
  const A = `Supplies A ${t}`;
  const { data: peptide, error } = await serviceClient()
    .from("peptides")
    .insert({ name: A, information: `[Supplied information for ${A}]`, available: true })
    .select("id")
    .single();
  if (error || !peptide) throw new Error(`Could not seed ${A}: ${error?.message ?? "no row"}`);
  const db = await signedInClient(email);
  const cycleId = await createCycle(db, { name: `Supplies cycle ${t}`, timeZone: NOON, plans: [plan(peptide.id, [interval(d(-2), d(20), "0.4", 2, "08:00")])] });
  const [{ id: planId }] = await ok(db.from("cycle_plans").select("id").eq("cycle_id", cycleId), "plan");
  await ok(
    db.rpc("save_mixture", { p_peptide_id: peptide.id, p_vial_mg: "0.7", p_liquid_ml: "1", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [planId] }),
    "mixture",
  );
  return { email, A, cycleId };
}

test("a tracked vial drops once for a retried confirmation, and shows low stock on Today and Supplies", async ({ page }) => {
  const { email, A, cycleId } = await seed();
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);

  // Tracking is off at first: only the note shows.
  await page.goto(`${APP_ORIGIN}/app/supplies`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Personal supplies");
  await expect(page.getByTestId("supplies-off")).toHaveText(TRACKING_OFF);
  await (await hydrated(page.getByLabel("Track supplies"))).check();
  await expect(page.getByText(NO_VIALS)).toBeVisible();
  await expect(page.getByLabel("Track supplies")).toBeChecked();

  // Add a vial on the saved mixture: its strength comes from the mixture.
  const add = page.getByRole("form", { name: "Add a vial" });
  await (await hydrated(add.getByLabel("Your label · optional"))).fill("E2E-1");
  await expect(add.getByLabel("Saved mixture")).toHaveValue(/.+/);
  await expect(add.getByTestId("add-strength")).toHaveText("0.7 mg · from the mixture");
  await add.getByRole("button", { name: "Add vial" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Vial E2E-1 added." })).toBeVisible();
  const card = page.getByTestId("vial-card").filter({ hasText: "E2E-1" });
  await expect(card.getByTestId("vial-remaining")).toHaveText("0.7 mg · 1 mL");
  await expect(card.getByTestId("vial-state")).toHaveText("In use");
  await expect(card.getByTestId("vial-uses")).toHaveText("0 confirmed doses deducted");
  // 0.7 mg covers one 0.4 mg dose.
  await expect(card.getByTestId("vial-outlook")).toHaveText(/^About 1 dose left at the planned amounts\. Next: 0\.4 mg, .+ · 08:00\.$/);

  // Today: nothing low yet.
  await page.goto(`${APP_ORIGIN}/app/today`);
  const hero = page.getByTestId("today-hero");
  await expect(hero.getByTestId("hero-name")).toHaveText(A);
  await expect(page.getByTestId("today-stock")).toHaveCount(0);

  // The first confirmation reaches the server but its answer is lost; the retry sends the same request.
  let lost = 0;
  await page.route(/\/app\/today$/, async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"] && lost === 0) {
      lost += 1;
      // From the test runner (which can't resolve app.localhost): the same request, to the same app host.
      const url = new URL(request.url());
      await route.fetch({ url: `${SERVER_ORIGIN}${url.pathname}`, headers: { ...request.headers(), host: url.host } });
      await route.abort("failed");
      return;
    }
    await route.fallback();
  });
  await (await hydrated(hero.getByRole("button", { name: "Taken", exact: true }))).click();
  // A v3 error toast is an alert (it stays until dismissed).
  await expect(page.getByRole("alert").filter({ hasText: SAVE_FAILED_MESSAGE })).toBeVisible();
  expect(lost).toBe(1);
  const recorded = async () => {
    const doses = await ok(serviceClient().from("dose_records").select("id").eq("cycle_id", cycleId), "doses");
    const rows = doses.length
      ? await ok(
          serviceClient().from("personal_vial_deductions").select("amount_mg::text, remaining_after_mg::text").in("dose_id", doses.map((x) => x.id)),
          "deductions",
        )
      : [];
    return { doses: doses.length, deductions: rows };
  };
  // Recorded once already, although the screen didn't hear back.
  expect(await recorded()).toEqual({ doses: 1, deductions: [{ amount_mg: "0.4", remaining_after_mg: "0.3" }] });

  await hero.getByRole("button", { name: "Taken", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: `${A} · 400 mcg logged at ` })).toBeVisible();
  expect(await recorded()).toEqual({ doses: 1, deductions: [{ amount_mg: "0.4", remaining_after_mg: "0.3" }] });

  // 0.3 mg left is less than the next planned 0.4 mg (two days after the actual time): noted beside A's next dose.
  const next = page.locator('[data-testid="today-row"][data-status="Next"]').filter({ hasText: A });
  await expect(next.getByTestId("today-stock")).toHaveText("Vial E2E-1 is low · 300 mcg left (estimate)");

  // Supplies: the estimate dropped once, flagged low, with its history.
  await page.goto(`${APP_ORIGIN}/app/supplies`);
  await expect(card.getByTestId("vial-remaining")).toHaveText("0.3 mg · ≈0.428571 mL");
  await expect(card.getByTestId("vial-state")).toHaveText("Low (estimate)");
  await expect(card.getByTestId("vial-uses")).toHaveText("1 confirmed dose deducted");
  await expect(card.getByTestId("vial-outlook")).toHaveText(/^Less than the next planned dose \(0\.4 mg, .+ · \d\d:\d\d\)\.$/);
  // On a phone, the screen fits without sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await (await hydrated(card.getByRole("button", { name: "History (1)" }))).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const row = card.getByTestId("vial-history-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("−0.4 mg");
  await expect(row).toContainText("0.3 mg left");
  await row.getByRole("link", { name: "View dose" }).click();
  await expect(page.getByRole("dialog", { name: A }).getByRole("heading", { level: 2 })).toHaveText(A);
});
