"use client";

import { useTransition } from "react";
import { signOutThisDevice } from "@/components/push/use-reminders";
import { SIGN_IN_PATH } from "@/lib/auth/paths";
import { useToast } from "./toast";

const SIGN_OUT_FAILED = "Could not sign out: reminders are still on for this phone. Try again.";

/**
 * Sign out (the account menu and R11 Me). Researchers and admins alike: this
 * phone must stop receiving this account's reminders first; if it can't, the
 * person stays signed in and is told so. Then a full load of the sign-in page
 * drops every bit of client state.
 */
export function useSignOut() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const signOut = () =>
    start(async () => {
      if ((await signOutThisDevice()) !== "signed-out") {
        toast(SIGN_OUT_FAILED, "error");
        return;
      }
      window.location.replace(SIGN_IN_PATH);
    });
  return { pending, signOut };
}
