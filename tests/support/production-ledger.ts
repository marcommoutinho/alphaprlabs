// A business ledger shaped like production's (2026-09-30): the Sep 14
// add-back lots (31 purchases over a dozen items, several strengths) and 18
// sales from Sep 16 to 24 by two sellers to several buyers, among them a
// researcher with an account and "Melanie (Sandra's friend)". The longest
// item name, CJC-1295 without DAC + Ipamorelin 5 mg, ends below its reorder
// level (8 of 10), so Stock shows it low. Each call makes
// its own items and sellers, so a spec can filter the Ledger to exactly this
// data (the seller filter, the item filter) while other specs record sales
// alongside. No app imports: e2e specs use this.
import { randomBytes, randomUUID } from "node:crypto";
import { ensureAccount, serviceClient, signedInClient, uniqueEmail } from "./local-supabase";
import { recordPreviewedSale } from "./sales";

export type ProductionLedger = {
  admin: { email: string; id: string };
  second: { id: string };
  buyer: { id: string };
  items: string[];
  peptides: string[];
};

const PEPTIDES = [
  "BPC-157",
  "TB-500",
  "Retatrutide",
  "Tirzepatide",
  "CJC-1295 without DAC + Ipamorelin",
  "GHK-Cu",
  "Semaglutide",
  "MOTS-c",
  "Epitalon",
  "Selank",
  "KPV",
  "NAD+",
];

// [item index, strength mg, vials, unit cost]: 31 lots received Sep 14.
const LOTS: [number, string, number, string][] = [
  [0, "5", 10, "18.40"], [0, "10", 10, "27.90"], [1, "5", 10, "21.10"], [1, "10", 5, "33.00"],
  [2, "10", 10, "64.25"], [2, "20", 5, "109.80"], [2, "30", 5, "149.00"], [3, "10", 10, "41.60"],
  [3, "30", 5, "88.10"], [3, "60", 3, "151.35"], [4, "10", 10, "36.00"], [4, "5", 10, "22.40"],
  [5, "50", 10, "15.95"], [5, "100", 5, "24.50"], [6, "5", 10, "19.70"], [6, "10", 10, "29.30"],
  [7, "10", 5, "31.20"], [7, "40", 3, "86.00"], [8, "10", 10, "17.80"], [8, "50", 3, "55.55"],
  [9, "5", 10, "14.30"], [9, "10", 5, "22.60"], [10, "10", 10, "20.90"], [11, "500", 5, "48.00"],
  [11, "1000", 3, "81.75"], [0, "5", 10, "18.10"], [1, "5", 10, "20.80"], [2, "10", 5, "63.90"],
  [3, "10", 5, "42.05"], [4, "10", 5, "35.50"], [5, "50", 10, "16.20"],
];

// [lot index, sold on, vials, unit price, buyer, seller]: 18 sales, Sep 16–24.
type Buyer = "account" | string;
const SALES: [number, string, number, string, Buyer, "admin" | "second"][] = [
  [0, "2026-09-16", 2, "75", "Melanie (Sandra's friend)", "admin"],
  [4, "2026-09-16", 1, "180", "account", "second"],
  [7, "2026-09-17", 3, "120", "Dave from the gym", "admin"],
  [12, "2026-09-17", 2, "55", "Melanie (Sandra's friend)", "admin"],
  [10, "2026-09-18", 2, "110", "Chris P.", "second"],
  [5, "2026-09-18", 1, "260", "account", "admin"],
  [14, "2026-09-19", 4, "60", "Jess Thompson-Whitaker", "second"],
  [2, "2026-09-19", 2, "70", "Melanie (Sandra's friend)", "admin"],
  [8, "2026-09-20", 1, "210", "Chris P.", "admin"],
  [18, "2026-09-20", 3, "50", "account", "second"],
  [20, "2026-09-21", 2, "45", "Dave from the gym", "admin"],
  [15, "2026-09-21", 2, "85", "Jess Thompson-Whitaker", "second"],
  [23, "2026-09-22", 1, "140", "Melanie (Sandra's friend)", "admin"],
  [16, "2026-09-22", 2, "95", "account", "admin"],
  [22, "2026-09-23", 3, "65", "Chris P.", "second"],
  [3, "2026-09-23", 1, "95", "Dave from the gym", "admin"],
  [6, "2026-09-24", 1, "340", "Melanie (Sandra's friend)", "second"],
  [11, "2026-09-24", 2, "70", "account", "admin"],
];

/** Seeds the production-shaped ledger: 31 purchases on Sep 14 and 18 sales over Sep 16–24. */
export async function seedProductionLedger(label: string): Promise<ProductionLedger> {
  const t = randomBytes(3).toString("hex");
  const admin = { email: uniqueEmail(`${label}-admin`), id: "" };
  admin.id = await ensureAccount({ email: admin.email, name: `Marco Moutinho ${t}`, role: "admin" });
  const second = { id: await ensureAccount({ email: uniqueEmail(`${label}-second`), name: `Sandra Oliveira ${t}`, role: "admin" }) };
  const buyer = { id: await ensureAccount({ email: uniqueEmail(`${label}-buyer`), name: `Katherine Montgomery-Clarke ${t}`, role: "researcher" }) };

  const { data: peptides, error } = await serviceClient()
    .from("peptides")
    .insert(PEPTIDES.map((name) => ({ name: `${name} ${t}`, information: "[Supplied information]", available: true })))
    .select("id, name");
  if (error) throw error;
  const peptideIds = PEPTIDES.map((name) => peptides.find((row) => row.name === `${name} ${t}`)!.id);

  const db = await signedInClient(admin.email);
  const lots: string[] = [];
  for (const [item, strength, quantity, cost] of LOTS) {
    const bought = await db
      .rpc("record_business_purchase", {
        p_idempotency_key: randomUUID(),
        p_peptide_id: peptideIds[item],
        p_strength_mg: strength,
        p_received_on: "2026-09-14",
        p_quantity: quantity,
        p_unit_cost: cost,
      })
      .single();
    if (bought.error) throw bought.error;
    lots.push(bought.data.stock_item_id);
  }
  for (const [lot, soldOn, quantity, price, who, seller] of SALES) {
    const sold = await recordPreviewedSale(db, {
      p_idempotency_key: randomUUID(),
      p_stock_item_id: lots[lot],
      p_sold_on: soldOn,
      p_quantity: quantity,
      p_unit_price: price,
      ...(who === "account" ? { p_buyer_profile_id: buyer.id } : { p_buyer_name: who }),
      p_seller_id: seller === "admin" ? admin.id : second.id,
    });
    if (sold.error) throw sold.error;
  }
  return { admin, second, buyer, items: [...new Set(lots)], peptides: peptideIds };
}
