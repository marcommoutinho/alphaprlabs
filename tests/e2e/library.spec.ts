// S4 A2 Peptide library: the admin adds an entry (hitting both designed
// validation messages first), edits it, turns availability off and sees the
// reference count, against the real local Supabase. The library is shared
// by every run, so entries are found by their unique names.
import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { APP_ORIGIN } from "../../playwright.config";
import { formatDate } from "../../src/lib/format";
import { ensureAccount, hydrated, serviceClient, signInAs, uniqueEmail } from "../support/local-supabase";

const ADMIN = { email: uniqueEmail("s4-library-admin"), name: "Library Admin" };
const RESEARCHER = { email: uniqueEmail("s4-library-researcher"), name: "Library Researcher" };

test.beforeAll(async () => {
  await ensureAccount({ ...ADMIN, role: "admin" });
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
});

const IDLE = "Select an entry to edit it, or add a new peptide.";
const row = (page: Page, name: string) => page.getByTestId("library-row").filter({ hasText: name });
const editor = (page: Page) => page.locator("section.app-lib-editor");
// The inline form error (Next.js adds its own empty route-announcer alert).
const alert = (page: Page) => page.locator('.app-inline-error[role="alert"]');
const stored = async (name: string) =>
  (await serviceClient().from("peptides").select("*").eq("name", name).single()).data!;

async function openLibrary(page: Page) {
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/admin/library`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Peptide library");
}

test("an admin adds, edits and withdraws a library entry, as designed", async ({ page }) => {
  const name = `Compound ${randomBytes(3).toString("hex")}`;
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLibrary(page);
  await expect(
    page.getByText("Supplied information and internal guidance researchers see. Maintenance only — nothing here generates research."),
  ).toBeVisible();
  await expect(page.getByText(IDLE)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]')).toHaveText("Library");

  // Add: the empty editor, then the designed validation, first failure wins.
  await (await hydrated(page.getByRole("button", { name: "Add peptide" }))).click();
  await expect(editor(page).getByRole("heading", { level: 2 })).toHaveText("New peptide");
  await expect(page.getByText(IDLE)).toBeHidden();
  await expect(page.getByLabel("Available for new cycles")).toBeChecked();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(alert(page)).toHaveText("Name is required.");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(alert(page)).toHaveText(
    "Add the information researchers will see (incomplete entries can't be published).",
  );
  // Whitespace alone is still incomplete.
  await page.getByLabel("Information researchers see").fill("   ");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(alert(page)).toHaveText(/incomplete entries can't be published/);
  await expect(row(page, name)).toHaveCount(0);

  await page.getByLabel("Information researchers see").fill("[Supplied peptide information placeholder]");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".app-toast")).toHaveText(`Library updated · ${name}`);
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByText(IDLE)).toBeVisible();

  const created = await stored(name);
  expect(created).toMatchObject({ available: true, cycling_off_guidance: "", supplement_guidance: "" });
  await expect(row(page, name)).toContainText(
    `Updated ${formatDate(created.updated_at)} · no cycling-off guidance · no supplement guidance · referenced by 0`,
  );
  await expect(row(page, name).locator(".app-lib-badge")).toHaveText("Available");

  // Edit: the row opens the editor with its values and is marked selected.
  await row(page, name).click();
  await expect(row(page, name)).toHaveAttribute("aria-current", "true");
  await expect(editor(page).getByRole("heading", { level: 2 })).toHaveText(`Edit ${name}`);
  await expect(page.getByLabel("Name")).toHaveValue(name);
  await expect(page.getByLabel("Information researchers see")).toHaveValue("[Supplied peptide information placeholder]");
  // Nothing uses it yet, so there is no researcher-cycles note.
  await expect(editor(page).locator(".app-lib-note")).toHaveCount(0);
  await page.getByLabel("Cycling-off guidance · optional").fill("[Cycling-off guidance placeholder]");
  await page.getByLabel("Supporting supplement guidance · optional").fill("[Supplement guidance placeholder]");
  await page.getByLabel("Available for new cycles").uncheck();
  // The title follows the name as typed; clearing it hits the first rule again.
  await page.getByLabel("Name").fill("");
  await expect(editor(page).getByRole("heading", { level: 2 })).toHaveText("Edit entry");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(alert(page)).toHaveText("Name is required.");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".app-toast")).toHaveText(`Library updated · ${name}`);
  await expect(editor(page)).toHaveCount(0);

  await expect(row(page, name)).toContainText(
    "cycling-off guidance · supplement guidance · referenced by 0",
  );
  await expect(row(page, name).locator(".app-lib-badge")).toHaveText("Not offered");
  expect(await stored(name)).toMatchObject({
    available: false,
    cycling_off_guidance: "[Cycling-off guidance placeholder]",
    supplement_guidance: "[Supplement guidance placeholder]",
  });

  // Cancel discards changes.
  await row(page, name).click();
  await page.getByLabel("Available for new cycles").check();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText(IDLE)).toBeVisible();
  await expect(row(page, name).locator(".app-lib-badge")).toHaveText("Not offered");
  expect((await stored(name)).available).toBe(false);
});

test("on a phone the editor stacks below the list", async ({ page }) => {
  const name = `Stacked ${randomBytes(3).toString("hex")}`;
  await serviceClient().from("peptides").insert({ name, information: "[Supplied information]" });
  await page.setViewportSize({ width: 390, height: 844 });
  await openLibrary(page);
  await (await hydrated(row(page, name))).click();
  await expect(editor(page).getByRole("heading", { level: 2 })).toHaveText(`Edit ${name}`);
  // The editor is scrolled into view; both boxes are measured in one frame
  // because that smooth scroll may still be moving the page.
  await expect(editor(page)).toBeInViewport();
  const boxes = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    return { listBottom: box(".app-lib-list").bottom, editorTop: box(".app-lib-editor").top, width: box(".app-lib-editor").width };
  });
  expect(boxes.editorTop).toBeGreaterThanOrEqual(boxes.listBottom);
  expect(boxes.width).toBeGreaterThan(300);
});

test("a researcher cannot open the library editor", async ({ page }) => {
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/admin/library`);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
});
