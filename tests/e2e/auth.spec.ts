// S2 journeys: invitations (A1), invitation acceptance, sign in, recovery and
// sign out (C1), against the real local Supabase and its Mailpit inbox.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import {
  emailCount,
  ensureAccount,
  latestEmail,
  seedInvitation,
  signInAs,
  TEST_PASSWORD,
  uniqueEmail,
} from "../support/local-supabase";

const ADMIN = { email: uniqueEmail("e2e-admin"), name: "Marco Moutinho" };
const RESEARCHER = { email: uniqueEmail("e2e-known"), name: "Known Researcher" };
let adminId: string;

test.beforeAll(async () => {
  adminId = await ensureAccount({ ...ADMIN, role: "admin" });
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
});

// The inline form error (Next.js adds its own empty route-announcer alert).
const alert = (page: Page) => page.locator('.app-inline-error[role="alert"]');
const toast = (page: Page) => page.locator(".app-toast");
const row = (page: Page, email: string) => page.getByTestId("invitation-row").filter({ hasText: email });
const rowIndex = async (page: Page, email: string) =>
  (await page.getByTestId("invitation-row").allTextContents()).findIndex((text) => text.includes(email));

async function invite(page: Page, name: string, email: string) {
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send invitation" }).click();
}

async function signOut(page: Page) {
  await page.locator('button[aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth`);
}

test("admin invites; the researcher accepts, sets a password, acknowledges and reaches Today", async ({
  browser,
  page,
}) => {
  const email = uniqueEmail("e2e-invitee");
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory`);
  await page.goto(`${APP_ORIGIN}/admin/invitations`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Researcher invitations");

  await invite(page, "Jordan Reyes", "not-an-email");
  await expect(alert(page)).toHaveText("Enter a valid email address.");
  await invite(page, "Jordan Reyes", email.toUpperCase());
  await expect(toast(page)).toHaveText(`Invitation sent to ${email}`);
  await expect(row(page, email)).toContainText("Jordan Reyes");
  await expect(row(page, email)).toContainText("Pending");
  await invite(page, "Jordan Reyes", email);
  await expect(alert(page)).toHaveText(`${email} already has a pending invitation.`);

  // The researcher opens the emailed link in their own browser.
  const mail = await latestEmail(email);
  const link = /http:\/\/\S+\/auth\/invite\/[A-Za-z0-9_-]{43}/.exec(mail.text)?.[0];
  expect(link).toContain(`${APP_ORIGIN}/auth/invite/`);
  const researcher = await (await browser.newContext()).newPage();
  await researcher.goto(link!);
  await expect(researcher.getByText("You're invited")).toBeVisible();
  await expect(researcher.getByRole("heading", { level: 1 })).toHaveText("Join Alpha PR Labs Research");
  await expect(researcher.getByText(`Marco Moutinho invited ${email}.`)).toBeVisible();
  await researcher.getByRole("link", { name: "Accept invitation" }).click();

  await expect(researcher.getByText("Step 1 of 3")).toBeVisible();
  await expect(researcher.getByLabel("Name")).toHaveValue("Jordan Reyes");
  await expect(researcher.getByLabel("Email (from your invitation)")).toHaveValue(email);
  await researcher.getByLabel("Password · at least 8 characters").fill("short");
  await researcher.getByRole("button", { name: "Continue" }).click();
  await expect(alert(researcher)).toHaveText("Password needs at least 8 characters.");
  await researcher.getByLabel("Password · at least 8 characters").fill(TEST_PASSWORD);
  await researcher.getByRole("button", { name: "Continue" }).click();

  await expect(researcher.getByText("Step 2 of 3")).toBeVisible();
  // Until acknowledged, the app routes back here.
  await researcher.goto(`${APP_ORIGIN}/app/today`);
  await expect(researcher).toHaveURL(`${APP_ORIGIN}/auth/acknowledge`);
  await researcher.getByRole("button", { name: "Continue" }).click();
  await expect(alert(researcher)).toHaveText(
    "Tick the acknowledgement to continue. It is required for researcher accounts.",
  );
  await researcher.getByLabel("I have read the acknowledgement and confirm I am a researcher.").check();
  await researcher.getByRole("button", { name: "Continue" }).click();
  // Step 3 (optional): reminders on this phone; "Not now" continues to Today.
  await expect(researcher).toHaveURL(`${APP_ORIGIN}/auth/reminders`);
  await expect(researcher.getByText("Step 3 of 3 · optional")).toBeVisible();
  await expect(researcher.getByRole("heading", { level: 1 })).toHaveText("Reminders on your phone");
  await researcher.getByRole("button", { name: "Not now" }).click();
  await expect(researcher).toHaveURL(`${APP_ORIGIN}/app/today`);
  await expect(researcher.getByRole("heading", { level: 1 })).toHaveText("Today");
  await expect(toast(researcher)).toHaveCount(0);

  // A researcher cannot open admin screens; the used link now says so.
  await researcher.goto(`${APP_ORIGIN}/admin/invitations`);
  await expect(researcher).toHaveURL(`${APP_ORIGIN}/app/today`);
  await researcher.goto(link!);
  await expect(researcher.getByRole("heading", { level: 1 })).toHaveText("This invitation was already used");
  await expect(researcher.getByText(`An account for ${email} already exists.`)).toBeVisible();

  await page.reload();
  await expect(row(page, email)).toContainText("Accepted");
  await invite(page, "Jordan Reyes", email);
  await expect(alert(page)).toHaveText(`${email} already has an account. They can sign in or recover access.`);

  // Sign out (both roles) returns to sign in; the new password works.
  await researcher.goto(`${APP_ORIGIN}/app/today`);
  await signOut(researcher);
  await signOut(page);
  await signInAs(researcher, APP_ORIGIN, email);
  await expect(researcher).toHaveURL(`${APP_ORIGIN}/app/today`);
});

test("expired, unknown and failed invitations; resend", async ({ page }) => {
  const expiredEmail = uniqueEmail("e2e-expired");
  const failedEmail = uniqueEmail("e2e-failed");
  const expiredToken = await seedInvitation({
    email: expiredEmail,
    name: "Lee Tran",
    sentDaysAgo: 31,
    invitedBy: adminId,
  });
  await seedInvitation({ email: failedEmail, name: "Sam Okafor", state: "failed" });

  await page.goto(`${APP_ORIGIN}/auth/invite/${expiredToken}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This invitation has expired");
  await expect(
    page.getByText(
      `Invitations are valid for 30 days. Ask Marco to send a new one to ${expiredEmail}. Nothing else is needed from you.`,
    ),
  ).toBeVisible();
  await page.goto(`${APP_ORIGIN}/auth/invite/${"x".repeat(43)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This invitation was already used");
  await expect(page.getByText("already exists")).toHaveCount(0);

  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory`);
  await page.goto(`${APP_ORIGIN}/admin/invitations`);
  await expect(row(page, expiredEmail).locator('[data-state="expired"]')).toHaveText("Expired");
  await expect(row(page, expiredEmail).locator('[data-state="expired"]')).toHaveCSS("color", "rgb(251, 191, 36)");
  await expect(row(page, failedEmail).locator('[data-state="failed"]')).toHaveText("Send failed");
  await expect(row(page, failedEmail).locator('[data-state="failed"]')).toHaveCSS("color", "rgb(248, 113, 113)");
  // Newest first by the "Sent" date.
  expect(await rowIndex(page, failedEmail)).toBeLessThan(await rowIndex(page, expiredEmail));

  await row(page, failedEmail).getByRole("button", { name: "Resend" }).click();
  await expect(toast(page)).toHaveText(`Invitation resent to ${failedEmail}`);
  await expect(row(page, failedEmail)).toContainText("Pending");
  await expect(row(page, failedEmail).getByRole("button", { name: "Resend" })).toHaveCount(0);
  expect((await latestEmail(failedEmail)).text).toContain("Marco Moutinho invited you");

  await row(page, expiredEmail).getByRole("button", { name: "Resend" }).click();
  await expect(row(page, expiredEmail)).toContainText("Pending");
  // Resending moves the older invitation above the newer one.
  expect(await rowIndex(page, expiredEmail)).toBeLessThan(await rowIndex(page, failedEmail));
  // The old link died with the resend.
  await page.goto(`${APP_ORIGIN}/auth/invite/${expiredToken}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This invitation was already used");
});

test("sign in errors, session-expired notice and return path", async ({ page, context }) => {
  for (const [email, password] of [
    [RESEARCHER.email, "wrong-password"],
    [uniqueEmail("e2e-nobody"), TEST_PASSWORD],
  ]) {
    await signInAs(page, APP_ORIGIN, email, password);
    await expect(alert(page)).toHaveText("Email or password is incorrect. Passwords are case-sensitive.");
  }

  // A lapsed session cookie: protected pages send you to sign in, with the notice.
  await context.addCookies([{ name: "sb-127-auth-token", value: "base64-bm90LWEtc2Vzc2lvbg", url: APP_ORIGIN }]);
  await page.goto(`${APP_ORIGIN}/app/progress`);
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth?expired=1&next=%2Fapp%2Fprogress`);
  await expect(page.getByText("Your session expired. Sign in again to continue.")).toBeVisible();
  await page.getByLabel("Email").fill(RESEARCHER.email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/progress`);
});

test("recovery shows the same confirmation for known and unknown emails and resets the password", async ({
  browser,
  page,
}) => {
  const account = { email: uniqueEmail("e2e-recover"), name: "Recover Me" };
  await ensureAccount({ ...account, role: "researcher" });
  const unknown = uniqueEmail("e2e-unknown");

  for (const email of [unknown, account.email]) {
    await page.goto(`${APP_ORIGIN}/auth`);
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recover access");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send recovery link" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Sent to" })).toContainText(
      `Sent to ${email}. Check your inbox.`,
    );
  }

  // Emails go out after the response; the unknown address (asked first) gets none.
  const mail = await latestEmail(account.email);
  expect(await emailCount(unknown)).toBe(0);
  const link = /href="([^"]+)"/.exec(mail.html)?.[1].replaceAll("&amp;", "&");
  expect(link).toContain(`${APP_ORIGIN}/auth/confirm?token_hash=`);

  // A mail scanner opening the link (GET, no click) must not use up the token.
  const scanner = await (await browser.newContext()).newPage();
  await scanner.goto(link!);
  await expect(scanner.getByRole("button", { name: "Continue to reset password" })).toBeVisible();
  await scanner.close();

  // Record any toast shown, even one a full page load wipes (locally the action's
  // redirect is a full load; in production it keeps the page, and the toast).
  await page.addInitScript(() =>
    new MutationObserver(() => {
      const shown = document.querySelector(".app-toast")?.textContent;
      if (shown) sessionStorage.setItem("toast-seen", shown);
    }).observe(document, { childList: true, subtree: true }),
  );
  await page.goto(link!);
  await expect(page).toHaveURL(link!);
  await page.getByRole("button", { name: "Continue to reset password" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth/reset`);
  const newPassword = page.getByLabel("New password · at least 8 characters");
  await expect(newPassword).toBeVisible();
  // A redirecting action is a success: no save-failure toast at any point.
  expect(await page.evaluate(() => sessionStorage.getItem("toast-seen"))).toBeNull();
  await expect(toast(page)).toHaveCount(0);
  // A genuine failure (request dropped) still shows it and keeps the input.
  await page.route("**/auth/reset", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await newPassword.fill("a-brand-new-password");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(toast(page)).toContainText("Could not save. Nothing was lost");
  await expect(newPassword).toHaveValue("a-brand-new-password");
  await page.unroute("**/auth/reset");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);

  // The link works once; the new password signs in.
  await page.goto(link!);
  await page.getByRole("button", { name: "Continue to reset password" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth/recover?link=invalid`);
  await page.goto(`${APP_ORIGIN}/app/today`);
  await signOut(page);
  await signInAs(page, APP_ORIGIN, account.email, "a-brand-new-password");
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
});
