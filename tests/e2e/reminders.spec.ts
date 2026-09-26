import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { APP_ORIGIN, PUBLIC_ORIGIN, SERVER_ORIGIN } from "../../playwright.config";
import { ensureAccount, serviceClient, signInAs, uniqueEmail } from "../support/local-supabase";

// C2: installable app files and "Reminders on this phone". Headless Chromium
// has no push service, so the browser's PushManager is replaced by a fake in
// the page (the server side is real: actions, database functions, RLS).
// Device states are emulated with init scripts; real phones are proven at G1.

const RESEARCHER = { email: uniqueEmail("c2-researcher"), name: "Casey Reminders" };
// Signs out (which ends all its sessions), so it has its own account.
const SIGN_OUT_RESEARCHER = { email: uniqueEmail("c2-signout"), name: "Sam Signout" };
const TABS_RESEARCHER = { email: uniqueEmail("c2-tabs"), name: "Tess Tabs" };
const LATE_RESEARCHER = { email: uniqueEmail("c2-late"), name: "Lee Late" };
const PHONE = { width: 390, height: 844 };
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

test.beforeAll(async () => {
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
  await ensureAccount({ ...SIGN_OUT_RESEARCHER, role: "researcher" });
  await ensureAccount({ ...TABS_RESEARCHER, role: "researcher" });
  await ensureAccount({ ...LATE_RESEARCHER, role: "researcher" });
});

/** Node can't resolve *.localhost: request the server directly with the host's Host header. */
const hostGet = (request: APIRequestContext, origin: string, path: string) =>
  request.get(`${SERVER_ORIGIN}${path}`, { headers: { host: new URL(origin).host }, maxRedirects: 0 });

/**
 * Headless Chromium reports notifications as denied whatever is granted, so
 * the permission is emulated: `initial`, "granted" once requested, and
 * window.setPermission() for a change made in the phone's Settings.
 */
function emulatePermission(target: Page | BrowserContext, initial: NotificationPermission) {
  return target.addInitScript((start) => {
    let state = start;
    Object.defineProperty(Notification, "permission", { get: () => state, configurable: true });
    Notification.requestPermission = async () => (state = "granted");
    Object.assign(window, { setPermission: (next: NotificationPermission) => (state = next) });
  }, initial);
}

/** Fake PushManager with one subscription at `endpoint`; window.dropSubscription() loses it (as iOS can). */
function fakePushService(target: Page | BrowserContext, endpoint: string) {
  return target.addInitScript((url) => {
    let current: object | null = null;
    let subscribeCalls = 0;
    const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ", auth: "tBHItJI5svbpez7KI4CCXg" };
    const subscription = {
      endpoint: url,
      options: { applicationServerKey: null },
      toJSON: () => ({ endpoint: url, keys }),
      unsubscribe: async () => ((current = null), true),
    };
    PushManager.prototype.getSubscription = async () => current as PushSubscription | null;
    PushManager.prototype.subscribe = async () => ((subscribeCalls += 1), (current = subscription)) as unknown as PushSubscription;
    Object.assign(window, { dropSubscription: () => (current = null), subscribeCalls: () => subscribeCalls });
  }, endpoint);
}

type TestWindow = { setPermission: (p: NotificationPermission) => void; dropSubscription: () => void; subscribeCalls: () => number };
const inPage = (page: Page, call: (w: TestWindow) => unknown) =>
  page.evaluate(`(${call.toString()})(window)`) as Promise<unknown>;
/** The app returns to the foreground (a phone app reopened from the background). */
const foreground = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
const deviceRow = async (endpoint: string) =>
  (await serviceClient().from("push_subscriptions").select("disabled_reason, device_label, last_seen_at").eq("endpoint", endpoint).single()).data!;
const rememberedDevice = (page: Page) => page.evaluate(() => localStorage.getItem("apl.reminders.device"));
const statusValue = (page: Page, label: string) => page.locator(".app-reminders-row", { hasText: label }).locator("b");

/**
 * Holds this page's next device save (the saveDevice server action) until
 * release(), and records whether any other action (turn off, sign out) was
 * sent while it was held.
 */
async function holdNextSave(page: Page) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  let arrived = () => {};
  const held = new Promise<void>((resolve) => (arrived = resolve));
  let holding = true;
  let sentWhileHeld = 0;
  await page.route(/\/app\/notifications$/, async (route) => {
    const body = route.request().method() === "POST" ? (route.request().postData() ?? "") : "";
    if (holding && body.includes("p256dh")) {
      arrived();
      await gate;
    } else if (holding && body.includes("endpoint")) {
      sentWhileHeld += 1;
    }
    await route.fallback();
  });
  return { held, sentWhileHeld: () => sentWhileHeld, release: () => ((holding = false), release()) };
}

/** A foreground re-sync whose upload is still pending when `act` (turn off / sign out) runs. */
async function withPendingSync(page: Page, act: () => Promise<void>) {
  const save = await holdNextSave(page);
  await foreground(page);
  await save.held;
  await act();
  await page.waitForTimeout(500); // time enough for an unserialized disable to go out
  expect(save.sentWhileHeld()).toBe(0);
  save.release();
}

test("the app host serves the manifest, icons and a cache-free worker; only the private area links them", async ({
  page,
  request,
}) => {
  const manifest = await (await hostGet(request, APP_ORIGIN, "/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ id: "/app", name: "Alpha PR Labs", start_url: "/", scope: "/", display: "standalone" });
  expect([manifest.theme_color, manifest.background_color]).toEqual(["#050505", "#050505"]);
  const icons = manifest.icons as { src: string; sizes: string; purpose: string }[];
  expect(icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  for (const src of [...icons.map((icon) => icon.src), "/app-icons/apple-touch-icon.png"]) {
    expect((await hostGet(request, APP_ORIGIN, src)).headers()["content-type"]).toBe("image/png");
  }
  const worker = await hostGet(request, APP_ORIGIN, "/sw.js");
  expect(worker.headers()).toMatchObject({
    "content-type": "application/javascript; charset=utf-8",
    "cache-control": "no-cache, no-store, must-revalidate",
    "content-security-policy": "default-src 'self'; script-src 'self'",
  });
  expect(await worker.text()).not.toMatch(/addEventListener\(\s*["']fetch["']|onfetch|caches\./);
  for (const path of ["/manifest.webmanifest", "/sw.js", "/app-icons/icon-192.png"]) {
    expect((await hostGet(request, PUBLIC_ORIGIN, path)).status()).toBe(404);
  }

  await page.goto(`${APP_ORIGIN}/auth`);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/app-icons/apple-touch-icon.png");
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute("content", "black-translucent");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#050505");
  await page.goto(`${PUBLIC_ORIGIN}/`);
  await expect(page.locator('link[rel="manifest"], meta[name="apple-mobile-web-app-title"], meta[name="theme-color"]')).toHaveCount(0);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png");
});

test("turn reminders on and off; turn off and sign out win over a pending re-sync; no test button by default", async ({
  page,
}) => {
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${Date.now().toString(36)}`;
  await emulatePermission(page, "default");
  await fakePushService(page, endpoint);
  await page.setViewportSize(PHONE);
  await signInAs(page, APP_ORIGIN, SIGN_OUT_RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  // The researcher area registers the worker (scope "/") on open.
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration("/"))?.scope ?? null))
    .toBe(`${APP_ORIGIN}/`);

  await page.goto(`${APP_ORIGIN}/app/notifications`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reminders on this phone");
  for (const [label, value] of [["Push supported", "Yes"], ["Installed to home screen", "Not yet"], ["Permission on this device", "Not requested"]]) {
    await expect(statusValue(page, label)).toHaveText(value);
  }
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
  expect(await deviceRow(endpoint)).toMatchObject({ disabled_reason: null, device_label: expect.stringContaining("Chrome") });

  // Turn off while a foreground re-sync's save is still pending: the disable
  // goes out only after it, and the device is not remembered again.
  await withPendingSync(page, () => page.getByRole("button", { name: "Turn off reminders" }).click());
  await expect(page.locator(".app-toast")).toHaveText("Reminders off. Your schedule is unchanged.");
  expect(await deviceRow(endpoint)).toMatchObject({ disabled_reason: "turned_off" });
  expect(await rememberedDevice(page)).toBeNull();

  // Same for sign out; the browser also loses its subscription meanwhile, so
  // the endpoint remembered on this device is the one disabled.
  await page.getByRole("button", { name: "Turn on reminders" }).click();
  await expect(page.getByRole("button", { name: "Turn off reminders" })).toBeVisible();
  await withPendingSync(page, async () => {
    await inPage(page, (w) => w.dropSubscription());
    await page.locator('button[aria-haspopup="menu"]').click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
  });
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth`);
  expect(await deviceRow(endpoint)).toMatchObject({ disabled_reason: "signed_out" });
  expect(await rememberedDevice(page)).toBeNull();
});

test("a re-sync pending in another tab can't switch the phone back on after turn off or sign out", async ({ browser }) => {
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-tabs-${Date.now().toString(36)}`;
  const context = await browser.newContext({ viewport: PHONE });
  await emulatePermission(context, "granted");
  await fakePushService(context, endpoint);
  const tabA = await context.newPage();
  await signInAs(tabA, APP_ORIGIN, TABS_RESEARCHER.email);
  await expect(tabA).toHaveURL(`${APP_ORIGIN}/app/today`);

  for (const reason of ["turned_off", "signed_out"] as const) {
    await tabA.goto(`${APP_ORIGIN}/app/notifications`);
    await tabA.getByRole("button", { name: "Turn on reminders" }).click();
    await expect(tabA.getByRole("button", { name: "Turn off reminders" })).toBeVisible();
    // Tab B opens; its re-sync's save is held until tab A has acted.
    const tabB = await context.newPage();
    const save = await holdNextSave(tabB);
    await tabB.goto(`${APP_ORIGIN}/app/notifications`);
    await save.held;
    if (reason === "turned_off") {
      await tabA.getByRole("button", { name: "Turn off reminders" }).click();
      await expect(tabA.locator(".app-toast")).toHaveText("Reminders off. Your schedule is unchanged.");
    } else {
      await tabA.locator('button[aria-haspopup="menu"]').click();
      await tabA.getByRole("menuitem", { name: "Sign out" }).click();
      await expect(tabA).toHaveURL(`${APP_ORIGIN}/auth`);
    }
    const answered = tabB.waitForResponse((response) => response.request().postData()?.includes("p256dh") ?? false);
    save.release();
    await answered;
    // The database refused tab B's save; tab B forgets the device and shows reminders off.
    if (reason === "turned_off") await expect(tabB.getByRole("button", { name: "Turn on reminders" })).toBeVisible();
    await expect.poll(() => rememberedDevice(tabB)).toBeNull();
    expect(await rememberedDevice(tabA)).toBeNull();
    expect(await deviceRow(endpoint)).toMatchObject({ disabled_reason: reason });
    await tabB.close();
  }
  await context.close();
});

test("a refused re-sync answered after a new Turn on in another tab doesn't undo it", async ({ browser }) => {
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-late-${Date.now().toString(36)}`;
  const context = await browser.newContext({ viewport: PHONE });
  await emulatePermission(context, "granted");
  await fakePushService(context, endpoint);
  const tabA = await context.newPage();
  await signInAs(tabA, APP_ORIGIN, LATE_RESEARCHER.email);
  await expect(tabA).toHaveURL(`${APP_ORIGIN}/app/today`);
  await tabA.goto(`${APP_ORIGIN}/app/notifications`);
  await tabA.getByRole("button", { name: "Turn on reminders" }).click();
  await expect(tabA.getByRole("button", { name: "Turn off reminders" })).toBeVisible();

  // Tab B's re-sync reaches the server only after tab A turned off (so it is
  // refused), and its answer only after tab A turned reminders on again.
  const gate = () => {
    let open = () => {};
    return { wait: new Promise<void>((resolve) => (open = resolve)), open: () => open() };
  };
  const [arrived, send, fetched, answer] = [gate(), gate(), gate(), gate()];
  let holding = true;
  const tabB = await context.newPage();
  await tabB.route(/\/app\/notifications$/, async (route) => {
    if (!holding || !(route.request().postData() ?? "").includes("p256dh")) return route.fallback();
    holding = false;
    arrived.open();
    await send.wait;
    // Node can't resolve *.localhost: send it to the server with the app's Host header.
    const headers = { ...route.request().headers(), host: new URL(APP_ORIGIN).host };
    const response = await route.fetch({ url: `${SERVER_ORIGIN}/app/notifications`, headers });
    fetched.open();
    await answer.wait;
    await route.fulfill({ response });
  });
  await tabB.goto(`${APP_ORIGIN}/app/notifications`);
  await arrived.wait;
  await tabA.getByRole("button", { name: "Turn off reminders" }).click();
  await expect(tabA.locator(".app-toast")).toHaveText("Reminders off. Your schedule is unchanged.");
  send.open();
  await fetched.wait;
  await tabA.getByRole("button", { name: "Turn on reminders" }).click();
  await expect(tabA.getByRole("button", { name: "Turn off reminders" })).toBeVisible();
  answer.open();

  await expect(tabB.getByRole("button", { name: "Turn off reminders" })).toBeVisible();
  expect(JSON.parse((await rememberedDevice(tabB)) ?? "null")).toMatchObject({ endpoint });
  const subscribed = () => tabB.evaluate(async () => !!(await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription()));
  expect(await subscribed()).toBe(true);
  expect(await deviceRow(endpoint)).toMatchObject({ disabled_reason: null });
  await context.close();
});

test("returning to the foreground re-checks permission and re-registers a dropped subscription", async ({ page }) => {
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-fg-${Date.now().toString(36)}`;
  await emulatePermission(page, "denied");
  await fakePushService(page, endpoint);
  await page.setViewportSize(PHONE);
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/app/notifications`);
  const permission = statusValue(page, "Permission on this device");
  await expect(permission).toHaveText("Denied");

  // Allowed in the phone's Settings, then back to the app (no reload).
  await inPage(page, (w) => w.setPermission("granted"));
  await foreground(page);
  await expect(permission).toHaveText("Not requested");
  await page.getByRole("button", { name: "Turn on reminders" }).click();
  await expect(permission).toHaveText("Enabled");
  const firstSeen = (await deviceRow(endpoint)).last_seen_at;

  // The browser drops the subscription while the app is in the background.
  await inPage(page, (w) => w.dropSubscription());
  await foreground(page);
  await expect.poll(() => inPage(page, (w) => w.subscribeCalls())).toBe(2);
  await expect.poll(async () => (await deviceRow(endpoint)).last_seen_at > firstSeen).toBe(true);
  await expect(permission).toHaveText("Enabled");

  // Blocked again in Settings: the screen follows on return.
  await inPage(page, (w) => w.setPermission("denied"));
  await foreground(page);
  await expect(permission).toHaveText("Denied");
});

test.describe("designed device states", () => {
  test.use({ viewport: PHONE });

  test("iPhone in Safari: add to home screen first", async ({ browser }) => {
    const page = await (await browser.newContext({ userAgent: IPHONE_UA, viewport: PHONE })).newPage();
    await signInAs(page, APP_ORIGIN, RESEARCHER.email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await page.goto(`${APP_ORIGIN}/app/notifications`);
    await expect(page.getByText("On iPhone, add the app to your home screen first: Share → Add to Home Screen.")).toBeVisible();
    await expect(page.getByText("I've added it")).toHaveCount(0);
    await expect(statusValue(page, "Installed to home screen")).toHaveText("Not yet");
    await expect(page.getByRole("button", { name: "Turn on reminders" })).toHaveCount(0);
  });

  test("step 3, denied and unsupported", async ({ page }) => {
    await emulatePermission(page, "default");
    await signInAs(page, APP_ORIGIN, RESEARCHER.email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await page.goto(`${APP_ORIGIN}/auth/reminders`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reminders on your phone");
    await expect(statusValue(page, "Notification permission")).toHaveText("Not requested");

    await emulatePermission(page, "denied");
    await page.goto(`${APP_ORIGIN}/app/notifications`);
    await expect(page.getByText("Denied at the OS level.", { exact: false })).toBeVisible();
    await expect(statusValue(page, "Permission on this device")).toHaveText("Denied");
    await expect(page.getByRole("button", { name: /Turn (on|off) reminders/ })).toHaveCount(0);

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
    await expect(statusValue(page, "Installed to home screen")).toHaveText("Yes");
    await expect(page.getByRole("button", { name: "Turn on reminders" })).toBeVisible();

    await page.getByRole("button", { name: "Not now" }).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
  });
});
