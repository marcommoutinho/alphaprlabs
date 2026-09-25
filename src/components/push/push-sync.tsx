"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { REMINDERS_READINESS_PATH } from "@/lib/auth/paths";
import { isAppleMobile } from "@/lib/push/readiness";
import { captureInstallPrompt, onForeground, readinessSeen, syncThisDevice } from "./use-reminders";

/**
 * Mounted once by the researcher layout: re-registers this device on every
 * app open and every return to the foreground (silently), and the first time
 * the installed iPhone app is opened without reminders on this device, routes
 * once to the readiness step — the home screen app doesn't share Safari's
 * session or storage, so this is the researcher's first chance to turn
 * reminders on there.
 */
export function PushSync({ userId, vapidPublicKey }: { userId: string; vapidPublicKey: string }) {
  const router = useRouter();

  useEffect(() => {
    let live = true;
    const check = () =>
      syncThisDevice(userId, vapidPublicKey).then(({ facts, subscribed }) => {
        const firstInstalledOpen =
          facts.standalone &&
          isAppleMobile(facts.userAgent, facts.maxTouchPoints) &&
          facts.pushApi &&
          facts.permission !== "denied" &&
          !subscribed &&
          !readinessSeen.get();
        if (live && firstInstalledOpen) {
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
