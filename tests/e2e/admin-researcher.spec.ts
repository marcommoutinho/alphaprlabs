// S3.2 "Admins are researchers": a new admin signs in, lands on the research
// side, passes the same acknowledgement as a researcher, turns on reminders
// for this phone and signs out, against the real local Supabase. The push
// service and notification permission are emulated in the browser.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { emulatePermission, fakePushService } from "../support/fake-push";
import { ensureAccount, hydrated, serviceClient, signInAs, uniqueEmail } from "../support/local-supabase";

const ADMIN = { email: uniqueEmail("s32-admin"), name: "Avery Admin" };
let adminId: string;

test.beforeAll(async () => {
  adminId = await ensureAccount({ ...ADMIN, role: "admin", acknowledged: false });
});

const accountButton = (page: Page) => page.locator('button[aria-haspopup="menu"]');
const deviceRow = async (endpoint: string) =>
  (await serviceClient().from("push_subscriptions").select("profile_id, disabled_reason").eq("endpoint", endpoint).single())
    .data!;

test("an admin acknowledges, turns on reminders, uses the research side and switches to Business and back", async ({
  page,
}) => {
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-admin-${Date.now().toString(36)}`;
  await emulatePermission(page, "default");
  await fakePushService(page, endpoint);
  await page.setViewportSize({ width: 390, height: 844 });

  // The app opens on the research side, which first needs the acknowledgement (R15).
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth/acknowledge`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("For research use only");
  await page.goto(`${APP_ORIGIN}/app/notifications`);
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth/acknowledge`);
  // A full page load: the form only works once React has hydrated it.
  await (await hydrated(page.getByRole("checkbox", { name: "I've read this and I'm using the app as a researcher." }))).click();
  await page.getByRole("button", { name: "Agree and continue" }).click();

  // R16 is for iPhone Safari only, and the push prompt opens by itself only
  // on a Home Screen launch: this browser goes straight on to Today.
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  const { data: profile } = await serviceClient().from("profiles").select("role, acknowledged_at").eq("id", adminId).single();
  expect(profile?.role).toBe("admin");
  expect(profile?.acknowledged_at).not.toBeNull();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");

  // Reminders are turned on from Me › Dose reminders (client-side
  // navigation: a reload would reset the emulated push service).
  const tabs = page.getByRole("navigation", { name: "Main" });
  await tabs.getByRole("link", { name: "Me" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/me`);
  await expect(page.getByTestId("me-reminders-value")).toHaveText("Off");
  await page.getByTestId("me-reminders").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reminders on this phone");
  await (await hydrated(page.getByRole("button", { name: "Turn on reminders" }))).click();
  await expect(page.locator('[data-slot="toast"]')).toHaveText("Reminders on for this device.");
  expect(await deviceRow(endpoint)).toEqual({ profile_id: adminId, disabled_reason: null });
  await expect(page.locator('[data-testid="reminder-status"][data-label="Permission on this device"]').getByTestId("reminder-status-value")).toHaveText(
    "Enabled",
  );
  await expect(page.getByRole("button", { name: "Turn off reminders" })).toBeVisible();
  // Me shows it on for this device.
  await page.getByRole("navigation", { name: "Dose reminders" }).getByRole("link", { name: "Me" }).click();
  await expect(page.getByTestId("me-reminders-value")).toHaveText("At dose time");

  // The admin's fourth tab, Business, switches to the back office; Today back.
  await expect(tabs.getByRole("link")).toHaveText(["Today", "Cycles", "Progress", "Business", "Me"]);
  await tabs.getByRole("link", { name: "Business" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/business`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Business");
  await expect(tabs.locator('[aria-current="page"]')).toHaveText("Business");
  await expect(page.getByRole("navigation", { name: "Business" }).getByRole("link")).toHaveText([
    "Overview",
    "Stock",
    "Ledger",
    "Library",
    "People",
  ]);
  await tabs.getByRole("link", { name: "Today" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect(tabs.locator('[aria-current="page"]')).toHaveText("Today");

  // Signing out from the admin side (the laptop account menu) also stops this
  // phone's reminders.
  await page.goto(`${APP_ORIGIN}/admin/sales`);
  await page.setViewportSize({ width: 1280, height: 800 });
  await accountButton(page).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth`);
  expect(await deviceRow(endpoint)).toEqual({ profile_id: adminId, disabled_reason: "signed_out" });
});
