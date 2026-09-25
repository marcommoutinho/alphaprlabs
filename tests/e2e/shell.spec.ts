import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN, PUBLIC_ORIGIN, SERVER_ORIGIN } from "../../playwright.config";
import { ensureAccount, signInAs, uniqueEmail } from "../support/local-supabase";

// Real accounts (unique per worker) signed in through the C1 form.
const ADMIN = { email: uniqueEmail("shell-admin"), name: "Shell Admin" };
const RESEARCHER = { email: uniqueEmail("shell-researcher"), name: "Shell Researcher" };

test.beforeAll(async () => {
  await ensureAccount({ ...ADMIN, role: "admin" });
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
});

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

const ADMIN_NAV = ["Inventory", "Sales", "Library", "Templates", "Invitations", "Support"];
const RESEARCHER_NAV = ["Today", "Cycles", "Library", "Calculator", "Progress"];
const RESEARCHER_MENU = [
  "Profile & support access",
  "Notifications",
  "Personal supplies",
  "Supplements",
  "Sign out",
];

// Only the visible "Main" nav is exposed: top nav on desktop, tab bar on phone.
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const accountButton = (page: Page) => page.locator('button[aria-haspopup="menu"]');

async function expectNav(page: Page, labels: string[], active: string) {
  const links = mainNav(page).getByRole("link");
  await expect(links).toHaveText(labels);
  await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText(active);
}

async function expectMenuOpensAndClosesWithEsc(page: Page, items: string[]) {
  const button = accountButton(page);
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitem")).toHaveText(items);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toHaveAttribute("aria-expanded", "false");
}

test.describe("public site (regression control)", () => {
  for (const path of ["/", "/peptides/semaglutide"]) {
    test(`${path} keeps the public header and footer`, async ({ page }) => {
      await page.goto(`${PUBLIC_ORIGIN}${path}`);
      await expect(page.getByRole("banner").getByRole("link", { name: "Peptide Library" })).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await expect(page.locator(".app-root")).toHaveCount(0);
    });
  }
});

test("host routing redirects between the public site and the app host", async ({ request, page }) => {
  const response = await request.get(`${SERVER_ORIGIN}/admin/sales?x=1`, { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toBe(`${APP_ORIGIN}/admin/sales?x=1`);
  // Node may not resolve *.localhost, so the rest goes through Chromium.
  await page.goto(`${PUBLIC_ORIGIN}/auth`);
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth`);
  // Signed out, the app host's home asks for sign-in and comes back afterwards.
  await page.goto(`${APP_ORIGIN}/`);
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth?next=%2Fapp`);
  await page.goto(`${APP_ORIGIN}/about`);
  await expect(page).toHaveURL(`${PUBLIC_ORIGIN}/about`);
  await expect(page.getByRole("contentinfo")).toBeVisible();
});

test.describe("admin shell", () => {
  test("desktop: top nav, active indicator, account menu", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signInAs(page, APP_ORIGIN, ADMIN.email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory`);
    await page.goto(`${APP_ORIGIN}/`);
    await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inventory");
    await expectNav(page, ADMIN_NAV, "Inventory");
    await expect(mainNav(page).locator('[aria-current="page"]')).toHaveCSS(
      "box-shadow",
      "rgb(96, 165, 250) 0px -2px 0px 0px inset",
    );
    await expect(page.locator(".app-tabbar")).toBeHidden();
    await expect(accountButton(page)).toContainText("Admin");
    await expectMenuOpensAndClosesWithEsc(page, ["Sign out"]);

    await mainNav(page).getByRole("link", { name: "Sales" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sales");
    await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText("Sales");
  });

  test("phone: tab bar without Me", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signInAs(page, APP_ORIGIN, ADMIN.email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory`);
    await expect(page.locator(".app-tabbar")).toBeVisible();
    await expect(page.locator(".app-topnav")).toBeHidden();
    await expectNav(page, ADMIN_NAV, "Inventory");
    await expectMenuOpensAndClosesWithEsc(page, ["Sign out"]);
  });
});

test.describe("researcher shell", () => {
  test("desktop: no Me in the nav; account menu reaches account pages", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signInAs(page, APP_ORIGIN, RESEARCHER.email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await page.goto(`${APP_ORIGIN}/`);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await expectNav(page, RESEARCHER_NAV, "Today");
    await expect(page.locator(".app-tabbar")).toBeHidden();
    await expectMenuOpensAndClosesWithEsc(page, RESEARCHER_MENU);

    await accountButton(page).click();
    await page.getByRole("menuitem", { name: "Notifications" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reminders on this phone");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(mainNav(page).locator('[aria-current="page"]')).toHaveCount(0);
    await expect(accountButton(page)).toHaveCSS("border-color", "rgba(96, 165, 250, 0.55)");
  });

  test("phone: tab bar with Me, highlighted on account pages", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signInAs(page, APP_ORIGIN, RESEARCHER.email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await expect(page.locator(".app-tabbar")).toBeVisible();
    await expectNav(page, [...RESEARCHER_NAV, "Me"], "Today");
    await expectMenuOpensAndClosesWithEsc(page, RESEARCHER_MENU);

    await page.goto(`${APP_ORIGIN}/app/supplies`);
    await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText("Me");
  });
});
