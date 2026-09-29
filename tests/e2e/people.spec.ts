// V7 A11 / D8 People and A12 Researcher history, against the real local
// Supabase and its Mailpit inbox: inviting an admin (Marco, 2026-09-27) from
// the laptop card, with the confirm step, the anonymous email, the invitee
// accepting and opening the back office; inviting a researcher from the
// phone's email + Invite and its sheet; resending an expired invitation;
// a shared history and the denied state after the share stops; the old
// Invitations and Support URLs; a researcher reaches none of it. The full
// share / stop journey from Me is tests/e2e/support.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { createCycle, createPeptide, day, interval, plan, tag } from "../support/cycles";
import { ensureAccount, hydrated, latestEmail, ok, seedInvitation, serviceClient, signedInClient, signInAs, TEST_PASSWORD, uniqueEmail } from "../support/local-supabase";
import { shot as saveShot, STATIC_TAB_BAR } from "../support/shots";

const ADMIN = { email: uniqueEmail("v7-people-admin"), name: "Marco Moutinho" };
const RESEARCHER = { email: uniqueEmail("v7-people-researcher"), name: `Jordan Reyes ${tag()}` };
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 820 };
const DENIED = "Jordan hasn't shared their history. Only they can turn it on, from Me.";

const id = { admin: "", researcher: "" };

test.beforeAll(async () => {
  id.admin = await ensureAccount({ ...ADMIN, role: "admin" });
  id.researcher = await ensureAccount({ ...RESEARCHER, role: "researcher" });
});

/** Screenshots only when asked for (SHOTS_DIR, tests/support/shots.ts). */
const shot = (page: Page, name: string) => saveShot(page, `v7-${name}`, { style: STATIC_TAB_BAR });
const toast = (page: Page) => page.locator('[data-slot="toast"]');
/** A laptop table row (D8). */
const line = (page: Page, text: string) => page.getByTestId("person-line").filter({ hasText: text });
/** A phone row (A11). */
const phoneRow = (page: Page, text: string) => page.getByTestId("person-row").filter({ hasText: text });

async function openPeople(page: Page) {
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/admin/people`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("People");
}

test("laptop: an admin invites an admin (confirm first), who accepts from the email and opens the back office", async ({ browser, page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(LAPTOP);
  const email = uniqueEmail("v7-people-newcomer");
  await openPeople(page);
  await expect(page.getByTestId("people-meta")).toHaveText(/^\d+ researchers? · \d+ admins?$/);
  const form = page.getByTestId("invite-form-card");
  await (await hydrated(form.getByLabel("Name", { exact: true }))).fill("Natasha Park");
  await form.getByLabel("Email", { exact: true }).fill(email);
  const access = form.getByRole("group", { name: "Access" });
  await expect(access.getByRole("button", { name: "Researcher" })).toHaveAttribute("aria-pressed", "true");
  await access.getByRole("button", { name: "Admin" }).click();
  await expect(access.getByRole("button", { name: "Admin" })).toHaveAttribute("aria-pressed", "true");
  await expect(form).toContainText("Valid for 30 days. An invitation gives no access to the person's history; only they can share it.");

  // The confirm step comes first; Cancel sends nothing.
  await form.getByTestId("send-invitation").click();
  const confirm = form.getByRole("group", { name: "Give this person admin access?" });
  await expect(confirm).toContainText("They'll see all business records: stock, purchases, sales, costs and gross profit");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  expect(await ok(serviceClient().from("invitations").select("id").eq("email", email), "none yet")).toEqual([]);
  await form.getByTestId("send-invitation").click();
  await form.getByRole("button", { name: "Send admin invitation" }).click();
  await expect(toast(page)).toContainText(`Invitation sent to ${email}`);
  const invited = page.getByTestId("admins").getByTestId("person-line").filter({ hasText: email });
  await expect(invited).toHaveAttribute("data-kind", "invite");
  await expect(invited.getByTestId("person-status")).toHaveText(/^Invited · expires \w{3} \d+$/);
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

  const inviteeContext = await browser.newContext();
  const invitee = await inviteeContext.newPage();
  await invitee.goto(link!);
  await expect(invitee.getByRole("heading", { level: 1 })).toHaveText("Join Alpha Research");
  await expect(invitee.getByTestId("invite-role-note")).toHaveText(
    "An Alpha PR Labs admin invited you with admin access. Accepting creates a researcher account with admin access.",
  );
  await expect(invitee.getByText("Marco")).toHaveCount(0);
  await (await hydrated(invitee.getByLabel("Password · 8 characters or more"))).fill(TEST_PASSWORD);
  await invitee.getByRole("button", { name: "Continue" }).click();
  await (await hydrated(invitee.getByRole("checkbox", { name: "I've read this and I'm using the app as a researcher." }))).click();
  await invitee.getByRole("button", { name: "Agree and continue" }).click();
  await expect(invitee).toHaveURL(`${APP_ORIGIN}/app/today`);
  await invitee.goto(`${APP_ORIGIN}/admin/people`);
  await expect(invitee.getByRole("heading", { level: 1 })).toHaveText("People");
  expect(await ok(serviceClient().from("profiles").select("role").eq("email", email), "role")).toEqual([{ role: "admin" }]);
  await inviteeContext.close();

  // Accepted: the invitation row becomes the admin's account.
  await page.reload();
  const joined = page.getByTestId("admins").getByTestId("person-line").filter({ hasText: email });
  await expect(joined).toHaveAttribute("data-kind", "account");
  await expect(joined).toContainText("Natasha Park");
  await expect(joined.getByTestId("person-status")).toHaveText("Admin");
  await expect(line(page, ADMIN.email)).toContainText("(you)");
});

for (const scheme of ["light", "dark"] as const) {
  test(`phone (${scheme}): invite a researcher from the email field and its sheet`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(PHONE);
    const email = uniqueEmail(`v7-people-phone-${scheme}`);
    await openPeople(page);
    await expect(page.getByRole("main").getByRole("link", { name: "Business", exact: true })).toBeVisible();
    await shot(page, `people-phone-${scheme}`);

    await (await hydrated(page.getByLabel("Email to invite"))).fill(email);
    await page.getByTestId("quick-invite").click();
    const sheet = page.getByRole("dialog", { name: "Invite someone" });
    await expect(sheet.getByLabel("Email", { exact: true })).toHaveValue(email);
    await sheet.getByLabel("Name", { exact: true }).fill("Dana Lin");
    await expect(sheet.getByRole("group", { name: "Access" }).getByRole("button", { name: "Researcher" })).toHaveAttribute("aria-pressed", "true");
    await shot(page, `people-invite-sheet-phone-${scheme}`);
    await sheet.getByTestId("send-invitation").click();
    await expect(toast(page)).toContainText(`Invitation sent to ${email}`);
    await expect(sheet).toHaveCount(0);
    await expect(page.getByLabel("Email to invite")).toHaveValue("");
    const row = page.getByTestId("researchers").getByTestId("person-row").filter({ hasText: email });
    await expect(row).toHaveAttribute("data-kind", "invite");
    await expect(row.getByTestId("person-status")).toHaveText(/^Invited · expires \w{3} \d+$/);

    // A second invitation to the same address is refused inline.
    await page.getByLabel("Email to invite").fill(email);
    await page.getByTestId("quick-invite").click();
    await sheet.getByTestId("send-invitation").click();
    await expect(sheet.getByRole("alert")).toHaveText(`${email} already has a pending invitation.`);
  });
}

test("laptop: resend an expired invitation", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  const email = uniqueEmail("v7-people-expired");
  const token = await seedInvitation({ email, name: "Lee Tran", sentDaysAgo: 31, invitedBy: id.admin });
  await openPeople(page);
  const row = line(page, email);
  await expect(row.getByTestId("person-status")).toHaveText(/^Invite expired \w{3} \d+$/);
  await expect(row.getByTestId("person-status")).toHaveAttribute("data-tone", "expired");
  await (await hydrated(row.getByTestId("resend"))).click();
  await expect(toast(page)).toContainText(`Invitation resent to ${email}`);
  await expect(row.getByTestId("person-status")).toHaveText(/^Invited · expires \w{3} \d+$/);
  await expect(row.getByTestId("resend")).toHaveCount(0);
  const resent = await latestEmail(email);
  expect(resent.text).toContain("You've been invited to Alpha PR Labs Research.");
  for (const part of [resent.subject, resent.text, resent.html]) expect(part).not.toContain("Marco");
  // The old link died with the resend.
  await page.goto(`${APP_ORIGIN}/auth/invite/${token}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This invitation was already used");
});

test("a shared history opens read-only; after the share stops, the next request is denied", async ({ page }) => {
  test.setTimeout(90_000);
  // The researcher's own cycle (made here: beforeAll runs once per worker), never visible without a share.
  const researcherDb = await signedInClient(RESEARCHER.email);
  const peptide = await createPeptide(await signedInClient(ADMIN.email), `V7 People peptide ${tag()}`);
  const cycleName = `Recovery protocol ${tag()}`;
  await createCycle(researcherDb, { name: cycleName, goal: "Leaner by October", plans: [plan(peptide, [interval(day(-3), day(24), "0.25", 1)])] });
  const history = `${APP_ORIGIN}/admin/people/${id.researcher}`;
  await page.setViewportSize(LAPTOP);
  await openPeople(page);
  await expect(line(page, RESEARCHER.email).getByTestId("view-history")).toHaveCount(0);

  await ok(researcherDb.rpc("share_with_team"), "share");
  await page.reload();
  await line(page, RESEARCHER.email).getByTestId("view-history").click();
  await expect(page).toHaveURL(history);
  await expect(page.getByTestId("history-banner")).toHaveText(/^Read-only · shared by Jordan on \w{3} \d+$/);
  await expect(page.getByTestId("history-sub")).toHaveText(`${cycleName} · day 4 of 28`);
  await expect(page.getByTestId("history-now")).toContainText("Adherence this cycle");
  await expect(page.getByTestId("recent-row").first()).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(LAPTOP);
    await shot(page, `history-shared-laptop-${scheme}`);
    await page.setViewportSize(PHONE);
    await expect(page.getByTestId("history-banner")).toBeVisible();
    await shot(page, `history-shared-phone-${scheme}`);
  }
  await page.setViewportSize(PHONE);
  await page.getByRole("main").getByRole("link", { name: "People", exact: true }).click();
  await expect(phoneRow(page, RESEARCHER.name).getByTestId("person-status")).toHaveText(/^Shared since \w{3} \d+$/);

  await ok(researcherDb.rpc("stop_sharing_with_team"), "stop");
  await page.goto(history);
  await expect(page.getByTestId("history-denied")).toBeVisible();
  await expect(page.getByTestId("denied-text")).toHaveText(DENIED);
  await expect(page.getByText(cycleName)).toHaveCount(0);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(PHONE);
    await shot(page, `history-denied-phone-${scheme}`);
    await page.setViewportSize(LAPTOP);
    await shot(page, `history-denied-laptop-${scheme}`);
  }
  await page.goto(`${APP_ORIGIN}/admin/people`);
  await expect(line(page, RESEARCHER.email).getByTestId("person-status")).toHaveText(/^Private · revoked \w{3} \d+$/);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await shot(page, `people-laptop-${scheme}`);
  }
});

test("a history opened a moment ago is asked for again: back through People after the share stops, it's denied", async ({ page }) => {
  // Its own researcher: the test above shares and stops Jordan's.
  const researcher = { email: uniqueEmail("v7-people-revisit"), name: `Jordan Revisit ${tag()}` };
  const researcherId = await ensureAccount({ ...researcher, role: "researcher" });
  const researcherDb = await signedInClient(researcher.email);
  const peptide = await createPeptide(await signedInClient(ADMIN.email), `V7 Revisit peptide ${tag()}`);
  const cycleName = `Revisit protocol ${tag()}`;
  await createCycle(researcherDb, { name: cycleName, plans: [plan(peptide, [interval(day(-3), day(24), "0.25", 1)])] });
  await ok(researcherDb.rpc("share_with_team"), "share");
  const history = `${APP_ORIGIN}/admin/people/${researcherId}`;
  await page.setViewportSize(PHONE);
  await openPeople(page);

  // People → the shared history → People again, all within the app.
  await (await hydrated(phoneRow(page, researcher.name))).click();
  await expect(page).toHaveURL(history);
  await expect(page.getByTestId("history-banner")).toBeVisible();
  await expect(page.getByText(cycleName).first()).toBeVisible();
  await (await hydrated(page.getByRole("main").getByRole("link", { name: "People", exact: true }))).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/people`);
  // People itself, not its loading skeleton: the row links to the history (the share is still on).
  await expect(phoneRow(page, researcher.name)).toHaveAttribute("href", `/admin/people/${researcherId}`);

  // The researcher stops sharing; seconds later the admin follows the row still on screen to the history.
  await ok(researcherDb.rpc("stop_sharing_with_team"), "stop");
  // 3 s on (within the 30 s asked about): Next.js drops a visited page by the wall clock, which on this
  // machine steps back about 2 s now and then, and would then keep it for that long.
  await page.waitForTimeout(3_000);
  const asked = page.waitForRequest((request) => new URL(request.url()).pathname === `/admin/people/${researcherId}` && Boolean(request.headers()["rsc"]));
  await phoneRow(page, researcher.name).click();
  await asked;
  await expect(page).toHaveURL(history);
  await expect(page.getByTestId("history-denied")).toBeVisible();
  await expect(page.getByText(cycleName)).toHaveCount(0);
  await expect(page.getByTestId("history-banner")).toHaveCount(0);
});

test("the old Invitations, Support and Templates URLs land on their V7 screens", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  for (const [from, to] of [
    ["/admin/invitations", "/admin/people"],
    ["/admin/support", "/admin/people"],
    [`/admin/support/${id.researcher}`, `/admin/people/${id.researcher}`],
    ["/admin/templates", "/admin/library/templates"],
  ]) {
    await page.goto(`${APP_ORIGIN}${from}`);
    await expect(page).toHaveURL(`${APP_ORIGIN}${to}`);
  }
});

test("a researcher reaches none of People", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  for (const path of ["/admin/people", `/admin/people/${id.researcher}`, `/admin/people/${id.admin}`, "/admin/invitations", `/admin/support/${id.researcher}`]) {
    await page.goto(`${APP_ORIGIN}${path}`);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  }
});
