"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isOnline } from "@/components/alpha/online";
import { Button } from "@/components/alpha/button";
import { buttonVariants } from "@/components/alpha/button-variants";
import { Field, TextInput } from "@/components/alpha/field";
import { NowBlock } from "@/components/alpha/now-block";
import { Segmented } from "@/components/alpha/segmented";
import { Sheet, SheetClose, SheetContent } from "@/components/alpha/sheet";
import { useAlphaToast } from "@/components/alpha/toast";
import { recordPurchaseAction } from "@/app/(private)/admin/inventory/actions";
import { money } from "@/lib/alpha/format";
import {
  COST_INVALID,
  parseCad,
  parseSupplier,
  parseVials,
  PURCHASE_ITEM_REQUIRED,
  PURCHASE_PEPTIDE_REQUIRED,
  PURCHASE_STRENGTH_INVALID,
  usdAmount,
  vialStrength,
} from "@/lib/inventory/rules";
import { FX_LOADING, fxEarlierNote } from "@/lib/inventory/screens";
import {
  FILLED_AUTOMATICALLY,
  NEW_ITEM,
  onHandLabel,
  purchaseNow,
  RECORDING_PAUSED,
  rateFor,
  rateLine,
  recordAttempt,
  recordPurchaseLabel,
  vialsOf,
  type RecordAttempt,
} from "@/lib/records/forms";
import type { UsdRatePreview } from "@/lib/records/rate";
import type { PurchaseFormData } from "@/lib/records/service";
import { cn } from "@/lib/utils";
import { SupplierField } from "./combos";
import { cardClass, DateButton, MoneyCard, NowLines, PartNote, PickerRow, RecordLoadError, RecordSkeleton, useJson } from "./parts";
import { RecordFooter } from "./sale-sheet";

type Opening = { itemId: string | null; token: number };
type Currency = "CAD" | "USD";

/** A5 Record a purchase (phone: full screen) / D5's drawer (laptop). */
export function PurchaseSheet({
  opening,
  onClose,
  onDone,
}: {
  opening: Opening | null;
  onClose: () => void;
  onDone: (token: number) => void;
}) {
  return (
    <Sheet open={opening !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      {opening ? <PurchaseContent key={opening.token} opening={opening} onDone={onDone} /> : null}
    </Sheet>
  );
}

function PurchaseContent({ opening, onDone }: { opening: Opening; onDone: (token: number) => void }) {
  const [formRound, setFormRound] = useState(0);
  // Read again after a refusal (onStale): the entry stays while it loads.
  const [form, retryForm] = useJson<PurchaseFormData>("/admin/records/purchase-form", formRound, true);
  const data = form?.status === "ready" ? form.data : null;
  return (
    <SheetContent
      title="Record purchase"
      size="screen"
      footer={data ? undefined : <SheetClose className={cn(buttonVariants({ variant: "outline", size: "lg" }), "laptop:h-12")}>Cancel</SheetClose>}
      footerOn="laptop"
    >
      {!form || form.status === "loading" ? (
        <RecordSkeleton />
      ) : form.status === "error" ? (
        <RecordLoadError message={RECORDING_PAUSED} onRetry={retryForm} />
      ) : (
        <PurchaseEntry data={data!} opening={opening} onDone={onDone} onStale={() => setFormRound((round) => round + 1)} />
      )}
    </SheetContent>
  );
}

type Problems = Partial<Record<"item" | "peptide" | "strength" | "vials" | "cost" | "supplier" | "date", string>>;

function PurchaseEntry({
  data,
  opening,
  onDone,
  onStale,
}: {
  data: PurchaseFormData;
  opening: Opening;
  onDone: (token: number) => void;
  onStale: () => void;
}) {
  const router = useRouter();
  const toast = useAlphaToast();
  const [itemId, setItemId] = useState(data.items.find((item) => item.id === opening.itemId)?.id ?? data.items[0]?.id ?? "new");
  const [peptideId, setPeptideId] = useState("");
  const [strength, setStrength] = useState("");
  const [vials, setVials] = useState("");
  const [receivedOn, setReceivedOn] = useState(data.today);
  const [currency, setCurrency] = useState<Currency>("CAD");
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [problems, setProblems] = useState<Problems>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef<RecordAttempt | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const isNew = itemId === "new";
  const item = data.items.find((entry) => entry.id === itemId) ?? null;
  const usd = currency === "USD";
  const [rateLoad, retryRate] = useJson<UsdRatePreview>(usd && receivedOn ? `/admin/records/rate?date=${receivedOn}` : null);
  const fx = rateLoad?.status === "ready" && rateLoad.data.rate && rateLoad.data.rateDate ? { rate: rateLoad.data.rate, rateDate: rateLoad.data.rateDate } : null;
  const rateError = rateLoad?.status === "error" ? { error: "Couldn't get the Bank of Canada rate. Try again in a moment.", retry: true } : rateLoad?.status === "ready" && rateLoad.data.error ? rateLoad.data : null;
  const quantity = vialsOf(vials);
  const now = purchaseNow({ quantity, currency, cost, rate: fx?.rate ?? null, onHand: isNew ? 0 : (item?.onHand ?? 0) });

  const check = (): Problems => {
    const found: Problems = {};
    if (!isNew && !item) found.item = PURCHASE_ITEM_REQUIRED;
    if (isNew && !peptideId) found.peptide = PURCHASE_PEPTIDE_REQUIRED;
    if (isNew && !vialStrength(strength)) found.strength = PURCHASE_STRENGTH_INVALID;
    const count = parseVials(vials);
    if (!count.ok) found.vials = count.error;
    const amount = usd ? usdAmount(cost) : parseCad(cost, COST_INVALID);
    if (!amount.ok) found.cost = amount.error;
    const name = parseSupplier(supplier);
    if (!name.ok) found.supplier = name.error;
    return found;
  };

  const send = async (payload: Record<string, unknown>, attempt: RecordAttempt) => {
    if (!isOnline()) return; // offline: the toast's Retry waits for the connection; nothing is sent
    const unsure = (text: string) =>
      toast.error({ message: text, action: { label: "Retry", onAction: () => void send(payload, attempt) } });
    setSaving(true);
    try {
      const result = await recordPurchaseAction(payload);
      if (!result.unsure && pending.current === attempt) pending.current = null;
      if (result.unsure) {
        unsure(result.error ?? "Couldn't confirm it was recorded.");
        return;
      }
      if (result.error) {
        if (mounted.current) setMessage(result.error);
        else toast.error({ message: result.error });
        if (usd) retryRate();
        return;
      }
      if (result.stockItemId && result.toast) {
        toast.success({ message: result.toast });
        router.refresh();
        onDone(opening.token);
        return;
      }
      if (result.toast) {
        toast.error({ message: result.toast });
        onStale();
      }
    } catch {
      unsure("Couldn't confirm it was recorded. Retry sends the same purchase, so it's never recorded twice.");
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const record = () => {
    // Offline, a save waits for the connection (the button is disabled; this covers Enter and keyboard submits).
    if (!isOnline()) return;
    const found = check();
    setProblems(found);
    setMessage(null);
    if (Object.keys(found).length > 0 || (usd && !fx)) return;
    const entry = {
      stockItemId: itemId,
      peptideId: isNew ? peptideId : "",
      strengthMg: isNew ? strength.trim() : "",
      receivedOn,
      quantity: String(quantity),
      currency,
      unitCost: cost.trim(),
      supplier: supplier.trim(),
    };
    const attempt = recordAttempt(pending.current, entry, () => crypto.randomUUID());
    pending.current = attempt;
    void send({ ...entry, idempotencyKey: attempt.key }, attempt);
  };

  const earlier = fx ? fxEarlierNote(fx, receivedOn, data.today) : null;
  const itemOptions = [
    ...data.items.map((entry) => ({ value: entry.id, label: `${entry.label} · ${onHandLabel(entry.onHand)}` })),
    { value: "new", label: NEW_ITEM },
  ];
  const blocked = saving || (usd && !fx);

  return (
    <form
      noValidate
      className="flex flex-1 flex-col gap-2.5"
      data-testid="purchase-form"
      onSubmit={(event) => {
        event.preventDefault();
        record();
      }}
    >
      <PickerRow
        label="Item"
        testId="purchase-item"
        value={isNew ? NEW_ITEM : (item?.label ?? "Choose an item")}
        meta={item ? onHandLabel(item.onHand) : undefined}
        options={itemOptions}
        selected={itemId}
        onSelect={setItemId}
        invalid={Boolean(problems.item)}
      />
      {isNew ? (
        <div className="grid grid-cols-[minmax(0,1fr)_128px] gap-2.5">
          <div>
            <PickerRow
              label="Peptide"
              testId="purchase-peptide"
              value={data.peptides.find((peptide) => peptide.id === peptideId)?.name ?? "Choose"}
              options={data.peptides.map((peptide) => ({ value: peptide.id, label: peptide.name }))}
              selected={peptideId}
              placeholder="Choose the peptide"
              onSelect={setPeptideId}
              invalid={Boolean(problems.peptide)}
            />
            {problems.peptide ? <PartNote error>{problems.peptide}</PartNote> : null}
          </div>
          <Field label="Strength" error={problems.strength} className="[&>label]:sr-only">
            <TextInput
              data-testid="purchase-strength"
              inputMode="decimal"
              autoComplete="off"
              placeholder="mg"
              value={strength}
              onChange={(event) => setStrength(event.currentTarget.value)}
              className="h-16 rounded-[16px] text-[17px] font-semibold"
            />
          </Field>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5">
        <div className={cn(cardClass(false, Boolean(problems.vials)), "px-3.5 py-2.5")}>
          <label htmlFor="purchase-vials-input" className="text-[12px] text-ink-3">
            Vials received
          </label>
          <input
            id="purchase-vials-input"
            data-testid="purchase-vials"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            value={vials}
            aria-invalid={Boolean(problems.vials) || undefined}
            onChange={(event) => setVials(event.currentTarget.value)}
            className="mt-1 block w-full bg-transparent text-[26px] font-semibold text-ink outline-none placeholder:text-ink-3"
          />
        </div>
        <div className={cn(cardClass(), "px-3.5 py-2.5")}>
          <span className="text-[12px] text-ink-3">Received</span>
          <div className="mt-[9px] font-mono text-[17px] font-semibold">
            <DateButton value={receivedOn} max={data.today} onChange={setReceivedOn} label="Date received" testId="purchase-date" />
          </div>
        </div>
      </div>
      {problems.vials ? (
        <PartNote error testId="purchase-vials-error">
          {problems.vials}
        </PartNote>
      ) : null}

      <div className="grid grid-cols-[120px_minmax(0,1fr)] items-stretch gap-2.5 laptop:grid-cols-[110px_minmax(0,1fr)]">
        <Segmented<Currency>
          aria-label="Currency"
          value={currency}
          onValueChange={(next) => {
            setCurrency(next);
            setMessage(null);
          }}
          mono
          options={[
            { value: "CAD", label: "CAD" },
            { value: "USD", label: "USD" },
          ]}
          className="h-auto auto-rows-fr grid-flow-row rounded-[14px] [&>*]:rounded-[11px]"
        />
        <MoneyCard
          label="Cost per vial"
          prefix={usd ? "US$" : "$"}
          testId="purchase-cost"
          value={cost}
          onChange={setCost}
          invalid={Boolean(problems.cost)}
        />
      </div>
      {problems.cost ? (
        <PartNote error testId="purchase-cost-error">
          {problems.cost}
        </PartNote>
      ) : null}

      {usd ? (
        <section className={cn(cardClass(), "px-4 py-3")} aria-live="polite" data-testid="rate-card">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium text-ink-2">Bank of Canada rate</span>
            {fx ? <span className="font-mono text-[12px] text-ink-3">{rateFor(fx.rateDate)}</span> : null}
          </div>
          {fx ? (
            <>
              <div className="mt-1.5 font-mono text-[18px] font-semibold" data-testid="fx-rate">
                {rateLine(fx.rate)}
              </div>
              <div className="mt-1 text-[13px] text-ink-3">{FILLED_AUTOMATICALLY}</div>
              {earlier ? (
                <p className="mt-1.5 text-[13px] text-ink-3" data-testid="fx-note">
                  {earlier}
                </p>
              ) : null}
            </>
          ) : rateError ? (
            <div className="mt-1.5 text-[14px] text-missed" role="alert" data-testid="fx-rate">
              {rateError.error}{" "}
              {rateError.retry ? (
                <button type="button" onClick={retryRate} className="cursor-pointer font-semibold text-signal-ink">
                  Try again
                </button>
              ) : null}
            </div>
          ) : (
            <div className="mt-1.5 text-[14px] text-ink-3" data-testid="fx-rate">
              {FX_LOADING}
            </div>
          )}
        </section>
      ) : null}

      <div>
        <SupplierField suppliers={data.suppliers.map((entry) => entry.name)} value={supplier} onChange={setSupplier} invalid={Boolean(problems.supplier)} />
        {problems.supplier ? (
          <PartNote error testId="purchase-supplier-error">
            {problems.supplier}
          </PartNote>
        ) : null}
      </div>

      <NowBlock className="rounded-[24px] px-[18px] pt-4 pb-3 laptop:rounded-[24px]" data-testid="purchase-now" aria-live="polite">
        <div className="text-[13px] text-on-ink-2">Total cost</div>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="text-[40px] leading-none font-semibold tracking-[-0.04em]" data-testid="purchase-total">
            {now.total !== null ? money(now.total) : "—"}
          </span>
          <span className="font-mono text-[14px] text-on-ink-2">CAD</span>
        </div>
        <NowLines
          lines={[
            ...(usd ? [{ key: "usd", label: now.usdLine?.label ?? "In USD", amount: now.usdLine?.amount ?? "—", testId: "purchase-usd-line" }] : []),
            { key: "after", label: "Per vial in CAD · stock after", amount: now.perVialAfter ?? "—", testId: "purchase-after" },
          ]}
        />
      </NowBlock>

      {message ? (
        <p role="alert" className="px-1 text-[14px] font-medium text-missed" data-testid="purchase-message">
          {message}
        </p>
      ) : null}

      <RecordFooter>
        <Button needsConnection type="submit" size="lg" className="laptop:h-12" saving={saving} savingLabel="Recording…" disabled={blocked && !saving} data-testid="record-purchase">
          {recordPurchaseLabel(now.total)}
        </Button>
      </RecordFooter>
    </form>
  );
}
