// V4 R8 Me (design v3) against the real local Supabase: the profile, the
// Tracking rows, the preferences (stored with the account, surviving a
// reload and followed on another device) and what they change: the
// builder's and the calculator's syringe, and weights on Progress and the
// check-in; appearance on the account and this device's cookie; the grant
// history; phone and laptop, light and dark. R17 sharing end to end is
// support.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { createCycle, interval, plan, tag } from "../support/cycles";
import { ensureAccount, hydrated, ok, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";
import { d, NOON } from "../support/noon";
import { seedPeptide } from "../support/today";

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 820 };
const PAPER = { light: "rgb(242, 242, 238)", dark: "rgb(12, 13, 15)" };
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
/** Screenshots for review, only when V4_SHOTS names a folder. */
const shot = async (page: Page, name: string) => {
  if (process.env.V4_SHOTS) await page.screenshot({ path: `${process.env.V4_SHOTS}/v4-${name}.png`, fullPage: true });
};

async function account(label: string) {
  const email = uniqueEmail(`v4-me-${label}`);
  const name = `Jordan Reyes ${tag()}`;
  const id = await ensureAccount({ email, name, role: "researcher" });
  return { email, name, id };
}

async function openMe(page: Page, email: string) {
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/app/me`);
}

async function choose(page: Page, row: string, sheet: string, choice: RegExp) {
  await (await hydrated(page.getByTestId(row))).click();
  const dialog = page.getByRole("dialog", { name: sheet });
  await dialog.getByRole("radio", { name: choice }).click();
  await expect(dialog).toBeHidden();
}

for (const [device, viewport] of [
  ["phone", PHONE],
  ["laptop", LAPTOP],
] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`Me on a ${device} in ${scheme}: profile, tracking, preferences and the account rows`, async ({ browser }) => {
      const context = await browser.newContext({ viewport, colorScheme: scheme });
      const page = await context.newPage();
      const me = await account(`${device}-${scheme}`);
      await openMe(page, me.email);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(me.name);
      await expect(page.getByTestId("me-email")).toHaveText(me.email);
      await expect(page.getByTestId("me-since")).toHaveText(/^Researcher since \w{3} \d{4}$/);
      await expect(page.getByTestId("support-card")).toHaveAttribute("data-sharing", "false");
      await expect(page.getByTestId("sharing-history")).toHaveCount(0);
      await expect(page.getByTestId("me-supplies-value")).toHaveText("Off");
      await expect(page.getByTestId("me-supplements-value")).toHaveText("Off");
      await expect(page.getByTestId("me-reminders-value")).toHaveText("Off");
      // The defaults: a 100-unit syringe, kg, and the device's own appearance.
      await expect(page.getByTestId("pref-syringe-value")).toHaveText("100-unit");
      await expect(page.getByTestId("pref-weight-value")).toHaveText("kg");
      await expect(page.getByTestId("pref-appearance-value")).toHaveText("System · this device");
      await expect(page.getByText("Alpha PR Labs · research use only · v3.0")).toBeVisible();
      expect(await background(page)).toBe(PAPER[scheme]);
      expect(await noSideScroll(page)).toBe(true);
      if (device === "laptop") {
        // Two columns: Support access beside Tracking.
        const [support, tracking] = await Promise.all([page.getByTestId("support-card").boundingBox(), page.getByTestId("me-supplies").boundingBox()]);
        expect(tracking!.x).toBeGreaterThan(support!.x + support!.width);
      }
      await shot(page, `me-${device}-${scheme}`);

      // Tracking: vials on from the row's sheet.
      await (await hydrated(page.getByTestId("me-supplies"))).click();
      const vials = page.getByRole("dialog", { name: "Vials and supplies" });
      await vials.getByRole("switch", { name: "Track vials" }).click();
      await expect(vials.getByRole("switch", { name: "Track vials" })).toBeChecked();
      await expect(vials.getByRole("link", { name: "Open Supplies" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("me-supplies-value")).toHaveText("On");

      // The disclaimer, read-only, with when it was accepted.
      await page.getByTestId("me-disclaimer").click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/me/disclaimer`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("For research use only");
      await expect(page.getByTestId("disclaimer-accepted")).toContainText(/^You agreed on \w{3}, \w{3} \d+, \d{4} · \d+:\d\d [AP]M\.Version test$/);
      await expect(page.getByRole("region", { name: "Research-use disclaimer" })).toBeVisible();
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      await context.close();
    });
  }
}

test("preferences persist with the account, follow it to another device, and change the syringe and weights", async ({ browser }) => {
  test.setTimeout(90_000);
  const me = await account("prefs");
  const t = tag();
  const A = `Prefs A ${t}`;
  const aId = await seedPeptide(A);
  const context = await browser.newContext({ viewport: PHONE, colorScheme: "light" });
  const page = await context.newPage();
  await openMe(page, me.email);

  await choose(page, "pref-syringe", "Default syringe", /^30-unit/);
  await expect(page.getByTestId("pref-syringe-value")).toHaveText("30-unit");
  await choose(page, "pref-weight", "Weight unit", /^lb/);
  await expect(page.getByTestId("pref-weight-value")).toHaveText("lb");
  // Appearance: this page at once, the account and this device's cookie.
  await choose(page, "pref-appearance", "Appearance", /^Dark/);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  expect(await background(page)).toBe(PAPER.dark);
  expect((await context.cookies(APP_ORIGIN)).find((c) => c.name === "alpha-appearance")?.value).toBe("dark");
  await shot(page, "me-phone-dark-chosen");

  await page.reload();
  await expect(page.getByTestId("pref-syringe-value")).toHaveText("30-unit");
  await expect(page.getByTestId("pref-weight-value")).toHaveText("lb");
  await expect(page.getByTestId("pref-appearance-value")).toHaveText("Dark");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  const stored = await ok(serviceClient().from("account_preferences").select("default_syringe, weight_unit, appearance").eq("owner_id", me.id).single());
  expect(stored).toEqual({ default_syringe: 30, weight_unit: "lb", appearance: "dark" });

  // Another device (no cookie, a light OS): the account's choice from the first paint once signed in.
  const other = await browser.newContext({ viewport: LAPTOP, colorScheme: "light" });
  const laptop = await other.newPage();
  await signInAs(laptop, APP_ORIGIN, me.email);
  await expect(laptop).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect(laptop.locator("html")).toHaveClass(/\bdark\b/);
  await expect.poll(async () => (await other.cookies(APP_ORIGIN)).find((c) => c.name === "alpha-appearance")?.value).toBe("dark");
  await other.close();

  // The builder: R12's "Add to a cycle" preselects the peptide; a new mix starts on the 30-unit syringe.
  await page.goto(`${APP_ORIGIN}/app/cycles/new?peptide=${aId}`);
  await (await hydrated(page.getByRole("button", { name: /^Continue with 1 peptide/ }))).click();
  await expect(page.getByRole("radiogroup", { name: "Syringe (units)" }).getByRole("radio", { name: "30" })).toHaveAttribute("aria-checked", "true");
  // The calculator's new setup too.
  await page.goto(`${APP_ORIGIN}/app/calculator`);
  await expect(page.getByRole("button", { name: "0.3 mL 30 u" })).toHaveAttribute("aria-pressed", "true");

  // Weights: entered and shown in lb, stored with their unit; kg again converts exactly.
  await page.goto(`${APP_ORIGIN}/app/progress`);
  await (await hydrated(page.getByTestId("progress-check-in"))).click();
  const sheet = page.getByRole("dialog", { name: "Daily check-in" });
  await sheet.getByRole("radio", { name: "4 · Good" }).click();
  await sheet.getByLabel("Measurement type").selectOption("Weight");
  await expect(sheet.getByText("lb", { exact: true })).toBeVisible();
  await sheet.getByLabel("Value").fill("180");
  await sheet.getByRole("button", { name: "Save check-in" }).click();
  await expect(sheet).toBeHidden();
  const row = page.getByTestId("progress-row").first();
  await expect(row).toContainText("Weight 180 lb");
  const [checkIn] = await ok(serviceClient().from("progress_check_ins").select("measurement_value, measurement_unit").eq("owner_id", me.id));
  expect(checkIn).toEqual({ measurement_value: 180, measurement_unit: "lb" });
  await page.goto(`${APP_ORIGIN}/app/me`);
  await choose(page, "pref-weight", "Weight unit", /^kg/);
  await page.goto(`${APP_ORIGIN}/app/progress`);
  await expect(page.getByTestId("progress-row").first()).toContainText("Weight 81.6 kg");

  // Back to System: no forced class, the OS decides.
  await page.goto(`${APP_ORIGIN}/app/me`);
  await choose(page, "pref-appearance", "Appearance", /^System/);
  await expect(page.locator("html")).not.toHaveClass(/\b(light|dark)\b/);
  expect(await background(page)).toBe(PAPER.light);
  await context.close();
});

test("choosing the appearance this device already shows still saves it to the account", async ({ browser }) => {
  const me = await account("appearance-same");
  // This device chose Dark on its own (its cookie); the account has no choice yet.
  const context = await browser.newContext({ viewport: PHONE, colorScheme: "light" });
  await context.addCookies([{ name: "alpha-appearance", value: "dark", url: APP_ORIGIN }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openMe(page, me.email);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(page.getByTestId("pref-appearance-value")).toHaveText("Dark · this device");
  await (await hydrated(page.getByTestId("pref-appearance"))).click();
  const dialog = page.getByRole("dialog", { name: "Appearance" });
  // Nothing is checked: the account holds no choice.
  await expect(dialog.getByRole("radio", { checked: true })).toHaveCount(0);
  await dialog.getByRole("radio", { name: /^Dark/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("pref-appearance-value")).toHaveText("Dark");
  const { data: stored } = await serviceClient().from("account_preferences").select("appearance").eq("owner_id", me.id).single();
  expect(stored?.appearance).toBe("dark");
  // Now the account's: checked, and picking it again just closes the sheet.
  // (The page keeps working after the save's refresh: no React error from the theme-color tags.)
  await page.getByTestId("pref-appearance").click();
  await expect(dialog.getByRole("radio", { name: /^Dark/ })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("radio", { name: /^Dark/ }).click();
  await expect(dialog).toBeHidden();
  await page.getByTestId("pref-weight").click();
  await expect(page.getByRole("dialog", { name: "Weight unit" })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();

  // Another device with no cookie and a light OS renders the account's Dark.
  const other = await browser.newContext({ viewport: LAPTOP, colorScheme: "light" });
  const laptop = await other.newPage();
  await openMe(laptop, me.email);
  await expect(laptop.locator("html")).toHaveClass(/\bdark\b/);
  expect(await background(laptop)).toBe(PAPER.dark);
  await expect(laptop.getByTestId("pref-appearance-value")).toHaveText("Dark");
  await other.close();
});

test("the grant history lists each share and stop, newest first, on a laptop", async ({ page }) => {
  const me = await account("history");
  const db = await signedInClient(me.email);
  await ok(db.rpc("share_with_team"), "share");
  await ok(db.rpc("stop_sharing_with_team"), "stop");
  await ok(db.rpc("share_with_team"), "share again");
  await page.setViewportSize(LAPTOP);
  await openMe(page, me.email);
  await expect(page.getByTestId("support-card")).toHaveAttribute("data-sharing", "true");
  await expect(page.getByRole("switch", { name: "Let admins view my history" })).toBeChecked();
  await expect(page.getByTestId("support-since")).toHaveText(/^Shared since /);
  await expect(page.getByTestId("share-event")).toHaveCount(3);
  await expect(page.getByTestId("share-event").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-kind")))).resolves.toEqual(["shared", "stopped", "shared"]);
  await expect(page.getByTestId("sharing-history")).not.toContainText("Admin ");
  // R17 on a laptop.
  await page.getByRole("switch", { name: "Let admins view my history" }).click();
  const stop = page.getByRole("dialog", { name: "Stop sharing your history?" });
  await expect(stop).toBeVisible();
  await shot(page, "r17-stop-laptop");
  await stop.getByRole("button", { name: "Keep sharing" }).click();
  await ok(db.rpc("stop_sharing_with_team"), "stop");
  await page.reload();
  await (await hydrated(page.getByRole("switch", { name: "Let admins view my history" }))).click();
  await expect(page.getByRole("dialog", { name: "Let admins view your history?" })).toBeVisible();
  await shot(page, "r17-laptop");
});

for (const scheme of ["light", "dark"] as const) {
  test(`R17 on a phone in ${scheme}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: PHONE, colorScheme: scheme });
    const page = await context.newPage();
    const me = await account(`r17-${scheme}`);
    await openMe(page, me.email);
    await (await hydrated(page.getByRole("switch", { name: "Let admins view my history" }))).click();
    const sheet = page.getByRole("dialog", { name: "Let admins view your history?" });
    await expect(sheet.getByRole("button", { name: "Allow read-only access" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Not now" })).toBeVisible();
    await page.waitForTimeout(400); // the sheet's slide-in
    await shot(page, `r17-phone-${scheme}`);
    await context.close();
  });
}

for (const [device, viewport, scheme] of [
  ["phone", PHONE, "light"],
  ["phone", PHONE, "dark"],
  ["laptop", LAPTOP, "light"],
] as const) {
  test(`Me › Dose reminders in v3 on a ${device} in ${scheme}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, colorScheme: scheme });
    const page = await context.newPage();
    const me = await account(`reminders-${device}-${scheme}`);
    await openMe(page, me.email);
    await (await hydrated(page.getByTestId("me-reminders"))).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/notifications`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reminders on this phone");
    await expect(page.getByTestId("reminder-status")).toHaveCount(3);
    await expect(page.locator('[data-testid="reminder-status"][data-label="Push supported"]').getByTestId("reminder-status-value")).not.toHaveText("Checking…");
    // The v3 page: the paper background, no legacy shell, and the way back to Me.
    expect(await background(page)).toBe(PAPER[scheme]);
    await expect(page.locator("[data-legacy-page]")).toHaveCount(0);
    const back = device === "phone" ? page.getByRole("navigation", { name: "Dose reminders" }).getByRole("link", { name: "Me" }) : page.getByRole("link", { name: "‹ Me" });
    await expect(back).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
    await shot(page, `reminders-${device}-${scheme}`);
    await back.click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/me`);
    await context.close();
  });
}

test("a cycle's peptide keeps its saved mix syringe in the builder, whatever the default", async ({ page }) => {
  const me = await account("keep-mix");
  const t = tag();
  const aId = await seedPeptide(`Keep A ${t}`);
  const db = await signedInClient(me.email);
  const cycleId = await createCycle(db, { name: `Keep ${t}`, timeZone: NOON, plans: [plan(aId, [interval(d(1), d(20), "0.4", 2, "08:00")])] });
  const [{ id: planId }] = await ok(db.from("cycle_plans").select("id").eq("cycle_id", cycleId), "plan");
  await ok(db.rpc("save_mixture", { p_peptide_id: aId, p_vial_mg: "10", p_liquid_ml: "2", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [planId] }), "mixture");
  await openMe(page, me.email);
  await choose(page, "pref-syringe", "Default syringe", /^50-unit/);
  await page.goto(`${APP_ORIGIN}/app/cycles/${cycleId}/edit`);
  await (await hydrated(page.getByRole("button", { name: /^Continue with 1 peptide/ }))).click();
  await expect(page.getByRole("radiogroup", { name: "Syringe (units)" }).getByRole("radio", { name: "100" })).toHaveAttribute("aria-checked", "true");
});
