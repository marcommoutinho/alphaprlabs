// USD purchases with Bank of Canada conversion (Marco, 2026-09-27) in the
// browser. Rates are read from public.fx_rates; when a date's window isn't
// stored, the Bank of Canada is the local stub (BOC_FX_TEST_RATES in
// playwright.config.ts; src/lib/inventory/fx.ts), never the real API: rates
// for Aug 24-26 and Fri Aug 28 (1.3888), none for the weekend, and Aug 19
// answers as if the Bank of Canada were down. The table keeps every rate
// stored, across tests and runs, and a date's latest stored rate within the
// window is the one used (the FX rule), so a test that expects a particular
// rate stores its own dates' rates first. Each test works on its own library
// peptide.
import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { APP_ORIGIN } from "../../playwright.config";
import { usdToCad } from "../../src/lib/inventory/rules";
import { ensureAccount, hydrated, serviceClient, signInAs, uniqueEmail } from "../support/local-supabase";

const ADMIN = { email: uniqueEmail("usd-inv-admin"), name: "USD Inventory Admin" };

test.beforeAll(async () => {
  await ensureAccount({ ...ADMIN, role: "admin" });
});

const alert = (page: Page) => page.locator('.app-inline-error[role="alert"]');
const toast = (page: Page) => page.locator(".app-toast");
const select = (page: Page, name: string) => page.locator(`select[name="${name}"]`);
const ITEM_URL = new RegExp(`^${APP_ORIGIN}/admin/inventory/([0-9a-f-]{36})$`);

async function newPeptide(): Promise<string> {
  const name = `Compound USD ${randomBytes(3).toString("hex")}`;
  const { error } = await serviceClient().from("peptides").insert({ name, information: "[Supplied information]", available: true });
  if (error) throw error;
  return name;
}

/** Signs in and opens A5 for a new stock item of `peptide` at 10 mg, cost in USD. */
async function openUsdPurchase(page: Page, peptide: string) {
  await signInAs(page, APP_ORIGIN, ADMIN.email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/admin/inventory/purchase`);
  await hydrated(page.getByLabel("Vials", { exact: true }));
  await select(page, "stockItemId").selectOption({ label: "New peptide / strength…" });
  await select(page, "peptideId").selectOption({ label: peptide });
  await page.getByLabel("Vial strength (mg)").fill("10");
  await expect(page.getByRole("button", { name: "CAD", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "USD", exact: true }).click();
  await expect(page.getByRole("button", { name: "USD", exact: true })).toHaveAttribute("aria-pressed", "true");
}

/**
 * "A USD purchase" owns its rates: Thu Jul 16 and Fri Jul 17, 2026 (no other
 * test uses July 2026; Sat Jul 18 has none), stored here as the daily sync
 * would, so it never depends on which other test stored which Bank of Canada
 * rate first. A stored rate is never replaced (the first value for a date
 * stays), so the rates it expects are read back from the table, not assumed.
 */
const OWN = { thursday: "2026-07-16", friday: "2026-07-17", saturday: "2026-07-18" } as const;

async function ownRates(): Promise<{ thursday: string; friday: string }> {
  const db = serviceClient();
  const { error } = await db.rpc("store_fx_rates", {
    p_rates: [
      { date: OWN.thursday, rate: "1.3712" },
      { date: OWN.friday, rate: "1.3701" },
    ],
  });
  expect(error).toBeNull();
  const { data } = await db
    .from("fx_rates")
    .select("rate_date, usd_cad::text")
    .in("rate_date", [OWN.thursday, OWN.friday, OWN.saturday])
    .order("rate_date")
    .overrideTypes<{ rate_date: string; usd_cad: string }[], { merge: false }>();
  // Thursday and Friday, and nothing for the Saturday: its rate is Friday's.
  expect(data!.map((r) => r.rate_date)).toEqual([OWN.thursday, OWN.friday]);
  return { thursday: data![0].usd_cad, friday: data![1].usd_cad };
}

const cad = (amount: string) => `CAD ${amount}`;
const times10 = (unit: string) => (Number(unit) * 10).toFixed(2);

test("a USD purchase: the rate preview, the CAD cost saved and the purchase line", async ({ page }) => {
  const rates = await ownRates();
  const peptide = await newPeptide();
  await openUsdPurchase(page, peptide);
  const preview = page.getByTestId("usd-preview");
  const rate = page.getByTestId("fx-rate");

  // A Saturday: Friday's rate, and the form says why.
  await page.getByLabel("Received").fill(OWN.saturday);
  await expect(rate).toHaveText(`Bank of Canada rate for Jul 17: ${rates.friday}`);
  await expect(preview).toContainText("No rate was published for Jul 18 (weekend or holiday), so the latest earlier rate is used.");
  await page.getByLabel("Vials", { exact: true }).fill("10");
  await page.getByLabel("Cost per vial (USD)").fill("11,5");
  const saturdayUnit = usdToCad("11.50", rates.friday); // 11.50 × 1.3701 = 15.75615 → 15.76
  await expect(page.getByTestId("usd-preview-unit")).toHaveText(cad(saturdayUnit));
  await expect(page.getByTestId("purchase-total")).toHaveText(cad(times10(saturdayUnit)));

  // Its own rate on a business day; the "1,000" form is refused, not guessed.
  await page.getByLabel("Received").fill(OWN.thursday);
  await expect(rate).toHaveText(`Bank of Canada rate for Jul 16: ${rates.thursday}`);
  await expect(preview).not.toContainText("latest earlier rate");
  await page.getByLabel("Cost per vial (USD)").fill("1,000");
  await expect(page.getByTestId("purchase-total")).toHaveText("—");
  await page.getByRole("button", { name: "Record purchase" }).click();
  await expect(alert(page)).toHaveText("Enter the cost per vial in USD (0 or more).");
  await page.getByLabel("Cost per vial (USD)").fill("11");
  const unit = usdToCad("11", rates.thursday); // 11 × 1.3712 = 15.0832 → 15.08
  await expect(page.getByTestId("usd-preview-unit")).toHaveText(cad(unit));
  await expect(page.getByTestId("purchase-total")).toHaveText(cad(times10(unit)));
  await page.getByRole("button", { name: "Record purchase" }).click();

  // Saved with the server's conversion; A4 shows it, totals in CAD.
  const conversion = `USD 11.00 × ${rates.thursday} (BoC Jul 16) = ${cad(unit)}`;
  await expect(toast(page)).toHaveText(`Purchase recorded · 10 vials at USD 11.00 = ${cad(unit)}`);
  await expect(page).toHaveURL(ITEM_URL);
  await expect(page.getByTestId("purchase-row")).toHaveText([`Jul 16, 2026 · 10 vials at ${cad(unit)}${conversion}None allocated yet${cad(times10(unit))}`]);
  await expect(page.getByTestId("purchase-conversion")).toHaveText(conversion);
  const itemId = ITEM_URL.exec(page.url())![1];
  const { data } = await serviceClient()
    .from("business_purchases")
    .select("unit_cost, original_currency, original_unit_cost, fx_rate, fx_rate_date")
    .eq("stock_item_id", itemId);
  expect(data).toEqual([
    { unit_cost: Number(unit), original_currency: "USD", original_unit_cost: 11, fx_rate: Number(rates.thursday), fx_rate_date: OWN.thursday },
  ]);
});

test("rates come from our stored table; a missing window is fetched once and stored", async ({ page }) => {
  // Fri Sep 4 (real, 1.3840) is stored as the daily sync would; the stub doesn't know it.
  const { error } = await serviceClient().rpc("store_fx_rates", { p_rates: [{ date: "2026-09-04", rate: "1.3840" }] });
  expect(error).toBeNull();
  const peptide = await newPeptide();
  await openUsdPurchase(page, peptide);
  const rate = page.getByTestId("fx-rate");
  // Labour Day Monday: the stored Friday rate.
  await page.getByLabel("Received").fill("2026-09-07");
  await expect(rate).toHaveText("Bank of Canada rate for Sep 4: 1.3840");
  await expect(page.getByTestId("usd-preview")).toContainText("No rate was published for Sep 7 (weekend or holiday)");
  // Aug 25: from the table, or from the stub when not stored yet (then stored); the save uses the stored rate.
  await page.getByLabel("Received").fill("2026-08-25");
  await expect(rate).toHaveText("Bank of Canada rate for Aug 25: 1.3839");
  await page.getByLabel("Vials", { exact: true }).fill("10");
  await page.getByLabel("Cost per vial (USD)").fill("11");
  await page.getByRole("button", { name: "Record purchase" }).click();
  await expect(toast(page)).toHaveText("Purchase recorded · 10 vials at USD 11.00 = CAD 15.22"); // 15.2229
  await expect(page.getByTestId("purchase-conversion")).toHaveText("USD 11.00 × 1.3839 (BoC Aug 25) = CAD 15.22");
  const stored = await serviceClient().from("fx_rates").select("usd_cad").eq("rate_date", "2026-08-25");
  expect(stored.data).toEqual([{ usd_cad: 1.3839 }]);
});

test("the Bank of Canada unreachable: the preview offers a retry and the save is refused, nothing recorded", async ({ page }) => {
  const peptide = await newPeptide();
  await openUsdPurchase(page, peptide);
  await page.getByLabel("Received").fill("2026-08-19");
  await expect(page.getByTestId("fx-rate")).toContainText("Couldn't get the Bank of Canada rate. Try again in a moment.");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("fx-rate")).toContainText("Couldn't get the Bank of Canada rate.");
  await page.getByLabel("Vials", { exact: true }).fill("5");
  await page.getByLabel("Cost per vial (USD)").fill("11");
  await expect(page.getByTestId("purchase-total")).toHaveText("—");
  await page.getByRole("button", { name: "Record purchase" }).click();
  await expect(alert(page)).toHaveText(
    "Couldn't get the Bank of Canada rate, so nothing was recorded. Your entry is still here — try again in a moment.",
  );
  await expect(page).toHaveURL(`${APP_ORIGIN}/admin/inventory/purchase`);
  await expect(page.getByLabel("Cost per vial (USD)")).toHaveValue("11");
  const { data } = await serviceClient().from("peptides").select("id").eq("name", peptide).single();
  const items = await serviceClient().from("business_stock_items").select("id").eq("peptide_id", data!.id);
  expect(items.data).toEqual([]);
});
