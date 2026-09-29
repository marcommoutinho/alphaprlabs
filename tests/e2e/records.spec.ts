// V6 records (design v3 A4 Record sale, A5 Record purchase, A7 / A14 Ledger,
// D5 laptop Ledger with its drawers) against the real local Supabase, on a
// phone and a laptop, light and dark. Other specs record sales at the same
// time, so exact figures are checked on items and past days this spec makes
// for itself. Exact allocation, AP037 and > 1,000-row reads:
// tests/integration/records.test.ts and records-owner.test.ts.
import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { APP_ORIGIN } from "../../playwright.config";
import { addDays, monthStart } from "../../src/lib/business/period";
import { businessToday } from "../../src/lib/inventory/screens";
import { BUYER_HELPER, BUYER_REQUIRED } from "../../src/lib/records/forms";
import { ensureAccount, hydrated, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";
import { recordPreviewedSale } from "../support/sales";

const ADMIN = { email: uniqueEmail("v6-rec-admin"), name: "Priya Sandhu" };
const SECOND = { email: uniqueEmail("v6-rec-second"), name: "Owen Marchetti" };
const BUYER = { email: uniqueEmail("v6-rec-buyer"), name: `Jordan Reyes ${randomBytes(2).toString("hex")}` };
const RESEARCHER = { email: uniqueEmail("v6-rec-researcher"), name: "V6 Researcher" };
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 820 };
const SHOTS = "/tmp/claude-1000/-home-marcomoutinho-personal-alphaprlabs/23b1f178-9ec7-4a18-b70d-a767abceb0f7/scratchpad/shots";

const id = { admin: "", second: "", buyer: "" };
const today = businessToday();

test.beforeAll(async () => {
  id.admin = await ensureAccount({ ...ADMIN, role: "admin" });
  id.second = await ensureAccount({ ...SECOND, role: "admin" });
  id.buyer = await ensureAccount({ ...BUYER, role: "researcher" });
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
  mkdirSync(SHOTS, { recursive: true });
});

const shot = (page: Page, name: string, fullPage = true) =>
  page.screenshot({ path: `${SHOTS}/v6-${name}.png`, fullPage, style: ".app-tabbar { position: static !important; }" });

async function signInAdmin(page: Page) {
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
}

/** A new peptide and its first lot: `quantity` vials at `unitCost` CAD, received on `receivedOn`. */
async function newItem(quantity: number, unitCost: string, receivedOn: string) {
  const name = `Compound V6 ${randomBytes(3).toString("hex")}`;
  const { data: peptide, error } = await serviceClient()
    .from("peptides")
    .insert({ name, information: "[Supplied information]", available: true })
    .select("id")
    .single();
  if (error) throw error;
  const bought = await (await signedInClient(ADMIN.email))
    .rpc("record_business_purchase", {
      p_idempotency_key: randomUUID(),
      p_received_on: receivedOn,
      p_quantity: quantity,
      p_unit_cost: unitCost,
      p_peptide_id: peptide.id,
      p_strength_mg: "10",
    })
    .single();
  if (bought.error) throw bought.error;
  return { id: bought.data.stock_item_id, name, label: `${name} · 10 mg` };
}

async function buyMore(itemId: string, quantity: number, unitCost: string, receivedOn: string) {
  const { error } = await (await signedInClient(ADMIN.email)).rpc("record_business_purchase", {
    p_idempotency_key: randomUUID(),
    p_received_on: receivedOn,
    p_quantity: quantity,
    p_unit_cost: unitCost,
    p_stock_item_id: itemId,
  });
  if (error) throw error;
}

async function sell(itemId: string, soldOn: string, quantity: number, price: string, seller = id.admin, buyerName = "Walk-in V6") {
  const { error } = await recordPreviewedSale(await signedInClient(ADMIN.email), {
    p_idempotency_key: randomUUID(),
    p_stock_item_id: itemId,
    p_sold_on: soldOn,
    p_quantity: quantity,
    p_unit_price: price,
    p_buyer_name: buyerName,
    p_seller_id: seller,
  });
  if (error) throw error;
}

/** Two consecutive past days (2020-2024) with no sales yet. */
async function freeDays(): Promise<[string, string]> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const day = addDays("2020-01-01", Math.floor(Math.random() * 1800));
    const next = addDays(day, 1);
    const { count, error } = await serviceClient().from("business_sales").select("id", { count: "exact", head: true }).in("sold_on", [day, next]);
    if (error) throw error;
    if (count === 0) return [day, next];
  }
  throw new Error("no free days found");
}

const sheet = (page: Page) => page.getByRole("dialog");

for (const scheme of ["light", "dark"] as const) {
  test(`A4 on a phone (${scheme}): a sale across two lots shows each lot's cost, then records exactly that`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(PHONE);
    const first = addDays(today, -30);
    const second = addDays(today, -17);
    const item = await newItem(5, "13.38", first);
    await buyMore(item.id, 5, "20", second);
    await signInAdmin(page);
    await page.goto(`${APP_ORIGIN}/admin/business`);
    await (await hydrated(page.getByRole("button", { name: "Record sale" }).first())).click();

    const dialog = sheet(page);
    await expect(dialog.getByRole("heading", { name: "Record sale" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
    await dialog.getByTestId("sale-item").selectOption(item.id);
    await expect(dialog.getByText("10 on hand", { exact: true })).toBeVisible();
    await dialog.getByTestId("sale-vials").fill("7");
    await dialog.getByTestId("sale-price").fill("120");
    await expect(dialog.getByTestId("buyer-helper")).toHaveText(BUYER_HELPER);
    // By part of the email (other runs have their own Jordan Reyes accounts).
    await dialog.getByTestId("buyer-input").fill(BUYER.email.split("@")[0]);
    await page.getByRole("option", { name: new RegExp(BUYER.name) }).click();
    await expect(dialog.getByTestId("buyer-researcher")).toHaveText("Researcher");

    // 5 × $13.38 + 2 × $20.00 = $106.90; revenue $840.00; gross profit $733.10.
    const lots = dialog.getByTestId("sale-cost-line");
    await expect(lots).toHaveCount(2);
    await expect(lots.nth(0)).toContainText(`Cost · 5 from ${monthDayOf(first)} lot at $13.38`);
    await expect(lots.nth(0)).toContainText("− $66.90");
    await expect(lots.nth(1)).toContainText(`Cost · 2 from ${monthDayOf(second)} lot at $20.00`);
    await expect(dialog.getByTestId("sale-revenue")).toContainText("Revenue · 7 × $120.00$840.00");
    await expect(dialog.getByTestId("sale-gross-profit")).toHaveText("$733.10");
    await expect(dialog.getByTestId("record-sale")).toHaveText("Record sale · $840.00");
    await shot(page, `sale-multi-lot-phone-${scheme}`, false);

    await dialog.getByTestId("record-sale").click();
    await expect(page.getByRole("status").filter({ hasText: "Sale recorded · 7 vials · $840.00 · gross profit $733.10" })).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);

    const { data: sale } = await serviceClient()
      .from("business_sales")
      .select("cost, buyer_type, buyer_profile_id, seller_id, business_sale_allocations(quantity, unit_cost)")
      .eq("stock_item_id", item.id)
      .single();
    expect(sale).toMatchObject({ cost: 106.9, buyer_type: "account", buyer_profile_id: id.buyer, seller_id: id.admin });
  });
}

const monthDayOf = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCDate()}`;
};

test("A4 validation: too many vials, a missing price and a missing buyer are named; a typed outside buyer records", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const item = await newItem(3, "10", addDays(today, -3));
  await signInAdmin(page);
  await page.goto(`${APP_ORIGIN}/admin/inventory?record=sale&recordItem=${item.id}`);
  const dialog = sheet(page);
  await expect(dialog.getByRole("heading", { name: "Record sale" })).toBeVisible();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory`);
  await expect(dialog.getByText("3 on hand", { exact: true })).toBeVisible();

  await dialog.getByTestId("sale-vials").fill("4");
  await expect(dialog.getByTestId("sale-vials-error")).toHaveText("Only 3 on hand.");
  await expect(dialog.getByTestId("record-sale")).toBeDisabled();
  await dialog.getByRole("button", { name: "Fewer" }).click();
  await expect(dialog.getByTestId("sale-vials-error")).toHaveCount(0);
  await expect(dialog.getByTestId("sale-cost-line")).toContainText("3 from");

  await dialog.getByTestId("record-sale").click();
  await expect(dialog.getByTestId("sale-price-error")).toHaveText("Enter the selling price per vial in CAD.");
  await expect(dialog.getByTestId("sale-buyer-error")).toHaveText(BUYER_REQUIRED);
  await dialog.getByTestId("sale-price").fill("1,000");
  await dialog.getByTestId("record-sale").click();
  await expect(dialog.getByTestId("sale-price-error")).toHaveText("Enter the selling price per vial in CAD.");

  // A zero price is allowed; any typed name is an outside buyer.
  await dialog.getByTestId("sale-price").fill("0");
  await dialog.getByTestId("buyer-input").fill("Clinic V6 walk-in");
  await expect(dialog.getByTestId("buyer-researcher")).toHaveCount(0);
  await dialog.getByTestId("record-sale").click();
  await expect(page.getByRole("status").filter({ hasText: "Sale recorded · 3 vials · $0.00 · gross profit − $30.00" })).toBeVisible();
  const { data } = await serviceClient().from("business_sales").select("buyer_type, buyer_name, unit_price").eq("stock_item_id", item.id).single();
  expect(data).toEqual({ buyer_type: "outside", buyer_name: "Clinic V6 walk-in", unit_price: 0 });
});

test("A5 / D5 on a laptop (dark): a USD purchase uses the stored Bank of Canada rate, a new supplier, then that supplier again", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize(LAPTOP);
  const item = await newItem(22, "12", addDays(today, -40));
  const supplier = `Halcyon V6 ${randomBytes(3).toString("hex")}`;
  await signInAdmin(page);
  await page.goto(`${APP_ORIGIN}/admin/ledger?tab=purchases`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sales and purchases");
  await (await hydrated(page.getByRole("button", { name: "Record purchase" }).first())).click();

  const dialog = sheet(page);
  await expect(dialog.getByRole("heading", { name: "Record purchase" })).toBeVisible();
  await dialog.getByTestId("purchase-item").selectOption(item.id);
  await dialog.getByTestId("purchase-vials").fill("50");
  await dialog.getByTestId("purchase-date").fill("2026-08-26");
  await dialog.getByRole("button", { name: "USD" }).click();
  await dialog.getByTestId("purchase-cost").fill("9.20");
  await expect(dialog.getByTestId("fx-rate")).toHaveText("1 USD = 1.3876 CAD");
  await expect(dialog.getByTestId("rate-card")).toContainText("for Aug 26");
  await expect(dialog.getByTestId("rate-card")).toContainText("Filled automatically");
  await expect(dialog.getByText("Override")).toHaveCount(0);
  await dialog.getByTestId("supplier-input").fill(supplier);
  // 9.20 × 1.3876 = 12.76592 → $12.77 a vial; 50 × $12.77 = $638.50.
  await expect(dialog.getByTestId("purchase-usd-line")).toContainText("50 × US$ 9.20US$ 460.00");
  await expect(dialog.getByTestId("purchase-after")).toContainText("$12.77 · 72");
  await expect(dialog.getByTestId("purchase-total")).toHaveText("$638.50");
  await expect(dialog.getByTestId("record-purchase")).toHaveText("Record purchase · $638.50");
  await shot(page, "purchase-usd-laptop-dark", false);
  await dialog.getByTestId("record-purchase").click();
  await expect(page.getByRole("status").filter({ hasText: "Purchase recorded · 50 vials · $638.50 · US$ 9.20 at 1.3876" })).toBeVisible();

  // Again in CAD, picking the supplier just recorded (any case).
  await (await hydrated(page.getByRole("button", { name: "Record purchase" }).first())).click();
  await sheet(page).getByTestId("purchase-item").selectOption(item.id);
  await sheet(page).getByTestId("purchase-vials").fill("2");
  await sheet(page).getByTestId("purchase-cost").fill("0");
  await sheet(page).getByTestId("supplier-input").fill(supplier.slice(0, 12).toLowerCase());
  await page.getByRole("option", { name: supplier }).click();
  await expect(sheet(page).getByTestId("supplier-input")).toHaveValue(supplier);
  await sheet(page).getByTestId("record-purchase").click();
  await expect(page.getByRole("status").filter({ hasText: "Purchase recorded · 2 vials · $0.00" })).toBeVisible();

  const { data } = await serviceClient()
    .from("business_purchases")
    .select("quantity, supplier, original_currency, fx_rate, unit_cost")
    .eq("stock_item_id", item.id)
    .order("recorded_order");
  expect(data).toEqual([
    { quantity: 22, supplier: null, original_currency: "CAD", fx_rate: null, unit_cost: 12 },
    { quantity: 50, supplier, original_currency: "USD", fx_rate: 1.3876, unit_cost: 12.77 },
    { quantity: 2, supplier, original_currency: "CAD", fx_rate: null, unit_cost: 0 },
  ]);
});

test("A5 validation on a phone: a new peptide needs its strength; the cost refuses thousands grouping", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signInAdmin(page);
  await page.goto(`${APP_ORIGIN}/admin/inventory/purchase`);
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/ledger?tab=purchases`);
  const dialog = sheet(page);
  await expect(dialog.getByRole("heading", { name: "Record purchase" })).toBeVisible();
  await dialog.getByTestId("purchase-item").selectOption("new");
  await dialog.getByTestId("record-purchase").click();
  await expect(dialog.getByText("Choose the peptide for the new item.")).toBeVisible();
  await expect(dialog.getByText("Enter the vial strength in mg for the new item.")).toBeVisible();
  await expect(dialog.getByTestId("purchase-vials-error")).toHaveText("Vials must be a whole number greater than 0.");
  // A date with a Bank of Canada rate (the stub's Aug 26): Record waits for a rate while USD is chosen,
  // and today's window has none unless some other test happened to store one.
  await dialog.getByTestId("purchase-date").fill("2026-08-26");
  await dialog.getByRole("button", { name: "USD" }).click();
  await expect(dialog.getByTestId("fx-rate")).toHaveText("1 USD = 1.3876 CAD");
  await dialog.getByTestId("purchase-cost").fill("1,000");
  await dialog.getByTestId("record-purchase").click();
  await expect(dialog.getByTestId("purchase-cost-error")).toHaveText("Enter the cost per vial in USD (0 or more).");
  await dialog.getByTestId("purchase-cost").fill("11,5");
  await dialog.getByTestId("purchase-vials").fill("2");
  // Comma decimals for USD: 2 × US$ 11.50.
  await expect(dialog.getByTestId("purchase-usd-line")).toContainText("2 × US$ 11.50US$ 23.00");
});

test("A7 / A14 / D5 Ledger: by day with day totals, by month with items and their sales, the seller filter, both tabs", async ({ page }) => {
  const item = await newItem(40, "5", "2019-12-01");
  const [day, next] = await freeDays();
  await sell(item.id, day, 3, "9");
  await sell(item.id, day, 1, "8", id.second, "Owen's buyer");
  await sell(item.id, next, 2, "10");
  const range = `from=${day}&to=${next}`;

  await page.setViewportSize(PHONE);
  await signInAdmin(page);
  await page.goto(`${APP_ORIGIN}/admin/ledger?${range}&item=${item.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ledger");
  await expect(page.getByTestId("ledger-tab-sales")).toHaveText("Sales · 6 vials");
  await expect(page.getByTestId("ledger-summary")).toHaveText("3 sales · 6 vials · $55.00 · cost $30.00 · GP $25.00");
  const days = page.getByTestId("ledger-day");
  await expect(days).toHaveCount(2);
  await expect(days.nth(0).getByTestId("ledger-day-total")).toHaveText("$20.00");
  await expect(days.nth(1).getByTestId("ledger-day-total")).toHaveText("$35.00");
  await expect(days.nth(1).getByTestId("ledger-sale-row").first()).toContainText(`${item.label} × `);
  await expect(days.nth(1)).toContainText("Owen → Owen's buyer · $8.00 ea");
  await expect(days.nth(1)).toContainText("GP $12.00");
  await shot(page, "ledger-day-phone-light", false);

  // The seller menu shows each seller's totals; choosing Owen narrows to his sale.
  await page.getByTestId("seller-select").selectOption(id.second);
  await expect(page).toHaveURL(new RegExp(`seller=${id.second}`));
  await expect(page.getByTestId("ledger-summary")).toHaveText("1 sale · 1 vial · $8.00 · cost $5.00 · GP $3.00");
  await expect(page.getByTestId("ledger-tab-sales")).toHaveText("Sales · 1 vial");

  // By month: the month, its item, and the item's sales.
  await page.goto(`${APP_ORIGIN}/admin/ledger?group=month&${range}&item=${item.id}`);
  const month = page.getByTestId("ledger-month");
  await expect(month).toHaveCount(next.slice(0, 7) === day.slice(0, 7) ? 1 : 2);
  await expect(month.first().getByTestId("ledger-month-line")).toContainText("vial");
  await month.first().getByTestId("ledger-month-item").getByRole("button").click();
  await expect(month.first().getByTestId("ledger-month-entry").first()).toBeVisible();
  await shot(page, "ledger-month-phone-light", false);

  // Purchases by day: the item's lot with its supplier and CAD total.
  await page.goto(`${APP_ORIGIN}/admin/ledger?tab=purchases&from=2019-12-01&to=2019-12-01&item=${item.id}`);
  await expect(page.getByTestId("ledger-purchase-row")).toHaveCount(1);
  await expect(page.getByTestId("ledger-purchase-row")).toContainText("No supplier · $5.00");
  await expect(page.getByTestId("ledger-purchase-row")).toContainText("$200.00");

  // Laptop: the D5 table.
  await page.setViewportSize(LAPTOP);
  await expect(page.getByTestId("ledger-table").getByRole("columnheader")).toHaveText(["Received", "Item", "Vials", "Unit cost", "Rate", "Total CAD"]);
  await expect(page.getByTestId("ledger-table-row")).toContainText([`Dec 1${item.label}No supplier40$5.00—$200.00`]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the Ledger on a phone and a laptop with its drawer (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(PHONE);
    await signInAdmin(page);
    await page.goto(`${APP_ORIGIN}/admin/ledger`);
    await expect(page.getByTestId("ledger")).toBeVisible();
    await expect(page.getByTestId("range-chip")).toBeVisible();
    await shot(page, `phone-${scheme}`, false);
    await page.goto(`${APP_ORIGIN}/admin/ledger?group=month`);
    await expect(page.getByTestId("ledger-group-month")).toHaveAttribute("aria-current", "page");
    await shot(page, `ledger-month-phone-${scheme}`, false);

    await page.setViewportSize(LAPTOP);
    await page.goto(`${APP_ORIGIN}/admin/ledger?tab=purchases`);
    await (await hydrated(page.getByRole("button", { name: "Record purchase" }).first())).click();
    await expect(sheet(page).getByRole("heading", { name: "Record purchase" })).toBeVisible();
    await expect(sheet(page).getByTestId("purchase-item")).toBeVisible();
    // Settled (its slide-in finished), the drawer lies wholly inside the laptop viewport: never clipped at the right edge.
    await sheet(page).evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)));
    await expect
      .poll(async () => {
        const box = await sheet(page).boundingBox();
        return box ? [box.x >= 0, box.y >= 0, box.x + box.width <= LAPTOP.width, box.y + box.height <= LAPTOP.height] : null;
      })
      .toEqual([true, true, true, true]);
    await shot(page, `ledger-laptop-drawer-${scheme}`, false);
    await sheet(page).getByRole("button", { name: "Cancel" }).click();
    await expect(sheet(page)).toHaveCount(0);
  });
}

test("the range sheet, the group switch and the old /admin/sales addresses", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signInAdmin(page);
  await page.goto(`${APP_ORIGIN}/admin/sales`);
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/ledger?group=month&from=${monthStart(today, -35)}&to=${today}`);
  await page.goto(`${APP_ORIGIN}/admin/sales?period=month`);
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/ledger`);
  await page.goto(`${APP_ORIGIN}/admin/sales?period=prev`);
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/ledger?from=${monthStart(today, -1)}&to=${addDays(monthStart(today), -1)}`);
  await expect(page.getByTestId("range-chip")).toBeVisible();

  await page.goto(`${APP_ORIGIN}/admin/ledger`);
  await (await hydrated(page.getByTestId("range-chip"))).click();
  await sheet(page).getByTestId("range-from").fill("2020-01-01");
  await sheet(page).getByTestId("range-to").fill("2020-12-31");
  await sheet(page).getByRole("button", { name: "Show range" }).click();
  await expect(sheet(page).getByRole("alert")).toHaveText("Choose 92 days or fewer, or use 12 months.");
  await sheet(page).getByRole("button", { name: "Last 7 days" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/ledger?from=${addDays(today, -6)}&to=${today}`);
  await page.getByTestId("ledger-group-month").click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/ledger?group=month`);
  await page.getByTestId("ledger-tab-purchases").click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/ledger?tab=purchases&group=month`);
});

test("a researcher can't open the Ledger, the record sheets' reads or the old pages", async ({ page }) => {
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  for (const path of ["/admin/ledger", "/admin/sales", "/admin/inventory/sale", "/admin/inventory/purchase", "/admin/sales/outside", "/admin/ledger/outside"]) {
    await page.goto(`${APP_ORIGIN}${path}`);
    await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  }
  for (const path of ["sale-form", "purchase-form", `sale-preview?item=${randomUUID()}&vials=1`, "rate?date=2026-08-26", "ledger-entries"]) {
    // In the browser, with the researcher's cookies (Node can't resolve *.localhost).
    const response = await page.evaluate(async (url) => {
      const r = await fetch(url);
      return { status: r.status, cacheControl: r.headers.get("cache-control") ?? "", text: await r.text() };
    }, `${APP_ORIGIN}/admin/records/${path}`);
    expect(response.status, path).toBe(403);
    expect(response.cacheControl).toContain("no-store");
    expect(response.text).not.toContain("Priya");
  }
});
