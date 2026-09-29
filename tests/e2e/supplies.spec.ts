// V3 R7 Supplies · Vials (design v3) on a laptop and a phone, light and
// dark, against the real local Supabase. Laptop: turn tracking on, add a
// vial on a saved mixture, confirm the dose on Today (its answer is lost
// once, so the tap is retried with the same request) and the estimate drops
// exactly once; the vial is then Low (less than the next planned dose,
// Marco's rule), on its row, in its sheet and as the sidebar's Supplies
// "low" counter; Correct remaining sets what's left (a correction in its
// history, the Low tag and the counter go); Mark finished moves it to
// Finished with its history. Phone: unopened vials grouped by peptide and
// strength, one added with the round + and no label (its first answer lost:
// the retry reports the "Vial N" the database stored, and adds nothing more),
// and tracking off hides the list.
// Cycles use a fixed-offset zone where it is about 12:00 now (tests/support/noon).
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN, SERVER_ORIGIN } from "../../playwright.config";
import { SAVE_FAILED_MESSAGE } from "../../src/lib/app/save";
import { NO_VIALS, TRACKING_OFF } from "../../src/lib/supplies/rules";
import { createCycle, interval, plan, tag } from "../support/cycles";
import { d, NOON } from "../support/noon";
import { ensureAccount, hydrated, ok, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";
import { seedPeptide } from "../support/today";

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 820 };
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const paper = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const suppliesLink = (page: Page) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Supplies/ });

/**
 * A researcher with one cycle: A every 2 days at 08:00 from two days ago,
 * 0.4 mg, with a saved 0.7 mg / 1 mL mixture. Today's 08:00 dose is due.
 */
async function seed(label: string) {
  const t = tag();
  const email = uniqueEmail(`v3-supplies-${label}`);
  await ensureAccount({ email, name: "Supplies E2E", role: "researcher" });
  const A = `Supplies A ${t}`;
  const aId = await seedPeptide(A);
  const db = await signedInClient(email);
  const cycleId = await createCycle(db, { name: `Supplies cycle ${t}`, timeZone: NOON, plans: [plan(aId, [interval(d(-2), d(20), "0.4", 2, "08:00")])] });
  const [{ id: planId }] = await ok(db.from("cycle_plans").select("id").eq("cycle_id", cycleId), "plan");
  await ok(
    db.rpc("save_mixture", { p_peptide_id: aId, p_vial_mg: "0.7", p_liquid_ml: "1", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [planId] }),
    "mixture",
  );
  return { email, A, aId, cycleId, db };
}

async function open(page: Page, email: string) {
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
}

test.describe("laptop, light", () => {
  test.use({ viewport: LAPTOP, colorScheme: "light" });

  test("a tracked vial drops once for a retried confirmation, goes Low, is corrected and finished", async ({ page }) => {
    const { email, A, aId, cycleId } = await seed("laptop");
    await open(page, email);

    // Tracking is off at first: the list is hidden.
    await page.goto(`${APP_ORIGIN}/app/supplies`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Supplies");
    await expect(page.getByRole("link", { name: "Vials" }).first()).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("supplies-off")).toContainText(TRACKING_OFF);
    await expect(page.getByTestId("supplies-add-laptop")).toHaveCount(0);
    await (await hydrated(page.getByTestId("supplies-off").getByRole("button", { name: "Turn on" }))).click();
    await expect(page.getByTestId("supplies-empty")).toHaveText(NO_VIALS);
    // The switch lives on Me › Tracking (V4); Supplies links there while tracking is on.
    await expect(page.getByTestId("tracking-note")).toContainText("Turn it off in Me › Tracking.");

    // Add a vial on the saved mixture: its strength comes from the mixture.
    await (await hydrated(page.getByTestId("supplies-add-laptop"))).click();
    const add = page.getByRole("dialog", { name: "Add vial" });
    await add.getByLabel("Your label").fill("E2E-1");
    await expect(add.getByLabel("Saved mixture")).toHaveValue(/.+/);
    await expect(add.getByTestId("add-strength")).toHaveText("0.7 mg · from the mixture");
    await add.getByTestId("add-vial-submit").click();
    await expect(add).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "Vial E2E-1 added." })).toBeVisible();
    await expect(page.getByText("In use · 1")).toBeVisible();
    const card = page.getByTestId("vial-card").filter({ hasText: "E2E-1" });
    await expect(card).toContainText(`${A} · 700 mcg`);
    await expect(card.locator("[data-slot=meta]")).toHaveText(/^Vial E2E-1 · mixed \w{3} \d{1,2} · 0\.7 mg\/mL$/);
    await expect(card.getByTestId("vial-left")).toHaveText("700 mcg left");
    await expect(card.getByTestId("vial-forecast")).toHaveText(/^1 dose · to /);
    await expect(card.getByTestId("vial-tag")).toHaveCount(0);

    await card.click();
    const sheet = page.getByRole("dialog", { name: `${A} · 700 mcg` });
    await expect(sheet.getByTestId("vial-remaining")).toHaveText("700 mcg · 1 mL");
    await expect(sheet.getByTestId("vial-state")).toHaveText("In use");
    await expect(sheet.getByTestId("vial-uses")).toHaveText("0 confirmed doses deducted");
    // 0.7 mg covers one 400 mcg dose.
    await expect(sheet.getByTestId("vial-outlook")).toHaveText(/^About 1 dose left at the planned amounts\. Next: 400 mcg, .+ · 08:00\.$/);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // Today: nothing low yet.
    await page.goto(`${APP_ORIGIN}/app/today`);
    const hero = page.getByTestId("today-hero");
    await expect(hero.getByTestId("hero-name")).toHaveText(A);
    await expect(page.getByTestId("today-stock")).toHaveCount(0);
    await expect(suppliesLink(page)).toHaveText("Supplies");

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

    // 0.3 mg left is less than the next planned 0.4 mg (two days after the actual time): noted beside A's next dose,
    // and the sidebar's Supplies says "low".
    const next = page.locator('[data-testid="today-row"][data-status="Next"]').filter({ hasText: A });
    await expect(next.getByTestId("today-stock")).toHaveText("Vial E2E-1 is low · 300 mcg left (estimate)");
    await expect(suppliesLink(page)).toContainText("low");

    // Supplies: the estimate dropped once, tagged Low.
    await suppliesLink(page).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/supplies`);
    await expect(card.getByTestId("vial-tag")).toHaveText("Low");
    await expect(card).toHaveAttribute("data-tag", "Low");
    await expect(card.getByTestId("vial-left")).toHaveText("300 mcg left");
    await expect(card.getByTestId("vial-forecast")).toHaveText("Less than the next 400 mcg dose");
    await expect(suppliesLink(page)).toContainText("low");
    await (await hydrated(card)).click();
    await expect(sheet.getByTestId("vial-remaining")).toHaveText("300 mcg · ≈0.428571 mL");
    await expect(sheet.getByTestId("vial-state")).toHaveText("Low (estimate)");
    await expect(sheet.getByTestId("vial-uses")).toHaveText("1 confirmed dose deducted");
    await expect(sheet.getByTestId("vial-outlook")).toHaveText(/^Less than the next planned dose \(400 mcg, .+ · \d\d:\d\d\)\.$/);
    const history = sheet.getByTestId("vial-history-row");
    await expect(history).toHaveCount(1);
    await expect(history).toContainText("−400 mcg");
    await expect(history).toContainText("300 mcg left");
    expect(await noSideScroll(page)).toBe(true);

    // Correct remaining: measured 600 mcg (the unit starts in mcg under 1 mg).
    const correct = sheet.getByRole("region", { name: "Correct remaining" });
    await correct.getByLabel(/^Remaining/).fill("600");
    await correct.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Vial E2E-1 set to 600 mcg left." })).toBeVisible();
    await expect(sheet.getByTestId("vial-sheet-left")).toHaveText("600 mcg left");
    await expect(sheet.getByTestId("vial-state")).toHaveText("In use");
    await expect(history).toHaveCount(2);
    await expect(history.first()).toHaveAttribute("data-kind", "correction");
    await expect(history.first()).toContainText("Corrected +300 mcg");
    await expect(history.first()).toContainText("600 mcg left");
    await expect(history.first().getByRole("link", { name: "View dose" })).toHaveCount(0);
    // Behind the sheet: the row's Low tag and the sidebar's counter are gone.
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(card.getByTestId("vial-tag")).toHaveCount(0);
    await expect(card.getByTestId("vial-left")).toHaveText("600 mcg left");
    await expect(suppliesLink(page)).toHaveText("Supplies");
    await card.click();
    await expect(sheet.getByTestId("vial-sheet-left")).toHaveText("600 mcg left");
    const [vial] = await ok(serviceClient().from("personal_vials").select("id").eq("peptide_id", aId).eq("label", "E2E-1"), "vial");
    const rows = await ok(
      serviceClient().from("personal_vial_deductions").select("kind, amount_mg::text, remaining_after_mg::text").eq("vial_id", vial.id).order("vial_sequence"),
      "deductions",
    );
    expect(rows).toEqual([
      { kind: "dose", amount_mg: "0.4", remaining_after_mg: "0.3" },
      { kind: "correction", amount_mg: "-0.3", remaining_after_mg: "0.6" },
    ]);

    // Mark finished asks first; the vial moves to Finished with its history.
    await sheet.getByRole("button", { name: "Mark finished" }).click();
    await expect(sheet.getByRole("alert")).toContainText("Finish vial E2E-1?");
    await sheet.getByTestId("finish-confirm").click();
    await expect(page.getByRole("status").filter({ hasText: "Vial E2E-1 finished. Its history stays here." })).toBeVisible();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId("vial-card")).toHaveCount(0);
    await expect(page.getByText("Finished · 1")).toBeVisible();
    const finished = page.getByTestId("finished-row").filter({ hasText: A });
    await expect(finished).toContainText(/Vial E2E-1 · finished \w{3} \d{1,2}/);
    await finished.click();
    const done = page.getByRole("dialog", { name: `${A} · 700 mcg` });
    await expect(done.getByTestId("vial-state")).toContainText("Finished");
    await expect(done.getByRole("region", { name: "Correct remaining" })).toHaveCount(0);
    await expect(done.getByTestId("vial-history-row")).toHaveCount(2);
    await done.getByTestId("vial-history-row").last().getByRole("link", { name: "View dose" }).click();
    await expect(page.getByRole("dialog", { name: A }).getByRole("heading", { level: 2 })).toHaveText(A);
  });
});

test.describe("phone, dark", () => {
  test.use({ viewport: PHONE, colorScheme: "dark" });

  test("unopened vials by peptide and strength, one added with +; tracking off hides the list", async ({ page }) => {
    const { email, A, aId, db } = await seed("phone");
    await ok(db.rpc("set_supply_tracking", { p_enabled: true }), "tracking on");
    for (const label of ["U-1", "U-2"]) {
      await ok(db.rpc("save_personal_vial", { p_label: label, p_peptide_id: aId, p_strength_mg: "5" }), label);
    }
    await open(page, email);
    await page.goto(`${APP_ORIGIN}/app/supplies`);
    expect(await paper(page)).not.toBe("rgb(242, 242, 238)");
    await expect(page.getByText("Unopened · 2")).toBeVisible();
    const group = page.getByTestId("unopened-row");
    await expect(group).toHaveCount(1);
    await expect(group).toContainText(`${A} · 5 mg`);
    await expect(group).toContainText("× 2");

    // Several of a kind: pick one, and its sheet says it isn't mixed.
    await (await hydrated(group)).click();
    const pick = page.getByRole("dialog", { name: `${A} · 5 mg` });
    await expect(pick).toContainText("Unopened · 2");
    await pick.getByRole("button", { name: /Vial U-2/ }).click();
    const sheet = page.getByRole("dialog", { name: `${A} · 5 mg` });
    await expect(sheet.getByTestId("vial-state")).toHaveText("Not mixed yet");
    await expect(sheet.getByTestId("vial-sheet-left")).toHaveText("5 mg left");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // The round + adds another, not mixed yet: peptide and strength.
    await page.getByTestId("supplies-add").click();
    const add = page.getByRole("dialog", { name: "Add vial" });
    await add.getByLabel("Saved mixture").selectOption({ label: "Not mixed yet" });
    await add.getByLabel("Peptide").selectOption({ label: A });
    await add.getByLabel(/^Strength/).fill("5");
    // No label: the database names it. The first answer is lost after the vial was added; the retry
    // sends the same request and reports the name stored, not a new one.
    let lost = 0;
    await page.route(/\/app\/supplies$/, async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"] && lost === 0) {
        lost += 1;
        const url = new URL(request.url());
        await route.fetch({ url: `${SERVER_ORIGIN}${url.pathname}`, headers: { ...request.headers(), host: url.host } });
        await route.abort("failed");
        return;
      }
      await route.fallback();
    });
    await add.getByTestId("add-vial-submit").click();
    await expect(page.getByRole("alert").filter({ hasText: SAVE_FAILED_MESSAGE })).toBeVisible();
    expect(lost).toBe(1);
    await expect(add).toBeVisible();
    await add.getByTestId("add-vial-submit").click();
    await expect(add).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: /^Vial 3 added\.$/ })).toBeVisible();
    await page.unroute(/\/app\/supplies$/);
    const vials = await ok(serviceClient().from("personal_vials").select("label").eq("peptide_id", aId).order("label"), "vials");
    expect(vials.map((v) => v.label)).toEqual(["U-1", "U-2", "Vial 3"]);
    await expect(group).toContainText("× 3");
    await expect(page.getByText("Unopened · 3")).toBeVisible();
    // Named once: "Vial 3" beside "Vial U-1" and "Vial U-2", never "Vial Vial 3".
    await group.click();
    await expect(pick.getByRole("button", { name: /^Vial (U-1|U-2|3)\b/ })).toHaveCount(3);
    await pick.getByRole("button", { name: /^Vial 3\b/ }).click();
    await expect(sheet.getByRole("meter", { name: "Vial 3 remaining" })).toBeVisible();
    await expect(page.getByText(/Vial Vial/)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    expect(await noSideScroll(page)).toBe(true);

    // Tracking off, from Me › Tracking: the list is hidden (nothing deleted), and + goes.
    await page.getByTestId("tracking-note").getByRole("link", { name: "Me › Tracking" }).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/me`);
    await expect(page.getByTestId("me-supplies-value")).toHaveText("On");
    await (await hydrated(page.getByTestId("me-supplies"))).click();
    const tracking = page.getByRole("dialog", { name: "Vials and supplies" });
    await expect(tracking.getByRole("switch", { name: "Track vials" })).toBeChecked();
    await tracking.getByRole("switch", { name: "Track vials" }).click();
    await expect(tracking.getByRole("switch", { name: "Track vials" })).not.toBeChecked();
    await expect(page.getByTestId("me-supplies-value")).toHaveText("Off");
    await page.goto(`${APP_ORIGIN}/app/supplies`);
    await expect(page.getByTestId("supplies-off")).toContainText(TRACKING_OFF);
    await expect(group).toHaveCount(0);
    await expect(page.getByTestId("supplies-add")).toHaveCount(0);
    await (await hydrated(page.getByTestId("supplies-off").getByRole("button", { name: "Turn on" }))).click();
    await expect(group).toContainText("× 3");

    // The Supplements tab is beside it.
    await page.getByRole("link", { name: "Supplements" }).first().click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/supplements`);
  });
});
