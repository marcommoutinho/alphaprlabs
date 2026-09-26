"use client";

import { Combobox } from "@base-ui/react/combobox";
import { usePortalContainer } from "@/components/app-shell/app-root";
import { accountMatches, BUYER_SEARCH_EMPTY, BUYER_SEARCH_PLACEHOLDER } from "@/lib/inventory/screens";

export type BuyerAccountOption = { id: string; name: string; email: string };

const labelOf = (account: BuyerAccountOption) => `${account.name} · ${account.email}`;
/** Rows rendered at once; typing narrows the rest down. */
const SHOWN = 50;

/**
 * A6 "Account": the buyer's researcher account (admins included), searchable
 * by name or email. Starts blank (Marco, 2026-09-26): nothing is linked until
 * the admin picks an account. Keyboard: type to filter, arrows to move, Enter
 * to pick, Esc to close (Base UI Combobox).
 */
export function BuyerAccountPicker({
  accounts,
  value,
  onChange,
}: {
  accounts: BuyerAccountOption[];
  /** The chosen account id, or "". */
  value: string;
  onChange: (id: string) => void;
}) {
  const container = usePortalContainer();
  const selected = accounts.find((account) => account.id === value) ?? null;
  return (
    <Combobox.Root
      items={accounts}
      value={selected}
      onValueChange={(account) => onChange(account?.id ?? "")}
      itemToStringLabel={labelOf}
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
