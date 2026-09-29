// The install guide (Marco, 2026-09-29) against the real local Supabase, with
// emulated phones and browsers: joining step 3 opens on this phone and
// browser's tab (iOS 18 Safari, iOS 26 Safari, Chrome on iPhone, Android
// Chrome) or on a laptop the QR code, and the installed app skips it; the Me
// row and the account-menu item show in a browser tab and never in the
// installed app; Copy link copies Today's address; Android's Install app
// button appears only once the browser offered its prompt; inside another
// app's browser, "open this page in Safari" comes first; the reminders
// screen links to the guide. Screens for review with SHOTS_DIR.
import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { ensureAccount, hydrated, seedInvitation, signInAs, TEST_PASSWORD, uniqueEmail } from "../support/local-supabase";
import { shot as saveShot, STATIC_TAB_BAR } from "../support/shots";

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 820 };
const TODAY_LINK = `${APP_ORIGIN}/app/today`;

const UA = {
  iosSafari18:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  // iOS 26 reports its system version frozen at 18_6; Safari's own version says 26.
  iosSafari26:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1",
  // iPadOS asks for the desktop site: a Mac with touch.
  ipadSafari26: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  iosInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.28.85 (iPhone15,3; iOS 18_5; en_US; en-US; scale=3.00; 1290x2796; 755829410)",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
};

type Device = { label: string; userAgent?: string; viewport: { width: number; height: number }; touch: boolean };
const IOS18: Device = { label: "ios18-safari", userAgent: UA.iosSafari18, viewport: PHONE, touch: true };
const IOS26: Device = { label: "ios26-safari", userAgent: UA.iosSafari26, viewport: PHONE, touch: true };
const IOS_CHROME: Device = { label: "ios-chrome", userAgent: UA.iosChrome, viewport: PHONE, touch: true };
const ANDROID: Device = { label: "android-chrome", userAgent: UA.androidChrome, viewport: PHONE, touch: true };
const SAMSUNG: Device = { label: "android-samsung", userAgent: UA.androidSamsung, viewport: PHONE, touch: true };
const INSTAGRAM: Device = { label: "ios-instagram", userAgent: UA.iosInstagram, viewport: PHONE, touch: true };
// Playwright's desktop Chrome, as every other spec runs.
const LAPTOP_CHROME: Device = { label: "laptop", viewport: LAPTOP, touch: false };

const shot = async (page: Page, name: string) => {
  await saveShot(page, `install-${name}`, { fullPage: true, style: STATIC_TAB_BAR });
};

/** Runs in the page before any script: the app reports itself as launched from the Home Screen. */
const standalone = () => {
  const original = window.matchMedia.bind(window);
  window.matchMedia = (query: string) =>
    query === "(display-mode: standalone)" ? ({ ...original(query), matches: true } as MediaQueryList) : original(query);
  Object.defineProperty(Navigator.prototype, "standalone", { configurable: true, get: () => true });
};

function context(browser: Browser, device: Device, extra: BrowserContextOptions = {}) {
  return browser.newContext({
    viewport: device.viewport,
    ...(device.userAgent ? { userAgent: device.userAgent } : {}),
    hasTouch: device.touch,
    isMobile: device.touch,
    ...extra,
  });
}

async function account(label: string) {
  const email = uniqueEmail(`install-${label}`);
  await ensureAccount({ email, name: "Jordan Reyes", role: "researcher" });
  return email;
}

/** Signs in and opens the install guide's page. */
async function openGuide(page: Page, email: string) {
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(/\/(app\/today|auth\/reminders)$/);
  await page.goto(`${APP_ORIGIN}/app/install`);
  await expect(page.getByTestId("install-guide")).toBeVisible();
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
const selectedTab = (page: Page) => page.getByRole("tab", { selected: true });
const stepTexts = (page: Page) => page.getByRole("tabpanel").getByTestId("install-step-text");

/** R14 and R15 as the invitee does them, then R16. */
async function joinToStepThree(page: Page, label: string) {
  const email = uniqueEmail(`install-join-${label}`);
  const token = await seedInvitation({ email, name: "Jordan Reyes" });
  await page.goto(`${APP_ORIGIN}/auth/invite/${token}`);
  await (await hydrated(page.getByLabel("Password · 8 characters or more"))).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth/acknowledge`);
  await (await hydrated(page.getByRole("checkbox", { name: "I've read this and I'm using the app as a researcher." }))).click();
  await page.getByRole("button", { name: "Agree and continue" }).click();
}

// iOS 26 keeps Share in the toolbar with the Bottom and Top tab layouts, behind ••• with Compact.
const SHARE_26_NOTE = "Don't see it? Tap •••the three-dot button first (Page Menu on iOS 27), then Share.";
// Missing from the iPhone share sheet (Safari and Chrome): added from Edit Actions.
const EDIT_ACTIONS_NOTE = "Don't see it? Scroll down, tap Edit Actions, and add Add to Home Screen.";
const JOINS: { device: Device; title: string; tab: string; first: string; firstNote?: string; steps: number }[] = [
  { device: IOS18, title: "Put Alpha on your Home Screen", tab: "iPhone · Safari", first: "Tap Share in the toolbar.", steps: 4 },
  { device: IOS26, title: "Put Alpha on your Home Screen", tab: "iPhone · Safari", first: "Tap Share.", firstNote: SHARE_26_NOTE, steps: 5 },
  { device: IOS_CHROME, title: "Put Alpha on your Home Screen", tab: "iPhone · Chrome", first: "Tap Share in the address bar (top right).", steps: 4 },
  // Chrome's steps, then Samsung Internet's.
  { device: ANDROID, title: "Put Alpha on your Home Screen", tab: "Android", first: "Tap ⋮More options (top right).", steps: 8 },
  { device: LAPTOP_CHROME, title: "Get the app on your phone", tab: "iPhone · Safari", first: "Tap Share.", firstNote: SHARE_26_NOTE, steps: 5 },
];

for (const join of JOINS) {
  test(`joining step 3 on ${join.device.label} opens on ${join.tab}`, async ({ browser }) => {
    const ctx = await context(browser, join.device);
    const page = await ctx.newPage();
    await joinToStepThree(page, join.device.label);
    await expect(page).toHaveURL(`${APP_ORIGIN}/auth/install`);
    await expect(page.getByRole("progressbar", { name: "Step 3 of 3" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(join.title);
    await expect(selectedTab(page)).toHaveAttribute("data-tab", /.+/);
    await expect(selectedTab(page)).toContainText(join.tab);
    await expect(stepTexts(page)).toHaveCount(join.steps);
    await expect(stepTexts(page).first()).toHaveText(join.first);
    const firstStep = page.getByRole("tabpanel").getByTestId("install-step").first();
    if (join.firstNote) await expect(firstStep.getByTestId("install-step-note")).toHaveText(join.firstNote);
    else await expect(firstStep.getByTestId("install-step-note")).toHaveCount(0);
    await expect(stepTexts(page).last()).toHaveText("Open Alpha from your Home Screen.");
    // Each step has its drawing, hidden from assistive technology.
    await expect(page.getByRole("tabpanel").locator("svg[data-sketch]")).toHaveCount(join.steps);
    await expect(page.getByRole("tabpanel").locator("svg[data-sketch]").first()).toHaveAttribute("aria-hidden", "true");
    if (join.device === LAPTOP_CHROME) {
      await expect(page.getByTestId("install-this-phone")).toHaveCount(0);
      await expect(page.getByTestId("install-qr")).toHaveAttribute("data-link", TODAY_LINK);
      await expect(page.getByRole("img", { name: `QR code for ${TODAY_LINK}` })).toBeVisible();
    } else {
      await expect(selectedTab(page).getByTestId("install-this-phone")).toHaveText("This phone");
      await expect(page.getByTestId("install-qr")).toHaveCount(0);
    }
    // The link offered is Today, never this page's address.
    await expect(page.getByTestId("install-link")).toHaveValue(TODAY_LINK);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, `join-${join.device.label}`);
    await (await hydrated(page.getByRole("button", { name: "I'll do it later" }))).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await ctx.close();
  });
}

test("joining in the installed app: step 3 is skipped", async ({ browser }) => {
  const ctx = await context(browser, ANDROID);
  await ctx.addInitScript(standalone);
  const page = await ctx.newPage();
  await joinToStepThree(page, "standalone-android");
  // Straight on to Today, whose first Home Screen launch opens the reminders prompt.
  await expect(page).toHaveURL(/\/(app\/today|auth\/reminders)$/);
  await expect(page.getByTestId("install-guide")).toHaveCount(0);
  await ctx.close();
});

test("the tabs: the steps for each phone, the reminders line and the Android sign-in note", async ({ browser }) => {
  const ctx = await context(browser, IOS18);
  const page = await ctx.newPage();
  await openGuide(page, await account("tabs"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Install the app");
  await expect(page.getByRole("tablist", { name: "Your phone and browser" }).getByRole("tab")).toHaveText([
    "iPhone · Safari, This phone",
    "iPhone · Chrome",
    "Android",
  ]);
  await expect(stepTexts(page)).toHaveText(["Tap Share in the toolbar.", "Scroll down and choose Add to Home Screen.", "Tap Add.", "Open Alpha from your Home Screen."]);
  await expect(page.getByTestId("install-step-note")).toHaveText([
    EDIT_ACTIONS_NOTE,
    "Sign in once more there. The Home Screen app keeps its own sign-in.",
  ]);
  await expect(page.getByTestId("install-reminders")).toHaveText("Dose reminders only work from the Home Screen app.");

  await (await hydrated(tab(page, "iPhone · Chrome"))).click();
  await expect(selectedTab(page)).toHaveAttribute("data-tab", "ios-chrome");
  await expect(stepTexts(page)).toHaveText([
    "Tap Share in the address bar (top right).",
    "Choose Add to Home Screen.",
    "Tap Add.",
    "Open Alpha from your Home Screen.",
  ]);
  // Chrome on iPhone uses the system share sheet: the same Edit Actions fallback.
  await expect(page.getByTestId("install-step-note")).toHaveText([
    EDIT_ACTIONS_NOTE,
    "If an Open as Web App switch is shown, keep it on.",
    "Sign in once more there. The Home Screen app keeps its own sign-in.",
  ]);

  await tab(page, "Android").click();
  await expect(selectedTab(page)).toHaveAttribute("data-tab", "android");
  const chrome = page.getByRole("list", { name: "Android, in chrome" }).getByTestId("install-step-text");
  await expect(chrome).toHaveText(["Tap ⋮More options (top right).", "Tap Install app or Add to Home screen.", "Tap Install.", "Open Alpha from your Home Screen."]);
  const samsung = page.getByRole("list", { name: "Android, in samsung internet" }).getByTestId("install-step-text");
  await expect(samsung).toHaveText(["Tap the menu (☰three lines or ⋮three dots).", "Tap Add page to.", "Choose Home screen.", "Open Alpha from your Home Screen."]);
  // Android shares Chrome's sign-in: no "sign in once more".
  await expect(page.getByRole("tabpanel").getByTestId("install-step-note")).toHaveCount(0);
  await expect(page.getByTestId("install-reminders")).toHaveText("Dose reminders work in the browser too. The app just opens full screen, and faster.");
  // No install prompt on an iPhone.
  await expect(page.getByRole("button", { name: "Install app" })).toHaveCount(0);
  // Keyboard: arrows move between the tabs.
  await tab(page, "Android").focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(selectedTab(page)).toHaveAttribute("data-tab", "ios-chrome");
  await ctx.close();
});

test("Copy link copies Today's address on this app", async ({ browser }) => {
  const ctx = await context(browser, IOS_CHROME, { permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  await openGuide(page, await account("copy"));
  await expect(page.getByTestId("install-link")).toHaveValue(TODAY_LINK);
  await (await hydrated(page.getByRole("button", { name: "Copy link" }))).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(TODAY_LINK);
  await ctx.close();
});

test("Android: Install app appears only once the browser offers its prompt, and opens it", async ({ browser }) => {
  const ctx = await context(browser, ANDROID);
  const page = await ctx.newPage();
  await openGuide(page, await account("android-prompt"));
  await expect(selectedTab(page)).toHaveAttribute("data-tab", "android");
  await expect(page.getByTestId("install-this-phone")).toHaveText("This phone");
  await hydrated(tab(page, "Android"));
  await expect(page.getByRole("button", { name: "Install app" })).toHaveCount(0);
  // Chrome in the order it detects: Chrome's steps first, then Samsung Internet's.
  await expect(page.getByRole("tabpanel").getByRole("heading", { level: 3 })).toHaveText(["In Chrome", "In Samsung Internet"]);
  await shot(page, "tab-android-phone-light");

  // The browser offers its prompt (a synthetic beforeinstallprompt).
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    event.prompt = async () => {
      (window as unknown as { prompted: number }).prompted = ((window as unknown as { prompted?: number }).prompted ?? 0) + 1;
    };
    event.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(event);
  });
  const install = page.getByRole("button", { name: "Install app" });
  await expect(install).toBeVisible();
  // The manual steps stay.
  await expect(page.getByRole("tabpanel").getByTestId("install-step")).toHaveCount(8);
  await shot(page, "android-prompt-phone");
  await install.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { prompted?: number }).prompted)).toBe(1);
  await expect(page.getByRole("status").filter({ hasText: "Installed. Open Alpha from your Home Screen." })).toBeVisible();
  await expect(install).toHaveCount(0);
  await ctx.close();
});

test("Samsung Internet opens on its own steps first", async ({ browser }) => {
  const ctx = await context(browser, SAMSUNG);
  const page = await ctx.newPage();
  await openGuide(page, await account("samsung"));
  await expect(selectedTab(page)).toHaveAttribute("data-tab", "android");
  await expect(page.getByRole("tabpanel").getByRole("heading", { level: 3 })).toHaveText(["In Samsung Internet", "In Chrome"]);
  await ctx.close();
});

test("inside another app's browser: open this page in Safari comes first", async ({ browser }) => {
  const ctx = await context(browser, INSTAGRAM);
  const page = await ctx.newPage();
  await openGuide(page, await account("in-app"));
  const first = page.getByTestId("install-elsewhere-first");
  await expect(first.getByRole("heading")).toHaveText("Open this page in Safari");
  await expect(first.getByTestId("install-link")).toHaveValue(TODAY_LINK);
  // Before the tabs, and not repeated at their end.
  const [note, tabs] = await Promise.all([first.boundingBox(), page.getByRole("tablist").boundingBox()]);
  expect(note!.y).toBeLessThan(tabs!.y);
  await expect(page.getByTestId("install-elsewhere")).toHaveCount(0);
  await expect(selectedTab(page)).toHaveAttribute("data-tab", "ios-safari");
  await shot(page, "in-app-browser-phone");
  await ctx.close();
});

test("on an iPad: Share, then More, then Add to Home Screen; no iPhone Edit Actions fallback", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, userAgent: UA.ipadSafari26, hasTouch: true });
  // iPadOS reports five touch points.
  await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "maxTouchPoints", { configurable: true, get: () => 5 }));
  const page = await ctx.newPage();
  await openGuide(page, await account("ipad"));
  await expect(page.getByTestId("install-guide")).toHaveAttribute("data-platform", "ios");
  await expect(selectedTab(page)).toHaveAttribute("data-tab", "ios-safari");
  await expect(selectedTab(page).getByTestId("install-this-phone")).toHaveText("This iPad");
  await expect(stepTexts(page)).toHaveText([
    "Tap Share.",
    "Tap More, then Add to Home Screen.",
    "Keep Open as Web App on.",
    "Tap Add.",
    "Open Alpha from your Home Screen.",
  ]);
  await expect(page.getByRole("tabpanel").getByTestId("install-step-note")).toHaveText([
    SHARE_26_NOTE,
    "Sign in once more there. The Home Screen app keeps its own sign-in.",
  ]);
  await expect(page.getByRole("tabpanel")).not.toContainText("Edit Actions");
  await shot(page, "tab-ipad-safari-light");
  // An iPhone keeps the Edit Actions fallback.
  const phone = await context(browser, IOS26);
  const iphone = await phone.newPage();
  await openGuide(iphone, await account("ipad-vs-iphone"));
  await expect(iphone.getByRole("tabpanel").getByTestId("install-step-note").nth(1)).toHaveText(EDIT_ACTIONS_NOTE);
  await phone.close();
  await ctx.close();
});

test("on a laptop: the QR code for Today and the steps to read ahead", async ({ browser }) => {
  for (const scheme of ["light", "dark"] as const) {
    const ctx = await context(browser, LAPTOP_CHROME, { colorScheme: scheme });
    const page = await ctx.newPage();
    await openGuide(page, await account(`laptop-${scheme}`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Get the app on your phone");
    await expect(page.getByTestId("install-qr")).toHaveAttribute("data-link", TODAY_LINK);
    // Always dark on light, so any camera reads it.
    const colors = await page.getByTestId("install-qr").evaluate((svg) => ({
      tile: getComputedStyle(svg.parentElement!).backgroundColor,
      modules: getComputedStyle(svg.querySelector("path")!).fill,
    }));
    expect(colors).toEqual({ tile: "rgb(242, 242, 238)", modules: "rgb(13, 14, 16)" });
    await expect(page.getByTestId("install-this-phone")).toHaveCount(0);
    await expect(selectedTab(page)).toHaveAttribute("data-tab", "ios-safari");
    // Read ahead for an iPhone: the iPhone's Edit Actions fallback.
    await expect(page.getByRole("tabpanel").getByTestId("install-step-note").nth(1)).toHaveText(EDIT_ACTIONS_NOTE);
    await shot(page, `laptop-qr-${scheme}`);
    await ctx.close();
  }
});

test("each tab on a phone, light and dark (screens)", async ({ browser }) => {
  const email = await account("shots");
  for (const scheme of ["light", "dark"] as const) {
    for (const [device, name] of [
      [IOS18, "ios-safari"],
      [IOS26, "ios26-safari"],
      [IOS_CHROME, "ios-chrome"],
      [ANDROID, "android"],
    ] as const) {
      const ctx = await context(browser, device, { colorScheme: scheme });
      const page = await ctx.newPage();
      await openGuide(page, email);
      await expect(selectedTab(page).getByTestId("install-this-phone")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `tab-${name}-phone-${scheme}`);
      await ctx.close();
    }
  }
});

for (const device of [IOS18, LAPTOP_CHROME]) {
  test(`the Me row and the account menu on ${device.label}: in a browser tab, never in the installed app`, async ({ browser }) => {
    const email = await account(`me-${device.label}`);
    const label = device === LAPTOP_CHROME ? "Get the app on your phone" : "Install the app";

    const ctx = await context(browser, device);
    const page = await ctx.newPage();
    await signInAs(page, APP_ORIGIN, email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await page.goto(`${APP_ORIGIN}/app/me`);
    // Client effects have run (the reminders row reads this device).
    await expect(page.getByTestId("me-reminders-value")).toHaveText("Off");
    const row = page.getByTestId("me-install");
    await expect(row).toContainText(label);
    await shot(page, `me-row-${device.label}`);
    await (await hydrated(row)).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/install`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(label);
    if (device === LAPTOP_CHROME) {
      await page.getByRole("button", { name: "Account menu" }).click();
      const item = page.getByRole("menu").getByRole("menuitem", { name: label });
      await expect(item).toBeVisible();
      await page.goto(`${APP_ORIGIN}/app/today`);
      await (await hydrated(page.getByRole("button", { name: "Account menu" }))).click();
      await page.getByRole("menu").getByRole("menuitem", { name: label }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/install`);
    }
    await ctx.close();

    // The installed app: neither the row nor the item, not even for a moment.
    const installed = await context(browser, device);
    await installed.addInitScript(standalone);
    const app = await installed.newPage();
    await app.addInitScript(() => {
      (window as unknown as { sawInstallRow: boolean }).sawInstallRow = false;
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="me-install"]')) (window as unknown as { sawInstallRow: boolean }).sawInstallRow = true;
      }).observe(document, { childList: true, subtree: true });
    });
    await signInAs(app, APP_ORIGIN, email);
    await expect(app).toHaveURL(/\/(app\/today|auth\/reminders)$/);
    await app.goto(`${APP_ORIGIN}/app/me`);
    await expect(app.getByTestId("me-reminders-value")).toHaveText("Off");
    await expect(app.getByTestId("me-install")).toHaveCount(0);
    expect(await app.evaluate(() => (window as unknown as { sawInstallRow: boolean }).sawInstallRow)).toBe(false);
    if (device === LAPTOP_CHROME) {
      await (await hydrated(app.getByRole("button", { name: "Account menu" }))).click();
      await expect(app.getByRole("menu").getByRole("menuitem", { name: "Sign out" })).toBeVisible();
      await expect(app.getByRole("menu").getByRole("menuitem", { name: label })).toHaveCount(0);
    }
    await installed.close();
  });
}

test("the reminders screen on iPhone links to the install guide", async ({ browser }) => {
  const ctx = await context(browser, IOS18);
  const page = await ctx.newPage();
  await signInAs(page, APP_ORIGIN, await account("reminders"));
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/app/notifications`);
  await expect(page.getByText("On iPhone, reminders need the app on your Home Screen.")).toBeVisible();
  await (await hydrated(page.getByRole("link", { name: "See how to install it" }))).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/install`);
  await expect(selectedTab(page)).toHaveAttribute("data-tab", "ios-safari");
  await ctx.close();
});
