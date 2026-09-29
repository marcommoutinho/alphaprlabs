import Form from "next/form";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "@/components/alpha/link";
import { buttonVariants } from "@/components/alpha/button-variants";
import { BUSINESS_MAIN, LEDGER_HREF, OUTSIDE_HREF } from "@/components/business/frame";
import { LinkSaleSheet } from "@/components/records/link-sheet";
import { money, shortDate } from "@/lib/alpha/format";
import {
  OUTSIDE_EMPTY,
  OUTSIDE_SEARCH_LABEL,
  OUTSIDE_SEARCH_SUBMIT,
  OUTSIDE_SUBTITLE,
  OUTSIDE_TITLE,
  outsideBuyerLine,
  outsideNameEmpty,
  outsideNoMatch,
  sellerLine,
} from "@/lib/inventory/seller-screens";
import type { OutsideBuyer } from "@/lib/inventory/sellers";
import type { BuyerAccount, SaleRecord } from "@/lib/inventory/service";
import { cn } from "@/lib/utils";

export const OUTSIDE_PATH = OUTSIDE_HREF;
const namePath = (name: string) => `${OUTSIDE_PATH}?${new URLSearchParams({ name })}`;

function BackBar({ href, label }: { href: string; label: string }) {
  return (
    <div className="flex h-11 items-center pr-3 pl-1.5 laptop:mb-2 laptop:h-auto laptop:pl-0">
      <Link href={href} className="flex items-center gap-0.5 text-[17px] text-signal-ink laptop:text-[15px]">
        <ChevronLeft className="size-[26px] laptop:size-5" aria-hidden />
        {label}
      </Link>
    </div>
  );
}

/**
 * Outside buyers (Marco, 2026-09-27; restyled in design v3 for V6): every
 * outside buyer name not yet linked, however old its sales, found by name.
 * Each name opens its sales. Reached from the Ledger.
 */
export function OutsideBuyersView({ buyers, search }: { buyers: OutsideBuyer[]; search: string }) {
  return (
    <main className={BUSINESS_MAIN} data-testid="outside">
      <BackBar href={LEDGER_HREF} label="Ledger" />
      <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
        <h1 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em]">{OUTSIDE_TITLE}</h1>
        <p className="mt-1.5 max-w-[620px] text-[15px] leading-[1.45] text-ink-2">{OUTSIDE_SUBTITLE}</p>
      </header>
      <Form action={OUTSIDE_PATH} role="search" className="mx-3 mt-4 flex gap-2 laptop:mx-0 laptop:max-w-[520px]">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[12px] bg-sunken px-3.5 text-ink-3">
          <Search className="size-[18px] shrink-0" aria-hidden />
          <span className="sr-only">{OUTSIDE_SEARCH_LABEL}</span>
          <input
            name="q"
            type="search"
            autoComplete="off"
            defaultValue={search}
            placeholder="Name or reference"
            aria-label={OUTSIDE_SEARCH_LABEL}
            className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
          />
        </label>
        <button type="submit" className={cn(buttonVariants({ variant: "ink", size: "md" }))}>
          {OUTSIDE_SEARCH_SUBMIT}
        </button>
      </Form>
      {buyers.length === 0 ? (
        <p className="mx-5 mt-6 text-[15px] text-ink-2 laptop:mx-0">{search.trim() ? outsideNoMatch(search) : OUTSIDE_EMPTY}</p>
      ) : (
        <div className="mx-3 mt-4 divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-surface laptop:mx-0 laptop:max-w-[720px]" data-testid="outside-buyers">
          {buyers.map((buyer) => (
            <Link key={buyer.name} href={namePath(buyer.name)} className="flex items-center gap-3 px-4 py-3" data-testid="outside-buyer">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold">{buyer.name}</span>
                <span className="mt-0.5 block truncate font-mono text-[12px] text-ink-2">{outsideBuyerLine(buyer, shortDate(buyer.lastSold))}</span>
              </span>
              <span className="shrink-0 text-[16px] font-semibold">{money(buyer.revenue)}</span>
              <ChevronRight className="size-[18px] shrink-0 text-ink-3" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

/** One outside buyer's sales, newest first, each with "Link to account…" (and the same-name option). */
export function OutsideSalesView({
  name,
  sales,
  itemLabels,
  accounts,
}: {
  name: string;
  sales: SaleRecord[];
  itemLabels: Map<string, string>;
  accounts: BuyerAccount[];
}) {
  return (
    <main className={BUSINESS_MAIN} data-testid="outside-sales">
      <BackBar href={OUTSIDE_PATH} label={OUTSIDE_TITLE} />
      <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
        <div className="font-mono text-[13px] font-medium text-ink-3">Outside buyer</div>
        <h1 className="mt-0.5 text-[34px] leading-[1.1] font-semibold tracking-[-0.03em]">{name}</h1>
        <p className="mt-1.5 max-w-[620px] text-[15px] leading-[1.45] text-ink-2">{OUTSIDE_SUBTITLE}</p>
      </header>
      {sales.length === 0 ? (
        <p className="mx-5 mt-6 text-[15px] text-ink-2 laptop:mx-0">{outsideNameEmpty(name)}</p>
      ) : (
        <div className="mx-3 mt-4 divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-surface laptop:mx-0 laptop:max-w-[720px]" data-testid="sales-list">
          {sales.map((sale) => (
            <div key={sale.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3" data-testid="sale-row">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold">
                  {itemLabels.get(sale.stockItemId) ?? "—"} × {sale.quantity.toLocaleString("en-CA")}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[12px] text-ink-2" data-testid="sale-line">
                  {shortDate(sale.soldOn)} · {sellerLine(sale)} · {money(sale.unitPrice)} ea
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[16px] font-semibold">{money(sale.revenue)}</span>
                <span className="block font-mono text-[12px] text-ink-3">GP {money(sale.grossProfit)}</span>
              </span>
              {sale.buyerType === "outside" ? (
                <div className="basis-full">
                  <LinkSaleSheet saleId={sale.id} buyerName={sale.buyerName} accounts={accounts} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
