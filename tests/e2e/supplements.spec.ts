// S16 R10 Supplements, against the real local Supabase: read the supplied
// guidance, turn tracking on, create a routine (the prototype's checks
// first), see it on Today and tap Taken (its answer is lost once, so the tap
// is retried with the same request and one Taken is recorded), then edit the
// routine: its card changes while the Taken history keeps what was taken;
// finally end it. A researcher without any cycle uses it. Nothing touches
// peptide stock. Days are America/Toronto days.
import { expect, test } from "@playwright/test";
import { APP_ORIGIN, SERVER_ORIGIN } from "../../playwright.config";
import { SAVE_FAILED_MESSAGE } from "../../src/components/app-shell/toast";
import { checkInDay } from "../../src/lib/progress/rules";
import { AMOUNT_REQUIRED, GUIDANCE_NOTE, NAME_REQUIRED, NO_ROUTINES, TRACKING_OFF } from "../../src/lib/supplements/rules";
import { NO_CYCLES_BODY, NO_CYCLES_BODY_SUPPLEMENTS } from "../../src/lib/supplements/view";
import { tag } from "../support/cycles";
import { ensureAccount, hydrated, ok, serviceClient, signInAs, uniqueEmail } from "../support/local-supabase";

test("create a routine, take it on Today once despite a retry, edit it and keep its history", async ({ page }) => {
  const t = tag();
  const email = uniqueEmail("s16-supplements");
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

  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect(page.getByTestId("today-supplement")).toHaveCount(0);
  // No cycle: the header is today in Toronto (the app's zone), and the prototype's empty note.
  const torontoToday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric" }).format(new Date());
  await expect(page.getByTestId("today-date")).toHaveAttribute("title", "America/Toronto");
  await expect(page.getByTestId("today-date")).toHaveText(torontoToday);
  await expect(page.getByTestId("today-empty-body")).toHaveText(NO_CYCLES_BODY);

  // R10: the supplied guidance; nothing tracked until turned on and a routine exists.
  await page.goto(`${APP_ORIGIN}/app/supplements`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Supplement routines");
  const supplied = page.getByTestId("supplement-guidance");
  await expect(supplied).toContainText(`Supplements A ${t}: ${guidance}`);
  await expect(supplied).toContainText(GUIDANCE_NOTE);
  await expect(page.getByTestId("supplements-off")).toHaveText(TRACKING_OFF);
  await (await hydrated(page.getByLabel("Track supplements"))).check();
  await expect(page.getByText(NO_ROUTINES)).toBeVisible();
  await expect(page.getByLabel("Track supplements")).toBeChecked();

  // The prototype's checks, then the routine (a decimal comma works; grouping doesn't).
  const form = page.getByRole("form", { name: "New routine" });
  const create = form.getByRole("button", { name: "Create routine" });
  await (await hydrated(create)).click();
  await expect(form.getByRole("alert")).toHaveText(NAME_REQUIRED);
  await form.getByLabel("Supplement").fill(name);
  await form.getByLabel("Amount").fill("2,000");
  await form.getByLabel("Unit").fill("IU");
  await create.click();
  await expect(form.getByRole("alert")).toHaveText(AMOUNT_REQUIRED);
  await form.getByLabel("Amount").fill("2000");
  // Midnight: today's occurrence is already due.
  await form.getByLabel("Daily at").fill("00:00");
  await create.click();
  await expect(page.getByRole("status").filter({ hasText: `Routine created · ${name}.` })).toBeVisible();
  const card = page.getByTestId("routine-card").filter({ hasText: name });
  await expect(card.getByTestId("routine-title")).toHaveText(`${name} · 2000 IU · daily 00:00`);
  await expect(card.getByTestId("routine-state")).toHaveText("Due today");
  await expect(card.getByTestId("routine-recent")).toHaveText(/^Since \w{3} \d{1,2} · 0 recorded in the last 2 weeks$/);
  await expect(form.getByLabel("Supplement")).toHaveValue("");

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
  expect(first).toMatchObject({ local_date: checkInDay(new Date()), name, amount: "2000", unit: "IU" });

  // The retry sends the same request: the recorded Taken comes back, and nothing more is recorded.
  await row.getByRole("button", { name: "Taken", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: `Taken · ${name} · ` })).toBeVisible();
  await expect(row.getByTestId("supplement-status")).toHaveText(/^Taken \d{1,2}:\d\d [AP]M$/);
  await expect(row.getByRole("button", { name: "Taken", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("today-empty-body")).toHaveText(NO_CYCLES_BODY);
  expect(await taken()).toEqual([first]);
  await page.unroute(/\/app\/today$/);

  // R10: taken today, with its history.
  await page.goto(`${APP_ORIGIN}/app/supplements`);
  await expect(card.getByTestId("routine-state")).toHaveText(/^Taken today \d\d:\d\d$/);
  await expect(card.getByTestId("routine-recent")).toContainText("1 recorded in the last 2 weeks");
  await (await hydrated(card.getByRole("button", { name: "History (1)" }))).click();
  const history = card.getByTestId("routine-history-row");
  await expect(history).toHaveCount(1);
  await expect(history).toContainText("2000 IU · planned 00:00");

  // Edit: a new amount, unit and time. The history keeps what was taken.
  await card.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit routine" });
  await (await hydrated(edit.getByLabel("Amount"))).fill("1,5");
  await edit.getByLabel("Unit").fill("capsules");
  await edit.getByLabel("Daily at").fill("07:30");
  await edit.getByRole("button", { name: "Save routine" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Routine saved · ${name}.` })).toBeVisible();
  await expect(edit).toHaveCount(0);
  await expect(card.getByTestId("routine-title")).toHaveText(`${name} · 1.5 capsules · daily 07:30`);
  await expect(card.getByTestId("routine-state")).toHaveText(/^Taken today \d\d:\d\d$/);
  if ((await card.getByTestId("routine-history-row").count()) === 0) await card.getByRole("button", { name: "History (1)" }).click();
  await expect(card.getByTestId("routine-history-row")).toHaveCount(1);
  await expect(card.getByTestId("routine-history-row")).toContainText("2000 IU · planned 00:00");
  expect(await taken()).toEqual([first]);
  const [routine] = await ok(serviceClient().from("supplement_routines").select("amount::text, unit, time_of_day, version").eq("owner_id", researcherId), "routine");
  expect(routine).toEqual({ amount: "1.5", unit: "capsules", time_of_day: "07:30", version: 2 });

  // Today still shows what was taken today, as it was taken.
  await page.goto(`${APP_ORIGIN}/app/today`);
  await expect(row).toContainText(`12:00 AM${name} · 2000 IU`);
  await expect(row.getByTestId("supplement-status")).toHaveText(/^Taken \d{1,2}:\d\d [AP]M$/);

  // On a phone, R10 fits without sideways scrolling.
  await page.goto(`${APP_ORIGIN}/app/supplements`);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card.getByTestId("routine-title")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // End it: it keeps its history, and nothing about peptide stock exists for this account.
  await (await hydrated(card.getByRole("button", { name: "End routine" }))).click();
  await page.getByRole("dialog", { name: "End routine" }).getByRole("button", { name: "End routine" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Routine ended. Its history is kept." })).toBeVisible();
  // Ended today: today is its last day, and what was taken today still shows.
  await expect(card.getByTestId("routine-state")).toHaveText(/^Taken today \d\d:\d\d · last day$/);
  await expect(card.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByText(NO_ROUTINES)).toBeVisible();
  for (const table of ["dose_records", "personal_vials", "personal_vial_deductions", "mixtures"] as const) {
    expect(await ok(serviceClient().from(table).select("id").eq("owner_id", researcherId), table), table).toEqual([]);
  }
});
