// V3 R13 Supplies · Supplements (design v3) on a laptop and a phone, light
// and dark, against the real local Supabase. Laptop: read the supplied
// guidance, turn tracking on, add a routine with the + (the prototype's
// checks first), take it on Today (its answer is lost once, so the tap is
// retried with the same request and one Taken is recorded), see it in
// "Today · 1 of 1" and the Last 7 days grid, edit it (the Taken history keeps
// what was taken), plan an end, and end it (kept under Ended). Phone: two
// routines today, Taken from the list (the next one's button is primary), the
// grid, a routine starting tomorrow, and tracking off. A researcher without
// any cycle uses it; nothing touches peptide stock. Days are America/Toronto days.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN, SERVER_ORIGIN } from "../../playwright.config";
import { SAVE_FAILED_MESSAGE } from "../../src/components/app-shell/toast";
import { addDays } from "../../src/lib/cycles/rules";
import { formatMonthDay } from "../../src/lib/format";
import { checkInDay } from "../../src/lib/progress/rules";
import { AMOUNT_REQUIRED, GUIDANCE_NOTE, NAME_REQUIRED, NO_ROUTINES, TRACKING_OFF } from "../../src/lib/supplements/rules";
import { NO_CYCLES_BODY, NO_CYCLES_BODY_SUPPLEMENTS } from "../../src/lib/supplements/view";
import { tag } from "../support/cycles";
import { ensureAccount, hydrated, ok, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 820 };
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const paper = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const cells = (row: ReturnType<Page["getByTestId"]>) => row.getByRole("cell");

test.describe("laptop, light", () => {
  test.use({ viewport: LAPTOP, colorScheme: "light" });

  test("add a routine, take it on Today once despite a retry, see the grid, edit it, plan an end and end it", async ({ page }) => {
    const t = tag();
    const email = uniqueEmail("v3-supplements");
    const researcherId = await ensureAccount({ email, name: "Supplements E2E", role: "researcher" });
    const guidance = `Vitamin D3 in the morning, with food (${t}).`;
    await ok(
      serviceClient()
        .from("peptides")
        .insert({ name: `Supplements A ${t}`, information: "[Supplied information]", supplement_guidance: guidance, available: true })
        .select("id"),
      "peptide with guidance",
    );
    const name = `Vitamin D3 ${t}`;
    const today = checkInDay(new Date());

    await signInAs(page, APP_ORIGIN, email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await expect(page.getByTestId("today-supplement")).toHaveCount(0);
    // No cycle: the header is today in Toronto (the app's zone), and the prototype's empty note.
    const torontoToday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric" }).format(new Date());
    await expect(page.getByTestId("today-date")).toHaveAttribute("title", "America/Toronto");
    await expect(page.getByTestId("today-date")).toHaveText(torontoToday);
    await expect(page.getByTestId("today-empty-body")).toHaveText(NO_CYCLES_BODY);

    // R13: the supplied guidance; nothing tracked until turned on and a routine exists.
    await page.goto(`${APP_ORIGIN}/app/supplements`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Supplies");
    await expect(page.getByRole("link", { name: "Supplements" }).first()).toHaveAttribute("aria-current", "page");
    const supplied = page.getByTestId("guidance");
    await expect(supplied).toContainText(`Supplements A ${t}`);
    await expect(supplied).toContainText(guidance);
    await expect(page.getByText(GUIDANCE_NOTE)).toBeVisible();
    await expect(page.getByTestId("supplements-off")).toContainText(TRACKING_OFF);
    await (await hydrated(page.getByTestId("supplements-off").getByRole("button", { name: "Turn on" }))).click();
    await expect(page.getByTestId("supplements-today-empty")).toHaveText(NO_ROUTINES);
    // The switch lives on Me › Tracking (V4); Supplies links there while tracking is on.
    await expect(page.getByTestId("tracking-note")).toContainText("Turn it off in Me › Tracking.");
    await expect(page.getByTestId("supplements-grid")).toHaveCount(0);

    // The + adds a routine: the prototype's checks, then the routine (a decimal comma works; grouping doesn't).
    await (await hydrated(page.getByTestId("supplies-add-laptop"))).click();
    const add = page.getByRole("dialog", { name: "Add routine" });
    await expect(add.getByLabel("Start")).toHaveValue(today);
    await add.getByTestId("routine-submit").click();
    await expect(add.getByRole("alert")).toHaveText(NAME_REQUIRED);
    await add.getByLabel("Name").fill(name);
    await add.getByLabel("Amount").fill("2,000");
    await add.getByLabel("Unit").fill("IU");
    await add.getByTestId("routine-submit").click();
    await expect(add.getByRole("alert")).toHaveText(AMOUNT_REQUIRED);
    await add.getByLabel("Amount").fill("2000");
    // Midnight: today's occurrence is already due.
    await add.getByLabel("Daily time").fill("00:00");
    await add.getByTestId("routine-submit").click();
    await expect(page.getByRole("status").filter({ hasText: `Routine created · ${name}.` })).toBeVisible();
    await expect(add).toBeHidden();
    const card = page.getByTestId("routine-card").filter({ hasText: name });
    await expect(card.getByTestId("routine-title")).toHaveText(`${name} · 2000 IU`);
    await expect(card.getByTestId("routine-state")).toHaveText("Daily · 12:00 AM · Due today");
    await expect(card.getByTestId("routine-dates")).toHaveText(`Since ${formatMonthDay(today)}`);
    await expect(page.getByText("Routines · 1")).toBeVisible();
    await expect(page.getByTestId("supplements-today-count")).toHaveText("0 of 1");
    const listRow = page.getByTestId("supplement-today-row").filter({ hasText: name });
    await expect(listRow).toHaveAttribute("data-next", "true");
    // Last 7 days: nothing before today; today still to take.
    const gridRow = page.getByTestId("grid-row").filter({ hasText: name });
    await expect(cells(gridRow)).toHaveCount(7);
    await expect(cells(gridRow).last()).toHaveAttribute("data-cell", "later");
    await expect(cells(gridRow).first()).toHaveAttribute("data-cell", "none");

    // Today lists it; the first Taken reaches the server but its answer is lost.
    await page.goto(`${APP_ORIGIN}/app/today`);
    const row = page.getByTestId("today-supplement").filter({ hasText: name });
    await expect(row).toContainText(`12:00 AM${name} · 2000 IU`);
    // Still no cycle: the same header, and the note no longer says nothing is due.
    await expect(page.getByTestId("today-date")).toHaveAttribute("title", "America/Toronto");
    await expect(page.getByTestId("today-date")).toHaveText(torontoToday);
    await expect(page.getByTestId("today-empty-body")).toHaveText(NO_CYCLES_BODY_SUPPLEMENTS);
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
    await (await hydrated(row.getByRole("button", { name: "Taken", exact: true }))).click();
    // A v3 error toast is an alert (it stays until dismissed).
    await expect(page.getByRole("alert").filter({ hasText: SAVE_FAILED_MESSAGE })).toBeVisible();
    expect(lost).toBe(1);
    const taken = () =>
      ok(serviceClient().from("supplement_taken").select("local_date, name, amount::text, unit, request_key").eq("owner_id", researcherId), "taken");
    // Recorded once already, although the screen didn't hear back.
    const [first] = await taken();
    expect(first).toMatchObject({ local_date: today, name, amount: "2000", unit: "IU" });

    // The retry sends the same request: the recorded Taken comes back, and nothing more is recorded.
    await row.getByRole("button", { name: "Taken", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: `Taken · ${name} · ` })).toBeVisible();
    await expect(row.getByTestId("supplement-status")).toHaveText(/^Taken \d{1,2}:\d\d [AP]M$/);
    await expect(row.getByRole("button", { name: "Taken", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("today-empty-body")).toHaveText(NO_CYCLES_BODY);
    expect(await taken()).toEqual([first]);
    await page.unroute(/\/app\/today$/);

    // R13: 1 of 1, taken in the list and on the grid.
    await page.goto(`${APP_ORIGIN}/app/supplements`);
    await expect(page.getByTestId("supplements-today-count")).toHaveText("1 of 1");
    await expect(listRow).toHaveAttribute("data-state", "taken");
    await expect(listRow.getByTestId("supplement-status")).toHaveText(/^Taken \d{1,2}:\d\d [AP]M$/);
    await expect(listRow.getByRole("button", { name: `Taken: ${name}` })).toHaveCount(0);
    await expect(cells(gridRow).last()).toHaveAttribute("data-cell", "taken");
    await expect(card.getByTestId("routine-state")).toHaveText(/^Daily · 12:00 AM · Taken today \d\d:\d\d$/);

    // Edit: a new amount, unit and time. The history keeps what was taken.
    await (await hydrated(card)).click();
    const edit = page.getByRole("dialog", { name });
    await expect(edit.getByTestId("routine-history-row")).toHaveCount(1);
    await expect(edit.getByTestId("routine-history-row")).toContainText("2000 IU · planned 00:00");
    await edit.getByLabel("Amount").fill("1,5");
    await edit.getByLabel("Unit").fill("capsules");
    await edit.getByLabel("Daily time").fill("07:30");
    await edit.getByTestId("routine-submit").click();
    await expect(page.getByRole("status").filter({ hasText: `Routine saved · ${name}.` })).toBeVisible();
    await expect(edit).toBeHidden();
    await expect(card.getByTestId("routine-title")).toHaveText(`${name} · 1.5 capsules`);
    await expect(card.getByTestId("routine-state")).toHaveText(/^Daily · 7:30 AM · Taken today \d\d:\d\d$/);
    expect(await taken()).toEqual([first]);
    const routine = async () =>
      (await ok(serviceClient().from("supplement_routines").select("amount::text, unit, time_of_day, start_date, end_date, version").eq("owner_id", researcherId), "routine"))[0];
    expect(await routine()).toEqual({ amount: "1.5", unit: "capsules", time_of_day: "07:30", start_date: today, end_date: null, version: 2 });

    // Plan an end in ten days: still running, and it says so.
    await card.click();
    await edit.getByLabel("End · optional").fill(addDays(today, 10));
    await edit.getByTestId("routine-submit").click();
    await expect(edit).toBeHidden();
    await expect(card.getByTestId("routine-dates")).toHaveText(`Since ${formatMonthDay(today)} · ends ${formatMonthDay(addDays(today, 10))}`);
    expect(await routine()).toMatchObject({ end_date: addDays(today, 10), version: 3 });

    // Today still shows what was taken today, as it was taken.
    await page.goto(`${APP_ORIGIN}/app/today`);
    await expect(row).toContainText(`12:00 AM${name} · 2000 IU`);
    await expect(row.getByTestId("supplement-status")).toHaveText(/^Taken \d{1,2}:\d\d [AP]M$/);

    // End it: it asks first, keeps its history and moves under Ended.
    await page.goto(`${APP_ORIGIN}/app/supplements`);
    await (await hydrated(card)).click();
    await edit.getByRole("button", { name: "End routine" }).click();
    await expect(edit.getByRole("alert")).toContainText("End this routine today?");
    await edit.getByTestId("end-confirm").click();
    await expect(page.getByRole("status").filter({ hasText: "Routine ended. Its history is kept." })).toBeVisible();
    await expect(page.getByText("Ended · 1")).toBeVisible();
    await expect(card).toHaveAttribute("data-ended", "true");
    // Ended today: today is its last day, and what was taken today still shows.
    await expect(card.getByTestId("routine-state")).toHaveText(/^Taken today \d\d:\d\d · last day$/);
    await expect(card.getByTestId("routine-dates")).toHaveText(`${formatMonthDay(today)} – ${formatMonthDay(today)}`);
    await card.click();
    await expect(edit.getByTestId("routine-ended")).toContainText("Its history is kept");
    await expect(edit.getByTestId("routine-submit")).toHaveCount(0);
    await expect(edit.getByTestId("routine-history-row")).toHaveCount(1);
    expect(await routine()).toMatchObject({ end_date: today, version: 4 });
    for (const table of ["dose_records", "personal_vials", "personal_vial_deductions", "mixtures"] as const) {
      expect(await ok(serviceClient().from(table).select("id").eq("owner_id", researcherId), table), table).toEqual([]);
    }
  });
});

test.describe("phone, dark", () => {
  test.use({ viewport: PHONE, colorScheme: "dark" });

  test("Taken from the list, the next one first; the grid; a routine starting tomorrow; tracking off", async ({ page }) => {
    const email = uniqueEmail("v3-supplements-phone");
    await ensureAccount({ email, name: "Supplements Phone", role: "researcher" });
    const db = await signedInClient(email);
    await ok(db.rpc("set_supplement_tracking", { p_enabled: true }), "tracking on");
    for (const [name, time] of [
      ["Magnesium", "00:00"],
      ["Zinc", "23:59"],
    ] as const) {
      await ok(
        db.rpc("save_supplement_routine", {
          p_id: null as unknown as string,
          p_version: null as unknown as number,
          p_name: name,
          p_amount: "1",
          p_unit: "capsule",
          p_time: time,
        }),
        name,
      );
    }
    const today = checkInDay(new Date());

    await signInAs(page, APP_ORIGIN, email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await page.goto(`${APP_ORIGIN}/app/supplements`);
    expect(await paper(page)).not.toBe("rgb(242, 242, 238)");
    await expect(page.getByTestId("supplements-today-count")).toHaveText("0 of 2");
    const rows = page.getByTestId("supplement-today-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Magnesium");
    await expect(rows.first()).toHaveAttribute("data-next", "true");
    await expect(rows.last()).toHaveAttribute("data-state", "later");
    await expect(rows.last()).not.toHaveAttribute("data-next", "true");

    // Taken from the list: Magnesium, then Zinc is next.
    await (await hydrated(page.getByRole("button", { name: "Taken: Magnesium" }))).click();
    await expect(page.getByRole("status").filter({ hasText: "Taken · Magnesium · " })).toBeVisible();
    await expect(page.getByTestId("supplements-today-count")).toHaveText("1 of 2");
    await expect(rows.first()).toHaveAttribute("data-state", "taken");
    await expect(rows.last()).toHaveAttribute("data-next", "true");

    // Last 7 days: a row per routine, by time.
    const grid = page.getByTestId("grid-row");
    await expect(grid).toHaveCount(2);
    await expect(grid.first()).toContainText("Magnesium");
    await expect(cells(grid.first()).last()).toHaveAttribute("data-cell", "taken");
    await expect(cells(grid.last()).last()).toHaveAttribute("data-cell", "later");
    await expect(page.getByRole("table", { name: "Supplements taken in the last 7 days" }).getByRole("columnheader", { name: today })).toBeVisible();

    // The round + adds one starting tomorrow: listed, not today.
    await page.getByTestId("supplies-add").click();
    const add = page.getByRole("dialog", { name: "Add routine" });
    await add.getByLabel("Name").fill("Creatine");
    await add.getByLabel("Amount").fill("5");
    await add.getByLabel("Unit").fill("g");
    await add.getByLabel("Daily time").fill("08:00");
    await add.getByLabel("Start").fill(addDays(today, 1));
    await add.getByTestId("routine-submit").click();
    await expect(add).toBeHidden();
    const creatine = page.getByTestId("routine-card").filter({ hasText: "Creatine" });
    await expect(creatine.getByTestId("routine-state")).toHaveText(`Daily · 8:00 AM · Starts ${formatMonthDay(addDays(today, 1))}`);
    await expect(page.getByText("Routines · 3")).toBeVisible();
    await expect(page.getByTestId("supplements-today-count")).toHaveText("1 of 2");
    await expect(grid).toHaveCount(2);
    expect(await noSideScroll(page)).toBe(true);

    // Tracking off, from Me › Tracking: the lists go (nothing deleted), the guidance stays.
    await page.getByTestId("tracking-note").getByRole("link", { name: "Me › Tracking" }).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/me`);
    await expect(page.getByTestId("me-supplements-value")).toHaveText(/^\d+ routines?$/);
    await (await hydrated(page.getByTestId("me-supplements"))).click();
    const tracking = page.getByRole("dialog", { name: "Supplements" });
    await tracking.getByRole("switch", { name: "Track supplements" }).click();
    await expect(tracking.getByRole("switch", { name: "Track supplements" })).not.toBeChecked();
    await expect(page.getByTestId("me-supplements-value")).toHaveText("Off");
    await page.goto(`${APP_ORIGIN}/app/supplements`);
    await expect(page.getByTestId("supplements-off")).toContainText(TRACKING_OFF);
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId("routine-card")).toHaveCount(0);
    await expect(page.getByTestId("guidance")).toBeVisible();
    await (await hydrated(page.getByTestId("supplements-off").getByRole("button", { name: "Turn on" }))).click();
    await expect(page.getByTestId("routine-card")).toHaveCount(3);
  });
});
