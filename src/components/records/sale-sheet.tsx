"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isOnline } from "@/components/alpha/online";
import { Button } from "@/components/alpha/button";
import { buttonVariants } from "@/components/alpha/button-variants";
import { NowBlock } from "@/components/alpha/now-block";
import { Segmented } from "@/components/alpha/segmented";
import { Sheet, SheetClose, SheetContent } from "@/components/alpha/sheet";
import { useAlphaToast } from "@/components/alpha/toast";
import { recordSaleAction } from "@/app/(private)/admin/inventory/actions";
import { money } from "@/lib/alpha/format";
import { sellerFirst } from "@/lib/business/overview";
import { BUYER_NAME_TOO_LONG, INVENTORY_LIMITS, parseCad, parseVials, PRICE_INVALID } from "@/lib/inventory/rules";
import { NO_SELLERS } from "@/lib/inventory/seller-screens";
import {
  BUYER_HELPER,
  BUYER_REQUIRED,
  cadOf,
  expectedAllocation,
  ITEM_REQUIRED,
  NO_ITEMS,
  onHandLabel,
  onlyOnHand,
  PREVIEW_UNAVAILABLE,
  RECORDING_PAUSED,
  recordAttempt,
  recordSaleLabel,
  saleNow,
  vialsOf,
  type RecordAttempt,
  type SalePreview,
} from "@/lib/records/forms";
import type { SaleFormData } from "@/lib/records/service";
import { cn } from "@/lib/utils";
import { BuyerField } from "./combos";
import { DateButton, MoneyCard, NowLines, PartLabel, PartNote, PickerRow, RecordLoadError, RecordSkeleton, Stepper, useJson, useSettled } from "./parts";
import { useRecorder } from "./record-provider";

type Opening = { itemId: string | null; token: number };

/** A4 Record a sale (phone: full screen) / D4's drawer (laptop). */
export function SaleSheet({
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
      {opening ? <SaleContent key={opening.token} opening={opening} onDone={onDone} /> : null}
    </Sheet>
  );
}

type Problems = Partial<Record<"item" | "vials" | "price" | "seller" | "buyer", string>>;

function SaleContent({ opening, onDone }: { opening: Opening; onDone: (token: number) => void }) {
  const [formRound, setFormRound] = useState(0);
  // Read again after a refusal (onStale): the entry stays while it loads.
  const [form, retryForm] = useJson<SaleFormData>("/admin/records/sale-form", formRound, true);
  const data = form?.status === "ready" ? form.data : null;
  const [soldOn, setSoldOn] = useState("");
  const date = soldOn || data?.today || "";

  return (
    <SheetContent
      title="Record sale"
      size="screen"
      context={data ? <DateButton value={date} max={data.today} onChange={setSoldOn} label="Sale date" testId="sale-date" /> : " "}
      footer={data && data.items.length > 0 ? undefined : <FooterCancelOnly />}
      footerOn="laptop"
    >
      {!form || form.status === "loading" ? (
        <RecordSkeleton />
      ) : form.status === "error" ? (
        <RecordLoadError message={RECORDING_PAUSED} onRetry={retryForm} />
      ) : data!.items.length === 0 ? (
        <NoStock />
      ) : (
        <SaleEntry data={data!} soldOn={date} opening={opening} onDone={onDone} onStale={() => setFormRound((round) => round + 1)} />
      )}
    </SheetContent>
  );
}

function FooterCancelOnly() {
  return (
    <SheetClose className={cn(buttonVariants({ variant: "outline", size: "lg" }), "laptop:h-12")}>Cancel</SheetClose>
  );
}

/** No stock item exists yet: a sale needs a purchase first. */
function NoStock() {
  const recorder = useRecorder();
  return (
    <div className="rounded-[20px] border-[1.5px] border-dashed border-ink-3 px-5 py-5" data-testid="record-no-stock">
      <p className="text-[15px] leading-[1.45] text-ink-2">{NO_ITEMS}</p>
      <Button variant="ink" size="md" className="mt-3" onClick={() => recorder.open("purchase")}>
        Record a purchase
      </Button>
    </div>
  );
}

function SaleEntry({
  data,
  soldOn,
  opening,
  onDone,
  onStale,
}: {
  data: SaleFormData;
  soldOn: string;
  opening: Opening;
  onDone: (token: number) => void;
  /** Counts may have changed: read the form's data again (the entry stays). */
  onStale: () => void;
}) {
  const router = useRouter();
  const toast = useAlphaToast();
  const startItem =
    data.items.find((item) => item.id === opening.itemId)?.id ?? data.items.find((item) => item.onHand > 0)?.id ?? data.items[0].id;
  const [itemId, setItemId] = useState(startItem);
  const [vials, setVials] = useState("1");
  const [price, setPrice] = useState("");
  const [sellerId, setSellerId] = useState(data.defaultSellerId);
  const [buyer, setBuyer] = useState<{ text: string; accountId: string | null }>({ text: "", accountId: null });
  const [problems, setProblems] = useState<Problems>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewRound, setPreviewRound] = useState(0);
  // The submission waiting for a sure answer: Retry (or Record with the
  // same entry) reuses its request key, so it's never recorded twice.
  const pending = useRef<RecordAttempt | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const item = data.items.find((entry) => entry.id === itemId) ?? null;
  const quantity = vialsOf(vials);
  const unitPrice = cadOf(price);
  const knownShort = item !== null && quantity !== null && quantity > item.onHand;
  const previewUrl = useSettled(
    item && quantity !== null && !knownShort ? `/admin/records/sale-preview?item=${item.id}&vials=${quantity}` : null,
  );
  const [previewLoad, retryPreview] = useJson<SalePreview>(previewUrl, previewRound);
  const preview = previewLoad?.status === "ready" && previewLoad.data.stockItemId === item?.id ? previewLoad.data : null;
  const onHand = preview ? preview.onHand : (item?.onHand ?? 0);
  const short = knownShort || (preview?.short ?? false);
  const now = saleNow({ quantity, price: unitPrice, preview });
  const previewFailed = previewLoad?.status === "error";
  const previewPending = !short && quantity !== null && (previewUrl === null || previewLoad?.status === "loading" || preview?.quantity !== quantity);

  const sellers = data.sellers;
  const firsts = sellers.map((seller) => sellerFirst(seller.name));
  const segmented = sellers.length > 0 && sellers.length <= 3 && new Set(firsts.map((name) => name.toLocaleLowerCase("en-CA"))).size === sellers.length;

  const vialsError = problems.vials ?? (short ? onlyOnHand(onHand) : undefined);

  const check = (): Problems => {
    const found: Problems = {};
    if (!item) found.item = ITEM_REQUIRED;
    const count = parseVials(vials);
    if (!count.ok) found.vials = count.error;
    const amount = parseCad(price, PRICE_INVALID);
    if (!amount.ok) found.price = amount.error;
    if (!sellers.some((seller) => seller.id === sellerId)) found.seller = sellers.length ? "Choose who made the sale." : NO_SELLERS;
    const name = buyer.text.trim();
    if (!buyer.accountId && !name) found.buyer = BUYER_REQUIRED;
    else if (!buyer.accountId && name.length > INVENTORY_LIMITS.buyerName) found.buyer = BUYER_NAME_TOO_LONG;
    return found;
  };

  const send = async (payload: Record<string, unknown>, attempt: RecordAttempt) => {
    const unsure = (text: string) =>
      toast.error({ message: text, action: { label: "Retry", onAction: () => void send(payload, attempt) } });
    setSaving(true);
    try {
      const result = await recordSaleAction(payload);
      if (!result.unsure && pending.current === attempt) pending.current = null;
      if (result.unsure) {
        unsure(result.error ?? "Couldn't confirm it was recorded.");
        return;
      }
      if (result.stockChanged) {
        // Nothing was recorded: a new preview (and new counts) before recording again.
        if (mounted.current) setMessage(result.error ?? null);
        else toast.error({ message: result.error ?? "Stock changed. Nothing was recorded." });
        setPreviewRound((round) => round + 1);
        onStale();
        return;
      }
      if (result.error) {
        if (mounted.current) setMessage(result.error);
        else toast.error({ message: result.error });
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
      // No answer at all (the connection dropped): it may have been recorded.
      unsure("Couldn't confirm it was recorded. Retry sends the same sale, so it's never recorded twice.");
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
    if (Object.keys(found).length > 0 || short || !preview || preview.quantity !== quantity) return;
    const entry = {
      stockItemId: item!.id,
      soldOn,
      quantity: String(quantity),
      unitPrice: unitPrice!,
      sellerId,
      buyerType: buyer.accountId ? "account" : "outside",
      buyerProfileId: buyer.accountId ?? "",
      buyerName: buyer.accountId ? "" : buyer.text.trim(),
    };
    // The key follows the entry, not the preview: a replay is the same sale
    // whatever stock has done since.
    const attempt = recordAttempt(pending.current, entry, () => crypto.randomUUID());
    pending.current = attempt;
    void send({ ...entry, idempotencyKey: attempt.key, expectedAllocation: expectedAllocation(preview) }, attempt);
  };

  const blocked = saving || short || previewFailed || previewPending || sellers.length === 0;

  return (
    <form
      noValidate
      className="flex flex-1 flex-col gap-2.5"
      data-testid="sale-form"
      onSubmit={(event) => {
        event.preventDefault();
        record();
      }}
    >
      <PickerRow
        label="Item"
        testId="sale-item"
        value={item?.label ?? "Choose an item"}
        meta={item ? onHandLabel(onHand) : undefined}
        options={data.items.map((entry) => ({ value: entry.id, label: `${entry.label} · ${onHandLabel(entry.onHand)}` }))}
        selected={itemId}
        onSelect={(id) => {
          setItemId(id);
          setMessage(null);
        }}
        invalid={Boolean(problems.item)}
      />

      <div className="grid grid-cols-2 gap-2.5">
        <Stepper label="Vials" testId="sale-vials" value={vials} onChange={setVials} invalid={Boolean(vialsError)} />
        <MoneyCard label="Price per vial" prefix="$" unit="CAD" testId="sale-price" value={price} onChange={setPrice} invalid={Boolean(problems.price)} />
      </div>
      {vialsError || problems.price ? (
        <div className="-mt-1">
          {vialsError ? (
            <PartNote error testId="sale-vials-error">
              {vialsError}
            </PartNote>
          ) : null}
          {problems.price ? (
            <PartNote error testId="sale-price-error">
              {problems.price}
            </PartNote>
          ) : null}
        </div>
      ) : null}

      <div>
        <PartLabel id="seller-label">Seller</PartLabel>
        <div className="mt-1.5">
          {segmented ? (
            <Segmented<string>
              aria-labelledby="seller-label"
              value={sellerId}
              onValueChange={setSellerId}
              options={sellers.map((seller, index) => ({ value: seller.id, label: firsts[index] }))}
            />
          ) : sellers.length > 0 ? (
            <PickerRow
              label="Seller"
              testId="sale-seller"
              value={sellers.find((seller) => seller.id === sellerId)?.label ?? "Choose the seller"}
              options={sellers.map((seller) => ({ value: seller.id, label: seller.label }))}
              selected={sellerId}
              placeholder="Choose the seller"
              onSelect={setSellerId}
              invalid={Boolean(problems.seller)}
            />
          ) : null}
        </div>
        {problems.seller ? (
          <PartNote error testId="sale-seller-error">
            {problems.seller}
          </PartNote>
        ) : null}
      </div>

      <div>
        <PartLabel>Buyer</PartLabel>
        <div className="mt-1.5">
          <BuyerField
            buyers={data.buyers}
            text={buyer.text}
            accountId={buyer.accountId}
            onChange={(next) => {
              setBuyer(next);
              if (problems.buyer) setProblems((current) => ({ ...current, buyer: undefined }));
            }}
            invalid={Boolean(problems.buyer)}
            describedBy="buyer-note"
          />
        </div>
        <div id="buyer-note">
          <PartNote error={Boolean(problems.buyer)} testId={problems.buyer ? "sale-buyer-error" : "buyer-helper"}>
            {problems.buyer ?? BUYER_HELPER}
          </PartNote>
        </div>
      </div>

      <NowBlock
        className="rounded-[24px] px-[18px] pt-4 pb-3 laptop:rounded-[24px]"
        data-testid="sale-now"
        aria-live="polite"
        aria-busy={previewPending || undefined}
      >
        <div className="text-[13px] text-on-ink-2">Gross profit on this sale</div>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="text-[40px] leading-none font-semibold tracking-[-0.04em]" data-testid="sale-gross-profit">
            {now.grossProfit !== null ? money(now.grossProfit) : "—"}
          </span>
          <span className="font-mono text-[14px] text-on-ink-2">CAD</span>
        </div>
        <NowLines
          lines={[
            { key: "revenue", label: now.revenueLabel, amount: now.revenue !== null ? money(now.revenue) : "—", testId: "sale-revenue" },
            ...(now.costLines.length > 0
              ? now.costLines.map((line) => ({ ...line, testId: "sale-cost-line" }))
              : [
                  {
                    key: "cost",
                    testId: "sale-cost-line",
                    label: short ? "Cost · not enough stock" : previewFailed ? PREVIEW_UNAVAILABLE : "Cost",
                    amount: previewFailed ? (
                      <button type="button" onClick={retryPreview} className="cursor-pointer text-surface underline underline-offset-2">
                        Try again
                      </button>
                    ) : (
                      "—"
                    ),
                  },
                ]),
          ]}
        />
      </NowBlock>

      {message ? (
        <p role="alert" className="px-1 text-[14px] font-medium text-missed" data-testid="sale-message">
          {message}
        </p>
      ) : null}

      <RecordFooter>
        <Button needsConnection type="submit" size="lg" className="laptop:h-12" saving={saving} savingLabel="Recording…" disabled={blocked && !saving} data-testid="record-sale">
          {recordSaleLabel(now.revenue)}
        </Button>
      </RecordFooter>
    </form>
  );
}

/**
 * The sheet's footer, rendered from inside the form (so Enter and the
 * button submit it): pinned to the bottom of the scroll area on the phone
 * (56 px signal button over the paper), with Cancel beside it on a laptop.
 */
export function RecordFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-3 mt-auto -mb-3.5 flex gap-2 border-t border-line bg-paper px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] laptop:-mx-6 laptop:px-6 laptop:pb-5 [&>*:last-child]:flex-1">
      <SheetClose className={cn(buttonVariants({ variant: "outline", size: "lg" }), "hidden w-[100px] laptop:inline-flex laptop:h-12")}>
        Cancel
      </SheetClose>
      {children}
    </div>
  );
}
