// Copy and view helpers for sellers and buyer linking (Marco, 2026-09-27:
// "Sellers, admin invitations and buyer linking"): the A6 Seller select, the
// A7 "By seller" rows, a sale's seller line and "Link to account…". Pure: no
// database, no React. Admin screens only; no researcher screen names an
// admin or a seller.

/** The seller of a sale recorded before sellers existed (a sale's line and the By seller row). */
export const NO_SELLER = "Seller not recorded";
export const NO_SELLERS = "No admin can be chosen as the seller. Reload the page and try again.";

/** A6 seller option: the admin's name, with the email when two admins share a name. */
export function sellerOptions(sellers: { id: string; name: string; email: string }[]): { id: string; label: string }[] {
  const key = (name: string) => name.trim().toLocaleLowerCase("en-CA");
  const shared = (name: string) => sellers.filter((other) => key(other.name) === key(name)).length > 1;
  return sellers.map((seller) => ({ id: seller.id, label: shared(seller.name) ? `${seller.name} · ${seller.email}` : seller.name }));
}

/**
 * The seller A6 starts with: the signed-in admin when they can be chosen,
 * else none (the admin picks one).
 */
export const defaultSeller = (sellers: { id: string }[], signedIn: string) =>
  sellers.some((seller) => seller.id === signedIn) ? signedIn : "";

/** A sale's seller: `Sold by Marco Moutinho`, or `Seller not recorded` for an older sale. */
export const sellerLine = (sale: { sellerName: string | null }) => (sale.sellerName ? `Sold by ${sale.sellerName}` : NO_SELLER);

const nameKey = (name: string) => name.trim().toLocaleLowerCase("en-CA");

/**
 * The email under an A7 "By seller" name, as in the A6 select: only when
 * another row has the same name (two admins who share a name), else null.
 */
export function sellerRowEmail(
  row: { sellerId: string | null; sellerName: string | null; sellerEmail: string | null },
  rows: { sellerId: string | null; sellerName: string | null }[],
): string | null {
  if (row.sellerName === null || row.sellerEmail === null) return null;
  const key = nameKey(row.sellerName);
  return rows.some((other) => other.sellerId !== row.sellerId && other.sellerName !== null && nameKey(other.sellerName) === key)
    ? row.sellerEmail
    : null;
}

// ── Outside buyers (A7): every outside-buyer sale can be found and linked ──
export const OUTSIDE_TITLE = "Outside buyers";
export const OUTSIDE_SUBTITLE =
  "Sales recorded to an outside buyer and not yet linked to an account, by name. When that person joins, open their name and link their sales.";
export const OUTSIDE_SEARCH_LABEL = "Find a buyer";
export const OUTSIDE_SEARCH_SUBMIT = "Find";
export const OUTSIDE_EMPTY = "No outside-buyer sales are waiting to be linked.";
export const OUTSIDE_LINK_NOTE = "Find a past outside buyer's sales to link them to an account:";
export const outsideNoMatch = (search: string) => `No outside buyer matches “${search.trim()}”.`;
export const outsideNameEmpty = (name: string) => `No sales are recorded to “${name}” as an outside buyer any more.`;

/** `3 sales · 5 vials · last Sep 6, 2026` (the date already formatted). */
export const outsideBuyerLine = (row: { sales: number; vials: number }, lastSold: string) =>
  `${row.sales.toLocaleString("en-CA")} sale${row.sales === 1 ? "" : "s"} · ${row.vials.toLocaleString("en-CA")} vial${row.vials === 1 ? "" : "s"} · last ${lastSold}`;

// ── Link to account… ────────────────────────────────────────────────────────
export const LINK_BUTTON = "Link to account…";
export const LINK_TITLE = "Link this sale to an account";
export const LINK_NOTE =
  "For an outside buyer who has since joined. A buyer reference only: it grants no access to their private records and adds nothing to their personal supplies. Revenue, cost and gross profit stay as recorded.";
export const LINK_SUBMIT = "Link sale";
export const LINK_NOT_LINKABLE = "This sale is already linked to an account. The list has been refreshed.";
export const LINK_UNKNOWN_ACCOUNT = "That account can't be found. Choose the account again.";

/** The checkbox that links every outside sale recorded with the same name. */
export const linkSameNameLabel = (name: string) => `Also link every other outside sale recorded as “${name}”`;

/** Toast after linking: `Linked 1 sale to Jordan Reyes.` / `Linked 3 sales to Jordan Reyes.` */
export function linkedToast(count: number, accountName: string): string {
  if (count === 0) return `This sale was already linked to ${accountName}.`;
  return `Linked ${count} sale${count === 1 ? "" : "s"} to ${accountName}.`;
}
