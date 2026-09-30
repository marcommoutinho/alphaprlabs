// Template drafts (Marco, 2026-09-30, "Yes to draft stage";
// 20261001100000_template_drafts.sql), against the real local Supabase, on a
// phone and a laptop: an admin saves a new template as a draft (the list
// tags it Draft; researchers don't see it: not in Templates, its page and a
// copy are not found), publishes it (researchers see it), then moves it back
// to draft (gone again). The database rules themselves:
// tests/integration/template-drafts.test.ts.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { APP_ORIGIN } from "../../playwright.config";
import { ensureAccount, hydrated, ok, serviceClient, signInAs, uniqueEmail } from "../support/local-supabase";
import { shot as saveShot, STATIC_TAB_BAR } from "../support/shots";

const ADMIN = { email: uniqueEmail("tpl-drafts-e2e-admin"), name: "Drafts E2E Admin" };
const RESEARCHER = { email: uniqueEmail("tpl-drafts-e2e-researcher"), name: "Drafts E2E Researcher" };
const VIEWPORTS = { phone: { width: 390, height: 844 }, laptop: { width: 1280, height: 820 } } as const;

test.beforeAll(async () => {
  await ensureAccount({ ...ADMIN, role: "admin" });
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
});

/** Screenshots only when asked for (SHOTS_DIR, tests/support/shots.ts). */
const shot = (page: Page, name: string) => saveShot(page, `drafts-${name}`, { style: STATIC_TAB_BAR });
const unique = (label: string) => `${label} ${randomBytes(3).toString("hex")}`;
const card = (page: Page, name: string) => page.getByTestId("template-card").filter({ hasText: name });
const toast = (page: Page) => page.locator('[data-slot="toast"]');

async function seedPeptide(name: string) {
  const [row] = await ok(serviceClient().from("peptides").insert({ name, information: `[Supplied information for ${name}]`, available: true }).select("id"), name);
  return row.id as string;
}

async function researcherPage(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  return page;
}

/** What the researcher sees of the template: listed in Templates, its page, and the builder's copy. */
async function expectResearcher(page: Page, id: string, name: string, visible: boolean) {
  await page.goto(`${APP_ORIGIN}/app/cycles/templates`);
  await expect(page.getByRole("heading", { level: 1, name: "Templates" })).toBeVisible();
  await expect(page.getByTestId("cycle-template").filter({ hasText: name })).toHaveCount(visible ? 1 : 0);
  await page.goto(`${APP_ORIGIN}/app/library/templates/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(visible ? name : "This page could not be found.");
  await page.goto(`${APP_ORIGIN}/app/cycles/new?template=${id}`);
  if (visible) await expect(page.getByText("This page could not be found.")).toHaveCount(0);
  else await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page could not be found.");
}

for (const [device, viewport] of Object.entries(VIEWPORTS)) {
  const laptop = device === "laptop";

  test(`${device}: a draft is hidden from researchers until published, and hidden again when moved back to draft`, async ({ page, browser }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const peptide = unique("Drafts peptide");
    await seedPeptide(peptide);
    const name = unique(`Draft template ${device}`);

    // A new template, saved as a draft.
    await signInAs(page, APP_ORIGIN, ADMIN.email);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
    await page.goto(`${APP_ORIGIN}/admin/library/templates/new`);
    await expect(page.getByTestId("template-state-line")).toHaveText("New · not visible to researchers until published");
    await (await hydrated(page.getByTestId("template-name"))).fill(name);
    await page.getByTestId(laptop ? "add-peptide" : "add-peptide-phone").click();
    await page.getByTestId("peptide-picker").getByRole("button", { name: peptide, exact: true }).click();
    await expect(page.getByTestId("peptide-picker")).toHaveCount(0);
    await page.getByTestId("phase-dose").fill("250");
    await page.getByTestId("phase-unit").selectOption("mcg");
    await expect(page.getByTestId("builder-issues")).toHaveCount(0);
    await page.getByTestId("save-draft").click();
    await expect(toast(page)).toContainText(`Draft saved · ${name}. Researchers can't see it.`);
    // Phone: back to the list; laptop: the new template's editor.
    await expect(page).toHaveURL(laptop ? /\/admin\/library\/templates\/[0-9a-f-]{36}$/ : `${APP_ORIGIN}/admin/library/templates`);
    const [{ id, published_at }] = await ok(serviceClient().from("cycle_templates").select("id, published_at").eq("name", name), "stored");
    expect(published_at).toBeNull();

    // The list tags it Draft.
    await page.goto(`${APP_ORIGIN}/admin/library/templates`);
    await expect(card(page, name)).toHaveAttribute("data-state", "draft");
    await expect(card(page, name).getByTestId("template-draft")).toHaveText("Draft");
    await card(page, name).scrollIntoViewIfNeeded();
    await shot(page, `list-with-draft-${device}`);

    // The draft's editor: the draft state line, Save draft and Publish (phone: Save and publish).
    await card(page, name).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/admin/library/templates/${id}`);
    await expect(page.getByTestId("template-editor")).toHaveAttribute("data-state", "draft");
    await expect(page.getByTestId("template-state-line")).toHaveText("Draft · not visible to researchers");
    await expect(page.getByTestId("save-draft")).toHaveText("Save draft");
    await expect(page.getByTestId("save-publish")).toHaveText(laptop ? "Publish" : "Save and publish");
    await expect(page.getByTestId("move-to-draft")).toHaveCount(0);
    await shot(page, `editor-draft-footer-${device}`);

    const researcher = await researcherPage(browser, viewport);
    await expectResearcher(researcher, id, name, false);

    // Published: researchers see it.
    await (await hydrated(page.getByTestId("save-publish"))).click();
    await expect(toast(page)).toContainText(`${name} published. Researchers can see it now.`);
    await expect.poll(async () => (await ok(serviceClient().from("cycle_templates").select("published_at").eq("id", id), "state"))[0].published_at).not.toBeNull();
    await expectResearcher(researcher, id, name, true);

    // The published editor: Move to draft and Save and publish; the list has no Draft tag.
    await page.goto(`${APP_ORIGIN}/admin/library/templates`);
    await expect(card(page, name)).toHaveAttribute("data-state", "published");
    await expect(card(page, name).getByTestId("template-draft")).toHaveCount(0);
    await card(page, name).click();
    await expect(page.getByTestId("template-editor")).toHaveAttribute("data-state", "published");
    await expect(page.getByTestId("template-state-line")).toHaveCount(0);
    await expect(page.getByTestId("move-to-draft")).toHaveText("Move to draft");
    await expect(page.getByTestId("save-draft")).toHaveCount(0);
    await expect(page.getByTestId("save-publish")).toHaveText("Save and publish");
    await shot(page, `editor-published-footer-${device}`);

    // Moved back to draft: gone for researchers again.
    await (await hydrated(page.getByTestId("move-to-draft"))).click();
    await expect(toast(page)).toContainText(`Draft saved · ${name}. Researchers can't see it.`);
    await expect.poll(async () => (await ok(serviceClient().from("cycle_templates").select("published_at").eq("id", id), "state"))[0].published_at).toBeNull();
    await page.goto(`${APP_ORIGIN}/admin/library/templates`);
    await expect(card(page, name).getByTestId("template-draft")).toHaveText("Draft");
    await expectResearcher(researcher, id, name, false);
    await researcher.context().close();
  });
}
