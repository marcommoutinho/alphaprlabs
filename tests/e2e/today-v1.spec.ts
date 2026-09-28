// V1 Today (design v3) on a phone and a laptop, light and dark, against the
// real local Supabase: Taken then Undo, Skip and Mark skipped, a late dose
// through R2b, the check-in sheet (R6) and the empty state (R9a). Cycles use
// a fixed-offset zone where it is about 12:00 now (tests/support/noon.ts),
// seeded by tests/support/today.ts: A due at 08:00 (8 units, or 20 with a
// tracked vial), B due at 09:00, both also unconfirmed from earlier days.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { d, noonZoneInstant } from "../support/noon";
import { hydrated, ok, serviceClient, signInAs } from "../support/local-supabase";
import { seedEmpty, seedToday } from "../support/today";

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 820 };

async function open(page: Page, email: string) {
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
}
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const table = async (name: "dose_records" | "dose_skips" | "dose_voids", cycleId: string): Promise<Record<string, unknown>[]> => {
  const { data, error } = await serviceClient().from(name as "dose_records").select("*").eq("cycle_id", cycleId);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? []) as unknown as Record<string, unknown>[];
};
const darkPaper = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe("phone, light", () => {
  test.use({ viewport: PHONE, colorScheme: "light" });

  test("Taken logs in one tap; Undo retracts it and the dose is due again", async ({ page }) => {
    const { email, A, cycleId } = await seedToday("undo");
    await open(page, email);
    const hero = page.getByTestId("today-hero");
    await expect(hero.getByTestId("hero-name")).toHaveText(A);
    await expect(page.getByTestId("today-done")).toHaveText("0 of 3 done");
    // Items 1-4 of R1 are within the first screen: the header, the Now block, the overdue rows and the check-in card start above the tab bar.
    await expect(page.getByTestId("today-checkin")).toBeInViewport();
    expect(await noSideScroll(page)).toBe(true);

    await (await hydrated(hero.getByRole("button", { name: "Taken", exact: true }))).click();
    const toast = page.getByRole("status").filter({ hasText: `${A} · 400 mcg logged at ` });
    await expect(toast).toBeVisible();
    await expect(page.getByTestId("today-done")).toHaveText("1 of 3 done");
    await expect(hero.getByTestId("hero-name")).not.toHaveText(A);
    expect(await table("dose_records", cycleId)).toHaveLength(1);

    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Undone. ${A} is open again.` })).toBeVisible();
    // The Now block is back on A, due now; nothing is recorded, and the audit trail keeps what was undone.
    await expect(hero.getByTestId("hero-name")).toHaveText(A);
    await expect(page.getByTestId("today-done")).toHaveText("0 of 3 done");
    expect(await table("dose_records", cycleId)).toEqual([]);
    const [voided] = await table("dose_voids", cycleId);
    expect(voided).toMatchObject({ kind: "taken" });

    // A new Taken records it again (a new request).
    await hero.getByRole("button", { name: "Taken", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: `${A} · 400 mcg logged at ` })).toBeVisible();
    await expect.poll(async () => (await table("dose_records", cycleId)).length).toBe(1);
  });

  test("with no cycle: the empty state, and the check-in card still shows", async ({ page }) => {
    const { email } = await seedEmpty("light");
    await open(page, email);
    const empty = page.getByTestId("today-empty");
    await expect(empty).toContainText("No cycle running");
    await expect(empty.getByRole("link", { name: "Build a cycle" })).toHaveAttribute("href", "/app/cycles/new");
    await expect(empty.getByRole("link", { name: "Templates" })).toBeVisible();
    await expect(page.getByTestId("today-checkin")).toBeVisible();
    await expect(page.getByTestId("today-hero")).toHaveCount(0);
    expect(await noSideScroll(page)).toBe(true);
  });
});

test.describe("phone, dark", () => {
  test.use({ viewport: PHONE, colorScheme: "dark" });

  test("a late dose through R2b: Earlier at the planned time, the vial after, Log at …", async ({ page }) => {
    const { email, A, cycleId, vialLabel } = await seedToday("late", { vial: { mg: "0.6", ml: "0.3" } });
    await open(page, email);
    expect(await darkPaper(page)).not.toBe("rgb(242, 242, 238)");
    // R2 for today's dose: 0.6 mg in the vial, 0.2 left after it: less than the next planned 0.4 mg.
    await (await hydrated(page.getByTestId("today-hero").getByRole("button", { name: "Details" }))).click();
    const due = page.getByRole("dialog", { name: A });
    await expect(due.getByTestId("sheet-reading")).toHaveText("20");
    const after = due.getByTestId("sheet-vial-after");
    await expect(after).toHaveAttribute("data-low", "true");
    await expect(after).toContainText("Vial after · low");
    await expect(after).toContainText("200 mcg");
    await expect(after).toContainText(`vial ${vialLabel}`);
    // The draw's syringe switch re-scales the ruler; the units stay.
    await due.getByRole("button", { name: "30", exact: true }).click();
    await expect(due.getByTestId("sheet-reading")).toHaveText("20");
    await expect(due).toContainText("of 0.3 mL");
    await due.getByRole("button", { name: "Close" }).first().click();
    await expect(due).toBeHidden();

    await (await hydrated(page.getByTestId("today-overdue").filter({ hasText: A }).getByRole("button", { name: "Log" }))).click();
    const sheet = page.getByRole("dialog", { name: A });
    await expect(sheet).toContainText(`Not logged · ${new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d(-2)}T12:00:00Z`))} 8:00 AM`);
    // At the planned time (two days ago) there was no mixture, so no vial either.
    await expect(sheet.getByTestId("sheet-units")).toHaveText("no saved mixture");
    await expect(sheet.getByTestId("sheet-vial-after")).toContainText("Not tracked");
    await expect(sheet.getByRole("button", { name: "Earlier…" })).toHaveAttribute("aria-pressed", "true");
    await expect(sheet.getByLabel("Date")).toHaveValue(d(-2));
    await expect(sheet).toContainText("Planned");
    await expect(sheet).toContainText("Must be before now");
    await sheet.getByLabel("Time", { exact: true }).fill("10:15");
    await sheet.getByRole("button", { name: "Log at 10:15 AM" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: `${A} · 400 mcg logged at 10:15 AM` })).toBeVisible();

    const [dose] = await table("dose_records", cycleId);
    expect(Date.parse(dose.actual_at as string)).toBe(Date.parse(noonZoneInstant(d(-2), "10:15")));
    expect(Date.parse(dose.recorded_at as string)).toBeGreaterThan(Date.parse(dose.actual_at as string));
    expect(dose.site).toBe("Abdomen L");
    // No mixture then, so nothing was deducted: nothing is low yet. Today's Taken leaves 0.2 mg.
    await expect(page.getByTestId("today-low")).toHaveCount(0);
    await page.getByTestId("today-hero").getByRole("button", { name: "Taken", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: `${A} · 400 mcg logged at ` })).toBeVisible();
    // The vial is now low: the Supplies row says so and links to it.
    const low = page.getByTestId("today-low");
    await expect(low).toContainText(`vial ${vialLabel}`);
    await expect(low).toContainText("Low · 200 mcg left, less than the next 400 mcg dose");
    await expect(low).toHaveAttribute("href", "/app/supplies");
    expect(await noSideScroll(page)).toBe(true);
  });

  test("with no cycle, in dark mode", async ({ page }) => {
    const { email } = await seedEmpty("dark");
    await open(page, email);
    await expect(page.getByTestId("today-empty")).toContainText("No cycle running");
    await expect(page.getByTestId("today-checkin")).toBeVisible();
    expect(await darkPaper(page)).not.toBe("rgb(242, 242, 238)");
  });
});

test.describe("laptop, dark", () => {
  test.use({ viewport: LAPTOP, colorScheme: "dark" });

  test("Skip and Mark skipped resolve doses as skipped; T logs the Now dose", async ({ page }) => {
    const { email, A, B, cycleId } = await seedToday("skip");
    await open(page, email);
    const hero = page.getByTestId("today-hero");
    await expect(hero).toContainText("Press T to log");
    await expect(page.getByTestId("today-overdue-count")).toHaveText("2 overdue");

    await (await hydrated(hero.getByRole("button", { name: "Add time, site or note" }))).click();
    const sheet = page.getByRole("dialog", { name: A });
    await sheet.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: `${A} · 8:00 AM skipped` })).toBeVisible();
    const railA = page.locator('[data-testid="today-row"][data-kind="today"]').filter({ hasText: A });
    await expect(railA.getByTestId("today-row-status")).toHaveText("Skipped");
    await expect(railA.locator('[data-state="skipped"]')).toHaveCount(1);
    // Skipped counts as done for the day, not missed.
    await expect(page.getByTestId("today-done")).toHaveText("1 of 3 done");
    await expect(hero.getByTestId("hero-name")).toHaveText(B);

    // The laptop's overdue row: Mark skipped.
    const overdueB = page.getByTestId("today-overdue").filter({ hasText: B });
    await overdueB.getByRole("button", { name: "Mark skipped" }).click();
    await expect(page.getByRole("status").filter({ hasText: `${B} · 9:00 AM skipped` })).toBeVisible();
    await expect(overdueB).toHaveCount(0);
    await expect(page.getByTestId("today-overdue-count")).toHaveText("1 overdue");

    // A skipped dose opens as skipped: nothing to log.
    await railA.getByRole("button").first().click();
    const skipped = page.getByRole("dialog", { name: A });
    await expect(skipped.getByTestId("dose-skipped")).toContainText("counts as skipped, not missed");
    await expect(skipped.getByRole("button", { name: /^Taken/ })).toHaveCount(0);
    await skipped.getByRole("button", { name: "Close" }).first().click();
    await expect(skipped).toBeHidden();

    // T logs the Now block's dose.
    await page.keyboard.press("t");
    await expect(page.getByRole("status").filter({ hasText: `${B} · 1 mg logged at ` })).toBeVisible();
    await expect.poll(async () => (await table("dose_records", cycleId)).length).toBe(1);
    expect(await table("dose_skips", cycleId)).toHaveLength(2);
  });
});

test.describe("laptop, light", () => {
  test.use({ viewport: LAPTOP, colorScheme: "light" });

  test("the check-in card opens R6 with the feeling tapped; None noticed clears the others", async ({ page }) => {
    const { email, researcherId } = await seedToday("checkin");
    await open(page, email);
    await (await hydrated(page.getByTestId("today-checkin").getByRole("button", { name: "4 · Good" }))).click();
    const sheet = page.getByRole("dialog", { name: "Daily check-in" });
    await expect(sheet.getByTestId("checkin-feeling")).toHaveText("4 · Good");
    await expect(sheet.getByRole("radio", { name: "4 · Good" })).toHaveAttribute("aria-checked", "true");
    await sheet.getByRole("button", { name: "Nausea" }).click();
    await expect(sheet.getByRole("button", { name: "Nausea" })).toHaveAttribute("aria-pressed", "true");
    await sheet.getByRole("button", { name: "None noticed" }).click();
    await expect(sheet.getByRole("button", { name: "Nausea" })).toHaveAttribute("aria-pressed", "false");
    await expect(sheet.getByRole("button", { name: "None noticed" })).toHaveAttribute("aria-pressed", "true");
    await sheet.getByLabel("Measurement type").selectOption("Weight");
    await sheet.getByLabel("Value").fill("81,4");
    await sheet.getByLabel("Note").fill("Slept well");
    await sheet.getByRole("button", { name: "Save check-in" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "Check-in saved." })).toBeVisible();
    // Done for today: the card goes.
    await expect(page.getByTestId("today-checkin")).toHaveCount(0);
    const rows = await ok(
      serviceClient().from("progress_check_ins").select("feeling, effects, note, measurement_name, measurement_value::text, measurement_unit").eq("owner_id", researcherId),
      "check-ins",
    );
    expect(rows).toEqual([
      { feeling: 4, effects: ["None noticed"], note: "Slept well", measurement_name: "Weight", measurement_value: "81.4", measurement_unit: "kg" },
    ]);
  });
});
