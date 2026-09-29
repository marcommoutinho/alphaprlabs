// The stock item page (the stock list is V5's A3 / D4:
// src/components/business/stock-screen.tsx; sales and purchases are V6's
// Ledger): server-rendered views (no client state). Money arrives as exact
// decimal text from the service.
import Link from "@/components/alpha/link";
import { AppButton, EmptyState } from "@/components/app-shell/form";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  allocationSummary,
  buyerLabel,
  lotNote,
  NO_PURCHASES,
  NO_SALES,
  profitTone,
  PURCHASES_CAPTION,
  SALES_CAPTION,
  stockSalesTruncatedNote,
  usdConversionLine,
  vials,
} from "@/lib/inventory/screens";
import { OUTSIDE_LINK_NOTE, OUTSIDE_TITLE, sellerLine } from "@/lib/inventory/seller-screens";
import type { BuyerAccount, SaleRecord, StockItemDetail } from "@/lib/inventory/service";
import { RecordButton } from "@/components/records/record-provider";
import { LinkSale } from "./link-sale";
import "@/styles/app/inventory.css";
import "@/styles/app/sellers.css";

export const stockItemPath = (id: string) => `/admin/inventory/${id}`;

/** A4 Stock item: on hand, its purchase lots (FIFO order) and its sales (newest first). */
export function StockItemView({ detail, linkAccounts }: { detail: StockItemDetail; linkAccounts?: BuyerAccount[] }) {
  const { item, lots, sales } = detail;
  return (
    <>
      <Link href="/admin/inventory" className="app-inv-back">
        ‹ Stock
      </Link>
      <div className="app-inv-head">
        <div>
          <h1 className="app-h1">{item.label}</h1>
          <div className="app-inv-hero">
            <span className="app-inv-hero-number" data-testid="on-hand" data-zero={item.onHand === 0 || undefined}>
              {item.onHand}
            </span>
            <span className="app-inv-hero-label">vials on hand</span>
          </div>
        </div>
        <div className="app-inv-actions">
          <RecordButton kind="purchase" itemId={item.id} variant="outline" size="sm" className="rounded-[12px] text-[14px]">
            Record purchase
          </RecordButton>
          {item.onHand > 0 ? (
            <RecordButton kind="sale" itemId={item.id} variant="primary" size="sm" className="rounded-[12px] text-[14px]">
              Record sale
            </RecordButton>
          ) : (
            <AppButton size="sm" disabled>
              Record sale
            </AppButton>
          )}
        </div>
      </div>

      <div className="app-inv-columns">
        <section className="app-inv-section" aria-labelledby="purchases-title" data-testid="purchases">
          <h2 id="purchases-title" className="app-inv-section-title">
            Purchases
          </h2>
          <p className="app-inv-caption">{PURCHASES_CAPTION}</p>
          {lots.length === 0 ? <EmptyState>{NO_PURCHASES}</EmptyState> : null}
          {lots.map((lot) => (
            <div key={lot.id} className="app-inv-entry" data-testid="purchase-row">
              <div className="app-inv-entry-line">
                <div>
                  {formatDate(lot.receivedOn)} · <b>{vials(lot.quantity)}</b> at {formatCurrency(lot.unitCost)}
                  {lot.usd ? (
                    <div className="app-inv-sub" data-testid="purchase-conversion">
                      {usdConversionLine({ unitCost: lot.unitCost, usd: lot.usd })}
                    </div>
                  ) : null}
                  <div className="app-inv-sub">{lotNote(lot)}</div>
                </div>
                <span className="app-inv-entry-amount" data-muted>
                  {formatCurrency(lot.totalCost)}
                </span>
              </div>
            </div>
          ))}
        </section>
        <section className="app-inv-section" aria-labelledby="sales-title" data-testid="sales">
          <h2 id="sales-title" className="app-inv-section-title">
            Sales
          </h2>
          <p className="app-inv-caption">{SALES_CAPTION}</p>
          {sales.length === 0 ? <EmptyState>{NO_SALES}</EmptyState> : null}
          {sales.map((sale) => (
            <SaleEntry key={sale.id} sale={sale} linkAccounts={linkAccounts} />
          ))}
          {detail.salesTruncated ? (
            <p className="app-inv-note">
              {stockSalesTruncatedNote(sales.length)} <OutsideBuyersLink />
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}

/**
 * One sale: `Sep 26, 2026 · 12 vials · Jordan Reyes (account)` and revenue,
 * then `Cost CAD 250.00 (10 × CAD 20.00 + 2 × CAD 25.00) · gross profit CAD 230.00`.
 * A7 adds the item label.
 */
export function SaleEntry({
  sale,
  itemLabel,
  linkAccounts,
}: {
  sale: SaleRecord;
  itemLabel?: string;
  /** The accounts an outside buyer's sale can be linked to ("Link to account…"); none: no link control. */
  linkAccounts?: BuyerAccount[];
}) {
  return (
    <div className="app-inv-entry" data-testid="sale-row">
      <div className="app-inv-entry-line">
        <span>
          {formatDate(sale.soldOn)} ·{" "}
          {itemLabel ? (
            <>
              <b>{itemLabel}</b> · {vials(sale.quantity)}
            </>
          ) : (
            <b>{vials(sale.quantity)}</b>
          )}{" "}
          · <span data-testid="sale-buyer">{buyerLabel(sale)}</span>
        </span>
        <span className="app-inv-entry-amount">{formatCurrency(sale.revenue)}</span>
      </div>
      <div className="app-inv-sub">
        Cost {formatCurrency(sale.cost)} ({allocationSummary(sale.allocations)}) · gross profit{" "}
        <span data-tone={profitTone(sale.grossProfit)}>{formatCurrency(sale.grossProfit)}</span> ·{" "}
        <span data-testid="sale-seller">{sellerLine(sale)}</span>
      </div>
      {linkAccounts && sale.buyerType === "outside" ? (
        <LinkSale saleId={sale.id} buyerName={sale.buyerName} accounts={linkAccounts} />
      ) : null}
    </div>
  );
}

/** `Find a past outside buyer's sales to link them to an account: Outside buyers` (every one, however old). */
function OutsideBuyersLink() {
  return (
    <>
      {OUTSIDE_LINK_NOTE}{" "}
      <Link href="/admin/sales/outside" className="app-seller-outside-link">
        {OUTSIDE_TITLE}
      </Link>
    </>
  );
}
