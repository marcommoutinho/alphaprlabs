// Copy and view helpers for sellers and buyer linking (Marco, 2026-09-27:
// "Sellers, admin invitations and buyer linking"): the A6 Seller select, the
// A7 "By seller" rows, a sale's seller line and "Link to account…". Pure: no
// database, no React. Admin screens only; no researcher screen names an
// admin or a seller.

export const SELLER_LABEL = "Seller";
export const BY_SELLER_TITLE = "By seller";
/** A7 row for sales recorded before sellers existed. */
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

/** A7 "By seller" row label. */
export const sellerRowLabel = (row: { sellerName: string | null }) => row.sellerName ?? NO_SELLER;

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
