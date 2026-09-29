"use client";

import { useTransition } from "react";
import { signOutThisDevice } from "@/components/push/use-reminders";
import { SIGN_IN_PATH } from "@/lib/auth/paths";
import { useAlphaToast } from "@/components/alpha/toast";

const SIGN_OUT_FAILED = "Could not sign out: reminders are still on for this phone. Try again.";

/**
 * Sign out (the account menu and R11 Me). Researchers and admins alike: this
 * phone must stop receiving this account's reminders first; if it can't, the
 * person stays signed in and is told so. Then a full load of the sign-in page
 * drops every bit of client state.
 */
export function useSignOut() {
  const [pending, start] = useTransition();
  const toast = useAlphaToast();
  const signOut = () =>
    start(async () => {
      if ((await signOutThisDevice()) !== "signed-out") {
        toast.error({ message: SIGN_OUT_FAILED });
        return;
      }
      window.location.replace(SIGN_IN_PATH);
    });
  return { pending, signOut };
}
