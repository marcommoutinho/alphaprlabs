import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { APP_ORIGIN, PUBLIC_ORIGIN, SERVER_ORIGIN } from "../../playwright.config";
import { ensureAccount, serviceClient, signInAs, uniqueEmail } from "../support/local-supabase";

// C2: installable app files and "Reminders on this phone". Headless Chromium
// has no push service, so the browser's PushManager is replaced by a fake in
// the page (the server side is real: actions, database functions, RLS).
// Device states are emulated with init scripts; real phones are proven at G1.

const RESEARCHER = { email: uniqueEmail("c2-researcher"), name: "Casey Reminders" };
const PHONE = { width: 390, height: 844 };
const SHOTS = process.env.S3_SCREENSHOTS; // optional folder for review screenshots
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

test.beforeAll(async () => {
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
});

/** Node can't resolve *.localhost: request the server directly with the host's Host header. */
const hostGet = (request: APIRequestContext, origin: string, path: string) =>
  request.get(`${SERVER_ORIGIN}${path}`, { headers: { host: new URL(origin).host }, maxRedirects: 0 });

/**
 * Headless Chromium reports notifications as denied whatever is granted, so
 * the permission is emulated: `initial`, and "granted" once requested.
 */
function emulatePermission(target: Page | BrowserContext, initial: NotificationPermission) {
  return target.addInitScript((start) => {
    let state = start;
    Object.defineProperty(Notification, "permission", { get: () => state, configurable: true });
    Notification.requestPermission = async () => (state = "granted");
  }, initial);
}

async function signIn(page: Page) {
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(/\/(app\/today|auth\/reminders)$/);
}

/** Review screenshot (only when S3_SCREENSHOTS is set), after enter animations settle. */
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** Replaces PushManager with an in-page fake whose subscription has `endpoint`. */
function fakePushService(page: Page, endpoint: string) {
  return page.addInitScript((url) => {
    let current: object | null = null;
    const subscription = {
      endpoint: url,
      options: { applicationServerKey: null },
      toJSON: () => ({ endpoint: url, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ", auth: "tBHItJI5svbpez7KI4CCXg" } }),
      unsubscribe: async () => ((current = null), true),
    };
    PushManager.prototype.getSubscription = async () => current as PushSubscription | null;
    PushManager.prototype.subscribe = async () => (current = subscription) as unknown as PushSubscription;
  }, endpoint);
}

const deviceRow = async (endpoint: string) =>
  (await serviceClient().from("push_subscriptions").select("profile_id, disabled_reason, device_label").eq("endpoint", endpoint)).data;
const statusValue = (page: Page, label: string) => page.locator(".app-reminders-row", { hasText: label }).locator("b");

test("the app host serves the manifest, icons and a cache-free worker; only the private area links them", async ({
  page,
  request,
}) => {
  const manifest = await (await hostGet(request, APP_ORIGIN, "/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({
    id: "/app",
    name: "Alpha PR Labs",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#050505",
    background_color: "#050505",
  });
  expect(manifest.icons.map((icon: { sizes: string; purpose: string }) => `${icon.sizes} ${icon.purpose}`)).toEqual([
    "192x192 any",
    "512x512 any",
    "512x512 maskable",
  ]);
  for (const src of [...manifest.icons.map((icon: { src: string }) => icon.src), "/app-icons/apple-touch-icon.png"]) {
    const icon = await hostGet(request, APP_ORIGIN, src);
    expect(icon.headers()["content-type"]).toBe("image/png");
  }

  const worker = await hostGet(request, APP_ORIGIN, "/sw.js");
  expect(worker.headers()).toMatchObject({
    "content-type": "application/javascript; charset=utf-8",
    "cache-control": "no-cache, no-store, must-revalidate",
    "content-security-policy": "default-src 'self'; script-src 'self'",
  });
  const source = await worker.text();
  expect(source).toContain('addEventListener("push"');
  expect(source).toContain('addEventListener("notificationclick"');
  expect(source).not.toMatch(/addEventListener\(\s*["']fetch["']|onfetch|caches\./);

  // Not on the public host.
  for (const path of ["/manifest.webmanifest", "/sw.js", "/app-icons/icon-192.png"]) {
    expect((await hostGet(request, PUBLIC_ORIGIN, path)).status()).toBe(404);
  }

  await page.goto(`${APP_ORIGIN}/auth`);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/app-icons/apple-touch-icon.png");
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute(
    "content",
    "black-translucent",
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#050505");

  await page.goto(`${PUBLIC_ORIGIN}/`);
  await expect(page.locator('link[rel="manifest"], meta[name="apple-mobile-web-app-title"], meta[name="theme-color"]')).toHaveCount(0);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png");
});

test("turn reminders on and off on this device; signing out disables it; no test button by default", async ({
  page,
}) => {
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${Date.now().toString(36)}`;
  await emulatePermission(page, "default");
  await fakePushService(page, endpoint);
  await page.setViewportSize(PHONE);
  await signIn(page);

  // The researcher area registers the worker (scope "/") on open.
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration("/"))?.scope ?? null))
    .toBe(`${APP_ORIGIN}/`);

  await page.goto(`${APP_ORIGIN}/app/notifications`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reminders on this phone");
  await expect(statusValue(page, "Push supported")).toHaveText("Yes");
  await expect(statusValue(page, "Installed to home screen")).toHaveText("Not yet");
  await expect(statusValue(page, "Permission on this device")).toHaveText("Not requested");
  await expect(page.getByRole("button", { name: "Send test notification" })).toHaveCount(0);

  // Android/Chromium: the browser's install prompt becomes a one-tap "Install app".
  await expect(page.getByRole("button", { name: "Install app" })).toHaveCount(0);
  await page.evaluate(() => {
    const prompt = { prompt: async () => undefined, userChoice: Promise.resolve({ outcome: "accepted" }) };
    window.dispatchEvent(Object.assign(new Event("beforeinstallprompt", { cancelable: true }), prompt));
  });
  await page.getByRole("button", { name: "Install app" }).click();
  await expect(statusValue(page, "Installed to home screen")).toHaveText("Yes");
  await expect(page.getByRole("button", { name: "Install app" })).toHaveCount(0);

  await page.getByRole("button", { name: "Turn on reminders" }).click();
  await expect(page.locator(".app-toast")).toHaveText("Reminders on for this device.");
  await expect(statusValue(page, "Permission on this device")).toHaveText("Enabled");
  await expect(page.getByRole("button", { name: "Turn off reminders" })).toBeVisible();
  expect(await deviceRow(endpoint)).toEqual([expect.objectContaining({ disabled_reason: null, device_label: expect.stringContaining("Chrome") })]);
  await shot(page, "s3-settings-enabled");

  await page.getByRole("button", { name: "Turn off reminders" }).click();
  await expect(page.locator(".app-toast")).toHaveText("Reminders off. Your schedule is unchanged.");
  await expect(page.getByRole("button", { name: "Turn on reminders" })).toBeVisible();
  expect(await deviceRow(endpoint)).toEqual([expect.objectContaining({ disabled_reason: "turned_off" })]);

  // On again, then sign out: this phone stops receiving this account's reminders.
  await page.getByRole("button", { name: "Turn on reminders" }).click();
  await expect(page.getByRole("button", { name: "Turn off reminders" })).toBeVisible();
  await page.locator('button[aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth`);
  expect(await deviceRow(endpoint)).toEqual([expect.objectContaining({ disabled_reason: "signed_out" })]);
});

test.describe("designed device states", () => {
  test.use({ viewport: PHONE });

  test("iPhone in Safari: add to home screen first", async ({ browser }) => {
    const page = await (await browser.newContext({ userAgent: IPHONE_UA, viewport: PHONE })).newPage();
    await signIn(page);
    await page.goto(`${APP_ORIGIN}/app/notifications`);
    await expect(page.getByText("On iPhone, add the app to your home screen first: Share → Add to Home Screen.")).toBeVisible();
    await expect(page.getByText("I've added it")).toHaveCount(0);
    await expect(statusValue(page, "Installed to home screen")).toHaveText("Not yet");
    await expect(page.getByRole("button", { name: "Turn on reminders" })).toHaveCount(0);
    await shot(page, "s3-settings-iphone");
  });

  test("denied and unsupported", async ({ page }) => {
    await emulatePermission(page, "default");
    await signIn(page);
    await page.goto(`${APP_ORIGIN}/auth/reminders`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reminders on your phone");
    await expect(statusValue(page, "Notification permission")).toHaveText("Not requested");
    await shot(page, "s3-step3");

    await emulatePermission(page, "denied");
    await page.goto(`${APP_ORIGIN}/app/notifications`);
    await expect(page.getByText("Denied at the OS level.", { exact: false })).toBeVisible();
    await expect(statusValue(page, "Permission on this device")).toHaveText("Denied");
    await expect(page.getByRole("button", { name: /Turn (on|off) reminders/ })).toHaveCount(0);
    await shot(page, "s3-settings-denied");

    const unsupported = await page.context().newPage();
    await unsupported.addInitScript(() => delete (window as { PushManager?: unknown }).PushManager);
    await unsupported.goto(`${APP_ORIGIN}/app/notifications`);
    await expect(unsupported.getByText("This browser can't deliver push notifications. Everything else works.")).toBeVisible();
    await expect(statusValue(unsupported, "Push supported")).toHaveText("No");
    await expect(statusValue(unsupported, "Permission on this device")).toHaveText("Unavailable");
  });

  test("installed iPhone app: first open after sign-in routes once to step 3", async ({ browser }) => {
    const context = await browser.newContext({ userAgent: IPHONE_UA, viewport: PHONE });
    await context.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query === "(display-mode: standalone)" ? ({ ...original(query), matches: true } as MediaQueryList) : original(query);
    });
    await emulatePermission(context, "default");
    const page = await context.newPage();
    await signInAs(page, APP_ORIGIN, RESEARCHER.email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/auth/reminders`);
    await expect(page.getByText("Step 3 of 3 · optional")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reminders on your phone");
    await expect(statusValue(page, "Installed to home screen")).toHaveText("Yes");
    await expect(page.getByRole("button", { name: "Turn on reminders" })).toBeVisible();
    await shot(page, "s3-step3-installed-iphone");

    await page.getByRole("button", { name: "Not now" }).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  });
});
