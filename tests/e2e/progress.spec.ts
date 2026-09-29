// V3 R5 Progress (phone) and D3 (laptop), design v3, light and dark, against
// the real local Supabase: a week of check-ins (a gap, an effect, a weight
// on three days, written as the database owner since only today's can be
// saved through the API) beside a cycle's doses; the feeling average and
// change, the dose lane, the weight card, the tiles and the check-ins; check
// in and edit today's from the screen (R6's sheet); a check-in with an effect,
// a note and a weight beside a dose confirmed on Today, edited ("None" clears
// the effect, the note cleared) while a second tab's stale edit is refused;
// "No cycle"; a researcher
// with no cycle and no measurements; and D3's Export CSV (owner-only: a
// signed-out request gets nothing). The researchers never chose a weight
// unit, so weights are entered and shown in lb (the default); the seeded
// weights were entered in kg and are shown converted exactly, while the CSV
// keeps each value in the unit it was entered in. Days are America/Toronto days. Cycles use
// a fixed-offset zone where it is about 12:00 now (tests/support/noon).
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { addDays } from "../../src/lib/cycles/rules";
import { CSV_HEADER } from "../../src/lib/progress/csv";
import { CHECK_IN_CHANGED, CHECK_IN_SAVED, checkInDay, FEELING_REQUIRED, NO_CYCLE_OPTION, NO_DOSES, NOT_EVIDENCE } from "../../src/lib/progress/rules";
import { formatMonthDay } from "../../src/lib/format";
import { createCycle, interval, plan, tag } from "../support/cycles";
import { d, NOON, noonZoneInstant } from "../support/noon";
import { ensureAccount, hydrated, ok, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";
import { psql, quote } from "../support/psql";
import { seedPeptide } from "../support/today";

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 820 };
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const paper = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/**
 * A researcher with a cycle (A 0.4 mg every 2 days at 08:00 from 8 days ago;
 * the dose 2 days ago taken) and six check-ins over the last week, none
 * today: t-6 3 (Weight 82.4), t-5 3 (Headache), t-4 4, t-3 none (a gap),
 * t-2 4 (Weight 81.8), t-1 5 (Weight 81.6, a note with a comma).
 */
async function seed(label: string) {
  const t = tag();
  const email = uniqueEmail(`v3-progress-${label}`);
  const researcherId = await ensureAccount({ email, name: `Progress ${label}`, role: "researcher" });
  const A = `Progress A ${t}`;
  const aId = await seedPeptide(A);
  const db = await signedInClient(email);
  const cycleName = `Progress cycle ${t}`;
  const cycleId = await createCycle(db, { name: cycleName, timeZone: NOON, plans: [plan(aId, [interval(d(-8), d(20), "0.4", 2, "08:00")])] });
  const [phase] = await ok(
    serviceClient().from("cycle_revision_phases").select("plan_id, phase_id, cycle_revision_plans!inner(cycle_id)").eq("cycle_revision_plans.cycle_id", cycleId),
    "phase",
  );
  await ok(
    db.rpc("confirm_dose", {
      p_request_key: randomUUID(),
      p_occurrence_key: `${phase.plan_id}:${phase.phase_id}:3`,
      p_seen_scheduled_at: noonZoneInstant(d(-2), "08:00"),
      p_seen_dose_mg: "0.4",
      p_seen_mixture_version_id: null as unknown as string,
      p_amount_mg: "0.4",
      p_actual_at: noonZoneInstant(d(-2), "08:00"),
      p_site: "",
    }),
    "confirm_dose",
  );
  const today = checkInDay(new Date());
  const day = (n: number) => addDays(today, n);
  const weight = (value: string) => `'Weight', ${value}, 'kg', now()`;
  const none = "null, null, null, null";
  const rows = [
    [day(-6), 3, "'{None}'", "''", weight("82.4")],
    [day(-5), 3, "'{Headache}'", "''", none],
    [day(-4), 4, "'{None}'", "''", none],
    [day(-2), 4, "'{None}'", "''", weight("81.8")],
    [day(-1), 5, "'{None}'", quote("Slept 8h, felt sharp"), weight("81.6")],
  ] as const;
  psql(`insert into public.progress_check_ins
    (owner_id, day, feeling, effects, note, measurement_name, measurement_value, measurement_unit, measured_at)
    values ${rows.map(([dd, feeling, effects, note, measure]) => `(${quote(researcherId)}, ${quote(dd)}, ${feeling}, ${effects}, ${note}, ${measure})`).join(",\n")};`);
  return { email, researcherId, A, cycleName, today, day };
}

async function openProgress(page: Page, email: string, query = "?range=7d") {
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/app/progress${query}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Progress");
}

const tile = (page: Page, id: string) => page.getByTestId(id);

test.describe("phone, light", () => {
  test.use({ viewport: PHONE, colorScheme: "light" });

  test("a week beside a cycle: the average and change, the dose lane, the weight, the tiles; check in and edit today's", async ({ page }) => {
    const { email, A, cycleName, day } = await seed("phone");
    await openProgress(page, email);
    await expect(page.getByTestId("progress-header")).toContainText(cycleName);
    await expect(page.getByLabel("Cycle").locator("option:checked")).toHaveText(cycleName);
    await expect(page.getByRole("link", { name: "7 days" })).toHaveAttribute("aria-current", "page");

    // 3, 3, 4, –, 4, 5 and no check-in yet today: 3.8; the first 3 days (3.3) to the last 3 (4.5).
    const now = page.getByTestId("progress-now");
    await expect(now.getByTestId("feeling-label")).toHaveText("Feeling · 7-day average");
    await expect(now.getByTestId("feeling-average")).toHaveText("3.8");
    await expect(now.getByTestId("feeling-change")).toContainText("Up 1.2");
    await expect(now.getByTestId("feeling-change")).toContainText("first 3 days to last");
    // The cycle's lane: the dose taken, today's still to take.
    await expect(now.getByRole("img", { name: `${A}: 1 dose taken in this range` })).toBeVisible();

    const measure = page.getByTestId("measure-card");
    // 82.4 kg → 81.6 kg, shown in lb: 181.7 → 179.9.
    await expect(measure.getByTestId("measure-latest")).toHaveText("179.9");
    await expect(measure.getByTestId("measure-change")).toContainText("Down 1.8 lb");
    await expect(measure.getByTestId("measure-change")).toContainText(`since ${formatMonthDay(day(-6))}`);
    await expect(measure).toContainText("3 entries");
    await expect(tile(page, "tile-adherence")).toContainText("Adherence");
    await expect(tile(page, "tile-check-ins").locator("[data-slot=value]")).toHaveText("5");
    await expect(tile(page, "tile-check-ins").locator("[data-slot=context]")).toHaveText("of 7 days");
    await expect(tile(page, "tile-effects").locator("[data-slot=value]")).toHaveText("1");
    await expect(page.getByTestId("effect-row")).toHaveCount(1);
    await expect(page.getByTestId("effect-row")).toContainText("Headache");
    await expect(page.getByTestId("effect-row")).toContainText(formatMonthDay(day(-5)));

    // Newest first; a gap stays a gap (no row for t-3).
    const rows = page.getByTestId("progress-row");
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toHaveAttribute("data-day", day(-1));
    await expect(rows.first()).toContainText("5 · Great");
    await expect(rows.first()).toContainText("Slept 8h, felt sharp");
    await expect(rows.first()).toContainText("Weight 179.9 lb");
    await expect(page.locator(`[data-testid=progress-row][data-day="${day(-3)}"]`)).toHaveCount(0);
    await expect(page.getByText(NOT_EVIDENCE)).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);

    // Check in today: 5 · Great and a weight in lb typed with a decimal comma.
    await (await hydrated(page.getByTestId("progress-check-in"))).click();
    const sheet = page.getByRole("dialog", { name: "Daily check-in" });
    await sheet.getByRole("radio", { name: "5 · Great" }).click();
    await sheet.getByLabel("Measurement type").selectOption("Weight");
    await expect(sheet.getByText("lb", { exact: true })).toBeVisible();
    await sheet.getByLabel("Value").fill("179,1");
    await sheet.getByRole("button", { name: "Save check-in" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "Check-in saved." })).toBeVisible();
    await expect(now.getByTestId("feeling-average")).toHaveText("4.0");
    await expect(now.getByTestId("feeling-change")).toContainText("Up 1.3");
    await expect(measure.getByTestId("measure-latest")).toHaveText("179.1");
    await expect(measure.getByTestId("measure-change")).toContainText("Down 2.6 lb");
    await expect(tile(page, "tile-check-ins").locator("[data-slot=value]")).toHaveText("6");
    await expect(rows.first()).toHaveAttribute("data-day", day(0));
    await expect(rows.first()).toContainText("5 · Great");
    // Six rows: the phone shows five, then all.
    await expect(rows).toHaveCount(5);
    await page.getByRole("button", { name: "See all" }).click();
    await expect(rows).toHaveCount(6);

    // Edit today's: the sheet starts from it.
    await expect(page.getByTestId("progress-check-in")).toHaveText("Edit today's check-in");
    await page.getByTestId("progress-check-in").click();
    const edit = page.getByRole("dialog", { name: "Today's check-in" });
    await expect(edit.getByRole("radio", { name: "5 · Great" })).toHaveAttribute("aria-checked", "true");
    await expect(edit.getByLabel("Value")).toHaveValue("179.1");
    await edit.getByRole("radio", { name: "2 · Low" }).click();
    await edit.getByRole("button", { name: "Update check-in" }).click();
    await expect(edit).toBeHidden();
    await expect(rows.first()).toContainText("2 · Low");
    // 3, 3, 4, 4, 5, 2: 3.5; the last 3 days (3.7) against the first (3.3).
    await expect(now.getByTestId("feeling-average")).toHaveText("3.5");
    await expect(now.getByTestId("feeling-change")).toContainText("Up 0.3");

    // Phone Export CSV points at this range.
    await expect(page.getByTestId("export-csv-phone")).toHaveAttribute("href", `/app/progress/export?from=${day(-6)}&to=${day(0)}`);

    // No cycle: the check-ins on their own, no lanes, no adherence.
    await (await hydrated(page.getByLabel("Cycle"))).selectOption({ label: NO_CYCLE_OPTION });
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/progress?range=7d&cycle=none`);
    await expect(page.getByTestId("progress-header")).toHaveText("Check-ins only");
    await expect(now.getByRole("img", { name: new RegExp(`^${A}:`) })).toHaveCount(0);
    await expect(tile(page, "tile-adherence").locator("[data-slot=context]")).toHaveText("No cycle selected");
    await expect(now.getByTestId("feeling-average")).toHaveText("3.5");
  });

  test("check in with an effect, a note and a weight beside a confirmed dose; edit it; a stale tab can't overwrite it", async ({ page, context }) => {
    // A every 2 days at 08:00 from two days ago: today's dose is due, yesterday had none.
    const t = tag();
    const email = uniqueEmail("v3-progress-edit");
    const researcherId = await ensureAccount({ email, name: "Progress Edit", role: "researcher" });
    const A = `Progress A ${t}`;
    const aId = await seedPeptide(A);
    await createCycle(await signedInClient(email), { name: `Progress cycle ${t}`, timeZone: NOON, plans: [plan(aId, [interval(d(-2), d(20), "0.4", 2, "08:00")])] });
    const today = checkInDay(new Date());
    const yesterday = addDays(today, -1);
    psql(`insert into public.progress_check_ins (owner_id, day, feeling, effects, note) values (${quote(researcherId)}, ${quote(yesterday)}, 3, '{None}', '');`);

    // Confirm today's dose on Today.
    await signInAs(page, APP_ORIGIN, email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await (await hydrated(page.getByTestId("today-hero").getByRole("button", { name: "Taken", exact: true }))).click();
    await expect(page.getByRole("status").filter({ hasText: `${A} · 400 mcg logged at ` })).toBeVisible();
    await page.goto(`${APP_ORIGIN}/app/progress?range=7d`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Progress");

    // Yesterday: the phase, no doses.
    const rows = page.getByTestId("progress-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator("[data-slot=beside]")).toHaveText(`${A}: 400 mcg · ${NO_DOSES}`);

    // Check in: the feeling is required.
    await (await hydrated(page.getByTestId("progress-check-in"))).click();
    const sheet = page.getByRole("dialog", { name: "Daily check-in" });
    await sheet.getByRole("button", { name: "Save check-in" }).click();
    await expect(sheet.getByRole("alert")).toHaveText(FEELING_REQUIRED);
    await sheet.getByRole("radio", { name: "4 · Good" }).click();
    await expect(sheet.getByRole("radio", { name: "4 · Good" })).toHaveAttribute("aria-checked", "true");
    await expect(sheet.getByRole("alert")).toHaveCount(0);
    await sheet.getByRole("button", { name: "Headache", exact: true }).click();
    await sheet.getByLabel("Note").fill("Slept better.");
    await sheet.getByLabel("Measurement type").selectOption("Weight");
    await sheet.getByLabel("Value").fill("181,6");
    await sheet.getByRole("button", { name: "Save check-in" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: CHECK_IN_SAVED })).toBeVisible();

    // Today's row: the feeling, the note, the effect and the weight, beside the phase and the dose taken.
    const todayRow = page.locator(`[data-testid=progress-row][data-day="${today}"]`);
    await expect(rows.first()).toHaveAttribute("data-day", today);
    await expect(todayRow.locator("[data-slot=feeling]")).toHaveText("4 · Good");
    await expect(todayRow).toContainText("Slept better.");
    await expect(todayRow).toContainText("Headache · Weight 181.6 lb");
    await expect(todayRow.locator("[data-slot=beside]")).toHaveText(`${A}: 400 mcg · ${A} 400 mcg`);

    // The edit sheet starts from what was saved.
    await expect(page.getByTestId("progress-check-in")).toHaveText("Edit today's check-in");
    await page.getByTestId("progress-check-in").click();
    const edit = page.getByRole("dialog", { name: "Today's check-in" });
    await expect(edit.getByRole("radio", { name: "4 · Good" })).toHaveAttribute("aria-checked", "true");
    await expect(edit.getByRole("button", { name: "Headache", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(edit.getByLabel("Note")).toHaveValue("Slept better.");
    await expect(edit.getByLabel("Value")).toHaveValue("181.6");

    // Another tab opened now starts from version 1.
    const other = await context.newPage();
    await other.goto(`${APP_ORIGIN}/app/progress?range=7d`);
    await (await hydrated(other.getByTestId("progress-check-in"))).click();
    const stale = other.getByRole("dialog", { name: "Today's check-in" });
    await expect(stale.getByRole("radio", { name: "4 · Good" })).toHaveAttribute("aria-checked", "true");

    // Edit: a lower feeling, "None" clears the headache, the note cleared; the weight stays.
    await edit.getByRole("radio", { name: "3 · OK" }).click();
    await edit.getByRole("button", { name: "None", exact: true }).click();
    await expect(edit.getByRole("button", { name: "Headache", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(edit.getByRole("button", { name: "None", exact: true })).toHaveAttribute("aria-pressed", "true");
    await edit.getByLabel("Note").fill("");
    await edit.getByRole("button", { name: "Update check-in" }).click();
    await expect(edit).toBeHidden();
    await expect(todayRow.locator("[data-slot=feeling]")).toHaveText("3 · OK");
    await expect(todayRow).not.toContainText("Headache");
    await expect(todayRow).not.toContainText("Slept better.");
    await expect(todayRow).toContainText("Weight 181.6 lb");
    await expect(todayRow.locator("[data-slot=beside]")).toHaveText(`${A}: 400 mcg · ${A} 400 mcg`);

    // The stale tab can't overwrite it.
    await stale.getByRole("radio", { name: "5 · Great" }).click();
    await stale.getByRole("button", { name: "Update check-in" }).click();
    await expect(stale.getByRole("alert")).toHaveText(CHECK_IN_CHANGED);
    await expect(stale).toBeVisible();
    await other.close();

    const saved = await ok(
      serviceClient()
        .from("progress_check_ins")
        .select("day, feeling, effects, note, measurement_name, measurement_value::text, measurement_unit, version")
        .eq("owner_id", researcherId)
        .eq("day", today),
      "check-ins",
    );
    expect(saved).toEqual([
      { day: today, feeling: 3, effects: ["None"], note: "", measurement_name: "Weight", measurement_value: "181.6", measurement_unit: "lb", version: 2 },
    ]);
    expect(await noSideScroll(page)).toBe(true);

    // No cycle: the same check-in on its own, without the phase or doses.
    await (await hydrated(page.getByLabel("Cycle"))).selectOption({ label: NO_CYCLE_OPTION });
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/progress?range=7d&cycle=none`);
    await expect(todayRow.locator("[data-slot=feeling]")).toHaveText("3 · OK");
    await expect(todayRow).toContainText("Weight 181.6 lb");
    await expect(page.locator("[data-testid=progress-row] [data-slot=beside]")).toHaveCount(0);
  });
});

test.describe("phone, dark", () => {
  test.use({ viewport: PHONE, colorScheme: "dark" });

  test("a researcher with no cycle and no measurements checks in; the screen says what isn't there", async ({ page }) => {
    const email = uniqueEmail("v3-progress-empty");
    await ensureAccount({ email, name: "Progress Empty", role: "researcher" });
    await openProgress(page, email, "");
    expect(await paper(page)).not.toBe("rgb(242, 242, 238)");
    await expect(page.getByTestId("progress-header")).toHaveText("Check-ins only");
    await expect(page.getByLabel("Cycle")).toHaveCount(0);
    await expect(page.getByTestId("feeling-label")).toHaveText("Feeling · 30-day average");
    await expect(page.getByTestId("feeling-average")).toHaveText("—");
    await expect(page.getByTestId("feeling-change")).toHaveText("No check-ins in this range");
    await expect(page.getByTestId("measure-empty")).toBeVisible();
    await expect(page.getByTestId("measure-card")).toHaveCount(0);
    await expect(page.getByTestId("progress-empty")).toBeVisible();
    await expect(page.getByRole("link", { name: "Cycle", exact: true })).toHaveCount(0);

    await (await hydrated(page.getByTestId("progress-check-in"))).click();
    const sheet = page.getByRole("dialog", { name: "Daily check-in" });
    await sheet.getByRole("radio", { name: "3 · OK" }).click();
    await sheet.getByRole("button", { name: "Fatigue", exact: true }).click();
    await sheet.getByRole("button", { name: "Save check-in" }).click();
    await expect(sheet).toBeHidden();
    const row = page.getByTestId("progress-row");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-day", checkInDay(new Date()));
    await expect(row).toContainText("3 · OK");
    await expect(row).toContainText("Fatigue");
    await expect(page.getByTestId("feeling-average")).toHaveText("3.0");
    await expect(page.getByTestId("measure-empty")).toBeVisible();
    await expect(page.getByTestId("effect-row")).toHaveText(/Fatigue/);
    expect(await noSideScroll(page)).toBe(true);
  });
});

test.describe("laptop, light", () => {
  test.use({ viewport: LAPTOP, colorScheme: "light" });

  test("D3: the table, the cycle range and Export CSV of the researcher's own check-ins", async ({ page, browser }) => {
    const { email, cycleName, day, today } = await seed("laptop");
    await openProgress(page, email);
    await expect(page.getByTestId("progress-header")).toContainText(cycleName);
    // Two tiles on a laptop.
    await expect(tile(page, "tile-adherence")).toBeVisible();
    await expect(tile(page, "tile-check-ins")).toBeVisible();
    await expect(tile(page, "tile-effects")).toBeHidden();
    const table = page.getByRole("table", { name: "Check-ins in this range" });
    await expect(table.getByRole("columnheader")).toHaveText(["Date", "Feeling", "Unwanted", "Weight", "Note"]);
    const rows = page.getByTestId("progress-table-row");
    await expect(rows).toHaveCount(5);
    await expect(rows.first().getByRole("cell")).toHaveText([/.+/, "5 · Great", "None", "179.9 lb", "Slept 8h, felt sharp"]);
    await expect(page.locator(`[data-testid=progress-table-row][data-day="${day(-5)}"]`).getByRole("cell").nth(2)).toHaveText("Headache");
    await expect(page.getByTestId("progress-row").first()).toBeHidden();

    // Export CSV: a download of this range's check-ins, oldest first, each value in the unit it was entered in.
    const [download] = await Promise.all([page.waitForEvent("download"), (await hydrated(page.getByTestId("export-csv"))).click()]);
    expect(download.suggestedFilename()).toBe(`alpha-check-ins_${day(-6)}_to_${today}.csv`);
    const csv = readFileSync((await download.path())!, "utf8");
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines).toEqual([
      CSV_HEADER.join(","),
      `${day(-6)},3,OK,,Weight,82.4,kg,`,
      `${day(-5)},3,OK,Headache,,,,`,
      `${day(-4)},4,Good,,,,,`,
      `${day(-2)},4,Good,,Weight,81.8,kg,`,
      `${day(-1)},5,Great,,Weight,81.6,kg,"Slept 8h, felt sharp"`,
      "",
    ]);

    // A bad range is refused.
    const exportUrl = (from: string, to: string) => `/app/progress/export?from=${from}&to=${to}`;
    expect(await page.evaluate(async (url) => (await fetch(url)).status, exportUrl(today, day(-6)))).toBe(400);
    // Signed out, the export answers nothing.
    const anonymous = await browser.newContext();
    const refused = await (await anonymous.newPage()).goto(`${APP_ORIGIN}${exportUrl(day(-6), today)}`);
    // (The proxy sends a request without a session to sign in; the route itself answers 401 without a researcher.)
    expect(new URL(refused!.url()).pathname).toBe("/auth");
    expect(refused!.headers()["content-type"]).not.toContain("text/csv");
    expect(await refused!.text()).not.toContain("Date,Feeling");
    await anonymous.close();

    // The cycle range: from a week before its start, the lead-in hatched.
    await page.getByRole("link", { name: "Cycle", exact: true }).click();
    await expect(page).toHaveURL(/range=cycle/);
    await expect(page.getByTestId("feeling-label")).toHaveText("Feeling · cycle average");
    await expect(page.getByTestId("progress-now")).toContainText("before cycle");
    expect(await noSideScroll(page)).toBe(true);
  });
});
