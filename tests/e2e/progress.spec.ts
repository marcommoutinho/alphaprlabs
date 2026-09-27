// S15 R9 Progress, against the real local Supabase: confirm today's dose on
// Today, check in on Progress (feeling, a chip, a note and a measurement
// typed with a decimal comma), edit the check-in in place, and see it in
// "Last 14 days" beside the confirmed dose and the cycle's phase. A second
// tab still showing the first version can't overwrite the edit. Cycles use a
// fixed-offset zone where it is about 12:00 now (tests/support/noon).
import { expect, test } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { CHECK_IN_CHANGED, CHECK_IN_SAVED, FEELING_REQUIRED, NO_CHECK_IN, NO_DOSES, NOT_EVIDENCE } from "../../src/lib/progress/rules";
import { createCycle, interval, plan, tag } from "../support/cycles";
import { d, NOON } from "../support/noon";
import { ensureAccount, hydrated, ok, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";

/** A researcher with one cycle: A every 2 days at 08:00 from two days ago, 0.4 mg. Today's 08:00 dose is due. */
async function seed() {
  const t = tag();
  const email = uniqueEmail("s15-progress");
  const researcherId = await ensureAccount({ email, name: "Progress E2E", role: "researcher" });
  const A = `Progress A ${t}`;
  const { data: peptide, error } = await serviceClient()
    .from("peptides")
    .insert({ name: A, information: `[Supplied information for ${A}]`, available: true })
    .select("id")
    .single();
  if (error || !peptide) throw new Error(`Could not seed ${A}: ${error?.message ?? "no row"}`);
  const db = await signedInClient(email);
  const cycleName = `Progress cycle ${t}`;
  await createCycle(db, { name: cycleName, goal: "Leaner by October", timeZone: NOON, plans: [plan(peptide.id, [interval(d(-2), d(20), "0.4", 2, "08:00")])] });
  return { email, researcherId, A, cycleName };
}

test("check in, edit it, and see it in history beside a confirmed dose", async ({ page, context }) => {
  const { email, researcherId, A, cycleName } = await seed();
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);

  // Confirm today's dose.
  const hero = page.getByTestId("today-hero");
  await (await hydrated(hero.getByRole("button", { name: "Taken", exact: true }))).click();
  await expect(page.getByRole("status").filter({ hasText: `Taken · ${A} · ` })).toBeVisible();

  await page.goto(`${APP_ORIGIN}/app/progress`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Progress");
  await expect(page.getByLabel("Cycle")).toHaveValue(/.+/);
  await expect(page.getByLabel("Cycle").locator("option:checked")).toHaveText(cycleName);
  await expect(page.getByTestId("progress-goal")).toContainText("Goal: Leaner by October · Baseline: not set yet · Add a baseline");
  await expect(page.getByText(NOT_EVIDENCE)).toBeVisible();

  const today = page.getByTestId("progress-day").first();
  await expect(today).toHaveAttribute("data-day", d(0));
  await expect(today.getByTestId("progress-feel")).toHaveText(NO_CHECK_IN);
  await expect(today.getByTestId("progress-doses")).toHaveText(`Doses: ${A} 0.4 mg`);
  await expect(today).toContainText(`${A}: 0.4 mg`);
  await expect(page.getByTestId("progress-day").nth(1).getByTestId("progress-doses")).toHaveText(NO_DOSES);

  // Check in: the feeling is required.
  const form = page.getByRole("form", { name: "Today's check-in" });
  const save = form.getByRole("button", { name: "Save check-in" });
  await (await hydrated(save)).click();
  await expect(form.getByRole("alert")).toHaveText(FEELING_REQUIRED);
  await form.getByRole("radio", { name: "4" }).click();
  await expect(form.getByRole("radio", { name: "4" })).toHaveAttribute("aria-checked", "true");
  await form.getByRole("button", { name: "Mild headache" }).click();
  await form.getByLabel("Note · optional").fill("Slept better.");
  await form.getByLabel("What").selectOption("Weight");
  await expect(form.getByLabel("Unit")).toHaveValue("kg");
  await form.getByLabel("Value").fill("82,4");
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: CHECK_IN_SAVED })).toBeVisible();

  const saved = page.getByRole("form", { name: /^Today's check-in · saved \d\d:\d\d$/ });
  await expect(saved.getByRole("button", { name: "Update today's check-in" })).toBeVisible();
  await expect(today.getByTestId("progress-feel")).toHaveText("4/5");
  await expect(today.getByTestId("progress-effects")).toHaveText("Mild headache");
  await expect(today.getByTestId("progress-note")).toHaveText("“Slept better.”");
  await expect(today.getByTestId("progress-measure")).toHaveText("Weight 82.4 kg");
  await expect(today.getByTestId("progress-doses")).toHaveText(`Doses: ${A} 0.4 mg`);
  // The form starts from what was saved.
  await expect(saved.getByLabel("Value")).toHaveValue("82.4");
  await expect(saved.getByRole("button", { name: "Mild headache" })).toHaveAttribute("aria-pressed", "true");

  // Another tab opened now shows version 1.
  const other = await context.newPage();
  await other.goto(`${APP_ORIGIN}/app/progress`);
  const otherForm = other.getByRole("form", { name: /^Today's check-in · saved/ });
  await hydrated(otherForm.getByRole("button", { name: "Update today's check-in" }));

  // Edit it in place: a lower feeling, and "None noticed" clears the headache.
  await (await hydrated(saved.getByRole("radio", { name: "3" }))).click();
  await saved.getByRole("button", { name: "None noticed" }).click();
  await expect(saved.getByRole("button", { name: "Mild headache" })).toHaveAttribute("aria-pressed", "false");
  await saved.getByRole("button", { name: "Update today's check-in" }).click();
  await expect(page.getByRole("status").filter({ hasText: CHECK_IN_SAVED })).toBeVisible();
  await expect(today.getByTestId("progress-feel")).toHaveText("3/5");
  await expect(today.getByTestId("progress-effects")).toHaveCount(0);
  await expect(today.getByTestId("progress-measure")).toHaveText("Weight 82.4 kg");
  await expect(today.getByTestId("progress-doses")).toHaveText(`Doses: ${A} 0.4 mg`);

  // The stale tab can't overwrite it.
  await otherForm.getByRole("radio", { name: "5" }).click();
  await otherForm.getByRole("button", { name: "Update today's check-in" }).click();
  await expect(otherForm.getByRole("alert")).toHaveText(CHECK_IN_CHANGED);

  const rows = await ok(
    serviceClient().from("progress_check_ins").select("day, feeling, effects, measurement_value::text, version").eq("owner_id", researcherId),
    "check-ins",
  );
  expect(rows).toEqual([{ day: d(0), feeling: 3, effects: ["None noticed"], measurement_value: "82.4", version: 2 }]);

  // On a phone, the screen fits without sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(today.getByTestId("progress-feel")).toHaveText("3/5");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
