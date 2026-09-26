"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { recordSaleAction } from "@/app/(private)/admin/inventory/actions";
import { AppButton, Field, InlineError } from "@/components/app-shell/form";
import { useSubmit } from "@/components/app-shell/use-submit";
import { BuyerAccountPicker } from "./buyer-account-picker";
import { formatCurrency } from "@/lib/format";
import { insufficientStockMessage, type FifoLot } from "@/lib/inventory/rules";
import {
  OUTSIDE_BUYER_PLACEHOLDER,
  previewAllocationLine,
  profitTone,
  SALE_PREVIEW_FOOTNOTE,
  salePreview,
  vials,
} from "@/lib/inventory/screens";
import "@/styles/app/inventory.css";

type Form = {
  stockItemId: string;
  soldOn: string;
  buyerType: "account" | "outside";
  buyerProfileId: string;
  buyerName: string;
  quantity: string;
  unitPrice: string;
};

export type SaleItemOption = { id: string; label: string; onHand: number };
/** The chosen item's current stock and open purchase lots (the preview's FIFO input). */
export type SaleSelection = { itemId: string; onHand: number; lots: FifoLot[] };

/**
 * A6 Record sale: the form (left) and the live preview (right; stacked on
 * phone). The preview allocates the typed quantity over the chosen item's
 * open lots exactly as the database will (allocateFifo, fifoOrder). Choosing
 * another item reloads its lots (?item=); until they arrive the preview shows
 * "—" and saving is blocked. The database re-checks stock when
 * saving; if it ran out meanwhile nothing is recorded, the page data is
 * refreshed and the "Stock changed" error shows.
 */
export function SaleForm({
  items,
  accounts,
  selection,
  today,
}: {
  items: SaleItemOption[];
  accounts: { id: string; name: string; email: string }[];
  selection: SaleSelection;
  /** Today in the business time zone: the default sale date. */
  today: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form>({
    stockItemId: selection.itemId,
    soldOn: today,
    buyerType: "account",
    // Blank until the admin picks the buyer's account (Marco, 2026-09-26).
    buyerProfileId: "",
    buyerName: "",
    quantity: "",
    unitPrice: "",
  });
  const { pending, error, submit } = useSubmit(recordSaleAction);
  const [loadingItem, startItemLoad] = useTransition();
  const key = useRef<string | null>(null);
  // Saved: the stock item is opening; keep the button disabled until it does.
  const [leaving, setLeaving] = useState(false);

  const update = <K extends keyof Form>(field: K, value: Form[K]) => setForm((current) => ({ ...current, [field]: value }));

  function chooseItem(id: string) {
    update("stockItemId", id);
    startItemLoad(() => router.replace(`/admin/inventory/sale?item=${encodeURIComponent(id)}`, { scroll: false }));
  }

  const item = items.find((option) => option.id === form.stockItemId);
  // The chosen item's lots; null while they load after switching items.
  const current = selection.itemId === form.stockItemId ? selection : null;
  const loading = current === null;
  const onHand = current?.onHand ?? item?.onHand ?? 0;
  const preview = salePreview({ onHand, lots: current?.lots ?? null, quantity: form.quantity, unitPrice: form.unitPrice });
  const label = item?.label ?? "—";
  const shown = error ?? (preview.short ? insufficientStockMessage(onHand, label) : undefined);

  return (
    <div className="app-inv-sale">
      <form
        noValidate
        className="app-inv-form"
        onSubmit={(event) => {
          event.preventDefault();
          // Never save before the preview for the chosen item has loaded.
          if (pending || leaving || loading || preview.short) return;
          key.current ??= crypto.randomUUID();
          submit({ ...form, idempotencyKey: key.current }, (result) => {
            if (!result.stockItemId) return;
            key.current = null;
            setLeaving(true);
            router.push(`/admin/inventory/${result.stockItemId}`);
          });
        }}
      >
        <Field label="Stock item">
          <select name="stockItemId" value={form.stockItemId} onChange={(e) => chooseItem(e.target.value)}>
            {items.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} · {option.onHand} on hand
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sale date">
          <input type="date" name="soldOn" max={today} value={form.soldOn} onChange={(e) => update("soldOn", e.target.value)} />
        </Field>
        <div role="group" aria-labelledby="buyer-label">
          <span id="buyer-label" className="app-field-label">
            Buyer
          </span>
          <div className="app-inv-toggle">
            <button
              type="button"
              aria-pressed={form.buyerType === "account"}
              onClick={() => update("buyerType", "account")}
            >
              Researcher account
            </button>
            <button
              type="button"
              aria-pressed={form.buyerType === "outside"}
              onClick={() => update("buyerType", "outside")}
            >
              Outside buyer
            </button>
          </div>
        </div>
        {form.buyerType === "account" ? (
          <BuyerAccountPicker accounts={accounts} value={form.buyerProfileId} onChange={(id) => update("buyerProfileId", id)} />
        ) : (
          <Field label="Buyer name or reference">
            <input
              name="buyerName"
              autoComplete="off"
              maxLength={120}
              placeholder={OUTSIDE_BUYER_PLACEHOLDER}
              value={form.buyerName}
              onChange={(e) => update("buyerName", e.target.value)}
            />
          </Field>
        )}
        <div className="app-inv-pair">
          <Field label="Vials">
            <input
              name="quantity"
              inputMode="numeric"
              autoComplete="off"
              placeholder="12"
              value={form.quantity}
              onChange={(e) => update("quantity", e.target.value)}
            />
          </Field>
          <Field label="Price per vial (CAD)">
            <input
              name="unitPrice"
              inputMode="decimal"
              autoComplete="off"
              placeholder="40.00"
              value={form.unitPrice}
              onChange={(e) => update("unitPrice", e.target.value)}
            />
          </Field>
        </div>
        <InlineError>{shown}</InlineError>
        <AppButton type="submit" saving={pending || leaving} savingLabel="Recording…" disabled={preview.short || loading}>
          Record sale
        </AppButton>
      </form>

      <section
        className="app-card"
        aria-labelledby="sale-preview-title"
        aria-busy={loading || loadingItem || undefined}
        data-testid="sale-preview"
      >
        <h2 id="sale-preview-title" className="app-inv-preview-title">
          Preview · {label}
        </h2>
        <dl className="app-inv-preview-grid">
          <dt>Available</dt>
          <dd data-short={preview.short || undefined} data-zero={(!preview.short && onHand === 0) || undefined}>
            {vials(preview.available)}
          </dd>
          <dt>Revenue</dt>
          <dd>{formatCurrency(preview.revenue)}</dd>
          <dt>Cost of vials sold · FIFO</dt>
          <dd>{formatCurrency(preview.cost)}</dd>
          <dt data-divider>Gross profit</dt>
          <dd data-divider data-tone={preview.grossProfit === null ? undefined : profitTone(preview.grossProfit)}>
            {formatCurrency(preview.grossProfit)}
          </dd>
        </dl>
        {preview.allocations.length > 0 ? (
          <div className="app-inv-alloc" data-testid="allocation">
            <div className="app-inv-alloc-title">Cost allocation, oldest stock first</div>
            {preview.allocations.map((allocation) => (
              <div key={allocation.purchaseId}>{previewAllocationLine(allocation)}</div>
            ))}
          </div>
        ) : null}
        <p className="app-inv-note">{SALE_PREVIEW_FOOTNOTE}</p>
      </section>
    </div>
  );
}
