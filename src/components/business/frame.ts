// Shared by the Business pages (server and client components alike).

/** The Business pages' frame: phone gutters; laptop `padding 28px 36px` on the 12-column grid. */
export const BUSINESS_MAIN =
  "mx-auto flex w-full max-w-[1200px] flex-col pb-[calc(96px+env(safe-area-inset-bottom))] laptop:px-9 laptop:pt-7 laptop:pb-16";

export const BUSINESS_PATH = "/admin/business";
export const STOCK_HREF = "/admin/inventory";
/** The record forms (V6 rebuilds them as A4 / A5 and the laptop drawers). */
export const SALE_HREF = "/admin/inventory/sale";
export const PURCHASE_HREF = "/admin/inventory/purchase";
/** The sales list with every filter and the per-seller totals (Ledger until V6 rebuilds it). */
export const SALES_HREF = "/admin/sales";
