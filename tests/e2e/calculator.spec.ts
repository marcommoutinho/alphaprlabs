// S11 R7 Calculator: a researcher converts a dose typed with comma decimals
// (a thousands-looking value is refused, never guessed), sees the flags, saves
// the setup as a mixture linked to their cycle's peptide, and reopening that
// plan in the calculator shows the saved mixture and the same result ("saved
// mixture reproduces calculation"); a changed setup becomes a new version;
// and the screen works at phone width. Against the real local Supabase;
// names are unique per run.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { createCycle, day, interval, plan, tag } from "../support/cycles";
import { ensureAccount, hydrated, ok, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";

const RESEARCHER = { email: uniqueEmail("s11-calc"), name: "Calculator Researcher" };
const t = tag();
const PEPTIDE = `Calc peptide ${t}`;
const CYCLE = `Calc cycle ${t}`;
let planId = "";

test.beforeAll(async () => {
  // Fully parallel: a worker that runs both tests runs this twice; seed once.
  if (planId) return;
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
  const { data, error } = await serviceClient()
    .from("peptides")
    .insert({ name: PEPTIDE, information: `[Supplied information for ${PEPTIDE}]`, available: true })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not seed ${PEPTIDE}: ${error?.message ?? "no row"}`);
  const db = await signedInClient(RESEARCHER.email);
  const cycleId = await createCycle(db, { name: CYCLE, plans: [plan(data.id, [interval(day(-3), day(20), "0.35")])] });
  const plans = await ok(db.from("cycle_plans").select("id").eq("cycle_id", cycleId), "plan");
  planId = plans[0].id;
});

const units = (page: Page) => page.getByTestId("calc-units");

/** The stored mixture for the plan (secret key): its versions, oldest first. */
async function storedMixture() {
  const db = serviceClient();
  const links = await ok(db.from("cycle_plan_mixtures").select("mixture_id").eq("plan_id", planId).is("unlinked_at", null), "link");
  expect(links).toHaveLength(1);
  return ok(
    db
      .from("mixture_versions")
      .select("number, vial_mg::text, liquid_ml::text, syringe_units, line_spacing::text")
      .eq("mixture_id", links[0].mixture_id)
      .order("number"),
    "versions",
  );
}

test("calculate with comma decimals, save a mixture for a cycle peptide, and reopen it with the same result", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/app/calculator`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Calculator");
  // The calculator belongs to Cycles in the design v3 shell (V2 moves it into the cycle builder).
  await expect(page.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]')).toHaveText("Cycles");
  await expect(page.getByText("None yet. Save one above to reuse it in reminders.")).toBeVisible();

  // Nothing typed yet: every missing value is listed.
  await expect(page.getByRole("alert").filter({ hasText: "Can't calculate yet" })).toContainText(
    "Enter the vial strength in mg.Enter the liquid added in mL.Enter your intended dose in mg.",
  );

  await (await hydrated(page.getByRole("combobox", { name: "Peptide", exact: true }))).selectOption({ label: PEPTIDE });
  const vial = page.getByLabel("Vial strength (mg per vial)");
  await vial.fill("8,000");
  await page.getByLabel("Liquid added (mL)").fill("2,5");
  await page.getByLabel("Intended dose (mg) · entered by you").fill("0,35");
  // "8,000" looks like thousands: refused, not guessed.
  await expect(page.getByRole("alert").filter({ hasText: "Can't calculate yet" })).toContainText("Enter the vial strength in mg.");
  await vial.fill("8");

  // 1 mL syringe, lines every 2 units by default: 10.9375 units, between lines.
  await expect(units(page)).toHaveText("10.9375");
  await expect(page.getByTestId("calc-concentration")).toHaveText("3.2");
  await expect(page.getByTestId("calc-volume")).toHaveText("0.109375");
  await expect(page.getByText("1 mL syringes are lined every 2 units")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Flagged" })).toContainText("10.9375 units falls between the 10 and 12 lines");

  // 0.5 mL syringe: its lines are every 1 unit.
  await page.getByRole("button", { name: /^0\.5 mL/ }).click();
  await expect(page.getByRole("button", { name: /^0\.5 mL/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("0.5 mL syringes are lined every 1 unit")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Flagged" })).toContainText("between the 10 and 11 lines");

  // Save it for the cycle's peptide.
  await expect(page.getByText("Use for syringe units in")).toBeVisible();
  await page.getByLabel(CYCLE).check();
  await page.getByRole("button", { name: "Save mixture" }).click();
  await expect(page.getByRole("status")).toContainText(`Saved mixture · ${PEPTIDE} 8 mg / 2.5 mL`);
  await expect(page.getByRole("button", { name: "Update saved mixture" })).toBeVisible();
  const row = page.getByTestId("saved-mixture").filter({ hasText: PEPTIDE });
  await expect(row).toContainText(`${PEPTIDE} · 8 mg / 2.5 mL · 0.5 mL`);
  await expect(row).toContainText(`3.2 mg/mL · lines every 1 u · used by ${CYCLE}`);
  expect(await storedMixture()).toEqual([{ number: 1, vial_mg: "8", liquid_ml: "2.5", syringe_units: 50, line_spacing: "1" }]);

  // Reopen from the plan (the cycle's "Set one up" link): the saved mixture and its dose, the same result.
  await page.goto(`${APP_ORIGIN}/app/calculator?plan=${planId}`);
  await expect(page.getByRole("combobox", { name: "Saved mixture" })).toHaveValue(/[0-9a-f-]{36}/);
  await expect(page.getByRole("combobox", { name: "Saved mixture" }).locator("option:checked")).toHaveText(`${PEPTIDE} · 8 mg / 2.5 mL · 0.5 mL`);
  await expect(page.getByLabel("Intended dose (mg) · entered by you")).toHaveValue("0.35");
  await expect(page.getByLabel("Liquid added (mL)")).toHaveValue("2.5");
  await expect(units(page)).toHaveText("10.9375");
  await expect(page.getByLabel(CYCLE)).toBeChecked();

  // Mark the lines unknown and update: a new version; the first stays.
  await (await hydrated(page.getByLabel("Line spacing override"))).selectOption("unknown");
  await expect(page.getByRole("alert").filter({ hasText: "Flagged" })).toContainText("Line spacing is unknown for this syringe");
  await expect(units(page)).toHaveText("10.9375");
  await page.getByRole("button", { name: "Update saved mixture" }).click();
  await expect(page.getByRole("status")).toContainText(`Updated mixture · ${PEPTIDE} 8 mg / 2.5 mL`);
  await expect.poll(async () => (await storedMixture()).map((v) => [v.number, v.line_spacing])).toEqual([
    [1, "1"],
    [2, null],
  ]);
});

test("the calculator works at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/app/calculator?plan=${planId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Calculator");
  // The bottom tab bar, with Cycles (which owns the calculator) current.
  await expect(page.locator(".app-tabbar [aria-current='page']")).toContainText("Cycles");
  const dose = await hydrated(page.getByLabel("Intended dose (mg) · entered by you"));
  await dose.fill("0,2");
  await page.getByLabel("Vial strength (mg per vial)").fill("5");
  await page.getByLabel("Liquid added (mL)").fill("2");
  await expect(units(page)).toHaveText("8");
  // One column: the result sits below the inputs; nothing scrolls sideways.
  const [doseBox, resultBox] = [await dose.boundingBox(), await page.getByTestId("calculator-result").boundingBox()];
  expect(resultBox!.y).toBeGreaterThan(doseBox!.y + doseBox!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
