"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { recordPurchaseAction, usdRatePreviewAction } from "@/app/(private)/admin/inventory/actions";
import { AppButton, Field, InlineError } from "@/components/app-shell/form";
import { useSubmit } from "@/components/app-shell/use-submit";
import { formatCurrency } from "@/lib/format";
import {
  CURRENCY_OPTIONS,
  FX_LOADING,
  FX_UNAVAILABLE,
  fxEarlierNote,
  fxRateLine,
  NEW_ITEM_OPTION,
  PURCHASE_FOOTNOTE,
  purchaseTotal,
  USD_NOTE,
  usdPreview,
  type PurchaseCurrency,
} from "@/lib/inventory/screens";
import "@/styles/app/inventory.css";

type Form = {
  /** A stock item id, or "new" for a new peptide / strength. */
  stockItemId: string;
  peptideId: string;
  strengthMg: string;
  receivedOn: string;
  quantity: string;
  /** CAD (the default) or USD: the currency `unitCost` is typed in. */
  currency: PurchaseCurrency;
  unitCost: string;
};

/**
 * A5 Record purchase. Values go to the server exactly as typed; the server
 * validates them (first failure wins) against today in the business time
 * zone. One idempotency key per entry: reused if the same entry is retried,
 * so a double submit records once, and replaced after a successful save.
 * A USD cost is converted on the server with the Bank of Canada rate it
 * fetches when saving; the preview here only shows that rate.
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
    currency: "CAD",
    unitCost: "",
  });
  const { pending, error, submit } = useSubmit(recordPurchaseAction);
  const key = useRef<string | null>(null);
  // Saved: the stock item is opening; keep the button disabled until it does.
  const [leaving, setLeaving] = useState(false);
  // Bumped after every save attempt that stays on the form: the USD preview
  // asks for its rate again, so a form left open across the day's publication
  // (or a newer stored rate) shows the current rate. Not after a save that
  // opens the stock item: a preview request still in flight would hold up
  // that navigation (Next runs Server Actions and navigations in order).
  const [previewRound, setPreviewRound] = useState(0);

  const update = <K extends keyof Form>(field: K, value: Form[K]) => setForm((current) => ({ ...current, [field]: value }));
  const isNew = form.stockItemId === "new";
  const usd = form.currency === "USD";

  return (
    <form
      noValidate
      className="app-inv-page-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || leaving) return;
        key.current ??= crypto.randomUUID();
        submit({ ...form, idempotencyKey: key.current }, (result) => {
          if (!result.stockItemId) {
            setPreviewRound((round) => round + 1);
            return;
          }
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
        <div role="group" aria-labelledby="currency-label">
          <span id="currency-label" className="app-field-label">
            Cost currency
          </span>
          <div className="app-inv-toggle">
            {CURRENCY_OPTIONS.map((currency) => (
              <button key={currency} type="button" aria-pressed={form.currency === currency} onClick={() => update("currency", currency)}>
                {currency}
              </button>
            ))}
          </div>
        </div>
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
          <Field label={`Cost per vial (${form.currency})`}>
            <input
              name="unitCost"
              inputMode="decimal"
              autoComplete="off"
              placeholder={usd ? "11.00" : "20.00"}
              value={form.unitCost}
              onChange={(e) => update("unitCost", e.target.value)}
            />
          </Field>
        </div>
        {usd ? (
          <UsdPreview key={previewRound} receivedOn={form.receivedOn} today={today} quantity={form.quantity} unitCost={form.unitCost} />
        ) : (
          <div className="app-inv-total" data-testid="purchase-total">
            <span>Total purchase cost</span>
            <b>{purchaseTotal(form.quantity, form.unitCost)}</b>
          </div>
        )}
        <InlineError>{error}</InlineError>
      </div>
      <AppButton type="submit" block className="app-inv-submit" saving={pending || leaving}>
        Record purchase
      </AppButton>
      <p className="app-inv-note">{PURCHASE_FOOTNOTE}</p>
    </form>
  );
}

type RateResult = { rate: string; rateDate: string } | { error: string };

/**
 * The USD summary card: the Bank of Canada rate for the date received (asked
 * of the server once per date) and the CAD cost per vial and in total it
 * gives. Display only; the save converts again on the server.
 */
function UsdPreview({ receivedOn, today, quantity, unitCost }: { receivedOn: string; today: string; quantity: string; unitCost: string }) {
  const [rates, setRates] = useState<Record<string, RateResult>>({});
  const [, startTransition] = useTransition();
  // A complete date that isn't in the future (the date input gives YYYY-MM-DD or "").
  const date = /^\d{4}-\d{2}-\d{2}$/.test(receivedOn) && receivedOn <= today ? receivedOn : null;
  const result = date ? rates[date] : undefined;
  const known = result !== undefined;

  useEffect(() => {
    if (!date || known) return;
    startTransition(async () => {
      let answer: RateResult;
      try {
        const preview = await usdRatePreviewAction(date);
        answer = preview.rate && preview.rateDate ? { rate: preview.rate, rateDate: preview.rateDate } : { error: preview.error ?? FX_UNAVAILABLE };
      } catch (error) {
        unstable_rethrow(error);
        answer = { error: FX_UNAVAILABLE };
      }
      setRates((current) => ({ ...current, [date]: answer }));
    });
  }, [date, known]);

  const fx = result && "rate" in result ? result : null;
  const amounts = fx ? usdPreview(quantity, unitCost, fx.rate) : null;
  const earlier = fx && date ? fxEarlierNote(fx, date, today) : null;

  return (
    <section className="app-inv-total app-inv-fx" aria-live="polite" data-testid="usd-preview">
      <div className="app-inv-fx-rate" data-testid="fx-rate">
        {!date ? (
          "Enter the date received to get the Bank of Canada rate."
        ) : !result ? (
          FX_LOADING
        ) : fx ? (
          fxRateLine(fx)
        ) : (
          <>
            <span className="app-inv-fx-error">{"error" in result ? result.error : FX_UNAVAILABLE}</span>{" "}
            <button
              type="button"
              className="app-inv-fx-retry"
              onClick={() =>
                setRates((current) => {
                  const next = { ...current };
                  delete next[date];
                  return next;
                })
              }
            >
              Try again
            </button>
          </>
        )}
      </div>
      {earlier ? <p className="app-inv-fx-note">{earlier}</p> : null}
      <dl className="app-inv-fx-grid">
        <dt>Cost per vial (CAD)</dt>
        <dd data-testid="usd-preview-unit">{formatCurrency(amounts?.unitCost)}</dd>
        <dt>Total purchase cost</dt>
        <dd data-testid="purchase-total">
          <b>{formatCurrency(amounts?.total)}</b>
        </dd>
      </dl>
      <p className="app-inv-fx-note">{USD_NOTE}</p>
    </section>
  );
}
