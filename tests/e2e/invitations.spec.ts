// Inviting an admin (Marco, 2026-09-27): A1's Researcher / Admin choice with
// a confirm step, the anonymous email from Mailpit, the invitee setting their
// own password and acknowledging like any researcher, then opening the admin
// back office. Against the real local Supabase.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { ensureAccount, hydrated, latestEmail, serviceClient, signInAs, TEST_PASSWORD, uniqueEmail } from "../support/local-supabase";

const ADMIN = { email: uniqueEmail("e2e-inv-admin"), name: "Marco Moutinho" };

test.beforeAll(async () => {
  await ensureAccount({ ...ADMIN, role: "admin" });
});

const toast = (page: Page) => page.locator(".app-toast");
const row = (page: Page, email: string) => page.getByTestId("invitation-row").filter({ hasText: email });

test("an admin invites an admin: confirm, accept from the email, and the new admin opens the back office", async ({ browser, page }) => {
  const email = uniqueEmail("e2e-inv-newcomer");
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/admin/invitations`);
  await (await hydrated(page.getByLabel("Name"))).fill("Natasha Park");
  await page.getByLabel("Email").fill(email);
  const access = page.getByRole("group", { name: "Access" });
  await expect(access.getByRole("button", { name: "Researcher" })).toHaveAttribute("aria-pressed", "true");
  await access.getByRole("button", { name: "Admin" }).click();
  await expect(access.getByRole("button", { name: "Admin" })).toHaveAttribute("aria-pressed", "true");

  // The confirm step comes first; Cancel sends nothing.
  await page.getByRole("button", { name: "Send invitation" }).click();
  const confirm = page.getByRole("group", { name: "Give this person admin access?" });
  await expect(confirm).toContainText("They'll see all business records: stock, purchases, sales, costs and gross profit");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  expect((await serviceClient().from("invitations").select("id").eq("email", email)).data).toEqual([]);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await page.getByRole("button", { name: "Send admin invitation" }).click();
  await expect(toast(page)).toHaveText(`Invitation sent to ${email}`);
  await expect(row(page, email)).toContainText("Admin · Sent");
  await expect(row(page, email)).toContainText("Pending");
  // The form is back to a researcher invitation.
  await expect(access.getByRole("button", { name: "Researcher" })).toHaveAttribute("aria-pressed", "true");

  // The email is anonymous and role-neutral.
  const mail = await latestEmail(email);
  for (const part of [mail.subject, mail.text, mail.html]) {
    expect(part).not.toContain("Marco");
    expect(part.toLowerCase()).not.toContain("admin");
  }
  const link = /http:\/\/\S+\/auth\/invite\/[A-Za-z0-9_-]{43}/.exec(mail.text)?.[0];
  expect(link).toContain(`${APP_ORIGIN}/auth/invite/`);

  const invitee = await (await browser.newContext()).newPage();
  await invitee.goto(link!);
  // R14 (V4): the invitation page asks for the password itself, and says the access comes with it.
  await expect(invitee.getByRole("heading", { level: 1 })).toHaveText("Join Alpha Research");
  await expect(invitee.getByRole("progressbar", { name: "Step 1 of 3" })).toBeVisible();
  await expect(invitee.getByTestId("invite-role-note")).toHaveText(
    "An Alpha PR Labs admin invited you with admin access. Accepting creates a researcher account with admin access.",
  );
  await expect(invitee.getByText("Marco")).toHaveCount(0);
  await (await hydrated(invitee.getByLabel("Password · 8 characters or more"))).fill(TEST_PASSWORD);
  await invitee.getByRole("button", { name: "Continue" }).click();
  await expect(invitee.getByRole("progressbar", { name: "Step 2 of 3" })).toBeVisible();
  await (await hydrated(invitee.getByRole("checkbox", { name: "I've read this and I'm using the app as a researcher." }))).click();
  await invitee.getByRole("button", { name: "Agree and continue" }).click();
  // R16 is for iPhone Safari only: a desktop browser goes straight on to Today.
  await expect(invitee).toHaveURL(`${APP_ORIGIN}/app/today`);

  // The new admin opens the back office.
  await invitee.goto(`${APP_ORIGIN}/admin`);
  await expect(invitee).toHaveURL(`${APP_ORIGIN}/admin/inventory`);
  await expect(invitee.getByRole("heading", { level: 1 })).toHaveText("Inventory");
  expect((await serviceClient().from("profiles").select("role").eq("email", email)).data).toEqual([{ role: "admin" }]);

  // The used link can't be used again.
  await invitee.goto(link!);
  await expect(invitee.getByRole("heading", { level: 1 })).toHaveText("This invitation was already used");
  await page.reload();
  await expect(row(page, email)).toContainText("Accepted");
});
