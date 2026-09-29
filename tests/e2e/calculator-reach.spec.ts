// The vial calculator within reach (Marco, 2026-09-29): the Cycles header's
// Calculator button, Me's "Vial calculator" row and the account menu item
// (laptop) each open it with a blank form, on a phone and a laptop; Back
// returns to where it was opened from, or to Cycles when there is nothing
// to go back to; the tab bar keeps its five tabs, Cycles current on the
// calculator. Screens for review with SHOTS_DIR.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { ensureAccount, hydrated, signInAs, uniqueEmail } from "../support/local-supabase";
import { shot as saveShot, STATIC_TAB_BAR } from "../support/shots";

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 820 };
const TABS = ["Today", "Cycles", "Progress", "Library", "Me"];

const shot = async (page: Page, name: string) => {
  await saveShot(page, `calculator-${name}`, { fullPage: true, style: STATIC_TAB_BAR });
};
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });

async function signedIn(browser: Browser, label: string, viewport: typeof PHONE) {
  const email = uniqueEmail(`calc-reach-${label}`);
  await ensureAccount({ email, name: "Jordan Reyes", role: "researcher" });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  return { context, page };
}

/** The calculator, opened with nothing filled in. */
async function expectBlankCalculator(page: Page) {
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/calculator`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Calculator");
  await expect(page.getByRole("combobox", { name: "Saved mixture" })).toHaveValue("");
  await expect(page.getByRole("alert").filter({ hasText: "Can't calculate yet" })).toContainText(
    "Enter the vial strength in mg.Enter the liquid added in mL.Enter your intended dose in mg.",
  );
  // It belongs to Cycles.
  await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText("Cycles");
}

for (const [device, viewport] of [
  ["phone", PHONE],
  ["laptop", LAPTOP],
] as const) {
  test(`on a ${device}: Cycles' Calculator button and Me's row open a blank calculator, and Back returns`, async ({ browser }) => {
    const { context, page } = await signedIn(browser, device, viewport);

    // Cycles: the header action beside +.
    await page.goto(`${APP_ORIGIN}/app/cycles`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cycles");
    const button = page.getByRole("link", { name: "Calculator" });
    await expect(button).toHaveAttribute("href", "/app/calculator");
    await expect(page.getByRole("link", { name: "New cycle" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, `cycles-header-${device}`);
    await (await hydrated(button)).click();
    await expectBlankCalculator(page);
    if (device === "phone") await expect(mainNav(page).getByRole("link")).toHaveText(TABS);
    await (await hydrated(page.getByTestId("back-link"))).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles`);

    // Me: Tools › Vial calculator; Back returns to Me.
    await page.goto(`${APP_ORIGIN}/app/me`);
    const row = page.getByTestId("me-calculator");
    await expect(row).toContainText("Vial calculator");
    await expect(page.getByRole("region", { name: "Tools" })).toContainText("Vial calculator");
    await shot(page, `me-list-${device}`);
    await (await hydrated(row)).click();
    await expectBlankCalculator(page);
    await (await hydrated(page.getByTestId("back-link"))).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/me`);
    await expect(page.getByTestId("me-calculator")).toBeVisible();

    // Opened on its own (a new tab): Back goes to Cycles.
    const fresh = await context.newPage();
    await fresh.goto(`${APP_ORIGIN}/app/calculator`);
    await expectBlankCalculator(fresh);
    await (await hydrated(fresh.getByTestId("back-link"))).click();
    await expect(fresh).toHaveURL(`${APP_ORIGIN}/app/cycles`);
    await context.close();
  });
}

test("on a laptop: the account menu's Vial calculator opens it", async ({ browser }) => {
  const { context, page } = await signedIn(browser, "menu", LAPTOP);
  const trigger = page.locator('button[aria-haspopup="menu"]');
  await (await hydrated(trigger)).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Vial calculator" }).click();
  await expectBlankCalculator(page);
  // Under Cycles: the account button isn't marked as the current section.
  await expect(trigger).not.toHaveAttribute("data-account-page");
  await trigger.click();
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Vial calculator" })).toHaveAttribute("aria-current", "page");
  await context.close();
});
