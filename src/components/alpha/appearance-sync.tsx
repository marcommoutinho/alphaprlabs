"use client";

import { useEffect } from "react";
import { APPEARANCE_COOKIE, appearanceCookie, parseAppearance, type Appearance } from "@/lib/alpha/appearance";

/** This device's stored choice (the alpha-appearance cookie). */
function deviceAppearance(): Appearance {
  const entry = document.cookie.split("; ").find((part) => part.startsWith(`${APPEARANCE_COOKIE}=`));
  return parseAppearance(entry ? decodeURIComponent(entry.slice(APPEARANCE_COOKIE.length + 1)) : undefined);
}

/**
 * Keeps this device's appearance cookie equal to the signed-in account's
 * choice (R8 Appearance, stored with the account). The server already
 * rendered the account's choice on <html>; the cookie makes the signed-out
 * screens (sign in, recovery) on this device match. Does nothing while signed
 * out or when the account never chose (the device keeps its own).
 */
export function AppearanceSync({ account }: { account: Appearance | null }) {
  useEffect(() => {
    if (account && deviceAppearance() !== account) document.cookie = appearanceCookie(account);
  }, [account]);
  return null;
}
