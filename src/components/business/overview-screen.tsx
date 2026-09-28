import { ArrowDownRight, ArrowUpRight, Minus, Plus } from "lucide-react";
import Link from "@/components/alpha/link";
import { buttonVariants } from "@/components/alpha/button-variants";
import { NowBlock } from "@/components/alpha/now-block";
import { StateGlyph } from "@/components/alpha/state-glyph";
import { money } from "@/lib/alpha/format";
import { initialsOf } from "@/lib/app/identity";
import type { OverviewData } from "@/lib/business/load";
import {
  bestDayLine,
  buyerShort,
  changeWords,
  ordersLabel,
  sellerFirst,
  sellerShort,
  type Change,
  type MonthRow,
  type PeriodOverview,
  type TwelveMonths,
} from "@/lib/business/overview";
import { monthDayLabel, periodHeader, type Period } from "@/lib/business/period";
import type { StockLevel } from "@/lib/business/service";
import { lowItems, reorderLine, stockTotals, vialCount } from "@/lib/business/stock";
import { NO_SELLER } from "@/lib/inventory/seller-screens";
import type { SellerTotals } from "@/lib/inventory/sellers";
import type { SaleRecord } from "@/lib/inventory/service";
import { cn } from "@/lib/utils";
import { DayBars, MonthAxis, MonthBars, MonthLegend, PurchaseBars, ShareBar, SplitBar, Swatch } from "./charts";
import { BUSINESS_MAIN, PURCHASE_HREF, SALE_HREF, SALES_HREF, STOCK_HREF } from "./frame";
import { MonthByMonth } from "./month-by-month";
import { PeriodControl } from "./period-control";
import { StockNavCount } from "./stock-nav-count";

const ON_INK_LINE = "border-[color:color-mix(in_oklab,currentColor_12%,transparent)]";

/** An amount, `missed` with its minus sign when negative (gross profit); money is otherwise ink. */
function Money({ amount, onInk = false, className }: { amount: string; onInk?: boolean; className?: string }) {
  const text = money(amount);
  const negative = text.startsWith("−");
  return (
    <span data-negative={negative || undefined} className={cn(negative && (onInk ? "text-on-ink-missed" : "text-missed"), className)}>
      {text}
    </span>
  );
}

/**
 * A1 / A2 / A13 / D9 Business overview (admins only). The phone and laptop
 * layouts differ in arrangement (lists become tables, the Now block gains
 * the revenue chart), so each is its own tree, shown at its width.
 */
export function OverviewScreen({
  data,
  period,
  today,
  admin,
}: {
  data: OverviewData;
  period: Period;
  today: string;
  admin: { name: string };
}) {
  const low = lowItems(data.stock);
  return (
    <main className={BUSINESS_MAIN} data-testid="business" data-period={period.kind}>
      <StockNavCount low={low.length} />
      <PhoneHeader admin={admin} period={period} today={today} />
      <LaptopHeader period={period} today={today} />
      {data.kind === "period" ? (
        <>
          <PeriodPhone overview={data.overview} stock={data.stock} low={low} recent={data.recent} sellers={data.sellers} />
          <PeriodLaptop overview={data.overview} stock={data.stock} low={low} recent={data.recent} sellers={data.sellers} />
        </>
      ) : (
        <>
          <TwelvePhone view={data.months} />
          <TwelveLaptop view={data.months} />
        </>
      )}
    </main>
  );
}

// ── Headers ─────────────────────────────────────────────────────────────────

function PhoneHeader({ admin, period, today }: { admin: { name: string }; period: Period; today: string }) {
  const first = admin.name.trim().split(/\s+/)[0] || admin.name;
  return (
    <header className="px-5 pt-2 laptop:hidden" data-testid="business-header-phone">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[13px] font-medium text-ink-3">
          {period.kind === "12m" ? periodHeader(period) : `Admin · ${first}`}
        </span>
        <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-sunken text-[13px] font-semibold">
          {initialsOf(admin.name)}
        </span>
      </div>
      <h1 className="mt-0.5 text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">Business</h1>
      <PeriodControl period={period} today={today} className="mt-3.5" />
    </header>
  );
}

function LaptopHeader({ period, today }: { period: Period; today: string }) {
  return (
    <header className="hidden items-end gap-4 laptop:flex" data-testid="business-header-laptop">
      <div>
        <div className="font-mono text-[13px] font-medium text-ink-3">{periodHeader(period)}</div>
        <h1 className="mt-0.5 text-[34px] leading-[1.1] font-semibold tracking-[-0.03em]">Overview</h1>
      </div>
      <PeriodControl period={period} today={today} className="ml-auto" />
      {period.kind === "12m" ? (
        <a href="/admin/business/export" download className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-[12px] text-[14px]")}>
          Export CSV
        </a>
      ) : (
        <>
          <Link href={PURCHASE_HREF} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-[12px] text-[14px]")}>
            Record purchase
          </Link>
          <Link href={SALE_HREF} className={cn(buttonVariants({ variant: "primary", size: "sm" }), "rounded-[12px] text-[14px]")}>
            Record sale
          </Link>
        </>
      )}
    </header>
  );
}

// ── A1: a period on the phone ───────────────────────────────────────────────

function NowRows({ overview }: { overview: PeriodOverview }) {
  const t = overview.totals;
  return (
    <div className="mt-3.5 flex flex-col text-[15px]" data-testid="now-rows">
      <div className={cn("flex items-center gap-2.5 border-b py-2", ON_INK_LINE)}>
        <span className="flex-1 text-on-ink-soft">Revenue</span>
        <span className="font-semibold">{money(t.revenue)}</span>
      </div>
      <div className={cn("flex items-center gap-2.5 border-b py-2", ON_INK_LINE)}>
        <Swatch kind="cost" />
        <span className="flex-1 text-on-ink-soft">Cost of stock sold</span>
        <span className="font-semibold">{money(`-${t.cost}`)}</span>
      </div>
      <div className="flex items-center gap-2.5 pt-2">
        <Swatch kind="profit" />
        <span className="flex-1 text-on-ink-soft">Gross profit</span>
        <Money amount={t.grossProfit} onInk className="font-semibold" />
      </div>
    </div>
  );
}

function marginLine(overview: PeriodOverview) {
  return overview.margin ? `${overview.margin} of revenue` : "No sales in this period";
}

function GrossReading({ overview, size }: { overview: PeriodOverview; size: 52 | 56 }) {
  return (
    <div className="mt-2.5 flex items-baseline gap-2">
      <Money
        amount={overview.totals.grossProfit}
        onInk
        className={cn("leading-none font-semibold tracking-[-0.045em]", size === 52 ? "text-[52px]" : "text-[56px]")}
      />
      <span className="font-mono text-[15px] text-on-ink-2">CAD</span>
    </div>
  );
}

function PeriodPhone({
  overview,
  stock,
  low,
  recent,
  sellers,
}: {
  overview: PeriodOverview;
  stock: StockLevel[];
  low: StockLevel[];
  recent: SaleRecord[];
  sellers: SellerTotals[];
}) {
  const t = overview.totals;
  const held = stockTotals(stock);
  const labels = new Map(stock.map((item) => [item.id, item.label]));
  return (
    <div className="flex flex-col laptop:hidden" data-testid="period-phone">
      <NowBlock className="mx-3 mt-4 pb-[18px]" aria-label="Gross profit" data-testid="now">
        <div className="flex items-baseline justify-between text-[13px] text-on-ink-2">
          <span>Gross profit</span>
          <span className="font-mono text-[12px] font-medium">{vialCount(t.vials)} sold</span>
        </div>
        <GrossReading overview={overview} size={52} />
        <div className="mt-1.5 text-[14px] text-on-ink-2" data-testid="margin">
          {marginLine(overview)}
        </div>
        <SplitBar profitShare={overview.profitShare} className="mt-[18px]" />
        <NowRows overview={overview} />
      </NowBlock>

      <div className="mx-3 mt-3 grid grid-cols-2 gap-2">
        <Link href={SALE_HREF} className={cn(buttonVariants({ variant: "primary", size: "lg" }), "gap-1.5 text-base")}>
          <Plus className="size-[18px]" aria-hidden />
          Record sale
        </Link>
        <Link href={PURCHASE_HREF} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "text-base")}>
          Record purchase
        </Link>
      </div>

      <div className="mx-3 mt-3 grid grid-cols-2 gap-2">
        <Tile label="Stock value" value={money(held.value)} context={`${vialCount(held.vials)} at cost`} testId="tile-stock" />
        <Tile
          label="Vials sold"
          value={t.vials.toLocaleString("en-CA")}
          context={overview.avgPrice ? `avg ${money(overview.avgPrice)} each` : "none sold"}
          testId="tile-sold"
        />
      </div>

      <section className="mx-3 mt-3 rounded-group border border-line bg-surface px-4 py-3.5" aria-label="Revenue by day">
        <div className="flex justify-between text-[13px] font-medium text-ink-2">
          <h2>Revenue by day</h2>
          <span className="font-mono text-[12px] text-ink-3" data-testid="best-day">
            {bestDayLine(overview)}
          </span>
        </div>
        <DayBars days={overview.days} label={`Revenue by day, ${bestDayLine(overview)}`} className="mt-3 h-24" />
        <div className="mt-1.5 flex justify-between font-mono text-[12px] font-medium text-ink-3">
          <span>{overview.axis[0]}</span>
          <span>{overview.axis[1]}</span>
        </div>
      </section>

      <LowStockPhone low={low} />

      <SectionHeader title="Recent sales" link={{ href: SALES_HREF, label: "All sales" }} className="mb-1" />
      <div className="mx-5 flex flex-col divide-y divide-line" data-testid="recent-sales">
        {recent.length === 0 ? <p className="py-3 text-[15px] text-ink-2">No sales recorded yet.</p> : null}
        {recent.map((sale) => (
          <div key={sale.id} className="flex items-center gap-3 py-3" data-testid="recent-sale">
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">
                {labels.get(sale.stockItemId) ?? "Stock item"} × {sale.quantity}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[12px] text-ink-3">
                {monthDayLabel(sale.soldOn)} · {sellerShort(sale.sellerName)} → {sale.buyerName}
              </span>
            </span>
            <span className="text-[15px] font-semibold">{money(sale.revenue)}</span>
          </div>
        ))}
      </div>

      <SellersPhone sellers={sellers} />
    </div>
  );
}

function Tile({ label, value, context, testId, tone }: { label: string; value: string; context: string; testId?: string; tone?: "low" }) {
  return (
    <div
      data-testid={testId}
      className={cn("rounded-group px-4 py-3.5", tone === "low" ? "bg-low-tint" : "border border-line bg-surface")}
    >
      <div className={cn("text-[13px]", tone === "low" ? "font-semibold text-low" : "font-medium text-ink-2")}>{label}</div>
      <div className="mt-2 text-[24px] leading-tight font-semibold tracking-[-0.025em] laptop:text-[23px]">{value}</div>
      <div className={cn("mt-0.5 text-[12px] laptop:text-[13px]", tone === "low" ? "text-low" : "text-ink-3")}>{context}</div>
    </div>
  );
}

function SectionHeader({
  title,
  count,
  link,
  className,
}: {
  title: string;
  count?: number;
  link?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={cn("mx-5 mt-7 mb-2 flex items-baseline justify-between", className)}>
      <h2 className="text-[20px] font-semibold tracking-[-0.015em]">
        {title}
        {count !== undefined ? <span className="ml-1.5 font-mono text-[14px] font-medium text-low">{count}</span> : null}
      </h2>
      {link ? (
        <Link href={link.href} className="text-[15px] font-semibold">
          {link.label}
        </Link>
      ) : null}
    </div>
  );
}

function LowStockPhone({ low }: { low: StockLevel[] }) {
  const shown = low.slice(0, 5);
  return (
    <>
      <SectionHeader title="Low stock" count={low.length} link={{ href: STOCK_HREF, label: "Stock" }} />
      <div className="mx-3 divide-y divide-line overflow-hidden rounded-group border border-line bg-surface" data-testid="low-stock">
        {low.length === 0 ? <p className="px-4 py-3.5 text-[15px] text-ink-2">Nothing is below its reorder level.</p> : null}
        {shown.map((item) => (
          <div key={item.id} className="flex items-center gap-3 px-4 py-3" data-testid="low-row">
            <StateGlyph state="low" className="[&>i:not(:last-child)]:bg-line" />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold">{item.label}</span>
              <span className="mt-px block text-[13px] font-semibold text-low">{reorderLine(item.threshold)}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="text-[22px] font-semibold">{item.onHand.toLocaleString("en-CA")}</span>{" "}
              <span className="font-mono text-[13px] font-medium text-ink-2">{item.onHand === 1 ? "vial" : "vials"}</span>
            </span>
          </div>
        ))}
        {low.length > shown.length ? (
          <Link href={`${STOCK_HREF}?filter=low`} className="block px-4 py-3 text-[15px] font-semibold">
            {low.length - shown.length} more low
          </Link>
        ) : null}
      </div>
    </>
  );
}

/** Per-seller totals for the period (the existing A7 feature, kept on the overview; the Ledger has them per item too). */
function SellersPhone({ sellers }: { sellers: SellerTotals[] }) {
  if (sellers.length === 0) return null;
  return (
    <>
      <SectionHeader title="By seller" className="mb-1" />
      <div className="mx-5 flex flex-col divide-y divide-line" data-testid="by-seller">
        {sellers.map((row) => (
          <div key={row.sellerId ?? "none"} className="flex items-center gap-3 py-3" data-testid="seller-row">
            <span className="min-w-0 flex-1">
              <span className={cn("block text-[15px] font-semibold", !row.sellerName && "text-ink-2")}>{row.sellerName ?? NO_SELLER}</span>
              <span className="mt-0.5 block font-mono text-[12px] text-ink-3">
                {vialCount(row.vials)} · rev {money(row.revenue)}
              </span>
            </span>
            <span className="text-right">
              <Money amount={row.grossProfit} className="block text-[15px] font-semibold" />
              <span className="block font-mono text-[12px] text-ink-3">GP</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

// ── A2: a period on a laptop ────────────────────────────────────────────────

function PeriodLaptop({
  overview,
  stock,
  low,
  recent,
  sellers,
}: {
  overview: PeriodOverview;
  stock: StockLevel[];
  low: StockLevel[];
  recent: SaleRecord[];
  sellers: SellerTotals[];
}) {
  const t = overview.totals;
  const held = stockTotals(stock);
  const labels = new Map(stock.map((item) => [item.id, item.label]));
  const smallest = low.reduce((min, item) => Math.min(min, item.threshold), Infinity);
  return (
    <div className="mt-5 hidden grid-cols-12 gap-4 laptop:grid" data-testid="period-laptop">
      <NowBlock className="col-span-8 grid grid-cols-[minmax(0,1fr)_210px] gap-7 px-6 py-[22px]" aria-label="Gross profit">
        <div className="flex flex-col">
          <span className="text-[13px] text-on-ink-2">Gross profit</span>
          <GrossReading overview={overview} size={56} />
          <div className="mt-1.5 text-[14px] text-on-ink-2">
            {marginLine(overview)} · {vialCount(t.vials)} sold
          </div>
          <SplitBar profitShare={overview.profitShare} className="mt-auto pt-0" />
          <div className="mt-3.5 grid grid-cols-3 gap-3 text-[14px]">
            <span>
              <span className="block text-[13px] text-on-ink-2">Revenue</span>
              <b className="text-[17px] font-semibold">{money(t.revenue)}</b>
            </span>
            <span>
              <span className="block text-[13px] text-on-ink-2">Cost of stock</span>
              <b className="text-[17px] font-semibold">{money(t.cost)}</b>
            </span>
            <span>
              <span className="block text-[13px] text-on-ink-2">Gross profit</span>
              <Money amount={t.grossProfit} onInk className="text-[17px] font-semibold" />
            </span>
          </div>
        </div>
        <div className="flex flex-col">
          <div className="flex justify-between text-[13px] text-on-ink-2">
            <span>Revenue by day</span>
            <span className="font-mono text-[12px]">{overview.best ? `max ${money(overview.max, 0)}` : "no sales"}</span>
          </div>
          <DayBars days={overview.days} onInk label={`Revenue by day, ${bestDayLine(overview)}`} className="mt-3 min-h-[150px] flex-1" />
          <div className="mt-1.5 flex justify-between font-mono text-[12px] font-medium text-on-ink-2">
            <span>{overview.axis[0]}</span>
            <span>{monthDayLabel(overview.period.to)}</span>
          </div>
        </div>
      </NowBlock>

      <div className="col-span-4 grid grid-cols-2 gap-3">
        <Tile
          label="Revenue"
          value={money(t.revenue)}
          context={overview.avgPrice ? `${vialCount(t.vials)} · avg ${money(overview.avgPrice)}` : "no vials sold"}
        />
        <Tile label="Cost of stock sold" value={money(t.cost)} context="oldest stock first" />
        <Tile label="Stock value" value={money(held.value)} context={`${vialCount(held.vials)} at cost`} testId="tile-stock-laptop" />
        {low.length > 0 ? (
          <Tile
            label="Low stock"
            value={`${low.length} ${low.length === 1 ? "item" : "items"}`}
            context={low.every((item) => item.threshold === smallest) ? `under ${smallest} vials each` : "under their reorder levels"}
            tone="low"
          />
        ) : (
          <Tile label="Low stock" value="0 items" context="all at reorder level or above" />
        )}
      </div>

      <section className="col-span-5 rounded-group border border-line bg-surface px-5 py-4" aria-label="Low stock">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[16px] font-semibold">Low stock</h2>
          <Link href={STOCK_HREF} className="text-[14px] font-semibold">
            All stock
          </Link>
        </div>
        <table className="mt-3 w-full text-[14px]" data-testid="low-stock-table">
          <thead>
            <tr className="border-b border-line text-[12px] text-ink-3">
              <th className="pb-1.5 text-left font-normal">Item</th>
              <th className="w-[70px] pb-1.5 text-right font-normal">On hand</th>
              <th className="w-[90px] pb-1.5 text-right font-normal">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {low.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-3 text-ink-2">
                  Nothing is below its reorder level.
                </td>
              </tr>
            ) : null}
            {low.slice(0, 6).map((item) => (
              <tr key={item.id}>
                <td className="py-[11px] font-semibold">{item.label}</td>
                <td className="py-[11px] text-right font-semibold text-low">{item.onHand}</td>
                <td className="py-[11px] text-right text-ink-2">{money(item.valueAtCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="col-span-7 rounded-group border border-line bg-surface px-5 py-4" aria-label="Recent sales">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[16px] font-semibold">Recent sales</h2>
          <Link href={SALES_HREF} className="text-[14px] font-semibold">
            All sales
          </Link>
        </div>
        <table className="mt-3 w-full table-fixed text-[14px]" data-testid="recent-sales-table">
          <thead>
            <tr className="border-b border-line text-[12px] text-ink-3">
              <th className="w-[60px] pb-1.5 text-left font-normal">Date</th>
              <th className="pb-1.5 text-left font-normal">Item</th>
              <th className="w-[40px] pb-1.5 text-right font-normal">Qty</th>
              <th className="pb-1.5 pl-2 text-left font-normal">Seller → buyer</th>
              <th className="w-[90px] pb-1.5 text-right font-normal">Revenue</th>
              <th className="w-[100px] pb-1.5 text-right font-normal">Gross profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {recent.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-3 text-ink-2">
                  No sales recorded yet.
                </td>
              </tr>
            ) : null}
            {recent.map((sale) => (
              <tr key={sale.id}>
                <td className="py-[11px] font-mono text-[13px] text-ink-2">{monthDayLabel(sale.soldOn)}</td>
                <td className="truncate py-[11px] font-semibold">{labels.get(sale.stockItemId) ?? "Stock item"}</td>
                <td className="py-[11px] text-right">{sale.quantity}</td>
                <td className="truncate py-[11px] pl-2 text-ink-2">
                  {sellerFirst(sale.sellerName)} → {buyerShort(sale.buyerName)}
                </td>
                <td className="py-[11px] text-right">{money(sale.revenue)}</td>
                <td className="py-[11px] text-right font-semibold">
                  <Money amount={sale.grossProfit} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {sellers.length > 0 ? (
        <section className="col-span-12 rounded-group border border-line bg-surface px-5 py-4" aria-label="By seller">
          <h2 className="text-[16px] font-semibold">By seller</h2>
          <table className="mt-3 w-full text-[14px]" data-testid="by-seller-table">
            <thead>
              <tr className="border-b border-line text-[12px] text-ink-3">
                <th className="pb-1.5 text-left font-normal">Seller</th>
                <th className="pb-1.5 text-right font-normal">Vials</th>
                <th className="pb-1.5 text-right font-normal">Revenue</th>
                <th className="pb-1.5 text-right font-normal">Cost</th>
                <th className="pb-1.5 text-right font-normal">Gross profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sellers.map((row) => (
                <tr key={row.sellerId ?? "none"}>
                  <td className={cn("py-[11px] font-semibold", !row.sellerName && "text-ink-2")}>{row.sellerName ?? NO_SELLER}</td>
                  <td className="py-[11px] text-right">{row.vials}</td>
                  <td className="py-[11px] text-right">{money(row.revenue)}</td>
                  <td className="py-[11px] text-right text-ink-2">{money(row.cost)}</td>
                  <td className="py-[11px] text-right font-semibold">
                    <Money amount={row.grossProfit} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

// ── A13 / D9: 12 months ─────────────────────────────────────────────────────

const ARROWS = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

function ChangeArrow({ change, className }: { change: Change; className?: string }) {
  const Icon = ARROWS[change.direction];
  return <Icon className={cn("shrink-0", className)} aria-hidden />;
}

function TwelveNow({ view, laptop }: { view: TwelveMonths; laptop: boolean }) {
  const c = view.current;
  return (
    <>
      <div className="flex items-baseline justify-between text-[13px] text-on-ink-2">
        <span>Gross profit · {c.name} to date</span>
        {laptop ? null : <span className="font-mono text-[12px] font-medium">{vialCount(c.vials)}</span>}
      </div>
      <div className="mt-2.5 flex items-baseline gap-2">
        <Money
          amount={c.grossProfit}
          onInk
          className={cn("leading-none font-semibold tracking-[-0.045em]", laptop ? "text-[46px]" : "text-[52px]")}
        />
        <span className="font-mono text-[15px] text-on-ink-2">CAD</span>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 text-[15px] font-semibold" data-testid="same-days-change">
        <ChangeArrow change={c.change} className="size-4" />
        {changeWords(c.change)}
        {laptop ? null : (
          <span className="font-normal text-on-ink-2">
            vs {c.vsLabel} ({money(c.previousGrossProfit)})
          </span>
        )}
      </div>
      {laptop ? (
        <div className="mt-0.5 text-[13px] text-on-ink-2">
          vs {c.vsLabel} · {money(c.previousGrossProfit)}
        </div>
      ) : null}
    </>
  );
}

function TwelvePhone({ view }: { view: TwelveMonths }) {
  return (
    <div className="flex flex-col laptop:hidden" data-testid="twelve-phone">
      <NowBlock className="mx-3 mt-4 pb-[18px]" aria-label={`Gross profit, ${view.current.name} to date`} data-testid="now">
        <TwelveNow view={view} laptop={false} />
        <div className={cn("mt-4 grid grid-cols-2 gap-3 border-t pt-3.5 text-[14px]", ON_INK_LINE)}>
          <span>
            <span className="block text-[12px] text-on-ink-2">12-month gross profit</span>
            <Money amount={view.totals.grossProfit} onInk className="text-[18px] font-semibold" />
          </span>
          <span>
            <span className="block text-[12px] text-on-ink-2">12-month purchases</span>
            <b className="text-[18px] font-semibold">{money(view.totals.purchases)}</b>
          </span>
        </div>
      </NowBlock>

      <section className="mx-3 mt-3 rounded-group border border-line bg-surface px-4 py-3.5" aria-label="Sales by month">
        <div className="flex justify-between text-[13px] font-medium text-ink-2">
          <h2>Sales by month</h2>
          <span className="font-mono text-[12px] text-ink-3">{view.best ? `best ${view.best.label} · ${money(view.best.revenue)}` : "no sales yet"}</span>
        </div>
        <MonthBars months={view.months} gap={5} className="mt-3 h-[120px]" />
        <MonthAxis months={view.months} style="initial" />
        <MonthLegend current={view.months[view.months.length - 1].label} />
      </section>

      <section className="mx-3 mt-3 rounded-group border border-line bg-surface px-4 py-3.5" aria-label="Supplier purchases by month">
        <div className="flex justify-between text-[13px] font-medium text-ink-2">
          <h2>Supplier purchases by month</h2>
          {view.noPurchases ? <span className="font-mono text-[12px] text-ink-3">{view.noPurchases}</span> : null}
        </div>
        <PurchaseBars months={view.months} gap={5} className="mt-3 h-16" />
        <MonthAxis months={view.months} style="initial" />
      </section>

      <div className="mx-5 mt-7 mb-0.5 flex items-baseline justify-between">
        <h2 className="text-[20px] font-semibold tracking-[-0.015em]">Month by month</h2>
        <span className="text-[13px] text-ink-3">Gross profit · change</span>
      </div>
      <MonthByMonth rows={[...view.months].reverse().map((m) => monthRowProps(m, view))} />

      <div className="mx-5 mt-7 mb-0.5 flex items-baseline justify-between">
        <h2 className="text-[20px] font-semibold tracking-[-0.015em]">Purchases by supplier</h2>
        <span className="text-[13px] text-ink-3">12 months</span>
      </div>
      <Suppliers view={view} phone />
    </div>
  );
}

/** A month-by-month row's text, prepared on the server (the list is a client component for "Show all"). */
function monthRowProps(m: MonthRow, view: TwelveMonths) {
  return {
    month: m.month,
    name: m.name,
    current: m.current,
    grossProfit: money(m.grossProfit),
    negative: money(m.grossProfit).startsWith("−"),
    meta: `${vialCount(m.vials)} · rev ${money(m.revenue)} · bought ${money(m.purchases)}`,
    change: { direction: m.change.direction, amount: money(m.change.amount) },
    vs: m.current ? `vs ${view.current.vsLabel}` : null,
  };
}

function Suppliers({ view, phone }: { view: TwelveMonths; phone: boolean }) {
  if (view.suppliers.length === 0) {
    return <p className={cn("py-3 text-[15px] text-ink-2", phone ? "mx-5" : "")}>No purchases in these 12 months.</p>;
  }
  return (
    <div className={cn("flex flex-col divide-y divide-line", phone ? "mx-5" : "mt-1")} data-testid="suppliers">
      {view.suppliers.map((s) => (
        <div key={s.name ?? ""} className={phone ? "py-3" : "py-2.5"} data-testid="supplier-row">
          <div className={cn("flex items-baseline justify-between", phone ? "text-[15px]" : "text-[14px]")}>
            <span className={cn("font-semibold", s.name === null && "text-ink-2")}>{s.name ?? "No supplier recorded"}</span>
            <span className="font-semibold">{money(s.total)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2.5">
            <ShareBar share={s.share} muted={s.name === null} />
            <span className={cn("text-right font-mono text-[12px] font-medium text-ink-3", phone && "w-[120px]")}>
              {[phone ? s.percent : s.percentWhole, s.currency, ordersLabel(s.orders)].filter(Boolean).join(" · ")}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TwelveLaptop({ view }: { view: TwelveMonths }) {
  const rows = [...view.months].reverse();
  return (
    <div className="mt-3.5 hidden grid-cols-12 gap-3.5 laptop:grid" data-testid="twelve-laptop">
      <NowBlock className="col-span-4 flex flex-col px-[22px] py-5" aria-label={`Gross profit, ${view.current.name} to date`}>
        <TwelveNow view={view} laptop />
        <div className="mt-auto flex flex-col pt-4 text-[14px]">
          {[
            ["12-month revenue", view.totals.revenue],
            ["12-month gross profit", view.totals.grossProfit],
            ["12-month purchases", view.totals.purchases],
          ].map(([label, amount], index) => (
            <div key={label} className={cn("flex justify-between py-2", index < 2 && cn("border-b", ON_INK_LINE), index === 2 && "pb-0")}>
              <span className="text-on-ink-soft">{label}</span>
              <Money amount={amount} onInk className="font-semibold" />
            </div>
          ))}
        </div>
      </NowBlock>

      <section className="col-span-8 rounded-[24px] border border-line bg-surface px-5 py-4" aria-label="Sales and purchases by month">
        <div className="grid grid-cols-[120px_1fr] items-end gap-x-4">
          <div className="pb-1">
            <div className="text-[14px] font-semibold">Sales</div>
            <div className="text-[12px] text-ink-3">revenue, stacked</div>
          </div>
          <MonthBars months={view.months} gap={10} className="h-[150px]" />
          <div className="pt-3.5 pb-1">
            <div className="text-[14px] font-semibold">Purchases</div>
            <div className="text-[12px] text-ink-3">from suppliers</div>
          </div>
          <div className="pt-3.5">
            <PurchaseBars months={view.months} gap={10} className="h-16" />
          </div>
          <span />
          <MonthAxis months={view.months} style="short" gap={10} />
        </div>
        <MonthLegend current={view.months[view.months.length - 1].label} className="ml-[136px]" />
      </section>

      <section className="col-span-8 rounded-[24px] border border-line bg-surface px-5 py-3" aria-label="Month by month">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[16px] font-semibold">Month by month</h2>
          <span className="text-[12px] text-ink-3">* vs the same days of {view.current.previousName}</span>
        </div>
        <table className="mt-2 w-full text-[14px]" data-testid="month-table">
          <thead>
            <tr className="border-b border-line text-[12px] text-ink-3">
              <th className="w-[110px] pb-1.5 text-left font-normal">Month</th>
              <th className="w-[60px] pb-1.5 text-right font-normal">Vials</th>
              <th className="pb-1.5 text-right font-normal">Revenue</th>
              <th className="pb-1.5 text-right font-normal">Cost</th>
              <th className="pb-1.5 text-right font-normal">Gross profit</th>
              <th className="w-[70px] pb-1.5 text-right font-normal">Margin</th>
              <th className="pb-1.5 text-right font-normal">Purchases</th>
              <th className="w-[110px] pb-1.5 text-right font-normal">GP change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((m) => (
              <tr key={m.month} data-testid="month-table-row">
                <td className="py-[9px] font-semibold">
                  {m.label} {m.current ? <span className="text-[12px] font-normal text-ink-3">to date</span> : null}
                </td>
                <td className="py-[9px] text-right">{m.vials}</td>
                <td className="py-[9px] text-right">{money(m.revenue)}</td>
                <td className="py-[9px] text-right text-ink-2">{money(m.cost)}</td>
                <td className="py-[9px] text-right font-semibold">
                  <Money amount={m.grossProfit} />
                </td>
                <td className="py-[9px] text-right text-ink-2">{m.margin ?? "—"}</td>
                <td className="py-[9px] text-right">{money(m.purchases)}</td>
                <td className="py-[9px] text-right text-ink-2">
                  <span className="inline-flex items-center justify-end gap-[3px]">
                    <ChangeArrow change={m.change} className="size-3" />
                    <span className="sr-only">{m.change.direction === "up" ? "up" : m.change.direction === "down" ? "down" : "no change"} </span>
                    {money(m.change.amount)}
                    {m.current ? "*" : ""}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="col-span-4 rounded-[24px] border border-line bg-surface px-5 py-3" aria-label="Purchases by supplier">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[16px] font-semibold">Purchases by supplier</h2>
          <span className="font-mono text-[12px] text-ink-3">12 months</span>
        </div>
        <Suppliers view={view} phone={false} />
      </section>
    </div>
  );
}
