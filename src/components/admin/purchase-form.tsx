"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { recordPurchaseAction } from "@/app/(private)/admin/inventory/actions";
import { AppButton, Field, InlineError } from "@/components/app-shell/form";
import { useSubmit } from "@/components/app-shell/use-submit";
import { NEW_ITEM_OPTION, PURCHASE_FOOTNOTE, purchaseTotal } from "@/lib/inventory/screens";
import "@/styles/app/inventory.css";

type Form = {
  /** A stock item id, or "new" for a new peptide / strength. */
  stockItemId: string;
  peptideId: string;
  strengthMg: string;
  receivedOn: string;
  quantity: string;
  unitCost: string;
};

/**
 * A5 Record purchase. Values go to the server exactly as typed; the server
 * validates them (first failure wins) against today in the business time
 * zone. One idempotency key per entry: reused if the same entry is retried,
 * so a double submit records once, and replaced after a successful save.
 */
export function PurchaseForm({
  items,
  peptides,
  initialItemId,
  today,
}: {
  items: { id: string; label: string }[];
  peptides: { id: string; name: string }[];
  /** A stock item id or "new". */
  initialItemId: string;
  /** Today in the business time zone: the default date received. */
  today: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form>({
    stockItemId: initialItemId,
    peptideId: peptides[0]?.id ?? "",
    strengthMg: "",
    receivedOn: today,
    quantity: "",
    unitCost: "",
  });
  const { pending, error, submit } = useSubmit(recordPurchaseAction);
  const key = useRef<string | null>(null);
  // Saved: the stock item is opening; keep the button disabled until it does.
  const [leaving, setLeaving] = useState(false);

  const update = <K extends keyof Form>(field: K, value: Form[K]) => setForm((current) => ({ ...current, [field]: value }));
  const isNew = form.stockItemId === "new";

  return (
    <form
      noValidate
      className="app-inv-page-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || leaving) return;
        key.current ??= crypto.randomUUID();
        submit({ ...form, idempotencyKey: key.current }, (result) => {
          if (!result.stockItemId) return;
          key.current = null;
          setLeaving(true);
          router.push(`/admin/inventory/${result.stockItemId}`);
        });
      }}
    >
      <div className="app-inv-form">
        <Field label="Stock item">
          <select name="stockItemId" value={form.stockItemId} onChange={(e) => update("stockItemId", e.target.value)}>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
            <option value="new">{NEW_ITEM_OPTION}</option>
          </select>
        </Field>
        {isNew ? (
          <div className="app-inv-pair">
            <Field label="Peptide">
              <select name="peptideId" value={form.peptideId} onChange={(e) => update("peptideId", e.target.value)}>
                {peptides.map((peptide) => (
                  <option key={peptide.id} value={peptide.id}>
                    {peptide.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Vial strength (mg)">
              <input
                name="strengthMg"
                inputMode="decimal"
                autoComplete="off"
                value={form.strengthMg}
                onChange={(e) => update("strengthMg", e.target.value)}
              />
            </Field>
          </div>
        ) : null}
        <Field label="Received">
          <input
            type="date"
            name="receivedOn"
            max={today}
            value={form.receivedOn}
            onChange={(e) => update("receivedOn", e.target.value)}
          />
        </Field>
        <div className="app-inv-pair">
          <Field label="Vials">
            <input
              name="quantity"
              inputMode="numeric"
              autoComplete="off"
              placeholder="10"
              value={form.quantity}
              onChange={(e) => update("quantity", e.target.value)}
            />
          </Field>
          <Field label="Cost per vial (CAD)">
            <input
              name="unitCost"
              inputMode="decimal"
              autoComplete="off"
              placeholder="20.00"
              value={form.unitCost}
              onChange={(e) => update("unitCost", e.target.value)}
            />
          </Field>
        </div>
        <div className="app-inv-total" data-testid="purchase-total">
          <span>Total purchase cost</span>
          <b>{purchaseTotal(form.quantity, form.unitCost)}</b>
        </div>
        <InlineError>{error}</InlineError>
      </div>
      <AppButton type="submit" block className="app-inv-submit" saving={pending || leaving}>
        Record purchase
      </AppButton>
      <p className="app-inv-note">{PURCHASE_FOOTNOTE}</p>
    </form>
  );
}
