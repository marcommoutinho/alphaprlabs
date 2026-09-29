"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import { Combobox } from "@base-ui/react/combobox";
import { X } from "lucide-react";
import { useAlphaPortal } from "@/components/alpha/root";
import { Tag } from "@/components/alpha/tag";
import { accountMatches } from "@/lib/inventory/screens";
import { BUYER_NO_MATCH, BUYER_PLACEHOLDER, SUPPLIER_PLACEHOLDER } from "@/lib/records/forms";
import type { RecordBuyer } from "@/lib/records/service";
import { cn } from "@/lib/utils";

/** Rows rendered at once; typing narrows the rest down. */
const SHOWN = 50;
/** Text the admin typed or pasted (not a sync from picking or closing). */
const TYPED = new Set(["input-change", "input-paste"]);

const fieldClass = (invalid: boolean) =>
  cn(
    "flex h-[52px] items-center gap-2 rounded-[14px] border bg-surface pr-1.5 pl-3.5",
    "focus-within:border-ink focus-within:shadow-[inset_0_0_0_1px_var(--ink)]",
    invalid ? "border-missed shadow-[inset_0_0_0_1px_var(--missed)]" : "border-line",
  );
const inputClass = "h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3";
const popupClass =
  "max-h-[min(320px,var(--available-height))] w-[var(--anchor-width)] overflow-y-auto rounded-[14px] border border-line bg-surface p-1 text-ink shadow-[var(--sheet-shadow)]";
const itemClass =
  "flex min-h-11 cursor-pointer flex-col justify-center rounded-[10px] px-3 py-1.5 text-[15px] data-highlighted:bg-sunken";

/**
 * A4 Buyer: a researcher account (admins are researchers too), searched by
 * name or email, or any name typed for an outside buyer. Blank to start.
 * Picking an account shows its name with the "Researcher" tag; editing the
 * text afterwards makes it a typed name again, so a sale can never go to an
 * account other than the one shown. The clear button empties both.
 */
export function BuyerField({
  buyers,
  text,
  accountId,
  onChange,
  invalid,
  describedBy,
}: {
  buyers: readonly RecordBuyer[];
  text: string;
  accountId: string | null;
  onChange: (next: { text: string; accountId: string | null }) => void;
  invalid: boolean;
  describedBy: string;
}) {
  const container = useAlphaPortal();
  const selected = buyers.find((buyer) => buyer.id === accountId) ?? null;
  return (
    <Combobox.Root<RecordBuyer>
      items={buyers as RecordBuyer[]}
      value={selected}
      onValueChange={(buyer) => {
        if (buyer) onChange({ text: buyer.name, accountId: buyer.id });
      }}
      inputValue={text}
      onInputValueChange={(next, details) => {
        if (TYPED.has(details.reason)) onChange({ text: next, accountId: null });
      }}
      itemToStringLabel={(buyer) => buyer.name}
      itemToStringValue={(buyer) => buyer.id}
      filter={(buyer, query) => accountMatches(buyer, query)}
      limit={SHOWN}
      autoHighlight
    >
      <div className={fieldClass(invalid)}>
        <Combobox.Input
          aria-label="Buyer"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          data-testid="buyer-input"
          placeholder={BUYER_PLACEHOLDER}
          autoComplete="off"
          className={inputClass}
        />
        {selected ? <Tag tone="role" data-testid="buyer-researcher">Researcher</Tag> : null}
        {text ? (
          <button
            type="button"
            aria-label="Clear buyer"
            onClick={() => onChange({ text: "", accountId: null })}
            className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-3"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      <Combobox.Portal container={container}>
        <Combobox.Positioner className="z-[95] outline-none" sideOffset={6}>
          <Combobox.Popup className={popupClass}>
            <Combobox.Empty className="px-3 py-2.5 text-[14px] text-ink-3 empty:hidden">{text.trim() ? BUYER_NO_MATCH : null}</Combobox.Empty>
            <Combobox.List>
              {(buyer: RecordBuyer) => (
                <Combobox.Item key={buyer.id} value={buyer} className={itemClass} data-testid="buyer-option">
                  <span className="font-semibold">{buyer.name}</span>
                  <span className="truncate font-mono text-[12px] text-ink-3">{buyer.email}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

/**
 * A5 "Supplier · optional": any name, with the suppliers already recorded
 * offered as the admin types (case and spacing don't make a new one: the
 * Ledger and Overview group them).
 */
export function SupplierField({
  suppliers,
  value,
  onChange,
  invalid,
}: {
  suppliers: readonly string[];
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}) {
  const container = useAlphaPortal();
  return (
    <Autocomplete.Root items={suppliers as string[]} value={value} onValueChange={(next) => onChange(next)} openOnInputClick>
      <div className={fieldClass(invalid)}>
        <Autocomplete.Input
          aria-label="Supplier (optional)"
          aria-invalid={invalid || undefined}
          data-testid="supplier-input"
          placeholder={SUPPLIER_PLACEHOLDER}
          autoComplete="off"
          maxLength={200}
          className={inputClass}
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear supplier"
            onClick={() => onChange("")}
            className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-3"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      <Autocomplete.Portal container={container}>
        <Autocomplete.Positioner className="z-[95] outline-none" sideOffset={6}>
          <Autocomplete.Popup className={cn(popupClass, "empty:hidden")}>
            <Autocomplete.List>
              {(supplier: string) => (
                <Autocomplete.Item key={supplier} value={supplier} className={itemClass} data-testid="supplier-option">
                  {supplier}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
