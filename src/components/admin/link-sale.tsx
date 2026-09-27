"use client";

import { useState } from "react";
import { linkSaleAction } from "@/app/(private)/admin/inventory/actions";
import { AppButton, InlineError } from "@/components/app-shell/form";
import { useSubmit } from "@/components/app-shell/use-submit";
import { accountLabel } from "@/lib/inventory/screens";
import { LINK_BUTTON, LINK_NOTE, LINK_SUBMIT, LINK_TITLE, linkSameNameLabel } from "@/lib/inventory/seller-screens";
import { BuyerAccountPicker, type BuyerAccountOption } from "./buyer-account-picker";
import "@/styles/app/sellers.css";

/**
 * "Link to account…" on an outside buyer's sale (Marco, 2026-09-27): once
 * that person has joined, an admin links the sale to their account, found
 * with A6's account search. Optionally every other outside sale recorded
 * with the same buyer name too. Opens inline under the sale; the page
 * refreshes with the sale shown as an account sale once linked.
 */
export function LinkSale({ saleId, buyerName, accounts }: { saleId: string; buyerName: string; accounts: BuyerAccountOption[] }) {
  const [open, setOpen] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [text, setText] = useState("");
  const [sameName, setSameName] = useState(false);
  const { pending, error, setError, submit } = useSubmit(linkSaleAction);

  if (!open) {
    return (
      <button type="button" className="app-inv-link-open" onClick={() => setOpen(true)}>
        {LINK_BUTTON}
      </button>
    );
  }

  function cancel() {
    setOpen(false);
    setProfileId("");
    setText("");
    setSameName(false);
    setError(undefined);
  }

  return (
    <div className="app-inv-link" role="group" aria-label={LINK_TITLE} data-testid="link-sale">
      <b className="app-inv-link-title">{LINK_TITLE}</b>
      <p className="app-inv-link-note">{LINK_NOTE}</p>
      <BuyerAccountPicker accounts={accounts} value={profileId} onChange={setProfileId} text={text} onTextChange={setText} />
      <label className="app-inv-link-check">
        <input type="checkbox" checked={sameName} onChange={(e) => setSameName(e.target.checked)} />
        <span>{linkSameNameLabel(buyerName)}</span>
      </label>
      <InlineError>{error}</InlineError>
      <div className="app-inv-link-actions">
        <AppButton
          size="sm"
          saving={pending}
          onClick={() => {
            // Only the account the field shows is linked (as on A6).
            const chosen = accounts.find((account) => account.id === profileId);
            const id = chosen && accountLabel(chosen) === text ? chosen.id : "";
            submit({ saleId, profileId: id, sameName }, (result) => {
              if (result.linked) setOpen(false);
            });
          }}
        >
          {LINK_SUBMIT}
        </AppButton>
        <AppButton variant="secondary" size="sm" disabled={pending} onClick={cancel}>
          Cancel
        </AppButton>
      </div>
    </div>
  );
}
