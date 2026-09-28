// A4 Stock item and the A7 report body (the stock list is V5's A3 / D4:
// src/components/business/stock-screen.tsx): server-rendered views
// (no client state). Money arrives as exact decimal text from the service.
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
  SALES_NOTE,
  salesEmptyText,
  salesTruncatedNote,
  stockSalesTruncatedNote,
  usdConversionLine,
  vials,
} from "@/lib/inventory/screens";
import { BY_SELLER_TITLE, OUTSIDE_LINK_NOTE, OUTSIDE_TITLE, sellerLine, sellerRowEmail, sellerRowLabel } from "@/lib/inventory/seller-screens";
import type { SellerTotals } from "@/lib/inventory/sellers";
import type { BuyerAccount, SaleRecord, SalesReport, StockItemDetail } from "@/lib/inventory/service";
import { LinkSale } from "./link-sale";
import "@/styles/app/inventory.css";
import "@/styles/app/sellers.css";

export const PURCHASE_PATH = "/admin/inventory/purchase";
export const SALE_PATH = "/admin/inventory/sale";
export const stockItemPath = (id: string) => `/admin/inventory/${id}`;
const withItem = (path: string, id: string) => `${path}?item=${encodeURIComponent(id)}`;

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
          <Link href={withItem(PURCHASE_PATH, item.id)} className="app-btn app-btn--secondary app-btn--sm">
            Record purchase
          </Link>
          {item.onHand > 0 ? (
            <Link href={withItem(SALE_PATH, item.id)} className="app-btn app-btn--primary app-btn--sm">
              Record sale
            </Link>
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

/**
 * A7 below the filters: KPIs, the note, the empty state, the by-item rows,
 * the by-seller rows (Marco, 2026-09-27) and the sales list.
 */
export function SalesReportView({
  report,
  itemLabels,
  sellers,
  linkAccounts,
}: {
  report: SalesReport;
  itemLabels: Map<string, string>;
  /** Totals per seller for the same period and item. */
  sellers: SellerTotals[];
  linkAccounts?: BuyerAccount[];
}) {
  const empty = salesEmptyText(report);
  const { totals } = report;
  return (
    <>
      <div className="app-inv-kpis" data-testid="kpis">
        <Kpi label="Vials sold" value={totals.vials.toLocaleString("en-CA")} />
        <Kpi label="Revenue" value={<Money amount={totals.revenue} />} />
        <Kpi label="Cost of vials sold" value={<Money amount={totals.cost} />} />
        <Kpi label="Gross profit" value={<Money amount={totals.grossProfit} />} tone={profitTone(totals.grossProfit)} accent />
      </div>
      <p className="app-inv-note">{SALES_NOTE}</p>
      <p className="app-inv-note">
        <OutsideBuyersLink />
      </p>
      {empty ? (
        <div className="app-inv-empty">
          <EmptyState>{empty}</EmptyState>
        </div>
      ) : (
        <>
          <div className="app-inv-breakdown" data-testid="by-item">
            {report.byItem.map((row) => (
              <div key={row.stockItemId} className="app-inv-item-row">
                <b>{row.label}</b>
                <span className="app-inv-num app-inv-muted">{vials(row.vials)}</span>
                <span className="app-inv-num">
                  <Money amount={row.revenue} />
                </span>
                <span className="app-inv-num app-inv-muted">
                  <Money amount={row.cost} />
                </span>
                <span className="app-inv-num" data-tone={profitTone(row.grossProfit)}>
                  <Money amount={row.grossProfit} />
                </span>
              </div>
            ))}
          </div>
          <h2 className="app-inv-list-title">{BY_SELLER_TITLE}</h2>
          <div className="app-inv-breakdown" data-testid="by-seller">
            {sellers.map((row) => (
              <div key={row.sellerId ?? "none"} className="app-inv-item-row">
                <SellerCell row={row} rows={sellers} />
                <span className="app-inv-num app-inv-muted">{vials(row.vials)}</span>
                <span className="app-inv-num">
                  <Money amount={row.revenue} />
                </span>
                <span className="app-inv-num app-inv-muted">
                  <Money amount={row.cost} />
                </span>
                <span className="app-inv-num" data-tone={profitTone(row.grossProfit)}>
                  <Money amount={row.grossProfit} />
                </span>
              </div>
            ))}
          </div>
          <h2 className="app-inv-list-title">Sales in this view</h2>
          {report.salesTruncated ? <p className="app-inv-note">{salesTruncatedNote(report.sales.length)}</p> : null}
          <div data-testid="sales-list">
            {report.sales.map((sale) => (
              <SaleEntry key={sale.id} sale={sale} itemLabel={itemLabels.get(sale.stockItemId) ?? "—"} linkAccounts={linkAccounts} />
            ))}
          </div>
        </>
      )}
    </>
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

/** A7 "By seller" name, with the email under it when two sellers share the name (as A6's select does). */
function SellerCell({ row, rows }: { row: SellerTotals; rows: SellerTotals[] }) {
  const email = sellerRowEmail(row, rows);
  return (
    <span className="app-seller-cell">
      <b data-muted={row.sellerId === null || undefined}>{sellerRowLabel(row)}</b>
      {email ? (
        <span className="app-seller-email" data-testid="seller-email">
          {email}
        </span>
      ) : null}
    </span>
  );
}

/**
 * An A7 amount (money columns and KPIs): `CAD 480.00`. On phones the "CAD"
 * label is visually dropped (still read by screen readers) so amounts don't
 * wrap (Marco, 2026-09-26).
 */
function Money({ amount }: { amount: string }) {
  const text = formatCurrency(amount);
  if (!text.startsWith("CAD ")) return <>{text}</>;
  return (
    <>
      <span className="app-inv-cad">CAD </span>
      <span className="app-inv-amount">{text.slice(4)}</span>
    </>
  );
}

function Kpi({ label, value, tone, accent }: { label: string; value: React.ReactNode; tone?: string; accent?: boolean }) {
  return (
    <div>
      <div className="app-inv-kpi-label" data-accent={accent || undefined}>
        {label}
      </div>
      <div className="app-inv-kpi-value" data-tone={tone}>
        {value}
      </div>
    </div>
  );
}
