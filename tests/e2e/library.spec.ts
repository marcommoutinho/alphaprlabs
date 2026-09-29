// V7 A8 / D6 Library and A9 Edit peptide, against the real local Supabase:
// an admin adds a draft, which no researcher can see or open until it is
// published; publishes it; previews it as a researcher; stops offering it
// (hidden from the researcher library again); on a phone, the full-screen
// editor and a save over another admin's ("Changed by …", Load latest).
// The library is shared by every run, so entries are found by their unique
// names. Exact rules and the SQL checks: tests/integration/admin-content.test.ts.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { APP_ORIGIN } from "../../playwright.config";
import { ensureAccount, hydrated, ok, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";
import { shot as saveShot, STATIC_TAB_BAR } from "../support/shots";

const ADMIN = { email: uniqueEmail("v7-lib-admin"), name: "Priya Sandhu" };
const SECOND = { email: uniqueEmail("v7-lib-second"), name: "Owen Marchetti" };
const RESEARCHER = { email: uniqueEmail("v7-lib-researcher"), name: "V7 Library Researcher" };
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 820 };

test.beforeAll(async () => {
  await ensureAccount({ ...ADMIN, role: "admin" });
  await ensureAccount({ ...SECOND, role: "admin" });
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
});

/** Screenshots only when asked for (SHOTS_DIR, tests/support/shots.ts). */
const shot = (page: Page, name: string) => saveShot(page, `v7-${name}`, { style: STATIC_TAB_BAR });
const unique = (label: string) => `${label} ${randomBytes(3).toString("hex")}`;
const row = (page: Page, name: string) => page.getByTestId("library-row").filter({ hasText: name });
const editor = (page: Page) => page.getByTestId("peptide-editor");
const toast = (page: Page) => page.locator('[data-slot="toast"]');
const stored = async (name: string) => (await ok(serviceClient().from("peptides").select("*").eq("name", name), "stored"))[0];

async function openLibrary(page: Page) {
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/admin/library`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Library");
}

/** What a researcher sees of the entry: listed in their library, and whether its page opens. */
async function researcherSees(browser: Browser, id: string, name: string) {
  const context = await browser.newContext({ viewport: LAPTOP });
  const page = await context.newPage();
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/app/library`);
  await expect(page.getByTestId("library-peptide").first()).toBeVisible();
  const listed = await page.getByTestId("library-peptide").filter({ hasText: name }).count();
  await page.goto(`${APP_ORIGIN}/app/library/peptides/${id}`);
  const heading = (await page.getByRole("heading", { level: 1 }).first().textContent())?.trim();
  await context.close();
  return { listed: listed > 0, opens: heading === name };
}

test("laptop: a draft stays invisible to researchers until published, then stops being offered", async ({ browser, page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(LAPTOP);
  const name = unique("V7 Draftide");
  await openLibrary(page);
  await expect(page.getByTestId("library-idle")).toBeVisible();
  await page.getByRole("navigation", { name: "Library" }).getByRole("link", { name: /^Peptides · \d+$/ }).waitFor();

  await page.getByTestId("library-add-laptop").click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/library/peptides/new`);
  await expect(editor(page)).toHaveAttribute("data-state", "new");
  await expect(page.getByTestId("save-draft")).toBeDisabled();
  await expect(page.getByTestId("save-publish")).toHaveText("Publish");
  await expect(page.getByTestId("save-publish")).toBeDisabled();

  await (await hydrated(page.getByTestId("peptide-name"))).fill(name);
  await page.getByTestId("peptide-short").fill("Tissue-repair research peptide");
  await expect(page.getByTestId("summary-required")).toHaveText("Required to publish");
  await expect(page.getByTestId("save-draft")).toBeEnabled();
  await expect(page.getByTestId("save-publish")).toBeDisabled();
  await page.getByTestId("strength-new").click();
  await page.getByTestId("strength-input").fill("5");
  await page.getByTestId("strength-add").click();
  await expect(page.getByTestId("strength-chip")).toHaveText(["5 mg"]);

  await page.getByTestId("save-draft").click();
  await expect(toast(page)).toContainText(`Draft saved · ${name}. Researchers can't see it.`);
  await expect(page).toHaveURL(/\/admin\/library\/peptides\/[0-9a-f-]{36}$/);
  await expect(editor(page)).toHaveAttribute("data-state", "draft");
  await expect(page.getByTestId("peptide-state-line")).toHaveText("Draft · not visible to researchers");
  await expect(row(page, name)).toHaveAttribute("data-state", "draft");
  await expect(row(page, name)).toHaveAttribute("aria-current", "page");
  await expect(row(page, name)).toContainText("Draft");
  const draft = await stored(name);
  expect(draft).toMatchObject({ published_at: null, available: false, offered: true, short_description: "Tissue-repair research peptide", version: 1 });
  expect(await researcherSees(browser, draft.id, name)).toEqual({ listed: false, opens: false });

  // Publish: the summary is required, then researchers see it.
  await page.getByTestId("peptide-summary-input").fill("[Supplied research summary]");
  await expect(page.getByTestId("save-publish")).toBeEnabled();
  await page.getByTestId("save-publish").click();
  await expect(toast(page)).toContainText(`${name} published. Researchers can see it now.`);
  await expect(page.getByTestId("peptide-state-line")).toHaveText("Offered · visible to researchers");
  await expect(page.getByTestId("save-draft")).toHaveCount(0);
  await expect(page.getByTestId("save-publish")).toHaveText("Save and publish");
  await expect(row(page, name)).toHaveAttribute("data-state", "offered");
  expect(await stored(name)).toMatchObject({ available: true, offered: true, version: 2 });
  expect(await researcherSees(browser, draft.id, name)).toEqual({ listed: true, opens: true });

  // Preview as researcher: the saved entry, read-only.
  await page.getByTestId("peptide-preview").click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/library/peptides/${draft.id}/preview`);
  await expect(page.getByTestId("preview-banner")).toBeVisible();
  await expect(page.getByTestId("peptide-preview-pane").getByRole("heading", { level: 2, name })).toBeVisible();
  await expect(page.getByText("[Supplied research summary]")).toBeVisible();
  await row(page, name).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/library/peptides/${draft.id}`);

  // Not offered: hidden from researchers' library and new cycles; the entry stays.
  await expect(page.getByTestId("usage-note-laptop")).toHaveText("No researcher cycle or template uses it yet.");
  await (await hydrated(page.getByRole("switch", { name: "Offered for new cycles" }))).click();
  await page.getByTestId("save-publish").click();
  await expect(toast(page)).toContainText(`${name} saved. Researchers see the change now.`);
  await expect(page.getByTestId("peptide-state-line")).toHaveText("Not offered · hidden from new cycles");
  await expect(row(page, name)).toHaveAttribute("data-state", "not-offered");
  await expect(row(page, name)).toContainText("Not offered");
  expect(await stored(name)).toMatchObject({ available: false, offered: false, published_at: expect.any(String), version: 3 });
  expect((await researcherSees(browser, draft.id, name)).listed).toBe(false);

  // Search by name.
  await page.getByRole("searchbox").fill(name.toUpperCase());
  await expect(page.getByTestId("library-row")).toHaveCount(1);
  await page.getByRole("searchbox").fill(`${name} nothing`);
  await expect(page.getByTestId("library-no-match")).toContainText("No peptide matches");
});

for (const scheme of ["light", "dark"] as const) {
  test(`phone (${scheme}): the full-screen editor, and a save over another admin's change`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(PHONE);
    const name = unique(`V7 Phonide ${scheme}`);
    await openLibrary(page);
    await shot(page, `library-list-phone-${scheme}`);

    await page.getByTestId("library-add").click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/admin/library/peptides/new`);
    await expect(page.getByRole("link", { name: "Cancel" })).toBeVisible();
    await (await hydrated(page.getByTestId("peptide-name"))).fill(name);
    await page.getByTestId("peptide-summary-input").fill("[Phone summary]");
    await expect(page.getByTestId("save-publish")).toHaveText("Save and publish");
    await expect(page.getByTestId("save-draft")).toBeVisible();
    await expect(page.getByTestId("usage-note")).toHaveText("No researcher cycle or template uses it yet.");
    await shot(page, `library-editor-phone-${scheme}`);
    await page.getByTestId("save-publish").click();
    // A phone goes back to the list after a save.
    await expect(page).toHaveURL(`${APP_ORIGIN}/admin/library`);
    await expect(toast(page)).toContainText(`${name} published. Researchers can see it now.`);
    await expect(row(page, name)).toHaveAttribute("data-state", "offered");

    await row(page, name).click();
    await expect(editor(page)).toHaveAttribute("data-state", "offered");
    const entry = await stored(name);
    // Another admin saves the entry while this one has it open.
    await ok(
      (await signedInClient(SECOND.email))
        .rpc("admin_save_peptide", {
          p_request_key: randomUUID(),
          p_request_hash: randomBytes(32).toString("hex"),
          p_id: entry.id,
          p_expected_version: entry.version,
          p_name: name,
          p_short_description: "Owen's line",
          p_vial_strengths_mg: [],
          p_information: "[Phone summary]",
          p_cycling_off_guidance: "",
          p_supplement_guidance: "",
          p_offered: true,
          p_publish: true,
        } as never)
        .single(),
      "second admin's save",
    );
    await (await hydrated(page.getByTestId("peptide-short"))).fill("My line");
    await page.getByTestId("save-publish").click();
    await expect(page.getByTestId("peptide-notice")).toContainText(`Changed by ${SECOND.name} since you opened it. Nothing was saved.`);
    expect((await stored(name)).short_description).toBe("Owen's line");
    await page.getByTestId("peptide-notice").getByRole("button", { name: "Load latest" }).click();
    await expect(page.getByTestId("peptide-short")).toHaveValue("Owen's line");
    await expect(page.getByTestId("peptide-notice")).toHaveCount(0);
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page).toHaveURL(`${APP_ORIGIN}/admin/library`);
  });

  test(`laptop (${scheme}): the list with the editor beside it`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(LAPTOP);
    await openLibrary(page);
    await shot(page, `library-list-laptop-${scheme}`);
    await page.getByTestId("library-row").first().click();
    await expect(editor(page)).toBeVisible();
    await expect(page.getByTestId("library-row").first()).toHaveAttribute("aria-current", "page");
    await shot(page, `library-editor-laptop-${scheme}`);
  });
}

test("a researcher reaches none of the Library admin", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  const [any] = await ok(serviceClient().from("peptides").select("id").limit(1), "a peptide");
  for (const path of ["/admin/library", "/admin/library/peptides/new", `/admin/library/peptides/${any.id}`, `/admin/library/peptides/${any.id}/preview`]) {
    await page.goto(`${APP_ORIGIN}${path}`);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  }
});
