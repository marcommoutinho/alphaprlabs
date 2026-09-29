// Shared by the Business pages (server and client components alike).

/** The Business pages' frame: phone gutters; laptop `padding 28px 36px` on the 12-column grid. */
export const BUSINESS_MAIN =
  "mx-auto flex w-full max-w-[1200px] flex-col pb-[calc(96px+env(safe-area-inset-bottom))] laptop:px-9 laptop:pt-7 laptop:pb-16";

export const BUSINESS_PATH = "/admin/business";
export const STOCK_HREF = "/admin/inventory";
/** A7 / A14 / D5 Ledger: every sale and purchase, by day or month (V6). */
export const LEDGER_HREF = "/admin/ledger";
/** "All sales": the Ledger's Sales tab. */
export const SALES_HREF = LEDGER_HREF;
/** The Ledger's Purchases tab. */
export const PURCHASES_HREF = `${LEDGER_HREF}?tab=purchases`;
/** Outside buyers' sales, to link to an account. */
export const OUTSIDE_HREF = "/admin/sales/outside";
