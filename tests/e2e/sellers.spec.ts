// Sellers and buyer linking in the browser (Marco, 2026-09-27): A6 records the
// seller chosen from the current admins (the signed-in admin first), A7 shows
// revenue, cost and gross profit per seller for the chosen period and item,
// and an outside buyer's past sale is linked to an account from the stock
// item. Each test works on its own library peptide.
import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { APP_ORIGIN } from "../../playwright.config";
import { ensureAccount, hydrated, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";

const tag = randomBytes(2).toString("hex");
const MARCO = { email: uniqueEmail("e2e-sel-marco"), name: `Marco Seller ${tag}` };
const NATASHA = { email: uniqueEmail("e2e-sel-natasha"), name: `Natasha Seller ${tag}` };
const KWAME = { email: uniqueEmail("e2e-sel-kwame"), name: `Kwame Osei ${tag}` };
const id = { marco: "", natasha: "", kwame: "" };

test.beforeAll(async () => {
  id.marco = await ensureAccount({ ...MARCO, role: "admin" });
  id.natasha = await ensureAccount({ ...NATASHA, role: "admin" });
  id.kwame = await ensureAccount({ ...KWAME, role: "researcher" });
});

const toast = (page: Page) => page.locator(".app-toast");
const h1 = (page: Page) => page.getByRole("heading", { level: 1 });

/** A stock item of a new peptide with 10 vials at CAD 20 (Sep 1), recorded as Marco; returns its id and label. */
async function seedItem() {
  const name = `Compound ${randomBytes(3).toString("hex")}`;
  const { data: peptide, error } = await serviceClient()
    .from("peptides")
    .insert({ name, information: "[Supplied information]", available: true })
    .select("id")
    .single();
  if (error) throw error;
  const bought = await (await signedInClient(MARCO.email))
    .rpc("record_business_purchase", {
      p_idempotency_key: randomUUID(),
      p_peptide_id: peptide.id,
      p_strength_mg: "5",
      p_received_on: "2026-09-01",
      p_quantity: 10,
      p_unit_cost: "20",
    })
    .single();
  if (bought.error) throw bought.error;
  return { id: bought.data.stock_item_id, label: `${name} · 5 mg` };
}

test("a sale records the seller chosen; A7 shows totals per seller for the period and item", async ({ page }) => {
  const item = await seedItem();
  // An earlier sale by Marco, recorded directly.
  const earlier = await (await signedInClient(MARCO.email)).rpc("record_business_sale", {
    p_idempotency_key: randomUUID(),
    p_stock_item_id: item.id,
    p_sold_on: "2026-09-10",
    p_quantity: 2,
    p_unit_price: "50",
    p_buyer_name: "Walk-in",
    p_seller_id: id.marco,
  });
  expect(earlier.error).toBeNull();

  await signInAs(page, APP_ORIGIN, MARCO.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/admin/inventory/sale?item=${item.id}`);
  const seller = page.locator('select[name="sellerId"]');
  await hydrated(seller);
  // The signed-in admin is the default; every current admin can be chosen, researchers can't.
  await expect(seller).toHaveValue(id.marco);
  await expect(seller.locator("option", { hasText: NATASHA.name })).toHaveCount(1);
  await expect(seller.locator("option", { hasText: KWAME.name })).toHaveCount(0);
  await seller.selectOption({ label: NATASHA.name });
  await page.getByRole("button", { name: "Outside buyer" }).click();
  await page.getByLabel("Buyer name or reference").fill("Clinic 9");
  await page.getByLabel("Vials", { exact: true }).fill("3");
  await page.getByLabel("Price per vial (CAD)").fill("40");
  await page.getByRole("button", { name: "Record sale" }).click();
  await expect(toast(page)).toHaveText("Sale recorded · 3 vials · revenue CAD 120.00 · gross profit CAD 60.00");
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory/${item.id}`);
  await expect(page.getByTestId("sale-row").filter({ hasText: "Clinic 9" }).getByTestId("sale-seller")).toHaveText(`Sold by ${NATASHA.name}`);
  expect((await serviceClient().from("business_sales").select("seller_id, seller_name").eq("stock_item_id", item.id).eq("buyer_name", "Clinic 9")).data).toEqual([
    { seller_id: id.natasha, seller_name: NATASHA.name },
  ]);

  // A7 for this item: one row per seller, by name.
  await page.goto(`${APP_ORIGIN}/admin/sales?item=${item.id}`);
  await expect(h1(page)).toHaveText("Sales & gross profit");
  await expect(page.getByRole("heading", { name: "By seller" })).toBeVisible();
  const rows = page.getByTestId("by-seller").locator(".app-inv-item-row");
  await expect(rows).toHaveText([
    `${MARCO.name}2 vialsCAD 100.00CAD 40.00CAD 60.00`,
    `${NATASHA.name}3 vialsCAD 120.00CAD 60.00CAD 60.00`,
  ]);
  // The same period selector: last month has none of these sales.
  await hydrated(page.getByLabel("Period"));
  await page.getByLabel("Period").selectOption({ label: "Last month" });
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/sales?period=prev&item=${item.id}`);
  await expect(page.getByText("No sales match this period and item.")).toBeVisible();
  await expect(page.getByTestId("by-seller")).toHaveCount(0);
});

test("Outside buyers: an outside buyer is found by name from A7 and their sales are linked from there", async ({ page }) => {
  const item = await seedItem();
  const marco = await signedInClient(MARCO.email);
  const name = `Finder Osei ${randomBytes(2).toString("hex")}`;
  for (const [soldOn, quantity] of [["2026-09-03", 1], ["2026-09-07", 2]] as const) {
    const sold = await marco.rpc("record_business_sale", {
      p_idempotency_key: randomUUID(),
      p_stock_item_id: item.id,
      p_sold_on: soldOn,
      p_quantity: quantity,
      p_unit_price: "30",
      p_buyer_name: name,
      p_seller_id: id.marco,
    });
    expect(sold.error).toBeNull();
  }

  await signInAs(page, APP_ORIGIN, MARCO.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/admin/sales`);
  await page.getByRole("link", { name: "Outside buyers" }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/sales/outside`);
  await expect(h1(page)).toHaveText("Outside buyers");
  await (await hydrated(page.getByLabel("Find a buyer"))).fill(name.toLowerCase());
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/sales/outside?${new URLSearchParams({ q: name.toLowerCase() })}`);
  const found = page.getByTestId("outside-buyer");
  await expect(found).toHaveCount(1);
  await expect(found).toContainText(`${name}2 sales · 3 vials · last Sep 7, 2026`);
  await expect(found).toContainText("CAD 90.00");

  await found.click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/sales/outside?${new URLSearchParams({ name })}`);
  await expect(h1(page)).toHaveText(name);
  const rows = page.getByTestId("sale-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(`Sep 7, 2026 · ${item.label} · 2 vials · ${name} (outside)`);
  await (await hydrated(rows.last().getByRole("button", { name: "Link to account…" }))).click();
  const panel = rows.last().getByTestId("link-sale");
  const account = panel.getByRole("combobox", { name: /^Account/ });
  await account.fill(KWAME.email.split("@")[0]);
  await page.getByRole("option", { name: `${KWAME.name} · ${KWAME.email}` }).click();
  await panel.getByLabel(`Also link every other outside sale recorded as “${name}”`).check();
  await panel.getByRole("button", { name: "Link sale" }).click();
  await expect(toast(page)).toHaveText(`Linked 2 sales to ${KWAME.name}.`);
  await expect(page.getByText(`No sales are recorded to “${name}” as an outside buyer any more.`)).toBeVisible();
});

test("an outside buyer's past sale is linked to their account; nothing else about it changes", async ({ page }) => {
  const item = await seedItem();
  const marco = await signedInClient(MARCO.email);
  const name = `K. Osei ${randomBytes(2).toString("hex")}`;
  for (const soldOn of ["2026-09-05", "2026-09-06"]) {
    const sold = await marco.rpc("record_business_sale", {
      p_idempotency_key: randomUUID(),
      p_stock_item_id: item.id,
      p_sold_on: soldOn,
      p_quantity: 1,
      p_unit_price: "45",
      p_buyer_name: name,
      p_seller_id: id.natasha,
    });
    expect(sold.error).toBeNull();
  }
  const before = (await serviceClient().from("business_sales").select("id, revenue, cost, quantity, sold_on, seller_id").eq("stock_item_id", item.id).order("sold_on")).data;

  await signInAs(page, APP_ORIGIN, MARCO.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/admin/inventory/${item.id}`);
  const rows = page.getByTestId("sale-row");
  await expect(rows).toHaveCount(2);
  const newest = rows.first();
  await expect(newest.getByTestId("sale-buyer")).toHaveText(`${name} (outside)`);
  await (await hydrated(newest.getByRole("button", { name: "Link to account…" }))).click();
  const panel = newest.getByTestId("link-sale");
  await expect(panel.getByText("A buyer reference only: it grants no access to their private records")).toBeVisible();
  const account = panel.getByRole("combobox", { name: /^Account/ });
  await account.fill(KWAME.email.split("@")[0]);
  await page.getByRole("option", { name: `${KWAME.name} · ${KWAME.email}` }).click();
  await expect(account).toHaveValue(`${KWAME.name} · ${KWAME.email}`);
  await panel.getByLabel(`Also link every other outside sale recorded as “${name}”`).check();
  await panel.getByRole("button", { name: "Link sale" }).click();
  await expect(toast(page)).toHaveText(`Linked 2 sales to ${KWAME.name}.`);
  await expect(rows.getByTestId("sale-buyer")).toHaveText([
    `${KWAME.name} (account · recorded as ${name})`,
    `${KWAME.name} (account · recorded as ${name})`,
  ]);
  await expect(page.getByRole("button", { name: "Link to account…" })).toHaveCount(0);
  const after = (await serviceClient().from("business_sales").select("id, revenue, cost, quantity, sold_on, seller_id").eq("stock_item_id", item.id).order("sold_on")).data;
  expect(after).toEqual(before);

  // Outside buyers no longer lists the name.
  await page.goto(`${APP_ORIGIN}/admin/sales/outside?${new URLSearchParams({ q: name })}`);
  await expect(page.getByText(`No outside buyer matches “${name}”.`)).toBeVisible();

  // Kwame's own view gains nothing: no admin screen, and the researcher side shows no business record.
  const kwame = await (await page.context().browser()!.newContext()).newPage();
  await signInAs(kwame, APP_ORIGIN, KWAME.email);
  await expect(kwame).toHaveURL(`${APP_ORIGIN}/app/today`);
  await kwame.goto(`${APP_ORIGIN}/admin/sales`);
  await expect(kwame).toHaveURL(`${APP_ORIGIN}/app/today`);
  expect((await (await signedInClient(KWAME.email)).from("business_sales").select("id")).data).toEqual([]);
});
