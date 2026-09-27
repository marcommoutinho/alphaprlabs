import Form from "next/form";
import Link from "next/link";
import { AppButton, EmptyState, Field } from "@/components/app-shell/form";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  OUTSIDE_EMPTY,
  OUTSIDE_SEARCH_LABEL,
  OUTSIDE_SEARCH_SUBMIT,
  OUTSIDE_SUBTITLE,
  OUTSIDE_TITLE,
  outsideBuyerLine,
  outsideNameEmpty,
  outsideNoMatch,
} from "@/lib/inventory/seller-screens";
import type { OutsideBuyer } from "@/lib/inventory/sellers";
import type { BuyerAccount, SaleRecord } from "@/lib/inventory/service";
import { SaleEntry } from "./inventory-views";
import "@/styles/app/inventory.css";
import "@/styles/app/sellers.css";

export const OUTSIDE_PATH = "/admin/sales/outside";
const namePath = (name: string) => `${OUTSIDE_PATH}?${new URLSearchParams({ name })}`;

/**
 * A7 "Outside buyers" (Marco, 2026-09-27): every outside buyer name not yet
 * linked, however old its sales, found by name. Each name opens its sales.
 */
export function OutsideBuyersView({ buyers, search }: { buyers: OutsideBuyer[]; search: string }) {
  return (
    <>
      <Link href="/admin/sales" className="app-inv-back">
        ‹ Sales
      </Link>
      <h1 className="app-h1">{OUTSIDE_TITLE}</h1>
      <p className="app-subtitle">{OUTSIDE_SUBTITLE}</p>
      <Form action={OUTSIDE_PATH} className="app-outside-search" role="search">
        <Field label={OUTSIDE_SEARCH_LABEL}>
          <input name="q" type="search" autoComplete="off" defaultValue={search} placeholder="Name or reference" />
        </Field>
        <AppButton type="submit" variant="secondary">
          {OUTSIDE_SEARCH_SUBMIT}
        </AppButton>
      </Form>
      {buyers.length === 0 ? (
        <div className="app-inv-empty">
          <EmptyState>{search.trim() ? outsideNoMatch(search) : OUTSIDE_EMPTY}</EmptyState>
        </div>
      ) : (
        <div className="app-inv-breakdown" data-testid="outside-buyers">
          {buyers.map((buyer) => (
            <Link key={buyer.name} href={namePath(buyer.name)} className="app-outside-row" data-testid="outside-buyer">
              <span className="app-outside-name">
                <b>{buyer.name}</b>
                <span className="app-inv-sub">{outsideBuyerLine(buyer, formatDate(buyer.lastSold))}</span>
              </span>
              <span className="app-inv-num">{formatCurrency(buyer.revenue)}</span>
            </Link>
          ))}
        </div>
      )}
    </>
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
    <>
      <Link href={OUTSIDE_PATH} className="app-inv-back">
        ‹ {OUTSIDE_TITLE}
      </Link>
      <h1 className="app-h1">{name}</h1>
      <p className="app-subtitle">{OUTSIDE_SUBTITLE}</p>
      {sales.length === 0 ? (
        <div className="app-inv-empty">
          <EmptyState>{outsideNameEmpty(name)}</EmptyState>
        </div>
      ) : (
        <div className="app-outside-sales" data-testid="sales-list">
          {sales.map((sale) => (
            <SaleEntry key={sale.id} sale={sale} itemLabel={itemLabels.get(sale.stockItemId) ?? "—"} linkAccounts={accounts} />
          ))}
        </div>
      )}
    </>
  );
}
