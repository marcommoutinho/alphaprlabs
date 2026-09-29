import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN, PUBLIC_ORIGIN, SERVER_ORIGIN } from "../../playwright.config";
import { ensureAccount, hydrated, signInAs, uniqueEmail } from "../support/local-supabase";

// Design v3 shell: a docked tab bar below 760 px, a 232 px sidebar from 760 px,
// light by default, dark with the OS or a stored Appearance choice.
// Real accounts (unique per worker) signed in through the C1 form.
const ADMIN = { email: uniqueEmail("shell-admin"), name: "Shell Admin" };
const RESEARCHER = { email: uniqueEmail("shell-researcher"), name: "Shell Researcher" };

test.beforeAll(async () => {
  await ensureAccount({ ...ADMIN, role: "admin" });
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
});

const LAPTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

// `paper` in each mode (tokens.css).
const PAPER = { light: "rgb(242, 242, 238)", dark: "rgb(12, 13, 15)" } as const;
const INK = { light: "rgb(13, 14, 16)", dark: "rgb(243, 243, 240)" } as const;

const RESEARCHER_TABS = ["Today", "Cycles", "Progress", "Library", "Me"];
const ADMIN_TABS = ["Today", "Cycles", "Progress", "Business", "Me"];
const RESEARCHER_SIDEBAR = ["Today", "Cycles", "Progress", "Library", "Supplies"];
const ADMIN_SIDEBAR = ["Today", "Cycles", "Progress", "Overview", "Stock", "Ledger", "Library", "People"];
const BUSINESS = ["Overview", "Stock", "Ledger", "Library", "People"];
const ACCOUNT_MENU = ["Profile & support access", "Notifications", "Personal supplies", "Supplements", "Sign out"];

// Only the visible "Main" nav is exposed: the sidebar on a laptop, the tab bar on a phone.
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const tabBar = (page: Page) => page.locator(".app-tabbar");
const sidebar = (page: Page) => page.locator("aside").filter({ has: mainNav(page) });
const accountButton = (page: Page) => page.locator('button[aria-haspopup="menu"]');
const background = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((node) => getComputedStyle(node).backgroundColor);

async function expectNav(page: Page, labels: string[], current: string | null) {
  await expect(mainNav(page).getByRole("link")).toHaveText(labels);
  const active = mainNav(page).locator('[aria-current="page"]');
  if (current === null) await expect(active).toHaveCount(0);
  else await expect(active).toHaveText(current);
}

async function expectMenuOpensAndClosesWithEsc(page: Page) {
  const button = await hydrated(accountButton(page));
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText(ACCOUNT_MENU);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toHaveAttribute("aria-expanded", "false");
}

test.describe("public site (regression control)", () => {
  for (const path of ["/", "/peptides/semaglutide"]) {
    test(`${path} keeps the public header, footer and look`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      const response = await page.goto(`${PUBLIC_ORIGIN}${path}`);
      await expect(page.getByRole("banner").getByRole("link", { name: "Peptide Library" })).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await expect(page.locator(".alpha")).toHaveCount(0);
      // None of the private app's tokens, fonts or theme reach the public site.
      const look = await page.evaluate(() => ({
        paper: getComputedStyle(document.documentElement).getPropertyValue("--paper"),
        classes: document.documentElement.className,
        body: getComputedStyle(document.body).backgroundColor,
        font: getComputedStyle(document.body).fontFamily,
      }));
      expect(look.paper).toBe("");
      expect(look.classes).not.toMatch(/\b(dark|light)\b/);
      expect(look.body).toBe("lab(100 0 0)"); // shadcn's oklch(1 0 0) white, as before
      expect(look.font).toMatch(/Inter/);
      await expect(page.locator('meta[name="theme-color"]')).toHaveCount(0);

      // Fonts: Inter only. No Geist @font-face in the page's CSS, and every
      // preloaded font file (in the HTML or a Link header) is one of Inter's.
      const fileName = (url: string) => url.split("/").pop()!.replace(/[)"'].*$/, "");
      const fonts = await page.evaluate(() => {
        const faces: { family: string; src: string }[] = [];
        for (const sheet of Array.from(document.styleSheets)) {
          for (const rule of Array.from(sheet.cssRules)) {
            if (rule instanceof CSSFontFaceRule) {
              faces.push({ family: rule.style.getPropertyValue("font-family"), src: rule.style.getPropertyValue("src") });
            }
          }
        }
        const preloads = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="font"]')).map(
          (link) => link.href,
        );
        return { faces, preloads };
      });
      const headerPreloads = [...(response?.headers()["link"] ?? "").matchAll(/<([^>]+\.woff2)>/g)].map((match) => match[1]);
      const preloaded = [...fonts.preloads, ...headerPreloads].map(fileName);
      expect(fonts.faces.length).toBeGreaterThan(0);
      expect(fonts.faces.filter((face) => /geist/i.test(face.family))).toEqual([]);
      expect(preloaded.length).toBeGreaterThan(0);
      const interFiles = fonts.faces.filter((face) => /Inter/.test(face.family)).map((face) => face.src);
      for (const file of preloaded) {
        expect(interFiles.some((src) => src.includes(file)), `${file} is an Inter font`).toBe(true);
      }
      // No design v3 utilities in the public CSS.
      const v3Rules = await page.evaluate(() =>
        Array.from(document.styleSheets)
          .flatMap((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText))
          .filter((text) => /\.(bg-paper|text-ink|rounded-btn|laptop\\:)/.test(text)).length,
      );
      expect(v3Rules).toBe(0);
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

for (const scheme of ["light", "dark"] as const) {
  test.describe(`researcher shell · ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test("phone: five tabs with Library and Me; Me owns the account pages", async ({ page }) => {
      await page.setViewportSize(PHONE);
      await signInAs(page, APP_ORIGIN, RESEARCHER.email);
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
      await expect(tabBar(page)).toBeVisible();
      await expect(sidebar(page)).toBeHidden();
      await expect(accountButton(page)).toBeHidden();
      await expectNav(page, RESEARCHER_TABS, "Today");
      expect(await background(page, ".app-tabbar")).toBe(PAPER[scheme]);
      expect(await background(page, "body")).toBe(PAPER[scheme]);
      await expect(tabBar(page).locator('[aria-current="page"]')).toHaveCSS("color", INK[scheme]);

      await mainNav(page).getByRole("link", { name: "Cycles" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles`);
      await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText("Cycles");
      await mainNav(page).getByRole("link", { name: "Me" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/me`);
      for (const path of ["/app/supplies", "/app/supplements", "/app/notifications"]) {
        await page.goto(`${APP_ORIGIN}${path}`);
        await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText("Me");
      }
    });

    test("laptop: sidebar with Supplies and no Me; the account menu reaches the account pages", async ({ page }) => {
      await page.setViewportSize(LAPTOP);
      await signInAs(page, APP_ORIGIN, RESEARCHER.email);
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
      await page.goto(`${APP_ORIGIN}/`);
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
      await expect(tabBar(page)).toBeHidden();
      await expect(sidebar(page)).toBeVisible();
      await expect(sidebar(page)).toHaveCSS("width", "232px");
      expect(await background(page, "aside")).toBe(PAPER[scheme]);
      await expectNav(page, RESEARCHER_SIDEBAR, "Today");
      await expect(sidebar(page).getByText("Business", { exact: true })).toHaveCount(0);
      await expect(accountButton(page)).toContainText(RESEARCHER.name);
      await expect(accountButton(page)).toContainText("Researcher");
      await expectMenuOpensAndClosesWithEsc(page);

      await accountButton(page).click();
      await page.getByRole("menuitem", { name: "Notifications" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reminders on this phone");
      await expect(page.getByRole("menu")).toBeHidden();
      await expect(mainNav(page).locator('[aria-current="page"]')).toHaveCount(0);
      await expect(accountButton(page)).toHaveAttribute("data-account-page", "true");

      await mainNav(page).getByRole("link", { name: "Supplies" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/supplies`);
      await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText("Supplies");
      await page.goto(`${APP_ORIGIN}/app/supplements`);
      await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText("Supplies");
    });
  });

  test.describe(`admin shell · ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test("phone: Business replaces Library; its destinations sit at the top of the admin area", async ({ page }) => {
      await page.setViewportSize(PHONE);
      await signInAs(page, APP_ORIGIN, ADMIN.email);
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
      await expectNav(page, ADMIN_TABS, "Today");
      expect(await background(page, ".app-tabbar")).toBe(PAPER[scheme]);
      await expect(page.getByRole("navigation", { name: "Business" })).toHaveCount(0);

      await mainNav(page).getByRole("link", { name: "Business" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/business`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Business");
      await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText("Business");
      const business = page.getByRole("navigation", { name: "Business" });
      await expect(business.getByRole("link")).toHaveText(BUSINESS);
      await expect(business.locator('[aria-current="page"]')).toHaveText("Overview");

      await business.getByRole("link", { name: "Stock" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stock");
      await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText("Business");
      // A3 Stock has its own bar back to Business in place of the Business links.
      await expect(business).toHaveCount(0);
      await page.getByTestId("stock").getByRole("link", { name: "Business", exact: true }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/business`);
      await expect(business.locator('[aria-current="page"]')).toHaveText("Overview");

      await business.getByRole("link", { name: "Library" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/library`);
      // V7 A8 / A10: the Library has its own "‹ Business" bar and Peptides · N | Templates · M.
      await expect(business).toHaveCount(0);
      const library = page.getByRole("navigation", { name: "Library" });
      await expect(library.getByRole("link")).toHaveText([/^Peptides · \d+$/, /^Templates · \d+$/]);
      await library.getByRole("link", { name: /^Templates/ }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/library/templates`);
      await expect(library.locator('[aria-current="page"]')).toHaveText(/^Templates · \d+$/);
      await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText("Business");
      await page.getByRole("main").getByRole("link", { name: "Business", exact: true }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/business`);

      await mainNav(page).getByRole("link", { name: "Me" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/me`);
      await expect(page.getByRole("navigation", { name: "Business" })).toHaveCount(0);
    });

    test("laptop: Research and Business groups in one sidebar", async ({ page }) => {
      await page.setViewportSize(LAPTOP);
      await signInAs(page, APP_ORIGIN, ADMIN.email);
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
      await expectNav(page, ADMIN_SIDEBAR, "Today");
      await expect(sidebar(page).getByText("Research", { exact: true })).toBeVisible();
      await expect(sidebar(page).getByText("Business", { exact: true })).toBeVisible();
      expect(await background(page, "aside")).toBe(PAPER[scheme]);
      await expect(accountButton(page)).toContainText("Admin");
      await expectMenuOpensAndClosesWithEsc(page);

      await mainNav(page).getByRole("link", { name: "Stock" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stock");
      // The item may carry its low counter ("3 low").
      await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText(/^Stock(\d+ low)?$/);
      await expect(page.getByRole("navigation", { name: "Business" })).toBeHidden();
      await expect(tabBar(page)).toBeHidden();

      await mainNav(page).getByRole("link", { name: "People" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/people`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("People");
      await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText("People");
      // The old Invitations and Support pages now land on People.
      await page.goto(`${APP_ORIGIN}/admin/support`);
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/people`);

      await mainNav(page).getByRole("link", { name: "Overview" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/business`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");
      await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText("Overview");
      // Ledger opens the V6 Ledger (D5 on a laptop): it alone is then current.
      await mainNav(page).getByRole("link", { name: "Ledger" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/ledger`);
      await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText("Ledger");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sales and purchases");
      await mainNav(page).getByRole("link", { name: "Overview" }).click();
      await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText("Overview");
      await mainNav(page).getByRole("link", { name: "Today" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
      await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText("Today");
    });
  });
}

test("a researcher never sees Business and is refused the admin area and the gallery", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect(mainNav(page).getByRole("link", { name: "Overview" })).toHaveCount(0);
  for (const path of ["/admin", "/admin/inventory", "/admin/invitations", "/admin/people", "/admin/library", "/admin/library/templates", "/admin/design"]) {
    await page.goto(`${APP_ORIGIN}${path}`);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await expectNav(page, RESEARCHER_SIDEBAR, "Today");
  }
});

test.describe("appearance", () => {
  test("follows the OS by default: both theme-colors, the default status bar, no forced class", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(`${APP_ORIGIN}/auth`);
    await expect(page.locator("html")).not.toHaveClass(/\b(light|dark)\b/);
    await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute("content", "default");
    const colors = page.locator('meta[name="theme-color"]');
    await expect(colors).toHaveCount(2);
    await expect(colors.nth(0)).toHaveAttribute("content", "#F2F2EE");
    await expect(colors.nth(0)).toHaveAttribute("media", "(prefers-color-scheme: light)");
    await expect(colors.nth(1)).toHaveAttribute("content", "#0C0D0F");
    await expect(colors.nth(1)).toHaveAttribute("media", "(prefers-color-scheme: dark)");
    expect(await background(page, "html")).toBe(PAPER.light);
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await background(page, "html")).toBe(PAPER.dark);
  });

  for (const [forced, os] of [
    ["dark", "light"],
    ["light", "dark"],
  ] as const) {
    test(`a stored ${forced} choice beats a ${os} OS from the first paint`, async ({ browser }) => {
      // Without JavaScript, only the server's HTML and CSS can set the mode.
      const noScript = await browser.newContext({ javaScriptEnabled: false, colorScheme: os, viewport: PHONE });
      await noScript.addCookies([{ name: "alpha-appearance", value: forced, url: APP_ORIGIN }]);
      const bare = await noScript.newPage();
      await bare.goto(`${APP_ORIGIN}/auth`);
      // The server renders the class on <html> (design contract: Appearance sets .light / .dark there).
      await expect(bare.locator("html")).toHaveClass(new RegExp(`\\b${forced}\\b`));
      await expect(bare.locator("html")).not.toHaveClass(new RegExp(`\\b${os}\\b`));
      expect(await background(bare, "html")).toBe(PAPER[forced]);
      const colors = bare.locator('meta[name="theme-color"]');
      await expect(colors).toHaveCount(1);
      await expect(colors).toHaveAttribute("content", forced === "dark" ? "#0C0D0F" : "#F2F2EE");
      await noScript.close();

      const context = await browser.newContext({ colorScheme: os, viewport: PHONE });
      await context.addCookies([{ name: "alpha-appearance", value: forced, url: APP_ORIGIN }]);
      const page = await context.newPage();
      await signInAs(page, APP_ORIGIN, RESEARCHER.email);
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
      expect(await background(page, ".app-tabbar")).toBe(PAPER[forced]);
      await context.close();
    });
  }

  test("after a reload, <html>'s class, the tokens and the dark: variant agree for every stored choice, without a hydration error", async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(LAPTOP);
    await signInAs(page, APP_ORIGIN, ADMIN.email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);

    const cases = [
      // stored cookie (null: none), OS scheme, class on <html>, mode shown
      ["dark", "light", "dark", "dark"],
      ["light", "dark", "light", "light"],
      [null, "light", null, "light"],
      [null, "dark", null, "dark"],
      ["purple", "dark", null, "dark"], // a bad value is "system"
    ] as const;
    for (const [stored, os, htmlClass, shown] of cases) {
      await context.clearCookies({ name: "alpha-appearance" });
      if (stored) await context.addCookies([{ name: "alpha-appearance", value: stored, url: APP_ORIGIN }]);
      await page.emulateMedia({ colorScheme: os });
      await page.goto(`${APP_ORIGIN}/admin/design`);
      await page.reload();
      const html = page.locator("html");
      const notRendered = htmlClass === null ? "(light|dark)" : htmlClass === "dark" ? "light" : "dark";
      if (htmlClass) await expect(html).toHaveClass(new RegExp(`\\b${htmlClass}\\b`));
      await expect(html).not.toHaveClass(new RegExp(`\\b${notRendered}\\b`));
      // The tokens and a `dark:`-styled element show the same mode.
      expect(await background(page, "aside")).toBe(PAPER[shown]);
      await expect(page.getByTestId("dark-variant")).toHaveText(`Showing ${shown}`, { useInnerText: true });
      await expect(page.locator('meta[name="theme-color"]')).toHaveCount(htmlClass ? 1 : 2);
      // The Appearance control starts on the stored choice, hydrated.
      const appearance = page.getByRole("group", { name: "Page appearance" });
      const label = htmlClass ? (htmlClass === "dark" ? "Dark" : "Light") : "System";
      await expect(await hydrated(appearance.getByRole("button", { name: label }))).toHaveAttribute("aria-pressed", "true");
    }

    // A change in the page matches what the server renders on the next load.
    await page.emulateMedia({ colorScheme: "dark" });
    const appearance = page.getByRole("group", { name: "Page appearance" });
    await appearance.getByRole("button", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveClass(/\blight\b/);
    await expect(page.getByTestId("dark-variant")).toHaveText("Showing light", { useInnerText: true });
    expect(await background(page, "aside")).toBe(PAPER.light);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/\blight\b/);
    await expect(page.getByTestId("dark-variant")).toHaveText("Showing light", { useInnerText: true });
    expect(await background(page, "aside")).toBe(PAPER.light);
    await (await hydrated(appearance.getByRole("button", { name: "System" }))).click();
    await expect(page.locator("html")).not.toHaveClass(/\b(light|dark)\b/);
    await expect(page.getByTestId("dark-variant")).toHaveText("Showing dark", { useInnerText: true });
    expect(await background(page, "aside")).toBe(PAPER.dark);

    // React reports a hydration mismatch as a console error (#418 in production).
    expect(errors.filter((text) => /hydrat|#418|#425/i.test(text))).toEqual([]);
  });
});

test("the component gallery: light and dark panes, appearance switch, toasts and a sheet", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/admin/design`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Components");
  expect(await background(page, '[data-alpha-theme="light"]')).toBe(PAPER.light);
  expect(await background(page, '[data-alpha-theme="dark"]')).toBe(PAPER.dark);
  // The same component swaps token values only: the Now block inverts in each mode.
  expect(await background(page, '[data-alpha-theme="light"] [data-slot="now-block"]')).toBe(INK.light);
  expect(await background(page, '[data-alpha-theme="dark"] [data-slot="now-block"]')).toBe(INK.dark);
  // The syringe ruler says when a value falls between lines, never rounding it.
  await expect(
    page.locator('[data-alpha-theme="light"]').getByText("On a 100-unit syringe, 5 units falls between the 4 and 6 lines."),
  ).toBeVisible();

  // Appearance: stored in a cookie and applied at once, and kept on reload.
  const appearance = page.getByRole("group", { name: "Page appearance" });
  await (await hydrated(appearance.getByRole("button", { name: "Dark" }))).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  expect(await background(page, "aside")).toBe(PAPER.dark);
  await expect(page.getByTestId("dark-variant")).toHaveText("Showing dark", { useInnerText: true });
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  expect(await background(page, "aside")).toBe(PAPER.dark);
  await (await hydrated(appearance.getByRole("button", { name: "System" }))).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  expect(await background(page, "aside")).toBe(PAPER.light);

  // Toasts: success is a status with Undo that leaves by itself; an error is an alert that stays.
  await page.getByRole("button", { name: "Success toast" }).click();
  const success = page.getByRole("status").filter({ hasText: "TB-500 · 2.5 mg logged at 9:12 AM" });
  await expect(success).toBeVisible();
  await expect(success.getByRole("button", { name: "Undo" })).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(success).toBeHidden({ timeout: 6_000 });
  await page.getByRole("button", { name: "Error toast" }).click();
  const error = page.getByRole("alert").filter({ hasText: "Couldn't save. Your entry is still here." });
  await expect(error).toBeVisible();
  await page.waitForTimeout(4_500);
  await expect(error).toBeVisible();
  await error.getByRole("button", { name: "Dismiss" }).click();
  await expect(error).toBeHidden();

  // The sheet is a right-hand 420 px drawer on a laptop; Esc closes it.
  await page.getByRole("button", { name: "Open a sheet" }).click();
  const sheet = page.getByRole("dialog", { name: "BPC-157" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCSS("width", "420px");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});
