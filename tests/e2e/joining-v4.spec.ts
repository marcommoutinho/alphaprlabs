// V4 joining (R14–R16) and sign-in in design v3, against the real local
// Supabase: an invitation link → name and password (R14) → the research-use
// disclaimer, stored with its version and time (R15) → Put Alpha on your
// Home Screen, the install guide (R16; every device is in
// install-guide.spec.ts) → Today; the first launch from
// the Home Screen opens the push permission prompt once, and never in a
// browser tab. Phone and laptop, light and dark.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { emulatePermission } from "../support/fake-push";
import { ensureAccount, hydrated, seedInvitation, serviceClient, signInAs, TEST_PASSWORD, uniqueEmail } from "../support/local-supabase";
import { shot as saveShot } from "../support/shots";

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 820 };
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const PAPER = { light: "rgb(242, 242, 238)", dark: "rgb(12, 13, 15)" };
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = async (page: Page, name: string) => {
  await saveShot(page, `v4-${name}`, { fullPage: true });
};

/** Runs in the page before any script: the app reports itself as launched from the Home Screen. */
const standalone = () => {
  const original = window.matchMedia.bind(window);
  window.matchMedia = (query: string) =>
    query === "(display-mode: standalone)" ? ({ ...original(query), matches: true } as MediaQueryList) : original(query);
};

async function invited(label: string) {
  const email = uniqueEmail(`v4-join-${label}`);
  const token = await seedInvitation({ email, name: "Jordan Reyes" });
  return { email, link: `${APP_ORIGIN}/auth/invite/${token}` };
}

/** R14 and R15 as the invitee does them. */
async function acceptAndAgree(page: Page, link: string, label: string) {
  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Join Alpha Research");
  await (await hydrated(page.getByLabel("Password · 8 characters or more"))).fill(TEST_PASSWORD);
  await shot(page, `r14-${label}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth/acknowledge`);
  const box = page.getByRole("checkbox", { name: "I've read this and I'm using the app as a researcher." });
  await (await hydrated(box)).click();
  await shot(page, `r15-${label}`);
  await page.getByRole("button", { name: "Agree and continue" }).click();
}

async function iphone(browser: Browser, scheme: "light" | "dark", viewport = PHONE) {
  return browser.newContext({ userAgent: IPHONE_UA, viewport, colorScheme: scheme, hasTouch: true, isMobile: viewport === PHONE });
}

test("an invitation on iPhone Safari: R14, R15 stored with its version, R16, then Today", async ({ browser }) => {
  const { email, link } = await invited("iphone");
  const context = await iphone(browser, "light");
  await emulatePermission(context, "default");
  const page = await context.newPage();

  // R14: anonymous, the invitation's email fixed, and when it expires.
  await page.goto(link);
  await expect(page.getByRole("progressbar", { name: "Step 1 of 3" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Alpha PR Labs" })).toBeVisible();
  await expect(page.getByText("You've been invited")).toBeVisible();
  await expect(page.getByText("A private app for the researchers Alpha PR Labs works with.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Jordan Reyes");
  await expect(page.getByLabel("Email · from your invitation")).toHaveValue(email);
  await expect(page.getByText(/^Valid until \w{3} \d+ · Already have an account\? Sign in$/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth");
  expect(await background(page)).toBe(PAPER.light);
  expect(await noSideScroll(page)).toBe(true);
  // An empty name is refused, and nothing is created.
  await (await hydrated(page.getByLabel("Name"))).fill("");
  await page.getByLabel("Password · 8 characters or more").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("form-error")).toHaveText("Enter your name.");
  await page.getByLabel("Name").fill("Jordan Reyes");
  await page.getByRole("button", { name: "Continue" }).click();

  // R15: Agree stays disabled until the box is ticked; the agreement is stored with its version and time.
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth/acknowledge`);
  await expect(page.getByRole("progressbar", { name: "Step 2 of 3" })).toBeVisible();
  await expect(page.getByText("Please read this once. It's recorded with your account.")).toBeVisible();
  const agree = page.getByRole("button", { name: "Agree and continue" });
  await expect(agree).toBeDisabled();
  const region = page.getByRole("region", { name: "Research-use disclaimer" });
  await expect(region).toHaveCSS("height", "330px");
  const box = page.getByRole("checkbox", { name: "I've read this and I'm using the app as a researcher." });
  await (await hydrated(box)).click();
  await expect(box).toBeChecked();
  await expect(agree).toBeEnabled();
  await box.click();
  await expect(agree).toBeDisabled();
  await box.click();
  const before = Date.now();
  await agree.click();

  // R16 on iPhone Safari.
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth/install`);
  await expect(page.getByRole("progressbar", { name: "Step 3 of 3" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Put Alpha on your Home Screen");
  await expect(page.getByRole("tab", { selected: true })).toHaveAttribute("data-tab", "ios-safari");
  await expect(page.getByRole("tabpanel").getByTestId("install-step-text")).toHaveText([
    "Tap Share in the toolbar.",
    "Scroll down and choose Add to Home Screen.",
    "Tap Add.",
    "Open Alpha from your Home Screen.",
  ]);
  await expect(page.getByTestId("install-reminders")).toHaveText("Dose reminders only work from the Home Screen app.");
  const { data: profile } = await serviceClient().from("profiles").select("acknowledged_at, acknowledgement_version").eq("email", email).single();
  expect(profile?.acknowledgement_version).toBe("2026-09-placeholder");
  expect(Date.parse(profile!.acknowledged_at!)).toBeGreaterThan(before - 60_000);
  await (await hydrated(page.getByRole("button", { name: "I'll do it later" }))).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
  // In Safari (not standalone) the push prompt never opens by itself.
  await page.reload();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await context.close();
});

test("R14–R16 in dark on a phone and on a laptop (screens)", async ({ browser }) => {
  for (const [label, scheme, viewport] of [
    ["phone-dark", "dark", PHONE],
    ["laptop", "light", LAPTOP],
  ] as const) {
    const { link } = await invited(label);
    const context = await iphone(browser, scheme, viewport);
    const page = await context.newPage();
    await acceptAndAgree(page, link, label);
    await expect(page).toHaveURL(`${APP_ORIGIN}/auth/install`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Put Alpha on your Home Screen");
    expect(await background(page)).toBe(PAPER[scheme]);
    expect(await noSideScroll(page)).toBe(true);
    await shot(page, `r16-${label}`);
    await context.close();
  }
  // Light phone screens for R14–R16.
  const { link } = await invited("phone-light");
  const context = await iphone(browser, "light");
  const page = await context.newPage();
  await acceptAndAgree(page, link, "phone-light");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Put Alpha on your Home Screen");
  await shot(page, "r16-phone-light");
  await context.close();
});

test("already on the Home Screen: R16 is skipped, and the push prompt opens once", async ({ browser }) => {
  const { link } = await invited("standalone");
  const context = await iphone(browser, "light");
  await context.addInitScript(standalone);
  await emulatePermission(context, "default");
  const page = await context.newPage();
  await acceptAndAgree(page, link, "standalone");
  // R16 goes on to Today, whose first standalone launch opens the prompt.
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth/reminders`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reminders on your phone");
  await expect(page.getByRole("button", { name: "Turn on reminders" })).toBeVisible();
  await shot(page, "reminders-prompt-phone");
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  // Never a second time.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await context.close();
});

for (const [device, viewport] of [
  ["phone", PHONE],
  ["laptop", LAPTOP],
] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`sign in and recover access on a ${device} in ${scheme}`, async ({ browser }) => {
      const email = uniqueEmail(`v4-signin-${device}-${scheme}`);
      await ensureAccount({ email, name: "Signing In", role: "researcher" });
      const context = await browser.newContext({ viewport, colorScheme: scheme });
      const page = await context.newPage();
      await page.goto(`${APP_ORIGIN}/auth`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
      await expect(page.getByRole("img", { name: "Alpha PR Labs" })).toBeVisible();
      expect(await background(page)).toBe(PAPER[scheme]);
      expect(await noSideScroll(page)).toBe(true);
      await shot(page, `signin-${device}-${scheme}`);
      await signInAs(page, APP_ORIGIN, email, "not-the-password");
      await expect(page.getByTestId("form-error")).toHaveText("Email or password is incorrect. Passwords are case-sensitive.");
      await expect(page.getByLabel("Email")).toHaveValue(email);

      await page.getByRole("link", { name: "Forgot password?" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recover access");
      await (await hydrated(page.getByLabel("Email"))).fill(email);
      await page.getByRole("button", { name: "Send recovery link" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Sent to" })).toContainText(`Sent to ${email}. Check your inbox.`);
      await page.getByRole("link", { name: "Back to sign in" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/auth`);
      await signInAs(page, APP_ORIGIN, email);
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
      await context.close();
    });
  }
}

test("expired and already used invitations in design v3", async ({ page }) => {
  const expiredEmail = uniqueEmail("v4-join-expired");
  const expired = await seedInvitation({ email: expiredEmail, name: "Lee Tran", sentDaysAgo: 31 });
  await page.setViewportSize(PHONE);
  await page.goto(`${APP_ORIGIN}/auth/invite/${expired}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This invitation has expired");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByLabel("Password · 8 characters or more")).toHaveCount(0);
  await shot(page, "r14-expired-phone");
  await page.goto(`${APP_ORIGIN}/auth/invite/${"x".repeat(43)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This invitation was already used");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/auth");
  // The old setup link lands on the invitation.
  await page.goto(`${APP_ORIGIN}/auth/invite/${expired}/setup`);
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth/invite/${expired}`);
});
