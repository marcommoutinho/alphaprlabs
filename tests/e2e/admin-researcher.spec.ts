// S3.2 "Admins are researchers": a new admin signs in, lands on the research
// side, passes the same acknowledgement as a researcher, turns on reminders
// for this phone and signs out, against the real local Supabase. The push
// service and notification permission are emulated in the browser.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { emulatePermission, fakePushService } from "../support/fake-push";
import { ensureAccount, serviceClient, signInAs, uniqueEmail } from "../support/local-supabase";

const ADMIN = { email: uniqueEmail("s32-admin"), name: "Avery Admin" };
let adminId: string;

test.beforeAll(async () => {
  adminId = await ensureAccount({ ...ADMIN, role: "admin", acknowledged: false });
});

const accountButton = (page: Page) => page.locator('button[aria-haspopup="menu"]');
const deviceRow = async (endpoint: string) =>
  (await serviceClient().from("push_subscriptions").select("profile_id, disabled_reason").eq("endpoint", endpoint).single())
    .data!;

test("an admin acknowledges, turns on reminders, uses the research side and switches to Admin and back", async ({
  page,
}) => {
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-admin-${Date.now().toString(36)}`;
  await emulatePermission(page, "default");
  await fakePushService(page, endpoint);
  await page.setViewportSize({ width: 390, height: 844 });

  // The app opens on the research side, which first needs the acknowledgement.
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth/acknowledge`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Researcher acknowledgement");
  await page.goto(`${APP_ORIGIN}/app/notifications`);
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth/acknowledge`);
  await page.getByLabel("I have read the acknowledgement and confirm I am a researcher.").check();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3: reminders on this phone, then Today.
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth/reminders`);
  const { data: profile } = await serviceClient().from("profiles").select("role, acknowledged_at").eq("id", adminId).single();
  expect(profile?.role).toBe("admin");
  expect(profile?.acknowledged_at).not.toBeNull();
  await expect(page.getByText("Step 3 of 3 · optional")).toBeVisible();
  await page.getByRole("button", { name: "Turn on reminders" }).click();
  await expect(page.locator(".app-toast")).toHaveText("Reminders on for this device.");
  expect(await deviceRow(endpoint)).toEqual({ profile_id: adminId, disabled_reason: null });
  await page.getByRole("button", { name: "Continue to Today" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");

  // The settings screen shows this device on for the admin (client-side
  // navigation: a reload would reset the emulated push service).
  await accountButton(page).click();
  await page.getByRole("menuitem", { name: "Notifications" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reminders on this phone");
  await expect(page.locator(".app-reminders-row", { hasText: "Permission on this device" }).locator("b")).toHaveText(
    "Enabled",
  );
  await expect(page.getByRole("button", { name: "Turn off reminders" })).toBeVisible();

  // Account menu: "Admin" switches to the back office, "My research" back.
  await accountButton(page).click();
  await page.getByRole("menuitem", { name: "Admin", exact: true }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory`);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText([
    "Inventory",
    "Sales",
    "Library",
    "Templates",
    "Invitations",
    "Support",
  ]);
  await accountButton(page).click();
  await page.getByRole("menuitem", { name: "My research" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Me" })).toBeVisible();

  // Signing out from the admin side also stops this phone's reminders.
  await page.goto(`${APP_ORIGIN}/admin/sales`);
  await accountButton(page).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth`);
  expect(await deviceRow(endpoint)).toEqual({ profile_id: adminId, disabled_reason: "signed_out" });
});
