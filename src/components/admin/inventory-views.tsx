// A4 Stock item, the page a Stock row opens (the stock list is V5's A3 / D4:
// src/components/business/stock-screen.tsx; sales and purchases are V6's
// Ledger), in design v3: on hand as the Now block's reading, then its
// purchase lots (FIFO order) and its sales (newest first). Server-rendered
// (no client state) but for the record and link sheets. Money arrives as
// exact decimal text from the service.
import Link from "@/components/alpha/link";
import { Button } from "@/components/alpha/button";
import { NowBlock, NowReading } from "@/components/alpha/now-block";
import { BackBar } from "@/components/alpha/back-bar";
import { BUSINESS_MAIN, OUTSIDE_HREF, STOCK_HREF } from "@/components/business/frame";
import { LinkSaleSheet } from "@/components/records/link-sheet";
import { RecordButton } from "@/components/records/record-provider";
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
import { cn } from "@/lib/utils";

export const stockItemPath = (id: string) => `/admin/inventory/${id}`;

/** A4 Stock item: on hand, its purchase lots (FIFO order) and its sales (newest first). */
export function StockItemView({ detail, linkAccounts }: { detail: StockItemDetail; linkAccounts?: BuyerAccount[] }) {
  const { item, lots, sales } = detail;
  return (
    <main className={BUSINESS_MAIN} data-testid="stock-item">
      <BackBar href={STOCK_HREF} label="Stock" />
      <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
        <div className="font-mono text-[13px] font-medium text-ink-3">Stock item</div>
        <h1 className="mt-0.5 text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] break-words">{item.label}</h1>
      </header>

      <div className="mx-3 mt-4 flex flex-col gap-3 laptop:mx-0 laptop:flex-row laptop:items-end laptop:gap-4">
        <NowBlock className="laptop:w-[360px]" aria-label="On hand">
          <NowReading
            size="m"
            value={
              <span data-testid="on-hand" data-zero={item.onHand === 0 || undefined}>
                {item.onHand}
              </span>
            }
            unit="vials on hand"
          />
        </NowBlock>
        <div className="flex gap-2 laptop:pb-1">
          <RecordButton kind="purchase" itemId={item.id} variant="outline" size="md" className="flex-1 laptop:flex-none">
            Record purchase
          </RecordButton>
          {item.onHand > 0 ? (
            <RecordButton kind="sale" itemId={item.id} variant="primary" size="md" className="flex-1 laptop:flex-none">
              Record sale
            </RecordButton>
          ) : (
            <Button variant="primary" size="md" className="flex-1 laptop:flex-none" disabled>
              Record sale
            </Button>
          )}
        </div>
      </div>

      <div className="mt-7 grid gap-7 laptop:grid-cols-2 laptop:gap-4">
        <section aria-labelledby="purchases-title" data-testid="purchases" className="min-w-0">
          <SectionHead id="purchases-title" title="Purchases" caption={PURCHASES_CAPTION} />
          {lots.length === 0 ? (
            <Empty>{NO_PURCHASES}</Empty>
          ) : (
            <Entries>
              {lots.map((lot) => (
                <div key={lot.id} className="flex items-start gap-3 px-4 py-3" data-testid="purchase-row">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] leading-5">
                      {formatDate(lot.receivedOn)} · <b className="font-semibold">{vials(lot.quantity)}</b> at {formatCurrency(lot.unitCost)}
                    </div>
                    {lot.usd ? (
                      <div className="mt-0.5 font-mono text-[12px] break-words text-ink-2" data-testid="purchase-conversion">
                        {usdConversionLine({ unitCost: lot.unitCost, usd: lot.usd })}
                      </div>
                    ) : null}
                    <div className="mt-0.5 text-[13px] text-ink-3" data-testid="lot-note">
                      {lotNote(lot)}
                    </div>
                  </div>
                  <span className="shrink-0 text-[15px] font-semibold whitespace-nowrap text-ink-2">{formatCurrency(lot.totalCost)}</span>
                </div>
              ))}
            </Entries>
          )}
        </section>
        <section aria-labelledby="sales-title" data-testid="sales" className="min-w-0">
          <SectionHead id="sales-title" title="Sales" caption={SALES_CAPTION} />
          {sales.length === 0 ? (
            <Empty>{NO_SALES}</Empty>
          ) : (
            <Entries>
              {sales.map((sale) => (
                <SaleEntry key={sale.id} sale={sale} linkAccounts={linkAccounts} />
              ))}
            </Entries>
          )}
          {detail.salesTruncated ? (
            <p className="mt-3 px-5 text-[13px] leading-[18px] text-ink-2 laptop:px-0">
              {stockSalesTruncatedNote(sales.length)} <OutsideBuyersLink />
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function SectionHead({ id, title, caption }: { id: string; title: string; caption: string }) {
  return (
    <div className="px-5 laptop:px-0">
      <h2 id={id} className="text-[20px] leading-6 font-semibold tracking-[-0.015em]">
        {title}
      </h2>
      <p className="mt-1 text-[13px] leading-[18px] text-ink-3">{caption}</p>
    </div>
  );
}

function Entries({ children }: { children: React.ReactNode }) {
  return <div className="mx-3 mt-3 divide-y divide-line overflow-hidden rounded-group border border-line bg-surface laptop:mx-0">{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mx-3 mt-3 rounded-group border-[1.5px] border-dashed border-ink-3 px-4 py-4 text-[15px] leading-5 text-ink-2 laptop:mx-0">{children}</p>;
}

/**
 * One sale: `Sep 26, 2026 · 12 vials · Jordan Reyes (account)` and revenue,
 * then `Cost CAD 250.00 (10 × CAD 20.00 + 2 × CAD 25.00) · gross profit CAD 230.00`.
 * With accounts given, an outside buyer's sale offers "Link to account…".
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
  const tone = profitTone(sale.grossProfit);
  return (
    <div className="px-4 py-3" data-testid="sale-row">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1 text-[15px] leading-5">
          {formatDate(sale.soldOn)} ·{" "}
          {itemLabel ? (
            <>
              <b className="font-semibold">{itemLabel}</b> · {vials(sale.quantity)}
            </>
          ) : (
            <b className="font-semibold">{vials(sale.quantity)}</b>
          )}{" "}
          · <span data-testid="sale-buyer">{buyerLabel(sale)}</span>
        </span>
        <span className="shrink-0 text-[15px] font-semibold whitespace-nowrap">{formatCurrency(sale.revenue)}</span>
      </div>
      <div className="mt-0.5 text-[13px] leading-[18px] text-ink-2">
        Cost {formatCurrency(sale.cost)} ({allocationSummary(sale.allocations)}) · gross profit{" "}
        <span data-tone={tone} className={cn(tone === "negative" && "text-missed")}>
          {formatCurrency(sale.grossProfit)}
        </span>{" "}
        · <span data-testid="sale-seller">{sellerLine(sale)}</span>
      </div>
      {linkAccounts && sale.buyerType === "outside" ? (
        <div className="mt-2">
          <LinkSaleSheet saleId={sale.id} buyerName={sale.buyerName} accounts={linkAccounts} />
        </div>
      ) : null}
    </div>
  );
}

/** `Find a past outside buyer's sales to link them to an account: Outside buyers` (every one, however old). */
function OutsideBuyersLink() {
  return (
    <>
      {OUTSIDE_LINK_NOTE}{" "}
      <Link href={OUTSIDE_HREF} className="font-semibold text-signal-ink">
        {OUTSIDE_TITLE}
      </Link>
    </>
  );
}
