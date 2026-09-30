// The research terms and the template notices (Marco, 2026-09-30), against
// the real local Supabase: a new joiner reads and agrees to the terms at step
// 2 of 3; someone who agreed to an earlier version is sent back to them, with
// the updated lead and no joining steps, before anything on the research side,
// and lands on Today; Me reopens them with the version and date; every
// template page and the start-from-template step carry the reference notice;
// a cycle made from a template carries its note; the admin template editor
// shows the writing rules. Phone screens, light and dark
// (SHOTS_DIR=test-results/terms-shots).
import { expect, test, type Browser, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { ACKNOWLEDGEMENT_VERSION } from "../../src/lib/auth/paths";
import { saveTemplateAs } from "../support/admin-writers";
import { createCycle, interval, plan, tag } from "../support/cycles";
import { ensureAccount, hydrated, ok, seedInvitation, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";
import { d, NOON } from "../support/noon";
import { shot as saveShot } from "../support/shots";
import { seedPeptide } from "../support/today";

// The approved wording, word for word.
const HEADING = "Research terms";
const LEAD = "Your agreement to these terms will be recorded with your account.";
const UPDATED_LEAD = "You must accept the updated terms before continuing, and your agreement will be recorded with your account.";
const CHECKBOX = "I am a researcher using this app for my own research, and I have read and accept these terms.";
const ME_LINK = "Research terms";
const TEMPLATE_NOTICE =
  "This reference example draws from published research and researcher discussions. It has not been verified, is not a recommendation, and leaves you to decide your own plan.";
const CYCLE_FROM_TEMPLATE_NOTE = "Your own copy of the template, your own responsibility.";
const SECTION_TITLES = [
  "Research use only.",
  "Who can use the app.",
  "What the app is.",
  "Cycle templates.",
  "Your responsibility.",
  "Health.",
  "Risk and liability.",
  "Privacy.",
  "Access.",
  "Changes and law.",
];
const CHECKLIST = [
  "Write guidance as reference information, never instructions such as “take” or “you should.”",
  "Make no health claims or promises of results.",
  "Name each template after its regimen, never as an Alpha PR Labs protocol.",
];

const OLD_VERSION = "2026-09-placeholder";
const PHONE = { width: 390, height: 844 };
const SCHEMES = ["light", "dark"] as const;
type Scheme = (typeof SCHEMES)[number];

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = (page: Page, name: string) => saveShot(page, `terms-${name}`, { fullPage: true });
const phone = (browser: Browser, scheme: Scheme) => browser.newContext({ viewport: PHONE, colorScheme: scheme, hasTouch: true, isMobile: true });
const stored = async (email: string) =>
  (await serviceClient().from("profiles").select("acknowledgement_version, acknowledged_at").eq("email", email).single()).data!;

for (const scheme of SCHEMES) {
  test(`a new joiner reads the terms at step 2 of 3 and agrees (${scheme})`, async ({ browser }) => {
    const email = uniqueEmail(`terms-join-${scheme}`);
    const token = await seedInvitation({ email, name: "Jordan Reyes" });
    const context = await phone(browser, scheme);
    const page = await context.newPage();
    await page.goto(`${APP_ORIGIN}/auth/invite/${token}`);
    await (await hydrated(page.getByLabel("Password · 8 characters or more"))).fill("correct-horse-42");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page).toHaveURL(`${APP_ORIGIN}/auth/acknowledge`);
    await expect(page.getByRole("progressbar", { name: "Step 2 of 3" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADING);
    await expect(page.getByText(LEAD, { exact: true })).toBeVisible();
    await expect(page.getByText(UPDATED_LEAD)).toHaveCount(0);
    const terms = page.getByRole("region", { name: HEADING });
    await expect(terms).toHaveCSS("height", "330px");
    await expect(terms.getByTestId("terms-section").locator("strong")).toHaveText(SECTION_TITLES);
    await expect(terms).not.toContainText("placeholder");
    await expect(terms).toContainText(
      "Ontario law and applicable Canadian federal law govern these terms.",
    );
    expect(await noSideScroll(page)).toBe(true);
    await shot(page, `join-step-${scheme}`);

    const agree = page.getByRole("button", { name: "Agree and continue" });
    await expect(agree).toBeDisabled();
    await (await hydrated(page.getByRole("checkbox", { name: CHECKBOX }))).click();
    await agree.click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/auth/install`);
    expect((await stored(email)).acknowledgement_version).toBe(ACKNOWLEDGEMENT_VERSION);
    await context.close();
  });

  test(`an earlier version's agreement is sent back to the terms, agrees again, and lands on Today; Me shows them (${scheme})`, async ({
    browser,
  }) => {
    const email = uniqueEmail(`terms-again-${scheme}`);
    await ensureAccount({ email, name: "Riley Returning", role: "researcher", termsVersion: OLD_VERSION });
    const before = await stored(email);
    const context = await phone(browser, scheme);
    const page = await context.newPage();

    // Signing in goes to the terms, not the research side.
    await signInAs(page, APP_ORIGIN, email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/auth/acknowledge`);
    // Every research page sends them back there.
    for (const path of ["/app/today", "/app/cycles", "/app/me", "/app/me/disclaimer"]) {
      await page.goto(`${APP_ORIGIN}${path}`);
      await expect(page, path).toHaveURL(`${APP_ORIGIN}/auth/acknowledge`);
    }
    // No joining steps; the updated lead.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADING);
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await expect(page.getByText(UPDATED_LEAD, { exact: true })).toBeVisible();
    await expect(page.getByText(LEAD, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: HEADING }).getByTestId("terms-section")).toHaveCount(SECTION_TITLES.length);
    expect(await noSideScroll(page)).toBe(true);
    await shot(page, `reagree-step-${scheme}`);

    await (await hydrated(page.getByRole("checkbox", { name: CHECKBOX }))).click();
    await page.getByRole("button", { name: "Agree and continue" }).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
    const after = await stored(email);
    expect(after.acknowledgement_version).toBe(ACKNOWLEDGEMENT_VERSION);
    expect(Date.parse(after.acknowledged_at!)).toBeGreaterThan(Date.parse(before.acknowledged_at!));

    // Me › Research terms: read-only, with the version and when.
    await page.goto(`${APP_ORIGIN}/app/me`);
    const row = page.getByTestId("me-disclaimer");
    await expect(row).toContainText(ME_LINK);
    await row.click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/me/disclaimer`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ME_LINK);
    await expect(page.getByTestId("disclaimer-accepted")).toContainText(
      new RegExp(`^You agreed on \\w{3}, \\w{3} \\d+, \\d{4} · \\d+:\\d\\d [AP]M\\.Version ${ACKNOWLEDGEMENT_VERSION}$`),
    );
    await expect(page.getByRole("region", { name: HEADING }).getByTestId("terms-section")).toHaveCount(SECTION_TITLES.length);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    expect(await noSideScroll(page)).toBe(true);
    await shot(page, `me-terms-${scheme}`);
    await context.close();
  });
}

test("an admin with an earlier version's agreement keeps the back office, and agrees again for the research side", async ({ page }) => {
  const email = uniqueEmail("terms-again-admin");
  await ensureAccount({ email, name: "Avery Returning", role: "admin", termsVersion: OLD_VERSION });
  await page.setViewportSize(PHONE);
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth/acknowledge`);
  // The back office never needed the terms, and still doesn't.
  await page.goto(`${APP_ORIGIN}/admin/business`);
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/business`);
  await page.goto(`${APP_ORIGIN}/app/today`);
  await expect(page).toHaveURL(`${APP_ORIGIN}/auth/acknowledge`);
  await expect(page.getByText(UPDATED_LEAD, { exact: true })).toBeVisible();
  await (await hydrated(page.getByRole("checkbox", { name: CHECKBOX }))).click();
  await page.getByRole("button", { name: "Agree and continue" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  expect((await stored(email)).acknowledgement_version).toBe(ACKNOWLEDGEMENT_VERSION);
});

test("templates carry the reference notice; a cycle made from one carries its note; the editor shows the writing rules", async ({ browser }) => {
  const t = tag();
  const researcher = uniqueEmail("terms-templates");
  const admin = uniqueEmail("terms-templates-admin");
  await ensureAccount({ email: researcher, name: "Template Researcher", role: "researcher" });
  await ensureAccount({ email: admin, name: "Template Admin", role: "admin" });
  const peptideName = `Terms peptide ${t}`;
  const peptideId = await seedPeptide(peptideName);
  const templateName = `Terms starter ${t}`;
  const phases = [{ kind: "active", offset_days: 0, length_days: 28, dose_mg: "0.4", local_time: "08:00", schedule_type: "interval", every_days: 2 }];
  const templateId = await ok(
    saveTemplateAs(await signedInClient(admin), { p_name: templateName, p_guidance: `Guidance for ${templateName}`, p_plans: [{ peptide_id: peptideId, phases }] }),
    "template",
  );
  const mine = await signedInClient(researcher);
  const fromTemplate = await createCycle(mine, { name: `From template ${t}`, timeZone: NOON, templateId, plans: [plan(peptideId, [interval(d(-2), d(20))])] });
  const custom = await createCycle(mine, { name: `Custom ${t}`, timeZone: NOON, plans: [plan(peptideId, [interval(d(-2), d(20))])] });

  for (const scheme of SCHEMES) {
    const context = await phone(browser, scheme);
    const page = await context.newPage();
    await signInAs(page, APP_ORIGIN, researcher);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);

    // The template page: the notice at the top, before the plans.
    await page.goto(`${APP_ORIGIN}/app/library/templates/${templateId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(templateName);
    const notice = page.getByTestId("template-reference-notice");
    await expect(notice).toHaveText(TEMPLATE_NOTICE);
    await expect(notice).toHaveAttribute("role", "note");
    expect((await notice.boundingBox())!.y).toBeLessThan((await page.getByTestId("template-plan").first().boundingBox())!.y);
    expect(await noSideScroll(page)).toBe(true);
    await shot(page, `template-page-${scheme}`);

    // The step that starts a cycle from it.
    await (await hydrated(page.getByRole("link", { name: "Use as starting point" }))).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/cycles/new?template=${templateId}`);
    await expect(page.getByTestId("template-note")).toContainText(templateName);
    await expect(page.getByTestId("template-reference-notice")).toHaveText(TEMPLATE_NOTICE);
    await shot(page, `template-start-${scheme}`);
    // A custom cycle's first step has neither.
    await page.goto(`${APP_ORIGIN}/app/cycles/new`);
    await expect(page.getByTestId("builder-title")).toHaveText("New cycle");
    await expect(page.getByTestId("template-reference-notice")).toHaveCount(0);

    // A cycle made from the template, and one that wasn't.
    await page.goto(`${APP_ORIGIN}/app/cycles/${fromTemplate}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`From template ${t}`);
    await expect(page.getByTestId("cycle-template-note")).toHaveText(CYCLE_FROM_TEMPLATE_NOTE);
    await shot(page, `cycle-from-template-${scheme}`);
    await page.goto(`${APP_ORIGIN}/app/cycles/${custom}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Custom ${t}`);
    await expect(page.getByTestId("cycle-template-note")).toHaveCount(0);
    await context.close();

    // The admin template editor: the writing rules beside the guidance, new and existing.
    const adminContext = await phone(browser, scheme);
    const adminPage = await adminContext.newPage();
    await signInAs(adminPage, APP_ORIGIN, admin);
    await expect(adminPage).toHaveURL(`${APP_ORIGIN}/app/today`);
    for (const path of [`/admin/library/templates/${templateId}`, "/admin/library/templates/new"]) {
      await adminPage.goto(`${APP_ORIGIN}${path}`);
      const rules = adminPage.getByTestId("template-writing-rules");
      await expect(rules.locator("p")).toHaveText("Template writing rules");
      await expect(rules.getByRole("listitem")).toHaveText(CHECKLIST);
      await expect(adminPage.getByTestId("template-guidance")).toBeVisible();
    }
    await adminPage.goto(`${APP_ORIGIN}/admin/library/templates/${templateId}`);
    await expect(adminPage.getByTestId("template-writing-rules")).toBeVisible();
    await shot(adminPage, `admin-editor-${scheme}`);
    await adminContext.close();
  }
});
