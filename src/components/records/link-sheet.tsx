"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Combobox } from "@base-ui/react/combobox";
import { Button } from "@/components/alpha/button";
import { isOnline } from "@/components/alpha/online";
import { buttonVariants } from "@/components/alpha/button-variants";
import { Checkbox } from "@/components/alpha/field";
import { useAlphaPortal } from "@/components/alpha/root";
import { Sheet, SheetClose, SheetContent } from "@/components/alpha/sheet";
import { useAlphaToast } from "@/components/alpha/toast";
import { linkSaleAction } from "@/app/(private)/admin/inventory/actions";
import { accountLabel, accountMatches, BUYER_SEARCH_EMPTY, BUYER_SEARCH_PLACEHOLDER } from "@/lib/inventory/screens";
import { LINK_BUTTON, LINK_NOTE, LINK_SUBMIT, LINK_TITLE, linkSameNameLabel } from "@/lib/inventory/seller-screens";
import type { BuyerAccount } from "@/lib/inventory/service";
import { cn } from "@/lib/utils";

const TYPED = new Set(["input-change", "input-paste"]);

/**
 * "Link to account…" on an outside buyer's sale (Marco, 2026-09-27), as a
 * sheet (a drawer on a laptop): the account, searched by name or email, and
 * optionally every other outside sale recorded with the same name. The same
 * action and rules as before (linkSaleAction): a buyer reference only.
 */
export function LinkSaleSheet({ saleId, buyerName, accounts }: { saleId: string; buyerName: string; accounts: BuyerAccount[] }) {
  const router = useRouter();
  const toast = useAlphaToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [profileId, setProfileId] = useState("");
  const [sameName, setSameName] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const container = useAlphaPortal();
  const selected = accounts.find((account) => account.id === profileId) ?? null;

  const link = async () => {
    if (!isOnline()) return; // offline: the button says so; nothing is sent
    // Only the account the field shows is linked.
    const id = selected && accountLabel(selected) === text ? selected.id : "";
    setSaving(true);
    try {
      const result = await linkSaleAction({ saleId, profileId: id, sameName });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      if (result.toast) (result.linked ? toast.success : toast.error)({ message: result.toast });
      router.refresh();
    } catch {
      setError("Couldn't link it. Nothing changed. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setText("");
          setProfileId("");
          setSameName(false);
          setError(null);
          setOpen(true);
        }}
        className="h-9 cursor-pointer rounded-[10px] bg-sunken px-3 text-[14px] font-semibold text-ink"
      >
        {LINK_BUTTON}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          title={LINK_TITLE}
          context={buyerName}
          size="auto"
          footer={
            <>
              <SheetClose className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-[100px] laptop:h-12")}>Cancel</SheetClose>
              <Button size="lg" className="laptop:h-12" saving={saving} needsConnection onClick={() => void link()}>
                {LINK_SUBMIT}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 px-2" data-testid="link-sale">
            <p className="text-[14px] leading-[1.45] text-ink-2">{LINK_NOTE}</p>
            <Combobox.Root<BuyerAccount>
              items={accounts}
              value={selected}
              onValueChange={(account) => {
                setProfileId(account?.id ?? "");
                if (account) setText(accountLabel(account));
              }}
              inputValue={text}
              onInputValueChange={(next, details) => {
                if (!TYPED.has(details.reason)) return;
                setText(next);
                setProfileId("");
              }}
              itemToStringLabel={accountLabel}
              itemToStringValue={(account) => account.id}
              filter={(account, query) => accountMatches(account, query)}
              limit={50}
              autoHighlight
            >
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-ink-2">Account</span>
                <Combobox.Input
                  placeholder={BUYER_SEARCH_PLACEHOLDER}
                  autoComplete="off"
                  className="h-[52px] w-full rounded-[14px] border border-line bg-surface px-3.5 text-base text-ink outline-none placeholder:text-ink-3 focus:border-ink focus:shadow-[inset_0_0_0_1px_var(--ink)]"
                />
              </label>
              <Combobox.Portal container={container}>
                <Combobox.Positioner className="z-[95] outline-none" sideOffset={6}>
                  <Combobox.Popup className="max-h-[min(320px,var(--available-height))] w-[var(--anchor-width)] overflow-y-auto rounded-[14px] border border-line bg-surface p-1 text-ink shadow-[var(--sheet-shadow)]">
                    <Combobox.Empty className="px-3 py-2.5 text-[14px] text-ink-3 empty:hidden">{BUYER_SEARCH_EMPTY}</Combobox.Empty>
                    <Combobox.List>
                      {(account: BuyerAccount) => (
                        <Combobox.Item
                          key={account.id}
                          value={account}
                          className="flex min-h-11 cursor-pointer items-center rounded-[10px] px-3 py-1.5 text-[15px] data-highlighted:bg-sunken"
                        >
                          {accountLabel(account)}
                        </Combobox.Item>
                      )}
                    </Combobox.List>
                  </Combobox.Popup>
                </Combobox.Positioner>
              </Combobox.Portal>
            </Combobox.Root>
            <label className="flex cursor-pointer items-center gap-3 text-[15px]">
              <Checkbox checked={sameName} onCheckedChange={setSameName} aria-label={linkSameNameLabel(buyerName)} />
              <span aria-hidden>{linkSameNameLabel(buyerName)}</span>
            </label>
            {error ? (
              <p role="alert" className="text-[13px] font-medium text-missed">
                {error}
              </p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
