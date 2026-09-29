// V5 Business (design v3 A1 / A2 Overview, A13 / D9 12 months, A3 / D4 Stock,
// A6 states) against the real local Supabase, on a phone and a laptop, light
// and dark. Other specs record sales today at the same time, so exact figures
// are checked on a custom range of two past days no other test uses (chosen
// per run); today's views are checked for structure. Exact totals over
// 1,000+ sales: tests/integration/business-overview-owner.test.ts.
import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import Decimal from "decimal.js";
import { APP_ORIGIN } from "../../playwright.config";
import { money } from "../../src/lib/alpha/format";
import { isLow, stockTotals } from "../../src/lib/business/stock";
import { MONTHS_CSV_HEADER } from "../../src/lib/business/overview";
import { addDays, monthsLabel, monthStart, rangeLabel, sameDaysWindow } from "../../src/lib/business/period";
import { PAUSED_NOTE } from "../../src/components/business/stock-load-error";
import { businessToday } from "../../src/lib/inventory/screens";
import { ensureAccount, hydrated, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";

const ADMIN = { email: uniqueEmail("v5-biz-admin"), name: "Priya Sandhu" };
const SECOND = { email: uniqueEmail("v5-biz-second"), name: "Owen Marchetti" };
const BUYER = { email: uniqueEmail("v5-biz-buyer"), name: "Jordan Reyes" };
const RESEARCHER = { email: uniqueEmail("v5-biz-researcher"), name: "V5 Researcher" };
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 820 };
const SHOTS = "/tmp/claude-1000/-home-marcomoutinho-personal-alphaprlabs/23b1f178-9ec7-4a18-b70d-a767abceb0f7/scratchpad/shots";

const id = { admin: "", second: "", buyer: "" };

test.beforeAll(async () => {
  id.admin = await ensureAccount({ ...ADMIN, role: "admin" });
  id.second = await ensureAccount({ ...SECOND, role: "admin" });
  id.buyer = await ensureAccount({ ...BUYER, role: "researcher" });
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
  mkdirSync(SHOTS, { recursive: true });
});

const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
/** A full-page screenshot for review; the phone tab bar is drawn at the page's end instead of floating mid-page. */
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/v5-${name}.png`, fullPage: true, style: ".app-tabbar { position: static !important; }" });

async function signInAdmin(page: Page) {
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
}

/** A sale recorded as Priya (`seller` defaults to her), to an outside buyer unless a profile is given. */
async function sell(
  itemId: string,
  soldOn: string,
  quantity: number,
  price: string,
  seller = id.admin,
  buyer: { profile?: string; name?: string } = { name: "Walk-in V5" },
) {
  const { error } = await (await signedInClient(ADMIN.email)).rpc("record_business_sale", {
    p_idempotency_key: randomUUID(),
    p_stock_item_id: itemId,
    p_sold_on: soldOn,
    p_quantity: quantity,
    p_unit_price: price,
    p_buyer_profile_id: buyer.profile,
    p_buyer_name: buyer.name,
    p_seller_id: seller,
  });
  if (error) throw error;
}

/** A new stock item of a new peptide: `quantity` vials at `unitCost` (CAD 5.00), received today. */
async function newItem(quantity: number, unitCost = "5") {
  const name = `Compound V5 ${randomBytes(3).toString("hex")}`;
  const { data: peptide, error } = await serviceClient()
    .from("peptides")
    .insert({ name, information: "[Supplied information]", available: true })
    .select("id")
    .single();
  if (error) throw error;
  const db = await signedInClient(ADMIN.email);
  const bought = await db
    .rpc("record_business_purchase", {
      p_idempotency_key: randomUUID(),
      // Today: 12 months always has a supplier purchase to show.
      p_received_on: businessToday(),
      p_quantity: quantity,
      p_unit_cost: unitCost,
      p_peptide_id: peptide.id,
      p_strength_mg: "10",
    })
    .single();
  if (bought.error) throw bought.error;
  return { id: bought.data.stock_item_id, name, label: `${name} · 10 mg` };
}

/** Two consecutive past days (2020-2024) with no sales yet, for this test's own sales. */
async function freeDays(): Promise<[string, string]> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const day = addDays("2020-01-01", Math.floor(Math.random() * 1800));
    const next = addDays(day, 1);
    const { count, error } = await serviceClient()
      .from("business_sales")
      .select("id", { count: "exact", head: true })
      .in("sold_on", [day, next]);
    if (error) throw error;
    if (count === 0) return [day, next];
  }
  throw new Error("no free days found");
}

/**
 * The fixture sales: on `day`, 3 vials at $9 by Priya to an outside buyer and
 * 1 at $8 by Owen to Jordan's account; on the next day, 1 at $2 by Priya (a
 * loss: every vial cost $5). 7 of 12 vials are left, below the default 10.
 */
async function seedPeriod() {
  const item = await newItem(12);
  const [day, next] = await freeDays();
  await sell(item.id, day, 3, "9");
  await sell(item.id, day, 1, "8", id.second, { profile: id.buyer });
  await sell(item.id, next, 1, "2");
  return { item, day, next };
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`Business on a phone · ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test("each period: Month by default, Week, a custom range (exact figures, a loss) and 12 months", async ({ page }) => {
      const { day, next } = await seedPeriod();
      const today = businessToday();
      await page.setViewportSize(PHONE);
      await signInAdmin(page);
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Business" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/business`);

      // A1 Month (the default): header, Now block, actions, tiles, revenue by day, low stock, recent sales, by seller.
      const main = page.getByTestId("business");
      await expect(main).toHaveAttribute("data-period", "month");
      await expect(h1(page)).toHaveText("Business");
      await expect(page.getByTestId("business-header-phone")).toContainText("Admin · Priya");
      const periods = page.getByRole("navigation", { name: "Period" }).first();
      await expect(periods.getByRole("link")).toHaveText(["Week", "Month", "12 months"]);
      await expect(periods.locator('[aria-current="page"]')).toHaveText("Month");
      const phone = page.getByTestId("period-phone");
      await expect(phone.getByTestId("now-rows")).toContainText("Revenue");
      await expect(phone.getByTestId("now-rows")).toContainText("Cost of stock sold");
      await expect(phone.getByTestId("now-rows")).toContainText("Gross profit");
      // V6: the record sheets open over the page.
      await expect(phone.getByRole("button", { name: "Record sale" })).toBeVisible();
      await expect(phone.getByRole("button", { name: "Record purchase" })).toBeVisible();
      await expect(phone.getByTestId("tile-stock")).toContainText("Stock value");
      await expect(phone.getByTestId("revenue-by-day").locator("i")).toHaveCount(Number(today.slice(8)));
      await expect(phone.getByTestId("revenue-by-day").locator("i").last()).toHaveAttribute("data-today", "true");
      await expect(phone.getByRole("heading", { name: /^Low stock/ })).toBeVisible();
      const lowRows = phone.getByTestId("low-row");
      expect(await lowRows.count()).toBeGreaterThan(0);
      expect(await lowRows.count()).toBeLessThanOrEqual(5);
      expect(await phone.getByTestId("recent-sale").count()).toBeLessThanOrEqual(3);
      await expect(phone.getByRole("link", { name: "All sales" })).toHaveAttribute("href", "/admin/ledger");
      // The Stock tab's counter follows what Business loaded.
      await shot(page, `business-month-phone-${scheme}`);

      // Week: seven days, today last.
      await periods.getByRole("link", { name: "Week" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/business?range=week`);
      await expect(main).toHaveAttribute("data-period", "week");
      await expect(periods.locator('[aria-current="page"]')).toHaveText("Week");
      const bars = phone.getByTestId("revenue-by-day").locator("i");
      await expect(bars).toHaveCount(7);
      await expect(bars.nth(0)).toHaveAttribute("data-day", addDays(today, -6));
      await expect(bars.nth(6)).toHaveAttribute("data-today", "true");
      if (scheme === "light") await shot(page, "business-week-phone");

      // A custom range through the picker: checked first, then shown with exact figures.
      await (await hydrated(periods.getByRole("button", { name: "Custom range" }))).click();
      const picker = page.getByRole("dialog", { name: "Custom range" });
      await picker.getByLabel("From").fill(next);
      await picker.getByLabel("To").fill(day);
      await picker.getByRole("button", { name: "Show range" }).click();
      await expect(picker.getByRole("alert")).toHaveText("The start date must be on or before the end date.");
      await picker.getByLabel("From").fill(day);
      await picker.getByLabel("To").fill(next);
      await picker.getByRole("button", { name: "Show range" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/business?from=${day}&to=${next}`);
      await expect(main).toHaveAttribute("data-period", "custom");
      await expect(periods.locator('[aria-current="page"]')).toHaveText(rangeLabel({ from: day, to: next }));
      const now = phone.getByTestId("now");
      await expect(now).toContainText("5 vials sold");
      await expect(now).toContainText("$12.00CAD");
      await expect(phone.getByTestId("margin")).toHaveText("32.4% of revenue");
      await expect(phone.getByTestId("now-rows")).toHaveText("Revenue$37.00Cost of stock sold− $25.00Gross profit$12.00");
      await expect(phone.getByTestId("tile-sold")).toContainText("avg $7.40 each");
      await expect(phone.getByTestId("revenue-by-day").locator("i")).toHaveCount(2);
      await expect(phone.getByTestId("best-day")).toHaveText(`best ${rangeLabel({ from: day, to: day })} · $35.00`);
      // Per-seller totals for the period stay on the overview (and on the Ledger).
      const sellers = phone.getByTestId("seller-row");
      await expect(sellers).toHaveCount(2);
      await expect(sellers.filter({ hasText: ADMIN.name })).toContainText("4 vials · rev $29.00");
      await expect(sellers.filter({ hasText: ADMIN.name })).toContainText("$9.00GP");
      await expect(sellers.filter({ hasText: SECOND.name })).toContainText("1 vial · rev $8.00");
      await expect(sellers.filter({ hasText: SECOND.name })).toContainText("$3.00GP");
      if (scheme === "light") await shot(page, "business-range-phone");

      // A day at a loss: the minus sign and the missed colour.
      await page.goto(`${APP_ORIGIN}/admin/business?from=${next}&to=${next}`);
      await expect(phone.getByTestId("now")).toContainText("− $3.00CAD");
      await expect(phone.getByTestId("margin")).toHaveText("−150.0% of revenue");
      const [loss, plain] = await Promise.all([
        phone.getByTestId("now").locator('[data-negative="true"]').first().evaluate((el) => getComputedStyle(el).color),
        phone.getByTestId("now").evaluate((el) => getComputedStyle(el).color),
      ]);
      expect(loss).not.toBe(plain);

      // A13 12 months.
      await periods.getByRole("link", { name: "12 months" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/business?range=12m`);
      await expect(main).toHaveAttribute("data-period", "12m");
      await expect(page.getByTestId("business-header-phone")).toContainText(monthsLabel(monthStart(today, -11), today));
      const twelve = page.getByTestId("twelve-phone");
      await expect(twelve.getByTestId("now")).toContainText(/Gross profit · \w+ to date/);
      await expect(twelve.getByTestId("same-days-change")).toContainText(`vs ${rangeLabel(sameDaysWindow(today).previous)}`);
      await expect(twelve.getByTestId("sales-by-month").locator("> *")).toHaveCount(12);
      await expect(twelve.getByTestId("purchases-by-month").locator("> *")).toHaveCount(12);
      const rows = twelve.getByTestId("month-row");
      await expect(rows).toHaveCount(6);
      await twelve.getByRole("button", { name: "Show all 12 months" }).click();
      await expect(rows).toHaveCount(12);
      // Purchases by supplier (V6): named suppliers first, then those without one.
      await expect(twelve.getByTestId("supplier-row").last()).toContainText("No supplier recorded");
      await shot(page, `business-12m-phone-${scheme}`);
    });
  });
}

test("laptop: A2 Overview for a period, D9 12 months with its month table and Export CSV", async ({ page }) => {
  const { day, next } = await seedPeriod();
  const today = businessToday();
  await page.setViewportSize(LAPTOP);
  await signInAdmin(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Overview" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/business`);
  await expect(h1(page)).toHaveText("Overview");
  await expect(nav.locator('[aria-current="page"]')).toHaveText("Overview");
  const header = page.getByTestId("business-header-laptop");
  await expect(header).toContainText(rangeLabel({ from: monthStart(today), to: today }, "header"));
  await expect(header.getByRole("button", { name: "Record purchase" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Record sale" })).toBeVisible();
  const laptop = page.getByTestId("period-laptop");
  await expect(laptop.getByTestId("revenue-by-day")).toBeVisible();
  await expect(laptop.getByTestId("low-stock-table")).toBeVisible();
  await expect(laptop.getByTestId("recent-sales-table")).toBeVisible();
  // The Stock counter in the sidebar: this run's item is low.
  await expect(nav.getByRole("link", { name: /^Stock/ })).toContainText(/\d+ low$/);
  await shot(page, "overview-laptop");

  await page.goto(`${APP_ORIGIN}/admin/business?from=${day}&to=${next}`);
  await expect(header).toContainText(rangeLabel({ from: day, to: next }, "header"));
  await expect(laptop.getByRole("region", { name: "Gross profit" })).toContainText("32.4% of revenue · 5 vials sold");
  await expect(laptop.getByRole("region", { name: "Gross profit" })).toContainText("Revenue$37.00Cost of stock$25.00Gross profit$12.00");
  const seller = laptop.getByTestId("by-seller-table").locator("tbody tr");
  await expect(seller.filter({ hasText: ADMIN.name })).toHaveText(`${ADMIN.name}4$29.00$20.00$9.00`);
  await expect(seller.filter({ hasText: SECOND.name })).toHaveText(`${SECOND.name}1$8.00$5.00$3.00`);

  // D9: 12 months, the month table newest first, the same-days footnote, and the CSV.
  await page.getByRole("navigation", { name: "Period" }).getByRole("link", { name: "12 months" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/business?range=12m`);
  await expect(header).toContainText(monthsLabel(monthStart(today, -11), today));
  const twelve = page.getByTestId("twelve-laptop");
  const table = twelve.getByTestId("month-table-row");
  await expect(table).toHaveCount(12);
  await expect(table.first()).toContainText("to date");
  await expect(twelve.getByRole("region", { name: "Month by month" })).toContainText("* vs the same days of");
  // Purchases by supplier (V6): named suppliers first, then those without one.
  await expect(twelve.getByTestId("supplier-row").last()).toContainText("No supplier recorded");
  await shot(page, "12m-laptop");

  const [download] = await Promise.all([page.waitForEvent("download"), header.getByRole("link", { name: "Export CSV" }).click()]);
  expect(download.suggestedFilename()).toBe(`alpha-business-months_${monthStart(today, -11).slice(0, 7)}_to_${today.slice(0, 7)}.csv`);
  const csv = readFileSync((await download.path())!, "utf8");
  const lines = csv.replace(/^﻿/, "").split("\r\n");
  expect(lines[0]).toBe(MONTHS_CSV_HEADER.join(","));
  expect(lines).toHaveLength(14);
  expect(lines[1]).toMatch(new RegExp(`^${today.slice(0, 7)} \\(to date\\),\\d+,`));
});

test.describe("Stock", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`phone · ${scheme}: search, the Low filter and a reorder level`, async ({ page }) => {
      test.info().annotations.push({ type: "scheme", description: scheme });
      await page.emulateMedia({ colorScheme: scheme });
      const item = await newItem(7);
      await page.setViewportSize(PHONE);
      await signInAdmin(page);
      await page.goto(`${APP_ORIGIN}/admin/business`);
      await page.getByTestId("period-phone").getByRole("link", { name: "Stock", exact: true }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory`);
      await expect(h1(page)).toHaveText("Stock");
      await expect(page.getByTestId("stock-summary")).toHaveText(/^[\d,]+ vials? · \$[\d,]+\.\d{2} at cost$/);
      // A3 has its own bar back to Business instead of the Business links.
      await expect(page.getByRole("navigation", { name: "Business" })).toHaveCount(0);
      const stock = page.getByTestId("stock");
      await expect(stock.getByRole("link", { name: "Business", exact: true })).toHaveAttribute("href", "/admin/business");
      // Record purchase opens its sheet over Stock (V6).
      await (await hydrated(stock.getByRole("button", { name: "Record purchase" }))).click();
      await expect(page.getByRole("dialog").getByRole("heading", { name: "Record purchase" })).toBeVisible();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory`);
      await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await shot(page, `stock-phone-${scheme}`);

      const search = await hydrated(page.getByRole("searchbox", { name: "Search stock" }));
      await search.fill(item.name.toLowerCase());
      const row = page.getByTestId("stock-row");
      await expect(row).toHaveCount(1);
      await expect(row).toHaveAttribute("data-low", "true");
      await expect(row.getByTestId("stock-count")).toHaveText("7");
      await expect(row).toContainText("$35.00");
      await expect(page.getByRole("region", { name: "Low · 1" })).toBeVisible();
      await search.fill("no such compound");
      await expect(page.getByTestId("stock-no-match")).toHaveText("No stock item matches “no such compound”.");
      await search.fill("");
      await page.getByTestId("filter-low").click();
      expect(await row.count()).toBeGreaterThan(0);
      // Every row shown is low, read in one pass (the local database keeps every run's items, hundreds of them).
      await expect.poll(() => row.evaluateAll((rows) => rows.filter((r) => r.getAttribute("data-low") !== "true").length)).toBe(0);
      await search.fill(item.name);
      await expect(row).toHaveCount(1);

      // The reorder level: checked, saved, shown at once.
      await row.click();
      const sheet = page.getByRole("dialog", { name: item.label });
      await expect(sheet).toContainText("7 vials on hand · $35.00 at cost");
      await expect(sheet.getByTestId("threshold-changed")).toHaveText("Default reorder level, never changed");
      const level = sheet.getByLabel("Reorder at");
      await expect(level).toHaveValue("10");
      await level.fill("2.5");
      await sheet.getByRole("button", { name: "Save" }).click();
      await expect(sheet).toContainText("Enter a whole number of vials, 0 or more.");
      await level.fill("5");
      await sheet.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText(`${item.label}: reorder at 5 vials`)).toBeVisible();
      await expect(sheet).toBeHidden();
      // No longer low: gone from the Low filter, back under All items.
      await expect(row).toHaveCount(0);
      await page.getByTestId("filter-all").click();
      await expect(row).toHaveCount(1);
      await expect(row).not.toHaveAttribute("data-low");
      await expect(page.getByRole("region", { name: "All items" })).toContainText(item.name);
      await row.click();
      await expect(sheet.getByLabel("Reorder at")).toHaveValue("5");
      await expect(sheet.getByTestId("threshold-changed")).toContainText(`Set by ${ADMIN.name}`);
      await sheet.getByRole("link", { name: "Purchases and sales" }).click();
      await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory/${item.id}`);
      await page.getByRole("link", { name: "‹ Stock" }).click();
      await expect(h1(page)).toHaveText("Stock");
    });
  }

  test("laptop: D4's table sorts, tags low items and opens the reorder level", async ({ page }) => {
    const item = await newItem(7);
    await page.setViewportSize(LAPTOP);
    await signInAdmin(page);
    await page.goto(`${APP_ORIGIN}/admin/inventory?filter=low`);
    await expect(h1(page)).toHaveText("Stock");
    await expect(page.getByRole("button", { name: /^Low \d+$/ })).toHaveAttribute("aria-pressed", "true");
    const table = page.getByTestId("stock-table");
    await expect(table.locator("th")).toHaveText(["Item", "On hand", "Value at cost", "Avg cost", "Sold 30 d"]);
    await expect(table.locator("th").first()).toHaveAttribute("aria-sort", "ascending");
    await shot(page, "stock-laptop");

    await (await hydrated(page.getByRole("searchbox", { name: "Search stock" }))).fill(item.name);
    const row = table.getByTestId("stock-table-row");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveText(`${item.name} 10 mg7Low$35.00$5.000`);
    await expect(row.getByRole("meter")).toHaveAttribute("aria-label", `${item.label} on hand`);

    const onHand = table.getByRole("button", { name: "On hand" });
    await onHand.click();
    await expect(table.locator("th").nth(1)).toHaveAttribute("aria-sort", "descending");
    await onHand.click();
    await expect(table.locator("th").nth(1)).toHaveAttribute("aria-sort", "ascending");

    await row.getByRole("button", { name: `${item.name} 10 mg` }).click();
    const sheet = page.getByRole("dialog", { name: item.label });
    await sheet.getByLabel("Reorder at").fill("3");
    await sheet.getByLabel("Reorder at").press("Enter");
    await expect(page.getByText(`${item.label}: reorder at 3 vials`)).toBeVisible();
    // Low only: the item left the list.
    await expect(row).toHaveCount(0);
    await page.getByRole("button", { name: /^All \d+$/ }).click();
    await expect(row).toHaveText(`${item.name} 10 mg7$35.00$5.000`);
  });
});

const thresholdOf = async (itemId: string) =>
  (await serviceClient().from("business_stock_items").select("low_stock_threshold").eq("id", itemId).single()).data!.low_stock_threshold;

/** The next Save reaches the server and is saved, but its answer never arrives (the connection resets). */
async function loseNextSave(page: Page) {
  let lost = 0;
  await page.route(
    (url) => url.pathname.startsWith("/admin/inventory"),
    async (route) => {
      const request = route.request();
      if (lost === 0 && request.method() === "POST" && request.headers()["next-action"]) {
        lost++;
        const url = new URL(request.url());
        await route.fetch({ url: request.url().replace(url.hostname, "127.0.0.1"), headers: { ...request.headers(), host: url.host } });
        await route.abort("connectionreset");
        return;
      }
      await route.continue();
    },
  );
}

/** Owen sets `threshold` over `expected`, as another admin would. */
async function otherAdminSets(itemId: string, expected: number, threshold: number) {
  const { error } = await (await signedInClient(SECOND.email))
    .rpc("set_business_stock_threshold", { p_request_key: randomUUID(), p_stock_item_id: itemId, p_expected: expected, p_threshold: threshold })
    .single();
  expect(error).toBeNull();
}

/**
 * The error toast's Retry, as the accessibility tree has it: on the page, or
 * inside the open sheet while one is open (never aria-hidden).
 */
const retryOf = (page: Page) =>
  page.getByRole("alert").filter({ hasText: "Couldn't save. Your entry is still here." }).getByRole("button", { name: "Retry" });

for (const [device, viewport] of [
  ["phone", PHONE],
  ["laptop", LAPTOP],
] as const) {
  test(`${device}: a toast never covers an open sheet's Save, and its Retry is reachable while the sheet is open`, async ({ page }) => {
    const item = await newItem(7);
    await page.setViewportSize(viewport);
    await signInAdmin(page);
    await page.goto(`${APP_ORIGIN}/admin/inventory`);
    await (await hydrated(page.getByRole("searchbox", { name: "Search stock" }))).fill(item.name);
    const row =
      device === "phone" ? page.getByTestId("stock-row") : page.getByTestId("stock-table-row").getByRole("button", { name: `${item.name} 10 mg` });
    await expect(row).toHaveCount(1);
    const sheet = page.getByRole("dialog", { name: item.label });

    // A save whose answer is lost: the error toast stays up while the sheet stays open.
    await loseNextSave(page);
    await row.click();
    const level = sheet.getByLabel("Reorder at");
    await level.fill("5");
    const save = sheet.getByRole("button", { name: "Save" });
    await save.click();
    const retry = retryOf(page);
    await expect(retry).toBeVisible();
    await expect(sheet).toBeVisible();
    await expect.poll(() => thresholdOf(item.id)).toBe(5);

    // Retry is in the accessibility tree (no includeHidden), inside the open dialog, and Tab reaches it
    // within the sheet's focus trap.
    await expect(sheet.getByRole("alert")).toContainText("Couldn't save. Your entry is still here.");
    await expect(sheet.getByRole("button", { name: "Retry" })).toBeVisible();
    await level.focus();
    let reached = false;
    for (let i = 0; i < 12 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await retry.evaluate((button) => button === document.activeElement);
      expect(await sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    }
    expect(reached).toBe(true);

    // The toast sits above the sheet's footer, not over it: Save takes the pointer's click.
    const [toastBox, saveBox] = await Promise.all([page.locator('[data-slot="toast"]').boundingBox(), save.boundingBox()]);
    expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(saveBox!.y);
    await save.click();
    // The same request again: the server replays the saved change, and the sheet closes on it.
    await expect(sheet).toBeHidden();
    expect(await thresholdOf(item.id)).toBe(5);
  });
}

test("Stock: a Retry after a saved change lost its answer replays it, and never overwrites a newer change", async ({ page }) => {
  const item = await newItem(7);
  await page.setViewportSize(LAPTOP);
  await signInAdmin(page);
  await page.goto(`${APP_ORIGIN}/admin/inventory`);
  await (await hydrated(page.getByRole("searchbox", { name: "Search stock" }))).fill(item.name);
  await page.getByTestId("stock-table-row").getByRole("button", { name: `${item.name} 10 mg` }).click();
  const sheet = page.getByRole("dialog", { name: item.label });

  // The first save reaches the server and is saved, but its answer never arrives.
  await loseNextSave(page);
  await sheet.getByLabel("Reorder at").fill("5");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Couldn't save. Your entry is still here.")).toBeVisible();
  await expect.poll(() => thresholdOf(item.id)).toBe(5);

  // Meanwhile another admin sets 8.
  await otherAdminSets(item.id, 5, 8);

  // Retry sends the same request key: the server replays the saved change and 8 stays.
  await page.getByRole("button", { name: "Retry" }).click();
  // Answered (the sheet closes on any saved answer): the other admin's 8 is still the level.
  await expect(sheet).toBeHidden();
  expect(await thresholdOf(item.id)).toBe(8);
  await expect(page.getByText(`${item.label}: this change was already saved. The list shows the current level.`)).toBeVisible();
  const changes = await serviceClient()
    .from("business_stock_threshold_changes")
    .select("threshold, changed_by")
    .eq("stock_item_id", item.id)
    .order("changed_at");
  expect(changes.data).toEqual([
    { threshold: 5, changed_by: id.admin },
    { threshold: 8, changed_by: id.second },
  ]);
  await expect(sheet).toBeHidden();
  // Once the list's refresh has landed, the item reopens on the other admin's 8. (Reopened sooner, a sheet
  // starts from the list it was opened from, and its Save compares against that: refused, never overwriting.)
  await expect(async () => {
    if (await sheet.isVisible()) {
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    }
    await page.getByTestId("stock-table-row").getByRole("button", { name: `${item.name} 10 mg` }).click();
    await expect(sheet.getByLabel("Reorder at")).toHaveValue("8", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(sheet.getByTestId("threshold-changed")).toContainText(`Set by ${SECOND.name}`);
});

test("Stock: a late Retry for one item never closes another item's sheet or discards its entry", async ({ page }) => {
  const a = await newItem(7);
  const b = await newItem(7);
  await page.setViewportSize(LAPTOP);
  await signInAdmin(page);
  await page.goto(`${APP_ORIGIN}/admin/inventory`);
  await hydrated(page.getByRole("searchbox", { name: "Search stock" }));
  const rowOf = (item: { name: string }) => page.getByTestId("stock-table-row").getByRole("button", { name: `${item.name} 10 mg` });

  // A's save is saved, but its answer never arrives.
  await loseNextSave(page);
  await rowOf(a).click();
  const sheetA = page.getByRole("dialog", { name: a.label });
  await sheetA.getByLabel("Reorder at").fill("5");
  await sheetA.getByRole("button", { name: "Save" }).click();
  const retry = retryOf(page);
  await expect(retry).toBeVisible();
  await expect.poll(() => thresholdOf(a.id)).toBe(5);

  // A's sheet is closed; B's is opened and edited, not saved yet.
  await page.keyboard.press("Escape");
  await expect(sheetA).toBeHidden();
  await rowOf(b).click();
  const sheetB = page.getByRole("dialog", { name: b.label });
  await sheetB.getByLabel("Reorder at").fill("3");

  // A's Retry is answered (a replay): B's sheet stays open with its entry.
  await retry.click();
  await expect(page.getByText(`${a.label}: this change was already saved. The list shows the current level.`)).toBeVisible();
  await expect(sheetB).toBeVisible();
  await expect(sheetB.getByLabel("Reorder at")).toHaveValue("3");
  expect(await thresholdOf(b.id)).toBe(10);
  expect(await thresholdOf(a.id)).toBe(5);

  // B's own save still works and closes B's sheet (the toast inside it never covers Save).
  await sheetB.getByRole("button", { name: "Save" }).click();
  await expect(sheetB).toBeHidden();
  await expect.poll(() => thresholdOf(b.id)).toBe(3);
});

test("Stock: after an unsure save, a reopened sheet's Save never overwrites a newer change: refused, and the sheet stays", async ({
  page,
}) => {
  const item = await newItem(7);
  await page.setViewportSize(LAPTOP);
  await signInAdmin(page);
  await page.goto(`${APP_ORIGIN}/admin/inventory`);
  await (await hydrated(page.getByRole("searchbox", { name: "Search stock" }))).fill(item.name);
  const row = page.getByTestId("stock-table-row").getByRole("button", { name: `${item.name} 10 mg` });
  const sheet = page.getByRole("dialog", { name: item.label });

  // 5 over the 10 shown: saved, but the answer never arrives.
  await loseNextSave(page);
  await row.click();
  await sheet.getByLabel("Reorder at").fill("5");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(retryOf(page)).toBeVisible();
  await expect.poll(() => thresholdOf(item.id)).toBe(5);

  // Closed; Owen sets 8 meanwhile.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await otherAdminSets(item.id, 5, 8);

  // Reopened from the list as it last read, and saved at once: refused, Owen's 8 stays.
  // (The error toast is still up, inside the sheet above its footer: Save takes the click.)
  await row.click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText(`Changed by ${SECOND.name} to 8. Nothing was saved.`)).toBeVisible();
  await expect(sheet).toBeVisible();
  expect(await thresholdOf(item.id)).toBe(8);
  const changes = await serviceClient()
    .from("business_stock_threshold_changes")
    .select("threshold, changed_by")
    .eq("stock_item_id", item.id)
    .order("changed_at");
  expect(changes.data).toEqual([
    { threshold: 5, changed_by: id.admin },
    { threshold: 8, changed_by: id.second },
  ]);

  // A new decision over the 8 it now knows saves.
  await sheet.getByLabel("Reorder at").fill("6");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(() => thresholdOf(item.id)).toBe(6);
});

test("Stock: a late Retry never closes or changes a sheet opened later for the same item", async ({ page }) => {
  const item = await newItem(7);
  await page.setViewportSize(LAPTOP);
  await signInAdmin(page);
  await page.goto(`${APP_ORIGIN}/admin/inventory`);
  await (await hydrated(page.getByRole("searchbox", { name: "Search stock" }))).fill(item.name);
  const row = page.getByTestId("stock-table-row").getByRole("button", { name: `${item.name} 10 mg` });
  const sheet = page.getByRole("dialog", { name: item.label });

  // 5 over the 10 shown: saved, but the answer never arrives.
  await loseNextSave(page);
  await row.click();
  await sheet.getByLabel("Reorder at").fill("5");
  await sheet.getByRole("button", { name: "Save" }).click();
  const retry = retryOf(page);
  await expect(retry).toBeVisible();
  await expect.poll(() => thresholdOf(item.id)).toBe(5);

  // Closed, reopened, and 7 typed (not saved yet).
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await row.click();
  await sheet.getByLabel("Reorder at").fill("7");

  // The first opening's Retry is answered (a replay): this opening stays, with its entry.
  await retry.click();
  await expect(page.getByText(`${item.label}: this change was already saved. The list shows the current level.`)).toBeVisible();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("Reorder at")).toHaveValue("7");
  expect(await thresholdOf(item.id)).toBe(5);

  // Its own Save compares against the level it was opened with (10, before the answer came):
  // refused with what happened, then saved over the 5 it now knows (the toast above the footer never covers Save).
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText(`Changed by ${ADMIN.name} to 5. Nothing was saved.`)).toBeVisible();
  await expect(sheet.getByLabel("Reorder at")).toHaveValue("7");
  expect(await thresholdOf(item.id)).toBe(5);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(() => thresholdOf(item.id)).toBe(7);
});

test("a period with only a free sample: sold, no revenue, the loss in missed with its minus sign, no margin", async ({ page }) => {
  const item = await newItem(3);
  const [day] = await freeDays();
  await sell(item.id, day, 1, "0");
  await signInAdmin(page);

  await page.setViewportSize(PHONE);
  await page.goto(`${APP_ORIGIN}/admin/business?from=${day}&to=${day}`);
  const phone = page.getByTestId("period-phone");
  const now = phone.getByTestId("now");
  await expect(now).toContainText("1 vial sold");
  await expect(now).toContainText("− $5.00CAD");
  await expect(phone.getByTestId("margin")).toHaveText("— of revenue");
  await expect(phone.getByTestId("now-rows")).toHaveText("Revenue$0.00Cost of stock sold− $5.00Gross profit− $5.00");
  await expect(phone.getByTestId("best-day")).toHaveText("no revenue");
  await expect(phone.getByTestId("tile-sold")).toContainText("avg $0.00 each");
  await expect(page.getByText("No sales in this period")).toHaveCount(0);
  const [loss, plain] = await Promise.all([
    now.locator('[data-negative="true"]').first().evaluate((el) => getComputedStyle(el).color),
    now.evaluate((el) => getComputedStyle(el).color),
  ]);
  expect(loss).not.toBe(plain);

  await page.setViewportSize(LAPTOP);
  const laptop = page.getByTestId("period-laptop");
  await expect(laptop.getByTestId("margin-laptop")).toHaveText("— of revenue · 1 vial sold");
  await expect(laptop.getByRole("region", { name: "Gross profit" })).toContainText("no revenue");
  await expect(laptop.getByRole("region", { name: "Gross profit" })).toContainText("Revenue$0.00Cost of stock$5.00Gross profit− $5.00");
});

/**
 * Every visible tile and Now-block figure (data-testid "figure-…", set by the
 * screen on the amount itself, with or without Fit): its rendered text, and
 * whether the text as drawn (a Range over it, so clipping or overflow can't
 * hide it) lies inside its box (the nearest data-figure-box: the tile, the
 * Now block's cell or row) within the box's padding.
 */
const readFigures = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, { text: string; inside: boolean; detail: string }> = {};
    for (const el of document.querySelectorAll<HTMLElement>('[data-testid^="figure-"]')) {
      if (!el.checkVisibility()) continue;
      const box = el.closest<HTMLElement>("[data-figure-box]");
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect();
      if (!box) {
        out[el.dataset.testid!] = { text: el.innerText, inside: false, detail: "no box" };
        continue;
      }
      const edge = box.getBoundingClientRect();
      const style = getComputedStyle(box);
      const left = edge.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const right = edge.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
      const inside = text.left >= left - 0.5 && text.right <= right + 0.5 && text.top >= edge.top - 0.5 && text.bottom <= edge.bottom + 0.5;
      out[el.dataset.testid!] = {
        text: el.innerText,
        inside,
        detail: `text ${text.left.toFixed(1)}–${text.right.toFixed(1)}, box ${left.toFixed(1)}–${right.toFixed(1)}`,
      };
    }
    return out;
  });

/** Stock value and the count of low items as every Business view shows them (the same RPC, all pages). */
async function heldNow(today: string) {
  const db = await signedInClient(ADMIN.email);
  const rows: { stock_item_id: string; on_hand: number; value_at_cost: string; low_stock_threshold: number }[] = [];
  for (;;) {
    const after = rows.at(-1)?.stock_item_id;
    const query = db.rpc("admin_business_stock_levels", { p_today: today });
    const { data, error } = await (after ? query.gt("stock_item_id", after) : query).order("stock_item_id").limit(1000);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const levels = rows.map((row) => ({ onHand: Number(row.on_hand), valueAtCost: row.value_at_cost, threshold: row.low_stock_threshold }));
  const low = levels.filter(isLow).length;
  return { value: money(stockTotals(levels).value), low: `${low} ${low === 1 ? "item" : "items"}` };
}

/** A period's totals (the same RPC as the page). */
async function summaryOf(from: string, to: string) {
  const { data, error } = await (await signedInClient(ADMIN.email))
    .rpc("admin_business_sales_summary", { p_from: from, p_to: to })
    .single();
  if (error) throw error;
  return data;
}

/** The figures of a period view: the Now block (phone rows show the cost as a deduction) and the tiles. */
function periodFigures(
  laptop: boolean,
  t: { revenue: string; cost: string; gross_profit: string; vials: number },
  held: { value: string; low: string },
): Record<string, string> {
  const shared = {
    "figure-gross-profit": money(t.gross_profit),
    "figure-gross-profit-unit": "CAD",
    "figure-now-revenue": money(t.revenue),
    "figure-now-profit": money(t.gross_profit),
    "figure-stock-value": held.value,
  };
  return laptop
    ? {
        ...shared,
        "figure-now-cost": money(t.cost),
        "figure-revenue": money(t.revenue),
        "figure-cost": money(t.cost),
        "figure-low-stock": held.low,
      }
    : { ...shared, "figure-now-cost": money(`-${t.cost}`), "figure-vials-sold": t.vials.toLocaleString("en-CA") };
}

test("7-figure amounts: every tile and Now-block figure shows its exact amount inside its box, on a phone and a laptop", async ({
  page,
}) => {
  // Stock value past $1M and 12 months of purchases past $3M. On two past days
  // no other test uses: a $1,050,000 loss (free samples), then $1.6M of
  // revenue. The sales are spread over four items and both admins so no item's
  // or seller's all-time totals pass six figures: the Ledger's seller menu
  // lists those on one line, and inventory.spec checks the Ledger fits a
  // phone.
  const items = await Promise.all([1, 2, 3, 4].map(() => newItem(30_000, "15")));
  await newItem(90_000, "15"); // $1,350,000 held
  const [loss, gain] = await freeDays();
  const today = businessToday();
  for (const [index, item] of items.entries()) {
    const seller = index % 2 === 0 ? id.admin : id.second;
    await sell(item.id, loss, 17_500, "0", seller);
    await sell(item.id, gain, 5_000, "80", seller);
  }
  await signInAdmin(page);

  // Those two days' figures, exactly (every vial cost $15).
  const lossDay = { revenue: "0.00", cost: "1050000.00", gross_profit: "-1050000.00", vials: 70_000 };
  const gainDay = { revenue: "1600000.00", cost: "300000.00", gross_profit: "1300000.00", vials: 20_000 };
  expect(periodFigures(false, lossDay, { value: "", low: "" })).toMatchObject({
    "figure-gross-profit": "− $1,050,000.00",
    "figure-now-cost": "− $1,050,000.00",
    "figure-vials-sold": "70,000",
  });

  const views: { query: string; expected: (laptop: boolean) => Promise<Record<string, string>> }[] = [
    { query: `?from=${loss}&to=${loss}`, expected: async (laptop) => periodFigures(laptop, lossDay, await heldNow(today)) },
    { query: `?from=${gain}&to=${gain}`, expected: async (laptop) => periodFigures(laptop, gainDay, await heldNow(today)) },
    // This month and 12 months are shared with the other tests: the same reads as the page, just after it.
    {
      query: "",
      expected: async (laptop) => periodFigures(laptop, await summaryOf(monthStart(today), today), await heldNow(today)),
    },
    {
      query: "?range=12m",
      expected: async (laptop) => {
        const { data: months, error } = await (await signedInClient(ADMIN.email)).rpc("admin_business_months", {
          p_from: monthStart(today, -11),
          p_to: today,
        });
        if (error) throw error;
        const sum = (pick: (m: NonNullable<typeof months>[number]) => string) => money(months.reduce((n, m) => n.plus(pick(m)), new Decimal(0)).toFixed(2));
        const current = money((await summaryOf(monthStart(today), today)).gross_profit);
        return {
          "figure-month-gross-profit": current,
          "figure-month-gross-profit-unit": "CAD",
          "figure-12m-gross-profit": sum((m) => m.gross_profit),
          "figure-12m-purchases": sum((m) => m.purchases),
          ...(laptop ? { "figure-12m-revenue": sum((m) => m.revenue) } : {}),
        };
      },
    },
  ];

  for (const size of [PHONE, LAPTOP]) {
    await page.setViewportSize(size);
    for (const view of views) {
      const where = `${size.width} px ${view.query || "this month"}`;
      // Other tests record sales and stock meanwhile: read the page, then the database, until they agree.
      await expect(async () => {
        await page.goto(`${APP_ORIGIN}/admin/business${view.query}`);
        const layout = `${view.query === "?range=12m" ? "twelve" : "period"}-${size === LAPTOP ? "laptop" : "phone"}`;
        await expect(page.getByTestId(layout)).toBeVisible();
        const shown = await readFigures(page);
        const expected = await view.expected(size === LAPTOP);
        expect(
          Object.fromEntries(Object.entries(shown).map(([id, figure]) => [id, figure.text])),
          where,
        ).toEqual(expected);
      }).toPass({ timeout: 45_000 });
      // Drawn inside its tile or cell, never past it (nor clipped by it).
      const outside = Object.entries(await readFigures(page)).filter(([, figure]) => !figure.inside);
      expect(outside.map(([id, figure]) => `${id} "${figure.text}": ${figure.detail}`), where).toEqual([]);
    }
  }
  expect(Object.values(await readFigures(page)).some((figure) => /^\$\d{1,3}(,\d{3}){2,}\.\d{2}$/.test(figure.text))).toBe(true);

  await page.goto(`${APP_ORIGIN}/admin/business`);
  await expect(page.getByTestId("period-laptop")).toBeVisible();
  await shot(page, "overview-laptop-fixed");
  await page.setViewportSize(PHONE);
  await page.goto(`${APP_ORIGIN}/admin/business?from=${loss}&to=${loss}`);
  await expect(page.getByTestId("period-phone")).toBeVisible();
  await shot(page, "business-7-figures-phone");
});

test("the A6 states in light and dark: empty, loading, and couldn't load (recording paused)", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await signInAdmin(page);
  await page.goto(`${APP_ORIGIN}/admin/design`);
  for (const pane of ["Light", "Dark"]) {
    const states = page.getByRole("region", { name: pane }).getByTestId("gallery-stock-states");
    await expect(states).toContainText("No stock recorded yet");
    await expect(states.getByRole("button", { name: "Record a purchase" })).toBeVisible();
    await expect(states.getByTestId("stock-skeleton").locator("> div")).toHaveCount(5);
    const failed = states.getByRole("alert");
    await expect(failed).toContainText("Couldn't load stock");
    await expect(failed).toContainText(PAUSED_NOTE);
    await expect(failed.getByRole("link")).toHaveCount(0);
    await expect(failed.getByRole("button")).toHaveText("Try again");
    await (await hydrated(failed.getByRole("button", { name: "Try again" }))).click();
    await expect(states.getByTestId("gallery-retried")).toHaveText("Try again pressed 1 time");
  }
  const tints = await page
    .getByTestId("gallery-stock-states")
    .getByRole("alert")
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
  expect(tints).toHaveLength(2);
  expect(tints[0]).not.toBe(tints[1]);
  await page.getByTestId("gallery-stock-states").first().screenshot({ path: `${SHOTS}/v5-states.png` });
});

test("a researcher can't reach Business, Stock or the export", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Overview" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Stock" })).toHaveCount(0);
  for (const path of ["/admin/business", "/admin/business?range=12m", "/admin/business?from=2026-09-01&to=2026-09-02", "/admin/inventory", "/admin/inventory?filter=low"]) {
    await page.goto(`${APP_ORIGIN}${path}`);
    await expect(page, path).toHaveURL(`${APP_ORIGIN}/app/today`);
  }
  // The export, fetched from the page (the browser resolves app.localhost and sends the session).
  const exportFrom = (from: Page) =>
    from.evaluate(async () => {
      const response = await fetch("/admin/business/export", { redirect: "manual" });
      return { status: response.status, text: await response.text() };
    });
  const exported = await exportFrom(page);
  expect(exported.status).toBe(403);
  expect(exported.text).not.toContain("Month,");
  // Signed out: sent to sign in (the session proxy), no CSV either.
  const anonymous = await page.context().browser()!.newContext();
  const stranger = await anonymous.newPage();
  await stranger.goto(`${APP_ORIGIN}/admin/business/export`);
  await expect(stranger).toHaveURL(new RegExp(`^${APP_ORIGIN}/auth`));
  await expect(stranger.locator("body")).not.toContainText("Month,");
  await anonymous.close();
});
