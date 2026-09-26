"use client";

import { Combobox } from "@base-ui/react/combobox";
import { usePortalContainer } from "@/components/app-shell/app-root";
import { accountLabel, accountMatches, BUYER_SEARCH_EMPTY, BUYER_SEARCH_PLACEHOLDER } from "@/lib/inventory/screens";

export type BuyerAccountOption = { id: string; name: string; email: string };

/** Rows rendered at once; typing narrows the rest down. */
const SHOWN = 50;
/** Input changes the admin makes by typing, pasting or clearing (not by picking an option). */
const TYPED = new Set(["input-change", "input-clear", "input-paste"]);

/**
 * A6 "Account": the buyer's researcher account (admins included), searchable
 * by name or email. Starts blank (Marco, 2026-09-26): nothing is linked until
 * the admin picks an account. Keyboard: type to filter, arrows to move, Enter
 * to pick, Esc to close (Base UI Combobox). The text is controlled here:
 * editing it after picking an account unlinks that account, so a sale can
 * never go to an account other than the one shown.
 */
export function BuyerAccountPicker({
  accounts,
  value,
  onChange,
  text,
  onTextChange,
}: {
  accounts: BuyerAccountOption[];
  /** The chosen account id, or "". */
  value: string;
  onChange: (id: string) => void;
  /** The text in the search field. */
  text: string;
  onTextChange: (text: string) => void;
}) {
  const container = usePortalContainer();
  const selected = accounts.find((account) => account.id === value) ?? null;
  return (
    <Combobox.Root<BuyerAccountOption>
      items={accounts}
      value={selected}
      onValueChange={(account) => onChange(account?.id ?? "")}
      inputValue={text}
      onInputValueChange={(next, details) => {
        onTextChange(next);
        if (selected && TYPED.has(details.reason) && next !== accountLabel(selected)) onChange("");
      }}
      itemToStringLabel={accountLabel}
      itemToStringValue={(account) => account.id}
      filter={(account, query) => accountMatches(account, query)}
      limit={SHOWN}
      autoHighlight
    >
      <label className="app-field">
        <span className="app-field-label">Account</span>
        <Combobox.Input className="app-combo-input" placeholder={BUYER_SEARCH_PLACEHOLDER} autoComplete="off" />
      </label>
      <Combobox.Portal container={container}>
        <Combobox.Positioner className="app-combo-positioner" sideOffset={6}>
          <Combobox.Popup className="app-combo-popup">
            <Combobox.Empty className="app-combo-empty">{BUYER_SEARCH_EMPTY}</Combobox.Empty>
            <Combobox.List className="app-combo-list">
              {(account: BuyerAccountOption) => (
                <Combobox.Item key={account.id} value={account} className="app-combo-item">
                  <span>
                    <span className="app-combo-name">{account.name}</span>
                    <span className="app-combo-email"> · {account.email}</span>
                  </span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
