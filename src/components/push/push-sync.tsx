"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { REMINDERS_READINESS_PATH } from "@/lib/auth/paths";
import { promptsOnLaunch } from "@/lib/push/readiness";
import { captureInstallPrompt, onForeground, readinessSeen, syncThisDevice } from "./use-reminders";

/**
 * Mounted once by the research-side layout (researchers and admins):
 * re-registers this device on every app open and every return to the
 * foreground (silently), and on the first launch from the Home Screen
 * (standalone) without reminders on this device, routes once to the push
 * permission prompt — the Home Screen app doesn't share the browser's
 * session or storage, and on iPhone it is the only place push works. Never
 * in a browser tab, and never a second time (Me › Dose reminders opens it
 * on request).
 */
export function PushSync({ userId, vapidPublicKey }: { userId: string; vapidPublicKey: string }) {
  const router = useRouter();

  useEffect(() => {
    let live = true;
    const check = () =>
      syncThisDevice(userId, vapidPublicKey).then((state) => {
        if (!state) return; // skipped: turning off or signing out
        if (live && promptsOnLaunch(state.facts, { subscribed: state.subscribed, seen: readinessSeen.get() })) {
          readinessSeen.mark();
          router.replace(REMINDERS_READINESS_PATH);
        }
      });
    captureInstallPrompt();
    void check();
    const stop = onForeground(() => void check());
    return () => {
      live = false;
      stop();
    };
  }, [router, userId, vapidPublicKey]);

  return null;
}
