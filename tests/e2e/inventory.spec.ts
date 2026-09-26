// S6 inventory and sales screens (A4-A7) against the real local Supabase: the
// handoff FIFO scenario in the browser, the designed validation order, a
// double-clicked save, the stock-changed refusal, A7's filters and empty
// states, the phone layout, and researchers kept out. The database is shared
// by every run, so each test works on its own library peptide.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { APP_ORIGIN } from "../../playwright.config";
import { businessToday } from "../../src/lib/inventory/screens";
import { ensureAccount, hydrated, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";

const ADMIN = { email: uniqueEmail("s6-inv-admin"), name: "Inventory Admin" };
const JORDAN = { email: uniqueEmail("s6-inv-jordan"), name: "Jordan Reyes" };
const RESEARCHER = { email: uniqueEmail("s6-inv-researcher"), name: "Inventory Researcher" };

let jordanId: string;

test.beforeAll(async () => {
  await ensureAccount({ ...ADMIN, role: "admin" });
  jordanId = await ensureAccount({ ...JORDAN, role: "researcher" });
  await ensureAccount({ ...RESEARCHER, role: "researcher" });
});

const alert = (page: Page) => page.locator('.app-inline-error[role="alert"]');
const toast = (page: Page) => page.locator(".app-toast");
const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
const activeNav = (page: Page) => page.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]');
const select = (page: Page, name: string) => page.locator(`select[name="${name}"]`);
const tomorrow = () => new Date(Date.parse(`${businessToday()}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const ITEM_URL = new RegExp(`^${APP_ORIGIN}/admin/inventory/([0-9a-f-]{36})$`);

async function newPeptide(): Promise<string> {
  const name = `Compound ${randomBytes(3).toString("hex")}`;
  const { error } = await serviceClient().from("peptides").insert({ name, information: "[Supplied information]", available: true });
  if (error) throw error;
  return name;
}

async function signInAdmin(page: Page) {
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
}

/** Submits and expects the designed inline message (first failure wins). */
async function expectError(page: Page, button: Locator, message: string) {
  await button.click();
  await expect(alert(page)).toHaveText(message);
}

/** A5 through the UI for a new peptide / strength; returns the new stock item's id. */
async function purchaseNewItem(page: Page, peptide: string, strength: string, receivedOn: string, quantity: string, cost: string) {
  await page.goto(`${APP_ORIGIN}/admin/inventory/purchase`);
  await hydrated(page.getByLabel("Vials", { exact: true }));
  await select(page, "stockItemId").selectOption({ label: "New peptide / strength…" });
  await select(page, "peptideId").selectOption({ label: peptide });
  await page.getByLabel("Vial strength (mg)").fill(strength);
  await page.getByLabel("Received").fill(receivedOn);
  await page.getByLabel("Vials", { exact: true }).fill(quantity);
  await page.getByLabel("Cost per vial (CAD)").fill(cost);
  await page.getByRole("button", { name: "Record purchase" }).click();
  await expect(page).toHaveURL(ITEM_URL);
  return ITEM_URL.exec(page.url())![1];
}

test("the handoff FIFO scenario: two purchases, a sale of 12, 8 left, 9 more blocked, A7 totals", async ({ page }) => {
  const peptide = await newPeptide();
  const label = `${peptide} · 8 mg`;
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAdmin(page);

  // A4 Inventory
  await page.goto(`${APP_ORIGIN}/admin/inventory`);
  await expect(h1(page)).toHaveText("Inventory");
  await expect(
    page.getByText("Whole vials on hand, counted per peptide and strength. Business stock only — never a researcher's personal supplies."),
  ).toBeVisible();
  await expect(activeNav(page)).toHaveText("Inventory");
  // A7 and A4 are visited before anything is recorded: after each purchase and
  // sale they must show fresh data, never the client's copy of this visit.
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Sales" }).click();
  await expect(h1(page)).toHaveText("Sales & gross profit");
  await nav.getByRole("link", { name: "Inventory" }).click();
  await expect(h1(page)).toHaveText("Inventory");
  await expect(page.getByTestId("stock-row").filter({ hasText: peptide })).toHaveCount(0);
  await page.getByRole("link", { name: "Record purchase" }).click();

  // A5, validation in the designed order.
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory/purchase`);
  await expect(h1(page)).toHaveText("Record purchase");
  await expect(activeNav(page)).toHaveText("Inventory");
  const save = page.getByRole("button", { name: "Record purchase" });
  await hydrated(page.getByLabel("Vials", { exact: true }));
  await expect(page.getByLabel("Received")).toHaveValue(businessToday());
  await select(page, "stockItemId").selectOption({ label: "New peptide / strength…" });
  await select(page, "peptideId").selectOption({ label: peptide });
  await page.getByLabel("Received").fill("");
  await expectError(page, save, "Enter the date received.");
  await page.getByLabel("Received").fill(tomorrow());
  await expectError(page, save, "The date received can't be in the future.");
  await page.getByLabel("Received").fill("2026-08-15");
  await expectError(page, save, "Vials must be a whole number greater than 0.");
  await page.getByLabel("Vials", { exact: true }).fill("10");
  await page.getByLabel("Cost per vial (CAD)").fill("-1");
  await expect(page.getByTestId("purchase-total")).toHaveText("Total purchase cost—");
  await expectError(page, save, "Enter the cost per vial in CAD (0 or more).");
  await page.getByLabel("Cost per vial (CAD)").fill("20");
  await expect(page.getByTestId("purchase-total")).toHaveText("Total purchase costCAD 200.00");
  await expectError(page, save, "Enter the vial strength in mg for the new item.");
  await page.getByLabel("Vial strength (mg)").fill("8");
  await save.click();

  // A4 Stock item: no sales yet.
  await expect(toast(page)).toHaveText("Purchase recorded · 10 vials at CAD 20.00");
  await expect(page).toHaveURL(ITEM_URL);
  const itemId = ITEM_URL.exec(page.url())![1];
  await expect(h1(page)).toHaveText(label);
  await expect(page.getByTestId("on-hand")).toHaveText("10");
  await expect(page.getByTestId("sales")).toContainText("No sales yet.");
  await expect(page.getByTestId("purchase-row")).toHaveText(["Aug 15, 2026 · 10 vials at CAD 20.00None allocated yetCAD 200.00"]);

  // The second purchase, preselected from the item; a double click records it once.
  await page.getByRole("link", { name: "Record purchase" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory/purchase?item=${itemId}`);
  await hydrated(page.getByLabel("Vials", { exact: true }));
  await expect(select(page, "stockItemId")).toHaveValue(itemId);
  await page.getByLabel("Received").fill("2026-08-20");
  await page.getByLabel("Vials", { exact: true }).fill("10");
  await page.getByLabel("Cost per vial (CAD)").fill("25.00");
  await page.getByRole("button", { name: "Record purchase" }).dblclick();
  await expect(toast(page)).toHaveText("Purchase recorded · 10 vials at CAD 25.00");
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory/${itemId}`);
  await expect(page.getByTestId("on-hand")).toHaveText("20");
  expect((await serviceClient().from("business_purchases").select("id").eq("stock_item_id", itemId)).data).toHaveLength(2);

  // A6: 12 × CAD 40 to Jordan; the live preview is what the database then freezes.
  await page.getByRole("link", { name: "Record sale" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory/sale?item=${itemId}`);
  await expect(h1(page)).toHaveText("Record sale");
  const preview = page.getByTestId("sale-preview");
  await expect(preview.getByRole("heading")).toHaveText(`Preview · ${label}`);
  await expect(preview.locator("dd")).toHaveText(["20 vials", "—", "—", "—"]);
  await hydrated(page.getByLabel("Vials", { exact: true }));
  await expect(page.getByRole("button", { name: "Researcher account" })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Vials", { exact: true }).fill("12");
  await page.getByLabel("Price per vial (CAD)").fill("40");
  await expect(preview.locator("dd")).toHaveText(["20 vials", "CAD 480.00", "CAD 250.00", "CAD 230.00"]);
  await expect(page.getByTestId("allocation")).toHaveText(
    "Cost allocation, oldest stock first" +
      "10 × CAD 20.00 from the Aug 15, 2026 purchase" +
      "2 × CAD 25.00 from the Aug 20, 2026 purchase",
  );
  // The buyer account starts blank and is searched by part of the email.
  const account = page.getByRole("combobox", { name: /^Account/ });
  await expect(account).toHaveValue("");
  await expect(account).toHaveAttribute("placeholder", "Search by name or email");
  const recordSale = page.getByRole("button", { name: "Record sale" });
  await expectError(page, recordSale, "Choose the buyer's researcher account.");
  // Admins are in the buyer list (admins are researchers too).
  await account.fill(ADMIN.email.split("@")[0]);
  await page.getByRole("option", { name: `${ADMIN.name} · ${ADMIN.email}` }).click();
  await expect(account).toHaveValue(`${ADMIN.name} · ${ADMIN.email}`);
  // Typing another name without choosing it unlinks the admin: nothing is recorded.
  await account.fill(JORDAN.name);
  // Clicked while the list is still open (it hides the rest of the page from
  // the accessibility tree, so the button is found by its markup).
  await expect(page.getByRole("option").first()).toBeVisible();
  await expectError(page, page.locator('form.app-inv-form button[type="submit"]'), "Choose the buyer's researcher account.");
  await expect(account).toHaveValue("");
  expect((await serviceClient().from("business_sales").select("id").eq("stock_item_id", itemId)).data).toEqual([]);
  await account.fill(JORDAN.email.split("@")[0].slice(4));
  const jordanOption = page.getByRole("option", { name: `${JORDAN.name} · ${JORDAN.email}` });
  await expect(page.getByRole("option")).toHaveCount(1);
  await jordanOption.click();
  await expect(account).toHaveValue(`${JORDAN.name} · ${JORDAN.email}`);
  await recordSale.click();
  await expect(toast(page)).toHaveText("Sale recorded · 12 vials · revenue CAD 480.00 · gross profit CAD 230.00");
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory/${itemId}`);
  await expect(page.getByTestId("on-hand")).toHaveText("8");
  expect((await serviceClient().from("business_sales").select("buyer_type, buyer_profile_id").eq("stock_item_id", itemId)).data).toEqual([
    { buyer_type: "account", buyer_profile_id: jordanId },
  ]);
  await expect(page.getByTestId("sale-row")).toHaveText([
    new RegExp(
      `· 12 vials · ${JORDAN.name} \\(account\\)CAD 480\\.00` +
        "Cost CAD 250\\.00 \\(10 × CAD 20\\.00 \\+ 2 × CAD 25\\.00\\) · gross profit CAD 230\\.00$",
    ),
  ]);
  await expect(page.getByTestId("purchase-row").locator(".app-inv-sub")).toHaveText([
    "10 of 10 allocated to sales · cost locked",
    "2 of 10 allocated to sales · cost locked",
  ]);

  // A4 lists it: 8 on hand, 20 purchased, 12 sold.
  await page.getByRole("link", { name: "‹ Inventory" }).click();
  await expect(page.getByTestId("stock-row").filter({ hasText: peptide })).toHaveText(`${peptide} · 8 mg82012›`);

  // A7 for this item: totals match; last month has none of its sales.
  await nav.getByRole("link", { name: "Sales" }).click();
  await expect(h1(page)).toHaveText("Sales & gross profit");
  await expect(page.getByTestId("sales-list")).toContainText(`${label} · 12 vials · ${JORDAN.name} (account)`);
  await hydrated(page.getByLabel("Item"));
  await page.getByLabel("Item").selectOption({ label });
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/sales?item=${itemId}`);
  const kpis = page.getByTestId("kpis").locator(".app-inv-kpi-value");
  await expect(kpis).toHaveText(["12", "CAD 480.00", "CAD 250.00", "CAD 230.00"]);
  await expect(page.getByTestId("by-item")).toHaveText(`${label}12 vialsCAD 480.00CAD 250.00CAD 230.00`);
  // On wider screens the money columns show "CAD".
  expect(await page.getByTestId("by-item").locator(".app-inv-cad").first().evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(10);
  await expect(page.getByTestId("sales-list").getByTestId("sale-row")).toHaveCount(1);
  await expect(page.getByTestId("sales-list")).toContainText(`${label} · 12 vials · ${JORDAN.name} (account)`);
  await page.getByLabel("Period").selectOption({ label: "This month" });
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/sales?period=month&item=${itemId}`);
  await expect(kpis).toHaveText(["12", "CAD 480.00", "CAD 250.00", "CAD 230.00"]);
  await page.getByLabel("Period").selectOption({ label: "Last month" });
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/sales?period=prev&item=${itemId}`);
  await expect(page.getByText("No sales match this period and item.")).toBeVisible();
  await expect(kpis).toHaveText(["0", "CAD 0.00", "CAD 0.00", "CAD 0.00"]);
  await expect(page.getByText("Sales in this view")).toHaveCount(0);

  // An outside buyer for 9: blocked before saving with the designed message.
  await page.goto(`${APP_ORIGIN}/admin/inventory/sale?item=${itemId}`);
  await hydrated(page.getByLabel("Vials", { exact: true }));
  await page.getByRole("button", { name: "Outside buyer" }).click();
  await page.getByLabel("Buyer name or reference").fill("K. Osei");
  await page.getByLabel("Vials", { exact: true }).fill("9");
  await page.getByLabel("Price per vial (CAD)").fill("40");
  await expect(alert(page)).toHaveText(`Only 8 vials are on hand for ${label}. Reduce the quantity or record a purchase first.`);
  await expect(page.getByRole("button", { name: "Record sale" })).toBeDisabled();
  await expect(preview.locator("dd")).toHaveText(["8 vials", "CAD 360.00", "—", "—"]);
  expect((await serviceClient().from("business_sales").select("id").eq("stock_item_id", itemId)).data).toHaveLength(1);
});

test("A6 validation order, a future date, and stock that changes before saving", async ({ page }) => {
  const peptide = await newPeptide();
  await signInAdmin(page);
  const itemId = await purchaseNewItem(page, peptide, "2.5", "2026-08-15", "3", "20");
  await page.goto(`${APP_ORIGIN}/admin/inventory/sale?item=${itemId}`);
  await hydrated(page.getByLabel("Vials", { exact: true }));
  await expect(page.getByLabel("Sale date")).toHaveValue(businessToday());
  const save = page.getByRole("button", { name: "Record sale" });
  await page.getByRole("button", { name: "Outside buyer" }).click();
  await expect(page.getByLabel("Buyer name or reference")).toHaveAttribute("placeholder", "No app account needed");
  await page.getByLabel("Sale date").fill("");
  await expectError(page, save, "Enter the sale date.");
  await page.getByLabel("Sale date").fill(tomorrow());
  await expectError(page, save, "The sale date can't be in the future.");
  // A sale may be dated before the purchase whose stock it uses.
  await page.getByLabel("Sale date").fill("2026-08-01");
  await expectError(page, save, "Vials must be a whole number greater than 0.");
  await page.getByLabel("Vials", { exact: true }).fill("3");
  await page.getByLabel("Price per vial (CAD)").fill("abc");
  await expectError(page, save, "Enter the selling price per vial in CAD.");
  await page.getByLabel("Price per vial (CAD)").fill("40");
  await expectError(page, save, "Name or reference the outside buyer.");
  await page.getByLabel("Buyer name or reference").fill("Walk-in");

  // Another sale takes a vial meanwhile: the database refuses, nothing is recorded.
  const other = await (await signedInClient(ADMIN.email)).rpc("record_business_sale", {
    p_idempotency_key: randomUUID(),
    p_stock_item_id: itemId,
    p_sold_on: "2026-08-20",
    p_quantity: 1,
    p_unit_price: "40",
    p_buyer_name: "Elsewhere",
  });
  expect(other.error).toBeNull();
  await save.click();
  await expect(alert(page)).toHaveText("Stock changed before saving — only 2 on hand now. Nothing was recorded.");
  // The page data was refreshed: the preview now shows what is left.
  await expect(page.getByTestId("sale-preview").locator("dd").first()).toHaveText("2 vials");
  await expect(save).toBeDisabled();
  expect((await serviceClient().from("business_sales").select("quantity").eq("stock_item_id", itemId)).data).toEqual([{ quantity: 1 }]);

  // Two vials fit: the sale dated before its purchase is recorded.
  await page.getByLabel("Vials", { exact: true }).fill("2");
  await save.click();
  await expect(toast(page)).toHaveText("Sale recorded · 2 vials · revenue CAD 80.00 · gross profit CAD 40.00");
  await expect(page.getByTestId("on-hand")).toHaveText("0");
  await expect(page.getByRole("button", { name: "Record sale" })).toBeDisabled();
});

test("phone: tables fit, columns stack, KPIs in two columns", async ({ page }) => {
  const peptide = await newPeptide();
  await signInAdmin(page);
  const itemId = await purchaseNewItem(page, peptide, "10", "2026-08-15", "4", "1250.50");
  // Wide amounts: CAD 5,002.00 purchased, CAD 7,999.96 revenue.
  const sold = await (await signedInClient(ADMIN.email)).rpc("record_business_sale", {
    p_idempotency_key: randomUUID(),
    p_stock_item_id: itemId,
    p_sold_on: "2026-08-20",
    p_quantity: 4,
    p_unit_price: "1999.99",
    p_buyer_name: "A buyer with a rather long reference name for the phone layout",
  });
  expect(sold.error).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  const fits = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("main *")].every((el) => el.getBoundingClientRect().right <= window.innerWidth + 0.5),
    );

  for (const path of ["/admin/inventory", `/admin/inventory/${itemId}`, "/admin/inventory/purchase", `/admin/sales?item=${itemId}`]) {
    await page.goto(`${APP_ORIGIN}${path}`);
    await expect(page.locator(".app-tabbar")).toBeVisible();
    expect(await fits(), path).toBe(true);
  }
  await page.goto(`${APP_ORIGIN}/admin/inventory/${itemId}`);
  const [purchases, sales] = await Promise.all([page.getByTestId("purchases").boundingBox(), page.getByTestId("sales").boundingBox()]);
  expect(sales!.y).toBeGreaterThanOrEqual(purchases!.y + purchases!.height);

  await page.goto(`${APP_ORIGIN}/admin/inventory/sale?item=${itemId}`);
  expect(await fits()).toBe(true);
  const [form, preview] = await Promise.all([page.locator("form.app-inv-form").boundingBox(), page.getByTestId("sale-preview").boundingBox()]);
  expect(preview!.y).toBeGreaterThanOrEqual(form!.y + form!.height);
  expect(preview!.width).toBeGreaterThan(330);

  // A7 money columns drop "CAD" and keep each amount on one line.
  await page.goto(`${APP_ORIGIN}/admin/sales?item=${itemId}`);
  const row = page.getByTestId("by-item").locator(".app-inv-item-row");
  await expect(row).toHaveText(/^.+4 vialsCAD 7,999\.96CAD 5,002\.00CAD 2,997\.96$/);
  const cells = await row.evaluate((el) => ({
    cad: [...el.querySelectorAll(".app-inv-cad")].map((cad) => cad.getBoundingClientRect().width),
    heights: [...el.querySelectorAll(".app-inv-num")].map((cell) => cell.getBoundingClientRect().height),
    shown: [...el.querySelectorAll(".app-inv-amount")].map((amount) => (amount as HTMLElement).innerText),
  }));
  expect(cells.cad).toHaveLength(3);
  for (const width of cells.cad) expect(width).toBeLessThanOrEqual(1);
  for (const height of cells.heights) expect(height).toBeLessThan(24);
  expect(cells.shown).toEqual(["7,999.96", "5,002.00", "2,997.96"]);
  // The KPI numbers drop the visible "CAD" too, and each stays on one line.
  const kpis = await page.getByTestId("kpis").evaluate((el) => ({
    cad: [...el.querySelectorAll(".app-inv-cad")].map((cad) => cad.getBoundingClientRect().width),
    shown: [...el.querySelectorAll(".app-inv-kpi-value .app-inv-amount")].map((value) => (value as HTMLElement).innerText),
    heights: [...el.querySelectorAll(".app-inv-kpi-value")].map((value) => value.getBoundingClientRect().height),
  }));
  // 26px numbers: one line is about 32px high.
  for (const height of kpis.heights) expect(height).toBeLessThan(45);
  expect(kpis.cad).toHaveLength(3);
  for (const width of kpis.cad) expect(width).toBeLessThanOrEqual(1);
  expect(kpis.shown).toEqual(["7,999.96", "5,002.00", "2,997.96"]);
  expect(await fits()).toBe(true);

  await page.goto(`${APP_ORIGIN}/admin/sales`);
  const tops = await page.getByTestId("kpis").locator(".app-inv-kpi-value").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  expect(tops[0]).toBe(tops[1]);
  expect(tops[2]).toBeGreaterThan(tops[0]);
  expect(await fits()).toBe(true);
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

test("switching the stock item blocks saving until that item's preview has loaded", async ({ page }) => {
  const [first, second] = [await seedItem(3, "10"), await seedItem(5, "12")];
  await signInAdmin(page);
  await page.goto(`${APP_ORIGIN}/admin/inventory/sale?item=${first.id}`);
  await hydrated(page.getByLabel("Vials", { exact: true }));
  await page.getByRole("button", { name: "Outside buyer" }).click();
  await page.getByLabel("Buyer name or reference").fill("Walk-in");
  await page.getByLabel("Vials", { exact: true }).fill("2");
  await page.getByLabel("Price per vial (CAD)").fill("30");
  const save = page.getByRole("button", { name: "Record sale" });
  const preview = page.getByTestId("sale-preview");
  await expect(save).toBeEnabled();
  await expect(preview.locator("dd")).toHaveText(["3 vials", "CAD 60.00", "CAD 20.00", "CAD 40.00"]);

  // Hold the second item's data until the save attempts are done.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === "/admin/inventory/sale" && url.searchParams.get("item") === second.id,
    async (route) => {
      if (route.request().headers()["rsc"]) await held;
      await route.continue();
    },
  );
  await select(page, "stockItemId").selectOption(second.id);
  await expect(preview.getByRole("heading")).toHaveText(`Preview · ${second.label}`);
  await expect(preview).toHaveAttribute("aria-busy", "true");
  await expect(preview.locator("dd")).toHaveText(["5 vials", "CAD 60.00", "—", "—"]);
  await expect(save).toBeDisabled();
  // Neither Enter in a field nor a direct form submission records anything.
  await page.getByLabel("Price per vial (CAD)").press("Enter");
  await page.locator("form.app-inv-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
  await expect(save).toHaveText("Record sale");

  release();
  await expect(preview).not.toHaveAttribute("aria-busy", "true");
  await expect(preview.locator("dd")).toHaveText(["5 vials", "CAD 60.00", "CAD 24.00", "CAD 36.00"]);
  await expect(save).toBeEnabled();
  for (const item of [first, second]) {
    expect((await serviceClient().from("business_sales").select("id").eq("stock_item_id", item.id)).data).toEqual([]);
  }
  await expect(toast(page)).toHaveCount(0);
});

test("a slow response for a previously chosen item never replaces the current item's preview", async ({ page }) => {
  const [first, slow, current] = [await seedItem(3, "10"), await seedItem(5, "12"), await seedItem(7, "14")];
  await signInAdmin(page);
  await page.goto(`${APP_ORIGIN}/admin/inventory/sale?item=${first.id}`);
  await hydrated(page.getByLabel("Vials", { exact: true }));
  await page.getByLabel("Vials", { exact: true }).fill("2");
  await page.getByLabel("Price per vial (CAD)").fill("30");
  const preview = page.getByTestId("sale-preview");
  await expect(preview.locator("dd")).toHaveText(["3 vials", "CAD 60.00", "CAD 20.00", "CAD 40.00"]);

  // The second item's data is held back; the third item's arrives first.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const isSlow = (url: URL) => url.pathname === "/admin/inventory/sale" && url.searchParams.get("item") === slow.id;
  await page.route(isSlow, async (route) => {
    if (route.request().headers()["rsc"]) await held;
    await route.continue().catch(() => {});
  });
  await select(page, "stockItemId").selectOption(slow.id);
  await expect(preview).toHaveAttribute("aria-busy", "true");
  await select(page, "stockItemId").selectOption(current.id);
  await expect(preview.getByRole("heading")).toHaveText(`Preview · ${current.label}`);
  await expect(preview.locator("dd")).toHaveText(["7 vials", "CAD 60.00", "CAD 28.00", "CAD 32.00"]);

  // The late response arrives: the chosen item and its preview stay as they are.
  release();
  await page.waitForTimeout(1_000);
  await expect(select(page, "stockItemId")).toHaveValue(current.id);
  await expect(preview.getByRole("heading")).toHaveText(`Preview · ${current.label}`);
  await expect(preview.locator("dd")).toHaveText(["7 vials", "CAD 60.00", "CAD 28.00", "CAD 32.00"]);
  await expect(preview).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: "Record sale" })).toBeEnabled();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory/sale?item=${current.id}`);
});

test("a researcher cannot reach inventory or sales", async ({ page }) => {
  await signInAs(page, APP_ORIGIN, RESEARCHER.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  for (const path of [
    "/admin/inventory",
    `/admin/inventory/${randomUUID()}`,
    "/admin/inventory/purchase",
    "/admin/inventory/sale",
    "/admin/sales",
    "/admin/sales?period=month",
  ]) {
    await page.goto(`${APP_ORIGIN}${path}`);
    await expect(page, path).toHaveURL(`${APP_ORIGIN}/app/today`);
  }
});
