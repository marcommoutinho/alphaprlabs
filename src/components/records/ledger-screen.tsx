"use client";

import Decimal from "decimal.js";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import Link from "@/components/alpha/link";
import { Button } from "@/components/alpha/button";
import { buttonVariants } from "@/components/alpha/button-variants";
import { Field, TextInput } from "@/components/alpha/field";
import { segmentedItem, segmentedTrack } from "@/components/alpha/segmented";
import { Sheet, SheetClose, SheetContent } from "@/components/alpha/sheet";
import { Skeleton } from "@/components/alpha/skeleton";
import { BUSINESS_MAIN, BUSINESS_PATH, OUTSIDE_HREF } from "@/components/business/frame";
import { money } from "@/lib/alpha/format";
import { checkCustomRange, CUSTOM_MAX_DAYS, type DateRange } from "@/lib/business/period";
import {
  byDay,
  byMonth,
  checkMonthRange,
  dayPresets,
  dayShort,
  dayTitle,
  entryTitle,
  gpLabel,
  LEDGER_EMPTY,
  LEDGER_MONTHS_MAX,
  ledgerHref,
  monthLine,
  monthPresets,
  monthRange,
  monthTitle,
  NO_SELLER,
  purchaseLine,
  purchaseTotals,
  rangeChip,
  rangeHeader,
  rateLabel,
  saleLine,
  salesTabLabel,
  saleTotals,
  supplierSummary,
  unitCostLabel,
  type LedgerPurchase,
  type LedgerSale,
  type LedgerView,
  type MonthGroup,
  type MonthItem,
  type Totals,
} from "@/lib/records/ledger";
import { cn } from "@/lib/utils";
import { useJson } from "./parts";
import { RecordButton } from "./record-provider";

export type LedgerSeller = { key: string; name: string | null; vials: number; revenue: string; cost: string; grossProfit: string };

export type LedgerData = {
  today: string;
  view: LedgerView;
  /** Each seller's totals for the range (and item): the seller menu. */
  sellers: LedgerSeller[];
  /** Vials sold in the range for the current seller filter: the Sales tab's label. */
  salesVials: number;
  itemLabel: string | null;
  /** Day view: the range's sales or purchases, newest first. */
  entries: LedgerSale[] | LedgerPurchase[] | null;
  /** Month view: per month and item. */
  months: MonthItem[] | null;
};

const chipClass =
  "relative inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-[12px] border border-line bg-surface px-3 text-[14px] text-ink focus-within:border-ink";

/**
 * A7 / A14 (phone) and D5 (laptop) Ledger: Sales | Purchases, the range,
 * the seller (Sales) and Day | Month. Read-only; Record sale and Record
 * purchase open their sheets over it.
 */
export function LedgerScreen({ data }: { data: LedgerData }) {
  const { view, today } = data;
  const sales = view.tab === "sales";
  const totals = totalsOf(data);

  return (
    <main className={BUSINESS_MAIN} data-testid="ledger" data-tab={view.tab} data-group={view.group}>
      {/* Phone nav bar (A7): back to Business, + records a sale or purchase. */}
      <div className="flex h-11 items-center justify-between pr-3 pl-1.5 laptop:hidden">
        <Link href={BUSINESS_PATH} className="flex items-center gap-0.5 text-[17px] text-signal-ink">
          <ChevronLeft className="size-[26px]" aria-hidden />
          Business
        </Link>
        <RecordButton kind={sales ? "sale" : "purchase"} variant="soft" size="icon" aria-label={sales ? "Record sale" : "Record purchase"}>
          <Plus className="size-5" aria-hidden />
        </RecordButton>
      </div>

      <header className="px-5 pt-1 laptop:flex laptop:items-end laptop:gap-3 laptop:px-0 laptop:pt-0">
        <div>
          <div className="hidden font-mono text-[13px] font-medium text-ink-3 laptop:block" data-testid="ledger-range-header">
            {rangeHeader(view)}
          </div>
          <h1 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] laptop:hidden">Ledger</h1>
          <h1 className="hidden text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] laptop:mt-0.5 laptop:block">Sales and purchases</h1>
        </div>
        <div className="ml-auto hidden gap-3 laptop:flex">
          <RecordButton kind="purchase" variant="outline" size="sm" className="rounded-[12px] text-[14px]">
            Record purchase
          </RecordButton>
          <RecordButton kind="sale" variant="primary" size="sm" className="rounded-[12px] text-[14px]">
            Record sale
          </RecordButton>
        </div>
      </header>

      <div className="mx-3 mt-3.5 flex flex-col gap-2.5 laptop:mx-0 laptop:mt-4 laptop:flex-row laptop:flex-wrap laptop:items-center laptop:gap-2">
        <nav aria-label="Sales or purchases" className={cn(segmentedTrack({ size: "md" }), "laptop:h-10 laptop:auto-cols-auto")}>
          {(["sales", "purchases"] as const).map((tab) => (
            <Link
              key={tab}
              href={ledgerHref(view, { tab })}
              aria-current={view.tab === tab ? "page" : undefined}
              data-testid={`ledger-tab-${tab}`}
              className={cn(segmentedItem({ size: "md" }), "laptop:px-3.5 laptop:text-[14px]")}
            >
              {tab === "sales" ? salesTabLabel(data.salesVials) : "Purchases"}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <RangeChip view={view} today={today} />
          {sales ? <SellerChip view={view} sellers={data.sellers} /> : null}
          {view.item ? (
            <Link href={ledgerHref(view, { item: null })} className={chipClass} aria-label={`Remove the item filter ${data.itemLabel ?? ""}`} data-testid="item-chip">
              <span className="max-w-[180px] truncate">{data.itemLabel ?? "One item"}</span>
              <X className="size-3.5 text-ink-3" aria-hidden />
            </Link>
          ) : null}
        </div>
        <div className="flex items-center gap-2.5 laptop:ml-auto">
          <span id="group-by" className="text-[13px] font-semibold text-ink-2">
            Group by
          </span>
          <nav aria-labelledby="group-by" className={cn(segmentedTrack({ size: "mini" }), "h-9 rounded-[10px]")}>
            {(["day", "month"] as const).map((group) => (
              <Link
                key={group}
                href={ledgerHref(view, { group })}
                aria-current={view.group === group ? "page" : undefined}
                data-testid={`ledger-group-${group}`}
                className={cn(segmentedItem({ size: "mini" }), "px-3.5")}
              >
                {group === "day" ? "Day" : "Month"}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <p className="mx-5 mt-3 font-mono text-[13px] text-balance text-ink-2 laptop:mx-0" data-testid="ledger-summary">
        {summaryLine(view, totals)}
      </p>

      {view.group === "day" ? <DayView data={data} /> : <MonthView data={data} />}

      {sales ? (
        <p className="mx-5 mt-5 text-[14px] text-ink-2 laptop:mx-0">
          <Link href={OUTSIDE_HREF} className="font-semibold text-signal-ink" data-testid="outside-link">
            Outside buyers
          </Link>{" "}
          · link past sales to a researcher&apos;s account.
        </p>
      ) : null}
    </main>
  );
}

function totalsOf(data: LedgerData): Totals {
  if (data.entries) return data.view.tab === "sales" ? saleTotals(data.entries as LedgerSale[]) : purchaseTotals(data.entries as LedgerPurchase[]);
  return byMonth(data.months ?? []).reduce<Totals>(
    (sum, month) => ({
      entries: sum.entries + month.totals.entries,
      vials: sum.vials + month.totals.vials,
      revenue: add(sum.revenue, month.totals.revenue),
      cost: add(sum.cost, month.totals.cost),
      grossProfit: add(sum.grossProfit, month.totals.grossProfit),
      total: add(sum.total, month.totals.total),
    }),
    { entries: 0, vials: 0, revenue: "0.00", cost: "0.00", grossProfit: "0.00", total: "0.00" },
  );
}

/** Exact sum of two money strings. */
const add = (a: string, b: string) => new Decimal(a).plus(b).toFixed(2);

/**
 * "12 sales · 32 vials · $3,840.00 · cost $427.90 · GP $3,412.10" (the FIFO
 * cost frozen with each sale, for every seller or the one chosen) or
 * "4 orders · 170 vials · $2,475.21".
 */
function summaryLine(view: LedgerView, totals: Totals): string {
  const vials = `${totals.vials.toLocaleString("en-CA")} vial${totals.vials === 1 ? "" : "s"}`;
  if (view.tab === "sales") {
    const sales = `${totals.entries.toLocaleString("en-CA")} sale${totals.entries === 1 ? "" : "s"}`;
    return `${sales} · ${vials} · ${money(totals.revenue)} · ${costLabel(totals.cost)} · ${gpLabel(totals.grossProfit)}`;
  }
  return `${totals.entries.toLocaleString("en-CA")} order${totals.entries === 1 ? "" : "s"} · ${vials} · ${money(totals.total)}`;
}

/** "cost $427.90": the FIFO cost of the vials sold. */
const costLabel = (cost: string) => `cost ${money(cost)}`;

function emptyText(view: LedgerView): string {
  if (view.tab === "purchases") return LEDGER_EMPTY.purchases;
  return view.seller ? LEDGER_EMPTY.salesSeller : LEDGER_EMPTY.sales;
}

// ── Filters ───────────────────────────────────────────────────────────────

/** "All sellers ▾": a native select over the chip; each option shows the seller's vials, revenue, cost and GP for the range. */
function SellerChip({ view, sellers }: { view: LedgerView; sellers: LedgerSeller[] }) {
  const router = useRouter();
  const current = sellers.find((seller) => seller.key === view.seller);
  const label = view.seller ? (view.seller === NO_SELLER ? "Seller not recorded" : (current?.name ?? "One seller")) : "All sellers";
  const options = [...sellers];
  if (view.seller && !current) options.push({ key: view.seller, name: view.seller === NO_SELLER ? null : "One seller", vials: 0, revenue: "0.00", cost: "0.00", grossProfit: "0.00" });
  return (
    <span className={chipClass}>
      <span className="max-w-[160px] truncate" aria-hidden>
        {label}
      </span>
      <ChevronDown className="size-3.5 text-ink-3" aria-hidden />
      <select
        aria-label="Seller"
        data-testid="seller-select"
        value={view.seller ?? ""}
        onChange={(event) => router.push(ledgerHref(view, { seller: event.currentTarget.value || null }))}
        className="absolute inset-0 size-full cursor-pointer appearance-none text-base opacity-0"
      >
        <option value="">All sellers</option>
        {options.map((seller) => (
          <option key={seller.key} value={seller.key}>
            {`${seller.name ?? "Seller not recorded"} · ${seller.vials.toLocaleString("en-CA")} vials · ${money(seller.revenue)} · ${costLabel(seller.cost)} · ${gpLabel(seller.grossProfit)}`}
          </option>
        ))}
      </select>
    </span>
  );
}

/** The range chip ("Sep 1–24 ▾"): presets and a custom From / To in a sheet. */
function RangeChip({ view, today }: { view: LedgerView; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Range ${rangeChip(view)}, change`}
        data-testid="range-chip"
        className={cn(chipClass, "font-mono")}
      >
        {rangeChip(view)}
        <ChevronDown className="size-3.5 text-ink-3" aria-hidden />
      </button>
      <RangeSheet key={`${view.group}:${view.range.from}:${view.range.to}`} open={open} onOpenChange={setOpen} view={view} today={today} />
    </>
  );
}

function RangeSheet({ open, onOpenChange, view, today }: { open: boolean; onOpenChange: (open: boolean) => void; view: LedgerView; today: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(view.range.from);
  const [to, setTo] = useState(view.range.to);
  const [error, setError] = useState<string | null>(null);
  const months = view.group === "month";
  const presets = months ? monthPresets(today) : dayPresets(today);

  const go = (range: DateRange) => {
    onOpenChange(false);
    router.push(ledgerHref(view, { range }));
  };
  const show = () => {
    const checked = months ? checkMonthRange(from, to, today) : checkCustomRange(from, to, today);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    go(checked.range);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="Range"
        size="auto"
        footer={
          <>
            <SheetClose className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-[100px] laptop:h-12")}>Cancel</SheetClose>
            <Button size="lg" className="laptop:h-12" onClick={show}>
              Show range
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2 px-2">
          {presets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => go(preset.range)}
              className="flex h-11 cursor-pointer items-center justify-center rounded-[12px] border border-line bg-surface text-[15px] font-medium"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <form
          className="flex flex-col gap-3 px-2"
          onSubmit={(event) => {
            event.preventDefault();
            show();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <TextInput type="date" value={from} max={today} onChange={(event) => setFrom(event.currentTarget.value)} mono data-testid="range-from" />
            </Field>
            <Field label="To">
              <TextInput type="date" value={to} max={today} onChange={(event) => setTo(event.currentTarget.value)} mono data-testid="range-to" />
            </Field>
          </div>
          <p className="text-[13px] text-ink-3">
            {months
              ? `Business dates in Toronto time. Whole months, up to ${LEDGER_MONTHS_MAX}.`
              : `Business dates in Toronto time, up to ${CUSTOM_MAX_DAYS} days. Longer spans: group by month.`}
          </p>
          {error ? (
            <p role="alert" className="text-[13px] font-medium text-missed">
              {error}
            </p>
          ) : null}
          <button type="submit" hidden />
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ── A7 / D5 by day ────────────────────────────────────────────────────────

function DayView({ data }: { data: LedgerData }) {
  const entries = data.entries ?? [];
  if (entries.length === 0) return <Empty text={emptyText(data.view)} />;
  const days = byDay(entries as (LedgerSale | LedgerPurchase)[]);
  const sales = data.view.tab === "sales";
  return (
    <>
      <div className="laptop:hidden" data-testid="ledger-days">
        {days.map((day) => (
          <section key={day.day} aria-label={dayTitle(day.day)} data-testid="ledger-day">
            <h2 className="mx-5 mt-5 mb-2 flex items-baseline justify-between text-[13px] font-semibold text-ink-2">
              <span>{dayTitle(day.day)}</span>
              <span className="font-mono font-medium" data-testid="ledger-day-total">
                {money(sales ? day.totals.revenue : day.totals.total)}
              </span>
            </h2>
            <div className="mx-3 divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-surface">
              {day.entries.map((entry) =>
                "soldOn" in entry ? <SaleRow key={entry.id} sale={entry} /> : <PurchaseRow key={entry.id} purchase={entry} />,
              )}
            </div>
          </section>
        ))}
      </div>
      <div className="mt-4 hidden laptop:block">
        {sales ? <SalesTable days={days as ReturnType<typeof byDay<LedgerSale>>} /> : <PurchasesTable days={days as ReturnType<typeof byDay<LedgerPurchase>>} />}
      </div>
    </>
  );
}

function SaleRow({ sale }: { sale: LedgerSale }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3" data-testid="ledger-sale-row">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold">{entryTitle(sale)}</span>
        <span className="mt-0.5 block truncate font-mono text-[12px] text-ink-2">{saleLine(sale)}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[16px] font-semibold">{money(sale.revenue)}</span>
        <span className="mt-0.5 block font-mono text-[12px] text-ink-3">{gpLabel(sale.grossProfit)}</span>
      </span>
    </div>
  );
}

function PurchaseRow({ purchase }: { purchase: LedgerPurchase }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3" data-testid="ledger-purchase-row">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold">{entryTitle(purchase)}</span>
        <span className="mt-0.5 block truncate font-mono text-[12px] text-ink-2">{purchaseLine(purchase)}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[16px] font-semibold">{money(purchase.totalCost)}</span>
        <span className="mt-0.5 block font-mono text-[12px] text-ink-3">{purchase.currency}</span>
      </span>
    </div>
  );
}

const th = "px-3 pt-3 pb-2 text-[12px] font-normal text-ink-3 first:pl-5 last:pr-5";
const td = "px-3 py-2.5 first:pl-5 last:pr-5";

function SalesTable({ days }: { days: { day: string; totals: Totals; entries: LedgerSale[] }[] }) {
  return (
    <div className="overflow-hidden rounded-group border border-line bg-surface">
      <table className="w-full table-fixed text-[14px]" data-testid="ledger-table">
        <colgroup>
          <col className="w-[80px]" />
          <col />
          <col className="w-[60px]" />
          <col className="w-[26%]" />
          <col className="w-[100px]" />
          <col className="w-[110px]" />
          <col className="w-[110px]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th className={cn(th, "text-left")}>Sold</th>
            <th className={cn(th, "text-left")}>Item</th>
            <th className={cn(th, "text-right")}>Vials</th>
            <th className={cn(th, "text-left")}>Seller → buyer</th>
            <th className={cn(th, "text-right")}>Price</th>
            <th className={cn(th, "text-right")}>Revenue</th>
            <th className={cn(th, "text-right")}>Gross profit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {days.flatMap((day) =>
            day.entries.map((sale, index) => (
              <tr key={sale.id} data-testid="ledger-table-row">
                <td className={cn(td, "font-mono text-[13px]")}>{index === 0 ? dayShort(day.day) : ""}</td>
                <td className={cn(td, "truncate font-semibold")}>{sale.item}</td>
                <td className={cn(td, "text-right")}>{sale.quantity.toLocaleString("en-CA")}</td>
                <td className={cn(td, "truncate font-mono text-[13px] text-ink-2")}>{saleLine(sale).split(" · ")[0]}</td>
                <td className={cn(td, "text-right")}>{money(sale.unitPrice)}</td>
                <td className={cn(td, "text-right font-semibold")}>{money(sale.revenue)}</td>
                <td className={cn(td, "text-right font-mono text-[13px] text-ink-2")}>{money(sale.grossProfit)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function PurchasesTable({ days }: { days: { day: string; totals: Totals; entries: LedgerPurchase[] }[] }) {
  return (
    <div className="overflow-hidden rounded-group border border-line bg-surface">
      <table className="w-full table-fixed text-[14px]" data-testid="ledger-table">
        <colgroup>
          <col className="w-[80px]" />
          <col />
          <col className="w-[60px]" />
          <col className="w-[110px]" />
          <col className="w-[80px]" />
          <col className="w-[110px]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th className={cn(th, "text-left")}>Received</th>
            <th className={cn(th, "text-left")}>Item</th>
            <th className={cn(th, "text-right")}>Vials</th>
            <th className={cn(th, "text-right")}>Unit cost</th>
            <th className={cn(th, "text-right")}>Rate</th>
            <th className={cn(th, "text-right")}>Total CAD</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {days.flatMap((day) =>
            day.entries.map((purchase) => (
              <tr key={purchase.id} data-testid="ledger-table-row">
                <td className={cn(td, "font-mono text-[13px]")}>{dayShort(day.day)}</td>
                <td className={cn(td, "truncate")}>
                  <span className="font-semibold">{purchase.item}</span>
                  <span className="ml-2 font-mono text-[12px] text-ink-3">{purchase.supplier ?? "No supplier"}</span>
                </td>
                <td className={cn(td, "text-right")}>{purchase.quantity.toLocaleString("en-CA")}</td>
                <td className={cn(td, "text-right")}>{unitCostLabel(purchase)}</td>
                <td className={cn(td, "text-right font-mono text-[13px]", purchase.fxRate ? "text-ink-2" : "text-ink-3")}>{rateLabel(purchase)}</td>
                <td className={cn(td, "text-right font-semibold")}>{money(purchase.totalCost)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── A14 by month ──────────────────────────────────────────────────────────

function MonthView({ data }: { data: LedgerData }) {
  const months = byMonth(data.months ?? []);
  if (months.length === 0) return <Empty text={emptyText(data.view)} />;
  return (
    <div className="mx-3 mt-4 flex flex-col gap-2.5 laptop:mx-0" data-testid="ledger-months">
      {months.map((month, index) => (
        <MonthCard key={month.month} month={month} data={data} initiallyOpen={index === 0} />
      ))}
    </div>
  );
}

function MonthCard({ month, data, initiallyOpen }: { month: MonthGroup; data: LedgerData; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const sales = data.view.tab === "sales";
  return (
    <section className="overflow-hidden rounded-[20px] border border-line bg-surface" data-testid="ledger-month">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-semibold" data-testid="ledger-month-title">
            {monthTitle(month.month, data.today)}
          </span>
          <span className="mt-0.5 block font-mono text-[12px] text-ink-2" data-testid="ledger-month-line">
            {monthLine(data.view.tab, month.totals)}
          </span>
        </span>
        <span className="shrink-0 text-[17px] font-semibold" data-testid="ledger-month-total">
          {money(sales ? month.totals.revenue : month.totals.total)}
        </span>
        <ChevronDown className={cn("size-[18px] shrink-0 text-ink-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="divide-y divide-line border-t border-line">
          {month.items.map((item) => (
            <MonthItemRow key={item.key} item={item} data={data} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MonthItemRow({ item, data }: { item: MonthItem; data: LedgerData }) {
  const [open, setOpen] = useState(false);
  const sales = data.view.tab === "sales";
  return (
    <div data-testid="ledger-month-item">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{item.item}</span>
          {!sales ? <span className="block truncate font-mono text-[12px] text-ink-3">{supplierSummary(item)}</span> : null}
        </span>
        <span className="w-[64px] shrink-0 text-right font-mono text-[13px] text-ink-2">
          {item.vials.toLocaleString("en-CA")} vial{item.vials === 1 ? "" : "s"}
        </span>
        <span className="w-[92px] shrink-0 text-right text-[15px] font-semibold">{money(item.total)}</span>
        <ChevronRight className={cn("size-4 shrink-0 text-ink-3 transition-transform", open && "rotate-90")} aria-hidden />
      </button>
      {open ? <MonthEntries item={item} data={data} /> : null}
    </div>
  );
}

/** An item's entries in a month, read when it's opened. */
function MonthEntries({ item, data }: { item: MonthItem; data: LedgerData }) {
  const range = monthRange(item.month, data.view.range);
  const query = new URLSearchParams({ tab: data.view.tab, from: range.from, to: range.to, item: item.itemId });
  if (data.view.seller) query.set("seller", data.view.seller);
  const [load, retry] = useJson<LedgerSale[] | LedgerPurchase[]>(`/admin/records/ledger-entries?${query}`);
  if (!load || load.status === "loading") {
    return (
      <div className="px-4 pb-3" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-12 rounded-[12px]" />
      </div>
    );
  }
  if (load.status === "error") {
    return (
      <p className="px-4 pb-3 text-[14px] text-missed" role="alert">
        Couldn&apos;t load these entries.{" "}
        <button type="button" onClick={retry} className="cursor-pointer font-semibold text-signal-ink">
          Try again
        </button>
      </p>
    );
  }
  return (
    <div className="mx-3 mb-3 divide-y divide-line rounded-[14px] bg-sunken" data-testid="ledger-month-entries">
      {load.data.map((entry) =>
        "soldOn" in entry ? (
          <div key={entry.id} className="flex items-center gap-3 px-3 py-2 text-[14px]" data-testid="ledger-month-entry">
            <span className="w-[52px] shrink-0 font-mono text-[12px] text-ink-2">{dayShort(entry.soldOn)}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">
              × {entry.quantity} · {saleLine(entry)}
            </span>
            <span className="shrink-0 font-semibold">{money(entry.revenue)}</span>
          </div>
        ) : (
          <div key={entry.id} className="flex items-center gap-3 px-3 py-2 text-[14px]" data-testid="ledger-month-entry">
            <span className="w-[52px] shrink-0 font-mono text-[12px] text-ink-2">{dayShort(entry.receivedOn)}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">
              × {entry.quantity} · {purchaseLine(entry)}
            </span>
            <span className="shrink-0 font-semibold">{money(entry.totalCost)}</span>
          </div>
        ),
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="mx-5 mt-6 text-[15px] text-ink-2 laptop:mx-0" data-testid="ledger-empty">
      {text}
    </p>
  );
}
