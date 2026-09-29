// S6 inventory and sales against the real local Supabase, through V6's
// Record sale / Record purchase sheets (A4 / A5) and the Ledger (A7): the
// handoff FIFO scenario in the browser, the validation messages, a
// double-clicked save, the stock-changed refusal, the phone layout, a
// preview that never records the wrong item's cost, and researchers kept
// out. The database is shared by every run, so each test works on its own
// library peptide.
import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { APP_ORIGIN } from "../../playwright.config";
import { addDays, monthStart } from "../../src/lib/business/period";
import { PURCHASE_ALREADY_RECORDED, SALE_ALREADY_RECORDED } from "../../src/lib/inventory/rules";
import { businessToday } from "../../src/lib/inventory/screens";
import { BUYER_PLACEHOLDER, BUYER_REQUIRED } from "../../src/lib/records/forms";
import { LEDGER_EMPTY } from "../../src/lib/records/ledger";
import { ensureAccount, hydrated, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";

const ADMIN = { email: uniqueEmail("s6-inv-admin"), name: "Inventory Admin" };
const JORDAN = { email: uniqueEmail("s6-inv-jordan"), name: "Jordan Reyes" };
const RESEARCHER = { email: uniqueEmail("s6-inv-researcher"), name: "Inventory Researcher" };

let jordanId: string;
let adminId: string;

test.beforeAll(async () => {
  adminId = await ensureAccount({ ...ADMIN, role: "admin" });
  jordanId = await ensureAccount({ ...JORDAN, role: "researcher" });
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
});

const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
const sheet = (page: Page) => page.getByRole("dialog");
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const activeNav = (page: Page) => page.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]');
const tomorrow = () => addDays(businessToday(), 1);

async function newPeptide(): Promise<string> {
  const name = `Compound ${randomBytes(3).toString("hex")}`;
  const { error } = await serviceClient().from("peptides").insert({ name, information: "[Supplied information]", available: true });
  if (error) throw error;
  return name;
}

/** The stock item of a peptide (one strength). */
async function itemOf(peptide: string): Promise<string> {
  const { data: found } = await serviceClient().from("peptides").select("id").eq("name", peptide).single();
  const { data } = await serviceClient().from("business_stock_items").select("id").eq("peptide_id", found!.id).single();
  return data!.id;
}

async function signInAdmin(page: Page) {
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
}

async function openSheet(page: Page, name: "Record sale" | "Record purchase") {
  await (await hydrated(page.getByRole("button", { name }).first())).click();
  await expect(sheet(page).getByRole("heading", { name })).toBeVisible();
  return sheet(page);
}

test("the handoff FIFO scenario: two purchases, a sale of 12, 8 left, 9 more blocked, the Ledger", async ({ page }) => {
  const peptide = await newPeptide();
  const label = `${peptide} · 8 mg`;
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAdmin(page);

  // A3 / D4 Stock (V5)
  await page.goto(`${APP_ORIGIN}/admin/inventory`);
  await expect(h1(page)).toHaveText("Stock");
  await expect(page.getByTestId("stock-summary")).toHaveText(/^[\d,]+ vials? · \$[\d,]+\.\d{2} at cost$/);
  await expect(activeNav(page)).toHaveText(/^Stock(\d+ low)?$/);
  // The Ledger and Stock are visited before anything is recorded: after each
  // purchase and sale they must show fresh data, never the client's copy of this visit.
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Ledger" }).click();
  await expect(h1(page)).toHaveText("Sales and purchases");
  await nav.getByRole("link", { name: "Stock" }).click();
  await expect(h1(page)).toHaveText("Stock");
  await expect(page.getByTestId("stock-table-row").filter({ hasText: peptide })).toHaveCount(0);

  // A5 over Stock: each missing or wrong value is named.
  let dialog = await openSheet(page, "Record purchase");
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory`);
  const date = dialog.getByTestId("purchase-date");
  await expect(date).toHaveValue(businessToday());
  const save = dialog.getByTestId("record-purchase");
  await dialog.getByTestId("purchase-item").selectOption("new");
  await dialog.getByTestId("purchase-peptide").selectOption({ label: peptide });
  await save.click();
  await expect(dialog.getByText("Enter the vial strength in mg for the new item.")).toBeVisible();
  await expect(dialog.getByTestId("purchase-vials-error")).toHaveText("Vials must be a whole number greater than 0.");
  await expect(dialog.getByTestId("purchase-cost-error")).toHaveText("Enter the cost per vial in CAD (0 or more).");
  await dialog.getByTestId("purchase-strength").fill("8");
  await dialog.getByTestId("purchase-vials").fill("10");
  await dialog.getByTestId("purchase-cost").fill("-1");
  await expect(dialog.getByTestId("purchase-total")).toHaveText("—");
  await save.click();
  await expect(dialog.getByTestId("purchase-cost-error")).toHaveText("Enter the cost per vial in CAD (0 or more).");
  await expect(dialog.getByText("Enter the vial strength in mg for the new item.")).toHaveCount(0);
  await dialog.getByTestId("purchase-cost").fill("20");
  await expect(dialog.getByTestId("purchase-total")).toHaveText("$200.00");
  await date.fill("");
  await save.click();
  await expect(dialog.getByTestId("purchase-message")).toHaveText("Enter the date received.");
  await date.fill(tomorrow());
  await save.click();
  await expect(dialog.getByTestId("purchase-message")).toHaveText("The date received can't be in the future.");
  await date.fill("2026-08-15");
  await save.click();
  await expect(toast(page, "Purchase recorded · 10 vials · $200.00")).toBeVisible();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByTestId("stock-table-row").filter({ hasText: peptide })).toHaveCount(1);

  // A4 Stock item: no sales yet.
  const itemId = await itemOf(peptide);
  await page.goto(`${APP_ORIGIN}/admin/inventory/${itemId}`);
  await expect(h1(page)).toHaveText(label);
  await expect(page.getByTestId("on-hand")).toHaveText("10");
  await expect(page.getByTestId("sales")).toContainText("No sales yet.");
  await expect(page.getByTestId("purchase-row")).toHaveText(["Aug 15, 2026 · 10 vials at CAD 20.00None allocated yetCAD 200.00"]);

  // The second purchase, preselected from the item; a double click records it once.
  dialog = await openSheet(page, "Record purchase");
  await expect(dialog.getByTestId("purchase-item")).toHaveValue(itemId);
  await dialog.getByTestId("purchase-date").fill("2026-08-20");
  await dialog.getByTestId("purchase-vials").fill("10");
  await dialog.getByTestId("purchase-cost").fill("25.00");
  await dialog.getByTestId("record-purchase").dblclick();
  await expect(toast(page, "Purchase recorded · 10 vials · $250.00")).toBeVisible();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByTestId("on-hand")).toHaveText("20");
  await expect(toast(page, PURCHASE_ALREADY_RECORDED)).toHaveCount(0);
  expect((await serviceClient().from("business_purchases").select("id").eq("stock_item_id", itemId)).data).toHaveLength(2);

  // A4 Record sale: 12 × $40 to Jordan; the Now block lists every lot the database then freezes.
  dialog = await openSheet(page, "Record sale");
  await expect(dialog.getByTestId("sale-item")).toHaveValue(itemId);
  await expect(dialog.getByText("20 on hand", { exact: true })).toBeVisible();
  await dialog.getByTestId("sale-vials").fill("12");
  await dialog.getByTestId("sale-price").fill("40");
  const lots = dialog.getByTestId("sale-cost-line");
  await expect(lots).toHaveCount(2);
  await expect(lots.nth(0)).toContainText("Cost · 10 from Aug 15 lot at $20.00");
  await expect(lots.nth(0)).toContainText("− $200.00");
  await expect(lots.nth(1)).toContainText("Cost · 2 from Aug 20 lot at $25.00");
  await expect(lots.nth(1)).toContainText("− $50.00");
  await expect(dialog.getByTestId("sale-revenue")).toContainText("Revenue · 12 × $40.00$480.00");
  await expect(dialog.getByTestId("sale-gross-profit")).toHaveText("$230.00");
  const recordSale = dialog.getByTestId("record-sale");
  await expect(recordSale).toHaveText("Record sale · $480.00");
  // The buyer starts blank and is required.
  const buyer = dialog.getByTestId("buyer-input");
  await expect(buyer).toHaveValue("");
  await expect(buyer).toHaveAttribute("placeholder", BUYER_PLACEHOLDER);
  await recordSale.click();
  await expect(dialog.getByTestId("sale-buyer-error")).toHaveText(BUYER_REQUIRED);
  expect((await serviceClient().from("business_sales").select("id").eq("stock_item_id", itemId)).data).toEqual([]);
  // Admins are in the buyer list (admins are researchers too), searched by part of the email.
  await buyer.fill(ADMIN.email.split("@")[0]);
  await page.getByRole("option", { name: new RegExp(`${ADMIN.name}.*${ADMIN.email}`) }).click();
  await expect(buyer).toHaveValue(ADMIN.name);
  await expect(dialog.getByTestId("buyer-researcher")).toBeVisible();
  // Typing another name unlinks the account: it would be an outside buyer's name.
  await buyer.fill(JORDAN.name);
  await expect(dialog.getByTestId("buyer-researcher")).toHaveCount(0);
  await buyer.fill(JORDAN.email.split("@")[0].slice(4));
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.getByRole("option", { name: new RegExp(JORDAN.email) }).click();
  await expect(buyer).toHaveValue(JORDAN.name);
  await expect(dialog.getByTestId("buyer-researcher")).toHaveText("Researcher");
  await recordSale.click();
  await expect(toast(page, "Sale recorded · 12 vials · $480.00 · gross profit $230.00")).toBeVisible();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByTestId("on-hand")).toHaveText("8");
  expect((await serviceClient().from("business_sales").select("buyer_type, buyer_profile_id").eq("stock_item_id", itemId)).data).toEqual([
    { buyer_type: "account", buyer_profile_id: jordanId },
  ]);
  await expect(page.getByTestId("sale-row")).toHaveText([
    new RegExp(
      `· 12 vials · ${JORDAN.name} \\(account\\)CAD 480\\.00` +
        `Cost CAD 250\\.00 \\(10 × CAD 20\\.00 \\+ 2 × CAD 25\\.00\\) · gross profit CAD 230\\.00 · Sold by ${ADMIN.name}$`,
    ),
  ]);
  await expect(page.getByTestId("purchase-row").locator(".app-inv-sub")).toHaveText([
    "10 of 10 allocated to sales · cost locked",
    "2 of 10 allocated to sales · cost locked",
  ]);

  // Stock lists it: 8 on hand (low, under the default 10), the 8 left of the
  // $25.00 lot at cost, and the 12 sold today.
  await page.getByRole("link", { name: "‹ Stock" }).click();
  await expect(page.getByTestId("stock-table-row").filter({ hasText: peptide })).toHaveText(`${peptide} 8 mg8Low$200.00$25.0012`);

  // The Ledger for this item: totals match; last month has none of its sales.
  await nav.getByRole("link", { name: "Ledger" }).click();
  await expect(h1(page)).toHaveText("Sales and purchases");
  await expect(page.getByTestId("ledger-table-row").filter({ hasText: label })).toHaveCount(1);
  await page.goto(`${APP_ORIGIN}/admin/ledger?item=${itemId}`);
  await expect(page.getByTestId("item-chip")).toContainText(label);
  await expect(page.getByTestId("ledger-tab-sales")).toHaveText("Sales · 12 vials");
  await expect(page.getByTestId("ledger-summary")).toHaveText("1 sale · 12 vials · $480.00 · GP $230.00");
  await expect(page.getByTestId("ledger-table-row")).toHaveCount(1);
  const today = businessToday();
  await page.goto(`${APP_ORIGIN}/admin/ledger?from=${monthStart(today, -1)}&to=${addDays(monthStart(today), -1)}&item=${itemId}`);
  await expect(page.getByTestId("ledger-empty")).toHaveText(LEDGER_EMPTY.sales);
  await expect(page.getByTestId("ledger-tab-sales")).toHaveText("Sales · 0 vials");

  // An outside buyer for 9: blocked before saving, with the vials on hand named.
  await page.goto(`${APP_ORIGIN}/admin/inventory/${itemId}`);
  dialog = await openSheet(page, "Record sale");
  await dialog.getByTestId("buyer-input").fill("K. Osei");
  await dialog.getByTestId("sale-vials").fill("9");
  await dialog.getByTestId("sale-price").fill("40");
  await expect(dialog.getByTestId("sale-vials-error")).toHaveText("Only 8 on hand.");
  await expect(dialog.getByTestId("record-sale")).toBeDisabled();
  await expect(dialog.getByTestId("sale-revenue")).toContainText("$360.00");
  await expect(dialog.getByTestId("sale-cost-line")).toHaveText("Cost · not enough stock—");
  expect((await serviceClient().from("business_sales").select("id").eq("stock_item_id", itemId)).data).toHaveLength(1);
});

/** A stock item of a new peptide with one purchase lot, recorded directly as the admin; returns its id and label. */
async function seedItem(quantity: number, unitCost: string) {
  const name = `Compound ${randomBytes(3).toString("hex")}`;
  const { data: peptide, error } = await serviceClient()
    .from("peptides")
    .insert({ name, information: "[Supplied information]", available: true })
    .select("id")
    .single();
  if (error) throw error;
  const bought = await (await signedInClient(ADMIN.email))
    .rpc("record_business_purchase", {
      p_idempotency_key: randomUUID(),
      p_peptide_id: peptide.id,
      p_strength_mg: "5",
      p_received_on: "2026-08-15",
      p_quantity: quantity,
      p_unit_cost: unitCost,
    })
    .single();
  if (bought.error) throw bought.error;
  return { id: bought.data.stock_item_id, label: `${name} · 5 mg` };
}

test("A4 validation, a future date, and stock that changes before saving", async ({ page }) => {
  const item = await seedItem(3, "20");
  await signInAdmin(page);
  await page.goto(`${APP_ORIGIN}/admin/inventory/${item.id}`);
  const dialog = await openSheet(page, "Record sale");
  const date = dialog.getByTestId("sale-date");
  await expect(date).toHaveValue(businessToday());
  const save = dialog.getByTestId("record-sale");
  await dialog.getByTestId("sale-vials").fill("");
  await save.click();
  await expect(dialog.getByTestId("sale-vials-error")).toHaveText("Vials must be a whole number greater than 0.");
  await expect(dialog.getByTestId("sale-price-error")).toHaveText("Enter the selling price per vial in CAD.");
  await expect(dialog.getByTestId("sale-buyer-error")).toHaveText(BUYER_REQUIRED);
  await dialog.getByTestId("sale-vials").fill("3");
  await dialog.getByTestId("sale-price").fill("abc");
  await save.click();
  await expect(dialog.getByTestId("sale-vials-error")).toHaveCount(0);
  await expect(dialog.getByTestId("sale-price-error")).toHaveText("Enter the selling price per vial in CAD.");
  await dialog.getByTestId("sale-price").fill("40");
  await dialog.getByTestId("buyer-input").fill("Walk-in");
  // The date is never empty: cleared, it's today again.
  await date.fill("");
  await expect(date).toHaveValue(businessToday());
  await date.fill(tomorrow());
  await save.click();
  await expect(dialog.getByTestId("sale-message")).toHaveText("The sale date can't be in the future.");
  // A sale may be dated before the purchase whose stock it uses.
  await date.fill("2026-08-01");

  // Another sale takes a vial meanwhile: the database refuses, nothing is recorded.
  const other = await (await signedInClient(ADMIN.email)).rpc("record_business_sale", {
    p_idempotency_key: randomUUID(),
    p_stock_item_id: item.id,
    p_sold_on: "2026-08-20",
    p_quantity: 1,
    p_unit_price: "40",
    p_buyer_name: "Elsewhere",
    p_seller_id: adminId,
  });
  expect(other.error).toBeNull();
  await save.click();
  await expect(dialog.getByTestId("sale-message")).toHaveText("Stock changed before saving — only 2 on hand now. Nothing was recorded.");
  // The counts were read again: the sheet now shows what is left.
  await expect(dialog.getByTestId("sale-vials-error")).toHaveText("Only 2 on hand.");
  await expect(save).toBeDisabled();
  expect((await serviceClient().from("business_sales").select("quantity").eq("stock_item_id", item.id)).data).toEqual([{ quantity: 1 }]);

  // Two vials fit: the sale dated before its purchase is recorded.
  await dialog.getByTestId("sale-vials").fill("2");
  await save.click();
  await expect(toast(page, "Sale recorded · 2 vials · $80.00 · gross profit $40.00")).toBeVisible();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByTestId("on-hand")).toHaveText("0");
  await expect(page.getByRole("button", { name: "Record sale" })).toBeDisabled();
  expect((await serviceClient().from("business_sales").select("sold_on").eq("stock_item_id", item.id).eq("sold_on", "2026-08-01")).data).toHaveLength(1);
});

test("phone: pages and sheets fit, sections stack, wide amounts stay on one line", async ({ page }) => {
  const item = await seedItem(4, "1250.50");
  // Wide amounts: $5,002.00 purchased, $7,999.96 revenue.
  const sold = await (await signedInClient(ADMIN.email)).rpc("record_business_sale", {
    p_idempotency_key: randomUUID(),
    p_stock_item_id: item.id,
    p_sold_on: "2026-08-20",
    p_quantity: 4,
    p_unit_price: "1999.99",
    p_buyer_name: "A buyer with a rather long reference name for the phone layout",
    p_seller_id: adminId,
  });
  expect(sold.error).toBeNull();
  await signInAdmin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const fits = (scope = "main") =>
    page.evaluate(
      (selector) => [...document.querySelectorAll(`${selector} *`)].every((el) => el.getBoundingClientRect().right <= window.innerWidth + 0.5),
      scope,
    );

  const august = `from=2026-08-01&to=2026-08-31&item=${item.id}`;
  for (const path of [
    "/admin/inventory",
    `/admin/inventory/${item.id}`,
    `/admin/ledger?${august}`,
    `/admin/ledger?tab=purchases&${august}`,
    `/admin/ledger?group=month&item=${item.id}`,
  ]) {
    await page.goto(`${APP_ORIGIN}${path}`);
    await expect(page.locator(".app-tabbar")).toBeVisible();
    expect(await fits(), path).toBe(true);
  }
  await page.goto(`${APP_ORIGIN}/admin/inventory/${item.id}`);
  const [purchases, sales] = await Promise.all([page.getByTestId("purchases").boundingBox(), page.getByTestId("sales").boundingBox()]);
  expect(sales!.y).toBeGreaterThanOrEqual(purchases!.y + purchases!.height);

  // The sheets are full-screen and fit; the Now block comes after the entry.
  for (const kind of ["sale", "purchase"] as const) {
    await page.goto(`${APP_ORIGIN}/admin/inventory?record=${kind}&recordItem=${item.id}`);
    const dialog = sheet(page);
    await expect(dialog.getByTestId(`${kind}-now`)).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).toMatchObject({ x: 0, width: 390 });
    expect(await fits('[role="dialog"]'), kind).toBe(true);
    const [entry, now] = await Promise.all([dialog.getByTestId(`${kind}-${kind === "sale" ? "price" : "cost"}`).boundingBox(), dialog.getByTestId(`${kind}-now`).boundingBox()]);
    expect(now!.y).toBeGreaterThanOrEqual(entry!.y + entry!.height);
    expect(now!.width).toBeGreaterThan(330);
  }

  // The Ledger's day: totals and amounts on one line each.
  await page.goto(`${APP_ORIGIN}/admin/ledger?from=2026-08-20&to=2026-08-20&item=${item.id}`);
  await expect(page.getByTestId("ledger-summary")).toHaveText("1 sale · 4 vials · $7,999.96 · GP $2,997.96");
  const total = page.getByTestId("ledger-day-total");
  await expect(total).toHaveText("$7,999.96");
  expect((await total.boundingBox())!.height).toBeLessThan(30);
  await expect(page.getByTestId("ledger-sale-row")).toContainText("$7,999.96");
  expect(await fits()).toBe(true);
});

test("switching the stock item blocks saving until that item's preview has loaded", async ({ page }) => {
  const [first, second] = [await seedItem(3, "10"), await seedItem(5, "12")];
  await signInAdmin(page);
  await page.goto(`${APP_ORIGIN}/admin/inventory?record=sale&recordItem=${first.id}`);
  const dialog = sheet(page);
  await expect(dialog.getByTestId("sale-item")).toHaveValue(first.id);
  await dialog.getByTestId("buyer-input").fill("Walk-in");
  await dialog.getByTestId("sale-vials").fill("2");
  await dialog.getByTestId("sale-price").fill("30");
  const save = dialog.getByTestId("record-sale");
  const now = dialog.getByTestId("sale-now");
  await expect(save).toBeEnabled();
  await expect(dialog.getByTestId("sale-gross-profit")).toHaveText("$40.00");
  await expect(dialog.getByTestId("sale-cost-line")).toHaveText(["Cost · 2 from Aug 15 lot at $10.00− $20.00"]);

  // Hold the second item's preview until the save attempts are done.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === "/admin/records/sale-preview" && url.searchParams.get("item") === second.id,
    async (route) => {
      await held;
      await route.continue();
    },
  );
  await dialog.getByTestId("sale-item").selectOption(second.id);
  await expect(dialog.getByText("5 on hand", { exact: true })).toBeVisible();
  await expect(now).toHaveAttribute("aria-busy", "true");
  await expect(dialog.getByTestId("sale-gross-profit")).toHaveText("—");
  await expect(dialog.getByTestId("sale-revenue")).toContainText("$60.00");
  await expect(save).toBeDisabled();
  // Neither Enter in a field nor a direct form submission records anything.
  await dialog.getByTestId("sale-price").press("Enter");
  await dialog.getByTestId("sale-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
  await expect(save).toHaveText("Record sale · $60.00");

  release();
  await expect(now).not.toHaveAttribute("aria-busy", "true");
  await expect(dialog.getByTestId("sale-gross-profit")).toHaveText("$36.00");
  await expect(dialog.getByTestId("sale-cost-line")).toHaveText(["Cost · 2 from Aug 15 lot at $12.00− $24.00"]);
  await expect(save).toBeEnabled();
  for (const seeded of [first, second]) {
    expect((await serviceClient().from("business_sales").select("id").eq("stock_item_id", seeded.id)).data).toEqual([]);
  }
  await expect(page.getByRole("status").filter({ hasText: "Sale recorded" })).toHaveCount(0);
  await expect(toast(page, SALE_ALREADY_RECORDED)).toHaveCount(0);
});

test("a slow response for a previously chosen item never replaces the current item's preview", async ({ page }) => {
  const [first, slow, current] = [await seedItem(3, "10"), await seedItem(5, "12"), await seedItem(7, "14")];
  await signInAdmin(page);
  await page.goto(`${APP_ORIGIN}/admin/inventory?record=sale&recordItem=${first.id}`);
  const dialog = sheet(page);
  await expect(dialog.getByTestId("sale-item")).toHaveValue(first.id);
  await dialog.getByTestId("sale-vials").fill("2");
  await dialog.getByTestId("sale-price").fill("30");
  const now = dialog.getByTestId("sale-now");
  await expect(dialog.getByTestId("sale-gross-profit")).toHaveText("$40.00");

  // The second item's preview is held back; the third item's arrives first.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === "/admin/records/sale-preview" && url.searchParams.get("item") === slow.id,
    async (route) => {
      await held;
      await route.continue().catch(() => {});
    },
  );
  await dialog.getByTestId("sale-item").selectOption(slow.id);
  await expect(now).toHaveAttribute("aria-busy", "true");
  await dialog.getByTestId("sale-item").selectOption(current.id);
  await expect(dialog.getByText("7 on hand", { exact: true })).toBeVisible();
  await expect(dialog.getByTestId("sale-gross-profit")).toHaveText("$32.00");
  await expect(dialog.getByTestId("sale-cost-line")).toHaveText(["Cost · 2 from Aug 15 lot at $14.00− $28.00"]);

  // The late response arrives: the chosen item and its preview stay as they are.
  release();
  await page.waitForTimeout(1_000);
  await expect(dialog.getByTestId("sale-item")).toHaveValue(current.id);
  await expect(dialog.getByTestId("sale-gross-profit")).toHaveText("$32.00");
  await expect(dialog.getByTestId("sale-cost-line")).toHaveText(["Cost · 2 from Aug 15 lot at $14.00− $28.00"]);
  await expect(now).not.toHaveAttribute("aria-busy", "true");
  await dialog.getByTestId("buyer-input").fill("Walk-in");
  await expect(dialog.getByTestId("record-sale")).toBeEnabled();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory`);
});

test("a researcher cannot reach inventory, the Ledger or the old sale pages", async ({ page }) => {
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  for (const path of [
    "/admin/inventory",
    `/admin/inventory/${randomUUID()}`,
    "/admin/inventory/purchase",
    "/admin/inventory/sale",
    "/admin/inventory?record=sale",
    "/admin/ledger",
    "/admin/sales",
    "/admin/sales?period=month",
  ]) {
    await page.goto(`${APP_ORIGIN}${path}`);
    await expect(page, path).toHaveURL(`${APP_ORIGIN}/app/today`);
  }
});
